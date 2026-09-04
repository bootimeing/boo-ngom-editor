import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export const ORIGINAL_MAP_TILE_CACHE_DIRECTORY = 'original-map-tiles-v1';
export const ORIGINAL_MAP_TILE_CHUNK_CELL_WIDTH = 16;
export const ORIGINAL_MAP_TILE_CHUNK_CELL_HEIGHT = 16;
export const ORIGINAL_MAP_TILE_CHUNK_CELLS = ORIGINAL_MAP_TILE_CHUNK_CELL_WIDTH;
export const ORIGINAL_MAP_TILE_CHUNK_WIDTH = ORIGINAL_MAP_TILE_CHUNK_CELL_WIDTH * 48;
export const ORIGINAL_MAP_TILE_CHUNK_HEIGHT = ORIGINAL_MAP_TILE_CHUNK_CELL_HEIGHT * 32;
export const ORIGINAL_MAP_TILE_MAX_PNG_BYTES = 16 * 1024 * 1024;
export const DEFAULT_ORIGINAL_MAP_TILE_CACHE_MAX_BYTES = 1024 * 1024 * 1024;
export const DEFAULT_ORIGINAL_MAP_TILE_CACHE_MAX_GENERATIONS = 64;

const HEX_64 = /^[a-f0-9]{64}$/;
const STATIC_ARCHIVE_NAME = /^(?:tiles|smtiles)\d*$/i;
const CHUNK_ID = /^c(0|[1-9]\d*)-r(0|[1-9]\d*)$/;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IHDR_TYPE = Buffer.from('IHDR', 'ascii');
const ACCESS_FILE = '.access';
const MANIFEST_FILE = 'manifest.json';
const MAX_MANIFEST_BYTES = 1024 * 1024;

export interface OriginalMapTileArchiveBinding {
  archiveName: string;
  archiveId?: string;
  status: string;
}

export interface OriginalMapTileCacheKeyInput {
  mapSha256: string;
  engine: string;
  profile: string;
  mapWidth: number;
  mapHeight: number;
  archives: readonly OriginalMapTileArchiveBinding[];
  decoderRevision: string;
  rendererRevision: string;
  placementRevision: string;
  blendRevision: string;
  chunkRevision: string;
}

export interface NormalizedOriginalMapTileArchiveBinding {
  archiveName: string;
  archiveId: string | null;
  status: string;
}

export interface OriginalMapTileIdentity {
  cacheKey: string;
  canonicalJson: string;
  schema: 'boo-original-map-tiles-v1';
  lod: 0;
  mapSha256: string;
  engine: string;
  profile: string;
  mapWidth: number;
  mapHeight: number;
  archives: NormalizedOriginalMapTileArchiveBinding[];
  decoderRevision: string;
  rendererRevision: string;
  placementRevision: string;
  blendRevision: string;
  chunkRevision: string;
  chunkCells: [number, number];
  chunkPixels: [number, number];
}

export interface OriginalMapTileManifest extends OriginalMapTileIdentity {
  schemaVersion: 1;
}

export interface OriginalMapTileChunkCoordinate {
  column: number;
  row: number;
}

export interface OriginalMapTileSize {
  width: number;
  height: number;
}

export interface OriginalMapTileDescriptor extends OriginalMapTileSize {
  lod: 0;
  column: number;
  row: number;
  chunkId: string;
  worldX: number;
  worldY: number;
}

export interface OriginalMapTilePngValidation {
  valid: boolean;
  reason?: string;
}

export interface OriginalMapTileLocation {
  cacheRoot: string;
  cacheKey: string;
  chunkId: string;
  mapWidth: number;
  mapHeight: number;
}

export interface PublishOriginalMapTileOptions extends OriginalMapTileLocation {
  png: Uint8Array;
}

export interface PublishOriginalMapTileResult {
  status: 'published' | 'hit' | 'replaced';
  filePath: string;
  byteLength: number;
}

export interface WriteOriginalMapTileAtomicResult {
  status: 'published' | 'already-exists';
  filePath: string;
  byteLength: number;
  replacedCorrupt: boolean;
}

export interface EnsureOriginalMapTileManifestResult {
  status: 'published' | 'already-exists';
  filePath: string;
  manifest: OriginalMapTileManifest;
  replacedCorrupt: boolean;
}

