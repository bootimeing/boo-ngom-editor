import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Biff8DatabaseSession } from './biff8-database';

export type DatabaseKind = 'sqlite' | 'access' | 'biff8';
export type DatabaseProfile = 'legacy' | '996pc';
export type DatabaseSortDirection = 'asc' | 'desc';

export interface DatabaseTableInfo {
  id: string;
  name: string;
  label: string;
  fileName: string;
  kind: DatabaseKind;
  rowCount: number;
  columns: string[];
  columnTypes: Record<string, string>;
  columnLabels: Record<string, string>;
  columnDescriptions: Record<string, string>;
  editable: boolean;
  schemaEditable: boolean;
  schemaEditReason: string;
  sortMode: 'database' | 'page';
}

export interface DatabaseCatalog {
  dbType: string;
  totalCount: number;
  tables: DatabaseTableInfo[];
}

export interface DatabaseColumnFilter {
  column: string;
  values: (string | number)[];
}

export interface DatabasePageRequest {
  tableId: string;
  offset: number;
  limit: number;
  query: string;
  searchColumn?: string;
  matchMode?: 'contains' | 'exact';
  filters?: DatabaseColumnFilter[];
  filterColumn?: string;
  filterValues?: (string | number)[];
  sortColumn: string;
  sortDirection: DatabaseSortDirection;
}

export interface DatabasePage {
  tableId: string;
  columns: string[];
  rows: Record<string, unknown>[];
  offset: number;
  limit: number;
  total: number;
  query: string;
  searchColumn: string;
  matchMode: 'contains' | 'exact';
  filters: DatabaseColumnFilter[];
  filterColumn: string;
  filterValues: (string | number)[];
  sortColumn: string;
  sortDirection: DatabaseSortDirection;
}

export interface DatabaseSchemaColumnUpdate {
  sourceName: string;
  name: string;
  type: string;
}

export interface DatabaseRowUpdate {
  rowId: unknown;
  values: Record<string, unknown>;
}

export type DatabaseMutationOperation = 'create' | 'update' | 'delete' | 'schema';

export interface DatabaseMutationResult {
  operation: DatabaseMutationOperation;
  tableId: string;
  rowCount: number;
  backupPath: string;
  rowId?: number;
}

export interface DatabaseUndoResult {
  operation: 'undo';
  revertedOperation: DatabaseMutationOperation;
  tableId: string;
  rowCount: number;
  backupPath: string;
  rowId?: number;
}

interface DatabaseUndoEntry {
  mutation: DatabaseMutationResult;
  filePath: string;
  postMutationSha256: string;
}

interface SqliteColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKeyOrder: number;
}

interface NormalizedSchemaColumn {
  source?: SqliteColumnInfo;
  name: string;
  type: string;
}

interface TableSource extends DatabaseTableInfo {
  filePath: string;
  sqliteSchema: SqliteColumnInfo[];
  hasRowId: boolean;
}

interface SqlStatement {
  bind(values?: unknown[]): boolean;
  step(): boolean;
  get(): unknown[];
  getAsObject(): Record<string, unknown>;
  getColumnNames(): string[];
  free(): void;
}

interface SqlDatabase {
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlStatement;
  export(): Uint8Array;
  getRowsModified(): number;
  close(): void;
}

interface SqlModule {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

interface AccessTable {
  rowCount: number;
  getColumnNames(): string[];
  getData(options?: { rowOffset?: number; rowLimit?: number }): unknown[];
}

interface AccessReader {
  getTableNames(): string[];
  getTable(name: string): AccessTable;
}

let sqlModulePromise: Promise<SqlModule> | undefined;

function getSqlModule(): Promise<SqlModule> {
  if (!sqlModulePromise) {
    const initialize = require('sql.js') as () => Promise<SqlModule>;
    sqlModulePromise = initialize();
  }
  return sqlModulePromise;
}

export class DatabaseRequestCancelledError extends Error {
  constructor() {
    super('Database page request was superseded');
    this.name = 'DatabaseRequestCancelledError';
  }
}

export class DatabaseBrowserSession {
  private catalog: DatabaseCatalog | undefined;
  private readonly sources = new Map<string, TableSource>();
  private activeSqlite: { filePath: string; database: SqlDatabase } | undefined;
  private activeAccess: { filePath: string; reader: AccessReader } | undefined;
  private disposed = false;
  private sourceSequence = 0;
  private readonly biff8Session: Biff8DatabaseSession | undefined;
  private readonly undoStack: DatabaseUndoEntry[] = [];

  constructor(
    private readonly dbDirectory: string,
    profile: DatabaseProfile = 'legacy'
  ) {
    this.biff8Session = profile === '996pc'
      ? new Biff8DatabaseSession(dbDirectory)
      : undefined;
  }

