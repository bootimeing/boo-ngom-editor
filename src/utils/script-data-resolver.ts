import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EngineId } from '../types';
import { readPreviewExcelTable } from '../ui-dialog/preview-excel';
import {
  NestedConfigValueRequest,
  NestedConfigValueResult,
  NestedDatabaseFieldRequest,
  NestedDatabaseFieldResult,
  NestedListDataRequest,
  NestedListDataResult,
  NestedTableDataRequest,
  NestedTableDataResult,
  NestedVariableAnalysisOptions,
} from './nested-variable-analysis';
import { decodeTextFile, encodeTextFile } from './text';
import { isBinarySpreadsheet, parseScriptTableData } from './table-data';
import { openXlsTable } from './xls-table';

type IniSections = Map<string, Map<string, string[]>>;

interface SqlStatement {
  bind(values?: unknown[]): boolean;
  step(): boolean;
  getAsObject(): Record<string, unknown>;
  free(): void;
}

interface SqlDatabase {
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlStatement;
  close(): void;
}

interface SqlModule {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

interface DatabaseFieldSource {
  lookup?(itemName: string, field: string, ignoreAsciiCase?: boolean): string | undefined;
  lookupByIndex?(itemIndex: number, field: string): string | undefined;
  dispose?(): void;
  itemNames?(): readonly string[] | undefined;
}

interface CachedDatabaseSources {
  stamp: string;
  sources: DatabaseFieldSource[];
  equipmentCatalogComplete: boolean;
  equipmentMatches: Map<string, readonly string[] | undefined>;
}

interface CachedValue<T> {
  stamp: string;
  value: T | undefined;
}

export class ScriptDataResolver {
  private readonly configs = new Map<string, CachedValue<IniSections>>();
  private readonly tables = new Map<string, CachedValue<NestedTableDataResult>>();
  private readonly lists = new Map<string, CachedValue<NestedListDataResult>>();
  private readonly databases = new Map<string, CachedDatabaseSources>();
  private sqlModulePromise: Promise<SqlModule> | undefined;

  async prepareFor(sourceFile: string, engine?: EngineId): Promise<void> {
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    if (!envirRoot) return;
    const candidates = databaseCandidates(envirRoot, engine);
    const stamp = fileSetStamp(candidates);
    const key = databaseCacheKey(envirRoot, engine);
    const cached = this.databases.get(key);
    if (cached?.stamp === stamp) return;

    cached?.sources.forEach(source => source.dispose?.());
    const sources: DatabaseFieldSource[] = [];
    let equipmentCatalogComplete = !candidates.some(candidate => /\.db$/i.test(candidate) && !isSqliteFile(candidate));
    const sqliteFiles = candidates.filter(candidate => (
      /\.db$/i.test(candidate) && isSqliteFile(candidate)
    ));
    if (sqliteFiles.length > 0) {
      try {
        const SQL = await this.sqlModule();
        for (const filePath of sqliteFiles) {
          try {
            sources.push(...openSqliteItemSources(SQL, filePath));
          } catch {
            equipmentCatalogComplete = false;
            // A damaged or unrelated DB must not prevent the visual preview.
          }
        }
      } catch {
        equipmentCatalogComplete = false;
        // Database values will fall back to the variable family's safe default.
      }
    }
    for (const filePath of candidates) {
      if (/\.mdb$/i.test(filePath)) {
        const loaded = openAccessItemSources(filePath);
        if (loaded) sources.push(...loaded);
        else equipmentCatalogComplete = false;
      }
      else if (/cfg_item\.xls$/i.test(filePath)) {
        const source = openBiff8ItemSource(filePath);
        if (source) sources.push(source);
      }
    }
    this.databases.set(key, { stamp, sources, equipmentCatalogComplete, equipmentMatches: new Map() });
  }

  optionsFor(sourceFile: string, engine?: EngineId): NestedVariableAnalysisOptions {
    return {
      resolvePreviewGlobalValues: () => this.resolvePreviewGlobalValues(sourceFile, engine),
      resolvePreviewEquipmentSlot: itemName => this.resolvePreviewEquipmentSlot(sourceFile, itemName, engine),
      resolvePreviewEquipmentMatches: pattern => this.resolvePreviewEquipmentMatches(sourceFile, pattern, engine),
      resolveConfigValues: request => this.resolveConfig(sourceFile, request),
      resolveTableData: request => this.resolveTable(sourceFile, request),
      resolvePreviewExcelData: request => this.resolvePreviewExcel(sourceFile, request, engine),
      resolvePreviewCsvData: request => this.resolvePreviewCsv(sourceFile, request, engine),
      resolveListData: request => this.resolveList(sourceFile, request),
      resolveDatabaseField: request => this.resolveDatabaseField(sourceFile, request, engine),
    };
  }

