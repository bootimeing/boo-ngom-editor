const assert = require('node:assert/strict');

function main() {
  const { buildPakImageIndex, getPakImagePath } = require('../out/utils/pak-image-index');
  const index = buildPakImageIndex([
    { willIdx: 0, localIdx: 1180, path: 'D:/cache/newopui/001180.png' },
    { willIdx: 1, localIdx: 7, path: 'D:/cache/dialog/000007.png' },
  ]);

  assert.equal(getPakImagePath(index, 0, 1180), 'D:/cache/newopui/001180.png');
  assert.equal(getPakImagePath(index, 1, 7), 'D:/cache/dialog/000007.png');
  assert.equal(getPakImagePath(index, 1, 1180), undefined);
  assert.equal(getPakImagePath(index, -1, 7), undefined);
  console.log('pak-image-index.test.js: PASS');
}

main();
