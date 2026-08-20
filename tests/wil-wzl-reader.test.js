const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  openArchiveIndexed,
  readArchiveImagePng,
} = require('../out/utils/archive-index');
const { encodePng, loadParser } = require('../out/utils/pak-reader');
const {
  uiEditorArchiveExtensions,
  uiEditorArchiveLabel,
} = require('../out/utils/ui-archive');
const { ArchiveImageWorkerPool } = require('../out/utils/archive-image-worker-pool');

const extensionPath = path.resolve('.');

function buildIndex(count, offsets) {
  const result = Buffer.alloc(48 + count * 4);
  result.writeUInt32LE(count, 44);
  offsets.forEach((offset, index) => result.writeUInt32LE(offset, 48 + index * 4));
  return result;
}

function wilFrame(width, height, x, y, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt16LE(width, 0);
  header.writeUInt16LE(height, 2);
  header.writeInt16LE(x, 4);
  header.writeInt16LE(y, 6);
  return Buffer.concat([header, payload]);
}

function buildPaletteWil(wilPath, wixPath) {
  const header = Buffer.alloc(56 + 1024);
  header.writeUInt32LE(3, 44);
  header.writeUInt32LE(256, 48);
  header.writeUInt32LE(1024, 52);
  const palette = header.subarray(56);
  palette.set([0, 0, 255, 0], 4);
  palette.set([0, 255, 0, 0], 8);
  palette.set([255, 0, 0, 0], 12);

  const firstOffset = header.length;
  const first = wilFrame(2, 2, -3, 4, Buffer.from([
    3, 0,
    1, 2,
  ]));
  const thirdOffset = firstOffset + first.length;
  const third = wilFrame(1, 1, 7, -8, Buffer.from([2]));
  fs.writeFileSync(wilPath, Buffer.concat([header, first, third]));
  fs.writeFileSync(wixPath, buildIndex(3, [firstOffset, 0, thirdOffset]));
}

function buildRgb565Wil(wilPath, wixPath) {
  const header = Buffer.alloc(56);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(65536, 48);
  const raw = Buffer.alloc(4);
  raw.writeUInt16LE(0xf800, 0);
  raw.writeUInt16LE(0x07e0, 2);
  fs.writeFileSync(wilPath, Buffer.concat([
    header,
    wilFrame(2, 1, 0, 0, raw),
  ]));
  fs.writeFileSync(wixPath, buildIndex(1, [56]));
}

function wzlFrame(packedType, width, height, x, y, payload, storedSize = payload.length) {
  const header = Buffer.alloc(16);
  header.writeUInt16LE(packedType, 0);
  header.writeUInt16LE(width, 4);
  header.writeUInt16LE(height, 6);
  header.writeInt16LE(x, 8);
  header.writeInt16LE(y, 10);
  header.writeUInt32LE(storedSize, 12);
  return Buffer.concat([header, payload]);
}

function buildWzl(wzlPath, wzxPath) {
  const header = Buffer.alloc(64);

  const rgb565 = Buffer.alloc(8);
  rgb565.writeUInt16LE(0x001f, 0);
  rgb565.writeUInt16LE(0x0000, 2);
  rgb565.writeUInt16LE(0xf800, 4);
  rgb565.writeUInt16LE(0x07e0, 6);
  const first = wzlFrame(0x0105, 2, 2, -5, 6, zlib.deflateSync(rgb565));

  const alpha565 = Buffer.alloc(5);
  alpha565.writeUInt16LE(0xf800, 0);
  alpha565.writeUInt16LE(0x07e0, 2);
  alpha565[4] = 0xf8;
  const third = wzlFrame(0x0905, 2, 1, 1, 2, zlib.deflateSync(alpha565));

  const embeddedPng = encodePng(
    1,
    1,
    new Uint8ClampedArray([11, 22, 33, 44])
  );
  const fourth = wzlFrame(0x0008, 1, 1, 0, 0, embeddedPng);

  const indexed = wzlFrame(
    0x0103,
    2,
    1,
    0,
    0,
    zlib.deflateSync(Buffer.from([1, 0, 0, 0]))
  );

  const bgr24 = wzlFrame(
    0x0006,
    2,
    1,
    3,
    -4,
    Buffer.from([0, 0, 255, 0, 0, 0]),
    0
  );

  const frames = [first, third, fourth, indexed, bgr24];
  const offsets = [];
  let offset = header.length;
  offsets.push(offset);
  offset += first.length;
  offsets.push(0);
  offsets.push(offset);
  offset += third.length;
  offsets.push(offset);
  offset += fourth.length;
  offsets.push(offset);
  offset += indexed.length;
  offsets.push(offset);

  fs.writeFileSync(wzlPath, Buffer.concat([header, ...frames]));
  fs.writeFileSync(wzxPath, buildIndex(6, offsets));
  return embeddedPng;
}

function decodeSimpleRgbaPng(png) {
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10]
  );
  let width = 0;
  let height = 0;
  const idat = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const payload = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      assert.equal(payload[8], 8);
      assert.equal(payload[9], 6);
    } else if (type === 'IDAT') {
      idat.push(payload);
    }
    offset += length + 12;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const source = y * (rowBytes + 1);
    assert.equal(raw[source], 0, 'fixture decoder expects PNG filter 0');
    raw.copy(rgba, y * rowBytes, source + 1, source + 1 + rowBytes);
  }
  return { width, height, rgba };
}