export interface PruneOriginalMapTileCacheOptions {
  maxBytes?: number;
  maxGenerations?: number;
  protectedKeys?: ReadonlySet<string>;
}

export interface PruneOriginalMapTileCacheResult {
  removedKeys: string[];
  removedBytes: number;
  remainingBytes: number;
  remainingGenerations: number;
}

interface GenerationEntry {
  key: string;
  directory: string;
  bytes: number;
  lastAccessMs: number;
}

export function createOriginalMapTileCacheKey(
  input: OriginalMapTileCacheKeyInput
): string {
  return createOriginalMapTileIdentity(input).cacheKey;
}

export function createOriginalMapTileIdentity(
  input: OriginalMapTileCacheKeyInput
): OriginalMapTileIdentity {
  const mapSha256 = normalizeHex64(input.mapSha256, 'MAP SHA-256');
  const mapWidth = positiveSafeInteger(input.mapWidth, '地图宽度');
  const mapHeight = positiveSafeInteger(input.mapHeight, '地图高度');
  const archives = input.archives.map(binding => {
    const archiveName = requiredText(binding.archiveName, 'archiveName').toLowerCase();
    if (!STATIC_ARCHIVE_NAME.test(archiveName)) {
      throw new Error(`静态地图缓存只接受 Tiles/SmTiles 素材包: ${binding.archiveName}`);
    }
    const archiveId = binding.archiveId === undefined
      ? null
      : normalizeHex64(binding.archiveId, `${binding.archiveName} archiveId`);
    return {
      archiveName,
      archiveId,
      status: requiredText(binding.status, `${binding.archiveName} status`).toLowerCase(),
    };
  }).sort((left, right) => left.archiveName.localeCompare(right.archiveName, 'en'));
  for (let index = 1; index < archives.length; index++) {
    if (archives[index - 1].archiveName === archives[index].archiveName) {
      throw new Error(`静态地图素材包名称重复: ${archives[index].archiveName}`);
    }
  }

  const canonical: Omit<OriginalMapTileIdentity, 'cacheKey' | 'canonicalJson'> = {
    schema: 'boo-original-map-tiles-v1' as const,
    lod: 0 as const,
    mapSha256,
    engine: requiredText(input.engine, 'engine').toLowerCase(),
    profile: requiredText(input.profile, 'profile').toLowerCase(),
    mapWidth,
    mapHeight,
    archives,
    decoderRevision: requiredText(input.decoderRevision, 'decoderRevision'),
    rendererRevision: requiredText(input.rendererRevision, 'rendererRevision'),
    placementRevision: requiredText(input.placementRevision, 'placementRevision'),
    blendRevision: requiredText(input.blendRevision, 'blendRevision'),
    chunkRevision: requiredText(input.chunkRevision, 'chunkRevision'),
    chunkCells: [
      ORIGINAL_MAP_TILE_CHUNK_CELL_WIDTH,
      ORIGINAL_MAP_TILE_CHUNK_CELL_HEIGHT,
    ],
    chunkPixels: [ORIGINAL_MAP_TILE_CHUNK_WIDTH, ORIGINAL_MAP_TILE_CHUNK_HEIGHT],
  };
  const canonicalJson = JSON.stringify(canonical);
  const cacheKey = crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  return { cacheKey, canonicalJson, ...canonical };
}

export function parseOriginalMapTileChunkId(
  chunkId: string
): OriginalMapTileChunkCoordinate {
  const match = CHUNK_ID.exec(chunkId);
  if (!match) throw new Error(`静态地图 chunkId 无效: ${chunkId}`);
  const column = Number(match[1]);
  const row = Number(match[2]);
  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row)) {
    throw new Error(`静态地图 chunkId 超出安全整数范围: ${chunkId}`);
  }
  return { column, row };
}

export function expectedOriginalMapTileSize(
  mapWidth: number,
  mapHeight: number,
  chunkId: string
): OriginalMapTileSize {
  const widthInCells = positiveSafeInteger(mapWidth, '地图宽度');
  const heightInCells = positiveSafeInteger(mapHeight, '地图高度');
  const { column, row } = parseOriginalMapTileChunkId(chunkId);
  const descriptor = originalMapTileDescriptor(widthInCells, heightInCells, column, row);
  return { width: descriptor.width, height: descriptor.height };
}

