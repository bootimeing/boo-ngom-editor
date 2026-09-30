import * as crypto from 'crypto';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import * as zlib from 'zlib';
import { ArchiveStructureError, ArchiveDiagnostic, isArchiveZlibDataError } from './archive-errors';

const CLASSIC_TITLE = 'GameLib';
const M2_TITLE_PATTERN = /^996M2 GameLib \d{4}\/\d{2}\/\d{2}$/;
const GLOBAL_HEADER_SIZE = 80;
const IMAGE_HEADER_SIZE = 20;
const MAX_SLOTS = 999_999;
const MAX_DIMENSION = 0x1000;

export class JpkFormatError extends ArchiveStructureError {
  constructor(message: string, diagnostic: Partial<ArchiveDiagnostic> = {}) {
    super(message, { family: 'JPK', stage: 'unknown', reasonCode: 'unknown', ...diagnostic });
    this.name = 'JpkFormatError';
  }
}

export class JpkPasswordError extends JpkFormatError {
  constructor() {
    super('JPK 密码错误，或文件不是支持的 996PC/XUW JPK', {
      stage: 'global-header', reasonCode: 'password-or-profile-mismatch', offset: 0, length: GLOBAL_HEADER_SIZE,
    });
    this.name = 'JpkPasswordError';
  }
}

export interface JpkBlock {
  logicalIndex: number;
  headerOffset: number;
  payloadOffset: number;
  payloadSize: number;
  compressedSize: number;
  rawSize: number;
  imageType: number;
  flags: number;
  storedType: number;
  bitsPerPixel: 8 | 16 | 24 | 32;
  compressed: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  alpha: boolean;
  format: string;
}

export interface ParsedJpkArchive {
  family: '996PC/XUW GameLib JPK';
  title: string;
  variant: 'GameLib' | '996M2';
  slotCount: number;
  indexOffset: number;
  trailerSize: number;
  timestamp: number;
  rc4State: Uint8Array;
  blocks: JpkBlock[];
  /** Indexed records whose entire header has been erased. IDs stay reserved. */
  skippedMalformedIndices: number[];
}

export function deriveJpkRc4State(password: string): Uint8Array {
  const passwordBytes = iconv.encode(password, 'cp936');
  const digest = crypto.createHash('sha1').update(passwordBytes).digest();
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < state.length; i++) {
    j = (j + state[i] + digest[i % digest.length]) & 0xff;
    const value = state[i];
    state[i] = state[j];
    state[j] = value;
  }
  return state;
}

export function rc4Crypt(data: Uint8Array, initialState: Uint8Array): Buffer {
  if (initialState.length !== 256 || new Set(initialState).size !== 256) {
    throw new JpkFormatError('JPK RC4 状态必须是 0..255 的完整置换', { stage: 'runtime', reasonCode: 'missing-runtime-data' });
  }
  const state = Uint8Array.from(initialState);
  const output = Buffer.allocUnsafe(data.length);
  let x = 0;
  let y = 0;
  for (let offset = 0; offset < data.length; offset++) {
    x = (x + 1) & 0xff;
    y = (y + state[x]) & 0xff;
    const value = state[x];
    state[x] = state[y];
    state[y] = value;
    output[offset] = data[offset] ^ state[(state[x] + state[y]) & 0xff];
  }
  return output;
}

export function parseJpkFile(filePath: string, password: string): ParsedJpkArchive {
  return parseJpkFileWithState(filePath, deriveJpkRc4State(password));
}

