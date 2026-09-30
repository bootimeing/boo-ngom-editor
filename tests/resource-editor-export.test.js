const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const archive = require(path.join(runtime, 'out/utils/archive-index'));
const archiveStatus = require(path.join(runtime, 'out/utils/archive-status'));
const { ArchiveImageDataError } = archiveStatus;
const { exportArchiveImages } = require(path.join(runtime, 'out/resource-editor/export'));
const { hxmFixture, rgbaFromPng } = require('./pak-hxm-pack4.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readManifest = result => JSON.parse(fs.readFileSync(result.manifestPath, 'utf8'));

// Independent minimal WIL/WIX fixture, retaining arbitrary empty IDs and negative coordinates.
function makeWil(root, count = 4, bad = false) {
  const data = Buffer.alloc(56 + 11 * (bad ? 2 : 1));
  data.writeUInt32LE(count, 44); data.writeUInt32LE(16777216, 48);
  data.writeUInt16LE(1, 56); data.writeUInt16LE(1, 58);
  data.writeInt16LE(-3, 60); data.writeInt16LE(4, 62);
  data.set([13, 17, 23], 64);
  if (bad) { data.writeUInt16LE(0, 67); data.writeUInt16LE(1, 69); }
  const wix = Buffer.alloc(48 + count * 4); wix.writeUInt32LE(count, 44);
  wix.writeUInt32LE(56, 48);
  if (bad) wix.writeUInt32LE(67, 56);
  const source = path.join(root, `pair-${count}-${bad}.wil`);
  const companion = source.replace(/\.wil$/, '.wix');
  fs.writeFileSync(source, data); fs.writeFileSync(companion, wix);
  return { source, companion };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-resource-export-'));
  let checks = 0;
  try {
    const destinationParent = path.join(root, 'exports'); fs.mkdirSync(destinationParent);
    const common = { extensionPath: runtime, indexRoot: path.join(root, 'indexes'),
      password: 'private-password-不得导出', willIdx: 1 };
    const source = path.join(root, 'private-source-name.pak');
    fs.writeFileSync(source, hxmFixture(common.password));
    const opened = await archive.openArchiveIndexed({ ...common, pakPath: source });
    const options = { ...common, archiveId: opened.archiveId, indexGeneration: opened.indexGeneration,
      destinationParent, selection: { kind: 'all' } };
    const sourceBefore = hash(fs.readFileSync(source));
    const first = await exportArchiveImages(options), manifest = readManifest(first);
    assert.equal(first.state, 'complete'); assert.equal(first.completed, 6);
    assert.equal(first.exported, 2); assert.equal(first.empty, 4); assert.equal(first.failed, 0);
    assert.deepEqual(manifest.entries.map(row => row.id), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(manifest.entries.filter(row => row.file).map(row => [row.id, row.x, row.y]),
      [[0, 13, -17], [4, -23, 7]]);
    assert.equal(manifest.profileId, 'hxm2-lz-v1');
    assert.equal(manifest.entries[0].sourceStatus, 'decoded');
    assert.equal(manifest.entries[0].compression, 'zlib');
    assert.equal(manifest.entries[0].pixelFormat, 'BGR24');
    assert.equal(manifest.sourceUnchanged, true); assert.equal(manifest.sourceSha256Before, sourceBefore);
    assert.equal(manifest.sourceSha256After, sourceBefore); assert.equal(hash(fs.readFileSync(source)), sourceBefore);
    for (const row of manifest.entries.filter(row => row.file)) {
      const png = fs.readFileSync(path.join(first.directory, row.file));
      const production = await archive.readArchiveImagePng({ ...common, archiveId: opened.archiveId, imageIndex: row.id });
      assert.equal(row.pngSha256, hash(png));
      assert.deepEqual(rgbaFromPng(png), rgbaFromPng(Buffer.from(production)));
    }
    const text = fs.readFileSync(first.manifestPath, 'utf8');
    for (const secret of [source, root, common.password, 'passwordHash', 'jpkRc4State', 'pakPath', 'private-source-name']) {
      assert.equal(text.includes(secret), false, secret);
    }
    checks++;

    const ranged = await exportArchiveImages({ ...options, selection: { kind: 'range', start: 3, end: 5 } });
    assert.deepEqual(readManifest(ranged).entries.map(row => row.id), [3, 4, 5]);
    const selected = await exportArchiveImages({ ...options, selection: { kind: 'ids', ids: [4, 0, 4] } });
    assert.deepEqual(readManifest(selected).entries.map(row => row.id), [0, 4]);
    assert.equal(selected.total, 2); assert.notEqual(first.directory, selected.directory);
    assert.equal(hash(fs.readFileSync(path.join(first.directory, '000000.png'))), manifest.entries[0].pngSha256);
    for (const selection of [{ kind: 'range', start: -1, end: 2 }, { kind: 'range', start: 3, end: 2 },
      { kind: 'range', start: 0, end: 6 }, { kind: 'ids', ids: [0, 99] }, { kind: 'ids', ids: [1.5] }]) {
      await assert.rejects(exportArchiveImages({ ...options, selection }), /invalid-selection/);
    }
    await assert.rejects(exportArchiveImages({ ...options, selection: { kind: 'ids', ids: Array(10001).fill(0) } }), /invalid-selection/);
    checks++;

    const badPair = makeWil(root, 4, true);
    const pairOpen = await archive.openArchiveIndexed({ ...common, pakPath: badPair.source });
    const pairOptions = { ...options, archiveId: pairOpen.archiveId, indexGeneration: pairOpen.indexGeneration };
    const partial = await exportArchiveImages(pairOptions), badManifest = readManifest(partial);
    assert.equal(partial.state, 'partial'); assert.equal(partial.failed, 1); assert.equal(partial.empty, 2);
    assert.equal(partial.exported, 1); assert.equal(badManifest.entries[2].status, 'corrupt');
    assert.equal(badManifest.entries[2].x, null); assert.equal(badManifest.entries[2].file, null);
    assert.equal(fs.existsSync(path.join(partial.directory, '000002.png')), false);
    assert.equal(badManifest.companionSha256Before, hash(fs.readFileSync(badPair.companion)));
    assert.equal(badManifest.companionSha256Before, badManifest.companionSha256After);
    checks++;

    const badDecode = await exportArchiveImages({ ...options, readPng: async id => {
      if (id === 0) throw new ArchiveImageDataError(`password ${common.password} ${source}`, 3);
      return archive.readArchiveImagePng({ ...common, archiveId: opened.archiveId, imageIndex: id });
    } });
    assert.equal(badDecode.state, 'partial'); assert.equal(badDecode.failed, 1); assert.equal(badDecode.exported, 1);
    assert.equal(fs.readFileSync(badDecode.manifestPath, 'utf8').includes(common.password), false);
    const badPng = await exportArchiveImages({ ...options, selection: { kind: 'ids', ids: [0] },
      readPng: async () => Buffer.from('not a PNG') });
    assert.equal(badPng.state, 'partial'); assert.equal(badPng.failed, 1);
    assert.equal(fs.existsSync(path.join(badPng.directory, '000000.png')), false);
    checks++;

    const controller = new AbortController();
    const cancelled = await exportArchiveImages({ ...options, signal: controller.signal, readPng: async id => {
      const png = await archive.readArchiveImagePng({ ...common, archiveId: opened.archiveId, imageIndex: id });
      controller.abort(); return png;
    } });
    const cancelledManifest = readManifest(cancelled);
    assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.completed, 0);
    assert.equal(cancelledManifest.unprocessed, 6); assert.equal(cancelledManifest.sourceUnchanged, true);
    checks++;

    const originalInspect = archive.inspectArchiveSlots, batchSizes = [], millionAbort = new AbortController();
    const millionPair = makeWil(root, 1000000);
    const millionOpen = await archive.openArchiveIndexed({ ...common, pakPath: millionPair.source });
    try {
      archive.inspectArchiveSlots = (...args) => {
        assert.ok(args[3].length <= 100);
        if (args[3].length > 1) {
          batchSizes.push(args[3].length);
          if (batchSizes.length === 2) millionAbort.abort();
        }
        return originalInspect(...args);
      };
      const million = await exportArchiveImages({ ...options, archiveId: millionOpen.archiveId,
        indexGeneration: millionOpen.indexGeneration, signal: millionAbort.signal });
      assert.equal(million.total, 1000000); assert.equal(million.state, 'cancelled');
      assert.equal(million.completed, 100); assert.ok(batchSizes.every(n => n <= 100));
      assert.ok(fs.statSync(million.manifestPath).size < 50000, 'cancelled million range is compact');
    } finally { archive.inspectArchiveSlots = originalInspect; }
    checks++;

    const changed = await exportArchiveImages({ ...options, readPng: async id => {
      const png = await archive.readArchiveImagePng({ ...common, archiveId: opened.archiveId, imageIndex: id });
      fs.appendFileSync(source, Buffer.from([9])); return png;
    } });
    assert.equal(changed.state, 'partial'); assert.equal(changed.exported, 0);
    assert.equal(readManifest(changed).sourceUnchanged, false);
    assert.equal(readManifest(changed).reasonCode, 'source-changed');
    await assert.rejects(exportArchiveImages(options), /source-changed/);
    checks++;

    const companionChanged = await exportArchiveImages({ ...pairOptions, readPng: async id => {
      const png = await archive.readArchiveImagePng({ ...common, archiveId: pairOpen.archiveId, imageIndex: id });
      fs.appendFileSync(badPair.companion, Buffer.from([1])); return png;
    } });
    assert.equal(companionChanged.state, 'partial'); assert.equal(readManifest(companionChanged).sourceUnchanged, false);
    checks++;

    const originalOpen = fs.promises.open;
    try {
      fs.promises.open = async (file, ...args) => {
        if (String(file).endsWith('.png.incomplete')) throw Object.assign(new Error('secret disk path'), { code: 'ENOSPC' });
        return originalOpen(file, ...args);
      };
      const diskFailure = await exportArchiveImages({ ...options, archiveId: millionOpen.archiveId,
        indexGeneration: millionOpen.indexGeneration, selection: { kind: 'ids', ids: [0] } });
      assert.equal(diskFailure.state, 'partial'); assert.equal(diskFailure.exported, 0);
      assert.equal(readManifest(diskFailure).reasonCode, 'read-or-write-failed');
    } finally { fs.promises.open = originalOpen; }
    checks++;

    const largeOptions = { ...options, archiveId: millionOpen.archiveId,
      indexGeneration: millionOpen.indexGeneration, selection: { kind: 'ids', ids: [0] } };
    const originalMkdtemp = fs.promises.mkdtemp;
    let occupiedDirectory;
    try {
      fs.promises.mkdtemp = async (...args) => {
        occupiedDirectory = await originalMkdtemp(...args);
        fs.writeFileSync(path.join(occupiedDirectory, '000000.png'), 'existing-data');
        return occupiedDirectory;
      };
      const occupied = await exportArchiveImages(largeOptions);
      assert.equal(occupied.state, 'partial'); assert.equal(occupied.exported, 0);
      assert.equal(fs.readFileSync(path.join(occupiedDirectory, '000000.png'), 'utf8'), 'existing-data');
    } finally { fs.promises.mkdtemp = originalMkdtemp; }
    checks++;

    try {
      fs.promises.open = async (file, ...args) => {
        const handle = await originalOpen(file, ...args);
        if (String(file).endsWith('manifest.json')) {
          handle.write = async () => { throw new Error(`disk failure ${root} ${common.password}`); };
        }
        return handle;
      };
      await assert.rejects(exportArchiveImages(largeOptions), error => {
        assert.equal(error.message.includes(root), false);
        assert.equal(error.message.includes(common.password), false);
        return /manifest-write-failed/.test(error.message);
      });
    } finally { fs.promises.open = originalOpen; }
    checks++;

    try {
      archive.inspectArchiveSlots = (...args) => originalInspect(...args).map(row => ({ ...row,
        metadata: row.metadata && { ...row.metadata, offsetX: undefined, offsetY: undefined } }));
      const unknownXY = await exportArchiveImages(largeOptions);
      assert.equal(readManifest(unknownXY).entries[0].x, null);
      assert.equal(readManifest(unknownXY).entries[0].y, null);
    } finally { archive.inspectArchiveSlots = originalInspect; }
    checks++;

    const staleGeneration = await exportArchiveImages({ ...largeOptions, readPng: async id => {
      const png = await archive.readArchiveImagePng({ ...common, archiveId: millionOpen.archiveId, imageIndex: id });
      await archive.openArchiveIndexed({ ...common, pakPath: millionPair.source, forceRefresh: true });
      return png;
    } });
    assert.equal(staleGeneration.state, 'partial'); assert.equal(staleGeneration.exported, 0);
    assert.equal(readManifest(staleGeneration).reasonCode, 'source-changed');
    checks++;

    const freshOptions = { ...largeOptions,
      indexGeneration: archive.loadArchiveSummary(common.indexRoot, millionOpen.archiveId).indexGeneration };
    const originalLink = fs.promises.link;
    try {
      fs.promises.link = async () => { throw Object.assign(new Error('no hard links'), { code: 'ENOTSUP' }); };
      const fallback = await exportArchiveImages(freshOptions);
      assert.equal(fallback.state, 'complete'); assert.equal(fallback.exported, 1);
      const row = readManifest(fallback).entries[0];
      assert.equal(hash(fs.readFileSync(path.join(fallback.directory, row.file))), row.pngSha256);
      assert.equal(fs.readdirSync(fallback.directory).some(file => file.endsWith('.incomplete')), false);
      fs.promises.mkdtemp = async (...args) => {
        const directory = await originalMkdtemp(...args);
        fs.writeFileSync(path.join(directory, '000000.png'), 'keep-fallback-target');
        return directory;
      };
      const refused = await exportArchiveImages(freshOptions);
      assert.equal(refused.state, 'partial'); assert.equal(refused.exported, 0);
      assert.equal(fs.readFileSync(path.join(refused.directory, '000000.png'), 'utf8'), 'keep-fallback-target');
    } finally { fs.promises.link = originalLink; fs.promises.mkdtemp = originalMkdtemp; }
    checks++;

    const preAbort = new AbortController(); preAbort.abort();
    const directoriesBefore = fs.readdirSync(destinationParent).length;
    await assert.rejects(exportArchiveImages({ ...freshOptions, signal: preAbort.signal }), /cancelled/);
    assert.equal(fs.readdirSync(destinationParent).length, directoriesBefore);
    const originalHash = archiveStatus.hashArchiveFile, hashAbort = new AbortController();
    try {
      archiveStatus.hashArchiveFile = async (file, signal) => { hashAbort.abort(); return originalHash(file, signal); };
      await assert.rejects(exportArchiveImages({ ...freshOptions, signal: hashAbort.signal }), /cancelled/);
      assert.equal(fs.readdirSync(destinationParent).length, directoriesBefore);
    } finally { archiveStatus.hashArchiveFile = originalHash; }
    checks++;

    const recovered = await exportArchiveImages({ ...freshOptions, readPng: async id => {
      const png = await archive.readArchiveImagePng({ ...common, archiveId: millionOpen.archiveId, imageIndex: id });
      const summary = archive.loadArchiveSummary(common.indexRoot, millionOpen.archiveId);
      archiveStatus.writeArchiveStatus(common.indexRoot, summary, id, 2);
      return png;
    } });
    assert.equal(recovered.state, 'complete');
    assert.equal(readManifest(recovered).entries[0].sourceStatus, 'recovered');
    checks++;
    console.log(`resource-editor-export.test.js: PASS (${checks} groups; production PNG worker, IDs/XY/empty/bad slots, privacy, million-slot bounded selection, cancellation, source/pair guards, write failure)`);
  } finally { archive.forgetArchiveIndex(path.join(root, 'indexes')); removeTemporaryDirectory(root); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
