const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { buildFixture } = require('./gom-reader-tolerance.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-verify-provider-'));
  const originalLoad = Module._load;
  const storage = require('../out/utils/cache-storage');
  const getIndex = storage.getArchiveIndexRoot, getPatch = storage.getPatchCacheRoot;
  const indexRoot = path.join(root, 'archive-index-v1');
  storage.getArchiveIndexRoot = () => indexRoot;
  storage.getPatchCacheRoot = () => path.join(root, 'patch-cache');
  const documents = [], shown = [], messages = [];
  const vscode = {
    workspace: {
      getConfiguration: () => ({ get: (_name, fallback) => fallback }),
      onDidChangeConfiguration: () => ({ dispose() {} }), workspaceFolders: [],
      openTextDocument: async document => { documents.push(document); return document; },
    },
    window: { showTextDocument: async document => shown.push(document) },
    Uri: { parse: s => s, file: fsPath => ({ fsPath }) },
    EventEmitter: class { constructor() { this.event = () => {}; } dispose() {} },
  };
  let provider;
  try {
    Module._load = function(request, parent, isMain) {
      return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
    };
    const { PatchManagerProvider } = require('../out/providers/patch-manager');
    const { ArchiveResourceProvider } = require('../out/utils/archive-resource-provider');
    Module._load = originalLoad;
    const { openArchiveIndexed } = require('../out/utils/archive-index');
    const context = { extensionPath: path.resolve(__dirname, '..'), subscriptions: [], secrets:{get:async()=> 'stale-secret'},
      workspaceState: { get() {}, async update() {} } };
    const source = path.join(root, 'many.pak'); buildFixture(source, 'fixture', new Set([1260]));
    const opened = await openArchiveIndexed({ extensionPath: context.extensionPath, indexRoot, pakPath: source, password: 'fixture', willIdx: 1 });
    const workbenchOpens=[];
    const manager = new PatchManagerProvider(context,(archiveId,password)=>workbenchOpens.push({archiveId,password}));
    manager.validateSelections = () => true;
    manager.clientLayout = () => ({ dataRoots: [root], availableCustomPatchDirectories: [], customPatchDirectories: [], mapRoots: [], wavRoots: [] });
    const entry = { path: source, name: 'many.pak', status: 'cached', canVerify: true, progress: 100, message: 'indexed' };
    manager.entries = [entry];
    manager.readPasswordRecords=()=>[{configuredPath:'many.pak',password:'fixture',configPath:path.join(root,'Pak.txt')}];
    manager.passwordDataRoot=()=>root;
    await manager.openResourceEditor(source);
    assert.deepEqual(workbenchOpens,[{archiveId:opened.archiveId,password:'fixture'}], 'PAK workbench uses configured password, not only JPK');
    manager.view = { webview: { postMessage(message) { messages.push(JSON.parse(JSON.stringify(message))); } } };
    await manager.handleMessage({ type: 'verifyPak', path: path.join(root, 'not-listed.pak') });
    assert.equal(messages.length, 0, 'unlisted Webview paths cannot start verification');
    const post = manager.postEntry.bind(manager);
    manager.postEntry = updated => {
      post(updated);
      if (updated.message.startsWith('验证 ') && updated.progress > 1) {
        void manager.handleMessage({ type: 'cancelVerification', path: source });
      }
    };
    await manager.handleMessage({ type: 'verifyPak', path: source });
    assert.equal(entry.verification, 'cancelled'); assert.equal(manager.busy, false);
    manager.postEntry = post;
    await manager.handleMessage({ type: 'verifyPak', path: source });
    assert.equal(entry.verification, 'complete'); assert.equal(manager.busy, false);
    assert.match(entry.message, /失败 1/);
    await manager.handleMessage({ type: 'verificationDetails', path: source });
    assert.equal(shown.length, 1);
    const details = JSON.parse(documents[0].content);
    assert.equal(details.counts.corrupt, 1); assert.equal(details.failures[0].id, 1260);
    assert.equal(details.counts.decoded, 1654); assert.equal(details.counts.empty, 4);
    assert.doesNotMatch(documents[0].content, /password|jpkRc4State|passwordHash/i);
    // Switching engine during a running verification cancels it before restoring a new view.
    await openArchiveIndexed({ extensionPath: context.extensionPath, indexRoot, pakPath: source, password: 'fixture', willIdx: 1, forceRefresh: true });
    manager.autoLoadOrCache = async () => {};
    manager.postEntry = updated => {
      post(updated);
      if (updated.message.startsWith('验证 ') && updated.progress > 1 && !manager.pendingEngine) void manager.switchEngine('GEE');
    };
    await manager.handleMessage({ type: 'verifyPak', path: source });
    assert.equal(entry.verification, 'cancelled'); assert.equal(manager.engine, 'GEE');
    assert.equal(manager.busy, false); assert.equal(manager.entries.length, 0);
    assert.equal(manager.verificationReports.size, 0, 'engine switch cannot retain another engine report');
    manager.entries = [entry]; manager.postEntry = post;
    await manager.handleMessage({ type: 'verifyPak', path: source });
    // Successful in-memory resource hits must still reject a changed source.
    provider = new ArchiveResourceProvider(context.extensionPath, indexRoot);
    const uri = { scheme: 'boo-archive', path: `/${opened.archiveId}/0.png` };
    await provider.readFile(uri); assert.equal(provider.imageCache.size, 1);
    const bytes = fs.readFileSync(source); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(source, bytes);
    await assert.rejects(provider.readFile(uri), /变化/);
    await manager.handleMessage({ type: 'verificationDetails', path: source });
    assert.equal(shown.length, 1, 'stale report must not reopen as current evidence');
    assert.equal(entry.hasVerificationDetails, false);
    const closedProvider = new ArchiveResourceProvider(context.extensionPath, indexRoot);
    closedProvider.dispose();
    await assert.rejects(closedProvider.readFile(uri), /已关闭/);
    console.log('patch-verification-provider.test.js: PASS (real Worker, path guard, cancel/resume, details, stale LRU/report)');
  } finally {
    provider?.dispose(); Module._load = originalLoad;
    storage.getArchiveIndexRoot = getIndex; storage.getPatchCacheRoot = getPatch;
    removeTemporaryDirectory(root);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
