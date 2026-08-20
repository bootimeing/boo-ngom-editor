import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import type {
  DatabaseCatalog,
  DatabaseColumnFilter,
  DatabaseMutationResult,
  DatabasePage,
  DatabasePageRequest,
  DatabaseRowUpdate,
  DatabaseSchemaColumnUpdate,
  DatabaseSortDirection,
  DatabaseTableInfo,
} from './database-browser';

interface Biff8TableSource extends DatabaseTableInfo {
  filePath: string;
  sheetName: string;
  dataStartRow: number;
  lastDataRow: number;
  columnIndexes: Record<string, number>;
  protocolDigest: string;
}

interface ActiveWorkbook {
  filePath: string;
  workbook: XLSX.WorkBook;
  worksheet: XLSX.WorkSheet;
  sourceSha256: string;
}

interface Biff8FieldDocumentation {
  label: string;
  description: string;
}

const TABLE_SPECS = [
  { fileName: 'cfg_item.xls', name: 'cfg_item', label: '物品数据库' },
  { fileName: 'cfg_monster.xls', name: 'cfg_monster', label: '怪物数据库' },
  { fileName: 'cfg_magic.xls', name: 'cfg_magic', label: '技能数据库' },
] as const;

const PROTOCOL_ROW_COUNT = 3;
const FIELD_DOCUMENTATION: Record<string, Record<string, Biff8FieldDocumentation>> = {
  cfg_item: {
    idx: {
      label: '物品序号',
      description: '物品序号（不可重复；996PC 帮助文档建议从 10000 开始）',
    },
    name: { label: '名称', description: '物品名称' },
    stdmode: { label: '分类', description: '物品分类代码（StdMode）' },
    shape: {
      label: '外观/效果',
      description: '衣服穿戴外观、首饰特殊功能或单件武器/衣服 JPK 外观编号',
    },
    weight: { label: '重量', description: '物品重量' },
    anicount: {
      label: '扩展参数',
      description: 'AniCount；含义随 StdMode 变化，可用于负重、外观、马牌或特殊物品参数',
    },
    source: {
      label: '来源/参数',
      description: 'Source；含义随 StdMode 变化，可用于强度、神圣、叠加或持久规则',
    },
    reserved: { label: '保留参数', description: '996PC 物品保留参数' },
    looks: {
      label: '背包外观',
      description: '物品栏和装备栏素材索引；0-9999 对应 Items.Jpk，之后每 10000 切换到 Items1.Jpk、Items2.Jpk，最大支持 99999',
    },
    duramax: { label: '最大持久', description: '最大持久度（1000 表示 1 点持久）' },
    attribute: { label: '属性', description: '职业#属性ID#属性值，多组属性使用 | 分隔' },
    need: { label: '使用条件', description: '使用或穿戴条件类型' },
    needlevel: { label: '条件数值', description: 'Need 对应的等级或属性条件数值' },
    price: { label: '出售价格', description: '物品出售价格' },
    color: { label: '地面颜色', description: '物品掉落在地面时的显示颜色' },
    overlap: { label: '叠加设置', description: '物品叠加相关设置' },
    suit: { label: '套装ID', description: '套装编号' },
    article: { label: '物品规则', description: '物品规则参数' },
    job: { label: '使用职业', description: '使用或穿戴职业要求' },
    effectparam: { label: '特殊效果参数', description: '按 StdMode 解释的道具特殊效果参数' },
    desc: { label: '备注', description: '物品备注' },
    expand1: { label: '扩展参数1', description: '生肖盒、首饰盒、马牌等功能的扩展参数' },
    hairshow: { label: '裸模显示控制', description: '控制发型、斗笠、武器和裸模是否显示' },
    auctionby: { label: '拍卖行分类', description: '拍卖行分类编号' },
    insurance: { label: '装备投保', description: '投保货币ID#投保金额' },
  },
  cfg_magic: {
    magid: { label: '技能编号', description: '技能序号' },
    magname: { label: '技能名称', description: '技能名称' },
    effecttype: { label: '角色动作效果', description: '使用技能时角色的动作效果' },
    effect: { label: '技能动画效果', description: '技能产生的动画效果' },
    spell: { label: '魔法消耗', description: '每次使用技能消耗的魔法值' },
    power: { label: '基础伤害下限', description: '技能基础伤害下限' },
    maxpower: { label: '基础伤害上限', description: '技能基础伤害上限' },
    defspell: { label: '每级魔法消耗', description: '每次技能升级后增加的魔法消耗' },
    defpower: { label: '每级伤害下限', description: '每次技能升级后增加的伤害下限' },
    defmaxpower: { label: '每级伤害上限', description: '每次技能升级后增加的伤害上限' },
    job: { label: '职业', description: '可学习技能的职业' },
    delay: { label: '技能切换延时', description: '使用当前技能后再次使用其他技能的延时（毫秒）' },
    skillcd: { label: '技能CD', description: '技能冷却时间（毫秒）' },
    qskill: { label: '强化技能', description: '强化技能设置' },
    actrange: { label: '技能范围', description: '群体法术的技能范围，默认值为 1' },
    actrate: { label: '技能伤害倍率', description: '技能伤害倍率或附加点数设置' },
    descr: { label: '英雄技能', description: '0 或空为人物技能，1 为英雄技能' },
  },
};

