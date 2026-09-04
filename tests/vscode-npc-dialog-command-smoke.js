const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'boo1213.boo-ngom-editor';
const COMMAND_ID = 'boo.openNpcDialogVisualEditor';
const VIEW_TYPE = 'booNpcDialogVisualEditor';
const EXPECTED_TITLE = 'NPC界面 @main';
const RESULT_PATH = process.env.BOO_NPC_DIALOG_HOST_SMOKE_RESULT
  || path.join(os.tmpdir(), 'boo-npc-dialog-host-smoke.json');

function matchesViewType(value) {
  return value === VIEW_TYPE || value === `mainThreadWebview-${VIEW_TYPE}`;
}

function withTimeout(promise, milliseconds, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${milliseconds}ms`)),
      milliseconds
    );
    Promise.resolve(promise).then(value => {
      clearTimeout(timer);
      resolve(value);
    }, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function npcDialogTabs() {
  return vscode.window.tabGroups.all.flatMap(group => group.tabs.filter(tab => (
    tab.input instanceof vscode.TabInputWebview
    && matchesViewType(tab.input.viewType)
  )));
}

async function runScenario() {
  const startedAt = Date.now();
  assert.equal(
    typeof vscode.TabInputWebview,
    'function',
    'this VS Code host does not expose TabInputWebview'
  );

  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `BOO development extension was not found: ${EXTENSION_ID}`);
  assert.ok(
    extension.packageJSON.activationEvents?.includes(`onCommand:${COMMAND_ID}`),
    `manifest activation event is missing: onCommand:${COMMAND_ID}`
  );
  assert.ok(
    extension.packageJSON.contributes?.commands?.some(entry => entry.command === COMMAND_ID),
    `manifest command is missing: ${COMMAND_ID}`
  );
  const keybinding = extension.packageJSON.contributes?.keybindings?.find(entry => (
    entry.command === COMMAND_ID && String(entry.key).toLowerCase() === 'ctrl+f12'
  ));
  assert.ok(keybinding, 'manifest Ctrl+F12 keybinding is missing');
  const when = String(keybinding.when || '').replace(/\s+/g, ' ').trim();
  assert.match(when, /\beditorTextFocus\b/);
  assert.match(when, /\beditorLangId\s*==\s*gomscript\b/);

  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  assert.equal(
    workspaceFolders.length,
    1,
    'the smoke must run with exactly one isolated workspace folder'
  );
  const sourceUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'npc-smoke.txt');
  const beforeBytes = Buffer.from(await vscode.workspace.fs.readFile(sourceUri));

  await withTimeout(extension.activate(), 20_000, 'extension activation');
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes(COMMAND_ID), `registered command is missing: ${COMMAND_ID}`);

  let document = await vscode.workspace.openTextDocument(sourceUri);
  if (document.languageId !== 'gomscript') {
    document = await vscode.languages.setTextDocumentLanguage(document, 'gomscript');
  }
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.One,
    preserveFocus: false,
    preview: false,
  });
  const cursor = new vscode.Position(2, 0);
  editor.selection = new vscode.Selection(cursor, cursor);
  assert.equal(document.languageId, 'gomscript');
  assert.equal(
    vscode.window.activeTextEditor?.document.uri.toString(),
    sourceUri.toString(),
    'fixture is not the active text editor'
  );
  assert.match(document.getText(), /\[@main\]/i);
  assert.equal(document.isDirty, false);
  assert.deepEqual(
    npcDialogTabs(),
    [],
    'an NPC dialog Webview tab already existed before the command'
  );

  let resolveOpened;
  const opened = new Promise(resolve => { resolveOpened = resolve; });
  let openedResolved = false;
  const subscription = vscode.window.tabGroups.onDidChangeTabs(event => {
    const tab = event.opened.find(candidate => (
      candidate.input instanceof vscode.TabInputWebview
      && matchesViewType(candidate.input.viewType)
    ));
    if (tab && !openedResolved) {
      openedResolved = true;
      resolveOpened(tab);
    }
  });

  let panelTab;
  let panelClosed = false;
  let observed;
  try {
    await withTimeout(vscode.commands.executeCommand(COMMAND_ID), 20_000, 'Ctrl+F12 command');
    panelTab = await withTimeout(opened, 5_000, 'NPC dialog Webview tab');
    assert.ok(panelTab.input instanceof vscode.TabInputWebview, 'opened tab is not TabInputWebview');
    assert.ok(matchesViewType(panelTab.input.viewType),
      `unexpected NPC Webview viewType: ${panelTab.input.viewType}`);
    assert.equal(panelTab.label, EXPECTED_TITLE);

    observed = {
      viewType: panelTab.input.viewType,
      title: panelTab.label,
    };
    panelClosed = await vscode.window.tabGroups.close(panelTab, true);
    assert.equal(panelClosed, true, 'failed to close the NPC dialog Webview tab');

    assert.equal(document.isDirty, false);
    const afterBytes = Buffer.from(await vscode.workspace.fs.readFile(sourceUri));
    assert.deepEqual(afterBytes, beforeBytes, 'Ctrl+F12 command modified the source fixture');
  } finally {
    subscription.dispose();
    if (panelTab && !panelClosed) {
      try {
        await vscode.window.tabGroups.close(panelTab, true);
      } catch {
        // The outer watchdog handles a host that cannot shut down cleanly.
      }
    }
    try {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    } catch {
      // Do not replace the primary assertion or command failure.
    }
  }

  const result = {
    ok: true,
    durationMs: Date.now() - startedAt,
    extensionPath: extension.extensionPath,
    command: COMMAND_ID,
    keybinding: 'ctrl+f12',
    when,
    viewType: observed.viewType,
    title: observed.title,
    sourceBytesUnchanged: true,
  };
  console.log('[BOO Ctrl+F12 host smoke]', result);
  return result;
}

async function run() {
  try {
    const result = await runScenario();
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  } catch (error) {
    fs.writeFileSync(RESULT_PATH, JSON.stringify({
      ok: false,
      error: error?.stack || String(error),
    }, null, 2));
    throw error;
  }
}

module.exports = { run };
