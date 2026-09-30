import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { encodePng, crc32, PakBlock } from './pak-reader';
import { ArchiveStructureError, isArchiveZlibDataError } from './archive-errors';
import { ArchiveRejectedSlot, rejectedSlot } from './archive-types';

const WIL_HEADER_SIZE = 56;
const WIL_FRAME_HEADER_SIZE = 8;
const WZL_FRAME_HEADER_SIZE = 16;
const INDEX_HEADER_SIZE = 48;
const MAX_IMAGE_DIMENSION = 16384;
const MAX_IMAGE_BYTES = 128 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface ParsedWilWzlArchive {
  format: 'WIL' | 'WZL';
  companionPath: string;
  slotCount: number;
  blocks: PakBlock[];
  /** Nonzero indexed records that cannot be read; never silently turn them into empty slots. */
  rejectedSlots: ArchiveRejectedSlot[];
  wilColorCount?: number;
  wilPaletteBgra?: string;
}

export interface WilWzlImageMetadata {
  format: 'WIL' | 'WZL';
  wilPaletteBgra?: string;
}

export function parseWilWzlArchive(dataPath: string): ParsedWilWzlArchive {
  const resolvedPath = path.resolve(dataPath);
  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension !== '.wil' && extension !== '.wzl') {
    throw new ArchiveStructureError(`不是 WIL/WZL 素材文件: ${path.basename(resolvedPath)}`, { stage: 'global-header', reasonCode: 'unsupported-global-header' });
  }
  const format = extension === '.wil' ? 'WIL' : 'WZL';
  const companionPath = resolveWilWzlCompanionPath(resolvedPath);
  return format === 'WIL'
    ? parseWilArchive(resolvedPath, companionPath)
    : parseWzlArchive(resolvedPath, companionPath);
}

export function resolveWilWzlCompanionPath(dataPath: string): string {
  const resolvedPath = path.resolve(dataPath);
  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension !== '.wil' && extension !== '.wzl') {
    throw new ArchiveStructureError(`不是 WIL/WZL 素材文件: ${path.basename(resolvedPath)}`, { stage: 'global-header', reasonCode: 'unsupported-global-header' });
  }
  return findCompanionFile(
    resolvedPath,
    extension === '.wil' ? '.wix' : '.wzx'
  );
}

export function readWilWzlImagePng(
  handle: number,
  block: PakBlock,
  metadata: WilWzlImageMetadata,
  defaultPaletteBgra: Uint8Array
): Buffer {
  if (!validDimensions(block.width, block.height) || block.width * block.height * 4 > MAX_IMAGE_BYTES
    || !Number.isSafeInteger(block.payloadSize) || block.payloadSize < 1 || block.payloadSize > MAX_IMAGE_BYTES) {
    throw new ArchiveStructureError('WIL/WZL 图片尺寸或负载超限', { family: metadata.format, stage: 'image-header', reasonCode: 'resource-limit', logicalIndex: block.logicalIndex });
  }
  const payload = readExactly(handle, block.payloadSize, block.payloadOffset);
  if (metadata.format === 'WZL' && block.imageType === 8) {
    validateEmbeddedPng(payload, block);
    return payload;
  }

  let raw: Buffer;
  if (block.compressedSize > 0) {
    const maximumSize = expectedWzlRawSize(block.imageType, block.flags, block.width, block.height);
    if (!maximumSize) throw new ArchiveStructureError(`不支持的 WIL/WZL 图片类型: ${block.imageType}`, { family: metadata.format, stage: 'pixels', reasonCode: 'unsupported-image-layout', logicalIndex: block.logicalIndex });
    try {
      const decoded = zlib.inflateSync(payload, { maxOutputLength: maximumSize, info: true }) as unknown as {
        buffer: Buffer; engine: { bytesWritten: number };
      };
      if (decoded.engine.bytesWritten !== payload.length) throw new ArchiveStructureError('WZL 压缩流存在尾随数据', { family: 'WZL', stage: 'decompression', reasonCode: 'trailing-compressed-data', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize });
      raw = decoded.buffer;
    } catch (error) {
      if (!isArchiveZlibDataError(error)) throw error;
      throw new ArchiveStructureError(
        `WZL 图片 ${block.logicalIndex} 解压失败: ${errorText(error)}`,
        { family: 'WZL', stage: 'decompression', reasonCode: 'decompression-failed', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize }
      );
    }
  } else {
    raw = payload;
  }

  const palette = metadata.format === 'WIL' && metadata.wilPaletteBgra
    ? Buffer.from(metadata.wilPaletteBgra, 'base64')
    : defaultPaletteBgra;
  const rgba = renderWilWzlRgba(raw, block, palette);
  return encodePng(block.width, block.height, rgba);
}

