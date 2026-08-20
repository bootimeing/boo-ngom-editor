import * as XLSX from 'xlsx';

export interface XlsTableState {
  workbook: XLSX.WorkBook;
  sheetName: string;
  rows: string[][];
  originalRows: string[][];
  formulaCellCount: number;
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  return String(cell.v);
}

function readSheetRows(sheet: XLSX.WorkSheet): string[][] {
  const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : undefined;
  if (!range) return [['']];
  const rows: string[][] = [];
  for (let row = range.s.r; row <= range.e.r; row++) {
    const values: string[] = [];
    for (let column = range.s.c; column <= range.e.c; column++) {
      values.push(cellText(sheet[XLSX.utils.encode_cell({ r: row, c: column })]));
    }
    rows.push(values);
  }
  return rows.length ? rows : [['']];
}

function cloneRows(rows: string[][]): string[][] {
  return rows.map(row => row.map(value => String(value ?? '')));
}

function countWorkbookFormulas(workbook: XLSX.WorkBook): number {
  let count = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!')) continue;
      if (cell && typeof cell === 'object' && typeof (cell as XLSX.CellObject).f === 'string') count++;
    }
  }
  return count;
}

function valueCell(value: string, previous?: XLSX.CellObject): XLSX.CellObject {
  if (previous?.t === 'n' && /^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) {
    return { t: 'n', v: Number(value) };
  }
  if (previous?.t === 'b' && /^(?:true|false)$/i.test(value.trim())) {
    return { t: 'b', v: value.trim().toLowerCase() === 'true' };
  }
  if (!previous && /^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) {
    return { t: 'n', v: Number(value) };
  }
  return { t: 's', v: value };
}

function usedSize(rows: string[][]): { rowCount: number; columnCount: number } {
  const rowCount = Math.max(1, rows.length);
  const columnCount = Math.max(1, ...rows.map(row => row.length));
  return { rowCount, columnCount };
}

export function openXlsTable(data: Uint8Array | Buffer): XlsTableState {
  const workbook = XLSX.read(data, {
    type: 'buffer',
    cellFormula: true,
    cellStyles: true,
    cellNF: true,
    cellDates: true,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName || !workbook.Sheets[sheetName]) {
    throw new Error('XLS 文件中没有可读取的工作表');
  }
  const rows = readSheetRows(workbook.Sheets[sheetName]);
  return {
    workbook,
    sheetName,
    rows,
    originalRows: cloneRows(rows),
    formulaCellCount: countWorkbookFormulas(workbook),
  };
}

export function updateXlsTableRows(state: XlsTableState, nextRows: string[][]): void {
  const sheet = state.workbook.Sheets[state.sheetName];
  if (!sheet) throw new Error(`工作表不存在: ${state.sheetName}`);

  const normalized = cloneRows(nextRows.length ? nextRows : [['']]);
  const oldSize = usedSize(state.rows);
  const newSize = usedSize(normalized);
  const maxRows = Math.max(oldSize.rowCount, newSize.rowCount);
  const maxColumns = Math.max(oldSize.columnCount, newSize.columnCount);

  for (let row = 0; row < maxRows; row++) {
    for (let column = 0; column < maxColumns; column++) {
      const oldValue = state.rows[row]?.[column] ?? '';
      const hasNewCell = row < normalized.length && column < (normalized[row]?.length ?? 0);
      const newValue = hasNewCell ? normalized[row][column] : '';
      if (hasNewCell && newValue === oldValue) continue;

      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (!hasNewCell || newValue === '') {
        delete sheet[address];
        continue;
      }
      sheet[address] = valueCell(newValue, sheet[address]);
    }
  }

  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: newSize.rowCount - 1, c: newSize.columnCount - 1 },
  });
  state.rows = normalized;
}

export function serializeXlsTable(state: XlsTableState): Buffer {
  return Buffer.from(XLSX.write(state.workbook, {
    type: 'buffer',
    bookType: 'xls',
    cellStyles: true,
  }));
}
