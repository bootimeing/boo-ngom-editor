const assert = require('node:assert/strict');
const path = require('node:path');

const parser = require(path.resolve('media/geepak3_exact.js'));

function buildFixture() {
  const count = 2;
  const imageOffset = 266 + count * 4;
  const data = Buffer.alloc(imageOffset + 16 + 4, 0xaa);
  data[0] = 0x07;
  data.write('GEEPAK3', 1, 'ascii');

  const indexKey = Buffer.alloc(256);
  const imageKey = Buffer.alloc(1024);
  data.writeUInt32LE((imageOffset ^ 0xffffffff) >>> 0, 266);
  data.writeUInt32LE(0xfffffffe, 270);

  const imageHeader = Buffer.alloc(16);
  imageHeader[0] = 7;
  imageHeader[3] = 1;
  imageHeader.writeUInt16LE(1, 4);
  imageHeader.writeUInt16LE(1, 6);
  imageHeader.writeInt16LE(-2, 8);
  imageHeader.writeInt16LE(3, 10);
  imageHeader.copy(data, imageOffset);
  Buffer.from([10, 20, 30, 40]).copy(data, imageOffset + 16);

  const alternate = Buffer.alloc(256);
  const title = Buffer.from('www.gameofmir.com', 'ascii');
  alternate[1] = title.length;
  title.copy(alternate, 2);
  alternate.writeUInt32LE(269, 0x2a);
  alternate.writeUInt32LE(count, 0x2e);
  alternate.writeUInt32LE(2, 0x32);
  alternate.writeUInt32LE(266, 0x36);

  return {
    data,
    profile: {
      indexKey: indexKey.toString('base64'),
      globalHeaderKey: Buffer.alloc(256).toString('base64'),
      imageHeaderKey: imageKey.toString('base64'),
      alternateGlobalHeader: alternate.toString('base64'),
    },
  };
}

const { data, profile } = buildFixture();
const parsed = parser.parse(data, 'symbols.test!@#', profile);
assert.equal(parsed.header.family, 'alternate-global');
assert.equal(parsed.header.count, 2);
assert.equal(parsed.blocks.length, 1);
assert.deepEqual(
  {
    logicalIndex: parsed.blocks[0].logicalIndex,
    width: parsed.blocks[0].width,
    height: parsed.blocks[0].height,
    x: parsed.blocks[0].x,
    y: parsed.blocks[0].y,
  },
  { logicalIndex: 0, width: 1, height: 1, x: -2, y: 3 }
);

const streamed = parser.parseFromReader(
  data.length,
  (offset, length) => data.subarray(offset, offset + length),
  'symbols.test!@#',
  profile
);
assert.equal(streamed.header.family, 'alternate-global');
assert.equal(streamed.blocks.length, 1);

assert.throws(
  () => parser.parse(data, 'wrong-password', {
    ...profile,
    alternateGlobalHeader: Buffer.alloc(256).toString('base64'),
  }),
  /密码不正确或属于尚未支持的加密变体/
);

console.log('GEEPAK3 alternate global-header parser tests passed.');
