import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import * as zlib from 'zlib';
import type { PakBlock } from './pak-reader';
import type { PakPhysicalStructure } from './pak-structure-types';
import { ArchiveStructureError, ArchiveDiagnostic, annotateArchiveError, getArchiveDiagnostic, isArchiveZlibDataError } from './archive-errors';

export const PACK4_PREFIX_FILE = 'pack4-pixel-prefixes.bin';
export const PACK4_PREFIX_SIZE = 128;
const MAX_SLOTS = 1_000_000;

export interface ParsedPack4Archive {
  slotCount: number;
  blocks: PakBlock[];
  structure: PakPhysicalStructure;
  /** Decoded pixel prefixes only, in block order. Never persist the XOR key. */
  pixelPrefixes?: Buffer;
}

/** Verified PACK4.0 trailing-index profiles: LEG/360/APPLE raw BGRA and KSF XOR.
 * Index bytes 0..39 are opaque, not ten image IDs. Dimensions include four
 * low random bits; pixels are top-down. No scanning/re-numbering fallback.
 */
export function parsePack4File(filePath: string, password: string): ParsedPack4Archive {
  const size = fs.statSync(filePath).size;
  const handle = fs.openSync(filePath, 'r');
  let context: ArchiveDiagnostic = { family: 'PACK4', stage: 'global-header', reasonCode: 'unknown' };
  const fail = (message: string, reasonCode: ArchiveDiagnostic['reasonCode'], extra: Partial<ArchiveDiagnostic> = {}) =>
    new ArchiveStructureError(message, { ...context, reasonCode, ...extra });
  const read = (position: number, length: number): Buffer => {
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length)
      || position < 0 || length < 0 || position + length > size) throw fail('PACK4 数据越界或文件截断', 'truncated-data', { offset: position, length });
    const data = Buffer.alloc(length);
    let done = 0;
    while (done < length) {
      const n = fs.readSync(handle, data, done, length - done, position + done);
      if (!n) throw fail('PACK4 文件提前结束', 'truncated-data', { offset: position, length });
      done += n;
    }
    return data;
  };
  try {
    const header = read(0, 64);
    if (header.subarray(0, 8).toString('ascii') !== 'PACK4.0 ') throw fail('不是受支持的 PACK4.0 文件', 'unsupported-global-header', { offset: 0, length: 64 });
    const plainCount = header.readUInt32LE(48), xorCount = header.readUInt32LE(24);
    if (plainCount && xorCount) throw fail('PACK4 全局头配置不受支持', 'unsupported-global-header');
    const encrypted = plainCount === 0 && xorCount > 0;
    context.profileId = encrypted ? 'pack4-ksf-bgra' : 'pack4-plain-bgra';
    const slotCount = encrypted ? xorCount : plainCount;
    if (slotCount > MAX_SLOTS) throw fail('PACK4 图片数量超限', 'resource-limit');
    const key = iconv.encode(password, 'cp936');
    if (encrypted && !key.length) throw fail('PACK4 KSF 需要密码', 'password-required');
    const indexSize = header.readUInt32LE(44);
    // Offset field 40 has profile-specific low-bit obfuscation. The verified
    // profiles append exactly indexSize bytes; authenticate the complete stream
    // and every logical offset instead of treating that field as a plain offset.
    if (indexSize < 6 || indexSize > 8 * MAX_SLOTS + 1024 || indexSize > size - 64) {
      throw fail('PACK4 尾部索引大小无效', indexSize > size - 64 ? 'index-truncated' : 'index-out-of-bounds', { stage: 'index', length: indexSize });
    }
    const indexOffset = size - indexSize;
    context = { ...context, stage: 'index', offset: indexOffset, length: indexSize };
    const indexBytes = read(indexOffset, indexSize);
    if (encrypted) xorInPlace(indexBytes, key, indexBytes.length);
    let index: Buffer;
    try {
      const decoded = zlib.inflateSync(indexBytes, { maxOutputLength: 40 + slotCount * 4, info: true }) as unknown as {
        buffer: Buffer; engine: { bytesWritten: number };
      };
      if (decoded.engine.bytesWritten !== indexBytes.length) throw fail('trailing index bytes', 'trailing-compressed-data');
      index = decoded.buffer;
    } catch (error) {
      const reasonCode = getArchiveDiagnostic(error).reasonCode;
      if (reasonCode === 'unknown' && !isArchiveZlibDataError(error)) throw error;
      throw fail(encrypted ? 'PACK4 KSF 密码错误或尾部索引损坏' : 'PACK4 尾部索引损坏或格式不受支持',
        reasonCode !== 'unknown' ? reasonCode : encrypted ? 'password-or-profile-mismatch' : 'decompression-failed');
    }
    if (index.length !== 40 + slotCount * 4) throw fail('PACK4 逻辑索引长度不匹配', 'decoded-size-mismatch');
    const entries: { logicalIndex: number; offset: number }[] = [];
    const seen = new Set<number>();
    for (let id = 0; id < slotCount; id++) {
      const offset = index.readUInt32LE(40 + id * 4);
      if (!offset) continue;
      if (offset < 64 || offset + 23 > indexOffset || seen.has(offset)) throw fail(`PACK4 图片 ${id} 索引越界或重复`, seen.has(offset) ? 'duplicate-offset' : 'index-out-of-bounds', { logicalIndex: id, offset, length: 23 });
      seen.add(offset);
      entries.push({ logicalIndex: id, offset });
    }
    entries.sort((a, b) => a.offset - b.offset);
    const records = entries.map(({ logicalIndex, offset }, ordinal) => {
      context = { ...context, stage: 'image-header', logicalIndex, offset, length: 23 };
      const image = read(offset, 23);
      if (encrypted) xorInPlace(image, key, 16);
      const width = image.readUInt16LE(0) >>> 4, height = image.readUInt16LE(2) >>> 4;
      if (!width || !height) throw fail(`PACK4 图片 ${logicalIndex} 尺寸无效`, 'invalid-dimensions');
      const payloadSize = image.readUInt32LE(13), rawSize = width * height * 4;
      if (image[12] !== 3 || payloadSize !== rawSize) {
        throw fail(`PACK4 图片 ${logicalIndex} 尚不支持该像素/压缩布局（type=${image[12]}）`, 'unsupported-image-layout');
      }
      const payloadOffset = offset + 23;
      if (payloadOffset + payloadSize > (entries[ordinal + 1]?.offset ?? indexOffset)) {
        throw fail(`PACK4 图片 ${logicalIndex} 数据越界或重叠`, payloadOffset + payloadSize > indexOffset ? 'payload-out-of-bounds' : 'overlapping-blocks', { offset: payloadOffset, length: payloadSize });
      }
      const prefix = encrypted ? read(payloadOffset, Math.min(PACK4_PREFIX_SIZE, payloadSize)) : undefined;
      if (prefix) xorInPlace(prefix, key, prefix.length);
      const block: PakBlock = { logicalIndex, payloadOffset, payloadSize, rawSize, compressedSize: 0,
        imageType: 3, flags: encrypted ? 1 : 0, width, height, x: image.readInt16LE(4), y: image.readInt16LE(6),
        format: encrypted ? 'PACK4_KSF_BGRA' : 'PACK4_BGRA' };
      return { block, prefix };
    });
    records.sort((a, b) => a.block.logicalIndex - b.block.logicalIndex);
    const pixelPrefixes = encrypted ? Buffer.alloc(records.length * PACK4_PREFIX_SIZE) : undefined;
    records.forEach((r, ordinal) => r.prefix?.copy(pixelPrefixes!, ordinal * PACK4_PREFIX_SIZE));
    return { slotCount, blocks: records.map(r => r.block), pixelPrefixes, structure: {
      profileId: encrypted ? 'pack4-ksf-bgra' : 'pack4-plain-bgra',
      headerSize: 64, globalHeaderOffset: 0, indexOffset, indexSize,
      indexDecodedPrefix: 40, indexEncoding: encrypted ? 'repeated-xor-then-zlib' : 'zlib',
      imageHeaderSize: 23,
    } };
  } catch (error) {
    if (error instanceof Error) throw annotateArchiveError(error, getArchiveDiagnostic(error, context));
    throw error;
  } finally {
    fs.closeSync(handle);
  }
}

