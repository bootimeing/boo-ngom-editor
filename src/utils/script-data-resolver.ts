import * as fs from 'fs';
import * as path from 'path';
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
import { decodeTextFile } from './text';
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
  lookup?(itemName: string, field: string): string | undefined;
  lookupByIndex?(itemIndex: number, field: string): string | undefined;
  dispose?(): void;
}

interface CachedDatabaseSources {
  stamp: string;
  sources: DatabaseFieldSource[];
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

  async prepareFor(sourceFile: string): Promise<void> {
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    if (!envirRoot) return;
    const candidates = databaseCandidates(envirRoot);
    const stamp = fileSetStamp(candidates);
    const key = pathKey(envirRoot);
    const cached = this.databases.get(key);
    if (cached?.stamp === stamp) return;

    cached?.sources.forEach(source => source.dispose?.());
    const sources: DatabaseFieldSource[] = [];
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
            // A damaged or unrelated DB must not prevent the visual preview.
          }
        }
      } catch {
        // Database values will fall back to the variable family's safe default.
      }
    }
    for (const filePath of candidates) {
      if (/\.mdb$/i.test(filePath)) sources.push(...openAccessItemSources(filePath));
      else if (/cfg_item\.xlsx?$/i.test(filePath)) {
        const source = openBiff8ItemSource(filePath);
        if (source) sources.push(source);
      }
    }
    this.databases.set(key, { stamp, sources });
  }

  optionsFor(sourceFile: string): NestedVariableAnalysisOptions {
    return {
      resolveConfigValues: request => this.resolveConfig(sourceFile, request),
      resolveTableData: request => this.resolveTable(sourceFile, request),
      resolveListData: request => this.resolveList(sourceFile, request),
      resolveDatabaseField: request => this.resolveDatabaseField(sourceFile, request),
    };
  }

  resolveItemFieldByIndex(
    sourceFile: string,
    itemIndex: number,
    field: string
  ): string | undefined {
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || !field.trim()) return undefined;
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    if (!envirRoot) return undefined;
    const sources = this.databases.get(pathKey(envirRoot))?.sources || [];
    for (const source of sources) {
      if (!source.lookupByIndex) continue;
      try {
        const value = source.lookupByIndex(itemIndex, field);
        if (value !== undefined) return value;
      } catch {
        // Continue with the next configured item database.
      }
    }
    return undefined;
  }

  resolveItemFieldByName(
    sourceFile: string,
    itemName: string,
    field: string
  ): string | undefined {
    return this.resolveDatabaseField(sourceFile, { itemName, field })?.value;
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
  ): NestedDatabaseFieldResult | undefined {
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    if (!envirRoot) return undefined;
    const itemName = stripQuotes(request.itemName).trim();
    const field = stripQuotes(request.field).trim();
    if (!itemName || !field || /<\$/i.test(itemName) || /<\$/i.test(field)) return undefined;
    const sources = this.databases.get(pathKey(envirRoot))?.sources || [];
    for (const source of sources) {
      if (!source.lookup) continue;
      let value: string | undefined;
      try {
        value = source.lookup(itemName, field);
      } catch {
        value = undefined;
      }
      if (value !== undefined) return { value, complete: true };
    }
    return undefined;
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

function databaseCandidates(envirRoot: string): string[] {
  const serverRoot = path.dirname(path.dirname(envirRoot));
  const legacyDirectory = path.join(serverRoot, 'MUD2', 'db');
  const dataDirectory = path.join(envirRoot, 'Data');
  const result: string[] = [];
  if (isDirectory(legacyDirectory)) {
    for (const name of fs.readdirSync(legacyDirectory)) {
      if (/\.(?:db|mdb)$/i.test(name)) result.push(path.join(legacyDirectory, name));
    }
  }
  if (isDirectory(dataDirectory)) {
    for (const name of fs.readdirSync(dataDirectory)) {
      if (/^cfg_item\.xlsx?$/i.test(name)) result.push(path.join(dataDirectory, name));
    }
  }
  return uniquePaths(result).sort((left, right) => left.localeCompare(right));
}

function fileSetStamp(files: readonly string[]): string {
  return files.map(filePath => {
    try {
      const stat = fs.statSync(filePath);
      return `${pathKey(filePath)}:${stat.size}:${stat.mtimeMs}`;
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
    sources.push({
      lookup(itemName, field) {
        if (!nameColumn) return undefined;
        const column = lookupColumn(columnLookup, field);
        if (!column) return undefined;
        const statement = database.prepare(
          `SELECT ${quoteIdentifier(column)} AS value FROM ${quoteIdentifier(tableName)} `
          + `WHERE TRIM(${quoteIdentifier(nameColumn)}) = ? LIMIT 1`
        );
        try {
          statement.bind([itemName]);
          if (!statement.step()) return undefined;
          return normalizeDatabaseValue(statement.getAsObject().value);
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
          + `WHERE ${quoteIdentifier(indexColumn)} = ? LIMIT 1`
        );
        try {
          statement.bind([itemIndex]);
          if (!statement.step()) return undefined;
          return normalizeDatabaseValue(statement.getAsObject().value);
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

function openAccessItemSources(filePath: string): DatabaseFieldSource[] {
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
    if (!MDBReader) return [];
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
      for (const row of table.getData()) {
        if (nameColumn) {
          const name = String(row[nameColumn] ?? '').trim().toLocaleUpperCase();
          if (name && !rows.has(name)) rows.set(name, row);
        }
        if (indexColumn) {
          const itemIndex = Number(row[indexColumn]);
          if (Number.isInteger(itemIndex) && !rowsByIndex.has(itemIndex)) rowsByIndex.set(itemIndex, row);
        }
      }
      result.push({
        lookup(itemName, field) {
          const column = lookupColumn(columnLookup, field);
          const row = rows.get(itemName.trim().toLocaleUpperCase());
          return column && row ? normalizeDatabaseValue(row[column]) : undefined;
        },
        lookupByIndex(itemIndex, field) {
          const column = lookupColumn(columnLookup, field);
          const row = rowsByIndex.get(itemIndex);
          return column && row ? normalizeDatabaseValue(row[column]) : undefined;
        },
      });
    }
    return result;
  } catch {
    return [];
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
    for (const row of rows.slice(3)) {
      if (nameIndex >= 0) {
        const name = String(row[nameIndex] ?? '').trim().toLocaleUpperCase();
        if (name && !itemRows.has(name)) itemRows.set(name, row);
      }
      if (itemIndexColumn >= 0) {
        const itemIndex = Number(row[itemIndexColumn]);
        if (Number.isInteger(itemIndex) && !itemRowsByIndex.has(itemIndex)) {
          itemRowsByIndex.set(itemIndex, row);
        }
      }
    }
    return {
      lookup(itemName, field) {
        const column = lookupColumn(columnLookup, field);
        const columnIndex = column ? columns.indexOf(column) : -1;
        const row = itemRows.get(itemName.trim().toLocaleUpperCase());
        return row && columnIndex >= 0 ? normalizeDatabaseValue(row[columnIndex]) : undefined;
      },
      lookupByIndex(itemIndex, field) {
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
