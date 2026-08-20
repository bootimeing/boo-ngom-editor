const assert = require('node:assert/strict');
const XLSX = require('xlsx');

function main() {
  const {
    openXlsTable,
    serializeXlsTable,
    updateXlsTableRows,
  } = require('../out/utils/xls-table');

  const workbook = XLSX.utils.book_new();
  const first = XLSX.utils.aoa_to_sheet([
    ['名称', '数量', '公式'],
    ['木剑', 2, { t: 'n', f: 'B2*2', v: 4 }],
  ]);
  const second = XLSX.utils.aoa_to_sheet([['保留页'], ['不要丢失']]);
  XLSX.utils.book_append_sheet(workbook, first, '数据');
  XLSX.utils.book_append_sheet(workbook, second, '配置');
  const input = XLSX.write(workbook, { type: 'buffer', bookType: 'xls' });

  const state = openXlsTable(input);
  assert.equal(state.sheetName, '数据');
  assert.deepEqual(state.rows[1].slice(0, 3), ['木剑', '2', '4']);

  updateXlsTableRows(state, [
    ['名称', '数量', '公式'],
    ['木剑', '3', '4'],
  ]);
  const output = serializeXlsTable(state);
  const reopened = XLSX.read(output, { type: 'buffer', cellFormula: true });
  assert.equal(reopened.Sheets['数据'].B2.v, 3);
  assert.equal(reopened.Sheets['数据'].C2.v, 4, 'the cached formula value must survive a cell edit');
  assert.equal(reopened.Sheets['配置'].A2.v, '不要丢失', 'non-active sheets must be preserved');

  console.log('xls-table.test.js: PASS');
}

main();
