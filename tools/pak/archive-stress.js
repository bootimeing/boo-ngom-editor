/* Explicit long-running synthetic acceptance; intentionally excluded from test:all.
 * node tools/pak/archive-stress.js --run --report=<fresh absolute JSON path>
 * Optional --runtime=<unpacked extension root>. No user archive/cache is read.
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { performance } = require('node:perf_hooks');
const { spawn } = require('node:child_process');

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const runtimeRoot = path.resolve(option('runtime') || path.join(__dirname, '../..'));
const denseCount = Number(option('dense-count') || 30000);
const round = value => Math.round(value * 100) / 100;
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const tick = () => new Promise(resolve => setImmediate(resolve));

function pixels(id, width, height) {
  const bytes = Buffer.alloc(width * height * 4);
  let seed = (id + 1) | 0;
  for (let i = 0; i < bytes.length; i += 4) {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    bytes[i] = seed & 255; bytes[i + 1] = seed >>> 8 & 255;
    bytes[i + 2] = seed >>> 16 & 255; bytes[i + 3] = i ? 255 : 0;
  }
  return bytes;
}

// Test-only packed writer. Field layout matches the existing independent
// PACK4 fixture; it does not import the production parser or writer.
function writeFixture(file, count, ids, width, height) {
  const global = Buffer.alloc(64); global.write('PACK4.0 '); global.writeUInt32LE(count, 48);
  const index = Buffer.alloc(40 + count * 4); index.fill(0xa3, 0, 40);
  const fd = fs.openSync(file, 'wx');
  let position = 64;
  try {
    fs.writeSync(fd, global);
    for (const id of ids) {
      const raw = pixels(id, width, height), header = Buffer.alloc(23);
      index.writeUInt32LE(position, 40 + id * 4);
      header.writeUInt16LE(width << 4 | 9, 0); header.writeUInt16LE(height << 4 | 3, 2);
      header.writeInt16LE(id % 17 - 8, 4); header.writeInt16LE(id % 19 - 9, 6);
      header[12] = 3; header.writeUInt32LE(raw.length, 13); header[17] = 31;
      fs.writeSync(fd, header); fs.writeSync(fd, raw); position += header.length + raw.length;
    }
    const tail = zlib.deflateSync(index);
    fs.writeSync(fd, tail); global.writeUInt32LE((position ^ 0x5689) >>> 0, 40);
    global.writeUInt32LE(tail.length, 44); fs.writeSync(fd, global, 0, global.length, 0);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

function decodePng(bytes) {
  const png = Buffer.from(bytes), width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const chunks = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(chunks)), rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width * 4 + 1)], 0, 'independent oracle expects unfiltered PNG rows');
    raw.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  }
  return { width, height, rgba };
}

function checkPixels(png, id, width, height) {
  const decoded = decodePng(png), bgra = pixels(id, width, height), expected = Buffer.alloc(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    expected[i] = bgra[i + 2]; expected[i + 1] = bgra[i + 1];
    expected[i + 2] = bgra[i]; expected[i + 3] = bgra[i + 3];
  }
  assert.deepEqual([decoded.width, decoded.height], [width, height]);
  assert.deepEqual(decoded.rgba, expected, `pixel identity at logical ID ${id}`);
}

function cacheStats(directory) {
  let files = 0, bytes = 0, pngFiles = 0;
  const pending = [directory];
  while (pending.length) for (const entry of fs.readdirSync(pending.pop(), { withFileTypes: true })) {
    const filename = path.join(entry.parentPath || entry.path, entry.name);
    if (entry.isDirectory()) pending.push(filename);
    else { files++; bytes += fs.statSync(filename).size; if (/\.png$/i.test(entry.name)) pngFiles++; }
  }
  return { files, bytes, pngFiles };
}

async function scenario(name) {
  const api = require(path.join(runtimeRoot, 'out/utils/archive-index'));
  const { verifyArchive } = require(path.join(runtimeRoot, 'out/utils/archive-verification'));
  const { hashArchiveFile } = require(path.join(runtimeRoot, 'out/utils/archive-status'));
  const { ArchiveImageWorkerPool } = require(path.join(runtimeRoot, 'out/utils/archive-image-worker-pool'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-archive-pressure-'));
  const indexRoot = path.join(root, 'index'), source = path.join(root, `${name}.pak`);
  const slotCount = name === 'million-sparse' ? 1000000 : denseCount;
  const ids = name === 'million-sparse' ? [0, 500000, 999999] : Array.from({ length: slotCount }, (_, id) => id);
  const width = 32, height = 32;
  const workers = new ArchiveImageWorkerPool(1);
  const report = { name, evidenceKind: 'synthetic PACK4 plain BGRA, not a real client package',
    slotCount, validImages: ids.length, imageSize: [width, height], timingsMs: {}, checkpoints: [] };
  let maximumGap = 0, peakSampledRss = process.memoryUsage().rss, lastTick = performance.now(), phase = 'between';
  const phaseGaps = {};
  const sample = () => {
    const now = performance.now(), gap = now - lastTick;
    maximumGap = Math.max(maximumGap, gap); phaseGaps[phase] = Math.max(phaseGaps[phase] || 0, gap); lastTick = now;
    peakSampledRss = Math.max(peakSampledRss, process.memoryUsage().rss);
  };
  let timer;
  const checkpoint = stage => {
    const memory = process.memoryUsage(); peakSampledRss = Math.max(peakSampledRss, memory.rss);
    report.checkpoints.push({ stage, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, externalBytes: memory.external });
    process.stderr.write(`${name}: ${stage}\n`);
  };
  const time = async (key, fn) => {
    await tick(); sample(); phase = key;
    const started = performance.now(); const value = await fn();
    report.timingsMs[key] = round(performance.now() - started); await tick(); sample(); phase = 'between'; checkpoint(key); return value;
  };
  try {
    const started = performance.now(); writeFixture(source, slotCount, ids, width, height);
    report.fixtureCreationMs = round(performance.now() - started);
    report.sourceBytes = fs.statSync(source).size;
    report.sourceSha256Before = await hashArchiveFile(source);
    global.gc?.(); checkpoint('before-production');
    lastTick = performance.now(); timer = setInterval(sample, 5);
    const options = { extensionPath: runtimeRoot, indexRoot, pakPath: source, password: '', willIdx: 1,
      ensureBridge: async () => { throw new Error('PACK4 stress must not start the bridge'); } };
    let opened = await time('openIndexed', () => api.openArchiveIndexed(options));
    assert.equal(opened.profileId, 'pack4-plain-bgra'); assert.equal(opened.slotCount, slotCount);
    assert.equal(opened.assets.length, slotCount);
    const archiveId = opened.archiveId;
    const read = { extensionPath: runtimeRoot, indexRoot, archiveId };
    const first = await time('firstWorkerImage', () => workers.read({ ...read, imageIndex: 0 }));
    checkPixels(first, 0, width, height);
    report.timingsMs.indexAndFirstImage = round(report.timingsMs.openIndexed + report.timingsMs.firstWorkerImage);
    const lastId = ids[ids.length - 1];
    assert.equal(opened.assets[lastId].imageIdx, lastId);
    const tail = await time('tailWorkerImage', () => workers.read({ ...read, imageIndex: lastId }));
    checkPixels(tail, lastId, width, height); report.tailLogicalId = lastId;
    // Keep the rich host result alive through the table load to measure actual coexistence.
    let table = await time('assetTable', () => api.loadArchiveAssetTable(indexRoot, archiveId));
    assert.equal(table.slotCount, slotCount); assert.equal(table.blank[lastId], 0);
    if (name === 'million-sparse') assert.equal(table.blank[lastId - 1], 1);
    assert.equal(table.offsetX[lastId], lastId % 17 - 8); assert.equal(table.offsetY[lastId], lastId % 19 - 9);
    report.tableBytes = Object.values(table).filter(ArrayBuffer.isView).reduce((total, array) => total + array.byteLength, 0);
    // Exact transfer estimate without allocating a second gigantic JSON string.
    report.richAssetJsonBytes = await time('harnessRichJsonSizing', () => {
      let total = 1;
      for (const asset of opened.assets) total += Buffer.byteLength(JSON.stringify(asset)) + 1;
      return total;
    });
    checkpoint('rich-assets-and-table');
    opened = null; table = null; global.gc?.();
    const controller = new AbortController(); let abortedAt = 0;
    const cancelled = await time('verificationUntilCancel', () => verifyArchive({ ...read, signal: controller.signal,
      onProgress: value => {
        if (!abortedAt && value.state === 'running' && value.decodedThisRun >= (name === 'million-sparse' ? 0 : 128)) {
          abortedAt = performance.now(); controller.abort();
        }
      } }));
    assert.ok(abortedAt, 'must actually request cancellation during verification');
    report.cancelResponseMs = round(performance.now() - abortedAt);
    assert.equal(cancelled.state, 'cancelled');
    report.cancelled = { state: cancelled.state, decodedThisRun: cancelled.decodedThisRun, counts: cancelled.counts };
    const resumed = await time('verificationResume', () => verifyArchive({ ...read,
      onProgress: value => { if (value.decodedThisRun && value.decodedThisRun % 5000 === 0) checkpoint(`verified-${value.decodedThisRun}`); } }));
    assert.equal(resumed.state, 'complete'); assert.equal(resumed.counts.decoded, ids.length);
    assert.equal(resumed.counts.empty, slotCount - ids.length); assert.equal(resumed.counts['indexed-unverified'], 0);
    assert.equal(resumed.decodedThisRun + cancelled.decodedThisRun + 2, ids.length);
    report.resumed = { state: resumed.state, decodedThisRun: resumed.decodedThisRun, counts: resumed.counts };
    report.timingsMs.verificationTotal = round(report.timingsMs.verificationUntilCancel + report.timingsMs.verificationResume);
    api.forgetArchiveIndex(indexRoot);
    const reopened = await time('reopenAssetTable', () => api.loadArchiveAssetTable(indexRoot, archiveId));
    assert.equal(reopened.blank[lastId], 0); assert.equal(reopened.rejected[lastId], 0);
    const resumeNoop = await time('verificationAlreadyComplete', () => verifyArchive(read));
    assert.equal(resumeNoop.decodedThisRun, 0, 'completed ledger survives reopen without redecoding');
    report.sourceSha256After = await hashArchiveFile(source);
    assert.equal(report.sourceSha256After, report.sourceSha256Before);
    report.sourceUnchanged = true; report.cache = cacheStats(indexRoot); assert.equal(report.cache.pngFiles, 0);
    assert.ok(report.cache.files <= 8, 'direct preview must not make one cache file per image');
    report.passed = true;
  } catch (error) {
    report.passed = false; report.error = String(error.stack || error);
  } finally {
    clearInterval(timer); sample(); await workers.dispose();
    report.memory = { peakSampledRssBytes: peakSampledRss,
      processHighWaterRssBytes: process.resourceUsage().maxRSS * 1024,
      scope: 'entire child process including its image workers and fixture generation; not the parent runner' };
    report.maxEventLoopGapMs = round(maximumGap);
    report.eventLoopGapByPhaseMs = Object.fromEntries(Object.entries(phaseGaps).map(([name, gap]) => [name, round(gap)]));
    report.productionMaxEventLoopGapMs = round(Math.max(0, ...Object.entries(phaseGaps)
      .filter(([name]) => name !== 'between' && !name.startsWith('harness')).map(([, gap]) => gap)));
    // Only the freshly-created, exact validated OS temp directory can be removed.
    const actual = fs.realpathSync(root), temporary = fs.realpathSync(os.tmpdir());
    assert.equal(path.dirname(actual).toLowerCase(), temporary.toLowerCase());
    assert.ok(path.basename(actual).startsWith('boo-archive-pressure-'));
    api.forgetArchiveIndex(indexRoot);
    fs.rmSync(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    report.temporaryFilesRemoved = !fs.existsSync(actual);
  }
  return report;
}

async function runChild(name) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--expose-gc', __filename, `--child=${name}`, `--runtime=${runtimeRoot}`, `--dense-count=${denseCount}`],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; process.stderr.write(bytes); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`${name} exited ${code}: ${stderr}`)));
  });
}

async function main() {
  if (option('child')) { process.stdout.write(JSON.stringify(await scenario(option('child')))); return; }
  assert.ok(process.argv.includes('--run'), 'Long-run opt-in required: --run --report=<fresh JSON path>');
  assert.ok(Number.isInteger(denseCount) && denseCount >= 20000 && denseCount <= 100000, 'dense-count must be 20000..100000');
  const reportFile = path.resolve(option('report') || '');
  assert.ok(option('report') && !fs.existsSync(reportFile), '--report must be a new JSON file');
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  const files = ['archive-index', 'archive-verification', 'archive-status', 'archive-image-worker', 'archive-image-worker-pool', 'pack4-reader'];
  const runtimeHashes = Object.fromEntries(files.map(file => [file, sha(fs.readFileSync(path.join(runtimeRoot, 'out/utils', `${file}.js`)))]));
  const report = { createdAt: new Date().toISOString(), runtimeRoot, runtimeHashes,
    node: process.version, platform: `${process.platform}/${process.arch}`, totalSystemMemoryBytes: os.totalmem(),
    syntheticOnly: true, toolSha256: sha(fs.readFileSync(__filename)), scenarios: [] };
  try {
    for (const name of ['million-sparse', `dense-${denseCount}`]) {
      const result = await runChild(name); report.scenarios.push(result);
      assert.ok(result.passed, result.error);
    }
    for (const file of files) assert.equal(sha(fs.readFileSync(path.join(runtimeRoot, 'out/utils', `${file}.js`))), runtimeHashes[file], `runtime changed during stress: ${file}`);
    report.passed = true;
  } catch (error) { report.passed = false; report.error = String(error.stack || error); process.exitCode = 1; }
  finally { fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { flag: 'wx' }); }
  console.log(JSON.stringify({ passed: report.passed, reportFile, scenarios: report.scenarios.map(item => ({
    name: item.name, sourceBytes: item.sourceBytes, timingsMs: item.timingsMs,
    memory: item.memory, maxEventLoopGapMs: item.maxEventLoopGapMs, cache: item.cache })) }, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
