const assert = require('node:assert/strict');
const zlib = require('node:zlib');

function main() {
  const { inflatePakPayload } = require('../out/utils/pak-reader');
  const raw = Buffer.from('BOO PAK checksum recovery test '.repeat(128), 'utf8');

  const valid = zlib.deflateSync(raw);
  const normal = inflatePakPayload(valid, raw.length);
  assert.deepEqual(Buffer.from(normal.raw), raw);
  assert.equal(normal.recoveredChecksum, false, 'valid zlib data must use normal verification');
  assert.throws(() => inflatePakPayload(valid, raw.length + 1), /长度|size/i);
  assert.throws(() => inflatePakPayload(valid, 16), /larger|length|limit|大小/i);
  assert.throws(() => inflatePakPayload(zlib.deflateSync(Buffer.alloc(1024 * 1024)), 16), /larger|length|limit|大小/i);
  assert.throws(() => inflatePakPayload(zlib.deflateSync(Buffer.alloc(1024 * 1024)), 16),
    error => error.slotCode === 3, 'bounded output overflow is corrupt image data, not an unclassified runtime allocation failure');
  for (const size of [0, -1, NaN, Infinity, 1.5, 1024 * 1024 * 1024]) {
    assert.throws(() => inflatePakPayload(valid, size), /大小|size|limit/i);
  }
  assert.throws(() => inflatePakPayload(Buffer.concat([valid, Buffer.from([0])]), raw.length), /尾随/);
  assert.throws(() => inflatePakPayload(Buffer.concat([valid, valid]), raw.length), /尾随/);

  const checksumDamaged = Buffer.from(valid);
  checksumDamaged[checksumDamaged.length - 1] ^= 0x01;
  assert.throws(
    () => zlib.inflateSync(checksumDamaged),
    /incorrect data check/,
    'the fixture must reproduce the reported zlib failure'
  );
  const recovered = inflatePakPayload(checksumDamaged, raw.length);
  assert.deepEqual(Buffer.from(recovered.raw), raw);
  assert.equal(recovered.recoveredChecksum, true, 'checksum-only damage should be recovered');
  assert.notEqual(recovered.actualChecksum, recovered.expectedChecksum);
  assert.throws(() => inflatePakPayload(Buffer.concat([checksumDamaged, Buffer.from([0])]), raw.length), /incorrect data check|尾随/);
  assert.throws(() => inflatePakPayload(checksumDamaged.subarray(0, checksumDamaged.length - 1), raw.length), /end|check|data/i);

  assert.throws(
    () => inflatePakPayload(checksumDamaged, raw.length + 1),
    /incorrect data check/,
    'recovery must be rejected when the decompressed image length is unexpected'
  );

  const bodyDamaged = Buffer.from(valid);
  bodyDamaged[Math.floor(bodyDamaged.length / 2)] ^= 0xff;
  assert.throws(
    () => inflatePakPayload(bodyDamaged, raw.length),
    /invalid|incorrect|distance|stream|block|data/i,
    'corrupted deflate bodies must still fail'
  );

  console.log('pak-inflate.test.js: PASS');
}

main();
