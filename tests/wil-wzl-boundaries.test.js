const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtimeRoot = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const { readWilWzlImagePng } = require(path.join(runtimeRoot, 'out/utils/wil-wzl-reader'));
const { encodePng } = require(path.join(runtimeRoot, 'out/utils/pak-reader'));
const { rgbaFromPng } = require('./pak-hxm-pack4.test');

// Independent standard PNG chunk writer; test-only, no production CRC helper.
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(bytes.length + 8); result.writeUInt32BE(data.length);
  bytes.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
}
function pngFixture(depth, color, interlace, raw, options = {}) {
  const header = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, depth, color, 0, 0, interlace]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    ...(color === 3 ? [chunk('PLTE', Buffer.alloc(6))] : []),
    chunk('IDAT', Buffer.concat([zlib.deflateSync(raw), options.tail || Buffer.alloc(0)])), chunk('IEND', Buffer.alloc(0))]);
}

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-wzl-boundaries-'));
  let ordinal = 0;
  const read = (payload, fields = {}) => {
    const file = path.join(root, `${ordinal++}.bin`); fs.writeFileSync(file, payload);
    const fd = fs.openSync(file, 'r');
    try {
      return readWilWzlImagePng(fd, { logicalIndex: 13, width: 1, height: 1, x: 0, y: 0, imageType: 6, flags: 0,
        payloadOffset: 0, payloadSize: payload.length, compressedSize: payload.length, rawSize: 4, ...fields }, { format: 'WZL' }, Buffer.alloc(1024));
    } finally { fs.closeSync(fd); }
  };
  const rejected = (run, reasonCode) => assert.throws(run, error => {
    assert.equal(error.diagnostic?.reasonCode, reasonCode); return true;
  });
  try {
    // Previously accepted a 1 MiB row for a 1x1 BGR24 image and silently ignored it.
    rejected(() => read(zlib.deflateSync(Buffer.alloc(1024 * 1024, 1))), 'decompression-failed');
    for (const raw of [Buffer.from([0, 0, 255]), Buffer.from([0, 0, 255, 0])]) {
      assert.deepEqual([...rgbaFromPng(read(zlib.deflateSync(raw)))], [255, 0, 0, 255]);
    }
    for (const raw of [Buffer.from([0, 248, 0, 248, 0x80, 0xf0]), Buffer.from([0, 248, 0, 0, 0, 248, 0, 0, 0x80, 0xf0])]) {
      assert.deepEqual([...rgbaFromPng(read(zlib.deflateSync(raw), { width: 1, height: 2, imageType: 5, flags: 9, rawSize: 10 }))], [255, 0, 0, 255, 255, 0, 0, 136]);
    }
    rejected(() => read(Buffer.concat([zlib.deflateSync(Buffer.from([0, 0, 255])), Buffer.from([3])])), 'trailing-compressed-data');
    rejected(() => read(zlib.deflateSync(Buffer.from([0, 0]))), 'decoded-size-mismatch');
    const png = encodePng(1, 1, Uint8ClampedArray.from([10, 20, 30, 40]));
    assert.deepEqual(read(png, { imageType: 8, compressedSize: 0, rawSize: png.length }), png);
    rejected(() => read(png.subarray(0, 24), { imageType: 8, compressedSize: 0 }), 'invalid-image-block');
    rejected(() => read(png.subarray(0, png.length - 4), { imageType: 8, compressedSize: 0 }), 'invalid-image-block');
    rejected(() => read(Buffer.concat([png, Buffer.from([1])]), { imageType: 8, compressedSize: 0 }), 'invalid-image-block');
    const badCrc = Buffer.from(png); badCrc[29] ^= 1;
    rejected(() => read(badCrc, { imageType: 8, compressedSize: 0 }), 'invalid-image-block');
    const pngFields = { width: 2, height: 2, imageType: 8, compressedSize: 0 };
    for (const [depth, color, interlace, bytes] of [[1, 0, 0, 4], [16, 2, 0, 26], [8, 3, 0, 6],
      [8, 4, 0, 10], [16, 6, 0, 34], [8, 6, 1, 19]]) {
      const candidate = pngFixture(depth, color, interlace, Buffer.alloc(bytes));
      assert.deepEqual(read(candidate, pngFields), candidate);
    }
    rejected(() => read(pngFixture(8, 6, 0, Buffer.alloc(1024 * 1024)), pngFields), 'decompression-failed');
    const badFilter = Buffer.alloc(18); badFilter[0] = 5;
    rejected(() => read(pngFixture(8, 6, 0, badFilter), pngFields), 'invalid-image-block');
    rejected(() => read(pngFixture(8, 6, 0, Buffer.alloc(18), { tail: Buffer.from([1]) }), pngFields), 'decompression-failed');
    rejected(() => read(Buffer.alloc(1), { width: 16384, height: 16384 }), 'resource-limit');
    const infrastructure = new Error('host unavailable'); infrastructure.code = 'ENOMEM';
    const original = zlib.inflateSync;
    try {
      zlib.inflateSync = () => { throw infrastructure; };
      assert.throws(() => read(Buffer.alloc(3)), error => error === infrastructure);
    } finally { zlib.inflateSync = original; }
    console.log('WIL/WZL bounded inflation, tight/aligned strides, alpha, PNG chunks/CRC and infrastructure errors: PASS');
  } finally { removeTemporaryDirectory(root); }
}
main();
