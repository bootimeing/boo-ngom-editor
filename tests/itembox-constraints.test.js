const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

/*
 * Manual-backed contract:
 *   <ITEMBOX:N:F:M:X:Y:W:H:S:T>
 *     F=-1 means that no background is drawn.
 *     S is a comma-separated StdMode list, while S=* accepts every StdMode.
 *   <ITEMBOX|boxindex=...|stdmode=...|wil=...|pcimg=...|tips=...>
 *     996PC documents the same box-index/StdMode/background/tips semantics.
 *
 * A box can be drawn statically, but the player's bag, the item actually
 * dragged into it, and the server-side accept/reject result are runtime data.
 */

function parse(engine, statements) {
  const source = [
    '[@main]',
    '#ACT',
    'MOV N$BOX_F 2',
    'MOV S$BOX_STDMODE 10,11',
    'MOV N$BOX_INDEX 6',
    '#SAY',
    ...statements,
  ].join('\n');
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/itembox-${engine}.txt`,
    fileName: `itembox-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\itembox-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine === '996PC' ? '996PC' : '新GOM',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function elements(model, statementId) {
  return model.pages
    .flatMap(page => page.elements || [])
    .filter(element => element.statementId === statementId);
}

function keyedElement(model, id) {
  return model.pages
    .flatMap(page => page.elements || [])
    .find(element => element.containerElementId === id);
}

function fieldSet(preview, property) {
  return new Set(preview?.[property] || []);
}

function tooltipText(element) {
  return (element.tooltipPreview?.lines || [])
    .flat()
    .map(run => run.text || '')
    .join('');
}

function assertNoBackgroundReference(element, message) {
  assert.equal(element.assetRef, undefined, `${message}: top-level assetRef must be absent`);
  assert.equal(
    (element.assetLayers || []).some(layer => layer.role === 'background'),
    false,
    `${message}: no background layer may reach the provider`
  );
}

function assertRuntimeBoundary(element) {
  const warning = element.warning || '';
  assert.match(warning, /Runtime-data blocked/i,
    'ITEMBOX must be explicitly classified as runtime-data blocked');
  assert.match(warning, /实际拖入/,
    'the model must state that a real drag-in cannot be simulated offline');
  assert.match(warning, /人物背包/,
    'the model must state that character-bag contents are unavailable offline');
  assert.match(warning, /服务器.*接受.*拒绝|服务器.*拒绝.*接受/,
    'the model must state that server accept/reject behavior is not simulated');
}

function testCatalogAndTraditionalStaticConstraints() {
  const catalog = buildDialogStatementCatalog(staticLanguage, 'GOM');
  assert.ok(catalog.some(schema => schema.id === 'item-box'),
    'the documented traditional ITEMBOX must remain in the GOM catalog');

  const model = parse('GOM', [
    '<ITEMBOX:3:-1:117:20:30:76:78:10,11:254#只允许衣服^251#运行时校验>',
    '<ITEMBOX:4:2:117:120:30:80:82:*:允许所有物品>',
  ]);
  const [limited, any] = elements(model, 'item-box');
  assert.ok(limited && any, 'both documented traditional ITEMBOX forms must be recognized');
  assert.equal(
    model.pages.flatMap(page => page.unsupportedStatements || [])
      .some(statement => /ITEMBOX/i.test(statement)),
    false,
    'recognized ITEMBOX markup must not also be reported as unsupported'
  );

  assert.deepEqual({
    mode: limited.itemPreview?.mode,
    boxIndex: limited.itemPreview?.boxIndex,
    allowedStdModes: limited.itemPreview?.allowedStdModes,
    acceptsAnyStdMode: limited.itemPreview?.acceptsAnyStdMode,
    backgroundDisabled: limited.itemPreview?.backgroundDisabled,
    width: limited.width,
    height: limited.height,
  }, {
    mode: 'empty-box',
    boxIndex: 3,
    allowedStdModes: [10, 11],
    acceptsAnyStdMode: false,
    backgroundDisabled: true,
    width: 76,
    height: 78,
  }, 'traditional N/F/W/H/S constraints must be modeled without losing their types');
  assert.match(tooltipText(limited), /只允许衣服/);
  assert.match(tooltipText(limited), /运行时校验/);
  assertNoBackgroundReference(limited, 'F=-1');
  assertRuntimeBoundary(limited);

  assert.equal(any.itemPreview?.boxIndex, 4);
  assert.equal(any.itemPreview?.acceptsAnyStdMode, true,
    'S=* must be represented as an explicit accept-all state');
  assert.equal(any.itemPreview?.allowedStdModes, undefined,
    'S=* must not be forged as an ordinary empty list');
  assert.equal(any.itemPreview?.backgroundDisabled, false);
  assert.deepEqual(
    any.assetLayers?.find(layer => layer.role === 'background')?.assetRef,
    { willIndex: 2, imageIndex: 117 },
    'a non-disabled traditional background must retain the documented WIL/image pair'
  );
  assert.deepEqual({ width: any.width, height: any.height }, { width: 80, height: 82 });
  assert.match(tooltipText(any), /允许所有物品/);
  assertRuntimeBoundary(any);
}

function test996PcStaticConstraints() {
  const catalog = buildDialogStatementCatalog(staticLanguage, '996PC');
  assert.ok(catalog.some(schema => schema.id === 'newui-itembox-996pc'),
    'the documented 996PC keyed ITEMBOX must remain in the catalog');

  const model = parse('996PC', [
    '<ITEMBOX|id=PC_BOX|boxindex=5|x=220|y=30|width=70|height=72|stdmode=5,6|wil=NewopUI|pcimg=112|tips=<只能放武器/FCOLOR=249>>',
  ]);
  const box = keyedElement(model, 'PC_BOX');
  assert.ok(box, '996PC ITEMBOX must create a typed element');
  assert.deepEqual({
    mode: box.itemPreview?.mode,
    boxIndex: box.itemPreview?.boxIndex,
    allowedStdModes: box.itemPreview?.allowedStdModes,
    acceptsAnyStdMode: box.itemPreview?.acceptsAnyStdMode,
    backgroundDisabled: box.itemPreview?.backgroundDisabled,
    width: box.width,
    height: box.height,
  }, {
    mode: 'empty-box',
    boxIndex: 5,
    allowedStdModes: [5, 6],
    acceptsAnyStdMode: false,
    backgroundDisabled: false,
    width: 70,
    height: 72,
  }, '996PC boxindex/stdmode/geometry must use the same typed constraint model');
  assert.deepEqual(
    box.assetLayers?.find(layer => layer.role === 'background')?.assetRef,
    { archiveName: 'NewopUI', imageIndex: 112 }
  );
  assert.match(tooltipText(box), /只能放武器/);
  assertRuntimeBoundary(box);
}

function testDynamicConstraintsNeverBorrowMovValues() {
  const gom = parse('GOM', [
    '<ITEMBOX:<$STR(N$BOX_INDEX)>:<$STR(N$BOX_F)>:117:20:130:76:78:<$STR(S$BOX_STDMODE)>:动态框>',
  ]);
  const box = elements(gom, 'item-box')[0];
  assert.ok(box, 'a source-dynamic traditional ITEMBOX must remain recognized');
  assert.equal(box.itemPreview?.boxIndex, undefined,
    'dynamic N must not borrow MOV N$BOX_INDEX=6');
  assert.equal(box.itemPreview?.allowedStdModes, undefined,
    'dynamic S must not borrow MOV S$BOX_STDMODE=10,11');
  assert.equal(box.itemPreview?.acceptsAnyStdMode, undefined,
    'a dynamic S expression is neither a proven list nor a proven wildcard');
  assert.equal(box.itemPreview?.backgroundDisabled, undefined,
    'dynamic F must not borrow MOV N$BOX_F=2');
  assert.deepEqual(fieldSet(box.itemPreview, 'dynamicFields'), new Set([
    'boxindex', 'background', 'stdmode',
  ]), 'every source-dynamic traditional ITEMBOX constraint must remain explicit');
  assertNoBackgroundReference(box, 'dynamic F');
  assert.doesNotMatch(box.itemPreview?.label || '', /OK框 6/,
    'the visible label must not claim the current MOV box index');
  assert.match(box.warning || '', /动态/);
  assert.match(box.warning || '', /不借用|当前值/);
  assertRuntimeBoundary(box);

  const pc = parse('996PC', [
    '<ITEMBOX|id=PC_DYNAMIC|boxindex=<$STR(N$BOX_INDEX)>|stdmode=<$STR(S$BOX_STDMODE)>|wil=NewopUI|pcimg=112|tips=动态框>',
  ]);
  const pcBox = keyedElement(pc, 'PC_DYNAMIC');
  assert.equal(pcBox.itemPreview?.boxIndex, undefined);
  assert.equal(pcBox.itemPreview?.allowedStdModes, undefined);
  assert.equal(pcBox.itemPreview?.acceptsAnyStdMode, undefined);
  assert.deepEqual(fieldSet(pcBox.itemPreview, 'dynamicFields'), new Set([
    'boxindex', 'stdmode',
  ]));
  assert.doesNotMatch(pcBox.itemPreview?.label || '', /OK框 6/);
  assert.match(pcBox.warning || '', /动态/);
  assert.match(pcBox.warning || '', /不借用|当前值/);
  assert.deepEqual(
    pcBox.assetLayers?.find(layer => layer.role === 'background')?.assetRef,
    { archiveName: 'NewopUI', imageIndex: 112 },
    'a static 996PC background remains drawable when only constraints are dynamic'
  );
  assertRuntimeBoundary(pcBox);
}

function testInvalidConstraintsStayInvalidAndSafe() {
  const gom = parse('GOM', [
    '<ITEMBOX:oops:-2:117:20:230:76:78:10,-1,2.5,,x:非法约束>',
  ]);
  const invalid = elements(gom, 'item-box')[0];
  assert.ok(invalid, 'an invalid ITEMBOX must remain visible for diagnostics');
  assert.equal(invalid.itemPreview?.boxIndex, undefined);
  assert.equal(invalid.itemPreview?.allowedStdModes, undefined,
    'a list containing negative, non-integer, empty, or nonnumeric fragments must be rejected');
  assert.equal(invalid.itemPreview?.acceptsAnyStdMode, undefined);
  assert.equal(invalid.itemPreview?.backgroundDisabled, undefined,
    'F=-2 is neither the documented -1 switch nor a valid WIL index');
  assert.deepEqual(fieldSet(invalid.itemPreview, 'invalidFields'), new Set([
    'boxindex', 'background', 'stdmode',
  ]));
  assertNoBackgroundReference(invalid, 'invalid F');
  assert.match(invalid.warning || '', /无效/);
  assertRuntimeBoundary(invalid);

  const pc = parse('996PC', [
    '<ITEMBOX|id=PC_INVALID|boxindex=-1|x=220|y=230|width=70|height=72|stdmode=*,5|wil=NewopUI|pcimg=112|tips=非法星号混用>',
  ]);
  const mixed = keyedElement(pc, 'PC_INVALID');
  assert.equal(mixed.itemPreview?.boxIndex, undefined);
  assert.equal(mixed.itemPreview?.allowedStdModes, undefined);
  assert.equal(mixed.itemPreview?.acceptsAnyStdMode, undefined,
    'a wildcard mixed with a numeric StdMode must not be treated as accept-all');
  assert.deepEqual(fieldSet(mixed.itemPreview, 'invalidFields'), new Set([
    'boxindex', 'stdmode',
  ]));
  assert.match(mixed.warning || '', /无效/);
  assertRuntimeBoundary(mixed);
}

testCatalogAndTraditionalStaticConstraints();
test996PcStaticConstraints();
testDynamicConstraintsNeverBorrowMovValues();
testInvalidConstraintsStayInvalidAndSafe();

console.log('itembox-constraints.test.js: PASS');
