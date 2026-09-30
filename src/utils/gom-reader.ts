import * as crypto from 'crypto';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import { GeePakApi, PakBlock } from './pak-reader';
import type { PakPhysicalStructure } from './pak-structure-types';
import { ArchiveStructureError, ArchiveDiagnostic, getArchiveDiagnostic } from './archive-errors';

const GOM2_SIGNATURE = Buffer.from([0x0a, ...Buffer.from('GAMEOFMIR2', 'ascii'), 0, 0]);
const GOM1_SIGNATURE = Buffer.from([0x09, ...Buffer.from('GAMEOFMIR', 'ascii')]);
const GOM_PASSWORD_SALT = 0x8f;
const GOM2_FIXED_DES_KEY = Buffer.from('d0740a42ee869c94', 'hex');
const GOM1_FIXED_DES_KEY = Buffer.from('507892b60c6ed00c', 'hex');
const MAX_GOM_SLOTS = 1_000_000;

export interface ParsedGomArchive {
  family: 'GM GAMEOFMIR' | 'GM GAMEOFMIR2';
  slotCount: number;
  blocks: PakBlock[];
  skippedMalformedIndices: number[];
  structure: PakPhysicalStructure;
}

export function parseGomFile(
  filePath: string,
  password: string,
  parser: GeePakApi
): ParsedGomArchive {
  const fileSize = fs.statSync(filePath).size;
  const handle = fs.openSync(filePath, 'r');
  let stage: 'global' | 'index' | 'images' = 'global';
  let diagnostic: ArchiveDiagnostic = { family: 'GOM', stage: 'global-header', reasonCode: 'unknown' };
  const fail = (message: string, reasonCode: ArchiveDiagnostic['reasonCode'], extra: Partial<ArchiveDiagnostic> = {}) =>
    new ArchiveStructureError(message, { ...diagnostic, reasonCode, ...extra });
  try {
    const prefix = readExactly(handle, Math.min(13, fileSize), 0);
    const variant = prefix.subarray(0, GOM2_SIGNATURE.length).equals(GOM2_SIGNATURE)
      ? { signature: GOM2_SIGNATURE, family: 'GM GAMEOFMIR2' as const, fixedKey: GOM2_FIXED_DES_KEY }
      : prefix.subarray(0, GOM1_SIGNATURE.length).equals(GOM1_SIGNATURE)
        ? { signature: GOM1_SIGNATURE, family: 'GM GAMEOFMIR' as const, fixedKey: GOM1_FIXED_DES_KEY }
        : undefined;
    if (!variant) throw fail('不是受支持的 GAMEOFMIR 系列 PAK', 'unsupported-global-header', { offset: 0, length: prefix.length });
    diagnostic.profileId = variant.family === 'GM GAMEOFMIR2' ? 'gom-gameofmir2-v2' : 'gom-gameofmir-v2';
    if (fileSize < variant.signature.length + 256) {
      throw fail(`${variant.family} 全局头不完整`, 'truncated-data', { offset: variant.signature.length, length: 256 });
    }

    const fixedSeed = createSeed(variant.fixedKey, GOM_PASSWORD_SALT);
    const globalHeader = decryptFeedback(
      readExactly(handle, 256, variant.signature.length),
      variant.fixedKey,
      fixedSeed
    );
    const titleLength = globalHeader[1];
    const titleEnd = 2 + titleLength;
    if (titleEnd > globalHeader.length) throw fail(`${variant.family} 全局标题无效`, 'unsupported-global-header');
    const title = globalHeader.subarray(2, titleEnd).toString('ascii');
    const headerSize = globalHeader.readUInt32LE(0x2a);
    const slotCount = globalHeader.readUInt32LE(0x2e);
    const version = globalHeader.readUInt32LE(0x32);
    const indexOffset = globalHeader.readUInt32LE(0x36);
    if (
      title !== 'www.gameofmir.com'
      || headerSize !== variant.signature.length + 256
      || version !== 2
      || indexOffset !== headerSize
    ) {
      throw fail(`${variant.family} 全局头不受支持`, 'unsupported-global-header', { offset: variant.signature.length, length: 256 });
    }
    if (slotCount > MAX_GOM_SLOTS) throw fail(`${variant.family} 素材数量超限: ${slotCount}`, 'resource-limit');
    const indexSize = slotCount * 4;
    if (indexOffset + indexSize > fileSize) throw fail(`${variant.family} 索引越界`, 'index-truncated', { stage: 'index', offset: indexOffset, length: indexSize });

    stage = 'index';
    diagnostic = { ...diagnostic, stage: 'index', offset: indexOffset, length: indexSize };
    const passwordKey = crypto.createHash('sha1')
      .update(iconv.encode(password, 'cp936'))
      .digest()
      .subarray(0, 8);
    const passwordSeed = createSeed(passwordKey, GOM_PASSWORD_SALT);
    const decryptedIndex = decryptFeedback(
      readExactly(handle, indexSize, indexOffset),
      passwordKey,
      passwordSeed
    );
    const imageHeaderKey = Buffer.concat([
      desEncryptBlock(passwordKey, passwordSeed.subarray(0, 8)),
      passwordSeed.subarray(8, 16),
    ]);
    const indexEnd = indexOffset + indexSize;
    const seenOffsets = new Set<number>();
    const entries: Array<{ logicalIndex: number; headerOffset: number }> = [];
    for (let logicalIndex = 0; logicalIndex < slotCount; logicalIndex++) {
      const headerOffset = decryptedIndex.readUInt32LE(logicalIndex * 4);
      if (headerOffset === 0) continue;
      if (seenOffsets.has(headerOffset)) {
        throw fail(`${variant.family} 图片 ${logicalIndex} 的块偏移重复`, 'password-or-profile-mismatch', { logicalIndex, offset: indexOffset + logicalIndex * 4, length: 4 });
      }
      if (headerOffset < indexEnd || headerOffset + 16 > fileSize) {
        throw fail(`${variant.family} 图片 ${logicalIndex} 的块头越界`, 'password-or-profile-mismatch', { logicalIndex, offset: indexOffset + logicalIndex * 4, length: 4 });
      }
      seenOffsets.add(headerOffset);
      entries.push({ logicalIndex, headerOffset });
    }

    entries.sort((left, right) => left.headerOffset - right.headerOffset);
    stage = 'images';
    const blocks: PakBlock[] = [];
    const skippedMalformedIndices: number[] = [];
    const rejectedBlocks: NonNullable<PakPhysicalStructure['rejectedBlocks']> = [];
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
      const { logicalIndex, headerOffset } = entries[entryIndex];
      const blockEnd = entries[entryIndex + 1]?.headerOffset ?? fileSize;
      diagnostic = { ...diagnostic, stage: 'image-header', logicalIndex, offset: headerOffset, length: 16 };
      try {
        if (headerOffset + 16 > blockEnd) throw fail('图片块重叠', 'overlapping-blocks');
        const encryptedHeader = readExactly(handle, 16, headerOffset);
        const header = Buffer.allocUnsafe(16);
        for (let index = 0; index < 16; index++) {
          header[index] = encryptedHeader[index] ^ imageHeaderKey[index];
        }
        const imageType = header[0];
        const flags = header[3];
        const width = header.readUInt16LE(4);
        const height = header.readUInt16LE(6);
        const x = header.readInt16LE(8);
        const y = header.readInt16LE(10);
        const compressedSize = header.readUInt32LE(12);
        if (width < 1 || height < 1 || width > 4096 || height > 4096) {
          throw fail(`${variant.family} 图片 ${logicalIndex} 尺寸无效: ${width}x${height}`, 'invalid-dimensions');
        }
        const rawSize = parser.rawImageSize(imageType, flags, width, height);
        parser.formatName(imageType, flags);
        const payloadSize = compressedSize || rawSize;
        const payloadOffset = headerOffset + 16;
        if (payloadSize <= 0 || payloadOffset + payloadSize > fileSize) {
          throw fail(`${variant.family} 图片 ${logicalIndex} 负载越界`, 'payload-out-of-bounds', { offset: payloadOffset, length: payloadSize });
        }
        if (payloadOffset + payloadSize > blockEnd) throw fail('图片块重叠', 'overlapping-blocks', { offset: payloadOffset, length: payloadSize });
        if (compressedSize) {
          if (compressedSize < 2) {
            throw fail(`${variant.family} 图片 ${logicalIndex} 的压缩负载过短`, 'invalid-compression-header', { offset: payloadOffset, length: payloadSize });
          }
          const zlibHeader = readExactly(handle, 2, payloadOffset);
          const cmf = zlibHeader[0];
          const flg = zlibHeader[1];
          if ((cmf & 0x0f) !== 8 || ((cmf << 8) + flg) % 31 !== 0) {
            throw fail(`${variant.family} 图片 ${logicalIndex} 的 zlib 头无效`, 'invalid-compression-header', { offset: payloadOffset, length: payloadSize });
          }
        }
        blocks.push({
          logicalIndex,
          payloadOffset,
          payloadSize,
          compressedSize,
          rawSize,
          imageType,
          flags,
          width,
          height,
          x,
          y,
          format: parser.formatName(imageType, flags),
        });
      } catch (error) {
        const reasonCode = getArchiveDiagnostic(error).reasonCode;
        if (reasonCode === 'unknown') throw error;
        skippedMalformedIndices.push(logicalIndex);
        rejectedBlocks.push({ logicalIndex, headerOffset, reasonCode });
      }
    }
    assertMalformedBlockTolerance(entries.length, blocks.length, skippedMalformedIndices, variant.family,
      rejectedBlocks[0] ? { ...diagnostic, logicalIndex: rejectedBlocks[0].logicalIndex,
        offset: rejectedBlocks[0].headerOffset, reasonCode: rejectedBlocks[0].reasonCode as ArchiveDiagnostic['reasonCode'] } : diagnostic);
    blocks.sort((left, right) => left.logicalIndex - right.logicalIndex);
    return { family: variant.family, slotCount, blocks, skippedMalformedIndices, structure: {
      profileId: variant.family === 'GM GAMEOFMIR2' ? 'gom-gameofmir2-v2' : 'gom-gameofmir-v2',
      headerSize, globalHeaderOffset: variant.signature.length, indexOffset, indexSize,
      indexDecodedPrefix: 0, indexEncoding: 'des-feedback-20', imageHeaderSize: 16, version,
      rejectedBlocks,
    } };
  } catch (error) {
    const context = stage === 'global' ? '全局头或索引边界不受支持'
      : stage === 'index' ? '密码或索引不匹配（也可能索引损坏）' : '图片结构异常';
    throw new ArchiveStructureError(`${pathLabel(filePath)} ${context}: ${errorText(error)}`, {
      ...getArchiveDiagnostic(error, diagnostic), family: 'GOM', profileId: diagnostic.profileId,
    });
  } finally {
    fs.closeSync(handle);
  }
}

