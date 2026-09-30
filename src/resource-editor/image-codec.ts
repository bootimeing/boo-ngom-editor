import * as fs from 'fs';
import * as zlib from 'zlib';
import { crc32 } from '../utils/pak-reader';

export interface ImportedResourceImage { width: number; height: number; rgba: Uint8ClampedArray }
export function validateResourceImage(image: ImportedResourceImage): ImportedResourceImage {
  if (!image || !(image.rgba instanceof Uint8ClampedArray)) fail('INVALID_IMAGE');
  dimensions(image.width, image.height);
  if (image.rgba.byteLength !== image.width * image.height * 4) fail('INVALID_IMAGE');
  return image;
}
export class ResourceImageError extends Error {
  constructor(readonly code: string) { super(`图片导入失败（${code}）`); this.name = 'ResourceImageError'; }
}
const fail = (code: string): never => { throw new ResourceImageError(code); };
const MAX_FILE = 32 * 1024 * 1024;
function dimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > 4096 || height > 4096 || width * height > 4 * 1024 * 1024) fail('IMAGE_DIMENSIONS');
}
function paeth(a: number, b: number, c: number) {
  const p = a + b - c, x = Math.abs(p - a), y = Math.abs(p - b), z = Math.abs(p - c);
  return x <= y && x <= z ? a : y <= z ? b : c;
}

/** Explicit subset: non-interlaced, 8-bit PNG (all five standard color types), never APNG/16-bit. */
export function decodeResourcePng(png: Buffer): ImportedResourceImage {
  if (png.length > MAX_FILE || png.length < 45 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('INVALID_PNG');
  let at = 8, width = 0, height = 0, type = -1, ended = false, dataEnded = false;
  let palette: Buffer | undefined, transparency: Buffer | undefined;
  const chunks: Buffer[] = [];
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at), end = at + length + 12, name = png.toString('ascii', at + 4, at + 8);
    if (end > png.length || crc32(png.subarray(at + 4, end - 4)) !== png.readUInt32BE(end - 4)) fail('PNG_CHECKSUM');
    const data = png.subarray(at + 8, end - 4);
    if (at === 8) {
      if (name !== 'IHDR' || length !== 13) fail('INVALID_PNG');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); dimensions(width, height); type = data[9];
      if (data[8] !== 8 || ![0, 2, 3, 4, 6].includes(type) || data[10] || data[11] || data[12]) fail('UNSUPPORTED_PNG_LAYOUT');
    } else if (name === 'IHDR') fail('INVALID_PNG');
    else if (name === 'PLTE') {
      if (palette || chunks.length || !length || length > 768 || length % 3 || [0, 4].includes(type)) fail('INVALID_PNG_PALETTE');
      palette = data;
    } else if (name === 'tRNS') {
      if (transparency || chunks.length || [4, 6].includes(type)) fail('INVALID_PNG_TRANSPARENCY');
      if (type === 0 && (length !== 2 || data.readUInt16BE(0) > 255)
        || type === 2 && (length !== 6 || [0, 2, 4].some(i => data.readUInt16BE(i) > 255))
        || type === 3 && (!palette || !length || length > palette.length / 3)) fail('INVALID_PNG_TRANSPARENCY');
      transparency = data;
    } else if (name === 'IDAT') {
      if (dataEnded || type === 3 && !palette) fail('INVALID_PNG');
      chunks.push(data);
    } else if (name === 'IEND') {
      if (length || !chunks.length || end !== png.length) fail('INVALID_PNG');
      ended = true; break;
    } else {
      if (['acTL', 'fcTL', 'fdAT', 'eXIf', 'iCCP'].includes(name)) fail('UNSUPPORTED_PNG_METADATA');
      if ((png[at + 4] & 32) === 0) fail('UNSUPPORTED_PNG_CHUNK');
      if (chunks.length) dataEnded = true;
    }
    at = end;
  }
  if (!ended) fail('INVALID_PNG');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  const stride = width * channels, expected = (stride + 1) * height, compressed = Buffer.concat(chunks);
  let raw: Buffer;
  try {
    const inflated = zlib.inflateSync(compressed, { info: true, maxOutputLength: expected }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    if (inflated.buffer.length !== expected || inflated.engine.bytesWritten !== compressed.length) fail('PNG_DECODE_SIZE');
    raw = inflated.buffer;
  } catch { return fail('PNG_DECOMPRESSION'); }
  const pixels = Buffer.alloc(stride * height), rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) fail('PNG_FILTER');
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const upperLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const delta = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, upperLeft);
      pixels[y * stride + x] = (raw[y * (stride + 1) + x + 1] + delta) & 255;
    }
  }
  for (let i = 0; i < width * height; i++) {
    const p = i * channels, q = i * 4; let r: number, g: number, b: number, a = 255;
    if (type === 3) {
      const entry = pixels[p]; if (entry * 3 + 2 >= palette!.length) fail('PNG_PALETTE_INDEX');
      r = palette![entry * 3]; g = palette![entry * 3 + 1]; b = palette![entry * 3 + 2]; a = transparency?.[entry] ?? 255;
    } else if (type === 0 || type === 4) {
      r = g = b = pixels[p];
      a = type === 4 ? pixels[p + 1] : transparency && r === transparency.readUInt16BE(0) ? 0 : 255;
    } else {
      r = pixels[p]; g = pixels[p + 1]; b = pixels[p + 2];
      a = type === 6 ? pixels[p + 3] : transparency && r === transparency.readUInt16BE(0)
        && g === transparency.readUInt16BE(2) && b === transparency.readUInt16BE(4) ? 0 : 255;
    }
    rgba.set([r, g, b, a], q);
  }
  return { width, height, rgba };
}

