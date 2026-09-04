const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

function parse(text) {
  const marker = '[@main]';
  return parseNpcDialogDocument(text, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/uimodel-test.txt',
    fileName: 'uimodel-test.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\uimodel-test.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: text.indexOf(marker) + marker.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
}

function main() {
  const document = parse([
    '[@main]',
    '#ACT',
    'MOV N$SEX 1',
    'MOV N$SCALE 2',
    'MOV N$CLOTH 2540',
    'MOV N$HAIR 3',
    'MOV S$EFFECT 506#1#0#0',
    '#SAY',
    '<UIModel|id=DYNAMIC|sex=<$STR(N$SEX)>|scale=<$STR(N$SCALE)>|clothID=<$STR(N$CLOTH)>|weaponID=2523.5|headID=-1|capID=1188|hairID=<$STR(N$HAIR)>|notShowMold=<$STR(N$SEX)>|notShowHair=maybe|clothEffectID=<$STR(S$EFFECT)>|weaponEffectID=505#1#0#0>',
    '<UIModel|id=STATIC|sex=0|scale=1.25|clothID=2540|hairID=3|notShowMold=true|notShowHair=false|clothEffectID=506#1#0#0&507#0#2#3>',
    '<UIModel|id=INVALID|sex=2|scale=0|clothID=0|weaponID=abc|hairID=-2|notShowMold=1>',
  ].join('\n'));
  const controls = new Map(document.pages[0].elements.map(element => (
    [element.containerElementId, element]
  )));

  const dynamic = controls.get('DYNAMIC');
  assert.equal(dynamic.modelPreview.sex, undefined,
    'dynamic sex must not borrow the current MOV value');
  assert.equal(dynamic.modelPreview.scale, 1,
    'dynamic scale must use a safe source fallback instead of the current MOV value');
  assert.deepEqual(dynamic.modelPreview.layers.map(layer => layer.role), ['cap'],
    'dynamic/invalid Looks values must not request deterministic StateItem assets');
  assert.equal(dynamic.modelPreview.hairId, undefined);
  assert.equal(dynamic.modelPreview.notShowMold, undefined);
  assert.equal(dynamic.modelPreview.notShowHair, undefined);
  assert.deepEqual(dynamic.modelPreview.dynamicFields, [
    'sex', 'scale', 'cloth-id', 'hair-id', 'not-show-mold', 'cloth-effect',
  ]);
  assert.deepEqual(dynamic.modelPreview.invalidFields, [
    'weapon-id', 'head-id', 'not-show-hair',
  ]);
  assert.deepEqual(dynamic.modelPreview.effectConfigs, {
    cloth: '<$STR(S$EFFECT)>',
    weapon: '505#1#0#0',
  });
  assert.match(dynamic.warning, /动态.*不(?:请求|采用|借用)|不(?:请求|采用|借用).*动态/);
  assert.match(dynamic.warning, /无效/);

  const staticModel = controls.get('STATIC').modelPreview;
  assert.equal(staticModel.sex, 0);
  assert.equal(staticModel.scale, 1.25);
  assert.equal(staticModel.hairId, 3);
  assert.equal(staticModel.notShowMold, true);
  assert.equal(staticModel.notShowHair, false);
  assert.equal(staticModel.dynamicFields, undefined);
  assert.equal(staticModel.invalidFields, undefined);
  assert.deepEqual(staticModel.effectConfigs, {
    cloth: '506#1#0#0&507#0#2#3',
  });

  const invalid = controls.get('INVALID').modelPreview;
  assert.equal(invalid.sex, undefined);
  assert.equal(invalid.scale, 1);
  assert.equal(invalid.hairId, undefined);
  assert.equal(invalid.notShowMold, undefined);
  assert.deepEqual(invalid.layers, []);
  assert.deepEqual(invalid.invalidFields, [
    'sex', 'scale', 'cloth-id', 'weapon-id', 'hair-id', 'not-show-mold',
  ]);

  console.log('PASS UIModel source-safe parameters, deterministic layers, and evidence boundaries');
}

main();
