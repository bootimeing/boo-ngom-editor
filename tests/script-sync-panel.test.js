const assert = require('node:assert/strict');
const fs = require('node:fs');

function main() {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const extension = fs.readFileSync('src/extension.ts', 'utf8');
  const explorerCommand = fs.readFileSync('src/commands/zone-sync.ts', 'utf8');
  const panel = fs.readFileSync('src/commands/script-sync.ts', 'utf8');

  const contributed = manifest.contributes.commands.find(
    item => item.command === 'boo.openScriptSync'
  );
  assert.equal(contributed.title, 'BOO: 脚本同步');
  assert.ok(manifest.activationEvents.includes('onCommand:boo.openScriptSync'));

  const toolsArrayIndex = extension.indexOf('const tools = [');
  const toolsArrayEnd = extension.indexOf('];', toolsArrayIndex);
  const scriptSyncToolIndex = extension.indexOf("cmd: 'boo.openScriptSync'", toolsArrayIndex);
  const quickToolsIndex = extension.indexOf('<h3>快捷工具</h3>', toolsArrayEnd);
  const shortcutsIndex = extension.indexOf('<h3>快捷键</h3>', quickToolsIndex);
  const footerIndex = extension.indexOf('<div class="ft">', shortcutsIndex);
  assert.ok(scriptSyncToolIndex > toolsArrayIndex && scriptSyncToolIndex < toolsArrayEnd, '脚本同步必须属于快捷工具数组');
  assert.match(extension.slice(scriptSyncToolIndex, toolsArrayEnd), /label: '脚本同步'/);
  assert.match(extension.slice(quickToolsIndex, shortcutsIndex), /tools\.map/);
  assert.doesNotMatch(extension.slice(shortcutsIndex, footerIndex), /href="command:boo\.openScriptSync"|script-sync/);

  assert.match(explorerCommand, /registerScriptSyncCommand/);
  assert.match(explorerCommand, /runZoneSyncSelection/);
  assert.match(explorerCommand, /collectZoneSyncInventory\(\s*workspaceRoot,\s*sourcePaths/);
  assert.match(panel, /当前工作区/);
  assert.match(panel, /同步目标/);
  assert.match(panel, /type = 'checkbox'/);
  assert.match(panel, /type: 'listDirectory'/);
  assert.match(panel, /listScriptSyncDirectory/);
  assert.match(panel, /validateScriptSyncSources/);
  assert.match(panel, /validateScriptSyncTargets/);
  assert.match(panel, /retainContextWhenHidden: true/);
  assert.match(panel, /selected\.target = new Set\(message\.rememberedTargets/);
  assert.match(panel, /type: 'startSync'/);
  const webviewScript = panel.match(/<script>\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(webviewScript, 'script sync webview must contain its controller script');
  assert.doesNotThrow(() => new Function(webviewScript[1]), 'webview controller must parse');
  console.log('script-sync-panel.test.js: PASS');
}

main();
