const assert = require('node:assert/strict');
const zlib = require('node:zlib');

function main() {
  const { inflatePakPayload } = require('../out/utils/pak-reader');
  const raw = Buffer.from('BOO PAK checksum recovery test '.repeat(128), 'utf8');

  const valid = zlib.deflateSync(raw);
  const normal = inflatePakPayload(valid, raw.length);
  assert.deepEqual(Buffer.from(normal.raw), raw);
  assert.equal(normal.recoveredChecksum, false, 'valid zlib data must use normal verification');

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
