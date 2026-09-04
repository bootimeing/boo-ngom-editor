import * as fs from 'fs';
import * as path from 'path';
import { EngineId } from '../types';
import { resolveMonsterRepresentativeAsset } from './monster-image';
import { decodeTextFile, encodeTextFile, PreservedTextEncoding } from './text';

export type DatabaseDetailKind = 'item' | 'monster' | 'skill' | 'other';

export interface MonsterIconConfig {
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

export interface MonsterDatabaseDetail {
  dropRateText: string;
  dropRateFileName: string;
  iconText: string;
  iconFileName: string;
  icons: MonsterIconConfig[];
}

export interface MonsterPreviewImageAsset {
  url: string;
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
  placementX?: number;
  placementY?: number;
}

export interface ActorIconPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MonsterDatabaseDetailTextKey = 'dropRateText' | 'iconText';

export interface MonsterIconPreview extends MonsterIconConfig {
  frames: string[];
  frameAssets: MonsterPreviewImageAsset[];
  previewTruncated: boolean;
}

export interface MonsterIconPreviewResult {
  icons: MonsterIconPreview[];
  iconConfigTruncated: boolean;
}

export interface MonsterBodyAppearance {
  source: 'archive' | 'will' | 'missing';
  imageIndex: number;
  pakName?: string;
  willIndex?: number;
  label: string;
  configFileName: string;
  warning: string;
}

export interface SavedMonsterDatabaseDetailText {
  fileName: string;
  encoding: PreservedTextEncoding;
}

export function classifyDatabaseDetail(tableName: unknown, tableLabel: unknown = ''): DatabaseDetailKind {
  const normalized = `${String(tableName || '')} ${String(tableLabel || '')}`.toLocaleLowerCase();
  if (/monster|怪物/.test(normalized)) return 'monster';
  if (/magic|skill|技能/.test(normalized)) return 'skill';
  if (/stditems?|\bitems?\b|物品/.test(normalized)) return 'item';
  return 'other';
}

export function parseMonsterIconText(text: string): MonsterIconConfig[] {
  const icons: MonsterIconConfig[] = [];
  const lines = String(text || '').split(/\r?\n/);
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
    const speedValue = strictInteger(tokens[6]);
    let playCount = 0;
    let layer = 0;
    if (tokens[7]) {
      const combined = tokens[7].split('|');
      playCount = nonNegativeInteger(combined[0], 0);
      if (combined.length > 1) layer = binaryInteger(combined[1], 0);
    }
    if (tokens[8]) layer = binaryInteger(tokens[8], layer);

    icons.push({
      lineNumber: index + 1,
      raw,
      wilIndex,
      imageIndex,
      frameCount: frameCountValue !== undefined && frameCountValue > 0 ? frameCountValue : 1,
      x: integerOrDefault(tokens[3], 0),
      y: integerOrDefault(tokens[4], 0),
      effect: binaryInteger(tokens[5], 0),
      speedMs: speedValue !== undefined && speedValue > 0 ? speedValue : 300,
      playCount,
      layer,
    });
  }
  return icons;
}

export function loadMonsterDatabaseDetail(envirDirectory: string, monsterName: unknown): MonsterDatabaseDetail {
  const safeName = safeMonsterName(monsterName);
  if (!safeName) return emptyMonsterDetail();

  const dropRatePath = findNamedTextFile(path.join(envirDirectory, 'MonItems'), safeName);
  const iconPath = findNamedTextFile(path.join(envirDirectory, 'MonIcons'), safeName);
  const dropRateText = readOptionalText(dropRatePath);
  const iconText = readOptionalText(iconPath);
  return {
    dropRateText,
    dropRateFileName: dropRatePath ? path.win32.join('MonItems', path.basename(dropRatePath)) : '',
    iconText,
    iconFileName: iconPath ? path.win32.join('MonIcons', path.basename(iconPath)) : '',
    icons: parseMonsterIconText(iconText),
  };
}

