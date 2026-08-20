const assert = require('node:assert/strict');

function main() {
  const { transformBatchNumbers } = require('../out/utils/number-transform');

  assert.deepEqual(transformBatchNumbers(['001 010', '100 200'], 'incrementAdd', 1), {
    texts: ['002 012', '103 204'],
    count: 4,
  });
  assert.deepEqual(transformBatchNumbers(['001 010', '100'], 'incrementAdd', 2), {
    texts: ['003 014', '106'],
    count: 3,
  });
  assert.deepEqual(transformBatchNumbers(['001 -002 3.5'], 'incrementAdd', 1), {
    texts: ['002 000 6.5'],
    count: 3,
  });
  assert.deepEqual(transformBatchNumbers(['001 009'], 'add', 2).texts, ['003 011']);
  assert.deepEqual(transformBatchNumbers(['010'], 'div', 0).texts, ['010']);
  assert.throws(() => transformBatchNumbers(['001'], 'incrementAdd', Infinity), /有限数字/);

  console.log('batch-number-edit.test.js: PASS');
}

main();
