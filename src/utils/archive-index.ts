import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  applyGomColorKeyTransparency,
  DecodedPakAsset,
  DecodedPakResult,
  detectPakFileFormat,
  encodePng,
  inflatePakPayload,
  loadParser,
  PakBlock,
  requestGee2Profile,
  requestGeeProfile,
  validateBlocks,
} from './pak-reader';
import {
  JpkBlock,
  parseJpkFile,
  readJpkPayload,
  renderJpkRgba,
} from './jpk-reader';
import { parseGomFile } from './gom-reader';
import { ArchiveFormat } from './archive-types';
import {
  parseWilWzlArchive,
  readWilWzlImagePng,
  resolveWilWzlCompanionPath,
} from './wil-wzl-reader';

export const ARCHIVE_INDEX_SCHEMA_VERSION = 1;
export const ARCHIVE_SUMMARY_FILE = 'summary.json';
export const ARCHIVE_INDEX_FILE = 'blocks.idx';
export const ARCHIVE_INDEX_DECODER_REVISION = 'archive-direct-v1';

const INDEX_MAGIC = Buffer.from('BOOIDX01', 'ascii');
const INDEX_HEADER_SIZE = 24;
const INDEX_RECORD_SIZE = 40;
const MAX_SAFE_OFFSET = BigInt(Number.MAX_SAFE_INTEGER);
const transparentPng = encodePng(1, 1, new Uint8ClampedArray(4));

export interface ArchiveIndexSummary {
  schemaVersion: number;
  decoderRevision: string;
  archiveId: string;
  format: ArchiveFormat;
  pakName: string;
  pakPath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  companionPath?: string;
  companionSize?: number;
  companionMtimeMs?: number;
  sourceMd5?: string;
  passwordHash: string;
  storedWillIdx: number;
  slotCount: number;
  blockCount: number;
  createdAt: number;
  jpkRc4State?: string;
  wilColorCount?: number;
  wilPaletteBgra?: string;
}

export interface ArchiveIndexBlock extends PakBlock {
  offsetX: number;
  offsetY: number;
}

export interface ArchiveAssetTable {
  slotCount: number;
  present: Uint8Array;
  blank: Uint8Array;
  width: Uint16Array;
  height: Uint16Array;
  offsetX: Int32Array;
  offsetY: Int32Array;
}

export interface OpenArchiveIndexedOptions {
  extensionPath: string;
  indexRoot: string;
  pakPath: string;
  password: string;
  willIdx: number;
  onProgress?: (completed: number, total: number, label: string) => void;
  ensureBridge?: () => Promise<void>;
  forceRefresh?: boolean;
}

export interface ReadArchiveImageOptions {
  extensionPath: string;
  indexRoot: string;
  archiveId: string;
  imageIndex: number;
}

interface CachedIndexBuffer {
  buffer: Buffer;
  lastUsed: number;
}

const summaryCache = new Map<string, ArchiveIndexSummary>();
const indexBufferCache = new Map<string, CachedIndexBuffer>();
const MAX_INDEX_BUFFER_BYTES = 32 * 1024 * 1024;
let cachedIndexBytes = 0;

