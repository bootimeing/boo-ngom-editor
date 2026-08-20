import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  DecodedPakAsset,
  DecodedPakResult,
  GOM_DECODER_REVISION,
  JPK_DECODER_REVISION,
} from './pak-reader';
import {
  ARCHIVE_INDEX_DECODER_REVISION,
  ARCHIVE_INDEX_FILE,
  getArchiveIndexDirectory,
  listArchiveIndexSummaries,
  loadArchiveAssetTable,
  loadArchiveResult,
  updateArchiveSourceMd5,
} from './archive-index';
import { EngineId } from '../types';
import {
  ArchiveExtension,
  ArchiveFormat,
} from './archive-types';
import {
  isPathInsideAny,
  resourceRootRank,
  selectPreferredArchiveFile,
} from './client-resources';

export type PatchStatus = 'waiting' | 'caching' | 'cached' | 'password-error' | 'error';
export type PatchReadScope = 'required' | 'all';

export interface PatchEntry {
  path: string;
  name: string;
  status: PatchStatus;
  message: string;
  progress: number;
  passwordRequired?: boolean;
}

export interface SavedPatchManagerState {
  clientDirectory?: string;
  dataDirectory?: string;
  customPatchName?: string;
  passwordFile: string;
  entries: PatchEntry[];
  stateVersion?: number;
  engine?: 'GOM' | 'GEE' | '996PC';
}

export interface CachedPatchPak {
  manifestPath: string;
  cacheDir: string;
  pakPath: string;
  pakName: string;
  sourceMd5?: string;
  decoderRevision?: string;
  format: ArchiveFormat;
  storedWillIdx: number;
  slotCount: number;
  cachedAt: number;
  storageMode?: 'legacy' | 'direct';
  archiveId?: string;
  sourceSize?: number;
  sourceMtimeMs?: number;
  companionPath?: string;
  companionSize?: number;
  companionMtimeMs?: number;
}

export interface CachedPatchAssetTable {
  slotCount: number;
  present: Uint8Array;
  blank: Uint8Array;
  width: Uint16Array;
  height: Uint16Array;
  offsetX: Int32Array;
  offsetY: Int32Array;
}

export type CachedPatchArchiveResolution =
  | { status: 'ready'; sourcePath: string; pak: CachedPatchPak }
  | { status: 'missing-source' }
  | { status: 'not-indexed'; sourcePath: string }
  | { status: 'stale'; sourcePath: string; pak: CachedPatchPak };

interface StoredPatchManifest {
  format: ArchiveFormat;
  pakName: string;
  pakPath: string;
  sourceMd5?: string;
  decoderRevision?: string;
  willIdx: number;
  slotCount: number;
  assets: DecodedPakAsset[];
}

export const PATCH_MANAGER_STATE_KEY = 'boo.patchManager.state';
export function patchManagerStateKey(engine: EngineId): string {
  return `${PATCH_MANAGER_STATE_KEY}:${engine}`;
}
export const REQUIRED_PATCH_PAK_NAMES = [
  'mmap10',
  'items',
  ...Array.from({ length: 9 }, (_, index) => `items${index + 1}`),
];

let cachedRoot = '';
let cachedPatchPaks: CachedPatchPak[] | undefined;

export type PatchCacheMd5Validation =
  | { current: true; reason: 'match'; sourceMd5: string }
  | {
      current: false;
      reason: 'changed' | 'metadata-changed';
      sourceMd5: string;
    }
  | {
      current: false;
      reason: 'legacy' | 'incomplete' | 'source-missing' | 'read-error' | 'decoder-outdated';
    };

export function invalidatePatchCacheIndex(): void {
  cachedRoot = '';
  cachedPatchPaks = undefined;
}

