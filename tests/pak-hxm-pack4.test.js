const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const iconv = require('iconv-lite');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtimeRoot = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const runtime = name => require(path.join(runtimeRoot, 'out/utils', name));
const { parseHxmFile, hxmRawSize, renderHxmRgba } = runtime('hxm-reader');
const { parsePack4File, renderPack4Rgba, PACK4_PREFIX_FILE } = runtime('pack4-reader');
const { decodePakFully, loadParser } = runtime('pak-reader');
const { openArchiveIndexed, readArchiveImagePng, forgetArchiveIndex } = runtime('archive-index');
const { ArchiveImageWorkerPool } = runtime('archive-image-worker-pool');
const { invalidatePatchCacheIndex, listCachedPatchPaks } = runtime('patch-cache');

// Independent fixture writer, never imported by the production readers.
function feedbackEncode(bytes, password) {
  const key = crypto.createHash('sha1').update(iconv.encode(password, 'cp936')).digest().subarray(0, 8);
  const des = b => {
    const c = crypto.createCipheriv('des-ede3', Buffer.concat([key, key, key]), null);
    c.setAutoPadding(false); return Buffer.concat([c.update(b), c.final()]);
  };
  let previous = Buffer.concat([des(Buffer.alloc(8, 0x8f)), Buffer.alloc(12, 0x8f)]);
  const out = Buffer.alloc(bytes.length);
  for (let at = 0; at < bytes.length; at += 20) {
    const n = Math.min(20, bytes.length - at);
    if (n === 20) {
      const part = Buffer.alloc(n);
      for (let i = 0; i < n; i++) part[i] = bytes[at + i] ^ previous[i];
      des(part.subarray(0, 8)).copy(part); part.copy(out, at); previous = part;
    } else {
      const mask = Buffer.concat([des(previous.subarray(0, 8)), previous.subarray(8)]);
      for (let i = 0; i < n; i++) out[at + i] = bytes[at + i] ^ mask[i];
    }
  }
  return out;
}
function fixturePixels(width, height, seed) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = (i + seed) % 256; rgba[i + 1] = (i + seed + 20) % 256;
    rgba[i + 2] = (i + seed + 50) % 256; rgba[i + 3] = (i + seed + 90) % 256;
  }
  rgba.fill(0, 0, 4); // transparent black must not become opaque.
  return rgba;
}
const pictures = [
  { id: 4, w: 3, h: 1, x: -23, y: 7, pixels: fixturePixels(3, 1, 19) },
  { id: 0, w: 5, h: 8, x: 13, y: -17, pixels: fixturePixels(5, 8, 39) },
];
const SLOT_COUNT = 6;
function hxmFixture(password, options = {}) {
  const global = Buffer.alloc(256); global.writeUInt32LE(262, 42);
  global.writeUInt32LE(SLOT_COUNT, 46); global.writeUInt32LE(options.version ?? 1, 50);
  if (options.versionReserved) Buffer.from(options.versionReserved).copy(global, 51, 0, 3);
  global.writeUInt32LE(262, 54); global.writeUInt16LE(24, 58);
  const check = feedbackEncode(Buffer.from(options.badCheck ? 'WRONG' : 'HXM2.'), password);
  global[68] = options.checkLength ?? check.length; check.copy(global, 69);
  const index = Buffer.alloc(SLOT_COUNT * 4), chunks = [];
  let offset = 262 + index.length;
  for (const pic of pictures) {
    index.writeUInt32LE(offset, pic.id * 4);
    const colorStride = (pic.w * 3 + 3) & ~3, alphaStride = (pic.w + 3) & ~3;
    const raw = Buffer.alloc((colorStride + alphaStride) * pic.h);
    for (let y = 0; y < pic.h; y++) for (let x = 0; x < pic.w; x++) {
      const src = (y * pic.w + x) * 4, dst = (pic.h - 1 - y) * colorStride + x * 3;
      raw[dst] = pic.pixels[src + 2]; raw[dst + 1] = pic.pixels[src + 1]; raw[dst + 2] = pic.pixels[src];
      raw[colorStride * pic.h + (pic.h - 1 - y) * alphaStride + x] = pic.pixels[src + 3];
    }
    const compressed = options.compressed ?? (pic.id === 0);
    const payload = compressed ? zlib.deflateSync(raw) : raw;
    const head = Buffer.alloc(16); head[0] = options.type ?? 6; head[3] = 1;
    head.writeUInt16LE(pic.w, 4); head.writeUInt16LE(pic.h, 6);
    head.writeInt16LE(pic.x, 8); head.writeInt16LE(pic.y, 10);
    head.writeUInt32LE(compressed ? payload.length : 0, 12);
    chunks.push(feedbackEncode(head, password), payload); offset += 16 + payload.length;
  }
  if (options.duplicate) index.writeUInt32LE(index.readUInt32LE(0), 4 * 4);
  if (options.badIndex) index.writeUInt32LE(1, 0);
  return Buffer.concat([Buffer.from('HXM2.'), feedbackEncode(global, '442517066'), Buffer.alloc(1), feedbackEncode(index, password), ...chunks]);
}
function pack4Fixture(password, encrypted, options = {}) {
  const key = iconv.encode(password, 'cp936');
  const xor = (b, count) => { for (let i = 0; i < count; i++) b[i] ^= key[i % key.length]; return b; };
  const global = Buffer.alloc(64); global.write('PACK4.0 ');
  global.writeUInt32LE(SLOT_COUNT, encrypted ? 24 : 48);
  const index = Buffer.alloc(40 + SLOT_COUNT * 4, 0);
  index.fill(0xa3, 0, 40); // opaque prefix must not be interpreted as ten extra slots.
  const chunks = []; let offset = 64;
  for (const pic of pictures) {
    index.writeUInt32LE(offset, 40 + pic.id * 4);
    const header = Buffer.alloc(23), payload = Buffer.alloc(pic.pixels.length);
    header.writeUInt16LE((pic.w << 4) | 9, 0); header.writeUInt16LE((pic.h << 4) | 3, 2);
    header.writeInt16LE(pic.x, 4); header.writeInt16LE(pic.y, 6);
    header[12] = options.type ?? 3; header.writeUInt32LE(payload.length, 13); header[17] = 31;
    for (let i = 0; i < payload.length; i += 4) {
      payload[i] = pic.pixels[i + 2]; payload[i + 1] = pic.pixels[i + 1];
      payload[i + 2] = pic.pixels[i]; payload[i + 3] = pic.pixels[i + 3];
    }
    if (encrypted) { xor(header, 16); xor(payload, Math.min(128, payload.length)); }
    chunks.push(header, payload); offset += header.length + payload.length;
  }
  if (options.duplicate) index.writeUInt32LE(index.readUInt32LE(40), 40 + 4 * 4);
  if (options.badIndex) index.writeUInt32LE(1, 40);
  if (options.overlap) index.writeUInt32LE(65, 40);
  let tail = zlib.deflateSync(index);
  if (options.trailing) tail = Buffer.concat([tail, Buffer.from([1])]);
  if (encrypted) xor(tail, tail.length);
  global.writeUInt32LE(offset ^ 0x5689, 40); global.writeUInt32LE(tail.length, 44);
  return Buffer.concat([global, ...chunks, tail]);
}
function rgbaFromPng(png) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), parts = [];
  for (let at = 8; at < png.length;) {
    const n = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + n));
    at += n + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts)), pixels = [];
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1); assert.equal(raw[start], 0);
    pixels.push(raw.subarray(start + 1, start + 1 + width * 4));
  }
  return Buffer.concat(pixels);
}
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-pak-variants-'));
  const workers = new ArchiveImageWorkerPool(1), password = 'Synthetic-中文-42';
  const parser = loadParser(runtimeRoot);
  try {
    for (const [name, build, parse, format] of [
      ['HXM', opts => hxmFixture(password, { versionReserved: [1, 2, 3], ...opts }), parseHxmFile, 'HXM'],
      ['PACK4', opts => pack4Fixture(password, false, opts), parsePack4File, 'PACK4'],
      ['KSF', opts => pack4Fixture(password, true, opts), parsePack4File, 'PACK4'],
    ]) {
      const file = path.join(root, name + '.pak'), source = build(); fs.writeFileSync(file, source);
      const options = { extensionPath: runtimeRoot, pakPath: file, password, willIdx: 3,
        ensureBridge: async () => { throw new Error('new formats must not start an external bridge'); } };
      const indexRoot = path.join(root, name, 'archive-index-v1'), cacheRoot = path.join(root, name, 'patch-cache');
      const direct = await openArchiveIndexed({ ...options, indexRoot });
      const legacy = await decodePakFully({ ...options, cacheRoot });
      assert.equal(direct.profileId, legacy.profileId);
      assert.equal(direct.format, format); assert.equal(direct.slotCount, SLOT_COUNT);
      assert.equal(direct.skippedMalformedCount, 0); assert.equal(legacy.recoveredChecksumCount, 0);
      const parsed = parse(file, password); assert.deepEqual(parsed.blocks.map(b => b.logicalIndex), [0, 4]);
      for (let id = 0; id < SLOT_COUNT; id++) {
        const readOptions = { extensionPath: options.extensionPath, indexRoot, archiveId: direct.archiveId, imageIndex: id };
        const png = await readArchiveImagePng(readOptions);
        assert.deepEqual(png, fs.readFileSync(legacy.assets[id].path));
        assert.deepEqual(png, Buffer.from(await workers.read(readOptions)));
        const pic = pictures.find(p => p.id === id), asset = direct.assets[id];
        assert.equal(asset.isBlank, !pic);
        assert.equal(asset.decodeStatus, pic ? 'indexed-unverified' : 'empty');
        assert.equal(legacy.assets[id].decodeStatus, pic ? 'decoded' : 'empty');
        assert.deepEqual(rgbaFromPng(png), pic ? pic.pixels : Buffer.alloc(4), `${name} slot ${id} pixels/alpha/orientation`);
        if (pic) assert.deepEqual([asset.width, asset.height, asset.offsetX, asset.offsetY], [pic.w, pic.h, pic.x, pic.y]);
      }
      forgetArchiveIndex(indexRoot);
      assert.equal((await openArchiveIndexed({ ...options, indexRoot })).fromCache, true);
      assert.equal((await decodePakFully({ ...options, cacheRoot })).fromCache, true);
      invalidatePatchCacheIndex();
      assert.equal(listCachedPatchPaks(cacheRoot, root).length, 1);
      if (name !== 'PACK4') assert.throws(() => parse(file, 'wrong'), /密码/);
      if (name === 'KSF') {
        const prefixPath = path.join(direct.cacheDir, PACK4_PREFIX_FILE);
        const prefix = fs.readFileSync(prefixPath);
        assert.equal(prefix.length, 256);
        assert.equal(fs.readFileSync(path.join(direct.cacheDir, 'summary.json'), 'utf8').includes(password), false);
        prefix[0] ^= 1; fs.writeFileSync(prefixPath, prefix); forgetArchiveIndex(indexRoot);
        assert.equal((await openArchiveIndexed({ ...options, indexRoot })).fromCache, false, 'corrupt pixel prefix forces safe rebuild');
      }
      assert.deepEqual(fs.readFileSync(file), source, 'read-only source preservation');
      for (const [options, pattern] of [
        [{ duplicate: true }, /重复/], [{ badIndex: true }, /索引越界/], [{ type: 99 }, /布局/],
        ...(name === 'HXM' ? [[{ version: 2 }, /版本 2/], [{ badCheck: true }, /密码/]] : [[{ trailing: true }, /索引损坏/]]),
      ]) {
        fs.writeFileSync(file, build(options)); assert.throws(() => parse(file, password), pattern, name + JSON.stringify(options));
      }
      fs.writeFileSync(file, source.subarray(0, source.length - 1));
      assert.throws(() => parse(file, password), /截断|越界|索引损坏|重叠/);
      fs.writeFileSync(file, source.subarray(0, 4)); assert.throws(() => parse(file, password), /截断|越界/);
    }
    // HXM has a separate alpha plane, including when color depth is 32 bits.
    const raw32 = Buffer.from([0, 0, 0, 128, 30, 20, 10, 7, 11, 201, 0, 0]);
    const block32 = { imageType: 7, flags: 1, width: 2, height: 1, rawSize: 12 };
    assert.deepEqual([...renderHxmRgba(raw32, block32, parser)], [0, 0, 0, 11, 10, 20, 30, 201]);
    assert.deepEqual([...renderHxmRgba(raw32.subarray(0, 8), { ...block32, flags: 0, rawSize: 8 }, parser)], [0, 0, 0, 255, 10, 20, 30, 255]);
    assert.throws(() => hxmRawSize(4, 0, 1, 1), /布局/);
    assert.throws(() => hxmRawSize(6, 0, 5000, 1), /尺寸/);
    assert.throws(() => renderPack4Rgba(Buffer.alloc(4), { imageType: 3, flags: 1, width: 1, height: 1, rawSize: 4 }), /前缀缓存/);
    console.log('pak-hxm-pack4.test.js: PASS (3 profiles, full slots, independent RGBA, Worker, cache rebuild and negative fixtures)');
  } finally {
    await workers.dispose(); removeTemporaryDirectory(root);
  }
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { feedbackEncode, hxmFixture, pack4Fixture, rgbaFromPng };
