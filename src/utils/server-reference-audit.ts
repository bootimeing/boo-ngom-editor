import * as fs from 'fs';
import * as path from 'path';
import { EngineId } from '../types';
import { DatabaseBrowserSession } from './database-browser';
import { resolveWorkspaceDatabaseSource } from './database-source';
import { analyzeDropRatesWithExternal } from './drop-rate-external';
import { parseMerchantLine, parseMonGenLine } from './map-entities';
import { isStaticMapInfoEntry, MapDimensions, parseMapInfoConnectionLine, parseMapInfoText } from './map-preview';
import { readOriginalMapHeader } from './original-map';
import { parseTableColumns } from './table-configs';
import { decodeTextFile } from './text';

type Check = 'monster' | 'item' | 'connection' | 'npc' | 'spawn';
type Status = 'valid' | 'invalid' | 'unverified';
export interface ServerReferenceFinding {
  check: Check | 'source';
  status: Exclude<Status, 'valid'>;
  file: string;
  line: number;
  message: string;
  occurrences: number;
}
export interface ServerReferenceReport {
  root: string;
  engine: EngineId;
  database?: string;
  counts: Record<Check, Record<Status, number>>;
  findings: ServerReferenceFinding[];
}

const normalize = (name: string) => name.trim().toLowerCase();
const dynamic = (value: string) => /<\$|[%$]\{|^[A-Z]{1,2}\$.+/i.test(value);
const read = (file: string) => decodeTextFile(fs.readFileSync(file)).text;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export async function auditServerReferences(root: string, engine: EngineId): Promise<ServerReferenceReport> {
  const counts = () => ({ valid: 0, invalid: 0, unverified: 0 });
  const report: ServerReferenceReport = { root: path.resolve(root), engine,
    counts: { monster: counts(), item: counts(), connection: counts(), npc: counts(), spawn: counts() }, findings: [] };
  const envir = path.join(report.root, 'Mir200', 'Envir');
  const seen = new Map<string, ServerReferenceFinding>();
  function finding(check: ServerReferenceFinding['check'], status: ServerReferenceFinding['status'], file: string, line: number, detail: string) {
    const key = JSON.stringify([check, status, file, line, detail]);
    const previous = seen.get(key);
    if (previous) { previous.occurrences++; return; }
    const item = { file, line, check, status, message: detail, occurrences: 1 };
    seen.set(key, item);
    report.findings.push(item);
  }
  function unavailable(file: string, detail: string, line = 1) {
    finding('source', 'unverified', file, line, detail);
  }
  function record(check: Check, status: Status, file: string, line: number, detail = '') {
    report.counts[check][status]++;
    if (status !== 'valid') finding(check, status, file, line, detail);
  }
  function config(name: string): string {
    const file = path.join(envir, name);
    try { return read(file); }
    catch (error) { unavailable(file, '无法读取配置文件。' + message(error)); return ''; }
  }

  const names: Partial<Record<'monster' | 'item', Set<string>>> = {};
  let session: DatabaseBrowserSession | undefined;
  try {
    const source = resolveWorkspaceDatabaseSource(root, engine === '996PC' ? '996pc' : 'legacy');
    report.database = source.path;
    session = new DatabaseBrowserSession(source.path, source.profile);
    const catalog = await session.initialize();
    for (const type of ['monster', 'item'] as const) {
      const tableName = engine === '996PC' ? 'cfg_' + type : type === 'item' ? 'stditems' : 'monster';
      const table = catalog.tables.find(entry => normalize(entry.name) === tableName);
      const column = table?.columns.find(entry => /^(?:fld_)?name$/i.test(entry));
      if (!table || !column) { unavailable(source.path, '无法读取名称列。' + tableName); continue; }
      const found = new Set<string>();
      for (let offset = 0; offset < table.rowCount;) {
        const page = await session.loadPage({ tableId: table.id, offset, limit: 200, query: '', sortColumn: '', sortDirection: 'asc' });
        if (!page.rows.length || page.total !== table.rowCount) throw new Error('读取期间数据库记录数变化。' + tableName);
        for (const row of page.rows) if (typeof row[column] === 'string') found.add(normalize(row[column] as string));
        offset += page.rows.length;
      }
      names[type] = found;
    }
  } catch (error) { unavailable(report.database || envir, message(error)); }
  finally { session?.dispose(); }

  function checkName(type: 'monster' | 'item', name: string, file: string, line: number) {
    const catalog = names[type];
    if (dynamic(name) || (type === 'item' && /^(?:[AS]\d+)$/i.test(name))) {
      record(type, 'unverified', file, line, '名称取决于运行时变量。' + name);
    } else if (!catalog) record(type, 'unverified', file, line, '数据库名称列未能读取。' + name);
    else if (catalog.has(normalize(name))) record(type, 'valid', file, line);
    else record(type, 'invalid', file, line, (type === 'item' ? '物品表' : '怪物表') + '中找不到「' + name + '」。');
  }

  const mapInfo = config('MapInfo.txt');
  const aliases = new Map<string, Set<string>>();
  for (const entry of parseMapInfoText(mapInfo)) {
    const id = normalize(entry.mapId);
    const originals = aliases.get(id) || new Set<string>();
    originals.add(normalize(entry.originalMapId));
    aliases.set(id, originals);
  }
  const dimensions = new Map<string, MapDimensions | undefined>();
  const mapDir = path.join(root, 'Mir200', 'Map');
  let mapFiles = new Map<string, string>();
  try {
    mapFiles = new Map(fs.readdirSync(mapDir, { withFileTypes: true }).filter(f => f.isFile() && /\.map$/i.test(f.name))
      .map(f => [normalize(path.parse(f.name).name), path.join(mapDir, f.name)]));
  } catch (error) { unavailable(mapDir, message(error)); }
  function mapSize(id: string): MapDimensions | undefined {
    if (dimensions.has(id)) return dimensions.get(id);
    const file = mapFiles.get(id);
    let result: MapDimensions | undefined;
    if (file) {
      let handle: number | undefined;
      try {
        handle = fs.openSync(file, 'r');
        const header = Buffer.alloc(52);
        const bytes = fs.readSync(handle, header, 0, header.length, 0);
        result = readOriginalMapHeader(header.subarray(0, bytes), fs.fstatSync(handle).size);
      } catch { /* Unsupported or damaged MAP files produce an unverified finding at each referencing location. */ }
      finally { if (handle !== undefined) fs.closeSync(handle); }
    }
    dimensions.set(id, result);
    return result;
  }
  function coordinate(check: 'connection' | 'npc' | 'spawn', file: string, line: number, id: string, x: string, y: string, role: string) {
    const prefix = role + '「' + id + '」(' + x + ', ' + y + ')';
    if ([id, x, y].some(dynamic) || !/^-?\d+$/.test(x) || !/^-?\d+$/.test(y)) {
      record(check, 'unverified', file, line, prefix + ' 含动态值或无法识别的坐标。'); return;
    }
    const matches = aliases.get(normalize(id));
    if (!matches?.size) {
      record(check, aliases.size > 0 && isStaticMapInfoEntry({ mapId: id, originalMapId: id }) ? 'invalid' : 'unverified',
        file, line, prefix + ' 在 MapInfo 中找不到地图定义。'); return;
    }
    const [original] = matches;
    if (matches.size !== 1 || dynamic(original) || !isStaticMapInfoEntry({ mapId: id, originalMapId: original })) {
      record(check, 'unverified', file, line, prefix + ' 地图原图映射不唯一或不是静态文件名。'); return;
    }
    const size = mapSize(original);
    if (!size) { record(check, 'unverified', file, line, prefix + ' 缺少可识别的原图 ' + original + '.map。'); return; }
    const valid = Number(x) >= 0 && Number(x) < size.width && Number(y) >= 0 && Number(y) < size.height;
    record(check, valid ? 'valid' : 'invalid', file, line, prefix + ' 超出 ' + original + '.map 的范围，X 为 0～' +
      (size.width - 1) + '，Y 为 0～' + (size.height - 1) + '。');
  }

  const infoFile = path.join(envir, 'MapInfo.txt');
  for (const [index, raw] of mapInfo.split(/\r\n|[\r\n]/).entries()) {
    const text = raw.replace(/(?:^|\s)(?:;|\/\/).*$/, '').trim();
    if (!text.includes('->') || text.startsWith('[')) continue;
    const pair = parseMapInfoConnectionLine(text, index + 1);
    if (pair) {
      for (const [key, role] of [['from', '入口'], ['to', '出口']] as const) {
        const p = pair[key];
        coordinate('connection', infoFile, index + 1, p.mapId, String(p.x), String(p.y), role);
      }
    } else {
      // Also retain the documented left-side radius, and diagnose negative or
      // variable coordinates which the navigation parser intentionally omits.
      const parts = text.split('->');
      for (const [side, part] of parts.entries()) {
        const fields = part.trim().split(/[\s,]+/);
        if (parts.length === 2 && (fields.length === 3 || (side === 0 && fields.length === 4))) {
          coordinate('connection', infoFile, index + 1, fields[0], fields[1], fields[2], side ? '出口' : '入口');
        } else record('connection', 'unverified', infoFile, index + 1, '无法识别连接点。' + part.trim());
      }
    }
  }
  for (const name of ['MonGen.txt', 'MerChant.txt', 'Npcs.txt']) {
    const file = path.join(envir, name);
    for (const [index, raw] of config(name).split(/\r\n|[\r\n]/).entries()) {
      const line = raw.replace(/(?:^|\s)(?:;|\/\/).*$/, '').trim();
      if (!line) continue;
      const n = index + 1;
      const columns = parseTableColumns(line).map(c => c.value);
      if (name === 'MonGen.txt') {
        const spawn = parseMonGenLine(line, n)?.spawn;
        if (columns.length < 6) { unavailable(file, '刷怪配置列不足。', n); continue; }
        checkName('monster', spawn?.monsterName || columns[3], file, n);
        coordinate('spawn', file, n, spawn?.mapName || columns[0], columns[1], columns[2], '刷怪中心');
      } else if (name === 'MerChant.txt') {
        if (columns.length < 7) { unavailable(file, 'NPC 配置列不足。', n); continue; }
        const npc = parseMerchantLine(line, n)?.npc;
        coordinate('npc', file, n, npc?.mapName || columns[1], columns[2], columns[3], 'NPC ' + columns[4] + ' ');
      } else if (columns.length >= 7) {
        coordinate('npc', file, n, columns[2], columns[3], columns[4], '固定 NPC ' + columns[0] + ' ');
      } else unavailable(file, '固定 NPC 配置列不足。', n);
    }
  }

  const dropDir = path.join(envir, 'MonItems');
  try {
    const files = fs.readdirSync(dropDir, { withFileTypes: true }).filter(f => f.isFile() && /\.txt$/i.test(f.name));
    for (const [index, entry] of files.entries()) {
      if (index && index % 32 === 0) await new Promise<void>(resolve => setImmediate(resolve));
      const file = path.join(dropDir, entry.name);
      try {
        const analysis = analyzeDropRatesWithExternal(read(file), engine, file);
        for (const row of analysis.rows) {
          const origin = row.source?.filePath || file;
          if (row.item) checkName('item', row.item, origin, row.line);
          else unavailable(origin, '爆率物品名称为空或无法识别。', row.line);
        }
        for (const warning of analysis.warnings) unavailable(warning.source?.filePath || file, warning.message, warning.line);
      } catch (error) { unavailable(file, message(error)); }
    }
  } catch (error) { unavailable(dropDir, message(error)); }
  return report;
}
