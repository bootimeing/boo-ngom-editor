import * as crypto from 'crypto';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import { createSeed, decryptFeedback } from './gom-reader';
import type { GeePakApi, PakBlock, PakInflateResult } from './pak-reader';
import { ArchiveImageDataError } from './archive-status';
import { ArchiveStructureError, annotateArchiveError, getArchiveDiagnostic, ArchiveDiagnostic, isArchiveZlibDataError } from './archive-errors';
import type { PakPhysicalStructure } from './pak-structure-types';

const HEADER_SIZE = 262;
const MAX_SLOTS = 1_000_000;
const CHECK_CODES = new Set(['D3DM2', 'HXM2', 'HeroM2', 'HeroM2.', 'HXM2.', 'FreeMF']);

/** GXX Pak.pas Lz V0/V1: 20-byte DES feedback, not standard DES-CBC.
 * The index and each image header start with a fresh feedback state.
 * V0: 8-byte offset/size index, 12-byte header, global bit depth, raw/RLE/zlib.
 * V1: 4-byte offsets, 16-byte header, plaintext/zlib and separate aligned alpha.
 */
export function parseHxmFile(filePath: string, password: string): {
  slotCount: number; blocks: PakBlock[]; structure: PakPhysicalStructure;
} {
  const fileSize = fs.statSync(filePath).size;
  const handle = fs.openSync(filePath, 'r');
  let context: ArchiveDiagnostic = { family: 'HXM', stage: 'global-header', reasonCode: 'unknown' };
  const fail = (message: string, reasonCode: ArchiveDiagnostic['reasonCode'], extra: Partial<ArchiveDiagnostic> = {}) =>
    new ArchiveStructureError(message, { ...context, reasonCode, ...extra });
  const read = (position: number, length: number): Buffer => {
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length)
      || position < 0 || length < 0 || position + length > fileSize) {
      throw fail('HXM2 文件数据越界或已截断', context.stage === 'index' ? 'index-truncated' : 'truncated-data', { offset: position, length });
    }
    const result = Buffer.alloc(length);
    let completed = 0;
    while (completed < length) {
      const size = fs.readSync(handle, result, completed, length - completed, position + completed);
      if (!size) throw fail('HXM2 文件数据提前结束', 'truncated-data', { offset: position, length });
      completed += size;
    }
    return result;
  };
  try {
    if (read(0, 5).toString('ascii') !== 'HXM2.') throw fail('不是 HXM2 PAK', 'unsupported-global-header', { offset: 0, length: 5 });
    const global = transform(read(5, 256), '442517066'); // Engine format constant, not an archive password.
    const slotCount = global.readUInt32LE(46);
    // GXX TPakFileHeader: bfType is one byte; Initialize selects V0/V1
    // using only this byte. The next three bytes are separate reserved fields.
    const version = global[50];
    const indexOffset = global.readUInt32LE(54);
    if (global.readUInt32LE(42) !== HEADER_SIZE || indexOffset !== HEADER_SIZE) {
      throw fail('HXM2 全局头结构不受支持', 'unsupported-global-header', { offset: 5, length: 256 });
    }
    if (version !== 0 && version !== 1) throw fail(`HXM2 暂不支持索引版本 ${version}（已支持 V0/V1）`, 'unsupported-global-header');
    context.profileId = `hxm2-lz-v${version}`;
    const bitCount = global.readUInt16LE(58);
    if (version === 0 && ![8, 16, 24, 32].includes(bitCount)) throw fail(`HXM2 V0 不支持全局色深 ${bitCount}`, 'unsupported-image-layout');
    if (slotCount > MAX_SLOTS) throw fail('HXM2 图片数量超限', 'resource-limit');
    const checkLength = global[68];
    if (checkLength < 1 || checkLength > 12) throw fail('HXM2 密码校验字段无效', 'unsupported-global-header');
    const key = passwordKey(password);
    const seed = createSeed(key, 0x8f);
    const decrypt = (bytes: Buffer) => decryptFeedback(bytes, key, seed);
    if (!CHECK_CODES.has(decrypt(global.subarray(69, 69 + checkLength)).toString('latin1'))) {
      throw fail('HXM2 密码校验未通过：密码、校验字段或格式可能不匹配', 'password-check-failed');
    }
    const indexRecordSize = version === 0 ? 8 : 4;
    const imageHeaderSize = version === 0 ? 12 : 16;
    const indexEnd = indexOffset + slotCount * indexRecordSize;
    context = { ...context, stage: 'index', offset: indexOffset, length: slotCount * indexRecordSize };
    const index = decrypt(read(indexOffset, slotCount * indexRecordSize));
    const entries: { logicalIndex: number; offset: number; dataSize?: number }[] = [];
    const seen = new Set<number>();
    for (let logicalIndex = 0; logicalIndex < slotCount; logicalIndex++) {
      const at = logicalIndex * indexRecordSize;
      const offset = version === 0 ? index.readInt32LE(at) : index.readUInt32LE(at);
      const dataSize = version === 0 ? index.readInt32LE(at + 4) : undefined;
      if (!offset) {
        if (dataSize) throw fail(`HXM2 图片 ${logicalIndex} 空槽索引带有非零长度`, 'index-out-of-bounds', { logicalIndex });
        continue;
      }
      if (offset < indexEnd || offset + imageHeaderSize > fileSize || seen.has(offset)) {
        throw fail(`HXM2 图片 ${logicalIndex} 索引越界或重复`, seen.has(offset) ? 'duplicate-offset' : 'index-out-of-bounds', { logicalIndex, offset, length: imageHeaderSize });
      }
      seen.add(offset);
      if (dataSize !== undefined && (dataSize <= imageHeaderSize || dataSize > 128 * 1024 * 1024)) {
        throw fail(`HXM2 图片 ${logicalIndex} 索引长度无效或超限`, dataSize > 128 * 1024 * 1024 ? 'resource-limit' : 'index-out-of-bounds', { logicalIndex, offset, length: dataSize });
      }
      entries.push({ logicalIndex, offset, dataSize });
    }
    entries.sort((a, b) => a.offset - b.offset);
    const blocks = entries.map(({ logicalIndex, offset, dataSize }, entryIndex) => {
      context = { ...context, stage: 'image-header', logicalIndex, offset, length: imageHeaderSize };
      const header = decrypt(read(offset, imageHeaderSize));
      const imageType = version === 0 ? (bitCount === 8 ? 3 : bitCount / 8 + 3) : header[0];
      // Internal V0 flags preserve the compression mode through the binary index/Worker.
      // These are NOT alpha flags; render/decode always require the separate profile ID.
      const flags = version === 0 ? header[0] : header[3];
      const width = header.readInt16LE(4);
      const height = header.readInt16LE(6);
      const rawSize = hxmRawSize(imageType, version === 0 ? 0 : flags, width, height);
      const compressedSize = version === 0 ? (flags === 1 || flags === 2 ? dataSize! - 12 : 0) : header.readUInt32LE(12);
      const payloadSize = version === 0 ? dataSize! - 12 : compressedSize || rawSize;
      const payloadOffset = offset + imageHeaderSize;
      if (payloadOffset + payloadSize > (entries[entryIndex + 1]?.offset ?? fileSize)) {
        throw fail(`HXM2 图片 ${logicalIndex} 数据越界或与下一图片重叠`, payloadOffset + payloadSize > fileSize ? 'payload-out-of-bounds' : 'overlapping-blocks', { offset: payloadOffset, length: payloadSize });
      }
      if (compressedSize && (version === 1 || flags === 2)) {
        const z = read(payloadOffset, Math.min(compressedSize, 2));
        if (z.length !== 2 || (z[0] & 15) !== 8 || ((z[0] << 8) + z[1]) % 31 !== 0) {
          throw fail(`HXM2 图片 ${logicalIndex} 压缩头无效`, 'invalid-compression-header', { offset: payloadOffset, length: compressedSize });
        }
      }
      return { logicalIndex, payloadOffset, payloadSize, compressedSize, rawSize, imageType,
        flags, width, height, x: header.readInt16LE(8), y: header.readInt16LE(10), format: `HXM2_V${version}` };
    });
    blocks.sort((a, b) => a.logicalIndex - b.logicalIndex);
    return { slotCount, blocks, structure: {
      profileId: `hxm2-lz-v${version}`, headerSize: HEADER_SIZE, globalHeaderOffset: 5,
      indexOffset, indexSize: slotCount * indexRecordSize, indexRecordSize, indexDecodedPrefix: 0,
      indexEncoding: 'des-feedback-20', imageHeaderSize, version,
      bitCount, versionReservedBytes: [...global.subarray(51, 54)],
    } };
  } catch (error) {
    if (error instanceof Error) throw annotateArchiveError(error, getArchiveDiagnostic(error, context));
    throw error;
  } finally {
    fs.closeSync(handle);
  }
}

