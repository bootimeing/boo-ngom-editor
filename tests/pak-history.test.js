const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function main() {
  const {
    discoverPakHistoryFromCache,
    mergePakHistory,
    prunePakHistory,
  } = require('../out/utils/pak-history');
  const existing = [
    { path: path.resolve('D:/Pak/old.pak'), lastOpenedAt: 10 },
    { path: path.resolve('D:/Pak/keep.pak'), lastOpenedAt: 20 },
  ];
  const merged = mergePakHistory(existing, [
    path.resolve('D:/Pak/NEW.pak'),
    path.resolve('D:/Pak/old.pak'),
  ], 100, 3);

  assert.deepEqual(merged.map(entry => path.basename(entry.path).toLowerCase()), [
    'new.pak', 'old.pak', 'keep.pak',
  ]);
  assert.equal(merged[0].lastOpenedAt, 100);
  assert.equal(merged[1].lastOpenedAt, 100);

  const pruned = prunePakHistory(merged, filePath => !filePath.toLowerCase().includes('old.pak'));
  assert.deepEqual(pruned.map(entry => path.basename(entry.path).toLowerCase()), ['new.pak', 'keep.pak']);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-pak-history-'));
  try {
    const pakPath = path.join(tempRoot, 'dialog.pak');
    const jpkPath = path.join(tempRoot, 'title.jpk');
    const wilPath = path.join(tempRoot, 'magic.wil');
    const wzlPath = path.join(tempRoot, 'ui.wzl');
    const cacheDir = path.join(tempRoot, 'cache', 'fingerprint');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(pakPath, 'pak');
    fs.writeFileSync(jpkPath, 'jpk');
    fs.writeFileSync(wilPath, 'wil');
    fs.writeFileSync(wzlPath, 'wzl');
    fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify({ pakPath }));
    const jpkCacheDir = path.join(tempRoot, 'cache', 'jpk-fingerprint');
    fs.mkdirSync(jpkCacheDir, { recursive: true });
    fs.writeFileSync(path.join(jpkCacheDir, 'manifest.json'), JSON.stringify({ pakPath: jpkPath }));
    const wilCacheDir = path.join(tempRoot, 'cache', 'wil-fingerprint');
    fs.mkdirSync(wilCacheDir, { recursive: true });
    fs.writeFileSync(path.join(wilCacheDir, 'manifest.json'), JSON.stringify({ pakPath: wilPath }));
    const wzlCacheDir = path.join(tempRoot, 'cache', 'wzl-fingerprint');
    fs.mkdirSync(wzlCacheDir, { recursive: true });
    fs.writeFileSync(path.join(wzlCacheDir, 'manifest.json'), JSON.stringify({ pakPath: wzlPath }));
    fs.mkdirSync(path.join(tempRoot, 'cache', 'broken'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'cache', 'broken', 'manifest.json'), '{');

    const discovered = discoverPakHistoryFromCache(path.join(tempRoot, 'cache'));
    assert.deepEqual(
      discovered.map(entry => path.basename(entry.path)).sort(),
      ['dialog.pak', 'magic.wil', 'title.jpk', 'ui.wzl']
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('pak-history.test.js: PASS');
}

main();
