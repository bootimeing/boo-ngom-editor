const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function main() {
  const {
    collectCandidateUsage,
    createCandidateUsage,
    mergeCandidateUsage,
    unusedPersonalFlagCandidates,
    unusedVariableCandidates,
  } = require('../out/utils/variable-candidates');

  const direct = collectCandidateUsage([
    'mov u3 1',
    'inc T499 1',
    'equal A470 0',
    'mov G499 1',
    '; mov U4 1',
    '// set [9] 1',
    'set [1,3-4] 1',
    'reset [10] 3',
  ].join('\n'));
  assert.deepEqual([...direct.variables.U], [3]);
  assert.deepEqual([...direct.variables.T], [499]);
  assert.deepEqual([...direct.variables.A], [470]);
  assert.deepEqual([...direct.variables.G], [499]);
  assert.deepEqual([...direct.personalFlags].sort((a, b) => a - b), [1, 3, 4, 10, 11, 12]);
  assert.equal(unusedVariableCandidates('U', direct).includes(3), false);
  assert.equal(unusedVariableCandidates('U', direct).includes(4), true);
  assert.equal(unusedPersonalFlagCandidates(direct).includes(10), false);
  assert.equal(unusedPersonalFlagCandidates(direct).includes(9), true);
  assert.equal(unusedVariableCandidates('A', direct).at(-1), 499);
  assert.equal(unusedVariableCandidates('G', direct).includes(499), false);

  const nested = collectCandidateUsage([
    'mov N$编号 151',
    'mov U<$STR(N$编号)> 1',
    'set [<$STR(N$编号)>] 1',
  ].join('\n'));
  assert.equal(nested.variables.U.has(151), true);
  assert.equal(nested.personalFlags.has(151), true);

  const unresolved = collectCandidateUsage([
    'mov U3 1',
    'mov U<$STR(N$运行时下标)> 1',
    'set [3] 1',
    'set [<$STR(N$运行时标识)>] 1',
  ].join('\n'));
  assert.equal(unresolved.uncertainVariableFamilies.has('U'), true);
  assert.equal(unresolved.personalFlagsUncertain, true);
  const unresolvedUCandidates = unusedVariableCandidates('U', unresolved);
  assert.deepEqual(unresolvedUCandidates.slice(0, 5), [0, 1, 2, 4, 5]);
  assert.equal(unresolvedUCandidates.includes(3), false);
  assert.equal(unresolvedUCandidates.at(-1), 499);
  const unresolvedFlagCandidates = unusedPersonalFlagCandidates(unresolved);
  assert.deepEqual(unresolvedFlagCandidates.slice(0, 5), [1, 2, 4, 5, 6]);
  assert.equal(unresolvedFlagCandidates.includes(3), false);
  assert.equal(unresolvedFlagCandidates.at(-1), 1024);
  assert.equal(unusedVariableCandidates('T', unresolved).includes(0), true);

  const crlfText = '; mov U1 1\r\nMAP U2\r\nmov U3 1';
  const excludedStart = crlfText.indexOf('U2');
  const crlf = collectCandidateUsage(crlfText, {
    excludedRanges: [{ start: excludedStart, end: excludedStart + 2 }],
  });
  assert.deepEqual([...crlf.variables.U], [3]);

  const merged = mergeCandidateUsage(createCandidateUsage(), direct);
  mergeCandidateUsage(merged, nested);
  assert.equal(merged.variables.U.has(3), true);
  assert.equal(merged.variables.U.has(151), true);
  assert.equal(merged.personalFlags.has(151), true);

  const assistant = fs.readFileSync(path.join(__dirname, '..', 'src', 'assistant.ts'), 'utf8');
  assert.match(assistant, /CompletionItem\('候选变量'/);
  assert.match(assistant, /CompletionItem\('候选标识'/);
  assert.match(assistant, /command: 'boo\.pickUnusedScriptCandidate'/);
  assert.doesNotMatch(assistant, /无法静态确定编号的 \$\{family\} 类动态变量/);
  assert.doesNotMatch(assistant, /动态个人标识，暂不提供候选/);
  assert.doesNotMatch(assistant, /usage\.personalFlagsUncertain/);
  assert.match(assistant, /选择当前统计中未使用的个人标识/);
  assert.match(assistant, /candidateUsageGeneration/);

  console.log('variable-candidates.test.js: PASS');
}

main();
