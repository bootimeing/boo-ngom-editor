import * as XLSX from 'xlsx';
import { EngineId } from '../types';
import { NestedTableDataRequest, NestedTableDataResult } from '../utils/nested-variable-analysis';

const MAX_PREVIEW_COLUMNS = 512;
const MAX_PREVIEW_CELL_LENGTH = 4096;
const MAX_PREVIEW_ROW_LENGTH = 65536;
const MAX_WORKBOOK_BYTES = 16 * 1024 * 1024;
const MAX_TABLE_CELLS = 1024 * 1024;
const MAX_TABLE_TEXT = 8 * 1024 * 1024;

export interface PreviewExcelResolvedValue {
  value: string;
  complete: boolean;
  localPreview?: boolean;
  dependencies?: readonly string[];
}

export interface PreviewExcelCallbacks {
  resolve(raw: string, role: 'path' | 'row'): PreviewExcelResolvedValue | undefined;
  /** The caller must restrict this read to an authorised, local Envir XLS file. */
  readTable(request: NestedTableDataRequest): NestedTableDataResult | undefined;
  knownRegisters?: Iterable<string>;
  /** Undefined invalidates stale values. This channel never grants database IDX provenance. */
  write(name: string, value: string | undefined, dependencies: readonly string[], localPreview: boolean): void;
  warn?(message: string): void;
}

/** The own GOM/996PC manuals use GLOBAL(ExcelN); bare EXCELN is the panel identity. */
export function previewExcelRegisterName(raw: string, engine: EngineId): string | undefined {
  if (engine !== 'GOM' && engine !== '996PC') return undefined;
  let value = raw.trim();
  if (value.startsWith('<$') && value.endsWith('>')) value = value.slice(2, -1).trim();
  const wrapped = /^STR\((.*)\)$/i.exec(value);
  if (wrapped) value = wrapped[1].trim();
  const match = /^(?:EXCEL(\d+)|GLOBAL\(EXCEL(\d+)\))$/i.exec(value);
  if (!match) return undefined;
  const index = Number(match[1] || match[2]);
  return Number.isSafeInteger(index) ? `EXCEL${index}` : undefined;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  return /^(?:".*"|'.*')$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
}

/**
 * Execute only the evidenced local, source-order READEXCEL effect. The first
 * worksheet row is 1 and column registers start at EXCEL0. No filesystem API,
 * workbook write, engine process or arbitrary expression execution is used.
 */
export function applyPreviewExcelCommand(
  command: string,
  parts: readonly string[],
  callbacks: PreviewExcelCallbacks,
  engine: EngineId
): boolean {
  if (command.toUpperCase() !== 'READEXCEL' || (engine !== 'GOM' && engine !== '996PC')) return false;
  // Capture operands before invalidating outputs: a later read may itself use
  // a column of the previous row as its path or next row selector.
  const file = parts.length === 2 ? callbacks.resolve(parts[0], 'path') : undefined;
  const rowValue = parts.length === 2 ? callbacks.resolve(parts[1], 'row') : undefined;
  // A failed/missing later read must not silently reuse an earlier row. The
  // real engine's failed-read retention is not documented; expose unknown.
  const known = new Set<string>();
  for (const raw of callbacks.knownRegisters || []) {
    const name = previewExcelRegisterName(raw, engine);
    if (name) known.add(name);
  }
  for (const name of known) callbacks.write(name, undefined, [], false);
  const warn = (reason: string) => callbacks.warn?.(`READEXCEL：${reason}`);
  if (parts.length !== 2) {
    warn('本引擎格式为“表格路径 行号”两个参数；列值保持待输入状态');
    return true;
  }
  const filePath = file ? unquote(file.value) : '';
  if (!file?.complete || file.localPreview || !filePath || /[\u0000-\u001f]|<\$|^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(filePath)
    || !/\.xls$/i.test(filePath)) {
    warn('仅可读取源码可确定且非用户输入指定的 XLS 路径；列值保持待输入状态');
    return true;
  }
  const rawRow = rowValue ? unquote(rowValue.value) : '';
  const row = /^\+?\d+$/.test(rawRow) ? Number(rawRow) : NaN;
  if (!rowValue?.complete || !Number.isSafeInteger(row) || row < 1) {
    warn('行号须可确定为从 1 开始的正整数；没有读取表格');
    return true;
  }
  let table: NestedTableDataResult | undefined;
  try { table = callbacks.readTable({ path: filePath, format: 'excel' }); }
  catch { /* Damaged or denied data is an unknown value, not a preview failure. */ }
  if (!table?.complete) {
    warn('工作区表格缺失、不安全或不能确定读取；未沿用旧行数据');
    return true;
  }
  const cells = table.rows[row - 1];
  if (!cells) {
    warn(`表格中没有第 ${row} 行；未沿用旧行数据`);
    return true;
  }
  const dependencies = [...new Set([...(file.dependencies || []), ...(rowValue.dependencies || [])])];
  const localPreview = rowValue.localPreview === true;
  let rowLength = 0, bounded = cells.length > MAX_PREVIEW_COLUMNS;
  for (let column = 0; column < Math.min(cells.length, MAX_PREVIEW_COLUMNS); column++) {
    const value = cells[column];
    rowLength += typeof value === 'string' ? value.length : 0;
    const valid = typeof value === 'string' && value.length <= MAX_PREVIEW_CELL_LENGTH && rowLength <= MAX_PREVIEW_ROW_LENGTH;
    if (!valid) bounded = true;
    callbacks.write(`EXCEL${column}`, valid ? value : undefined, dependencies, localPreview);
  }
  if (bounded) warn('本地预览上限为 512 列、单元格 4096 字符、整行 65536 字符；超限部分保留待输入状态');
  return true;
}

