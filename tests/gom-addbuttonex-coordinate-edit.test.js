const assert = require('node:assert/strict');
const Module = require('node:module');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const {
  applyTextReplacements,
  buildDialogCoordinateEdits,
} = require('../out/ui-dialog/source-patcher');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

// Exact GOM ADDBUTTONEX statements from:
// D:\MirServer\Mir200\Envir\QuestDiary\02功能脚本\战力排行.txt
// The surrounding #IF/#ACT/#ELSEACT structure is retained because three
// physical button pairs intentionally share runtime positions while using
// different source spans and images.
const REAL_GOM_ADDBUTTONEX_SOURCE = [
  '[@查看装备]',
  '#IF',
  '#ACT',
  'QueryUserState <$STR(S$他人名字)>',
  'addbuttonex 10|70|410|0|0 1 3243|3243|3242 0 * * * -1 15',
  '#IF',
  '<$STR(S$他人名字)>.CHECK [731] 0',
  '#ACT',
  'addbuttonex 31|146|410|0|0 1 3244|3244|3244 0 * * * -1|未突破 15',
  '#ELSEACT',
  'addbuttonex 31|146|410|0|0 1 3245|3245|3244 0 * * * -1 15',
  '#IF',
  '<$STR(S$他人名字)>.CHECK [732] 0',
  '#ACT',
  'addbuttonex 32|222|410|0|0 1 3246|3246|3246 0 * * * -1|未突破 15',
  '#ELSEACT',
  'addbuttonex 32|222|410|0|0 1 3247|3247|3246 0 * * * -1 15',
  '#IF',
  '<$STR(S$他人名字)>.CHECK [733] 0',
  '#ACT',
  'addbuttonex 33|297|410|0|0 1 3248|3248|3248 0 * * * -1|未突破 15',
  '#ELSEACT',
  'addbuttonex 33|297|410|0|0 1 3249|3249|3248 0 * * * -1 15',
  '#SAY',
  '<返回/@main>',
].join('\r\n');

const DYNAMIC_AND_INVALID_SOURCE = [
  '[@main]',
  '#ACT',
  'MOV N$X 70',
  'MOV N$Y 410',
  'ADDBUTTONEX 40|<$STR(N$X)>|410|0|0 1 3243|3243|3242 0 * * * -1 15',
  'ADDBUTTONEX 41|70|<$STR(N$Y)>|0|0 1 3243|3243|3242 0 * * * -1 15',
  'ADDBUTTONEX 42||410|0|0 1 3243|3243|3242 0 * * * -1 15',
  'ADDBUTTONEX 43|abc|410|0|0 1 3243|3243|3242 0 * * * -1 15',
  'ADDBUTTONEX 44|70||0|0 1 3243|3243|3242 0 * * * -1 15',
  '#SAY',
  '<静态内容>',
].join('\r\n');

const GOM_LEGACY_LITERAL_SOURCE = [
  '[@main]',
  '#ACT',
  'ADDBUTTON 3 1 283 284 285 20 30 0|0 -1 253/旧按钮',
  '#SAY',
  '<静态内容>',
].join('\r\n');

const GEE_LEGACY_LITERAL_SOURCE = [
  '[@main]',
  '#ACT',
  'ADDBUTTON 3 101 283 284 285 110 160 33 地图按钮 251#地图提示',
  '#SAY',
  '<静态内容>',
].join('\r\n');

const GOM_LEGACY_DYNAMIC_SOURCE = [
  '[@main]',
  '#ACT',
  'MOV N$X 20',
  'ADDBUTTON 3 2 283 284 285 <$STR(N$X)> 30 0|0 -1 253/动态坐标',
  '#SAY',
  '<静态内容>',
].join('\r\n');

function parse(source, suffix = 'fixture', engine = 'GOM') {
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/gom-addbuttonex-${suffix}.txt`,
    fileName: `gom-addbuttonex-${suffix}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\gom-addbuttonex-${suffix}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine === 'GEE' ? 'LFM/GEE' : engine,
    cursorOffset: source.indexOf('[@') + 2,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });
}

