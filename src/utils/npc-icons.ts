import * as fs from 'fs';
import * as path from 'path';
import { EngineId } from '../types';
import { MerchantNpc } from './map-entities';
import { decodeTextFile, encodeTextFile, PreservedTextEncoding } from './text';

export interface NpcIconConfig {
  lineNumber: number;
  raw: string;
  wilIndex: number;
  imageIndex: number;
  frameCount: number;
  x: number;
  y: number;
  effect: number;
  speedMs: number;
  playCount: number;
  layer: number;
}

export interface NpcIconDetail {
  text: string;
  fileName: string;
  exists: boolean;
  icons: NpcIconConfig[];
}

export interface SavedNpcIconText extends NpcIconDetail {
  encoding?: PreservedTextEncoding;
}

export function parseNpcIconText(text: string, engine: EngineId): NpcIconConfig[] {
  const icons: NpcIconConfig[] = [];
  const lines = String(text || '').split(/\r?\n|\r/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index].trim();
    if (!raw || raw.startsWith(';') || raw.startsWith('//')) continue;
    const tokens = raw.split(/\s+/);
    const wilIndex = strictInteger(tokens[0]);
    const imageIndex = strictInteger(tokens[1]);
    if (wilIndex === undefined || wilIndex < 0 || imageIndex === undefined || imageIndex < 0 || imageIndex > 65535) {
      continue;
    }

    const frameCountValue = strictInteger(tokens[2]);
    let speedMs = 300;
    let playCount = 0;
    let layer = 0;
    if (engine === 'GEE') {
      layer = binaryInteger(tokens[6], 0);
      speedMs = positiveInteger(tokens[7], 300);
    } else {
      speedMs = positiveInteger(tokens[6], 300);
      if (tokens[7]) {
        const combined = tokens[7].split('|');
        playCount = nonNegativeInteger(combined[0], 0);
        if (combined.length > 1) layer = binaryInteger(combined[1], 0);
      }
      if (tokens[8]) layer = binaryInteger(tokens[8], layer);
    }

    icons.push({
      lineNumber: index + 1,
      raw,
      wilIndex,
      imageIndex,
      frameCount: frameCountValue !== undefined && frameCountValue > 0 ? frameCountValue : 1,
      x: integerOrDefault(tokens[3], 0),
      y: integerOrDefault(tokens[4], 0),
      effect: binaryInteger(tokens[5], 0),
      speedMs,
      playCount,
      layer,
    });
  }
  return icons;
}

export function npcIconRelativeFileName(npc: Pick<MerchantNpc, 'scriptRef' | 'mapName'>): string {
  const scriptParts = safePathParts(npc.scriptRef);
  const mapName = safeFilePart(String(npc.mapName || '').replace(/^\$/, ''));
  if (scriptParts.length === 0 || !mapName) return '';
  const fileName = scriptParts.pop()!;
  return path.win32.join('NpcIcons', ...scriptParts, `${fileName}-${mapName}.txt`);
}

export function loadNpcIconDetail(
  envirDirectory: string,
  npc: Pick<MerchantNpc, 'scriptRef' | 'mapName'>,
  engine: EngineId
): NpcIconDetail {
  const relativeFileName = npcIconRelativeFileName(npc);
  if (!relativeFileName) return { text: '', fileName: '', exists: false, icons: [] };
  const canonicalPath = path.join(envirDirectory, ...relativeFileName.split(/[\\/]/));
  const fallbackRelativeFileName = npcIconFallbackRelativeFileName(npc);
  const fallbackPath = fallbackRelativeFileName
    ? path.join(envirDirectory, ...fallbackRelativeFileName.split(/[\\/]/))
    : '';
  const existingPath = findCaseInsensitiveFile(canonicalPath)
    || (fallbackPath ? findCaseInsensitiveFile(fallbackPath) : undefined);
  const text = existingPath ? readOptionalText(existingPath) : '';
  const fileName = existingPath
    ? path.win32.relative(envirDirectory, existingPath)
    : relativeFileName;
  return {
    text,
    fileName,
    exists: Boolean(existingPath),
    icons: parseNpcIconText(text, engine),
  };
}

