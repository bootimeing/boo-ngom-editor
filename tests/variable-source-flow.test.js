const assert = require('node:assert/strict');
const { analyzeNestedVariables, resolveScriptValueExpressions } = require('../out/utils/nested-variable-analysis');
const { analyzeVariableListFile } = require('../out/utils/variable-list');
const { collectCandidateUsage, unusedVariableCandidates, unusedPersonalFlagCandidates } = require('../out/utils/variable-candidates');

function analyze(lines, options = {}) {
  return analyzeNestedVariables(lines.join('\n'), { engine: 'GOM', ...options });
}
function reference(result, raw, occurrence = 0) {
  const found = result.references.filter(item => item.raw === raw)[occurrence];
  assert.ok(found, `missing ${raw}`);
  return found;
}
const slot = 'U<$STR(N$新变量)>';
{
  const lines = ['MOV N$编号 24', 'MOV U24 9',
    'INC S$组装 <&LAYOUT:#L1~#L<$STR(N$编号)>:1:2:3:4><IMG:#U<$STR(N$编号)>~#U60:1:1:2:3>',
    '#SAY', '<&TEXT:#T99~#L<$STR(U<$STR(N$编号)>)>:U<$STR(N$编号)>:3:4>',
    '<IMG:~#U70:1:1:2:3><NewLine:#U80~>', '<TEXT:普通字段:#U<$STR(N$编号)>~:1>',
    '<TEXT:#U<$STR(N$编号)>:1:2>', '<TEXT:#U<$STR(N$编号)>~坏字段:1:2>'];
  const text = lines.join('\r\n');
  const result = analyzeNestedVariables(text, {engine: 'GOM'});
  assert.deepEqual(result.references.map(ref => ref.line), [4, 4, 6, 7, 8]);
  for (const ref of result.references) assert.deepEqual(ref.variables, ['U24']);
  const list = analyzeVariableListFile(text, 'D:/audit/Envir/Market_Def/ui.txt', {engine: () => 'GOM'});
  assert.deepEqual(list.variables.filter(row => row.line === 2 && row.name === 'N$编号').map(row =>
    text.slice(row.source.start, row.source.end)), ['N$编号', 'N$编号']);
  for (const name of ['T99', 'U60', 'U70', 'U80']) assert.ok(!list.variables.some(row => row.name === name));
  assert.deepEqual([...list.candidates.variables.U], [24]);
  for (const engine of ['GEE', '996PC']) {
    assert.ok(analyzeNestedVariables(lines[2], {engine}).references.some(ref => ref.base === 'U'));
  }
}
{
  const staticRead = 'U<$STR(N$idx1)>', nestedRead = 'U<$STR(N$idx<$STR(N$i)>)>';
  function checkSlot(lines, raw, expected, engine = '996PC') {
    const text = lines.join('\n');
    const ref = reference(analyze(lines, {engine}), raw);
    assert.deepEqual(ref.variables, [expected], raw);
    assert.equal(ref.status, 'resolved');
    const aggregate = analyzeVariableListFile(text, 'D:/audit/Envir/Market_Def/test.txt', {engine: () => engine});
    assert.deepEqual(aggregate.variables.filter(row => row.line === ref.line && row.source?.start === ref.start)
      .map(row => row.name), [expected]);
    assert.ok(!unusedVariableCandidates('U', collectCandidateUsage(text, {engine})).includes(Number(expected.slice(1))));
  }
  const addr = 'N$idx<$STR(N$i)>';
  for (const engine of ['996PC', 'GOM', 'GEE']) {
    checkSlot(['MOV N$idx1 20', 'MOV N$i 1', 'GOTO @helper(|' + addr + ')', 'EQUAL ' + staticRead + ' 0',
      '[@helper]', 'MOV N$i 2', 'RETURN 30'], staticRead, 'U30', engine);
    checkSlot(['MOV N$i 1', 'MOV S$data 30', 'EXTRACTSTRING , <$STR(S$data)> ' + addr,
      'MOV ' + addr + ' 40', 'EQUAL ' + nestedRead + ' 0'], nestedRead, 'U40', engine);
    checkSlot(['MOV N$i 1', 'MOV N$j 1', 'MOV S$data 30', 'EXTRACTSTRING , <$STR(S$data)> ' + addr,
      'MOV N$idx<$STR(N$j)> 40', 'EQUAL ' + nestedRead + ' 0'], nestedRead, 'U40', engine);
    checkSlot(['MOV N$idx1 20', 'MOV N$i 1', 'MOV S$data 30', 'EXTRACTSTRING , <$STR(S$data)> ' + addr,
      'EQUAL ' + staticRead + ' 0'], staticRead, 'U30', engine);
  }
  const runtimeMutation = analyze(['MOV N$i 1', 'MOV S$data 30', 'EXTRACTSTRING , <$STR(S$data)> ' + addr,
    'MOV ' + addr + ' 40', '#CALL [unknown.txt] @change', 'EQUAL ' + nestedRead + ' 0']);
  assert.equal(reference(runtimeMutation, nestedRead).status, 'partial');
  const unknown = analyze(['MOV N$idx1 20', 'GOTO @return(|' + addr + ')', 'EQUAL ' + staticRead + ' 0',
    '[@return]', 'RETURN 30'], {engine: '996PC'});
  assert.equal(reference(unknown, staticRead).status, 'partial');
  assert.deepEqual(reference(unknown, staticRead).variables, ['U20', 'U30']);
  const conflicting = analyze(['MOV N$idx1 20', 'MOV N$i 1', 'GOTO @return(|N$idx1,' + addr + ')',
    'EQUAL ' + staticRead + ' 0', '[@return]', 'RETURN 30 40'], {engine: '996PC'});
  assert.notEqual(reference(conflicting, staticRead).status, 'resolved');
  const menu = ['[@main]', '#ACT', 'GOTO @prepare', '#SAY', '<炼魂/@炼魂>', '[@prepare]', '#ACT',
    'READCONFIGFILEITEM foo.ini section key S$data FAST', 'EXTRACTSTRING | <$STR(S$data)> N$idx1 S$name',
    '[@炼魂]', '#IF', 'EQUAL ' + staticRead + ' 0'];
  const click = reference(analyze(menu, {engine: 'GOM',
    resolveConfigValues: () => ({values: ['30|名字'], complete: true})}), staticRead);
  assert.deepEqual(click.variables, ['U30']);
  assert.equal(click.status, 'partial');
  assert.ok(click.trace.some(step => step.line === 8));
}
{
  const target = 'N$甲·〩ろ', use = 'EQUAL U<$STR(' + target + ')> 0';
  assert.deepEqual(analyze(['MOV ' + target + ' 20', 'INC ' + target + ' 10 ; 行尾注释', use]).references[0].variables, ['U30']);
  assert.deepEqual(analyze(['MOVR ' + target + ' 1 4', use]).references[0].variables, ['U1','U2','U3']);
  assert.deepEqual(analyze(['MOVR ' + target + ' 2', use]).references[0].variables, ['U0','U1']);
  for (const engine of ['GOM','GEE','996PC']) {
    const call = ['[@main]','#ACT','GOTO @取值(20|' + target + ')',use,'[@取值]','#ACT',
      'MOV N$tmp <$SCRIPTPARAM(1)>','INC N$tmp 10','RETURN <$STR(N$tmp)>','RETURN 999'];
    assert.deepEqual(analyze(call,{engine}).references[0].variables,['U30']);
    assert.deepEqual(analyze(call.map(line => line === 'RETURN <$STR(N$tmp)>' ? 'BREAK' : line),{engine}).references[0].variables,[]);
    const reads = analyze(['#ACT','MOV ' + target + ' 9','#SAY','SET [77] 1','<$FLAG(<$STR(' + target + ')>)>',
      '#ACT','RESET [720]'],{engine}).personalFlags;
    assert.deepEqual(reads.map(r => r.flags),[['[9]']]);
  }
  assert.deepEqual(analyze(['#SAY','<$FLAG(0)>'],{engine:'996PC'}).personalFlags[0].flags,['[0]']);
  for (const cmd of ['GetCamp ' + target,'GetRankLevelByNo 1 5 ' + target]) {
    assert.deepEqual(analyze(['MOV ' + target + ' 20',cmd,use],{engine:'996PC'}).references[0].variables,[]);
  }
  const returned = analyze(['[@main]','#ACT','READCONFIGFILEITEM test.ini section key S$data FAST',
    'EXTRACTSTRING | <$STR(S$data)> S$name ' + target,'MESSAGEBOX 确认 @确定','BREAK','[@确定]','#ACT',use],
    {resolveConfigValues: request => { assert.equal(request.key,'key'); return {values:['例子|30'],complete:true}; }});
  assert.deepEqual(returned.references[0].variables,['U30']);
  const alias = analyze(['MOV N$i 1','GETLISTSTRING test.txt 0 S$data','EXTRACTSTRING , <$STR(S$data)> S$名字<$STR(N$i)> N$槽<$STR(N$i)>',
    'EQUAL T<$STR(N$槽<$STR(N$i)>)> 0','MOV N$i 2','EQUAL T<$STR(N$槽<$STR(N$i)>)> 0'],
    {resolveListData: () => ({lines:['名字,51'],complete:true})}).references.filter(ref => ref.base === 'T');
  assert.deepEqual(alias[0].variables,['T51']);
  assert.deepEqual(alias[1].variables,[], 'changing the subscript invalidates the same-expression alias');
}
const original = ['MOV N$原变量 20', 'MOV N$新变量 <$STR(N$原变量)>', 'INC N$新变量 10', `EQUAL ${slot} 0`];
let result = analyze(original);
assert.deepEqual(reference(result, slot).variables, ['U30'], '20 + 10 must propagate into U30, not stale U20');
assert.equal(reference(result, slot).status, 'resolved');
assert.ok(reference(result, slot).trace.some(step => step.line === 2 && /INC/.test(step.description)));
const aggregate = analyzeVariableListFile(original.join('\n'), 'C:/audit/Envir/Market_Def/test.txt', { engine: () => 'GOM' });
assert.ok(aggregate.variables.some(item => item.name === 'U30'));
assert.ok(!aggregate.variables.some(item => item.name === 'U20'));
const usage = collectCandidateUsage(original.join('\n'), { engine: 'GOM' });
assert.ok(!unusedVariableCandidates('U', usage).includes(30));
assert.deepEqual(resolveScriptValueExpressions(original.join('\n'), [
  { expression: 'N$新变量', line: 2 }, { expression: 'N$新变量', line: 3 },
], { engine: 'GOM' }).map(item => item.values), [['20'], ['30']]);

