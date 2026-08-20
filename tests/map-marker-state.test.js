const assert = require('node:assert/strict');

function main() {
  const {
    mapMarkerWorkspaceKey,
    rememberMapMarkerFile,
    resolveSavedMapMarkerFile,
  } = require('../out/utils/map-marker-state');

  const root = 'D:\\MirServer翎风';
  const key = mapMarkerWorkspaceKey(root);
  assert.equal(key, 'd:\\mirserver翎风');
  assert.equal(resolveSavedMapMarkerFile('D:\\Maps\\Current.txt', {}, root), 'D:\\Maps\\Current.txt');
  assert.equal(
    resolveSavedMapMarkerFile('', { [key]: 'D:\\Maps\\Saved.txt' }, root),
    'D:\\Maps\\Saved.txt'
  );
  assert.equal(resolveSavedMapMarkerFile('', { [key]: 'D:\\Maps\\Saved.txt' }, ''), '');

  const remembered = rememberMapMarkerFile({ other: 'C:\\Old.txt' }, root, 'D:\\Maps\\MapDesc1.txt');
  assert.deepEqual(remembered, {
    other: 'C:\\Old.txt',
    [key]: 'D:\\Maps\\MapDesc1.txt',
  });
  assert.notEqual(remembered, null);
  assert.throws(() => rememberMapMarkerFile({}, '', 'D:\\Maps\\MapDesc1.txt'), /工作区/);

  console.log('map-marker-state.test.js: PASS');
}

main();
