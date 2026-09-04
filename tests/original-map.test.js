const assert = require('node:assert/strict');

function writeLegendMapHeader(buffer, cellSize) {
  buffer[4] = cellSize === 12 ? 0x0d : 0x0f;
  buffer.write('Legend of mir', 5, 'ascii');
  if (cellSize !== 12) {
    buffer[18] = 0x0d;
    buffer[19] = 0x0a;
  }
}

function buildSingleCellMap(cellSize, animationFrame, animationTick, recognizedHeader = true) {
  const buffer = Buffer.alloc(52 + cellSize);
  buffer.writeUInt16LE(1, 0);
  buffer.writeUInt16LE(1, 2);
  if (recognizedHeader) writeLegendMapHeader(buffer, cellSize);
  buffer.writeUInt16LE(1, 52 + 4);
  buffer[52 + 8] = animationFrame;
  buffer[52 + 9] = animationTick;
  return buffer;
}

function buildSharedObjectMap(firstAnimationFrame, firstAnimationTick, secondAnimationFrame, secondAnimationTick) {
  const width = 2;
  const height = 1;
  const cellSize = 14;
  const buffer = Buffer.alloc(52 + width * height * cellSize);
  buffer.writeUInt16LE(width, 0);
  buffer.writeUInt16LE(height, 2);
  writeLegendMapHeader(buffer, cellSize);
  for (let x = 0; x < width; x++) {
    const offset = 52 + x * cellSize;
    buffer.writeUInt16LE(1, offset + 4);
    buffer[offset + 8] = x === 0 ? firstAnimationFrame : secondAnimationFrame;
    buffer[offset + 9] = x === 0 ? firstAnimationTick : secondAnimationTick;
  }
  return buffer;
}

