import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as zlib from 'zlib';
import { parseHxmFile, decodeHxmPayload, renderHxmRgba } from './hxm-reader';
import { ArchiveImageDataError } from './archive-status';
import { ArchiveStructureError, annotateArchiveError, getArchiveDiagnostic } from './archive-errors';
import { parseGomFile } from './gom-reader';
import { PACK4_PREFIX_SIZE, parsePack4File, renderPack4Rgba } from './pack4-reader';
import {
  JpkBlock,
  JpkFormatError,
  parseJpkFile,
  readJpkPayload,
  renderJpkRgba,
} from './jpk-reader';
import {
  ArchiveAssetSource,
  ArchiveFormat,
  ArchiveSlotStatus,
  ArchiveRejectedSlot,
  rejectedSlot,
} from './archive-types';

export interface GeePakApi {
  PASSWORD: string;
  A8_PALETTE_BGRA: Uint8Array;
  parse(bytes: Uint8Array, password: string, profile?: unknown): {
    header: { count: number; family: string; headerSize: number; indexOffset: number; version: number };
    blocks: PakBlock[];
  };
  parseFromReader(
    fileSize: number,
    readRange: (offset: number, length: number) => Uint8Array,
    password: string,
    profile?: unknown
  ): {
    header: { count: number; family: string; headerSize: number; indexOffset: number; version: number };
    blocks: PakBlock[];
  };
  formatName(imageType: number, flags: number): string;
  rawImageSize(imageType: number, flags: number, width: number, height: number): number;
  readPayload(bytes: Uint8Array, block: PakBlock, inflate: (payload: Uint8Array) => Uint8Array): Uint8Array;
  toRgba(raw: Uint8Array, block: PakBlock): Uint8ClampedArray;
}

export interface PakBlock {
  logicalIndex: number;
  payloadOffset: number;
  payloadSize: number;
  compressedSize: number;
  rawSize: number;
  imageType: number;
  flags: number;
  width: number;
  height: number;
  x?: number;
  y?: number;
  format?: string;
}

export interface BridgeProfile {
  format?: string;
  family?: string;
  slotCount?: number;
  blocks?: PakBlock[];
  skippedMalformedIndices?: number[];
}

export type DetectedPakFormat = 'GEE2' | 'GEE' | 'GOM' | 'HXM' | 'PACK4' | 'UNKNOWN';

export interface DecodedPakAsset {
  name: string;
  path: string;
  pakName: string;
  pakPath: string;
  willIdx: number;
  localIdx: number;
  imageIdx: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  isBlank: boolean;
  decodeStatus?: ArchiveSlotStatus;
  failureCode?: string;
  source: ArchiveAssetSource;
  archiveId?: string;
  indexGeneration?: string;
}

export interface DecodedPakResult {
  format: ArchiveFormat;
  pakName: string;
  pakPath: string;
  willIdx: number;
  slotCount: number;
  assets: DecodedPakAsset[];
  cacheDir: string;
  fromCache: boolean;
  storageMode?: 'legacy' | 'direct';
  archiveId?: string;
  indexGeneration?: string;
  recoveredChecksumCount?: number;
  skippedMalformedCount?: number;
  profileId?: string;
}

export interface DecodePakOptions {
  extensionPath: string;
  cacheRoot: string;
  pakPath: string;
  password: string;
  willIdx: number;
  onProgress?: (completed: number, total: number, label: string) => void;
  ensureBridge?: () => Promise<void>;
  forceRefresh?: boolean;
}

interface PakCacheManifest {
  version: number;
  fingerprint: string;
  decoderRevision?: string;
  format: ArchiveFormat;
  pakName: string;
  pakPath: string;
  sourceMd5: string;
  willIdx: number;
  slotCount: number;
  assets: DecodedPakAsset[];
  recoveredChecksumIndices?: number[];
  skippedMalformedIndices?: number[];
  profileId?: string;
}

export interface PakInflateResult {
  raw: Uint8Array;
  recoveredChecksum: boolean;
  expectedChecksum?: number;
  actualChecksum?: number;
}

