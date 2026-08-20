const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  deriveJpkRc4State,
  parseJpkFile,
  rc4Crypt,
  readJpkPayload,
  renderJpkRgba,
} = require('../out/utils/jpk-reader');
const { decodePakFully } = require('../out/utils/pak-reader');
const geeParser = require('../media/geepak3_exact.js');

function imageBlock(state, options) {
  const plaintext = options.compressed ? zlib.deflateSync(options.raw) : options.raw;
  const payload = rc4Crypt(plaintext, state);
  const record = Buffer.alloc(20);
  record[0] = options.bitsPerPixel;
  record[1] = options.compressed ? 1 : 0;
  record.writeUInt16LE(options.width, 2);
  record.writeUInt16LE(options.height, 4);
  record.writeInt16LE(options.x || 0, 6);
  record.writeInt16LE(options.y || 0, 8);
  record.writeUInt32LE(payload.length, 12);
  record[16] = options.alpha ? 1 : 0;
  return { record, payload };
}

function buildFixture(filePath, password, options = {}) {
  const state = deriveJpkRc4State(password);
  const indexedRaw = Buffer.from([
    1, 2, 3, 0,
    4, 5, 6, 0,
    7, 8, 9, 0,
  ]);
  const rgbaRaw = Buffer.alloc(48);
  const rgbAlphaRaw = Buffer.alloc(48);
  for (let pixel = 0; pixel < 9; pixel++) {
    const source = pixel * 4;
    rgbaRaw[source] = 10 + pixel;
    rgbaRaw[source + 1] = 20 + pixel;
    rgbaRaw[source + 2] = 30 + pixel;
    rgbaRaw[source + 3] = 0;
  }
  for (let pixel = 0; pixel < 9; pixel++) {
    const row = Math.floor(pixel / 3);
    const column = pixel % 3;
    rgbaRaw[36 + row * 4 + column] = 100 + pixel;
    const rgbSource = row * 12 + column * 3;
    rgbAlphaRaw[rgbSource] = 40 + pixel;
    rgbAlphaRaw[rgbSource + 1] = 50 + pixel;
    rgbAlphaRaw[rgbSource + 2] = 60 + pixel;
    rgbAlphaRaw[36 + row * 4 + column] = 150 + pixel;
  }

  const first = imageBlock(state, {
    bitsPerPixel: 8,
    compressed: true,
    width: 3,
    height: 3,
    x: -2,
    y: 4,
    raw: indexedRaw,
  });
  const third = imageBlock(state, {
    bitsPerPixel: 32,
    compressed: false,
    alpha: true,
    width: 3,
    height: 3,
    raw: rgbaRaw,
  });
  const fourth = imageBlock(state, {
    bitsPerPixel: 24,
    compressed: true,
    alpha: true,
    width: 3,
    height: 3,
    raw: rgbAlphaRaw,
  });

  const firstOffset = 80;
  const thirdOffset = firstOffset + first.record.length + first.payload.length;
  const fourthOffset = thirdOffset + third.record.length + third.payload.length;
  const indexOffset = fourthOffset + fourth.record.length + fourth.payload.length;
  const header = Buffer.alloc(80);
  const title = options.title || 'GameLib';
  const titleBytes = Buffer.from(title, 'ascii');
  header[0] = titleBytes.length;
  titleBytes.copy(header, 1);
  header.writeUInt32LE(80, 0x2c);
  header.writeUInt32LE(4, 0x30);
  header.writeUInt32LE(indexOffset, 0x34);
  header.writeDoubleLE(1234.5, 0x38);
  const index = Buffer.alloc(16);
  index.writeUInt32LE(firstOffset, 0);
  index.writeUInt32LE(0, 4);
  index.writeUInt32LE(thirdOffset, 8);
  index.writeUInt32LE(fourthOffset, 12);
  const trailerWordCount = options.trailerWordCount || 0;
  const trailer = Buffer.alloc(trailerWordCount * 4);
  if (trailer.length > 0) {
    trailer.writeUInt32LE(options.invalidTrailer ? indexOffset + 1 : indexOffset, 0);
    for (let word = 1; word < trailerWordCount; word++) {
      trailer.writeUInt32LE((0x12340000 + word) >>> 0, word * 4);
    }
  }

  fs.writeFileSync(filePath, Buffer.concat([
    rc4Crypt(header, state),
    first.record,
    first.payload,
    third.record,
    third.payload,
    fourth.record,
    fourth.payload,
    index,
    trailer,
  ]));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-jpk-reader-'));
  try {
    const password = '测试Pass';
    const jpkPath = path.join(root, 'Synthetic.jpk');
    buildFixture(jpkPath, password);

    const parsed = parseJpkFile(jpkPath, password);
    assert.equal(parsed.family, '996PC/XUW GameLib JPK');
    assert.equal(parsed.variant, 'GameLib');
    assert.equal(parsed.trailerSize, 0);
    assert.equal(parsed.slotCount, 4);
    assert.deepEqual(parsed.blocks.map(block => block.logicalIndex), [0, 2, 3]);
    assert.equal(parsed.blocks[0].format, 'JPK_A8_PALETTE');
    assert.equal(parsed.blocks[0].x, -2);
    assert.equal(parsed.blocks[0].y, 4);
    assert.equal(parsed.blocks[1].format, 'JPK_A8R8G8B8');
    assert.equal(parsed.blocks[2].format, 'JPK_R8G8B8_A8');
    assert.throws(() => parseJpkFile(jpkPath, 'wrong'), /密码错误/);

    for (const trailerWordCount of [4, 7]) {
      const trailerPath = path.join(root, `Trailer-${trailerWordCount * 4}.jpk`);
      buildFixture(trailerPath, password, { trailerWordCount });
      const trailerArchive = parseJpkFile(trailerPath, password);
      assert.equal(trailerArchive.variant, 'GameLib');
      assert.equal(trailerArchive.trailerSize, trailerWordCount * 4);
      assert.equal(trailerArchive.slotCount, 4);
    }

    const invalidTrailerPath = path.join(root, 'Invalid-Trailer.jpk');
    buildFixture(invalidTrailerPath, password, { trailerWordCount: 4, invalidTrailer: true });
    assert.throws(() => parseJpkFile(invalidTrailerPath, password), /尾部|边界/);

    const m2Path = path.join(root, '996M2.jpk');
    buildFixture(m2Path, password, { title: '996M2 GameLib 2021/07/27' });
    const m2Archive = parseJpkFile(m2Path, password);
    assert.equal(m2Archive.title, '996M2 GameLib 2021/07/27');
    assert.equal(m2Archive.variant, '996M2');
    assert.equal(m2Archive.trailerSize, 0);
    assert.deepEqual(m2Archive.blocks.map(block => block.logicalIndex), [0, 2, 3]);

    const unsupportedTitlePath = path.join(root, 'Unsupported-Title.jpk');
    buildFixture(unsupportedTitlePath, password, { title: '996M2 GameLib unknown' });
    assert.throws(() => parseJpkFile(unsupportedTitlePath, password), /密码错误|不是 996PC/);

    const handle = fs.openSync(jpkPath, 'r');
    try {
      const raw = readJpkPayload(handle, parsed.blocks[1], parsed.rc4State);
      const rgba = renderJpkRgba(raw, parsed.blocks[1], geeParser.A8_PALETTE_BGRA);
      assert.deepEqual(
        [...rgba.subarray(0, 4)],
        [36, 26, 16, 106],
        'JPK pixels must be converted from bottom-up BGR plus the independent alpha plane'
      );
      const rgbAlphaRawDecoded = readJpkPayload(handle, parsed.blocks[2], parsed.rc4State);
      const rgbAlphaRgba = renderJpkRgba(
        rgbAlphaRawDecoded,
        parsed.blocks[2],
        geeParser.A8_PALETTE_BGRA
      );
      assert.deepEqual(
        [...rgbAlphaRgba.subarray(0, 4)],
        [66, 56, 46, 156],
        '24-bit JPK pixels must retain their independent alpha plane'
      );
    } finally {
      fs.closeSync(handle);
    }

    const result = await decodePakFully({
      extensionPath: path.resolve('.'),
      cacheRoot: path.join(root, 'cache'),
      pakPath: jpkPath,
      password,
      willIdx: 7,
      ensureBridge: async () => {
        throw new Error('JPK must not start the PAK bridge');
      },
    });
    assert.equal(result.format, 'JPK');
    assert.equal(result.slotCount, 4);
    assert.deepEqual(
      result.assets.map(asset => asset.name),
      ['000000', '000001', '000002', '000003']
    );
    assert.equal(result.assets[1].isBlank, true);
    assert.ok(result.assets.every(asset => asset.source === 'jpk'));
    assert.ok(result.assets.every(asset => fs.existsSync(asset.path)));
    assert.deepEqual(
      [...fs.readFileSync(result.assets[0].path).subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10]
    );
  } finally {
    const resolvedRoot = path.resolve(root);
    if (resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolvedRoot, { recursive: true, force: true });
    }
  }
  console.log('jpk-reader.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