async function main() {
  const {
    collectOriginalMapViewport,
    originalMapAnimationFrameCount,
    originalMapAnimationFrameReferences,
    originalMapAnimationProfileSupportsPlayback,
    originalMapAnimationSequenceKey,
    originalMapArchiveName,
    originalMapObjectBlendAnchorRows,
    permanentMapEffectFramesIntersectViewport,
    parseOriginalMap,
  } = require('../out/utils/original-map');

  const width = 4;
  const height = 4;
  const cellSize = 14;
  const buffer = Buffer.alloc(52 + width * height * cellSize);
  buffer.writeUInt16LE(width, 0);
  buffer.writeUInt16LE(height, 2);
  writeLegendMapHeader(buffer, cellSize);
  const writeCell = (x, y, values) => {
    const offset = 52 + (x * height + y) * cellSize;
    buffer.writeUInt16LE(values.back || 0, offset);
    buffer.writeUInt16LE(values.middle || 0, offset + 2);
    buffer.writeUInt16LE(values.front || 0, offset + 4);
    buffer[offset + 8] = values.animationFrame || 0;
    buffer[offset + 9] = values.animationTick || 0;
    buffer[offset + 10] = values.objectFile || 0;
    buffer[offset + 12] = values.tileFile || 0;
    buffer[offset + 13] = values.smTileFile || 0;
  };
  writeCell(0, 0, { back: 1, tileFile: 99 });
  writeCell(1, 1, { middle: 8, smTileFile: 100 });
  writeCell(2, 2, { front: 3, objectFile: 101, animationFrame: 0xa3, animationTick: 2 });
  writeCell(0, 2, { back: 0xffff, middle: 0xffff, front: 0xffff });

  const model = await parseOriginalMap(buffer);
  assert.equal(model.cellSize, 14);
  assert.equal(model.referenceCount, 3);
  assert.equal(model.backImages[2 * width], 0, '0xFFFF back-image sentinel must remain blank');
  assert.equal(model.middleImages[2 * width], 0, '0xFFFF middle-image sentinel must remain blank');
  assert.equal(model.frontImages[2 * width], 0, '0xFFFF front-image sentinel must remain blank');
  assert.equal(model.objectAnimationFrames[2 * width + 2], 0xa3);
  assert.equal(model.objectAnimationTicks[2 * width + 2], 2);
  assert.equal(originalMapArchiveName('tile', 0), 'Tiles');
  assert.equal(originalMapArchiveName('tile', 99), 'Tiles100');
  assert.equal(originalMapArchiveName('object', 101), 'Objects102');

  const refs = collectOriginalMapViewport(model, { left: 0, top: 0, right: 3, bottom: 3 });
  assert.deepEqual(
    refs.map(ref => [ref.layer, ref.archiveName, ref.imageIndex, ref.animationFrame, ref.animationTick]),
    [
      ['tile', 'Tiles100', 0, 0, 0],
      ['smTile', 'SmTiles101', 7, 0, 0],
      ['object', 'Objects102', 2, 0xa3, 2],
    ]
  );

  for (const [cellSize, animationFrame, animationTick] of [[12, 0x23, 0], [14, 0x80, 2], [36, 0x8a, 5]]) {
    const formatModel = await parseOriginalMap(buildSingleCellMap(cellSize, animationFrame, animationTick));
    assert.equal(
      formatModel.animationProfile,
      cellSize === 12
        ? 'classic-12'
        : cellSize === 14
          ? 'classic-14'
          : 'classic-prefix-compatible-36'
    );
    assert.equal(formatModel.objectAnimationFrames[0], animationFrame);
    assert.equal(formatModel.objectAnimationTicks[0], animationTick);
    const reference = collectOriginalMapViewport(
      formatModel,
      { left: 0, top: 0, right: 0, bottom: 0 }
    )[0];
    assert.equal(
      reference.animationFrame,
      animationFrame,
      `${cellSize}-byte MAP cells must read the animation byte from +8`
    );
    assert.equal(reference.animationTick, animationTick, `${cellSize}-byte MAP cells must read tick from +9`);
  }
  const unverifiedHeaderModel = await parseOriginalMap(buildSingleCellMap(14, 0xff, 0xff, false));
  assert.equal(unverifiedHeaderModel.animationProfile, 'unverified');
  assert.equal(
    originalMapAnimationProfileSupportsPlayback('GOM', unverifiedHeaderModel.animationProfile),
    false,
    'cell size alone must not authorize classic low-7-bit animation semantics'
  );
  const invalidHeaderCases = [
    (() => {
      const candidate = buildSingleCellMap(36, 3, 1);
      candidate[4] = 0x0d;
      return candidate;
    })(),
    (() => {
      const candidate = buildSingleCellMap(12, 3, 1);
      candidate[4] = 0x0f;
      candidate[18] = 0x0d;
      candidate[19] = 0x0a;
      return candidate;
    })(),
    (() => {
      const candidate = buildSingleCellMap(14, 3, 1);
      candidate[18] = 0;
      candidate[19] = 0;
      return candidate;
    })(),
  ];
  for (const candidate of invalidHeaderCases) {
    assert.equal(
      (await parseOriginalMap(candidate)).animationProfile,
      'unverified',
      'near-miss MAP headers must not opt into the classic animation profile'
    );
  }
  assert.equal(originalMapAnimationProfileSupportsPlayback('GOM', 'classic-12'), true);
  assert.equal(originalMapAnimationProfileSupportsPlayback('GOM', 'classic-14'), true);
  assert.equal(originalMapAnimationProfileSupportsPlayback('GOM', 'classic-prefix-compatible-36'), true);
  assert.equal(
    originalMapObjectBlendAnchorRows('GOM', 'classic-14'),
    3,
    'the verified GOM classic-14 bit7 family must use the client three-row anchor'
  );
  assert.equal(
    originalMapObjectBlendAnchorRows('GOM', 'classic-12'),
    3,
    'the classic GOM bit7 anchor must not depend on an Objects archive name'
  );
  assert.equal(
    originalMapObjectBlendAnchorRows('GOM', 'classic-prefix-compatible-36'),
    3,
    'the verified classic-prefix-compatible GOM profile must preserve the classic bit7 anchor'
  );
  assert.equal(
    originalMapObjectBlendAnchorRows('GOM', 'unverified'),
    undefined,
    'an unverified MAP profile must retain ordinary bottom anchoring'
  );
  assert.equal(
    originalMapObjectBlendAnchorRows('GEE', 'classic-14'),
    undefined,
    'the fixed anchor must not leak into an unverified engine'
  );
  assert.equal(
    originalMapAnimationProfileSupportsPlayback('GEE', 'classic-14'),
    false,
    'unverified engine/profile pairs must keep embedded object sequences on their first frame'
  );
  assert.equal(originalMapAnimationProfileSupportsPlayback('996PC', 'classic-prefix-compatible-36'), false);

  const sharedObjectModel = await parseOriginalMap(buildSharedObjectMap(0x23, 1, 0x80, 7));
  const sharedObjectRefs = collectOriginalMapViewport(
    sharedObjectModel,
    { left: 0, top: 0, right: 1, bottom: 0 }
  );
  assert.deepEqual(
    sharedObjectRefs.map(reference => [reference.resourceKey, reference.animationFrame, reference.animationTick]),
    [['objects:0', 0x23, 1], ['objects:0', 0x80, 7]],
    'resource deduplication keys must not erase per-placement animation/blend bytes or ticks'
  );
  const sequenceReference = { ...sharedObjectRefs[0], animationFrame: 0x83 };
  assert.equal(originalMapAnimationFrameCount(sequenceReference.animationFrame), 3);
  assert.equal(originalMapAnimationSequenceKey(sequenceReference), 'objects:0#3');
  assert.deepEqual(
    originalMapAnimationFrameReferences(sequenceReference).map(reference => reference.resourceKey),
    ['objects:0', 'objects:1', 'objects:2'],
    'map animation frames must use consecutive image indexes in the same Objects archive'
  );
  const adjacentViewport = { left: 16, top: 16, right: 31, bottom: 31 };
  assert.equal(
    permanentMapEffectFramesIntersectViewport(32, 20, [
      { width: 96, height: 64, offsetX: -64, offsetY: 0, blank: false },
    ], adjacentViewport),
    true,
    'negative-offset MAPEFFECT frame extending from an adjacent chunk must remain visible'
  );
  assert.equal(
    permanentMapEffectFramesIntersectViewport(32, 20, [
      { width: 32, height: 64, offsetX: 0, offsetY: 0, blank: false },
    ], adjacentViewport),
    false,
    'an adjacent MAPEFFECT frame touching but not crossing the viewport edge must stay excluded'
  );
  assert.equal(
    permanentMapEffectFramesIntersectViewport(20, 32, [
      { width: 48, height: 96, offsetX: 0, offsetY: -80, blank: false },
    ], adjacentViewport),
    true,
    'negative vertical offsets must use frame pixels rather than only the logical effect cell'
  );
  assert.equal(
    permanentMapEffectFramesIntersectViewport(20, 20, [
      { width: 512, height: 512, offsetX: -256, offsetY: -256, blank: true },
    ], adjacentViewport),
    false,
    'blank animation slots must not create a false visual intersection'
  );
  console.log('original-map.test.js: PASS');
}

main();