const CACHE_VERSION = 4;
export const JPK_DECODER_REVISION = 'jpk-active-index-v4-slot-status';
export const GOM_DECODER_REVISION = 'gom-v2-bounded-slots';
export const GEE2_DECODER_REVISION = 'geepak2-exact-v2-bounded';
export const PAK_DECODER_REVISION = 'pak-v3-hxm-v0';
const BRIDGE_HOST = '127.0.0.1';
const configuredBridgePort = Number(process.env.BOO_PAK_BRIDGE_PORT || '');
const BRIDGE_PORT = Number.isInteger(configuredBridgePort)
  && configuredBridgePort >= 1
  && configuredBridgePort <= 65535
  ? configuredBridgePort
  : 8765;
const GEE_HEADER_SIZE = 266;

export async function decodePakFully(options: DecodePakOptions): Promise<DecodedPakResult> {
  const parser = loadParser(options.extensionPath);
  const stat = fs.statSync(options.pakPath);
  const isJpk = path.extname(options.pakPath).toLowerCase() === '.jpk';
  const detectedPakFormat = isJpk ? 'UNKNOWN' : detectPakFileFormat(options.pakPath);
  const isGom = detectedPakFormat === 'GOM';
  const isGee2 = detectedPakFormat === 'GEE2';
  const expectedDecoderRevision = isJpk
    ? JPK_DECODER_REVISION
    : isGom
      ? GOM_DECODER_REVISION
      : isGee2
        ? GEE2_DECODER_REVISION
        : PAK_DECODER_REVISION;
  const passwordHash = crypto.createHash('sha256').update(options.password, 'utf8').digest('hex');
  // New semantics get a separate directory. In particular a rejected slot
  // must never inherit a transparent PNG generated by an older decoder.
  const cacheVersionKey = `${CACHE_VERSION}:${expectedDecoderRevision}`;
  const fingerprint = crypto.createHash('sha256')
    .update(`${cacheVersionKey}|${path.resolve(options.pakPath).toLowerCase()}|${stat.size}|${stat.mtimeMs}|${passwordHash}|${options.willIdx}`)
    .digest('hex');
  const cacheDir = path.join(options.cacheRoot, fingerprint);
  const manifestPath = path.join(cacheDir, 'manifest.json');
  const cached = options.forceRefresh
    ? null
    : readValidManifest(manifestPath, fingerprint, expectedDecoderRevision);
  if (cached) {
    options.onProgress?.(cached.assets.length, cached.assets.length, `${cached.pakName} 已从缓存加载`);
    return {
      ...cached,
      cacheDir,
      fromCache: true,
      storageMode: 'legacy',
      recoveredChecksumCount: cached.recoveredChecksumIndices?.length || 0,
      skippedMalformedCount: cached.skippedMalformedIndices?.length || 0,
    };
  }
  if (options.forceRefresh && fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }

  options.onProgress?.(0, 1, `读取 ${path.basename(options.pakPath)}`);
  const data = isJpk ? undefined : fs.readFileSync(options.pakPath);
  const format: DetectedPakFormat | 'JPK' = isJpk
    ? 'JPK'
    : detectPakFormat(data!);
  let blocks: PakBlock[];
  let slotCount: number;
  let skippedMalformedIndices: number[] = [];
  const rejectedSlots = new Map<number, ArchiveRejectedSlot>();
  let profileId: string | undefined;
  let pack4Prefixes: Map<number, Buffer> | undefined;
  const jpkArchive = format === 'JPK'
    ? parseJpkFile(options.pakPath, options.password)
    : undefined;
  const sourceMd5 = data
    ? crypto.createHash('md5').update(data).digest('hex')
    : await calculateFileMd5(options.pakPath);

  if (format === 'JPK') {
    blocks = jpkArchive!.blocks;
    slotCount = jpkArchive!.slotCount;
    skippedMalformedIndices = [...jpkArchive!.skippedMalformedIndices];
    for (const id of skippedMalformedIndices) rejectedSlots.set(id, rejectedSlot(id, 'invalid-image-header'));
    profileId = `jpk-${jpkArchive!.variant}`;
  } else if (format === 'PACK4') {
    const parsed = parsePack4File(options.pakPath, options.password);
    blocks = parsed.blocks;
    slotCount = parsed.slotCount;
    profileId = parsed.structure.profileId;
    if (parsed.pixelPrefixes) {
      pack4Prefixes = new Map(blocks.map((b, i) => [b.logicalIndex,
        parsed.pixelPrefixes!.subarray(i * PACK4_PREFIX_SIZE, (i + 1) * PACK4_PREFIX_SIZE)]));
    }
  } else if (format === 'HXM') {
    const parsed = parseHxmFile(options.pakPath, options.password);
    blocks = parsed.blocks;
    slotCount = parsed.slotCount;
    profileId = parsed.structure.profileId;
  } else if (format === 'GEE2') {
    await options.ensureBridge?.();
    const profile = await requestGee2Profile(
      data!.length,
      (offset, length) => data!.subarray(offset, offset + length),
      options.password
    );
    const parsed = parser.parse(data!, options.password, profile);
    blocks = parsed.blocks;
    slotCount = parsed.header.count;
    profileId = 'gee2-v2';
  } else if (format === 'GEE') {
    let parsed;
    try {
      parsed = parser.parse(data!, options.password);
    } catch (offlineError) {
      try {
        await options.ensureBridge?.();
        const profile = await requestGeeProfile(
          options.password,
          data!.subarray(10, 266)
        );
        parsed = parser.parse(data!, options.password, profile);
      } catch (bridgeError) {
        throw new ArchiveStructureError(
          `GEE PAK 精确索引解析失败。内置解析: ${errorText(offlineError)}；离线引擎: ${errorText(bridgeError)}`,
          getArchiveDiagnostic(bridgeError, { family: 'GEE', stage: 'runtime', reasonCode: 'unknown' })
        );
      }
    }
    blocks = parsed.blocks;
    slotCount = parsed.header.count;
    profileId = `gee3-${parsed.header.family}-v2`;
  } else if (format === 'GOM') {
    const profile = parseGomFile(options.pakPath, options.password, parser);
    blocks = profile.blocks;
    slotCount = profile.slotCount;
    skippedMalformedIndices = profile.skippedMalformedIndices;
    profileId = profile.structure.profileId;
    for (const slot of profile.structure.rejectedBlocks || []) {
      rejectedSlots.set(slot.logicalIndex, rejectedSlot(slot.logicalIndex, slot.reasonCode));
    }
  } else {
    throw new ArchiveStructureError('当前只支持具有精确逻辑索引的 GEEPAK2、GEEPAK3、GAMEOFMIR、GAMEOFMIR2、HXM2 V0/V1、PACK4.0 PAK 和 996PC JPK', { family: 'PAK', stage: 'global-header', reasonCode: 'unsupported-global-header', offset: 0, length: Math.min(data?.length || 0, GEE_HEADER_SIZE) });
  }

  const archiveFormat: ArchiveFormat = format === 'GEE2' ? 'GEE' : format;

  validateBlocks(blocks, slotCount, stat.size);
  const slots = enumeratePakSlots(blocks, slotCount);
  fs.mkdirSync(cacheDir, { recursive: true });
  const pakName = path.basename(options.pakPath, path.extname(options.pakPath));
  const assets: DecodedPakAsset[] = [];
  const recoveredChecksumIndices: number[] = [];
  const jpkHandle = format === 'JPK' ? fs.openSync(options.pakPath, 'r') : undefined;

  try {
    for (let logicalIndex = 0; logicalIndex < slots.length; logicalIndex++) {
      const block = slots[logicalIndex];
      let width = 1;
      let height = 1;
      let offsetX = 0;
      let offsetY = 0;
      let failure = rejectedSlots.get(logicalIndex);
      let isBlank = !block && !failure;
      let decodeStatus: ArchiveSlotStatus = failure?.status || (block ? 'decoded' : 'empty');
      let rgba: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(4);
      if (block) {
        width = block.width;
        height = block.height;
        offsetX = block.x || 0;
        offsetY = block.y || 0;
        try {
          if (format === 'JPK') {
            const raw = readJpkPayload(
              jpkHandle!,
              block as JpkBlock,
              jpkArchive!.rc4State
            );
            rgba = renderJpkRgba(raw, block as JpkBlock, parser.A8_PALETTE_BGRA);
          } else {
            let recoveredChecksum = false;
            const hxm = format === 'HXM' ? decodeHxmPayload(data!.subarray(block.payloadOffset,
              block.payloadOffset + block.payloadSize), block, profileId!, inflatePakPayload) : undefined;
            recoveredChecksum = hxm?.recoveredChecksum || false;
            const raw = hxm?.raw || parser.readPayload(data!, block, payload => {
              const inflated = inflatePakPayload(payload, block.rawSize);
              recoveredChecksum = inflated.recoveredChecksum;
              return inflated.raw;
            });
            rgba = format === 'HXM' ? renderHxmRgba(raw, block, parser, profileId)
              : format === 'PACK4' ? renderPack4Rgba(raw, block, pack4Prefixes?.get(block.logicalIndex))
                : parser.toRgba(raw, block);
            if (format === 'GOM') {
              rgba = applyGomColorKeyTransparency(rgba, block.imageType, block.flags);
            }
            if (recoveredChecksum) {
              decodeStatus = 'recovered';
              recoveredChecksumIndices.push(logicalIndex);
              console.warn(
                `[BOO] ${path.basename(options.pakPath)} 图片 ${logicalIndex} 的 zlib 校验值异常，`
                + '压缩正文与图片长度均完整，已兼容恢复'
              );
            }
          }
        } catch (error) {
          const diagnostic = getArchiveDiagnostic(error);
          if ((format === 'JPK' && error instanceof JpkFormatError
            && ['image-header', 'decompression', 'pixels'].includes(diagnostic.stage)
            && diagnostic.reasonCode !== 'resource-limit')
            || (format === 'HXM' && error instanceof ArchiveImageDataError)) {
            // The active index is valid; one damaged payload must not discard
            // independent later slots. Keep its ID, but do not fabricate a PNG.
            skippedMalformedIndices.push(logicalIndex);
            failure = rejectedSlot(logicalIndex, error instanceof ArchiveImageDataError && error.slotCode === 4
              ? 'unsupported-image-layout' : 'payload-decode-failed');
            decodeStatus = failure.status;
            isBlank = false;
            console.warn(`[BOO] ${path.basename(options.pakPath)} 图片 ${logicalIndex} 解码失败，保留原序号: ${errorText(error)}`);
          } else {
            throw new ArchiveStructureError(
              `${format === 'JPK' ? 'JPK' : 'PAK'} ${path.basename(options.pakPath)} 图片序号 ${logicalIndex} 解压失败`
              + `（偏移 ${block.payloadOffset}，压缩 ${block.compressedSize || 0}，原始 ${block.rawSize}）`
              + `: ${errorText(error)}`,
              getArchiveDiagnostic(error, { family: format === 'JPK' ? 'JPK' : 'PAK',
                stage: 'unknown', reasonCode: 'unknown', logicalIndex, offset: block.payloadOffset, length: block.payloadSize, profileId })
            );
          }
        }
      }
      const displayName = String(logicalIndex).padStart(6, '0');
      const fileName = `${displayName}.png`;
      const outputPath = path.join(cacheDir, fileName);
      if (!failure) fs.writeFileSync(outputPath, encodePng(width, height, rgba));
      assets.push({
        name: displayName,
        path: failure ? '' : outputPath,
        pakName,
        pakPath: options.pakPath,
        willIdx: options.willIdx,
        localIdx: logicalIndex,
        imageIdx: logicalIndex,
        width,
        height,
        offsetX,
        offsetY,
        isBlank,
        decodeStatus,
        failureCode: failure?.reasonCode,
        source: format === 'JPK' ? 'jpk' : 'pak',
      });
      if ((logicalIndex + 1) % 20 === 0 || logicalIndex + 1 === slots.length) {
        options.onProgress?.(logicalIndex + 1, slots.length, `${pakName}: ${logicalIndex + 1}/${slots.length}`);
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    }
  } finally {
    if (jpkHandle !== undefined) fs.closeSync(jpkHandle);
  }

  skippedMalformedIndices.sort((left, right) => left - right);
  const manifest: PakCacheManifest = {
    version: CACHE_VERSION,
    fingerprint,
    decoderRevision: format === 'JPK'
      ? JPK_DECODER_REVISION
      : format === 'GOM'
        ? GOM_DECODER_REVISION
        : format === 'GEE2'
          ? GEE2_DECODER_REVISION
          : PAK_DECODER_REVISION,
    format: archiveFormat,
    pakName,
    pakPath: options.pakPath,
    sourceMd5,
    willIdx: options.willIdx,
    slotCount,
    assets,
    recoveredChecksumIndices,
    skippedMalformedIndices,
    profileId,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');
  return {
    format: archiveFormat,
    pakName,
    pakPath: options.pakPath,
    willIdx: options.willIdx,
    slotCount,
    assets,
    cacheDir,
    fromCache: false,
    storageMode: 'legacy',
    recoveredChecksumCount: recoveredChecksumIndices.length,
    skippedMalformedCount: skippedMalformedIndices.length,
    profileId,
  };
}

export function loadParser(extensionPath: string): GeePakApi {
  const parserPath = path.join(extensionPath, 'media', 'geepak3_exact.js');
  if (!fs.existsSync(parserPath)) throw new ArchiveStructureError(`缺少 PAK 解析器: ${parserPath}`, { stage: 'runtime', reasonCode: 'missing-runtime-data' });
  return require(parserPath) as GeePakApi;
}

export function detectPakFormat(data: Uint8Array): DetectedPakFormat {
  if (Buffer.from(data.subarray(0, 5)).toString('ascii') === 'HXM2.') return 'HXM';
  if (Buffer.from(data.subarray(0, 8)).toString('ascii') === 'PACK4.0 ') return 'PACK4';
  if (data.length >= 8 && data[0] === 0x07) {
    const signature = Buffer.from(data.subarray(1, 8)).toString('ascii');
    if (signature === 'GEEPAK2') return 'GEE2';
    if (signature === 'GEEPAK3') return 'GEE';
  }
  if (data.length >= 11 && data[0] === 0x0a && Buffer.from(data.subarray(1, 11)).toString('ascii') === 'GAMEOFMIR2') return 'GOM';
  if (data.length >= 10 && data[0] === 0x09 && Buffer.from(data.subarray(1, 10)).toString('ascii') === 'GAMEOFMIR') return 'GOM';
  return 'UNKNOWN';
}

export function applyGomColorKeyTransparency(
  rgba: Uint8ClampedArray,
  imageType: number,
  flags: number
): Uint8ClampedArray {
  if (flags !== 0 || (imageType !== 5 && imageType !== 6 && imageType !== 7)) return rgba;
  for (let index = 0; index + 3 < rgba.length; index += 4) {
    if (rgba[index] === 0 && rgba[index + 1] === 0 && rgba[index + 2] === 0) {
      rgba[index + 3] = 0;
    }
  }
  return rgba;
}

export function detectPakFileFormat(filePath: string): DetectedPakFormat {
  const handle = fs.openSync(filePath, 'r');
  try {
    const signature = Buffer.alloc(13);
    const bytesRead = fs.readSync(handle, signature, 0, signature.length, 0);
    return detectPakFormat(signature.subarray(0, bytesRead));
  } finally {
    fs.closeSync(handle);
  }
}

export function normalizeBridgeBlock(block: PakBlock): PakBlock {
  return {
    ...block,
    logicalIndex: Number(block.logicalIndex),
    payloadOffset: Number(block.payloadOffset),
    compressedSize: Number(block.compressedSize || 0),
    payloadSize: Number(block.payloadSize || block.compressedSize || block.rawSize),
    rawSize: Number(block.rawSize),
    imageType: Number(block.imageType),
    flags: Number(block.flags),
    width: Number(block.width),
    height: Number(block.height),
    x: Number(block.x || 0),
    y: Number(block.y || 0),
  };
}

export function enumeratePakSlots<T extends { logicalIndex: number }>(
  blocks: T[],
  slotCount: number
): (T | undefined)[] {
  const byIndex = new Map(blocks.map(block => [block.logicalIndex, block]));
  return Array.from({ length: slotCount }, (_, logicalIndex) => byIndex.get(logicalIndex));
}

export function inflatePakPayload(payload: Uint8Array, expectedRawSize: number): PakInflateResult {
  // Supported layouts are limited to 4096 x 4096; 128 MiB also leaves room
  // for a separate alpha plane. Never allocate based on the deflate stream.
  if (!Number.isSafeInteger(expectedRawSize) || expectedRawSize < 1 || expectedRawSize > 128 * 1024 * 1024) {
    throw new ArchiveStructureError(`PAK 解压大小超限或无效: ${expectedRawSize}`, { family: 'PAK', stage: 'decompression', reasonCode: 'resource-limit' });
  }
  type InflateInfo = { buffer: Buffer; engine: { bytesWritten: number } };
  try {
    const result = zlib.inflateSync(payload, { info: true, maxOutputLength: expectedRawSize }) as unknown as InflateInfo;
    if (result.engine.bytesWritten !== payload.byteLength) throw annotateArchiveError(new ArchiveImageDataError('PAK zlib 流存在尾随数据', 3), { family: 'PAK', stage: 'decompression', reasonCode: 'trailing-compressed-data', length: payload.byteLength });
    if (result.buffer.length !== expectedRawSize) {
      throw annotateArchiveError(new ArchiveImageDataError(`PAK 解压长度 ${result.buffer.length}，预期 ${expectedRawSize}`, 3), { family: 'PAK', stage: 'decompression', reasonCode: 'decoded-size-mismatch', length: payload.byteLength });
    }
    return {
      raw: result.buffer,
      recoveredChecksum: false,
    };
  } catch (primaryError) {
    // Node uses RangeError for the explicit maxOutputLength guard as well as
    // runtime faults. This specific code is proof that the stream exceeded
    // its declared image size; the slot ledger must not treat it as a host fault.
    if ((primaryError as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw annotateArchiveError(new ArchiveImageDataError(`PAK 解压输出超过声明大小 ${expectedRawSize}`, 3), { family: 'PAK', stage: 'decompression', reasonCode: 'decompression-failed', length: payload.byteLength });
    }
    if (primaryError instanceof Error && ['Z_DATA_ERROR', 'Z_BUF_ERROR', 'Z_NEED_DICT'].includes((primaryError as NodeJS.ErrnoException).code || '')) {
      annotateArchiveError(primaryError, { family: 'PAK', stage: 'decompression', reasonCode: 'decompression-failed', length: payload.byteLength });
    }
    if (!isZlibChecksumError(primaryError)) throw primaryError;

    const bytes = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
    if (!isZlibEnvelope(bytes) || (bytes[1] & 0x20) !== 0 || bytes.length <= 6) throw primaryError;

    let raw: Buffer;
    try {
      const body = bytes.subarray(2, bytes.length - 4);
      const result = zlib.inflateRawSync(body, { info: true, maxOutputLength: expectedRawSize }) as unknown as InflateInfo;
      if (result.engine.bytesWritten !== body.length) throw primaryError;
      raw = result.buffer;
    } catch {
      throw primaryError;
    }

    const expectedChecksum = bytes.readUInt32BE(bytes.length - 4);
    const actualChecksum = adler32(raw);
    if (raw.length !== expectedRawSize || actualChecksum === expectedChecksum) throw primaryError;
    return {
      raw,
      recoveredChecksum: true,
      expectedChecksum,
      actualChecksum,
    };
  }
}

function isZlibChecksumError(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return code === 'Z_DATA_ERROR' && /incorrect data check/i.test(errorText(error));
}

function isZlibEnvelope(payload: Uint8Array): boolean {
  if (payload.length < 6) return false;
  const cmf = payload[0];
  const flg = payload[1];
  return (cmf & 0x0f) === 8 && ((cmf << 8) + flg) % 31 === 0;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const value of data) {
    a = (a + value) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

export function validateBlocks(blocks: PakBlock[], slotCount: number, fileSize: number) {
  if (!Number.isInteger(slotCount) || slotCount < 0) throw new ArchiveStructureError('PAK 逻辑槽数量无效', { family: 'PAK', stage: 'index', reasonCode: 'index-out-of-bounds' });
  const seen = new Set<number>();
  for (const block of blocks) {
    if (!Number.isInteger(block.logicalIndex) || block.logicalIndex < 0 || block.logicalIndex >= slotCount) {
      throw new ArchiveStructureError(`PAK 逻辑序号越界: ${block.logicalIndex}/${slotCount}`, { family: 'PAK', stage: 'index', reasonCode: 'index-out-of-bounds', logicalIndex: block.logicalIndex });
    }
    if (seen.has(block.logicalIndex)) throw new ArchiveStructureError(`PAK 逻辑序号重复: ${block.logicalIndex}`, { family: 'PAK', stage: 'index', reasonCode: 'index-out-of-bounds', logicalIndex: block.logicalIndex });
    seen.add(block.logicalIndex);
    if (!Number.isInteger(block.width) || !Number.isInteger(block.height) || block.width < 1 || block.height < 1) {
      throw new ArchiveStructureError(`PAK 图片 ${block.logicalIndex} 尺寸无效`, { family: 'PAK', stage: 'image-header', reasonCode: 'invalid-dimensions', logicalIndex: block.logicalIndex });
    }
    if (block.payloadOffset < 0 || block.payloadSize < 0 || block.payloadOffset + block.payloadSize > fileSize) {
      throw new ArchiveStructureError(`PAK 图片 ${block.logicalIndex} 数据越界`, { family: 'PAK', stage: 'image-header', reasonCode: 'payload-out-of-bounds', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize });
    }
  }
}

function readValidManifest(
  manifestPath: string,
  fingerprint: string,
  expectedDecoderRevision?: string
): PakCacheManifest | null {
  try {
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PakCacheManifest;
    if (manifest.version !== CACHE_VERSION || manifest.fingerprint !== fingerprint || !Array.isArray(manifest.assets)) return null;
    if (expectedDecoderRevision && manifest.decoderRevision !== expectedDecoderRevision) return null;
    const cacheDir = path.dirname(manifestPath);
    manifest.assets = manifest.assets.map(asset => ({
      ...asset,
      path: asset.failureCode ? '' : path.join(cacheDir, path.basename(asset.path)),
    }));
    if (!manifest.assets.every(asset => asset.failureCode || fs.existsSync(asset.path))) return null;
    return manifest;
  } catch {
    return null;
  }
}

export async function requestGeeProfile(
  password: string,
  encryptedGlobalHeader?: Uint8Array
): Promise<unknown> {
  if (encryptedGlobalHeader && encryptedGlobalHeader.length !== 256) {
    throw new ArchiveStructureError('GEE 加密全局头必须为 256 字节', { family: 'GEE', stage: 'global-header', reasonCode: 'truncated-data', offset: 10, length: 256 });
  }
  const body = Buffer.from(JSON.stringify({
    password,
    encryptedGlobalHeader: encryptedGlobalHeader
      ? Buffer.from(encryptedGlobalHeader).toString('base64')
      : undefined,
  }), 'utf8');
  const result = await postBridge('/api/gee-profile', body, { 'Content-Type': 'application/json' });
  return result.profile;
}

export async function requestGee2Profile(
  fileSize: number,
  readRange: (offset: number, length: number) => Uint8Array,
  password: string
): Promise<unknown> {
  if (!Number.isSafeInteger(fileSize) || fileSize < GEE_HEADER_SIZE) {
    throw new ArchiveStructureError('GEEPAK2 文件长度无效', { family: 'GEE2', stage: 'global-header', reasonCode: 'truncated-data', offset: 0, length: GEE_HEADER_SIZE });
  }
  const prefix = Buffer.from(readRange(0, GEE_HEADER_SIZE));
  if (prefix.length !== GEE_HEADER_SIZE) throw new ArchiveStructureError('GEEPAK2 全局头读取不完整', { family: 'GEE2', stage: 'global-header', reasonCode: 'truncated-data', offset: 0, length: GEE_HEADER_SIZE });
  const passwordHeader = Buffer.from(password, 'utf8').toString('base64');
  const headers = {
    'Content-Type': 'application/octet-stream',
    'X-GM-Password-B64': passwordHeader,
  };
  const headerResult = await postBridge('/api/gee2-header', prefix, headers);
  const headerProfile = headerResult.profile as Record<string, unknown> | undefined;
  if (!headerProfile || headerProfile.format !== 'GEEPAK2' || headerProfile.family !== 'gee2') {
    throw new ArchiveStructureError('PAK 离线引擎返回的 GEEPAK2 全局头无效', { family: 'GEE2', stage: 'runtime', reasonCode: 'missing-runtime-data' });
  }
  const slotCount = Number(headerProfile.slotCount);
  const indexOffset = Number(headerProfile.indexOffset);
  if (
    !Number.isInteger(slotCount)
    || slotCount < 0
    || slotCount > 1_000_000
    || indexOffset !== GEE_HEADER_SIZE
    || indexOffset + slotCount * 4 > fileSize
  ) {
    throw new ArchiveStructureError('PAK 离线引擎返回的 GEEPAK2 索引范围无效', { family: 'GEE2', stage: 'index', reasonCode: 'index-out-of-bounds', offset: indexOffset, length: slotCount * 4 });
  }
  const encryptedIndex = Buffer.from(readRange(indexOffset, slotCount * 4));
  if (encryptedIndex.length !== slotCount * 4) throw new ArchiveStructureError('GEEPAK2 索引读取不完整', { family: 'GEE2', stage: 'index', reasonCode: 'index-truncated', offset: indexOffset, length: slotCount * 4 });
  const indexResult = await postBridge(
    '/api/gee2-index',
    Buffer.concat([prefix, encryptedIndex]),
    headers
  );
  const profile = indexResult.profile as Record<string, unknown> | undefined;
  if (
    !profile
    || profile.format !== 'GEEPAK2'
    || profile.family !== 'gee2'
    || Number(profile.slotCount) !== slotCount
    || Number(profile.indexOffset) !== indexOffset
    || typeof profile.decryptedIndex !== 'string'
    || typeof profile.imageHeaderMask !== 'string'
  ) {
    throw new ArchiveStructureError('PAK 离线引擎返回的 GEEPAK2 精确索引无效', { family: 'GEE2', stage: 'runtime', reasonCode: 'missing-runtime-data' });
  }
  return profile;
}

export async function requestGomProfile(data: Buffer, password: string): Promise<BridgeProfile> {
  const passwordHeader = Buffer.from(password, 'utf8').toString('base64');
  const result = await postBridge('/api/gom-profile', data, {
    'Content-Type': 'application/octet-stream',
    'X-GM-Password-B64': passwordHeader,
  });
  return result.profile as BridgeProfile;
}

function postBridge(route: string, body: Buffer, headers: Record<string, string>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: BRIDGE_HOST,
      port: BRIDGE_PORT,
      path: route,
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(body.length) },
      timeout: 180000,
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let result: Record<string, unknown>;
        try {
          result = JSON.parse(text) as Record<string, unknown>;
        } catch {
          reject(new ArchiveStructureError(`PAK 离线引擎返回了无效响应 (${response.statusCode || 0})`, { stage: 'runtime', reasonCode: 'unknown' }));
          return;
        }
        if ((response.statusCode || 500) >= 400 || result.ok !== true) {
          reject(new ArchiveStructureError(String(result.error || `HTTP ${response.statusCode || 0}`),
            getArchiveDiagnostic(result, { stage: 'runtime', reasonCode: 'unknown' })));
          return;
        }
        resolve(result);
      });
    });
    request.on('timeout', () => request.destroy(new ArchiveStructureError('PAK 离线引擎请求超时', { stage: 'runtime', reasonCode: 'unknown' })));
    request.on('error', error => reject(new ArchiveStructureError(`未连接到 PAK 离线引擎 127.0.0.1:8765: ${error.message}`, { stage: 'runtime', reasonCode: 'unknown' })));
    request.end(body);
  });
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

const crcTable = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let k = 0; k < 8; k++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
}

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const value of data) crc = crcTable[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, 'ascii');
  const result = Buffer.allocUnsafe(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return result;
}

export function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Buffer {
  if (rgba.length !== width * height * 4) throw new ArchiveStructureError('RGBA 像素长度与图片尺寸不一致', { stage: 'pixels', reasonCode: 'decoded-size-mismatch' });
  const stride = width * 4;
  const raw = Buffer.allocUnsafe((stride + 1) * height);
  const pixels = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let y = 0; y < height; y++) {
    const target = y * (stride + 1);
    raw[target] = 0;
    pixels.copy(raw, target + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
