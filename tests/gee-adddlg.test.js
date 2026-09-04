const assert = require('node:assert/strict');

const commandData = require('../data/commands.json');
const functionsGee = require('../data/functions-gee.json');
const languageAccuracy = require('../data/audit-report/language-accuracy-final.json');
const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

// Evidence used by this red test:
// - LFM is represented by engine id `GEE` inside BOO.
// - `D:\AI界面\mir-plugin\knowledge\lfm\manual\添加对话框-可用于主界面任务引导.md`
//   documents two distinct LFM commands:
//     ADDDLG   id wil image movable x:y textX:textY hostPosition inlineContent
//     ADDDLGEX id wil image movable x:y textX:textY hostPosition fileName isAbsolute
// - LFM id range is 1-50. Its host-position table is not GOM's table; for example,
//   22 is 宠物界面 and 43 is 可视化无限仓库.
// - The manual demonstrates an absolute `d:\d.txt` ADDDLGEX source, but does not
//   publish its client decoding/lifetime rules. Ctrl+F12 must expose that boundary
//   and must not silently read an arbitrary external path.
// - `language-accuracy-final.json` explicitly marks ADDDLG as a resolved engine
//   difference. GOM's QF/parent/popup parameters therefore cannot be applied to LFM.

const INLINE_CONTENT = '>翎风行内内容|253#第二行\\<按钮/@1>';
const EXTERNAL_FILE = 'D:\\lfm-dialog\\d.txt';
const DYNAMIC_FIELDS = [
  'resource',
  'backgroundImage',
  'movable',
  'windowOrigin',
  'textOffset',
  'createPosition',
  'content',
];

function parseFixtures() {
  const source = [
    '[@main]',
    '#ACT',
    'MOV N1 9',
    'MOV N2 777',
    'MOV N3 1',
    'MOV N4 333',
    'MOV N5 444',
    'MOV N6 55',
    'MOV N7 66',
    'MOV N8 22',
    'MOV S1 已解析但仍属于运行时的内容',
    `ADDDLG 11 1 440 1 10:20 30:40 22 ${INLINE_CONTENT}`,
    `ADDDLGEX 12 1 441 0 110:120 31:41 43 ${EXTERNAL_FILE} 1`,
    'ADDDLG 13 <$STR(N1)> <$STR(N2)> <$STR(N3)> '
      + '<$STR(N4)>:<$STR(N5)> <$STR(N6)>:<$STR(N7)> '
      + '<$STR(N8)> <$STR(S1)>',
    'DELDLG 11 0',
  ].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/gee-adddlg.txt',
    fileName: 'gee-adddlg.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\gee-adddlg.txt',
    documentVersion: 1,
    engine: 'GEE',
    engineLabel: '翎风引擎',
    cursorOffset: source.indexOf('#ACT') + 4,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GEE'),
  });
  return { source, model };
}

function windowByDialogId(model, dialogId) {
  return (model.addDlgWindows || []).find(window => window.dialogId === dialogId);
}

function pagesForWindow(model, window) {
  if (!window) return [];
  return (model.pages || []).filter(page => page.addDlgWindow?.id === window.id);
}

function warningText(model, window) {
  return [
    ...(window?.warnings || []),
    ...(model.warnings || []),
    ...pagesForWindow(model, window).flatMap(page => page.warnings || []),
  ].join('；');
}

function visibleWindowText(model, window) {
  return pagesForWindow(model, window)
    .flatMap(page => page.elements || [])
    .map(element => element.text || '')
    .join(' ');
}

