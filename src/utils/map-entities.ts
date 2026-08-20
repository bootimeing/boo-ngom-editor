import * as fs from 'fs';
import * as path from 'path';
import { EngineId } from '../types';
import { MapInfoEntry } from './map-preview';
import { parseTableColumns } from './table-configs';

export interface MerchantNpc {
  lineNumber: number;
  fields: string[];
  scriptRef: string;
  mapName: string;
  x: number;
  y: number;
  displayName: string;
  direction: number;
  appearance: number;
}

export interface ParsedMerchantLine {
  npc: MerchantNpc;
  columns: { value: string; start: number; end: number }[];
}

export interface MonsterSpawn {
  lineNumber: number;
  fields: string[];
  mapName: string;
  x: number;
  y: number;
  monsterName: string;
  range: number;
}

export interface CustomNpcAnimation {
  fileIndex: number;
  direction: number;
  startIndex: number;
  frameCount: number;
  interval: number;
}

export interface CachedArchiveIdentity {
  pakName: string;
  storedWillIdx: number;
  cachedAt: number;
}

export interface EffectImageArchiveIdentity {
  name: string;
  willIdx: number;
}

const MERCHANT_COLUMNS = [
  '脚本路径',
  '地图编号',
  'X',
  'Y',
  'NPC显示名字',
  'NPC朝向',
  'NPC外观编号',
  '是否属于城堡',
  '是否自动移动',
  '移动间隔',
];

const MONGEN_COLUMNS: Record<EngineId, string[]> = {
  GOM: [
    '地图',
    '坐标X',
    '坐标Y',
    '怪物名字',
    '范围',
    '数量(支持G变量)',
    '时间间隔',
    '集中刷新坐标机率',
    '名字颜色(0~255)',
    '刷出来时触发的QF脚本字段(*表示不触发QF)',
    '内功怪物(0,1)',
    '国家名',
    '怪物能否攻击同国家的人(0,1)',
    '不同国家的怪物能否相互攻击(0,1)',
    '怪物能否被同国家的人来攻击(0,1)',
    '刷新模式(0~1)',
    'BOSS怪(0~1 不被NOMANNOMON模式地图清理)',
    '是否在小地图显示刷新倒计时/刷怪预告',
  ],
  GEE: [
    '地图',
    '坐标X',
    '坐标Y',
    '怪物名字',
    '范围',
    '数量',
    '时间间隔',
    '集中刷新坐标机率',
    '名字颜色(0~255)',
    '内功怪物(0,1)',
    '国家ID',
    '怪物能否攻击同国家的人(0,1)',
    '不同国家的怪物能否相互攻击(0,1)',
    '怪物能否被同国家的人攻击(0,1)',
    '刷出来时触发的QF脚本字段',
    '刷怪条件变量',
    '刷怪条件比较符',
    '刷怪条件值',
  ],
  '996PC': [
    '地图',
    '坐标X',
    '坐标Y',
    '怪物名字',
    '范围',
    '数量(支持G变量)',
    '时间间隔',
    '集中刷新机率#刷新模式#大地图倒计时',
    '名字颜色(0~255)',
    '刷出来时触发的QF脚本字段',
    '内功怪物(0,1)',
    '国家名字',
    '同国家玩家能否攻击(0,1)',
  ],
};

