const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const parser = require('../media/geepak3_exact.js');

const HEADER_SIZE = 266;
const IMAGE_MASK = Buffer.from([0x51, 0x22, 0x93, 0x04, 0xa5, 0x16, 0x77, 0xe8]);

function encodeImageHeader(options) {
  const header = Buffer.alloc(16);
  header[0] = options.imageType;
  header[3] = options.flags;
  header.writeUInt16LE(options.width, 4);
  header.writeUInt16LE(options.height, 6);
  header.writeInt16LE(options.x, 8);
  header.writeInt16LE(options.y, 10);
  header.writeUInt32LE(options.compressedSize, 12);
  for (let index = 0; index < IMAGE_MASK.length; index++) header[index] ^= IMAGE_MASK[index];
  return header;
}

function buildFixture() {
  const alphaRaw = Buffer.from([
    30, 20, 10, 60, 50, 40, 0, 0,
    90, 80, 70, 120, 110, 100, 0, 0,
    33, 44, 0, 0,
    11, 22, 0, 0,
  ]);
  const alphaPayload = zlib.deflateSync(alphaRaw);
  const rgb565Raw = Buffer.alloc(8);
  rgb565Raw.writeUInt16LE(0xf800, 0);
  rgb565Raw.writeUInt16LE(0x07e0, 4);

  const slotCount = 4;
  const firstOffset = HEADER_SIZE + slotCount * 4;
  const thirdOffset = firstOffset + 16 + alphaPayload.length;
  const firstHeader = encodeImageHeader({
    imageType: 6,
    flags: 1,
    width: 2,
    height: 2,
    x: -3,
    y: 5,
    compressedSize: alphaPayload.length,
  });
  const thirdHeader = encodeImageHeader({
    imageType: 5,
    flags: 0,
    width: 1,
    height: 2,
    x: 7,
    y: -9,
    compressedSize: 0,
  });

  const archive = Buffer.alloc(thirdOffset + 16 + rgb565Raw.length);
  archive[0] = 7;
  archive.write('GEEPAK2', 1, 'ascii');
  firstHeader.copy(archive, firstOffset);
  alphaPayload.copy(archive, firstOffset + 16);
  thirdHeader.copy(archive, thirdOffset);
  rgb565Raw.copy(archive, thirdOffset + 16);

  const decryptedIndex = Buffer.alloc(slotCount * 4);
  decryptedIndex.writeUInt32LE(firstOffset, 0);
  decryptedIndex.writeUInt32LE(thirdOffset, 8);
  const profile = {
    format: 'GEEPAK2',
    family: 'gee2',
    title: 'www.gameofmir2.com',
    headerSize: HEADER_SIZE,
    slotCount,
    version: 2,
    indexOffset: HEADER_SIZE,
    imageHeaderMask: IMAGE_MASK.toString('base64'),
    decryptedIndex: decryptedIndex.toString('base64'),
  };
  return { archive, profile, alphaRaw };
}

function main() {
  const { archive, profile, alphaRaw } = buildFixture();
  const parsed = parser.parse(archive, '', profile);
  assert.equal(parsed.header.family, 'gee2');
  assert.equal(parsed.header.count, 4);
  assert.deepEqual(parsed.blocks.map(block => block.logicalIndex), [0, 2]);
  assert.deepEqual(
    parsed.blocks.map(block => [block.format, block.width, block.height, block.x, block.y]),
    [
      ['GEE_R8G8B8_A8', 2, 2, -3, 5],
      ['GEE_R5G6B5', 1, 2, 7, -9],
    ]
  );

  const fromReader = parser.parseFromReader(
    archive.length,
    (offset, length) => archive.subarray(offset, offset + length),
    '',
    profile
  );
  assert.deepEqual(fromReader.blocks, parsed.blocks);

  const firstRaw = parser.readPayload(archive, parsed.blocks[0], payload => zlib.inflateSync(payload));
  assert.deepEqual(Buffer.from(firstRaw), alphaRaw);
  assert.deepEqual(
    [...parser.toRgba(firstRaw, parsed.blocks[0])],
    [
      70, 80, 90, 11, 100, 110, 120, 22,
      10, 20, 30, 33, 40, 50, 60, 44,
    ]
  );

  const thirdRaw = parser.readPayload(archive, parsed.blocks[1]);
  assert.deepEqual(
    [...parser.toRgba(thirdRaw, parsed.blocks[1])],
    [0, 255, 0, 255, 255, 0, 0, 255]
  );

  assert.throws(() => parser.parse(archive, '', null), /GEEPAK2.*离线引擎/);
  assert.throws(
    () => parser.parse(archive, '', { ...profile, imageHeaderMask: Buffer.alloc(7).toString('base64') }),
    /imageHeaderMask.*长度无效/
  );
  const overlappingIndex = Buffer.from(profile.decryptedIndex, 'base64');
  overlappingIndex.writeUInt32LE(parsed.blocks[0].payloadOffset + 1, 8);
  assert.throws(
    () => parser.parse(archive, '', {
      ...profile,
      decryptedIndex: overlappingIndex.toString('base64'),
    }),
    /数据与下一个图像块重叠/
  );

  console.log('geepak2-parser.test.js: PASS');
}

main();