async function readImage(indexRoot, result, imageIndex) {
  return readArchiveImagePng({
    extensionPath,
    indexRoot,
    archiveId: result.archiveId,
    imageIndex,
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-wil-wzl-'));
  const workerPool = new ArchiveImageWorkerPool(1);
  try {
    assert.deepEqual(uiEditorArchiveExtensions('GOM'), ['pak', 'wil', 'wzl']);
    assert.deepEqual(uiEditorArchiveExtensions('GEE'), ['pak', 'wil', 'wzl']);
    assert.deepEqual(uiEditorArchiveExtensions('996PC'), ['jpk', 'wil', 'wzl']);
    assert.equal(uiEditorArchiveLabel('996PC'), 'JPK/WIL/WZL');

    const indexRoot = path.join(root, 'indices');
    const paletteWil = path.join(root, 'Palette.WIL');
    const paletteWix = path.join(root, 'Palette.WiX');
    buildPaletteWil(paletteWil, paletteWix);
    const wil = await openArchiveIndexed({
      extensionPath,
      indexRoot,
      pakPath: paletteWil,
      password: '',
      willIdx: 12,
    });
    assert.equal(wil.format, 'WIL');
    assert.equal(wil.slotCount, 3);
    assert.deepEqual(wil.assets.map(asset => asset.isBlank), [false, true, false]);
    assert.deepEqual(
      wil.assets.map(asset => [asset.name, asset.source]),
      [['000000', 'wil'], ['000001', 'wil'], ['000002', 'wil']]
    );
    assert.deepEqual(
      [wil.assets[0].offsetX, wil.assets[0].offsetY],
      [-3, 4]
    );
    const wilPixels = decodeSimpleRgbaPng(await readImage(indexRoot, wil, 0));
    assert.deepEqual([wilPixels.width, wilPixels.height], [2, 2]);
    assert.deepEqual([...wilPixels.rgba], [
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      0, 0, 0, 0,
    ]);
    const blankPixels = decodeSimpleRgbaPng(await readImage(indexRoot, wil, 1));
    assert.deepEqual([...blankPixels.rgba], [0, 0, 0, 0]);

    fs.appendFileSync(paletteWix, Buffer.from([0]));
    await assert.rejects(
      () => readImage(indexRoot, wil, 0),
      /已发生变化/
    );
    const reindexedWil = await openArchiveIndexed({
      extensionPath,
      indexRoot,
      pakPath: paletteWil,
      password: '',
      willIdx: 12,
    });
    assert.notEqual(reindexedWil.archiveId, wil.archiveId);

    const rgbWilPath = path.join(root, 'Rgb565.wil');
    const rgbWixPath = path.join(root, 'Rgb565.wix');
    buildRgb565Wil(rgbWilPath, rgbWixPath);
    const rgbWil = await openArchiveIndexed({
      extensionPath,
      indexRoot,
      pakPath: rgbWilPath,
      password: '',
      willIdx: 13,
    });
    assert.deepEqual(
      [...decodeSimpleRgbaPng(await readImage(indexRoot, rgbWil, 0)).rgba],
      [255, 0, 0, 255, 0, 255, 0, 255]
    );

    const wzlPath = path.join(root, 'Effects.WzL');
    const wzxPath = path.join(root, 'Effects.WZX');
    const embeddedPng = buildWzl(wzlPath, wzxPath);
    const wzl = await openArchiveIndexed({
      extensionPath,
      indexRoot,
      pakPath: wzlPath,
      password: '',
      willIdx: 14,
    });
    assert.equal(wzl.format, 'WZL');
    assert.equal(wzl.slotCount, 6);
    assert.deepEqual(
      wzl.assets.map(asset => asset.isBlank),
      [false, true, false, false, false, false]
    );
    assert.ok(wzl.assets.every(asset => asset.source === 'wzl'));
    assert.deepEqual(
      [...decodeSimpleRgbaPng(await readImage(indexRoot, wzl, 0)).rgba],
      [
        255, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 255, 255,
        0, 0, 0, 0,
      ]
    );
    const alphaPng = await readImage(indexRoot, wzl, 2);
    assert.deepEqual(
      [...decodeSimpleRgbaPng(alphaPng).rgba],
      [255, 0, 0, 255, 0, 255, 0, 136]
    );
    assert.deepEqual(
      Buffer.from(await workerPool.read({
        extensionPath,
        indexRoot,
        archiveId: wzl.archiveId,
        imageIndex: 2,
      })),
      alphaPng,
      'WZL Worker output must match the main-thread decoder byte for byte'
    );
    assert.deepEqual(await readImage(indexRoot, wzl, 3), embeddedPng);

    const parser = loadParser(extensionPath);
    const palette = parser.A8_PALETTE_BGRA;
    const indexedPixels = decodeSimpleRgbaPng(await readImage(indexRoot, wzl, 4));
    assert.deepEqual([...indexedPixels.rgba.subarray(0, 4)], [
      palette[6],
      palette[5],
      palette[4],
      (palette[4] | palette[5] | palette[6]) === 0 ? 0 : (palette[7] || 255),
    ]);
    assert.deepEqual([...indexedPixels.rgba.subarray(4)], [0, 0, 0, 0]);
    assert.deepEqual(
      [...decodeSimpleRgbaPng(await readImage(indexRoot, wzl, 5)).rgba],
      [255, 0, 0, 255, 0, 0, 0, 0]
    );

    const orphanPath = path.join(root, 'Orphan.wil');
    fs.copyFileSync(paletteWil, orphanPath);
    await assert.rejects(
      () => openArchiveIndexed({
        extensionPath,
        indexRoot,
        pakPath: orphanPath,
        password: '',
        willIdx: 15,
      }),
      /缺少配套索引文件 Orphan\.wix/
    );
  } finally {
    workerPool.dispose();
    const resolvedRoot = path.resolve(root);
    if (resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolvedRoot, { recursive: true, force: true });
    }
  }
  console.log('wil-wzl-reader.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
