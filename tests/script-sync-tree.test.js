const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  listScriptSyncDirectory,
  validateScriptSyncSources,
  validateScriptSyncTargets,
} = require('../out/utils/script-sync-tree');

async function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-script-sync-'));
  const root = path.join(sandbox, 'drive');
  const outside = path.join(sandbox, 'outside');
  const areaA = path.join(root, 'MirServer-A');
  const areaB = path.join(root, 'MirServer-B');
  const scriptDir = path.join(areaA, 'Mir200', 'Envir', 'QuestDiary');
  const scriptFile = path.join(scriptDir, '测试脚本.txt');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(areaB, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(scriptFile, '[@main]\r\n', 'utf8');
  fs.writeFileSync(path.join(root, 'not-a-target.txt'), 'x', 'utf8');

  try {
    const sourceEntries = await listScriptSyncDirectory(areaA, areaA, true);
    assert.deepEqual(sourceEntries.map(entry => entry.name), ['Mir200']);
    const scriptEntries = await listScriptSyncDirectory(areaA, scriptDir, true);
    assert.deepEqual(scriptEntries.map(entry => entry.name), ['测试脚本.txt']);
    assert.equal(scriptEntries[0].isDirectory, false);

    const targetEntries = await listScriptSyncDirectory(root, root, false);
    assert.deepEqual(targetEntries.map(entry => entry.name), ['MirServer-A', 'MirServer-B']);
    assert.ok(targetEntries.every(entry => entry.isDirectory));

    const sources = await validateScriptSyncSources(areaA, [scriptFile, scriptDir, scriptFile]);
    assert.deepEqual(sources, [scriptDir, scriptFile].sort((left, right) => left.localeCompare(
      right,
      'zh-CN',
      { numeric: true, sensitivity: 'base' }
    )));
    assert.deepEqual(await validateScriptSyncTargets(root, [areaB, areaB]), [areaB]);

    await assert.rejects(
      validateScriptSyncSources(areaA, [path.join(outside, 'escape.txt')]),
      /路径超出允许范围/
    );
    await assert.rejects(validateScriptSyncTargets(root, [root]), /不能选择根目录/);
    await assert.rejects(
      validateScriptSyncTargets(root, [path.join(root, 'not-a-target.txt')]),
      /路径类型不受支持/
    );

    const linkPath = path.join(root, 'outside-link');
    try {
      fs.symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      const entriesWithLink = await listScriptSyncDirectory(root, root, false);
      assert.ok(!entriesWithLink.some(entry => entry.name === 'outside-link'));
      await assert.rejects(
        listScriptSyncDirectory(root, linkPath, false),
        /跳出了允许范围|不是可读取的文件夹/
      );
    } catch (error) {
      if (!['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error;
    }

    console.log('script-sync-tree.test.js: PASS');
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
