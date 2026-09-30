const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-var-provider-'));
  const scripts = path.join(temporary, 'Envir/Market_Def');
  fs.mkdirSync(scripts, { recursive: true });
  const file = path.join(scripts, 'main.txt');
  fs.writeFileSync(file, 'MOV N$中文 1\nMOV U3 1');
  const handlers = {};
  function event(name) {
    handlers[name] = new Set();
    return callback => { handlers[name].add(callback); return { dispose: () => handlers[name].delete(callback) }; };
  }
  const emit = (name, data) => { for (const callback of handlers[name]) callback(data); };
  const uri = filePath => ({ scheme: 'file', fsPath: filePath });
  const watcher = { dispose() {}, onDidChange: event('diskChange'), onDidCreate: event('diskCreate'), onDidDelete: event('diskDelete') };
  const workspace = {
    workspaceFolders: [{ uri: uri(temporary) }], textDocuments: [],
    asRelativePath: filePath => path.relative(temporary, filePath),
    getWorkspaceFolder: target => target.fsPath.startsWith(temporary + path.sep) ? workspace.workspaceFolders[0] : undefined,
    createFileSystemWatcher: pattern => { assert.ok(pattern.includes('[tT][xX][tT]')); return watcher; },
  };
  for (const name of ['onDidChangeTextDocument', 'onDidSaveTextDocument', 'onDidOpenTextDocument', 'onDidCloseTextDocument', 'onDidCreateFiles', 'onDidDeleteFiles', 'onDidRenameFiles', 'onDidChangeWorkspaceFolders']) workspace[name] = event(name);
  const vscode = {
    workspace,
    TreeItem: class { constructor(label, collapsibleState) { Object.assign(this, { label, collapsibleState }); } },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
    EventEmitter: class { callbacks = new Set(); event = callback => { this.callbacks.add(callback); return { dispose: () => this.callbacks.delete(callback) }; }; fire() { for (const callback of this.callbacks) callback(); } dispose() { this.callbacks.clear(); } },
  };
  const originalLoad = Module._load;
  let production;
  try {
    Module._load = function(request, ...args) { return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args); };
    production = require('../out/providers/variable-list');
  } finally { Module._load = originalLoad; }
  const context = { subscriptions: [] };
  let published, publishes = 0, refreshes = 0;
  const log = [];
  const provider = new production.VariableListProvider({
    workspaceState: { get: (key, fallback) => fallback },
    publish: snapshot => { published = snapshot; publishes++; }, log: message => log.push(message), invalidateDependencies() {},
  });
  production.registerVariableListRefresh(context, provider);
  provider.onDidChangeTreeData(() => refreshes++);
  const items = async () => (await provider.getChildren()).flatMap(group => group.children || []);
  const names = async () => (await items()).map(item => item.label);
  try {
    assert.ok((await names()).includes('N$中文'));
    const item = (await items()).find(item => item.label === 'U3');
    assert.deepEqual(item.command.arguments, ['U3']);
    assert.ok(item.tooltip.includes(file));
    const initialPublishes = publishes;
    await items();
    assert.equal(publishes, initialPublishes, 'cached tree is reused');
    let draft = 'MOV S$草稿 1';
    const document = { uri: uri(file), getText: () => draft };
    workspace.textDocuments = [document];
    emit('onDidChangeTextDocument', { document });
    draft = 'MOV S$最终草稿 1';
    emit('onDidChangeTextDocument', { document });
    assert.equal(refreshes, 0, 'edits are coalesced before refresh');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(refreshes, 1);
    assert.deepEqual(await names(), ['S$最终草稿']);
    assert.equal(published.occurrences.get('S$最终草稿')[0].line, 0);
    workspace.textDocuments = [];
    emit('onDidCloseTextDocument', document);
    assert.ok((await names()).includes('N$中文'), 'discarded draft returns to disk');

    fs.writeFileSync(file, 'MOV U10 1');
    emit('onDidSaveTextDocument', document);
    assert.deepEqual(await names(), ['U10']);
    fs.writeFileSync(file, 'MOV U11 1');
    emit('diskChange', uri(file));
    assert.deepEqual(await names(), ['U11']);
    const added = path.join(scripts, 'added.TXT');
    fs.writeFileSync(added, 'MOV U12 1');
    emit('onDidCreateFiles', { files: [uri(added)] });
    assert.ok((await names()).includes('U12'));
    const moved = path.join(scripts, 'moved.txt');
    fs.renameSync(added, moved);
    emit('onDidRenameFiles', { files: [{ oldUri: uri(added), newUri: uri(moved) }] });
    await names();
    assert.equal(published.occurrences.get('U12')[0].file, moved);
    fs.unlinkSync(moved);
    emit('onDidDeleteFiles', { files: [uri(moved)] });
    assert.equal((await names()).includes('U12'), false);
    fs.writeFileSync(added, 'MOV U13 1');
    emit('diskCreate', uri(added));
    assert.ok((await names()).includes('U13'));
    fs.unlinkSync(added);
    emit('diskDelete', uri(added));
    assert.equal((await names()).includes('U13'), false);

    provider.clearCache();
    const beforeRace = publishes;
    const pending = provider.getChildren();
    workspace.workspaceFolders = [];
    emit('onDidChangeWorkspaceFolders', {});
    await pending;
    assert.equal(publishes, beforeRace, 'old workspace scan must never publish');
    assert.equal((await provider.getChildren())[0].label, '(未打开工作区)');
    assert.equal(published.occurrences.size, 0);
    workspace.workspaceFolders = [{ uri: uri(temporary) }];
    emit('onDidChangeWorkspaceFolders', {});
    assert.deepEqual(await names(), ['U11']);
    assert.deepEqual(log, []);
    provider.clearCache();
    const beforeDispose = publishes;
    const disposing = provider.getChildren();
    provider.dispose();
    await disposing;
    assert.equal(publishes, beforeDispose);
    assert.deepEqual(await provider.getChildren(), []);
    console.log('variable-list-provider.test.js: PASS (real provider, mocked VS Code events; not native UI acceptance)');
  } finally {
    for (const disposable of context.subscriptions) disposable.dispose();
    removeTemporaryDirectory(temporary);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