  private resolvePreviewGlobalValues(sourceFile: string, engine?: EngineId): Readonly<Record<string, string>> {
    // GOM server evidence and GXX M2Share.LoadGlobalVal agree on these keys.
    // Read persisted defaults only; never reproduce the server loader's writes.
    if ((engine !== 'GOM' && engine !== 'GEE') || /^[\\/]{2}/.test(sourceFile)) return {};
    const envir = findAncestorDirectory(path.resolve(sourceFile), 'Envir');
    if (!envir) return {};
    const server = path.dirname(envir);
    const file = path.join(server, 'GlobalVal.ini');
    if (!hasOnlyRealPreviewComponents(server, path.dirname(path.resolve(sourceFile)), true)
      || !hasOnlyRealPreviewComponents(server, file)) return {};
    try {
      const before = fs.statSync(file);
      if (before.size > 2 * 1024 * 1024) return {};
      const bytes = fs.readFileSync(file);
      if (!samePreviewFileSnapshot(before, fs.statSync(file)) || bytes.length !== before.size
        || !hasOnlyRealPreviewComponents(server, file)) return {};
      const setup = parseIniSections(decodeTextFile(bytes).text).get('SETUP');
      const values: Record<string, string> = {};
      const ambiguous = new Set<string>();
      for (const [key, entries] of setup || []) {
        const match = /^(GLOBALSTRVAL|GLOBALVAL)(\d{1,4})$/.exec(key);
        if (!match || Number(match[2]) > 999 || entries.length !== 1) continue;
        const value = entries[0];
        const prefix = match[1] === 'GLOBALSTRVAL' ? 'A' : 'G';
        if (value.length > 4096 || (prefix === 'G' && !/^[+-]?\d{1,128}$/.test(value))) continue;
        const name = `${prefix}${Number(match[2])}`;
        if (ambiguous.has(name)) continue;
        if (Object.prototype.hasOwnProperty.call(values, name)) { delete values[name]; ambiguous.add(name); }
        else values[name] = value;
      }
      return values;
    } catch { return {}; }
  }

