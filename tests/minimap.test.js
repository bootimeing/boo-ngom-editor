const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function main() {
  const {
    decodeMiniMapCode,
    findMiniMapReferenceByPriority,
    miniMapArchiveCandidates,
    parseMiniMapText,
  } = require('../out/utils/minimap');

  assert.deepEqual(miniMapArchiveCandidates('mmap0'), ['mmap0', 'mmap']);
  assert.deepEqual(miniMapArchiveCandidates('MMAP0.PAK'), ['MMAP0.PAK', 'mmap']);
  assert.deepEqual(miniMapArchiveCandidates('mmap10'), ['mmap10']);

  assert.deepEqual(decodeMiniMapCode('盟重土城', 10012), {
    mapName: '盟重土城',
    code: 10012,
    pakName: 'mmap10',
    imageIndex: 11,
  });
  assert.deepEqual(decodeMiniMapCode('盟重土城', 10286), {
    mapName: '盟重土城',
    code: 10286,
    pakName: 'mmap10',
    imageIndex: 285,
  });
  assert.deepEqual(decodeMiniMapCode('荒土城', 11031), {
    mapName: '荒土城',
    code: 11031,
    pakName: 'mmap10',
    imageIndex: 1030,
  });
  assert.deepEqual(decodeMiniMapCode('扩展边界10', 15000), {
    mapName: '扩展边界10',
    code: 15000,
    pakName: 'mmap10',
    imageIndex: 4999,
  });
  assert.deepEqual(decodeMiniMapCode('扩展边界11', 15001), {
    mapName: '扩展边界11',
    code: 15001,
    pakName: 'mmap11',
    imageIndex: 0,
  });
  assert.deepEqual(decodeMiniMapCode('扩展边界12', 20001), {
    mapName: '扩展边界12',
    code: 20001,
    pakName: 'mmap12',
    imageIndex: 0,
  });
  assert.deepEqual(decodeMiniMapCode('sldg', 3101), {
    mapName: 'sldg',
    code: 3101,
    pakName: 'mmap3',
    imageIndex: 100,
  });
  const index = parseMiniMapText('; comment\n盟重土城 10012\n0110\t10012\nbad line');
  assert.equal(index.get('盟重土城').imageIndex, 11);
  assert.equal(index.get('0110').pakName, 'mmap10');
  assert.equal(index.get('0110').imageIndex, 11);

  const priorityIndex = parseMiniMapText('地图编号 10012\n原始地图编号 3101');
  assert.equal(
    findMiniMapReferenceByPriority(priorityIndex, ['原始地图编号', '地图编号']).pakName,
    'mmap3'
  );
  assert.equal(
    findMiniMapReferenceByPriority(priorityIndex, ['不存在', '地图编号']).pakName,
    'mmap10'
  );

  const {
    findCachedPatchImage,
    invalidatePatchCacheIndex,
  } = require('../out/utils/patch-cache');
  const { JPK_DECODER_REVISION } = require('../out/utils/pak-reader');
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-minimap-jpk-'));
  try {
    const sourceRoot = path.join(cacheRoot, 'client', 'Data');
    const cacheDir = path.join(cacheRoot, 'entry');
    const jpkPath = path.join(sourceRoot, 'mmap10.jpk');
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(jpkPath, 'jpk');
    fs.writeFileSync(path.join(cacheDir, '000000.png'), 'blank');
    fs.writeFileSync(path.join(cacheDir, '000011.png'), 'map');
    fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify({
      version: 4,
      fingerprint: 'entry',
      format: 'JPK',
      pakName: 'mmap10',
      pakPath: jpkPath,
      decoderRevision: JPK_DECODER_REVISION,
      willIdx: 10,
      slotCount: 12,
      assets: [],
    }));
    invalidatePatchCacheIndex();
    const resolved = findCachedPatchImage(
      cacheRoot,
      'mmap10',
      index.get('0110').imageIndex,
      sourceRoot,
      ['jpk']
    );
    assert.ok(resolved);
    assert.equal(path.basename(resolved.imagePath), '000011.png');
    assert.equal(path.extname(resolved.pak.pakPath).toLowerCase(), '.jpk');
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
  console.log('minimap.test.js: PASS');
}

main();
