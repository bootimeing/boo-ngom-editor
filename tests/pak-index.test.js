const assert = require('node:assert/strict');
const fs = require('node:fs');
const iconv = require('iconv-lite');
const os = require('node:os');
const path = require('node:path');

function main() {
  const {
    clearPakCache,
    loadPakIndex,
    matchPakFile,
  } = require('../out/utils/pak');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-pak-index-'));
  try {
    const envir = path.join(root, 'Mir200', 'Envir');
    fs.mkdirSync(envir, { recursive: true });
    fs.writeFileSync(
      path.join(envir, 'EffectImageList.txt'),
      iconv.encode(
        'Newopui.pak\r\n对话框.PAK\r\nTitle.jpk\r\nResources\\Data\\Tiles151.JPK\r\nMagic.wil\r\nUi.wzl\r\nShared.pak\r\nShared.wil\r\n',
        'gbk'
      )
    );
    clearPakCache();
    const index = loadPakIndex(root);
    assert.ok(index);
    assert.deepEqual(index.pakList, [
      { name: 'Newopui', willIdx: 0, extension: 'pak' },
      { name: '对话框', willIdx: 1, extension: 'pak' },
      { name: 'Title', willIdx: 2, extension: 'jpk' },
      { name: 'Tiles151', willIdx: 3, extension: 'jpk' },
      { name: 'Magic', willIdx: 4, extension: 'wil' },
      { name: 'Ui', willIdx: 5, extension: 'wzl' },
      { name: 'Shared', willIdx: 6, extension: 'pak' },
      { name: 'Shared', willIdx: 7, extension: 'wil' },
    ]);
    assert.deepEqual(
      matchPakFile(path.join(root, 'Resources', 'Data', 'TITLE.JPK'), index.pakList),
      { name: 'Title', willIdx: 2, extension: 'jpk' },
      'JPK matching must remain case-insensitive and preserve EffectImageList line order'
    );
    assert.deepEqual(
      matchPakFile(path.join(root, 'Resources', 'Data', 'shared.wil'), index.pakList),
      { name: 'Shared', willIdx: 7, extension: 'wil' },
      'same-name resources must match the exact extension from EffectImageList'
    );

    const outer = path.join(root, '996pc-outer');
    const nestedEnvir = path.join(outer, 'Mirserver', 'Mir200', 'Envir');
    fs.mkdirSync(nestedEnvir, { recursive: true });
    fs.writeFileSync(path.join(outer, 'Mirserver', 'Mir200', 'M2Server.exe'), '');
    fs.writeFileSync(
      path.join(nestedEnvir, 'EffectImageList.txt'),
      iconv.encode('转换补丁.Jpk\r\nItems.Jpk\r\n', 'gbk')
    );
    clearPakCache();
    assert.deepEqual(loadPakIndex(outer)?.pakList, [
      { name: '转换补丁', willIdx: 0, extension: 'jpk' },
      { name: 'Items', willIdx: 1, extension: 'jpk' },
    ], 'an outer 996PC workspace must resolve Mirserver/EffectImageList.txt');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('pak-index.test.js: PASS');
}

main();
