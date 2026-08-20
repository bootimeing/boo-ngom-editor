const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const { GOM_DECODER_REVISION } = require('../out/utils/pak-reader');
  const { ARCHIVE_INDEX_DECODER_REVISION, ARCHIVE_INDEX_FILE } = require('../out/utils/archive-index');
  const {
    findCachedPatchImage,
    findCachedPatchPakByPath,
    findUniqueCurrentCachedPatchPakByName,
    findNearbyPakPasswordFile,
    filterRequiredPatchPakFiles,
    findMissingEffectImageArchives,
    invalidatePatchCacheIndex,
    isPatchCacheCurrent,
    listCachedPatchPaks,
    loadCachedPatchPakResult,
    resolveCachedPatchArchiveByName,
    scanPatchPakFiles,
    validatePatchCacheMd5,
  } = require('../out/utils/patch-cache');
  const {
    findWorkspacePatchPasswordFile,
  } = require('../out/utils/patch-discovery');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-patch-cache-'));
  try {
    const clientRoot = path.join(root, 'client');
    const dataDirectory = path.join(clientRoot, 'data');
    const nestedDirectory = path.join(dataDirectory, 'ui');
    const cacheRoot = path.join(root, 'cache');
    const pakPath = path.join(dataDirectory, 'Items1.pak');
    fs.mkdirSync(nestedDirectory, { recursive: true });
    fs.mkdirSync(cacheRoot, { recursive: true });
    fs.writeFileSync(path.join(clientRoot, 'Pak.txt'), `${pakPath}|password`);
    fs.writeFileSync(pakPath, 'pak');
    fs.writeFileSync(path.join(nestedDirectory, 'Dialog.pak'), 'pak');
    fs.writeFileSync(path.join(dataDirectory, 'Title.jpk'), 'jpk');

    const cacheDir = path.join(cacheRoot, 'fingerprint');
    fs.mkdirSync(cacheDir);
    const sourceMd5 = crypto.createHash('md5').update('pak').digest('hex');
    const imagePath = path.join(cacheDir, '000001.png');
    fs.writeFileSync(path.join(cacheDir, '000000.png'), 'png');
    fs.writeFileSync(imagePath, 'png');
    fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify({
      version: 3,
      fingerprint: 'fingerprint',
      format: 'GOM',
      decoderRevision: GOM_DECODER_REVISION,
      pakName: 'Items1',
      pakPath,
      sourceMd5,
      willIdx: 99,
      slotCount: 2,
      assets: [
        { name: '000000', path: path.join(cacheDir, '000000.png'), pakName: 'Items1', pakPath, willIdx: 99, localIdx: 0, imageIdx: 0, width: 1, height: 1, offsetX: 0, offsetY: 0, isBlank: false, source: 'pak' },
        { name: '000001', path: imagePath, pakName: 'Items1', pakPath, willIdx: 99, localIdx: 1, imageIdx: 1, width: 32, height: 32, offsetX: 0, offsetY: 0, isBlank: false, source: 'pak' },
      ],
    }));

    invalidatePatchCacheIndex();
    const cached = listCachedPatchPaks(cacheRoot, dataDirectory);
    assert.equal(cached.length, 1);
    assert.equal(cached[0].pakName, 'Items1');
    assert.equal(cached[0].slotCount, 2);
    assert.equal(cached[0].sourceMd5, sourceMd5);
    assert.equal(isPatchCacheCurrent(cached[0]), true);
    assert.deepEqual(
      await validatePatchCacheMd5(cached[0]),
      { current: true, reason: 'match', sourceMd5 }
    );
    assert.deepEqual(
      await validatePatchCacheMd5({ ...cached[0], decoderRevision: undefined }),
      { current: false, reason: 'decoder-outdated' },
      'GOM caches created before black color-key support must be rebuilt automatically'
    );
    assert.equal(findCachedPatchPakByPath(cacheRoot, pakPath, dataDirectory).cacheDir, cacheDir);
    assert.equal(findCachedPatchImage(cacheRoot, 'items1.pak', 1, dataDirectory).imagePath, imagePath);

    const pairedSourcePath = path.join(dataDirectory, 'Magic.wil');
    const pairedCompanionPath = path.join(dataDirectory, 'Magic.wix');
    const pairedCacheDir = path.join(cacheRoot, 'paired-index');
    fs.mkdirSync(pairedCacheDir);
    fs.writeFileSync(pairedSourcePath, 'wil');
    fs.writeFileSync(pairedCompanionPath, 'wix');
    fs.writeFileSync(path.join(pairedCacheDir, ARCHIVE_INDEX_FILE), 'index');
    const pairedManifestPath = path.join(pairedCacheDir, 'summary.json');
    fs.writeFileSync(pairedManifestPath, '{}');
    const pairedSourceStat = fs.statSync(pairedSourcePath);
    const pairedCompanionStat = fs.statSync(pairedCompanionPath);
    const pairedSourceMd5 = crypto.createHash('md5').update('wil').digest('hex');
    const pairedCache = {
      manifestPath: pairedManifestPath,
      cacheDir: pairedCacheDir,
      pakPath: pairedSourcePath,
      pakName: 'Magic',
      sourceMd5: pairedSourceMd5,
      decoderRevision: ARCHIVE_INDEX_DECODER_REVISION,
      format: 'WIL',
      storedWillIdx: 0,
      slotCount: 1,
      cachedAt: Date.now(),
      storageMode: 'direct',
      archiveId: 'paired-index',
      sourceSize: pairedSourceStat.size,
      sourceMtimeMs: pairedSourceStat.mtimeMs,
      companionPath: pairedCompanionPath,
      companionSize: pairedCompanionStat.size,
      companionMtimeMs: pairedCompanionStat.mtimeMs,
    };
    assert.equal((await validatePatchCacheMd5(pairedCache)).current, true);
    const changedSourceTime = new Date(pairedSourceStat.mtimeMs + 1000);
    fs.utimesSync(pairedSourcePath, changedSourceTime, changedSourceTime);
    assert.deepEqual(
      await validatePatchCacheMd5(pairedCache),
      { current: false, reason: 'metadata-changed', sourceMd5: pairedSourceMd5 },
      'a direct index with matching content but changed source metadata must be rebuilt'
    );
    fs.utimesSync(
      pairedSourcePath,
      new Date(pairedSourceStat.atimeMs),
      new Date(pairedSourceStat.mtimeMs)
    );
    const changedCompanionTime = new Date(pairedCompanionStat.mtimeMs + 5000);
    fs.utimesSync(pairedCompanionPath, changedCompanionTime, changedCompanionTime);
    assert.deepEqual(
      await validatePatchCacheMd5(pairedCache),
      { current: false, reason: 'changed', sourceMd5: pairedSourceMd5 },
      'a changed WIX/WZX companion must invalidate a WIL/WZL cache'
    );

    const loaded = loadCachedPatchPakResult(cached[0], 7);
    assert.equal(loaded.willIdx, 7);
    assert.ok(loaded.assets.every(asset => asset.willIdx === 7));
    assert.equal(findNearbyPakPasswordFile(dataDirectory), path.join(clientRoot, 'Pak.txt'));
    const jpkClientRoot = path.join(root, 'jpk-client');
    const jpkDataDirectory = path.join(jpkClientRoot, 'Data');
    fs.mkdirSync(jpkDataDirectory, { recursive: true });
    fs.writeFileSync(path.join(jpkClientRoot, 'JpkList.txt'), 'Data\\Items.jpk|password');
    assert.equal(
      findNearbyPakPasswordFile(jpkDataDirectory),
      path.join(jpkClientRoot, 'JpkList.txt')
    );

    const pc996Root = path.join(root, '996PC');
    const pc996EngineRoot = path.join(pc996Root, 'Mirserver');
    const pc996M2 = path.join(pc996EngineRoot, 'Mir200', 'M2Server.exe');
    const pc996PasswordFile = path.join(pc996EngineRoot, '登录器生成器', 'JpkList.txt');
    const pc996Data = path.join(pc996Root, '自定义补丁', 'Data');
    fs.mkdirSync(path.dirname(pc996M2), { recursive: true });
    fs.mkdirSync(path.dirname(pc996PasswordFile), { recursive: true });
    fs.mkdirSync(pc996Data, { recursive: true });
    fs.writeFileSync(pc996M2, '');
    fs.writeFileSync(pc996PasswordFile, 'F:\\old\\Items.Jpk|password');
    fs.writeFileSync(path.join(pc996Data, 'Items.Jpk'), 'jpk');
    assert.equal(
      findWorkspacePatchPasswordFile('996PC', pc996Data, [pc996Root]),
      pc996PasswordFile
    );
    assert.equal(
      findWorkspacePatchPasswordFile('996PC', pc996Root, [pc996EngineRoot]),
      pc996PasswordFile,
      'the selected client can still use the current workspace 996PC password list'
    );

    const scanned = await scanPatchPakFiles(dataDirectory);
    assert.deepEqual(
      scanned.map(file => path.relative(dataDirectory, file)),
      ['Items1.pak', 'Title.jpk', path.join('ui', 'Dialog.pak')]
    );
    const required = filterRequiredPatchPakFiles(scanned, ['Dialog.pak', 'Newopui.pak']);
    assert.deepEqual(
      required.map(file => path.relative(dataDirectory, file)),
      ['Items1.pak', path.join('ui', 'Dialog.pak')],
      'required mode must combine EffectImageList entries with the fixed items series'
    );
    assert.deepEqual(
      filterRequiredPatchPakFiles([
        path.join(dataDirectory, 'mmap10.pak'),
        path.join(dataDirectory, 'mmap11.pak'),
        path.join(dataDirectory, 'items9.pak'),
        path.join(dataDirectory, 'monster.pak'),
      ], []),
      [
        path.join(dataDirectory, 'mmap10.pak'),
        path.join(dataDirectory, 'items9.pak'),
      ],
      'fixed required PAKs must include only mmap10 and items through items9'
    );
    assert.deepEqual(
      findMissingEffectImageArchives(
        [path.join(dataDirectory, 'Dialog.pak'), path.join(dataDirectory, 'Items1.jpk')],
        ['Dialog.pak', 'MissingUI.jpk', 'missingui.pak', 'Items1.jpk']
      ),
      ['MissingUI.jpk', 'missingui.pak'],
      'same-basename calls with different extensions must be checked independently'
    );
    assert.deepEqual(
      filterRequiredPatchPakFiles([
        path.join(dataDirectory, 'Magic8.wil'),
        path.join(dataDirectory, 'Magic8.wzl'),
      ], ['Magic8.wzl']),
      [path.join(dataDirectory, 'Magic8.wzl')],
      'EffectImageList extension matching must not confuse WIL and WZL resources'
    );

    const preferredData = path.join(clientRoot, 'CustomPatch', 'Data');
    fs.mkdirSync(preferredData, { recursive: true });
    const sourceTime = new Date(Date.now() - 10000);
    const writeSource = (fileName, data = fileName) => {
      const filePath = path.join(preferredData, fileName);
      fs.writeFileSync(filePath, data);
      fs.utimesSync(filePath, sourceTime, sourceTime);
      return filePath;
    };
    const writeLegacyCache = (directoryName, sourcePath, format, modifiedAt) => {
      const directory = path.join(cacheRoot, directoryName);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, '000000.png'), 'png');
      const manifestPath = path.join(directory, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify({
        format,
        decoderRevision: format === 'GOM' ? GOM_DECODER_REVISION : undefined,
        pakName: path.basename(sourcePath, path.extname(sourcePath)),
        pakPath: sourcePath,
        willIdx: 0,
        slotCount: 1,
        assets: [],
      }));
      fs.utimesSync(manifestPath, modifiedAt, modifiedAt);
    };
    const objectsPak = writeSource('Objects.pak');
    const objectsWil = writeSource('Objects.wil');
    writeLegacyCache('objects-pak-cache', objectsPak, 'GOM', new Date(Date.now() - 5000));
    writeLegacyCache('objects-wil-cache', objectsWil, 'WIL', new Date(Date.now() - 1000));
    const tilesWzl = writeSource('Tiles.wzl');
    const clientTilesPak = path.join(dataDirectory, 'Tiles.pak');
    fs.writeFileSync(clientTilesPak, 'client-tiles');
    fs.utimesSync(clientTilesPak, sourceTime, sourceTime);
    writeLegacyCache('tiles-wzl-cache', tilesWzl, 'WZL', new Date(Date.now() - 1000));
    writeLegacyCache('tiles-pak-cache', clientTilesPak, 'GOM', new Date(Date.now() - 500));
    const smTilesPak = writeSource('SmTiles.pak');
    const smTilesWzl = writeSource('SmTiles.wzl');
    writeLegacyCache('smtiles-wzl-cache', smTilesWzl, 'WZL', new Date(Date.now() - 1000));
    const archiveFiles = [
      objectsPak,
      objectsWil,
      tilesWzl,
      clientTilesPak,
      smTilesPak,
      smTilesWzl,
    ];
    const resourceRoots = [preferredData, dataDirectory];
    invalidatePatchCacheIndex();
    const objectsResolution = resolveCachedPatchArchiveByName(
      cacheRoot,
      'Objects',
      archiveFiles,
      resourceRoots,
      ['pak', 'wil', 'wzl']
    );
    assert.equal(objectsResolution.status, 'ready');
    assert.equal(objectsResolution.sourcePath, objectsPak);
    assert.equal(objectsResolution.pak.pakPath, objectsPak);
    assert.equal(
      findUniqueCurrentCachedPatchPakByName(cacheRoot, 'Objects', ['wil', 'wzl']).pakPath,
      objectsWil,
      'shared classic lookup must ignore a same-name PAK cache'
    );
    assert.equal(
      findUniqueCurrentCachedPatchPakByName(cacheRoot, 'Tiles', ['wil', 'wzl']).pakPath,
      tilesWzl,
      'shared classic lookup may reuse one current WIL/WZL source outside the active roots'
    );
    const tilesResolution = resolveCachedPatchArchiveByName(
      cacheRoot,
      'Tiles',
      archiveFiles,
      resourceRoots,
      ['pak', 'wil', 'wzl']
    );
    assert.equal(tilesResolution.status, 'ready');
    assert.equal(
      tilesResolution.sourcePath,
      tilesWzl,
      'custom-patch WZL must override a client PAK even when the client cache is newer'
    );
    const smTilesResolution = resolveCachedPatchArchiveByName(
      cacheRoot,
      'SmTiles',
      archiveFiles,
      resourceRoots,
      ['pak', 'wil', 'wzl']
    );
    assert.deepEqual(
      smTilesResolution,
      { status: 'not-indexed', sourcePath: smTilesPak },
      'a lower-priority WZL cache must not replace the PAK actually selected by the client'
    );
    assert.deepEqual(
      resolveCachedPatchArchiveByName(
        cacheRoot,
        'Missing',
        archiveFiles,
        resourceRoots,
        ['pak', 'wil', 'wzl']
      ),
      { status: 'missing-source' }
    );

    const secondClientData = path.join(root, 'second-client', 'Data');
    fs.mkdirSync(secondClientData, { recursive: true });
    const secondObjectsWil = path.join(secondClientData, 'Objects.wil');
    fs.writeFileSync(secondObjectsWil, 'second-objects-wil');
    fs.utimesSync(secondObjectsWil, sourceTime, sourceTime);
    writeLegacyCache(
      'second-objects-wil-cache',
      secondObjectsWil,
      'WIL',
      new Date(Date.now() - 500)
    );
    invalidatePatchCacheIndex();
    assert.equal(
      findUniqueCurrentCachedPatchPakByName(cacheRoot, 'Objects', ['wil', 'wzl']),
      undefined,
      'shared classic lookup must refuse ambiguous same-name caches from two clients'
    );
    fs.rmSync(secondObjectsWil);
    invalidatePatchCacheIndex();
    assert.equal(
      findUniqueCurrentCachedPatchPakByName(cacheRoot, 'Objects', ['wil', 'wzl']).pakPath,
      objectsWil,
      'a cache whose original source disappeared must not make shared lookup ambiguous'
    );

    const jpkPath = path.join(dataDirectory, 'Items1.jpk');
    const jpkCacheDir = path.join(cacheRoot, 'jpk-fingerprint');
    const jpkImagePath = path.join(jpkCacheDir, '000001.png');
    fs.writeFileSync(jpkPath, 'jpk-items');
    fs.mkdirSync(jpkCacheDir);
    fs.writeFileSync(path.join(jpkCacheDir, '000000.png'), 'jpk-blank');
    fs.writeFileSync(jpkImagePath, 'jpk-image');
    fs.writeFileSync(path.join(jpkCacheDir, 'manifest.json'), JSON.stringify({
      version: 4,
      fingerprint: 'jpk-fingerprint',
      format: 'JPK',
      pakName: 'Items1',
      pakPath: jpkPath,
      sourceMd5: crypto.createHash('md5').update('jpk-items').digest('hex'),
      decoderRevision: 'jpk-alpha-plane-v2',
      willIdx: 99,
      slotCount: 2,
      assets: [],
    }));
    invalidatePatchCacheIndex();
    assert.equal(
      findCachedPatchImage(cacheRoot, 'Items1', 1, dataDirectory, ['pak']).imagePath,
      imagePath,
      'PAK lookup must not return a same-name JPK cache'
    );
    assert.equal(
      findCachedPatchImage(cacheRoot, 'Items1', 1, dataDirectory, ['jpk']).imagePath,
      jpkImagePath,
      'JPK lookup must not return a same-name PAK cache'
    );

    const originalTimes = fs.statSync(pakPath);
    fs.writeFileSync(pakPath, 'zap');
    fs.utimesSync(pakPath, originalTimes.atime, originalTimes.mtime);
    assert.equal(
      isPatchCacheCurrent(cached[0]),
      true,
      'the fast cache check intentionally cannot detect same-stat content changes'
    );
    const changedMd5 = crypto.createHash('md5').update('zap').digest('hex');
    assert.deepEqual(
      await validatePatchCacheMd5(cached[0]),
      { current: false, reason: 'changed', sourceMd5: changedMd5 },
      'the exact MD5 check must invalidate changed content even when size and mtime are unchanged'
    );
    fs.writeFileSync(pakPath, 'pak');
    fs.utimesSync(pakPath, originalTimes.atime, originalTimes.mtime);
    assert.deepEqual(
      await validatePatchCacheMd5({ ...cached[0], sourceMd5: undefined }),
      { current: false, reason: 'legacy' },
      'legacy manifests without a source MD5 must be rebuilt once'
    );

    const future = new Date(Date.now() + 5000);
    fs.utimesSync(pakPath, future, future);
    assert.equal(isPatchCacheCurrent(cached[0]), false, 'a newer source PAK must invalidate the cache');

    const olderCacheDir = path.join(cacheRoot, 'older-fingerprint');
    const olderImagePath = path.join(olderCacheDir, '000001.png');
    fs.mkdirSync(olderCacheDir);
    fs.writeFileSync(path.join(olderCacheDir, '000000.png'), 'png');
    fs.writeFileSync(olderImagePath, 'older');
    const olderManifestPath = path.join(olderCacheDir, 'manifest.json');
    fs.writeFileSync(olderManifestPath, JSON.stringify({
      format: 'GOM',
      decoderRevision: GOM_DECODER_REVISION,
      pakName: 'Items1',
      pakPath: path.join(root, 'moved-client', 'data', 'Items1.pak'),
      willIdx: 1,
      slotCount: 2,
      assets: [],
    }));
    const oldTime = new Date(Date.now() - 5000);
    fs.utimesSync(olderManifestPath, oldTime, oldTime);
    invalidatePatchCacheIndex();
    assert.equal(
      findCachedPatchImage(cacheRoot, 'Items1', 1, undefined, ['pak']).imagePath,
      olderImagePath,
      'image lookup must skip a newer stale cache and use the next valid same-name cache'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('patch-cache.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