export class Biff8DatabaseSession {
  private catalog: DatabaseCatalog | undefined;
  private readonly sources = new Map<string, Biff8TableSource>();
  private active: ActiveWorkbook | undefined;
  private disposed = false;

  constructor(private readonly dataDirectory: string) {}

  initialize(): DatabaseCatalog {
    this.assertAvailable();
    if (this.catalog) return this.catalog;

    const tables: Biff8TableSource[] = [];
    for (const spec of TABLE_SPECS) {
      const filePath = path.join(this.dataDirectory, spec.fileName);
      if (!isFile(filePath)) continue;
      tables.push(readTableSource(filePath, spec.name, spec.label));
    }
    for (const table of tables) this.sources.set(table.id, table);
    this.catalog = {
      dbType: tables.length > 0
        ? '996PC BIFF8 (.XLS) - 前三行为引擎协议'
        : '未找到 996PC 数据库文件 (检查 Mir200\\Envir\\Data\\cfg_*.xls)',
      totalCount: tables.reduce((sum, table) => sum + table.rowCount, 0),
      tables: tables.map(toPublicTableInfo),
    };
    return this.catalog;
  }

  async loadPage(
    request: DatabasePageRequest,
    isCancelled: () => boolean
  ): Promise<DatabasePage> {
    this.assertAvailable();
    const source = this.getSource(request.tableId);
    const active = this.getActive(source);
    const limit = Math.max(20, Math.min(200, Math.floor(Number(request.limit) || 100)));
    const offset = Math.max(0, Math.floor(Number(request.offset) || 0));
    const query = String(request.query || '').trim().slice(0, 200);
    const searchColumn = source.columns.includes(request.searchColumn || '') ? String(request.searchColumn) : '';
    const matchMode = request.matchMode === 'exact' ? 'exact' : 'contains';
    const filters = normalizeFilters(source, request);
    const sortColumn = source.columns.includes(request.sortColumn) ? request.sortColumn : '';
    const sortDirection: DatabaseSortDirection = request.sortDirection === 'desc' ? 'desc' : 'asc';
    const searchColumns = searchColumn ? [searchColumn] : source.columns;
    const keyword = query.toLocaleLowerCase();
    const matched: Record<string, unknown>[] = [];

    for (let rowIndex = source.dataStartRow; rowIndex <= source.lastDataRow; rowIndex++) {
      if ((rowIndex - source.dataStartRow) % 300 === 0) {
        if (isCancelled()) throw new Error('Database page request was superseded');
        await yieldToEventLoop();
      }
      const row = readWorksheetRow(active.worksheet, source, rowIndex);
      if (!matchesFilters(row, filters)) continue;
      if (query && !searchColumns.some(column => {
        const value = String(row[column] ?? '').toLocaleLowerCase();
        return matchMode === 'exact' ? value === keyword : value.includes(keyword);
      })) continue;
      matched.push(row);
    }

    if (sortColumn) {
      matched.sort((left, right) =>
        compareValues(left[sortColumn], right[sortColumn], sortDirection)
      );
    }
    return {
      tableId: source.id,
      columns: [...source.columns],
      rows: matched.slice(offset, offset + limit),
      offset,
      limit,
      total: matched.length,
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

  createRow(tableId: string, values: Record<string, unknown>): DatabaseMutationResult {
    const source = this.getSource(tableId);
    const active = this.getActive(source);
    const rowIndex = source.lastDataRow + 1;
    const entries = normalizeMutationValues(source, values);

    for (const column of source.columns) {
      const columnIndex = source.columnIndexes[column];
      const entry = entries.find(([name]) => name === column);
      setWorksheetCell(
        active.worksheet,
        rowIndex,
        columnIndex,
        entry ? entry[1] : '',
        findStyleTemplate(active.worksheet, rowIndex - 1, columnIndex)
      );
    }
    source.lastDataRow = rowIndex;
    source.rowCount++;
    expandWorksheetRange(active.worksheet, rowIndex);
    const backupPath = this.persistMutation(source, active);
    this.refreshCatalog(source, 1);
    return {
      operation: 'create',
      tableId,
      rowCount: source.rowCount,
      backupPath,
      rowId: rowIndex + 1,
    };
  }

  updateRow(
    tableId: string,
    rowId: unknown,
    values: Record<string, unknown>
  ): DatabaseMutationResult {
    const source = this.getSource(tableId);
    const active = this.getActive(source);
    const rowIndex = normalizeWorksheetRowId(source, rowId);
    const entries = normalizeMutationValues(source, values);
    if (entries.length === 0) throw new Error('没有可修改的字段');

    for (const [column, value] of entries) {
      setWorksheetCell(
        active.worksheet,
        rowIndex,
        source.columnIndexes[column],
        value
      );
    }
    const backupPath = this.persistMutation(source, active);
    return {
      operation: 'update',
      tableId,
      rowCount: source.rowCount,
      backupPath,
      rowId: rowIndex + 1,
    };
  }

  updateRows(tableId: string, updates: DatabaseRowUpdate[]): DatabaseMutationResult {
    const source = this.getSource(tableId);
    const active = this.getActive(source);
    const normalized = normalizeRowUpdates(source, updates);

    for (const update of normalized) {
      for (const [column, value] of update.entries) {
        setWorksheetCell(
          active.worksheet,
          update.rowIndex,
          source.columnIndexes[column],
          value
        );
      }
    }
    const backupPath = this.persistMutation(source, active);
    return {
      operation: 'update',
      tableId,
      rowCount: source.rowCount,
      backupPath,
      rowId: normalized[0].rowIndex + 1,
    };
  }

  deleteRow(tableId: string, rowId: unknown): DatabaseMutationResult {
    const source = this.getSource(tableId);
    const active = this.getActive(source);
    const rowIndex = normalizeWorksheetRowId(source, rowId);
    const range = worksheetRange(active.worksheet);

    for (let currentRow = rowIndex; currentRow < source.lastDataRow; currentRow++) {
      for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex++) {
        const currentAddress = XLSX.utils.encode_cell({ r: currentRow, c: columnIndex });
        const nextAddress = XLSX.utils.encode_cell({ r: currentRow + 1, c: columnIndex });
        const nextCell = active.worksheet[nextAddress] as XLSX.CellObject | undefined;
        if (nextCell) active.worksheet[currentAddress] = { ...nextCell };
        else delete active.worksheet[currentAddress];
      }
    }
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex++) {
      delete active.worksheet[XLSX.utils.encode_cell({ r: source.lastDataRow, c: columnIndex })];
    }
    if (Array.isArray(active.worksheet['!rows'])) {
      active.worksheet['!rows']!.splice(rowIndex, 1);
    }
    source.lastDataRow--;
    source.rowCount = Math.max(0, source.rowCount - 1);
    range.e.r = Math.max(PROTOCOL_ROW_COUNT - 1, source.lastDataRow);
    active.worksheet['!ref'] = XLSX.utils.encode_range(range);
    const backupPath = this.persistMutation(source, active);
    this.refreshCatalog(source, -1);
    return {
      operation: 'delete',
      tableId,
      rowCount: source.rowCount,
      backupPath,
      rowId: rowIndex + 1,
    };
  }

