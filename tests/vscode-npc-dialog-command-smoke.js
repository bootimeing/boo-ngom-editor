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

    const dropCommand = 'boo.analyzeDropRates';
    assert.ok(commands.includes(dropCommand), 'drop analysis command must activate in the real host');
    const dropUri = vscode.Uri.joinPath(workspaceFolders[0].uri, 'drop-smoke.txt');
    const dropBytes = Buffer.from('#CHILD 1/2 RANDOM\r\n(\r\n1/4 Sword\r\n1/1 Gold 100\r\n)\r\n');
    await vscode.workspace.fs.writeFile(dropUri, dropBytes); // Isolated test workspace only.
    const dropDocument = await vscode.workspace.openTextDocument(dropUri);
    await vscode.window.showTextDocument(dropDocument);
    await withTimeout(vscode.commands.executeCommand(dropCommand), 5_000, 'read-only drop analysis');
    const report = vscode.window.activeTextEditor?.document;
    assert.ok(report?.isUntitled && report.languageId === 'markdown', 'analysis must open a separate unsaved report');
    assert.match(report.getText(), /Sword/);
    assert.match(report.getText(), /1\/4/);
    assert.equal(dropDocument.isDirty, false);
    assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(dropUri)), dropBytes);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');

    const envir = vscode.Uri.joinPath(workspaceFolders[0].uri, 'Mir200', 'Envir');
    const monItems = vscode.Uri.joinPath(envir, 'MonItems');
    const diary = vscode.Uri.joinPath(envir, 'QuestDiary');
    await vscode.workspace.fs.createDirectory(monItems);
    await vscode.workspace.fs.createDirectory(diary);
    const externalUri = vscode.Uri.joinPath(diary, 'r20-smoke.txt');
    const callerUri = vscode.Uri.joinPath(monItems, 'r20-drop-smoke.txt');
    const externalBytes = Buffer.from('[@smoke]\r\n{\r\n1/2 CalledPotion\r\n}\r\n');
    const callerBytes = Buffer.from('#CALL [\\r20-smoke.txt] @smoke\r\n');
    await vscode.workspace.fs.writeFile(externalUri, externalBytes);
    await vscode.workspace.fs.writeFile(callerUri, callerBytes);
    const caller = await vscode.workspace.openTextDocument(callerUri);
    await vscode.window.showTextDocument(caller);
    await withTimeout(vscode.commands.executeCommand(dropCommand), 5_000, 'external read-only drop analysis');
    const externalReport = vscode.window.activeTextEditor?.document;
    assert.ok(externalReport?.isUntitled && externalReport.languageId === 'markdown');
    assert.match(externalReport.getText(), /CalledPotion/);
    assert.match(externalReport.getText(), /1\/2/);
    assert.ok(externalReport.getText().includes('r20-smoke\\.txt:3'), 'report must retain the Markdown-escaped physical source line');
    assert.match(externalReport.getText(), /外部 CALL：展开 1 处，未展开 0 处/);
    assert.equal(caller.isDirty, false);
    assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(callerUri)), callerBytes);
    assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(externalUri)), externalBytes);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
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
    dropAnalysisCommand: 'boo.analyzeDropRates',
    dropAnalysisSourceUnchanged: true,
    externalDropCallSourceUnchanged: true,
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
