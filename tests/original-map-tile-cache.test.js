const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function testPng(width, height, marker = 0) {
  const data = Buffer.alloc(45);
  PNG_SIGNATURE.copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  data[24] = 8;
  data[25] = 6;
  data[26] = 0;
  data[27] = 0;
  data[28] = 0;
  data[29] = marker & 0xff;
  data.writeUInt32BE(0, 33);
  data.write('IEND', 37, 'ascii');
  data.writeUInt32BE(0, 41);
  return data;
}

function identity(overrides = {}) {
  return {
    mapSha256: 'a'.repeat(64),
    engine: 'GOM',
    profile: 'classic-14',
    mapWidth: 18,
    mapHeight: 17,
    archives: [
      { archiveName: 'SmTiles2', archiveId: '2'.repeat(64), status: 'direct' },
      { archiveName: 'Tiles', archiveId: '1'.repeat(64), status: 'direct' },
    ],
    decoderRevision: 'archive-direct-v1',
    rendererRevision: 'static-renderer-v1',
    placementRevision: 'top-left-48x32-v1',
    blendRevision: 'source-over-v1',
    chunkRevision: 'cells-16x16-v1',
    ...overrides,
  };
}

function setAccessTime(cacheRoot, key, timeMs) {
  const generation = path.join(cacheRoot, key);
  fs.mkdirSync(generation, { recursive: true });
  const access = path.join(generation, '.access');
  fs.writeFileSync(access, '');
  const time = new Date(timeMs);
  fs.utimesSync(access, time, time);
}

