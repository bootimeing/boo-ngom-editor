const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));

async function main() {
  const {
    createPatchCacheSnapshot,
    invalidatePatchCacheIndex,
    isPatchCacheCurrent,
    resolveCachedPatchArchiveByName,
  } = require(path.join(runtimeRoot, 'out/utils/patch-cache'));
  const { GOM_DECODER_REVISION } = require(path.join(runtimeRoot, 'out/utils/pak-reader'));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-patch-cache-snapshot-'));
  try {
    const dataRoot = path.join(root, 'client', 'Data');
    const cacheRoot = path.join(root, 'cache');
    const cacheDir = path.join(cacheRoot, 'items');
    const sourcePath = path.join(dataRoot, 'Items1.pak');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(sourcePath, 'items');
    fs.writeFileSync(path.join(cacheDir, '000000.png'), 'png');
    fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify({
      format: 'GOM',
      decoderRevision: GOM_DECODER_REVISION,
      pakName: 'Items1',
      pakPath: sourcePath,
      willIdx: 0,
      slotCount: 1,
      assets: [],
    }));

    invalidatePatchCacheIndex();
    const snapshot = createPatchCacheSnapshot(cacheRoot, [dataRoot], 'direct');
    assert.equal(snapshot.entries.length, 1);
    assert.equal(snapshot.currentByManifest.size, 1);
    assert.equal(isPatchCacheCurrent(snapshot.entries[0]), true);

    const archiveFiles = [sourcePath];
    const first = resolveCachedPatchArchiveByName(
      cacheRoot,
      'Items1',
      archiveFiles,
      [dataRoot],
      ['pak'],
      snapshot
    );
    const second = resolveCachedPatchArchiveByName(
      cacheRoot,
      'Items1',
      archiveFiles,
      [dataRoot],
      ['pak'],
      snapshot
    );
    assert.equal(first.status, 'ready');
    assert.equal(second.status, 'ready');
    assert.equal(first.pak.manifestPath, second.pak.manifestPath);

    // A snapshot is request-scoped.  Changing source metadata does not mutate
    // the old selection; a new snapshot observes the source as stale instead.
    const stat = fs.statSync(sourcePath);
    const newer = new Date(stat.mtimeMs + 5000);
    fs.utimesSync(sourcePath, newer, newer);
    const staleSnapshot = createPatchCacheSnapshot(cacheRoot, [dataRoot], 'direct');
    assert.equal([...staleSnapshot.currentByManifest.values()][0], false);
    assert.equal(
      resolveCachedPatchArchiveByName(
        cacheRoot,
        'Items1',
        archiveFiles,
        [dataRoot],
        ['pak'],
        staleSnapshot
      ).status,
      'stale'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('patch-cache-snapshot.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