/**
 * Read a BIFF8 XLS buffer without compacting its used range. The generic XLS
 * editor intentionally returns rows relative to !ref; READEXCEL instead needs
 * absolute A1 coordinates, including leading empty rows and columns.
 * Sheet selection and formula recalculation have no evidenced offline rule,
 * so multi-sheet or formula-bearing workbooks are deliberately rejected.
 */
export function readPreviewExcelTable(
  data: Uint8Array,
  warn?: (message: string) => void
): NestedTableDataResult | undefined {
  const reject = (reason: string): undefined => { warn?.(reason); return undefined; };
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (data.length < 8 || data.length > MAX_WORKBOOK_BYTES || !signature.every((byte, index) => data[index] === byte)) {
    return reject('仅接受不超过 16 MiB 的 BIFF8 XLS 文件，不能以 XLSX/CSV 改名替代');
  }
  try {
    const buffer = Buffer.from(data);
    const container = XLSX.CFB.read(buffer, { type: 'buffer' }) as { FileIndex?: { name?: string; content?: Uint8Array }[] };
    const streams = (container.FileIndex || []).filter(entry => /^(?:Workbook|Book)$/i.test(entry.name || ''));
    if (streams.length !== 1) return reject('XLS 工作簿流缺失或不唯一');
    const stream = streams[0].content;
    if (!stream || stream.length < 8 || stream[0] !== 0x09 || stream[1] !== 0x08 || stream[4] !== 0x00 || stream[5] !== 0x06) {
      return reject('工作簿不是已验证的 BIFF8 格式');
    }
    for (let cursor = 0; cursor + 4 <= stream.length;) {
      const record = stream[cursor] | (stream[cursor + 1] << 8);
      const length = stream[cursor + 2] | (stream[cursor + 3] << 8);
      if (cursor + 4 + length > stream.length) return reject('XLS 记录长度损坏');
      // Check the original records too: a library may retain the cached value
      // but omit .f when it cannot decode a formula token sequence.
      if (record === 0x0006) return reject('公式重算需要运行时语义，不能将缓存结果当成当前确定值');
      if (record === 0x002f) return reject('不读取加密工作簿');
      cursor += 4 + length;
    }
    const workbook = XLSX.read(buffer, { type: 'buffer', cellFormula: true, cellDates: false, cellNF: false, cellHTML: false, cellText: false });
    if (workbook.SheetNames.length !== 1) return reject('多工作表的选表规则缺少本引擎证据，不能擅自选择第一张');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    for (const [address, cell] of Object.entries(sheet)) {
      if (!address.startsWith('!') && cell && typeof cell === 'object' && typeof (cell as XLSX.CellObject).f === 'string') {
        return reject('公式重算需要运行时语义，不能将缓存结果当成当前确定值');
      }
    }
    if (!sheet['!ref']) return { rows: [], complete: true };
    const range = XLSX.utils.decode_range(sheet['!ref']);
    if (range.e.r < 0 || range.e.r > 65535 || range.e.c < 0 || range.e.c > 255
      || (range.e.r + 1) * (range.e.c + 1) > MAX_TABLE_CELLS) return reject('工作表尺寸超出本地安全读取上限');
    const rows: string[][] = [];
    let totalText = 0;
    for (let row = 0; row <= range.e.r; row++) {
      const cells: string[] = [];
      for (let column = 0; column <= range.e.c; column++) {
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject | undefined;
        if (cell?.t === 'e') return reject('工作表含错误值，不能作为确定的脚本列值');
        const value = cell?.v === undefined || cell.v === null ? '' : String(cell.v);
        totalText += value.length;
        if (totalText > MAX_TABLE_TEXT) return reject('工作表文字总量超出 8 MiB 本地读取上限');
        cells.push(value);
      }
      rows.push(cells);
    }
    return { rows, complete: true };
  } catch { return reject('XLS 文件损坏、加密或格式不能确定'); }
}
