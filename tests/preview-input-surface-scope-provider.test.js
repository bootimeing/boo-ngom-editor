const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { interactiveSource, parse } = require('./preview-input-surface-scope.test');

const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const language = require(path.join(runtimeRoot, 'data/static-language.json'));
const { workspaceNpcDialogOffsets } = require(path.join(runtimeRoot, 'out/ui-dialog/offsets'));

function loadManager(errors, workspaceOverrides = {}) {
  const originalLoad = Module._load;
  const vscode = {
    Uri: {
      parse: value => ({ scheme: 'file', fsPath: value, toString: () => value }),
      file: value => ({ scheme: 'file', fsPath: value, toString: () => value }),
    },
    EventEmitter: class {},
    window: { showErrorMessage: message => errors.push(message) },
    workspace: { textDocuments: [], ...workspaceOverrides },
  };
  Module._load = function (request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  try {
    const file = path.join(runtimeRoot, 'out/providers/npc-dialog-visual.js');
    const loaded = new Module(file, module);
    loaded.filename = file;
    loaded.paths = Module._nodeModulePaths(path.dirname(file));
    loaded._compile(
      fs.readFileSync(file, 'utf8') + '\nmodule.exports.TestManager = NpcDialogVisualEditorManager;',
      file,
    );
    return loaded.exports.TestManager;
  } finally {
    Module._load = originalLoad;
  }
}

async function testRealQuestDiaryProviderScope() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-surface-scope-provider-'));
  try {
    const externalPath = path.join(temp, 'Envir', 'QuestDiary', 'property.txt');
    const primaryPath = path.join(temp, 'main.txt');
    const primaryText = [
      '[@main]', '#ACT', String.raw`#CALL [\property.txt] @reload`, '#SAY',
      '<TEXT:完成这个任务后获得属性，固定结果=<$STR(N$result)>:20:20>',
    ].join('\n');
    const externalText = [
      '[@reload]', '{', '#ACT',
      'MOV N$result 40',
      'INC N$result 2',
      'MOV U212 1',
      'INC N$攻击 2',
      'MOV S$内部 仅业务',
      '#IF', 'LARGE U211 0', '#ACT',
      'SENDMSG 6 属性已重载',
      '}',
    ].join('\n');
    fs.mkdirSync(path.dirname(externalPath), { recursive: true });
    fs.writeFileSync(primaryPath, primaryText, 'utf8');
    fs.writeFileSync(externalPath, externalText, 'utf8');

    const fileUri = file => ({
      scheme: 'file',
      fsPath: file,
      toString: () => pathToFileURL(file).href,
    });
    const document = {
      fileName: primaryPath,
      uri: fileUri(primaryPath),
      version: 1,
      getText: () => primaryText,
    };
    const providerErrors = [];
    const Manager = loadManager(providerErrors, {
      textDocuments: [document],
      getWorkspaceFolder: () => ({ uri: fileUri(temp) }),
      getConfiguration: () => ({ get: () => 'GOM' }),
    });
    const manager = Object.create(Manager.prototype);
    manager.staticLanguage = language;
    manager.scriptDataResolver = {
      prepareFor: async () => {},
      optionsFor: () => ({}),
    };
    manager.dialogOffsets = () => workspaceNpcDialogOffsets(0, 0);
    manager.resolveCompanion = () => ({ status: 'missing', candidateFilePaths: [] });

    const model = await manager.createModel(document, 2, undefined, {}, {});
    assert.ok(
      model.companionFilePaths.some(file => path.resolve(file) === path.resolve(externalPath)),
      'production createModel must discover the real QuestDiary dependency before its variables are scoped',
    );
    const mainPage = model.pages.find(page => page.sourceLabel === '@main');
    assert.ok(mainPage, 'the Provider model must retain the primary @main page');
    assert.ok(
      mainPage.elements.some(element => element.text === '完成这个任务后获得属性，固定结果=42'),
      'the external @reload function must execute and feed its deterministic N$result value into primary canvas text',
    );
    assert.deepEqual(
      (model.previewInputs || []).map(input => input.name).sort(),
      [],
      'the deterministic derived target and all Provider-loaded external business variables must stay off the input panel',
    );
    for (const hiddenName of ['N$result', 'U211', 'U212', 'N$攻击', 'S$内部']) {
      assert.ok(
        !(model.previewInputs || []).some(input => input.name === hiddenName),
        `${hiddenName} must remain evaluator-private even though the external function really executed`,
      );
    }
    assert.deepEqual(model.conditionGroups, [],
      'a real Provider-loaded external business condition must stay off the canvas controls');
    assert.deepEqual(model.pages.map(page => page.sourceLabel), ['@main']);
    assert.deepEqual(providerErrors, []);

    const { ScriptDataResolver } = require(path.join(runtimeRoot, 'out/utils/script-data-resolver'));
    const { globalSource } = require('./preview-global-values.test');
    const globalScript = path.join(temp, 'Envir', 'Market_Def', 'global.txt');
    const globalIni = path.join(temp, 'GlobalVal.ini');
    fs.mkdirSync(path.dirname(globalScript), { recursive: true });
    fs.writeFileSync(globalScript, globalSource, 'utf8');
    const iniText = '[Setup]\nGlobalVal201=40\nGlobalStrVal201=\n';
    fs.writeFileSync(globalIni, iniText, 'utf8');
    const globalDocument = { fileName: globalScript, uri: fileUri(globalScript), version: 1, getText: () => globalSource };
    manager.scriptDataResolver = new ScriptDataResolver();
    try {
      const globalSession = {
        document: globalDocument, previewValues: {}, modelRevision: 1,
        model: await manager.createModel(globalDocument, 2, undefined, {}, {}),
        panel: { webview: { postMessage: () => {} } },
      };
      manager.previewDraftSourcesCurrent = () => true;
      manager.reloadSession = async current => {
        current.model = await manager.createModel(globalDocument, 2, undefined, {}, current.previewValues);
      };
      const text = () => globalSession.model.pages.flatMap(p => p.elements).map(e => e.text).join('\n');
      assert.ok(text().includes('暂无') && text().includes('数量=42'));
      await manager.onMessage(globalSession, { type: 'previewInput', name: 'A201', value: '临时玩家' });
      await manager.onMessage(globalSession, { type: 'previewInput', name: 'G201', value: '100' });
      assert.ok(text().includes('临时玩家') && text().includes('数量=102'));
      await manager.onMessage(globalSession, { type: 'resetPreview' });
      assert.deepEqual(globalSession.previewValues, {});
      assert.ok(text().includes('暂无') && text().includes('数量=42'));
      assert.equal(globalSession.model.previewInputs.find(i => i.name === 'G201').value, '40');
      assert.equal(fs.readFileSync(globalScript, 'utf8'), globalSource);
      assert.equal(fs.readFileSync(globalIni, 'utf8'), iniText);
      assert.deepEqual(providerErrors, []);
    } finally { manager.scriptDataResolver.dispose(); }
  } finally {
    removeTemporaryDirectory(temp);
  }
}