export function originalMapTileDescriptor(
  mapWidth: number,
  mapHeight: number,
  column: number,
  row: number
): OriginalMapTileDescriptor {
  const widthInCells = positiveSafeInteger(mapWidth, '地图宽度');
  const heightInCells = positiveSafeInteger(mapHeight, '地图高度');
  const safeColumn = nonNegativeSafeInteger(column, '静态地图切片列');
  const safeRow = nonNegativeSafeInteger(row, '静态地图切片行');
  const chunkId = `c${safeColumn}-r${safeRow}`;
  const leftCell = safeColumn * ORIGINAL_MAP_TILE_CHUNK_CELL_WIDTH;
  const topCell = safeRow * ORIGINAL_MAP_TILE_CHUNK_CELL_HEIGHT;
  if (!Number.isSafeInteger(leftCell) || !Number.isSafeInteger(topCell)) {
    throw new Error(`静态地图 chunkId 超出安全整数范围: ${chunkId}`);
  }
  if (leftCell >= widthInCells || topCell >= heightInCells) {
    throw new Error(`静态地图 chunkId 超出地图范围: ${chunkId}`);
  }
  return {
    lod: 0,
    column: safeColumn,
    row: safeRow,
    chunkId,
    worldX: leftCell * 48,
    worldY: topCell * 32,
    width: Math.min(ORIGINAL_MAP_TILE_CHUNK_CELL_WIDTH, widthInCells - leftCell) * 48,
    height: Math.min(ORIGINAL_MAP_TILE_CHUNK_CELL_HEIGHT, heightInCells - topCell) * 32,
  };
}

export function originalMapTilePath(
  cacheRoot: string,
  cacheKey: string,
  chunkId: string
): string {
  const root = path.resolve(cacheRoot);
  const key = strictCacheKey(cacheKey, 'cacheKey');
  parseOriginalMapTileChunkId(chunkId);
  const target = path.resolve(root, key, `${chunkId}.png`);
  assertPathInside(root, target);
  return target;
}

export function validateOriginalMapTilePng(
  input: Uint8Array,
  expectedWidth: number,
  expectedHeight: number
): OriginalMapTilePngValidation {
  if (!Number.isSafeInteger(expectedWidth) || expectedWidth <= 0
    || !Number.isSafeInteger(expectedHeight) || expectedHeight <= 0) {
    return { valid: false, reason: '预期 PNG 尺寸无效' };
  }
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (data.byteLength > ORIGINAL_MAP_TILE_MAX_PNG_BYTES) {
    return { valid: false, reason: 'PNG 超过 16 MiB 上限' };
  }
  if (data.byteLength < 33) return { valid: false, reason: 'PNG 文件头不完整' };
  if (!data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { valid: false, reason: 'PNG signature 无效' };
  }
  if (data.readUInt32BE(8) !== 13 || !data.subarray(12, 16).equals(PNG_IHDR_TYPE)) {
    return { valid: false, reason: 'PNG IHDR 无效' };
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== expectedWidth || height !== expectedHeight) {
    return {
      valid: false,
      reason: `PNG 尺寸不一致: ${width}x${height}/${expectedWidth}x${expectedHeight}`,
    };
  }
  return { valid: true };
}

export function ensureOriginalMapTileManifest(
  cacheRoot: string,
  input: OriginalMapTileCacheKeyInput | OriginalMapTileIdentity
): EnsureOriginalMapTileManifestResult {
  const identity = isOriginalMapTileIdentity(input)
    ? validateOriginalMapTileIdentity(input)
    : createOriginalMapTileIdentity(input);
  const filePath = originalMapTileManifestPath(cacheRoot, identity.cacheKey);
  const manifest: OriginalMapTileManifest = { schemaVersion: 1, ...identity };
  const data = Buffer.from(`${JSON.stringify(manifest)}\n`, 'utf8');
  const result = publishImmutableFileAtomic(
    filePath,
    data,
    candidate => readValidManifest(candidate, identity.cacheKey, identity.canonicalJson) !== undefined
  );
  touchGeneration(path.dirname(filePath));
  return {
    status: result.status,
    filePath,
    manifest,
    replacedCorrupt: result.replacedCorrupt,
  };
}