  async initialize(): Promise<DatabaseCatalog> {
    this.assertAvailable();
    if (this.biff8Session) return this.biff8Session.initialize();
    if (this.catalog) return this.catalog;

    const tables: TableSource[] = [];
    const databaseLabels: string[] = [];
    if (fs.existsSync(this.dbDirectory)) {
      const fileNames = fs.readdirSync(this.dbDirectory).sort((left, right) => left.localeCompare(right));
      const sqliteFiles = fileNames.filter(file => /\.db$/i.test(file));
      const accessFiles = fileNames.filter(file => /\.mdb$/i.test(file));

      if (sqliteFiles.length > 0) {
        const SQL = await getSqlModule();
        for (const fileName of sqliteFiles) {
          const filePath = path.join(this.dbDirectory, fileName);
          let database: SqlDatabase | undefined;
          try {
            database = new SQL.Database(fs.readFileSync(filePath));
            const tableNames = readSqliteTableNames(database);
            for (const tableName of tableNames) {
              const sqliteSchema = readSqliteSchema(database, tableName);
              const rowCount = readSqliteCount(database, tableName);
              const hasRowId = readSqliteHasRowId(database, tableName, sqliteSchema);
              const schemaEditReason = readSchemaEditReason(database, tableName, hasRowId);
              tables.push(this.createSource(
                'sqlite',
                fileName,
                filePath,
                tableName,
                rowCount,
                sqliteSchema.map(column => column.name),
                sqliteSchema,
                hasRowId,
                schemaEditReason
              ));
            }
            if (tableNames.length > 0) databaseLabels.push(`SQLite (.DB) - ${fileName}`);
          } finally {
            database?.close();
          }
        }
      }

      if (tables.length === 0) {
        const module = require('mdb-reader') as { default?: new (buffer: Buffer) => AccessReader } | (new (buffer: Buffer) => AccessReader);
        const MDBReader = typeof module === 'function' ? module : module.default;
        if (MDBReader) {
          for (const fileName of accessFiles) {
            const filePath = path.join(this.dbDirectory, fileName);
            const reader = new MDBReader(fs.readFileSync(filePath));
            const tableNames = reader.getTableNames();
            for (const tableName of tableNames) {
              const table = reader.getTable(tableName);
              tables.push(this.createSource(
                'access',
                fileName,
                filePath,
                tableName,
                table.rowCount,
                table.getColumnNames(),
                [],
                false,
                'Access (.MDB) 数据库仅支持读取'
              ));
            }
            if (tableNames.length > 0) databaseLabels.push(`Access (.MDB) - ${fileName}`);
          }
        }
      }
    }

    tables.sort(compareTableSources);
    applyUniqueTableLabels(tables);
    for (const table of tables) this.sources.set(table.id, table);
    this.catalog = {
      dbType: databaseLabels.join(', ') || '未找到数据库文件 (检查 MUD2\\db\\)',
      totalCount: tables.reduce((sum, table) => sum + table.rowCount, 0),
      tables: tables.map(toPublicTableInfo),
    };
    return this.catalog;
  }

  async loadPage(
    request: DatabasePageRequest,
    isCancelled: () => boolean = () => false
  ): Promise<DatabasePage> {
    this.assertAvailable();
    if (this.biff8Session) {
      try {
        return await this.biff8Session.loadPage(request, isCancelled);
      } catch (error) {
        if (error instanceof Error && error.message === 'Database page request was superseded') {
          throw new DatabaseRequestCancelledError();
        }
        throw error;
      }
    }
    if (!this.catalog) await this.initialize();
    const source = this.sources.get(request.tableId);
    if (!source) throw new Error('数据库表不存在或已刷新');

    const limit = Math.max(20, Math.min(200, Math.floor(Number(request.limit) || 100)));
    const offset = Math.max(0, Math.floor(Number(request.offset) || 0));
    const query = String(request.query || '').trim().slice(0, 200);
    const searchColumn = source.columns.includes(request.searchColumn || '') ? String(request.searchColumn) : '';
    const matchMode = request.matchMode === 'exact' ? 'exact' : 'contains';
    const filters = normalizePageFilters(source, request);
    const sortColumn = source.columns.includes(request.sortColumn) ? request.sortColumn : '';
    const sortDirection: DatabaseSortDirection = request.sortDirection === 'desc' ? 'desc' : 'asc';
    if (isCancelled()) throw new DatabaseRequestCancelledError();

    if (source.kind === 'sqlite') {
      return this.loadSqlitePage(
        source,
        offset,
        limit,
        query,
        searchColumn,
        matchMode,
        filters,
        sortColumn,
        sortDirection
      );
    }
    return this.loadAccessPage(
      source,
      offset,
      limit,
      query,
      searchColumn,
      matchMode,
      filters,
      sortColumn,
      sortDirection,
      isCancelled
    );
  }

  async createRow(tableId: string, values: Record<string, unknown>): Promise<DatabaseMutationResult> {
    if (this.biff8Session) {
      const result = this.biff8Session.createRow(tableId, values);
      this.recordUndo(result, this.biff8Session.filePathForTable(tableId));
      return result;
    }
    const source = await this.getWritableSource(tableId);
    const entries = this.normalizeMutationValues(source, values);
    let rowId = 0;
    const backupPath = await this.persistSqliteMutation(source, database => {
      if (entries.length === 0) {
        runPreparedStatement(database, `INSERT INTO ${quoteIdentifier(source.name)} DEFAULT VALUES`, []);
      } else {
        const columns = entries.map(([column]) => quoteIdentifier(column)).join(', ');
        const placeholders = entries.map(() => '?').join(', ');
        runPreparedStatement(
          database,
          `INSERT INTO ${quoteIdentifier(source.name)} (${columns}) VALUES (${placeholders})`,
          entries.map(([, value]) => value)
        );
      }
      rowId = readPreparedScalar(database, 'SELECT last_insert_rowid()', []);
    });
    source.rowCount++;
    this.refreshCatalogSource(source, 1);
    const result: DatabaseMutationResult = {
      operation: 'create', tableId, rowCount: source.rowCount, backupPath, rowId,
    };
    this.recordUndo(result, source.filePath);
    return result;
  }

