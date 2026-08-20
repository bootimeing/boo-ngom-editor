const assert = require('node:assert/strict');

function flagsAt(analysis, line) {
  const reference = analysis.personalFlags.find(item => item.line === line - 1);
  assert.ok(reference, `missing personal flag reference at line ${line}`);
  return reference;
}

function main() {
  const { analyzeNestedVariables } = require('../out/utils/nested-variable-analysis');

  const direct = analyzeNestedVariables([
    'mov N$击杀标识 203',
    'check [<$str(N$击杀标识)>] 0',
    'set [<$STR(N$击杀标识)>] 1',
  ].join('\n'));
  assert.deepEqual(flagsAt(direct, 2).flags, ['[203]']);
  assert.equal(flagsAt(direct, 2).status, 'resolved');
  assert.deepEqual(flagsAt(direct, 3).flags, ['[203]']);

  const batch = analyzeNestedVariables([
    'mov N$追加标识 8',
    'set [1,2,4-6,<$STR(N$追加标识)>,1024] 1',
    'check [0,1025] 1',
  ].join('\n'));
  assert.deepEqual(flagsAt(batch, 2).flags, [
    '[1]', '[2]', '[4]', '[5]', '[6]', '[8]', '[1024]',
  ]);
  assert.deepEqual(flagsAt(batch, 3).flags, []);

  const reset = analyzeNestedVariables([
    'reset [100] 7',
    'mov N$起始标识 1020',
    'mov N$标识数量 5',
    'reset [<$STR(N$起始标识)>] <$STR(N$标识数量)> 1',
  ].join('\n'));
  assert.deepEqual(flagsAt(reset, 1).flags, [
    '[100]', '[101]', '[102]', '[103]', '[104]', '[105]', '[106]',
  ]);
  assert.deepEqual(flagsAt(reset, 4).flags, [
    '[1020]', '[1021]', '[1022]', '[1023]', '[1024]',
  ]);

  const eventParameter = analyzeNestedVariables([
    '<开关标识1/@开关标识(1)>',
    '<开关标识100/@开关标识(100)>',
    '[@开关标识]',
    'check [<$SCRIPTPARAM1>] 0',
    'set [<$SCRIPTPARAM1>] 1',
  ].join('\n'));
  assert.deepEqual(flagsAt(eventParameter, 4).flags, ['[1]', '[100]']);
  assert.equal(flagsAt(eventParameter, 4).status, 'resolved');

  const unresolved = analyzeNestedVariables('check [<$STR(N$运行时标识)>] 1');
  assert.deepEqual(flagsAt(unresolved, 1).flags, []);
  assert.equal(flagsAt(unresolved, 1).status, 'unresolved');

  const listDriven = analyzeNestedVariables([
    'GetListString ..\\QuestDiary\\个人首爆数据.txt N0 <$STR(S$个人首爆数据)>',
    'extractstring | <$str(S$个人首爆数据)> S$装备 N$个人首爆标识',
    'check [<$str(N$个人首爆标识)>] 0',
  ].join('\n'), {
    resolveListData(request) {
      assert.equal(request.path, '..\\QuestDiary\\个人首爆数据.txt');
      return { lines: ['神剑|401', '神甲|402'], complete: true };
    },
  });
  assert.deepEqual(flagsAt(listDriven, 3).flags, ['[401]', '[402]']);
  assert.equal(flagsAt(listDriven, 3).status, 'partial');

  const keyedList = analyzeNestedVariables([
    'GetListString ..\\QuestDiary\\标识数据.txt 1 S$名称 N$列表标识',
    'set [<$STR(N$列表标识)>] 1',
  ].join('\n'), {
    resolveListData() {
      return { lines: ['神剑:601', '神甲:602'], complete: true };
    },
  });
  assert.deepEqual(flagsAt(keyedList, 2).flags, ['[602]']);
  assert.equal(flagsAt(keyedList, 2).status, 'resolved');

  const dynamicTarget = analyzeNestedVariables([
    'readconfigfileitem ..\\QuestDiary\\藏宝阁.ini <$str(S$类别)> <$str(N$页)> <$STR(S$数据)>',
    'extractstring | <$str(S$数据)> S$名称 N$来源标识',
    'mov N$数量 1',
    'inc N$数量 1',
    'mov N$藏宝阁标识<$str(N$数量)> <$str(N$来源标识)>',
    'check [<$str(N$藏宝阁标识1)>] 0',
    'check [<$str(N$藏宝阁标识2)>] 0',
  ].join('\n'), {
    resolveConfigValues() {
      return { values: ['神剑|501', '神甲|502'], complete: true };
    },
  });
  assert.deepEqual(flagsAt(dynamicTarget, 6).flags, ['[501]', '[502]']);
  assert.deepEqual(flagsAt(dynamicTarget, 7).flags, ['[501]', '[502]']);
  assert.equal(flagsAt(dynamicTarget, 6).status, 'partial');

  console.log('personal-flag-analysis.test.js: PASS');
}

main();
