const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const iconv = require('iconv-lite');

const staticLanguage = require('../data/static-language.json');
const {
  addDlgCompanionCandidatePaths,
  dialogCompanionSourceChangeAction,
  dialogElementSource,
  isAddDlgCompanionCandidate,
  isDialogCompanionModelSource,
  parseNpcDialogDocumentWithCompanion,
  resolveAddDlgCompanion,
} = require('../out/ui-dialog/adddlg-companion');
const {
  buildDialogStatementCatalog,
} = require('../out/ui-dialog/statement-catalog');
const {
  reflowNpcDialogLayout,
} = require('../out/ui-dialog/source-parser');
const {
  buildDialogCoordinateEdits,
} = require('../out/ui-dialog/source-patcher');
const {
  workspaceNpcDialogOffsets,
} = require('../out/ui-dialog/offsets');

function mainSource(...commands) {
  return [
    '[@main]',
    '#ACT',
    ...commands,
    '',
  ].join('\r\n');
}

function parseWithResolution(source, filePath, resolution, conditionStates) {
  return parseNpcDialogDocumentWithCompanion(source, {
    uri: pathToFileURL(filePath).toString(),
    fileName: path.basename(filePath),
    filePath,
    documentVersion: 7,
    engine: 'GOM',
    engineLabel: 'GOM',
    cursorOffset: source.indexOf('[@main]') + 2,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
    conditionStates,
  }, resolution);
}

function testExternalConditionStateRoundTrip() {
  const workspaceRoot = makeWorkspace();
  const mainPath = path.join(workspaceRoot, 'Mir200', 'Envir', 'QuestDiary', 'condition.txt');
  writeCompanion(workspaceRoot, ['Mir200', 'Envir', 'Market_Def'], [
    '[@条件界面]',
    '#IF',
    'CHECKLEVELEX > 100',
    '#SAY',
    '满足条件',
    '#ELSESAY',
    '不满足条件',
  ].join('\n'), 'utf8');
  const source = mainSource('AddDlg 3 1 440 0 10:20 30:40 9 @条件界面 0:0 0:0:0:0:300');
  const resolution = resolveAddDlgCompanion(workspaceRoot);
  const initial = parseWithResolution(source, mainPath, resolution);
  assert.equal(initial.conditionGroups.length, 1);
  const groupId = initial.conditionGroups[0].id;
  assert.match(initial.pages[0].elements.map(element => element.text || '').join(' '), /不满足条件/);
  const selected = parseWithResolution(source, mainPath, resolution, { [groupId]: true });
  assert.equal(selected.conditionGroups[0].id, groupId);
  assert.match(selected.pages[0].elements.map(element => element.text || '').join(' '), /满足条件/);
  assert.doesNotMatch(selected.pages[0].elements.map(element => element.text || '').join(' '), /不满足条件/);
}

function testSameDocumentQfDoesNotRequireCompanion() {
  const workspaceRoot = makeWorkspace();
  const mainPath = path.join(workspaceRoot, 'Mir200', 'Envir', 'QuestDiary', 'inline.txt');
  const source = [
    mainSource('AddDlg 4 1 440 0 10:20 30:40 9 @同文档界面 0:0 0:0:0:0:300').trimEnd(),
    '[@同文档界面]',
    '#SAY',
    '同文档内容',
  ].join('\r\n');
  const resolution = resolveAddDlgCompanion(workspaceRoot);
  assert.equal(resolution.status, 'missing');
  const model = parseWithResolution(source, mainPath, resolution);
  assert.equal(model.pages.length, 1);
  assert.match(model.pages[0].elements.map(element => element.text || '').join(' '), /同文档内容/);
  assert.doesNotMatch(model.warnings.join('\n'), /QFunction-0\.txt/,
    'an inline QF label must remain self-contained and must not require a companion file');
}

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'boo-adddlg-companion-'));
}

function writeCompanion(workspaceRoot, relativeParts, text, encoding) {
  const filePath = path.join(workspaceRoot, ...relativeParts, 'QFunction-0.txt');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, encoding === 'gbk' ? iconv.encode(text, 'gbk') : Buffer.from(text, 'utf8'));
  return filePath;
}