function xorInPlace(bytes: Buffer, key: Buffer, length: number): void {
  for (let i = 0; i < length; i++) bytes[i] ^= key[i % key.length];
}

export function renderPack4Rgba(raw: Uint8Array, block: PakBlock, prefix?: Uint8Array): Uint8ClampedArray {
  if (block.imageType !== 3 || (block.flags !== 0 && block.flags !== 1)) {
    throw new ArchiveStructureError('PACK4 像素布局或解码长度无效', { family: 'PACK4', stage: 'pixels', reasonCode: 'unsupported-image-layout', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize });
  }
  if (!Number.isInteger(block.width) || !Number.isInteger(block.height)
    || block.width < 1 || block.height < 1 || block.width > 4095 || block.height > 4095) {
    throw new ArchiveStructureError('PACK4 像素布局或解码长度无效', { family: 'PACK4', stage: 'pixels', reasonCode: 'invalid-dimensions', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize });
  }
  if (block.rawSize !== block.width * block.height * 4 || raw.length !== block.rawSize) {
    throw new ArchiveStructureError('PACK4 像素布局或解码长度无效', { family: 'PACK4', stage: 'pixels', reasonCode: 'decoded-size-mismatch', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize });
  }
  if (block.flags && (!prefix || prefix.length < Math.min(raw.length, PACK4_PREFIX_SIZE))) {
    throw new ArchiveStructureError('PACK4 KSF 像素前缀缓存缺失，请重新读取素材包', { family: 'PACK4', stage: 'runtime', reasonCode: 'missing-runtime-data', logicalIndex: block.logicalIndex });
  }
  const rgba = new Uint8ClampedArray(raw.length);
  for (let offset = 0; offset < raw.length; offset += 4) {
    const source = block.flags && offset < PACK4_PREFIX_SIZE ? prefix! : raw;
    rgba[offset] = source[offset + 2];
    rgba[offset + 1] = source[offset + 1];
    rgba[offset + 2] = source[offset];
    rgba[offset + 3] = source[offset + 3];
  }
  return rgba;
}
