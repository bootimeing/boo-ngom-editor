const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', root], {
  cwd: root,
  stdio: 'ignore',
});

const { resolveGxxItemLightEffect } = require('../out/ui-dialog/item-light-preview');

function main() {
  assert.deepEqual(resolveGxxItemLightEffect('GEE', 1), {
    archiveName: 'Prguse2', startIndex: 230, frameCount: 20,
    offsetX: 0, offsetY: 0, intervalMs: 200, blendMode: 'src-alpha-color',
  });
  assert.deepEqual(resolveGxxItemLightEffect('GEE', 8), {
    archiveName: 'Prguse3', startIndex: 758, frameCount: 2,
    offsetX: 0, offsetY: 0, intervalMs: 200, blendMode: 'src-alpha-color',
  });
  assert.deepEqual(resolveGxxItemLightEffect('GEE', 11), {
    archiveName: 'StateEffect', startIndex: 640, frameCount: 15,
    offsetX: 16, offsetY: 20, intervalMs: 200, blendMode: 'src-alpha-color',
  });
  assert.deepEqual(resolveGxxItemLightEffect('GEE', 100), {
    archiveName: 'HeadgearEffect', startIndex: 0, frameCount: 20,
    offsetX: 0, offsetY: 0, intervalMs: 200, blendMode: 'src-alpha-color',
  });
  assert.deepEqual(resolveGxxItemLightEffect('GEE', 699), {
    archiveName: 'HeadgearEffect6', startIndex: 1980, frameCount: 20,
    offsetX: 0, offsetY: 0, intervalMs: 200, blendMode: 'src-alpha-color',
  });
  assert.equal(resolveGxxItemLightEffect('GOM', 1), undefined,
    'GOM must not inherit GXX light archive semantics');
  assert.equal(resolveGxxItemLightEffect('GEE', 0), undefined);
  assert.equal(resolveGxxItemLightEffect('GEE', 700), undefined);
  console.log('item-light-preview.test.js: PASS');
}

main();
