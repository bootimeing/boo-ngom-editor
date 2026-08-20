import * as fs from 'fs';
import * as path from 'path';
import { readFileGBK } from './text';

export interface MiniMapReference {
  mapName: string;
  code: number;
  pakName: string;
  imageIndex: number;
}

export function miniMapArchiveCandidates(pakName: string): string[] {
  const baseName = path.basename(pakName, path.extname(pakName)).toLowerCase();
  return baseName === 'mmap0' ? [pakName, 'mmap'] : [pakName];
}

export function parseMiniMapText(text: string): Map<string, MiniMapReference> {
  const result = new Map<string, MiniMapReference>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const match = line.match(/^(\S+)\s+(\d+)/);
    if (!match) continue;
    const mapName = match[1];
    const reference = decodeMiniMapCode(mapName, Number(match[2]));
    if (reference) result.set(mapName.toLowerCase(), reference);
  }
  return result;
}

export function decodeMiniMapCode(mapName: string, code: number): MiniMapReference | undefined {
  if (!Number.isInteger(code) || code < 1) return undefined;
  // Extended mmap10+ archives use 5,000-image ranges starting at code 10001.
  if (code >= 10001) {
    const extendedIndex = code - 10001;
    return {
      mapName,
      code,
      pakName: `mmap${10 + Math.floor(extendedIndex / 5000)}`,
      imageIndex: extendedIndex % 5000,
    };
  }
  const pakNumber = Math.floor(code / 1000);
  const imageIndex = code % 1000 - 1;
  if (imageIndex < 0) return undefined;
  return {
    mapName,
    code,
    pakName: `mmap${pakNumber}`,
    imageIndex,
  };
}

export function loadMiniMapIndex(workspaceRoot: string): Map<string, MiniMapReference> {
  const candidates = [
    path.join(workspaceRoot, 'Mir200', 'Envir', 'MiniMap.txt'),
    path.join(workspaceRoot, 'Envir', 'MiniMap.txt'),
  ];
  const miniMapPath = candidates.find(candidate => fs.existsSync(candidate));
  if (!miniMapPath) return new Map();
  try {
    return parseMiniMapText(readFileGBK(fs.readFileSync(miniMapPath)));
  } catch (error) {
    console.warn('[BOO] MiniMap.txt 读取失败:', error instanceof Error ? error.message : String(error));
    return new Map();
  }
}

export function findMiniMapReferenceByPriority(
  index: Map<string, MiniMapReference>,
  mapNames: string[]
): MiniMapReference | undefined {
  for (const mapName of mapNames) {
    const reference = index.get(mapName.trim().toLowerCase());
    if (reference) return reference;
  }
  return undefined;
}

export function findMiniMapReference(
  workspaceRoot: string,
  mapFileName: string
): MiniMapReference | undefined {
  const mapName = path.basename(mapFileName, path.extname(mapFileName)).toLowerCase();
  return loadMiniMapIndex(workspaceRoot).get(mapName);
}