const ENGINE_COLORS = `000000 800000 008000 808000 000080 800080 008080 C0C0C0 558097 9DB9C8 7B7373 2D2929 5A5252 635A5A 423939 1D1818 181010 291818 100808 F27971 E1675F FF5A5A FF3131 D65A52 941000 942918 390800 731000 B51800 BD6352 421810 FFAA99 FFFFFF 733929 A54A31 947B73 BD5231 522110 7B3118 2D1810 8C4A31 942900 BD3100 C67352 6B3118 C66B42 CE4A00 A56339 5A3118 2A1000 150800 3A1800 080000 290000 4A0000 9D0000 DC0000 DE0000 FB0000 9C7352 946B4A 734A29 523118 8C4A18 884411 4A2100 211810 D6945A C66B21 EF6B00 FF7700 A59484 423121 181008 291808 211000 392918 8C6339 422910 6B4218 7B4A18 944A00 8C847B 6B635A 4A4239 292118 463929 B5A594 7B6B5A CEB194 A58C73 8C735A B59473 D6A573 EFA54A EFC68C 7B6342 6B5639 BD945A 633900 D6C6AD 524229 946318 EFD6AD A58C63 635A4A BDA57B 5A4218 BD8C31 353129 948463 7B6B4A A58C5A 5A4A29 9C7B39 423110 EFAD21 181000 292100 9C6B00 94845A 524218 6B5A29 7B6321 9C7B21 DEA500 5A5239 312910 CEBD7B 635A39 94844A C6A529 109C18 428C4A 318C42 109429 081810 081818 082910 184229 A5B5AD 6B7373 182929 18424A 31424A 63C6DE 44DDFF 8CD6EF 736B39 F7DE39 F7EF8C F7E700 6B6B5A 5A8CA5 39B5EF 4A9CCE 3184B5 31526B DEDED6 BDBDB5 8C8C84 F7F7DE 000818 081839 081029 081800 082900 0052A5 007BDE 10294A 10396B 10528C 215AA5 10315A 104284 315284 182131 4A5A7B 526BA5 293963 104ADE 292921 4A4A39 292918 4A4A29 7B7B42 9C9C4A 5A5A29 424214 393900 595900 CA352C 6B7321 293100 313910 313918 424A00 526318 5A7329 314A18 182100 183100 183910 63844A 6BBD4A 63B54A 63BD4A 5A9C4A 4A8C39 63C64A 63D64A 52844A 317329 63C65A 52BD4A 10FF00 182918 4A884A 4AE74A 005A00 008800 009400 00DE00 00EE00 00FB00 4A5A94 6373B5 7B8CD6 6B7BD6 7788FF C6C6CE 94949C 9C94C6 313139 291884 180084 4A4252 52427B 635A73 CEB5F7 8C7B9C 7722CC DDAAFF F0B42A DF009F E317B3 FFFBF0 A0A0A4 808080 FF0000 00FF00 FFFF00 0000FF FF00FF 00FFFF FFFFFF`.split(' ');

export function parseMerchantText(text: string): MerchantNpc[] {
  const result: MerchantNpc[] = [];
  for (const [index, rawLine] of text.split(/\r?\n|\r/).entries()) {
    const parsed = parseMerchantLine(rawLine, index + 1);
    if (parsed) result.push(parsed.npc);
  }
  return result;
}

export function parseMerchantLine(rawLine: string, lineNumber: number): ParsedMerchantLine | undefined {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('//')) return undefined;
  const columns = parseTableColumns(rawLine);
  if (columns.length < 7) return undefined;
  const fields = columns.map(column => column.value);
  const x = Number(fields[2]);
  const y = Number(fields[3]);
  const appearance = Number(fields[6]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(appearance)) return undefined;
  return {
    columns,
    npc: {
      lineNumber,
      fields,
      scriptRef: fields[0],
      mapName: fields[1],
      x,
      y,
      displayName: fields[4],
      direction: Number(fields[5]) || 0,
      appearance,
    },
  };
}

export function parseMonGenText(text: string): MonsterSpawn[] {
  const result: MonsterSpawn[] = [];
  for (const [index, rawLine] of text.split(/\r?\n|\r/).entries()) {
    const fields = parseFields(rawLine);
    if (fields.length < 6) continue;
    const x = Number(fields[1]);
    const y = Number(fields[2]);
    const range = Number(fields[4]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(range)) continue;
    result.push({
      lineNumber: index + 1,
      fields,
      mapName: fields[0],
      x,
      y,
      monsterName: fields[3],
      range,
    });
  }
  return result;
}

export function mapEntityMatches(entryMapName: string, map: MapInfoEntry): boolean {
  const key = normalizeMapKey(entryMapName);
  return [map.mapId, map.originalMapId, map.name].some(value => normalizeMapKey(value) === key);
}

export function updateMerchantCoordinates(
  text: string,
  lineNumber: number,
  x: number,
  y: number
): { text: string; npc: MerchantNpc } {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
    throw new Error('NPC坐标必须是大于等于 0 的整数');
  }
  const npc = parseMerchantText(text).find(item => item.lineNumber === lineNumber);
  if (!npc) throw new Error(`Merchant.txt 第 ${lineNumber} 行不是有效的 NPC 配置`);
  const fields = [...npc.fields];
  fields[2] = String(x);
  fields[3] = String(y);
  const updatedText = replaceRecordLine(text, lineNumber, fields);
  const updated = parseMerchantText(updatedText).find(item => item.lineNumber === lineNumber);
  if (!updated) throw new Error('修改后的 NPC 配置无效');
  return { text: updatedText, npc: updated };
}

