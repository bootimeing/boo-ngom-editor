const assert = require('node:assert/strict');
const {
  collectCandidates,
  commandToken,
  coverageDisposition,
  coveredByKnownCommand,
} = require('../tools/data-maintenance/audit-help-command-coverage');

function page(relativePath, title, lines) {
  return { relativePath, title, lines };
}

function main() {
  assert.equal(commandToken('ChangeHumNewValue 0 10 100'), 'CHANGEHUMNEWVALUE');
  assert.equal(commandToken('RunGate.exe'), '');
  assert.equal(commandToken('FILEINDEX=13'), '');
  assert.equal(commandToken('NPC'), '');
  const known = { commandByName: new Map([['GIVE', {}], ['SENDMSG', {}]]) };
  assert.equal(coveredByKnownCommand('H.GIVE', known), true);
  assert.equal(coveredByKnownCommand('SENDMSG6', known), true);
  assert.equal(coveredByKnownCommand('CHANGEHUMNEWVALUE', known), false);
  assert.deepEqual(coverageDisposition('GIVE', known), { kind: 'exact', command: 'GIVE' });
  assert.deepEqual(
    coverageDisposition('H.GIVE', known),
    { kind: 'target-prefix', command: 'GIVE' }
  );
  assert.deepEqual(
    coverageDisposition('SENDMSG6', known),
    { kind: 'joined-number', command: 'SENDMSG' }
  );

  const candidates = collectCandidates({
    pages: [
      page('游戏引擎反外挂系统/功能操作命令/调整人物属性.html', '调整人物属性', [
        '命令一：ChangeHumNewValue',
        '格式：ChangeHumNewValue 属性 属性值 时间',
        '#ACT',
        'ChangeHumNewValue 0 10 100',
        'FILEINDEX=13',
      ]),
      page('更新记录.html', '更新记录', [
        '修复 SomeRandomEnglishToken 功能',
      ]),
    ],
  });

  assert.ok(candidates.has('CHANGEHUMNEWVALUE'));
  assert.equal(candidates.get('CHANGEHUMNEWVALUE').score, 100);
  assert.equal(candidates.has('FILEINDEX'), false);
  assert.equal(candidates.has('SOMERANDOMENGLISHTOKEN'), false);
  console.log('Help command coverage tests passed.');
}

main();
