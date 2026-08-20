import * as fs from 'fs';
import * as path from 'path';

export interface ScriptSyncTreeEntry {
  name: string;
  entryPath: string;
  isDirectory: boolean;
}

export async function listScriptSyncDirectory(
  rootPath: string,
  directoryPath: string,
  includeFiles: boolean
): Promise<ScriptSyncTreeEntry[]> {
  const safeDirectory = await resolveSafeExistingPath(rootPath, directoryPath);
  const directoryStat = await fs.promises.lstat(safeDirectory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error(`不是可读取的文件夹: ${safeDirectory}`);
  }

  const entries = await fs.promises.readdir(safeDirectory, { withFileTypes: true });
  const result: ScriptSyncTreeEntry[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(safeDirectory, entry.name);
    if (entry.isDirectory()) {
      result.push({ name: entry.name, entryPath, isDirectory: true });
    } else if (includeFiles && entry.isFile()) {
      result.push({ name: entry.name, entryPath, isDirectory: false });
    } else if (!entry.isFile() && !entry.isDirectory()) {
      const stat = await fs.promises.lstat(entryPath);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        result.push({ name: entry.name, entryPath, isDirectory: true });
      } else if (includeFiles && stat.isFile()) {
        result.push({ name: entry.name, entryPath, isDirectory: false });
      }
    }
  }

  return result.sort((left, right) => (
    Number(right.isDirectory) - Number(left.isDirectory)
    || left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
  ));
}

export async function validateScriptSyncSources(
  workspaceRoot: string,
  selectedPaths: readonly string[]
): Promise<string[]> {
  return validateSelections(workspaceRoot, selectedPaths, true, true);
}

export async function validateScriptSyncTargets(
  driveRoot: string,
  selectedPaths: readonly string[]
): Promise<string[]> {
  const targets = await validateSelections(driveRoot, selectedPaths, false, false);
  const rootKey = pathKey(path.resolve(driveRoot));
  for (const target of targets) {
    if (pathKey(target) === rootKey) {
      throw new Error('不能将整个磁盘根目录选为同步目标');
    }
  }
  return targets;
}

async function validateSelections(
  rootPath: string,
  selectedPaths: readonly string[],
  allowFiles: boolean,
  allowRoot: boolean
): Promise<string[]> {
  const root = path.resolve(rootPath);
  const unique = new Map<string, string>();
  for (const selectedPath of selectedPaths) {
    const safePath = await resolveSafeExistingPath(root, selectedPath);
    if (!allowRoot && pathKey(safePath) === pathKey(root)) {
      throw new Error('不能选择根目录');
    }
    const stat = await fs.promises.lstat(safePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`不能选择符号链接: ${safePath}`);
    }
    if (!stat.isDirectory() && !(allowFiles && stat.isFile())) {
      throw new Error(`所选路径类型不受支持: ${safePath}`);
    }
    unique.set(pathKey(safePath), safePath);
  }
  return [...unique.values()].sort((left, right) => left.localeCompare(
    right,
    'zh-CN',
    { numeric: true, sensitivity: 'base' }
  ));
}

async function resolveSafeExistingPath(rootPath: string, candidatePath: string): Promise<string> {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  if (!isSameOrInside(candidate, root)) {
    throw new Error(`路径超出允许范围: ${candidate}`);
  }

  const [realRoot, realCandidate] = await Promise.all([
    fs.promises.realpath(root),
    fs.promises.realpath(candidate),
  ]);
  if (!isSameOrInside(realCandidate, realRoot)) {
    throw new Error(`路径通过链接跳出了允许范围: ${candidate}`);
  }
  return candidate;
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relativePath = path.relative(path.resolve(parent), path.resolve(candidate));
  return relativePath === '' || (
    relativePath !== '..'
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
}

function pathKey(value: string): string {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
