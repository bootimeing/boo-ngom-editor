import { ImportedResourceImage, validateResourceImage } from './image-codec';

export type ImageTransform = { kind: 'mirrorX' | 'mirrorY' | 'trim' }
  | { kind: 'scale'; percent: number };
/** Nearest-neighbour only. Trim preserves stored-coordinate placement, including negative offsets. */
export function transformResourceImage(source: ImportedResourceImage, transform: ImageTransform) {
  validateResourceImage(source);
  let { width, height } = source;
  let left = 0, top = 0;
  if (transform.kind === 'trim') {
    let right = -1, bottom = -1; left = width; top = height;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (source.rgba[(y * width + x) * 4 + 3]) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    // A fully transparent frame has no bounding box. Keep its dimensions and offset.
    if (right < 0) return { image: source, dx: 0, dy: 0 };
    width = right - left + 1; height = bottom - top + 1;
  } else if (transform.kind === 'scale') {
    if (!Number.isInteger(transform.percent) || transform.percent < 1 || transform.percent > 800) throw new Error('INVALID_SCALE');
    width = Math.max(1, Math.round(width * transform.percent / 100));
    height = Math.max(1, Math.round(height * transform.percent / 100));
  } else if (!['mirrorX', 'mirrorY'].includes(transform.kind)) throw new Error('INVALID_TRANSFORM');
  if (width > 4096 || height > 4096 || width * height > 4194304) throw new Error('IMAGE_DIMENSIONS');
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = transform.kind === 'mirrorX' ? width - x - 1 : transform.kind === 'scale' ? Math.floor(x * source.width / width) : left + x;
    const sy = transform.kind === 'mirrorY' ? height - y - 1 : transform.kind === 'scale' ? Math.floor(y * source.height / height) : top + y;
    const at = (sy * source.width + sx) * 4;
    rgba.set(source.rgba.subarray(at, at + 4), (y * width + x) * 4);
  }
  return { image: { width, height, rgba }, dx: left, dy: top };
}