export function readOriginalMapTileManifest(
  cacheRoot: string,
  cacheKey: string
): OriginalMapTileManifest | undefined {
  const filePath = originalMapTileManifestPath(cacheRoot, cacheKey);
  const manifest = readValidManifest(filePath, cacheKey);
  if (manifest) touchGeneration(path.dirname(filePath));
  return manifest;
}

export function readOriginalMapTile(
  cacheRoot: string,
  cacheKey: string,
  chunkId: string,
  expectedWidth: number,
  expectedHeight: number
): Buffer | undefined;
export function readOriginalMapTile(
  options: OriginalMapTileLocation
): Buffer | undefined;
export function readOriginalMapTile(
  cacheRootOrOptions: string | OriginalMapTileLocation,
  cacheKey?: string,
  chunkId?: string,
  expectedWidth?: number,
  expectedHeight?: number
): Buffer | undefined {
  let cacheRoot: string;
  let resolvedCacheKey: string;
  let resolvedChunkId: string;
  let expected: OriginalMapTileSize;
  if (typeof cacheRootOrOptions === 'string') {
    cacheRoot = cacheRootOrOptions;
    resolvedCacheKey = strictCacheKey(cacheKey || '', 'cacheKey');
    resolvedChunkId = chunkId || '';
    parseOriginalMapTileChunkId(resolvedChunkId);
    expected = {
      width: positiveSafeInteger(expectedWidth || 0, '预期 PNG 宽度'),
      height: positiveSafeInteger(expectedHeight || 0, '预期 PNG 高度'),
    };
  } else {
    cacheRoot = cacheRootOrOptions.cacheRoot;
    resolvedCacheKey = cacheRootOrOptions.cacheKey;
    resolvedChunkId = cacheRootOrOptions.chunkId;
    expected = expectedOriginalMapTileSize(
      cacheRootOrOptions.mapWidth,
      cacheRootOrOptions.mapHeight,
      resolvedChunkId
    );
  }
  const filePath = originalMapTilePath(cacheRoot, resolvedCacheKey, resolvedChunkId);
  const data = readValidTile(filePath, expected);
  if (!data) {
    removeCorruptTile(filePath, expected);
    return undefined;
  }
  touchGeneration(path.dirname(filePath));
  return data;
}

export function writeOriginalMapTileAtomic(
  cacheRoot: string,
  cacheKey: string,
  chunkId: string,
  expectedWidth: number,
  expectedHeight: number,
  png: Uint8Array
): WriteOriginalMapTileAtomicResult {
  const filePath = originalMapTilePath(cacheRoot, cacheKey, chunkId);
  const expected = {
    width: positiveSafeInteger(expectedWidth, '预期 PNG 宽度'),
    height: positiveSafeInteger(expectedHeight, '预期 PNG 高度'),
  };
  const data = Buffer.from(png.buffer, png.byteOffset, png.byteLength);
  const validation = validateOriginalMapTilePng(data, expected.width, expected.height);
  if (!validation.valid) throw new Error(`静态地图 PNG 无效: ${validation.reason}`);
  const result = publishImmutableFileAtomic(
    filePath,
    data,
    candidate => readValidTile(candidate, expected) !== undefined
  );
  touchGeneration(path.dirname(filePath));
  return {
    status: result.status,
    filePath,
    byteLength: result.status === 'already-exists'
      ? fs.statSync(filePath).size
      : data.byteLength,
    replacedCorrupt: result.replacedCorrupt,
  };
}

export function publishOriginalMapTile(
  options: PublishOriginalMapTileOptions
): PublishOriginalMapTileResult {
  const expected = expectedOriginalMapTileSize(
    options.mapWidth,
    options.mapHeight,
    options.chunkId
  );
  const result = writeOriginalMapTileAtomic(
    options.cacheRoot,
    options.cacheKey,
    options.chunkId,
    expected.width,
    expected.height,
    options.png
  );
  return {
    status: result.status === 'already-exists'
      ? 'hit'
      : result.replacedCorrupt
        ? 'replaced'
        : 'published',
    filePath: result.filePath,
    byteLength: result.byteLength,
  };
}