result = analyze(['MOV N$新变量 20', `EQUAL ${slot} 0`, 'INC N$新变量 10', `EQUAL ${slot} 0`]);
assert.deepEqual(reference(result, slot, 0).variables, ['U20']);
assert.deepEqual(reference(result, slot, 1).variables, ['U30']);
result = analyze(['MOV N$新变量 20', 'MOV N$新变量 30', `EQUAL ${slot} 0`]);
assert.deepEqual(reference(result, slot).variables, ['U30'], 'strong assignment kills the old value');
result = analyze(['#ACT MOV N$新变量 20', '#ACT INC N$新变量 10', `EQUAL ${slot} 0`]);
assert.deepEqual(reference(result, slot).variables, ['U30']);
result = analyze(['MOV N1 20', 'INC N1 10', 'MOV N$新变量 <$STR(N1)>', `EQUAL ${slot} 0`]);
assert.deepEqual(reference(result, slot).variables, ['U30']);

result = analyze(['[@main]', '#SAY', '<计算/@计算(20)>', '[@计算]', '#ACT', 'MOV N$新变量 <$SCRIPTPARAM1>', 'INC N$新变量 10', `EQUAL ${slot} 0`]);
assert.deepEqual(reference(result, slot).variables, ['U30']);
assert.equal(reference(result, slot).status, 'resolved');
result = analyze(['[@main]', '#ACT', 'MOV N$原变量 20', '#SAY', '<计算/@计算(<$STR(N$原变量)>)>', '#ACT', 'INC N$原变量 100', '[@计算]', '#ACT', 'MOV N$新变量 <$SCRIPTPARAM1>', 'INC N$新变量 10', `EQUAL ${slot} 0`]);
assert.deepEqual(reference(result, slot).variables, ['U30'], 'parameters read the SAY position, not the caller final value');

