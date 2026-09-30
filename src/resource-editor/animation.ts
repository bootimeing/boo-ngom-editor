import { encodePng, crc32 } from '../utils/pak-reader';
import { ImportedResourceImage, validateResourceImage } from './image-codec';
export interface AnimationFrame { image: ImportedResourceImage; x: number; y: number }
export function animationBounds(frames: AnimationFrame[]) {
  if (!frames.length || frames.length > 256) throw new Error('BATCH_LIMIT');
  let left = 0, top = 0, right = 1, bottom = 1, bytes = 0;
  for (const frame of frames) {
    validateResourceImage(frame.image);
    if (!Number.isInteger(frame.x) || !Number.isInteger(frame.y) || Math.abs(frame.x) > 32768 || Math.abs(frame.y) > 32768) throw new Error('OFFSET_RANGE');
    bytes += frame.image.rgba.byteLength;
    left = Math.min(left, frame.x); top = Math.min(top, frame.y);
    right = Math.max(right, frame.x + frame.image.width); bottom = Math.max(bottom, frame.y + frame.image.height);
  }
  const width = right - left, height = bottom - top;
  if (bytes > 64 * 1024 * 1024 || width > 4096 || height > 4096 || width * height * frames.length * 4 > 64 * 1024 * 1024) throw new Error('ANIMATION_MEMORY_LIMIT');
  return { left, top, width, height };
}
function chunk(name: string, data: Buffer) {
  const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); result.write(name, 4);
  data.copy(result, 8); result.writeUInt32BE(crc32(result.subarray(4, result.length - 4)), result.length - 4); return result;
}
/** Full RGBA frames, source replacement blend, fixed shared origin; no GIF quantization. */
export function encodeResourceApng(frames: AnimationFrame[], fps: number): Buffer {
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('INVALID_FPS');
  const { left, top, width, height } = animationBounds(frames);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length);
  const parts = [Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('acTL', actl)];
  let sequence = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], rgba = new Uint8ClampedArray(width * height * 4), control = Buffer.alloc(26);
    for (let y = 0; y < f.image.height; y++) rgba.set(f.image.rgba.subarray(y * f.image.width * 4, (y + 1) * f.image.width * 4), ((y + f.y - top) * width + f.x - left) * 4);
    control.writeUInt32BE(sequence++); control.writeUInt32BE(width, 4); control.writeUInt32BE(height, 8);
    control.writeUInt16BE(1, 20); control.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', control));
    const png = encodePng(width, height, rgba);
    for (let at = 8; at < png.length;) {
      const size = png.readUInt32BE(at), name = png.toString('ascii', at + 4, at + 8);
      if (name === 'IDAT') {
        const data = png.subarray(at + 8, at + 8 + size);
        if (!i) parts.push(chunk('IDAT', data));
        else { const fd = Buffer.alloc(size + 4); fd.writeUInt32BE(sequence++); data.copy(fd, 4); parts.push(chunk('fdAT', fd)); }
      }
      at += size + 12;
    }
  }
  parts.push(chunk('IEND', Buffer.alloc(0))); return Buffer.concat(parts);
}
