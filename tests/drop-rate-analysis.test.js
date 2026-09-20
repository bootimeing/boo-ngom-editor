const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { analyzeDropRates, dropAnalysisMarkdown } = require(path.join(runtime, 'out/utils/drop-rate-analysis'));
const child = (header, body) => `${header}\n(\n${body}\n)`;
for (const engine of ['GOM', 'GEE', '996PC']) {
  let result = analyzeDropRates('1/10 木剑\n1/2 金币 10000', engine);
  assert.deepEqual(result.rows.map(r => r.baselineFraction), ['1/10', '1/2']);
  assert.equal(result.rows[1].quantity, '10000');
  result = analyzeDropRates(child('#CHILD 1/5 RANDOM', '1/2 木剑\n1/4 铁剑'), engine);
  assert.deepEqual(result.rows.map(r => r.baselineFraction), engine === 'GEE' ? ['1/20', '1/40'] : ['1/10', '1/10']);
  result = analyzeDropRates(child('#CHILD 1/2', child('#CHILD 1/3', '1/5 木剑')), engine);
  assert.equal(result.rows[0].baselineFraction, '1/30');
  result = analyzeDropRates(child('#CHILD 1/2 RANDOM', child('#CHILD 1/100', '1/5 木剑')), engine);
  assert.equal(result.rows[0].baselineFraction, undefined, 'GXX nested RANDOM semantics must not leak into engine profiles');
  assert.ok(result.rows[0].unknownReasons.some(s => s.includes('内嵌分组')));
  result = analyzeDropRates(child('#CHILD 1/2 RANDOM', '1/1 木剑\n#CALL [x.txt] @drop'), engine);
  assert.equal(result.rows[0].baselineFraction, undefined, 'external expansion changes random candidate count');
  assert.ok(result.warnings.some(w => w.message.includes('CALL')));
  result = analyzeDropRates('#CHILD 1/2\n(\n1/1 木剑', engine);
  assert.equal(result.rows[0].baselineFraction, undefined, 'unclosed tree fails closed');
  result = analyzeDropRates('1/0 木剑\n2/1 铁剑\n1/U1 药水', engine);
  assert.ok(result.rows.every(r => r.baselineFraction === undefined));
  result = analyzeDropRates('1/10 木剑|@check\n1/3 S10', engine);
  assert.ok(result.rows.every(r => r.runtimeReasons.length > 0));
  assert.equal(result.rows[0].item, '木剑');
  assert.equal(result.rows[0].trigger, '@check');
  assert.equal(result.rows[0].baselineFraction, '1/10', 'candidate chance is not final ALLOWDROP probability');
  assert.equal(result.totalProbability, undefined, 'never add correlated lines into a fake total chance');
  assert.equal(analyzeDropRates('1/2 S10剑', engine).rows[0].runtimeReasons.length, 0);
  assert.equal(analyzeDropRates('1/2 木剑|@a|@b', engine).rows[0].baselineFraction, undefined);
  assert.ok(!dropAnalysisMarkdown(analyzeDropRates('1/1 <script>|[x](command:bad)', engine)).includes('<script>'));
}
for (const engine of ['GOM', '996PC']) {
  const result = analyzeDropRates(
    '#CASE N10|1 RANDOM\n100\n(\n1/1 太阳水\n1/1 木剑\n)\n',
    engine
  );
  assert.equal(result.groups[0].caseVariable, 'N10');
  assert.equal(result.groups[0].caseValue, '100');
  assert.equal(result.groups[0].caseClearVariables, true);
  assert.equal(result.groups[0].random, true);
  assert.deepEqual(result.rows.map(row => row.baselineFraction), [undefined, undefined],
    'CASE depends on a runtime variable and must not invent a final chance');
  assert.ok(result.rows.every(row => row.runtimeReasons.some(reason => reason.includes('CASE N10=100'))));
  assert.ok(!result.warnings.some(warning => warning.message.includes('未支持的爆率行')));
}

