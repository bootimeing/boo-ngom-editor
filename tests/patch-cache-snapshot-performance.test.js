const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function measure(fsModule, fn) {
  const originalExists = fsModule.existsSync;
  const originalStat = fsModule.statSync;
  const counters = { existsSync: 0, statSync: 0 };
  fsModule.existsSync = (...args) => {
    counters.existsSync += 1;
    return originalExists(...args);
  };
  fsModule.statSync = (...args) => {
    counters.statSync += 1;
    return originalStat(...args);
  };
  const started = process.hrtime.bigint();
  try {
    fn();
  } finally {
    fsModule.existsSync = originalExists;
    fsModule.statSync = originalStat;
  }
  return {
    ...counters,
    elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
  };
}

async function main() {
  const runtimeRoot = path.resolve(
    process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..')
  );
  const patch = require(path.join(runtimeRoot, 'out/utils/patch-cache'));
  const { GOM_DECODER_REVISION } = require(path.join(runtimeRoot, 'out/utils/pak-reader'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-patch-cache-perf-'));
  const originalExists = fs.existsSync;
  const originalStat = fs.statSync;
  try {
    const cacheRoot = path.join(root, 'cache');
    const clientRoot = path.join(root, 'client', 'Data');
    const foreignRoot = path.join(root, 'foreign', 'Data');
    fs.mkdirSync(cacheRoot, { recursive: true });
    fs.mkdirSync(clientRoot, { recursive: true });
    fs.mkdirSync(foreignRoot, { recursive: true });
    const total = 320;
    const clientCount = 96;
    const sourcePaths = [];
    for (let i = 0; i < total; i += 1) {
      const isClient = i < clientCount;
      const dataRoot = isClient ? clientRoot : foreignRoot;
      const name = `Items${i}`;
      const sourcePath = path.join(dataRoot, `${name}.pak`);
      const cacheDir = path.join(cacheRoot, `cache-${i}`);
      fs.mkdirSync(cacheDir);
      fs.writeFileSync(sourcePath, `payload-${i}`);
      fs.writeFileSync(path.join(cacheDir, '000000.png'), 'png');
      fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify({
        format: 'GOM',
        decoderRevision: GOM_DECODER_REVISION,
        pakName: name,
        pakPath: sourcePath,
        willIdx: i,
        slotCount: 1,
        assets: [],
      }));
      sourcePaths.push(sourcePath);
    }
    const selectedSource = sourcePaths[0];
    const archiveFiles = [selectedSource];
    const resourceRoots = [clientRoot];
    const resolve = (snapshot) => patch.resolveCachedPatchArchiveByName(
      cacheRoot,
      'Items0',
      archiveFiles,
      resourceRoots,
      ['pak'],
      snapshot
    );

    patch.invalidatePatchCacheIndex();
    const baselineCold = measure(fs, () => {
      assert.equal(resolve().status, 'ready');
    });
    const baselineWarm = measure(fs, () => {
      for (let i = 0; i < 100; i += 1) assert.equal(resolve().status, 'ready');
    });

    patch.invalidatePatchCacheIndex();
    const snapshotCold = measure(fs, () => {
      const snapshot = patch.createPatchCacheSnapshot(cacheRoot, resourceRoots, 'direct');
      assert.equal(resolve(snapshot).status, 'ready');
    });
    const snapshot = patch.createPatchCacheSnapshot(cacheRoot, resourceRoots, 'direct');
    const snapshotWarm = measure(fs, () => {
      for (let i = 0; i < 100; i += 1) assert.equal(resolve(snapshot).status, 'ready');
    });
    assert.equal(snapshot.entries.length, clientCount);

    // A snapshot from another client must never be accepted by a lookup for
    // a different resource root; the new request observes the stale source.
    const foreignSource = sourcePaths[clientCount];
    const foreignSnapshot = patch.createPatchCacheSnapshot(cacheRoot, [foreignRoot], 'direct');
    const foreignStat = fs.statSync(foreignSource);
    const foreignNewer = new Date(foreignStat.mtimeMs + 5000);
    fs.utimesSync(foreignSource, foreignNewer, foreignNewer);
    const crossClient = patch.resolveCachedPatchArchiveByName(
      cacheRoot,
      'Items96',
      [foreignSource],
      [foreignRoot],
      ['pak'],
      snapshot
    );
    assert.equal(crossClient.status, 'stale');

    // The old request remains a captured view; a new snapshot is the boundary
    // that rechecks current metadata after the source changed.
    const changedSource = selectedSource;
    const changedStat = fs.statSync(changedSource);
    const changedNewer = new Date(changedStat.mtimeMs + 5000);
    fs.utimesSync(changedSource, changedNewer, changedNewer);
    const changedSnapshot = patch.createPatchCacheSnapshot(cacheRoot, resourceRoots, 'direct');
    assert.equal(resolve(changedSnapshot).status, 'stale');

    const report = {
      generatedAt: new Date().toISOString(),
      candidateCount: total,
      resourceRootCandidateCount: clientCount,
      repeatedLookups: 100,
      baseline: { cold: baselineCold, warm100: baselineWarm },
      snapshot: { cold: snapshotCold, warm100: snapshotWarm },
      reduction: {
        warmExistsSync: baselineWarm.existsSync - snapshotWarm.existsSync,
        warmStatSync: baselineWarm.statSync - snapshotWarm.statSync,
        warmElapsedMs: baselineWarm.elapsedMs - snapshotWarm.elapsedMs,
      },
      crossClientStatus: crossClient.status,
      changedSourceStatus: changedSnapshot.currentByManifest.size > 0
        ? changedSnapshot.currentByManifest.values().next().value
        : null,
      boundaries: [
        'snapshot currentness is request-scoped and filtered by resourceRoots before metadata checks',
        'snapshot is rejected when cacheRoot/resourceRoots/storage mode differ',
        'exact MD5 validation remains authoritative for exact-identity ITEMSHOW previews; ordinary assets use a final metadata gate and URI read gate',
      ],
    };
    const artifactPath = path.resolve(
      process.env.BOO_CACHE_PERF_OUT
        || path.join(runtimeRoot, 'artifacts', 'r19-cache-performance.json')
    );
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.existsSync = originalExists;
    fs.statSync = originalStat;
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('patch-cache-snapshot-performance.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
