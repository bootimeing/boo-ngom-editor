const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function writeManifest(cacheDir, pakPath) {
  const { GOM_DECODER_REVISION } = require('../out/utils/pak-reader');
  const imagePath = path.join(cacheDir, '000000.png');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(imagePath, 'png');
  fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify({
    version: 3,
    fingerprint: path.basename(cacheDir),
    format: 'GOM',
    decoderRevision: GOM_DECODER_REVISION,
    pakName: 'Items',
    pakPath,
    sourceMd5: '0123456789abcdef0123456789abcdef',
    willIdx: 0,
    slotCount: 1,
    assets: [{
      name: '000000',
      path: imagePath,
      pakName: 'Items',
      pakPath,
      willIdx: 0,
      localIdx: 0,
      imageIdx: 0,
      width: 1,
      height: 1,
      offsetX: 0,
      offsetY: 0,
      isBlank: false,
      source: 'pak',
    }],
  }));
}

function main() {
  const {
    getCacheRoots,
    initializeCacheStorage,
  } = require('../out/utils/cache-storage');
  const {
    invalidatePatchCacheIndex,
    listCachedPatchPaks,
    loadCachedPatchPakResult,
  } = require('../out/utils/patch-cache');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-cache-storage-'));
  try {
    const roaming = path.join(root, 'Roaming');
    const local = path.join(root, 'Local');
    const globalStorage = path.join(
      roaming,
      'Code',
      'User',
      'globalStorage',
      'boo1213.boo-ngom-editor'
    );
    const context = { globalStorageUri: { fsPath: globalStorage } };
    const env = { LOCALAPPDATA: local, APPDATA: roaming };
    const legacyPatchCache = path.join(globalStorage, 'patch-cache');
    const legacyPakCache = path.join(globalStorage, 'pak-cache');
    const pakPath = path.join(root, 'client', 'data', 'Items.pak');

    fs.mkdirSync(path.dirname(pakPath), { recursive: true });
    fs.writeFileSync(pakPath, 'pak');
    writeManifest(path.join(legacyPatchCache, 'legacy-fingerprint'), pakPath);
    writeManifest(path.join(legacyPakCache, 'history-fingerprint'), pakPath);

    const roots = getCacheRoots(context, env);
    assert.equal(roots.base, path.join(local, 'BOO-NGOM-Editor', 'cache'));
    assert.equal(roots.archiveIndex, path.join(roots.base, 'archive-index-v1'));
    assert.equal(
      path.relative(globalStorage, roots.base).startsWith('..'),
      true,
      'heavy caches must live outside VS Code globalStorage'
    );

    const migrated = initializeCacheStorage(context, env);
    assert.equal(migrated.warnings.length, 0);
    assert.equal(migrated.movedEntries, 2);
    assert.equal(fs.existsSync(roots.archiveIndex), true);
    assert.equal(fs.existsSync(legacyPatchCache), false);
    assert.equal(fs.existsSync(legacyPakCache), false);
    assert.equal(
      fs.existsSync(path.join(roots.patchCache, 'legacy-fingerprint', '000000.png')),
      true
    );
    assert.equal(
      fs.existsSync(path.join(roots.pakCache, 'history-fingerprint', '000000.png')),
      true
    );

    invalidatePatchCacheIndex();
    const cached = listCachedPatchPaks(roots.patchCache);
    assert.equal(cached.length, 1);
    const loaded = loadCachedPatchPakResult(cached[0], 7);
    assert.equal(loaded.assets[0].willIdx, 7);
    assert.equal(
      loaded.assets[0].path,
      path.join(roots.patchCache, 'legacy-fingerprint', '000000.png'),
      'old absolute image paths must be rebased after moving the cache directory'
    );

    const existingTarget = path.join(roots.patchCache, 'collision');
    const legacyCollision = path.join(legacyPatchCache, 'collision');
    fs.mkdirSync(existingTarget, { recursive: true });
    fs.writeFileSync(path.join(existingTarget, 'current.txt'), 'current');
    fs.mkdirSync(legacyCollision, { recursive: true });
    fs.writeFileSync(path.join(legacyCollision, 'legacy.txt'), 'legacy');

    const merged = initializeCacheStorage(context, env);
    assert.equal(merged.warnings.length, 0);
    assert.equal(fs.existsSync(legacyPatchCache), false);
    assert.equal(fs.existsSync(path.join(existingTarget, 'current.txt')), true);
    const migratedCollision = fs.readdirSync(roots.patchCache)
      .find(name => name.startsWith('collision.legacy-'));
    assert.ok(migratedCollision, 'a colliding legacy directory must be preserved under a unique name');
    assert.equal(
      fs.existsSync(path.join(roots.patchCache, migratedCollision, 'legacy.txt')),
      true
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('cache-storage.test.js: PASS');
}

main();
