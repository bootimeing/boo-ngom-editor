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
  const emit = (name, data) => { for (const callback of handlers[name] || []) callback(data); };
  const uri = filePath => ({ scheme: 'file', fsPath: filePath });
  const watcher = { dispose() {}, onDidChange: event('diskChange'), onDidCreate: event('diskCreate'), onDidDelete: event('diskDelete') };
  let watcherCreations = 0;
  const workspace = {
    workspaceFolders: [{ uri: uri(temporary) }], textDocuments: [],
    asRelativePath: filePath => path.relative(temporary, filePath),
    getWorkspaceFolder: target => target.fsPath.startsWith(temporary + path.sep) ? workspace.workspaceFolders[0] : undefined,
    createFileSystemWatcher: () => { watcherCreations++; return watcher; },
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

  // Advance the Provider's debounce explicitly; scanner IO and microtasks remain real.
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const timers = new Map();
  let timerId = 0;
  global.setTimeout = callback => { const id = ++timerId; timers.set(id, callback); return id; };
  global.clearTimeout = id => { timers.delete(id); };
  const flushTimers = () => {
    const scheduled = [...timers];
    for (const [id, callback] of scheduled) if (timers.delete(id)) callback();
  };
  const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  };
  async function bounded(promise, message) {
    let timeout;
    try {
      return await Promise.race([Promise.resolve(promise), new Promise((_, reject) => {
        timeout = originalSetTimeout(() => reject(new Error(message)), 5000);
      })]);
    } finally { originalClearTimeout(timeout); }
  }
  async function until(predicate, message) {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(message);
      await new Promise(resolve => originalSetTimeout(resolve, 5));
    }
  }

  const context = { subscriptions: [] };
  let published, publishes = 0, refreshes = 0, scanCalls = 0;
  const log = [];
  const publicationNames = [];
  const provider = new production.VariableListProvider({
    workspaceState: { get: (key, fallback) => fallback },
    publish: snapshot => {
      published = snapshot; publishes++;
      publicationNames.push([...snapshot.usages.keys()].sort());
    },
    log: message => log.push(message), invalidateDependencies() {},
  });
  const realScan = provider.scanner.scan.bind(provider.scanner);
  let nextScanGate;
  provider.scanner.scan = async (...args) => {
    scanCalls++;
    const gate = nextScanGate;
    nextScanGate = undefined;
    if (gate) { gate.started.resolve(); await gate.release.promise; }
    return realScan(...args);
  };
  production.registerVariableListRefresh(context, provider);
  const uiReads = [];
  provider.onDidChangeTreeData(() => {
    refreshes++;
    // A real TreeView queries its provider after a change event.
    uiReads.push(Promise.resolve(provider.getChildren()));
  });
  const items = async () => (await bounded(provider.getChildren(), 'tree query unexpectedly waited for a held scan')).flatMap(group => group.children || []);
  const names = async () => (await items()).map(item => item.label).sort();
  async function completedRefresh(action) {
    const before = publishes;
    action();
    flushTimers();
    await until(() => publishes > before, 'saved/manual refresh did not publish a completed snapshot');
    await Promise.all(uiReads.splice(0));
  }
  try {
    assert.deepEqual(await names(), ['N$中文', 'U3']);
    const item = (await items()).find(item => item.label === 'U3');
    assert.deepEqual(item.command.arguments, ['U3']);
    assert.ok(item.tooltip.includes(file));
    assert.equal(item.id, 'variable:U3', 'variable identity must survive a saved refresh');
    const initialUGroup = (await provider.getChildren()).find(group => (group.children || []).some(child => child.label === 'U3'));
    const initialPublishes = publishes;
    await items();
    assert.equal(publishes, initialPublishes, 'cached tree is reused');

    let draft = 'MOV S$草稿 1';
    const document = { uri: uri(file), isDirty: true, getText: () => draft };
    workspace.textDocuments = [document];
    const beforeEdits = { refreshes, publishes, scanCalls };
    for (let i = 0; i < 30; i++) emit('onDidChangeTextDocument', { document, contentChanges: [{ text: String(i) }] });
    draft = 'MOV S$最终草稿 1';
    emit('onDidChangeTextDocument', { document, contentChanges: [] });
    emit('onDidOpenTextDocument', document);
    emit('onDidCloseTextDocument', document);
    flushTimers();
    assert.equal(refreshes, beforeEdits.refreshes, 'typing/open/close/empty changes must not refresh the saved list');
    assert.equal(publishes, beforeEdits.publishes, 'unsaved edits must not publish variable drafts');
    assert.equal(scanCalls, beforeEdits.scanCalls, 'unsaved editing must not restart scans');
    assert.deepEqual(await names(), ['N$中文', 'U3']);

    fs.writeFileSync(file, draft);
    document.isDirty = false;
    const beforeSaveScans = scanCalls;
    await completedRefresh(() => {
      emit('onDidSaveTextDocument', document);
      emit('onDidSaveTextDocument', document);
    });
    assert.equal(scanCalls, beforeSaveScans + 1, 'save bursts are merged into one scan');
    assert.deepEqual(await names(), ['S$最终草稿']);
    assert.equal(published.occurrences.get('S$最终草稿')[0].line, 0);

    const dirtyFile = path.join(scripts, 'dirty.txt');
    fs.writeFileSync(dirtyFile, 'MOV U30 1');
    const dirtyDocument = { uri: uri(dirtyFile), isDirty: true, getText: () => 'MOV A99 1' };
    workspace.textDocuments = [document, dirtyDocument];
    fs.writeFileSync(file, 'MOV U10 1');
    draft = 'MOV U10 1';
    await completedRefresh(() => {
      emit('onDidSaveTextDocument', document);
      // Typing again before the debounce must not leak the new draft into this save.
      document.isDirty = true;
      draft = 'MOV U999 1';
      emit('onDidChangeTextDocument', { document, contentChanges: [{ text: '9' }] });
    });
    assert.deepEqual(await names(), ['U10', 'U30'], 'a saved refresh reads disk for every dirty document');
    const updatedUGroup = (await provider.getChildren()).find(group => (group.children || []).some(child => child.label === 'U10'));
    assert.equal(updatedUGroup.id, initialUGroup.id, 'category identity must stay stable when its variable count changes');
    assert.notEqual(updatedUGroup.label, initialUGroup.label, 'this identity test must actually cover a changed group count');
    const settledCounts = { refreshes, scanCalls };
    for (let i = 0; i < 20; i++) await names();
    assert.deepEqual({ refreshes, scanCalls }, settledCounts, 'completed-tree callbacks must not start a refresh/scan loop');

    assert.equal(watcherCreations, 0, 'background file watchers must not rescan for server/log writes');
    const beforeDiskWrites = { refreshes, publishes, scanCalls };
    fs.writeFileSync(file, 'MOV U11 1');
    for (let i = 0; i < 50; i++) emit('diskChange', uri(file));
    emit('diskCreate', uri(file));
    emit('diskDelete', uri(file));
    flushTimers();
    assert.deepEqual({ refreshes, publishes, scanCalls }, beforeDiskWrites, 'external disk events keep the saved tree stable until reload');
    assert.deepEqual(await names(), ['U10', 'U30']);
    await completedRefresh(() => provider.clearCache());
    assert.deepEqual(await names(), ['U11', 'U30'], 'manual/M2 refresh picks up externally saved content, without dirty drafts');

    const added = path.join(scripts, 'added.TXT');
    fs.writeFileSync(added, 'MOV U12 1');
    await completedRefresh(() => emit('onDidCreateFiles', { files: [uri(added)] }));
    assert.ok((await names()).includes('U12'));
    const moved = path.join(scripts, 'moved.txt');
    fs.renameSync(added, moved);
    await completedRefresh(() => emit('onDidRenameFiles', { files: [{ oldUri: uri(added), newUri: uri(moved) }] }));
    assert.equal(published.occurrences.get('U12')[0].file, moved);
    fs.unlinkSync(moved);
    await completedRefresh(() => emit('onDidDeleteFiles', { files: [uri(moved)] }));
    assert.equal((await names()).includes('U12'), false);

    const stableNames = await names();
    const gate = { started: deferred(), release: deferred() };
    nextScanGate = gate;
    fs.writeFileSync(file, 'MOV U20 1');
    const beforeRace = publishes;
    provider.clearCache();
    await bounded(gate.started.promise, 'manual refresh did not start its scan');
    assert.deepEqual(await names(), stableNames, 'the last completed list stays available during a saved refresh');
    fs.writeFileSync(file, 'MOV U21 1');
    draft = 'MOV U21 1';
    document.isDirty = false;
    emit('onDidSaveTextDocument', document);
    flushTimers();
    assert.deepEqual(await names(), stableNames, 'a superseded scan must not clear the visible tree');
    gate.release.resolve();
    await until(() => publishes > beforeRace, 'newest save did not replace the superseded scan');
    assert.deepEqual(await names(), ['U21', 'U30']);
    assert.equal(publicationNames.slice(beforeRace).some(list => list.includes('U20')), false, 'an obsolete saved generation must never publish');

    const workspaceGate = { started: deferred(), release: deferred() };
    nextScanGate = workspaceGate;
    provider.clearCache();
    await bounded(workspaceGate.started.promise, 'workspace race scan did not start');
    const beforeWorkspace = publishes;
    workspace.workspaceFolders = [];
    emit('onDidChangeWorkspaceFolders', {});
    const nextWorkspaceTree = provider.getChildren();
    workspaceGate.release.resolve();
    const transitionalTree = await bounded(nextWorkspaceTree, 'cancelled workspace scan did not complete');
    assert.equal(transitionalTree.some(group => (group.children || []).some(child => child.label === 'U21')), false, 'old workspace items must disappear immediately');
    await until(() => publishes > beforeWorkspace, 'new workspace did not publish its empty snapshot');
    assert.equal((await provider.getChildren())[0].label, '(未打开工作区)');
    assert.equal(published.occurrences.size, 0, 'workspace switching must discard previous jump locations');
    workspace.workspaceFolders = [{ uri: uri(temporary) }];
    await completedRefresh(() => emit('onDidChangeWorkspaceFolders', {}));
    assert.deepEqual(await names(), ['U21', 'U30']);
    assert.deepEqual(log, []);

    const layersFile = path.join(scripts, 'layers.txt');
    fs.writeFileSync(layersFile, [
      'MOV U130 1',
      'READCONFIGFILEITEM slots.ini setup choices N$choice',
      'EQUAL U<$STR(N$choice)> 0',
      'MOV N$exact 130',
      'EQUAL U<$STR(N$exact)> 0',
      'EQUAL U<$STR(N$unknown)> 0',
    ].join('\n'));
    const layersProvider = new production.VariableListProvider({
      workspaceState: { get: (key, fallback) => fallback },
      nestedOptions: () => ({ resolveConfigValues: () => ({ values: ['130', '140'], complete: true }) }),
      publish() {}, log: message => log.push(message), invalidateDependencies() {},
    });
    try {
      const layeredItems = (await layersProvider.getChildren()).flatMap(group => group.children || []);
      const mixed = layeredItems.find(item => item.label === 'U130');
      assert.ok(mixed.description.includes('3处'));
      for (const label of ['直接引用 1处', '确定推导 1处', '可能引用 1处', '不是运行次数', 'U<$STR(N$choice)>', 'layers.txt:3', '值域完整']) {
        assert.ok(mixed.tooltip.includes(label), label);
      }
      assert.ok(mixed.tooltip.includes('不表示线上已经执行'));
      const possible = layeredItems.find(item => item.label === 'U140');
      assert.ok(possible.description.includes('1处 · 可能引用'));
      assert.ok(possible.tooltip.includes('可能编号'));
      const unknown = layeredItems.find(item => item.label === 'U<$STR(N$unknown)>');
      assert.ok(unknown.description.includes('未解动态'));
      assert.ok(unknown.tooltip.includes('原因：'));
      assert.ok(unknown.tooltip.includes('未解出编号'));
      assert.deepEqual(possible.command.arguments, ['U140'], 'evidence labels must not change navigation identity');

      const legacy = layersProvider.buildItems({ usages: new Map([['U7', { type: 'U', count: 2, files: new Set([file]) }]]), occurrences: new Map() });
      assert.ok(legacy[0].children[0].tooltip.includes('源码引用 2处'), 'old snapshots without source metadata remain displayable');
    } finally { layersProvider.dispose(); }

    const scopedFile = path.join(scripts, 'scoped.txt');
    fs.writeFileSync(scopedFile, [
      '#ACT',
      'VAR INTEGER HUMAN Same',
      'VAR INTEGER GUILD Same',
      'CALCVAR HUMAN Same + 5',
      '#SAY',
      '<$HUMAN(Same)> <$GUILD(Same)>',
      '#ACT',
      'CLEARVAR S210 5',
    ].join('\n'));
    for (const engine of ['GOM', 'GEE', '996PC']) {
      const scopedProvider = new production.VariableListProvider({
        engine: () => engine, workspaceState: { get: (key, fallback) => fallback },
        publish() {}, log: message => log.push(message), invalidateDependencies() {},
      });
      try {
        const tree = await scopedProvider.getChildren();
        const scopeItems = tree.flatMap(group => group.children || []);
        const human = scopeItems.find(item => item.label === 'HUMAN(Same)');
        const guild = scopeItems.find(item => item.label === 'GUILD(Same)');
        if (engine === '996PC') {
          assert.equal(human, undefined);
          assert.equal(guild, undefined);
          assert.equal(scopeItems.some(item => item.label === 'S214'), false);
        } else {
          assert.ok(human.description.includes('3处'));
          assert.ok(human.tooltip.includes('<$HUMAN(Same)>'));
          assert.deepEqual(human.command.arguments, ['HUMAN(Same)']);
          assert.ok(guild.description.includes('2处'));
          assert.deepEqual(guild.command.arguments, ['GUILD(Same)']);
          const start = scopeItems.find(item => item.label === 'S210');
          const last = scopeItems.find(item => item.label === 'S214');
          assert.ok(start.description.includes('1处'), 'explicit starting slot is not counted again after expansion');
          assert.ok(last.tooltip.includes('CLEARVAR S210 5'));
          assert.ok(last.tooltip.includes('静态区间覆盖S210-S214'));
          assert.ok(last.tooltip.includes('scoped.txt:8'));
          assert.ok(tree.some(group => group.label.startsWith('HUMAN命名变量(')));
        }
      } finally { scopedProvider.dispose(); }
    }

    const disposalGate = { started: deferred(), release: deferred() };
    nextScanGate = disposalGate;
    provider.clearCache();
    await bounded(disposalGate.started.promise, 'disposal race scan did not start');
    const beforeDispose = publishes;
    provider.dispose();
    disposalGate.release.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(publishes, beforeDispose, 'disposed scans never publish');
    assert.deepEqual(await provider.getChildren(), []);
    console.log('variable-list-provider.test.js: PASS (save-only refresh, stable snapshot, source evidence, named scopes/CLEARVAR, real scanner and mocked VS Code events; not native UI acceptance)');
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    for (const disposable of context.subscriptions) disposable.dispose();
    removeTemporaryDirectory(temporary);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