export function updateMonGenFields(
  text: string,
  lineNumber: number,
  fields: string[]
): { text: string; spawn: MonsterSpawn } {
  if (!parseMonGenText(text).some(item => item.lineNumber === lineNumber)) {
    throw new Error(`MonGen.txt 第 ${lineNumber} 行不是有效的刷怪配置`);
  }
  const normalized = fields.map(value => String(value ?? '').trim());
  while (normalized.length && !normalized[normalized.length - 1]) normalized.pop();
  if (normalized.length < 6) throw new Error('刷怪配置至少需要地图、坐标、怪物、范围和数量');
  if (normalized.some(value => /\s/.test(value))) throw new Error('单个刷怪字段不能包含空格或换行');
  for (const fieldIndex of [1, 2, 4]) {
    const value = Number(normalized[fieldIndex]);
    if (!Number.isInteger(value) || value < 0) throw new Error('坐标和刷怪范围必须是大于等于 0 的整数');
  }
  const updatedText = replaceRecordLine(text, lineNumber, normalized);
  const updated = parseMonGenText(updatedText).find(item => item.lineNumber === lineNumber);
  if (!updated) throw new Error('修改后的刷怪配置无效');
  return { text: updatedText, spawn: updated };
}

export function monGenColumns(engine: EngineId, fieldCount = 0): string[] {
  const columns = [...MONGEN_COLUMNS[engine]];
  while (columns.length < fieldCount) columns.push(`扩展参数 ${columns.length + 1}`);
  return columns;
}

export function merchantColumns(fieldCount = 0): string[] {
  const columns = [...MERCHANT_COLUMNS];
  while (columns.length < fieldCount) columns.push(`扩展参数 ${columns.length + 1}`);
  return columns;
}

export function parseMerchantNameColor(text: string, fallback = 255): number {
  const match = text.match(/^\s*MerchantNameColor\s*=\s*(\d+)/im);
  if (!match) return fallback;
  return Math.max(0, Math.min(255, Number(match[1]) || 0));
}

export function engineColor(index: number): string {
  const normalized = Math.max(0, Math.min(255, Math.trunc(Number(index) || 0)));
  return `#${ENGINE_COLORS[normalized] || 'FFFFFF'}`;
}

export function parseCustomNpcAnimation(text: string, engine: EngineId): CustomNpcAnimation | undefined {
  const sections = parseIniSections(text);
  const setup = sections.get('setup');
  const gomStyleFile = readIniNumber(setup, 'fileindex');
  if (gomStyleFile !== undefined) {
    const enabled = Array.from({ length: 8 }, (_, index) => index)
      .filter(index => readIniNumber(setup, `dir${index}`) === 1);
    const direction = enabled.includes(4) ? 4 : enabled[0];
    if (direction === undefined) return undefined;
    const stand = sections.get('stand');
    return validatedAnimation({
      fileIndex: gomStyleFile,
      direction,
      startIndex: readIniNumber(stand, `start${direction}`) ?? -1,
      frameCount: readIniNumber(stand, `frame${direction}`) ?? 0,
      interval: readIniNumber(stand, `time${direction}`) ?? 200,
    });
  }

  const directions = engine === 'GEE'
    ? [4, 1, 2, 3, 5, 6, 7, 8]
    : [4, 0, 1, 2, 3, 5, 6, 7];
  for (const direction of directions) {
    const section = sections.get(`dir${direction}`);
    if (readIniNumber(section, 'enabled') !== 1) continue;
    return validatedAnimation({
      fileIndex: readIniNumber(section, 'stdfile') ?? -1,
      direction,
      startIndex: readIniNumber(section, 'stdindex') ?? -1,
      frameCount: readIniNumber(section, 'stdcount') ?? 0,
      interval: readIniNumber(section, 'stdtime') ?? 200,
    });
  }
  return undefined;
}

export function selectCustomNpcArchive<T extends CachedArchiveIdentity>(
  fileIndex: number,
  effectImageArchives: readonly EffectImageArchiveIdentity[],
  cachedArchives: readonly T[]
): { archive: T | undefined; expectedPakName: string } {
  const configured = effectImageArchives.find(item => item.willIdx === fileIndex);
  const candidates = configured
    ? cachedArchives.filter(item => archiveNameKey(item.pakName) === archiveNameKey(configured.name))
    : cachedArchives.filter(item => item.storedWillIdx === fileIndex);
  return {
    archive: [...candidates].sort((left, right) => right.cachedAt - left.cachedAt)[0],
    expectedPakName: configured?.name || '',
  };
}