/** Strict BITMAPINFOHEADER BI_RGB: 24-bit or opaque 32-bit BGRX, top-down or bottom-up. */
export function decodeResourceBmp(bmp: Buffer): ImportedResourceImage {
  if (bmp.length > MAX_FILE || bmp.length < 54 || bmp.toString('ascii', 0, 2) !== 'BM') fail('INVALID_BMP');
  const width = bmp.readInt32LE(18), signedHeight = bmp.readInt32LE(22), height = Math.abs(signedHeight);
  dimensions(width, height);
  const depth = bmp.readUInt16LE(28), offset = bmp.readUInt32LE(10), stride = ((width * depth + 31) >> 5) * 4;
  if (bmp.readUInt32LE(14) !== 40 || bmp.readUInt16LE(26) !== 1 || ![24, 32].includes(depth)
    || bmp.readUInt32LE(30) !== 0 || offset !== 54 || bmp.readUInt32LE(2) !== bmp.length
    || offset + stride * height !== bmp.length) fail('UNSUPPORTED_BMP_LAYOUT');
  const declared = bmp.readUInt32LE(34);
  if (declared !== 0 && declared !== stride * height) fail('INVALID_BMP');
  const rgba = new Uint8ClampedArray(width * height * 4);
  let unusedByte: number | undefined;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const source = offset + (signedHeight < 0 ? y : height - 1 - y) * stride + x * (depth / 8);
    if (depth === 32) {
      const value = bmp[source + 3];
      if (![0, 255].includes(value) || unusedByte !== undefined && value !== unusedByte) fail('UNSUPPORTED_BMP_ALPHA');
      unusedByte = value;
    }
    rgba.set([bmp[source + 2], bmp[source + 1], bmp[source], 255], (y * width + x) * 4);
  }
  return { width, height, rgba };
}

export function readResourceImage(file: string): ImportedResourceImage {
  const handle = fs.openSync(file, 'r');
  try {
    const before = fs.fstatSync(handle);
    if (!before.isFile() || before.size > MAX_FILE) fail('IMAGE_SIZE_LIMIT');
    const bytes = Buffer.alloc(before.size); let completed = 0;
    while (completed < bytes.length) {
      const count = fs.readSync(handle, bytes, completed, bytes.length - completed, completed);
      if (!count) fail('IMAGE_CHANGED'); completed += count;
    }
    const after = fs.fstatSync(handle);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('IMAGE_CHANGED');
    if (bytes[0] === 137) return decodeResourcePng(bytes);
    if (bytes.toString('ascii', 0, 2) === 'BM') return decodeResourceBmp(bytes);
    return fail('UNSUPPORTED_IMAGE_FORMAT');
  } finally { fs.closeSync(handle); }
}