function passwordKey(password: string): Buffer {
  return crypto.createHash('sha1').update(iconv.encode(password, 'cp936')).digest().subarray(0, 8);
}

function transform(bytes: Buffer, password: string): Buffer {
  const key = passwordKey(password);
  return decryptFeedback(bytes, key, createSeed(key, 0x8f));
}

export function hxmRawSize(type: number, flags: number, width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new ArchiveStructureError(`HXM2 图片尺寸无效: ${width}x${height}`, { family: 'HXM', stage: 'image-header', reasonCode: 'invalid-dimensions' });
  }
  // Do not reinterpret pf15bit, the special SD 4-bit alpha layout, or unknown pixel formats.
  if (![3, 5, 6, 7].includes(type) || (flags !== 0 && flags !== 1)) {
    throw new ArchiveStructureError(`HXM2 不支持图片布局 type=${type}, alpha=${flags}`, { family: 'HXM', stage: 'image-header', reasonCode: 'unsupported-image-layout' });
  }
  const bytes = type === 3 ? 1 : type - 3;
  return (((width * bytes + 3) & ~3) + (flags ? (width + 3) & ~3 : 0)) * height;
}

/** Decode only the registered profile, without guessing compressed streams from payload bytes. */
function hxmImageError(message: string, slotCode: 3 | 4 | 5, block: PakBlock,
  reasonCode: ArchiveDiagnostic['reasonCode'] = slotCode === 4 ? 'unsupported-image-layout'
    : slotCode === 3 ? 'decompression-failed' : 'decoded-size-mismatch'): ArchiveImageDataError {
  return annotateArchiveError(new ArchiveImageDataError(message, slotCode), {
    family: 'HXM', stage: slotCode === 3 ? 'decompression' : 'pixels', reasonCode,
    logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize,
  });
}

