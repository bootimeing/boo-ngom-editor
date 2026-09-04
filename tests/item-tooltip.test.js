const assert = require('node:assert/strict');

function flattened(preview) {
  return (preview?.lines || []).map(line => line.map(run => run.text).join('')).join('\n');
}

function main() {
  const { buildDialogItemTooltip } = require('../out/ui-dialog/item-tooltip');

  const database = buildDialogItemTooltip({
    mode: 'database-index', itemIndex: 1927, quantity: 3, showTips: true,
    label: '物品 IDX 1927',
  }, {
    Name: '承影', StdMode: '5', Shape: '7', Weight: '12', Looks: '20699', DuraMax: '30000',
  });
  assert.equal(database.kind, 'item');
  assert.match(flattened(database), /数据库基础属性预览/);
  assert.match(flattened(database), /承影/);
  assert.match(flattened(database), /StdMode 5/);
  assert.match(flattened(database), /Looks 20699/);
  assert.match(flattened(database), /数量 3/);
  assert.match(flattened(database), /运行时极品|鉴定|强化/);

  const runtime = buildDialogItemTooltip({
    mode: 'equipment', equipmentSlot: 3, showTips: true,
    label: '人物装备位 3',
  });
  assert.match(flattened(runtime), /运行时属性无法离线还原/);
  assert.match(flattened(runtime), /人物装备位 3/);

  assert.equal(buildDialogItemTooltip({
    mode: 'database-index', itemIndex: 1927, showTips: false, label: '物品 IDX 1927',
  }), undefined);
  assert.equal(buildDialogItemTooltip({
    mode: 'database-index', itemIndex: 1927, label: '物品 IDX 1927',
  }), undefined);
  console.log('item-tooltip.test.js: PASS');
}

main();