function assertMalformedBlockTolerance(
  nonemptyCount: number,
  validCount: number,
  malformedIndices: number[],
  family: string,
  diagnostic: ArchiveDiagnostic
): void {
  if (malformedIndices.length === 0) return;
  const allowed = Math.min(8, Math.floor(nonemptyCount / 1000));
  if (validCount < 1000 || malformedIndices.length > allowed) {
    const preview = malformedIndices.slice(0, 8).join(', ');
    throw new ArchiveStructureError(
      `${family} 检测到 ${malformedIndices.length} 个异常图片块`
      + `${preview ? ` (序号 ${preview})` : ''}`, diagnostic
    );
  }
}

export function createSeed(key: Buffer, salt: number): Buffer {
  const saltBlock = Buffer.alloc(8, salt);
  return Buffer.concat([desEncryptBlock(key, saltBlock), Buffer.alloc(12, salt)]);
}

export function decryptFeedback(data: Buffer, key: Buffer, seed: Buffer): Buffer {
  if (seed.length !== 20) throw new Error('GAMEOFMIR feedback seed 长度无效');
  const output = Buffer.allocUnsafe(data.length);
  let feedback = Buffer.from(seed);
  let position = 0;
  while (data.length - position >= 20) {
    const encrypted = data.subarray(position, position + 20);
    const stage = Buffer.concat([
      desDecryptBlock(key, encrypted.subarray(0, 8)),
      encrypted.subarray(8),
    ]);
    for (let index = 0; index < 20; index++) {
      output[position + index] = stage[index] ^ feedback[index];
    }
    feedback = Buffer.from(encrypted);
    position += 20;
  }
  if (position < data.length) {
    const stream = Buffer.concat([
      desEncryptBlock(key, feedback.subarray(0, 8)),
      feedback.subarray(8),
    ]);
    for (let index = 0; position + index < data.length; index++) {
      output[position + index] = data[position + index] ^ stream[index];
    }
  }
  return output;
}

function desEncryptBlock(key: Buffer, block: Buffer): Buffer {
  return desBlock(key, block, false);
}

function desDecryptBlock(key: Buffer, block: Buffer): Buffer {
  return desBlock(key, block, true);
}

function desBlock(key: Buffer, block: Buffer, decrypt: boolean): Buffer {
  if (key.length !== 8 || block.length !== 8) throw new Error('DES 块长度无效');
  const tripleKey = Buffer.concat([key, key, key]);
  const cipher = decrypt
    ? crypto.createDecipheriv('des-ede3', tripleKey, null)
    : crypto.createCipheriv('des-ede3', tripleKey, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function readExactly(handle: number, length: number, position: number): Buffer {
  const result = Buffer.allocUnsafe(length);
  let completed = 0;
  while (completed < length) {
    const bytesRead = fs.readSync(handle, result, completed, length - completed, position + completed);
    if (bytesRead <= 0) throw new ArchiveStructureError(`GAMEOFMIR 文件数据提前结束: ${position}+${length}`, { family: 'GOM', stage: 'source', reasonCode: 'truncated-data', offset: position, length });
    completed += bytesRead;
  }
  return result;
}

function pathLabel(filePath: string): string {
  return filePath.replace(/^.*[\\/]/, '');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
