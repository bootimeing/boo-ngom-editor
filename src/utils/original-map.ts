import { EngineId } from '../types';

export type OriginalMapLayer = 'tile' | 'smTile' | 'object';
export type OriginalMapAnimationProfile =
  | 'classic-12'
  | 'classic-14'
  | 'classic-prefix-compatible-36'
  | 'unverified';

export interface OriginalMapModel {
  width: number;
  height: number;
  cellSize: 12 | 14 | 36;
  format: string;
  animationProfile: OriginalMapAnimationProfile;
  backImages: Uint16Array;
  middleImages: Uint16Array;
  frontImages: Uint16Array;
  tileFiles: Uint8Array;
  smTileFiles: Uint8Array;
  objectFiles: Uint8Array;
  objectAnimationFrames: Uint8Array;
  objectAnimationTicks: Uint8Array;
  archiveNames: string[];
  referenceCount: number;
}

export interface OriginalMapViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OriginalMapVisualFrame {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  blank?: boolean;
}

export interface OriginalMapDrawReference {
  layer: OriginalMapLayer;
  x: number;
  y: number;
  archiveName: string;
  imageIndex: number;
  resourceKey: string;
  animationFrame: number;
  animationTick: number;
}

const HEADER_SIZE = 52;
const FOREGROUND_LOOKAHEAD_ROWS = 35;
const LEGEND_MAP_TITLE = Buffer.from('Legend of mir', 'ascii');
const VERIFIED_EMBEDDED_OBJECT_ANIMATION_PROFILES: Readonly<
  Partial<Record<EngineId, ReadonlySet<OriginalMapAnimationProfile>>>
> = {
  GOM: new Set<OriginalMapAnimationProfile>([
    'classic-12',
    'classic-14',
    'classic-prefix-compatible-36',
  ]),
};

// Classic GOM clients place bit7 DrawBlend objects at a fixed three-row anchor
// instead of subtracting each bitmap's height. Keep this as an explicit
// engine/profile capability: an Objects archive name is only a resource source,
// not a placement rule. Other engines and unverified MAP profiles continue to
// use ordinary bottom anchoring.
const VERIFIED_OBJECT_BLEND_ANCHOR_ROWS: Readonly<
  Partial<Record<EngineId, ReadonlyMap<OriginalMapAnimationProfile, number>>>
> = {
  GOM: new Map<OriginalMapAnimationProfile, number>([
    ['classic-12', 3],
    ['classic-14', 3],
    ['classic-prefix-compatible-36', 3],
  ]),
};

function mapFormat(
  cellSize: 12 | 14 | 36,
  animationProfile: OriginalMapAnimationProfile
): string {
  if (animationProfile === 'unverified') {
    return `${cellSize} 字节（动画 profile 未验证）`;
  }
  return cellSize === 12
    ? '经典 12 字节'
    : cellSize === 14
      ? '扩展 14 字节'
      : '扩展 36 字节（经典前缀兼容）';
}

function hasLegendMapTitle(data: Buffer): boolean {
  return data.subarray(5, 5 + LEGEND_MAP_TITLE.length).equals(LEGEND_MAP_TITLE);
}

function mapAnimationProfile(
  data: Buffer,
  cellSize: 12 | 14 | 36
): OriginalMapAnimationProfile {
  if (!hasLegendMapTitle(data)) return 'unverified';
  if (cellSize === 12 && data[4] === 0x0d) return 'classic-12';
  if (
    (cellSize === 14 || cellSize === 36)
    && data[4] === 0x0f
    && data[18] === 0x0d
    && data[19] === 0x0a
  ) {
    return cellSize === 14 ? 'classic-14' : 'classic-prefix-compatible-36';
  }
  return 'unverified';
}

