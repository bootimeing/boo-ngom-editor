const assert = require('node:assert/strict');
const fs = require('node:fs');

function main() {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const extension = fs.readFileSync('src/extension.ts', 'utf8');
  const command = fs.readFileSync('src/commands/zone-sync.ts', 'utf8');
  const core = fs.readFileSync('src/utils/zone-sync.ts', 'utf8');
  const contributed = manifest.contributes.commands.find(
    item => item.command === 'boo.syncToOtherZones'
  );
  assert.equal(contributed.title, '同步其他区');
  assert.ok(manifest.activationEvents.includes('onCommand:boo.syncToOtherZones'));
  assert.ok(
    manifest.contributes.menus['explorer/context'].some(item => (
      item.command === 'boo.syncToOtherZones' && item.when === 'resourceScheme == file'
    )),
    'the sync command must appear only in the file Explorer context menu'
  );
  assert.match(extension, /registerZoneSyncCommand\(context\)/);
  assert.match(command, /createQuickPick<DirectoryTargetItem>/);
  assert.match(command, /canSelectMany = true/);
  assert.match(command, /if \(!updatingItems\) captureVisibleSelections\(\)/);
  assert.match(command, /path\.parse\(workspaceRoot\)\.root/);
  assert.match(command, /iconPath: new vscode\.ThemeIcon\('folder-opened'\)/);
  assert.match(command, /同路径文件将被覆盖，目标缺少的目录和文件会自动创建/);
  assert.match(core, /collectZoneSyncInventory/);
  assert.match(core, /pendingDirectories/);
  assert.match(core, /copyFileForZoneSync/);
  assert.match(core, /validateZoneSyncTargets/);
  console.log('zone-sync-command.test.js: PASS');
}

main();
