const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function main() {
  const {
    buildReloadPathCommand,
    findM2PathFromLocation,
  } = require('../out/utils/m2-target');
  const {
    getReloadOptions,
    normalizeReloadSelection,
  } = require('../out/utils/reload-options');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-m2-target-'));
  try {
    const m2Path = path.join(root, 'Mir200', 'M2Server.exe');
    const scriptPath = path.join(root, 'Mir200', 'Envir', 'Market_Def', 'test.txt');
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(m2Path, '');
    fs.writeFileSync(scriptPath, '');

    assert.equal(findM2PathFromLocation(scriptPath), m2Path);
    assert.equal(findM2PathFromLocation(path.dirname(scriptPath)), m2Path);
    assert.equal(findM2PathFromLocation(path.join(root, 'missing.txt')), m2Path);
    assert.equal(findM2PathFromLocation(os.tmpdir()), null);
    assert.equal(
      buildReloadPathCommand(m2Path, ['所有NPC']),
      `reloadpath:${m2Path}|所有NPC`
    );
    assert.match(
      buildReloadPathCommand(`${root}|bad`, ['所有NPC']),
      /^ERR:/
    );
    assert.equal(
      getReloadOptions('GOM').find(option => option.label === '所有NPC').id,
      17
    );
    assert.equal(
      getReloadOptions('GEE').find(option => option.label === '所有NPC').id,
      20
    );
    assert.equal(
      getReloadOptions('996PC').find(option => option.label === '所有NPC').id,
      23
    );
    assert.deepEqual(normalizeReloadSelection([16]).items, ['所有NPC']);
    assert.deepEqual(normalizeReloadSelection(['16']).items, ['所有NPC']);
    assert.deepEqual(
      normalizeReloadSelection(['QFunction 功能脚本', 16, 'QFunction 功能脚本']).items,
      ['QFunction 功能脚本']
    );
    assert.deepEqual(
      normalizeReloadSelection(['所有NPC', '怪物爆率']).items,
      ['所有NPC', '怪物爆率']
    );

    const nativeSource = fs.readFileSync(
      path.join(__dirname, '..', 'tools', 'M2Reloader', 'native', 'M2Reloader.cpp'),
      'utf8'
    );
    assert.match(nativeSource, /QueryFullProcessImageNameW/);
    assert.match(nativeSource, /scanpath:/);
    assert.match(nativeSource, /reloadpath:/);
    assert.match(nativeSource, /OK_PID=/);
  } finally {
    const resolvedRoot = path.resolve(root);
    if (resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolvedRoot, { recursive: true, force: true });
    }
  }
  console.log('m2-target.test.js: PASS');
}

main();
