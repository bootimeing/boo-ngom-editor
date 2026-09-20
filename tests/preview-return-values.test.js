const assert = require('node:assert/strict');
const path = require('node:path');
const { parse, visible } = require('./preview-inputs-integration.test');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { resolveDialogVariables } = require(path.join(runtime, 'out/ui-dialog/variable-resolver'));

// Own-engine evidence: knowledge/{gom,lfm}/manual/GOTO将传递参数返回值保存到变量-脚本参数回调.md.
const source = [
  '[@main]', '#ACT', 'GOTO @callee(3,文字|N$结果,S$结果)', '#SAY',
  '<TEXT:结果=<$STR(N$结果)>/文字=<$STR(S$结果)>:30:30>',
  '[@callee]', '#ACT', 'RETURN 6 <$SCRIPTPARAM(2)>', 'MOV N$结果 999',
].join('\n');

function probe(lines, names, options = {}) {
  const text = lines.join('\n');
  const line = lines.findIndex(value => value.startsWith('PROBE '));
  assert.notEqual(line, -1);
  const result = resolveDialogVariables(text, {
    rootLabel: '@main', targetLabels: ['@main'], engine: 'GOM', previewValues: {}, ...options,
  });
  const output = result.byLabel.get('@MAIN').lines.get(line);
  return { ...result, output, variables: new Map(names.map(name => [name, output.variables.find(value => value.name === name)])) };
}