export function decodeHxmPayload(payload: Uint8Array, block: PakBlock, profileId: string,
  inflate: (bytes: Uint8Array, size: number) => PakInflateResult): PakInflateResult {
  if (profileId !== 'hxm2-lz-v0' && profileId !== 'hxm2-lz-v1') {
    throw hxmImageError('HXM2 不支持此 profile', 4, block);
  }
  const v0 = profileId === 'hxm2-lz-v0';
  const expected = hxmRawSize(block.imageType, v0 ? 0 : block.flags, block.width, block.height);
  if (block.rawSize !== expected) throw hxmImageError('HXM2 图片元数据长度不匹配', 5, block);
  if (!v0 && block.imageType === 5 && block.flags === 0 && block.width % 2) {
    // Pak.pas passes the padded expected color size, not actual decompressed
    // length, to IsNewSDFormat. Odd-width 565 without alpha is ambiguous even
    // when its byte count also fits a normal DIB. Do not silently discard SD alpha.
    throw hxmImageError('HXM2 V1 不支持存在 SD 歧义的奇数宽无 alpha RGB565 布局', 4, block);
  }
  if (v0 && ![0, 1, 2].includes(block.flags)) throw hxmImageError(`HXM2 V0 不支持压缩方式 ${block.flags}`, 4, block);
  if (v0 && block.flags === 1) return { raw: decodeHxmRle(payload, block), recoveredChecksum: false };
  if (v0 ? block.flags === 2 : block.compressedSize > 0) {
    try { return inflate(payload, expected); }
    catch (error) {
      // Preserve system/runtime exceptions; only malformed stream errors belong to a slot.
      const diagnostic = getArchiveDiagnostic(error);
      if (diagnostic.stage !== 'decompression' && !isArchiveZlibDataError(error)) throw error;
      if (diagnostic.reasonCode === 'resource-limit') throw error;
      throw annotateArchiveError(hxmImageError((error as Error).message, 3, block), {
        ...getArchiveDiagnostic(error, { stage: 'decompression', reasonCode: 'decompression-failed' }),
        family: 'HXM', profileId, logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize,
      });
    }
  }
  if (payload.length !== expected) throw hxmImageError('HXM2 原始图片长度不匹配', 5, block);
  return { raw: payload, recoveredChecksum: false };
}

