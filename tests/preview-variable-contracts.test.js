const assert = require('node:assert/strict');
const path = require('node:path');
const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { previewVariableContract: contract } = require(path.join(runtimeRoot, 'out/ui-dialog/preview-variable-contracts'));
const { discoverPreviewInputs, evaluatePreviewCondition, previewInputName, previewInputKind,
  previewFlagNames, validPreviewValue, resolvePreviewExpression, splitPreviewArguments } = require(path.join(runtimeRoot, 'out/ui-dialog/preview-inputs'));

function run() {
  for (const engine of ['GOM', 'GEE', '996PC']) {
    for (const name of ['A0', 'S0', 'T0']) assert.equal(contract(name, engine).kind, 'text', `${engine} ${name}`);
    for (const name of ['P0', 'D0', 'M0', 'N0', 'I0', 'G0', 'U0', 'J0']) assert.equal(contract(name, engine).kind, 'number', `${engine} ${name}`);
    assert.equal(contract('L$列表', engine).kind, 'list');
    assert.equal(contract('N$数额', engine).kind, 'number');
    assert.equal(contract('S$名字', engine).kind, 'text');
    for (const name of ['LEVEL', 'GAMEGOLD', 'HP', 'C.GAMEGOLD', 'H.LEVEL']) assert.equal(contract(name, engine).kind, 'number', `${engine} ${name}`);
    for (const name of ['USERNAME', 'GUILDNAME', 'GAMEGOLDNAME', 'C.USERNAME', 'H.USERNAME']) assert.equal(contract(name, engine).kind, 'text', `${engine} ${name}`);
    assert.equal(previewInputName('sCrIpTpArAm2', engine), 'SCRIPTPARAM(2)');
    assert.equal(previewInputName('<$SCRIPTPARAM(2)>', engine), 'SCRIPTPARAM(2)');
    assert.equal(previewInputName('<$CSTR(s0)>', engine), 'CSTR(S0)');
    assert.equal(previewInputKind('CSTR(s0)', engine), 'text');
    assert.equal(previewInputName('HUMAN(大小写ABC)', engine), 'HUMAN(大小写ABC)');
  }
  assert.equal(contract('Z0', 'GOM').kind, 'text');
  assert.equal(contract('KILLMONNAME_MAXHP', 'GOM').kind, 'number');
  assert.equal(contract('CURRRTARGETNAMECOLOR', 'GOM').kind, 'number');
  assert.equal(contract('HIGHLEVELINFO', 'GOM').kind, 'text');
  assert.equal(contract('Z0', '996PC').kind, 'text');
  assert.equal(contract('Z0', 'GEE'), undefined, 'GEE cannot borrow an unevidenced GOM Z family');
  assert.equal(contract('GL$列表', 'GOM').kind, 'list');
  assert.equal(contract('GL$列表', 'GEE'), undefined);
  assert.equal(contract('D$字典', 'GEE').kind, 'dictionary');
  assert.equal(contract('D$字典', '996PC'), undefined);
  assert.equal(contract('P100', 'GOM').kind, 'number');
  assert.equal(contract('P100', '996PC'), undefined);
  assert.equal(contract('U500'), undefined);
  assert.equal(contract('A999', '996PC').typeUncertain, true);
  assert.equal(contract('[0]', '996PC').kind, 'flag');
  assert.equal(contract('[0]', 'GOM'), undefined);
  assert.equal(contract('[1000]', '996PC'), undefined);
  assert.equal(contract('[1024]', 'GOM').kind, 'flag');
  assert.equal(contract('UNKNOWN_PLUGIN_VALUE'), undefined);
  assert.equal(contract('UNKNOWN_PLUGIN_VALUE', 'GOM', true).typeUncertain, true);
  assert.equal(contract('CALL_PLUGIN(1)', 'GOM', true), undefined);
  assert.equal(contract('PARAM0').kind, 'text');
  assert.equal(previewInputName('n$Case'), 'N$Case');
  assert.notEqual(previewInputName('N$Case'), previewInputName('N$case'));
  assert.equal(previewInputName('u101'), 'U101');

  const source = `[@main]
#ACT
MOVR U102 1 100
READCONFIGFILEITEM U103 S0 N0 S$配置
READEXCEL book.xls 1
CSVGETCELLTEXT cache 1 2 S$csv
GETLISTSTRING path 0 S$第一列 N$第二列
RESET [101] 0 3
VAR Integer HUMAN 次数
VAR String GLOBAL 名称
#IF
NOT CHECK [101] 0
CHECK [<$STR(N0)>] 1
CHECKLEVEL 10
CHECKGAMEGOLD > 20
CHECKVAR HUMAN 次数 > 1
EQUAL <$STR(U<$STR(N0)>)> 9
EQUAL S0 勇士
#SAY
<$USERNAME> <$C.GAMEGOLD> <$H.LEVEL> <$CSTR(S0)>
<$STR(L$列表[<$STR(N0)>])> <$STR(D$字典[键])>
<$SCRIPTPARAM1> <$SCRIPTPARAM(1)>
<$HUMAN(次数)> <$GLOBAL(名称)> <$CONST(U444)> <$EXCEL0> <$PLUGIN_VALUE>
U201 [202] 文本不是变量
; <$STR(U203)>`;
  const inputs = discoverPreviewInputs(source, { N0: '101', 'SCRIPTPARAM(1)': '参数', 'HUMAN(次数)': '7' });
  const names = inputs.map(input => input.name);
  for (const name of ['U102', 'S$配置', 'S$csv', 'S$第一列', 'N$第二列', '[101]', '[102]', '[103]', 'LEVEL',
    'GAMEGOLD', 'N0', 'U101', 'S0', 'USERNAME', 'C.GAMEGOLD', 'H.LEVEL', 'CSTR(S0)', 'L$列表', 'D$字典',
    'SCRIPTPARAM(1)', 'HUMAN(次数)', 'GLOBAL(名称)', 'EXCEL0', 'PLUGIN_VALUE']) assert.ok(names.includes(name), `discovered ${name}`);
  for (const name of ['U103', 'U201', '[202]', 'U203', 'U444']) assert.ok(!names.includes(name), `not false positive ${name}`);
  assert.equal(names.filter(name => name === '[101]').length, 1);
  assert.equal(names.filter(name => name === 'SCRIPTPARAM(1)').length, 1);
  assert.equal(inputs.find(input => input.name === 'HUMAN(次数)').kind, 'number');
  assert.equal(inputs.find(input => input.name === 'GLOBAL(名称)').kind, 'text');
  assert.equal(inputs.find(input => input.name === 'HUMAN(次数)').value, '7');
  const values = { N0: '101', U101: '9007199254740993.02', '[101]': '1', S0: '勇士', LEVEL: '10',
    GAMEGOLD: '20', 'C.GAMEGOLD': '999', 'H.LEVEL': '12', 'CSTR(S0)': '对象', 'SCRIPTPARAM(1)': '参数',
    'HUMAN(次数)': '7', 'L$列表': '["a","b"]', 'D$字典': '{"键":"值"}' };
  const read = name => values[name];
  assert.equal(resolvePreviewExpression('<$STR(U<$STR(N0)>)>', read), values.U101);
  assert.equal(resolvePreviewExpression('<$CSTR(S0)>', read), '对象');
  assert.equal(resolvePreviewExpression('<$SCRIPTPARAM1>', read), '参数');
  assert.equal(resolvePreviewExpression('<$STR(L$列表[1])>', read), 'b');
  assert.equal(resolvePreviewExpression('<$STR(D$字典[键])>', read), '值');
  assert.deepEqual(previewFlagNames('[<$STR(N0)>]', read), ['[101]']);
  for (const condition of ['NOT CHECK [101] 0', 'CHECK [<$STR(N0)>] 1', 'EQUAL S0 勇士', 'CHECKLEVEL 10',
    'CHECKGAMEGOLD = 20', 'CHECKGAMEGOLD ? 20', 'EQUAL <$C.GAMEGOLD> 999', 'EQUAL <$H.LEVEL> 12',
    'LARGE <$STR(U<$STR(N0)>)> 9007199254740993.01', 'CHECKVAR HUMAN 次数 > 6', 'EQUAL <$SCRIPTPARAM1> 参数']) {
    assert.equal(evaluatePreviewCondition(condition, read), true, condition);
  }
  assert.equal(evaluatePreviewCondition('NOT NOT CHECK [101] 1', read), true);
  assert.equal(evaluatePreviewCondition('NOT EQUAL <$PLUGIN_UNKNOWN> 1', read), undefined);
  assert.equal(evaluatePreviewCondition('EQUAL <$PLUGIN_UNKNOWN> 勇士', name => name === 'PLUGIN_UNKNOWN' ? '勇士' : undefined), true);
  const implicitSource = '[@main]\n#IF\nCHECKSLAVENAME dog N0\nCHECKNAMELISTPOSITION path < 10 N1\n#ACT\nCSVGETCELLTEXT path 0 0 N2\nMIRRORMAPTIME map';
  const implicit = engine => discoverPreviewInputs(implicitSource, {}, engine).map(input => input.name);
  assert.deepEqual(implicit('GOM').sort(), ['D99', 'N0', 'N1', 'N2', 'P0'].sort());
  assert.deepEqual(implicit('GEE').sort(), ['N1', 'N2', 'P0'].sort());
  assert.deepEqual(implicit('996PC').sort(), ['D99', 'N1'].sort());
  assert.equal(evaluatePreviewCondition('NOT RANDOM 2', read), undefined);
  assert.equal(evaluatePreviewCondition('CompareText "Abc" "ABC"', read), true);
  assert.equal(evaluatePreviewCondition('CheckContainsText "www.996m2.com" "996M2.COM"', read, '996PC'), true);
  assert.equal(evaluatePreviewCondition('CompareText "Abc" "ABC"', read, 'GEE'), undefined);
  assert.equal(evaluatePreviewCondition('CompareText "勇士" "勇士"', read, 'GEE'), true);
  assert.equal(evaluatePreviewCondition('NOT CompareText <$UNKNOWN()>' + ' "x"', read), undefined);
  assert.equal(evaluatePreviewCondition('CHECKLEVEL 10', read, '996PC'), undefined, 'name-only legacy contract is not borrowed');
  assert.equal(evaluatePreviewCondition('CHECKLEVELEX = 10', read, '996PC'), true);
  assert.deepEqual(splitPreviewArguments('LARGE <$STR(U<$STR(N0)>)> 1 ; comment'), ['LARGE', '<$STR(U<$STR(N0)>)>', '1']);
  assert.deepEqual(splitPreviewArguments('CHECKGAMEGOLD < 100'), ['CHECKGAMEGOLD', '<', '100']);
  assert.equal(validPreviewValue({ name: 'N0', kind: 'number' }, '9007199254740993.02'), true);
  assert.equal(validPreviewValue({ name: 'N0', kind: 'number' }, '1e3'), false);
  assert.equal(validPreviewValue({ name: 'L$x', kind: 'list' }, '["x",1]'), true);
  assert.equal(validPreviewValue({ name: 'L$x', kind: 'list' }, '{"x":1}'), false);
  assert.equal(validPreviewValue({ name: 'D$x', kind: 'dictionary' }, '{"x":"y"}'), true);
  assert.equal(validPreviewValue({ name: 'D$x', kind: 'dictionary' }, '{"__proto__":"x"}'), true, 'own-key dictionaries safely preserve engine key names');
  assert.equal(Object.prototype.x, undefined);
  console.log('preview-variable-contracts.test.js: PASS (engine types, catalog, discovery, nested conditions, validation)');
}
if (require.main === module) run();
module.exports = { run };
