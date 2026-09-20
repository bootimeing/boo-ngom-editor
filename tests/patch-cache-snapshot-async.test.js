const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const patch = require(path.join(runtime, 'out/utils/patch-cache'));
const { GOM_DECODER_REVISION } = require(path.join(runtime, 'out/utils/pak-reader'));
const { makeContext, makeVscodeStub, loadCompiledProvider, makePanel } = require('./map-preview-persistent-tile-provider.test');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-async-snapshot-'));
  const originalExists = fs.existsSync;
  try {
    const cacheRoot = path.join(temporary, 'patch-cache'), client = path.join(temporary, 'client');
    fs.mkdirSync(cacheRoot); fs.mkdirSync(client);
    for (let n = 0; n < 64; n++) {
      const name = `Items${n}`, source = path.join(client, `${name}.pak`), dir = path.join(cacheRoot, name);
      fs.mkdirSync(dir); fs.writeFileSync(source, name); fs.writeFileSync(path.join(dir, '000000.png'), 'png');
      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ format: 'GOM', decoderRevision: GOM_DECODER_REVISION, pakName: name, pakPath: source, willIdx: n, slotCount: 1, assets: [] }));
    }
    patch.invalidatePatchCacheIndex();
    const sync = patch.createPatchCacheSnapshot(cacheRoot, [client]);
    patch.invalidatePatchCacheIndex();
    const asyncView = await patch.createPatchCacheSnapshotAsync(cacheRoot, [client]);
    assert.deepEqual(asyncView.entries, sync.entries);
    assert.deepEqual([...asyncView.currentByManifest], [...sync.currentByManifest]);
    assert.deepEqual(asyncView.entries.slice(0, 12).map(p => p.pakName), Array.from({ length: 12 }, (_, n) => `Items${n}`), 'collator preserves numeric ordering');

    // Deterministic forced disk latency makes a yield observable on fast hosts.
    fs.existsSync = function (file) {
      if (String(file).endsWith('manifest.json')) { const end = performance.now() + 1; while (performance.now() < end) { /* injected I/O latency */ } }
      return originalExists(file);
    };
    patch.invalidatePatchCacheIndex();
    let current = true, yielded = false;
    setImmediate(() => { yielded = true; current = false; });
    await assert.rejects(patch.createPatchCacheSnapshotAsync(cacheRoot, [client], 'direct', () => current), /取消|失效/);
    assert.equal(yielded, true, 'cold scan must let the event loop run');
    // A cancelled cold scan must not have published a partial global cache.
    fs.unlinkSync(path.join(cacheRoot, 'Items0', 'manifest.json'));
    const afterCancel = patch.createPatchCacheSnapshot(cacheRoot, [client]);
    assert.equal(afterCancel.entries.length, 63);
    assert.ok(afterCancel.entries.every(item => item.pakName !== 'Items0'));

    patch.invalidatePatchCacheIndex();
    setImmediate(() => patch.invalidatePatchCacheIndex());
    await assert.rejects(patch.createPatchCacheSnapshotAsync(cacheRoot, [client]), /取消|失效/, 'invalidation across an await must reject publication');
    fs.existsSync = originalExists;

    // A source mutation is still observed on the next request, not masked by
    // the process list warmed by the asynchronous scan.
    const ready = await patch.createPatchCacheSnapshotAsync(cacheRoot, [client]);
    const changed = ready.entries[0], newer = new Date(fs.statSync(changed.pakPath).mtimeMs + 5000);
    fs.utimesSync(changed.pakPath, newer, newer);
    const fresh = await patch.createPatchCacheSnapshotAsync(cacheRoot, [client]);
    assert.equal(fresh.currentByManifest.get(path.resolve(changed.manifestPath).toLowerCase()), false);

    // Provider: async snapshot completion from an old generation may not set
    // identity/null fallback on the new session, nor publish viewport output.
    const { MapPreviewProvider } = loadCompiledProvider(makeVscodeStub(temporary));
    const provider = new MapPreviewProvider(makeContext(temporary));
    const messages = []; provider.panel = makePanel(messages);
    provider.currentMap = { key: 'generation' }; provider.originalMapVersion = 1;
    const session = { mapKey: 'generation', generation: 1, latestViewportSeq: 1, requestId: 1, engineId: 'GOM', mapSha256: 'a'.repeat(64), model: { width: 2, height: 2, archiveNames: ['Tiles'] } };
    provider.originalMapSession = session;
    let release;
    provider.originalMapSourceContext = () => new Promise(resolve => { release = resolve; });
    const old = provider.prepareOriginalMapStaticCache(session);
    provider.originalMapVersion = session.generation = 2;
    release({ resourceRoots: [client], sourceScanWarning: '', archiveFiles: [], supportedExtensions: ['.pak'] });
    assert.equal(await old, undefined);
    assert.equal(session.staticCacheIdentity, undefined, 'old generation cannot write identity/null');
    assert.deepEqual(messages, [], 'old generation cannot publish messages');
    console.log('patch-cache-snapshot-async.test.js: PASS (selection, yielding, cancellation, invalidation, source freshness, generation)');
  } finally {
    fs.existsSync = originalExists;
    // Only this test-created directory, never the user cache.
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
