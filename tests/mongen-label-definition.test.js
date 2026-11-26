const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

// Call the actual DefinitionProvider registered by activateAssistant. The fixture
// filesystem is in memory: lookup may read it but must never open editors or write.
const runtime = path.resolve(process.env.BOO_SCRIPT_RUNTIME_ROOT || path.join(__dirname, '..'));
const fixtureRoot = path.join(runtime, 'test-fixtures', 'mongen-definition');
const envir = path.join(fixtureRoot, '服一', 'Mir200', 'Envir');
const otherEnvir = path.join(fixtureRoot, '服二', 'Mir200', 'Envir');
const sourcePath = path.join(envir, 'MonGen.txt');
const qFunction = path.join(envir, 'Market_Def', 'QFunction-0.txt');
const questDiary = path.join(envir, 'QuestDiary');
const disposable = () => ({ dispose() {} });
const pathKey = value => path.resolve(value).toLowerCase();
let documentVersion = 0;
let cases = 0;

class TestUri {
  constructor(value) {
    this.value = value;
    this.scheme = value.split(':')[0];
    this.fsPath = this.scheme === 'file' ? fileURLToPath(value) : '';
  }
  static file(value) { return new TestUri(pathToFileURL(path.resolve(value)).href); }
  static parse(value) { return new TestUri(value); }
  toString() { return this.value; }
}
class TestPosition { constructor(line, character) { this.line = line; this.character = character; } }
class TestRange {
  constructor(...args) {
    this.start = typeof args[0] === 'number' ? new TestPosition(args[0], args[1]) : args[0];
    this.end = typeof args[0] === 'number' ? new TestPosition(args[2], args[3]) : args[1];
  }
}
class TestLocation {
  constructor(uri, position) { this.uri = uri; this.range = position.start ? position : new TestRange(position, position); }
}
class TestEventEmitter { constructor() { this.event = disposable; } fire() {} dispose() {} }
class TestRelativePattern {
  constructor(base, pattern) { this.baseUri = typeof base === 'string' ? TestUri.file(base) : base; this.pattern = pattern; }
}

function makeDocument(text, fileName = sourcePath) {
  let content = text;
  const document = {
    fileName, uri: TestUri.file(fileName), languageId: 'plaintext', version: ++documentVersion, isDirty: true,
    get lineCount() { return content.split(/\r\n|\r|\n/).length; },
    getText(range) { return range ? content.slice(this.offsetAt(range.start), this.offsetAt(range.end)) : content; },
    lineAt(index) {
      const line = typeof index === 'number' ? index : index.line;
      const text = content.split(/\r\n|\r|\n/)[line];
      return { text, range: new TestRange(line, 0, line, text.length) };
    },
    positionAt(offset) {
      const lines = content.slice(0, Math.max(0, Math.min(offset, content.length))).split(/\r\n|\r|\n/);
      return new TestPosition(lines.length - 1, lines[lines.length - 1].length);
    },
    offsetAt(position) {
      const lines = content.split(/\r\n|\r|\n/);
      const separators = [...content.matchAll(/\r\n|\r|\n/g)];
      const start = position.line ? separators[position.line - 1].index + separators[position.line - 1][0].length : 0;
      return start + Math.min(position.character, lines[position.line].length);
    },
    getWordRangeAtPosition(position) {
      for (const match of this.lineAt(position.line).text.matchAll(/[\p{L}\p{N}_]+/gu)) {
        if (position.character >= match.index && position.character < match.index + match[0].length) {
          return new TestRange(position.line, match.index, position.line, match.index + match[0].length);
        }
      }
      return undefined;
    },
    replace(text) { content = text; this.version = ++documentVersion; },
  };
  return document;
}