export async function openArchiveIndexed(
  options: OpenArchiveIndexedOptions
): Promise<DecodedPakResult> {
  const pakPath = path.resolve(options.pakPath);
  const stat = fs.statSync(pakPath);
  const extension = path.extname(pakPath).toLowerCase();
  const isWilWzl = extension === '.wil' || extension === '.wzl';
  const companionPath = isWilWzl
    ? resolveWilWzlCompanionPath(pakPath)
    : undefined;
  const companionStat = companionPath ? fs.statSync(companionPath) : undefined;
  const passwordHash = crypto.createHash('sha256').update(options.password, 'utf8').digest('hex');
  const archiveId = crypto.createHash('sha256')
    .update([
      ARCHIVE_INDEX_SCHEMA_VERSION,
      ARCHIVE_INDEX_DECODER_REVISION,
      normalizePath(pakPath),
      stat.size,
      stat.mtimeMs,
      companionPath ? normalizePath(companionPath) : '',
      companionStat?.size || 0,
      companionStat?.mtimeMs || 0,
      passwordHash,
    ].join('|'))
    .digest('hex');
  const cacheDir = archiveCacheDir(options.indexRoot, archiveId);
  const summaryPath = path.join(cacheDir, ARCHIVE_SUMMARY_FILE);
  const indexPath = path.join(cacheDir, ARCHIVE_INDEX_FILE);

  const cached = options.forceRefresh
    ? undefined
    : readValidArchiveSummary(summaryPath, indexPath, {
        archiveId,
        pakPath,
        sourceSize: stat.size,
        sourceMtimeMs: stat.mtimeMs,
        companionPath,
        companionSize: companionStat?.size,
        companionMtimeMs: companionStat?.mtimeMs,
        passwordHash,
      });
  if (cached) {
    rememberSummary(options.indexRoot, cached);
    const assets = createArchiveAssets(options.indexRoot, cached, options.willIdx);
    options.onProgress?.(cached.slotCount, cached.slotCount, `${cached.pakName} 已从索引加载`);
    return summaryToResult(cached, cacheDir, assets, options.willIdx, true);
  }

  options.onProgress?.(0, 1, `建立 ${path.basename(pakPath)} 索引`);
  const parser = loadParser(options.extensionPath);
  const isJpk = extension === '.jpk';
  let format: ArchiveFormat;
  let blocks: PakBlock[];
  let slotCount: number;
  let jpkRc4State: string | undefined;
  let wilColorCount: number | undefined;
  let wilPaletteBgra: string | undefined;

  if (isWilWzl) {
    const archive = parseWilWzlArchive(pakPath);
    format = archive.format;
    blocks = archive.blocks;
    slotCount = archive.slotCount;
    wilColorCount = archive.wilColorCount;
    wilPaletteBgra = archive.wilPaletteBgra;
  } else if (isJpk) {
    const archive = parseJpkFile(pakPath, options.password);
    format = 'JPK';
    blocks = archive.blocks;
    slotCount = archive.slotCount;
    jpkRc4State = Buffer.from(archive.rc4State).toString('base64');
  } else {
    const detected = detectPakFileFormat(pakPath);
    if (detected === 'GEE2') {
      await options.ensureBridge?.();
      const profile = await requestGee2FileProfile(
        pakPath,
        stat.size,
        options.password
      );
      const parsed = parseGeeFile(
        parser,
        pakPath,
        stat.size,
        options.password,
        profile
      );
      format = 'GEE';
      blocks = parsed.blocks;
      slotCount = parsed.header.count;
    } else if (detected === 'GEE') {
      let parsed;
      try {
        parsed = parseGeeFile(parser, pakPath, stat.size, options.password);
      } catch (offlineError) {
        try {
          await options.ensureBridge?.();
          const profile = await requestGeeProfile(options.password);
          parsed = parseGeeFile(parser, pakPath, stat.size, options.password, profile);
        } catch (bridgeError) {
          throw new Error(
            `GEE PAK 精确索引解析失败。内置解析: ${errorText(offlineError)}；离线引擎: ${errorText(bridgeError)}`
          );
        }
      }
      format = 'GEE';
      blocks = parsed.blocks;
      slotCount = parsed.header.count;
    } else if (detected === 'GOM') {
      const profile = parseGomFile(pakPath, options.password, parser);
      format = 'GOM';
      blocks = profile.blocks;
      slotCount = profile.slotCount;
    } else {
      throw new Error('当前只支持具有精确逻辑索引的 GEEPAK2/GEEPAK3/GOM PAK、996PC JPK、WIL/WIX 和 WZL/WZX');
    }
  }

  validateBlocks(blocks, slotCount, stat.size);
  blocks.sort((left, right) => left.logicalIndex - right.logicalIndex);
  const beforePublish = fs.statSync(pakPath);
  if (beforePublish.size !== stat.size || beforePublish.mtimeMs !== stat.mtimeMs) {
    throw new Error(`${path.basename(pakPath)} 在建立索引期间发生变化，请重新读取`);
  }
  if (companionPath && companionStat) {
    const companionBeforePublish = fs.statSync(companionPath);
    if (
      companionBeforePublish.size !== companionStat.size
      || companionBeforePublish.mtimeMs !== companionStat.mtimeMs
    ) {
      throw new Error(`${path.basename(companionPath)} 在建立索引期间发生变化，请重新读取`);
    }
  }

  const summary: ArchiveIndexSummary = {
    schemaVersion: ARCHIVE_INDEX_SCHEMA_VERSION,
    decoderRevision: ARCHIVE_INDEX_DECODER_REVISION,
    archiveId,
    format,
    pakName: path.basename(pakPath, path.extname(pakPath)),
    pakPath,
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    companionPath,
    companionSize: companionStat?.size,
    companionMtimeMs: companionStat?.mtimeMs,
    passwordHash,
    storedWillIdx: options.willIdx,
    slotCount,
    blockCount: blocks.length,
    createdAt: Date.now(),
    jpkRc4State,
    wilColorCount,
    wilPaletteBgra,
  };

  fs.mkdirSync(cacheDir, { recursive: true });
  const indexBuffer = encodeArchiveIndex(blocks, slotCount);
  atomicWriteFile(indexPath, indexBuffer);
  atomicWriteFile(summaryPath, Buffer.from(JSON.stringify(summary), 'utf8'));
  forgetArchiveIndex(options.indexRoot, archiveId);
  rememberSummary(options.indexRoot, summary);
  rememberIndexBuffer(indexCacheKey(options.indexRoot, archiveId), indexBuffer);

  const assets = createAssetsFromBlocks(summary, blocks, options.willIdx);
  options.onProgress?.(slotCount, slotCount, `${summary.pakName}: 索引完成，共 ${slotCount} 项`);
  return summaryToResult(summary, cacheDir, assets, options.willIdx, false);
}