export function pruneOriginalMapTileCache(
  cacheRoot: string,
  options: PruneOriginalMapTileCacheOptions = {}
): PruneOriginalMapTileCacheResult {
  const root = path.resolve(cacheRoot);
  if (path.basename(root).toLowerCase() !== ORIGINAL_MAP_TILE_CACHE_DIRECTORY) {
    throw new Error(`拒绝清理非 original-map-tiles-v1 精确缓存根: ${root}`);
  }
  const maxBytes = nonNegativeSafeInteger(
    options.maxBytes ?? DEFAULT_ORIGINAL_MAP_TILE_CACHE_MAX_BYTES,
    '缓存字节上限'
  );
  const maxGenerations = nonNegativeSafeInteger(
    options.maxGenerations ?? DEFAULT_ORIGINAL_MAP_TILE_CACHE_MAX_GENERATIONS,
    '缓存目录上限'
  );
  const protectedKeys = new Set(
    [...(options.protectedKeys || [])].map(key => strictCacheKey(key, 'protected cacheKey'))
  );
  if (!fs.existsSync(root)) {
    return {
      removedKeys: [],
      removedBytes: 0,
      remainingBytes: 0,
      remainingGenerations: 0,
    };
  }

  const entries: GenerationEntry[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !HEX_64.test(entry.name)) continue;
    const directory = path.resolve(root, entry.name);
    assertPathInside(root, directory);
    const accessPath = path.join(directory, ACCESS_FILE);
    let lastAccessMs: number;
    try {
      lastAccessMs = fs.statSync(accessPath).mtimeMs;
    } catch {
      lastAccessMs = fs.statSync(directory).mtimeMs;
    }
    entries.push({
      key: entry.name,
      directory,
      bytes: directorySize(directory),
      lastAccessMs,
    });
  }
  entries.sort((left, right) => (
    left.lastAccessMs - right.lastAccessMs || left.key.localeCompare(right.key, 'en')
  ));
  let remainingBytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  let remainingGenerations = entries.length;
  let removedBytes = 0;
  const removedKeys: string[] = [];
  for (const entry of entries) {
    if (remainingBytes <= maxBytes && remainingGenerations <= maxGenerations) break;
    if (protectedKeys.has(entry.key)) continue;
    assertPathInside(root, entry.directory);
    fs.rmSync(entry.directory, { recursive: true, force: true });
    removedKeys.push(entry.key);
    removedBytes += entry.bytes;
    remainingBytes -= entry.bytes;
    remainingGenerations--;
  }
  return { removedKeys, removedBytes, remainingBytes, remainingGenerations };
}

function originalMapTileManifestPath(cacheRoot: string, cacheKey: string): string {
  const root = path.resolve(cacheRoot);
  const key = strictCacheKey(cacheKey, 'cacheKey');
  const target = path.resolve(root, key, MANIFEST_FILE);
  assertPathInside(root, target);
  return target;
}

function isOriginalMapTileIdentity(
  input: OriginalMapTileCacheKeyInput | OriginalMapTileIdentity
): input is OriginalMapTileIdentity {
  return typeof (input as Partial<OriginalMapTileIdentity>).cacheKey === 'string';
}

function validateOriginalMapTileIdentity(
  input: OriginalMapTileIdentity
): OriginalMapTileIdentity {
  const rebuilt = createOriginalMapTileIdentity({
    mapSha256: input.mapSha256,
    engine: input.engine,
    profile: input.profile,
    mapWidth: input.mapWidth,
    mapHeight: input.mapHeight,
    archives: input.archives.map(binding => ({
      archiveName: binding.archiveName,
      ...(binding.archiveId ? { archiveId: binding.archiveId } : {}),
      status: binding.status,
    })),
    decoderRevision: input.decoderRevision,
    rendererRevision: input.rendererRevision,
    placementRevision: input.placementRevision,
    blendRevision: input.blendRevision,
    chunkRevision: input.chunkRevision,
  });
  if (input.cacheKey !== rebuilt.cacheKey || input.canonicalJson !== rebuilt.canonicalJson) {
    throw new Error('静态地图 identity 与 canonical cacheKey 不一致');
  }
  return rebuilt;
}

function readValidManifest(
  filePath: string,
  expectedCacheKey: string,
  expectedCanonicalJson?: string
): OriginalMapTileManifest | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_MANIFEST_BYTES) return undefined;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as OriginalMapTileManifest;
    if (parsed.schemaVersion !== 1 || parsed.cacheKey !== expectedCacheKey) return undefined;
    const identity = validateOriginalMapTileIdentity(parsed);
    if (expectedCanonicalJson !== undefined && identity.canonicalJson !== expectedCanonicalJson) {
      return undefined;
    }
    return { schemaVersion: 1, ...identity };
  } catch {
    return undefined;
  }
}

