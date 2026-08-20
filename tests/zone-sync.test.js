const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const {
    collectZoneSyncInventory,
    executeZoneSync,
    validateZoneSyncTargets,
    ZoneSyncCancelledError,
  } = require('../out/utils/zone-sync');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-zone-sync-'));
  try {
    const workspace = path.join(root, '一区');
    const zone2 = path.join(root, '二区');
    const zone3 = path.join(root, '三区');
    const envir = path.join(workspace, 'Mir200', 'Envir');
    const nested = path.join(envir, '子目录');
    const empty = path.join(envir, '空目录');
    const scriptA = path.join(envir, '功能A.txt');
    const scriptB = path.join(nested, '功能B.txt');
    const rootFile = path.join(workspace, '说明.txt');
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(empty, { recursive: true });
    fs.writeFileSync(scriptA, 'A-v1');
    fs.writeFileSync(scriptB, 'B-v1');
    fs.writeFileSync(rootFile, 'ROOT-v1');

    const inventory = await collectZoneSyncInventory(
      workspace,
      [envir, scriptB, rootFile]
    );
    assert.deepEqual(
      new Set(inventory.files.map(file => file.relativePath)),
      new Set(
      [
        path.join('Mir200', 'Envir', '功能A.txt'),
        path.join('Mir200', 'Envir', '子目录', '功能B.txt'),
        '说明.txt',
      ]),
      'selecting a parent folder and one nested file must not duplicate the nested file'
    );
    assert.deepEqual(
      new Set(inventory.directories),
      new Set(
      [
        path.join('Mir200', 'Envir'),
        path.join('Mir200', 'Envir', '子目录'),
        path.join('Mir200', 'Envir', '空目录'),
      ]),
      'recursive inventory must preserve nested and empty directories'
    );

    const existingTarget = path.join(zone2, 'Mir200', 'Envir', '功能A.txt');
    fs.mkdirSync(path.dirname(existingTarget), { recursive: true });
    fs.writeFileSync(existingTarget, 'old-target');
    const progress = [];
    const first = await executeZoneSync(inventory, [zone2, zone3], {
      onProgress: state => progress.push([state.completed, state.total]),
    });
    assert.equal(first.cancelled, false);
    assert.equal(first.copiedFiles, 6);
    assert.equal(first.overwrittenFiles, 1);
    assert.equal(first.createdFiles, 5);
    assert.equal(first.failures.length, 0);
    assert.deepEqual(progress.at(-1), [6, 6]);
    for (const target of [zone2, zone3]) {
      assert.equal(
        fs.readFileSync(path.join(target, 'Mir200', 'Envir', '功能A.txt'), 'utf8'),
        'A-v1'
      );
      assert.equal(
        fs.readFileSync(path.join(target, 'Mir200', 'Envir', '子目录', '功能B.txt'), 'utf8'),
        'B-v1'
      );
      assert.equal(fs.readFileSync(path.join(target, '说明.txt'), 'utf8'), 'ROOT-v1');
      assert.equal(fs.statSync(path.join(target, 'Mir200', 'Envir', '空目录')).isDirectory(), true);
    }

    fs.writeFileSync(scriptA, 'A-v2');
    const second = await executeZoneSync(inventory, [zone2]);
    assert.equal(second.overwrittenFiles, 3);
    assert.equal(second.createdFiles, 0);
    assert.equal(fs.readFileSync(existingTarget, 'utf8'), 'A-v2');

    assert.throws(
      () => validateZoneSyncTargets(workspace, [workspace]),
      /不能与当前工作区重叠/
    );
    assert.throws(
      () => validateZoneSyncTargets(workspace, [path.join(workspace, '同步目标')]),
      /不能与当前工作区重叠/
    );
    assert.throws(
      () => validateZoneSyncTargets(workspace, [root]),
      /不能与当前工作区重叠/
    );
    assert.throws(
      () => validateZoneSyncTargets(workspace, [zone2, path.join(zone2, '嵌套目标')]),
      /目标区目录不能互相包含/
    );
    await assert.rejects(
      collectZoneSyncInventory(workspace, [zone2]),
      /不在当前工作区根目录内/
    );
    await assert.rejects(
      collectZoneSyncInventory(workspace, [rootFile], { isCancelled: () => true }),
      error => error instanceof ZoneSyncCancelledError
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('zone-sync.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