function decodeHxmRle(payload: Uint8Array, block: PakBlock): Uint8Array {
  const bytesPerPixel = block.imageType === 3 ? 1 : block.imageType - 3;
  const tightStride = block.width * bytesPerPixel;
  // GXX DecodeRLE writes tightly packed pixels, then LoadLzImageDataV0 copies
  // aligned DIB bytes from that buffer. Non-aligned multi-row input has no
  // deterministic engine result (including uninitialized memory at the end).
  if (tightStride % 4 && block.height > 1) throw hxmImageError('HXM2 V0 RLE 不支持未确定的多行行对齐布局', 4, block);
  const raw = Buffer.alloc(block.rawSize);
  const tightSize = tightStride * block.height;
  let source = 0, target = 0;
  while (target < tightSize) {
    if (source >= payload.length) throw hxmImageError('HXM2 RLE 数据提前结束', 3, block, 'truncated-data');
    const control = payload[source++], repeat = control >= 128;
    const count = repeat ? control - 127 : control + 1;
    const outputSize = count * bytesPerPixel, inputSize = repeat ? bytesPerPixel : outputSize;
    if (target + outputSize > tightSize || source + inputSize > payload.length) {
      throw hxmImageError('HXM2 RLE 游程越界或像素数据截断', 3, block);
    }
    if (repeat) {
      raw.fill(payload.subarray(source, source + bytesPerPixel), target, target + outputSize);
    } else raw.set(payload.subarray(source, source + inputSize), target);
    source += inputSize; target += outputSize;
  }
  if (source !== payload.length) throw hxmImageError('HXM2 RLE 存在尾随数据', 3, block, 'trailing-compressed-data');
  return raw;
}

export function renderHxmRgba(raw: Uint8Array, block: PakBlock, parser: GeePakApi,
  profileId = 'hxm2-lz-v1'): Uint8ClampedArray {
  if (profileId === 'hxm2-lz-v0') block = { ...block, flags: 0 };
  else if (profileId !== 'hxm2-lz-v1') throw hxmImageError('HXM2 不支持此 profile', 4, block);
  const expected = hxmRawSize(block.imageType, block.flags, block.width, block.height);
  if (raw.length !== expected || block.rawSize !== expected) throw hxmImageError('HXM2 图片解码长度不匹配', 5, block);
  const colorSize = hxmRawSize(block.imageType, 0, block.width, block.height);
  const rgba = parser.toRgba(raw.subarray(0, colorSize), { ...block, flags: 0, rawSize: colorSize });
  const alphaStride = (block.width + 3) & ~3;
  for (let y = 0; y < block.height; y++) for (let x = 0; x < block.width; x++) {
    const target = (y * block.width + x) * 4;
    const sourceY = block.height - 1 - y;
    if (block.imageType === 5) {
      // Active GXX GameImages.BuildColorLevels left-shifts 565 components;
      // it does not replicate low bits as the separate GEE/GOM renderer does.
      const source = sourceY * ((block.width * 2 + 3) & ~3) + x * 2;
      const value = raw[source] | (raw[source + 1] << 8);
      rgba[target] = (value & 0xf800) >>> 8;
      rgba[target + 1] = (value & 0x07e0) >>> 3;
      rgba[target + 2] = (value & 0x001f) << 3;
    }
    if (block.flags) {
      rgba[target + 3] = raw[colorSize + sourceY * alphaStride + x];
    } else if (block.imageType === 7) {
      // GXX ConvertLine32_32 tests all four source bytes, not RGB alone.
      const source = (sourceY * block.width + x) * 4;
      rgba[target + 3] = raw[source] || raw[source + 1] || raw[source + 2] || raw[source + 3] ? 255 : 0;
    } else if (block.imageType !== 3 && !rgba[target] && !rgba[target + 1] && !rgba[target + 2]) {
      rgba[target + 3] = 0;
    }
  }
  return rgba;
}
