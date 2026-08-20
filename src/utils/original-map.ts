export type OriginalMapLayer = 'tile' | 'smTile' | 'object';

export interface OriginalMapModel {
  width: number;
  height: number;
  cellSize: 12 | 14 | 36;
  format: string;
  backImages: Uint16Array;
  middleImages: Uint16Array;
  frontImages: Uint16Array;
  tileFiles: Uint8Array;
  smTileFiles: Uint8Array;
  objectFiles: Uint8Array;
  archiveNames: string[];
  referenceCount: number;
}

export interface OriginalMapViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OriginalMapDrawReference {
  layer: OriginalMapLayer;
  x: number;
  y: number;
  archiveName: string;
  imageIndex: number;
  resourceKey: string;
}

const HEADER_SIZE = 52;
const FOREGROUND_LOOKAHEAD_ROWS = 35;

function mapFormat(cellSize: number): string {
  return cellSize === 12 ? '经典 12 字节' : cellSize === 14 ? '扩展 14 字节' : '扩展 36 字节';
}

function bufferView(data: Uint8Array | Buffer): Buffer {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
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

export async function parseOriginalMap(
  input: Uint8Array | Buffer,
  onProgress?: (completed: number, total: number) => void
): Promise<OriginalMapModel> {
  const data = bufferView(input);
  const { width, height, cellSize } = validateHeader(data);
  const pointCount = width * height;
  const backImages = new Uint16Array(pointCount);
  const middleImages = new Uint16Array(pointCount);
  const frontImages = new Uint16Array(pointCount);
  const tileFiles = new Uint8Array(pointCount);
  const smTileFiles = new Uint8Array(pointCount);
  const objectFiles = new Uint8Array(pointCount);
  const archives = new Set<string>();
  let referenceCount = 0;

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const offset = HEADER_SIZE + (x * height + y) * cellSize;
      const index = y * width + x;
      const back = data.readUInt16LE(offset) & 0x7fff;
      const middle = data.readUInt16LE(offset + 2) & 0x7fff;
      const front = data.readUInt16LE(offset + 4) & 0x7fff;
      const objectFile = data[offset + 10] || 0;
      const tileFile = cellSize >= 14 ? data[offset + 12] || 0 : 0;
      const smTileFile = cellSize >= 14 ? data[offset + 13] || 0 : 0;
      backImages[index] = back;
      middleImages[index] = middle;
      frontImages[index] = front;
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
    format: mapFormat(cellSize),
    backImages,
    middleImages,
    frontImages,
    tileFiles,
    smTileFiles,
    objectFiles,
    archiveNames: [...archives].sort((left, right) => (
      left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' })
    )),
    referenceCount,
  };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.floor(Number(value) || 0)));
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
    fileIndex: number
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
      append('object', x, y, model.frontImages[index], model.objectFiles[index]);
    }
  }
  return references;
}