// GOM/996PC CASE blocks use one header followed by multiple sibling value
// branches.  Every branch is runtime-gated; the analyzer must retain all
// items without manufacturing a final probability for any branch.
for (const engine of ['GOM', '996PC']) {
  const result = analyzeDropRates(
    '#CASE N10|1 RANDOM\n100\n(\n1/1 太阳水\n)\n101\n(\n1/2 回城卷\n)\n102\n(\n1/1 强效太阳水\n)\n',
    engine
  );
  assert.deepEqual(result.rows.map(row => row.item), ['太阳水', '回城卷', '强效太阳水']);
  assert.deepEqual(result.groups.map(group => group.caseValue), ['100', '101', '102']);
  assert.ok(result.rows.every(row => row.baselineFraction === undefined));
  assert.ok(result.rows.every(row => row.runtimeReasons.some(reason => reason.includes('CASE N10='))));
  assert.ok(!result.warnings.some(warning => warning.message.includes('未支持的爆率行')));
}

// CASE can nest inside a branch and the outer CASE must still accept its next
// sibling after the nested block closes.
for (const engine of ['GOM', '996PC']) {
  const result = analyzeDropRates(
    '#CASE N1\n1\n(\n#CASE N2\n2\n(\n1/1 内层二\n)\n3\n(\n1/1 内层三\n)\n)\n2\n(\n1/1 外层二\n)\n',
    engine
  );
  assert.deepEqual(result.rows.map(row => row.item), ['内层二', '内层三', '外层二']);
  assert.deepEqual(result.groups.map(group => `${group.caseVariable}=${group.caseValue}`), ['N1=1', 'N2=2', 'N2=3', 'N1=2']);
  assert.ok(result.rows.every(row => row.baselineFraction === undefined));
  assert.equal(result.warnings.length, 0);
}

// A malformed branch value must not swallow the following command.  Keep the
// valid CHILD visible, but fail closed for numeric probability calculations.
for (const engine of ['GOM', '996PC']) {
  const result = analyzeDropRates('#CASE N1\nnot-a-branch\n#CHILD 1/1\n(\n1/1 回退物品\n)\n', engine);
  assert.deepEqual(result.rows.map(row => row.item), ['回退物品']);
  assert.equal(result.rows[0].baselineFraction, undefined);
  assert.ok(result.warnings.some(warning => warning.message.includes('分支值不是已确认的整数')));
}

// Missing CASE values must recover without consuming the following structural
// line.  Each malformed form still leaves subsequent items/labels visible and
// marks the document as non-numeric.
for (const engine of ['GOM', '996PC']) {
  const malformedFollowups = [
    '#CASE N1\n(\n1/1 直接物品\n)\n1/1 后续物品\n',
    '#CASE N1\n#CHILD 1/1\n(\n1/1 子物品\n)\n',
    '#CASE N1\n[@后续标签]\n1/1 标签物品\n',
    '#CASE N1\n)\n1/1 右括号后物品\n',
  ];
  const expected = ['后续物品', '子物品', '标签物品', '右括号后物品'];
  malformedFollowups.forEach((source, index) => {
    const result = analyzeDropRates(source, engine);
    assert.ok(result.rows.some(row => row.item === expected[index]), `recovered item ${expected[index]}`);
    assert.ok(result.warnings.some(warning => warning.message.includes('CASE')));
    assert.ok(result.rows.every(row => row.baselineFraction === undefined));
  });
}

// The standalone RANDOM token is only a legacy CHILD form.  It must not be
// attached to an #IF block by broad token matching.
const ifStandaloneRandom = analyzeDropRates('#IF [N20>1]\nRANDOM\n(\n1/1 不应静默随机\n)\n', 'GOM');
assert.ok(ifStandaloneRandom.warnings.some(warning => warning.message.includes('RANDOM')));
assert.equal(ifStandaloneRandom.rows[0].baselineFraction, undefined);