export function buildMonsterIconPreviews(
  icons: MonsterIconConfig[],
  resolveImage: (wilIndex: number, imageIndex: number) => string | MonsterPreviewImageAsset,
  maxConfigs = 10,
  totalFrameBudget = 96,
  maxFramesPerIcon = 32
): MonsterIconPreviewResult {
  const iconConfigs = icons.slice(0, Math.max(0, maxConfigs));
  const frameBudgetPerIcon = iconConfigs.length > 0
    ? Math.max(1, Math.min(maxFramesPerIcon, Math.floor(totalFrameBudget / iconConfigs.length)))
    : 0;
  return {
    icons: iconConfigs.map(icon => {
      const previewFrameCount = Math.min(icon.frameCount, frameBudgetPerIcon);
      const frames: string[] = [];
      const frameAssets: MonsterPreviewImageAsset[] = [];
      for (let offset = 0; offset < previewFrameCount; offset++) {
        const resolved = resolveImage(icon.wilIndex, icon.imageIndex + offset);
        const asset = typeof resolved === 'string' ? { url: resolved } : resolved;
        frames.push(asset.url);
        const placement = calculateActorIconPlacement(asset, icon.x, icon.y);
        frameAssets.push(placement
          ? { ...asset, placementX: placement.x, placementY: placement.y }
          : asset);
      }
      return {
        ...icon,
        frames,
        frameAssets,
        previewTruncated: previewFrameCount < icon.frameCount,
      };
    }),
    iconConfigTruncated: icons.length > iconConfigs.length,
  };
}

export function calculateActorIconPlacement(
  asset: Pick<MonsterPreviewImageAsset, 'width' | 'height' | 'offsetX' | 'offsetY'>,
  scriptX: number,
  scriptY: number,
  naturalWidth = 0,
  naturalHeight = 0
): ActorIconPlacement | undefined {
  const assetWidth = finiteNumber(asset.width);
  const assetHeight = finiteNumber(asset.height);
  const width = assetWidth !== undefined && assetWidth > 0 ? assetWidth : finitePositive(naturalWidth);
  const height = assetHeight !== undefined && assetHeight > 0 ? assetHeight : finitePositive(naturalHeight);
  if (width === undefined || height === undefined) return undefined;

  const offsetX = finiteNumber(asset.offsetX) || 0;
  const offsetY = finiteNumber(asset.offsetY) || 0;
  return {
    x: offsetX + (finiteNumber(scriptX) || 0) + 24 - Math.floor(width / 2),
    y: offsetY + (finiteNumber(scriptY) || 0) + 21 - height,
    width,
    height,
  };
}

function finiteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function finitePositive(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

export function describeMonsterBodyAppearance(
  envirDirectory: string,
  monsterName: unknown,
  fields: Record<string, unknown>,
  engine: EngineId
): MonsterBodyAppearance {
  const race = readFieldNumber(fields, ['race']);
  const appr = readFieldNumber(fields, ['appr', 'raceimg']);
  if (race === 156) {
    return describeSmartMonsterAppearance(envirDirectory, monsterName, engine);
  }
  const representative = resolveMonsterRepresentativeAsset(appr);
  if (!representative) {
    return missingMonsterBody('怪物数据库没有有效的 Appr 字段');
  }
  const extension = engine === '996PC' ? 'jpk' : 'pak';
  const pakName = representative.archiveName;
  const imageIndex = representative.imageIndex;
  return {
    source: 'archive',
    pakName,
    imageIndex,
    label: `${pakName}.${extension} / ${String(imageIndex).padStart(6, '0')}`,
    configFileName: '',
    warning: '',
  };
}

export function saveMonsterDatabaseDetailText(
  envirDirectory: string,
  monsterName: unknown,
  key: MonsterDatabaseDetailTextKey,
  text: unknown
): SavedMonsterDatabaseDetailText {
  const safeName = safeMonsterName(monsterName);
  if (!safeName) throw new Error('怪物名称无效，无法保存配置');
  if (key !== 'dropRateText' && key !== 'iconText') throw new Error('不支持的怪物配置类型');

  const directoryName = key === 'dropRateText' ? 'MonItems' : 'MonIcons';
  const directory = path.join(envirDirectory, directoryName);
  const existingPath = findNamedTextFile(directory, safeName);
  const filePath = existingPath || path.join(directory, `${safeName}.txt`);
  let encoding: PreservedTextEncoding = 'gbk';
  let eol = '\r\n';
  if (existingPath) {
    const decoded = decodeTextFile(fs.readFileSync(existingPath));
    encoding = decoded.encoding;
    if (decoded.text.includes('\r\n')) eol = '\r\n';
    else if (decoded.text.includes('\n')) eol = '\n';
  }

  const normalizedText = normalizeLineEndings(String(text ?? ''), eol);
  if (key === 'iconText') validateMonsterIconText(normalizedText);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, encodeTextFile(normalizedText, encoding));
  return {
    fileName: path.win32.join(directoryName, path.basename(filePath)),
    encoding,
  };
}

