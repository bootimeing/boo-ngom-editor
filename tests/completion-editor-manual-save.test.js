const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const runtime = path.resolve(__dirname, '..');
const { loadEngineFunctions, loadStaticLanguageData } = require('../out/data/loader');
const noop = () => {};
const disposable = () => ({ dispose: noop });

function activate(extensionPath) {
  let open, receive, panel, acknowledgement;
  const withEvents = (object) => new Proxy(object, {
    get(target, key) { return /^(?:onDid|register)/.test(String(key)) && !(key in target) ? disposable : target[key]; },
  });
  const api = {
    Uri: { file: fsPath => ({ fsPath, scheme: 'file' }), parse: value => ({ scheme: value.split(':')[0] }) },
    EventEmitter: class { event = disposable; fire() {} dispose() {} },
    TreeItem: class {}, ThemeIcon: class {}, SemanticTokensLegend: class {},
    DecorationRangeBehavior: { ClosedOpen: 0 }, StatusBarAlignment: { Right: 2 }, ViewColumn: { Active: -1 },
    CodeActionKind: { QuickFix: 'quickfix' }, DiagnosticSeverity: {},
    workspace: withEvents({
      workspaceFolders: [], textDocuments: [], findFiles: async () => [],
      getConfiguration: () => ({ get: (key, fallback) => key === 'engine' ? 'GEE' : fallback }),
    }),
    languages: withEvents({ createDiagnosticCollection: () => ({ clear: noop, dispose: noop }) }),
    commands: withEvents({
      executeCommand: async () => {},
      registerCommand(id, handler) { if (id === 'boo.openCompletionEditor') open = handler; return disposable(); },
    }),
    window: withEvents({
      visibleTextEditors: [], createOutputChannel: () => ({ appendLine: noop, dispose: noop }),
      createTextEditorDecorationType: disposable, createStatusBarItem: () => ({ show: noop, dispose: noop }),
      createWebviewPanel() {
        panel = { webview: { cspSource: 'vscode-webview:', onDidReceiveMessage(fn) { receive = fn; },
          postMessage(msg) { acknowledgement = msg; return Promise.resolve(true); } }, onDidDispose: disposable };
        return panel;
      },
    }),
  };
  const state = { get: (_key, fallback) => fallback, update: async () => {} };
  const context = { extensionPath, globalState: state, workspaceState: state, subscriptions: [] };
  const originalLoad = Module._load;
  Module._load = function (request, parent, main) {
    return request === 'vscode' ? api : originalLoad.call(this, request, parent, main);
  };
  try { require('../out/assistant').activateAssistant(context); }
  finally { Module._load = originalLoad; }
  return {
    async open() {
      await open();
      return { html: panel.webview.html, tabs: JSON.parse(/const allData = (.*?);\r?\n/.exec(panel.webview.html)[1]) };
    },
    async save(tabId, row, obj) {
      acknowledgement = undefined;
      await receive({ type: 'save', engine: row.engineId, tabId, changes: [{ storage: row.storage, sourceIndex: row.sourceIndex, obj }] });
      assert.ok(acknowledgement, 'a save needs an acknowledgement');
      return acknowledgement;
    },
    dispose() { for (const item of context.subscriptions) item?.dispose(); },
  };
}

// Exercise the actual panel script, including edits made while the host is saving.
function checkClient(html, row) {
  const events = {}, elements = {}, messages = [];
  const element = id => elements[id] ||= { addEventListener: (type, fn) => { events[id + type] = fn; } };
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => ({}), querySelectorAll: () => [], addEventListener: noop },
    window: { addEventListener: (_type, fn) => { events.message = fn; } },
    acquireVsCodeApi: () => ({ postMessage: msg => messages.push(msg) }), alert: noop,
  });
  vm.runInContext(/<script[^>]*>([\s\S]*?)<\/script>/.exec(html)[1], context);
  vm.runInContext("activeTab = 'exec'", context);
  const cell = {
    dataset: { field: 'desc', key: 'GEE:' + row.storage + ':' + row.sourceIndex }, classList: { add: noop },
    closest: () => ({ dataset: { idx: String(row.sourceIndex), storage: row.storage } }),
  };
  const edit = text => { cell.textContent = text; events.tbodyinput({ target: cell }); };
  const send = () => vm.runInContext('saveCurrent()', context);
  const ack = ok => events.message({ data: { type: 'saved', ok, engine: 'GEE', tabId: 'exec' } });
  edit('第一次'); send();
  assert.deepEqual(Object.keys(messages[0].changes[0].obj), ['desc']);
  ack(false); send();
  assert.equal(messages[1].changes[0].obj.desc, '第一次', 'failed writes can be retried');
  edit('第二次'); ack(true); send();
  assert.equal(messages[2].changes[0].obj.desc, '第二次', 'edits made during a save survive its acknowledgement');
  ack(true); send();
  assert.equal(messages.length, 3);
}

