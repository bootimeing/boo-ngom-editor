export type ScriptTableFormat = 'excel' | 'csv';

export function isBinarySpreadsheet(raw: Uint8Array): boolean {
  return raw.length >= 8 && (
    (raw[0] === 0xd0 && raw[1] === 0xcf && raw[2] === 0x11 && raw[3] === 0xe0 &&
      raw[4] === 0xa1 && raw[5] === 0xb1 && raw[6] === 0x1a && raw[7] === 0xe1) ||
    (raw[0] === 0x50 && raw[1] === 0x4b && raw[2] === 0x03 && raw[3] === 0x04)
  );
}

export function parseScriptTableData(
  text: string,
  format: ScriptTableFormat,
): string[][] {
  const normalized = text.replace(/^\uFEFF/, '');
  const delimiter = format === 'csv' ? ',' : detectExcelDelimiter(normalized);
  return parseDelimitedRows(normalized, delimiter)
    .filter(row => row.some(cell => cell.trim().length > 0))
    .filter(row => !row[0]?.trimStart().startsWith(';'));
}

function detectExcelDelimiter(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    return countOutsideQuotes(line, '\t') > 0 ? '\t' : ',';
  }
  return '\t';
}

function countOutsideQuotes(value: string, target: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '"') {
      if (quoted && value[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && value[index] === target) {
      count++;
    }
  }
  return count;
}

function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const finishField = () => {
    row.push(field);
    field = '';
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      finishField();
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && text[index + 1] === '\n') index++;
      finishRow();
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) finishRow();
  return rows;
}