export function listCachedPatchPaks(
  cacheRoot: string,
  resourceRoots?: string | readonly string[],
  preferredStorageMode: 'legacy' | 'direct' = 'direct'
): CachedPatchPak[] {
  const resolvedRoot = path.resolve(cacheRoot);
  if (!cachedPatchPaks || normalizePath(cachedRoot) !== normalizePath(resolvedRoot)) {
    cachedRoot = resolvedRoot;
    cachedPatchPaks = scanPatchCache(resolvedRoot);
  }
  const roots = normalizeResourceRoots(resourceRoots);
  const filtered = roots === undefined
    ? cachedPatchPaks
    : cachedPatchPaks.filter(item => isPathInsideAny(item.pakPath, roots));
  return sortCachedByResourcePriority(
    selectPreferredPatchCaches(filtered, preferredStorageMode),
    roots
  );
}

export function findCachedPatchPakByPath(
  cacheRoot: string,
  pakPath: string,
  resourceRoots?: string | readonly string[],
  preferredStorageMode: 'legacy' | 'direct' = 'direct'
): CachedPatchPak | undefined {
  const key = normalizePath(pakPath);
  return listCachedPatchPaks(cacheRoot, resourceRoots, preferredStorageMode)
    .find(item => normalizePath(item.pakPath) === key);
}

export function resolveCachedPatchArchiveByName(
  cacheRoot: string,
  archiveName: string,
  archiveFiles: readonly string[],
  resourceRoots: readonly string[],
  archiveExtensions: readonly ArchiveExtension[]
): CachedPatchArchiveResolution {
  const sourcePath = selectPreferredArchiveFile(
    archiveFiles,
    archiveName,
    resourceRoots,
    archiveExtensions
  );
  if (!sourcePath) return { status: 'missing-source' };
  const pak = findCachedPatchPakByPath(cacheRoot, sourcePath, resourceRoots);
  if (!pak) return { status: 'not-indexed', sourcePath };
  if (!isPatchCacheCurrent(pak)) return { status: 'stale', sourcePath, pak };
  return { status: 'ready', sourcePath, pak };
}

export function findCachedPatchPakByName(
  cacheRoot: string,
  pakName: string,
  resourceRoots?: string | readonly string[]
): CachedPatchPak | undefined {
  const key = normalizePakName(pakName);
  const requestedExtension = archiveExtension(pakName);
  const roots = normalizeResourceRoots(resourceRoots);
  const candidates = listCachedPatchPaks(cacheRoot, resourceRoots)
    .filter(item => normalizePakName(item.pakName) === key)
    .filter(item => !requestedExtension || archiveExtension(item.pakPath) === requestedExtension)
    .sort((left, right) => compareCachedPatchPaks(left, right, roots));
  return candidates[0];
}

