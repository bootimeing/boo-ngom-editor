// Production Provider, Node Worker, JPK core and index IO; VS Code dialogs/messages are simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const Module = require('node:module');
const { fixture, password } = require('./resource-editor-jpk.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtimeRoot = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const runtime = relative => require(path.join(runtimeRoot, 'out', relative));
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function uri(scheme, pathname, fsPath = pathname, query = '') {
  return { scheme, path: pathname, fsPath, query,
    toString() { return `${scheme}:${pathname}${query ? `?${query}` : ''}`; },
    with(changes) { return uri(changes.scheme ?? scheme, changes.path ?? pathname, fsPath, changes.query ?? query); } };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(predicate, label) {
  const deadline = Date.now() + 10000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(`Timeout: ${label}`); await new Promise(done => setTimeout(done, 5)); }
}
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-edit-provider-'));
  const indexRoot = path.join(root, 'index'), archive = runtime('utils/archive-index'), storage = runtime('utils/cache-storage');
  const originalLoad = Module._load, originalGetIndex = storage.getArchiveIndexRoot, originalOpen = archive.openArchiveIndexed;
  const panels = [], workers = new Set(), notices = [];
  let picker = async () => undefined, savePicker = async () => undefined, warning = async () => undefined;
  let restoreFails = false, picked = 0, provider;
  const vscode = {
    ViewColumn: { Active: -1 },
    Uri: { file: name => uri('file', name.replace(/\\/g, '/'), name), from: v => uri(v.scheme, v.path),
      parse: text => { const at = text.indexOf(':'); return uri(text.slice(0, at), text.slice(at + 1)); } },
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } dispose() {} },
    commands: { executeCommand: () => { throw new Error('No floating-window command allowed'); } },
    workspace: { fs: { readFile: target => {
      const match = /^\/([a-f0-9]{64})\/(\d+)\.png$/.exec(target.path); assert.ok(match);
      return archive.readArchiveImagePng({ extensionPath: runtimeRoot, indexRoot, archiveId: match[1], imageIndex: +match[2] });
    } } },
    window: {
      createWebviewPanel(viewType, title, column, options) {
        if (restoreFails) throw new Error('Injected host restore failure');
        const listeners = [], received = [];
        const panel = { viewType, title, column, options, disposed: false, messages: [], reveal() { assert.ok(!this.disposed); },
          onDidDispose(fn) { listeners.push(fn); return { dispose() { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } }; },
          dispose() { if (this.disposed) return; this.disposed = true; for (const fn of [...listeners]) fn(); } };
        panel.webview = { cspSource: 'https://resource.test', html: '',
          asWebviewUri: value => ({ toString: () => `https://resource.test/${encodeURIComponent(value.toString())}` }),
          postMessage(value) { panel.messages.push(JSON.parse(JSON.stringify(value))); return Promise.resolve(true); },
          onDidReceiveMessage(fn) { received.push(fn); return { dispose() { const i = received.indexOf(fn); if (i >= 0) received.splice(i, 1); } }; } };
        panels.push(panel); return panel;
      },
      showOpenDialog: async options => { picked++; return picker(options); },
      showSaveDialog: async options => savePicker(options),
      showWarningMessage: async (...args) => { notices.push(args[0]); return warning(...args); },
      showInformationMessage: async () => '导入草稿', showInputBox: async () => password,
    },
  };
  try {
    storage.getArchiveIndexRoot = () => indexRoot;
    Module._load = function(request, parent, isMain) { if (request === 'vscode') return vscode; return originalLoad.call(this, request, parent, isMain); };
    const { ResourceEditorProvider } = runtime('providers/resource-editor'); Module._load = originalLoad;
    provider = new ResourceEditorProvider({ extensionPath: runtimeRoot });
    const source = fixture(path.join(root, 'source.jpk')), sourceHash = digest(source);
    const open = async file => {
      const indexed = await archive.openArchiveIndexed({ extensionPath: runtimeRoot, indexRoot, pakPath: file, password, willIdx: 1 });
      await provider.openArchive(indexed.archiveId, password);
      const entry = provider.panels.get(indexed.archiveId); await ready(entry);
      return entry;
    };
    let doc = 0;
    async function ready(entry) { await provider.handleMessage(entry, { type: 'ready', documentId: `test_document_${++doc}` }); }
    async function send(entry, type, extra = {}) {
      const requestId = entry.lastRequestId + 1;
      await provider.handleMessage(entry, { type, sessionId: entry.sessionId, documentId: entry.documentId, requestId,
        ...(['importImage', 'clearSlot', 'setOffsets', 'batchTools', 'exportAnimation', 'undo', 'redo', 'saveAs', 'endEdit'].includes(type) ? { revision: entry.editInfo?.revision ?? 0 } : {}), ...extra });
      if (entry.editClient) workers.add(entry.editClient);
      await until(() => !entry.inspecting, `${type} detail settled`);
      return requestId;
    }
    const state = entry => entry.panel.messages.filter(m => m.type === 'state').at(-1);
    const entry = await open(source); assert.equal(state(entry).canStartEdit, true);
    const beforeRemovedAction=panels.length;
    await send(entry,'createJpk');assert.equal(panels.length,beforeRemovedAction,'removed action cannot open a new package');
    await send(entry, 'beginEdit'); assert.equal(state(entry).editActive, true); assert.equal(state(entry).canExport, false);
    let client = entry.editClient; assert.ok(client); assert.equal(entry.editInfo.slotCount, 9);
    const png = path.join(root, 'image.png'); fs.writeFileSync(png, await client.preview(8));
    const initial = entry.editInfo.revision;
    const controller=new AbortController();controller.abort();
    await assert.rejects(client.prepareBatch({kind:'clear',ids:[0,2]},initial,controller.signal),e=>e.code==='CANCELLED');
    assert.equal((await client.info()).revision,initial);
    const oldInput=vscode.window.showInputBox,oldInformation=vscode.window.showInformationMessage;
    vscode.window.showInputBox=async()=> '0,2';
    await send(entry,'animation');
    const sequence=entry.panel.messages.filter(m=>m.type==='animationFrames').at(-1);
    assert.deepEqual(sequence.frames.map(f=>f.index),[0,1,2]);assert.equal(sequence.frames[1].status,'empty');
    const animationFile=path.join(root,'test.apng');savePicker=async()=>vscode.Uri.file(animationFile);
    await send(entry,'exportAnimation',{ids:[0,1,2],fps:13});assert.equal(fs.readFileSync(animationFile).toString('ascii',37,41),'acTL');
    savePicker=async()=>undefined;
    vscode.window.showQuickPick=async options=>options.find(item=>item.id==='relative');
    vscode.window.showInputBox=async()=> '2,-1';vscode.window.showInformationMessage=async()=> '应用整批';
    await send(entry,'batchTools',{ids:[0,2],index:0});
    assert.equal(entry.editInfo.revision,initial+1);assert.equal((await client.slots(0,1))[0].offsetX,1);
    await send(entry,'undo');assert.equal(entry.editInfo.dirty,false);
    // Start a fresh edit baseline for original sequential revision assertions.
    await send(entry,'endEdit');vscode.window.showInputBox=oldInput;vscode.window.showInformationMessage=oldInformation;
    await send(entry,'beginEdit');
    const reopened=entry.editClient;
    assert.ok(reopened!==client);workers.add(reopened);client=reopened;
    await send(entry, 'setOffsets', { index: 8, x: -32768, y: 32767 });
    assert.equal((await client.slots(8, 1))[0].offsetX, -32768); assert.equal(entry.editInfo.dirty, true);
    await assert.rejects(client.offsets(8, 0, 0, initial), e => e.code === 'STALE_REVISION');
    const revision = entry.editInfo.revision;
    await send(entry, 'setOffsets', { index: 8, x: 0, y: 0, revision: initial }); assert.equal(entry.editInfo.revision, revision);
    await send(entry, 'setOffsets', { index: 8, x: 0, y: 0, path: source }); assert.equal(entry.editInfo.revision, revision);
    await send(entry, 'undo'); assert.equal(entry.editInfo.dirty, false);
    await send(entry, 'redo'); assert.equal(entry.editInfo.dirty, true);
    await send(entry, 'importImage', { mode: 'replace', index: 8 }); assert.equal(entry.editInfo.revision, revision + 2, 'cancelled picker is not an edit');
    picker = async () => [vscode.Uri.file(png)];
    await send(entry, 'importImage', { mode: 'replace', index: 8 }); assert.equal((await client.slots(8, 1))[0].offsetX, -32768);
    await send(entry, 'importImage', { mode: 'fill', index: 1 }); assert.equal((await client.slots(1, 1))[0].status, 'decoded');
    await send(entry, 'importImage', { mode: 'append', index: null }); assert.equal(entry.editInfo.slotCount, 10); assert.equal(entry.focusIndex, 9);
    await send(entry, 'undo'); assert.equal(entry.editInfo.slotCount, 9); assert.equal(entry.focusIndex, undefined);
    await send(entry, 'redo'); assert.equal(entry.editInfo.slotCount, 10);
    warning = async () => '清空槽位';
    await send(entry, 'clearSlot', { index: 8 }); assert.equal((await client.slots(8, 1))[0].status, 'empty');
    await send(entry, 'undo'); assert.equal((await client.slots(8, 1))[0].status, 'decoded');
    const beforeExport = picked; await send(entry, 'export', { selection: { kind: 'all' } }); assert.equal(picked, beforeExport);
    await send(entry, 'saveAs'); assert.equal(entry.editInfo.dirty, true, 'cancel save preserves draft');
    warning = async () => '继续编辑'; await send(entry, 'endEdit'); assert.ok(entry.editClient);
    // A dirty native tab close cannot veto disposal, but must keep the exact worker and history.
    const oldPanel = entry.panel, oldRevision = entry.editInfo.revision;
    oldPanel.dispose(); await until(() => entry.panel !== oldPanel && !entry.closePrompt, 'restore dirty tab');
    await ready(entry); assert.equal(entry.editClient, client); assert.equal(entry.editInfo.revision, oldRevision);
    const pending = deferred(); picker = () => pending.promise;
    const importDuringClose = send(entry, 'importImage', { mode: 'append', index: null });
    await until(() => entry.busy, 'picker opened'); const panelBeforeClose = entry.panel; panelBeforeClose.dispose();
    pending.resolve([vscode.Uri.file(png)]); await importDuringClose;
    await until(() => entry.panel !== panelBeforeClose && !entry.closePrompt, 'restore after picker');
    await ready(entry); assert.equal(entry.editInfo.revision, oldRevision, 'closed picker must not apply import');
    // Failure to restore must not silently discard the worker. Explicit reopen retries.
    restoreFails = true; entry.panel.dispose(); await until(() => !entry.closePrompt, 'failed restore');
    assert.equal(entry.editClient, client); assert.ok(entry.editInfo.dirty); assert.ok(entry.disposed);
    restoreFails = false; await provider.openArchive(entry.summary.archiveId); await ready(entry);
    assert.ok(!entry.disposed); assert.equal(entry.editClient, client);
    const target = path.join(root, 'new.jpk'); savePicker = async () => vscode.Uri.file(target);
    await send(entry, 'saveAs'); assert.ok(fs.existsSync(target)); assert.equal(entry.editInfo.dirty, false);
    assert.equal(entry.summary.pakPath, target); assert.equal(entry.indexUnavailable, false);
    assert.equal(state(entry).name, 'new.jpk'); assert.equal(digest(source), sourceHash);
    assert.equal(provider.panels.get(entry.summary.archiveId), entry);
    await send(entry, 'endEdit'); assert.equal(state(entry).editRevision, 0); assert.equal(state(entry).canExport, true);
    await send(entry, 'beginEdit'); const savedClient = entry.editClient; workers.add(savedClient);
    await send(entry, 'setOffsets', { index: 8, x: -23, y: 0 });
    // Save succeeded but follow-up index creation fails: no fallback to stale source URIs.
    const second = path.join(root, 'new2.jpk'); savePicker = async () => vscode.Uri.file(second);
    archive.openArchiveIndexed = async () => { throw new Error('Injected index failure'); };
    await send(entry, 'saveAs'); archive.openArchiveIndexed = originalOpen;
    assert.ok(fs.existsSync(second)); assert.equal(entry.indexUnavailable, true); assert.equal(entry.savedTarget, second);
    assert.equal(state(entry).name, 'new2.jpk'); assert.ok(state(entry).slots.filter(s => s.imageUrl).every(s => !s.imageUrl.includes('boo-archive')));
    assert.ok(entry.panel.messages.some(m => m.type === 'notice' && /索引重建失败/.test(m.text)));
    await send(entry, 'setOffsets', { index: 8, x: -24, y: 0 }); warning = async () => '放弃修改';
    entry.panel.dispose(); await until(() => !provider.panels.has(entry.summary.archiveId), 'discard releases session');
    const readonly = fixture(path.join(root, 'tail.jpk')); fs.appendFileSync(readonly, Buffer.from([0]));
    const readonlyEntry = await open(readonly); await send(readonlyEntry, 'beginEdit');
    assert.equal(readonlyEntry.editClient, undefined); assert.equal(state(readonlyEntry).canExport, true);
    assert.ok(readonlyEntry.panel.messages.some(m => m.type === 'notice' && /暂仅支持浏览/.test(m.text)));
    assert.match(state(readonlyEntry).notice, /暂仅支持浏览/, 'failed admission must remain visible after final state refresh');
    // Same production UI/Worker path for GOM2, including the correct save suffix and reindexed preview.
    const {fixture:gomFixture} = require('./resource-editor-gom.test');
    const gomSource=gomFixture(path.join(root,'source.pak')),gomHash=digest(gomSource),gomEntry=await open(gomSource);
    assert.equal(state(gomEntry).canStartEdit,true);await send(gomEntry,'beginEdit');assert.equal(gomEntry.editInfo.profileId,'gom-gameofmir2-v2');
    const gomClient=gomEntry.editClient, gomImage=path.join(root,'gom.png');fs.writeFileSync(gomImage,await gomClient.preview(12));
    picker=async()=>[vscode.Uri.file(gomImage)];
    await send(gomEntry,'setOffsets',{index:0,x:-23,y:0});await send(gomEntry,'undo');assert.equal(gomEntry.editInfo.dirty,false);
    await send(gomEntry,'redo');assert.equal((await gomClient.slots(0,1))[0].offsetX,-23);
    await send(gomEntry,'importImage',{mode:'replace',index:12});await send(gomEntry,'importImage',{mode:'fill',index:6});
    await send(gomEntry,'importImage',{mode:'append',index:null});assert.equal(gomEntry.editInfo.slotCount,15);
    const gomTarget=path.join(root,'new.pak');savePicker=async options=>{
      assert.deepEqual(options.filters,{PAK:['pak']});assert.ok(options.defaultUri.fsPath.endsWith('-edited.pak'));return vscode.Uri.file(gomTarget);
    };
    await send(gomEntry,'saveAs');assert.equal(gomEntry.indexUnavailable,false);assert.equal(gomEntry.editInfo.dirty,false);
    assert.equal(gomEntry.summary.pakPath,gomTarget);assert.equal(state(gomEntry).name,'new.pak');assert.equal(digest(gomSource),gomHash);
    assert.ok((await archive.readArchiveImagePng({extensionPath:runtimeRoot,indexRoot,archiveId:gomEntry.summary.archiveId,imageIndex:14})).length);
    await send(gomEntry,'endEdit');
    const oldGom=await open(gomFixture(path.join(root,'old.pak'),{variant:1}));assert.equal(state(oldGom).canStartEdit,false);
    await send(oldGom,'beginEdit');assert.equal(oldGom.editClient,undefined);
    const tailGom=await open(gomFixture(path.join(root,'tail.pak'),{tail:true}));await send(tailGom,'beginEdit');assert.equal(tailGom.editClient,undefined);
    const {fixture:pairFixture}=require('./resource-editor-pair.test');
    for(const suffix of ['wil','wzl']){
      const pairSource=pairFixture(path.join(root,'source.'+suffix)),pairEntry=await open(pairSource);await send(pairEntry,'beginEdit');
      assert.equal(pairEntry.editInfo.saveMode,'directory');assert.equal(pairEntry.password,'');
      await send(pairEntry,'setOffsets',{index:0,x:-31,y:17});const folder=path.join(root,'new-'+suffix);
      savePicker=async options=>{assert.match(options.title,/新文件夹/);assert.equal(options.filters,undefined);return vscode.Uri.file(folder);};
      await send(pairEntry,'saveAs');assert.equal(pairEntry.editInfo.dirty,false);assert.equal(pairEntry.indexUnavailable,false);
      assert.equal(pairEntry.summary.pakPath,path.join(folder,path.basename(pairSource)));assert.ok(pairEntry.summary.companionSha256);
      await send(pairEntry,'endEdit');
    }
    for (const panel of panels) {
      const json = JSON.stringify(panel.messages); assert.doesNotMatch(json, /password|rc4State|jpkRc4State|sourcePath|sourceSha256|pakPath/);
      assert.ok(!json.includes(password)); assert.equal(panel.column, -1);
    }
    assert.equal(digest(source), sourceHash);
    console.log('resource-editor-edit-provider.test.js: PASS (actual Worker/core/index IO; simulated host; edit/revisions/save/reindex failure/close restore/cancel/privacy)');
  } finally {
    Module._load = originalLoad; storage.getArchiveIndexRoot = originalGetIndex; archive.openArchiveIndexed = originalOpen;
    provider?.dispose(); await Promise.all([...workers].map(client => client.dispose()));
    removeTemporaryDirectory(root);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