function parseGeeFile(
  parser: ReturnType<typeof loadParser>,
  pakPath: string,
  fileSize: number,
  password: string,
  profile?: unknown
): ReturnType<ReturnType<typeof loadParser>['parseFromReader']> {
  const handle = fs.openSync(pakPath, 'r');
  try {
    return parser.parseFromReader(
      fileSize,
      (offset, length) => readExactly(handle, length, offset),
      password,
      profile
    );
  } finally {
    fs.closeSync(handle);
  }
}

async function requestGee2FileProfile(
  pakPath: string,
  fileSize: number,
  password: string
): Promise<unknown> {
  const handle = fs.openSync(pakPath, 'r');
  try {
    return await requestGee2Profile(
      fileSize,
      (offset, length) => readExactly(handle, length, offset),
      password
    );
  } finally {
    fs.closeSync(handle);
  }
}

export async function readArchiveImagePng(
  options: ReadArchiveImageOptions
): Promise<Buffer> {
  const summary = loadArchiveSummary(options.indexRoot, options.archiveId);
  if (!Number.isInteger(options.imageIndex) || options.imageIndex < 0 || options.imageIndex >= summary.slotCount) {
    throw new Error(`素材序号越界: ${options.imageIndex}/${summary.slotCount}`);
  }
  assertArchiveSourceCurrent(summary);
  const index = loadIndexBuffer(options.indexRoot, summary);
  const block = findArchiveBlock(index, summary, options.imageIndex);
  if (!block) return Buffer.from(transparentPng);

  const parser = loadParser(options.extensionPath);
  const handle = fs.openSync(summary.pakPath, 'r');
  try {
    if (summary.format === 'WIL' || summary.format === 'WZL') {
      return readWilWzlImagePng(
        handle,
        block,
        {
          format: summary.format,
          wilPaletteBgra: summary.wilPaletteBgra,
        },
        parser.A8_PALETTE_BGRA
      );
    }
    let rgba: Uint8ClampedArray;
    if (summary.format === 'JPK') {
      if (!summary.jpkRc4State) throw new Error(`${summary.pakName} 的 JPK 解码状态缺失`);
      const bitsPerPixel = normalizeJpkBits(block.imageType);
      const jpkBlock: JpkBlock = {
        logicalIndex: block.logicalIndex,
        headerOffset: Math.max(0, block.payloadOffset - 20),
        payloadOffset: block.payloadOffset,
        payloadSize: block.payloadSize,
        compressedSize: block.compressedSize,
        rawSize: block.rawSize,
        imageType: block.imageType,
        flags: block.flags,
        storedType: block.imageType,
        bitsPerPixel,
        compressed: block.compressedSize > 0,
        width: block.width,
        height: block.height,
        x: block.offsetX,
        y: block.offsetY,
        alpha: block.flags !== 0,
        format: 'JPK_INDEXED',
      };
      const raw = readJpkPayload(
        handle,
        jpkBlock,
        Buffer.from(summary.jpkRc4State, 'base64')
      );
      rgba = renderJpkRgba(raw, jpkBlock, parser.A8_PALETTE_BGRA);
    } else {
      const payload = readExactly(handle, block.payloadSize, block.payloadOffset);
      const raw = block.compressedSize > 0
        ? inflatePakPayload(payload, block.rawSize).raw
        : payload;
      if (raw.length !== block.rawSize) {
        throw new Error(`图片 ${block.logicalIndex} 解码长度 ${raw.length}，预期 ${block.rawSize}`);
      }
      const pakBlock: PakBlock = {
        logicalIndex: block.logicalIndex,
        payloadOffset: block.payloadOffset,
        payloadSize: block.payloadSize,
        compressedSize: block.compressedSize,
        rawSize: block.rawSize,
        imageType: block.imageType,
        flags: block.flags,
        width: block.width,
        height: block.height,
        x: block.offsetX,
        y: block.offsetY,
      };
      rgba = parser.toRgba(raw, pakBlock);
      if (summary.format === 'GOM') {
        rgba = applyGomColorKeyTransparency(rgba, block.imageType, block.flags);
      }
    }
    return encodePng(block.width, block.height, rgba);
  } finally {
    fs.closeSync(handle);
  }
}