  async updateRow(
    tableId: string,
    rowId: unknown,
    values: Record<string, unknown>
  ): Promise<DatabaseMutationResult> {
    if (this.biff8Session) {
      const result = this.biff8Session.updateRow(tableId, rowId, values);
      this.recordUndo(result, this.biff8Session.filePathForTable(tableId));
      return result;
    }
    const source = await this.getWritableSource(tableId);
    const normalizedRowId = normalizeRowId(rowId);
    const entries = this.normalizeMutationValues(source, values);
    if (entries.length === 0) throw new Error('没有可修改的字段');
    const assignments = entries.map(([column]) => `${quoteIdentifier(column)} = ?`).join(', ');
    const backupPath = await this.persistSqliteMutation(source, database => {
      runPreparedStatement(
        database,
        `UPDATE ${quoteIdentifier(source.name)} SET ${assignments} WHERE rowid = ?`,
        [...entries.map(([, value]) => value), normalizedRowId]
      );
      if (database.getRowsModified() !== 1) throw new Error('记录不存在或已被其他操作修改');
    });
    const result: DatabaseMutationResult = {
      operation: 'update', tableId, rowCount: source.rowCount, backupPath, rowId: normalizedRowId,
    };
    this.recordUndo(result, source.filePath);
    return result;
  }

  async updateRows(
    tableId: string,
    updates: DatabaseRowUpdate[]
  ): Promise<DatabaseMutationResult> {
    if (this.biff8Session) {
      const result = this.biff8Session.updateRows(tableId, updates);
      this.recordUndo(result, this.biff8Session.filePathForTable(tableId));
      return result;
    }
    const source = await this.getWritableSource(tableId);
    const normalized = this.normalizeRowUpdates(source, updates);
    const backupPath = await this.persistSqliteMutation(source, database => {
      for (const update of normalized) {
        const assignments = update.entries
          .map(([column]) => `${quoteIdentifier(column)} = ?`)
          .join(', ');
        runPreparedStatement(
          database,
          `UPDATE ${quoteIdentifier(source.name)} SET ${assignments} WHERE rowid = ?`,
          [...update.entries.map(([, value]) => value), update.rowId]
        );
        if (database.getRowsModified() !== 1) {
          throw new Error(`记录 ${update.rowId} 不存在或已被其他操作修改`);
        }
      }
    });
    const result: DatabaseMutationResult = {
      operation: 'update',
      tableId,
      rowCount: source.rowCount,
      backupPath,
      rowId: normalized[0].rowId,
    };
    this.recordUndo(result, source.filePath);
    return result;
  }

  async deleteRow(tableId: string, rowId: unknown): Promise<DatabaseMutationResult> {
    if (this.biff8Session) {
      const result = this.biff8Session.deleteRow(tableId, rowId);
      this.recordUndo(result, this.biff8Session.filePathForTable(tableId));
      return result;
    }
    const source = await this.getWritableSource(tableId);
    const normalizedRowId = normalizeRowId(rowId);
    const backupPath = await this.persistSqliteMutation(source, database => {
      runPreparedStatement(
        database,
        `DELETE FROM ${quoteIdentifier(source.name)} WHERE rowid = ?`,
        [normalizedRowId]
      );
      if (database.getRowsModified() !== 1) throw new Error('记录不存在或已被其他操作删除');
    });
    source.rowCount = Math.max(0, source.rowCount - 1);
    this.refreshCatalogSource(source, -1);
    const result: DatabaseMutationResult = {
      operation: 'delete', tableId, rowCount: source.rowCount, backupPath, rowId: normalizedRowId,
    };
    this.recordUndo(result, source.filePath);
    return result;
  }

