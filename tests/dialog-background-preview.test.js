const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');

const staticLanguage = require('../data/static-language.json');
const commandCatalog = require('../data/commands.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

/*
 * Primary-source evidence for this red test (all files were decompiled from the
 * local CHM snapshots in D:\0帮助 on 2026-08-29):
 *
 * GOM 打开NPC大对话框[!].htm
 * SHA-256 688285A6DBED7962AB4C9CE2D060BDB38DC650BDFB87B18CA220ED80F879B1D9
 * - OPENMERCHANTBIGDLG argument 2 may be `3|1|400|300`: image 3,
 *   nine-grid enabled, target width 400 and target height 300 (added
 *   2025-12-04).
 * - arguments 3..10 are movable, screen position 0..4, offset X/Y, close
 *   visibility, close X/Y and independent-window.
 *
 * GEE 打开NPC大对话框[!].htm
 * SHA-256 96744147A66601D0165BEB7F88E8272F6AB6F1E29D08BBB1AC009F34C76AD0EB
 * - the same ten positional slots are documented, but argument 10 means that
 *   subsequent dialogs of the current NPC continue to use this background;
 *   it is not GOM's independent-window flag.
 *
 * GEE 打开自定义NPC对话框.htm
 * SHA-256 076653C160C1266F2BD51D133F6DE9E2C437FAA5AE9881759890C2C77DFFF120
 * - OpenBigDialogBox has nine arguments: WIL, image, movable, position,
 *   offset X/Y, close visibility and close X/Y.
 *
 * GOM / 996PC 打开自定义NPC对话框[!].htm
 * SHA-256 6ED639BFC7B09BB53543B1520D691C9F2ED47A651BB4F9D6748EE822C7FB33BC
 * SHA-256 891988E12E77B9930F3915F374FD7335E8F2A4831CAB8C70A65B35A08E35B304
 * - OpenBigDialogBox has exactly WIL and image arguments.
 *
 * Close lifecycle evidence is engine specific. GOM/GEE publish
 * CLOSEMERCHANTBIGDLG for OPENMERCHANTBIGDLG and CloseBigDialogBox for
 * OpenBigDialogBox. The 996PC OPENMERCHANTBIGDLG page explicitly names
 * CloseBigDialogBox as its close command. The visualizer must model these
 * commands as a lifecycle boundary only; it must never execute client actions.
 */

const FULL_RUNTIME_FIELDS = [
  'movable',
  'position',
  'offset-x',
  'offset-y',
  'show-close',
  'close-x',
  'close-y',
];

function parse(engine, source, cursorNeedle = '#SAY') {
  const cursorOffset = Math.max(0, source.indexOf(cursorNeedle) + cursorNeedle.length);
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/dialog-background-redtest.txt',
    fileName: 'dialog-background-redtest.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\dialog-background-redtest.txt',
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function parseAct(engine, actLines, say = '测试') {
  const source = [
    '[@main]',
    '#ACT',
    ...actLines,
    '#SAY',
    say,
  ].join('\n');
  return parse(engine, source).pages[0]?.background;
}

function fieldSet(value) {
  return new Set(Array.isArray(value) ? value : []);
}

function requireFields(actual, expected, message) {
  const values = fieldSet(actual);
  const missing = expected.filter(field => !values.has(field));
  assert.deepEqual(missing, [], `${message}; missing=${missing.join(',')}; actual=${JSON.stringify(actual)}`);
}

function visibleBoundary(background) {
  return [background?.warning, ...(background?.warnings || [])].filter(Boolean).join('；');
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

function collectFailures() {
  const failures = [];
  const check = (name, callback) => {
    try {
      callback();
    } catch (error) {
      failures.push(`${name}: ${error && error.message ? error.message : String(error)}`);
    }
  };

  const gomNineGrid = parseAct('GOM', [
    'OPENMERCHANTBIGDLG 5 3|1|400|300 1 4 10 -20 1 190 8 1',
  ]);
  const geeMerchant = parseAct('GEE', [
    'OPENMERCHANTBIGDLG 176 19 1 3 10 70 1 190 8 1',
  ]);
  const pcMerchant = parseAct('996PC', [
    'OPENMERCHANTBIGDLG 3 607 0 1 1 1 1 431 40 1',
  ]);
  const gomOpenBig = parseAct('GOM', ['OpenBigDialogBox 16 109']);
  const geeOpenBig = parseAct('GEE', ['OpenBigDialogBox 8 109 1 4 0 0 1 530 0']);
  const pcOpenBig = parseAct('996PC', ['OpenBigDialogBox 16 109']);
  const gomMissingOptionalGeometry = parseAct('GOM', [
    'OPENMERCHANTBIGDLG 1 3262 1 4',
  ]);
  const gomDynamicMovable = parseAct('GOM', [
    'MOV N$MOVE 1',
    'OPENMERCHANTBIGDLG 1 3262 <$STR(N$MOVE)> 4 0 0 1 190 8 1',
  ]);
  const gomInvalidCloseSwitch = parseAct('GOM', [
    'OPENMERCHANTBIGDLG 1 3262 1 4 0 0 2 190 8 1',
  ]);
  const gomDynamicNineGridWidth = parseAct('GOM', [
    'MOV N$WIDTH 400',
    'OPENMERCHANTBIGDLG 5 3|1|<$STR(N$WIDTH)>|300 1 4 10 20 1 190 8 1',
  ]);
  const gomDynamicNineGridHeight = parseAct('GOM', [
    'MOV N$HEIGHT 300',
    'OPENMERCHANTBIGDLG 5 3|1|400|<$STR(N$HEIGHT)> 1 4 10 20 1 190 8 1',
  ]);
  const gomDynamicNineGridEnabled = parseAct('GOM', [
    'MOV N$ENABLED 1',
    'OPENMERCHANTBIGDLG 5 3|<$STR(N$ENABLED)>|400|300 1 4 10 20 1 190 8 1',
  ]);
  const gomDynamicNineGridImage = parseAct('GOM', [
    'MOV N$IMAGE 3',
    'OPENMERCHANTBIGDLG 5 <$STR(N$IMAGE)>|1|400|300 1 4 10 20 1 190 8 1',
  ]);

  check('execution-command catalog exposes the evidenced engine contracts', () => {
    const merchant = commandCatalog.execCommands.find(command => (
      String(command.name).toUpperCase() === 'OPENMERCHANTBIGDLG'
    ));
    const openBig = commandCatalog.execCommands.find(command => (
      String(command.name).toUpperCase() === 'OPENBIGDIALOGBOX'
    ));
    assert.ok(merchant && openBig, 'background commands missing from data/commands.json');
    const gomMerchantText = [
      merchant.engineVariants?.GOM?.syntax,
      ...(merchant.engineVariants?.GOM?.params || []),
      merchant.engineVariants?.GOM?.description,
    ].join(' ');
    assert.match(gomMerchantText, /九宫格/,
      'GOM command catalog still hides the documented image|1|width|height form');
    assert.match(gomMerchantText, /独立窗口/);
    assert.match([
      merchant.engineVariants?.GEE?.syntax,
      ...(merchant.engineVariants?.GEE?.params || []),
      merchant.engineVariants?.GEE?.description,
    ].join(' '), /延续使用|沿用/);
    assert.equal(openBig.engineVariants?.GOM?.params?.length, 2);
    assert.equal(openBig.engineVariants?.GEE?.params?.length, 9);
    assert.equal(openBig.engineVariants?.['996PC']?.params?.length, 2);
  });

  check('GOM nine-grid OPENMERCHANTBIGDLG retains full typed semantics', () => {
    assert.ok(gomNineGrid, 'GOM nine-grid background was not modeled');
    assert.equal(gomNineGrid.command, 'OPENMERCHANTBIGDLG');
    assert.equal(gomNineGrid.status, 'static');
    assert.deepEqual(gomNineGrid.assetRef, { willIndex: 5, imageIndex: 3 });
    assert.deepEqual({
      willIndex: gomNineGrid.willIndex,
      imageIndex: gomNineGrid.imageIndex,
      movable: gomNineGrid.movable,
      position: gomNineGrid.position,
      offsetX: gomNineGrid.offsetX,
      offsetY: gomNineGrid.offsetY,
      showCloseButton: gomNineGrid.showCloseButton,
      closeButtonX: gomNineGrid.closeButtonX,
      closeButtonY: gomNineGrid.closeButtonY,
      independentWindow: gomNineGrid.independentWindow,
      continueUse: gomNineGrid.continueUse,
      runtimeScope: gomNineGrid.runtimeScope,
    }, {
      willIndex: 5,
      imageIndex: 3,
      movable: true,
      position: 4,
      offsetX: 10,
      offsetY: -20,
      showCloseButton: true,
      closeButtonX: 190,
      closeButtonY: 8,
      independentWindow: true,
      continueUse: undefined,
      runtimeScope: 'local-only',
    });
    assert.deepEqual(gomNineGrid.nineGrid, {
      enabled: true,
      targetWidth: 400,
      targetHeight: 300,
      rendering: 'partial-simulation',
    });
    assert.match(visibleBoundary(gomNineGrid), /Partial simulation/i);
    assert.match(visibleBoundary(gomNineGrid), /九宫格/);
  });

  check('omitted optional placement values keep documented zero defaults', () => {
    assert.ok(gomMissingOptionalGeometry, 'short OPENMERCHANTBIGDLG was not modeled');
    assert.equal(gomMissingOptionalGeometry.status, 'static');
    assert.deepEqual({
      position: gomMissingOptionalGeometry.position,
      offsetX: gomMissingOptionalGeometry.offsetX,
      offsetY: gomMissingOptionalGeometry.offsetY,
    }, {
      position: 4,
      offsetX: 0,
      offsetY: 0,
    }, 'omitted offsets must not turn the dialog-local 0,0 origin into an unknown canvas origin');
    assert.deepEqual(gomMissingOptionalGeometry.assetRef, { willIndex: 1, imageIndex: 3262 });
  });

  check('non-resource runtime fields never suppress a statically known background image', () => {
    assert.ok(gomDynamicMovable && gomInvalidCloseSwitch);
    assert.equal(gomDynamicMovable.status, 'dynamic');
    assert.deepEqual(gomDynamicMovable.assetRef, { willIndex: 1, imageIndex: 3262 });
    requireFields(gomDynamicMovable.dynamicFields, ['movable'], 'dynamic movable field');
    assert.equal(gomInvalidCloseSwitch.status, 'invalid');
    assert.deepEqual(gomInvalidCloseSwitch.assetRef, { willIndex: 1, imageIndex: 3262 });
    requireFields(gomInvalidCloseSwitch.invalidFields, ['show-close'], 'invalid close switch');
    assert.match(visibleBoundary(gomDynamicMovable), /仍.*(?:素材|背景)|(?:素材|背景).*仍/);
    assert.match(visibleBoundary(gomInvalidCloseSwitch), /仍.*(?:素材|背景)|(?:素材|背景).*仍/);
  });

  check('GOM nine-grid subfields are classified independently', () => {
    for (const [label, background, dynamicField, expectedNineGrid] of [
      ['width', gomDynamicNineGridWidth, 'nine-grid-width', { enabled: true, targetHeight: 300 }],
      ['height', gomDynamicNineGridHeight, 'nine-grid-height', { enabled: true, targetWidth: 400 }],
      ['enabled', gomDynamicNineGridEnabled, 'nine-grid-enabled', { targetWidth: 400, targetHeight: 300 }],
    ]) {
      assert.ok(background, `${label} background missing`);
      assert.equal(background.status, 'dynamic', `${label} status`);
      assert.deepEqual(background.assetRef, { willIndex: 5, imageIndex: 3 },
        `${label} uncertainty discarded the independent static image source`);
      requireFields(background.dynamicFields, [dynamicField], `${label} dynamic field`);
      assert.deepEqual({
        ...(background.nineGrid.enabled === true ? { enabled: true } : {}),
        ...(background.nineGrid.targetWidth !== undefined
          ? { targetWidth: background.nineGrid.targetWidth } : {}),
        ...(background.nineGrid.targetHeight !== undefined
          ? { targetHeight: background.nineGrid.targetHeight } : {}),
      }, expectedNineGrid, `${label} borrowed or erased a sibling nine-grid field`);
    }
    assert.ok(gomDynamicNineGridImage);
    assert.equal(gomDynamicNineGridImage.status, 'dynamic');
    assert.equal(gomDynamicNineGridImage.assetRef, undefined,
      'a dynamic image subfield must still block the resource request');
    requireFields(gomDynamicNineGridImage.dynamicFields, ['image-index'], 'dynamic image subfield');
    assert.deepEqual({
      enabled: gomDynamicNineGridImage.nineGrid.enabled,
      targetWidth: gomDynamicNineGridImage.nineGrid.targetWidth,
      targetHeight: gomDynamicNineGridImage.nineGrid.targetHeight,
    }, { enabled: true, targetWidth: 400, targetHeight: 300 },
    'a dynamic image must not erase independently static nine-grid geometry');
  });

  check('GEE merchant tail is continue-use rather than GOM independent-window', () => {
    assert.ok(geeMerchant, 'GEE merchant background was not modeled');
    assert.equal(geeMerchant.command, 'OPENMERCHANTBIGDLG');
    assert.equal(geeMerchant.status, 'static');
    assert.deepEqual(geeMerchant.assetRef, { willIndex: 176, imageIndex: 19 });
    assert.deepEqual({
      movable: geeMerchant.movable,
      position: geeMerchant.position,
      offsetX: geeMerchant.offsetX,
      offsetY: geeMerchant.offsetY,
      showCloseButton: geeMerchant.showCloseButton,
      closeButtonX: geeMerchant.closeButtonX,
      closeButtonY: geeMerchant.closeButtonY,
      independentWindow: geeMerchant.independentWindow,
      continueUse: geeMerchant.continueUse,
      runtimeScope: geeMerchant.runtimeScope,
    }, {
      movable: true,
      position: 3,
      offsetX: 10,
      offsetY: 70,
      showCloseButton: true,
      closeButtonX: 190,
      closeButtonY: 8,
      independentWindow: undefined,
      continueUse: true,
      runtimeScope: 'local-only',
    });
  });

  check('996PC merchant tail remains independent-window and never inherits GEE semantics', () => {
    assert.ok(pcMerchant, '996PC merchant background was not modeled');
    assert.equal(pcMerchant.command, 'OPENMERCHANTBIGDLG');
    assert.equal(pcMerchant.independentWindow, true);
    assert.equal(pcMerchant.continueUse, undefined);
    assert.deepEqual(pcMerchant.assetRef, { willIndex: 3, imageIndex: 607 });
  });

  check('OpenBigDialogBox follows each engine own-help grammar', () => {
    for (const [engine, background, reference] of [
      ['GOM', gomOpenBig, { willIndex: 16, imageIndex: 109 }],
      ['996PC', pcOpenBig, { willIndex: 16, imageIndex: 109 }],
    ]) {
      assert.ok(background, `${engine} OpenBigDialogBox was not modeled`);
      assert.equal(background.command, 'OPENBIGDIALOGBOX', `${engine} command`);
      assert.equal(background.status, 'static', `${engine} status`);
      assert.deepEqual(background.assetRef, reference, `${engine} asset`);
      assert.equal(background.movable, undefined, `${engine} must not invent GEE movable`);
      assert.equal(background.position, undefined, `${engine} must not invent GEE position`);
      assert.equal(background.independentWindow, undefined, `${engine} must not invent a tail`);
      assert.equal(background.continueUse, undefined, `${engine} must not invent a tail`);
    }

    assert.ok(geeOpenBig, 'GEE OpenBigDialogBox was not modeled');
    assert.equal(geeOpenBig.command, 'OPENBIGDIALOGBOX');
    assert.equal(geeOpenBig.status, 'static');
    assert.deepEqual(geeOpenBig.assetRef, { willIndex: 8, imageIndex: 109 });
    assert.deepEqual({
      movable: geeOpenBig.movable,
      position: geeOpenBig.position,
      offsetX: geeOpenBig.offsetX,
      offsetY: geeOpenBig.offsetY,
      showCloseButton: geeOpenBig.showCloseButton,
      closeButtonX: geeOpenBig.closeButtonX,
      closeButtonY: geeOpenBig.closeButtonY,
    }, {
      movable: true,
      position: 4,
      offsetX: 0,
      offsetY: 0,
      showCloseButton: true,
      closeButtonX: 530,
      closeButtonY: 0,
    });
    assert.equal(geeOpenBig.independentWindow, undefined);
    assert.equal(geeOpenBig.continueUse, undefined);
  });

  const dynamicMovs = [
    'MOV N$BG_WIL 5',
    'MOV N$BG_IMAGE 3',
    'MOV N$BG_MOVE 1',
    'MOV N$BG_POSITION 4',
    'MOV N$BG_X 10',
    'MOV N$BG_Y -20',
    'MOV N$BG_CLOSE 1',
    'MOV N$BG_CLOSE_X 190',
    'MOV N$BG_CLOSE_Y 8',
    'MOV N$BG_TAIL 1',
  ];
  const dynamicGom = parseAct('GOM', [
    ...dynamicMovs,
    'OPENMERCHANTBIGDLG <$STR(N$BG_WIL)> <$STR(N$BG_IMAGE)> '
      + '<$STR(N$BG_MOVE)> <$STR(N$BG_POSITION)> <$STR(N$BG_X)> <$STR(N$BG_Y)> '
      + '<$STR(N$BG_CLOSE)> <$STR(N$BG_CLOSE_X)> <$STR(N$BG_CLOSE_Y)> <$STR(N$BG_TAIL)>',
  ]);
  const dynamicGeeOpenBig = parseAct('GEE', [
    ...dynamicMovs,
    'OpenBigDialogBox <$STR(N$BG_WIL)> <$STR(N$BG_IMAGE)> '
      + '<$STR(N$BG_MOVE)> <$STR(N$BG_POSITION)> <$STR(N$BG_X)> <$STR(N$BG_Y)> '
      + '<$STR(N$BG_CLOSE)> <$STR(N$BG_CLOSE_X)> <$STR(N$BG_CLOSE_Y)>',
  ]);

  check('dynamic source fields never borrow MOV values', () => {
    assert.ok(dynamicGom && dynamicGeeOpenBig, 'dynamic commands were discarded rather than typed');
    for (const [label, background, tailField] of [
      ['GOM merchant', dynamicGom, 'independent-window'],
      ['GEE OpenBig', dynamicGeeOpenBig, undefined],
    ]) {
      assert.equal(background.status, 'dynamic', `${label} status`);
      assert.equal(background.assetRef, undefined, `${label} must not request a MOV-derived asset`);
      assert.equal(background.willIndex, undefined, `${label} borrowed MOV WIL`);
      assert.equal(background.imageIndex, undefined, `${label} borrowed MOV image`);
      for (const property of [
        'movable', 'position', 'offsetX', 'offsetY', 'showCloseButton',
        'closeButtonX', 'closeButtonY', 'independentWindow', 'continueUse',
      ]) {
        assert.equal(background[property], undefined, `${label} borrowed ${property}`);
      }
      requireFields(
        background.dynamicFields,
        ['will-index', 'image-index', ...FULL_RUNTIME_FIELDS, ...(tailField ? [tailField] : [])],
        `${label} dynamic classification`
      );
      assert.match(background.raw, /<\$STR\(/i, `${label} lost source expression`);
      assert.match(visibleBoundary(background), /不借用.*MOV|MOV.*不借用|不借用.*当前值/);
    }
  });

  const invalidGom = parseAct('GOM', [
    'OPENMERCHANTBIGDLG -1 nope 2 5 1.5 bad -1 x q 2',
  ]);
  const invalidNineGrid = parseAct('GOM', [
    'OPENMERCHANTBIGDLG 5 3|1|0|300 1 4 10 -20 1 190 8 1',
  ]);
  const geeFakeNineGrid = parseAct('GEE', [
    'OPENMERCHANTBIGDLG 5 3|1|400|300 1 4 10 -20 1 190 8 1',
  ]);
  const invalidPcOpenBig = parseAct('996PC', ['OpenBigDialogBox -1 nope']);

  check('invalid fields are rejected without clamp, coercion, or cross-engine nine-grid guessing', () => {
    assert.ok(invalidGom && invalidNineGrid && geeFakeNineGrid && invalidPcOpenBig,
      'invalid commands must remain visible as typed diagnostics');
    assert.equal(invalidGom.status, 'invalid');
    assert.equal(invalidGom.assetRef, undefined);
    requireFields(invalidGom.invalidFields, [
      'will-index', 'image-index', ...FULL_RUNTIME_FIELDS, 'independent-window',
    ], 'invalid GOM fields');
    assert.equal(invalidNineGrid.status, 'invalid');
    assert.deepEqual(invalidNineGrid.assetRef, { willIndex: 5, imageIndex: 3 },
      'an invalid non-resource dimension must not block a statically known source image');
    requireFields(invalidNineGrid.invalidFields, ['nine-grid-width'], 'invalid GOM nine-grid width');
    assert.equal(geeFakeNineGrid.status, 'invalid');
    assert.equal(geeFakeNineGrid.assetRef, undefined,
      'GOM-only nine-grid syntax must not reach the GEE provider');
    requireFields(geeFakeNineGrid.invalidFields, ['image-index'], 'GEE fake nine-grid image');
    assert.equal(geeFakeNineGrid.nineGrid, undefined, 'GEE must not guess GOM nine-grid support');
    assert.equal(invalidPcOpenBig.status, 'invalid');
    assert.equal(invalidPcOpenBig.assetRef, undefined);
    requireFields(invalidPcOpenBig.invalidFields, ['will-index', 'image-index'], '996PC invalid OpenBig');
  });

  check('matching close commands terminate only their documented lifecycle', () => {
    const gomMerchantClosed = parseAct('GOM', [
      'OPENMERCHANTBIGDLG 3 607 1 4 0 0 1 190 8 1',
      'CLOSEMERCHANTBIGDLG',
    ]);
    const geeMerchantClosed = parseAct('GEE', [
      'OPENMERCHANTBIGDLG 176 19 1 4 0 0 1 190 8 1',
      'CLOSEMERCHANTBIGDLG',
    ]);
    const gomOpenBigClosed = parseAct('GOM', [
      'OpenBigDialogBox 16 109',
      'CloseBigDialogBox',
    ]);
    const geeOpenBigClosed = parseAct('GEE', [
      'OpenBigDialogBox 8 109 1 4 0 0 1 530 0',
      'CloseBigDialogBox',
    ]);
    const pcMerchantClosed = parseAct('996PC', [
      'OPENMERCHANTBIGDLG 3 607 1 4 0 0 1 190 8 1',
      'CloseBigDialogBox',
    ]);
    const pcOpenBigClosed = parseAct('996PC', [
      'OpenBigDialogBox 16 109',
      'CloseBigDialogBox',
    ]);
    assert.equal(gomMerchantClosed, undefined, 'GOM CLOSEMERCHANTBIGDLG did not close merchant background');
    assert.equal(geeMerchantClosed, undefined, 'GEE CLOSEMERCHANTBIGDLG did not close merchant background');
    assert.equal(gomOpenBigClosed, undefined, 'GOM CloseBigDialogBox did not close OpenBig background');
    assert.equal(geeOpenBigClosed, undefined, 'GEE CloseBigDialogBox did not close OpenBig background');
    assert.equal(pcMerchantClosed, undefined,
      '996PC own help names CloseBigDialogBox as the merchant-background close command');
    assert.equal(pcOpenBigClosed, undefined, '996PC CloseBigDialogBox did not close OpenBig background');

    const gomDifferentLifecycle = parseAct('GOM', [
      'OPENMERCHANTBIGDLG 3 607 1 4 0 0 1 190 8 1',
      'CloseBigDialogBox',
    ]);
    assert.equal(gomDifferentLifecycle?.command, 'OPENMERCHANTBIGDLG',
      'GOM CloseBigDialogBox must not be guessed as CLOSEMERCHANTBIGDLG');

    const reopened = parseAct('GOM', [
      'OPENMERCHANTBIGDLG 3 607 1 4 0 0 1 190 8 1',
      'CLOSEMERCHANTBIGDLG',
      'OPENMERCHANTBIGDLG 4 700 0 0 5 6 0 0 0 0',
    ]);
    assert.deepEqual(reopened?.assetRef, { willIndex: 4, imageIndex: 700 },
      'a later static open must start a new lifecycle');
  });

  check('background provider requests only complete static sources and is integrated', () => {
    const provider = loadProviderWithVscodeStub();
    assert.equal(typeof provider.hydrateDialogBackgroundAssets, 'function',
      'provider must expose a focused background hydration primitive');

    const first = {
      command: 'OPENMERCHANTBIGDLG', status: 'static',
      willIndex: 5, imageIndex: 3,
      assetRef: { willIndex: 99, imageIndex: 99 },
    };
    const duplicate = {
      command: 'OPENMERCHANTBIGDLG', status: 'static',
      willIndex: 5, imageIndex: 3,
      assetRef: { willIndex: 98, imageIndex: 98 },
    };
    const openBig = {
      command: 'OPENBIGDIALOGBOX', status: 'static',
      willIndex: 8, imageIndex: 109,
      assetRef: { willIndex: 97, imageIndex: 97 },
    };
    // Deliberately include stale/corrupt references. The status gate must be
    // independent of parser correctness so a dynamic MOV value can never leak
    // to the workspace resolver after model serialization or future refactors.
    const dynamic = {
      command: 'OPENMERCHANTBIGDLG', status: 'dynamic',
      willIndex: 99, imageIndex: 98,
      assetRef: { willIndex: 99, imageIndex: 98 },
      dynamicFields: ['will-index', 'image-index'],
    };
    const invalid = {
      command: 'OPENBIGDIALOGBOX', status: 'invalid',
      willIndex: 97, imageIndex: 96,
      assetRef: { willIndex: 97, imageIndex: 96 },
      invalidFields: ['will-index', 'image-index'],
    };
    const dynamicRuntimeOnly = {
      command: 'OPENMERCHANTBIGDLG', status: 'dynamic',
      willIndex: 6, imageIndex: 10,
      assetRef: { willIndex: 66, imageIndex: 100 },
      dynamicFields: ['movable'],
    };
    const invalidGeometryOnly = {
      command: 'OPENMERCHANTBIGDLG', status: 'invalid',
      willIndex: 7, imageIndex: 11,
      assetRef: { willIndex: 77, imageIndex: 110 },
      invalidFields: ['nine-grid-width'],
    };
    const model = { scenes: [
      { background: first },
      { background: duplicate },
      { background: openBig },
      { background: dynamic },
      { background: invalid },
      { background: dynamicRuntimeOnly },
      { background: invalidGeometryOnly },
      {},
    ] };
    const requests = [];
    provider.hydrateDialogBackgroundAssets(model, reference => {
      requests.push(reference);
      return {
        status: 'ready',
        url: `vscode-resource:/${reference.willIndex}/${reference.imageIndex}.png`,
        archiveLabel: `${reference.willIndex}/${reference.imageIndex}`,
        width: 200,
        height: 100,
        offsetX: -2,
        offsetY: 3,
      };
    });
    assert.deepEqual(requests, [
      { willIndex: 5, imageIndex: 3 },
      { willIndex: 8, imageIndex: 109 },
      { willIndex: 6, imageIndex: 10 },
      { willIndex: 7, imageIndex: 11 },
    ], 'provider failed to rebuild references or confused resource and non-resource diagnostics');
    assert.equal(first.asset?.status, 'ready');
    assert.equal(duplicate.asset, first.asset, 'duplicate reference must reuse one preview object');
    assert.equal(openBig.asset?.status, 'ready');
    assert.equal(dynamic.asset, undefined, 'dynamic background was hydrated');
    assert.equal(invalid.asset, undefined, 'invalid background was hydrated');
    assert.equal(dynamicRuntimeOnly.asset?.status, 'ready',
      'dynamic non-resource behavior incorrectly suppressed the known background image');
    assert.equal(invalidGeometryOnly.asset?.status, 'ready',
      'invalid non-resource geometry incorrectly suppressed the known background image');

    const providerSource = fs.readFileSync(
      require.resolve('../out/providers/npc-dialog-visual'),
      'utf8'
    );
    assert.match(providerSource, /hydrateDialogBackgroundAssets\s*\(\s*model\s*,\s*resolve\s*\)/,
      'NpcDialogVisualProvider.hydrateAssets bypasses the source-safety helper');
  });

  if (failures.length > 0) {
    throw new Error(`dialog background coverage failures (${failures.length}):\n- ${failures.join('\n- ')}`);
  }
}

collectFailures();
console.log('dialog-background-preview.test.js: PASS');
