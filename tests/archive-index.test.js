const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  deriveJpkRc4State,
  rc4Crypt,
} = require('../out/utils/jpk-reader');
const { decodePakFully } = require('../out/utils/pak-reader');
const {
  ARCHIVE_INDEX_FILE,
  ARCHIVE_SUMMARY_FILE,
  loadArchiveAssetTable,
  openArchiveIndexed,
  readArchiveImagePng,
} = require('../out/utils/archive-index');
const {
  findCachedPatchImage,
  findCachedPatchPakByPath,
  invalidatePatchCacheIndex,
  isPatchCacheCurrent,
  listCachedPatchPaks,
  loadCachedPatchAssetTable,
  loadCachedPatchPakResult,
  validatePatchCacheMd5,
} = require('../out/utils/patch-cache');
const { ArchiveImageWorkerPool } = require('../out/utils/archive-image-worker-pool');

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

function buildFixture(filePath, password) {
  const state = deriveJpkRc4State(password);
  const indexedRaw = Buffer.from([
    1, 2, 3, 0,
    4, 5, 6, 0,
    7, 8, 9, 0,
  ]);
  const rgbaRaw = Buffer.alloc(48);
  for (let pixel = 0; pixel < 9; pixel++) {
    const source = pixel * 4;
    rgbaRaw[source] = 10 + pixel;
    rgbaRaw[source + 1] = 20 + pixel;
    rgbaRaw[source + 2] = 30 + pixel;
    rgbaRaw[source + 3] = 0;
    rgbaRaw[36 + Math.floor(pixel / 3) * 4 + pixel % 3] = 100 + pixel;
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

  const firstOffset = 80;
  const thirdOffset = firstOffset + first.record.length + first.payload.length;
  const indexOffset = thirdOffset + third.record.length + third.payload.length;
  const header = Buffer.alloc(80);
  header[0] = 7;
  header.write('GameLib', 1, 'ascii');
  header.writeUInt32LE(80, 0x2c);
  header.writeUInt32LE(4, 0x30);
  header.writeUInt32LE(indexOffset, 0x34);
  header.writeDoubleLE(1234.5, 0x38);
  const index = Buffer.alloc(16);
  index.writeUInt32LE(firstOffset, 0);
  index.writeUInt32LE(0, 4);
  index.writeUInt32LE(thirdOffset, 8);
  index.writeUInt32LE(0, 12);

  fs.writeFileSync(filePath, Buffer.concat([
    rc4Crypt(header, state),
    first.record,
    first.payload,
    third.record,
    third.payload,
    index,
  ]));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-archive-index-'));
  const workerPool = new ArchiveImageWorkerPool(1);
  try {
    const password = '测试Pass';
    const archivePath = path.join(root, 'Synthetic.jpk');
    const indexRoot = path.join(root, 'archive-index-v1');
    const patchCacheRoot = path.join(root, 'patch-cache');
    const legacyRoot = patchCacheRoot;
    buildFixture(archivePath, password);

    const direct = await openArchiveIndexed({
      extensionPath: path.resolve('.'),
      indexRoot,
      pakPath: archivePath,
      password,
      willIdx: 7,
      ensureBridge: async () => {
        throw new Error('JPK must not start the PAK bridge');
      },
    });
    assert.equal(direct.storageMode, 'direct');
    assert.equal(direct.format, 'JPK');
    assert.equal(direct.slotCount, 4);
    assert.equal(direct.assets.length, 4);
    assert.deepEqual(direct.assets.map(asset => asset.name), [
      '000000',
      '000001',
      '000002',
      '000003',
    ]);
    assert.deepEqual(direct.assets.map(asset => asset.isBlank), [false, true, false, true]);
    assert.ok(direct.assets.every(asset => asset.path === ''));
    assert.ok(direct.assets.every(asset => asset.archiveId === direct.archiveId));

    const indexFiles = fs.readdirSync(direct.cacheDir).sort();
    assert.deepEqual(indexFiles, [ARCHIVE_INDEX_FILE, ARCHIVE_SUMMARY_FILE]);
    assert.equal(indexFiles.some(name => name.endsWith('.png')), false);

    const legacy = await decodePakFully({
      extensionPath: path.resolve('.'),
      cacheRoot: legacyRoot,
      pakPath: archivePath,
      password,
      willIdx: 7,
      ensureBridge: async () => {
        throw new Error('JPK must not start the PAK bridge');
      },
    });
    for (const imageIndex of [0, 1, 2, 3]) {
      const directPng = await readArchiveImagePng({
        extensionPath: path.resolve('.'),
        indexRoot,
        archiveId: direct.archiveId,
        imageIndex,
      });
      assert.deepEqual(
        directPng,
        fs.readFileSync(legacy.assets[imageIndex].path),
        `direct image ${imageIndex} must be byte-identical to the V4.2.4 PNG cache`
      );
    }
    const workerPng = await workerPool.read({
      extensionPath: path.resolve('.'),
      indexRoot,
      archiveId: direct.archiveId,
      imageIndex: 2,
    });
    assert.deepEqual(
      Buffer.from(workerPng),
      fs.readFileSync(legacy.assets[2].path),
      'background Worker decoding must remain byte-identical to V4.2.4'
    );

    const table = loadArchiveAssetTable(indexRoot, direct.archiveId);
    assert.equal(table.slotCount, 4);
    assert.deepEqual([...table.present], [1, 1, 1, 1]);
    assert.deepEqual([...table.blank], [0, 1, 0, 1]);
    assert.equal(table.offsetX[0], -2);
    assert.equal(table.offsetY[0], 4);

    const reopened = await openArchiveIndexed({
      extensionPath: path.resolve('.'),
      indexRoot,
      pakPath: archivePath,
      password,
      willIdx: 9,
    });
    assert.equal(reopened.fromCache, true);
    assert.equal(reopened.archiveId, direct.archiveId);
    assert.ok(reopened.assets.every(asset => asset.willIdx === 9));

    invalidatePatchCacheIndex();
    const cachedPaks = listCachedPatchPaks(patchCacheRoot, root);
    assert.equal(cachedPaks.length, 1);
    assert.equal(cachedPaks[0].storageMode, 'direct');
    assert.equal(cachedPaks[0].archiveId, direct.archiveId);
    assert.equal(isPatchCacheCurrent(cachedPaks[0]), true);
    assert.equal(
      findCachedPatchPakByPath(patchCacheRoot, archivePath, root, 'legacy')?.storageMode,
      'legacy',
      'the V4.2.4 switch must select the preserved PNG cache'
    );
    assert.equal(
      findCachedPatchPakByPath(patchCacheRoot, archivePath, root, 'direct')?.storageMode,
      'direct',
      'the V4.2.5 switch must select the indexed cache'
    );
    const cachedImage = findCachedPatchImage(
      patchCacheRoot,
      'synthetic.jpk',
      2,
      root,
      ['jpk']
    );
    assert.ok(cachedImage);
    assert.equal(cachedImage.imagePath, '');
    assert.equal(cachedImage.archiveId, direct.archiveId);
    assert.equal(cachedImage.imageIndex, 2);
    const cachedResult = loadCachedPatchPakResult(cachedPaks[0], 11);
    assert.equal(cachedResult.storageMode, 'direct');
    assert.ok(cachedResult.assets.every(asset => asset.willIdx === 11));
    assert.deepEqual(
      [...loadCachedPatchAssetTable(cachedPaks[0]).blank],
      [0, 1, 0, 1]
    );
    const validation = await validatePatchCacheMd5(cachedPaks[0]);
    assert.equal(validation.current, true);
    assert.match(cachedPaks[0].sourceMd5 || '', /^[a-f0-9]{32}$/);
  } finally {
    workerPool.dispose();
    const resolvedRoot = path.resolve(root);
    if (resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolvedRoot, { recursive: true, force: true });
    }
  }
  console.log('archive-index.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
