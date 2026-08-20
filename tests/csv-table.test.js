const assert = require('node:assert/strict');

function main() {
  const { parseCsvTable, serializeCsvTable } = require('../out/utils/csv-table');
  const {
    applyTableChanges,
    normalizeTableRows,
    readTableChanges,
    tableRowsEqual,
  } = require('../out/utils/table-edit');

  const tabSeparated = '\ufeff名称\t说明\r\n木剑\t"第一行\r\n第二行"\r\n';
  const parsed = parseCsvTable(tabSeparated);
  assert.equal(parsed.hasBom, true);
  assert.equal(parsed.delimiter, '\t');
  assert.equal(parsed.eol, '\r\n');
  assert.equal(parsed.trailingEol, true);
  assert.deepEqual(parsed.rows, [
    ['名称', '说明'],
    ['木剑', '第一行\r\n第二行'],
  ]);
  assert.equal(serializeCsvTable(parsed), tabSeparated, 'BOM, delimiter, EOL and quoted newlines must survive');

  const commaSeparated = 'name,note\nSword,"a, b and ""quoted"""';
  const commaState = parseCsvTable(commaSeparated);
  assert.equal(commaState.delimiter, ',');
  assert.deepEqual(commaState.rows[1], ['Sword', 'a, b and "quoted"']);
  assert.equal(serializeCsvTable(commaState), commaSeparated);

  const semicolonState = parseCsvTable('name;value\ritem;2');
  assert.equal(semicolonState.delimiter, ';');
  assert.equal(semicolonState.eol, '\r');

  const original = normalizeTableRows([['A', 'B'], ['C', 'D']]);
  const patched = applyTableChanges(original, [
    { row: 0, column: 1, value: 'B2' },
    { row: 2, column: 2, value: 'X' },
  ], 3, 3);
  assert.deepEqual(patched, [
    ['A', 'B2', ''],
    ['C', 'D', ''],
    ['', '', 'X'],
  ]);
  assert.equal(tableRowsEqual(original, patched), false);
  assert.deepEqual(readTableChanges([
    { row: 1, column: 0, value: 0 },
    { row: -1, column: 0, value: 'ignored' },
    { row: 0.5, column: 1, value: 'ignored' },
  ]), [{ row: 1, column: 0, value: '0' }]);

  console.log('csv-table.test.js: PASS');
}

main();