  updateSchema(
    tableId: string,
    _columns: DatabaseSchemaColumnUpdate[]
  ): DatabaseMutationResult {
    const source = this.getSource(tableId);
    throw new Error(source.schemaEditReason);
  }

  filePathForTable(tableId: string): string {
    return this.getSource(tableId).filePath;
  }

  resetAfterExternalRestore(): void {
    this.active = undefined;
    this.sources.clear();
    this.catalog = undefined;
  }

  releaseActive(): void {
    this.active = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.releaseActive();
    this.sources.clear();
    this.catalog = undefined;
    this.disposed = true;
  }

  private getSource(tableId: string): Biff8TableSource {
    if (!this.catalog) this.initialize();
    const source = this.sources.get(tableId);
    if (!source) throw new Error('数据库表不存在或已刷新');
    return source;
  }

  private getActive(source: Biff8TableSource): ActiveWorkbook {
    if (this.active?.filePath === source.filePath) return this.active;
    const input = fs.readFileSync(source.filePath);
    const workbook = readWorkbook(input);
    const worksheet = workbook.Sheets[source.sheetName];
    if (!worksheet) throw new Error(`${source.fileName} 缺少工作表 ${source.sheetName}`);
    if (protocolDigest(worksheet) !== source.protocolDigest) {
      throw new Error(`${source.fileName} 的前三行协议已变化，请关闭并重新打开数据库`);
    }
    this.active = {
      filePath: source.filePath,
      workbook,
      worksheet,
      sourceSha256: sha256(input),
    };
    return this.active;
  }

