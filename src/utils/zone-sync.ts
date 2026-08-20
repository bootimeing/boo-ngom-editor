import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface ZoneSyncFile {
  sourcePath: string;
  relativePath: string;
}

export interface ZoneSyncInventory {
  workspaceRoot: string;
  files: ZoneSyncFile[];
  directories: string[];
  skippedSymbolicLinks: string[];
}

export interface ZoneSyncFailure {
  sourcePath: string;
  targetPath: string;
  message: string;
}

export interface ZoneSyncResult {
  copiedFiles: number;
  overwrittenFiles: number;
  createdFiles: number;
  createdDirectories: number;
  completedOperations: number;
  totalOperations: number;
  cancelled: boolean;
  failures: ZoneSyncFailure[];
}

export interface ZoneSyncProgress {
  completed: number;
  total: number;
  sourcePath: string;
  targetPath: string;
}

export interface CollectZoneSyncOptions {
  isCancelled?: () => boolean;
  onProgress?: (visitedEntries: number, currentPath: string) => void;
}

export interface ExecuteZoneSyncOptions {
  isCancelled?: () => boolean;
  onProgress?: (progress: ZoneSyncProgress) => void;
}

export class ZoneSyncCancelledError extends Error {
  constructor() {
    super('区服同步已取消');
    this.name = 'ZoneSyncCancelledError';
  }
}

interface SelectedSource {
  sourcePath: string;
  isDirectory: boolean;
}

export async function collectZoneSyncInventory(
  workspaceRoot: string,
  selectedPaths: readonly string[],
  options: CollectZoneSyncOptions = {}
): Promise<ZoneSyncInventory> {
  const root = path.resolve(workspaceRoot);
  const selected = await normalizeSelectedSources(root, selectedPaths, options);
  const files = new Map<string, ZoneSyncFile>();
  const directories = new Map<string, string>();
  const skippedSymbolicLinks = new Map<string, string>();
  const pendingDirectories: string[] = [];
  let visitedEntries = 0;

  const rememberDirectory = (directoryPath: string): void => {
    const relativePath = relativePathInside(root, directoryPath);
    directories.set(pathKey(relativePath), relativePath);
  };
  const rememberFile = (filePath: string): void => {
    const relativePath = relativePathInside(root, filePath);
    files.set(pathKey(relativePath), { sourcePath: filePath, relativePath });
  };

  for (const source of selected) {
    throwIfCancelled(options);
    if (source.isDirectory) {
      rememberDirectory(source.sourcePath);
      pendingDirectories.push(source.sourcePath);
    } else {
      rememberFile(source.sourcePath);
    }
  }

  while (pendingDirectories.length > 0) {
    throwIfCancelled(options);
    const directoryPath = pendingDirectories.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      throw new Error(`无法读取文件夹 ${directoryPath}: ${errorText(error)}`);
    }
    entries.sort((left, right) => left.name.localeCompare(
      right.name,
      'zh-CN',
      { numeric: true, sensitivity: 'base' }
    ));
    for (const entry of entries) {
      throwIfCancelled(options);
      const entryPath = path.join(directoryPath, entry.name);
      visitedEntries++;
      options.onProgress?.(visitedEntries, entryPath);
      if (entry.isSymbolicLink()) {
        skippedSymbolicLinks.set(pathKey(entryPath), entryPath);
      } else if (entry.isDirectory()) {
        rememberDirectory(entryPath);
        pendingDirectories.push(entryPath);
      } else if (entry.isFile()) {
        rememberFile(entryPath);
      } else {
        const stat = await fs.promises.lstat(entryPath);
        if (stat.isSymbolicLink()) skippedSymbolicLinks.set(pathKey(entryPath), entryPath);
        else if (stat.isDirectory()) {
          rememberDirectory(entryPath);
          pendingDirectories.push(entryPath);
        } else if (stat.isFile()) rememberFile(entryPath);
      }
      if (visitedEntries % 250 === 0) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }
  }

  return {
    workspaceRoot: root,
    files: [...files.values()].sort((left, right) => compareRelativePaths(
      left.relativePath,
      right.relativePath
    )),
    directories: [...directories.values()].sort(compareDirectories),
    skippedSymbolicLinks: [...skippedSymbolicLinks.values()].sort(compareRelativePaths),
  };
}