function main() {
  const {
    getCacheRoots,
    initializeCacheStorage,
  } = require('../out/utils/cache-storage');
  const {
    DEFAULT_ORIGINAL_MAP_TILE_CACHE_MAX_BYTES,
    DEFAULT_ORIGINAL_MAP_TILE_CACHE_MAX_GENERATIONS,
    ORIGINAL_MAP_TILE_CACHE_DIRECTORY,
    ORIGINAL_MAP_TILE_CHUNK_CELL_HEIGHT,
    ORIGINAL_MAP_TILE_CHUNK_CELL_WIDTH,
    ORIGINAL_MAP_TILE_MAX_PNG_BYTES,
    createOriginalMapTileCacheKey,
    createOriginalMapTileIdentity,
    ensureOriginalMapTileManifest,
    expectedOriginalMapTileSize,
    originalMapTileDescriptor,
    originalMapTilePath,
    parseOriginalMapTileChunkId,
    pruneOriginalMapTileCache,
    publishOriginalMapTile,
    readOriginalMapTile,
    readOriginalMapTileManifest,
    validateOriginalMapTilePng,
    writeOriginalMapTileAtomic,
  } = require('../out/utils/original-map-tile-cache');

  assert.equal(ORIGINAL_MAP_TILE_CACHE_DIRECTORY, 'original-map-tiles-v1');
  assert.equal(DEFAULT_ORIGINAL_MAP_TILE_CACHE_MAX_BYTES, 1024 * 1024 * 1024);
  assert.equal(DEFAULT_ORIGINAL_MAP_TILE_CACHE_MAX_GENERATIONS, 64);
  assert.equal(ORIGINAL_MAP_TILE_MAX_PNG_BYTES, 16 * 1024 * 1024);
  assert.equal(ORIGINAL_MAP_TILE_CHUNK_CELL_WIDTH, 16);
  assert.equal(ORIGINAL_MAP_TILE_CHUNK_CELL_HEIGHT, 16);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-original-map-tile-cache-'));
  try {
    const globalStorage = path.join(root, 'Roaming', 'Code', 'User', 'globalStorage', 'boo');
    const local = path.join(root, 'Local');
    const context = { globalStorageUri: { fsPath: globalStorage } };
    const env = { LOCALAPPDATA: local, APPDATA: path.join(root, 'Roaming') };
    const roots = getCacheRoots(context, env);
    assert.equal(
      roots.originalMapTiles,
      path.join(roots.base, ORIGINAL_MAP_TILE_CACHE_DIRECTORY)
    );
    const initialized = initializeCacheStorage(context, env);
    assert.equal(initialized.warnings.length, 0);
    assert.equal(fs.existsSync(roots.originalMapTiles), true);

    const cacheRoot = roots.originalMapTiles;
    const firstIdentity = createOriginalMapTileIdentity(identity());
    const firstKey = firstIdentity.cacheKey;
    assert.equal(createOriginalMapTileCacheKey(identity()), firstKey);
    assert.match(firstKey, /^[a-f0-9]{64}$/);
    assert.equal(firstIdentity.lod, 0);
    assert.deepEqual(firstIdentity.chunkCells, [16, 16]);
    assert.deepEqual(firstIdentity.chunkPixels, [768, 512]);
    assert.deepEqual(
      firstIdentity.archives.map(archive => archive.archiveName),
      ['smtiles2', 'tiles']
    );
    assert.equal(
      createOriginalMapTileCacheKey(identity({ archives: [...identity().archives].reverse() })),
      firstKey,
      'archive binding input order must not affect the canonical key'
    );
    assert.equal(
      createOriginalMapTileCacheKey(identity({ engine: 'gom' })),
      firstKey,
      'engine/profile identifiers must be normalized'
    );

    const mutations = [
      { mapSha256: 'b'.repeat(64) },
      { engine: 'GEE' },
      { profile: 'classic-12' },
      { mapWidth: 19 },
      { mapHeight: 18 },
      { archives: [
        { archiveName: 'SmTiles2', archiveId: '3'.repeat(64), status: 'direct' },
        { archiveName: 'Tiles', archiveId: '1'.repeat(64), status: 'direct' },
      ] },
      { archives: [
        { archiveName: 'SmTiles2', archiveId: '2'.repeat(64), status: 'stale' },
        { archiveName: 'Tiles', archiveId: '1'.repeat(64), status: 'direct' },
      ] },
      { decoderRevision: 'archive-direct-v2' },
      { rendererRevision: 'static-renderer-v2' },
      { placementRevision: 'top-left-48x32-v2' },
      { blendRevision: 'source-over-v2' },
      { chunkRevision: 'cells-16x16-v2' },
    ];
    for (const mutation of mutations) {
      assert.notEqual(createOriginalMapTileCacheKey(identity(mutation)), firstKey);
    }
    assert.throws(
      () => createOriginalMapTileCacheKey(identity({ archives: [
        { archiveName: 'Tiles', archiveId: '1'.repeat(64), status: 'direct' },
        { archiveName: 'tiles', archiveId: '2'.repeat(64), status: 'direct' },
      ] })),
      /重复/
    );
    assert.throws(
      () => createOriginalMapTileCacheKey(identity({ mapSha256: 'not-a-hash' })),
      /SHA-256/
    );
    assert.throws(
      () => createOriginalMapTileCacheKey(identity({ archives: [
        { archiveName: 'Objects', archiveId: '1'.repeat(64), status: 'direct' },
      ] })),
      /Tiles\/SmTiles/
    );

    assert.deepEqual(parseOriginalMapTileChunkId('c0-r0'), { column: 0, row: 0 });
    assert.deepEqual(parseOriginalMapTileChunkId('c12-r34'), { column: 12, row: 34 });
    for (const invalid of ['c01-r0', 'c0-r01', 'c-1-r0', 'C0-r0', '../c0-r0', 'c0-r0.png']) {
      assert.throws(() => parseOriginalMapTileChunkId(invalid), /chunkId/);
    }
    assert.deepEqual(expectedOriginalMapTileSize(18, 17, 'c0-r0'), {
      width: 768,
      height: 512,
    });
    assert.deepEqual(expectedOriginalMapTileSize(18, 17, 'c1-r1'), {
      width: 96,
      height: 32,
    });
    assert.deepEqual(originalMapTileDescriptor(18, 17, 1, 1), {
      lod: 0,
      column: 1,
      row: 1,
      chunkId: 'c1-r1',
      worldX: 768,
      worldY: 512,
      width: 96,
      height: 32,
    });
    assert.throws(() => expectedOriginalMapTileSize(18, 17, 'c2-r0'), /范围/);

    const manifestCreated = ensureOriginalMapTileManifest(cacheRoot, firstIdentity);
    assert.equal(manifestCreated.status, 'published');
    assert.equal(manifestCreated.replacedCorrupt, false);
    assert.equal(
      manifestCreated.filePath,
      path.join(cacheRoot, firstKey, 'manifest.json')
    );
    assert.deepEqual(readOriginalMapTileManifest(cacheRoot, firstKey), manifestCreated.manifest);
    const manifestHit = ensureOriginalMapTileManifest(cacheRoot, identity());
    assert.equal(manifestHit.status, 'already-exists');
    fs.writeFileSync(manifestCreated.filePath, '{corrupt');
    const manifestReplaced = ensureOriginalMapTileManifest(cacheRoot, firstIdentity);
    assert.equal(manifestReplaced.status, 'published');
    assert.equal(manifestReplaced.replacedCorrupt, true);
    assert.deepEqual(readOriginalMapTileManifest(cacheRoot, firstKey), manifestCreated.manifest);

    const fullPng = testPng(768, 512, 1);
    const secondFullPng = testPng(768, 512, 2);
    const edgePng = testPng(96, 32, 3);
    assert.deepEqual(validateOriginalMapTilePng(fullPng, 768, 512), {
      valid: true,
    });
    assert.equal(validateOriginalMapTilePng(fullPng, 96, 32).valid, false);
    assert.equal(validateOriginalMapTilePng(Buffer.from('not-png'), 768, 512).valid, false);
    assert.equal(
      validateOriginalMapTilePng(Buffer.alloc(ORIGINAL_MAP_TILE_MAX_PNG_BYTES + 1), 768, 512).valid,
      false
    );

    const published = publishOriginalMapTile({
      cacheRoot,
      cacheKey: firstKey,
      chunkId: 'c0-r0',
      mapWidth: 18,
      mapHeight: 17,
      png: fullPng,
    });
    assert.equal(published.status, 'published');
    assert.equal(
      published.filePath,
      path.join(cacheRoot, firstKey, 'c0-r0.png')
    );
    assert.deepEqual(readOriginalMapTile({
      cacheRoot,
      cacheKey: firstKey,
      chunkId: 'c0-r0',
      mapWidth: 18,
      mapHeight: 17,
    }), fullPng);
    assert.deepEqual(
      readOriginalMapTile(cacheRoot, firstKey, 'c0-r0', 768, 512),
      fullPng
    );
    const directWriteHit = writeOriginalMapTileAtomic(
      cacheRoot,
      firstKey,
      'c0-r0',
      768,
      512,
      secondFullPng
    );
    assert.equal(directWriteHit.status, 'already-exists');
    assert.equal(directWriteHit.replacedCorrupt, false);

    const hit = publishOriginalMapTile({
      cacheRoot,
      cacheKey: firstKey,
      chunkId: 'c0-r0',
      mapWidth: 18,
      mapHeight: 17,
      png: secondFullPng,
    });
    assert.equal(hit.status, 'hit');
    assert.deepEqual(fs.readFileSync(published.filePath), fullPng,
      'a valid immutable target must never be overwritten');

    const edge = publishOriginalMapTile({
      cacheRoot,
      cacheKey: firstKey,
      chunkId: 'c1-r1',
      mapWidth: 18,
      mapHeight: 17,
      png: edgePng,
    });
    assert.equal(edge.status, 'published');
    assert.deepEqual(readOriginalMapTile({
      cacheRoot,
      cacheKey: firstKey,
      chunkId: 'c1-r1',
      mapWidth: 18,
      mapHeight: 17,
    }), edgePng);
    assert.throws(() => publishOriginalMapTile({
      cacheRoot,
      cacheKey: firstKey,
      chunkId: 'c1-r1',
      mapWidth: 18,
      mapHeight: 17,
      png: fullPng,
    }), /PNG/);

    fs.writeFileSync(published.filePath, 'corrupt');
    assert.equal(readOriginalMapTile({
      cacheRoot,
      cacheKey: firstKey,
      chunkId: 'c0-r0',
      mapWidth: 18,
      mapHeight: 17,
    }), undefined, 'a corrupt target must never be returned as a cache hit');
    const republished = publishOriginalMapTile({
      cacheRoot,
      cacheKey: firstKey,
      chunkId: 'c0-r0',
      mapWidth: 18,
      mapHeight: 17,
      png: secondFullPng,
    });
    assert.equal(republished.status, 'published',
      'a corrupt target cleaned by read must be published again as a cache miss');
    fs.writeFileSync(published.filePath, 'corrupt-again');
    const replaced = publishOriginalMapTile({
      cacheRoot,
      cacheKey: firstKey,
      chunkId: 'c0-r0',
      mapWidth: 18,
      mapHeight: 17,
      png: secondFullPng,
    });
    assert.equal(replaced.status, 'replaced');
    assert.deepEqual(fs.readFileSync(published.filePath), secondFullPng);
    assert.equal(
      fs.readdirSync(path.dirname(published.filePath)).some(name => name.includes('.tmp-') || name.includes('.corrupt-')),
      false,
      'successful publication must not leave temporary or quarantine files'
    );

    assert.throws(() => originalMapTilePath(cacheRoot, 'f'.repeat(63), 'c0-r0'), /cacheKey/);
    assert.throws(() => originalMapTilePath(cacheRoot, 'F'.repeat(64), 'c0-r0'), /cacheKey/);
    assert.throws(() => originalMapTilePath(cacheRoot, firstKey, '../c0-r0'), /chunkId/);

    const keyA = 'a'.repeat(64);
    const keyB = 'b'.repeat(64);
    const keyC = 'c'.repeat(64);
    const now = Date.now();
    setAccessTime(cacheRoot, keyA, now - 3000);
    setAccessTime(cacheRoot, keyB, now - 2000);
    setAccessTime(cacheRoot, keyC, now - 1000);
    fs.writeFileSync(path.join(cacheRoot, keyA, 'payload.bin'), Buffer.alloc(64));
    fs.writeFileSync(path.join(cacheRoot, keyB, 'payload.bin'), Buffer.alloc(64));
    fs.writeFileSync(path.join(cacheRoot, keyC, 'payload.bin'), Buffer.alloc(64));
    fs.mkdirSync(path.join(cacheRoot, 'do-not-touch'));
    const pruned = pruneOriginalMapTileCache(cacheRoot, {
      maxBytes: 1024 * 1024,
      maxGenerations: 3,
      protectedKeys: new Set([keyA]),
    });
    assert.deepEqual(pruned.removedKeys, [keyB]);
    assert.equal(fs.existsSync(path.join(cacheRoot, keyA)), true);
    assert.equal(fs.existsSync(path.join(cacheRoot, keyB)), false);
    assert.equal(fs.existsSync(path.join(cacheRoot, keyC)), true);
    assert.equal(fs.existsSync(path.join(cacheRoot, 'do-not-touch')), true);

    const protectedOnly = pruneOriginalMapTileCache(cacheRoot, {
      maxBytes: 0,
      maxGenerations: 0,
      protectedKeys: new Set([firstKey, keyA, keyC]),
    });
    assert.deepEqual(protectedOnly.removedKeys, []);

    const keyD = 'd'.repeat(64);
    setAccessTime(cacheRoot, keyD, now - 4000);
    fs.writeFileSync(path.join(cacheRoot, keyD, 'payload.bin'), Buffer.alloc(256));
    const bytePruned = pruneOriginalMapTileCache(cacheRoot, {
      maxBytes: protectedOnly.remainingBytes,
      maxGenerations: 64,
      protectedKeys: new Set([firstKey, keyA, keyC]),
    });
    assert.deepEqual(bytePruned.removedKeys, [keyD]);
    assert.equal(fs.existsSync(path.join(cacheRoot, keyD)), false);

    const wrongRoot = path.join(root, 'not-original-map-tiles-v1');
    fs.mkdirSync(path.join(wrongRoot, keyB), { recursive: true });
    fs.writeFileSync(path.join(wrongRoot, keyB, 'keep.txt'), 'keep');
    assert.throws(
      () => pruneOriginalMapTileCache(wrongRoot, { maxBytes: 0, maxGenerations: 0 }),
      /精确缓存根/
    );
    assert.equal(fs.existsSync(path.join(wrongRoot, keyB, 'keep.txt')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('original-map-tile-cache.test.js: PASS');
}

main();