async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-completion-manual-'));
  let host;
  try {
    const dataDir = path.join(temp, 'data');
    fs.mkdirSync(dataDir);
    for (const name of fs.readdirSync(path.join(runtime, 'data')).filter(name => name.endsWith('.json'))) {
      fs.copyFileSync(path.join(runtime, 'data', name), path.join(dataDir, name));
    }
    const bytes = file => fs.readFileSync(path.join(dataDir, file), 'utf8');
    const json = file => JSON.parse(bytes(file));
    const originals = new Map(fs.readdirSync(dataDir).map(file => [file, bytes(file)]));
    host = activate(temp);
    let { tabs, html } = await host.open();
    const rows = (tab, engine) => tabs.find(x => x.id === tab).data.filter(row => row.engineId === engine);
    const named = (tab, engine, name) => {
      const matches = rows(tab, engine).filter(row => row.name.toLowerCase() === name.toLowerCase());
      assert.equal(matches.length, 1, `${engine}/${tab} should have exactly one ${name}`);
      return matches[0];
    };
    const manualFile = 'manual-gee.json', before = json(manualFile);
    const { saveLanguageFiles } = require('../out/utils/language-editor-save');
    const sampleFiles = ['commands.json', manualFile].map(name => ({
      path: path.join(dataDir, name), before: bytes(name), after: '{}',
    }));
    await assert.rejects(saveLanguageFiles(sampleFiles, async () => { throw new Error('settings write failed'); }), /settings write failed/);
    for (const file of sampleFiles) assert.equal(fs.readFileSync(file.path, 'utf8'), file.before);
    assert.ok(fs.readdirSync(dataDir).every(name => name.endsWith('.json')), 'discard temporary files and release locks');
    const firstFunction = named('exec', 'GEE', 'ACTIVATIONCASKET');
    const otherFunction = named('exec', 'GEE', 'actrepairall');
    assert.equal((await host.save('exec', firstFunction, { name: otherFunction.name.toUpperCase() })).ok, false);
    assert.equal((await host.save('exec', firstFunction, { name: '  ' })).ok, false);
    const command = named('exec', 'GEE', 'SendCenterMsg');
    checkClient(html, command);
    assert.equal(command.storage, 'manual-function');
    assert.equal(command.params.split('\n').length, 9);
    assert.equal(named('check', 'GEE', 'CheckSwordCount').storage, 'manual-function');
    assert.equal(named('exec', 'GEE', 'OpenSword').storage, 'manual-function');
    assert.ok(!rows('check', 'GOM').some(row => row.name.toUpperCase() === 'CHECKGETTARGET'));

    const firstSave = await host.save('exec', command, { desc: '测试手册说明' });
    assert.equal(firstSave.file, manualFile, firstSave.error);
    assert.deepEqual(json(manualFile).functions.SendCenterMsg, { ...before.functions.SendCenterMsg, details: '测试手册说明' });
    assert.equal(loadEngineFunctions(temp, 'GEE', noop).SendCenterMsg.details, '测试手册说明');
    assert.equal((await host.save('exec', command, { name: 'OpenSword' })).ok, false);
    const text = before.saySnippets.find(x => x.id === 'text-absolute');
    const say = named('say', 'GEE', text.label);
    assert.equal(say.storage, 'manual-say');
    const reordered = json(manualFile);
    reordered.saySnippets.reverse();
    fs.writeFileSync(path.join(dataDir, manualFile), JSON.stringify(reordered));
    assert.equal((await host.save('say', say, { desc: '测试文字标签' })).ok, true);
    assert.deepEqual(json(manualFile).saySnippets.find(x => x.id === text.id), { ...text, description: '测试文字标签' });
    const newSay = before.saySnippets.find(x => x.id === 'gee-img-submit');
    assert.equal((await host.save('say', named('say', 'GEE', newSay.label), { params: 'N：保留;和；以及||\nF：资源库' })).ok, true);
    const updated = loadStaticLanguageData(temp, noop).saySnippets.find(x => x.id === newSay.id).engineVariants.GEE;
    assert.deepEqual(updated.parameters.map(x => x.description), ['保留;和；以及||', '资源库']);
    for (const [file, original] of originals) if (file !== manualFile) assert.equal(bytes(file), original, file);

    const baseFile = 'static-language.json', base = json(baseFile);
    const baseEntry = base.saySnippets.find(x => x.id === 'text-link').engineVariants.GEE;
    const baseRow = named('say', 'GEE', baseEntry.label);
    assert.equal(baseRow.storage, 'static-say');
    assert.equal((await host.save('say', baseRow, { desc: '测试基础语句' })).file, baseFile);
    baseEntry.description = '测试基础语句';
    assert.deepEqual(json(baseFile), base);

    assert.equal((await host.save('exec', command, { name: 'SendCenterMsgTest' })).ok, true);
    assert.equal((await host.save('exec', command, { params: '独立编辑；保留标点' })).ok, true);
    ({ tabs } = await host.open());
    const renamed = named('exec', 'GEE', 'SendCenterMsgTest');
    assert.equal(renamed.params, '独立编辑；保留标点');
    assert.match(renamed.syntax, /^SendCenterMsgTest /);
    assert.ok(!rows('exec', 'GEE').some(row => row.name.toUpperCase() === 'SENDCENTERMSG'));
    assert.equal(named('say', 'GEE', text.label).desc, '测试文字标签');
    assert.equal(named('say', 'GEE', baseEntry.label).desc, '测试基础语句');
    for (const [file, original] of originals) if (file !== manualFile && file !== baseFile) assert.equal(bytes(file), original, file);
    const partial = named('exec', '996PC', 'RecallMobEx');
    const partialBefore = json('manual-996pc.json').functions.RecallMobEx;
    assert.equal(partial.partialFormat, true);
    assert.equal(partial.desc, partialBefore.details);
    assert.equal(partial.syntax, partialBefore.syntax);
    assert.equal((await host.save('exec', partial, { desc: '部分说明' })).file, 'manual-996pc.json');
    assert.deepEqual(json('manual-996pc.json').functions.RecallMobEx, { ...partialBefore, details: '部分说明' });
    console.log('completion-editor-manual-save.test.js: PASS');
  } finally { host?.dispose(); removeTemporaryDirectory(temp); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
