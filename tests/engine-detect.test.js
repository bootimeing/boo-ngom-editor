const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}

function main() {
  const { detectEngineDetails } = require('../out/utils/engine-detect');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-engine-detect-'));
  try {
    const empty = path.join(root, 'ordinary-folder');
    fs.mkdirSync(empty);
    assert.equal(detectEngineDetails(empty).engine, null);

    const gom = path.join(root, 'gom');
    touch(path.join(gom, 'Mir200', 'M2Server.exe'));
    touch(path.join(gom, 'GameOfMir引擎控制器.exe'));
    assert.equal(detectEngineDetails(gom).engine, 'GOM');

    const gee = path.join(root, 'gee');
    touch(path.join(gee, 'Mir200', 'M2Server.exe'));
    touch(path.join(gee, 'Mir200', 'server.dll'));
    touch(path.join(gee, 'Mir200', '系统插件.ini'));
    assert.equal(detectEngineDetails(gee).engine, 'GEE');

    const pc996 = path.join(root, '996pc');
    touch(path.join(pc996, 'Mir200', 'M2Server.exe'));
    fs.mkdirSync(path.join(pc996, 'Mir200'), { recursive: true });
    fs.writeFileSync(
      path.join(pc996, 'Mir200', 'Setup.json'),
      JSON.stringify({ 'M2DB-Config': {} })
    );
    for (const table of ['cfg_item.xls', 'cfg_monster.xls', 'cfg_magic.xls']) {
      touch(path.join(pc996, '表格', table));
    }
    assert.equal(detectEngineDetails(pc996).engine, '996PC');
    assert.equal(detectEngineDetails(path.join(pc996, 'Mir200')).engine, '996PC');

    const pc996Outer = path.join(root, '996pc-outer');
    const pc996Server = path.join(pc996Outer, 'Mirserver');
    touch(path.join(pc996Server, 'Mir200', 'M2Server.exe'));
    fs.writeFileSync(
      path.join(pc996Server, 'Mir200', 'Setup.json'),
      JSON.stringify({ 'M2DB-Config': {} })
    );
    for (const table of ['cfg_item.xls', 'cfg_monster.xls', 'cfg_magic.xls']) {
      touch(path.join(pc996Server, 'Mir200', 'Envir', 'Data', table));
    }
    assert.equal(
      detectEngineDetails(pc996Outer).engine,
      '996PC',
      'outer folder containing Mirserver must resolve to the deployed server root'
    );

    const gameCenterOnly = path.join(root, 'game-center-only');
    touch(path.join(gameCenterOnly, 'Mir200', 'M2Server.exe'));
    touch(path.join(gameCenterOnly, 'GameCenter.exe'));
    assert.equal(
      detectEngineDetails(gameCenterOnly).engine,
      null,
      'GameCenter.exe is shared and must not identify GEE'
    );

    const ambiguous = path.join(root, 'ambiguous');
    touch(path.join(ambiguous, 'Mir200', 'M2Server.exe'));
    touch(path.join(ambiguous, 'GameOfMir登录器生成器.exe'));
    touch(path.join(ambiguous, 'Mir200', 'server.dll'));
    assert.equal(detectEngineDetails(ambiguous).engine, null);
  } finally {
    const resolvedRoot = path.resolve(root);
    if (resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolvedRoot, { recursive: true, force: true });
    }
  }
  console.log('engine-detect.test.js: PASS');
}

main();
