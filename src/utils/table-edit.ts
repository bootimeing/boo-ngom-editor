export interface TableCellChange {
  row: number;
  column: number;
  value: string;
}

function positiveDimension(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.max(1, fallback);
  return Math.max(1, Math.floor(value));
}

export function normalizeTableRows(
  rows: readonly (readonly unknown[])[],
  requestedRowCount?: number,
  requestedColumnCount?: number
): string[][] {
  const inferredRows = Math.max(1, rows.length);
  const inferredColumns = rows.reduce(
    (maximum, row) => Math.max(maximum, Array.isArray(row) ? row.length : 0),
    1
  );
  const rowCount = positiveDimension(requestedRowCount, inferredRows);
  const columnCount = positiveDimension(requestedColumnCount, inferredColumns);
  const normalized: string[][] = [];

  for (let row = 0; row < rowCount; row++) {
    const source = Array.isArray(rows[row]) ? rows[row] : [];
    const values: string[] = [];
    for (let column = 0; column < columnCount; column++) {
      values.push(String(source[column] ?? ''));
    }
    normalized.push(values);
  }
  return normalized;
}

export function readTableRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [['']];
  const rows = value.map(row => Array.isArray(row) ? row : []);
  return normalizeTableRows(rows);
}

export function readTableChanges(value: unknown): TableCellChange[] {
  if (!Array.isArray(value)) return [];
  const changes: TableCellChange[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const row = Number(record.row);
    const column = Number(record.column);
    if (!Number.isInteger(row) || row < 0 || !Number.isInteger(column) || column < 0) continue;
    changes.push({ row, column, value: String(record.value ?? '') });
  }
  return changes;
}

export function applyTableChanges(
  rows: readonly (readonly unknown[])[],
  changes: readonly TableCellChange[],
  requestedRowCount?: number,
  requestedColumnCount?: number
): string[][] {
  const maxChangedRow = changes.reduce((maximum, change) => Math.max(maximum, change.row + 1), 0);
  const maxChangedColumn = changes.reduce((maximum, change) => Math.max(maximum, change.column + 1), 0);
  const inferredRows = Math.max(rows.length, maxChangedRow, 1);
  const inferredColumns = rows.reduce(
    (maximum, row) => Math.max(maximum, Array.isArray(row) ? row.length : 0),
    Math.max(maxChangedColumn, 1)
  );
  const rowCount = positiveDimension(requestedRowCount, inferredRows);
  const columnCount = positiveDimension(requestedColumnCount, inferredColumns);
  const next = normalizeTableRows(rows, rowCount, columnCount);

  for (const change of changes) {
    if (change.row >= rowCount || change.column >= columnCount) continue;
    next[change.row][change.column] = String(change.value ?? '');
  }
  return next;
}

export function tableRowsEqual(left: readonly string[][], right: readonly string[][]): boolean {
  if (left.length !== right.length) return false;
  for (let row = 0; row < left.length; row++) {
    if (left[row].length !== right[row].length) return false;
    for (let column = 0; column < left[row].length; column++) {
      if (left[row][column] !== right[row][column]) return false;
    }
  }
  return true;
}
