const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtimeRoot = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const runtime = name => require(path.join(runtimeRoot, 'out/utils', name));
const { parseWilWzlArchive } = runtime('wil-wzl-reader');
const archive = runtime('archive-index');
const { ArchiveImageWorkerPool } = runtime('archive-image-worker-pool');
const { verifyArchive } = runtime('archive-verification');
const { rgbaFromPng } = require('./pak-hxm-pack4.test');

function wilRecord(options = {}) {
  const header = Buffer.alloc(8);
  header.writeUInt16LE(options.width ?? 1, 0); header.writeUInt16LE(options.height ?? 1, 2);
  header.writeInt16LE(-2, 4); header.writeInt16LE(3, 6);
  return Buffer.concat([header, options.payload ?? Buffer.from([13, 17, 23])]);
}
function wzlRecord(options = {}) {
  if (options.blank) return Buffer.alloc(16);
  const header = Buffer.alloc(16), payload = options.payload ?? Buffer.from([13, 17, 23]);
  header.writeUInt16LE(options.type ?? 6, 0);
  header.writeUInt16LE(options.width ?? 1, 4); header.writeUInt16LE(options.height ?? 1, 6);
  header.writeInt16LE(-2, 8); header.writeInt16LE(3, 10);
  header.writeUInt32LE(options.storedSize ?? 0, 12);
  return Buffer.concat([header, payload]);
}
function writePair(root, name, format, records, selection = [null, 0, 1]) {
  const prefix = Buffer.alloc(format === 'WIL' ? 56 : 64);
  if (format === 'WIL') { prefix.writeUInt32LE(selection.length, 44); prefix.writeUInt32LE(16777216, 48); }
  const positions = [], parts = [prefix]; let position = prefix.length;
  for (const record of records) { positions.push(position); parts.push(record); position += record.length; }
  const index = Buffer.alloc(48 + selection.length * 4); index.writeUInt32LE(selection.length, 44);
  selection.forEach((entry, id) => index.writeUInt32LE(entry === null ? 0
    : typeof entry === 'object' ? entry.offset(position) : positions[entry], 48 + id * 4));
  const dataPath = path.join(root, name + '.' + format.toLowerCase());
  const indexPath = path.join(root, name + (format === 'WIL' ? '.wix' : '.wzx'));
  fs.writeFileSync(dataPath, Buffer.concat(parts)); fs.writeFileSync(indexPath, index);
  return { dataPath, indexPath };
}
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-wil-wzl-rejected-'));
  const workers = new ArchiveImageWorkerPool(1);
  const parserOnly = process.argv.includes('--parser-only');
  let scenarios = 0;
  try {
    const cases = [
      ['wil-outside', 'WIL', wilRecord(), 'index-out-of-bounds', [null, { offset: n => n + 100 }, 1]],
      ['wil-header-prefix', 'WIL', wilRecord(), 'index-out-of-bounds', [null, { offset: () => 1 }, 1]],
      ['wil-zero-dimensions', 'WIL', wilRecord({ width: 0 }), 'invalid-dimensions'],
      ['wil-excess-dimensions', 'WIL', wilRecord({ width: 16385 }), 'invalid-dimensions'],
      ['wil-short-payload', 'WIL', wilRecord({ payload: Buffer.from([1]) }), 'payload-out-of-bounds'],
      ['wil-header-overlap', 'WIL', Buffer.alloc(4, 1), 'overlapping-blocks'],
      ['wzl-outside', 'WZL', wzlRecord(), 'index-out-of-bounds', [null, { offset: n => n + 100 }, 1]],
      ['wzl-zero-dimensions', 'WZL', wzlRecord({ width: 0 }), 'invalid-dimensions'],
      ['wzl-unknown-type', 'WZL', wzlRecord({ type: 77 }), 'unsupported-image-layout'],
      ['wzl-short-raw', 'WZL', wzlRecord({ payload: Buffer.from([1]) }), 'payload-out-of-bounds'],
      ['wzl-payload-outside', 'WZL', wzlRecord({ storedSize: 999999 }), 'payload-out-of-bounds'],
      ['wzl-payload-overlap', 'WZL', wzlRecord({ storedSize: 5 }), 'overlapping-blocks'],
      ['wzl-invalid-png', 'WZL', wzlRecord({ type: 8, storedSize: 8, payload: Buffer.alloc(8, 1) }), 'invalid-image-block'],
      ['wzl-short-png', 'WZL', wzlRecord({ type: 8, storedSize: 2, payload: Buffer.alloc(2) }), 'invalid-image-block'],
      ['wzl-header-overlap', 'WZL', Buffer.alloc(4, 1), 'overlapping-blocks'],
    ];
    for (const [name, format, bad, reasonCode, selection] of cases) {
      const good = format === 'WIL' ? wilRecord() : wzlRecord();
      const pair = writePair(root, name, format, [bad, good], selection);
      const before = [digest(pair.dataPath), digest(pair.indexPath)];
      const parsed = parseWilWzlArchive(pair.dataPath);
      assert.ok(Array.isArray(parsed.rejectedSlots), `${name}: nonzero invalid index was silently converted into empty`);
      assert.deepEqual(parsed.rejectedSlots, [{ logicalIndex: 1, reasonCode,
        status: reasonCode === 'unsupported-image-layout' ? 'unsupported' : 'corrupt' }], name);
      assert.equal(parsed.slotCount, 3); assert.ok(parsed.blocks.some(block => block.logicalIndex === 2), name);
      if (parserOnly) {
        assert.deepEqual([digest(pair.dataPath), digest(pair.indexPath)], before);
        scenarios++; continue;
      }
      const indexRoot = path.join(root, 'cache-' + name);
      const options = { extensionPath: runtimeRoot, indexRoot, pakPath: pair.dataPath, password: '', willIdx: 8 };
      const result = await archive.openArchiveIndexed(options);
      assert.deepEqual(result.assets.map(asset => asset.decodeStatus), ['empty', parsed.rejectedSlots[0].status, 'indexed-unverified'], name);
      assert.deepEqual(result.assets.map(asset => asset.isBlank), [true, false, false], name);
      assert.equal(result.skippedMalformedCount, 1);
      const read = { extensionPath: runtimeRoot, indexRoot, archiveId: result.archiveId, imageIndex: 1 };
      await assert.rejects(archive.readArchiveImagePng(read), error => error.slotCode === (reasonCode === 'unsupported-image-layout' ? 4 : 5));
      await assert.rejects(workers.read(read), error => error.slotCode === (reasonCode === 'unsupported-image-layout' ? 4 : 5));
      const png = await archive.readArchiveImagePng({ ...read, imageIndex: 2 });
      assert.deepEqual([...rgbaFromPng(png)], [23, 17, 13, 255]);
      assert.deepEqual(Buffer.from(await workers.read({ ...read, imageIndex: 2 })), png);
      archive.forgetArchiveIndex(indexRoot);
      const reopened = archive.loadArchiveResult(indexRoot, result.archiveId, 8);
      assert.equal(reopened.assets[1].decodeStatus, parsed.rejectedSlots[0].status);
      assert.equal(reopened.assets[1].failureCode, reasonCode);
      const verification = await verifyArchive(read);
      assert.equal(verification.state, 'complete');
      assert.deepEqual(verification.counts, { empty: 1, 'indexed-unverified': 0, decoded: 1, recovered: 0,
        unsupported: reasonCode === 'unsupported-image-layout' ? 1 : 0, corrupt: reasonCode === 'unsupported-image-layout' ? 0 : 1 });
      assert.deepEqual([digest(pair.dataPath), digest(pair.indexPath)], before, 'source pair must remain unchanged');
      scenarios++;
    }
    // Explicit full-zero WZL sentinel and valid image aliases retain all original IDs.
    for (const selection of [[0, 1], [0, 0, 1, 1]]) {
      const pair = writePair(root, 'sentinel-' + selection.length, 'WZL', [wzlRecord({ blank: true }), wzlRecord()], selection);
      const parsed = parseWilWzlArchive(pair.dataPath);
      assert.deepEqual(parsed.rejectedSlots, []);
      assert.deepEqual(parsed.blocks.map(block => block.logicalIndex), selection.flatMap((entry, id) => entry === 1 ? [id] : []));
      scenarios++;
    }
    for (const format of ['WIL', 'WZL']) {
      const good = format === 'WIL' ? wilRecord() : wzlRecord();
      const pair = writePair(root, format + '-late-alias', format, [good], [0, null, 0]);
      const parsed = parseWilWzlArchive(pair.dataPath);
      assert.deepEqual(parsed.rejectedSlots, []);
      assert.deepEqual(parsed.blocks.map(block => block.logicalIndex), [0, 2]);
      const bad = format === 'WIL' ? wilRecord({ width: 0 }) : wzlRecord({ type: 77 });
      const badAliasPair = writePair(root, format + '-bad-alias', format, [bad, good], [0, 0, 1]);
      assert.deepEqual(parseWilWzlArchive(badAliasPair.dataPath).rejectedSlots.map(slot => slot.logicalIndex), [0, 1], 'all aliases of a bad record must retain their own IDs');
      const originalRead = fs.readSync, hostError = new Error('fixture IO failure'); hostError.code = 'EIO';
      try {
        fs.readSync = () => { throw hostError; };
        assert.throws(() => parseWilWzlArchive(pair.dataPath), error => error === hostError, 'host failure must not become a corrupt slot');
      } finally { fs.readSync = originalRead; }
      try {
        fs.readSync = (...args) => args[3] === (format === 'WIL' ? 8 : 16) ? 0 : originalRead(...args);
        assert.throws(() => parseWilWzlArchive(pair.dataPath), error => error.diagnostic?.stage === 'source', 'unexpected source truncation must abort instead of marking a slot');
      } finally { fs.readSync = originalRead; }
      const truncated = fs.readFileSync(pair.indexPath).subarray(0, 48); fs.writeFileSync(pair.indexPath, truncated);
      assert.throws(() => parseWilWzlArchive(pair.dataPath), error => error.diagnostic?.reasonCode === 'index-truncated');
      scenarios++;
    }
    // Decode-time failure still belongs to a nonempty indexed slot, not parse-time empty.
    const badPayload = zlib.deflateSync(Buffer.alloc(1024, 1));
    const pair = writePair(root, 'decode-late', 'WZL', [wzlRecord({ storedSize: badPayload.length, payload: badPayload }), wzlRecord()]);
    assert.deepEqual(parseWilWzlArchive(pair.dataPath).rejectedSlots, []);
    console.log(`wil-wzl-rejected-slots.test.js: PASS (${scenarios} negative/alias/sentinel scenarios, ${parserOnly ? 'PARSER ONLY' : 'direct/Worker/reopen/verify'}, source pair hashes)`);
  } finally { await workers.dispose(); removeTemporaryDirectory(root); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
