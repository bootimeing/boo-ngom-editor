const assert = require('node:assert/strict');

const commandData = require('../data/commands.json');
const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

// Primary local-manual evidence, rechecked from the CHM files on 2026-08-29:
//
// GOM CHM SHA-256
//   493DA27968064A9D41A273D836A4E9D6221D7CA2B6758B470D2AE17C4E0804D4
// GOM page
//   游戏引擎反外挂系统/功能操作命令/自定义按钮.html
//   extracted page SHA-256
//   DA418401881BD6274E19D3FE447A8BEA48A62358F825F2D3B53377641080A9FC
//
// LFM/GEE CHM SHA-256
//   F6265F33F469EF8746F03ECBD2A17A641953BE48A4CA46689D93BB822AEF6EFA
// LFM/GEE page
//   游戏引擎反外挂系统/部分脚本实例/脚本增加自定义按钮.htm
//   extracted page SHA-256
//   F5CAF7CB4340E8C8AA2E0535A00907E24E8E1BF12D5BFE37947E3DFC2FA6D7E0
//
// 996PC CHM SHA-256
//   DDA97B230FA2CE2F85A6104E8F21D4DF5C8708AE6107871CB2EBF2E4B57673E5
// 996PC legacy page
//   游戏引擎反外挂系统/功能操作命令/自定义按钮.html
//   extracted page SHA-256
//   58408993C01D71A2CE69A4B6E0F544DFB0AF66FBFD1E632ED485D485E2E4D0B5
// 996PC new-NPC page
//   游戏引擎反外挂系统/新NPC界面写法/自定义按钮AddButton.htm
//   extracted page SHA-256
//   501FCF55DCCD1A84939B407FBA3725D6E49B7905F5887DA5FC8F7A1F742C5178
//
// The 996PC CHM contains two incompatible ADDBUTTON dialects: the legacy
// ten-argument image button and the new-NPC three-argument host/id/<Button>
// form. Its legacy page also contains an ADDBUTTONEX table, but the current
// verified language catalog deliberately keeps 996PC ADDBUTTONEX name-only.
// Ctrl+F12 therefore must not copy GOM's five-part base/group grammar into
// 996PC. Until a version/dialect discriminator is proven, the EX action stays
// Evidence-blocked while the documented legacy ADDBUTTON remains drawable.

const GOM_SOURCE = [
  '[@main]',
  '#ACT',
  String.raw`ADDBUTTON 3 1 283 284 285 20 30 0|4 主线按钮 253/主线提示\254/第二行`,
  String.raw`ADDBUTTONEX 2|160|30|1|4 5 275|276|277 9 840|3|80|0|2|-3 850|2|100|1|4|5 860|4|120|0|-1|6 -1|253/特效提示 17`,
  '#SAY',
  '<删除按钮/@remove>',
  '[@remove]',
  '#ACT',
  'DELBUTTON 1',
  'DELBUTTON 2 1',
  '#SAY',
  '<返回/@main>',
].join('\r\n');

const GEE_SOURCE = [
  '[@main]',
  '#ACT',
  String.raw`ADDBUTTON 3 101 283 284 285 20 160 33 地图按钮 251#地图提示\249#第二行`,
  String.raw`ADDBUTTON 3 102 286 287 288 110 160 1 可移动按钮 250#可移动提示`,
  '#SAY',
  '<删除按钮/@remove>',
  '[@remove]',
  '#ACT',
  'DELBUTTON 101 0',
  '#SAY',
  '<返回/@main>',
].join('\r\n');

const PC_SOURCE = [
  '[@main]',
  '#ACT',
  String.raw`ADDBUTTON 3 7 283 284 285 220 160 1 旧按钮 253/旧提示\254/第二行`,
  String.raw`ADDBUTTONEX 7|320|160|1|4 5 275|276|277 9 840|3|80|0|2|-3 850|2|100|1|4|5 860|4|120|0|-1|6 -1|253/不得套用GOM 17`,
  '#SAY',
  '<删除按钮/@remove>',
  '[@remove]',
  '#ACT',
  'DELBUTTON 7',
  '#SAY',
  '<返回/@main>',
].join('\r\n');

const DYNAMIC_GOM_SOURCE = [
  '[@main]',
  '#ACT',
  'MOV N$WIL 3',
  'MOV N$NORMAL 283',
  String.raw`ADDBUTTON <$STR(N$WIL)> 9 <$STR(N$NORMAL)> 284 285 20 260 0|1 动态按钮 253/动态提示`,
  '#SAY',
  '<静态内容>',
].join('\r\n');