async function main() {
  const errors = [];
  const Manager = loadManager(errors);
  const manager = Object.create(Manager.prototype);
  let reloads = 0;
  manager.previewDraftSourcesCurrent = () => true;
  manager.reloadSession = async () => { reloads += 1; };

  const posted = [];
  const model = parse(interactiveSource);
  const session = {
    model,
    modelRevision: 17,
    previewValues: {},
    conflict: false,
    coordinateOperation: false,
    document: { version: model.documentVersion },
    panel: { webview: { postMessage: message => posted.push(message) } },
  };

  for (const name of ['U201', 'U202', 'N$攻击', 'S$内部', '[301]']) {
    await manager.onMessage(session, { type: 'previewInput', name, value: name === '[301]' ? '1' : '9' });
  }
  assert.equal(reloads, 0, 'forged business-only inputs must be rejected before reparsing');
  assert.deepEqual(session.previewValues, {}, 'rejected browser fields must not enter the local scenario state');
  assert.equal(session.modelRevision, 17);
  assert.equal(errors.length, 5);
  assert.equal(posted.filter(message => message.type === 'operationError').length, 5);

  await manager.onMessage(session, { type: 'previewInput', name: 'U203', value: '42' });
  assert.equal(reloads, 1, 'the visible runtime fallback remains accepted');
  assert.deepEqual(session.previewValues, { U203: '42' });
  assert.equal(errors.length, 5);

  const dormantUiSource = [
    '[@main]', '#SAY', '<TEXT:主界面:20:20>', '<领取/@business>',
    '[@business]', '#ACT', 'WHILE U1 > 0',
    'MESSAGEBOX 休眠循环卡片 @确定 @取消',
    'DEC U1 1', 'ENDWHILE',
  ].join('\n');
  session.model = parse(dormantUiSource);
  session.previewValues = {};
  session.modelRevision = 18;
  session.document.version = session.model.documentVersion;
  await manager.onMessage(session, { type: 'previewInput', name: 'U1', value: '1' });
  assert.equal(reloads, 1,
    'a forged WHILE input from an unclicked action-only handler must be rejected');
  assert.deepEqual(session.previewValues, {});
  assert.equal(errors.length, 6);
  assert.equal(posted.filter(message => message.type === 'operationError').length, 6);

  const hiddenSay = [
    '[@main]', '#IF', 'CHECK [110] 1', '#SAY',
    '<TEXT:隐藏=<$STR(U9)>:20:20>', '#ELSESAY', '<TEXT:关闭:20:20>',
  ].join('\n');
  const hiddenStm = [
    '[@main]', '#IF', 'CHECK [111] 1', '#SAY',
    '<Text|id=1|x=20|y=20|text=$STM(HP)>',
    '#ELSESAY', '<Text|id=2|x=20|y=20|text=关闭>',
  ].join('\n');
  const isolatedDelete = [
    '[@main]', '#SAY', '<TEXT:主界面:20:20>',
    '#IF', 'CHECK [112] 1', '#ACT', 'DELBUTTON 99',
  ].join('\n');
  for (const attempt of [
    { model: parse(hiddenSay), name: 'U9', value: '9' },
    { model: parse(hiddenStm, {}, '996PC'), name: 'STM(HP)', value: '99' },
    { model: parse(isolatedDelete), name: '[112]', value: '1' },
  ]) {
    assert.ok(!(attempt.model.previewInputs || []).some(input => input.name === attempt.name),
      `${attempt.name} must be absent before the forged Provider submission is tested`);
    session.model = attempt.model;
    session.previewValues = {};
    session.document.version = attempt.model.documentVersion;
    await manager.onMessage(session, {
      type: 'previewInput',
      name: attempt.name,
      value: attempt.value,
    });
    assert.deepEqual(session.previewValues, {},
      `forged hidden input ${attempt.name} must not enter local preview state`);
  }
  assert.equal(reloads, 1, 'forged hidden-branch and isolated-lifecycle fields must not reparse');
  assert.equal(errors.length, 9);
  assert.equal(posted.filter(message => message.type === 'operationError').length, 9);

  await testRealQuestDiaryProviderScope();

  console.log('preview-input-surface-scope-provider.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