function testCandidateResolutionAndEncoding() {
  const utf8Root = makeWorkspace();
  const utf8Path = writeCompanion(utf8Root, ['Mir200', 'Envir', 'Market_Def'], [
    '[@外部界面]',
    '#SAY',
    'UTF8中文',
  ].join('\n'), 'utf8');
  const candidates = addDlgCompanionCandidatePaths(utf8Root);
  assert.deepEqual(candidates, [
    path.join(utf8Root, 'Mir200', 'Envir', 'Market_Def', 'QFunction-0.txt'),
    path.join(utf8Root, 'Envir', 'Market_Def', 'QFunction-0.txt'),
  ]);
  const utf8 = resolveAddDlgCompanion(utf8Root);
  assert.equal(utf8.status, 'found');
  assert.equal(utf8.source.filePath, utf8Path);
  assert.equal(utf8.source.encoding, 'utf8');
  assert.match(utf8.source.text, /UTF8中文/);
  assert.equal(isAddDlgCompanionCandidate(utf8Root, utf8Path), true);

  const gbkRoot = makeWorkspace();
  const gbkPath = writeCompanion(gbkRoot, ['Envir', 'Market_Def'], [
    '[@外部界面]',
    '#SAY',
    'GBK中文',
  ].join('\r\n'), 'gbk');
  const gbk = resolveAddDlgCompanion(gbkRoot);
  assert.equal(gbk.status, 'found');
  assert.equal(gbk.source.filePath, gbkPath);
  assert.equal(gbk.source.encoding, 'gbk');
  assert.match(gbk.source.text, /GBK中文/);

  const ambiguousPath = writeCompanion(gbkRoot, ['Mir200', 'Envir', 'Market_Def'], '[@另一个]\n#SAY\n冲突', 'utf8');
  const ambiguous = resolveAddDlgCompanion(gbkRoot);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.deepEqual(new Set(ambiguous.existingFilePaths), new Set([gbkPath, ambiguousPath]));
}

function testExternalQFunctionMergeReadOnlyLocateAndCloseAction() {
  const workspaceRoot = makeWorkspace();
  const mainPath = path.join(workspaceRoot, 'Mir200', 'Envir', 'QuestDiary', 'npc.txt');
  const qfPath = writeCompanion(workspaceRoot, ['Mir200', 'Envir', 'Market_Def'], [
    '[@QF脚本字段]',
    '#SAY',
    '<&TEXT:外部文字:10:20{FCOLOR=250}>',
    '<ITEMBOX:1:1:10:30:40:36:36:0:不支持的OK框>',
    '前往下一页<下一页/@下一页>',
    '',
    '[@下一页]',
    '#SAY',
    '外部第二页<关闭/@关闭>',
    '',
    '[@关闭]',
    '#ACT',
    'DelDlg 1',
  ].join('\r\n'), 'gbk');
  const source = mainSource('AddDlg 1 1 440 0 900:700 30:40 9 @QF脚本字段 0:0 0:0:0:0:300');
  const model = parseWithResolution(source, mainPath, resolveAddDlgCompanion(workspaceRoot));

  assert.equal(model.addDlgWindows.length, 1);
  assert.deepEqual(model.companionFilePaths, [qfPath]);
  assert.deepEqual(model.companionUris, [pathToFileURL(qfPath).toString()]);
  assert.equal(model.pages.length, 2, 'external QF root and linked visible page must be merged');
  assert.ok(model.pages.every(page => page.addDlgWindow?.dialogId === 1));
  const external = model.scenes.flatMap(scene => scene.elements)
    .find(element => element.text === '外部文字');
  assert.ok(external, 'external QFunction element missing');
  assert.equal(external.editable, false);
  assert.equal(external.sourceFilePath, qfPath);
  assert.equal(external.sourceUri, pathToFileURL(qfPath).toString());
  assert.equal(isDialogCompanionModelSource(model, qfPath), true,
    'opened-document and file-watcher changes must be classified as companion changes');
  assert.equal(isDialogCompanionModelSource(model, mainPath), false);
  assert.equal(dialogCompanionSourceChangeAction(model, qfPath, false), 'reload');
  assert.equal(dialogCompanionSourceChangeAction(model, qfPath, true), 'conflict');
  assert.equal(dialogCompanionSourceChangeAction(model, mainPath, false), 'ignore');
  const target = dialogElementSource(model, external);
  assert.deepEqual(target, {
    uri: pathToFileURL(qfPath).toString(),
    filePath: qfPath,
    documentVersion: 0,
  });
  assert.ok(model.pages[1].addDlgWindow.closeActions.some(action => (
    action.dialogId === 1 && action.sourceLabel === '@关闭'
  )), 'external DelDlg must remain associated with the AddDlg lifecycle');
  assert.match(model.warnings.join('\n'), /不支持.*ITEMBOX.*OK框|ITEMBOX.*OK框.*不支持/);
  assert.doesNotMatch(model.warnings.join('\n'), /未找到 QF 标签 @QF脚本字段/,
    'resolved external labels must remove the preliminary missing-label warning');
  assert.ok(model.canvasWidth >= 1400, 'canvas width must include AddDlg origin and fallback window width');
  assert.ok(model.canvasHeight >= 1080, 'canvas height must include AddDlg origin and fallback window height');

  assert.throws(() => buildDialogCoordinateEdits(source, model, [{
    elementId: external.id,
    x: 50,
    y: 60,
  }]), /外部.*QFunction|companion.*只读/i);

  external.editable = true;
  assert.throws(() => buildDialogCoordinateEdits(source, model, [{
    elementId: external.id,
    x: 50,
    y: 60,
  }]), /外部.*QFunction|companion.*只读/i,
  'patcher must reject external spans defensively even if editability is corrupted');

  const window = model.scenes[0].addDlgWindow;
  window.asset = { status: 'ready', url: 'test://background', width: 600, height: 500 };
  reflowNpcDialogLayout(model);
  assert.ok(model.canvasWidth >= 1580, 'rehydrated AddDlg background width must expand canvas bounds');
  assert.ok(model.canvasHeight >= 1280, 'rehydrated AddDlg background height must expand canvas bounds');
}