export function findUniqueCurrentCachedPatchPakByName(
  cacheRoot: string,
  pakName: string,
  archiveExtensions?: readonly ArchiveExtension[]
): CachedPatchPak | undefined {
  const key = normalizePakName(pakName);
  const requestedExtension = archiveExtension(pakName);
  const allowedExtensions = requestedExtension
    ? new Set<ArchiveExtension>([requestedExtension])
    : archiveExtensions
      ? new Set(archiveExtensions.map(extension => extension.toLowerCase()))
      : undefined;
  const candidates = listCachedPatchPaks(cacheRoot)
    .filter(item => normalizePakName(item.pakName) === key)
    .filter(item => !allowedExtensions || allowedExtensions.has(
      archiveExtension(item.pakPath) as ArchiveExtension
    ))
    .filter(item => fs.existsSync(item.pakPath))
    .filter(item => !item.companionPath || fs.existsSync(item.companionPath))
    .filter(isPatchCacheCurrent);
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function isPatchCacheCurrent(item: CachedPatchPak): boolean {
  if (!fs.existsSync(item.manifestPath)) return false;
  if (!hasCurrentDecoderRevision(item)) return false;
  if (item.storageMode === 'direct') {
    if (!item.archiveId || !fs.existsSync(path.join(item.cacheDir, ARCHIVE_INDEX_FILE))) return false;
    try {
      const stat = fs.statSync(item.pakPath);
      if (stat.size !== item.sourceSize || stat.mtimeMs !== item.sourceMtimeMs) return false;
      if (item.companionPath) {
        const companionStat = fs.statSync(item.companionPath);
        if (
          companionStat.size !== item.companionSize
          || companionStat.mtimeMs !== item.companionMtimeMs
        ) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
  if (item.slotCount > 0) {
    const first = patchImagePath(item, 0);
    const last = patchImagePath(item, item.slotCount - 1);
    if (!fs.existsSync(first) || !fs.existsSync(last)) return false;
  }
  try {
    if (fs.existsSync(item.pakPath) && fs.statSync(item.pakPath).mtimeMs > item.cachedAt + 1) return false;
  } catch {
    return false;
  }
  return true;
}

export async function validatePatchCacheMd5(
  item: CachedPatchPak
): Promise<PatchCacheMd5Validation> {
  if (!hasCurrentDecoderRevision(item)) return { current: false, reason: 'decoder-outdated' };
  if (!hasCompletePatchCache(item)) return { current: false, reason: 'incomplete' };
  if (!fs.existsSync(item.pakPath)) return { current: false, reason: 'source-missing' };

  try {
    const before = await fs.promises.stat(item.pakPath);
    const companionBefore = item.companionPath
      ? await fs.promises.stat(item.companionPath)
      : undefined;
    const sourceMd5 = await calculateFileMd5(item.pakPath);
    const after = await fs.promises.stat(item.pakPath);
    const companionAfter = item.companionPath
      ? await fs.promises.stat(item.companionPath)
      : undefined;
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      return { current: false, reason: 'changed', sourceMd5 };
    }
    if (
      companionBefore
      && companionAfter
      && (
        companionBefore.size !== companionAfter.size
        || companionBefore.mtimeMs !== companionAfter.mtimeMs
        || companionAfter.size !== item.companionSize
        || companionAfter.mtimeMs !== item.companionMtimeMs
      )
    ) {
      return { current: false, reason: 'changed', sourceMd5 };
    }
    if (item.sourceMd5 && sourceMd5 !== item.sourceMd5.toLowerCase()) {
      return { current: false, reason: 'changed', sourceMd5 };
    }
    if (
      item.storageMode === 'direct'
      && (after.size !== item.sourceSize || after.mtimeMs !== item.sourceMtimeMs)
    ) {
      return { current: false, reason: 'metadata-changed', sourceMd5 };
    }
    if (!item.sourceMd5) {
      if (item.storageMode !== 'direct' || !item.archiveId) {
        return { current: false, reason: 'legacy' };
      }
      updateArchiveSourceMd5(archiveIndexRootForPatchCacheRoot(path.dirname(item.cacheDir)), item.archiveId, sourceMd5);
      item.sourceMd5 = sourceMd5;
    }
    markManifestValidated(item, after.mtimeMs);
    return { current: true, reason: 'match', sourceMd5 };
  } catch {
    return { current: false, reason: 'read-error' };
  }
}

function hasCurrentDecoderRevision(item: CachedPatchPak): boolean {
  if (item.storageMode === 'direct') {
    return item.decoderRevision === ARCHIVE_INDEX_DECODER_REVISION;
  }
  if (item.format === 'JPK') return item.decoderRevision === JPK_DECODER_REVISION;
  if (item.format === 'GOM') return item.decoderRevision === GOM_DECODER_REVISION;
  return true;
}

export function calculateFileMd5(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => {
      try {
        resolve(hash.digest('hex'));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function patchImagePath(item: CachedPatchPak, imageIndex: number): string {
  if (item.storageMode === 'direct') return '';
  return path.join(item.cacheDir, `${String(Math.trunc(imageIndex)).padStart(6, '0')}.png`);
}

export function findCachedPatchImage(
  cacheRoot: string,
  pakName: string,
  imageIndex: number,
  resourceRoots?: string | readonly string[],
  archiveExtensions?: readonly ArchiveExtension[]
): { pak: CachedPatchPak; imagePath: string; archiveId?: string; imageIndex: number } | undefined {
  if (!Number.isInteger(imageIndex) || imageIndex < 0) return undefined;
  const key = normalizePakName(pakName);
  const requestedExtension = archiveExtension(pakName);
  const allowedExtensions = requestedExtension
    ? new Set<ArchiveExtension>([requestedExtension])
    : archiveExtensions
    ? new Set(archiveExtensions.map(extension => extension.toLowerCase()))
    : undefined;
  const roots = normalizeResourceRoots(resourceRoots);
  const candidates = listCachedPatchPaks(cacheRoot, resourceRoots)
    .filter(item => normalizePakName(item.pakName) === key)
    .filter(item => !allowedExtensions || allowedExtensions.has(
      archiveExtension(item.pakPath) as ArchiveExtension
    ))
    .sort((left, right) => compareCachedPatchPaks(left, right, roots));
  for (const pak of candidates) {
    if (!isPatchCacheCurrent(pak) || imageIndex >= pak.slotCount) continue;
    if (pak.storageMode === 'direct' && pak.archiveId) {
      return { pak, imagePath: '', archiveId: pak.archiveId, imageIndex };
    }
    const imagePath = patchImagePath(pak, imageIndex);
    if (fs.existsSync(imagePath)) return { pak, imagePath, imageIndex };
  }
  return undefined;
}

export function loadCachedPatchPakResult(item: CachedPatchPak, willIdx: number): DecodedPakResult {
  if (item.storageMode === 'direct' && item.archiveId) {
    return loadArchiveResult(
      archiveIndexRootForPatchCacheRoot(path.dirname(item.cacheDir)),
      item.archiveId,
      willIdx
    );
  }
  const stored = JSON.parse(fs.readFileSync(item.manifestPath, 'utf8')) as StoredPatchManifest;
  if (!Array.isArray(stored.assets) || !Number.isInteger(stored.slotCount)) {
    throw new Error(`${item.pakName} 的补丁缓存清单无效`);
  }
  const assets = stored.assets.map(asset => ({
    ...asset,
    path: rebaseCachedAssetPath(asset, item.cacheDir),
    pakName: item.pakName,
    pakPath: item.pakPath,
    willIdx,
    source: item.format === 'JPK'
      ? 'jpk' as const
      : item.format === 'WIL'
        ? 'wil' as const
        : item.format === 'WZL'
          ? 'wzl' as const
          : 'pak' as const,
  }));
  return {
    format: item.format,
    pakName: item.pakName,
    pakPath: item.pakPath,
    willIdx,
    slotCount: item.slotCount,
    assets,
    cacheDir: item.cacheDir,
    fromCache: true,
  };
}

export function loadCachedPatchAssetTable(item: CachedPatchPak): CachedPatchAssetTable {
  if (item.storageMode === 'direct' && item.archiveId) {
    return loadArchiveAssetTable(
      archiveIndexRootForPatchCacheRoot(path.dirname(item.cacheDir)),
      item.archiveId
    );
  }
  const stored = JSON.parse(fs.readFileSync(item.manifestPath, 'utf8')) as StoredPatchManifest;
  if (!Array.isArray(stored.assets) || !Number.isInteger(stored.slotCount) || stored.slotCount < 0) {
    throw new Error(`${item.pakName} 的补丁缓存清单无效`);
  }
  const slotCount = stored.slotCount;
  const table: CachedPatchAssetTable = {
    slotCount,
    present: new Uint8Array(slotCount),
    blank: new Uint8Array(slotCount),
    width: new Uint16Array(slotCount),
    height: new Uint16Array(slotCount),
    offsetX: new Int32Array(slotCount),
    offsetY: new Int32Array(slotCount),
  };
  for (const asset of stored.assets) {
    const index = Number(asset.imageIdx);
    if (!Number.isInteger(index) || index < 0 || index >= slotCount) continue;
    table.present[index] = 1;
    table.blank[index] = asset.isBlank ? 1 : 0;
    table.width[index] = Math.max(0, Math.min(65535, Math.trunc(Number(asset.width) || 0)));
    table.height[index] = Math.max(0, Math.min(65535, Math.trunc(Number(asset.height) || 0)));
    table.offsetX[index] = Math.trunc(Number(asset.offsetX) || 0);
    table.offsetY[index] = Math.trunc(Number(asset.offsetY) || 0);
  }
  return table;
}

export async function scanPatchPakFiles(dataDirectory: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && /\.(?:pak|jpk)$/i.test(entry.name)) {
        result.push(path.resolve(entryPath));
      }
    }
  };
  await visit(path.resolve(dataDirectory));
  return result;
}

export function filterRequiredPatchPakFiles(
  pakPaths: string[],
  effectImagePakNames: string[]
): string[] {
  const fixedNames = new Set(REQUIRED_PATCH_PAK_NAMES.map(name => name.toLowerCase()));
  const references = effectImagePakNames.map(parseArchiveReference).filter(isArchiveReference);
  const selectedFixedNames = new Set<string>();
  return pakPaths.filter(pakPath => {
    const candidate = parseArchiveReference(pakPath);
    if (!candidate) return false;
    const explicitlyCalled = references.some(reference => (
      reference.name === candidate.name
      && (!reference.extension || reference.extension === candidate.extension)
    ));
    if (explicitlyCalled) return true;
    if (!fixedNames.has(candidate.name) || selectedFixedNames.has(candidate.name)) return false;
    selectedFixedNames.add(candidate.name);
    return true;
  });
}

export function findMissingEffectImageArchives(
  archivePaths: string[],
  effectImagePakNames: string[]
): string[] {
  const available = archivePaths.map(parseArchiveReference).filter(isArchiveReference);
  const seen = new Set<string>();
  return effectImagePakNames.filter(rawName => {
    const reference = parseArchiveReference(rawName);
    if (!reference) return false;
    const key = `${reference.name}.${reference.extension || '*'}`;
    const found = available.some(candidate => (
      candidate.name === reference.name
      && (!reference.extension || candidate.extension === reference.extension)
    ));
    if (seen.has(key) || found) return false;
    seen.add(key);
    return true;
  }).map(rawName => path.basename(rawName.trim().replace(/[\\/]+/g, path.sep)));
}

export function findNearbyPakPasswordFile(dataDirectory: string): string | undefined {
  const directories = [
    dataDirectory,
    path.dirname(dataDirectory),
    path.dirname(path.dirname(dataDirectory)),
  ];
  const candidates = directories.flatMap(directory => [
    path.join(directory, 'Pak.txt'),
    path.join(directory, 'JpkList.txt'),
  ]);
  return candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

function scanPatchCache(cacheRoot: string): CachedPatchPak[] {
  const latestByPath = new Map<string, CachedPatchPak>();
  try {
    if (fs.existsSync(cacheRoot)) {
      for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const cacheDir = path.join(cacheRoot, entry.name);
        const manifestPath = path.join(cacheDir, 'manifest.json');
        const item = readPatchManifestHeader(manifestPath, cacheDir);
        if (!item) continue;
        rememberLatestPatch(latestByPath, item);
      }
    }
    const archiveIndexRoot = archiveIndexRootForPatchCacheRoot(cacheRoot);
    for (const summary of listArchiveIndexSummaries(archiveIndexRoot)) {
      const cacheDir = getArchiveIndexDirectory(archiveIndexRoot, summary.archiveId);
      rememberLatestPatch(latestByPath, {
        manifestPath: path.join(cacheDir, 'summary.json'),
        cacheDir,
        pakPath: summary.pakPath,
        pakName: summary.pakName,
        sourceMd5: summary.sourceMd5,
        decoderRevision: summary.decoderRevision,
        format: summary.format,
        storedWillIdx: summary.storedWillIdx,
        slotCount: summary.slotCount,
        cachedAt: summary.createdAt,
        storageMode: 'direct',
        archiveId: summary.archiveId,
        sourceSize: summary.sourceSize,
        sourceMtimeMs: summary.sourceMtimeMs,
        companionPath: summary.companionPath,
        companionSize: summary.companionSize,
        companionMtimeMs: summary.companionMtimeMs,
      });
    }
  } catch (error) {
    console.warn('[BOO] 补丁缓存索引读取失败:', error instanceof Error ? error.message : String(error));
  }
  return [...latestByPath.values()].sort((left, right) =>
    left.pakName.localeCompare(right.pakName, 'zh-CN', { numeric: true, sensitivity: 'base' })
  );
}

function rememberLatestPatch(
  latestByPath: Map<string, CachedPatchPak>,
  item: CachedPatchPak
): void {
  const key = `${normalizePath(item.pakPath)}|${item.storageMode || 'legacy'}`;
  const existing = latestByPath.get(key);
  if (
    !existing
    || item.cachedAt > existing.cachedAt
    || (item.cachedAt === existing.cachedAt && item.storageMode === 'direct')
  ) {
    latestByPath.set(key, item);
  }
}

function selectPreferredPatchCaches(
  candidates: CachedPatchPak[],
  preferredStorageMode: 'legacy' | 'direct'
): CachedPatchPak[] {
  const grouped = new Map<string, CachedPatchPak[]>();
  for (const candidate of candidates) {
    const key = normalizePath(candidate.pakPath);
    const group = grouped.get(key) || [];
    group.push(candidate);
    grouped.set(key, group);
  }
  return [...grouped.values()].map(group => {
    group.sort((left, right) => right.cachedAt - left.cachedAt);
    return group.find(item => item.storageMode === preferredStorageMode && isPatchCacheCurrent(item))
      || group.find(item => isPatchCacheCurrent(item))
      || group.find(item => item.storageMode === preferredStorageMode)
      || group[0];
  }).sort((left, right) =>
    left.pakName.localeCompare(right.pakName, 'zh-CN', { numeric: true, sensitivity: 'base' })
  );
}

function archiveIndexRootForPatchCacheRoot(cacheRoot: string): string {
  const resolved = path.resolve(cacheRoot);
  if (path.basename(resolved).toLowerCase() === 'archive-index-v1') return resolved;
  return path.join(path.dirname(resolved), 'archive-index-v1');
}

function readPatchManifestHeader(manifestPath: string, cacheDir: string): CachedPatchPak | undefined {
  try {
    if (!fs.existsSync(manifestPath)) return undefined;
    const handle = fs.openSync(manifestPath, 'r');
    const buffer = Buffer.allocUnsafe(65536);
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0);
    } finally {
      fs.closeSync(handle);
    }
    const header = buffer.subarray(0, bytesRead).toString('utf8');
    const pakName = readJsonString(header, 'pakName');
    const pakPath = readJsonString(header, 'pakPath');
    const rawSourceMd5 = readJsonString(header, 'sourceMd5');
    const decoderRevision = readJsonString(header, 'decoderRevision') || undefined;
    const sourceMd5 = rawSourceMd5 && /^[a-f0-9]{32}$/i.test(rawSourceMd5)
      ? rawSourceMd5.toLowerCase()
      : undefined;
    const format = readJsonString(header, 'format');
    const storedWillIdx = readJsonNumber(header, 'willIdx');
    const slotCount = readJsonNumber(header, 'slotCount');
    if (
      !pakName
      || !pakPath
      || (
        format !== 'GEE'
        && format !== 'GOM'
        && format !== 'JPK'
        && format !== 'WIL'
        && format !== 'WZL'
      )
    ) return undefined;
    if (!Number.isInteger(storedWillIdx) || !Number.isInteger(slotCount) || slotCount < 0) return undefined;
    return {
      manifestPath,
      cacheDir,
      pakName,
      pakPath: path.resolve(pakPath),
      sourceMd5,
      decoderRevision,
      format,
      storedWillIdx,
      slotCount,
      cachedAt: fs.statSync(manifestPath).mtimeMs,
      storageMode: 'legacy',
    };
  } catch {
    return undefined;
  }
}

function hasCompletePatchCache(item: CachedPatchPak): boolean {
  if (!fs.existsSync(item.manifestPath)) return false;
  if (item.storageMode === 'direct') {
    return !!item.archiveId && fs.existsSync(path.join(item.cacheDir, ARCHIVE_INDEX_FILE));
  }
  if (item.slotCount <= 0) return true;
  return fs.existsSync(patchImagePath(item, 0))
    && fs.existsSync(patchImagePath(item, item.slotCount - 1));
}

function rebaseCachedAssetPath(asset: DecodedPakAsset, cacheDir: string): string {
  const storedName = typeof asset.path === 'string' ? path.basename(asset.path) : '';
  const fallbackName = Number.isInteger(asset.imageIdx) && asset.imageIdx >= 0
    ? `${String(asset.imageIdx).padStart(6, '0')}.png`
    : `${asset.name}.png`;
  return path.join(cacheDir, storedName || fallbackName);
}

function markManifestValidated(item: CachedPatchPak, sourceMtimeMs: number): void {
  if (sourceMtimeMs <= item.cachedAt + 1) return;
  try {
    const validatedAt = Math.max(Date.now(), sourceMtimeMs + 2);
    const timestamp = new Date(validatedAt);
    fs.utimesSync(item.manifestPath, timestamp, timestamp);
    item.cachedAt = validatedAt;
  } catch {
    // MD5 remains authoritative for the current read even if touching the manifest fails.
  }
}

function readJsonString(text: string, property: string): string | undefined {
  const match = text.match(new RegExp(`"${property}"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")`));
  if (!match) return undefined;
  try { return JSON.parse(match[1]) as string; } catch { return undefined; }
}

function readJsonNumber(text: string, property: string): number {
  const match = text.match(new RegExp(`"${property}"\\s*:\\s*(-?\\d+)`));
  return match ? Number(match[1]) : Number.NaN;
}

function normalizePath(filePath: string): string {
  return filePath ? path.normalize(path.resolve(filePath)).toLowerCase() : '';
}

function normalizePakName(pakName: string): string {
  return path.basename(pakName, path.extname(pakName)).toLowerCase();
}

function archiveExtension(filePath: string): ArchiveExtension | undefined {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return /^(?:pak|jpk|wil|wzl)$/.test(extension)
    ? extension as ArchiveExtension
    : undefined;
}

interface ArchiveReference {
  name: string;
  extension?: ArchiveExtension;
}

function parseArchiveReference(value: string): ArchiveReference | undefined {
  const configuredName = String(value || '').trim().replace(/[\\/]+/g, path.sep);
  const name = normalizePakName(configuredName);
  if (!name) return undefined;
  return { name, extension: archiveExtension(configuredName) };
}

function isArchiveReference(value: ArchiveReference | undefined): value is ArchiveReference {
  return !!value;
}

function normalizeResourceRoots(
  resourceRoots: string | readonly string[] | undefined
): string[] | undefined {
  if (resourceRoots === undefined) return undefined;
  const roots = typeof resourceRoots === 'string' ? [resourceRoots] : resourceRoots;
  const unique = new Map<string, string>();
  for (const root of roots) {
    if (!root) continue;
    const resolved = path.resolve(root);
    const key = normalizePath(resolved);
    if (!unique.has(key)) unique.set(key, resolved);
  }
  return [...unique.values()];
}

function sortCachedByResourcePriority(
  candidates: CachedPatchPak[],
  resourceRoots: readonly string[] | undefined
): CachedPatchPak[] {
  return candidates.sort((left, right) => compareCachedPatchPaks(left, right, resourceRoots));
}

function compareCachedPatchPaks(
  left: CachedPatchPak,
  right: CachedPatchPak,
  resourceRoots: readonly string[] | undefined
): number {
  if (resourceRoots) {
    const rankDifference = resourceRootRank(left.pakPath, resourceRoots)
      - resourceRootRank(right.pakPath, resourceRoots);
    if (rankDifference) return rankDifference;
  }
  const nameDifference = left.pakName.localeCompare(
    right.pakName,
    'zh-CN',
    { numeric: true, sensitivity: 'base' }
  );
  if (nameDifference) return nameDifference;
  return right.cachedAt - left.cachedAt;
}