export function saveNpcIconText(
  envirDirectory: string,
  npc: Pick<MerchantNpc, 'scriptRef' | 'mapName'>,
  engine: EngineId,
  value: unknown
): SavedNpcIconText {
  const text = String(value ?? '');
  validateNpcIconText(text, engine);
  const current = loadNpcIconDetail(envirDirectory, npc, engine);
  if (!current.fileName) throw new Error('NPC脚本路径或地图编号无效，无法定位顶戴配置');
  if (!current.exists && !text.trim()) return current;

  const filePath = path.join(envirDirectory, ...current.fileName.split(/[\\/]/));
  let encoding: PreservedTextEncoding = 'gbk';
  let eol = '\r\n';
  let existingText = '';
  if (current.exists && fs.existsSync(filePath)) {
    const decoded = decodeTextFile(fs.readFileSync(filePath));
    existingText = decoded.text;
    encoding = decoded.encoding;
    if (decoded.text.includes('\r\n')) eol = '\r\n';
    else if (decoded.text.includes('\n')) eol = '\n';
    else if (decoded.text.includes('\r')) eol = '\r';
  }
  const normalizedText = normalizeLineEndings(text, eol);
  if (!current.exists || existingText !== normalizedText) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, encodeTextFile(normalizedText, encoding));
  }
  return {
    text: normalizedText,
    fileName: current.fileName,
    exists: true,
    icons: parseNpcIconText(normalizedText, engine),
    encoding,
  };
}

export function validateNpcIconText(text: string, engine: EngineId): void {
  const icons = parseNpcIconText(text, engine);
  if (icons.length > 10) throw new Error('NPC顶戴配置最多支持 10 行');
  const validLines = new Set(icons.map(icon => icon.lineNumber));
  const lines = String(text || '').split(/\r?\n|\r/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith(';') || line.startsWith('//')) continue;
    if (!validLines.has(index + 1)) {
      throw new Error(`第 ${index + 1} 行NPC顶戴配置无效，至少需要有效的 WIL 序号和图片序号`);
    }
  }
}

function npcIconFallbackRelativeFileName(npc: Pick<MerchantNpc, 'scriptRef'>): string {
  const scriptParts = safePathParts(npc.scriptRef);
  if (scriptParts.length === 0) return '';
  const fileName = scriptParts.pop()!;
  return path.win32.join('NpcIcons', ...scriptParts, `${fileName}.txt`);
}

function safePathParts(value: unknown): string[] {
  const parts = String(value || '').replace(/^[/\\]+/, '').split(/[/\\]/).filter(Boolean);
  if (parts.some(part => !safeFilePart(part))) return [];
  return parts;
}

function safeFilePart(value: unknown): string {
  const part = String(value || '').trim();
  if (!part || part === '.' || part === '..' || /[<>:"|?*\0/\\]/.test(part)) return '';
  return part;
}

function findCaseInsensitiveFile(filePath: string): string | undefined {
  if (isFile(filePath)) return filePath;
  const parsed = path.parse(path.resolve(filePath));
  const segments = path.resolve(filePath).slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  try {
    for (const segment of segments) {
      const match = fs.readdirSync(current, { withFileTypes: true })
        .find(entry => entry.name.toLocaleLowerCase() === segment.toLocaleLowerCase());
      if (!match) return undefined;
      current = path.join(current, match.name);
    }
    return isFile(current) ? current : undefined;
  } catch {
    return undefined;
  }
}

function readOptionalText(filePath: string): string {
  try {
    return decodeTextFile(fs.readFileSync(filePath)).text;
  } catch {
    return '';
  }
}

function normalizeLineEndings(text: string, eol: string): string {
  return text.replace(/\r\n|\r|\n/g, '\n').replace(/\n/g, eol);
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function strictInteger(value: string | undefined): number | undefined {
  if (!value || !/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function integerOrDefault(value: string | undefined, fallback: number): number {
  return strictInteger(value) ?? fallback;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = strictInteger(value);
  return parsed !== undefined && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = strictInteger(value);
  return parsed !== undefined && parsed >= 0 ? parsed : fallback;
}

function binaryInteger(value: string | undefined, fallback: number): number {
  const parsed = strictInteger(value);
  return parsed === 1 ? 1 : parsed === 0 ? 0 : fallback;
}