function publishImmutableFileAtomic(
  filePath: string,
  data: Buffer,
  validateExisting: (filePath: string) => boolean
): { status: 'published' | 'already-exists'; replacedCorrupt: boolean } {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  if (validateExisting(filePath)) {
    return { status: 'already-exists', replacedCorrupt: false };
  }

  const baseName = path.basename(filePath);
  const tempPath = path.join(
    directory,
    `.${baseName}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  );
  let quarantinePath: string | undefined;
  let handle: number | undefined;
  let replacedCorrupt = false;
  try {
    handle = fs.openSync(tempPath, 'wx');
    fs.writeFileSync(handle, data);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;

    if (validateExisting(filePath)) {
      return { status: 'already-exists', replacedCorrupt: false };
    }
    if (fs.existsSync(filePath)) {
      quarantinePath = path.join(
        directory,
        `.${baseName}.corrupt-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
      );
      fs.renameSync(filePath, quarantinePath);
      replacedCorrupt = true;
    }
    try {
      fs.renameSync(tempPath, filePath);
    } catch (error) {
      if (validateExisting(filePath)) {
        return { status: 'already-exists', replacedCorrupt: false };
      }
      if (quarantinePath && fs.existsSync(quarantinePath) && !fs.existsSync(filePath)) {
        fs.renameSync(quarantinePath, filePath);
        quarantinePath = undefined;
      }
      throw error;
    }
    removeQuarantine(quarantinePath);
    quarantinePath = undefined;
    return { status: 'published', replacedCorrupt };
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    if (quarantinePath && fs.existsSync(quarantinePath) && !fs.existsSync(filePath)) {
      fs.renameSync(quarantinePath, filePath);
      quarantinePath = undefined;
    }
    removeQuarantine(quarantinePath);
  }
}

function removeQuarantine(filePath: string | undefined): void {
  if (!filePath || !fs.existsSync(filePath)) return;
  fs.rmSync(filePath, { recursive: true, force: true });
}

function removeCorruptTile(filePath: string, expected: OriginalMapTileSize): void {
  try {
    if (!fs.existsSync(filePath) || readValidTile(filePath, expected)) return;
    fs.rmSync(filePath, { recursive: true, force: true });
  } catch {
    // Corruption is still a cache miss when another process owns or replaces the target.
  }
}

function readValidTile(
  filePath: string,
  expected: OriginalMapTileSize
): Buffer | undefined {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > ORIGINAL_MAP_TILE_MAX_PNG_BYTES) return undefined;
    const data = fs.readFileSync(filePath);
    return validateOriginalMapTilePng(data, expected.width, expected.height).valid
      ? data
      : undefined;
  } catch {
    return undefined;
  }
}

function touchGeneration(generationDirectory: string): void {
  try {
    fs.mkdirSync(generationDirectory, { recursive: true });
    const accessPath = path.join(generationDirectory, ACCESS_FILE);
    const handle = fs.openSync(accessPath, 'a');
    fs.closeSync(handle);
    const now = new Date();
    fs.utimesSync(accessPath, now, now);
  } catch {
    // Access timestamps are advisory. A read/write hit remains valid if touching fails.
  }
}

function directorySize(directory: string): number {
  let total = 0;
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile()) total += fs.statSync(candidate).size;
    }
  }
  return total;
}

function normalizeHex64(value: string, label: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!HEX_64.test(normalized)) throw new Error(`${label} 必须是 64 位十六进制值`);
  return normalized;
}

function strictCacheKey(value: string, label: string): string {
  if (typeof value !== 'string' || !HEX_64.test(value)) {
    throw new Error(`${label} 必须是小写 64 位十六进制值`);
  }
  return value;
}

function requiredText(value: string, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} 不能为空`);
  return normalized;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} 必须是正整数`);
  return value;
}

function nonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} 必须是非负整数`);
  return value;
}

function assertPathInside(root: string, candidate: string): void {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (
    relative === ''
    || path.isAbsolute(relative)
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`静态地图缓存路径越界: ${candidate}`);
  }
}