function testMissingAndAmbiguousStillProduceStaticWindow() {
  for (const status of ['missing', 'ambiguous']) {
    const workspaceRoot = makeWorkspace();
    const mainPath = path.join(workspaceRoot, 'Mir200', 'Envir', 'QuestDiary', `${status}.txt`);
    if (status === 'ambiguous') {
      writeCompanion(workspaceRoot, ['Mir200', 'Envir', 'Market_Def'], '[@别处]\n#SAY\n一', 'utf8');
      writeCompanion(workspaceRoot, ['Envir', 'Market_Def'], '[@别处]\n#SAY\n二', 'utf8');
    }
    const resolution = resolveAddDlgCompanion(workspaceRoot);
    assert.equal(resolution.status, status);
    const model = parseWithResolution(
      mainSource('AddDlg 2 1 440 0 10:20 30:40 9 @缺失界面 0:0 0:0:0:0:300'),
      mainPath,
      resolution
    );
    assert.equal(model.pages.length, 1, `${status} companion must keep a synthetic AddDlg page`);
    assert.equal(model.pages[0].addDlgWindow.dialogId, 2);
    assert.match(model.warnings.join('\n'), status === 'missing'
      ? /QFunction-0\.txt.*未找到|未找到.*QFunction-0\.txt/
      : /QFunction-0\.txt.*多个|多个.*QFunction-0\.txt/);
  }
}

function testSharedExternalTargetDoesNotCollapseWindows() {
  const workspaceRoot = makeWorkspace();
  const mainPath = path.join(workspaceRoot, 'Mir200', 'Envir', 'QuestDiary', 'shared.txt');
  writeCompanion(workspaceRoot, ['Mir200', 'Envir', 'Market_Def'], [
    '[@共享界面]',
    '#SAY',
    '共享内容',
  ].join('\n'), 'utf8');
  const source = mainSource(
    'AddDlg 1 1 440 0 10:20 30:40 9 @共享界面 0:0 0:0:0:0:300',
    'AddDlg 2 1 441 0 100:120 30:40 9 @共享界面 0:0 0:0:0:0:300'
  );
  const model = parseWithResolution(source, mainPath, resolveAddDlgCompanion(workspaceRoot));
  assert.equal(model.pages.length, 2, 'two AddDlg windows sharing one QF page need distinct preview pages');
  assert.deepEqual(new Set(model.pages.map(page => page.addDlgWindow.dialogId)), new Set([1, 2]));
  assert.ok(model.pages.every(page => /共享界面/.test(page.sourceLabel)));
}

testCandidateResolutionAndEncoding();
testExternalConditionStateRoundTrip();
testSameDocumentQfDoesNotRequireCompanion();
testExternalQFunctionMergeReadOnlyLocateAndCloseAction();
testMissingAndAmbiguousStillProduceStaticWindow();
testSharedExternalTargetDoesNotCollapseWindows();
console.log('adddlg-companion.test.js: PASS');