export function validateZoneSyncTargets(
  workspaceRoot: string,
  targetRoots: readonly string[]
): string[] {
  const sourceRoot = path.resolve(workspaceRoot);
  const unique = new Map<string, string>();
  for (const rawTarget of targetRoots) {
    const target = path.resolve(rawTarget);
    const targetKey = pathKey(target);
    if (unique.has(targetKey)) continue;
    if (pathsOverlap(sourceRoot, target)) {
      throw new Error(`目标目录不能与当前工作区重叠: ${target}`);
    }
    for (const existing of unique.values()) {
      if (pathsOverlap(existing, target)) {
        throw new Error(`目标区目录不能互相包含: ${existing} 与 ${target}`);
      }
    }
    unique.set(targetKey, target);
  }
  return [...unique.values()].sort(compareRelativePaths);
}

export async function executeZoneSync(
  inventory: ZoneSyncInventory,
  targetRoots: readonly string[],
  options: ExecuteZoneSyncOptions = {}
): Promise<ZoneSyncResult> {
  const targets = validateZoneSyncTargets(inventory.workspaceRoot, targetRoots);
  const totalOperations = inventory.files.length * targets.length;
  const failures: ZoneSyncFailure[] = [];
  const createdDirectoryKeys = new Set<string>();
  let copiedFiles = 0;
  let overwrittenFiles = 0;
  let createdFiles = 0;
  let completedOperations = 0;

  for (const targetRoot of targets) {
    if (options.isCancelled?.()) break;
    for (const relativeDirectory of inventory.directories) {
      if (options.isCancelled?.()) break;
      const targetDirectory = resolveTargetPath(targetRoot, relativeDirectory);
      try {
        if (!fs.existsSync(targetDirectory)) {
          await fs.promises.mkdir(targetDirectory, { recursive: true });
          createdDirectoryKeys.add(pathKey(targetDirectory));
        }
      } catch (error) {
        failures.push({
          sourcePath: path.join(inventory.workspaceRoot, relativeDirectory),
          targetPath: targetDirectory,
          message: errorText(error),
        });
      }
    }

    for (const file of inventory.files) {
      if (options.isCancelled?.()) break;
      const targetPath = resolveTargetPath(targetRoot, file.relativePath);
      const existed = fs.existsSync(targetPath);
      try {
        const parentDirectory = path.dirname(targetPath);
        if (!fs.existsSync(parentDirectory)) {
          await fs.promises.mkdir(parentDirectory, { recursive: true });
          createdDirectoryKeys.add(pathKey(parentDirectory));
        }
        await copyFileForZoneSync(file.sourcePath, targetPath);
        copiedFiles++;
        if (existed) overwrittenFiles++;
        else createdFiles++;
      } catch (error) {
        failures.push({
          sourcePath: file.sourcePath,
          targetPath,
          message: errorText(error),
        });
      }
      completedOperations++;
      options.onProgress?.({
        completed: completedOperations,
        total: totalOperations,
        sourcePath: file.sourcePath,
        targetPath,
      });
      if (completedOperations % 50 === 0) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }
  }

  return {
    copiedFiles,
    overwrittenFiles,
    createdFiles,
    createdDirectories: createdDirectoryKeys.size,
    completedOperations,
    totalOperations,
    cancelled: completedOperations < totalOperations && Boolean(options.isCancelled?.()),
    failures,
  };
}

function throwIfCancelled(options: CollectZoneSyncOptions): void {
  if (options.isCancelled?.()) throw new ZoneSyncCancelledError();
}

