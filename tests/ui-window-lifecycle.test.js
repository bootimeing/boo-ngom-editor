// Exercise the compiled production panel lifecycle; VS Code transport/timers are doubles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const filename = path.join(runtime, 'out/extension.js');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['openEditorPanel', 'createEditorPanel'];
const functions = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
assert.equal(functions.length, names.length);
const moveCommand = 'workbench.action.moveEditorToNewWindow';
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function harness(options = {}) {
  const panels = [], events = [], timers = [], restores = [], replays = [], warnings = [], sent = [], dialogs = [];
  const context = { extensionPath: runtime, subscriptions: [] };
  const sandbox = {
    currentPanel: undefined, path, resourceRootsSet: new Set(), loadedPakResults: new Map(), archiveOperationVersion: 1,
    engine_registry_1: { normalizeEngineId: value => value },
    archive_resource_provider_1: { webviewResourceRoots: value => [...value] },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    getWebviewContent: () => '<html>ready</html>',
    restoreOpenedPakFiles: (panel, ctx) => { assert.equal(ctx, context); restores.push(panel); },
    postLoadedPakAssets: panel => { replays.push(panel); },
    vscode: {
      ViewColumn: { Beside: -2 },
      Uri: { file: fsPath => ({ fsPath }) },
      workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
      commands: {
        getCommands: async () => { events.push('getCommands'); return options.getCommands ? options.getCommands() : [moveCommand]; },
        executeCommand: async command => { events.push(['execute', command]); if (options.execute) return options.execute(command); },
      },
      window: {
        showInformationMessage: text => { warnings.push(text); return Promise.resolve(); },
        showWarningMessage: text => { warnings.push(text); return Promise.resolve(); },
        showOpenDialog: () => { const dialog = deferred(); dialogs.push(dialog); return dialog.promise; },
        createWebviewPanel: (type, title, column, config) => {
          const panel = { type, title, column, config, reveals: [],
            reveal(...args) { this.reveals.push(args); events.push(['reveal', panel]); },
            onDidDispose(fn) { this.disposeCallback = fn; },
            dispose() { this.disposeCallback(); },
            webview: {
              postMessage(message) { sent.push(message); return true; },
              asWebviewUri(uri) { return { toString: () => 'webview:' + uri.fsPath }; },
              onDidReceiveMessage(fn) { panel.message = message => fn({ documentId: 'document-' + panels.indexOf(panel), ...message }); },
              set html(value) {
                assert.equal(typeof panel.message, 'function', 'message listener installed before HTML');
                assert.equal(typeof panel.disposeCallback, 'function', 'dispose listener installed before HTML');
                panel.html = value;
              },
            },
          };
          panels.push(panel); return panel;
        },
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(functions.map(n => n.getText(source)).join('\n'), sandbox);
  return { sandbox, panels, events, timers, restores, replays, warnings, sent, dialogs,
    open: () => sandbox.openEditorPanel(context),
    tick: async () => { for (const fn of timers.splice(0)) fn(); await settle(); },
    moves: () => events.filter(e => Array.isArray(e) && e[0] === 'execute'),
  };
}
async function main() {
  let h = harness(); h.open(); const first = h.panels[0];
  assert.equal(first.config.retainContextWhenHidden, true);
  assert.equal(h.moves().length, 0); assert.equal(h.restores.length, 0, 'restore waits for ready');
  await first.message({ type: 'ready' }); await first.message({ type: 'ready' });
  assert.equal(h.restores.length, 1); assert.equal(h.timers.length, 1);
  await h.tick(); assert.deepEqual(h.moves(), [['execute', moveCommand]]);
  const moveIndex = h.events.findIndex(e => Array.isArray(e) && e[0] === 'execute');
  assert.equal(h.events[moveIndex - 1][0], 'reveal', 'target is revealed immediately before moving');
  h.open(); assert.equal(h.panels.length, 1, 'repeat reuses same webview');
  assert.deepEqual(first.reveals.at(-1), [undefined, false], 'repeat does not force floating panel to Beside');
  assert.equal(h.moves().length, 1);
  // VS Code destroys/recreates the iframe when moving between windows.
  await first.message({ type: 'ready', documentId: 'replacement-document' });
  await first.message({ type: 'ready', documentId: 'replacement-document' });
  assert.equal(h.replays.length, 1, 'new DOM receives current compact archive catalog exactly once');
  assert.equal(h.restores.length, 1, 'source packages are not reloaded on every window move');
  await h.tick(); assert.equal(h.moves().length, 1, 'new DOM must not trigger another floating window');
  await first.message({ type: 'ready', documentId: '' });
  await first.message({ type: 'ready', documentId: 12 });
  assert.equal(h.replays.length, 1, 'malformed document identities ignored');
  first.dispose(); h.open(); const second = h.panels[1];
  h.sandbox.loadedPakResults.set('new', {}); first.dispose();
  assert.equal(h.sandbox.currentPanel, second, 'stale dispose cannot clear replacement panel');
  assert.equal(h.sandbox.loadedPakResults.size, 1);
  await first.message({ type: 'ready' }); assert.equal(h.restores.length, 1, 'stale ready ignored');
  await second.message({ type: 'ready' }); await h.tick(); assert.equal(h.moves().length, 2);

  h = harness(); h.open(); const disposedBeforeTimer = h.panels[0];
  await disposedBeforeTimer.message({ type: 'ready' }); disposedBeforeTimer.dispose(); h.open();
  await h.tick(); assert.equal(h.moves().length, 0, 'disposed delayed task cannot move any editor');

  for (const reject of [false, true]) {
    const commands = deferred(); h = harness({ getCommands: () => commands.promise }); h.open();
    const old = h.panels[0]; await old.message({ type: 'ready' }); await h.tick(); old.dispose(); h.open();
    if (reject) commands.reject(Error('late failure')); else commands.resolve([moveCommand]);
    await settle(); assert.equal(h.moves().length, 0); assert.equal(h.warnings.length, 0, 'stale task remains silent');
  }
  for (const options of [
    { getCommands: () => [] },
    { getCommands: () => { throw Error('command registry failed'); } },
    { execute: () => { throw Error('move failed'); } },
  ]) {
    h = harness(options); h.open(); const panel = h.panels[0];
    await panel.message({ type: 'ready' }); await h.tick(); await panel.message({ type: 'ready' }); await h.tick();
    assert.equal(h.warnings.length, 1, 'one concise fallback notification');
    assert.equal(h.sandbox.currentPanel, panel, 'failed float preserves existing editor');
    assert.equal(h.restores.length, 1);
  }
  h = harness(); h.open(); const pickerPanel = h.panels[0];
  await pickerPanel.message({ type: 'ready' });
  const request = { type: 'selectQuickImportFile', importType: 'closeBtn', requestId: 1, sessionId: 1 };
  const oldPicker = pickerPanel.message(request);
  await pickerPanel.message({ type: 'ready', documentId: 'new-picker-document' });
  const newPicker = pickerPanel.message(request);
  h.dialogs[0].resolve([{ fsPath: 'old-frame.png' }]); await oldPicker;
  assert.equal(h.sent.length, 0, 'old document picker cannot collide with new request counters');
  h.dialogs[1].resolve([{ fsPath: 'new-frame.png' }]); await newPicker;
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].name, 'new-frame.png');
  const html = fs.readFileSync(path.join(runtime, 'media/editor.html'), 'utf8');
  assert.match(html, /window\.togglePropsPanel\s*=\s*togglePropsPanel;[\s\S]*?_vscode\.postMessage\(\{\s*type:\s*'ready',\s*documentId:[\s\S]+?\}\);\s*\}\s*\}\)\(\);/,
    'ready sent only after all UI handlers are initialized');
  console.log('ui-window-lifecycle.test.js: PASS (compiled production lifecycle; mocked VS Code/timers; ready, single instance, disposal races, fallback)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
