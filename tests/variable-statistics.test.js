const assert = require('node:assert/strict');

function main() {
  const {
    compactVariableTypeLabel,
    formatVariableGroupLabel,
    normalizeScriptVariableName,
    recordVariableUsage,
    findSemanticScriptVariables,
  } = require('../out/utils/variable-statistics');

  assert.equal(normalizeScriptVariableName('u3'), 'U3');
  assert.equal(normalizeScriptVariableName('u003'), 'U3');
  assert.equal(normalizeScriptVariableName('G000'), 'G0');
  assert.equal(normalizeScriptVariableName('n$Score'), 'N$Score');
  assert.notEqual(
    normalizeScriptVariableName('N$Score'),
    normalizeScriptVariableName('N$score'),
  );
  assert.equal(normalizeScriptVariableName('[u3]'), '[U3]');
  assert.equal(normalizeScriptVariableName('human(Score)'), 'HUMAN(Score)');
  assert.equal(normalizeScriptVariableName('guild(同名)'), 'GUILD(同名)');
  assert.notEqual(normalizeScriptVariableName('HUMAN(Score)'), normalizeScriptVariableName('GUILD(Score)'));
  assert.notEqual(normalizeScriptVariableName('HUMAN(Score)'), normalizeScriptVariableName('HUMAN(score)'));

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
  assert.equal(compactVariableTypeLabel('HUMAN(QQQQ)'), 'HUMAN命名变量');
  assert.equal(compactVariableTypeLabel('GUILD(变量测试)'), 'GUILD命名变量');
  const semanticNames = (text, engine = 'GOM', allowCommands = true) => findSemanticScriptVariables(text, engine, allowCommands).references.map(item => item.name);
  assert.deepEqual(semanticNames('VAR INTEGER HUMAN QQQQ'), ['HUMAN(QQQQ)']);
  assert.deepEqual(semanticNames('CALCVAR HUMAN QQQQ + 5'), ['HUMAN(QQQQ)']);
  assert.deepEqual(semanticNames('LOADVAR HUMAN QQQQ VARSAVE.TXT'), ['HUMAN(QQQQ)']);
  assert.deepEqual(semanticNames('SAVEVAR HUMAN QQQQ VARSAVE.TXT'), ['HUMAN(QQQQ)']);
  assert.deepEqual(semanticNames('VAR INTEGER GUILD QQQQ'), ['GUILD(QQQQ)']);
  assert.deepEqual(semanticNames('VAR INTEGER GUILD QQQQ', 'GEE'), ['GUILD(QQQQ)']);
  assert.deepEqual(semanticNames('SAVEVAR GUILD QQQQ guild.txt', 'GEE'), ['GUILD(QQQQ)']);
  assert.deepEqual(semanticNames('LOADVAR GUILD QQQQ guild.txt', 'GEE'), [], 'LOADVAR GUILD lacks own-command evidence');
  assert.deepEqual(semanticNames('SENDMSG 6 <$HUMAN(QQQQ)> <$GUILD(QQQQ)>', 'GEE'), ['HUMAN(QQQQ)', 'GUILD(QQQQ)']);
  assert.deepEqual(semanticNames('VAR INTEGER HUMAN QQQQ', '996PC'), []);
  assert.deepEqual(semanticNames('SENDMSG 6 <$HUMAN(QQQQ)>', '996PC'), []);
  assert.deepEqual(semanticNames('; VAR INTEGER HUMAN QQQQ'), []);
  assert.deepEqual(semanticNames('VAR INTEGER HUMAN QQQQ', 'GOM', false), []);
  assert.deepEqual(semanticNames('VAR INTEGER HUMAN <$STR(S1)>'), [], 'dynamic names must not be guessed');
  assert.deepEqual(semanticNames('CLEARVAR S0 5'), ['S0', 'S1', 'S2', 'S3', 'S4']);
  assert.deepEqual(semanticNames('#ACT CLEARVAR S003 2', 'GEE'), ['S3', 'S4']);
  assert.deepEqual(semanticNames('CLEARVAR U0 5'), [], 'S evidence does not prove U ranges');
  assert.deepEqual(semanticNames('CLEARVAR S0 5', '996PC'), []);
  assert.deepEqual(semanticNames('CLEARVAR S0 <$STR(N$count)>'), []);
  assert.deepEqual(semanticNames('CLEARVAR S0 100000000000'), [], 'malformed ranges cannot allocate unbounded arrays');
  assert.equal(formatVariableGroupLabel('A', 5), 'A(5个)');
  assert.equal(
    formatVariableGroupLabel('嵌套变量（部分推导）', 2),
    '嵌套变量（部分推导）(2个)'
  );

  console.log('variable-statistics.test.js: PASS');
}

main();