function parseWilArchive(
  wilPath: string,
  wixPath: string
): ParsedWilWzlArchive {
  const wilStat = fs.statSync(wilPath);
  const header = readFileRange(wilPath, 0, WIL_HEADER_SIZE);
  const index = fs.readFileSync(wixPath);
  if (index.length < INDEX_HEADER_SIZE) {
    throw new ArchiveStructureError(`${path.basename(wixPath)} 的 WIX 文件头不完整`, { family: 'WIL', stage: 'index', reasonCode: 'index-truncated', offset: 0, length: INDEX_HEADER_SIZE });
  }

  const wilCount = header.readUInt32LE(44);
  const wixCount = index.readUInt32LE(44);
  if (wilCount !== wixCount) {
    throw new ArchiveStructureError(
      `${path.basename(wilPath)} 与 ${path.basename(wixPath)} 的图片数量不一致 (${wilCount}/${wixCount})`,
      { family: 'WIL', stage: 'index', reasonCode: 'index-out-of-bounds', offset: 44, length: 4 }
    );
  }
  validateIndexTable(index, wixCount, 'WIX');

  const colorCount = header.readUInt32LE(48);
  const imageType = wilImageType(colorCount);
  const bytesPerPixel = wilBytesPerPixel(colorCount);
  const paletteSize = header.readUInt32LE(52);
  let paletteBgra: string | undefined;
  if (imageType === 3) {
    if (paletteSize < 1024 || WIL_HEADER_SIZE + 1024 > wilStat.size) {
      throw new ArchiveStructureError(`${path.basename(wilPath)} 的 256 色调色板不完整`, { family: 'WIL', stage: 'global-header', reasonCode: 'truncated-data', offset: WIL_HEADER_SIZE, length: 1024 });
    }
    const palette = readFileRange(wilPath, WIL_HEADER_SIZE, 1024);
    paletteBgra = normalizePaletteAlpha(palette).toString('base64');
  }

  const offsets = readOffsets(index, wixCount);
  const imageDataStart = WIL_HEADER_SIZE + (imageType === 3 ? 1024 : 0);
  const nextOffsets = buildNextOffsetMap(
    offsets.filter(offset => offset >= imageDataStart && offset < wilStat.size),
    wilStat.size
  );
  const blocks: PakBlock[] = [];
  const rejectedSlots: ArchiveRejectedSlot[] = [];
  const handle = fs.openSync(wilPath, 'r');
  try {
    const frameHeader = Buffer.allocUnsafe(WIL_FRAME_HEADER_SIZE);
    for (let logicalIndex = 0; logicalIndex < offsets.length; logicalIndex++) {
      const frameOffset = offsets[logicalIndex];
      if (frameOffset === 0) continue;
      if (
        frameOffset < imageDataStart
        || frameOffset + WIL_FRAME_HEADER_SIZE > wilStat.size
      ) {
        rejectedSlots.push(rejectedSlot(logicalIndex, 'index-out-of-bounds'));
        continue;
      }
      const nextOffset = nextOffsets.get(frameOffset) || wilStat.size;
      if (frameOffset + WIL_FRAME_HEADER_SIZE > nextOffset) {
        rejectedSlots.push(rejectedSlot(logicalIndex, 'overlapping-blocks'));
        continue;
      }
      readInto(handle, frameHeader, frameOffset);
      const width = frameHeader.readUInt16LE(0);
      const height = frameHeader.readUInt16LE(2);
      if (!validDimensions(width, height)) {
        rejectedSlots.push(rejectedSlot(logicalIndex, 'invalid-dimensions'));
        continue;
      }
      const tightSize = checkedImageBytes(width, height, bytesPerPixel);
      const alignedSize = align4(width * bytesPerPixel) * height;
      const payloadOffset = frameOffset + WIL_FRAME_HEADER_SIZE;
      const available = Math.max(0, nextOffset - payloadOffset);
      if (available < tightSize) {
        rejectedSlots.push(rejectedSlot(logicalIndex, 'payload-out-of-bounds'));
        continue;
      }
      const payloadSize = alignedSize !== tightSize && available === alignedSize
        ? alignedSize
        : tightSize;
      blocks.push({
        logicalIndex,
        payloadOffset,
        payloadSize,
        compressedSize: 0,
        rawSize: payloadSize,
        imageType,
        flags: payloadSize === alignedSize ? 1 : 0,
        width,
        height,
        x: frameHeader.readInt16LE(4),
        y: frameHeader.readInt16LE(6),
        format: `WIL-${colorCount}`,
      });
    }
  } finally {
    fs.closeSync(handle);
  }

  return {
    format: 'WIL',
    companionPath: wixPath,
    slotCount: wixCount,
    blocks,
    rejectedSlots,
    wilColorCount: colorCount,
    wilPaletteBgra: paletteBgra,
  };
}

