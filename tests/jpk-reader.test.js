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
const { openArchiveIndexed, readArchiveImagePng } = require('../out/utils/archive-index');
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

    // Real edited GameLib files retain stale index words after the active table.
    // The declared count, not a sentinel or the physical EOF, owns logical IDs.
    for (const [name, tail] of [
      ['zero-padding', Buffer.alloc(80)],
      ['stale-index', Buffer.alloc(3364, 0xff)],
      ['opaque-tail', Buffer.from([1, 2, 3])],
    ]) {
      const file = path.join(root, `${name}.jpk`);
      fs.writeFileSync(file, Buffer.concat([fs.readFileSync(jpkPath), tail]));
      const archive = parseJpkFile(file, password);
      assert.equal(archive.trailerSize, tail.length);
      assert.equal(archive.slotCount, 4);
      assert.deepEqual(archive.blocks, parsed.blocks, 'tail bytes cannot add or shift slots');
    }
    const legacyTrailerPath = path.join(root, 'Different-Trailer-Word.jpk');
    buildFixture(legacyTrailerPath, password, { trailerWordCount: 4, invalidTrailer: true });
    assert.deepEqual(parseJpkFile(legacyTrailerPath, password).blocks, parsed.blocks);

    const invalidIndexPath = path.join(root, 'Invalid-Active-Index.jpk');
    const invalidIndex = fs.readFileSync(jpkPath);
    invalidIndex.writeUInt32LE(parsed.indexOffset, parsed.indexOffset);
    fs.writeFileSync(invalidIndexPath, invalidIndex);
    assert.throws(() => parseJpkFile(invalidIndexPath, password), /块头偏移越界/,
      'trailer tolerance must never forgive an out-of-range active pointer');
    fs.writeFileSync(invalidIndexPath, fs.readFileSync(jpkPath).subarray(0, -1));
    assert.throws(() => parseJpkFile(invalidIndexPath, password), /索引边界异常/);

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

    const partialPath = path.join(root, 'Partial.jpk');
    const partial = Buffer.concat([fs.readFileSync(jpkPath), Buffer.alloc(3364)]);
    // A wiped record and a damaged zlib stream, followed by a healthy frame.
    partial.fill(0, parsed.blocks[1].headerOffset, parsed.blocks[1].payloadOffset);
    partial[parsed.blocks[0].payloadOffset] ^= 0xff;
    fs.writeFileSync(partialPath, partial);
    const partialArchive = parseJpkFile(partialPath, password);
    assert.equal(partialArchive.slotCount, 4);
    assert.deepEqual(partialArchive.skippedMalformedIndices, [2]);
    assert.deepEqual(partialArchive.blocks.map(block => block.logicalIndex), [0, 3]);
    const hash = data => require('node:crypto').createHash('sha256').update(data).digest('hex');
    const sourceHash = hash(partial);
    const indexRoot = path.join(root, 'direct');
    const options = { extensionPath: path.resolve('.'), pakPath: partialPath, password, willIdx: 7 };
    const direct = await openArchiveIndexed({ ...options, indexRoot });
    assert.equal(direct.skippedMalformedCount, 1);
    assert.deepEqual(direct.assets.map(asset => asset.imageIdx), [0, 1, 2, 3]);
    assert.deepEqual(direct.assets.map(asset => asset.decodeStatus), ['indexed-unverified', 'empty', 'corrupt', 'indexed-unverified']);
    const read = imageIndex => readArchiveImagePng({
      extensionPath: path.resolve('.'), indexRoot, archiveId: direct.archiveId, imageIndex,
    });
    await assert.rejects(() => read(0), /zlib/, 'direct reads report the damaged frame');
    await assert.rejects(() => read(2), /invalid-image-header/, 'known bad header is not an empty frame');
    assert.deepEqual(await read(3), fs.readFileSync(result.assets[3].path));
    const cachedDirect = await openArchiveIndexed({ ...options, indexRoot });
    assert.equal(cachedDirect.fromCache, true);
    assert.equal(cachedDirect.skippedMalformedCount, 1);

    const legacyOptions = { ...options, cacheRoot: path.join(root, 'partial-cache') };
    const recovered = await decodePakFully(legacyOptions);
    assert.equal(recovered.skippedMalformedCount, 2);
    assert.deepEqual(recovered.assets.map(asset => asset.isBlank), [false, true, false, false]);
    assert.deepEqual(recovered.assets.map(asset => asset.decodeStatus), ['corrupt', 'empty', 'corrupt', 'decoded']);
    assert.equal(recovered.assets[0].path, '');
    assert.equal(recovered.assets[2].path, '');
    assert.deepEqual([recovered.assets[0].width, recovered.assets[0].height, recovered.assets[0].offsetX, recovered.assets[0].offsetY],
      [partialArchive.blocks[0].width, partialArchive.blocks[0].height, partialArchive.blocks[0].x, partialArchive.blocks[0].y],
      'a payload error must not discard dimensions/offsets from its validated header');
    assert.deepEqual(fs.readFileSync(recovered.assets[3].path), fs.readFileSync(result.assets[3].path));
    const cachedLegacy = await decodePakFully(legacyOptions);
    assert.equal(cachedLegacy.fromCache, true);
    assert.equal(cachedLegacy.skippedMalformedCount, 2);
    const { listCachedPatchPaks, isPatchCacheCurrent } = require('../out/utils/patch-cache');
    const legacyEntries = listCachedPatchPaks(legacyOptions.cacheRoot);
    assert.equal(legacyEntries.length, 1);
    assert.equal(isPatchCacheCurrent(legacyEntries[0]), true, 'an explicitly failed first image must not invalidate healthy later PNGs');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(recovered.cacheDir, 'manifest.json'))).skippedMalformedIndices, [0, 2]);
    assert.equal(hash(fs.readFileSync(partialPath)), sourceHash, 'reading cannot repair/write the input file');
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
