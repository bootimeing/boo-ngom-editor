const assert = require('node:assert/strict');

function bytes(...values) {
  return Uint8Array.from(values);
}

function signature(length, text, trailing = []) {
  return bytes(length, ...Buffer.from(text, 'ascii'), ...trailing);
}

function main() {
  const {
    applyGomColorKeyTransparency,
    detectPakFormat,
  } = require('../out/utils/pak-reader');

  assert.equal(detectPakFormat(signature(7, 'GEEPAK2')), 'GEE2');
  assert.equal(detectPakFormat(signature(7, 'GEEPAK3')), 'GEE');
  assert.equal(detectPakFormat(signature(10, 'GAMEOFMIR2', [0, 0])), 'GOM');
  assert.equal(detectPakFormat(signature(9, 'GAMEOFMIR')), 'GOM');
  assert.equal(detectPakFormat(signature(9, 'GAMEOFMIX')), 'UNKNOWN');
  assert.equal(detectPakFormat(signature(10, 'GAMEOFMIR')), 'UNKNOWN');

  const colorKeyed = applyGomColorKeyTransparency(
    Uint8ClampedArray.from([
      0, 0, 0, 255,
      0, 0, 1, 255,
      12, 34, 56, 255,
    ]),
    6,
    0
  );
  assert.deepEqual(
    [...colorKeyed],
    [0, 0, 0, 0, 0, 0, 1, 255, 12, 34, 56, 255],
    'GOM BGR24 images without an alpha plane must use pure black as the transparent color key'
  );
  for (const imageType of [5, 7]) {
    const keyed = applyGomColorKeyTransparency(
      Uint8ClampedArray.from([0, 0, 0, 255, 8, 0, 0, 255]),
      imageType,
      0
    );
    assert.deepEqual(
      [...keyed],
      [0, 0, 0, 0, 8, 0, 0, 255],
      `GOM no-alpha image type ${imageType} must use the same pure-black color key`
    );
  }
  const paletteImage = applyGomColorKeyTransparency(
    Uint8ClampedArray.from([0, 0, 0, 255]),
    3,
    0
  );
  assert.deepEqual([...paletteImage], [0, 0, 0, 255], 'palette alpha must remain authoritative');
  const explicitAlpha = applyGomColorKeyTransparency(
    Uint8ClampedArray.from([0, 0, 0, 127]),
    6,
    1
  );
  assert.deepEqual([...explicitAlpha], [0, 0, 0, 127], 'explicit GOM alpha must be preserved');

  console.log('pak-format.test.js: PASS');
}

main();