/** Host-only entry point for an already authenticated cached state. Never expose this state to a webview. */
export function parseJpkFileWithState(filePath: string, initialState: Uint8Array): ParsedJpkArchive {
  if (!(initialState instanceof Uint8Array) || initialState.length !== 256) {
    throw new JpkFormatError('JPK RC4 状态必须是 0..255 的完整置换', { stage: 'runtime', reasonCode: 'missing-runtime-data' });
  }
  const state = Uint8Array.from(initialState);
  // Validate the complete permutation before touching the input file.
  rc4Crypt(new Uint8Array(), state);
  const fileSize = fs.statSync(filePath).size;
  if (fileSize < GLOBAL_HEADER_SIZE) throw new JpkFormatError('JPK 文件不足 80 字节', { stage: 'global-header', reasonCode: 'truncated-data', offset: 0, length: GLOBAL_HEADER_SIZE });

  const handle = fs.openSync(filePath, 'r');
  try {
    const header = rc4Crypt(readExactly(handle, GLOBAL_HEADER_SIZE, 0), state);
    const titleLength = header[0];
    if (titleLength <= 0 || titleLength + 1 > 0x2c) throw new JpkPasswordError();
    const title = header.subarray(1, Math.min(1 + titleLength, header.length)).toString('ascii');
    const variant = title === CLASSIC_TITLE
      ? 'GameLib' as const
      : M2_TITLE_PATTERN.test(title)
        ? '996M2' as const
        : undefined;
    if (!variant) throw new JpkPasswordError();

    const headerSize = header.readUInt32LE(0x2c);
    const slotCount = header.readUInt32LE(0x30);
    const indexOffset = header.readUInt32LE(0x34);
    const timestamp = header.readDoubleLE(0x38);
    if (headerSize !== GLOBAL_HEADER_SIZE) {
      throw new JpkFormatError(`JPK 全局头长度异常: ${headerSize}`, { stage: 'global-header', reasonCode: 'unsupported-global-header', offset: 0, length: GLOBAL_HEADER_SIZE });
    }
    if (slotCount > MAX_SLOTS) {
      throw new JpkFormatError(`JPK 逻辑槽数量超限: ${slotCount}`, { stage: 'global-header', reasonCode: 'resource-limit' });
    }

    const indexSize = slotCount * 4;
    if (indexOffset < GLOBAL_HEADER_SIZE) {
      throw new JpkFormatError(`JPK 索引偏移无效: ${indexOffset}`, { stage: 'index', reasonCode: 'index-out-of-bounds', offset: indexOffset, length: indexSize });
    }
    const indexEnd = indexOffset + indexSize;
    if (indexEnd > fileSize) {
      throw new JpkFormatError(`JPK 索引边界异常: ${indexOffset}+${indexSize}>${fileSize}；文件可能不完整或索引已损坏`, { stage: 'index', reasonCode: 'index-truncated', offset: indexOffset, length: indexSize });
    }
    const trailerSize = fileSize - indexEnd;
    // The encrypted header owns the active index extent. Real GameLib archives
    // can retain an older index after it (Mon4013: 3364 bytes), or zero padding
    // followed by an index-offset word (Mon4024: 80 bytes). Those bytes are not
    // extra slots and have no mandatory leading sentinel. Never follow them.

    const index = readExactly(handle, indexSize, indexOffset);
    const blocks: JpkBlock[] = [];
    const skippedMalformedIndices: number[] = [];
    for (let logicalIndex = 0; logicalIndex < slotCount; logicalIndex++) {
      const blockOffset = index.readUInt32LE(logicalIndex * 4);
      if (blockOffset === 0) continue;
      if (blockOffset < GLOBAL_HEADER_SIZE || blockOffset + IMAGE_HEADER_SIZE > indexOffset) {
        throw new JpkFormatError(`JPK 图像 ${logicalIndex} 块头偏移越界: ${blockOffset}`, { stage: 'index', reasonCode: 'index-out-of-bounds', logicalIndex, offset: blockOffset, length: IMAGE_HEADER_SIZE });
      }

      const record = readExactly(handle, IMAGE_HEADER_SIZE, blockOffset);
      if (record.every(byte => byte === 0)) {
        skippedMalformedIndices.push(logicalIndex);
        continue;
      }
      const storedType = record[0];
      const compressed = record[1] !== 0;
      const width = record.readUInt16LE(2);
      const height = record.readUInt16LE(4);
      const x = record.readInt16LE(6);
      const y = record.readInt16LE(8);
      const storedSize = record.readUInt32LE(12);
      const bitsPerPixel = normalizeBitsPerPixel(storedType);
      const alpha = record[16] !== 0;
      const payloadOffset = blockOffset + IMAGE_HEADER_SIZE;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw new JpkFormatError(`JPK 图像 ${logicalIndex} 尺寸超限: ${width}x${height}`, { stage: 'image-header', reasonCode: 'resource-limit', logicalIndex, offset: blockOffset, length: IMAGE_HEADER_SIZE });
      }
      if (width <= 2 && height <= 2) {
        throw new JpkFormatError(`JPK 图像 ${logicalIndex} 尺寸无效: ${width}x${height}`, { stage: 'image-header', reasonCode: 'invalid-dimensions', logicalIndex, offset: blockOffset, length: IMAGE_HEADER_SIZE });
      }
      if (storedSize <= 0 || payloadOffset + storedSize > indexOffset) {
        throw new JpkFormatError(
          `JPK 图像 ${logicalIndex} 数据边界无效: ${payloadOffset}+${storedSize}>${indexOffset}`,
          { stage: 'image-header', reasonCode: 'payload-out-of-bounds', logicalIndex, offset: payloadOffset, length: storedSize }
        );
      }

      blocks.push({
        logicalIndex,
        headerOffset: blockOffset,
        payloadOffset,
        payloadSize: storedSize,
        compressedSize: compressed ? storedSize : 0,
        rawSize: rawImageSize(bitsPerPixel, width, height, alpha),
        imageType: bitsPerPixel,
        flags: alpha ? 1 : 0,
        storedType,
        bitsPerPixel,
        compressed,
        width,
        height,
        x,
        y,
        alpha,
        format: jpkFormatName(bitsPerPixel, alpha),
      });
    }

    return {
      family: '996PC/XUW GameLib JPK',
      title,
      variant,
      slotCount,
      indexOffset,
      trailerSize,
      timestamp,
      rc4State: state,
      blocks,
      skippedMalformedIndices,
    };
  } finally {
    fs.closeSync(handle);
  }
}

