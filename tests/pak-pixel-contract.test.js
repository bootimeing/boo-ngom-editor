const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const parser = require(path.join(runtime, 'media/geepak3_exact.js'));
const block = (imageType, flags, width, height, rawSize) => ({ imageType, flags, width, height, rawSize });
const render = (raw, b) => [...parser.toRgba(Buffer.from(raw), b)];

// Handwritten BGR scanlines: two rows, odd width, poisoned DIB padding.
const color = [0, 0, 255, 0, 255, 0, 255, 0, 0, 222, 222, 222,
  255, 255, 255, 0, 0, 0, 3, 2, 1, 111, 111, 111];
const opaque = [255, 255, 255, 255, 0, 0, 0, 255, 1, 2, 3, 255,
  255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255];
assert.deepEqual(render(color, block(6, 0, 3, 2, 24)), opaque);
const alpha = [0, 17, 127, 66, 255, 128, 1, 77];
const withAlpha = opaque.slice();
[255, 128, 1, 0, 17, 127].forEach((a, i) => { withAlpha[i * 4 + 3] = a; });
assert.deepEqual(render([...color, ...alpha], block(6, 1, 3, 2, 32)), withAlpha, 'separate A8 plane, bottom-up, per-row padding');
assert.deepEqual(render([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00, 99, 99,
  0xff, 0xff, 0x00, 0x00, 0x21, 0x08, 88, 88], block(5, 0, 3, 2, 16)),
  [255,255,255,255, 0,0,0,255, 8,4,8,255, 255,0,0,255, 0,255,0,255, 0,0,255,255], 'RGB565 channel widths and padding');
assert.deepEqual(render([3, 2, 1, 17, 6, 5, 4, 127], block(7, 1, 1, 2, 8)),
  [4,5,6,127,1,2,3,17], 'current inline BGRA profile');
assert.deepEqual(render([3, 2, 1, 17, 6, 5, 4, 127], block(7, 0, 1, 2, 8)),
  [4,5,6,255,1,2,3,255], 'X channel is ignored, not alpha');
assert.deepEqual(render([1, 0, 0, 0], block(3, 0, 1, 1, 4)),
  [parser.A8_PALETTE_BGRA[6], parser.A8_PALETTE_BGRA[5], parser.A8_PALETTE_BGRA[4], parser.A8_PALETTE_BGRA[7]]);
for (const [type, flags] of [[4,0], [5,1], [3,1], [6,2], [8,0], [255,0]]) {
  assert.throws(() => parser.toRgba(Buffer.alloc(4), block(type, flags, 1, 1, 4)), /unsupported|layout/i,
    'unknown profiles must not fall through to BGRA');
}
assert.throws(() => parser.toRgba(Buffer.alloc(1), block(6,0,1,1,1)), /size|layout/i,
  'matching a forged rawSize is insufficient: validate actual layout');
for (const dimension of [0, -1, 1.5, NaN, Infinity, 65536]) {
  assert.throws(() => parser.toRgba(Buffer.alloc(0), block(6,0,dimension,1,0)), /dimension|尺寸/i);
}
console.log('pak-pixel-contract.test.js: PASS BGR, RGB565, row alignment, orientation, explicit alpha and unknown-layout rejection; synthetic pixel vectors, not client fidelity');
