const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

/*
 * Evidence-bounded red contract for progress-family controls.
 *
 * Engine help used for the assertions below:
 * - GOM/GEE `Npc对话框动态进度条功能.htm` documents F/B/P,
 *   C/T, N/X/V and direction 0..3. GOM notes that only horizontal
 *   directions are currently supported, but still documents all four values.
 * - 996PC `进度条LoadingBar.htm` documents direction 0/1, defaults
 *   endper=100, maxper=100, interval=.05, loadvalue=10 and a completion link.
 * - 996PC `百分比图片_PercentImg_.htm` documents direction 0..3,
 *   pcimg, minValue and maxValue.
 * - 996PC `滑动拉杆_Slider_.htm` documents maxvalue default 100,
 *   defvalue default 0, an N/N$ variable and a link triggered by slider use.
 *
 * A display-only text or number may expose a statically proven MOV snapshot,
 * while its dynamic source provenance remains auditable. Runtime ratios,
 * timing, state, geometry and assets must remain unknown. Invalid static
 * fields must not be clamped into a plausible preview or reach hydration.
 */

function parse(engine, sayLines, actLines = [], fileName = 'progress-strict-runtime.txt') {
  const source = [
    '[@main]',
    ...(actLines.length > 0 ? ['#ACT', ...actLines] : []),
    '#SAY',
    ...sayLines,
    '',
  ].join('\n');
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/${fileName}`,
    fileName,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\${fileName}`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function typedElements(model) {
  return model.pages[0].elements.filter(element => element.statementId !== 'flow-text');
}

function statement(model, statementId, occurrence = 0) {
  const matches = typedElements(model).filter(element => element.statementId === statementId);
  assert.ok(matches[occurrence], `missing ${statementId} occurrence ${occurrence}`);
  return matches[occurrence];
}

function keyed(model, id) {
  const element = typedElements(model).find(candidate => candidate.containerElementId === id);
  assert.ok(element, `missing keyed control ${id}`);
  return element;
}

function requireFields(actual, expected, message) {
  const values = new Set(actual || []);
  const missing = expected.filter(field => !values.has(field));
  assert.deepEqual(
    missing,
    [],
    `${message}; missing=${missing.join(',')}; actual=${JSON.stringify(actual)}`
  );
}

function assetReferences(element) {
  return [
    element.assetRef,
    ...(element.assetLayers || []).map(layer => layer.assetRef),
  ].filter(Boolean);
}

function assertNoAssetValue(element, predicate, message) {
  const rejected = assetReferences(element).filter(predicate);
  assert.deepEqual(rejected, [], `${message}: ${JSON.stringify(rejected)}`);
}

function assertUnknownProgress(preview, fields, message) {
  for (const field of fields) {
    assert.equal(preview?.[field], undefined, `${message}: ${field} borrowed/coerced a value`);
  }
  assert.equal(preview?.ratio, undefined, `${message}: unknown range must not expose a fake ratio`);
}

function assertDynamicProgressDisplay(preview, expected, runtimeFields, message) {
  for (const [field, value] of Object.entries(expected)) {
    assert.equal(preview?.[field], value, `${message}: visible ${field}`);
  }
  for (const field of runtimeFields) {
    assert.equal(preview?.[field], undefined, `${message}: runtime ${field} must stay gated`);
  }
  assert.equal(preview?.ratio, undefined, `${message}: dynamic range must not expose a fake ratio`);
}

function assertAction(element, trigger, link, message) {
  const action = element.runtimeActionPreview;
  assert.ok(action, `${message}: missing typed runtime action`);
  assert.equal(action.trigger, trigger, `${message}: trigger`);
  assert.equal(action.localOnly, true, `${message}: action must be local-only`);
  assert.equal(action.link, link, `${message}: link`);
}

function checkStaticLanguageEvidence() {
  const entries = new Map(staticLanguage.saySnippets.map(entry => [entry.id, entry]));
  for (const id of [
    'progress-bar',
    'newui-slider-996pc',
    'newui-percentimg-996pc',
    'newui-loadingbar-996pc',
    'countdown',
    'image-countdown',
    'time-tips',
    'newui-countdown-996pc',
    'newui-timetips-996pc',
  ]) {
    assert.ok(entries.has(id), `static-language is missing ${id}`);
  }
  const loading = entries.get('newui-loadingbar-996pc').engineVariants['996PC'];
  const loadingText = JSON.stringify(loading);
  assert.match(loadingText, /direction.*0.*1|0.*1.*direction/i);
  assert.match(loadingText, /endper.*100|maxper.*100|interval.*0\.05|loadvalue.*10/i);
  assert.match(loadingText, /完成触发标签|完成标签/);
  const percent = JSON.stringify(entries.get('newui-percentimg-996pc').engineVariants['996PC']);
  assert.match(percent, /0左到右.*1右到左.*2上到下.*3下到上/);
  const slider = JSON.stringify(entries.get('newui-slider-996pc').engineVariants['996PC']);
  assert.match(slider, /最大值；默认100/);
  assert.match(slider, /默认值；默认0/);
}

function checkLegacyProgressStrictness() {
  for (const engine of ['GOM', 'GEE']) {
    const validModel = parse(engine, [
      '<&ProgressBar:10:20:1:620:630:6:100:4:1:100:200:190:3:249:0:0:%p/%m:valid>',
    ]);
    const valid = statement(validModel, 'progress-bar');
    assert.deepEqual(
      {
        minimum: valid.progressPreview?.minimum,
        maximum: valid.progressPreview?.maximum,
        value: valid.progressPreview?.value,
        ratio: valid.progressPreview?.ratio,
        direction: valid.progressPreview?.direction,
        frameCount: valid.progressPreview?.frameCount,
        frameInterval: valid.progressPreview?.frameInterval,
      },
      {
        minimum: 100,
        maximum: 200,
        value: 190,
        ratio: 0.9,
        direction: 3,
        frameCount: 6,
        frameInterval: 100,
      },
      `${engine} valid ProgressBar`
    );
    assert.deepEqual(valid.progressPreview?.invalidFields || [], []);
    assert.deepEqual(valid.progressPreview?.dynamicFields || [], []);
    assert.deepEqual(assetReferences(valid).map(reference => [
      reference.willIndex,
      reference.imageIndex,
    ]), [[1, 620], [1, 620], [1, 630]]);

    const invalidModel = parse(engine, [
      '<&ProgressBar:10:20:-1:-2:-3:3.5:-1:0:0:100:100:150:4:999:0:0:%p/%m:invalid>',
    ]);
    const invalid = statement(invalidModel, 'progress-bar');
    requireFields(invalid.progressPreview?.invalidFields, [
      'archive', 'background-image', 'progress-image',
      'frame-count', 'frame-interval',
      'minimum', 'maximum', 'value', 'direction', 'caption-color',
    ], `${engine} invalid ProgressBar fields`);
    assertUnknownProgress(
      invalid.progressPreview,
      ['minimum', 'maximum', 'value', 'direction', 'frameCount', 'frameInterval', 'captionColor'],
      `${engine} invalid ProgressBar`
    );
    assert.deepEqual(assetReferences(invalid), [], `${engine} invalid ProgressBar reached assets`);
    assert.match(invalid.warning || '', /无效/);
    assert.match(invalid.warning || '', /0\s*(?:\.\.|-|~|至)\s*3|direction/i);
    assert.match(invalid.warning || '', /0\s*(?:\.\.|-|~|至)\s*255|颜色/i);

    const dynamicModel = parse(engine, [
      '<&ProgressBar:10:20:<$STR(N$WIL)>:<$STR(N$BG)>:<$STR(N$FILL)>:<$STR(N$COUNT)>:<$STR(N$INTERVAL)>:0:0:<$STR(N$MIN)>:<$STR(N$MAX)>:<$STR(N$VALUE)>:<$STR(N$DIRECTION)>:<$STR(N$COLOR)>:0:0:<$STR(S$TEXT)>:dynamic>',
    ], [
      'MOV N$WIL 91', 'MOV N$BG 9620', 'MOV N$FILL 9630', 'MOV N$COUNT 8',
      'MOV N$INTERVAL 50', 'MOV N$MIN 10', 'MOV N$MAX 500', 'MOV N$VALUE 450',
      'MOV N$DIRECTION 2', 'MOV N$COLOR 250', 'MOV S$TEXT __BORROWED_CAPTION__',
    ]);
    const dynamic = statement(dynamicModel, 'progress-bar');
    requireFields(dynamic.progressPreview?.dynamicFields, [
      'archive', 'background-image', 'progress-image',
      'frame-count', 'frame-interval',
      'minimum', 'maximum', 'value', 'direction', 'caption-color', 'text',
    ], `${engine} dynamic ProgressBar fields`);
    assertDynamicProgressDisplay(
      dynamic.progressPreview,
      { value: 450, text: '__BORROWED_CAPTION__' },
      ['minimum', 'maximum', 'direction', 'frameCount', 'frameInterval', 'captionColor'],
      `${engine} dynamic ProgressBar`
    );
    assertNoAssetValue(
      dynamic,
      reference => reference.willIndex === 91 || [9620, 9630].includes(reference.imageIndex),
      `${engine} dynamic ProgressBar borrowed MOV assets`
    );
    const textSource = dynamic.displayValueSources?.find(source => source.field === 'progress-text');
    assert.deepEqual({
      status: textSource?.status,
      kind: textSource?.kind,
      value: textSource?.value,
    }, {
      status: 'resolved-static',
      kind: 'text',
      value: '__BORROWED_CAPTION__',
    }, `${engine} resolved caption provenance`);
    assert.match(dynamic.warning || '', /动态/);
    assert.match(dynamic.warning || '', /不借用.*当前值|当前值.*不借用/);

    const unresolvedModel = parse(engine, [
      '<&ProgressBar:10:20:1:620:630:6:100:0:0:100:200:150:0:250:0:0:<$STR(S$UNKNOWN_CAPTION)>:unresolved>',
    ]);
    const unresolved = statement(unresolvedModel, 'progress-bar');
    assert.equal(unresolved.progressPreview?.text, '预览文字',
      `${engine} unresolved display caption must remain useful`);
    requireFields(unresolved.progressPreview?.dynamicFields, ['text'],
      `${engine} unresolved caption dynamic provenance`);
    const unresolvedTextSource = unresolved.displayValueSources
      ?.find(source => source.field === 'progress-text');
    assert.deepEqual({
      status: unresolvedTextSource?.status,
      kind: unresolvedTextSource?.kind,
      value: unresolvedTextSource?.value,
    }, {
      status: 'runtime-placeholder',
      kind: 'text',
      value: '预览文字',
    }, `${engine} unresolved caption provenance`);
  }
}

function checkLoadingBarStrictnessAndCompletion() {
  const model = parse('996PC', [
    '<LoadingBar|id=LOAD_DEFAULT|x=10|y=20|wil=NewopUI|pcloadingbg=100|pcloadingbar=101|startper=0|direction=0|link=@loadDefaultDone>',
    '<LoadingBar|id=LOAD_VALID|x=10|y=50|wil=NewopUI|pcloadingbg=110|pcloadingbar=111|startper=10|endper=90|maxper=150|interval=0.1|loadvalue=2|direction=1|HideText=1|size=16|color=250|outline=0|outlinecolor=251|link=@loadDone>',
    '<LoadingBar|id=LOAD_INVALID|x=10|y=80|wil=NewopUI|pcloadingbg=-1|pcloadingbar=1.5|startper=-1|endper=101|maxper=0|interval=0|loadvalue=0|direction=2|HideText=2|size=0|color=256|outline=-1|outlinecolor=-1|link=@invalidDone>',
    '<LoadingBar|id=LOAD_DYNAMIC|x=10|y=110|wil=<$STR(S$WIL)>|pcloadingbg=<$STR(N$BG)>|pcloadingbar=<$STR(N$FILL)>|startper=<$STR(N$START)>|endper=<$STR(N$END)>|maxper=<$STR(N$MAX)>|interval=<$STR(N$INTERVAL)>|loadvalue=<$STR(N$STEP)>|direction=<$STR(N$DIRECTION)>|HideText=<$STR(N$HIDE)>|link=@dynamicDone>',
  ], [
    'MOV S$WIL BorrowedUI', 'MOV N$BG 9700', 'MOV N$FILL 9701',
    'MOV N$START 20', 'MOV N$END 80', 'MOV N$MAX 200',
    'MOV N$INTERVAL 2', 'MOV N$STEP 5', 'MOV N$DIRECTION 1', 'MOV N$HIDE 1',
  ]);
  const defaults = keyed(model, 'LOAD_DEFAULT');
  const valid = keyed(model, 'LOAD_VALID');
  const invalid = keyed(model, 'LOAD_INVALID');
  const dynamic = keyed(model, 'LOAD_DYNAMIC');

  assert.deepEqual({
    maximum: defaults.progressPreview?.maximum,
    endValue: defaults.progressPreview?.endValue,
    valueIntervalMs: defaults.progressPreview?.valueIntervalMs,
    valueStep: defaults.progressPreview?.valueStep,
    showCaption: defaults.progressPreview?.showCaption,
  }, {
    maximum: 100,
    endValue: 100,
    valueIntervalMs: 50,
    valueStep: 10,
    showCaption: true,
  });
  requireFields(defaults.progressPreview?.defaultFields, [
    'maximum', 'end-value', 'value-interval', 'value-step', 'visibility',
  ], 'LoadingBar documented defaults');
  assertAction(defaults, 'completion', '@loadDefaultDone', 'LoadingBar default completion');

  assert.deepEqual({
    minimum: valid.progressPreview?.minimum,
    maximum: valid.progressPreview?.maximum,
    value: valid.progressPreview?.value,
    endValue: valid.progressPreview?.endValue,
    ratio: valid.progressPreview?.ratio,
    direction: valid.progressPreview?.direction,
    valueIntervalMs: valid.progressPreview?.valueIntervalMs,
    valueStep: valid.progressPreview?.valueStep,
    showCaption: valid.progressPreview?.showCaption,
    fontSize: valid.progressPreview?.fontSize,
    outlineWidth: valid.progressPreview?.outlineWidth,
  }, {
    minimum: 0,
    maximum: 150,
    value: 10,
    endValue: 90,
    ratio: 10 / 150,
    direction: 1,
    valueIntervalMs: 100,
    valueStep: 2,
    showCaption: false,
    fontSize: 16,
    outlineWidth: 0,
  });
  assertAction(valid, 'completion', '@loadDone', 'LoadingBar completion');

  requireFields(invalid.progressPreview?.invalidFields, [
    'background-image', 'progress-image', 'maximum', 'value', 'end-value',
    'value-interval', 'value-step', 'direction', 'visibility', 'font-size',
    'caption-color', 'outline-width', 'outline-color',
  ], 'LoadingBar invalid fields');
  assertUnknownProgress(
    invalid.progressPreview,
    [
      'maximum', 'value', 'endValue', 'direction', 'valueIntervalMs', 'valueStep',
      'showCaption', 'fontSize', 'captionColor', 'outlineWidth', 'outlineColor',
    ],
    'invalid LoadingBar'
  );
  assert.deepEqual(assetReferences(invalid), [], 'invalid LoadingBar reached provider references');
  assertAction(invalid, 'completion', '@invalidDone', 'invalid LoadingBar completion type');
  assert.match(invalid.warning || '', /无效/);

  requireFields(dynamic.progressPreview?.dynamicFields, [
    'archive', 'background-image', 'progress-image', 'maximum', 'value', 'end-value',
    'value-interval', 'value-step', 'direction', 'visibility',
  ], 'LoadingBar dynamic fields');
  assertDynamicProgressDisplay(
    dynamic.progressPreview,
    { value: 20 },
    [
      'maximum', 'endValue', 'direction', 'valueIntervalMs', 'valueStep',
      'showCaption',
    ],
    'dynamic LoadingBar'
  );
  assertNoAssetValue(
    dynamic,
    reference => reference.archiveName === 'BorrowedUI' || [9700, 9701].includes(reference.imageIndex),
    'dynamic LoadingBar borrowed MOV assets'
  );
  assertAction(dynamic, 'completion', '@dynamicDone', 'dynamic LoadingBar completion type');
  assert.match(dynamic.warning || '', /动态/);
  assert.match(dynamic.warning || '', /不借用.*当前值|当前值.*不借用/);
}

function checkPercentImgStrictness() {
  const model = parse('996PC', [
    '<PercentImg|id=P_VALID|x=10|y=20|direction=3|wil=NewopUI|pcimg=231|minValue=50|maxValue=148>',
    '<PercentImg|id=P_INVALID|x=10|y=50|direction=4|wil=NewopUI|pcimg=-1|minValue=200|maxValue=0>',
    '<PercentImg|id=P_DYNAMIC|x=10|y=80|direction=<$STR(N$DIR)>|wil=<$STR(S$WIL)>|pcimg=<$STR(N$IMG)>|minValue=<$STR(N$VALUE)>|maxValue=<$STR(N$MAX)>>',
  ], [
    'MOV N$DIR 2', 'MOV S$WIL BorrowedUI', 'MOV N$IMG 9800',
    'MOV N$VALUE 75', 'MOV N$MAX 300',
  ]);
  const valid = keyed(model, 'P_VALID');
  const invalid = keyed(model, 'P_INVALID');
  const dynamic = keyed(model, 'P_DYNAMIC');
  assert.deepEqual({
    minimum: valid.progressPreview?.minimum,
    maximum: valid.progressPreview?.maximum,
    value: valid.progressPreview?.value,
    ratio: valid.progressPreview?.ratio,
    direction: valid.progressPreview?.direction,
  }, { minimum: 0, maximum: 148, value: 50, ratio: 50 / 148, direction: 3 });
  requireFields(invalid.progressPreview?.invalidFields, [
    'progress-image', 'maximum', 'value', 'direction',
  ], 'PercentImg invalid fields');
  assertUnknownProgress(
    invalid.progressPreview,
    ['maximum', 'value', 'direction'],
    'invalid PercentImg'
  );
  assert.deepEqual(assetReferences(invalid), [], 'invalid PercentImg reached provider references');
  requireFields(dynamic.progressPreview?.dynamicFields, [
    'archive', 'progress-image', 'maximum', 'value', 'direction',
  ], 'PercentImg dynamic fields');
  assertDynamicProgressDisplay(
    dynamic.progressPreview,
    { value: 75 },
    ['maximum', 'direction'],
    'dynamic PercentImg'
  );
  assertNoAssetValue(
    dynamic,
    reference => reference.archiveName === 'BorrowedUI' || reference.imageIndex === 9800,
    'dynamic PercentImg borrowed MOV assets'
  );
}

function checkSliderStrictnessAndChangeAction() {
  const model = parse('996PC', [
    '<Slider|id=S_DEFAULT|x=10|y=20|sliderid=N20|wil=NewopUI|pcbgimg=298|pcbarimg=299|pcballimg=297|link=@slideDefault>',
    '<Slider|id=S_VALID|x=10|y=50|sliderid=N$VALUE|wil=NewopUI|pcbgimg=308|pcbarimg=309|pcballimg=307|maxvalue=10000|defvalue=5000|link=@slide>',
    '<Slider|id=S_UPPER|x=10|y=65|sliderid=N999|wil=NewopUI|pcbgimg=318|pcbarimg=319|pcballimg=317|maxvalue=10|defvalue=5>',
    '<Slider|id=S_TOO_LARGE|x=10|y=70|sliderid=N1000|wil=NewopUI|pcbgimg=328|pcbarimg=329|pcballimg=327|maxvalue=10|defvalue=5>',
    '<Slider|id=S_INVALID|x=10|y=80|sliderid=S0|wil=NewopUI|pcbgimg=-1|pcbarimg=1.5|pcballimg=-2|maxvalue=0|defvalue=-1|link=@invalidSlide>',
    '<Slider|id=S_DYNAMIC|x=10|y=110|sliderid=<$STR(S$VAR)>|wil=<$STR(S$WIL)>|pcbgimg=<$STR(N$BG)>|pcbarimg=<$STR(N$BAR)>|pcballimg=<$STR(N$BALL)>|maxvalue=<$STR(N$MAX)>|defvalue=<$STR(N$VALUE)>|link=<$STR(S$LINK)>>',
  ], [
    'MOV S$VAR N0', 'MOV S$WIL BorrowedUI', 'MOV N$BG 9900', 'MOV N$BAR 9901',
    'MOV N$BALL 9902', 'MOV N$MAX 1000', 'MOV N$VALUE 500', 'MOV S$LINK @borrowedSlide',
  ]);
  const defaults = keyed(model, 'S_DEFAULT');
  const valid = keyed(model, 'S_VALID');
  const upper = keyed(model, 'S_UPPER');
  const tooLarge = keyed(model, 'S_TOO_LARGE');
  const invalid = keyed(model, 'S_INVALID');
  const dynamic = keyed(model, 'S_DYNAMIC');

  assert.deepEqual({
    maximum: defaults.sliderPreview?.maximum,
    initialValue: defaults.sliderPreview?.initialValue,
  }, { maximum: 100, initialValue: 0 });
  requireFields(defaults.sliderPreview?.defaultFields, ['maximum', 'value'], 'Slider defaults');
  assert.equal(defaults.sliderPreview?.variableName, 'N20');
  assertAction(defaults, 'change', '@slideDefault', 'Slider default change action');
  assert.deepEqual({
    maximum: valid.sliderPreview?.maximum,
    initialValue: valid.sliderPreview?.initialValue,
    variableName: valid.sliderPreview?.variableName,
  }, { maximum: 10000, initialValue: 5000, variableName: 'N$VALUE' });
  assertAction(valid, 'change', '@slide', 'Slider change action');
  assert.equal(upper.sliderPreview?.variableName, 'N999');
  assert.ok((tooLarge.sliderPreview?.invalidFields || []).includes('variable'));
  assert.equal(tooLarge.sliderPreview?.variableName, undefined);

  requireFields(invalid.sliderPreview?.invalidFields, [
    'variable', 'maximum', 'value', 'background-image', 'progress-image', 'thumb-image',
  ], 'Slider invalid fields');
  assert.equal(invalid.sliderPreview?.maximum, undefined);
  assert.equal(invalid.sliderPreview?.initialValue, undefined);
  assert.equal(invalid.sliderPreview?.variableName, undefined);
  assert.equal(invalid.progressPreview?.ratio, undefined);
  assert.deepEqual(assetReferences(invalid), [], 'invalid Slider reached provider references');
  assertAction(invalid, 'change', '@invalidSlide', 'invalid Slider action type');

  requireFields(dynamic.sliderPreview?.dynamicFields, [
    'variable', 'maximum', 'value', 'link',
    'archive', 'background-image', 'progress-image', 'thumb-image',
  ], 'Slider dynamic fields');
  assert.equal(dynamic.sliderPreview?.maximum, undefined);
  assert.equal(dynamic.sliderPreview?.initialValue, undefined);
  assert.equal(dynamic.sliderPreview?.variableName, undefined);
  assert.equal(dynamic.sliderPreview?.link, undefined);
  assert.equal(dynamic.progressPreview?.ratio, undefined);
  assertNoAssetValue(
    dynamic,
    reference => reference.archiveName === 'BorrowedUI'
      || [9900, 9901, 9902].includes(reference.imageIndex),
    'dynamic Slider borrowed MOV assets'
  );
  const action = dynamic.runtimeActionPreview;
  assert.ok(action, 'dynamic Slider lost its typed action');
  assert.equal(action.trigger, 'change');
  assert.equal(action.localOnly, true);
  assert.equal(action.link, undefined);
  requireFields(action.dynamicFields, ['link'], 'dynamic Slider action fields');
}

function checkCompletionActions() {
  const cases = [
    ['GOM', '<&COUNTDOWN:0:1:251:0:0:0/@gomDone>', 'countdown', '@gomDone'],
    ['GOM', '<&IMGCOUNTDOWN:0:1:1320:10:0:0:0/@gomImageDone>', 'image-countdown', '@gomImageDone'],
    ['GEE', '<&COUNTDOWN:0:1:251:0:0:0/@geeDone>', 'countdown', '@geeDone'],
    ['GEE', '<&IMGCOUNTDOWN:0:1:1320:10:0:0:0/@geeImageDone>', 'image-countdown', '@geeImageDone'],
    ['996PC', '<COUNTDOWN:0:1:250:10:10/@pcLegacyDone>', 'countdown', '@pcLegacyDone'],
    ['996PC', '<TIMETIPS:0:1:250:10:10/@pcTimeDone>', 'time-tips', '@pcTimeDone'],
  ];
  for (const [engine, markup, statementId, link] of cases) {
    const element = statement(parse(engine, [markup]), statementId);
    assert.equal(element.countdownPreview?.link, link, `${engine} ${statementId} countdown link`);
    assertAction(element, 'completion', link, `${engine} ${statementId}`);
  }

  const pc = parse('996PC', [
    '<COUNTDOWN|id=PC_COUNT|x=10|y=20|time=0|count=1|link=@pcCountDone>',
    '<TIMETIPS|id=PC_TIME|x=10|y=50|time=0|count=1|link=@pcTimeKeyedDone>',
    '<COUNTDOWN|id=PC_DYNAMIC_LINK|x=10|y=80|time=0|count=1|link=<$STR(S$DONE)>>',
  ], ['MOV S$DONE @borrowedDone']);
  assertAction(keyed(pc, 'PC_COUNT'), 'completion', '@pcCountDone', '996PC keyed COUNTDOWN');
  assertAction(keyed(pc, 'PC_TIME'), 'completion', '@pcTimeKeyedDone', '996PC keyed TIMETIPS');
  const dynamic = keyed(pc, 'PC_DYNAMIC_LINK');
  assert.equal(dynamic.countdownPreview?.link, undefined, 'dynamic countdown borrowed MOV link');
  requireFields(dynamic.countdownPreview?.dynamicFields, ['link'], 'dynamic countdown fields');
  assert.ok(dynamic.runtimeActionPreview, 'dynamic countdown lost action boundary');
  assert.equal(dynamic.runtimeActionPreview.trigger, 'completion');
  assert.equal(dynamic.runtimeActionPreview.link, undefined);
  assert.equal(dynamic.runtimeActionPreview.localOnly, true);
  requireFields(dynamic.runtimeActionPreview.dynamicFields, ['link'], 'dynamic completion action fields');
  assert.doesNotMatch(JSON.stringify(dynamic), /borrowedDone/);
}

function checkVariableCarriedProgressSourceSafety() {
  const loading = parse('996PC', ['<$STR(S$PANEL)>'], [
    'MOV N$MAX 100',
    'MOV N$END 90',
    'MOV N$HIDE 1',
    'MOV S$PANEL <LoadingBar|id=NESTED|x=10|y=20|wil=NewopUI|pcloadingbg=100|pcloadingbar=101|startper=10|maxper=<$STR(N$MAX)>|endper=<$STR(N$END)>|HideText=<$STR(N$HIDE)>|direction=0>',
  ], 'progress-variable-carried-loading.txt');
  const nested = keyed(loading, 'NESTED');
  requireFields(nested.progressPreview?.dynamicFields, [
    'maximum', 'end-value', 'visibility',
  ], 'variable-carried LoadingBar dynamic fields');
  assert.equal(nested.progressPreview?.maximum, undefined,
    'variable-carried LoadingBar borrowed MOV maximum');
  assert.equal(nested.progressPreview?.endValue, undefined,
    'variable-carried LoadingBar borrowed MOV end value');
  assert.equal(nested.progressPreview?.showCaption, undefined,
    'variable-carried LoadingBar borrowed MOV visibility');
  assert.equal(nested.progressPreview?.ratio, undefined,
    'variable-carried LoadingBar exposed a ratio from a borrowed maximum');
  assert.equal(nested.progressPreview?.value, 10,
    'variable-carried LoadingBar lost its statically proven start value');

  const percent = parse('996PC', ['<$STR(S$PANEL)>'], [
    'MOV N$MAX -1',
    'MOV S$PANEL <PercentImg|id=NESTED_PERCENT|x=10|y=20|direction=0|wil=NewopUI|pcimg=231|minValue=50|maxValue=<$STR(N$MAX)>>',
  ], 'progress-variable-carried-percent.txt');
  const nestedPercent = keyed(percent, 'NESTED_PERCENT');
  requireFields(nestedPercent.progressPreview?.dynamicFields, ['maximum'],
    'variable-carried PercentImg dynamic fields');
  assert.equal(nestedPercent.progressPreview?.maximum, undefined,
    'variable-carried PercentImg borrowed an invalid MOV maximum');
  assert.equal(nestedPercent.progressPreview?.ratio, undefined,
    'variable-carried PercentImg exposed a ratio from a borrowed maximum');
  assert.equal(nestedPercent.progressPreview?.value, 50,
    'variable-carried PercentImg lost its statically proven value');
  assert.ok(!(nestedPercent.progressPreview?.invalidFields || []).includes('maximum'),
    'dynamic PercentImg maximum was misclassified from the current MOV value');
  assert.ok(!(nestedPercent.progressPreview?.invalidFields || []).includes('value'),
    'static PercentImg value was poisoned by the current dynamic maximum');
}

function checkLegacyProgressArchiveIsolation() {
  const model = parse('GOM', [
    '<&ProgressBar:10:20:NewopUI:620:630:6:100:0:0:0:100:50:0:250:0:0:%p/%m:badF>',
  ]);
  const progress = statement(model, 'progress-bar');
  requireFields(progress.progressPreview?.invalidFields, ['archive'],
    'legacy ProgressBar named archive isolation');
  assert.deepEqual(assetReferences(progress), [],
    'legacy ProgressBar accepted a 996PC-style named archive');

  const pcModel = parse('996PC', [
    '<LoadingBar|id=NUMERIC_NAME|x=10|y=20|wil=1|pcloadingbg=100|pcloadingbar=101|startper=0|direction=0>',
  ]);
  const numericName = keyed(pcModel, 'NUMERIC_NAME');
  const references = assetReferences(numericName);
  assert.ok(references.length >= 2, '996PC numeric archive-name fixture lost its assets');
  assert.ok(references.every(reference => (
    reference.archiveName === '1' && reference.willIndex === undefined
  )), '996PC wil file name was reinterpreted as a GOM/GEE WIL index');
}

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

async function checkProviderSourceSafety() {
  const gom = parse('GOM', [
    '<&ProgressBar:10:20:1:620:<$STR(N$FILL)>:6:100:0:0:0:100:50:0:250:0:0:%p/%m:mixed>',
    '<&ProgressBar:10:50:1:700:710:3.5:100:0:0:0:100:50:0:250:0:0:%p/%m:invalid-count>',
    '<&ProgressBar:10:80:-1:-2:-3:4:100:0:0:0:100:50:0:250:0:0:%p/%m:invalid-assets>',
  ], ['MOV N$FILL 9001'], 'progress-provider-gom.txt');
  const pc = parse('996PC', [
    '<LoadingBar|id=MIX_LOAD|x=10|y=20|wil=NewopUI|pcloadingbg=100|pcloadingbar=<$STR(N$LOAD_FILL)>|startper=0|endper=100|maxper=100>',
    '<PercentImg|id=DYNAMIC_PERCENT|x=10|y=50|direction=0|wil=NewopUI|pcimg=<$STR(N$PERCENT_IMG)>|minValue=50|maxValue=100>',
    '<Slider|id=MIX_SLIDER|x=10|y=80|sliderid=N0|wil=NewopUI|pcbgimg=200|pcbarimg=<$STR(N$SLIDER_BAR)>|pcballimg=-1|maxvalue=100|defvalue=50>',
    '<LoadingBar|id=INVALID_LOAD|x=10|y=110|wil=NewopUI|pcloadingbg=-5|pcloadingbar=1.5|startper=-1|endper=101|maxper=0>',
  ], [
    'MOV N$LOAD_FILL 9002', 'MOV N$PERCENT_IMG 9003', 'MOV N$SLIDER_BAR 9004',
  ], 'progress-provider-pc.txt');

  const { __NpcDialogVisualEditorManager: Manager } = loadProviderInternals();
  assert.equal(typeof Manager, 'function');
  const manager = Object.create(Manager.prototype);
  const requests = [];
  manager.resolveAsset = reference => {
    requests.push({ ...reference });
    return { status: 'missing', archiveLabel: 'fixture/missing', message: 'fixture' };
  };
  manager.scriptDataResolver = {
    resolveItemFieldByIndex() { return undefined; },
    resolveItemFieldByName() { return undefined; },
  };
  await manager.hydrateAssets(gom, {}, { fileName: 'progress-provider-gom.txt' });
  await manager.hydrateAssets(pc, {}, { fileName: 'progress-provider-pc.txt' });

  const forbidden = requests.filter(reference => (
    [9001, 9002, 9003, 9004, 711, 712].includes(reference.imageIndex)
    || Number(reference.imageIndex) < 0
    || !Number.isInteger(reference.imageIndex)
    || Number(reference.willIndex) < 0
  ));
  assert.deepEqual(
    forbidden,
    [],
    `provider requested dynamic/invalid progress assets or expanded an invalid frame count: ${JSON.stringify(forbidden)}`
  );
  const requestedKeys = new Set(requests.map(reference => (
    `${reference.archiveName || ''}|${reference.willIndex ?? ''}|${reference.imageIndex}`
  )));
  assert.ok(requestedKeys.has('|1|620'), 'mixed legacy ProgressBar lost proven static background');
  assert.ok(requestedKeys.has('|1|700'), 'invalid-count ProgressBar lost proven static background');
  assert.ok(requestedKeys.has('|1|710'), 'invalid-count ProgressBar lost proven static fill');
  assert.ok(requestedKeys.has('NewopUI||100'), 'mixed LoadingBar lost proven static background');
  assert.ok(requestedKeys.has('NewopUI||200'), 'mixed Slider lost proven static background');

  // Re-inject references that a stale serialized model or future parser
  // regression could retain. Provider hydration must treat field diagnostics as
  // authoritative instead of trusting these plausible-looking positive values.
  const mixedLegacy = statement(gom, 'progress-bar', 0);
  mixedLegacy.assetLayers = [
    ...(mixedLegacy.assetLayers || []).filter(layer => layer.role !== 'progress'),
    { role: 'progress', assetRef: { willIndex: 1, imageIndex: 9001 } },
  ];
  const invalidCount = statement(gom, 'progress-bar', 1);
  const invalidCountFill = (invalidCount.assetLayers || [])
    .find(layer => layer.role === 'progress');
  assert.ok(invalidCountFill, 'invalid-count fixture lost its proven base fill');
  invalidCountFill.assetRef.frameCount = 3;
  invalidCount.progressPreview.frameCount = 3;
  const invalidLegacy = statement(gom, 'progress-bar', 2);
  invalidLegacy.assetRef = { willIndex: -1, imageIndex: -2 };
  invalidLegacy.assetLayers = [
    { role: 'background', assetRef: { willIndex: -1, imageIndex: -2 } },
    { role: 'progress', assetRef: { willIndex: -1, imageIndex: -3, frameCount: 4 } },
  ];

  const mixedLoading = keyed(pc, 'MIX_LOAD');
  mixedLoading.assetLayers = [
    ...(mixedLoading.assetLayers || []).filter(layer => layer.role !== 'progress'),
    { role: 'progress', assetRef: { archiveName: 'NewopUI', imageIndex: 9002 } },
  ];
  const dynamicPercent = keyed(pc, 'DYNAMIC_PERCENT');
  dynamicPercent.assetRef = { archiveName: 'NewopUI', imageIndex: 9003 };
  dynamicPercent.assetLayers = [
    { role: 'progress', assetRef: { archiveName: 'NewopUI', imageIndex: 9003 } },
  ];
  const mixedSlider = keyed(pc, 'MIX_SLIDER');
  mixedSlider.assetLayers = [
    ...(mixedSlider.assetLayers || []).filter(layer => !['progress', 'thumb'].includes(layer.role)),
    { role: 'progress', assetRef: { archiveName: 'NewopUI', imageIndex: 9004 } },
    { role: 'thumb', assetRef: { archiveName: 'NewopUI', imageIndex: -1 } },
  ];
  const invalidLoading = keyed(pc, 'INVALID_LOAD');
  invalidLoading.assetRef = { archiveName: 'NewopUI', imageIndex: -5 };
  invalidLoading.assetLayers = [
    { role: 'background', assetRef: { archiveName: 'NewopUI', imageIndex: -5 } },
    { role: 'progress', assetRef: { archiveName: 'NewopUI', imageIndex: 1.5 } },
  ];

  requests.length = 0;
  await manager.hydrateAssets(gom, {}, { fileName: 'progress-provider-stale-gom.txt' });
  await manager.hydrateAssets(pc, {}, { fileName: 'progress-provider-stale-pc.txt' });
  const staleForbidden = requests.filter(reference => (
    [9001, 9002, 9003, 9004, 711, 712].includes(reference.imageIndex)
    || Number(reference.imageIndex) < 0
    || !Number.isInteger(reference.imageIndex)
    || Number(reference.willIndex) < 0
  ));
  assert.deepEqual(
    staleForbidden,
    [],
    `provider trusted stale/dynamic/invalid progress references: ${JSON.stringify(staleForbidden)}`
  );
  const staleKeys = new Set(requests.map(reference => (
    `${reference.archiveName || ''}|${reference.willIndex ?? ''}|${reference.imageIndex}`
  )));
  for (const key of ['|1|620', '|1|700', '|1|710', 'NewopUI||100', 'NewopUI||200']) {
    assert.ok(staleKeys.has(key), `provider stale-model gate removed proven static asset ${key}`);
  }
  assert.equal(invalidCount.animationFrames, undefined,
    'invalid frame-count in a stale model must not create animation frames');
}

async function main() {
  const checks = [
    ['static-language evidence', checkStaticLanguageEvidence],
    ['GOM/GEE ProgressBar strict fields', checkLegacyProgressStrictness],
    ['996PC LoadingBar strict fields and completion', checkLoadingBarStrictnessAndCompletion],
    ['996PC PercentImg strict fields', checkPercentImgStrictness],
    ['996PC Slider strict fields and change action', checkSliderStrictnessAndChangeAction],
    ['countdown-family completion actions', checkCompletionActions],
    ['variable-carried progress source safety', checkVariableCarriedProgressSourceSafety],
    ['legacy ProgressBar archive isolation', checkLegacyProgressArchiveIsolation],
    ['provider source and invalid-asset safety', checkProviderSourceSafety],
  ];
  const failures = [];
  for (const [name, callback] of checks) {
    try {
      await callback();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error && error.message ? error.message : String(error)}`);
      console.error(`FAIL ${name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failures.length > 0) {
    console.error(`progress-strict-runtime.test.js: RED FAILURE MATRIX (${failures.length}/${checks.length})`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`progress-strict-runtime.test.js: PASS (${checks.length} checks)`);
}

void main();
