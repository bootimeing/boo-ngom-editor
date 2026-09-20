const assert = require('node:assert/strict');
const { cases } = require('./preview-fidelity-audit.test');
const { parse, visible } = require('./preview-inputs-integration.test');
for (const c of cases.filter(c => c.category === 'implementation-bug')) {
  assert.deepEqual(c.actual, c.expected, c.id);
}
function result(act, expression = '<$STR(N0)>', values = {}) {
  return visible(parse(`[@main]\n#ACT\n${act}\n#SAY\n<TEXT:${expression}:30:30>`, values));
}
assert.equal(result('FORMULATION -5/2 N0'), '-2');
assert.equal(result('FORMULATION -7/2 N0'), '-4');
assert.equal(result('FORMULATION 5/4 N0'), '1');
assert.equal(result('MOV N0 0\nWHILE N0 ? 2\nINC N0 1\nENDWHILE'), '3');
assert.equal(result('MOV N0 0\nMOV N1 0\nWHILE N0 < 2\nINC N0 1\nMOV N2 0\nWHILE N2 < 3\nINC N2 1\nINC N1 1\nENDWHILE\nENDWHILE','<$STR(N1)>'), '6');
assert.equal(result('MOV S1 甲乙丙\nDEC S1 1 2','<$STR(S1)>'), '乙丙');
assert.equal(result('DEC S1 B','<$STR(S1)>',{S1:'<IMG:B>'}), '<IMG:>');
const bounded = parse('[@main]\n#ACT\nMOV N0 0\nWHILE N0 = 0\nINC N1 1\nENDWHILE\n#SAY\n<TEXT:<$STR(N1)>:30:30>');
assert.ok(bounded.warnings.some(w => w.includes('循环') && w.includes('上限')));
assert.equal(visible(bounded), '0', 'loop limit must not display a partially accumulated result');
assert.equal(result('VAR Integer HUMAN QQQQ\nINC QQQQ 1','<$HUMAN(QQQQ)>'), '1');
assert.equal(result('MOV N2 100\nMOV N3 10\nMUL N2 N2 N3','<$STR(N2)>'), '1000', 'capture both operands before overwriting target');
// A bare numeric variable on the right side is a value reference, not literal
// text. GEE additionally proves text-token copying; GOM/996PC text variables
// stay literal unless the documented <$STR(...)> form is used. The GXX source
// snapshot independently confirms the GEE-family scalar-copy path: VarInfo2
// is classified by GetValNameInfo (including N$/S$), ProcessParams resolves
// the raw right operand through GetVarValue, and ActionOfMov writes that value.
assert.equal(result('MOV U101 42\nMOV U102 U101', '<$STR(U102)>'), '42');
assert.equal(visible(parse('[@main]\n#ACT\nMOV N$结果 N$来源\n#SAY\n<TEXT:<$STR(N$结果)>:30:30>', {'N$来源':'88'})), '88');
assert.equal(visible(parse('[@main]\n#ACT\nMOV S1 T001\n#SAY\n<TEXT:<$STR(S1)>:30:30>', {T001:'翎风'}, 'GEE')), '翎风');
// 996PC removed the old bare `MOV N1 N2` form.  The current manual requires
// <$STR(...)>; do not silently borrow GOM/GEE copy semantics in this engine.
const legacy996BareModel = parse('[@main]\n#ACT\nMOV N0 U101\n#SAY\n<TEXT:<$STR(N0)>:30:30>', {U101:'996'}, '996PC');
assert.equal(visible(legacy996BareModel), '0');
assert.ok(legacy996BareModel.warnings.some(warning => warning.includes('996PC') && warning.includes('<$STR')));
assert.equal(result('MOV N2 12\nDIV N0 N2 0'), '0');
assert.equal(result('MOV N0 0\nWHILE N0 < 2\nINC N0 1\n#IF\nEQUAL N0 1\n#ACT\nINC N1 1\nENDWHILE\n#SAY','<$STR(N1)>'), '1');
const halfCharacter = parse('[@main]\n#ACT\nMOV S1 甲乙\nDEC S1 1 1\n#SAY\n<TEXT:<$STR(S1)>:30:30>');
assert.ok(halfCharacter.warnings.some(w => w.includes('字符边界')));
for (const [threshold, expected] of [[1,'成功'],[2,'失败'],[3,'失败']]) {
  const source = `[@main]\n#ACT\nMOV N0 1\n#IF(${threshold})\nEQUAL N0 1\nEQUAL N0 2\n#SAY\n<TEXT:成功:30:30>\n#ELSESAY\n<TEXT:失败:30:30>`;
  assert.equal(visible(parse(source)), expected);
}
const protectedDeletion = parse('[@main]\n#ACT\nDEC S1 B\n#SAY\n<TEXT:<$STR(S1)>:30:30>', {S1:'<IMG:B>'});
assert.equal(protectedDeletion.pages[0].elements.length, 1);
assert.equal(protectedDeletion.pages[0].elements[0].kind, 'text');
assert.equal(visible(parse('[@main]\n#ACT\nMOV N0 0\nWHILE N0 > 5\n#SAY\n<TEXT:不该出现:30:30>\n#ACT\nENDWHILE\n#SAY\n<TEXT:结束:30:60>')), '结束');
console.log('preview-fidelity-semantics.test.js: PASS');