function actionButtons(model) {
  const seen = new Set();
  const result = [];
  for (const element of (model.scenes || []).flatMap(scene => scene.elements || [])) {
    if (element.addButtonPreview?.command !== 'ADDBUTTONEX' || seen.has(element.id)) continue;
    seen.add(element.id);
    result.push(element);
  }
  return result.sort((left, right) => left.sourceRange.start - right.sourceRange.start);
}

function actionButton(model, command) {
  const seen = new Set();
  return (model.scenes || []).flatMap(scene => scene.elements || []).find(element => {
    if (seen.has(element.id)) return false;
    seen.add(element.id);
    return element.addButtonPreview?.command === command;
  });
}

function loadProviderWithVscodeStub() {
  const originalLoad = Module._load;
  const uri = value => ({
    fsPath: value,
    path: value,
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
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../out/providers/npc-dialog-visual');
  } finally {
    Module._load = originalLoad;
  }
}

function packedParts(raw) {
  return raw.split(/\s+/u)[1].split('|');
}

function assertCoordinateSpan(source, coordinate, expected) {
  assert.ok(coordinate, `missing coordinate ${expected}`);
  assert.equal(coordinate.sourceValue, Number(expected));
  assert.equal(coordinate.displayValue, Number(expected));
  assert.equal(coordinate.span.original, expected);
  assert.equal(source.slice(coordinate.span.start, coordinate.span.end), expected);
}

const failures = [];
function check(name, callback) {
  try {
    callback();
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : String(error)}`);
  }
}

const model = parse(REAL_GOM_ADDBUTTONEX_SOURCE, 'real-seven');
const buttons = actionButtons(model);

check('all seven physical GOM ADDBUTTONEX statements remain modeled', () => {
  assert.equal(buttons.length, 7);
  assert.deepEqual(buttons.map(button => button.addButtonPreview.triggerId), [10, 31, 31, 32, 32, 33, 33]);
});

check('group=0 is a valid no-group sentinel', () => {
  for (const button of buttons) {
    assert.equal(button.addButtonPreview.groupId, undefined, button.raw);
    assert.ok(!button.addButtonPreview.invalidFields.includes('group'), button.raw);
  }
});

check('three star effect arguments are valid empty effect slots', () => {
  for (const button of buttons) {
    assert.deepEqual(button.addButtonPreview.effects || [], [], button.raw);
    assert.ok(
      !(button.addButtonPreview.invalidFields || []).some(field => /effect/i.test(field)),
      `${button.raw}: ${button.addButtonPreview.invalidFields.join(',')}`
    );
  }
});

check('real no-effect buttons are not invalid and retain main three-state assets', () => {
  for (const button of buttons) {
    assert.equal(button.addButtonPreview.status, 'partial-simulation', button.raw);
    assert.deepEqual(button.addButtonPreview.invalidFields, [], button.raw);
    const [, , archive, images] = button.raw.split(/\s+/u);
    const [normal, hover, pressed] = images.split('|').map(Number);
    assert.deepEqual(button.assetRef, { willIndex: Number(archive), imageIndex: normal }, button.raw);
    assert.deepEqual(
      (button.assetLayers || []).map(layer => [layer.role, layer.assetRef]),
      [
        ['hover', { willIndex: Number(archive), imageIndex: hover }],
        ['pressed', { willIndex: Number(archive), imageIndex: pressed }],
      ],
      button.raw
    );
  }
});

check('packed X/Y receive exact independent source spans and are editable', () => {
  for (const button of buttons) {
    const [, expectedX, expectedY] = packedParts(button.raw);
    assertCoordinateSpan(REAL_GOM_ADDBUTTONEX_SOURCE, button.x, expectedX);
    assertCoordinateSpan(REAL_GOM_ADDBUTTONEX_SOURCE, button.y, expectedY);
    assert.notDeepEqual(
      [button.x.span.start, button.x.span.end],
      [button.y.span.start, button.y.span.end],
      button.raw
    );
    assert.equal(button.editable, true, button.raw);
    assert.equal(button.coordinateMode, 'absolute', button.raw);
  }
});

check('editing one button changes only packed part 2 and part 3', () => {
  const button = buttons[0];
  const result = buildDialogCoordinateEdits(REAL_GOM_ADDBUTTONEX_SOURCE, model, [{
    elementId: button.id,
    x: 90,
    y: 420,
  }]);
  assert.equal(result.changedElements, 1);
  assert.deepEqual(
    [...result.replacements]
      .sort((left, right) => left.start - right.start)
      .map(replacement => ({
        axis: replacement.axis,
        original: REAL_GOM_ADDBUTTONEX_SOURCE.slice(replacement.start, replacement.end),
        text: replacement.text,
      })),
    [
      { axis: 'x', original: '70', text: '90' },
      { axis: 'y', original: '410', text: '420' },
    ]
  );
  const patched = applyTextReplacements(REAL_GOM_ADDBUTTONEX_SOURCE, result.replacements);
  const expected = REAL_GOM_ADDBUTTONEX_SOURCE.replace(
    'addbuttonex 10|70|410|0|0 1 3243|3243|3242 0 * * * -1 15',
    'addbuttonex 10|90|420|0|0 1 3243|3243|3242 0 * * * -1 15'
  );
  assert.equal(patched, expected);
});

check('identical packed values on different physical lines keep distinct absolute spans', () => {
  for (const triggerId of [31, 32, 33]) {
    const pair = buttons.filter(button => button.addButtonPreview.triggerId === triggerId);
    assert.equal(pair.length, 2);
    assert.equal(pair[0].raw.split(/\s+/u)[1], pair[1].raw.split(/\s+/u)[1]);
    assert.notEqual(pair[0].x.span.start, pair[1].x.span.start);
    assert.notEqual(pair[0].y.span.start, pair[1].y.span.start);
  }
});

check('dynamic and malformed packed coordinates remain read-only without MOV borrowing', () => {
  const unsafeModel = parse(DYNAMIC_AND_INVALID_SOURCE, 'unsafe');
  const unsafe = actionButtons(unsafeModel);
  assert.equal(unsafe.length, 5);
  for (const button of unsafe) {
    assert.equal(button.editable, false, button.raw);
    assert.throws(
      () => buildDialogCoordinateEdits(DYNAMIC_AND_INVALID_SOURCE, unsafeModel, [{
        elementId: button.id,
        x: 90,
        y: 420,
      }]),
      /坐标不是可安全修改的直接数值/
    );
  }
  const dynamicX = unsafe.find(button => button.addButtonPreview.triggerId === 40);
  const dynamicY = unsafe.find(button => button.addButtonPreview.triggerId === 41);
  assert.ok(dynamicX.addButtonPreview.dynamicFields.includes('x'));
  assert.ok(dynamicY.addButtonPreview.dynamicFields.includes('y'));
  assert.notEqual(dynamicX.x?.sourceValue, 70, 'dynamic X borrowed MOV N$X=70');
  assert.notEqual(dynamicY.y?.sourceValue, 410, 'dynamic Y borrowed MOV N$Y=410');
});

check('static main assets reach the provider while star effects request nothing', () => {
  const { hydrateAddButtonAssets } = loadProviderWithVscodeStub();
  const requested = [];
  hydrateAddButtonAssets(model, reference => {
    requested.push({ ...reference });
    return {
      status: 'ready',
      url: `vscode-resource:/gom-addbuttonex/${reference.willIndex}-${reference.imageIndex}.png`,
      archiveLabel: `${reference.willIndex}/${reference.imageIndex}`,
      width: 48,
      height: 24,
      offsetX: 0,
      offsetY: 0,
    };
  });
  for (const button of buttons) {
    assert.equal(button.asset?.status, 'ready', button.raw);
    assert.ok((button.assetLayers || []).every(layer => layer.asset?.status === 'ready'), button.raw);
    assert.deepEqual(button.addButtonPreview.effects || [], [], button.raw);
  }
  assert.deepEqual(
    [...new Set(requested.map(reference => `${reference.willIndex}:${reference.imageIndex}`))].sort(),
    Array.from({ length: 8 }, (_, index) => `1:${3242 + index}`)
  );
});

check('GOM and GEE legacy ADDBUTTON literal X/Y spans are independently editable', () => {
  const fixtures = [
    {
      engine: 'GOM',
      source: GOM_LEGACY_LITERAL_SOURCE,
      suffix: 'gom-legacy-literal',
      x: '20',
      y: '30',
      nextX: 25,
      nextY: 35,
      expected: 'ADDBUTTON 3 1 283 284 285 25 35 0|0 -1 253/旧按钮',
    },
    {
      engine: 'GEE',
      source: GEE_LEGACY_LITERAL_SOURCE,
      suffix: 'gee-legacy-literal',
      x: '110',
      y: '160',
      nextX: 115,
      nextY: 165,
      expected: 'ADDBUTTON 3 101 283 284 285 115 165 33 地图按钮 251#地图提示',
    },
  ];
  for (const fixture of fixtures) {
    const legacyModel = parse(fixture.source, fixture.suffix, fixture.engine);
    const button = actionButton(legacyModel, 'ADDBUTTON');
    assert.ok(button, `${fixture.engine} legacy button missing`);
    assert.equal(button.editable, true, `${fixture.engine} literal #ACT coordinates are locked`);
    assertCoordinateSpan(fixture.source, button.x, fixture.x);
    assertCoordinateSpan(fixture.source, button.y, fixture.y);
    const edits = buildDialogCoordinateEdits(fixture.source, legacyModel, [{
      elementId: button.id,
      x: fixture.nextX,
      y: fixture.nextY,
    }]);
    const patched = applyTextReplacements(fixture.source, edits.replacements);
    assert.ok(patched.includes(fixture.expected), patched);
  }
});