export function readJpkPayload(
  handle: number,
  block: JpkBlock,
  rc4State: Uint8Array
): Buffer {
  const ciphertext = readExactly(handle, block.payloadSize, block.payloadOffset);
  const plaintext = rc4Crypt(ciphertext, rc4State);
  let raw: Buffer;
  if (block.compressed) {
    let result: { buffer: Buffer; engine: { bytesWritten: number } };
    try {
      result = zlib.inflateSync(plaintext, { info: true, maxOutputLength: block.rawSize }) as unknown as {
        buffer: Buffer;
        engine: { bytesWritten: number };
      };
    } catch (error) {
      if (!isArchiveZlibDataError(error)) throw error;
      throw new JpkFormatError(
        `JPK 图像 ${block.logicalIndex} zlib 解压失败: ${errorText(error)}`,
        { stage: 'decompression', reasonCode: 'decompression-failed', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize }
      );
    }
    if (result.engine.bytesWritten !== plaintext.length) {
      throw new JpkFormatError(`JPK 图像 ${block.logicalIndex} zlib 流存在尾随数据`, { stage: 'decompression', reasonCode: 'trailing-compressed-data', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize });
    }
    raw = result.buffer;
  } else {
    raw = plaintext;
  }
  if (raw.length !== block.rawSize) {
    throw new JpkFormatError(
      `JPK 图像 ${block.logicalIndex} 解码长度 ${raw.length}，预期 ${block.rawSize}`,
      { stage: 'pixels', reasonCode: 'decoded-size-mismatch', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize }
    );
  }
  return raw;
}