function bufferView(data: Uint8Array | Buffer): Buffer {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function mapImageReference(rawValue: number): number {
  return rawValue === 0xffff ? 0 : rawValue & 0x7fff;
}

function validateHeader(data: Buffer): { width: number; height: number; cellSize: 12 | 14 | 36 } {
  if (data.length < HEADER_SIZE) throw new Error('MAP 文件小于 52 字节，文件头不完整');
  const width = data.readUInt16LE(0);
  const height = data.readUInt16LE(2);
  if (width <= 0 || height <= 0 || width > 4000 || height > 4000) {
    throw new Error(`MAP 尺寸无效: ${width}x${height}`);
  }
  const payloadSize = data.length - HEADER_SIZE;
  const pointCount = width * height;
  if (payloadSize % pointCount !== 0) {
    throw new Error(`MAP 数据长度与 ${width}x${height} 不匹配`);
  }
  const cellSize = payloadSize / pointCount;
  if (cellSize !== 12 && cellSize !== 14 && cellSize !== 36) {
    throw new Error(`暂不支持 ${cellSize} 字节的 MAP 单元格式`);
  }
  return { width, height, cellSize };
}

export function originalMapArchiveName(layer: OriginalMapLayer, fileIndex: number): string {
  const baseName = layer === 'tile' ? 'Tiles' : layer === 'smTile' ? 'SmTiles' : 'Objects';
  return fileIndex > 0 ? `${baseName}${fileIndex + 1}` : baseName;
}

export function originalMapResourceKey(archiveName: string, imageIndex: number): string {
  return `${archiveName.toLowerCase()}:${imageIndex}`;
}

export function originalMapAnimationFrameCount(animationFrame: number): number {
  return (Number(animationFrame) || 0) & 0x7f;
}

export function originalMapAnimationProfileSupportsPlayback(
  engine: EngineId,
  profile: OriginalMapAnimationProfile
): boolean {
  return VERIFIED_EMBEDDED_OBJECT_ANIMATION_PROFILES[engine]?.has(profile) === true;
}

export function originalMapObjectBlendAnchorRows(
  engine: EngineId,
  profile: OriginalMapAnimationProfile
): number | undefined {
  return VERIFIED_OBJECT_BLEND_ANCHOR_ROWS[engine]?.get(profile);
}

export function originalMapAnimationSequenceKey(reference: OriginalMapDrawReference): string {
  return `${reference.resourceKey}#${originalMapAnimationFrameCount(reference.animationFrame)}`;
}

export function originalMapAnimationFrameReferences(
  reference: OriginalMapDrawReference
): OriginalMapDrawReference[] {
  if (reference.layer !== 'object') return [];
  const frameCount = originalMapAnimationFrameCount(reference.animationFrame);
  if (frameCount <= 1) return [];
  return Array.from({ length: frameCount }, (_, frameOffset) => {
    const imageIndex = reference.imageIndex + frameOffset;
    return {
      ...reference,
      imageIndex,
      resourceKey: originalMapResourceKey(reference.archiveName, imageIndex),
    };
  });
}

export async function parseOriginalMap(
  input: Uint8Array | Buffer,
  onProgress?: (completed: number, total: number) => void
): Promise<OriginalMapModel> {
  const data = bufferView(input);
  const { width, height, cellSize } = validateHeader(data);
  const animationProfile = mapAnimationProfile(data, cellSize);
  const pointCount = width * height;
  const backImages = new Uint16Array(pointCount);
  const middleImages = new Uint16Array(pointCount);
  const frontImages = new Uint16Array(pointCount);
  const tileFiles = new Uint8Array(pointCount);
  const smTileFiles = new Uint8Array(pointCount);
  const objectFiles = new Uint8Array(pointCount);
  const objectAnimationFrames = new Uint8Array(pointCount);
  const objectAnimationTicks = new Uint8Array(pointCount);
  const archives = new Set<string>();
  let referenceCount = 0;

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const offset = HEADER_SIZE + (x * height + y) * cellSize;
      const index = y * width + x;
      const back = mapImageReference(data.readUInt16LE(offset));
      const middle = mapImageReference(data.readUInt16LE(offset + 2));
      const front = mapImageReference(data.readUInt16LE(offset + 4));
      const animationFrame = data[offset + 8] || 0;
      const animationTick = data[offset + 9] || 0;
      const objectFile = data[offset + 10] || 0;
      const tileFile = cellSize >= 14 ? data[offset + 12] || 0 : 0;
      const smTileFile = cellSize >= 14 ? data[offset + 13] || 0 : 0;
      backImages[index] = back;
      middleImages[index] = middle;
      frontImages[index] = front;
      objectAnimationFrames[index] = animationFrame;
      objectAnimationTicks[index] = animationTick;
      objectFiles[index] = objectFile;
      tileFiles[index] = tileFile;
      smTileFiles[index] = smTileFile;
      if (back > 0 && x % 2 === 0 && y % 2 === 0) {
        archives.add(originalMapArchiveName('tile', tileFile));
        referenceCount++;
      }
      if (middle > 0) {
        archives.add(originalMapArchiveName('smTile', smTileFile));
        referenceCount++;
      }
      if (front > 0) {
        archives.add(originalMapArchiveName('object', objectFile));
        referenceCount++;
      }
    }
    if (x === width - 1 || x % Math.max(1, Math.floor(width / 100)) === 0) {
      onProgress?.(x + 1, width);
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }

  return {
    width,
    height,
    cellSize,
    format: mapFormat(cellSize, animationProfile),
    animationProfile,
    backImages,
    middleImages,
    frontImages,
    tileFiles,
    smTileFiles,
    objectFiles,
    objectAnimationFrames,
    objectAnimationTicks,
    archiveNames: [...archives].sort((left, right) => (
      left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })
    )),
    referenceCount,
  };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(Number(value) || 0)));
}