export function loadArchiveSummary(indexRoot: string, archiveId: string): ArchiveIndexSummary {
  const key = summaryCacheKey(indexRoot, archiveId);
  const cached = summaryCache.get(key);
  if (cached) return cached;
  const summaryPath = path.join(archiveCacheDir(indexRoot, archiveId), ARCHIVE_SUMMARY_FILE);
  const indexPath = path.join(archiveCacheDir(indexRoot, archiveId), ARCHIVE_INDEX_FILE);
  const summary = readValidArchiveSummary(summaryPath, indexPath, { archiveId });
  if (!summary) throw new Error(`素材索引不存在或已损坏: ${archiveId}`);
  rememberSummary(indexRoot, summary);
  return summary;
}

export function loadArchiveAssetTable(indexRoot: string, archiveId: string): ArchiveAssetTable {
  const summary = loadArchiveSummary(indexRoot, archiveId);
  const index = loadIndexBuffer(indexRoot, summary);
  const table: ArchiveAssetTable = {
    slotCount: summary.slotCount,
    present: new Uint8Array(summary.slotCount).fill(1),
    blank: new Uint8Array(summary.slotCount).fill(1),
    width: new Uint16Array(summary.slotCount).fill(1),
    height: new Uint16Array(summary.slotCount).fill(1),
    offsetX: new Int32Array(summary.slotCount),
    offsetY: new Int32Array(summary.slotCount),
  };
  forEachArchiveBlock(index, summary, block => {
    table.blank[block.logicalIndex] = 0;
    table.width[block.logicalIndex] = block.width;
    table.height[block.logicalIndex] = block.height;
    table.offsetX[block.logicalIndex] = block.offsetX;
    table.offsetY[block.logicalIndex] = block.offsetY;
  });
  return table;
}