function run() {
  for (const engine of ['GOM', 'GEE']) {
    const model = parse(source, {}, engine);
    assert.ok(visible(model).includes('结果=6/文字=文字'), `${engine}: deterministic RETURN must reach the caller canvas: ${visible(model)}`);
    assert.ok(!visible(model).includes('999'), `${engine}: RETURN terminates the callee`);
    const nested = parse([
      '[@main]', '#ACT', 'GOTO @outer(甲,乙|S$A,S$B)', '#SAY', '<TEXT:<$STR(S$A)>/<$STR(S$B)>:30:30>',
      '[@outer]', '#ACT', 'GOTO @inner(<$SCRIPTPARAM(2)>,<$SCRIPTPARAM(1)>|S$X,S$Y)',
      'RETURN <$STR(S$X)> <$STR(S$Y)>', '[@inner]', '#ACT', 'RETURN <$SCRIPTPARAM(1)> <$SCRIPTPARAM(2)>',
    ].join('\n'), {}, engine);
    assert.ok(visible(nested).includes('乙/甲'), `${engine}: nested input and return snapshots`);
  }
  assert.ok(visible(parse(source, {}, '996PC')).includes('结果=0/文字=预览文字'), 'do not borrow GOM/LFM RETURN contract for 996PC');
  const staticOnly = parse(source, {}, 'GOM', { previewValues: undefined });
  assert.ok(visible(staticOnly).includes('结果=0/文字=预览文字'), 'legacy non-scenario static mode retains its resource safety contract');

  const bound = probe([
    '[@main]', '#ACT', 'MOV N$slot 101', 'GOTO @callee(|U<$STR(N$slot)>)', '#SAY', 'PROBE <$STR(U101)>/<$STR(U102)>',
    '[@callee]', '#ACT', 'MOV N$slot 102', 'RETURN 7',
  ], ['U101', 'U102']);
  assert.equal(bound.variables.get('U101').value, '7', 'return destination bound before the callee mutates its selector');
  assert.equal(bound.variables.get('U102').value, '0');

  const simultaneous = probe([
    '[@main]', '#ACT', 'MOV S$A 甲', 'MOV S$B 乙', 'GOTO @callee(|S$A,S$B)', '#SAY', 'PROBE <$STR(S$A)>/<$STR(S$B)>',
    '[@callee]', '#ACT', 'RETURN <$STR(S$B)> <$STR(S$A)>',
  ], ['S$A', 'S$B']);
  assert.equal(simultaneous.output.text, 'PROBE 乙/甲', 'all return operands resolve before any destination is written');

  for (const body of [['BREAK', 'RETURN 7'], ['MOV N$结果 88'], ['#IF', 'CHECK [101] 1', '#ACT', 'RETURN 7'], ['MOVR N$未知 10', 'RETURN <$STR(N$未知)>']]) {
    const result = probe([
      '[@main]', '#ACT', 'MOV N$结果 99', 'GOTO @callee(|N$结果)', '#SAY', 'PROBE <$STR(N$结果)>', '[@callee]', '#ACT', ...body,
    ], ['N$结果']);
    assert.equal(result.variables.get('N$结果').value, '0', 'missing/disabled/unknown return must not retain prior values');
    assert.equal(result.variables.get('N$结果').status, 'default');
  }
  const missing = probe(['[@main]', '#ACT', 'MOV N$结果 99', 'GOTO @missing(|N$结果)', '#SAY', 'PROBE <$STR(N$结果)>'], ['N$结果']);
  assert.equal(missing.variables.get('N$结果').status, 'default');
  assert.equal(missing.variables.get('N$结果').value, '0');

  for (const call of ['#CALL [\\外部.txt] @更新', '#CALLEX [\\外部.txt] @更新', 'CALL [\\外部.txt] @更新', 'CALLEX [\\外部.txt] @更新']) {
    const result = probe([
      '[@main]', '#ACT', 'GOTO @callee(|N$结果)', '#SAY', 'PROBE <$STR(N$结果)>',
      '[@callee]', '#ACT', call, 'RETURN 7',
    ], ['N$结果']);
    assert.equal(result.variables.get('N$结果').value, '0', 'unmodeled external call cannot certify a later RETURN: ' + call);
    assert.ok(result.warnings.some(value => value.includes('跨文件')));
  }

  for (const callee of [
    ['[@callee]', '#ACT', 'GOTO @callee', 'RETURN 7'],
    ['[@callee]', '#ACT', 'GOTO @missing', 'RETURN 7'],
    ['[@callee]', '#ACT', 'RETURN 7', '[@CALLEE]', '#ACT', 'RETURN 8'],
  ]) {
    const result = probe([
      '[@main]', '#ACT', 'MOV N$结果 99', 'GOTO @callee(|N$结果)', '#SAY', 'PROBE <$STR(N$结果)>', ...callee,
    ], ['N$结果']);
    assert.equal(result.variables.get('N$结果').value, '0', 'aborted/ambiguous callee must not manufacture a deterministic return');
    assert.equal(result.variables.get('N$结果').status, 'default');
  }
  const deepLabels = Array.from({ length: 50 }, (_, index) => [
    '[@level' + index + ']', '#ACT', ...(index < 49 ? ['GOTO @level' + (index + 1)] : []), 'RETURN 7',
  ]).flat();
  const depth = probe([
    '[@main]', '#ACT', 'GOTO @level0(|N$结果)', '#SAY', 'PROBE <$STR(N$结果)>', ...deepLabels,
  ], ['N$结果']);
  assert.equal(depth.variables.get('N$结果').value, '0', 'execution-depth abort propagates through literal RETURN statements');
  assert.equal(depth.variables.get('N$结果').status, 'default');
  const fallthrough = probe([
    '[@main]', '#ACT', 'GOTO @callee(|N$结果)', '#SAY', 'PROBE <$STR(N$结果)>',
    '[@callee]', '#ACT', 'GOTO @normal', 'RETURN 7', '[@normal]', '#ACT', 'MOV N$其他 1',
  ], ['N$结果']);
  assert.equal(fallthrough.variables.get('N$结果').value, '7', 'normal no-RETURN subroutine is not an aborted execution');

  for (const [targets, returned] of [
    ['N$结果,S$结果', '7'], ['N$结果', '7 多余'], ['不合法-槽位,N$结果', '7 8'],
    [',N$结果', '7 8'], ['N$结果,', '7 8'], ['N$结果,N$结果', '7 8'],
  ]) {
    const result = probe([
      '[@main]', '#ACT', 'MOV N$结果 99', 'GOTO @callee(|' + targets + ')', '#SAY', 'PROBE <$STR(N$结果)>',
      '[@callee]', '#ACT', 'RETURN ' + returned,
    ], ['N$结果']);
    assert.equal(result.variables.get('N$结果').value, '0', 'unsupported return arity/identity stays unknown, never shifts slots: ' + targets);
    assert.ok(result.warnings.some(value => value.includes('返回')), 'uncertain return contract must be inspectable');
  }

  const literal = '<IMG:1:1:1:1>|/@hack <$STR(U101)> $STM(HP) ;仍是文字';
  const protectedSource = [
    '[@main]', '#ACT', 'GOTO @callee(<$STR(S$输入)>|S$结果)', '#SAY', '<TEXT:返回=<$STR(S$结果)>:30:30>',
    '[@callee]', '#ACT', 'RETURN <$SCRIPTPARAM(1)>',
  ].join('\n');
  const protectedModel = parse(protectedSource, { 'S$输入': literal });
  assert.ok(visible(protectedModel).includes('返回=' + literal), 'user literal protection survives argument and return copies');
  assert.equal(protectedModel.pages[0].elements.length, 1, 'returned user text cannot inject controls');
  assert.ok(visible(parse(protectedSource, { 'S$输入': '' })).includes('返回='), 'explicit empty string is a real return value');

  const inputOnly = probe([
    '[@main]', '#ACT', 'MOV N$结果 13', 'GOTO @callee(N$结果)', '#SAY', 'PROBE <$STR(N$结果)>', '[@callee]', '#ACT', 'RETURN 7',
  ], ['N$结果']);
  assert.equal(inputOnly.variables.get('N$结果').value, '13', 'RETURN values are not implicit output targets');
  const dataOptions = { resolveDatabaseField: () => ({ value: '935', complete: true }) };
  const itemSource = [
    '[@main]', '#ACT', 'GETDBITEMFIELDVALUE 传送戒指 IDX N$IDX', 'GOTO @callee(|N$返回)', '#SAY',
    '<TEXT:返回=<$STR(N$返回)>:30:30>', '<&ITEMSHOW:<$STR(N$返回)>:1:10:70:48>',
    '[@callee]', '#ACT', 'RETURN <$STR(N$IDX)>',
  ].join('\n');
  const itemModel = parse(itemSource, {}, 'GOM', { dataOptions });
  assert.ok(visible(itemModel).includes('返回=935'));
  const returned = itemModel.pages[0].resolvedVariables.find(value => value.name === 'N$返回');
  assert.equal(returned.staticValueSource, undefined, 'return copy never inherits database IDX authority');
  assert.equal(itemModel.pages[0].elements.find(element => element.itemPreview)?.itemPreview.itemIndex, undefined);
  console.log('preview-return-values.test.js: PASS');
}

if (require.main === module) run();
module.exports = { run, source };