for (const formula of ['(<$STR(N$原变量)>+10)', '<$STR(N$原变量)>+5+5', '(<$STR(N$原变量)>+10)*2/2']) {
  result = analyze(['MOV N$原变量 20', `FORMULATION ${formula} N$新变量`, `EQUAL ${slot} 0`]);
  assert.deepEqual(reference(result, slot).variables, ['U30']);
}
result = analyze(['MOV N$idx 1', 'MOV N$slot1 21', 'EQUAL U<$STR(N$slot<$STR(N$idx)>)> 0']);
assert.deepEqual(reference(result, 'U<$STR(N$slot<$STR(N$idx)>)>').variables, ['U21']);
result = analyze(['MOV N$idx 1', 'MOV N$flag1 203', 'CHECK [<$STR(N$flag<$STR(N$idx)>)>] 0']);
assert.deepEqual(result.personalFlags[0].flags, ['[203]']);

result = analyze(['[@a]', 'MOV N$新变量 20', `EQUAL ${slot} 0`, '[@b]', 'MOV N$新变量 80', `EQUAL ${slot} 0`]);
assert.deepEqual(reference(result, slot, 0).variables, ['U20']);
assert.deepEqual(reference(result, slot, 1).variables, ['U80']);
result = analyze(['#IF', 'CHECKLEVEL 1', '#ACT', 'MOV N$新变量 20', '#ELSEACT', 'MOV N$新变量 40', '#IF', 'CHECKLEVEL 1', '#ACT', 'INC N$新变量 10', `EQUAL ${slot} 0`]);
assert.deepEqual(reference(result, slot).variables, ['U30', 'U50'], 'alternative branches must not execute consecutively');
result = analyze(['MOV N$新变量 20', '#SAY', 'MOV N$新变量 30', '#ACT', `EQUAL ${slot} 0`]);
assert.deepEqual(reference(result, slot).variables, ['U20'], 'SAY text is not an assignment');
result = analyze([`EQUAL ${slot} 0`, 'MOV N$新变量 30']);
assert.equal(reference(result, slot).status, 'unresolved', 'future assignments cannot make earlier reads precise');
result = analyze(['MOV N$新变量 21', 'READCONFIGFILEITEM missing.ini section key N$新变量', `EQUAL ${slot} 0`], { resolveConfigValues: () => undefined });
assert.notEqual(reference(result, slot).status, 'resolved', 'missing dependency cannot preserve a precise old value');
result = analyze(['MOV N$slot1 21', 'MOV N$slot<$STR(N$unknown)> <$USERNAME>', 'EQUAL U<$STR(N$slot1)> 0']);
assert.notEqual(reference(result, 'U<$STR(N$slot1)>').status, 'resolved', 'unknown dynamic writes invalidate possibly overwritten values');