export function loadArchiveResult(
  indexRoot: string,
  archiveId: string,
  willIdx: number
): DecodedPakResult {
  const summary = loadArchiveSummary(indexRoot, archiveId);
  const assets = createArchiveAssets(indexRoot, summary, willIdx);
  return summaryToResult(
    summary,
    archiveCacheDir(indexRoot, archiveId),
    assets,
    willIdx,
    true
  );
}

export function getArchiveIndexDirectory(indexRoot: string, archiveId: string): string {
  return archiveCacheDir(indexRoot, archiveId);
}

export function listArchiveIndexSummaries(indexRoot: string): ArchiveIndexSummary[] {
  if (!fs.existsSync(indexRoot)) return [];
  const result: ArchiveIndexSummary[] = [];
  for (const entry of fs.readdirSync(indexRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const cacheDir = path.join(indexRoot, entry.name);
    const summary = readValidArchiveSummary(
      path.join(cacheDir, ARCHIVE_SUMMARY_FILE),
      path.join(cacheDir, ARCHIVE_INDEX_FILE),
      { archiveId: entry.name }
    );
    if (!summary) continue;
    rememberSummary(indexRoot, summary);
    result.push(summary);
  }
  return result;
}

export function updateArchiveSourceMd5(
  indexRoot: string,
  archiveId: string,
  sourceMd5: string
): ArchiveIndexSummary {
  const summary = loadArchiveSummary(indexRoot, archiveId);
  const normalized = sourceMd5.toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) throw new Error('素材索引 MD5 无效');
  if (summary.sourceMd5 === normalized) return summary;
  const next = { ...summary, sourceMd5: normalized };
  const summaryPath = path.join(archiveCacheDir(indexRoot, archiveId), ARCHIVE_SUMMARY_FILE);
  atomicWriteFile(summaryPath, Buffer.from(JSON.stringify(next), 'utf8'));
  rememberSummary(indexRoot, next);
  return next;
}

export function forgetArchiveIndex(indexRoot: string, archiveId?: string): void {
  const rootKey = normalizePath(indexRoot);
  for (const key of [...summaryCache.keys()]) {
    if (archiveId ? key === `${rootKey}|${archiveId}` : key.startsWith(`${rootKey}|`)) {
      summaryCache.delete(key);
    }
  }
  for (const key of [...indexBufferCache.keys()]) {
    if (archiveId ? key === `${rootKey}|${archiveId}` : key.startsWith(`${rootKey}|`)) {
      const cached = indexBufferCache.get(key);
      if (cached) cachedIndexBytes -= cached.buffer.byteLength;
      indexBufferCache.delete(key);
    }
  }
}

function summaryToResult(
  summary: ArchiveIndexSummary,
  cacheDir: string,
  assets: DecodedPakAsset[],
  willIdx: number,
  fromCache: boolean
): DecodedPakResult {
  return {
    format: summary.format,
    pakName: summary.pakName,
    pakPath: summary.pakPath,
    willIdx,
    slotCount: summary.slotCount,
    assets,
    cacheDir,
    fromCache,
    storageMode: 'direct',
    archiveId: summary.archiveId,
  };
}

function createArchiveAssets(
  indexRoot: string,
  summary: ArchiveIndexSummary,
  willIdx: number
): DecodedPakAsset[] {
  const index = loadIndexBuffer(indexRoot, summary);
  const blocks: ArchiveIndexBlock[] = [];
  forEachArchiveBlock(index, summary, block => blocks.push(block));
  return createAssetsFromBlocks(summary, blocks, willIdx);
}