export function findMir200Directory(workspaceRoot: string): string | undefined {
  const candidates = [
    workspaceRoot,
    path.join(workspaceRoot, 'Mir200'),
    path.join(workspaceRoot, 'Mirserver', 'Mir200'),
  ];
  return candidates.find(candidate => isDirectory(path.join(candidate, 'Envir')));
}

export function findEnvirDirectory(workspaceRoot: string): string | undefined {
  const mir200 = findMir200Directory(workspaceRoot);
  return mir200 ? path.join(mir200, 'Envir') : undefined;
}

export function findCustomNpcConfig(
  envirDirectory: string,
  appearance: number,
  engine: EngineId
): string | undefined {
  if (!Number.isInteger(appearance) || appearance < 10000) return undefined;
  const relativeDirectories = engine === 'GEE'
    ? ['CustomNPC', path.join('UserData', 'CustomNpc')]
    : [path.join('UserData', 'CustomNpc'), 'CustomNPC'];
  for (const directory of relativeDirectories) {
    for (const extension of ['ini', 'txt']) {
      const candidate = path.join(envirDirectory, directory, `${appearance}.${extension}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

export function resolveMerchantScriptPath(
  envirDirectory: string,
  npc: Pick<MerchantNpc, 'scriptRef' | 'mapName'>
): string | undefined {
  const parts = npc.scriptRef.split(/[\\/]/).filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return undefined;
  const directory = parts.length ? path.join(...parts) : '';
  const mapName = npc.mapName.replace(/^\$/, '');
  const root = path.join(envirDirectory, 'Market_Def', directory);
  for (const name of [`${fileName}-${mapName}.txt`, `${fileName}.txt`]) {
    const candidate = path.join(root, name);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

function parseFields(rawLine: string): string[] {
  const line = rawLine.trim();
  if (!line || line.startsWith(';') || line.startsWith('//')) return [];
  return line.match(/\S+/g) || [];
}

function normalizeMapKey(value: string): string {
  return String(value || '').trim().replace(/^\$/, '').toLowerCase();
}

function replaceRecordLine(text: string, lineNumber: number, fields: string[]): string {
  const range = findLineRange(text, lineNumber);
  if (!range) throw new Error(`第 ${lineNumber} 行不存在`);
  const original = text.slice(range.start, range.end);
  const leading = original.match(/^\s*/)?.[0] || '';
  const separator = original.includes('\t') ? '\t' : ' ';
  return text.slice(0, range.start) + leading + fields.join(separator) + text.slice(range.end);
}

function findLineRange(text: string, lineNumber: number): { start: number; end: number } | undefined {
  let start = 0;
  let currentLine = 1;
  for (let index = 0; index <= text.length; index++) {
    const char = text[index];
    if (char !== '\r' && char !== '\n' && index !== text.length) continue;
    if (currentLine === lineNumber) return { start, end: index };
    if (char === '\r' && text[index + 1] === '\n') index++;
    start = index + 1;
    currentLine++;
  }
  return undefined;
}

function parseIniSections(text: string): Map<string, Map<string, string>> {
  const result = new Map<string, Map<string, string>>();
  let current = new Map<string, string>();
  result.set('', current);
  for (const rawLine of text.split(/\r?\n|\r/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const section = line.match(/^\[([^\]]+)\]$/);
    if (section) {
      const key = section[1].trim().toLowerCase();
      current = result.get(key) || new Map<string, string>();
      result.set(key, current);
      continue;
    }
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    current.set(line.slice(0, equals).trim().toLowerCase(), line.slice(equals + 1).trim());
  }
  return result;
}

function readIniNumber(section: Map<string, string> | undefined, key: string): number | undefined {
  if (!section) return undefined;
  const raw = section.get(key.toLowerCase());
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function archiveNameKey(value: string): string {
  const name = path.basename(String(value || '').trim());
  return name.replace(/\.(?:pak|jpk|wil|wzl)$/i, '').toLowerCase();
}

function validatedAnimation(value: CustomNpcAnimation): CustomNpcAnimation | undefined {
  if (value.fileIndex < 0 || value.startIndex < 0 || value.frameCount < 1) return undefined;
  return {
    ...value,
    frameCount: Math.min(100, value.frameCount),
    interval: Math.max(16, value.interval || 200),
  };
}

function isDirectory(directoryPath: string): boolean {
  try { return fs.statSync(directoryPath).isDirectory(); } catch { return false; }
}

function isFile(filePath: string): boolean {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}
