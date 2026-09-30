const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hxmFixture } = require('./pak-hxm-pack4.test');
const { buildFixture } = require('./gom-reader-tolerance.test');
const { parseHxmFile } = require('../out/utils/hxm-reader');
const index = require('../out/utils/archive-index');
const { ArchiveImageWorkerPool } = require('../out/utils/archive-image-worker-pool');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-verification-'));
  const workers = new ArchiveImageWorkerPool(2);
  try {
    const options = { extensionPath: path.resolve(__dirname, '..'), indexRoot: path.join(root, 'index'), password: 'fixture', willIdx: 1 };
    const file = path.join(root, 'normal.pak'); fs.writeFileSync(file, hxmFixture(options.password));
    const result = await index.openArchiveIndexed({ ...options, pakPath: file });
    const read = { ...options, archiveId: result.archiveId, imageIndex: 0 };
    await Promise.all([0, 4].map(imageIndex => workers.read({ ...read, imageIndex })));
    index.forgetArchiveIndex(options.indexRoot);
    const assets = index.loadArchiveResult(options.indexRoot, result.archiveId, 1).assets;
    assert.equal(assets[0].decodeStatus, 'decoded', 'on-demand decode survives cache reopen');
    assert.equal(assets[4].decodeStatus, 'decoded', 'concurrent workers must not lose results');
    assert.equal(assets[1].decodeStatus, 'empty');
    const fresh = spawnSync(process.execPath, ['-e',
      "const m=require('./out/utils/archive-index'); console.log(m.loadArchiveResult(process.argv[1],process.argv[2],1).assets.map(a=>a.decodeStatus).join(','))",
      options.indexRoot, result.archiveId], { cwd: options.extensionPath, encoding: 'utf8', windowsHide: true });
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.equal(fresh.stdout.trim(), 'decoded,empty,empty,empty,decoded,empty', 'new process restores persisted results');
    const { verifyArchive } = require('../out/utils/archive-verification');
    const verification = await verifyArchive(read);
    assert.equal(verification.state, 'complete');
    assert.deepEqual(verification.counts, { empty: 4, 'indexed-unverified': 0, decoded: 2, recovered: 0, unsupported: 0, corrupt: 0 });
    assert.equal(verification.decodedThisRun, 0, 'resume uses results bound to the same source hash and generation');

    for (const [name, change, expected] of [
      ['recovered', (b, block) => { b[block.payloadOffset + block.payloadSize - 1] ^= 1; }, 'recovered'],
      ['corrupt', (b, block) => { b.fill(0xff, block.payloadOffset + 2, block.payloadOffset + block.payloadSize); }, 'corrupt'],
    ]) {
      const p = path.join(root, name + '.pak'); fs.writeFileSync(p, hxmFixture(options.password));
      const block = parseHxmFile(p, options.password).blocks.find(b => b.logicalIndex === 0);
      const bytes = fs.readFileSync(p); change(bytes, block); fs.writeFileSync(p, bytes);
      const opened = await index.openArchiveIndexed({ ...options, pakPath: p });
      const report = await verifyArchive({ ...read, archiveId: opened.archiveId });
      assert.equal(report.state, 'complete'); assert.equal(report.counts[expected], 1);
      assert.equal(report.counts.decoded, 1, 'bad slot does not stop subsequent good slots');
      assert.deepEqual(fs.readFileSync(p), bytes, 'verification never writes source');
      index.forgetArchiveIndex(options.indexRoot);
      assert.equal(index.loadArchiveResult(options.indexRoot, opened.archiveId, 1).assets[0].decodeStatus, expected);
      assert.equal(index.loadArchiveAssetTable(options.indexRoot, opened.archiveId).rejected[0], expected === 'corrupt' ? 1 : 0);
    }

    const bigFile = path.join(root, 'many.pak'); buildFixture(bigFile, options.password, new Set([1260]));
    const big = await index.openArchiveIndexed({ ...options, pakPath: bigFile });
    const controller = new AbortController();
    const cancelled = await verifyArchive({ ...read, archiveId: big.archiveId, signal: controller.signal,
      onProgress: report => { if (report.decodedThisRun >= 1) controller.abort(); } });
    assert.equal(cancelled.state, 'cancelled'); assert.ok(cancelled.counts['indexed-unverified'] > 0);
    const resumed = await verifyArchive({ ...read, archiveId: big.archiveId });
    assert.equal(resumed.state, 'complete'); assert.equal(resumed.counts.corrupt, 1);
    assert.equal(resumed.counts.decoded, 1654); assert.equal(resumed.counts.empty, 4);
    assert.equal(resumed.counts['indexed-unverified'], 0);
    assert.ok(resumed.decodedThisRun < 1654);
    // Worker launch and cache I/O failures are infrastructure failures, never corrupt slots.
    const infraFile = path.join(root, 'infra.pak'); fs.writeFileSync(infraFile, hxmFixture(options.password));
    const infra = await index.openArchiveIndexed({ ...options, pakPath: infraFile });
    const infraRead = { ...read, archiveId: infra.archiveId };
    const exists = fs.existsSync;
    try {
      fs.existsSync = file => String(file).endsWith('archive-image-worker.js') ? false : exists(file);
      await assert.rejects(verifyArchive(infraRead), /缺少.*Worker/);
    } finally { fs.existsSync = exists; }
    const status = require('../out/utils/archive-status');
    let infraSummary = index.loadArchiveSummary(options.indexRoot, infra.archiveId);
    assert.equal(status.readArchiveStatuses(options.indexRoot, infraSummary).some(Boolean), false);
    const open = fs.openSync;
    try {
      fs.openSync = (file, ...args) => {
        if (String(file).includes(`slots-${infraSummary.indexGeneration}`)) throw Object.assign(new Error('injected cache denied'), { code: 'EACCES' });
        return open(file, ...args);
      };
      await assert.rejects(index.readArchiveImagePng(infraRead), error => error.code === 'EACCES' && !(error instanceof status.ArchiveImageDataError));
    } finally { fs.openSync = open; }
    const simultaneous = await Promise.all([verifyArchive(infraRead), verifyArchive(infraRead)]);
    for (const r of simultaneous) assert.equal(r.counts.decoded, 2);
    const ledger = status.archiveStatusPath(options.indexRoot, infraSummary);
    const invalid = fs.readFileSync(ledger); invalid[64] = 255; fs.writeFileSync(ledger, invalid);
    await assert.rejects(verifyArchive(infraRead), /状态记录无效/);
    await index.openArchiveIndexed({ ...options, pakPath: infraFile, forceRefresh: true });
    const mid = await verifyArchive({ ...infraRead, onProgress: progress => {
      if (progress.decodedThisRun === 1) {
        const bytes = fs.readFileSync(infraFile); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(infraFile, bytes);
      }
    } }).then(() => null, error => error);
    assert.match(mid?.message || '', /变化/, 'source mutation during verification must reject completion');
    // Paired archive identity includes the companion, even if its size and mtime are restored.
    const wil = path.join(root, 'paired.wil'), wix = path.join(root, 'paired.wix');
    const wh = Buffer.alloc(56); wh.writeUInt32LE(1, 44); wh.writeUInt32LE(65536, 48);
    const frame = Buffer.alloc(12); frame.writeUInt16LE(2, 0); frame.writeUInt16LE(1, 2); frame.writeUInt16LE(0xf800, 8);
    const wi = Buffer.alloc(52); wi.writeUInt32LE(1, 44); wi.writeUInt32LE(56, 48);
    fs.writeFileSync(wil, Buffer.concat([wh, frame])); fs.writeFileSync(wix, wi);
    const pair = await index.openArchiveIndexed({ ...options, pakPath: wil });
    assert.equal((await verifyArchive({ ...read, archiveId: pair.archiveId })).counts.decoded, 1);
    const ws = fs.statSync(wix); wi[0] ^= 1; fs.writeFileSync(wix, wi); fs.utimesSync(wix, ws.atime, ws.mtime);
    await assert.rejects(verifyArchive({ ...read, archiveId: pair.archiveId }), /变化/);
    const old = index.loadArchiveSummary(options.indexRoot, result.archiveId);
    await index.openArchiveIndexed({ ...options, pakPath: file, forceRefresh: true });
    assert.throws(() => index.assertArchiveReadCurrent(options.indexRoot, old), /索引.*变化/);
    assert.equal(index.loadArchiveResult(options.indexRoot, result.archiveId, 1).assets[0].decodeStatus, 'indexed-unverified');
    const oldStat = fs.statSync(file); const changed = fs.readFileSync(file); changed[changed.length - 1] ^= 1;
    fs.writeFileSync(file, changed); fs.utimesSync(file, oldStat.atime, oldStat.mtime);
    await assert.rejects(verifyArchive(read), /变化/);
    // Bypass the metadata gate in this fixture to prove full content SHA is independently enforced.
    const summaryFile = path.join(result.cacheDir, 'summary.json');
    const altered = JSON.parse(fs.readFileSync(summaryFile)), now = fs.statSync(file);
    altered.sourceMtimeMs = now.mtimeMs; altered.sourceCtimeMs = now.ctimeMs;
    fs.writeFileSync(summaryFile, JSON.stringify(altered)); index.forgetArchiveIndex(options.indexRoot);
    await assert.rejects(verifyArchive(read), /内容已发生变化/);
    console.log('archive-verification.test.js: PASS (persistence, parallel workers, recovery, corrupt, cancellation/resume, generation, source/companion identity, infrastructure failures)');
  } finally { await workers.dispose(); removeTemporaryDirectory(root); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
