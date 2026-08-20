const assert = require('node:assert/strict');

function main() {
  const {
    compactVariableTypeLabel,
    formatVariableGroupLabel,
    normalizeScriptVariableName,
    recordVariableUsage,
  } = require('../out/utils/variable-statistics');

  assert.equal(normalizeScriptVariableName('u3'), 'U3');
  assert.equal(normalizeScriptVariableName('n$Score'), 'N$Score');
  assert.notEqual(
    normalizeScriptVariableName('N$Score'),
    normalizeScriptVariableName('N$score'),
  );
  assert.equal(normalizeScriptVariableName('[u3]'), '[U3]');

  const usages = new Map();
  recordVariableUsage(usages, 'U3', 'RobotManage.txt', () => ({
    count: 0,
    files: new Set(),
  }));
  recordVariableUsage(usages, 'u3', 'AutoRunRobot.txt', () => ({
    count: 0,
    files: new Set(),
  }));
  recordVariableUsage(usages, 'U3', 'RobotManage.txt', () => ({
    count: 0,
    files: new Set(),
  }));

  assert.equal(usages.size, 1);
  assert.equal(usages.has('U3'), true);
  assert.equal(usages.get('U3').count, 3);
  assert.deepEqual([...usages.get('U3').files].sort(), [
    'AutoRunRobot.txt',
    'RobotManage.txt',
  ]);

  const customUsages = new Map();
  for (const name of ['N$Score', 'n$Score', 'N$score']) {
    recordVariableUsage(customUsages, name, 'case-sensitive.txt', () => ({
      count: 0,
      files: new Set(),
    }));
  }
  assert.equal(customUsages.size, 2);
  assert.equal(customUsages.get('N$Score').count, 2);
  assert.equal(customUsages.get('N$score').count, 1);

  assert.equal(compactVariableTypeLabel('A5'), 'A');
  assert.equal(compactVariableTypeLabel('g16'), 'G');
  assert.equal(compactVariableTypeLabel('N$Score'), 'N$');
  assert.equal(compactVariableTypeLabel('GL$List'), 'GL$');
  assert.equal(formatVariableGroupLabel('A', 5), 'A(5个)');
  assert.equal(
    formatVariableGroupLabel('嵌套变量（部分推导）', 2),
    '嵌套变量（部分推导）(2个)'
  );

  console.log('variable-statistics.test.js: PASS');
}

main();
