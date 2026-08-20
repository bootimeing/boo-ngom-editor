import * as crypto from 'crypto';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import { GeePakApi, PakBlock } from './pak-reader';

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
}

export function parseGomFile(
  filePath: string,
  password: string,
  parser: GeePakApi
): ParsedGomArchive {
  const fileSize = fs.statSync(filePath).size;
  const handle = fs.openSync(filePath, 'r');
  try {
    const prefix = readExactly(handle, Math.min(13, fileSize), 0);
    const variant = prefix.subarray(0, GOM2_SIGNATURE.length).equals(GOM2_SIGNATURE)
      ? { signature: GOM2_SIGNATURE, family: 'GM GAMEOFMIR2' as const, fixedKey: GOM2_FIXED_DES_KEY }
      : prefix.subarray(0, GOM1_SIGNATURE.length).equals(GOM1_SIGNATURE)
        ? { signature: GOM1_SIGNATURE, family: 'GM GAMEOFMIR' as const, fixedKey: GOM1_FIXED_DES_KEY }
        : undefined;
    if (!variant) throw new Error('不是受支持的 GAMEOFMIR 系列 PAK');
    if (fileSize < variant.signature.length + 256) {
      throw new Error(`${variant.family} 全局头不完整`);
    }

    const fixedSeed = createSeed(variant.fixedKey, GOM_PASSWORD_SALT);
    const globalHeader = decryptFeedback(
      readExactly(handle, 256, variant.signature.length),
      variant.fixedKey,
      fixedSeed
    );
    const titleLength = globalHeader[1];
    const titleEnd = 2 + titleLength;
    if (titleEnd > globalHeader.length) throw new Error(`${variant.family} 全局标题无效`);
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
      throw new Error(
        `${variant.family} 全局头不受支持 (title=${title}, size=${headerSize}, version=${version}, index=${indexOffset})`
      );
    }
    if (slotCount > MAX_GOM_SLOTS) throw new Error(`${variant.family} 素材数量超限: ${slotCount}`);
    const indexSize = slotCount * 4;
    if (indexOffset + indexSize > fileSize) throw new Error(`${variant.family} 索引越界`);

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
        throw new Error(`${variant.family} 图片 ${logicalIndex} 的块偏移重复`);
      }
      if (headerOffset < indexEnd || headerOffset + 16 > fileSize) {
        throw new Error(`${variant.family} 图片 ${logicalIndex} 的块头越界`);
      }
      seenOffsets.add(headerOffset);
      entries.push({ logicalIndex, headerOffset });
    }

    entries.sort((left, right) => left.headerOffset - right.headerOffset);
    const blocks: PakBlock[] = [];
    for (const { logicalIndex, headerOffset } of entries) {
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
        throw new Error(`${variant.family} 图片 ${logicalIndex} 尺寸无效: ${width}x${height}`);
      }
      let rawSize: number;
      try {
        rawSize = parser.rawImageSize(imageType, flags, width, height);
        parser.formatName(imageType, flags);
      } catch (error) {
        throw new Error(`${variant.family} 图片 ${logicalIndex}: ${errorText(error)}`);
      }
      const payloadSize = compressedSize || rawSize;
      const payloadOffset = headerOffset + 16;
      if (payloadSize <= 0 || payloadOffset + payloadSize > fileSize) {
        throw new Error(`${variant.family} 图片 ${logicalIndex} 负载越界`);
      }
      if (compressedSize) {
        const zlibHeader = readExactly(handle, 2, payloadOffset);
        const cmf = zlibHeader[0];
        const flg = zlibHeader[1];
        if ((cmf & 0x0f) !== 8 || ((cmf << 8) + flg) % 31 !== 0) {
          throw new Error(`${variant.family} 图片 ${logicalIndex} 的 zlib 头无效`);
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
    }
    blocks.sort((left, right) => left.logicalIndex - right.logicalIndex);
    return { family: variant.family, slotCount, blocks };
  } catch (error) {
    if (/密码|password/i.test(errorText(error))) throw error;
    throw new Error(`密码错误，或 ${pathLabel(filePath)} 索引损坏: ${errorText(error)}`);
  } finally {
    fs.closeSync(handle);
  }
}

function createSeed(key: Buffer, salt: number): Buffer {
  const saltBlock = Buffer.alloc(8, salt);
  return Buffer.concat([desEncryptBlock(key, saltBlock), Buffer.alloc(12, salt)]);
}

function decryptFeedback(data: Buffer, key: Buffer, seed: Buffer): Buffer {
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
    if (bytesRead <= 0) throw new Error(`GAMEOFMIR 文件数据提前结束: ${position}+${length}`);
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