function parse(engine, source, suffix) {
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/addbutton-${suffix}.txt`,
    fileName: `addbutton-${suffix}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\addbutton-${suffix}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine === 'GEE' ? 'LFM/GEE' : engine,
    cursorOffset: source.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function actionElements(model) {
  const seen = new Set();
  const result = [];
  for (const element of (model.scenes || []).flatMap(scene => scene.elements || [])) {
    if (!element.addButtonPreview || seen.has(element.id)) continue;
    seen.add(element.id);
    result.push(element);
  }
  return result;
}

function button(model, command, triggerId, status) {
  return actionElements(model).find(element => {
    const preview = element.addButtonPreview;
    return String(preview.command || '').toUpperCase() === command
      && (triggerId === undefined || preview.triggerId === triggerId)
      && (status === undefined || preview.status === status);
  });
}

function layer(element, role) {
  return (element?.assetLayers || []).find(candidate => candidate.role === role);
}

function effect(element, state) {
  return (element?.addButtonPreview?.effects || []).find(candidate => (
    (candidate.state || candidate.role) === state
  ));
}

function flattened(preview) {
  return (preview?.lines || [])
    .map(line => (line || []).map(run => run.text || '').join(''))
    .join('\n');
}

function assertThreeStateAssets(element, willIndex, normal, hover, pressed) {
  assert.deepEqual(element?.assetRef, { willIndex, imageIndex: normal });
  assert.deepEqual(layer(element, 'hover')?.assetRef, { willIndex, imageIndex: hover });
  assert.deepEqual(layer(element, 'pressed')?.assetRef, { willIndex, imageIndex: pressed });
}

function assertLocalClick(element, triggerId) {
  const action = element?.runtimeActionPreview;
  assert.equal(action?.localOnly, true);
  assert.match(action?.link || '', new RegExp(`^@ButtonClick${triggerId}$`, 'i'));
  assert.match(element?.warning || '', /(?:Partial simulation|部分模拟|仅本地预览)/i);
  assert.match(element?.warning || '', /不(?:执行|提交).*服务器|服务器.*不(?:执行|提交)/i);
}

function assertDeleteAction(element, expected) {
  const actions = element?.addButtonPreview?.deleteActions || [];
  const action = actions.find(candidate => candidate.buttonId === expected.buttonId);
  assert.ok(action, `missing DELBUTTON lifecycle for ${expected.buttonId}`);
  assert.equal(action.scope, expected.scope);
  assert.equal(action.dynamic, false);
  assert.ok(Number.isInteger(action.lineNumber));
}

function command(name) {
  return commandData.execCommands.find(candidate => candidate.name === name);
}

const failures = [];
function check(name, callback) {
  try {
    callback();
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : String(error)}`);
  }
}

check('catalog evidence keeps engine grammars separated', () => {
  const add = command('ADDBUTTON');
  const addEx = command('ADDBUTTONEX');
  const del = command('DELBUTTON');
  assert.match(add.engineVariants.GOM.syntax, /移动\|分组/);
  assert.match(add.engineVariants.GEE.syntax, /创建位置/);
  assert.match(add.engineVariants['996PC'].syntax, /是否可移动/);
  assert.equal(addEx.engineVariants['996PC'].completionVerified, false);
  assert.equal(addEx.engineVariants['996PC'].completionEnabled, false);
  assert.match(addEx.engineVariants['996PC'].completionReview, /name-only/i);
  assert.match(del.engineVariants.GOM.syntax, /1-100/);
  assert.match(del.engineVariants.GEE.syntax, /1-200/);
});

const gom = parse('GOM', GOM_SOURCE, 'gom');
const gee = parse('GEE', GEE_SOURCE, 'gee');
const pc = parse('996PC', PC_SOURCE, '996pc');
const dynamicGom = parse('GOM', DYNAMIC_GOM_SOURCE, 'gom-dynamic');

check('GOM legacy ADDBUTTON is a real three-state static button', () => {
  const element = button(gom, 'ADDBUTTON', 1);
  assert.ok(element, 'GOM ADDBUTTON action was silently discarded');
  assert.equal(element.kind, 'button');
  assert.equal(element.editable, true,
    '#ACT action execution safety must not disable an independently safe literal coordinate edit');
  assert.equal(GOM_SOURCE.slice(element.x.span.start, element.x.span.end), '20');
  assert.equal(GOM_SOURCE.slice(element.y.span.start, element.y.span.end), '30');
  assertThreeStateAssets(element, 3, 283, 284, 285);
  assert.equal(element.x?.sourceValue, 20);
  assert.equal(element.y?.sourceValue, 30);
  assert.equal(element.addButtonPreview.movable, false);
  assert.equal(element.addButtonPreview.groupId, 4);
  assert.equal(flattened(element.textPreview), '主线按钮');
  assert.match(flattened(element.tooltipPreview), /主线提示/);
  assert.match(flattened(element.tooltipPreview), /第二行/);
  assertLocalClick(element, 1);
  assertDeleteAction(element, { buttonId: 1, scope: 'self' });
});

check('GOM ADDBUTTONEX preserves all button and effect layers', () => {
  const element = button(gom, 'ADDBUTTONEX', 2);
  assert.ok(element, 'GOM ADDBUTTONEX action was silently discarded');
  assert.equal(element.kind, 'button');
  assertThreeStateAssets(element, 5, 275, 276, 277);
  assert.equal(element.x?.sourceValue, 160);
  assert.equal(element.y?.sourceValue, 30);
  assert.equal(element.addButtonPreview.movable, true);
  assert.equal(element.addButtonPreview.groupId, 4);
  assert.equal(element.addButtonPreview.createPosition, 17);
  assert.match(element.addButtonPreview.createPositionLabel || '', /大地图/);
  assert.equal(flattened(element.textPreview), '', 'title=-1 must not invent a caption');
  assert.match(flattened(element.tooltipPreview), /特效提示/);

  const expected = [
    ['normal', 840, 3, 80, 0, 2, -3],
    ['hover', 850, 2, 100, 1, 4, 5],
    ['pressed', 860, 4, 120, 0, -1, 6],
  ];
  for (const [state, start, count, interval, drawMode, offsetX, offsetY] of expected) {
    const layerPreview = effect(element, state);
    assert.ok(layerPreview, `missing ${state} effect layer`);
    assert.deepEqual(layerPreview.assetRef, { willIndex: 9, imageIndex: start });
    assert.equal(layerPreview.frameCount ?? layerPreview.assetRef?.frameCount, count);
    assert.equal(layerPreview.frameIntervalMs ?? layerPreview.intervalMs, interval);
    assert.equal(layerPreview.drawMode, drawMode);
    assert.equal(layerPreview.offsetX, offsetX);
    assert.equal(layerPreview.offsetY, offsetY);
  }
  assertLocalClick(element, 2);
  assertDeleteAction(element, { buttonId: 2, scope: 'all-users' });
  assert.match(element.warning || '', /(?:绘制模式|混合|特效).*(?:客户端|Partial simulation|部分模拟)/i,
    'unpublished client effect blending must remain an explicit runtime boundary');
});

check('LFM/GEE ADDBUTTON keeps create-position semantics separate from GOM grouping', () => {
  const mapButton = button(gee, 'ADDBUTTON', 101);
  const movableButton = button(gee, 'ADDBUTTON', 102);
  assert.ok(mapButton && movableButton, 'both documented LFM buttons must be modeled');
  assert.equal(mapButton.editable, true,
    'GEE #ACT action remains local-only while literal X/Y spans remain editable');
  assert.equal(movableButton.editable, true,
    'GEE movable-client metadata must not disable source-safe coordinate editing');
  assert.equal(GEE_SOURCE.slice(mapButton.x.span.start, mapButton.x.span.end), '20');
  assert.equal(GEE_SOURCE.slice(mapButton.y.span.start, mapButton.y.span.end), '160');
  assert.equal(GEE_SOURCE.slice(movableButton.x.span.start, movableButton.x.span.end), '110');
  assert.equal(GEE_SOURCE.slice(movableButton.y.span.start, movableButton.y.span.end), '160');
  assertThreeStateAssets(mapButton, 3, 283, 284, 285);
  assert.equal(mapButton.x?.sourceValue, 20);
  assert.equal(mapButton.y?.sourceValue, 160);
  assert.equal(mapButton.addButtonPreview.createPosition, 33);
  assert.match(mapButton.addButtonPreview.createPositionLabel || '', /M.*大地图|大地图/i);
  assert.equal(mapButton.addButtonPreview.groupId, undefined,
    'LFM parameter 8 is a create position and must not be borrowed as a GOM group');
  assert.equal(flattened(mapButton.textPreview), '地图按钮');
  assert.match(flattened(mapButton.tooltipPreview), /地图提示/);
  assert.match(flattened(mapButton.tooltipPreview), /第二行/);
  assertLocalClick(mapButton, 101);
  assertDeleteAction(mapButton, { buttonId: 101, scope: 'self' });

  assert.equal(movableButton.addButtonPreview.createPosition, 1);
  assert.equal(movableButton.addButtonPreview.movable, true,
    'LFM create position 1 is the documented movable main-screen mode');
  assert.equal(movableButton.addButtonPreview.groupId, undefined);
});

check('996PC legacy ADDBUTTON is drawable without importing GOM grouping', () => {
  const element = button(pc, 'ADDBUTTON', 7);
  assert.ok(element, '996PC legacy ADDBUTTON action was silently discarded');
  assert.equal(element.editable, true,
    '996PC documented literal X/Y are source-safe even though ButtonClick remains local-only');
  assert.equal(PC_SOURCE.slice(element.x.span.start, element.x.span.end), '220');
  assert.equal(PC_SOURCE.slice(element.y.span.start, element.y.span.end), '160');
  assertThreeStateAssets(element, 3, 283, 284, 285);
  assert.equal(element.x?.sourceValue, 220);
  assert.equal(element.y?.sourceValue, 160);
  assert.equal(element.addButtonPreview.movable, true);
  assert.equal(element.addButtonPreview.groupId, undefined);
  assert.equal(element.addButtonPreview.createPosition, undefined);
  assert.equal(flattened(element.textPreview), '旧按钮');
  assert.match(flattened(element.tooltipPreview), /旧提示/);
  assert.match(flattened(element.tooltipPreview), /第二行/);
  assertLocalClick(element, 7);
  assertDeleteAction(element, { buttonId: 7, scope: 'self' });
});

check('996PC ADDBUTTONEX remains visible but Evidence-blocked', () => {
  const element = button(pc, 'ADDBUTTONEX', undefined, 'evidence-blocked');
  assert.ok(element, '996PC ADDBUTTONEX must remain an auditable action placeholder');
  assert.equal(element.assetRef, undefined);
  assert.equal((element.assetLayers || []).length, 0);
  assert.equal((element.addButtonPreview.effects || []).length, 0);
  assert.match(element.warning || '', /Evidence-blocked/i);
  assert.match(element.warning || '', /996PC.*ADDBUTTONEX|ADDBUTTONEX.*996PC/i);
  assert.match(element.warning || '', /(?:方言|语法|版本|模式).*(?:未确认|冲突|消歧)|不能.*GOM|不.*套用.*GOM/i);
  assert.doesNotMatch(JSON.stringify(element), /"groupId"\s*:\s*4/,
    'GOM five-part base/group semantics leaked into 996PC');
});

check('dynamic action sources never borrow MOV values or request assets', () => {
  const element = button(dynamicGom, 'ADDBUTTON', 9);
  assert.ok(element, 'dynamic GOM ADDBUTTON must remain a typed preview');
  assert.equal(element.assetRef, undefined);
  assert.equal((element.assetLayers || []).length, 0);
  assert.ok((element.addButtonPreview.dynamicFields || []).length >= 2);
  assert.doesNotMatch(JSON.stringify(element.assetRef || {}), /283|"willIndex"\s*:\s*3/);
  assert.match(element.warning || '', /动态/);
  assert.match(element.warning || '', /不借用.*MOV|MOV.*不借用|不借用.*当前值|当前值.*不借用/i);
});

check('recognized action commands do not leak into flow text or unsupported SAY markup', () => {
  for (const model of [gom, gee, pc]) {
    const unsupported = (model.pages || [])
      .flatMap(page => page.unsupportedStatements || [])
      .join('\n');
    assert.doesNotMatch(unsupported, /ADDBUTTONEX?|DELBUTTON/i);
    const nonActionText = (model.scenes || [])
      .flatMap(scene => scene.elements || [])
      .filter(element => !element.addButtonPreview)
      .map(element => element.text || '')
      .join('\n');
    assert.doesNotMatch(nonActionText, /ADDBUTTONEX?|DELBUTTON/i);
  }
});

if (failures.length > 0) {
  console.error('addbutton-action-preview.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('addbutton-action-preview.test.js: PASS');
}
