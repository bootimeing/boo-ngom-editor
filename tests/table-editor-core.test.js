const assert = require('node:assert/strict');
const core = require('../media/table-editor-core');

function main() {
  assert.equal(core.columnName(0), 'A');
  assert.equal(core.columnName(25), 'Z');
  assert.equal(core.columnName(26), 'AA');
  assert.equal(core.columnIndex('AA'), 26);
  assert.equal(core.columnIndex('bad-1'), -1);

  const clipboard = 'A\t"B\r\nC"\r\nD\tE\r\n';
  const matrix = core.parseClipboardText(clipboard);
  assert.deepEqual(matrix, [['A', 'B\r\nC'], ['D', 'E']]);
  assert.deepEqual(core.parseClipboardText(core.formatClipboardText(matrix)), matrix);

  const vertical = core.calculateFillChanges(
    [['1'], ['3']],
    { top: 0, bottom: 1, left: 0, right: 0 },
    4,
    0,
  );
  assert.equal(vertical.direction, 'vertical');
  assert.deepEqual(vertical.changes.map(change => change.value), ['5', '7', '9']);

  const padded = core.calculateFillChanges(
    [['009']],
    { top: 0, bottom: 0, left: 0, right: 0 },
    2,
    0,
  );
  assert.deepEqual(padded.changes.map(change => change.value), ['010', '011']);

  const horizontal = core.calculateFillChanges(
    [['item08', 'item10']],
    { top: 0, bottom: 0, left: 0, right: 1 },
    0,
    3,
  );
  assert.equal(horizontal.direction, 'horizontal');
  assert.deepEqual(horizontal.changes.map(change => change.value), ['item12', 'item14']);

  assert.deepEqual(
    core.calculateSelectionFillChanges(
      [['A'], ['B'], ['C'], ['D']],
      { top: 0, bottom: 3, left: 0, right: 0 },
    ),
    [
      { row: 1, column: 0, value: 'A' },
      { row: 2, column: 0, value: 'A' },
      { row: 3, column: 0, value: 'A' },
    ],
  );
  assert.deepEqual(
    core.calculateSelectionFillChanges(
      [['A', 'B', 'C', 'D']],
      { top: 0, bottom: 0, left: 0, right: 3 },
    ),
    [
      { row: 0, column: 1, value: 'A' },
      { row: 0, column: 2, value: 'A' },
      { row: 0, column: 3, value: 'A' },
    ],
  );
  assert.deepEqual(
    core.calculateSelectionFillChanges(
      [['A', 'B'], ['C', 'D'], ['E', 'F']],
      { top: 0, bottom: 2, left: 0, right: 1 },
    ),
    [
      { row: 1, column: 0, value: 'A' },
      { row: 1, column: 1, value: 'B' },
      { row: 2, column: 0, value: 'A' },
      { row: 2, column: 1, value: 'B' },
    ],
  );
  assert.deepEqual(core.calculateSelectionFillChanges([['A']], { top: 0, bottom: 0, left: 0, right: 0 }), []);

  assert.deepEqual(
    core.calculateIncrementChanges(
      [['10', 'not-a-number'], ['20', '30'], ['0040', '2.5']],
      { top: 0, bottom: 2, left: 0, right: 1 },
      2,
    ),
    {
      changes: [
        { row: 0, column: 0, value: '12' },
        { row: 1, column: 0, value: '24' },
        { row: 1, column: 1, value: '36' },
        { row: 2, column: 0, value: '0048' },
        { row: 2, column: 1, value: '12.5' },
      ],
      skipped: 1,
    },
  );
  assert.deepEqual(
    core.calculateIncrementChanges(
      [['10'], ['20'], ['30']],
      { top: 0, bottom: 2, left: 0, right: 0 },
      -1,
    ).changes.map(change => change.value),
    ['9', '18', '27'],
  );

  const compacted = core.applyChanges(
    [['A'], ['']],
    [{ row: 5, column: 2, value: 'X' }],
    2,
    1,
  );
  assert.deepEqual(core.tableSize(compacted), { rows: 6, columns: 3 });
  const cleared = core.applyChanges(compacted, [{ row: 5, column: 2, value: '' }], 2, 1);
  assert.deepEqual(cleared, [['A'], ['']]);

  console.log('table-editor-core.test.js: PASS');
}

main();
