const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { feedbackEncode, rgbaFromPng } = require('./pak-hxm-pack4.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const root = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const runtime = name => require(path.join(root, 'out/utils', name));
const { parseHxmFile, decodeHxmPayload } = runtime('hxm-reader');
const { decodePakFully, inflatePakPayload, loadParser } = runtime('pak-reader');
const { openArchiveIndexed, readArchiveImagePng, forgetArchiveIndex } = runtime('archive-index');
const { ArchiveImageWorkerPool } = runtime('archive-image-worker-pool');
const { inspectPakStructure } = runtime('pak-structure');
const { verifyArchive } = runtime('archive-verification');

// Test-only writer from the packed records, independent of the production decoder.
function fixture(password, bitCount, pictures, options = {}) {
  const version = options.version ?? 0, recordSize = version ? 4 : 8, headerSize = version ? 16 : 12;
  const global = Buffer.alloc(256); global.writeUInt32LE(262, 42); global.writeUInt32LE(6, 46);
  global[50] = version; global.set([5, 7, 9], 51); global.writeUInt32LE(262, 54); global.writeUInt16LE(bitCount, 58);
  const check = feedbackEncode(Buffer.from('HXM2.'), password); global[68] = check.length; check.copy(global, 69);
  const index = Buffer.alloc(6 * recordSize), chunks = [];
  let at = 262 + index.length;
  for (const p of pictures) {
    const data = p.data ?? (p.mode === 2 ? zlib.deflateSync(p.raw) : p.raw);
    const header = Buffer.alloc(headerSize); header[0] = version ? ({ 8: 3, 16: 5, 24: 6, 32: 7 }[bitCount]) : p.mode;
    header.set([19, 37], 1); header[3] = version ? (options.alpha ?? 1) : 91; // opaque V0 bytes are NOT alpha
    header.writeInt16LE(p.w, 4); header.writeInt16LE(p.h, 6); header.writeInt16LE(-23, 8); header.writeInt16LE(17, 10);
    if (version) header.writeUInt32LE(p.mode === 2 ? data.length : 0, 12);
    index.writeInt32LE(at, p.id * recordSize);
    if (!version) index.writeInt32LE(p.declaredLength ?? headerSize + data.length, p.id * recordSize + 4);
    chunks.push(feedbackEncode(header, password), data); at += headerSize + data.length;
  }
  options.editIndex?.(index);
  return Buffer.concat([Buffer.from('HXM2.'), feedbackEncode(global, '442517066'), Buffer.alloc(1), feedbackEncode(index, password), ...chunks]);
}

function rleLiteral(bytes, bpp) {
  const out = [];
  for (let at = 0; at < bytes.length; at += 128 * bpp) {
    const chunk = bytes.subarray(at, at + 128 * bpp);
    out.push(Buffer.from([chunk.length / bpp - 1]), chunk);
  }
  return Buffer.concat(out);
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-hxm-layouts-'));
  const password = 'Synthetic-HXM-中文 ', workers = new ArchiveImageWorkerPool(1), parser = loadParser(root);
  let checked = 0;
  try {
    async function verify(name, bytes, expected, profile = 'hxm2-lz-v0') {
      const file = path.join(temporary, name + '.pak'); fs.writeFileSync(file, bytes);
      const options = { extensionPath: root, pakPath: file, password, willIdx: 1,
        ensureBridge: async () => { throw Error('HXM must not start the bridge'); } };
      const indexRoot = path.join(temporary, name, 'index'), cacheRoot = path.join(temporary, name, 'legacy');
      const direct = await openArchiveIndexed({ ...options, indexRoot });
      const legacy = await decodePakFully({ ...options, cacheRoot });
      assert.equal(direct.profileId, profile); assert.equal(legacy.profileId, profile);
      assert.equal(direct.slotCount, 6);
      for (let id = 0; id < 6; id++) {
        const read = { extensionPath: root, indexRoot, archiveId: direct.archiveId, imageIndex: id };
        const png = await readArchiveImagePng(read);
        assert.deepEqual(png, fs.readFileSync(legacy.assets[id].path));
        assert.deepEqual(png, Buffer.from(await workers.read(read)));
        assert.deepEqual(rgbaFromPng(png), expected[id] || Buffer.alloc(4), name + ':' + id);
        assert.equal(direct.assets[id].isBlank, !expected[id]);
        if (expected[id]) assert.deepEqual([direct.assets[id].offsetX, direct.assets[id].offsetY], [-23, 17]);
      }
      forgetArchiveIndex(indexRoot);
      const reopened = await openArchiveIndexed({ ...options, indexRoot });
      assert.equal(reopened.fromCache, true);
      assert.deepEqual(reopened.assets.map(a => a.decodeStatus), Array.from({ length: 6 }, (_, id) => expected[id] ? 'decoded' : 'empty'));
      assert.equal((await decodePakFully({ ...options, cacheRoot })).fromCache, true);
      const report = await inspectPakStructure({ ...options });
      assert.equal(report.profileId, profile); assert.equal(report.issues.length, 0);
      assert.equal(report.slots[4].indexEntry.length, profile.endsWith('v0') ? 8 : 4);
      assert.equal(report.slots[4].indexEntry.decodedOffset, profile.endsWith('v0') ? 32 : 16);
      assert.equal(report.slots[4].image.headerLength, profile.endsWith('v0') ? 12 : 16);
      if (profile.endsWith('v0')) assert.equal(report.slots[4].image.values.compressionMode, parseHxmFile(file, password).blocks[1].flags);
      assert.equal(JSON.stringify(report).includes(password), false);
      assert.throws(() => parseHxmFile(file, password.trimEnd()), /密码/);
      assert.deepEqual(fs.readFileSync(file), bytes);
      checked++;
    }

    // Two physical rows of four identical colors: repeat packets cross rows; literal packets exercise all bpp.
    // Indexed mode tests row/layout routing against the existing palette contract, not independent palette provenance.
    for (const [bits, pixel, rgba] of [
      [8, [1], [parser.A8_PALETTE_BGRA[6], parser.A8_PALETTE_BGRA[5], parser.A8_PALETTE_BGRA[4], parser.A8_PALETTE_BGRA[7]]],
      [16, [0x21, 0x08], [8, 4, 8, 255]], [24, [3, 2, 1], [1, 2, 3, 255]], [32, [0, 0, 0, 7], [0, 0, 0, 255]],
    ]) for (const mode of [0, 1, 2]) {
      const raw = Buffer.from(Array(8).fill(pixel).flat()), pixels = Buffer.from(Array(8).fill(rgba).flat());
      const p = { w: 4, h: 2, mode, raw };
      const pictures = [{ ...p, id: 4, ...(mode === 1 ? { data: Buffer.from([135, ...pixel]) } : {}) },
        { ...p, id: 1, ...(mode === 1 ? { data: rleLiteral(raw, bits / 8) } : {}) }];
      await verify(`v0-${bits}-${mode}`, fixture(password, bits, pictures), { 1: pixels, 4: pixels });
    }

    // Handwritten odd-width, two-row planes with poisoned padding. Independent expected color/alpha values.
    const vectors = [
      [16, [0x00,0xf8, 0xe0,0x07, 0x1f,0x00, 99,99, 0xff,0xff, 0x00,0x00, 0x21,0x08, 88,88],
        [248,252,248, 0,0,0, 8,4,8, 248,0,0, 0,252,0, 0,0,248]],
      [24, [0,0,255, 0,255,0, 255,0,0, 99,99,99, 255,255,255, 0,0,0, 3,2,1, 88,88,88],
        [255,255,255, 0,0,0, 1,2,3, 255,0,0, 0,255,0, 0,0,255]],
      [32, [0,0,255,1, 0,255,0,2, 255,0,0,3, 255,255,255,0, 0,0,0,7, 3,2,1,0],
        [255,255,255, 0,0,0, 1,2,3, 255,0,0, 0,255,0, 0,0,255]],
      [8, [1,0,1,99, 0,1,0,88], [0,1,0,1,0,1].flatMap(i => [parser.A8_PALETTE_BGRA[i*4+2], parser.A8_PALETTE_BGRA[i*4+1], parser.A8_PALETTE_BGRA[i*4]])],
    ];
    for (const [bits, colors, rgb] of vectors) for (const version of [0, 1]) {
      const alpha = [0, 17, 127, 66, 255, 128, 1, 77];
      const raw = Buffer.from(version ? [...colors, ...alpha] : colors);
      const pixels = Buffer.from(Array.from({ length: 6 }, (_, i) => {
        const c = rgb.slice(i * 3, i * 3 + 3);
        const a = version ? [255,128,1,0,17,127][i] : bits === 8 ? parser.A8_PALETTE_BGRA[[0,1,0,1,0,1][i]*4+3]
          : bits !== 32 && c.every(v => v === 0) ? 0 : 255;
        return [...c, a];
      }).flat());
      await verify(`odd-${bits}-v${version}`, fixture(password, bits,
        [{ id: 4, w: 3, h: 2, mode: 0, raw }, { id: 1, w: 3, h: 2, mode: 2, raw }], { version }),
      { 1: pixels, 4: pixels }, `hxm2-lz-v${version}`);
    }

    await verify('v0-single-row-rle', fixture(password, 24, [4,1].map(id => ({
      id, w: 3, h: 1, mode: 1, data: Buffer.from([130, 3, 2, 1]),
    }))), { 1: Buffer.from([1,2,3,255, 1,2,3,255, 1,2,3,255]), 4: Buffer.from([1,2,3,255, 1,2,3,255, 1,2,3,255]) });

    // Direct RLE packet boundaries; no fixture encoder as the expected decoder oracle.
    const decode = (payload, width = 4, height = 2, imageType = 3) => {
      const bpp = imageType === 3 ? 1 : imageType - 3;
      const block = { imageType, flags: 1, width, height, rawSize: ((width * bpp + 3) & ~3) * height };
      return decodeHxmPayload(Buffer.from(payload), block, 'hxm2-lz-v0', inflatePakPayload).raw;
    };
    assert.deepEqual([...decode([130,7, 1,8,9, 130,10])], [7,7,7,8,9,10,10,10]);
    assert.deepEqual([...decode([255,6], 128, 1)], Array(128).fill(6));
    assert.deepEqual([...decode([127, ...Array.from({ length:128 }, (_, i) => i)], 128, 1)], Array.from({ length:128 }, (_, i) => i));
    assert.deepEqual([...decode([128,4, 128,5], 2, 1)], [4,5,0,0]);
    for (const type of [5,6,7]) {
      const pixel = Array.from({ length: type - 3 }, (_, i) => i + 1);
      assert.deepEqual([...decode([255, ...pixel], 128, 1, type)], Array(128).fill(pixel).flat());
    }
    for (const payload of [[], [135], [7,1], [136,1], [135,1,0], [134,1]]) {
      assert.throws(() => decode(payload), /RLE/);
    }
    assert.throws(() => decode([133,1], 3, 2), /不支持.*行对齐/);
    assert.throws(() => decode([255,1], 5000, 1), /尺寸/);

    const bad = path.join(temporary, 'bad.pak'), p = { id: 1, w: 4, h: 2, mode: 0, raw: Buffer.alloc(24) };
    for (const [pictures, options, pattern] of [
      [[{ ...p, declaredLength: -1 }], {}, /长度/], [[{ ...p, declaredLength: 11 }], {}, /长度/],
      [[{ ...p, declaredLength: 100000 }], {}, /越界|重叠/],
      [[p], { editIndex: b => b.writeInt32LE(12, 4) }, /空槽/],
      [[p], { editIndex: b => b.writeInt32LE(-1, 8) }, /索引越界/],
      [[p], { editIndex: b => b.copy(b, 4*8, 8, 16) }, /重复/],
      [[p, { ...p, id: 4 }], { editIndex: b => b.writeInt32LE(37, 12) }, /重叠/],
    ]) { fs.writeFileSync(bad, fixture(password, 24, pictures, options)); assert.throws(() => parseHxmFile(bad, password), pattern); }
    fs.writeFileSync(bad, fixture(password, 15, [p])); assert.throws(() => parseHxmFile(bad, password), /色深/);
    fs.writeFileSync(bad, fixture(password, 24, [p]).subarray(0, -1)); assert.throws(() => parseHxmFile(bad, password), /越界|重叠/);

    // One unsupported and one bad payload must not renumber or hide the final valid slot.
    for (const [name, badPicture, status, layout = {}] of [
      ['unaligned', { ...p, w: 3, mode: 1, data: Buffer.from([133,1,2,3]) }, 'unsupported'],
      ['unknown-mode', { ...p, mode: 9 }, 'unsupported'],
      ['short-rle', { ...p, mode: 1, data: Buffer.from([135,1]) }, 'corrupt'],
      ['short-raw', { ...p, raw: Buffer.alloc(23) }, 'corrupt'],
      ['oversize-zlib', { ...p, mode: 2, data: zlib.deflateSync(Buffer.alloc(1024 * 1024)) }, 'corrupt'],
      ['trailing-zlib', { ...p, mode: 2, data: Buffer.concat([zlib.deflateSync(p.raw), Buffer.from([7])]) }, 'corrupt'],
      ['v1-565-ambiguous', { ...p, w: 3, raw: Buffer.alloc(16) }, 'unsupported', { version: 1, alpha: 0, bitCount: 16 }],
    ]) {
      const bits = layout.bitCount || 24;
      const file = path.join(temporary, name + '.pak'), bytes = fixture(password, bits,
        [badPicture, { ...p, id: 4, raw: Buffer.alloc(bits) }], layout);
      fs.writeFileSync(file, bytes);
      const options = { extensionPath: root, pakPath: file, password, willIdx: 1, indexRoot: path.join(temporary, name, 'index') };
      const opened = await openArchiveIndexed(options);
      const read = { extensionPath: root, indexRoot: options.indexRoot, archiveId: opened.archiveId, imageIndex: 1 };
      await assert.rejects(workers.read(read));
      await readArchiveImagePng({ ...read, imageIndex: 4 });
      forgetArchiveIndex(options.indexRoot);
      const reopened = await openArchiveIndexed(options);
      assert.equal(reopened.assets[1].decodeStatus, status); assert.equal(reopened.assets[1].isBlank, false);
      assert.equal(reopened.assets[4].decodeStatus, 'decoded');
      const legacy = await decodePakFully({ ...options, cacheRoot: path.join(temporary, name, 'legacy') });
      assert.equal(legacy.assets[1].decodeStatus, status); assert.equal(legacy.assets[1].isBlank, false);
      assert.equal(fs.existsSync(legacy.assets[1].path), false); assert.equal(legacy.assets[4].decodeStatus, 'decoded');
      const report = await verifyArchive(read);
      assert.deepEqual(report.counts, { empty: 4, 'indexed-unverified': 0, decoded: 1, recovered: 0,
        unsupported: status === 'unsupported' ? 1 : 0, corrupt: status === 'corrupt' ? 1 : 0 });
      assert.equal(report.state, 'complete'); assert.equal(report.failures[0].id, 1);
      assert.deepEqual(fs.readFileSync(file), bytes);
    }

    // V0 and V1 zlib checksum recovery retains its status through Worker/legacy/reopen.
    for (const version of [0,1]) {
      const raw = Buffer.alloc(version ? 32 : 24), broken = zlib.deflateSync(raw); broken[broken.length - 1] ^= 1;
      const bytes = fixture(password, 24, [{ ...p, mode: 2, raw, data: broken }, { ...p, id: 4, raw }], { version });
      const file = path.join(temporary, `recovered-v${version}.pak`); fs.writeFileSync(file, bytes);
      const options = { extensionPath: root, pakPath: file, password, willIdx: 1, indexRoot: path.join(temporary, `recover-${version}`) };
      const opened = await openArchiveIndexed(options);
      const read = { extensionPath: root, indexRoot: options.indexRoot, archiveId: opened.archiveId, imageIndex: 1 };
      const report = await verifyArchive(read);
      assert.deepEqual(report.counts, { empty: 4, 'indexed-unverified': 0, decoded: 1, recovered: 1, unsupported: 0, corrupt: 0 });
      assert.equal(report.failures.length, 0);
      assert.deepEqual(Buffer.from(await workers.read(read)), await readArchiveImagePng(read));
      forgetArchiveIndex(options.indexRoot);
      assert.equal((await openArchiveIndexed(options)).assets[1].decodeStatus, 'recovered');
      const legacy = await decodePakFully({ ...options, cacheRoot: path.join(temporary, `recover-legacy-${version}`) });
      assert.equal(legacy.recoveredChecksumCount, 1); assert.equal(legacy.assets[1].decodeStatus, 'recovered');
      assert.deepEqual(fs.readFileSync(file), bytes);
    }

    // Safe cache invalidation never mutates the user's package or removes the old directory.
    const emptyFile = path.join(temporary, 'empty.pak'); fs.writeFileSync(emptyFile, fixture(password, 8, []));
    const emptyOptions = { extensionPath: root, pakPath: emptyFile, password, willIdx: 1, indexRoot: path.join(temporary, 'empty-index') };
    const empty = await openArchiveIndexed(emptyOptions);
    assert.equal(empty.assets.filter(a => a.isBlank).length, 6);
    const summaryFile = path.join(empty.cacheDir, 'summary.json'), oldSummary = JSON.parse(fs.readFileSync(summaryFile));
    oldSummary.decoderRevision = 'archive-direct-v3-slot-ledger'; fs.writeFileSync(summaryFile, JSON.stringify(oldSummary));
    forgetArchiveIndex(emptyOptions.indexRoot);
    assert.equal((await openArchiveIndexed(emptyOptions)).fromCache, false);
    assert.equal(fs.existsSync(empty.cacheDir), true);
    console.log(`pak-hxm-layouts.test.js: PASS (${checked} full-chain layouts, bounded RLE, slot isolation, structure, cache, independent true-color/alpha vectors; synthetic only)`);
  } finally {
    await workers.dispose();
    assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(temporary).startsWith('boo-hxm-layouts-'));
    removeTemporaryDirectory(temporary);
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture };
