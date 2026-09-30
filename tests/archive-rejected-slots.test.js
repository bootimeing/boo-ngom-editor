const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { buildFixture } = require('./gom-reader-tolerance.test');
const { openArchiveIndexed, forgetArchiveIndex, loadArchiveSummary, loadArchiveAssetTable } = require('../out/utils/archive-index');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-rejected-slots-'));
  const originalLoad = Module._load;
  let provider;
  try {
    Module._load = function (request, parent, mainModule) {
      if (request === 'vscode') return {
        Uri: { parse: value => value },
        EventEmitter: class { constructor() { this.event = () => {}; } dispose() {} },
      };
      return originalLoad.call(this, request, parent, mainModule);
    };
    const { ArchiveResourceProvider } = require('../out/utils/archive-resource-provider');
    Module._load = originalLoad;
    const file = path.join(root, 'bad.pak'), indexRoot = path.join(root, 'index');
    buildFixture(file, 'fixture', new Set([1260]));
    const source = fs.readFileSync(file);
    const options = { extensionPath: path.resolve(__dirname, '..'), indexRoot, pakPath: file, password: 'fixture', willIdx: 1 };
    const result = await openArchiveIndexed(options);
    provider = new ArchiveResourceProvider(options.extensionPath, indexRoot);
    const uri = id => ({ scheme: 'boo-archive', path: `/${result.archiveId}/${id}.png` });
    for (let n = 0; n < 2; n++) {
      await assert.rejects(provider.readFile(uri(1260)), /1260.*invalid-dimensions/);
      assert.equal(provider.pendingReads.size, 0);
      assert.equal(provider.imageCache.size, 0, 'failed images cannot enter the successful PNG cache');
    }
    const good = await provider.readFile(uri(1261));
    assert.equal(Buffer.from(good).readUInt32BE(16), 1);
    const blank = await provider.readFile(uri(1655));
    assert.notDeepEqual(good, blank, 'a real image and an empty frame are independent slots');
    provider.dispose(); provider = undefined;

    const summaryPath = path.join(result.cacheDir, 'summary.json');
    const summary = JSON.parse(fs.readFileSync(summaryPath));
    for (const edit of [
      s => { s.decoderRevision = 'archive-direct-v1'; },
      s => { delete s.rejectedSlots; },
      s => { s.rejectedSlots[0].logicalIndex = s.slotCount; },
    ]) {
      const damaged = JSON.parse(JSON.stringify(summary)); edit(damaged);
      fs.writeFileSync(summaryPath, JSON.stringify(damaged));
      forgetArchiveIndex(indexRoot);
      assert.throws(() => loadArchiveSummary(indexRoot, result.archiveId), /损坏/);
      const rebuilt = await openArchiveIndexed(options);
      assert.equal(rebuilt.fromCache, false);
      assert.equal(rebuilt.assets[1260].failureCode, 'invalid-dimensions');
    }
    const indexFile = path.join(result.cacheDir, 'blocks.idx');
    const bytes = fs.readFileSync(indexFile);
    // Move a valid record to the known rejected ID without changing length.
    bytes.writeUInt32LE(1260, 24 + 1260 * 40);
    fs.writeFileSync(indexFile, bytes); forgetArchiveIndex(indexRoot);
    assert.throws(() => loadArchiveAssetTable(indexRoot, result.archiveId), /状态冲突/);
    assert.deepEqual(fs.readFileSync(file), source, 'cache rebuilds must leave original archive unchanged');
  } finally {
    Module._load = originalLoad;
    provider?.dispose();
    removeTemporaryDirectory(root);
  }
  console.log('archive-rejected-slots.test.js: PASS (actual Worker resource errors, no false PNG cache, migration, no source writes)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