  private resolvePreviewEquipmentMatches(sourceFile: string, pattern: string, engine?: EngineId): readonly string[] | undefined {
    if (engine !== 'GEE' || !pattern || pattern.startsWith('[') || pattern.length > 512 || /[<>$"\r\n\x00]/.test(pattern)) return undefined;
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    const cached = envirRoot ? this.databases.get(databaseCacheKey(envirRoot, engine)) : undefined;
    if (!cached?.equipmentCatalogComplete || !cached.sources.length) return undefined;
    if (cached.equipmentMatches.has(pattern)) return cached.equipmentMatches.get(pattern);
    const matches = this.resolveEquipmentMatches(cached.sources, pattern);
    if (cached.equipmentMatches.size >= 128) cached.equipmentMatches.clear();
    cached.equipmentMatches.set(pattern, matches);
    return matches;
  }

  private resolveEquipmentMatches(sources: readonly DatabaseFieldSource[], pattern: string): readonly string[] | undefined {
    const matches = new Set<string>();
    const spellings = new Map<string, Set<string>>();
    for (const source of sources) {
      const names = source.itemNames?.();
      if (!names || names.length > 40000) return undefined;
      for (const name of names) {
        const identity = name.replace(/[a-z]/g, char => char.toUpperCase());
        const variants = spellings.get(identity) || new Set<string>();
        variants.add(name); spellings.set(identity, variants);
        if (name.includes(pattern)) {
          // Reject incomplete/unrepresentable sets rather than silently losing matches.
          if (!name || name.startsWith('[') || name.length > 512 || /[<>$"\r\n\x00]/.test(name)) return undefined;
          matches.add(name);
          if (matches.size > 128) return undefined;
        }
      }
    }
    for (const name of matches) {
      if ((spellings.get(name.replace(/[a-z]/g, char => char.toUpperCase()))?.size || 0) > 1) return undefined;
    }
    return [...matches].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  }

  private resolvePreviewEquipmentSlot(sourceFile: string, itemName: string, engine?: EngineId): { key: string; label: string } | undefined {
    if (engine !== 'GOM' && engine !== 'GEE') return undefined;
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    if (!envirRoot) return undefined;
    // Only equipment matching gains this GEE rule. General DB/IDX queries keep
    // their original matching/provenance contract; duplicate matches stay unknown.
    const raw = engine === 'GEE'
      ? resolveUniqueDatabaseValue(this.databases.get(databaseCacheKey(envirRoot, engine))?.sources || [],
        source => source.lookup?.(itemName, 'StdMode', true))
      : this.resolveItemFieldByName(sourceFile, itemName, 'StdMode', engine);
    if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
    const mode = Number(raw);
    if (engine === 'GEE') {
      // GXX M2Share.CheckUserItems + Grobal2 slot constants. Use legal slots,
      // not GetTakeOnPosition's preferred slot: 7/25/28/51/96/97 have multiple
      // legal positions. Rings/bracelets are paired and deliberately omitted.
      // Do not import GOM CustUserItem rules or its different shield/fashion IDs.
      const geeSingleSlots: Array<[number[], number, string]> = [
        [[10,11],0,'衣服'], [[5,6],1,'武器'], [[29,30],2,'勋章'],
        [[19,20,21],3,'项链'], [[15],4,'头盔'], [[54,64],10,'腰带'],
        [[52,62],11,'鞋子'], [[53,63,94],12,'宝石'], [[16],13,'斗笠'],
        [[65],14,'军鼓'], [[12],16,'盾牌'], [[90],17,'灵玉'],
        [[66,67],18,'时装衣服'], [[68,69],19,'时装武器'], [[75,76,77],20,'时装项链'],
        [[78],21,'时装头盔'], [[83],26,'时装勋章'], [[84,85],27,'时装腰带'],
        [[86,87],28,'时装鞋子'], [[88,89],29,'时装宝石'],
      ];
      const match = geeSingleSlots.find(([modes]) => modes.includes(mode));
      return match ? { key: `GEE:${match[1]}`, label: match[2] } : undefined;
    }
    const singleSlots: Array<[number[], number, string]> = [
      [[10,11],0,'衣服'],[[5,6],1,'武器'],[[30],2,'勋章'],[[19,20,21],3,'项链'],[[15],4,'头盔'],
      [[25],9,'毒符'],[[54,64],10,'腰带'],[[52,62],11,'鞋子'],[[7,53,63],12,'宝石'],[[16],13,'斗笠'],
      [[65],14,'军鼓'],[[28],15,'马牌'],[[48],16,'盾牌'],[[66,67],17,'时装衣服'],[[68,69],18,'时装武器'],
      [[75,76,77],19,'时装项链'],[[78],20,'时装头盔'],[[83],25,'时装勋章'],[[84,85],26,'时装腰带'],
      [[86,87],27,'时装鞋子'],[[88,89],28,'时装宝石'],[[90],48,'时装斗笠'],[[91],49,'时装毒符'],
      [[92],50,'时装军鼓'],[[93],51,'时装马牌'],[[94],52,'时装盾牌'],
    ];
    const candidates = singleSlots.filter(([modes]) => modes.includes(mode)).map(([,slot,label]) => ({slot,label}));
    if (mode >= 100 && mode <= 111) candidates.push({slot:mode - 70,label:`首饰盒 ${mode - 99}`});
    const envir = findAncestorDirectory(path.resolve(sourceFile), 'Envir');
    if (!envir || /^[\\/]{2}/.test(sourceFile)) return undefined;
    const server = path.dirname(envir), file = path.join(server, '!Setup.txt');
    if (fs.existsSync(file)) {
      if (!hasOnlyRealPreviewComponents(server, file)) return undefined;
      try {
        const before = fs.statSync(file);
        if (before.size > 2 * 1024 * 1024) return undefined;
        const bytes = fs.readFileSync(file);
        if (!samePreviewFileSnapshot(before, fs.statSync(file))) return undefined;
        const section = parseIniSections(decodeTextFile(bytes).text).get('CUSTUSERITEM');
        for (const [key, values] of section || []) {
          const match = /^WHERE(\d+)$/.exec(key);
          if (!match || Number(match[1]) >= 50) continue;
          if (values.length !== 1) { if (values.includes(raw)) return undefined; continue; }
          if (/^\d+$/.test(values[0]) && Number(values[0]) === mode) candidates.push({slot:71 + Number(match[1]),label:`自定义装备 ${Number(match[1]) + 1}`});
        }
      } catch { return undefined; }
    }
    // Paired rings/bracelets or custom modes allowed in multiple slots must
    // not be incorrectly made mutually exclusive merely by equal StdMode.
    return candidates.length === 1 ? {key:`GOM:${candidates[0].slot}`,label:candidates[0].label} : undefined;
  }

  resolveItemFieldByIndex(
    sourceFile: string,
    itemIndex: number,
    field: string,
    engine?: EngineId
  ): string | undefined {
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || !field.trim()) return undefined;
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    if (!envirRoot) return undefined;
    const sources = this.databases.get(databaseCacheKey(envirRoot, engine))?.sources || [];
    return resolveUniqueDatabaseValue(
      sources,
      source => source.lookupByIndex?.(itemIndex, field)
    );
  }

  resolveItemFieldByName(
    sourceFile: string,
    itemName: string,
    field: string,
    engine?: EngineId
  ): string | undefined {
    return this.resolveDatabaseField(sourceFile, { itemName, field }, engine)?.value;
  }

  dispose(): void {
    for (const cached of this.databases.values()) {
      cached.sources.forEach(source => source.dispose?.());
    }
    this.databases.clear();
  }

  private resolveConfig(
    sourceFile: string,
    request: NestedConfigValueRequest,
  ): NestedConfigValueResult | undefined {
    const configPath = this.resolveDataFile(sourceFile, request.path);
    if (!configPath) return undefined;
    const sections = this.cachedFile(this.configs, configPath, raw => (
      parseIniSections(decodeTextFile(raw).text)
    ));
    if (!sections) return undefined;

    const sectionExpression = stripQuotes(request.section);
    const keyExpression = stripQuotes(request.key);
    const dynamicSection = /<\$/i.test(sectionExpression);
    const dynamicKey = /<\$/i.test(keyExpression);
    const selectedSections = dynamicSection
      ? [...sections.values()]
      : [sections.get(sectionExpression.trim().toUpperCase())]
        .filter((section): section is Map<string, string[]> => section !== undefined);
    if (selectedSections.length === 0) return undefined;

    const values = dynamicKey
      ? selectedSections.flatMap(section => [...section.values()].flat())
      : selectedSections.flatMap(section => (
        section.get(keyExpression.trim().toUpperCase()) || []
      ));
    if (values.length === 0) return undefined;
    return {
      values,
      complete: !dynamicSection && !dynamicKey,
    };
  }

  private resolveTable(
    sourceFile: string,
    request: NestedTableDataRequest,
  ): NestedTableDataResult | undefined {
    const tablePath = this.resolveDataFile(sourceFile, request.path);
    if (!tablePath) return undefined;
    const cacheKey = `${request.format}:${tablePath}`;
    return this.cachedFile(this.tables, cacheKey, raw => {
      if (isBinarySpreadsheet(raw)) {
        return { rows: openXlsTable(Buffer.from(raw)).rows, complete: true };
      }
      return {
        rows: parseScriptTableData(decodeTextFile(raw).text, request.format),
        complete: true,
      };
    }, tablePath);
  }

  private resolvePreviewExcel(
    sourceFile: string,
    request: NestedTableDataRequest,
    engine?: EngineId,
  ): NestedTableDataResult | undefined {
    if ((engine !== 'GOM' && engine !== '996PC') || request.format !== 'excel') return undefined;
    const tablePath = safePreviewTablePath(sourceFile, request.path, 'xls');
    if (!tablePath) return undefined;
    let handle: number | undefined;
    try {
      handle = fs.openSync(tablePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const before = fs.fstatSync(handle);
      // Bound before allocation/read, and read exactly this snapshot's size so
      // a concurrently growing workbook cannot bypass the 16 MiB ceiling.
      if (!before.isFile() || before.nlink !== 1 || before.size < 8 || before.size > 16 * 1024 * 1024) return undefined;
      const buffer = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < buffer.length) {
        const count = fs.readSync(handle, buffer, offset, buffer.length - offset, offset);
        if (count === 0) return undefined;
        offset += count;
      }
      const after = fs.fstatSync(handle);
      if (!samePreviewFileSnapshot(before, after) || safePreviewTablePath(sourceFile, request.path, 'xls') !== tablePath
        || !samePreviewFileSnapshot(after, fs.statSync(tablePath))) return undefined;
      // Deliberately no size+mtime cache: in-place edits can preserve both.
      // Every preview uses the bounded bytes just read from this file handle.
      return readPreviewExcelTable(buffer);
    } catch {
      return undefined;
    } finally {
      if (handle !== undefined) fs.closeSync(handle);
    }
  }

  private resolvePreviewCsv(
    sourceFile: string,
    request: NestedTableDataRequest,
    engine?: EngineId,
  ): NestedTableDataResult | undefined {
    if (engine !== 'GOM' || request.format !== 'csv') return undefined;
    const tablePath = safePreviewTablePath(sourceFile, request.path, 'csv');
    if (!tablePath) return undefined;
    let handle: number | undefined;
    try {
      handle = fs.openSync(tablePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const before = fs.fstatSync(handle);
      if (!before.isFile() || before.nlink !== 1 || before.size > 8 * 1024 * 1024) return undefined;
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = fs.readSync(handle, bytes, offset, bytes.length - offset, offset);
        if (count === 0) return undefined;
        offset += count;
      }
      const after = fs.fstatSync(handle);
      if (!samePreviewFileSnapshot(before, after)
        || safePreviewTablePath(sourceFile, request.path, 'csv') !== tablePath
        || !samePreviewFileSnapshot(after, fs.statSync(tablePath)) || isBinarySpreadsheet(bytes)) return undefined;
      const decoded = decodeTextFile(bytes);
      if (decoded.text.includes('\u0000') || !encodeTextFile(decoded.text, decoded.encoding).equals(bytes)) return undefined;
      // Bound cell allocation before the general CSV parser creates arrays.
      // Counting separators inside quotes is deliberately conservative.
      let separators = 0, lineBreaks = 0;
      for (const character of decoded.text) {
        if (character === ',' && ++separators > 500000) return undefined;
        if ((character === '\n' || character === '\r') && ++lineBreaks > 100000) return undefined;
      }
      const rows = parseScriptTableData(decoded.text, 'csv');
      if (rows.length > 50000 || rows.some(row => row.length > 4096)) return undefined;
      // No size/mtime cache: a new preview must not retain a replaced CSV row.
      return { rows, complete: true };
    } catch {
      return undefined;
    } finally {
      if (handle !== undefined) fs.closeSync(handle);
    }
  }

  private resolveList(
    sourceFile: string,
    request: NestedListDataRequest,
  ): NestedListDataResult | undefined {
    const listPath = this.resolveDataFile(sourceFile, request.path);
    if (!listPath) return undefined;
    return this.cachedFile(this.lists, listPath, raw => ({
      lines: decodeTextFile(raw).text.split(/\r\n|\n|\r/),
      complete: true,
    }));
  }

  private resolveDatabaseField(
    sourceFile: string,
    request: NestedDatabaseFieldRequest,
    engine?: EngineId
  ): NestedDatabaseFieldResult | undefined {
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    if (!envirRoot) return undefined;
    const itemName = stripQuotes(request.itemName).trim();
    const field = stripQuotes(request.field).trim();
    if (!itemName || !field || /<\$/i.test(itemName) || /<\$/i.test(field)) return undefined;
    const sources = this.databases.get(databaseCacheKey(envirRoot, engine))?.sources || [];
    const value = resolveUniqueDatabaseValue(
      sources,
      source => source.lookup?.(itemName, field)
    );
    return value === undefined ? undefined : { value, complete: true };
  }

  private resolveDataFile(sourceFile: string, rawPath: string): string | undefined {
    if (!rawPath || /<\$/i.test(rawPath)) return undefined;
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    if (!envirRoot) return undefined;
    const relativePath = stripQuotes(rawPath);
    const withoutParentPrefix = relativePath.replace(/^(?:\.\.[\\/])+/, '');
    const candidates = path.isAbsolute(relativePath)
      ? [path.resolve(relativePath)]
      : [
        path.resolve(path.dirname(sourceFile), relativePath),
        path.resolve(envirRoot, 'Market_Def', relativePath),
        path.resolve(envirRoot, relativePath),
        path.resolve(envirRoot, withoutParentPrefix),
      ];
    return uniquePaths(candidates).find(isFile);
  }

  private cachedFile<T>(
    cache: Map<string, CachedValue<T>>,
    cacheKey: string,
    parse: (raw: Uint8Array) => T,
    filePath = cacheKey,
  ): T | undefined {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return undefined;
    }
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const cached = cache.get(cacheKey);
    if (cached?.stamp === stamp) return cached.value;
    let value: T | undefined;
    try {
      value = parse(fs.readFileSync(filePath));
    } catch {
      value = undefined;
    }
    cache.set(cacheKey, { stamp, value });
    return value;
  }

  private sqlModule(): Promise<SqlModule> {
    if (!this.sqlModulePromise) {
      const initialize = require('sql.js') as () => Promise<SqlModule>;
      this.sqlModulePromise = initialize();
    }
    return this.sqlModulePromise;
  }
}

function databaseCandidates(envirRoot: string, engine?: EngineId): string[] {
  const serverRoot = path.dirname(path.dirname(envirRoot));
  const legacyDirectory = path.join(serverRoot, 'MUD2', 'db');
  const dataDirectory = path.join(envirRoot, 'Data');
  const result: string[] = [];
  if (engine !== '996PC' && isDirectory(legacyDirectory)) {
    for (const name of fs.readdirSync(legacyDirectory)) {
      if (/\.(?:db|mdb)$/i.test(name)) result.push(path.join(legacyDirectory, name));
    }
  }
  if (engine !== 'GOM' && engine !== 'GEE' && isDirectory(dataDirectory)) {
    for (const name of fs.readdirSync(dataDirectory)) {
      if (/^cfg_item\.xls$/i.test(name)) result.push(path.join(dataDirectory, name));
    }
  }
  return uniquePaths(result).sort((left, right) => left.localeCompare(right));
}

function databaseCacheKey(envirRoot: string, engine?: EngineId): string {
  return `${pathKey(envirRoot)}|${engine || 'ANY'}`;
}

/**
 * A server folder can contain stale copies or migrated item databases beside
 * the active one.  Returning the first matching row makes the preview depend
 * on filename order and can map one database IDX to the wrong Looks image.
 * Accept identical evidence from several sources, but reject conflicting
 * values so ITEMSHOW remains unresolved instead of drawing the wrong item.
 */
function resolveUniqueDatabaseValue(
  sources: readonly DatabaseFieldSource[],
  lookup: (source: DatabaseFieldSource) => string | undefined
): string | undefined {
  let resolved: string | undefined;
  for (const source of sources) {
    let value: string | undefined;
    try {
      value = lookup(source);
    } catch {
      value = undefined;
    }
    if (value === undefined) continue;
    if (resolved !== undefined && resolved !== value) return undefined;
    resolved = value;
  }
  return resolved;
}

function fileSetStamp(files: readonly string[]): string {
  return files.map(filePath => {
    try {
      const stat = fs.statSync(filePath, { bigint: true });
      // Item databases are authoritative for IDX -> Looks. Size and timestamps
      // can survive an in-place replacement, so include exact file bytes in the
      // identity instead of allowing a stale open database to draw another
      // item. Only the engine-selected item DB candidates are hashed here.
      const contentSha256 = crypto.createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex');
      return [
        pathKey(filePath),
        stat.size,
        stat.mtimeNs,
        stat.ctimeNs,
        stat.birthtimeNs,
        stat.ino,
        contentSha256,
      ].join(':');
    } catch {
      return `${pathKey(filePath)}:missing`;
    }
  }).join('|');
}

function openSqliteItemSources(SQL: SqlModule, filePath: string): DatabaseFieldSource[] {
  const database = new SQL.Database(fs.readFileSync(filePath));
  const tableRows = database.exec("SELECT name FROM sqlite_master WHERE type='table'")[0]?.values || [];
  const sources: DatabaseFieldSource[] = [];
  for (const row of tableRows) {
    const tableName = String(row[0] ?? '');
    if (!isItemTableName(tableName)) continue;
    const columns = database.exec(`PRAGMA table_info(${quoteIdentifier(tableName)})`)[0]?.values
      .map(value => String(value[1] ?? ''))
      .filter(Boolean) || [];
    const nameColumn = findColumn(columns, ['NAME', 'ITEMNAME']);
    const indexColumn = findColumn(columns, ['IDX', 'INDEX']);
    if (!nameColumn && !indexColumn) continue;
    const columnLookup = createColumnLookup(columns);
    let names: readonly string[] | undefined;
    let namesRead = false;
    sources.push({
      itemNames() {
        if (!nameColumn) return undefined;
        if (!namesRead) {
          namesRead = true;
          const rows = database.exec(`SELECT ${quoteIdentifier(nameColumn)} FROM ${quoteIdentifier(tableName)} LIMIT 40001`)[0]?.values || [];
          if (rows.length <= 40000) names = rows.map(row => String(row[0] ?? '').trim()).filter(Boolean);
        }
        return names;
      },
      lookup(itemName, field, ignoreAsciiCase = false) {
        if (!nameColumn) return undefined;
        const column = lookupColumn(columnLookup, field);
        if (!column) return undefined;
        const statement = database.prepare(
          `SELECT ${quoteIdentifier(column)} AS value FROM ${quoteIdentifier(tableName)} `
          + `WHERE TRIM(${quoteIdentifier(nameColumn)}) = ?${ignoreAsciiCase ? ' COLLATE NOCASE' : ''}`
        );
        try {
          statement.bind([itemName]);
          let value: string | undefined;
          let matches = 0;
          while (statement.step()) {
            matches++;
            if (matches > 1) return undefined;
            value = normalizeDatabaseValue(statement.getAsObject().value);
          }
          return matches === 1 ? value : undefined;
        } finally {
          statement.free();
        }
      },
      lookupByIndex(itemIndex, field) {
        if (!indexColumn) return undefined;
        const column = lookupColumn(columnLookup, field);
        if (!column) return undefined;
        const statement = database.prepare(
          `SELECT ${quoteIdentifier(column)} AS value FROM ${quoteIdentifier(tableName)} `
          + `WHERE ${quoteIdentifier(indexColumn)} = ?`
        );
        try {
          statement.bind([itemIndex]);
          let value: string | undefined;
          let matches = 0;
          while (statement.step()) {
            matches++;
            if (matches > 1) return undefined;
            value = normalizeDatabaseValue(statement.getAsObject().value);
          }
          return matches === 1 ? value : undefined;
        } finally {
          statement.free();
        }
      },
    });
  }
  if (sources.length === 0) {
    database.close();
    return [];
  }
  const dispose = () => database.close();
  sources[0].dispose = dispose;
  return sources;
}

function openAccessItemSources(filePath: string): DatabaseFieldSource[] | undefined {
  try {
    const module = require('mdb-reader') as {
      default?: new (buffer: Buffer) => {
        getTableNames(): string[];
        getTable(name: string): { getColumnNames(): string[]; getData(): Record<string, unknown>[] };
      };
    } | (new (buffer: Buffer) => {
      getTableNames(): string[];
      getTable(name: string): { getColumnNames(): string[]; getData(): Record<string, unknown>[] };
    });
    const MDBReader = typeof module === 'function' ? module : module.default;
    if (!MDBReader) return undefined;
    const reader = new MDBReader(fs.readFileSync(filePath));
    const result: DatabaseFieldSource[] = [];
    for (const tableName of reader.getTableNames()) {
      if (!isItemTableName(tableName)) continue;
      const table = reader.getTable(tableName);
      const columns = table.getColumnNames();
      const nameColumn = findColumn(columns, ['NAME', 'ITEMNAME']);
      const indexColumn = findColumn(columns, ['IDX', 'INDEX']);
      if (!nameColumn && !indexColumn) continue;
      const columnLookup = createColumnLookup(columns);
      const rows = new Map<string, Record<string, unknown>>();
      const rowsByIndex = new Map<number, Record<string, unknown>>();
      const ambiguousNames = new Set<string>();
      const ambiguousIndexes = new Set<number>();
      const names: string[] = [];
      for (const row of table.getData()) {
        if (nameColumn) {
          const spelling = String(row[nameColumn] ?? '').trim();
          if (spelling) names.push(spelling);
          const name = String(row[nameColumn] ?? '').trim().toLocaleUpperCase();
          if (name) {
            if (rows.has(name)) ambiguousNames.add(name);
            else rows.set(name, row);
          }
        }
        if (indexColumn) {
          const itemIndex = Number(row[indexColumn]);
          if (Number.isInteger(itemIndex)) {
            if (rowsByIndex.has(itemIndex)) ambiguousIndexes.add(itemIndex);
            else rowsByIndex.set(itemIndex, row);
          }
        }
      }
      result.push({
        itemNames: () => nameColumn && names.length <= 40000 ? names : undefined,
        lookup(itemName, field) {
          const column = lookupColumn(columnLookup, field);
          const key = itemName.trim().toLocaleUpperCase();
          if (ambiguousNames.has(key)) return undefined;
          const row = rows.get(key);
          return column && row ? normalizeDatabaseValue(row[column]) : undefined;
        },
        lookupByIndex(itemIndex, field) {
          if (ambiguousIndexes.has(itemIndex)) return undefined;
          const column = lookupColumn(columnLookup, field);
          const row = rowsByIndex.get(itemIndex);
          return column && row ? normalizeDatabaseValue(row[column]) : undefined;
        },
      });
    }
    return result;
  } catch {
    return undefined;
  }
}

function openBiff8ItemSource(filePath: string): DatabaseFieldSource | undefined {
  try {
    const rows = openXlsTable(fs.readFileSync(filePath)).rows;
    if (rows.length < 3 || !String(rows[0]?.[0] || '').trim().toLowerCase().startsWith('//;ver')) {
      return undefined;
    }
    const columns = rows[2].map(value => String(value || '').trim());
    const nameIndex = findColumnIndex(columns, ['NAME', 'ITEMNAME']);
    const itemIndexColumn = findColumnIndex(columns, ['IDX', 'INDEX']);
    if (nameIndex < 0 && itemIndexColumn < 0) return undefined;
    const columnLookup = createColumnLookup(columns);
    const itemRows = new Map<string, string[]>();
    const itemRowsByIndex = new Map<number, string[]>();
    const ambiguousNames = new Set<string>();
    const ambiguousIndexes = new Set<number>();
    for (const row of rows.slice(3)) {
      if (nameIndex >= 0) {
        const name = String(row[nameIndex] ?? '').trim().toLocaleUpperCase();
        if (name) {
          if (itemRows.has(name)) ambiguousNames.add(name);
          else itemRows.set(name, row);
        }
      }
      if (itemIndexColumn >= 0) {
        const itemIndex = Number(row[itemIndexColumn]);
        if (Number.isInteger(itemIndex)) {
          if (itemRowsByIndex.has(itemIndex)) ambiguousIndexes.add(itemIndex);
          else itemRowsByIndex.set(itemIndex, row);
        }
      }
    }
    return {
      lookup(itemName, field) {
        const column = lookupColumn(columnLookup, field);
        const columnIndex = column ? columns.indexOf(column) : -1;
        const key = itemName.trim().toLocaleUpperCase();
        if (ambiguousNames.has(key)) return undefined;
        const row = itemRows.get(key);
        return row && columnIndex >= 0 ? normalizeDatabaseValue(row[columnIndex]) : undefined;
      },
      lookupByIndex(itemIndex, field) {
        if (ambiguousIndexes.has(itemIndex)) return undefined;
        const column = lookupColumn(columnLookup, field);
        const columnIndex = column ? columns.indexOf(column) : -1;
        const row = itemRowsByIndex.get(itemIndex);
        return row && columnIndex >= 0 ? normalizeDatabaseValue(row[columnIndex]) : undefined;
      },
    };
  } catch {
    return undefined;
  }
}

function createColumnLookup(columns: readonly string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const column of columns) {
    const normalized = normalizeDatabaseIdentifier(column);
    if (!normalized) continue;
    result.set(normalized, column);
    result.set(normalized.replace(/^FLD/, ''), column);
    if (normalized === 'INDEX') result.set('IDX', column);
    if (normalized === 'IDX') result.set('INDEX', column);
  }
  return result;
}

function lookupColumn(columns: ReadonlyMap<string, string>, field: string): string | undefined {
  const normalized = normalizeDatabaseIdentifier(field);
  return columns.get(normalized) || columns.get(normalized.replace(/^FLD/, ''));
}

function findColumn(columns: readonly string[], priorities: readonly string[]): string | undefined {
  const lookup = createColumnLookup(columns);
  return priorities.map(priority => lookupColumn(lookup, priority)).find(Boolean);
}

function findColumnIndex(columns: readonly string[], priorities: readonly string[]): number {
  const column = findColumn(columns, priorities);
  return column ? columns.indexOf(column) : -1;
}

function isItemTableName(value: string): boolean {
  return /^(?:STDITEMS?|ITEMS?|CFGITEM)$/i.test(normalizeDatabaseIdentifier(value));
}

function normalizeDatabaseIdentifier(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function normalizeDatabaseValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Buffer.isBuffer(value)) return decodeTextFile(value).text.replace(/\0+$/g, '').trim();
  return String(value).trim();
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function isSqliteFile(filePath: string): boolean {
  try {
    const handle = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(16);
      fs.readSync(handle, header, 0, header.length, 0);
      return header.toString('ascii') === 'SQLite format 3\0';
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return false;
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function pathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

function samePreviewFileSnapshot(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.nlink === right.nlink;
}

function insidePreviewRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** Reject links at every level, including an in-root junction to another in-root folder. */
function hasOnlyRealPreviewComponents(root: string, target: string, directoryTarget = false): boolean {
  if (target !== root && !insidePreviewRoot(root, target)) return false;
  try {
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || pathKey(fs.realpathSync(root)) !== pathKey(root)) return false;
    const segments = path.relative(root, target).split(path.sep).filter(Boolean);
    let current = root;
    for (let index = 0; index < segments.length; index++) {
      current = path.join(current, segments[index]);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return false;
      const directory = index < segments.length - 1 || directoryTarget;
      if (directory ? !stat.isDirectory() : !stat.isFile()) return false;
    }
    return pathKey(fs.realpathSync(target)) === pathKey(target);
  } catch { return false; }
}

function safePreviewTablePath(sourceFile: string, rawPath: string, extension: 'xls' | 'csv'): string | undefined {
  if (!rawPath || /^[\\/]{2}/.test(sourceFile) || /[\u0000-\u001f]|<\$/.test(rawPath)) return undefined;
  const trimmed = rawPath.trim();
  const relativePath = /^(?:".*"|'.*')$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
  // Block UNC/device paths, URLs, drive-relative paths and alternate streams
  // before probing the filesystem. Absolute paths are allowed only inside
  // the same proven local Envir boundary below.
  if (path.extname(relativePath).toLowerCase() !== `.${extension}` || /^[\\/]{2}|^[A-Za-z]:[^\\/]/.test(relativePath)
    || relativePath.replace(/^[A-Za-z]:/, '').includes(':')) return undefined;
  const sourcePath = path.resolve(sourceFile);
  const root = findAncestorDirectory(sourcePath, 'Envir');
  if (!root || !hasOnlyRealPreviewComponents(root, path.dirname(sourcePath), true)) return undefined;
  try {
    // New unsaved files in a real source directory are allowed; an existing
    // symlink document must not grant its target's unrelated Envir authority.
    if (fs.existsSync(sourcePath) && fs.lstatSync(sourcePath).isSymbolicLink()) return undefined;
  } catch { return undefined; }
  const normalized = relativePath.replace(/[\\/]/g, path.sep);
  const candidates = path.isAbsolute(normalized) ? [path.resolve(normalized)] : [
    path.resolve(path.dirname(sourcePath), normalized),
    path.resolve(root, 'Market_Def', normalized),
    path.resolve(root, normalized),
  ];
  const valid = uniquePaths(candidates).filter(candidate => insidePreviewRoot(root, candidate)
    && hasOnlyRealPreviewComponents(root, candidate));
  // Several different existing candidates are ambiguous; never select by
  // filename order or strip excess ../ prefixes until some file happens to fit.
  return valid.length === 1 ? valid[0] : undefined;
}

function parseIniSections(text: string): IniSections {
  const sections: IniSections = new Map();
  let current: Map<string, string[]> | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('//')) continue;
    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      const name = sectionMatch[1].trim().toUpperCase();
      current = sections.get(name) || new Map<string, string[]>();
      sections.set(name, current);
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toUpperCase();
    const values = current.get(key) || [];
    values.push(line.slice(separator + 1).trim());
    current.set(key, values);
  }
  return sections;
}

function findAncestorDirectory(filePath: string, directoryName: string): string | undefined {
  let current = path.dirname(path.resolve(filePath));
  while (true) {
    if (path.basename(current).toUpperCase() === directoryName.toUpperCase()) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function uniquePaths(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = process.platform === 'win32' ? value.toLowerCase() : value;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
