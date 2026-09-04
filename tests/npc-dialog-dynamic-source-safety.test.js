const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const staticLanguage = require('../data/static-language.json');
const {
  buildDialogStatementCatalog,
} = require('../out/ui-dialog/statement-catalog');
const {
  parseNpcDialogDocument,
} = require('../out/ui-dialog/source-parser');
const {
  workspaceNpcDialogOffsets,
} = require('../out/ui-dialog/offsets');

function parse(source, engine) {
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/dynamic-source-safety.txt',
    fileName: 'dynamic-source-safety.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\dynamic-source-safety.txt',
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function sceneElements(model) {
  return model.pages[0].elements.filter(element => element.statementId !== 'flow-text');
}

function statement(model, id, occurrence = 0) {
  const matches = sceneElements(model).filter(element => element.statementId === id);
  assert.ok(matches[occurrence], `missing ${id} occurrence ${occurrence}`);
  return matches[occurrence];
}

function keyed(model, id) {
  const element = sceneElements(model).find(candidate => candidate.containerElementId === id);
  assert.ok(element, `missing keyed control ${id}`);
  return element;
}

function assetReferences(element) {
  return [
    element.assetRef,
    ...(element.assetLayers || []).map(layer => layer.assetRef),
    ...(element.imageTextPreview?.glyphs || []).map(glyph => glyph.assetRef),
    ...(element.imageTextPreview?.glyphBank || []).map(glyph => glyph.assetRef),
    ...(element.modelPreview?.layers || []).map(layer => layer.assetRef),
  ].filter(Boolean);
}

function visibleText(element) {
  const runs = preview => (preview?.lines || [])
    .flatMap(line => line.map(run => run.text));
  return [
    element.text,
    ...runs(element.textPreview),
    element.imageTextPreview?.value,
    element.costItemPreview?.title,
    element.costItemPreview?.quantityText,
    ...runs(element.tooltipPreview),
  ].filter(value => value !== undefined).join('\n');
}

function assertDynamicBoundary(element, label) {
  assert.match(
    element.warning || '',
    /动态|运行时|runtime/i,
    `${label} must expose a dynamic/runtime static-preview boundary`
  );
}

function assertNoImageIndexes(element, forbidden, label) {
  const actual = assetReferences(element).map(reference => reference.imageIndex);
  for (const imageIndex of forbidden) {
    assert.equal(
      actual.includes(imageIndex),
      false,
      `${label} must not retain or hydrate temporarily resolved image ${imageIndex}; got ${actual.join(',')}`
    );
  }
}

function assertNoWillIndexes(element, forbidden, label) {
  const actual = assetReferences(element)
    .map(reference => reference.willIndex)
    .filter(value => value !== undefined);
  for (const willIndex of forbidden) {
    assert.equal(
      actual.includes(willIndex),
      false,
      `${label} must not retain or hydrate temporarily resolved WIL ${willIndex}; got ${actual.join(',')}`
    );
  }
}

const gomSource = [
  '[@main]',
  '#ACT',
  'MOV N$WIL 37',
  'MOV N$IMG 9010',
  'MOV N$HOVER 9011',
  'MOV N$PRESSED 9012',
  'MOV N$NUMSTART 9020',
  'MOV N$NUMVALUE 6789',
  'MOV N$NUMGAP 7',
  'MOV N$SECONDS 77',
  'MOV N$CDSTART 9030',
  'MOV N$CDGAP 6',
  'MOV N$APPR 1120',
  'MOV N$RACE 81',
  'MOV N$ACTION 3',
  'MOV N$DIR 7',
  'MOV N$LOOKS 9123',
  '#SAY',
  '<&IMG:<$STR(N$IMG)>:<$STR(N$WIL)>:10:20>',
  '<&IMGEX:<$STR(N$WIL)>:<$STR(N$IMG)>:<$STR(N$HOVER)>:<$STR(N$PRESSED)>:30:20>',
  '<&IMGNUM:<$STR(N$NUMSTART)>:<$STR(N$NUMVALUE)>:<$STR(N$NUMGAP)>:40:20:*>',
  '<&IMGCOUNTDOWN:<$STR(N$SECONDS)>:1:<$STR(N$CDSTART)>:<$STR(N$CDGAP)>:50:20:0/@done>',
  '<MONSTER:<$STR(N$APPR)>:<$STR(N$RACE)>:<$STR(N$ACTION)>:<$STR(N$DIR)>:60:20>',
  '<Looks:1:<$STR(N$LOOKS)>:70:20>',
].join('\n');

const geeSource = [
  '[@main]',
  '#ACT',
  'MOV N$WIL 37',
  'MOV N$IMG 9310',
  'MOV N$HOVER 9311',
  'MOV N$PRESSED 9312',
  'MOV N$NUMTYPE 6',
  'MOV N$NUMVALUE 4321',
  'MOV N$NUMGAP 5',
  'MOV N$SECONDS 66',
  'MOV N$CDSTART 9330',
  'MOV N$CDGAP 4',
  'MOV N$RACEIMG 11',
  'MOV N$APPR 160',
  'MOV N$DISPLAY 11',
  'MOV N$DIR 1',
  'MOV N$STATE 9388',
  'MOV N$DN 9389',
  'MOV N$CUSTOM 9390',
  'MOV N$HERO 9391',
  'MOV N$NEWOP 9392',
  'MOV N$LOOKS 9393',
  '#SAY',
  '<&IMG:<$STR(N$IMG)>:<$STR(N$WIL)>:10:20>',
  '<&IMGEX:<$STR(N$WIL)>:<$STR(N$IMG)>:<$STR(N$HOVER)>:<$STR(N$PRESSED)>:30:20>',
  '<&IMGNUM:<$STR(N$NUMTYPE)>:<$STR(N$NUMVALUE)>:<$STR(N$NUMGAP)>:40:20:*>',
  '<&IMGCOUNTDOWN:<$STR(N$SECONDS)>:1:<$STR(N$CDSTART)>:<$STR(N$CDGAP)>:50:20:0/@done>',
  '<MONSTER:<$STR(N$RACEIMG)>:<$STR(N$APPR)>:<$STR(N$DISPLAY)>:<$STR(N$DIR)>:60:20>',
  '<StateItem:<$STR(N$STATE)>:70:20:1>',
  '<DnItems:<$STR(N$DN)>:80:20:1>',
  '<CustomItem:3:<$STR(N$WIL)>:<$STR(N$CUSTOM)>:90:20:1:tip>',
  '<HeroCustomItem:3:<$STR(N$WIL)>:<$STR(N$HERO)>:100:20:1:tip>',
  '<NewopUI:<$STR(N$NEWOP)>:110:20>',
  '<Looks:<$STR(N$LOOKS)>:120:20:1>',
].join('\n');

const pcSource = [
  '[@main]',
  '#ACT',
  'MOV N$NORMAL 9410',
  'MOV N$HOVER 9411',
  'MOV N$PRESSED 9412',
  'MOV N$CHECKED 1',
  'MOV N$COLOR 250',
  'MOV N$SIZE 20',
  'MOV N$TIPX 91',
  'MOV N$TIPY 92',
  'MOV N$ATLAS 9420',
  'MOV N$GLYPHW 17',
  'MOV N$GLYPHH 23',
  'MOV N$PERCENT 73',
  'MOV N$MAX 400',
  'MOV N$DIRECTION 2',
  'MOV N$LOADBG 9440',
  'MOV N$LOADBAR 9441',
  'MOV N$LOADSTART 23',
  'MOV N$LOADEND 77',
  'MOV N$LOADMAX 200',
  'MOV N$LOADINTERVAL 2',
  'MOV N$LOADSTEP 9',
  'MOV N$ITEMID 993',
  'MOV N$ITEMCOUNT 123456',
  'MOV N$ITEMSCALE 0.75',
  'MOV S$BUTTON __MOV_BUTTON__',
  'MOV S$TEXT __MOV_TEXT__',
  'MOV S$ATLASTEXT 6789',
  'MOV S$TIP __MOV_TOOLTIP__',
  '#SAY',
  '<Button|id=B|x=10|y=20|wil=NewopUI|pcnimg=<$STR(N$NORMAL)>|pcmimg=<$STR(N$HOVER)>|pcpimg=<$STR(N$PRESSED)>|text=<$STR(S$BUTTON)>|color=<$STR(N$COLOR)>|size=<$STR(N$SIZE)>|tips=<$STR(S$TIP)>|tipsx=<$STR(N$TIPX)>|tipsy=<$STR(N$TIPY)>>',
  '<CheckBox|id=C|x=10|y=50|checkboxid=N0|wil=NewopUI|pcnimg=<$STR(N$NORMAL)>|pcpimg=<$STR(N$PRESSED)>|default=<$STR(N$CHECKED)>>',
  '<Text|id=T|x=10|y=80|text=<$STR(S$TEXT)>|color=<$STR(N$COLOR)>|size=<$STR(N$SIZE)>|tips=<$STR(S$TIP)>|tipsx=<$STR(N$TIPX)>|tipsy=<$STR(N$TIPY)>>',
  '<RText|id=R|x=10|y=110|text=<$STR(S$TEXT)>|color=<$STR(N$COLOR)>|size=<$STR(N$SIZE)>|tips=<$STR(S$TIP)>|tipsx=<$STR(N$TIPX)>|tipsy=<$STR(N$TIPY)>>',
  '<TextAtlas|id=A|x=10|y=140|wil=NewopUI|pcimg=<$STR(N$ATLAS)>|iwidth=<$STR(N$GLYPHW)>|iheight=<$STR(N$GLYPHH)>|text=<$STR(S$ATLASTEXT)>>',
  '<PercentImg|id=P|x=10|y=170|direction=<$STR(N$DIRECTION)>|wil=NewopUI|pcimg=<$STR(N$ATLAS)>|minValue=<$STR(N$PERCENT)>|maxValue=<$STR(N$MAX)>>',
  '<LoadingBar|id=L|x=10|y=200|wil=NewopUI|pcloadingbg=<$STR(N$LOADBG)>|pcloadingbar=<$STR(N$LOADBAR)>|startper=<$STR(N$LOADSTART)>|endper=<$STR(N$LOADEND)>|maxper=<$STR(N$LOADMAX)>|direction=<$STR(N$DIRECTION)>|interval=<$STR(N$LOADINTERVAL)>|loadvalue=<$STR(N$LOADSTEP)>>',
  '<CostItem|id=K|x=10|y=230|itemid=<$STR(N$ITEMID)>|itemcount=<$STR(N$ITEMCOUNT)>|title=<$STR(S$BUTTON)>|itemscale=<$STR(N$ITEMSCALE)>|fontsize=<$STR(N$SIZE)>>',
].join('\n');

const gom = parse(gomSource, 'GOM');
const gee = parse(geeSource, 'GEE');
const pc = parse(pcSource, '996PC');

const checks = [];
function check(name, callback) {
  checks.push({ name, callback });
}

check('GOM IMG/IMGEX dynamic references', () => {
  const img = statement(gom, 'img-absolute');
  const imgex = statement(gom, 'imgex-absolute');
  assertNoImageIndexes(img, [9010], 'GOM IMG');
  assertNoImageIndexes(imgex, [9010, 9011, 9012], 'GOM IMGEX');
  assertNoWillIndexes(img, [37], 'GOM IMG');
  assertNoWillIndexes(imgex, [37], 'GOM IMGEX');
  assertDynamicBoundary(img, 'GOM IMG');
  assertDynamicBoundary(imgex, 'GOM IMGEX');
});

check('GOM IMGNUM/IMGCOUNTDOWN dynamic glyph sources', () => {
  const number = statement(gom, 'image-number');
  const countdown = statement(gom, 'image-countdown');
  assertNoImageIndexes(number, [9020, 9021, 9022, 9023, 9024, 9025, 9026, 9027, 9028, 9029], 'GOM IMGNUM');
  assert.equal(number.imageTextPreview?.value, '6789');
  assert.equal(
    number.imageTextPreview?.glyphs.map(glyph => glyph.character).join(''),
    '6789',
    'GOM IMGNUM must keep a statically proven display number visible',
  );
  assert.notEqual(number.imageTextPreview?.gap, 7);
  assertNoImageIndexes(countdown, [9330, 9030, 9031, 9032, 9033, 9034, 9035, 9036, 9037, 9038, 9039, 9040], 'GOM IMGCOUNTDOWN');
  assert.notEqual(countdown.imageTextPreview?.gap, 6);
  assertDynamicBoundary(number, 'GOM IMGNUM');
  assertDynamicBoundary(countdown, 'GOM IMGCOUNTDOWN');
});

check('GOM MONSTER/Looks dynamic data', () => {
  const monster = statement(gom, 'monster-preview');
  const looks = statement(gom, 'looks-preview');
  assert.equal(assetReferences(monster).some(reference => (
    reference.archiveName === 'Mon113' && reference.imageIndex === 40
  )), false, 'dynamic GOM APPR must not select Mon113/40 from the MOV value');
  assert.notEqual(monster.monsterPreview?.appr, 1120);
  assert.notEqual(monster.monsterPreview?.race, 81);
  assert.notEqual(looks.itemPreview?.looks, 9123);
  assertDynamicBoundary(monster, 'GOM MONSTER');
  assertDynamicBoundary(looks, 'GOM Looks');
});

check('GEE IMG/IMGEX/IMGNUM/IMGCOUNTDOWN dynamic references', () => {
  const img = statement(gee, 'img-absolute');
  const imgex = statement(gee, 'imgex-absolute');
  const number = statement(gee, 'image-number');
  const countdown = statement(gee, 'image-countdown');
  assertNoImageIndexes(img, [9310], 'GEE IMG');
  assertNoImageIndexes(imgex, [9310, 9311, 9312], 'GEE IMGEX');
  assertNoWillIndexes(img, [37], 'GEE IMG');
  assertNoWillIndexes(imgex, [37], 'GEE IMGEX');
  assertNoImageIndexes(number, [1290, 1291, 1292, 1293, 1294, 1295, 1296, 1297, 1298, 1299], 'GEE IMGNUM');
  assert.equal(number.imageTextPreview?.value, '4321');
  assert.equal(
    number.imageTextPreview?.glyphs.map(glyph => glyph.character).join(''),
    '4321',
    'GEE IMGNUM must keep a statically proven display number visible',
  );
  assert.notEqual(number.imageTextPreview?.gap, 5);
  assertNoImageIndexes(countdown, [9330, 9331, 9332, 9333, 9334, 9335, 9336, 9337, 9338, 9339, 9340], 'GEE IMGCOUNTDOWN');
  for (const [element, label] of [[img, 'GEE IMG'], [imgex, 'GEE IMGEX'], [number, 'GEE IMGNUM'], [countdown, 'GEE IMGCOUNTDOWN']]) {
    assertDynamicBoundary(element, label);
  }
});

check('GEE MONSTER direct-item and custom-frame dynamic references', () => {
  const monster = statement(gee, 'monster-preview');
  assert.equal(assetReferences(monster).some(reference => (
    reference.archiveName === 'Mon17' && reference.imageIndex === 40
  )), false, 'dynamic GEE Appr must not select Mon17/40 from the MOV value');
  assert.notEqual(monster.monsterPreview?.appr, 160);
  const cases = [
    ['state-item-preview', 9388, 'StateItem'],
    ['dnitems-preview', 9389, 'DnItems'],
    ['custom-item-preview', 9390, 'CustomItem'],
    ['hero-custom-item-preview', 9391, 'HeroCustomItem'],
    ['newopui-preview', 9392, 'NewopUI'],
  ];
  for (const [id, imageIndex, label] of cases) {
    const element = statement(gee, id);
    assertNoImageIndexes(element, [imageIndex], `GEE ${label}`);
    if (id === 'custom-item-preview' || id === 'hero-custom-item-preview') {
      assertNoWillIndexes(element, [37], `GEE ${label}`);
    }
    assertDynamicBoundary(element, `GEE ${label}`);
  }
  const looks = statement(gee, 'looks-preview');
  assert.notEqual(looks.itemPreview?.looks, 9393);
  assertDynamicBoundary(monster, 'GEE MONSTER');
  assertDynamicBoundary(looks, 'GEE Looks');
});

check('996PC Button/CheckBox keep dynamic assets strict while a proven caption is visible', () => {
  const button = keyed(pc, 'B');
  const checkbox = keyed(pc, 'C');
  assertNoImageIndexes(button, [9410, 9411, 9412], '996PC Button');
  assert.match(visibleText(button), /__MOV_BUTTON__/,
    'the independently proven button caption should remain useful even when asset states are runtime-only');
  assert.equal(button.textPreview?.textValueStatus, 'resolved-static');
  assert.ok(button.textPreview?.resolvedFields?.includes('text'));
  assert.match(visibleText(button), /__MOV_TOOLTIP__/,
    'the independently proven button tooltip should remain useful display text');
  assert.equal(
    button.displayValueSources?.find(source => source.field === 'tooltip')?.status,
    'resolved-static',
  );
  assert.notEqual(button.tooltipPreview?.offsetX, 91);
  assert.notEqual(button.tooltipPreview?.offsetY, 92);
  assertNoImageIndexes(checkbox, [9410, 9412], '996PC CheckBox');
  assert.equal(checkbox.togglePreview?.checked, undefined);
  assertDynamicBoundary(button, '996PC Button');
  assertDynamicBoundary(checkbox, '996PC CheckBox');
});

check('996PC Text/RText apply statically proven visible text style and tooltip fields', () => {
  for (const [id, label] of [['T', 'Text'], ['R', 'RText']]) {
    const element = keyed(pc, id);
    assert.match(visibleText(element), /__MOV_TEXT__/);
    assert.match(visibleText(element), /__MOV_TOOLTIP__/);
    assert.equal(element.textPreview?.fontSize, 20);
    assert.equal(element.textPreview?.color, '#00ff00');
    assert.equal(element.tooltipPreview?.offsetX, 91);
    assert.equal(element.tooltipPreview?.offsetY, 92);
    assert.equal(element.textPreview?.textValueStatus, 'resolved-static');
    assert.deepEqual(
      [...(element.textPreview?.resolvedFields || [])].sort(),
      ['color', 'font-size', 'text']
    );
  }
});

check('996PC TextAtlas dynamic sheet text and glyph dimensions', () => {
  const atlas = keyed(pc, 'A');
  assertNoImageIndexes(atlas, [9420], '996PC TextAtlas');
  assert.equal(atlas.imageTextPreview?.value, '6789');
  assert.equal(
    atlas.imageTextPreview?.glyphs.map(glyph => glyph.character).join(''),
    '6789',
    'TextAtlas must expose the statically proven display number',
  );
  assert.notEqual(atlas.imageTextPreview?.glyphWidth, 17);
  assert.notEqual(atlas.imageTextPreview?.glyphHeight, 23);
  assert.ok(atlas.imageTextPreview?.glyphs.every(glyph => (
    !glyph.assetRef && glyph.sourceX === undefined
  )), 'dynamic TextAtlas resources and glyph geometry must remain gated');
  assertDynamicBoundary(atlas, '996PC TextAtlas');
});

check('996PC PercentImg/LoadingBar dynamic progress', () => {
  const percent = keyed(pc, 'P');
  const loading = keyed(pc, 'L');
  assertNoImageIndexes(percent, [9420], '996PC PercentImg');
  assert.equal(percent.progressPreview?.value, 73,
    'PercentImg must expose the statically proven display number');
  assert.equal(percent.progressPreview?.maximum, undefined);
  assert.equal(percent.progressPreview?.ratio, undefined);
  assert.equal(percent.progressPreview?.direction, undefined);
  assertNoImageIndexes(loading, [9440, 9441], '996PC LoadingBar');
  assert.equal(loading.progressPreview?.value, 23,
    'LoadingBar must expose the statically proven display number');
  assert.equal(loading.progressPreview?.endValue, undefined);
  assert.equal(loading.progressPreview?.maximum, undefined);
  assert.equal(loading.progressPreview?.ratio, undefined);
  assert.equal(loading.progressPreview?.direction, undefined);
  assert.equal(loading.progressPreview?.valueIntervalMs, undefined);
  assert.equal(loading.progressPreview?.valueStep, undefined);
  assertDynamicBoundary(percent, '996PC PercentImg');
  assertDynamicBoundary(loading, '996PC LoadingBar');
});

check('996PC CostItem dynamic database and visible values', () => {
  const cost = keyed(pc, 'K');
  assert.equal(cost.itemPreview?.itemIndex, undefined);
  assert.equal(cost.itemPreview?.quantity, undefined);
  assert.equal(cost.costItemPreview?.title, '__MOV_BUTTON__');
  assert.equal(cost.costItemPreview?.quantityText, '123456');
  assert.notEqual(cost.costItemPreview?.itemScale, 0.75);
  assert.equal(cost.costItemPreview?.fontSize, undefined);
  assertDynamicBoundary(cost, '996PC CostItem');
});

check('mixed static and dynamic state layers keep only the proven static assets', () => {
  const gomMixed = parse([
    '[@main]', '#ACT', 'MOV N$HOVER 9511', '#SAY',
    '<&IMGEX:5:100:<$STR(N$HOVER)>:102:10:20>',
  ].join('\n'), 'GOM');
  const gomButton = statement(gomMixed, 'imgex-absolute');
  assert.deepEqual(gomButton.assetRef, { willIndex: 5, imageIndex: 100 });
  assert.deepEqual(
    (gomButton.assetLayers || []).map(layer => [layer.role, layer.assetRef]),
    [['pressed', { willIndex: 5, imageIndex: 102 }]],
    'GOM IMGEX must retain static normal/pressed assets while omitting only dynamic hover'
  );
  assertDynamicBoundary(gomButton, 'mixed GOM IMGEX');

  const pcMixed = parse([
    '[@main]', '#ACT', 'MOV N$HOVER 9511', 'MOV N$SELECTED 9512', '#SAY',
    '<Button|id=B|x=10|y=20|wil=NewopUI|pcnimg=140|pcmimg=<$STR(N$HOVER)>|pcpimg=142|text=static>',
    '<CheckBox|id=C|x=10|y=50|checkboxid=N0|wil=NewopUI|pcnimg=192|pcpimg=<$STR(N$SELECTED)>|default=0>',
  ].join('\n'), '996PC');
  const pcButton = keyed(pcMixed, 'B');
  assert.deepEqual(pcButton.assetRef, { archiveName: 'NewopUI', imageIndex: 140 });
  assert.deepEqual(
    (pcButton.assetLayers || []).map(layer => [layer.role, layer.assetRef]),
    [['pressed', { archiveName: 'NewopUI', imageIndex: 142 }]],
    '996PC Button must retain static normal/pressed assets while omitting only dynamic hover'
  );
  const checkbox = keyed(pcMixed, 'C');
  assert.deepEqual(checkbox.assetRef, { archiveName: 'NewopUI', imageIndex: 192 });
  assert.equal(
    (checkbox.assetLayers || []).some(layer => layer.assetRef?.imageIndex === 9512),
    false,
    '996PC CheckBox must retain static unchecked asset without requesting dynamic selected state'
  );
  assertDynamicBoundary(pcButton, 'mixed 996PC Button');
  assertDynamicBoundary(checkbox, 'mixed 996PC CheckBox');
});

check('unresolved display values use typed placeholders without unlocking resources', () => {
  const gomUnknown = parse([
    '[@main]', '#SAY',
    '<&IMG:<$STR(N$IMG)>:<$STR(N$WIL)>:10:20>',
    '<MONSTER:<$STR(N$APPR)>:<$STR(N$RACE)>:<$STR(N$ACTION)>:<$STR(N$DIR)>:20:20>',
    '<Looks:1:<$STR(N$LOOKS)>:30:20>',
  ].join('\n'), 'GOM');
  const geeUnknown = parse([
    '[@main]', '#SAY',
    '<StateItem:<$STR(N$STATE)>:10:20:1>',
    '<NewopUI:<$STR(N$NEWOP)>:30:20>',
  ].join('\n'), 'GEE');
  const pcUnknown = parse([
    '[@main]', '#SAY',
    '<Button|id=B0|x=10|y=20|wil=<$STR(S$WIL)>|pcnimg=<$STR(N$NORMAL)>|text=<$STR(S$TEXT)>>',
    '<Text|id=T0|x=10|y=50|text=<$STR(S$TEXT)>|color=<$STR(N$COLOR)>|size=<$STR(N$SIZE)>>',
    '<TextAtlas|id=A0|x=10|y=80|wil=<$STR(S$WIL)>|pcimg=<$STR(N$ATLAS)>|iwidth=<$STR(N$W)>|iheight=<$STR(N$H)>|text=<$STR(S$TEXT)>>',
    '<CostItem|id=K0|x=10|y=110|itemid=<$STR(N$ITEM)>|itemcount=<$STR(N$COUNT)>>',
  ].join('\n'), '996PC');
  for (const element of [
    statement(gomUnknown, 'img-absolute'),
    statement(gomUnknown, 'monster-preview'),
    statement(gomUnknown, 'looks-preview'),
    statement(geeUnknown, 'state-item-preview'),
    statement(geeUnknown, 'newopui-preview'),
    keyed(pcUnknown, 'B0'),
    keyed(pcUnknown, 'A0'),
  ]) {
    assertNoImageIndexes(element, [0], element.statementId);
    assertDynamicBoundary(element, element.statementId);
  }
  assertNoWillIndexes(statement(gomUnknown, 'img-absolute'), [0], 'GOM IMG without MOV');
  assert.equal(
    assetReferences(keyed(pcUnknown, 'B0')).some(reference => reference.archiveName === '0'),
    false,
    'a missing MOV must not make dynamic 996PC wil resolve to archive name 0'
  );
  const unknownButton = keyed(pcUnknown, 'B0');
  const unknownText = keyed(pcUnknown, 'T0');
  const unknownAtlas = keyed(pcUnknown, 'A0');
  const unknownCost = keyed(pcUnknown, 'K0');
  assert.match(visibleText(unknownButton), /预览文字/);
  assert.match(visibleText(unknownText), /预览文字/);
  assert.equal(unknownAtlas.imageTextPreview?.value, '0');
  assert.equal(
    unknownAtlas.imageTextPreview?.glyphs.map(glyph => glyph.character).join(''),
    '0',
  );
  assert.equal(unknownCost.costItemPreview?.title, '客户端默认标题');
  assert.equal(unknownCost.costItemPreview?.quantityText, '0');
  assert.equal(unknownCost.itemPreview?.itemIndex, undefined);
  assert.equal(unknownCost.itemPreview?.quantity, undefined);
  for (const [element, label] of [
    [unknownButton, '996PC Button without MOV'],
    [unknownText, '996PC Text without MOV'],
    [unknownAtlas, '996PC TextAtlas without MOV'],
    [unknownCost, '996PC CostItem without MOV'],
  ]) {
    assert.doesNotMatch(visibleText(element), /<\$|\$STR/i,
      `${label} leaked its raw source expression into visible text`);
    assertDynamicBoundary(element, label);
  }
});

function loadProviderInternals() {
  const fileName = require.resolve('../out/providers/npc-dialog-visual');
  const source = fs.readFileSync(fileName, 'utf8')
    + '\nmodule.exports.__NpcDialogVisualEditorManager = NpcDialogVisualEditorManager;\n';
  const uri = value => ({
    fsPath: value,
    path: value,
    scheme: 'file',
    toString() { return value; },
  });
  const vscode = {
    Uri: {
      parse: uri,
      file: uri,
      joinPath(base, ...parts) {
        return uri([base.fsPath || base.path, ...parts].join('/'));
      },
    },
    EventEmitter: class {
      constructor() { this.event = () => undefined; }
      fire() {}
      dispose() {}
    },
    Disposable: { from: () => ({ dispose() {} }) },
    workspace: {},
    window: {},
    commands: {},
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const testModule = new Module(fileName, module);
    testModule.filename = fileName;
    testModule.paths = Module._nodeModulePaths(path.dirname(fileName));
    testModule._compile(source, fileName);
    return testModule.exports;
  } finally {
    Module._load = originalLoad;
  }
}

check('production provider never resolves dynamic-derived assets or CostItem IDX', async () => {
  const { __NpcDialogVisualEditorManager: Manager } = loadProviderInternals();
  assert.equal(typeof Manager, 'function');
  const manager = Object.create(Manager.prototype);
  const requests = [];
  const databaseLookups = [];
  manager.resolveAsset = reference => {
    requests.push({ ...reference });
    return {
      status: 'missing',
      archiveLabel: 'test/missing',
      message: 'test fixture',
    };
  };
  manager.scriptDataResolver = {
    resolveItemFieldByIndex(fileName, itemIndex, field) {
      databaseLookups.push({ kind: 'index', fileName, itemIndex, field });
      return undefined;
    },
    resolveItemFieldByName(fileName, itemName, field) {
      databaseLookups.push({ kind: 'name', fileName, itemName, field });
      return undefined;
    },
  };
  const freshModels = [
    parse(gomSource, 'GOM'),
    parse(geeSource, 'GEE'),
    parse(pcSource, '996PC'),
  ];
  for (const model of freshModels) {
    await manager.hydrateAssets(model, {}, { fileName: 'dynamic-source-safety.txt' });
  }
  const forbidden = requests.filter(reference => (
    (reference.imageIndex >= 9000 && reference.imageIndex <= 9999)
    || reference.willIndex === 37
    || reference.archiveName === '0'
    || (reference.archiveName === 'Mon113' && reference.imageIndex === 40)
    || (reference.archiveName === 'Mon17' && reference.imageIndex === 40)
    || (reference.archiveName === 'NewopUI'
      && reference.imageIndex >= 1290 && reference.imageIndex <= 1299)
  ));
  assert.deepEqual(
    forbidden,
    [],
    `provider requested assets derived only from source expressions: ${JSON.stringify(forbidden)}`
  );
  assert.equal(
    databaseLookups.some(lookup => lookup.itemIndex === 993),
    false,
    `provider queried CostItem IDX 993 derived only from MOV: ${JSON.stringify(databaseLookups)}`
  );
});

async function main() {
  const failures = [];
  for (const entry of checks) {
    try {
      await entry.callback();
      console.log(`PASS ${entry.name}`);
    } catch (error) {
      failures.push({ name: entry.name, error });
      console.error(`FAIL ${entry.name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failures.length > 0) {
    console.error(`npc-dialog-dynamic-source-safety.test.js: ${failures.length}/${checks.length} checks failed`);
    process.exitCode = 1;
    return;
  }
  console.log(`npc-dialog-dynamic-source-safety.test.js: PASS (${checks.length} checks)`);
}

void main();