function createAssetsFromBlocks(
  summary: ArchiveIndexSummary,
  blocks: Array<PakBlock | ArchiveIndexBlock>,
  willIdx: number
): DecodedPakAsset[] {
  const result: DecodedPakAsset[] = new Array(summary.slotCount);
  let blockIndex = 0;
  for (let logicalIndex = 0; logicalIndex < summary.slotCount; logicalIndex++) {
    const block = blocks[blockIndex];
    const matches = block?.logicalIndex === logicalIndex;
    const displayName = String(logicalIndex).padStart(6, '0');
    result[logicalIndex] = {
      name: displayName,
      path: '',
      pakName: summary.pakName,
      pakPath: summary.pakPath,
      willIdx,
      localIdx: logicalIndex,
      imageIdx: logicalIndex,
      width: matches ? block.width : 1,
      height: matches ? block.height : 1,
      offsetX: matches ? ('offsetX' in block ? block.offsetX : block.x || 0) : 0,
      offsetY: matches ? ('offsetY' in block ? block.offsetY : block.y || 0) : 0,
      isBlank: !matches,
      source: summary.format === 'JPK'
        ? 'jpk'
        : summary.format === 'WIL'
          ? 'wil'
          : summary.format === 'WZL'
            ? 'wzl'
            : 'pak',
      archiveId: summary.archiveId,
    };
    if (matches) blockIndex++;
  }
  return result;
}

function encodeArchiveIndex(blocks: PakBlock[], slotCount: number): Buffer {
  const result = Buffer.allocUnsafe(INDEX_HEADER_SIZE + blocks.length * INDEX_RECORD_SIZE);
  INDEX_MAGIC.copy(result, 0);
  result.writeUInt32LE(ARCHIVE_INDEX_SCHEMA_VERSION, 8);
  result.writeUInt32LE(INDEX_RECORD_SIZE, 12);
  result.writeUInt32LE(blocks.length, 16);
  result.writeUInt32LE(slotCount, 20);
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const offset = INDEX_HEADER_SIZE + index * INDEX_RECORD_SIZE;
    result.writeUInt32LE(block.logicalIndex, offset);
    result.writeBigUInt64LE(BigInt(block.payloadOffset), offset + 4);
    result.writeUInt32LE(block.payloadSize, offset + 12);
    result.writeUInt32LE(block.compressedSize || 0, offset + 16);
    result.writeUInt32LE(block.rawSize, offset + 20);
    result.writeUInt16LE(block.imageType & 0xffff, offset + 24);
    result.writeUInt16LE(block.flags & 0xffff, offset + 26);
    result.writeUInt16LE(block.width, offset + 28);
    result.writeUInt16LE(block.height, offset + 30);
    result.writeInt32LE(Math.trunc(block.x || 0), offset + 32);
    result.writeInt32LE(Math.trunc(block.y || 0), offset + 36);
  }
  return result;
}

function loadIndexBuffer(indexRoot: string, summary: ArchiveIndexSummary): Buffer {
  const key = indexCacheKey(indexRoot, summary.archiveId);
  const cached = indexBufferCache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    indexBufferCache.delete(key);
    indexBufferCache.set(key, cached);
    return cached.buffer;
  }
  const indexPath = path.join(archiveCacheDir(indexRoot, summary.archiveId), ARCHIVE_INDEX_FILE);
  const buffer = fs.readFileSync(indexPath);
  validateIndexBuffer(buffer, summary);
  rememberIndexBuffer(key, buffer);
  return buffer;
}

function rememberIndexBuffer(key: string, buffer: Buffer): void {
  const previous = indexBufferCache.get(key);
  if (previous) cachedIndexBytes -= previous.buffer.byteLength;
  indexBufferCache.delete(key);
  indexBufferCache.set(key, { buffer, lastUsed: Date.now() });
  cachedIndexBytes += buffer.byteLength;
  while (cachedIndexBytes > MAX_INDEX_BUFFER_BYTES && indexBufferCache.size > 1) {
    const oldestKey = indexBufferCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = indexBufferCache.get(oldestKey);
    if (oldest) cachedIndexBytes -= oldest.buffer.byteLength;
    indexBufferCache.delete(oldestKey);
  }
}

