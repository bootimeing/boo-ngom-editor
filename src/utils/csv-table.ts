import { normalizeTableRows } from './table-edit';

export interface CsvTableState {
  rows: string[][];
  delimiter: ',' | '\t' | ';';
  eol: '\r\n' | '\n' | '\r';
  hasBom: boolean;
  trailingEol: boolean;
}

const DELIMITERS: CsvTableState['delimiter'][] = [',', '\t', ';'];

function detectDelimiter(text: string): CsvTableState['delimiter'] {
  const counts = new Map<CsvTableState['delimiter'], number>(DELIMITERS.map(value => [value, 0]));
  let quoted = false;
  let physicalLines = 0;
  for (let index = 0; index < text.length && physicalLines < 12; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
      continue;
    }
    if (!quoted && (character === '\r' || character === '\n')) {
      physicalLines++;
      if (character === '\r' && text[index + 1] === '\n') index++;
      continue;
    }
    if (!quoted && counts.has(character as CsvTableState['delimiter'])) {
      const delimiter = character as CsvTableState['delimiter'];
      counts.set(delimiter, (counts.get(delimiter) ?? 0) + 1);
    }
  }
  return DELIMITERS.reduce((best, candidate) => (
    (counts.get(candidate) ?? 0) > (counts.get(best) ?? 0) ? candidate : best
  ), ',');
}

function detectEol(text: string): CsvTableState['eol'] {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const withoutCrlf = text.replace(/\r\n/g, '');
  const lf = (withoutCrlf.match(/\n/g) ?? []).length;
  const cr = (withoutCrlf.match(/\r/g) ?? []).length;
  if (crlf >= lf && crlf >= cr && crlf > 0) return '\r\n';
  if (cr > lf && cr > 0) return '\r';
  return '\n';
}

function parseRows(text: string, delimiter: CsvTableState['delimiter']): string[][] {
  if (text.length === 0) return [['']];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = '';
    } else if (character === '\r' || character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (character === '\r' && text[index + 1] === '\n') index++;
    } else {
      cell += character;
    }
  }

  if (cell.length > 0 || row.length > 0 || rows.length === 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.length ? rows : [['']];
}

export function parseCsvTable(source: string): CsvTableState {
  const hasBom = source.charCodeAt(0) === 0xfeff;
  const text = hasBom ? source.slice(1) : source;
  const delimiter = detectDelimiter(text);
  const rows = parseRows(text, delimiter);
  const columnCount = rows.reduce((maximum, row) => Math.max(maximum, row.length), 1);
  return {
    rows: normalizeTableRows(rows, rows.length, columnCount),
    delimiter,
    eol: detectEol(text),
    hasBom,
    trailingEol: /(?:\r\n|\r|\n)$/.test(text),
  };
}

function quoteCell(value: string, delimiter: CsvTableState['delimiter']): string {
  if (!value.includes(delimiter) && !/["\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function serializeCsvTable(state: CsvTableState): string {
  const body = state.rows.map(row => (
    row.map(value => quoteCell(String(value ?? ''), state.delimiter)).join(state.delimiter)
  )).join(state.eol);
  return `${state.hasBom ? '\ufeff' : ''}${body}${state.trailingEol ? state.eol : ''}`;
}