check('legacy ADDBUTTON dynamic X remains read-only and never borrows MOV', () => {
  const dynamicModel = parse(GOM_LEGACY_DYNAMIC_SOURCE, 'gom-legacy-dynamic');
  const button = actionButton(dynamicModel, 'ADDBUTTON');
  assert.ok(button);
  assert.equal(button.editable, false);
  assert.ok(button.addButtonPreview.dynamicFields.includes('x'));
  assert.notEqual(button.x?.sourceValue, 20);
  assert.throws(
    () => buildDialogCoordinateEdits(GOM_LEGACY_DYNAMIC_SOURCE, dynamicModel, [{
      elementId: button.id,
      x: 25,
      y: 35,
    }]),
    /坐标不是可安全修改的直接数值/
  );
});

check('external companion guard remains authoritative even for an editable clone', () => {
  const button = buttons[0];
  const external = {
    ...button,
    id: `${button.id}:external`,
    editable: true,
    sourceFilePath: 'D:\\MirServer\\Mir200\\Envir\\Market_Def\\QFunction-0.txt',
    sourceUri: 'file:///D:/MirServer/Mir200/Envir/Market_Def/QFunction-0.txt',
  };
  const externalModel = {
    ...model,
    scenes: [{ ...model.scenes[0], elements: [external] }],
  };
  assert.throws(
    () => buildDialogCoordinateEdits(REAL_GOM_ADDBUTTONEX_SOURCE, externalModel, [{
      elementId: external.id,
      x: 90,
      y: 420,
    }]),
    /外部 QFunction companion.*只读预览/
  );
});

if (failures.length > 0) {
  console.error('gom-addbuttonex-coordinate-edit.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('gom-addbuttonex-coordinate-edit.test.js: PASS');
}