  async updateSchema(
    tableId: string,
    columns: DatabaseSchemaColumnUpdate[]
  ): Promise<DatabaseMutationResult> {
    this.assertAvailable();
    if (this.biff8Session) {
      const result = this.biff8Session.updateSchema(tableId, columns);
      this.recordUndo(result, this.biff8Session.filePathForTable(tableId));
      return result;
    }
    if (!this.catalog) await this.initialize();
    const source = this.sources.get(tableId);
    if (!source) throw new Error('数据库表不存在或已刷新');
    if (!source.schemaEditable) throw new Error(source.schemaEditReason || '当前数据表不支持字段结构修改');

    const targetColumns = normalizeSchemaUpdate(source, columns);
    const temporaryTable = `__boo_schema_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
    const targetDefinitions = buildSchemaDefinitions(source, targetColumns);
    const targetNames = targetColumns.map(column => quoteIdentifier(column.name)).join(', ');
    const selectValues = targetColumns.map(column => column.source
      ? quoteIdentifier(column.source.name)
      : 'NULL').join(', ');
    const backupPath = await this.persistSqliteMutation(source, database => {
      database.exec(`CREATE TABLE ${quoteIdentifier(temporaryTable)} (${targetDefinitions.join(', ')})`);
      if (source.rowCount > 0) {
        database.exec(
          `INSERT INTO ${quoteIdentifier(temporaryTable)} (${targetNames}) ` +
          `SELECT ${selectValues} FROM ${quoteIdentifier(source.name)}`
        );
      }
      database.exec(`DROP TABLE ${quoteIdentifier(source.name)}`);
      database.exec(
        `ALTER TABLE ${quoteIdentifier(temporaryTable)} RENAME TO ${quoteIdentifier(source.name)}`
      );
    });

    source.sqliteSchema = targetColumns.map(column => ({
      name: column.name,
      type: column.type,
      notNull: column.source?.notNull || false,
      defaultValue: column.source?.defaultValue ?? null,
      primaryKeyOrder: column.source?.primaryKeyOrder || 0,
    }));
    source.columns = source.sqliteSchema.map(column => column.name);
    source.columnTypes = Object.fromEntries(source.sqliteSchema.map(column => [column.name, column.type]));
    source.hasRowId = true;
    source.editable = true;
    this.refreshCatalogSource(source, 0);
    const result: DatabaseMutationResult = {
      operation: 'schema', tableId, rowCount: source.rowCount, backupPath,
    };
    this.recordUndo(result, source.filePath);
    return result;
  }

  async undoLastMutation(): Promise<DatabaseUndoResult> {
    this.assertAvailable();
    const entry = this.undoStack[this.undoStack.length - 1];
    if (!entry) throw new Error('没有可撤回的数据库操作');
    if (!fs.existsSync(entry.filePath)) throw new Error('数据库文件已不存在，无法撤回');
    if (!fs.existsSync(entry.mutation.backupPath)) throw new Error('撤回备份已不存在');

    this.releaseActive();
    if (fileSha256(entry.filePath) !== entry.postMutationSha256) {
      throw new Error('数据库已被其他程序修改，为避免覆盖外部数据，本次撤回已取消');
    }

    const safetyBackupPath = createDatabaseBackup(entry.filePath);
    const temporaryPath = path.join(
      path.dirname(entry.filePath),
      `.${path.basename(entry.filePath)}.boo-undo-${process.pid}-${Date.now()}.tmp`
    );
    try {
      fs.copyFileSync(entry.mutation.backupPath, temporaryPath);
      fs.copyFileSync(temporaryPath, entry.filePath);
      this.resetAfterExternalRestore();
      const catalog = await this.initialize();
      const table = catalog.tables.find(candidate => candidate.id === entry.mutation.tableId);
      if (!table) throw new Error('撤回后无法重新识别原数据表');
      this.undoStack.pop();
      return {
        operation: 'undo',
        revertedOperation: entry.mutation.operation,
        tableId: entry.mutation.tableId,
        rowCount: table.rowCount,
        backupPath: safetyBackupPath,
        rowId: entry.mutation.rowId,
      };
    } catch (error) {
      try { fs.copyFileSync(safetyBackupPath, entry.filePath); } catch { /* preserve undo error */ }
      this.resetAfterExternalRestore();
      try { await this.initialize(); } catch { /* the original error is more useful */ }
      throw new Error(`数据库撤回失败，已尝试恢复撤回前备份: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch { /* best effort */ }
    }
  }

  releaseActive(): void {
    this.biff8Session?.releaseActive();
    this.activeSqlite?.database.close();
    this.activeSqlite = undefined;
    this.activeAccess = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.releaseActive();
    this.biff8Session?.dispose();
    this.undoStack.length = 0;
    this.sources.clear();
    this.catalog = undefined;
    this.disposed = true;
  }

  private createSource(
    kind: DatabaseKind,
    fileName: string,
    filePath: string,
    tableName: string,
    rowCount: number,
    columns: string[],
    sqliteSchema: SqliteColumnInfo[],
    hasRowId: boolean,
    schemaEditReason: string
  ): TableSource {
    const columnTypes = Object.fromEntries(sqliteSchema.map(column => [column.name, column.type]));
    return {
      id: `table-${this.sourceSequence++}`,
      name: tableName,
      label: tableCategoryLabel(tableName),
      fileName,
      filePath,
      kind,
      rowCount: Number.isFinite(rowCount) ? Math.max(0, rowCount) : 0,
      columns,
      columnTypes,
      columnLabels: {},
      columnDescriptions: {},
      editable: kind === 'sqlite' && hasRowId,
      schemaEditable: kind === 'sqlite' && !schemaEditReason,
      schemaEditReason,
      sortMode: kind === 'sqlite' ? 'database' : 'page',
      sqliteSchema,
      hasRowId,
    };
  }

