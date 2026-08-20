const assert = require('node:assert/strict');

async function main() {
  const {
    collectOriginalMapViewport,
    originalMapArchiveName,
    parseOriginalMap,
  } = require('../out/utils/original-map');

  const width = 4;
  const height = 4;
  const cellSize = 14;
  const buffer = Buffer.alloc(52 + width * height * cellSize);
  buffer.writeUInt16LE(width, 0);
  buffer.writeUInt16LE(height, 2);
  const writeCell = (x, y, values) => {
    const offset = 52 + (x * height + y) * cellSize;
    buffer.writeUInt16LE(values.back || 0, offset);
    buffer.writeUInt16LE(values.middle || 0, offset + 2);
    buffer.writeUInt16LE(values.front || 0, offset + 4);
    buffer[offset + 10] = values.objectFile || 0;
    buffer[offset + 12] = values.tileFile || 0;
    buffer[offset + 13] = values.smTileFile || 0;
  };
  writeCell(0, 0, { back: 1, tileFile: 99 });
  writeCell(1, 1, { middle: 8, smTileFile: 100 });
  writeCell(2, 2, { front: 3, objectFile: 101 });

  const model = await parseOriginalMap(buffer);
  assert.equal(model.cellSize, 14);
  assert.equal(model.referenceCount, 3);
  assert.equal(originalMapArchiveName('tile', 0), 'Tiles');
  assert.equal(originalMapArchiveName('tile', 99), 'Tiles100');
  assert.equal(originalMapArchiveName('object', 101), 'Objects102');

  const refs = collectOriginalMapViewport(model, { left: 0, top: 0, right: 3, bottom: 3 });
  assert.deepEqual(
    refs.map(ref => [ref.layer, ref.archiveName, ref.imageIndex]),
    [
      ['tile', 'Tiles100', 0],
      ['smTile', 'SmTiles101', 7],
      ['object', 'Objects102', 2],
    ]
  );
  console.log('original-map.test.js: PASS');
}

main();