function validateIndexBuffer(buffer: Buffer, summary: ArchiveIndexSummary): void {
  if (buffer.length < INDEX_HEADER_SIZE || !buffer.subarray(0, 8).equals(INDEX_MAGIC)) {
    throw new Error(`${summary.pakName} 的素材索引头无效`);
  }
  const version = buffer.readUInt32LE(8);
  const recordSize = buffer.readUInt32LE(12);
  const blockCount = buffer.readUInt32LE(16);
  const slotCount = buffer.readUInt32LE(20);
  if (version !== ARCHIVE_INDEX_SCHEMA_VERSION || recordSize !== INDEX_RECORD_SIZE) {
    throw new Error(`${summary.pakName} 的素材索引版本不兼容`);
  }
  if (blockCount !== summary.blockCount || slotCount !== summary.slotCount) {
    throw new Error(`${summary.pakName} 的素材索引数量不一致`);
  }
  if (buffer.length !== INDEX_HEADER_SIZE + blockCount * INDEX_RECORD_SIZE) {
    throw new Error(`${summary.pakName} 的素材索引长度无效`);
  }
}

function findArchiveBlock(
  buffer: Buffer,
  summary: ArchiveIndexSummary,
  logicalIndex: number
): ArchiveIndexBlock | undefined {
  let low = 0;
  let high = summary.blockCount - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const offset = INDEX_HEADER_SIZE + middle * INDEX_RECORD_SIZE;
    const current = buffer.readUInt32LE(offset);
    if (current === logicalIndex) return decodeArchiveBlock(buffer, offset);
    if (current < logicalIndex) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
}

function forEachArchiveBlock(
  buffer: Buffer,
  summary: ArchiveIndexSummary,
  callback: (block: ArchiveIndexBlock) => void
): void {
  validateIndexBuffer(buffer, summary);
  for (let index = 0; index < summary.blockCount; index++) {
    callback(decodeArchiveBlock(buffer, INDEX_HEADER_SIZE + index * INDEX_RECORD_SIZE));
  }
}

function decodeArchiveBlock(buffer: Buffer, offset: number): ArchiveIndexBlock {
  const payloadOffsetValue = buffer.readBigUInt64LE(offset + 4);
  if (payloadOffsetValue > MAX_SAFE_OFFSET) throw new Error('素材负载偏移超出 JavaScript 安全整数范围');
  const offsetX = buffer.readInt32LE(offset + 32);
  const offsetY = buffer.readInt32LE(offset + 36);
  return {
    logicalIndex: buffer.readUInt32LE(offset),
    payloadOffset: Number(payloadOffsetValue),
    payloadSize: buffer.readUInt32LE(offset + 12),
    compressedSize: buffer.readUInt32LE(offset + 16),
    rawSize: buffer.readUInt32LE(offset + 20),
    imageType: buffer.readUInt16LE(offset + 24),
    flags: buffer.readUInt16LE(offset + 26),
    width: buffer.readUInt16LE(offset + 28),
    height: buffer.readUInt16LE(offset + 30),
    x: offsetX,
    y: offsetY,
    offsetX,
    offsetY,
  };
}