const sequential = Array.from({ length: 513 }, (_, index) => `MOV N$新变量 ${index + 1}`);
result = analyze([...sequential, `EQUAL ${slot} 0`]);
assert.deepEqual(reference(result, slot).variables, ['U513'], '513 overwrites are not 513 alternatives');
const callers = Array.from({ length: 513 }, (_, index) => `<按钮/@大量参数(${index + 1})>`);
const flagText = [...callers, '[@大量参数]', 'CHECK [<$SCRIPTPARAM1>] 0'].join('\n');
const manyFlags = analyzeNestedVariables(flagText, { engine: 'GOM' });
assert.notEqual(manyFlags.personalFlags[0].status, 'resolved');
const manyUsage = collectCandidateUsage(flagText, { engine: 'GOM', nestedAnalysis: manyFlags });
assert.equal(manyUsage.personalFlagsUncertain, true, 'bounded alternatives must retain uncertainty');
assert.ok(!unusedPersonalFlagCandidates(manyUsage).includes(1));
result = analyze(['MOV N$新变量 20', 'SUM N1 N2', `EQUAL ${slot} 0`], { engine: 'GEE' });
assert.notEqual(reference(result, slot).status, 'resolved', 'unmodeled implicit SUM cannot preserve a precise old value');
result = analyze(['MOV N$新变量 20', 'MOV <$CSTR(N$新变量)> 30', `EQUAL ${slot} 0`]);
assert.notEqual(reference(result, slot).status, 'resolved', 'unknown owner writes cannot prove current-owner constants');
const tableOptions = { resolveTableData: () => ({ rows: [['21'], ['22']], complete: true }) };
result = analyze(['MOV N$row 1', 'READEXCEL table.xls <$STR(N$row)>', 'INC N$row 1',
  'MOV N$新变量 <$GLOBAL(Excel0)>', `EQUAL ${slot} 0`], tableOptions);