function requireFields(actual, expected, message) {
  const values = new Set(actual || []);
  const missing = expected.filter(field => !values.has(field));
  assert.deepEqual(missing, [], `${message}; missing=${missing.join(',')}; actual=${JSON.stringify(actual)}`);
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

  let source = '';
  let model;
  try {
    ({ source, model } = parseFixtures());
  } catch (error) {
    failures.push(`fixture parse: ${error && error.stack ? error.stack : String(error)}`);
    return failures;
  }

  check('language evidence keeps GOM and LFM ADDDLG grammars separate', () => {
    assert.equal(model.engine, 'GEE', 'BOO must use engine id GEE for LFM fixtures');
    assert.equal(functionsGee.adddlg?.completionVerified, true);
    assert.equal(functionsGee.adddlgex?.completionVerified, true);
    assert.match(functionsGee.adddlg.params, /位置\s+内容/);
    assert.match(functionsGee.adddlgex.params, /文件名\s+是否绝对路径/);

    const command = commandData.execCommands.find(candidate => candidate.name === 'ADDDLG');
    assert.ok(command?.engineVariants?.GOM && command?.engineVariants?.GEE);
    assert.equal(command.engineVariants.GOM.params.length, 10);
    assert.equal(command.engineVariants.GEE.params.length, 8);
    assert.match(command.engineVariants.GOM.params.join(' '), /QF/);
    assert.doesNotMatch(command.engineVariants.GEE.params.join(' '), /QF|上级移动|渐缓/);
    assert.equal(languageAccuracy.commands.ADDDLG.variant.status, 'resolved-difference');
    assert.match(languageAccuracy.commands.ADDDLG.GEE.function.signature, /位置\s+内容/);
  });

  check('LFM ADDDLG creates a typed inline window with static geometry and content', () => {
    const window = windowByDialogId(model, 11);
    assert.ok(window, 'engine=GEE ADDDLG was silently ignored instead of becoming a typed window');
    assert.deepEqual({
      command: window.command,
      dialogId: window.dialogId,
      assetRef: window.assetRef,
      movable: window.movable,
      windowX: window.windowX,
      windowY: window.windowY,
      textOffsetX: window.textOffsetX,
      textOffsetY: window.textOffsetY,
      createPosition: window.createPosition,
      createPositionLabel: window.createPositionLabel,
    }, {
      command: 'ADDDLG',
      dialogId: 11,
      assetRef: { willIndex: 1, imageIndex: 440 },
      movable: true,
      windowX: 10,
      windowY: 20,
      textOffsetX: 30,
      textOffsetY: 40,
      createPosition: 22,
      createPositionLabel: '宠物界面',
    });
    assert.deepEqual(window.contentPreview, {
      mode: 'inline',
      raw: INLINE_CONTENT,
      status: 'static',
    });
    assert.equal(window.qfTarget, undefined,
      'LFM inline content must not be reinterpreted as a GOM QF target');
    assert.ok(pagesForWindow(model, window).length >= 1,
      'the typed LFM window needs an independently renderable page/container');
    assert.match(visibleWindowText(model, window), /翎风行内内容/,
      'static inline content must be available to the Ctrl+F12 renderer');
    assert.doesNotMatch(visibleWindowText(model, window), /ADDDLG\s+11/i,
      'the raw action command must never become canvas flow text');
    assert.match(warningText(model, window), /Partial simulation/i);
    assert.match(warningText(model, window), /宿主|客户端|运行时/);
  });

  check('LFM ADDDLGEX retains external-file fields without loading arbitrary paths', () => {
    const window = windowByDialogId(model, 12);
    assert.ok(window, 'engine=GEE ADDDLGEX was silently ignored instead of becoming a typed window');
    assert.deepEqual({
      command: window.command,
      dialogId: window.dialogId,
      assetRef: window.assetRef,
      movable: window.movable,
      windowX: window.windowX,
      windowY: window.windowY,
      textOffsetX: window.textOffsetX,
      textOffsetY: window.textOffsetY,
      createPosition: window.createPosition,
      createPositionLabel: window.createPositionLabel,
    }, {
      command: 'ADDDLGEX',
      dialogId: 12,
      assetRef: { willIndex: 1, imageIndex: 441 },
      movable: false,
      windowX: 110,
      windowY: 120,
      textOffsetX: 31,
      textOffsetY: 41,
      createPosition: 43,
      createPositionLabel: '可视化无限仓库',
    });
    assert.deepEqual(window.contentPreview, {
      mode: 'external-file',
      raw: EXTERNAL_FILE,
      absolute: true,
      status: 'evidence-blocked',
    });
    assert.equal(window.qfTarget, undefined,
      'LFM file name must not be reinterpreted as a GOM QF target');
    assert.ok(pagesForWindow(model, window).length >= 1,
      'evidence-blocked external content must still keep a visible static window');
    const warnings = warningText(model, window);
    assert.match(warnings, /Evidence-blocked/i);
    assert.match(warnings, /外部文件|文件内容|ADDDLGEX/i);
    assert.match(warnings, /不读取|不加载|不执行|未读取/);
  });

  check('dynamic LFM ADDDLG fields remain unknown and never borrow MOV values', () => {
    const window = windowByDialogId(model, 13);
    assert.ok(window, 'dynamic engine=GEE ADDDLG must remain a typed static-preview window');
    assert.equal(window.command, 'ADDDLG');
    requireFields(window.dynamicFields, DYNAMIC_FIELDS, 'LFM ADDDLG dynamicFields');
    assert.equal(window.assetRef, undefined, 'dynamic WIL/image must not request a resolved MOV asset');
    assert.equal(window.movable, undefined);
    assert.equal(window.windowX, undefined);
    assert.equal(window.windowY, undefined);
    assert.equal(window.textOffsetX, undefined);
    assert.equal(window.textOffsetY, undefined);
    assert.equal(window.createPosition, undefined);
    assert.notEqual(window.windowX, 333, 'dynamic X borrowed MOV N4');
    assert.notEqual(window.windowY, 444, 'dynamic Y borrowed MOV N5');
    assert.notEqual(window.createPosition, 22, 'dynamic host position borrowed MOV N8');
    assert.deepEqual(window.contentPreview, {
      mode: 'inline',
      raw: '<$STR(S1)>',
      status: 'dynamic',
    });
    assert.ok(pagesForWindow(model, window).length >= 1,
      'unknown geometry must produce a visible uncertain-position window, not disappear');
    const warnings = warningText(model, window);
    assert.match(warnings, /动态|运行时/);
    assert.match(warnings, /不借用.*当前值|当前值.*不借用/);
    assert.match(warnings, /Partial simulation/i);
  });

  check('LFM inline/file windows do not activate the GOM companion pipeline', () => {
    assert.deepEqual(model.companionUris, []);
    assert.deepEqual(model.companionFilePaths, []);
    assert.deepEqual(model.companionCandidateFilePaths, []);
    const visible = (model.pages || []).flatMap(page => page.elements || [])
      .map(element => element.text || element.raw || '')
      .join('\n');
    assert.doesNotMatch(visible, /ADDDLGEX?\s+(?:11|12|13)\b/i);
    assert.doesNotMatch((model.pages || []).flatMap(page => page.unsupportedStatements || []).join('\n'),
      /ADDDLGEX?/i, 'recognized action windows must not be mislabeled as unsupported SAY markup');
    assert.match(source, /ADDDLGEX 12/,
      'fixture guard: this test must retain the documented ADDDLGEX line');
  });

  return failures;
}

const failures = collectFailures();
if (failures.length > 0) {
  console.error('gee-adddlg.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('gee-adddlg.test.js: PASS');
}