function readValidArchiveSummary(
  summaryPath: string,
  indexPath: string,
  expected: Partial<Pick<ArchiveIndexSummary,
    | 'archiveId'
    | 'pakPath'
    | 'sourceSize'
    | 'sourceMtimeMs'
    | 'companionPath'
    | 'companionSize'
    | 'companionMtimeMs'
    | 'passwordHash'>>
): ArchiveIndexSummary | undefined {
  try {
    if (!fs.existsSync(summaryPath) || !fs.existsSync(indexPath)) return undefined;
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as ArchiveIndexSummary;
    if (summary.schemaVersion !== ARCHIVE_INDEX_SCHEMA_VERSION) return undefined;
    if (summary.decoderRevision !== ARCHIVE_INDEX_DECODER_REVISION) return undefined;
    if (!/^[a-f0-9]{64}$/.test(summary.archiveId)) return undefined;
    if (expected.archiveId && summary.archiveId !== expected.archiveId) return undefined;
    if (expected.pakPath && normalizePath(summary.pakPath) !== normalizePath(expected.pakPath)) return undefined;
    if (expected.sourceSize !== undefined && summary.sourceSize !== expected.sourceSize) return undefined;
    if (expected.sourceMtimeMs !== undefined && summary.sourceMtimeMs !== expected.sourceMtimeMs) return undefined;
    if (
      expected.companionPath
      && (!summary.companionPath
        || normalizePath(summary.companionPath) !== normalizePath(expected.companionPath))
    ) return undefined;
    if (expected.companionSize !== undefined && summary.companionSize !== expected.companionSize) return undefined;
    if (
      expected.companionMtimeMs !== undefined
      && summary.companionMtimeMs !== expected.companionMtimeMs
    ) return undefined;
    if (expected.passwordHash && summary.passwordHash !== expected.passwordHash) return undefined;
    if (!Number.isInteger(summary.slotCount) || summary.slotCount < 0) return undefined;
    if (!Number.isInteger(summary.blockCount) || summary.blockCount < 0 || summary.blockCount > summary.slotCount) return undefined;
    if (
      summary.format !== 'GEE'
      && summary.format !== 'GOM'
      && summary.format !== 'JPK'
      && summary.format !== 'WIL'
      && summary.format !== 'WZL'
    ) return undefined;
    if (
      (summary.format === 'WIL' || summary.format === 'WZL')
      && (
        !summary.companionPath
        || summary.companionSize === undefined
        || summary.companionMtimeMs === undefined
      )
    ) return undefined;
    if (
      summary.format === 'WIL'
      && summary.wilColorCount === 256
      && !summary.wilPaletteBgra
    ) return undefined;
    const expectedBytes = INDEX_HEADER_SIZE + summary.blockCount * INDEX_RECORD_SIZE;
    if (fs.statSync(indexPath).size !== expectedBytes) return undefined;
    return summary;
  } catch {
    return undefined;
  }
}

function assertArchiveSourceCurrent(summary: ArchiveIndexSummary): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(summary.pakPath);
  } catch {
    throw new Error(`源素材包不存在: ${summary.pakPath}`);
  }
  if (stat.size !== summary.sourceSize || stat.mtimeMs !== summary.sourceMtimeMs) {
    throw new Error(`${summary.pakName} 已发生变化，请重新读取`);
  }
  if (summary.companionPath) {
    let companionStat: fs.Stats;
    try {
      companionStat = fs.statSync(summary.companionPath);
    } catch {
      throw new Error(`配套素材索引不存在: ${summary.companionPath}`);
    }
    if (
      companionStat.size !== summary.companionSize
      || companionStat.mtimeMs !== summary.companionMtimeMs
    ) {
      throw new Error(`${path.basename(summary.companionPath)} 已发生变化，请重新读取`);
    }
  }
}

function readExactly(handle: number, length: number, position: number): Buffer {
  const result = Buffer.allocUnsafe(length);
  let completed = 0;
  while (completed < length) {
    const bytesRead = fs.readSync(handle, result, completed, length - completed, position + completed);
    if (bytesRead <= 0) throw new Error(`素材数据提前结束: ${completed}/${length}`);
    completed += bytesRead;
  }
  return result;
}

function atomicWriteFile(filePath: string, data: Buffer): void {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tempPath, data);
  try {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}

function normalizeJpkBits(value: number): 8 | 16 | 24 | 32 {
  return value === 16 || value === 24 || value === 32 ? value : 8;
}

function archiveCacheDir(indexRoot: string, archiveId: string): string {
  return path.join(path.resolve(indexRoot), archiveId);
}

function summaryCacheKey(indexRoot: string, archiveId: string): string {
  return `${normalizePath(indexRoot)}|${archiveId}`;
}

function indexCacheKey(indexRoot: string, archiveId: string): string {
  return summaryCacheKey(indexRoot, archiveId);
}

function rememberSummary(indexRoot: string, summary: ArchiveIndexSummary): void {
  summaryCache.set(summaryCacheKey(indexRoot, summary.archiveId), summary);
}

function normalizePath(filePath: string): string {
  return path.normalize(path.resolve(filePath)).toLowerCase();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