assert.deepEqual(reference(result, slot).variables, ['U21'], 'Excel columns snapshot the row at READEXCEL, not the later row value');
result = analyze(['MOV N$新变量 <$GLOBAL(Excel0)>', `EQUAL ${slot} 0`, 'READEXCEL table.xls 1'], tableOptions);
assert.equal(reference(result, slot).status, 'unresolved', 'a future READEXCEL cannot initialize earlier reads');
result = analyze(['MOV N$新变量 <$table(0,0)>', `EQUAL ${slot} 0`, 'CSVOPENCACHE table.csv'], tableOptions);
assert.equal(reference(result, slot).status, 'unresolved', 'a future CSV cache load cannot initialize earlier reads');
result = analyze(['CSVOPENCACHE table.csv', 'MOV N$新变量 <$table(0,0)>', `EQUAL ${slot} 0`], tableOptions);
assert.deepEqual(reference(result, slot).variables, ['U21']);
assert.equal(reference(result, slot).status, 'resolved');

// Independent bounded integer oracle. Expected values are computed while
// constructing scripts, never by calling the production expression evaluator.
let randomState = 0x4340;
const next = maximum => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState % maximum; };
let oracleCases = 0;
for (const engine of ['GOM', 'GEE', '996PC']) for (let sample = 0; sample < 60; sample++) {
  let value = next(30);
  const script = [`MOV N$oracle ${value}`];
  const expected = [];
  for (let step = 0; step < 10; step++) {
    script.push('EQUAL U<$STR(N$oracle)> 0');
    expected.push(`U${value}`);
    const operand = next(6);
    switch (next(5)) {
      case 0: script.push(`INC N$oracle ${operand}`); value += operand; break;
      case 1: script.push(`DEC N$oracle ${Math.min(value, operand)}`); value -= Math.min(value, operand); break;
      case 2: script.push(`MUL N$oracle N$oracle ${operand % 2 + 1}`); value *= operand % 2 + 1; break;
      case 3: script.push(`FORMULATION (<$STR(N$oracle)>+${operand})*1 N$oracle`); value += operand; break;
      default: value = next(30); script.push(`MOV N$oracle ${value}`); break;
    }
  }
  script.push('EQUAL U<$STR(N$oracle)> 0'); expected.push(`U${value}`);
  const output = analyze(script, { engine }).references;
  assert.deepEqual(output.map(item => item.variables), expected.map(name => [name]), `${engine} integer oracle sample ${sample}`);
  assert.ok(output.every(item => item.status === 'resolved'));
  oracleCases++;
}
console.log(`variable-source-flow.test.js: PASS (${oracleCases} independent integer oracle scripts; source order, NPC snapshots, branches, nested slots and candidate safety)`);
