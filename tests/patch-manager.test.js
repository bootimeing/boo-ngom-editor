const assert = require('node:assert/strict');
const fs = require('node:fs');

function main() {
  const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const extension = fs.readFileSync('src/extension.ts', 'utf8');
  const provider = fs.readFileSync('src/providers/patch-manager.ts', 'utf8');
  const patchCache = fs.readFileSync('src/utils/patch-cache.ts', 'utf8');
  const patchDiscovery = fs.readFileSync('src/utils/patch-discovery.ts', 'utf8');
  const clientResources = fs.readFileSync('src/utils/client-resources.ts', 'utf8');
  const pakReader = fs.readFileSync('src/utils/pak-reader.ts', 'utf8');
  const html = fs.readFileSync('media/patch-manager.html', 'utf8');
  const icon = fs.readFileSync('resources/patch-icon.svg', 'utf8');

  const activityBar = manifest.contributes.viewsContainers.activitybar;
  const patchIndex = activityBar.findIndex(item => item.id === 'boo-patch');
  const editorIndex = activityBar.findIndex(item => item.id === 'boo-editor');
  assert.ok(patchIndex >= 0 && patchIndex < editorIndex, 'patch manager must appear above the UI editor');
  assert.equal(activityBar[patchIndex].icon, 'resources/patch-icon.svg');
  assert.equal(manifest.contributes.views['boo-patch'][0].id, 'boo.patchView');
  assert.ok(manifest.activationEvents.includes('onView:boo.patchView'));
  assert.match(icon, />补<\/text>/, 'patch manager icon must use the requested character');
  assert.match(
    extension,
    /const patchManagerProvider = new PatchManagerProvider\(context\)[\s\S]*registerWebviewViewProvider\('boo\.patchView', patchManagerProvider\)[\s\S]*patchManagerProvider\.autoLoadOrCache\(\)/,
    'the patch manager view provider must be registered'
  );

  assert.match(provider, /scanClientArchiveFiles\([\s\S]*layout\.dataRoots[\s\S]*uiEditorArchiveExtensions/);
  assert.match(provider, /filterRequiredPatchPakFiles/, 'required mode must include EffectImageList and fixed resources');
  assert.match(provider, /readEffectImageArchiveNames[\s\S]*item\.extension \? `\$\{item\.name\}\.\$\{item\.extension\}`/);
  assert.match(provider, /readPasswordRecords\(\)[\s\S]*if \(!isFile\(this\.passwordFile\)\) return \[\]/);
  assert.match(provider, /isPairedArchiveExtension[\s\S]*passwordRequired/);
  assert.match(provider, /configuredPassword[\s\S]*resolvePakPasswordFromRecords/);
  assert.match(
    provider,
    /selectPakPassword\(suppliedPassword, configuredPassword, savedPassword\)/,
    'the selected password file must override stale secure-storage passwords'
  );
  assert.match(provider, /storageModeForPath[\s\S]*\? 'direct'/, 'WIL/WZL must always use direct indexed reading');
  assert.match(
    provider,
    /for \(let pendingIndex = 0; pendingIndex < pending\.length; pendingIndex\+\+\)[\s\S]*await this\.cacheEntry/,
    'archives must be indexed sequentially on low-memory clients'
  );
  assert.match(provider, /forceRefresh[\s\S]*decodePakFully/, 'single-row reload must force a fresh cache');
  assert.match(provider, /patchPasswordSecretKey/, 'manual passwords must use VS Code secure storage');
  assert.match(provider, /status = 'password-error'/, 'password failures must have a dedicated row state');
  assert.match(provider, /isConfirmedPakPasswordError\(error\)/, 'ambiguous format failures must still try the compatibility reader');
  assert.match(provider, /密码或资源格式不匹配/, 'ambiguous failures must not be reported as a definite wrong password');
  assert.match(patchDiscovery, /findNearbyPakPasswordFile/);
  assert.match(provider, /findWorkspacePatchPasswordFile/);
  assert.doesNotMatch(provider, /findWorkspacePatchDataDirectory/, 'a workspace must not silently select a client');
  assert.match(provider, /validatePatchCacheMd5/, 'explicit reads must retain exact MD5 validation');
  assert.match(provider, /case 'metadata-changed':[\s\S]*等待刷新索引/);
  assert.match(
    pakReader,
    /createHash\('md5'\)\.update\(data\)\.digest\('hex'\)[\s\S]*sourceMd5/,
    'fresh caches must persist source MD5'
  );

  assert.match(clientResources, /customPatchName[\s\S]*children\.length === 1[\s\S]*selectedChildren/);
  assert.match(clientResources, /for \(const candidate of selectedChildren\)[\s\S]*appendUnique\(dataRoots/);
  assert.match(provider, /setCustomPatchName[\s\S]*customPatchSelectionError/);
  assert.match(provider, /customPatchName:\s*this\.customPatchName/);
  assert.match(provider, /context\.workspaceState\.get<SavedPatchManagerState>/);
  assert.match(provider, /context\.workspaceState\.update\(patchManagerStateKey\(engine\), state\)/);
  assert.doesNotMatch(provider, /context\.globalState\.(?:get|update).*PATCH_MANAGER_STATE_KEY/);
  assert.match(
    provider,
    /runAutoLoadOrCache\(\)[\s\S]*readPatches\(true, 'required'\)/,
    'startup must only validate required resources even after a prior read-all action'
  );
  assert.doesNotMatch(provider, /inferPatchReadScope/, 'old read-all cache evidence must not widen startup scans');
  assert.match(
    provider,
    /this\.readScope = 'required';\s*\/\/[^\n]+\s*this\.entries = \[\];/,
    'startup must not restore a previous read-all row list'
  );
  assert.match(
    provider,
    /passwordFile:\s*this\.passwordFile,\s*entries:\s*\[\],\s*engine,\s*stateVersion:\s*3/,
    'read-all rows must not be persisted back into workspace state'
  );

  assert.match(html, /首次读取会建立资源索引/);
  assert.match(html, /选择客户端目录/);
  assert.match(html, /自定义补丁文件夹/);
  assert.match(html, /type: 'setCustomPatchName'/);
  assert.match(html, /选择 PAK\/JPK 密码文件（可选）/);
  assert.match(html, /读取需求资源包/);
  assert.match(html, /读取所有资源包/);
  assert.match(html, /type: 'readRequiredPatches'/);
  assert.match(html, /type: 'readAllPatches'/);
  assert.match(html, /data-action="reloadPak"/);
  assert.match(html, /data-action="changePassword"/);
  assert.match(html, /entry\.passwordRequired === false/);
  assert.match(
    html,
    /pakList\.addEventListener\('pointerdown'[\s\S]*selectPakRow\(row\)/,
    'rows must select on pointer down'
  );
  assert.match(html, /function selectPakRow\(row\)[\s\S]*selectedPath = pakPath/);
  assert.doesNotMatch(html, /selectedPath === pakPath \? '' : pakPath/);
  assert.match(html, /entry\.status === 'password-error'[\s\S]*密码错误[\s\S]*data-action="reloadPak"/);
  assert.match(html, /\.pak-row\.password-error[\s\S]*background:/);

  assert.match(
    extension,
    /listCalledClientArchives[\s\S]*matchPakFile[\s\S]*willIdx/,
    'UI resource choices must come from the current EffectImageList'
  );
  assert.match(extension, /context\.workspaceState\.get<PakHistoryEntry\[]>\(PAK_HISTORY_STATE_KEY/);
  assert.match(extension, /calledPaths\.has\(normalizePakPath\(entry\.path\)\)/);

  assert.match(
    patchCache,
    /reference\.extension === candidate\.extension/,
    'called WIL and WZL files with the same basename must remain distinct'
  );

  console.log('patch-manager.test.js: PASS');
}

main();
