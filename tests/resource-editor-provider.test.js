// Actual compiled Provider/model and archive-index with a simulated VS Code host.
// Archive fixture, index, and output paths are confined to this test's temp root.
// Export orchestration is stubbed here; the export test owns actual PNG/manifest IO.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { buildFixture } = require('./gom-reader-tolerance.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtimeRoot = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const runtime = relative => require(path.join(runtimeRoot, 'out', relative));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function uri(scheme, pathname, fsPath = pathname, query = '') {
  return { scheme, path: pathname, fsPath, query,
    toString() { return `${scheme}:${pathname}${query ? `?${query}` : ''}`; },
    with(changes) { return uri(changes.scheme ?? scheme, changes.path ?? pathname, fsPath, changes.query ?? query); },
  };
}
async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${label}`);
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-resource-provider-'));
  const indexRoot = path.join(root, 'archive-index-v1');
  const extensionPath = runtimeRoot;
  const originalLoad = Module._load;
  const storage = runtime('utils/cache-storage');
  const originalGetIndex = storage.getArchiveIndexRoot;
  storage.getArchiveIndexRoot = () => indexRoot;
  const panels = [], executed = [], commandDiscovery = [], pickedOptions = [], exports = [], notifications = [];
  let provider;
  let picker = async () => undefined;
  let exporter = async () => ({ state: 'complete', exported: 1, failed: 0,
    manifestPath: path.join(root, 'exported', 'manifest.json') });
  let information = async () => undefined;
  let fileReader;
  const archive = runtime('utils/archive-index');
  const vscode = {
    ViewColumn: { Active: -1 },
    Uri: {
      file: name => uri('file', name.replace(/\\/g, '/'), name),
      parse: text => { const at = text.indexOf(':'); return uri(text.slice(0, at), text.slice(at + 1)); },
      from: value => uri(value.scheme, value.path),
    },
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } dispose() {} },
    workspace: { fs: { readFile: target => fileReader(target) } },
    commands: {
      getCommands: async (...args) => { commandDiscovery.push(args); return ['workbench.action.moveEditorToNewWindow']; },
      executeCommand: async (...args) => { executed.push(args); },
    },
    window: {
      createWebviewPanel(viewType, title, column, options) {
        const listeners = [], received = [];
        const panel = {
          viewType, title, column, options, disposed: false, reveals: 0, messages: [],
          reveal() { assert.equal(this.disposed, false, 'cannot reveal disposed panel'); this.reveals++; },
          onDidDispose(listener) {
            listeners.push(listener);
            return { dispose() { const at = listeners.indexOf(listener); if (at >= 0) listeners.splice(at, 1); } };
          },
          dispose() { if (this.disposed) return; this.disposed = true; for (const listener of [...listeners]) listener(); },
        };
        panel.webview = {
          cspSource: 'https://test-resource.vscode-cdn.net', html: '',
          asWebviewUri: value => ({ toString: () => `https://test-resource.vscode-cdn.net/${encodeURIComponent(value.toString())}` }),
          postMessage(message) { panel.messages.push(JSON.parse(JSON.stringify(message))); return Promise.resolve(true); },
          onDidReceiveMessage(listener) {
            received.push(listener);
            return { dispose() { const at = received.indexOf(listener); if (at >= 0) received.splice(at, 1); } };
          },
        };
        panels.push(panel);
        return panel;
      },
      showOpenDialog: async options => { pickedOptions.push(options); return picker(options); },
      showInformationMessage: async (...args) => { notifications.push(args); return information(...args); },
    },
  };
  const exportStub = { exportArchiveImages: async options => { exports.push(options); return exporter(options); } };
  try {
    Module._load = function(request, parent, isMain) {
      if (request === 'vscode') return vscode;
      if (request === '../resource-editor/export' && /[\\/]providers[\\/]resource-editor\.js$/.test(parent?.filename || '')) return exportStub;
      return originalLoad.call(this, request, parent, isMain);
    };
    const providerPath = require.resolve(path.join(runtimeRoot, 'out/providers/resource-editor'));
    assert.equal(path.dirname(providerPath), path.join(runtimeRoot, 'out/providers'));
    const { ResourceEditorProvider } = require(providerPath);
    Module._load = originalLoad;
    const model = runtime('resource-editor/model');
    const source = path.join(root, 'many.pak');
    buildFixture(source, 'fixture', new Set([1260]));
    const beforeSha = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const opened = await archive.openArchiveIndexed({ extensionPath, indexRoot,
      pakPath: source, password: 'fixture', willIdx: 1 });
    fileReader = target => {
      const match = /^\/([a-f0-9]{64})\/(\d+)\.png$/.exec(target.path);
      assert.ok(match);
      return archive.readArchiveImagePng({ extensionPath, indexRoot, archiveId: match[1], imageIndex: Number(match[2]) });
    };
    provider = new ResourceEditorProvider({ extensionPath });
    await assert.rejects(provider.openArchive('../arbitrary'), /标识/);
    await assert.rejects(provider.openArchive('f'.repeat(64)));
    assert.equal(panels.length, 0);
    await provider.openArchive(opened.archiveId);
    const panel = panels[0], entry = provider.panels.get(opened.archiveId);
    assert.equal(panel.viewType, 'boo.resourceEditor');
    assert.equal(panel.column, vscode.ViewColumn.Active, 'resource workbench opens in the active VS Code editor group');
    assert.equal(panel.options.enableScripts, true);
    assert.equal(panel.options.retainContextWhenHidden, true);
    assert.deepEqual(panel.options.localResourceRoots.map(value => value.scheme), ['file', 'boo-archive']);
    assert.equal(panel.options.localResourceRoots[0].fsPath, path.join(extensionPath, 'resources'));
    assert.equal(panel.options.localResourceRoots[1].path, `/${opened.archiveId}/`);
    assert.equal((panel.webview.html.match(/http-equiv="Content-Security-Policy"/g) || []).length, 1);
    assert.match(panel.webview.html, /connect-src 'none'/);
    assert.match(panel.webview.html, /script-src-attr 'none'/);
    assert.match(panel.webview.html, /<script nonce="[a-f0-9]+"/);
    assert.doesNotMatch(panel.webview.html, /\{\{ICON_URI\}\}/);
    assert.ok(panel.webview.html.includes(encodeURIComponent(vscode.Uri.file(path.join(extensionPath, 'resources', 'icon.png')).toString())));
    await provider.openArchive(opened.archiveId);
    assert.equal(panels.length, 1, 'same generation reuses the existing panel');
    assert.equal(panel.reveals, 1);

    const docA = 'document_A_001', docB = 'document_B_002', docC = 'document_C_003';
    const send = message => provider.handleMessage(entry, message);
    const ready = documentId => send({ type: 'ready', documentId });
    const assertEditorTabOnly = async label => {
      // Exercise the real event loop beyond the former 350ms auto-float delay.
      // Do not clear timers or invoke private floating helpers to mask a regression.
      await new Promise(resolve => setTimeout(resolve, 425));
      assert.equal(commandDiscovery.length, 0, `${label}: must not discover floating-window commands`);
      assert.equal(executed.some(args => args[0] === 'workbench.action.moveEditorToNewWindow'), false,
        `${label}: must not move the workbench to another window`);
    };
    const request = (type, requestId, extra = {}, documentId = entry.documentId) => ({
      type, sessionId: entry.sessionId, documentId, requestId, ...extra,
    });
    const states = () => panel.messages.filter(message => message.type === 'state');
    await ready(docA);
    await assertEditorTabOnly('first ready');
    await ready(docA);
    await assertEditorTabOnly('repeated ready');
    const initial = states().at(-1);
    assert.equal(initial.slots.length, 100);
    assert.equal(initial.pageSize, 100);
    assert.equal(initial.start, 0);
    assert.equal(initial.slots[0].index, 0);
    assert.equal(initial.slots.at(-1).index, 99);
    assert.equal(initial.canEdit, false);
    assert.equal(initial.canExport, true);
    assert.ok(initial.slots.find(slot => slot.imageUrl).imageUrl.includes(encodeURIComponent(`generation=${opened.indexGeneration}`)),
      'browser image URL binds the active index generation');
    assert.doesNotMatch(JSON.stringify(panel.messages), /password|jpkRc4State|passwordHash|fixture|pakPath|sourceSha256/);

    for (const index of [-1, 0.5, NaN, Infinity, opened.slotCount, '0', null]) {
      assert.throws(() => model.parseResourceEditorMessage(request('inspect', 1, { index }), entry.sessionId, docA, opened.slotCount));
    }
    assert.equal(model.resourceEditorPageStart(0, 0), 0);
    assert.throws(() => model.resourceEditorPageStart(1, 0));
    assert.deepEqual(model.parseResourceExportSelection({ kind: 'ids', ids: [9, 0, 5] }, 10), { kind: 'ids', ids: [0, 5, 9] });
    for (const selection of [
      { kind: 'ids', ids: [] }, { kind: 'ids', ids: [0, 0] }, { kind: 'ids', ids: new Array(10001).fill(0) },
      { kind: 'range', start: 5, end: 4 }, { kind: 'all', path: source }, { kind: 'all', password: 'not-a-real-secret' },
    ]) assert.throws(() => model.parseResourceExportSelection(selection, opened.slotCount));
    const beforeBad = panel.messages.length;
    for (const message of [null, [], {}, request('inspect', 1, { index: -1 }), request('inspect', 1, { index: 0, path: source }),
      request('export', 1, { selection: { kind: 'all' }, password: 'not-a-real-secret' }),
      request('import', 1, { path: source }), request('save', 1), request('setOffset', 1, { index: 0, x: 0, y: 0 }),
      { ...request('inspect', 1, { index: 0 }), sessionId: 'bad-session' }]) await send(message);
    assert.equal(panel.messages.length, beforeBad, 'malformed, path, password, write, and wrong-session messages are silently rejected');
    assert.equal(entry.lastRequestId, 0, 'invalid requests cannot consume the valid request sequence');

    await send(request('page', 1, { start: 199 }));
    assert.equal(states().at(-1).start, 100);
    assert.equal(states().at(-1).slots.length, 100);
    await send(request('jump', 2, { index: 0 }));
    await until(() => !entry.inspecting, 'ID 0 inspect');
    assert.equal(states().at(-1).focusIndex, 0);
    assert.equal(states().at(-1).start, 0);
    assert.equal(panel.messages.filter(message => message.type === 'detail').at(-1).slot.index, 0);
    await send(request('jump', 3, { index: opened.slotCount - 1 }));
    await until(() => !entry.inspecting, 'tail inspect');
    const tail = states().at(-1);
    assert.equal(tail.start, 1600);
    assert.equal(tail.slots.length, 59);
    assert.equal(tail.slots.at(-1).index, opened.slotCount - 1);
    const beforeDuplicate = panel.messages.length;
    await send(request('page', 3, { start: 0 }));
    assert.equal(panel.messages.length, beforeDuplicate, 'replayed request IDs are ignored');

    const pendingRead = deferred();
    fileReader = () => pendingRead.promise;
    await send(request('inspect', 4, { index: 0 }));
    assert.equal(entry.inspecting, true);
    await ready(docB);
    await assertEditorTabOnly('replacement document ready');
    assert.equal(entry.documentId, docB);
    assert.equal(entry.lastRequestId, 0);
    assert.equal(states().at(-1).start, 1600, 'DOM rebuild replays the same page');
    pendingRead.resolve(Buffer.alloc(0));
    await until(() => !entry.inspecting, 'old document inspect drain');
    assert.equal(panel.messages.some(message => message.type === 'detail' && message.requestId === 4), false);
    const beforeOldDoc = panel.messages.length;
    await send(request('page', 99, { start: 0 }, docA));
    assert.equal(panel.messages.length, beforeOldDoc, 'old document action rejected');
    await ready(docA);
    assert.equal(entry.documentId, docB, 'retired document ready must not reactivate an old DOM');

    await send(request('export', 1, { selection: { kind: 'all' } }));
    assert.equal(pickedOptions.length, 1);
    assert.equal(pickedOptions[0].canSelectFolders, true);
    assert.equal(pickedOptions[0].canSelectFiles, false);
    assert.equal(entry.busy, false, 'cancelled directory picker releases busy state');
    assert.equal(exports.length, 0);
    assert.equal(panel.messages.at(-1).busy, false);

    const pendingPicker = deferred();
    picker = () => pendingPicker.promise;
    const switchedPicker = send(request('export', 2, { selection: { kind: 'ids', ids: [0] } }));
    assert.equal(entry.busy, true);
    await ready(docC);
    pendingPicker.resolve([vscode.Uri.file(root)]);
    await switchedPicker;
    assert.equal(exports.length, 0, 'old DOM directory choice cannot begin an export in the new DOM');
    assert.equal(entry.busy, false);

    picker = async () => [vscode.Uri.file(root)];
    const pendingExport = deferred(), pendingToast = deferred();
    exporter = () => pendingExport.promise;
    information = () => pendingToast.promise;
    const activeExport = send(request('export', 1, { selection: { kind: 'ids', ids: [0] } }));
    await until(() => exports.length === 1, 'start export orchestration');
    const options = exports[0];
    assert.equal(options.archiveId, opened.archiveId);
    assert.equal(options.indexGeneration, opened.indexGeneration);
    assert.equal(options.destinationParent, root);
    assert.deepEqual(options.selection, { kind: 'ids', ids: [0] });
    assert.equal(options.signal.aborted, false);
    await send(request('cancelExport', 2));
    assert.equal(options.signal.aborted, true);
    pendingExport.resolve({ state: 'cancelled', exported: 0, failed: 0, manifestPath: path.join(root, 'unfinished', 'manifest.json') });
    await until(() => !entry.busy, 'busy state must not depend on dismissing informational toast');
    pendingToast.resolve(undefined);
    await activeExport;

    const pendingDisposePicker = deferred();
    picker = () => pendingDisposePicker.promise;
    const disposedPicker = send(request('export', 3, { selection: { kind: 'all' } }));
    assert.equal(entry.busy, true);
    panel.dispose();
    const messagesAtDispose = panel.messages.length, exportCountAtDispose = exports.length;
    pendingDisposePicker.resolve([vscode.Uri.file(root)]);
    await disposedPicker;
    assert.equal(exports.length, exportCountAtDispose);
    assert.equal(panel.messages.length, messagesAtDispose, 'disposed panel receives no late output');
    await assertEditorTabOnly('disposed panel');
    assert.equal(provider.panels.size, 0);

    await provider.openArchive(opened.archiveId);
    const reopened = panels.at(-1), reopenedEntry = provider.panels.get(opened.archiveId);
    assert.equal(reopened.column, vscode.ViewColumn.Active);
    await provider.handleMessage(reopenedEntry, { type: 'ready', documentId: 'reopened_doc_1' });
    assert.equal(reopened.disposed, false);

    for (let serial = 1; serial < 128; serial++) {
      await provider.handleMessage(reopenedEntry, { type: 'ready', documentId: `bounded_document_${serial}` });
    }
    const lastAllowedDocument = reopenedEntry.documentId;
    assert.equal(reopenedEntry.documents.size, 128);
    const beforeOverLimit = reopened.messages.length;
    await provider.handleMessage(reopenedEntry, { type: 'ready', documentId: 'bounded_document_overflow' });
    await provider.handleMessage(reopenedEntry, { type: 'ready', documentId: 'reopened_doc_1' });
    assert.equal(reopenedEntry.documentId, lastAllowedDocument, 'document limit cannot evict and reactivate a retired DOM');
    assert.equal(reopened.messages.length, beforeOverLimit);
    await assertEditorTabOnly('reopened and rotated document limit');

    const staleRead = deferred();
    fileReader = () => staleRead.promise;
    await provider.handleMessage(reopenedEntry, { type: 'inspect', sessionId: reopenedEntry.sessionId,
      documentId: reopenedEntry.documentId, requestId: 1, index: 0 });
    await archive.openArchiveIndexed({ extensionPath, indexRoot, pakPath: source,
      password: 'fixture', willIdx: 1, forceRefresh: true });
    staleRead.resolve(Buffer.alloc(0));
    await until(() => !reopenedEntry.inspecting, 'stale generation inspect');
    assert.equal(reopened.messages.some(message => message.type === 'detail'), false,
      'stale generation never becomes a current detail or corruption verdict');
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), beforeSha,
      'Provider and fixture inspection never change archive bytes');
    provider.dispose();
    assert.equal(reopened.disposed, true);
    console.log('resource-editor-provider.test.js: PASS (compiled Provider/model, synthetic archive, simulated host; no native UI or real export IO)');
  } finally {
    provider?.dispose();
    Module._load = originalLoad;
    storage.getArchiveIndexRoot = originalGetIndex;
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
    removeTemporaryDirectory(resolved);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