function emptyMonsterDetail(): MonsterDatabaseDetail {
  return { dropRateText: '', dropRateFileName: '', iconText: '', iconFileName: '', icons: [] };
}

function describeSmartMonsterAppearance(
  envirDirectory: string,
  monsterName: unknown,
  engine: EngineId
): MonsterBodyAppearance {
  const safeName = safeMonsterName(monsterName);
  if (!safeName) return missingMonsterBody('怪物名称无效，无法读取 SmartMonster 配置');
  const configPath = findNamedFile(path.join(envirDirectory, 'SmartMonster'), safeName, ['ini', 'txt']);
  if (!configPath) return missingMonsterBody(`未找到 SmartMonster\\${safeName}.ini`);
  const configFileName = path.win32.join('SmartMonster', path.basename(configPath));
  let text = '';
  try {
    text = decodeTextFile(fs.readFileSync(configPath)).text;
  } catch {
    return missingMonsterBody(`${configFileName} 读取失败`, configFileName);
  }
  const sections = parseIniSections(text);
  if (engine === 'GEE') {
    const stand = sections.get('actstand');
    const fileIndex = readIniInteger(stand, 'actionfile');
    const start = readIniInteger(stand, 'startindex');
    const frame = readIniInteger(stand, 'playcount') ?? 0;
    const skip = readIniInteger(stand, 'emptycount') ?? 0;
    const calcDir = readIniInteger(stand, 'calcdir') ?? 0;
    return smartMonsterResult(fileIndex, start, frame, skip, calcDir, configFileName, engine);
  }
  const client = sections.get('client');
  const stand = sections.get('actstand');
  const fileIndex = readIniInteger(client, 'fileindex');
  const start = readIniInteger(stand, 'start');
  const frame = readIniInteger(stand, 'frame') ?? 0;
  const skip = readIniInteger(stand, 'skip') ?? 0;
  const checkDir = readIniInteger(stand, 'checkdir') ?? 0;
  return smartMonsterResult(fileIndex, start, frame, skip, checkDir, configFileName, engine);
}

function smartMonsterResult(
  fileIndex: number | undefined,
  start: number | undefined,
  frame: number,
  skip: number,
  directional: number,
  configFileName: string,
  engine: EngineId
): MonsterBodyAppearance {
  if (fileIndex === undefined || fileIndex < 0 || start === undefined || start < 0) {
    return missingMonsterBody(`${configFileName} 没有有效的站立素材配置`, configFileName);
  }
  const directionStride = Math.max(0, frame) + Math.max(0, skip);
  const imageIndex = start + (directional !== 0 ? directionStride * 4 : 0);
  return {
    source: 'will',
    willIndex: fileIndex,
    imageIndex,
    label: `WILL ${fileIndex} / ${String(imageIndex).padStart(6, '0')} (${engine})`,
    configFileName,
    warning: '',
  };
}

function missingMonsterBody(warning: string, configFileName = ''): MonsterBodyAppearance {
  return {
    source: 'missing',
    imageIndex: -1,
    label: '',
    configFileName,
    warning,
  };
}