export function renderJpkRgba(
  raw: Uint8Array,
  block: JpkBlock,
  paletteBgra: Uint8Array
): Uint8ClampedArray {
  if (raw.length !== block.rawSize) {
    throw new JpkFormatError(
      `JPK 图像 ${block.logicalIndex} 解码长度 ${raw.length}，预期 ${block.rawSize}`,
      { stage: 'pixels', reasonCode: 'decoded-size-mismatch', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize }
    );
  }
  if (block.bitsPerPixel === 8 && paletteBgra.length !== 256 * 4) {
    throw new JpkFormatError('JPK 8 位调色板长度无效', { stage: 'runtime', reasonCode: 'missing-runtime-data', logicalIndex: block.logicalIndex });
  }

  const { width, height } = block;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const colorStride = alignedStride(width, block.bitsPerPixel);
  const alphaOffset = colorStride * height;
  const alphaStride = alignedStride(width, 8);

  for (let y = 0; y < height; y++) {
    const sourceY = height - 1 - y;
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      let defaultAlpha = 255;
      if (block.bitsPerPixel === 8) {
        const palette = raw[sourceY * colorStride + x] * 4;
        rgba[target] = paletteBgra[palette + 2];
        rgba[target + 1] = paletteBgra[palette + 1];
        rgba[target + 2] = paletteBgra[palette];
        defaultAlpha = paletteBgra[palette + 3];
      } else if (block.bitsPerPixel === 16) {
        const source = sourceY * colorStride + x * 2;
        const value = raw[source] | (raw[source + 1] << 8);
        const r5 = (value >> 11) & 31;
        const g6 = (value >> 5) & 63;
        const b5 = value & 31;
        rgba[target] = (r5 << 3) | (r5 >> 2);
        rgba[target + 1] = (g6 << 2) | (g6 >> 4);
        rgba[target + 2] = (b5 << 3) | (b5 >> 2);
      } else if (block.bitsPerPixel === 24) {
        const source = sourceY * colorStride + x * 3;
        rgba[target] = raw[source + 2];
        rgba[target + 1] = raw[source + 1];
        rgba[target + 2] = raw[source];
      } else {
        const source = sourceY * colorStride + x * 4;
        rgba[target] = raw[source + 2];
        rgba[target + 1] = raw[source + 1];
        rgba[target + 2] = raw[source];
      }
      rgba[target + 3] = block.alpha
        ? raw[alphaOffset + sourceY * alphaStride + x]
        : defaultAlpha;
    }
  }
  return rgba;
}

export function alignedStride(width: number, bitsPerPixel: number): number {
  return ((width * bitsPerPixel + 31) >> 5) << 2;
}

function normalizeBitsPerPixel(storedType: number): 8 | 16 | 24 | 32 {
  return storedType === 16 || storedType === 24 || storedType === 32
    ? storedType
    : 8;
}

function rawImageSize(
  bitsPerPixel: 8 | 16 | 24 | 32,
  width: number,
  height: number,
  alpha: boolean
): number {
  let size = alignedStride(width, bitsPerPixel) * height;
  if (alpha) size += alignedStride(width, 8) * height;
  return size;
}

function jpkFormatName(bitsPerPixel: 8 | 16 | 24 | 32, alpha: boolean): string {
  if (bitsPerPixel === 8) return alpha ? 'JPK_INDEXED8_A8' : 'JPK_A8_PALETTE';
  if (bitsPerPixel === 16) return alpha ? 'JPK_R5G6B5_A8' : 'JPK_R5G6B5';
  if (bitsPerPixel === 24) return alpha ? 'JPK_R8G8B8_A8' : 'JPK_R8G8B8';
  return alpha ? 'JPK_A8R8G8B8' : 'JPK_X8R8G8B8';
}

function readExactly(handle: number, length: number, position: number): Buffer {
  const result = Buffer.allocUnsafe(length);
  let completed = 0;
  while (completed < length) {
    const bytesRead = fs.readSync(
      handle,
      result,
      completed,
      length - completed,
      position + completed
    );
    if (bytesRead <= 0) {
      throw new JpkFormatError(`JPK 数据提前结束: ${completed}/${length}`, { stage: 'source', reasonCode: 'truncated-data', offset: position, length });
    }
    completed += bytesRead;
  }
  return result;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
