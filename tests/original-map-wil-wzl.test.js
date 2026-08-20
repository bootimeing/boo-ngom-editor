const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { openArchiveIndexed, readArchiveImagePng } = require('../out/utils/archive-index');
const { scanClientArchiveFiles } = require('../out/utils/client-resources');
const { collectOriginalMapViewport, parseOriginalMap } = require('../out/utils/original-map');
const {
  invalidatePatchCacheIndex,
  loadCachedPatchAssetTable,
  resolveCachedPatchArchiveByName,
} = require('../out/utils/patch-cache');

const extensionPath = path.resolve('.');

function buildPairIndex(count, offsets) {
  const result = Buffer.alloc(48 + count * 4);
  result.writeUInt32LE(count, 44);
  offsets.forEach((offset, index) => result.writeUInt32LE(offset, 48 + index * 4));
  return result;
}

function buildWil(wilPath, wixPath) {
  const header = Buffer.alloc(56 + 1024);
  header.writeUInt32LE(1, 44);
  header.writeUInt32LE(256, 48);
  header.writeUInt32LE(1024, 52);
  header.set([0, 0, 255, 0], 56 + 4);
  const frame = Buffer.alloc(9);
  frame.writeUInt16LE(1, 0);
  frame.writeUInt16LE(1, 2);
  frame.writeInt16LE(-7, 4);
  frame.writeInt16LE(9, 6);
  frame[8] = 1;
  fs.writeFileSync(wilPath, Buffer.concat([header, frame]));
  fs.writeFileSync(wixPath, buildPairIndex(1, [header.length]));
}

function buildWzl(wzlPath, wzxPath) {
  const header = Buffer.alloc(64);
  const raw = Buffer.alloc(2);
  raw.writeUInt16LE(0xf800, 0);
  const payload = zlib.deflateSync(raw);
  const frame = Buffer.alloc(16);
  frame.writeUInt16LE(0x0105, 0);
  frame.writeUInt16LE(1, 4);
  frame.writeUInt16LE(1, 6);
  frame.writeInt16LE(3, 8);
  frame.writeInt16LE(-4, 10);
  frame.writeUInt32LE(payload.length, 12);
  fs.writeFileSync(wzlPath, Buffer.concat([header, frame, payload]));
  fs.writeFileSync(wzxPath, buildPairIndex(1, [header.length]));
}

function buildMap() {
  const width = 2;
  const height = 2;
  const cellSize = 14;
  const data = Buffer.alloc(52 + width * height * cellSize);
  data.writeUInt16LE(width, 0);
  data.writeUInt16LE(height, 2);
  const offset = 52;
  data.writeUInt16LE(1, offset);
  data.writeUInt16LE(1, offset + 4);
  data[offset + 10] = 1;
  return data;
}

function assertPng(data) {
  assert.deepEqual([...data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-original-map-wil-wzl-'));
  try {
    const dataRoot = path.join(root, 'Client', 'Data');
    const cacheBase = path.join(root, 'cache');
    const patchCacheRoot = path.join(cacheBase, 'patch-cache');
    const indexRoot = path.join(cacheBase, 'archive-index-v1');
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.mkdirSync(patchCacheRoot, { recursive: true });

    const tilesWzl = path.join(dataRoot, 'Tiles.wzl');
    buildWzl(tilesWzl, path.join(dataRoot, 'Tiles.wzx'));
    const objectsWil = path.join(dataRoot, 'Objects2.wil');
    buildWil(objectsWil, path.join(dataRoot, 'Objects2.wix'));

    await openArchiveIndexed({
      extensionPath,
      indexRoot,
      pakPath: tilesWzl,
      password: '',
      willIdx: 0,
    });
    await openArchiveIndexed({
      extensionPath,
      indexRoot,
      pakPath: objectsWil,
      password: '',
      willIdx: 1,
    });
    invalidatePatchCacheIndex();

    const archiveFiles = await scanClientArchiveFiles(
      [dataRoot],
      ['pak', 'wil', 'wzl']
    );
    const model = await parseOriginalMap(buildMap());
    const references = collectOriginalMapViewport(model, {
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
    });
    assert.deepEqual(
      references.map(reference => [reference.archiveName, reference.imageIndex]),
      [['Tiles', 0], ['Objects2', 0]]
    );

    const tiles = resolveCachedPatchArchiveByName(
      patchCacheRoot,
      'Tiles',
      archiveFiles,
      [dataRoot],
      ['pak', 'wil', 'wzl']
    );
    const objects = resolveCachedPatchArchiveByName(
      patchCacheRoot,
      'Objects2',
      archiveFiles,
      [dataRoot],
      ['pak', 'wil', 'wzl']
    );
    assert.equal(tiles.status, 'ready');
    assert.equal(tiles.pak.format, 'WZL');
    assert.equal(objects.status, 'ready');
    assert.equal(objects.pak.format, 'WIL');
    assert.deepEqual(
      [
        loadCachedPatchAssetTable(tiles.pak).offsetX[0],
        loadCachedPatchAssetTable(tiles.pak).offsetY[0],
      ],
      [3, -4]
    );
    assert.deepEqual(
      [
        loadCachedPatchAssetTable(objects.pak).offsetX[0],
        loadCachedPatchAssetTable(objects.pak).offsetY[0],
      ],
      [-7, 9]
    );
    assertPng(await readArchiveImagePng({
      extensionPath,
      indexRoot,
      archiveId: tiles.pak.archiveId,
      imageIndex: 0,
    }));
    assertPng(await readArchiveImagePng({
      extensionPath,
      indexRoot,
      archiveId: objects.pak.archiveId,
      imageIndex: 0,
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('original-map-wil-wzl.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