  private async loadSqlitePage(
    source: TableSource,
    offset: number,
    limit: number,
    query: string,
    searchColumn: string,
    matchMode: 'contains' | 'exact',
    filters: DatabaseColumnFilter[],
    sortColumn: string,
    sortDirection: DatabaseSortDirection
  ): Promise<DatabasePage> {
    const database = await this.getActiveSqlite(source.filePath);
    const tableName = quoteIdentifier(source.name);
    const searchColumns = searchColumn ? [searchColumn] : source.columns;
    const searchValue = matchMode === 'exact' ? query : `%${escapeLikeValue(query)}%`;
    const conditions: string[] = [];
    const parameters: unknown[] = [];
    for (const filter of filters) {
      conditions.push(`${quoteIdentifier(filter.column)} IN (${filter.values.map(() => '?').join(', ')})`);
      parameters.push(...filter.values);
    }
    if (query) {
      conditions.push(`(${searchColumns.map(column => matchMode === 'exact'
        ? `CAST(${quoteIdentifier(column)} AS TEXT) = ? COLLATE NOCASE`
        : `CAST(${quoteIdentifier(column)} AS TEXT) LIKE ? ESCAPE '\\' COLLATE NOCASE`).join(' OR ')})`);
      parameters.push(...searchColumns.map(() => searchValue));
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const total = readPreparedScalar(database, `SELECT COUNT(*) FROM ${tableName}${where}`, parameters);
    const order = sortColumn ? ` ORDER BY ${quoteIdentifier(sortColumn)} ${sortDirection.toUpperCase()}` : '';
    const rowIdentity = source.hasRowId ? 'rowid AS "__booRowId", ' : '';
    const rows = readPreparedRows(
      database,
      `SELECT ${rowIdentity}* FROM ${tableName}${where}${order} LIMIT ? OFFSET ?`,
      [...parameters, limit, offset]
    ).map(row => normalizeDatabaseRow(row, source.columns));
    return {
      tableId: source.id,
      columns: source.columns,
      rows,
      offset,
      limit,
      total,
      query,
      searchColumn,
      matchMode,
      filters,
      filterColumn: filters[0]?.column || '',
      filterValues: filters[0]?.values || [],
      sortColumn,
      sortDirection,
    };
  }

  private async loadAccessPage(
    source: TableSource,
    offset: number,
    limit: number,
    query: string,
    searchColumn: string,
    matchMode: 'contains' | 'exact',
    filters: DatabaseColumnFilter[],
    sortColumn: string,
    sortDirection: DatabaseSortDirection,
    isCancelled: () => boolean
  ): Promise<DatabasePage> {
    const reader = this.getActiveAccess(source.filePath);
    const table = reader.getTable(source.name);
    let rows: Record<string, unknown>[] = [];
    let total = source.rowCount;

    if (!query && filters.length === 0) {
      rows = table.getData({ rowOffset: offset, rowLimit: limit })
        .map(row => normalizeDatabaseRow(row, source.columns));
    } else {
      const keyword = query.toLocaleLowerCase();
      const allowedFilterValues = filters.map(filter => ({
        column: filter.column,
        values: new Set(filter.values.map(value => String(value))),
      }));
      const searchColumns = searchColumn ? [searchColumn] : source.columns;
      const chunkSize = 500;
      let matched = 0;
      for (let rowOffset = 0; rowOffset < source.rowCount; rowOffset += chunkSize) {
        if (isCancelled()) throw new DatabaseRequestCancelledError();
        const chunk = table.getData({ rowOffset, rowLimit: chunkSize });
        for (const rawRow of chunk) {
          const row = normalizeDatabaseRow(rawRow, source.columns);
          const matchesFilter = allowedFilterValues.every(filter =>
            filter.values.has(String(row[filter.column] ?? ''))
          );
          const matchesSearch = !query || searchColumns.some(column => {
            const value = String(row[column] ?? '').toLocaleLowerCase();
            return matchMode === 'exact' ? value === keyword : value.includes(keyword);
          });
          if (!matchesFilter || !matchesSearch) continue;
          if (matched >= offset && rows.length < limit) rows.push(row);
          matched++;
        }
        if ((rowOffset / chunkSize) % 10 === 9) await yieldToEventLoop();
      }
      total = matched;
    }

    if (sortColumn) {
      rows.sort((left, right) => compareDatabaseValues(left[sortColumn], right[sortColumn], sortDirection));
    }
    return {
      tableId: source.id,
      columns: source.columns,
      rows,
      offset,
      limit,
      total,
      query,
      searchColumn,
      matchMode,
      filters,
      filterColumn: filters[0]?.column || '',
      filterValues: filters[0]?.values || [],
      sortColumn,
      sortDirection,
    };
  }

  private async getWritableSource(tableId: string): Promise<TableSource> {
    this.assertAvailable();
    if (!this.catalog) await this.initialize();
    const source = this.sources.get(tableId);
    if (!source) throw new Error('数据库表不存在或已刷新');
    if (source.kind !== 'sqlite') throw new Error('Access (.MDB) 数据库仅支持读取');
    if (!source.editable || !source.hasRowId) throw new Error('当前数据表没有可用的 rowid，无法安全修改记录');
    return source;
  }

  private normalizeMutationValues(
    source: TableSource,
    values: Record<string, unknown>
  ): [string, unknown][] {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('记录内容格式无效');
    const entries: [string, unknown][] = [];
    for (const column of source.columns) {
      if (!Object.prototype.hasOwnProperty.call(values, column)) continue;
      entries.push([column, normalizeMutationValue(values[column], source.columnTypes[column] || '')]);
    }
    return entries;
  }

  private normalizeRowUpdates(
    source: TableSource,
    updates: DatabaseRowUpdate[]
  ): { rowId: number; entries: [string, unknown][] }[] {
    if (!Array.isArray(updates) || updates.length === 0) throw new Error('没有可修改的记录');
    if (updates.length > 200) throw new Error('单次最多修改 200 行记录');
    const seen = new Set<number>();
    let cellCount = 0;
    const normalized = updates.map(update => {
      const rowId = normalizeRowId(update?.rowId);
      if (seen.has(rowId)) throw new Error(`记录 ${rowId} 在批量修改中重复`);
      seen.add(rowId);
      const entries = this.normalizeMutationValues(source, update?.values);
      if (entries.length === 0) throw new Error(`记录 ${rowId} 没有可修改的字段`);
      cellCount += entries.length;
      return { rowId, entries };
    });
    if (cellCount > 20000) throw new Error('单次最多修改 20000 个单元格');
    return normalized;
  }

  private async persistSqliteMutation(
    source: TableSource,
    mutation: (database: SqlDatabase) => void
  ): Promise<string> {
    const database = await this.getActiveSqlite(source.filePath);
    const backupPath = createDatabaseBackup(source.filePath);
    let exported: Uint8Array;
    try {
      database.exec('BEGIN IMMEDIATE');
      mutation(database);
      database.exec('COMMIT');
      exported = database.export();
    } catch (error) {
      try { database.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw error;
    }

    if (this.activeSqlite?.database === database) this.activeSqlite = undefined;
    database.close();
    const temporaryPath = path.join(
      path.dirname(source.filePath),
      `.${path.basename(source.filePath)}.boo-write-${process.pid}-${Date.now()}.tmp`
    );
    try {
      fs.writeFileSync(temporaryPath, Buffer.from(exported));
      fs.copyFileSync(temporaryPath, source.filePath);
    } catch (error) {
      try { fs.copyFileSync(backupPath, source.filePath); } catch { /* keep the original write error */ }
      throw new Error(`数据库写入失败，已尝试恢复备份: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch { /* temporary cleanup is best effort */ }
    }
    return backupPath;
  }

  private recordUndo(result: DatabaseMutationResult, filePath: string): void {
    try {
      this.undoStack.push({
        mutation: { ...result },
        filePath,
        postMutationSha256: fileSha256(filePath),
      });
      if (this.undoStack.length > 100) this.undoStack.shift();
    } catch (error) {
      console.warn('[BOO] 数据库修改已完成，但未能建立撤回点:', error instanceof Error ? error.message : String(error));
    }
  }

  private resetAfterExternalRestore(): void {
    this.releaseActive();
    this.biff8Session?.resetAfterExternalRestore();
    this.sources.clear();
    this.catalog = undefined;
    this.sourceSequence = 0;
  }

  private refreshCatalogSource(source: TableSource, totalDelta: number): void {
    if (!this.catalog) return;
    const table = this.catalog.tables.find(candidate => candidate.id === source.id);
    if (table) Object.assign(table, toPublicTableInfo(source));
    this.catalog.totalCount = Math.max(0, this.catalog.totalCount + totalDelta);
  }

  private async getActiveSqlite(filePath: string): Promise<SqlDatabase> {
    if (this.activeSqlite?.filePath === filePath) return this.activeSqlite.database;
    this.releaseActive();
    const SQL = await getSqlModule();
    const database = new SQL.Database(fs.readFileSync(filePath));
    this.activeSqlite = { filePath, database };
    return database;
  }

  private getActiveAccess(filePath: string): AccessReader {
    if (this.activeAccess?.filePath === filePath) return this.activeAccess.reader;
    this.releaseActive();
    const module = require('mdb-reader') as { default?: new (buffer: Buffer) => AccessReader } | (new (buffer: Buffer) => AccessReader);
    const MDBReader = typeof module === 'function' ? module : module.default;
    if (!MDBReader) throw new Error('MDB Reader 初始化失败');
    const reader = new MDBReader(fs.readFileSync(filePath));
    this.activeAccess = { filePath, reader };
    return reader;
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('数据库查看会话已关闭');
  }
}

function readSqliteTableNames(database: SqlDatabase): string[] {
  const result = database.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name COLLATE NOCASE");
  if (result.length === 0) return [];
  return result[0].values
    .map(row => String(row[0] || ''))
    .filter(name => name && !name.toLowerCase().startsWith('sqlite_'));
}

function readSqliteSchema(database: SqlDatabase, tableName: string): SqliteColumnInfo[] {
  const result = database.exec(`PRAGMA table_info(${quoteIdentifier(tableName)})`);
  if (result.length === 0) return [];
  return result[0].values.map(row => ({
    name: String(row[1] ?? ''),
    type: String(row[2] ?? ''),
    notNull: Number(row[3]) === 1,
    defaultValue: row[4] === null || row[4] === undefined ? null : String(row[4]),
    primaryKeyOrder: Math.max(0, Number(row[5]) || 0),
  })).filter(column => column.name);
}

function readSqliteHasRowId(
  database: SqlDatabase,
  tableName: string,
  schema: SqliteColumnInfo[]
): boolean {
  const reservedNames = new Set(['rowid', '_rowid_', 'oid']);
  if (schema.some(column => reservedNames.has(column.name.toLocaleLowerCase()))) return false;
  let statement: SqlStatement | undefined;
  try {
    statement = database.prepare(`SELECT rowid FROM ${quoteIdentifier(tableName)} LIMIT 0`);
    return true;
  } catch {
    return false;
  } finally {
    statement?.free();
  }
}

function readSchemaEditReason(database: SqlDatabase, tableName: string, hasRowId: boolean): string {
  if (!hasRowId) return '没有可用的 rowid，无法安全重建字段结构';
  const foreignKeys = database.exec(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`);
  if (foreignKeys.length > 0 && foreignKeys[0].values.length > 0) return '数据表包含外键，字段结构已保护';
  const sql = readPreparedText(
    database,
    "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?",
    [tableName]
  );
  if (/\b(CHECK|COLLATE|GENERATED|REFERENCES|AUTOINCREMENT|UNIQUE|STRICT)\b/i.test(sql)) {
    return '数据表包含复杂约束，字段结构已保护';
  }
  const dependencies = readPreparedScalar(
    database,
    "SELECT COUNT(*) FROM sqlite_master WHERE tbl_name = ? AND type IN ('index','trigger') AND sql IS NOT NULL",
    [tableName]
  );
  return dependencies > 0 ? '数据表包含索引或触发器，字段结构已保护' : '';
}

function readSqliteCount(database: SqlDatabase, tableName: string): number {
  return readPreparedScalar(database, `SELECT COUNT(*) FROM ${quoteIdentifier(tableName)}`, []);
}

function readPreparedScalar(database: SqlDatabase, sql: string, parameters: unknown[]): number {
  const statement = database.prepare(sql);
  try {
    if (parameters.length > 0) statement.bind(parameters);
    if (!statement.step()) return 0;
    return Number(statement.get()[0]) || 0;
  } finally {
    statement.free();
  }
}

function readPreparedText(database: SqlDatabase, sql: string, parameters: unknown[]): string {
  const statement = database.prepare(sql);
  try {
    if (parameters.length > 0) statement.bind(parameters);
    if (!statement.step()) return '';
    return String(statement.get()[0] ?? '');
  } finally {
    statement.free();
  }
}

function readPreparedRows(database: SqlDatabase, sql: string, parameters: unknown[]): Record<string, unknown>[] {
  const statement = database.prepare(sql);
  const rows: Record<string, unknown>[] = [];
  try {
    statement.bind(parameters);
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function runPreparedStatement(database: SqlDatabase, sql: string, parameters: unknown[]): void {
  const statement = database.prepare(sql);
  try {
    if (parameters.length > 0) statement.bind(parameters);
    statement.step();
  } finally {
    statement.free();
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function normalizePageFilters(
  source: TableSource,
  request: DatabasePageRequest
): DatabaseColumnFilter[] {
  const requested = Array.isArray(request.filters) && request.filters.length > 0
    ? request.filters
    : [{ column: request.filterColumn || '', values: request.filterValues || [] }];
  const filters: DatabaseColumnFilter[] = [];
  for (const filter of requested.slice(0, 8)) {
    const column = source.columns.includes(filter?.column || '') ? String(filter.column) : '';
    if (!column || !Array.isArray(filter.values)) continue;
    const values = [...new Set(filter.values
      .filter(value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
      .slice(0, 64))];
    if (values.length > 0) filters.push({ column, values });
  }
  return filters;
}

function escapeLikeValue(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

function normalizeDatabaseRow(row: unknown, columns: string[]): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  if (Array.isArray(row)) {
    columns.forEach((column, index) => { normalized[column] = normalizeDatabaseValue(row[index]); });
    return normalized;
  }
  const source = row && typeof row === 'object' ? row as Record<string, unknown> : {};
  if (Object.prototype.hasOwnProperty.call(source, '__booRowId')) {
    normalized.__booRowId = normalizeDatabaseValue(source.__booRowId);
  }
  for (const column of columns) normalized[column] = normalizeDatabaseValue(source[column]);
  return normalized;
}

function normalizeDatabaseValue(value: unknown): unknown {
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return `<二进制 ${value.byteLength} 字节>`;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return value;
}

function normalizeMutationValue(value: unknown, declaredType: string): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== 'string') return value;
  const affinity = declaredType.toLocaleUpperCase();
  if (!/(INT|REAL|FLOA|DOUB|NUMERIC|DECIMAL|BOOLEAN)/.test(affinity)) return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) throw new Error(`字段值“${value}”不是有效数字`);
  return affinity.includes('INT') ? Math.trunc(numeric) : numeric;
}

function normalizeRowId(value: unknown): number {
  const rowId = Number(value);
  if (!Number.isSafeInteger(rowId)) throw new Error('记录标识无效，请刷新数据库后重试');
  return rowId;
}

function normalizeSchemaUpdate(
  source: TableSource,
  updates: DatabaseSchemaColumnUpdate[]
): NormalizedSchemaColumn[] {
  if (!Array.isArray(updates) || updates.length === 0) throw new Error('数据表至少需要保留一个字段');
  if (updates.length > 512) throw new Error('字段数量不能超过 512 个');
  const originalColumns = new Map(source.sqliteSchema.map(column => [column.name.toLocaleLowerCase(), column]));
  const usedSources = new Set<string>();
  const usedNames = new Set<string>();
  return updates.map(update => {
    const name = String(update?.name || '').trim();
    if (!name) throw new Error('字段名不能为空');
    if (name.length > 128 || /[\u0000-\u001f]/.test(name)) throw new Error(`字段名“${name}”无效`);
    const normalizedName = name.toLocaleLowerCase();
    if (usedNames.has(normalizedName)) throw new Error(`字段名“${name}”重复`);
    usedNames.add(normalizedName);

    const sourceName = String(update?.sourceName || '').trim();
    if (!sourceName) return { name, type: sanitizeColumnType(update?.type || 'TEXT') };
    const original = originalColumns.get(sourceName.toLocaleLowerCase());
    if (!original) throw new Error(`原字段“${sourceName}”不存在，请刷新后重试`);
    const normalizedSource = original.name.toLocaleLowerCase();
    if (usedSources.has(normalizedSource)) throw new Error(`原字段“${original.name}”被重复使用`);
    usedSources.add(normalizedSource);
    return { source: original, name, type: original.type || 'TEXT' };
  });
}

function sanitizeColumnType(value: string): string {
  const type = String(value || 'TEXT').trim().toLocaleUpperCase();
  if (!/^[A-Z][A-Z0-9_]*(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?$/.test(type)) {
    throw new Error(`字段类型“${value}”无效`);
  }
  return type;
}

function buildSchemaDefinitions(
  source: TableSource,
  columns: NormalizedSchemaColumn[]
): string[] {
  const primaryKeys = columns
    .filter(column => (column.source?.primaryKeyOrder || 0) > 0)
    .sort((left, right) => (left.source?.primaryKeyOrder || 0) - (right.source?.primaryKeyOrder || 0));
  const definitions = columns.map(column => {
    const parts = [quoteIdentifier(column.name), column.type || 'TEXT'];
    if (column.source?.notNull) parts.push('NOT NULL');
    if (column.source?.defaultValue !== null && column.source?.defaultValue !== undefined) {
      parts.push(`DEFAULT ${column.source.defaultValue}`);
    }
    if (primaryKeys.length === 1 && column === primaryKeys[0]) parts.push('PRIMARY KEY');
    return parts.join(' ');
  });
  if (primaryKeys.length > 1) {
    definitions.push(`PRIMARY KEY (${primaryKeys.map(column => quoteIdentifier(column.name)).join(', ')})`);
  }
  if (source.sqliteSchema.length === 0) throw new Error('无法读取原字段结构');
  return definitions;
}

function createDatabaseBackup(filePath: string): string {
  const backupDirectory = path.join(path.dirname(filePath), 'boo-database-backups');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = `${process.pid}-${process.hrtime.bigint().toString().slice(-6)}`;
  const backupPath = path.join(backupDirectory, `${path.basename(filePath)}.${stamp}.${suffix}.bak`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function fileSha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function toPublicTableInfo(source: TableSource): DatabaseTableInfo {
  return {
    id: source.id,
    name: source.name,
    label: source.label,
    fileName: source.fileName,
    kind: source.kind,
    rowCount: source.rowCount,
    columns: [...source.columns],
    columnTypes: { ...source.columnTypes },
    columnLabels: { ...source.columnLabels },
    columnDescriptions: { ...source.columnDescriptions },
    editable: source.editable,
    schemaEditable: source.schemaEditable,
    schemaEditReason: source.schemaEditReason,
    sortMode: source.sortMode,
  };
}

function tableCategoryRank(tableName: string): number {
  const normalized = tableName.toLocaleLowerCase();
  if (/^(stditems?|items?)$/.test(normalized)) return 0;
  if (/monster/.test(normalized)) return 1;
  if (/(magic|skill)/.test(normalized)) return 2;
  return 3;
}

function tableCategoryLabel(tableName: string): string {
  const rank = tableCategoryRank(tableName);
  return rank === 0 ? '物品数据库' : rank === 1 ? '怪物数据库' : rank === 2 ? '技能数据库' : tableName;
}

function compareTableSources(left: TableSource, right: TableSource): number {
  const category = tableCategoryRank(left.name) - tableCategoryRank(right.name);
  if (category !== 0) return category;
  const file = left.fileName.localeCompare(right.fileName);
  return file !== 0 ? file : left.name.localeCompare(right.name);
}

function applyUniqueTableLabels(tables: TableSource[]): void {
  const counts = new Map<string, number>();
  for (const table of tables) {
    const key = table.label.toLocaleLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const table of tables) {
    if ((counts.get(table.label.toLocaleLowerCase()) || 0) > 1) {
      table.label = `${table.label} (${table.fileName})`;
    }
  }
}

function compareDatabaseValues(left: unknown, right: unknown, direction: DatabaseSortDirection): number {
  const multiplier = direction === 'desc' ? -1 : 1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return (leftNumber - rightNumber) * multiplier;
  return String(left ?? '').localeCompare(String(right ?? '')) * multiplier;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