function activateWithStub() {
  const providers = {}, disk = new Map(), calls = [], sideEffects = [], scopedConfiguration = [];
  let engine = 'GOM', enumeratedPaths = [], onFindFiles, onReadFile, querying = false;
  function forbidden(name) { sideEffects.push(name); throw new Error(`definition lookup must not ${name}`); }
  const workspace = {
    workspaceFolders: [], textDocuments: [],
    getConfiguration(_section, scope) {
      scopedConfiguration.push(scope?.toString());
      return { get(key, fallback) { if (key === 'engine') return scope?.engine || engine; if (key === 'autoDetectEngine') return false; return fallback; } };
    },
    getWorkspaceFolder() { return { uri: TestUri.file(fixtureRoot) }; },
    async findFiles(pattern, exclude, limit, token) {
      if (!pattern?.baseUri) return []; // Unrelated activation-time workspace review.
      calls.push({ kind: 'findFiles', root: pattern.baseUri.fsPath, pattern: pattern.pattern, exclude, limit, token });
      if (onFindFiles) onFindFiles(token);
      // Deliberately return other-server and out-of-scope entries too: the
      // production candidate merge must enforce its own source-Envir boundary.
      return enumeratedPaths.map(TestUri.file);
    },
    async openTextDocument() { return forbidden('openTextDocument'); },
    fs: {
      async readFile(uri) {
        calls.push({ kind: 'readFile', path: uri.fsPath });
        if (onReadFile) onReadFile(uri);
        const bytes = disk.get(pathKey(uri.fsPath));
        if (bytes === undefined) throw new Error('fixture file missing');
        return bytes;
      },
      async writeFile() { return forbidden('writeFile'); },
      async createDirectory() { return forbidden('createDirectory'); },
      async delete() { return forbidden('delete'); },
      async rename() { return forbidden('rename'); },
    },
  };
  for (const name of ['onDidChangeTextDocument', 'onDidSaveTextDocument', 'onDidChangeWorkspaceFolders', 'onDidChangeConfiguration', 'onDidOpenTextDocument', 'onDidCloseTextDocument', 'onDidCreateFiles', 'onDidDeleteFiles', 'onDidRenameFiles']) {
    workspace[name] = disposable;
  }
  const languages = {
    createDiagnosticCollection() { return { set() {}, delete() {}, clear() {}, forEach() {}, dispose() {} }; },
  };
  for (const kind of ['CompletionItem', 'Hover', 'Definition', 'DocumentLink', 'Reference', 'DocumentSymbol', 'FoldingRange', 'CodeLens', 'CodeActions', 'SignatureHelp', 'DocumentSemanticTokens']) {
    languages[`register${kind}Provider`] = (_selector, provider) => { providers[kind] = provider; return disposable(); };
  }
  const api = {
    Uri: TestUri, Position: TestPosition, Range: TestRange, Location: TestLocation, RelativePattern: TestRelativePattern,
    EventEmitter: TestEventEmitter, TreeItem: class {}, ThemeIcon: class {}, SemanticTokensLegend: class {},
    StatusBarAlignment: { Right: 2 }, DecorationRangeBehavior: { ClosedOpen: 0 },
    CodeActionKind: { QuickFix: 'quickfix' },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    workspace, languages,
    window: {
      activeTextEditor: undefined, visibleTextEditors: [],
      createOutputChannel() { return { appendLine() {}, dispose() {} }; },
      createTextEditorDecorationType: disposable,
      onDidChangeActiveTextEditor: disposable, onDidChangeVisibleTextEditors: disposable,
      registerTreeDataProvider: disposable,
      createStatusBarItem() { return { show() {}, dispose() {} }; },
      showWarningMessage() { return forbidden('showWarningMessage'); },
      showErrorMessage() { return forbidden('showErrorMessage'); },
      showInformationMessage() { return forbidden('showInformationMessage'); },
      showTextDocument() { return forbidden('showTextDocument'); },
    },
    commands: { registerCommand: disposable, registerTextEditorCommand: disposable, async executeCommand() { if (querying) return forbidden('executeCommand'); } },
  };
  const state = { get(_key, fallback) { return fallback; }, async update() {} };
  const context = { subscriptions: [], extensionPath: runtime, extensionUri: TestUri.file(runtime), globalState: state, workspaceState: state };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) { return request === 'vscode' ? api : originalLoad.call(this, request, parent, isMain); };
  try { require(path.join(runtime, 'out', 'assistant')).activateAssistant(context); }
  finally { Module._load = originalLoad; }
  querying = true;
  return {
    providers, workspace, calls, sideEffects, scopedConfiguration,
    reset() {
      disk.clear(); calls.length = 0; sideEffects.length = 0; scopedConfiguration.length = 0;
      engine = 'GOM'; enumeratedPaths = []; onFindFiles = undefined; onReadFile = undefined; workspace.textDocuments = [];
      workspace.workspaceFolders = [{ uri: TestUri.file(fixtureRoot) }];
    },
    setEngine(value) { engine = value; },
    put(filePath, text) { disk.set(pathKey(filePath), Buffer.from(text, 'utf8')); },
    setCandidates(values) { enumeratedPaths = values; },
    afterEnumeration(callback) { onFindFiles = callback; },
    afterRead(callback) { onReadFile = callback; },
    dispose() { for (const subscription of context.subscriptions) subscription?.dispose(); },
  };
}