// 996PC/GOM manuals also show the legacy split RANDOM token between a CHILD
// header and its opening parenthesis.  LFM only documents the one-line form;
// it must remain fail-closed instead of borrowing this cross-engine syntax.
for (const engine of ['GOM', '996PC']) {
  const result = analyzeDropRates('#CHILD 1/2\nRANDOM // legacy form\n(\n1/1 木剑\n1/2 铁剑\n)\n', engine);
  assert.deepEqual(result.rows.map(row => row.baselineFraction), ['1/4', '1/4']);
  assert.equal(result.groups[0].random, true);
  assert.equal(result.warnings.length, 0);
}
const geeLegacyRandom = analyzeDropRates('#CHILD 1/2\nRANDOM\n(\n1/1 木剑\n1/2 铁剑\n)\n', 'GEE');
assert.ok(geeLegacyRandom.warnings.some(warning => warning.message.includes('RANDOM')));
assert.ok(geeLegacyRandom.rows.every(row => row.baselineFraction === undefined));

const geeCase = analyzeDropRates('#CASE N10|1 RANDOM\n100\n(\n1/1 太阳水\n)\n', 'GEE');
assert.equal(geeCase.rows[0].baselineFraction, undefined);
assert.ok(geeCase.warnings.some(warning => warning.message.includes('翎风未证实')));
const lfm = analyzeDropRates(child('#CHILD 1/2 RANDOM [U57>100;U57<200|OR,3,@check]', '1/2 木剑\n1/1 铁剑'), 'GEE');
assert.equal(lfm.groups[0].inheritanceMask, 3);
assert.equal(lfm.groups[0].conditionMode, 'or');
assert.equal(lfm.groups[0].clearVariables, undefined);
assert.deepEqual(lfm.rows.map(r => r.baselineFraction), ['1/8', '1/4']);
assert.ok(lfm.rows[0].runtimeReasons.some(s => s.includes('触发')));
for (const engine of ['GOM', '996PC']) {
  assert.equal(analyzeDropRates(child('#IF [N20 >>> 10]', '1/1 木剑'), engine).rows[0].baselineFraction, undefined);
  const result = analyzeDropRates(child('#IF [N20>100,N20<110|1] RANDOM', '1/10 木剑\n1/3 铁剑'), engine);
  assert.equal(result.groups[0].clearVariables, true);
  assert.equal(result.groups[0].inheritanceMask, undefined);
  assert.deepEqual(result.rows.map(r => r.baselineFraction), ['1/2', '1/2']);
  assert.equal(analyzeDropRates(child('#CHILD 1/1 [U57>100;U57<200,0]', '1/1 木剑'), engine).rows[0].baselineFraction, undefined);
}
assert.equal(analyzeDropRates(child('#IF [N20>100]', '1/1 木剑'), 'GEE').rows[0].baselineFraction, undefined);
assert.equal(analyzeDropRates(child('#CHILD 1/1 BURSTRATE', '1/2 木剑'), 'GEE').groups[0].ignoresMultiplier, true);
assert.equal(analyzeDropRates(child('#CHILD 1/1 BURSTRATE', '1/2 木剑'), '996PC').rows[0].baselineFraction, undefined);
assert.throws(() => analyzeDropRates('1/1 木剑', 'unknown'), /引擎/);
assert.throws(() => analyzeDropRates('x'.repeat(1_000_001), 'GEE'), /上限/);
const deep = '#CHILD 1/1\n(\n'.repeat(40) + '1/1 木剑\n' + ')\n'.repeat(40);
assert.throws(() => analyzeDropRates(deep, 'GEE'), /层/);
console.log('drop-rate-analysis.test.js: PASS three-engine RANDOM isolation, nested gates, conditions, inheritance/clear, triggers, bounds, unresolved external blocks and no fake total');
