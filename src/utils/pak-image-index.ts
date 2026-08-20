export interface PakImageIndexAsset {
  willIdx: number;
  localIdx: number;
  path: string;
}

export function pakImageIndexKey(willIdx: number, localIdx: number): string {
  return `${Math.trunc(willIdx)}:${Math.trunc(localIdx)}`;
}

export function buildPakImageIndex(assets: PakImageIndexAsset[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const asset of assets) {
    if (!Number.isInteger(asset.willIdx) || asset.willIdx < 0) continue;
    if (!Number.isInteger(asset.localIdx) || asset.localIdx < 0) continue;
    if (!asset.path || index.has(pakImageIndexKey(asset.willIdx, asset.localIdx))) continue;
    index.set(pakImageIndexKey(asset.willIdx, asset.localIdx), asset.path);
  }
  return index;
}

export function getPakImagePath(
  index: Map<string, string>,
  willIdx: number,
  localIdx: number
): string | undefined {
  if (!Number.isInteger(willIdx) || willIdx < 0) return undefined;
  if (!Number.isInteger(localIdx) || localIdx < 0) return undefined;
  return index.get(pakImageIndexKey(willIdx, localIdx));
}
