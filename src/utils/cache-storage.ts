import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ExtensionStorageContext {
  globalStorageUri: {
    fsPath: string;
  };
}

export interface CacheRoots {
  base: string;
  pakCache: string;
  patchCache: string;
  archiveIndex: string;
}

export interface CacheMigrationResult {
  roots: CacheRoots;
  movedEntries: number;
  warnings: string[];
}

const CACHE_FOLDER_NAME = 'BOO-NGOM-Editor';
const CACHE_DIRECTORIES = ['pak-cache', 'patch-cache', 'archive-index-v1'] as const;

export function getCacheRoots(
  context: ExtensionStorageContext,
  env: NodeJS.ProcessEnv = process.env
): CacheRoots {
  const legacyRoot = path.resolve(context.globalStorageUri.fsPath);
  const base = resolveExternalCacheBase(legacyRoot, env);
  return {
    base,
    pakCache: path.join(base, 'pak-cache'),
    patchCache: path.join(base, 'patch-cache'),
    archiveIndex: path.join(base, 'archive-index-v1'),
  };
}

export function getPakCacheRoot(context: ExtensionStorageContext): string {
  return getCacheRoots(context).pakCache;
}

export function getPatchCacheRoot(context: ExtensionStorageContext): string {
  return getCacheRoots(context).patchCache;
}

export function getArchiveIndexRoot(context: ExtensionStorageContext): string {
  return getCacheRoots(context).archiveIndex;
}

export function initializeCacheStorage(
  context: ExtensionStorageContext,
  env: NodeJS.ProcessEnv = process.env
): CacheMigrationResult {
  const legacyRoot = path.resolve(context.globalStorageUri.fsPath);
  const roots = getCacheRoots(context, env);
  const warnings: string[] = [];
  let movedEntries = 0;

  fs.mkdirSync(roots.base, { recursive: true });
  for (const directoryName of CACHE_DIRECTORIES) {
    const source = path.join(legacyRoot, directoryName);
    const target = path.join(roots.base, directoryName);
    try {
      movedEntries += moveCacheDirectory(source, target);
    } catch (error) {
      warnings.push(`${directoryName}: ${errorText(error)}`);
    }
    fs.mkdirSync(target, { recursive: true });
  }

  return { roots, movedEntries, warnings };
}

function resolveExternalCacheBase(
  legacyRoot: string,
  env: NodeJS.ProcessEnv
): string {
  const platformCacheRoot = process.platform === 'win32'
    ? env.LOCALAPPDATA
    : env.XDG_CACHE_HOME;
  const homeCacheRoot = process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local')
    : path.join(os.homedir(), '.cache');
  const roamingFallback = env.APPDATA || deriveRoamingRoot(legacyRoot);
  const candidates = [
    platformCacheRoot,
    roamingFallback,
    homeCacheRoot,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => path.resolve(value, CACHE_FOLDER_NAME, 'cache'))
    .filter(candidate => !isSameOrInside(candidate, legacyRoot));
  const uniqueCandidates = [...new Map(
    candidates.map(candidate => [normalizePath(candidate), candidate])
  ).values()];
  if (uniqueCandidates.length === 0) {
    throw new Error('无法确定 VS Code 管理目录之外的缓存位置');
  }
  return uniqueCandidates.find(candidate => isSameVolume(candidate, legacyRoot))
    || uniqueCandidates[0];
}

function moveCacheDirectory(source: string, target: string): number {
  if (!fs.existsSync(source) || normalizePath(source) === normalizePath(target)) return 0;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) {
    fs.renameSync(source, target);
    return 1;
  }

  let movedEntries = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const entrySource = path.join(source, entry.name);
    const entryTarget = availableTargetPath(target, entry.name);
    fs.renameSync(entrySource, entryTarget);
    movedEntries++;
  }
  fs.rmdirSync(source);
  return movedEntries;
}

function availableTargetPath(targetRoot: string, entryName: string): string {
  const preferred = path.join(targetRoot, entryName);
  if (!fs.existsSync(preferred)) return preferred;
  const parsed = path.parse(entryName);
  const stamp = Date.now();
  for (let counter = 1; counter < Number.MAX_SAFE_INTEGER; counter++) {
    const candidate = path.join(
      targetRoot,
      `${parsed.name}.legacy-${stamp}-${counter}${parsed.ext}`
    );
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`无法为旧缓存分配迁移目录: ${entryName}`);
}

function deriveRoamingRoot(legacyRoot: string): string {
  let current = legacyRoot;
  for (let index = 0; index < 4; index++) current = path.dirname(current);
  return current;
}

function isSameVolume(left: string, right: string): boolean {
  return path.parse(path.resolve(left)).root.toLowerCase()
    === path.parse(path.resolve(right)).root.toLowerCase();
}

function isSameOrInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizePath(filePath: string): string {
  return path.normalize(path.resolve(filePath)).toLowerCase();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