// Fixed examples are the oracle. Do not obtain callback positions by reusing the
// production parser or copying its regex: column 10 and column 15 differ by engine.
function gomRow(label = '@Mixed_死亡-回调', suffix = '') { return `\uFEFF  3\t100 101 祖玛教主 5 1 60 0 0 ${label}${suffix}`; }
function geeRow(label = '@Mixed_死亡-回调', suffix = '') { return `\t3 100 101 祖玛教主 5 1 60 0 0 0 0 0 0 0 ${label}${suffix}`; }
function locations(value) { return value ? (Array.isArray(value) ? value : [value]) : []; }
function assertTarget(value, filePath, line = 1, character = 2) {
  assert.equal(locations(value).length, 1, 'one callback definition must be returned');
  assert.equal(locations(value)[0].uri.toString(), TestUri.file(filePath).toString());
  assert.deepEqual(locations(value)[0].range.start, new TestPosition(line, character));
}

async function main() {
  const host = activateWithStub();
  const provider = host.providers.Definition;
  assert.equal(typeof provider?.provideDefinition, 'function', 'activateAssistant must register the production DefinitionProvider');
  const targetText = '; fake [@Mixed_死亡-回调]\r\n  [@mixed_死亡-回调]\r\n#ACT\r\n';
  const token = () => ({ isCancellationRequested: false });
  async function jump(document, character = document.lineAt(0).text.indexOf('@'), cancellation = token(), line = 0) {
    return provider.provideDefinition(document, new TestPosition(line, character), cancellation);
  }
  async function check(name, body) {
    host.reset();
    await body();
    assert.deepEqual(host.sideEffects, [], 'definition queries cannot open editors, write, execute commands, or show UI');
    cases++;
    console.log(`mongen-label-definition: PASS - ${name}`);
  }
  try {
    await check('GOM and 996PC standard column 10 callbacks resolve to the same Envir QFunction', async () => {
      host.put(qFunction, targetText);
      for (const engine of ['GOM', '996PC']) {
        host.setEngine(engine);
        const document = makeDocument(gomRow());
        assertTarget(await jump(document), qFunction);
        assert.ok(host.scopedConfiguration.includes(document.uri.toString()), 'engine lookup must be scoped to the current document');
      }
      assert.equal(host.calls.filter(call => call.kind === 'findFiles').length, 0, 'QF hit must not enumerate QuestDiary');
      assert.deepEqual(host.calls.filter(call => call.kind === 'readFile').map(call => pathKey(call.path)), [pathKey(qFunction), pathKey(qFunction)]);
    });
    await check('GEE standard column 15 and per-document engine override do not borrow column 10', async () => {
      host.put(qFunction, targetText);
      host.setEngine('GOM');
      const document = makeDocument(geeRow());
      document.uri.engine = 'GEE';
      assertTarget(await jump(document), qFunction);
      document.uri.engine = 'GOM';
      assert.equal(await jump(document), null, 'GOM cannot treat the GEE fifteenth column as its callback');
      document.replace(gomRow());
      document.uri.engine = 'GEE';
      assert.equal(await jump(document), null, 'GEE cannot treat GOM tenth column as its callback');
      document.uri.engine = '996PC';
      assertTarget(await jump(document), qFunction);
    });
    await check('only @ through the final static-label character is navigable, with a half-open span', async () => {
      host.put(qFunction, targetText);
      for (const [engine, raw] of [['GOM', gomRow(undefined, ' 1')], ['GEE', geeRow(undefined, ' 1')], ['996PC', gomRow()]]) {
        host.setEngine(engine);
        const document = makeDocument(raw);
        const start = raw.indexOf('@'), end = start + '@Mixed_死亡-回调'.length;
        for (let character = start; character < end; character++) assertTarget(await jump(document, character), qFunction);
        for (const character of [0, raw.indexOf('100'), raw.indexOf('祖玛'), start - 1, end, raw.length]) {
          assert.equal(await jump(document, character), null, `${engine} must not link column data or adjacent whitespace at ${character}`);
        }
      }
    });
    await check('comments, disabled *, wrong columns, dynamic labels, and unverified suffixes never navigate or read', async () => {
      host.put(qFunction, targetText);
      const rejected = [
        `; ${gomRow()}`, `// ${gomRow()}`, `* ${gomRow()}`,
        gomRow('*'), gomRow('@'), gomRow('@<$STR(S$触发)>'), gomRow('@Mixed_死亡-回调(1)'),
        '3 100 101 @Mixed_死亡-回调 5 1 60 0 0 0',
        '3 100 101 祖玛教主 5 1 60 0 @Mixed_死亡-回调 0',
        '3 100 101 祖玛教主 5 1 60 0 0 0 @Mixed_死亡-回调',
        '3 bad 101 祖玛教主 5 1 60 0 0 @Mixed_死亡-回调',
        '3 100 101 祖玛教主 5 1 60 0 0; @Mixed_死亡-回调',
        '3 100 101 祖玛教主 5 1 60 0 0// @Mixed_死亡-回调',
      ];
      for (const raw of rejected) {
        const document = makeDocument(raw);
        assert.equal(await jump(document, Math.max(0, raw.indexOf('@'))), null, raw);
      }
      assert.deepEqual(host.calls, [], 'rejected callback cells must not cause filesystem access');
    });
    await check('only local Envir-direct MonGen.txt is eligible, not nested copies or non-file documents', async () => {
      host.put(qFunction, targetText);
      for (const filePath of [path.join(questDiary, 'MonGen.txt'), path.join(fixtureRoot, 'MonGen.txt'), path.join(envir, 'MonGen-copy.txt')]) {
        assert.equal(await jump(makeDocument(gomRow(), filePath)), null, filePath);
      }
      const remote = makeDocument(gomRow());
      remote.uri = TestUri.parse('untitled:MonGen.txt');
      assert.equal(await jump(remote), null);
      const mixedCase = makeDocument(gomRow(), path.join(envir, 'mOnGeN.TxT'));
      assertTarget(await jump(mixedCase), qFunction);
    });
    await check('missing QF falls back recursively to all same-Envir QD definitions in stable natural order', async () => {
      const first = path.join(questDiary, '2', '深层', 'a.TXT');
      const second = path.join(questDiary, '10', 'b.txt');
      const unrelated = path.join(questDiary, '1', 'other.txt');
      const outside = path.join(otherEnvir, 'QuestDiary', '0.txt');
      const prefixSibling = path.join(envir, 'QuestDiary-other', '0.txt');
      const nonText = path.join(questDiary, '0.json');
      for (const filePath of [first, second, outside, prefixSibling, nonText]) host.put(filePath, targetText);
      host.put(unrelated, '[@别的标签]');
      host.setCandidates([second, outside, prefixSibling, unrelated, first, nonText, second]);
      const result = locations(await jump(makeDocument(gomRow())));
      assert.deepEqual(result.map(location => pathKey(location.uri.fsPath)), [first, second].map(pathKey));
      for (const location of result) assert.deepEqual(location.range.start, new TestPosition(1, 2));
      const discovery = host.calls.find(call => call.kind === 'findFiles');
      assert.equal(pathKey(discovery.root), pathKey(questDiary));
      assert.equal(discovery.pattern, '**/*.[tT][xX][tT]');
      assert.equal(discovery.exclude, null, 'workspace excludes must not hide callback scripts');
      assert.ok(host.calls.filter(call => call.kind === 'readFile').every(call => pathKey(call.path) === pathKey(qFunction) || [first, second, unrelated].map(pathKey).includes(pathKey(call.path))));
    });
    await check('dirty QF additions take priority and dirty deletions allow QD fallback over stale disk labels', async () => {
      const qd = path.join(questDiary, '一', '二', '触发.txt');
      host.put(qFunction, '[@别的标签]');
      host.put(qd, targetText);
      host.setCandidates([qd]);
      const openQf = makeDocument(targetText, qFunction);
      host.workspace.textDocuments = [openQf];
      assertTarget(await jump(makeDocument(gomRow())), qFunction);
      assert.deepEqual(host.calls, [], 'dirty QF hit needs neither disk reads nor QD enumeration');
      host.put(qFunction, targetText);
      openQf.replace('[@目标已删除]');
      assertTarget(await jump(makeDocument(gomRow())), qd);
      assert.ok(host.calls.some(call => call.kind === 'findFiles'));
      assert.ok(!host.calls.some(call => call.kind === 'readFile' && pathKey(call.path) === pathKey(qFunction)), 'dirty QF must remain authoritative over disk');
    });
    await check('dirty QD additions, removals, and unsaved files are authoritative without crossing servers', async () => {
      const removed = path.join(questDiary, '1.txt'), added = path.join(questDiary, '2', '新建.TXT');
      const otherServer = path.join(otherEnvir, 'QuestDiary', '0.txt');
      host.put(qFunction, '[@其他]');
      host.put(removed, targetText);
      host.setCandidates([removed]);
      host.workspace.textDocuments = [makeDocument('[@被删除]', removed), makeDocument(targetText, added), makeDocument(targetText, otherServer)];
      assertTarget(await jump(makeDocument(gomRow())), added);
      assert.ok(!host.calls.some(call => call.kind === 'readFile' && [removed, added, otherServer].map(pathKey).includes(pathKey(call.path))), 'open target documents must never fall back to stale disk text');
      host.workspace.textDocuments[1].replace('[@刚删除]');
      assert.equal(await jump(makeDocument(gomRow())), null);
    });
    await check('QF without the label, comment-only fake definitions, and individual unreadable QD files are skipped', async () => {
      host.put(qFunction, '; [@Mixed_死亡-回调]\r\nSENDMSG 6 示例 [@Mixed_死亡-回调]\r\n[@其他]');
      const missing = path.join(questDiary, '1-missing.txt'), valid = path.join(questDiary, '2-valid.txt');
      host.put(valid, targetText);
      host.setCandidates([valid, missing]);
      assertTarget(await jump(makeDocument(`${gomRow()}\r\n[@Mixed_死亡-回调]`)), valid);
    });
    await check('cancellation before lookup or during QD discovery stops subsequent filesystem reads', async () => {
      const document = makeDocument(gomRow());
      const cancelled = { isCancellationRequested: true };
      assert.equal(await jump(document, undefined, cancelled), null);
      assert.deepEqual(host.calls, [], 'a cancelled query must not perform filesystem I/O');
      const pending = token(), qd = path.join(questDiary, '1.txt');
      host.put(qd, targetText);
      host.setCandidates([qd]);
      host.afterEnumeration(() => { pending.isCancellationRequested = true; });
      assert.equal(await jump(document, undefined, pending), null);
      assert.equal(host.calls.filter(call => call.kind === 'findFiles').length, 1);
      assert.deepEqual(host.calls.filter(call => call.kind === 'readFile').map(call => pathKey(call.path)), [pathKey(qFunction)], 'cancelled discovery must not start QD reads');
    });
    console.log(`mongen-label-definition.test.js: PASS (${cases} cases; production registration, VS Code API stub)`);
  } finally { host.dispose(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
