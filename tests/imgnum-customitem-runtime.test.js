const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

function parse(engine, lines, before = []) {
  const source = ['[@main]', '#ACT', ...before, '#SAY', ...lines].join('\n');
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/imgnum-custom-${engine}.txt`,
    fileName: `imgnum-custom-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\imgnum-custom-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function byRaw(model, marker) {
  return model.pages[0].elements.find(element => element.raw.includes(marker));
}

function fields(preview, name) {
  return [...new Set(preview?.[name] || [])].sort();
}

function testImgNumSubmitInputIds() {
  const model = parse('GOM', [
    '<&IMGNUM:3170:1234:-3:10:20:1,3>',
    '<&IMGNUM:3170:1234:-3:10:50:0>',
    '<&IMGNUM:3170:1234:-3:10:80:*>',
    '<&IMGNUM:3170:1234:-3:10:110:<$STR(S$IDS)>>',
    '<&IMGNUM:3170:1234:-3:10:140:1,10,bad>',
    '<&IMGNUM:3170:1234:-3:10:170:2|提示/@done>',
  ], ['MOV S$IDS 2,4']);
  const stat = byRaw(model, ':10:20:1,3>');
  const zero = byRaw(model, ':10:50:0>');
  const star = byRaw(model, ':10:80:*>');
  const dynamic = byRaw(model, ':10:110:<$STR(S$IDS)>>');
  const invalid = byRaw(model, ':10:140:1,10,bad>');
  const linked = byRaw(model, ':10:170:2|提示/@done>');

  assert.deepEqual(stat.runtimeActionPreview, {
    trigger: 'click', submitInputIds: [1, 3], localOnly: true,
  });
  assert.equal(zero.runtimeActionPreview, undefined, 'IMGNUM input id 0 means no submission');
  assert.equal(star.runtimeActionPreview, undefined, 'IMGNUM * means no input submission');
  assert.deepEqual(dynamic.runtimeActionPreview, {
    trigger: 'click', localOnly: true, dynamicFields: ['submit-inputs'],
  });
  assert.doesNotMatch(JSON.stringify(dynamic.runtimeActionPreview), /2,4/,
    'dynamic IMGNUM input IDs borrowed the MOV current value');
  assert.deepEqual(invalid.runtimeActionPreview?.submitInputIds, [1]);
  assert.deepEqual(fields(invalid.runtimeActionPreview, 'invalidFields'), ['submit-inputs']);
  assert.deepEqual(linked.runtimeActionPreview, {
    trigger: 'click', submitInputIds: [2], link: '@done', localOnly: true,
  });
  for (const element of [stat, dynamic, invalid, linked]) {
    assert.match(element.warning || '', /仅本地预览/);
    assert.match(element.warning || '', /不提交服务器/);
  }
}

function testCustomItemInteriorSwitch() {
  const model = parse('GEE', [
    '<CustomItem:3:11:120:20:20:0:人物提示>',
    '<HeroCustomItem:4:12:130:80:20:1:英雄提示>',
    '<CustomItem:5:13:140:140:20:<$STR(N$SHOW)>:动态提示>',
    '<HeroCustomItem:6:14:150:200:20:2:非法提示>',
  ], ['MOV N$SHOW 1']);
  const off = byRaw(model, '<CustomItem:3:');
  const on = byRaw(model, '<HeroCustomItem:4:');
  const dynamic = byRaw(model, '<CustomItem:5:');
  const invalid = byRaw(model, '<HeroCustomItem:6:');

  assert.equal(off.itemPreview?.showInterior, false);
  assert.equal(on.itemPreview?.showInterior, true);
  assert.deepEqual(fields(off.itemPreview, 'dynamicFields'), []);
  assert.deepEqual(fields(on.itemPreview, 'invalidFields'), []);
  assert.equal(dynamic.itemPreview?.showInterior, undefined);
  assert.deepEqual(fields(dynamic.itemPreview, 'dynamicFields'), ['interior']);
  assert.equal(invalid.itemPreview?.showInterior, undefined);
  assert.deepEqual(fields(invalid.itemPreview, 'invalidFields'), ['interior']);
  assert.doesNotMatch(JSON.stringify(dynamic.itemPreview), /"showInterior":true/,
    'dynamic showInterior borrowed MOV=1');
  for (const element of [off, on, dynamic, invalid]) {
    assert.ok(element.assetLayers?.some(layer => layer.role === 'background'),
      'statically proven custom frame was lost');
    assert.match(element.warning || '', /Runtime-data blocked|运行时/);
  }
}

const failures = [];
for (const [name, test] of [
  ['IMGNUM submitInputIds', testImgNumSubmitInputIds],
  ['CustomItem showInterior', testCustomItemInteriorSwitch],
]) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message || error}`); }
}
if (failures.length) {
  console.error('imgnum-customitem-runtime.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('imgnum-customitem-runtime.test.js: PASS');
}