export function permanentMapEffectFramesIntersectViewport(
  effectX: number,
  effectY: number,
  frames: readonly OriginalMapVisualFrame[],
  viewport: OriginalMapViewport
): boolean {
  const viewportWorldLeft = viewport.left * 48;
  const viewportWorldTop = viewport.top * 32;
  const viewportWorldRight = (viewport.right + 1) * 48;
  const viewportWorldBottom = (viewport.bottom + 1) * 32;
  return frames.some(frame => {
    if (frame.blank) return false;
    const frameLeft = effectX * 48 + (Number(frame.offsetX) || 0);
    const frameTop = effectY * 32 + (Number(frame.offsetY) || 0);
    const frameRight = frameLeft + Math.max(1, Number(frame.width) || 1);
    const frameBottom = frameTop + Math.max(1, Number(frame.height) || 1);
    return frameRight > viewportWorldLeft
      && frameBottom > viewportWorldTop
      && frameLeft < viewportWorldRight
      && frameTop < viewportWorldBottom;
  });
}

export function collectOriginalMapViewport(
  model: OriginalMapModel,
  viewport: OriginalMapViewport
): OriginalMapDrawReference[] {
  const left = clampInteger(viewport.left, 0, model.width - 1);
  const top = clampInteger(viewport.top, 0, model.height - 1);
  const right = clampInteger(viewport.right, left, model.width - 1);
  const bottom = clampInteger(viewport.bottom, top, model.height - 1);
  const references: OriginalMapDrawReference[] = [];

  const append = (
    layer: OriginalMapLayer,
    x: number,
    y: number,
    rawImageIndex: number,
    fileIndex: number,
    animationFrame = 0,
    animationTick = 0
  ): void => {
    if (rawImageIndex <= 0) return;
    const archiveName = originalMapArchiveName(layer, fileIndex);
    const imageIndex = rawImageIndex - 1;
    references.push({
      layer,
      x,
      y,
      archiveName,
      imageIndex,
      resourceKey: originalMapResourceKey(archiveName, imageIndex),
      animationFrame,
      animationTick,
    });
  };

  const backgroundLeft = Math.max(0, left - 2);
  const backgroundTop = Math.max(0, top - 2);
  const backgroundRight = Math.min(model.width - 1, right + 2);
  const backgroundBottom = Math.min(model.height - 1, bottom + 2);
  for (let y = backgroundTop; y <= backgroundBottom; y++) {
    for (let x = backgroundLeft; x <= backgroundRight; x++) {
      const index = y * model.width + x;
      if (x % 2 === 0 && y % 2 === 0) {
        append('tile', x, y, model.backImages[index], model.tileFiles[index]);
      }
      append('smTile', x, y, model.middleImages[index], model.smTileFiles[index]);
    }
  }

  const objectBottom = Math.min(model.height - 1, bottom + FOREGROUND_LOOKAHEAD_ROWS);
  for (let y = top; y <= objectBottom; y++) {
    for (let x = backgroundLeft; x <= backgroundRight; x++) {
      const index = y * model.width + x;
      append(
        'object',
        x,
        y,
        model.frontImages[index],
        model.objectFiles[index],
        model.objectAnimationFrames[index],
        model.objectAnimationTicks[index]
      );
    }
  }
  return references;
}
