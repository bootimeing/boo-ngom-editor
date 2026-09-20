const assert = require('node:assert/strict');
const path = require('node:path');

const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { resolvePreviewExpression } = require(path.join(runtimeRoot, 'out/ui-dialog/preview-inputs'));
const { resolveDialogVariables } = require(path.join(runtimeRoot, 'out/ui-dialog/variable-resolver'));

function modelFor(source, values, reader, engine = 'GOM') {
  return resolveDialogVariables(source, {
    rootLabel: '@main',
    targetLabels: ['@main'],
    engine,
    previewValues: values,
    dataOptions: { resolvePreviewCsvData: reader },
  });
}

function run() {
  const rows = [
    ['0', '1', '50', '5', '50000'],
    ['1', '2', '60', '10', '100000'],
  ];
  const resolveCsv = (name, args, resolve) => {
    if (name.toUpperCase() !== '转生系统' || args.length < 2) return undefined;
    const row = Number(resolve(args[0]));
    const column = Number(resolve(args[1]));
    return Number.isSafeInteger(row) && Number.isSafeInteger(column)
      ? rows[row]?.[column]
      : undefined;
  };
  const read = name => ({ N0: '1' }[name]);

  assert.equal(
    resolvePreviewExpression('<$转生系统(<$str(N0)>,4)>', read, 'GOM', resolveCsv),
    '100000',
    'nested CSV function arguments must use the selected numeric variable',
  );
  assert.equal(
    resolvePreviewExpression('<$转生系统(1,1)>', () => undefined, 'GOM', resolveCsv),
    '2',
    'CSV cached aliases must resolve literal row/column coordinates',
  );
  assert.equal(
    resolvePreviewExpression('<$转生系统(9,1)>', () => undefined, 'GOM', resolveCsv),
    undefined,
    'out-of-range CSV rows remain unknown rather than borrowing a fallback value',
  );
  assert.equal(
    resolvePreviewExpression('<$转生系统(1,1)>', () => undefined, 'GOM'),
    undefined,
    'without an executed cache resolver, an unknown function stays unresolved',
  );

  const script = [
    '[@main]',
    '#ACT',
    'CSVOpenCache ..\\QuestDiary\\转生系统.csv',
    'MOV n$当前转生等级 <$relevel>',
    '#SAY',
    '<&text:<$转生系统(<$str(n$当前转生等级)>,4)>:10:10>',
  ].join('\n');
  const model = resolveDialogVariables(script, {
    rootLabel: '@main',
    targetLabels: ['@main'],
    engine: 'GOM',
    previewValues: { RELEVEL: '1' },
    dataOptions: {
      // The production ScriptDataResolver supplies this callback only after a
      // bounded local CSV read; this test keeps the model self-contained.
      resolvePreviewCsvData: () => ({ rows, complete: true }),
    },
  });
  const event = model.executionTrace?.[0];
  assert.equal(event?.resolution.text, '<&text:100000:10:10>',
    'executed CSVOpenCache alias must feed the selected preview variable into SAY');

  // The cache is source-order state: a SAY before OPEN cannot borrow a later
  // open, while the next SAY can use the loaded snapshot.
  const ordered = modelFor([
    '[@main]', '#SAY', '<&text:<$order(0,0)>:0:0>',
    '#ACT', 'CSVOpenCache order.csv',
    '#SAY', '<&text:<$order(0,0)>:0:0>',
  ].join('\n'), {}, request => request.path === 'order.csv'
    ? { rows: [['after-open']], complete: true } : undefined);
  assert.equal(ordered.executionTrace?.[0].resolution.text, '<&text:预览文字:0:0>',
    'later CSVOpenCache must not backfill an earlier SAY');
  assert.equal(ordered.executionTrace?.[1].resolution.text, '<&text:after-open:0:0>',
    'the first SAY after CSVOpenCache uses its bounded snapshot');

  // A failed refresh invalidates the previous snapshot rather than silently
  // reusing stale data.
  let refresh = 0;
  const invalidated = modelFor([
    '[@main]', '#ACT', 'CSVOpenCache refresh.csv',
    '#SAY', '<&text:<$refresh(0,0)>:0:0>',
    '#ACT', 'CSVOpenCache refresh.csv',
    '#SAY', '<&text:<$refresh(0,0)>:0:0>',
  ].join('\n'), {}, request => {
    refresh++;
    return refresh === 1 ? { rows: [['old']], complete: true } : undefined;
  });
  assert.equal(invalidated.executionTrace?.[0].resolution.text, '<&text:old:0:0>');
  assert.equal(invalidated.executionTrace?.[1].resolution.text, '<&text:预览文字:0:0>',
    'a failed repeated open must invalidate its old alias');

  // Distinct source paths with the same basename are intentionally ambiguous,
  // even when a caller happens to return identical cell values for both.
  const ambiguous = modelFor([
    '[@main]', '#ACT', 'CSVOpenCache one\\same.csv',
    'CSVOpenCache two\\same.csv', '#SAY', '<&text:<$same(0,0)>:0:0>',
  ].join('\n'), {}, request => ({ rows: [['same']], complete: true }));
  assert.equal(ambiguous.executionTrace?.[0].resolution.text, '<&text:预览文字:0:0>',
    'same-basename paths must not be selected by equal cell contents');

  let dynamicReads = 0;
  const dynamic = modelFor([
    '[@main]', '#ACT', 'CSVOpenCache <$S$path>',
    '#SAY', '<&text:<$path(0,0)>:0:0>',
  ].join('\n'), { 'S$path': 'user.csv' }, () => { dynamicReads++; return { rows: [['secret']], complete: true }; });
  assert.equal(dynamicReads, 0, 'a user-controlled cache path must not select a file');
  assert.equal(dynamic.executionTrace?.[0].resolution.text, '<&text:预览文字:0:0>');

  const nonGom = modelFor([
    '[@main]', '#ACT', 'CSVOpenCache non-gom.csv',
    '#SAY', '<&text:<$non-gom(0,0)>:0:0>',
  ].join('\n'), {}, () => ({ rows: [['must-not-read']], complete: true }), 'GEE');
  assert.equal(nonGom.executionTrace?.[0].resolution.text, '<&text:预览文字:0:0>',
    'the GOM CSV cache shorthand is not borrowed by GEE');

  // Raw function-argument boundaries survive user commas and closing parens.
  const row = [['A,B'], ['C)']];
  const rowResolver = (name, args, resolve) => {
    if (name.toUpperCase() !== 'SAME.ROW' || args.length !== 3) return undefined;
    const direction = resolve(args[0]), search = resolve(args[1]), column = resolve(args[2]);
    if (direction !== '0' || column !== '0') return undefined;
    return String(row.findIndex(cells => cells.length > Number(column) && cells[Number(column)] === search));
  };
  assert.equal(resolvePreviewExpression('<$SAME.ROW(0,<$STR(S$key)>,0)>',
    name => name === 'S$key' ? 'A,B' : undefined, 'GOM', rowResolver), '0');
  assert.equal(resolvePreviewExpression('<$SAME.ROW(0,<$STR(S$key)>,0)>',
    name => name === 'S$key' ? 'C)' : undefined, 'GOM', rowResolver), '1');

  // Unknown row/column inputs must remain unknown, never coerce to index 0.
  let unknownReads = 0;
  const unknown = resolvePreviewExpression('<$same(<$UNKNOWN>,0)>', () => undefined, 'GOM',
    (name, args, resolve) => {
      unknownReads++;
      const value = resolve(args[0]);
      return value === undefined ? undefined : 'wrong';
    });
  assert.equal(unknown, undefined);
  assert.equal(unknownReads, 1);

  // Exercise the production alias implementation, not just a mock callback.
  const tableModel = (expression, data = [[' zero '], ['A,B'], ['C)'], ['x', '']], values = {}) => modelFor([
    '[@main]', '#ACT', 'CSVOpenCache table.csv', '#SAY', `<&text:${expression}:0:0>`,
  ].join('\n'), values, () => ({ rows: data, complete: true })).executionTrace[0].resolution.text;
  assert.equal(tableModel('<$table(0,0)>'), '<&text: zero :0:0>', 'cell whitespace survives the production resolver');
  for (const expression of ['<$table(,0)>', '<$table(0,)>', '<$table(-1,0)>', '<$table(0.5,0)>',
    '<$table(0,0,1)>', '<$table(UNKNOWN,0)>', '<$table(99,0)>', '<$table.ROW(2,"A,B",0)>']) {
    assert.equal(tableModel(expression), '<&text:预览文字:0:0>', expression);
  }
  assert.equal(tableModel('<$table.ROW(0,<$STR(S$key)>,0)>', undefined, { 'S$key': 'A,B' }), '<&text:1:0:0>');
  assert.equal(tableModel('<$table.ROW(0,<$STR(S$key)>,0)>', undefined, { 'S$key': 'C)' }), '<&text:2:0:0>');
  assert.equal(tableModel('<$table.ROW(0,"",1)>'), '<&text:3:0:0>', 'missing column is not a present empty cell');
  let refreshCount = 0;
  const reopened = modelFor(['[@main]', '#ACT', 'CSVOpenCache fresh.csv', '#SAY', '<&text:<$fresh(0,0)>:0:0>',
    '#ACT', 'CSVOpenCache fresh.csv', '#SAY', '<&text:<$fresh(0,0)>:0:0>'].join('\n'), {},
  () => ({ rows: [[++refreshCount === 1 ? 'old' : 'new']], complete: true }));
  assert.equal(refreshCount, 2, 'one bounded read per executed open, not per displayed cell');
  assert.deepEqual(reopened.executionTrace.map(item => item.resolution.text), ['<&text:old:0:0>', '<&text:new:0:0>']);
  console.log('preview-csv-functions.test.js: PASS');
}

if (require.main === module) run();
module.exports = { run };