function safeMonsterName(value: unknown): string {
  const name = String(value || '').trim();
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name)) return '';
  return name;
}

function readFieldNumber(fields: Record<string, unknown>, aliases: string[]): number | undefined {
  const entries = Object.entries(fields || {});
  for (const alias of aliases) {
    const normalizedAlias = alias.trim().toLowerCase();
    for (const [key, rawValue] of entries) {
      if (key.trim().toLowerCase() !== normalizedAlias) continue;
      const value = Number(rawValue);
      if (Number.isFinite(value) && Number.isInteger(value)) return value;
    }
  }
  return undefined;
}

function findNamedFile(directory: string, baseName: string, extensions: string[]): string | undefined {
  for (const extension of extensions) {
    const direct = path.join(directory, `${baseName}.${extension}`);
    try { if (fs.statSync(direct).isFile()) return direct; } catch { /* Continue. */ }
  }
  if (!fs.existsSync(directory)) return undefined;
  const expected = new Set(extensions.map(extension => `${baseName}.${extension}`.toLocaleLowerCase()));
  try {
    const match = fs.readdirSync(directory, { withFileTypes: true })
      .find(entry => entry.isFile() && expected.has(entry.name.toLocaleLowerCase()));
    return match ? path.join(directory, match.name) : undefined;
  } catch {
    return undefined;
  }
}

function parseIniSections(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current = new Map<string, string>();
  sections.set('', current);
  for (const rawLine of text.split(/\r?\n|\r/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      const name = section[1].trim().toLowerCase();
      current = sections.get(name) || new Map<string, string>();
      sections.set(name, current);
      continue;
    }
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    current.set(line.slice(0, equals).trim().toLowerCase(), line.slice(equals + 1).trim());
  }
  return sections;
}

function readIniInteger(section: Map<string, string> | undefined, key: string): number | undefined {
  const raw = section?.get(key.toLowerCase());
  if (raw === undefined || !/^-?\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

function findNamedTextFile(directory: string, baseName: string): string | undefined {
  if (!fs.existsSync(directory)) return undefined;
  const expectedName = `${baseName}.txt`;
  const directPath = path.join(directory, expectedName);
  try {
    if (fs.statSync(directPath).isFile()) return directPath;
  } catch {
    // Fall through to a case-insensitive lookup for files created on other platforms.
  }
  try {
    const expectedLower = expectedName.toLocaleLowerCase();
    const match = fs.readdirSync(directory, { withFileTypes: true })
      .find(entry => entry.isFile() && entry.name.toLocaleLowerCase() === expectedLower);
    return match ? path.join(directory, match.name) : undefined;
  } catch {
    return undefined;
  }
}

function readOptionalText(filePath: string | undefined): string {
  if (!filePath) return '';
  try {
    return decodeTextFile(fs.readFileSync(filePath)).text;
  } catch {
    return '';
  }
}

function validateMonsterIconText(text: string): void {
  const validLines = new Set(parseMonsterIconText(text).map(icon => icon.lineNumber));
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith(';') || line.startsWith('//')) continue;
    if (!validLines.has(index + 1)) {
      throw new Error(`第 ${index + 1} 行顶戴配置无效，至少需要有效的 WIL 序号和图片序号`);
    }
  }
}

function normalizeLineEndings(text: string, eol: string): string {
  return text.replace(/\r\n|\r|\n/g, '\n').replace(/\n/g, eol);
}

function strictInteger(value: string | undefined): number | undefined {
  if (!value || !/^-?\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function integerOrDefault(value: string | undefined, fallback: number): number {
  return strictInteger(value) ?? fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = strictInteger(value);
  return parsed !== undefined && parsed >= 0 ? parsed : fallback;
}

function binaryInteger(value: string | undefined, fallback: number): number {
  const parsed = strictInteger(value);
  return parsed === 1 ? 1 : parsed === 0 ? 0 : fallback;
}