async function normalizeSelectedSources(
  workspaceRoot: string,
  selectedPaths: readonly string[],
  options: CollectZoneSyncOptions
): Promise<SelectedSource[]> {
  const unique = new Map<string, string>();
  for (const selectedPath of selectedPaths) {
    const sourcePath = path.resolve(selectedPath);
    relativePathInside(workspaceRoot, sourcePath);
    unique.set(pathKey(sourcePath), sourcePath);
  }

  const classified: SelectedSource[] = [];
  for (const sourcePath of unique.values()) {
    throwIfCancelled(options);
    const stat = await fs.promises.lstat(sourcePath);
    if (stat.isSymbolicLink()) continue;
    if (!stat.isDirectory() && !stat.isFile()) continue;
    classified.push({ sourcePath, isDirectory: stat.isDirectory() });
  }
  classified.sort((left, right) => (
    left.sourcePath.length - right.sourcePath.length
    || compareRelativePaths(left.sourcePath, right.sourcePath)
  ));

  const result: SelectedSource[] = [];
  for (const candidate of classified) {
    const covered = result.some(parent => (
      parent.isDirectory && isSameOrInside(candidate.sourcePath, parent.sourcePath)
    ));
    if (!covered) result.push(candidate);
  }
  return result;
}

async function copyFileForZoneSync(sourcePath: string, targetPath: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const sourceBefore = await fs.promises.stat(sourcePath);
    const temporaryPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.boo-sync-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`
    );
    try {
      await fs.promises.copyFile(sourcePath, temporaryPath);
      const sourceAfter = await fs.promises.stat(sourcePath);
      if (
        sourceBefore.size !== sourceAfter.size
        || sourceBefore.mtimeMs !== sourceAfter.mtimeMs
      ) {
        if (attempt === 0) continue;
        throw new Error('源文件在同步过程中发生变化，请重新同步');
      }
      await fs.promises.utimes(temporaryPath, sourceAfter.atime, sourceAfter.mtime);
      try {
        await fs.promises.rename(temporaryPath, targetPath);
      } catch (error) {
        if (!isReplaceRenameError(error) || !fs.existsSync(targetPath)) throw error;
        await fs.promises.copyFile(temporaryPath, targetPath);
        await fs.promises.utimes(targetPath, sourceAfter.atime, sourceAfter.mtime);
        await fs.promises.unlink(temporaryPath);
      }
      return;
    } finally {
      try { await fs.promises.unlink(temporaryPath); } catch { /* already published or absent */ }
    }
  }
}

function resolveTargetPath(targetRoot: string, relativePath: string): string {
  const resolvedRoot = path.resolve(targetRoot);
  const targetPath = path.resolve(resolvedRoot, relativePath);
  if (!isSameOrInside(targetPath, resolvedRoot)) {
    throw new Error(`同步目标超出所选区服根目录: ${relativePath}`);
  }
  return targetPath;
}

function relativePathInside(root: string, candidate: string): string {
  const relativePath = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relativePath === '..'
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) {
    throw new Error(`所选文件不在当前工作区根目录内: ${candidate}`);
  }
  return relativePath;
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrInside(left, right) || isSameOrInside(right, left);
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(candidate));
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
}

function isReplaceRenameError(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as NodeJS.ErrnoException).code || '')
    : '';
  return code === 'EEXIST' || code === 'EPERM' || code === 'EACCES' || code === 'ENOTEMPTY';
}

function compareDirectories(left: string, right: string): number {
  const leftDepth = left ? left.split(path.sep).length : 0;
  const rightDepth = right ? right.split(path.sep).length : 0;
  return leftDepth - rightDepth || compareRelativePaths(left, right);
}

function compareRelativePaths(left: string, right: string): number {
  return left.localeCompare(right, 'zh-CN', { numeric: true, sensitivity: 'base' });
}

function pathKey(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
