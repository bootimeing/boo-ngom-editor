const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

// Evidence:
// - 996PC 新NPC界面写法/自定义输入框Input.htm documents
//   submitInput=3,4,5 and shows it on Img together with link=@提交.
// - 996PC 新NPC界面写法/物品框ItemShow.htm documents link, dblink and
//   reload=0/1 for EquipShow.
// - 996PC 新NPC界面写法/复选框CheckBox.htm documents delay as the
//   automatic-link interval and count as the number of automatic executions.
//   The page does not state delay's unit, so the preview must retain that boundary.

function parseRuntimeActions() {
  const source = [
    '[@main]',
    '#ACT',
    'MOV N$SUBMIT_ID 2',
    'MOV S$ACTION_LINK @动态提交',
    '#SAY',
    '<Input|id=INPUT_ONE|x=20|y=20|width=120|height=24|inputid=1|type=0|place=名字>',
    '<Input|id=INPUT_TWO|x=20|y=55|width=120|height=24|inputid=2|type=1|place=数量>',
    '<Img|id=SUBMIT_STATIC|x=170|y=20|wil=NewopUI|pcimg=115|submitInput=1,2|link=@提交>',
    '<EquipShow|id=EQUIP_ACTION|x=170|y=70|width=45|height=45|index=0|showtips=1|bgtype=1|link=@单击装备|dblink=@双击装备|reload=1>',
    '<CheckBox|id=CHECK_ACTION|x=170|y=130|checkboxid=N0|wil=NewopUI|pcnimg=145|pcpimg=144|default=0|delay=3|count=2|link=@勾选触发>',
    '<Img|id=DYNAMIC_ACTION|x=260|y=20|wil=NewopUI|pcimg=116|submitInput=1,<$STR(N$SUBMIT_ID)>|link=<$STR(S$ACTION_LINK)>>',
    '<EquipShow|id=INVALID_EQUIP|x=260|y=70|width=45|height=45|index=1|reload=2|dblink=>',
    '<CheckBox|id=INVALID_AUTO|x=260|y=130|checkboxid=N1|wil=NewopUI|pcnimg=145|pcpimg=144|default=0|delay=-1|count=1.5|link=@无效自动提交>',
  ].join('\n');
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/runtime-action-preview.txt',
    fileName: 'runtime-action-preview.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\runtime-action-preview.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
}

function controlsByContainerId(model) {
  return new Map(model.pages[0].elements.map(element => [element.containerElementId, element]));
}

function testStaticRuntimeActionsAreTypedAndLocalOnly() {
  const model = parseRuntimeActions();
  const controls = controlsByContainerId(model);
  const submit = controls.get('SUBMIT_STATIC');
  const equip = controls.get('EQUIP_ACTION');
  const check = controls.get('CHECK_ACTION');
  assert.ok(submit && equip && check, 'all documented runtime-action fixtures must be recognized');

  assert.deepEqual(submit.runtimeActionPreview, {
    submitInputIds: [1, 2],
    link: '@提交',
    localOnly: true,
  }, 'Img must retain its documented input list and click label as one typed action');
  assert.deepEqual(equip.runtimeActionPreview, {
    link: '@单击装备',
    doubleClickLink: '@双击装备',
    reload: true,
    localOnly: true,
  }, 'EquipShow must distinguish single-click, double-click and reload semantics');
  assert.deepEqual(check.runtimeActionPreview, {
    link: '@勾选触发',
    delay: 3,
    count: 2,
    delayUnit: 'manual-unspecified',
    localOnly: true,
  }, 'CheckBox delay/count must remain typed without inventing an undocumented time unit');

  for (const element of [submit, equip, check]) {
    assert.match(element.warning || '', /仅本地预览/);
    assert.match(element.warning || '', /不提交服务器/);
    assert.match(element.warning || '', /不执行.*@|@.*不执行/,
      'server labels must remain visible but explicitly non-executable');
  }
  assert.match(check.warning || '', /delay.*单位.*未公开|单位.*未公开.*delay/i);
  assert.equal(model.pages[0].unsupportedStatements.length, 0);
}

function testDynamicAndInvalidActionsNeverBorrowResolvedValues() {
  const model = parseRuntimeActions();
  const controls = controlsByContainerId(model);
  const dynamic = controls.get('DYNAMIC_ACTION');
  const invalidEquip = controls.get('INVALID_EQUIP');
  const invalidAuto = controls.get('INVALID_AUTO');
  assert.ok(dynamic && invalidEquip && invalidAuto);

  assert.deepEqual(dynamic.runtimeActionPreview, {
    submitInputIds: [1],
    localOnly: true,
    dynamicFields: ['submit-inputs', 'link'],
  }, 'the static ID may remain visible, but MOV values must not complete a dynamic action');
  assert.equal(dynamic.runtimeActionPreview?.link, undefined);
  assert.doesNotMatch(JSON.stringify(dynamic.runtimeActionPreview), /动态提交|"2"/,
    'resolved MOV values must not become a confirmed input ID or server label');
  assert.match(dynamic.warning || '', /动态/);
  assert.match(dynamic.warning || '', /不借用.*当前值|当前值.*不借用/);

  assert.ok(invalidEquip.runtimeActionPreview?.invalidFields?.includes('reload'));
  assert.ok(invalidEquip.runtimeActionPreview?.invalidFields?.includes('double-click-link'));
  assert.equal(invalidEquip.runtimeActionPreview?.reload, undefined);
  assert.equal(invalidEquip.runtimeActionPreview?.doubleClickLink, undefined);
  assert.deepEqual(invalidAuto.runtimeActionPreview?.invalidFields, ['delay', 'count']);
  assert.equal(invalidAuto.runtimeActionPreview?.delay, undefined);
  assert.equal(invalidAuto.runtimeActionPreview?.count, undefined);
  assert.match(`${invalidEquip.warning || ''};${invalidAuto.warning || ''}`, /无效/);
}

testStaticRuntimeActionsAreTypedAndLocalOnly();
testDynamicAndInvalidActionsNeverBorrowResolvedValues();
console.log('runtime-action-preview.test.js: PASS');