function parseWzlArchive(
  wzlPath: string,
  wzxPath: string
): ParsedWilWzlArchive {
  const wzlStat = fs.statSync(wzlPath);
  const index = fs.readFileSync(wzxPath);
  if (index.length < INDEX_HEADER_SIZE) {
    throw new ArchiveStructureError(`${path.basename(wzxPath)} 的 WZX 文件头不完整`, { family: 'WZL', stage: 'index', reasonCode: 'index-truncated', offset: 0, length: INDEX_HEADER_SIZE });
  }
  const slotCount = index.readUInt32LE(44);
  validateIndexTable(index, slotCount, 'WZX');
  const offsets = readOffsets(index, slotCount);
  const validOffsets = offsets.filter(
    offset => offset > 0 && offset < wzlStat.size
  );
  const nextOffsets = buildNextOffsetMap(validOffsets, wzlStat.size);
  const blocks: PakBlock[] = [];
  const rejectedSlots: ArchiveRejectedSlot[] = [];
  const handle = fs.openSync(wzlPath, 'r');
  try {
    const frameHeader = Buffer.allocUnsafe(WZL_FRAME_HEADER_SIZE);
    for (let logicalIndex = 0; logicalIndex < offsets.length; logicalIndex++) {
      const frameOffset = offsets[logicalIndex];
      if (frameOffset === 0) continue;
      if (
        frameOffset + WZL_FRAME_HEADER_SIZE > wzlStat.size
      ) {
        rejectedSlots.push(rejectedSlot(logicalIndex, 'index-out-of-bounds'));
        continue;
      }
      readInto(handle, frameHeader, frameOffset);
      // Complete zero WZL records are an explicit blank sentinel, including
      // the common shared-offset form. Do not require aliases to recognize it.
      if (frameHeader.every(byte => byte === 0)) continue;
      const nextOffset = nextOffsets.get(frameOffset) || wzlStat.size;
      if (frameOffset + WZL_FRAME_HEADER_SIZE > nextOffset) {
        rejectedSlots.push(rejectedSlot(logicalIndex, 'overlapping-blocks'));
        continue;
      }
      const packedType = frameHeader.readUInt16LE(0);
      const imageType = packedType & 0xff;
      const flags = packedType >>> 8;
      const width = frameHeader.readUInt16LE(4);
      const height = frameHeader.readUInt16LE(6);
      if (!validDimensions(width, height)) {
        rejectedSlots.push(rejectedSlot(logicalIndex, 'invalid-dimensions'));
        continue;
      }
      if (imageType !== 3 && imageType !== 5 && imageType !== 6 && imageType !== 8) {
        rejectedSlots.push(rejectedSlot(logicalIndex, 'unsupported-image-layout'));
        continue;
      }

      const payloadOffset = frameOffset + WZL_FRAME_HEADER_SIZE;
      const storedSize = frameHeader.readUInt32LE(12);
      let payloadSize = storedSize;
      let compressedSize = storedSize;
      let rawSize = expectedWzlRawSize(imageType, flags, width, height);
      if (storedSize > 0 && payloadOffset + storedSize > wzlStat.size) {
        rejectedSlots.push(rejectedSlot(logicalIndex, 'payload-out-of-bounds'));
        continue;
      }
      if (storedSize > 0 && payloadOffset + storedSize > nextOffset) {
        rejectedSlots.push(rejectedSlot(logicalIndex, 'overlapping-blocks'));
        continue;
      }
      if (imageType === 8) {
        compressedSize = 0;
        rawSize = storedSize;
        if (
          storedSize < PNG_SIGNATURE.length
          || !readFileRange(wzlPath, payloadOffset, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
        ) {
          rejectedSlots.push(rejectedSlot(logicalIndex, 'invalid-image-block'));
          continue;
        }
      } else if (storedSize === 0) {
        compressedSize = 0;
        const available = Math.max(0, nextOffset - payloadOffset);
        payloadSize = chooseRawPayloadSize(imageType, flags, width, height, available);
        rawSize = payloadSize;
        if (payloadSize <= 0) {
          rejectedSlots.push(rejectedSlot(logicalIndex, 'payload-out-of-bounds'));
          continue;
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
        x: frameHeader.readInt16LE(8),
        y: frameHeader.readInt16LE(10),
        format: `WZL-0x${packedType.toString(16).padStart(4, '0')}`,
      });
    }
  } finally {
    fs.closeSync(handle);
  }

  return {
    format: 'WZL',
    companionPath: wzxPath,
    slotCount,
    blocks,
    rejectedSlots,
  };
}

function renderWilWzlRgba(
  raw: Uint8Array,
  block: PakBlock,
  paletteBgra: Uint8Array
): Uint8ClampedArray {
  const { width, height } = block;
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (block.imageType === 3) {
    if (paletteBgra.length < 1024) throw new ArchiveStructureError('WIL/WZL 调色板长度不足', { stage: 'runtime', reasonCode: 'missing-runtime-data', logicalIndex: block.logicalIndex });
    const stride = resolveStride(raw.length, width, height);
    for (let y = 0; y < height; y++) {
      const sourceY = height - 1 - y;
      for (let x = 0; x < width; x++) {
        const paletteIndex = raw[sourceY * stride + x];
        const paletteOffset = paletteIndex * 4;
        const target = (y * width + x) * 4;
        const blue = paletteBgra[paletteOffset];
        const green = paletteBgra[paletteOffset + 1];
        const red = paletteBgra[paletteOffset + 2];
        rgba[target] = red;
        rgba[target + 1] = green;
        rgba[target + 2] = blue;
        rgba[target + 3] = (red | green | blue) === 0
          ? 0
          : (paletteBgra[paletteOffset + 3] || 255);
      }
    }
    return rgba;
  }

  if (block.imageType === 5) {
    const hasNibbleAlpha = block.flags === 9;
    const alphaStride = Math.ceil(width / 2);
    const alphaBytes = hasNibbleAlpha ? alphaStride * height : 0;
    if (raw.length < alphaBytes) throw new ArchiveStructureError('WZL Alpha 平面长度不足', { family: 'WZL', stage: 'pixels', reasonCode: 'decoded-size-mismatch', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize });
    const colorBytes = raw.length - alphaBytes;
    const colorStride = resolveStride(colorBytes, width * 2, height);
    const alphaOffset = colorBytes;
    for (let y = 0; y < height; y++) {
      const sourceY = height - 1 - y;
      for (let x = 0; x < width; x++) {
        const source = sourceY * colorStride + x * 2;
        const value = raw[source] | (raw[source + 1] << 8);
        const red5 = (value >>> 11) & 31;
        const green6 = (value >>> 5) & 63;
        const blue5 = value & 31;
        const target = (y * width + x) * 4;
        rgba[target] = (red5 << 3) | (red5 >>> 2);
        rgba[target + 1] = (green6 << 2) | (green6 >>> 4);
        rgba[target + 2] = (blue5 << 3) | (blue5 >>> 2);
        if (hasNibbleAlpha) {
          const alphaByte = raw[
            alphaOffset + sourceY * alphaStride + Math.floor(x / 2)
          ];
          const nibble = x % 2 === 0 ? alphaByte >>> 4 : alphaByte & 0x0f;
          rgba[target + 3] = nibble * 17;
        } else {
          rgba[target + 3] = value === 0 ? 0 : 255;
        }
      }
    }
    return rgba;
  }

  if (block.imageType === 6) {
    const stride = resolveStride(raw.length, width * 3, height);
    for (let y = 0; y < height; y++) {
      const sourceY = height - 1 - y;
      for (let x = 0; x < width; x++) {
        const source = sourceY * stride + x * 3;
        const target = (y * width + x) * 4;
        const blue = raw[source];
        const green = raw[source + 1];
        const red = raw[source + 2];
        rgba[target] = red;
        rgba[target + 1] = green;
        rgba[target + 2] = blue;
        rgba[target + 3] = (red | green | blue) === 0 ? 0 : 255;
      }
    }
    return rgba;
  }

  throw new ArchiveStructureError(`不支持的 WIL/WZL 图片类型: ${block.imageType}`, { stage: 'pixels', reasonCode: 'unsupported-image-layout', logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize });
}

function findCompanionFile(dataPath: string, extension: '.wix' | '.wzx'): string {
  const directory = path.dirname(dataPath);
  const expectedName = `${path.basename(dataPath, path.extname(dataPath))}${extension}`;
  const match = fs.readdirSync(directory, { withFileTypes: true }).find(entry =>
    entry.isFile() && entry.name.toLowerCase() === expectedName.toLowerCase()
  );
  if (!match) {
    throw new ArchiveStructureError(
      `${path.basename(dataPath)} 缺少配套索引文件 ${expectedName}`,
      { family: extension === '.wix' ? 'WIL' : 'WZL', stage: 'source', reasonCode: 'missing-runtime-data' }
    );
  }
  return path.join(directory, match.name);
}

function validateIndexTable(
  index: Buffer,
  count: number,
  label: 'WIX' | 'WZX'
): void {
  if (!Number.isInteger(count) || count < 0) {
    throw new ArchiveStructureError(`${label} 图片数量无效`, { family: label === 'WIX' ? 'WIL' : 'WZL', stage: 'index', reasonCode: 'index-out-of-bounds', offset: 44, length: 4 });
  }
  const expectedLength = INDEX_HEADER_SIZE + count * 4;
  if (expectedLength > index.length) {
    throw new ArchiveStructureError(
      `${label} 索引表不完整: ${index.length}/${expectedLength} 字节`,
      { family: label === 'WIX' ? 'WIL' : 'WZL', stage: 'index', reasonCode: 'index-truncated', offset: INDEX_HEADER_SIZE, length: count * 4 }
    );
  }
}

function readOffsets(index: Buffer, count: number): number[] {
  const offsets = new Array<number>(count);
  for (let logicalIndex = 0; logicalIndex < count; logicalIndex++) {
    offsets[logicalIndex] = index.readUInt32LE(INDEX_HEADER_SIZE + logicalIndex * 4);
  }
  return offsets;
}

function buildNextOffsetMap(offsets: number[], fileSize: number): Map<number, number> {
  const unique = [...new Set(offsets)].sort((left, right) => left - right);
  const result = new Map<number, number>();
  for (let index = 0; index < unique.length; index++) {
    result.set(unique[index], unique[index + 1] || fileSize);
  }
  return result;
}

function wilImageType(colorCount: number): number {
  if (colorCount === 256) return 3;
  if (colorCount === 65536) return 5;
  if (colorCount === 16777216) return 6;
  throw new ArchiveStructureError(`不支持的 WIL 色深标记: ${colorCount}`, { family: 'WIL', stage: 'global-header', reasonCode: 'unsupported-image-layout', offset: 48, length: 4 });
}

function wilBytesPerPixel(colorCount: number): number {
  if (colorCount === 256) return 1;
  if (colorCount === 65536) return 2;
  if (colorCount === 16777216) return 3;
  throw new ArchiveStructureError(`不支持的 WIL 色深标记: ${colorCount}`, { family: 'WIL', stage: 'global-header', reasonCode: 'unsupported-image-layout', offset: 48, length: 4 });
}

function expectedWzlRawSize(
  imageType: number,
  flags: number,
  width: number,
  height: number
): number {
  if (imageType === 3) return align4(width) * height;
  if (imageType === 5) {
    const colorBytes = align4(width * 2) * height;
    return flags === 9 ? colorBytes + Math.ceil(width / 2) * height : colorBytes;
  }
  if (imageType === 6) return align4(width * 3) * height;
  return 0;
}

function chooseRawPayloadSize(
  imageType: number,
  flags: number,
  width: number,
  height: number,
  available: number
): number {
  const candidates: number[] = [];
  if (imageType === 3) {
    candidates.push(width * height, align4(width) * height);
  } else if (imageType === 5) {
    const alphaBytes = flags === 9 ? Math.ceil(width / 2) * height : 0;
    candidates.push(
      width * height * 2 + alphaBytes,
      align4(width * 2) * height + alphaBytes
    );
  } else if (imageType === 6) {
    candidates.push(width * height * 3, align4(width * 3) * height);
  }
  const unique = [...new Set(candidates)].sort((left, right) => right - left);
  return unique.find(size => size > 0 && size <= available) || 0;
}

function normalizePaletteAlpha(palette: Buffer): Buffer {
  const result = Buffer.from(palette);
  for (let index = 0; index < 256; index++) {
    const offset = index * 4;
    const isBlack = (result[offset] | result[offset + 1] | result[offset + 2]) === 0;
    result[offset + 3] = isBlack ? 0 : 255;
  }
  return result;
}

function validateEmbeddedPng(payload: Buffer, block: PakBlock): void {
  const fail = (message: string, reasonCode: 'invalid-image-block' | 'unsupported-image-layout'
    | 'invalid-dimensions' | 'decompression-failed' | 'resource-limit' = 'invalid-image-block') =>
    new ArchiveStructureError(message, { family: 'WZL', stage: reasonCode === 'decompression-failed' ? 'decompression' : 'pixels', reasonCode,
      logicalIndex: block.logicalIndex, offset: block.payloadOffset, length: block.payloadSize });
  if (
    payload.length < 45
    || !payload.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    throw fail(`WZL 图片 ${block.logicalIndex} 的内嵌 PNG 无效`);
  }
  const idat: Buffer[] = [];
  let header: Buffer | undefined, ended = false, hasPalette = false, idatEnded = false;
  for (let at = PNG_SIGNATURE.length; at < payload.length;) {
    if (payload.length - at < 12) throw fail('WZL PNG 块头或校验值截断');
    const length = payload.readUInt32BE(at), end = at + 12 + length;
    if (end > payload.length) throw fail('WZL PNG 块数据越界');
    const type = payload.toString('ascii', at + 4, at + 8);
    if (!/^[A-Za-z]{4}$/.test(type)
      || crc32(payload.subarray(at + 4, at + 8 + length)) !== payload.readUInt32BE(at + 8 + length)) {
      throw fail('WZL PNG 块类型或 CRC 无效');
    }
    const data = payload.subarray(at + 8, at + 8 + length);
    if (!header && type !== 'IHDR') throw fail('WZL PNG 缺少首个 IHDR');
    if (type === 'IHDR') {
      if (header || length !== 13) throw fail('WZL PNG IHDR 无效或重复');
      header = data;
    } else if (type === 'PLTE') {
      if (hasPalette || idat.length || !length || length > 768 || length % 3) throw fail('WZL PNG 调色板无效');
      hasPalette = true;
    } else if (type === 'IDAT') {
      if (idatEnded) throw fail('WZL PNG IDAT 不连续');
      idat.push(data);
    } else {
      if (idat.length) idatEnded = true;
      if (type === 'IEND') {
        if (length || !idat.length || end !== payload.length) throw fail('WZL PNG 结尾无效或带尾随数据');
        ended = true;
      } else if ((payload[at + 4] & 32) === 0) throw fail('WZL PNG 包含不支持的关键块', 'unsupported-image-layout');
    }
    at = end;
  }
  if (!header || !ended) throw fail('WZL PNG 缺少完整 IHDR/IDAT/IEND');
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4);
  if (width !== block.width || height !== block.height) throw fail(
    `WZL 图片 ${block.logicalIndex} 的 PNG 尺寸不一致 (${width}x${height}/${block.width}x${block.height})`, 'invalid-dimensions');
  const depth = header[8], color = header[9], interlace = header[12];
  const channels = color === 0 || color === 3 ? 1 : color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : 0;
  const depths = color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
  if (!channels || !depths.includes(depth) || header[10] || header[11] || interlace > 1 || (color === 3 && !hasPalette)) {
    throw fail('WZL PNG 色深、颜色或交错布局无效', 'unsupported-image-layout');
  }
  // Standard PNG scanline sizes, including all seven Adam7 passes. Bound the
  // stream independently of caller metadata; do not trust a forged rawSize.
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
    [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows: { bytes: number; count: number }[] = [];
  let expected = 0;
  for (const [x, y, stepX, stepY] of passes) {
    const w = width > x ? Math.ceil((width - x) / stepX) : 0;
    const h = height > y ? Math.ceil((height - y) / stepY) : 0;
    if (!w || !h) continue;
    const bytes = Math.ceil(w * channels * depth / 8) + 1;
    rows.push({ bytes, count: h }); expected += bytes * h;
  }
  if (!expected || expected > MAX_IMAGE_BYTES) throw fail('WZL PNG 解压大小超限', 'resource-limit');
  const compressed = Buffer.concat(idat);
  let raw: Buffer;
  try {
    const decoded = zlib.inflateSync(compressed, { maxOutputLength: expected, info: true }) as unknown as {
      buffer: Buffer; engine: { bytesWritten: number };
    };
    if (decoded.engine.bytesWritten !== compressed.length || decoded.buffer.length !== expected) throw fail('WZL PNG IDAT 长度不匹配', 'decompression-failed');
    raw = decoded.buffer;
  } catch (error) {
    if (!isArchiveZlibDataError(error)) throw error;
    throw fail('WZL PNG IDAT 解压失败', 'decompression-failed');
  }
  let at = 0;
  for (const row of rows) for (let n = 0; n < row.count; n++, at += row.bytes) {
    if (raw[at] > 4) throw fail('WZL PNG 扫描行过滤器无效');
  }
}

function resolveStride(rawLength: number, rowBytes: number, height: number): number {
  const aligned = align4(rowBytes);
  if (rawLength === rowBytes * height) return rowBytes;
  if (rawLength === aligned * height) return aligned;
  if (height > 0 && rawLength % height === 0 && rawLength / height >= rowBytes) {
    return rawLength / height;
  }
  throw new ArchiveStructureError(
    `WIL/WZL 图片数据长度无效: ${rawLength}，行宽至少 ${rowBytes}，高度 ${height}`,
    { stage: 'pixels', reasonCode: 'decoded-size-mismatch' }
  );
}

function checkedImageBytes(width: number, height: number, bytesPerPixel: number): number {
  const value = width * height * bytesPerPixel;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ArchiveStructureError(`WIL 图片尺寸过大: ${width}x${height}`, { family: 'WIL', stage: 'image-header', reasonCode: 'resource-limit' });
  }
  return value;
}

function validDimensions(width: number, height: number): boolean {
  return width > 0
    && height > 0
    && width <= MAX_IMAGE_DIMENSION
    && height <= MAX_IMAGE_DIMENSION;
}

function readFileRange(filePath: string, position: number, length: number): Buffer {
  const handle = fs.openSync(filePath, 'r');
  try {
    return readExactly(handle, length, position);
  } finally {
    fs.closeSync(handle);
  }
}

function readInto(handle: number, target: Buffer, position: number): void {
  let completed = 0;
  while (completed < target.length) {
    const bytesRead = fs.readSync(
      handle,
      target,
      completed,
      target.length - completed,
      position + completed
    );
    if (bytesRead <= 0) {
      throw new ArchiveStructureError(`素材数据提前结束: ${completed}/${target.length}`, { stage: 'source', reasonCode: 'truncated-data', offset: position, length: target.length });
    }
    completed += bytesRead;
  }
}

function readExactly(handle: number, length: number, position: number): Buffer {
  const result = Buffer.allocUnsafe(length);
  if (length > 0) readInto(handle, result, position);
  return result;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