  private persistMutation(source: Biff8TableSource, active: ActiveWorkbook): string {
    const current = fs.readFileSync(source.filePath);
    if (sha256(current) !== active.sourceSha256) {
      this.releaseActive();
      throw new Error(`${source.fileName} 已被其他程序修改，请刷新数据库后重试`);
    }
    if (protocolDigest(active.worksheet) !== source.protocolDigest) {
      this.releaseActive();
      throw new Error(`${source.fileName} 的前三行引擎协议不允许修改`);
    }

    const expectedRange = worksheetRange(active.worksheet);
    const expectedDigest = worksheetDataDigest(active.worksheet, expectedRange);
    const backupPath = createBackup(source.filePath);
    const temporaryPath = path.join(
      path.dirname(source.filePath),
      `.${path.basename(source.filePath)}.boo-write-${process.pid}-${Date.now()}.xls`
    );
    try {
      const output = XLSX.write(sanitizeBiff8WorkbookForWrite(active.workbook), {
        type: 'buffer',
        bookType: 'biff8',
        bookSST: true,
        cellStyles: true,
      }) as Buffer;
      fs.writeFileSync(temporaryPath, output);
      verifyWrittenWorkbook(temporaryPath, source, expectedRange, expectedDigest);
      fs.copyFileSync(temporaryPath, source.filePath);
      verifyWrittenWorkbook(source.filePath, source, expectedRange, expectedDigest);
    } catch (error) {
      try { fs.copyFileSync(backupPath, source.filePath); } catch { /* preserve the original failure */ }
      this.releaseActive();
      throw new Error(
        `996PC 数据库写入失败，已尝试恢复备份: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch { /* best effort */ }
    }
    this.releaseActive();
    return backupPath;
  }

  private refreshCatalog(source: Biff8TableSource, totalDelta: number): void {
    if (!this.catalog) return;
    const publicSource = this.catalog.tables.find(table => table.id === source.id);
    if (publicSource) Object.assign(publicSource, toPublicTableInfo(source));
    this.catalog.totalCount = Math.max(0, this.catalog.totalCount + totalDelta);
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('数据库查看会话已关闭');
  }
}

function readTableSource(filePath: string, name: string, label: string): Biff8TableSource {
  const workbook = readWorkbook(fs.readFileSync(filePath));
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  if (!sheetName || !worksheet) throw new Error(`${path.basename(filePath)} 没有可读取的工作表`);
  const range = worksheetRange(worksheet);
  if (range.e.r < PROTOCOL_ROW_COUNT - 1) {
    throw new Error(`${path.basename(filePath)} 缺少 996PC 三行协议头`);
  }
  const protocolMarker = String(cellValue(worksheet, 0, 0) ?? '').trim().toLowerCase();
  if (!protocolMarker.startsWith('//;ver')) {
    throw new Error(`${path.basename(filePath)} 不是有效的 996PC cfg XLS 表`);
  }

  const columns: string[] = [];
  const columnLabels: Record<string, string> = {};
  const columnDescriptions: Record<string, string> = {};
  const columnIndexes: Record<string, number> = {};
  const used = new Set<string>();
  const fieldDocumentation = FIELD_DOCUMENTATION[name] || {};
  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex++) {
    const rawName = String(cellValue(worksheet, 2, columnIndex) ?? '').trim();
    const versionIndex = String(cellValue(worksheet, 0, columnIndex) ?? columnIndex).replace(/^\/\/;ver$/i, '0');
    const baseName = rawName || `Reserved${versionIndex || columnIndex}`;
    const column = uniqueColumnName(baseName, used);
    const protocolDescription = cleanProtocolLabel(cellValue(worksheet, 1, columnIndex));
    const documented = rawName ? fieldDocumentation[rawName.toLocaleLowerCase()] : undefined;
    const description = documented?.description
      || protocolDescription
      || (rawName ? rawName : `保留字段 ${versionIndex}`);
    columns.push(column);
    columnIndexes[column] = columnIndex;
    columnDescriptions[column] = description;
    columnLabels[column] = documented?.label
      || (rawName ? compactLabel(description) : `保留字段${versionIndex}`);
  }

  const lastDataRow = Math.max(PROTOCOL_ROW_COUNT - 1, range.e.r);
  const columnTypes = Object.fromEntries(columns.map(column => [
    column,
    inferColumnType(worksheet, columnIndexes[column], PROTOCOL_ROW_COUNT, lastDataRow),
  ]));
  return {
    id: `biff8:${path.basename(filePath).toLowerCase()}`,
    name,
    label,
    fileName: path.basename(filePath),
    filePath,
    sheetName,
    kind: 'biff8',
    rowCount: Math.max(0, lastDataRow - PROTOCOL_ROW_COUNT + 1),
    columns,
    columnTypes,
    columnLabels,
    columnDescriptions,
    editable: true,
    schemaEditable: false,
    schemaEditReason: '996PC cfg XLS 的前三行和字段顺序属于引擎协议，已保护',
    sortMode: 'page',
    dataStartRow: PROTOCOL_ROW_COUNT,
    lastDataRow,
    columnIndexes,
    protocolDigest: protocolDigest(worksheet),
  };
}

function readWorkbook(input: Buffer): XLSX.WorkBook {
  return XLSX.read(input, {
    type: 'buffer',
    cellDates: false,
    cellFormula: true,
    cellNF: true,
    cellStyles: true,
    sheetStubs: true,
  });
}

export function sanitizeBiff8WorkbookForWrite(workbook: XLSX.WorkBook): XLSX.WorkBook {
  const sanitized = { ...workbook };
  delete sanitized.Props;
  delete sanitized.Custprops;
  return sanitized;
}

function readWorksheetRow(
  worksheet: XLSX.WorkSheet,
  source: Biff8TableSource,
  rowIndex: number
): Record<string, unknown> {
  const row: Record<string, unknown> = { __booRowId: rowIndex + 1 };
  for (const column of source.columns) {
    row[column] = normalizeCellValue(cellValue(
      worksheet,
      rowIndex,
      source.columnIndexes[column]
    ));
  }
  return row;
}

function cellValue(worksheet: XLSX.WorkSheet, row: number, column: number): unknown {
  return (worksheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined)?.v;
}

function normalizeCellValue(value: unknown): unknown {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function setWorksheetCell(
  worksheet: XLSX.WorkSheet,
  row: number,
  column: number,
  value: unknown,
  styleTemplate?: XLSX.CellObject
): void {
  const address = XLSX.utils.encode_cell({ r: row, c: column });
  const previous = worksheet[address] as XLSX.CellObject | undefined;
  const styleSource = previous || styleTemplate;
  const cell: XLSX.CellObject = value === null || value === undefined
    ? { t: 's', v: '' }
    : typeof value === 'number'
      ? { t: 'n', v: value }
      : typeof value === 'boolean'
        ? { t: 'b', v: value }
        : { t: 's', v: String(value) };
  if (styleSource?.s) cell.s = styleSource.s;
  if (styleSource?.z) cell.z = styleSource.z;
  worksheet[address] = cell;
}

function findStyleTemplate(
  worksheet: XLSX.WorkSheet,
  row: number,
  column: number
): XLSX.CellObject | undefined {
  if (row < PROTOCOL_ROW_COUNT) return undefined;
  return worksheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
}

function expandWorksheetRange(worksheet: XLSX.WorkSheet, rowIndex: number): void {
  const range = worksheetRange(worksheet);
  range.e.r = Math.max(range.e.r, rowIndex);
  worksheet['!ref'] = XLSX.utils.encode_range(range);
}

function worksheetRange(worksheet: XLSX.WorkSheet): XLSX.Range {
  return XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
}

function protocolDigest(worksheet: XLSX.WorkSheet): string {
  const range = worksheetRange(worksheet);
  return worksheetDataDigest(worksheet, {
    s: { r: 0, c: range.s.c },
    e: { r: PROTOCOL_ROW_COUNT - 1, c: range.e.c },
  });
}

function worksheetDataDigest(worksheet: XLSX.WorkSheet, range: XLSX.Range): string {
  const values: unknown[][] = [];
  for (let row = range.s.r; row <= range.e.r; row++) {
    const cells: unknown[] = [];
    for (let column = range.s.c; column <= range.e.c; column++) {
      const value = cellValue(worksheet, row, column);
      cells.push(value === undefined || value === '' ? null : value);
    }
    values.push(cells);
  }
  return sha256(Buffer.from(JSON.stringify(values), 'utf8'));
}

function verifyWrittenWorkbook(
  filePath: string,
  source: Biff8TableSource,
  expectedRange: XLSX.Range,
  expectedDigest: string
): void {
  const workbook = readWorkbook(fs.readFileSync(filePath));
  const worksheet = workbook.Sheets[source.sheetName];
  if (!worksheet) throw new Error(`写入结果缺少工作表 ${source.sheetName}`);
  const actualRange = worksheetRange(worksheet);
  if (actualRange.e.r !== expectedRange.e.r || actualRange.e.c !== expectedRange.e.c) {
    throw new Error(
      `写入结果尺寸异常: ${worksheet['!ref']}，预期 ${XLSX.utils.encode_range(expectedRange)}`
    );
  }
  if (protocolDigest(worksheet) !== source.protocolDigest) {
    throw new Error('写入结果的前三行引擎协议发生变化');
  }
  if (worksheetDataDigest(worksheet, expectedRange) !== expectedDigest) {
    throw new Error('写入结果的数据复核不一致');
  }
}

function normalizeMutationValues(
  source: Biff8TableSource,
  values: Record<string, unknown>
): [string, unknown][] {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('记录内容格式无效');
  }
  const result: [string, unknown][] = [];
  for (const column of source.columns) {
    if (!Object.prototype.hasOwnProperty.call(values, column)) continue;
    result.push([
      column,
      normalizeMutationValue(values[column], source.columnTypes[column] || ''),
    ]);
  }
  return result;
}

function normalizeRowUpdates(
  source: Biff8TableSource,
  updates: DatabaseRowUpdate[]
): { rowIndex: number; entries: [string, unknown][] }[] {
  if (!Array.isArray(updates) || updates.length === 0) throw new Error('没有可修改的记录');
  if (updates.length > 200) throw new Error('单次最多修改 200 行记录');
  const seen = new Set<number>();
  let cellCount = 0;
  const normalized = updates.map(update => {
    const rowIndex = normalizeWorksheetRowId(source, update?.rowId);
    if (seen.has(rowIndex)) throw new Error(`记录 ${rowIndex + 1} 在批量修改中重复`);
    seen.add(rowIndex);
    const entries = normalizeMutationValues(source, update?.values);
    if (entries.length === 0) throw new Error(`记录 ${rowIndex + 1} 没有可修改的字段`);
    cellCount += entries.length;
    return { rowIndex, entries };
  });
  if (cellCount > 20000) throw new Error('单次最多修改 20000 个单元格');
  return normalized;
}

function normalizeMutationValue(value: unknown, declaredType: string): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return value;
  if (declaredType !== 'NUMERIC') return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) throw new Error(`字段值“${value}”不是有效数字`);
  return numeric;
}

function normalizeWorksheetRowId(source: Biff8TableSource, value: unknown): number {
  const oneBased = Number(value);
  if (!Number.isSafeInteger(oneBased)) throw new Error('记录标识无效，请刷新数据库后重试');
  const rowIndex = oneBased - 1;
  if (rowIndex < source.dataStartRow || rowIndex > source.lastDataRow) {
    throw new Error('记录不存在或已被其他操作修改');
  }
  return rowIndex;
}

function normalizeFilters(
  source: Biff8TableSource,
  request: DatabasePageRequest
): DatabaseColumnFilter[] {
  const requested = Array.isArray(request.filters) && request.filters.length > 0
    ? request.filters
    : [{ column: request.filterColumn || '', values: request.filterValues || [] }];
  const filters: DatabaseColumnFilter[] = [];
  for (const filter of requested.slice(0, 8)) {
    if (!source.columns.includes(filter?.column || '') || !Array.isArray(filter.values)) continue;
    const values = [...new Set(filter.values
      .filter(value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
      .slice(0, 64))];
    if (values.length > 0) filters.push({ column: filter.column, values });
  }
  return filters;
}

function matchesFilters(
  row: Record<string, unknown>,
  filters: DatabaseColumnFilter[]
): boolean {
  return filters.every(filter => {
    const value = String(row[filter.column] ?? '');
    return filter.values.some(candidate => String(candidate) === value);
  });
}

function inferColumnType(
  worksheet: XLSX.WorkSheet,
  column: number,
  startRow: number,
  endRow: number
): string {
  let numeric = 0;
  let text = 0;
  for (let row = startRow; row <= Math.min(endRow, startRow + 299); row++) {
    const value = cellValue(worksheet, row, column);
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number') numeric++;
    else text++;
  }
  return numeric > 0 && text === 0 ? 'NUMERIC' : 'TEXT';
}

function uniqueColumnName(baseName: string, used: Set<string>): string {
  let candidate = baseName;
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase())) candidate = `${baseName}_${suffix++}`;
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

function cleanProtocolLabel(value: unknown): string {
  return String(value ?? '')
    .replace(/^\/\/;\s*/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function compactLabel(value: string): string {
  const firstLine = value.split('\n')[0].trim();
  return firstLine.length <= 28 ? firstLine : `${firstLine.slice(0, 27)}…`;
}

function compareValues(
  left: unknown,
  right: unknown,
  direction: DatabaseSortDirection
): number {
  const multiplier = direction === 'desc' ? -1 : 1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return (leftNumber - rightNumber) * multiplier;
  }
  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  }) * multiplier;
}

function toPublicTableInfo(source: Biff8TableSource): DatabaseTableInfo {
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

function createBackup(filePath: string): string {
  const backupDirectory = path.join(path.dirname(filePath), 'boo-database-backups');
  fs.mkdirSync(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = `${process.pid}-${process.hrtime.bigint().toString().slice(-6)}`;
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(filePath)}.${stamp}.${suffix}.bak`
  );
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function isFile(candidate: string): boolean {
  try { return fs.statSync(candidate).isFile(); } catch { return false; }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
