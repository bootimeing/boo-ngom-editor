const assert = require('node:assert/strict');
const { parse, visible } = require('./preview-inputs-integration.test');
const names = model => model.previewInputs.map(input => input.name);
const cases = [
  { name: 'dynamic destination', engine: 'GOM', source: [
    '[@main]', '#ACT', 'MOV N9 2', 'MOV S2 <TEXT:88灵玉:20:20>',
    '#IF', 'CHECK [401] 1', '#ACT', 'MOV S<$STR(N9)> <TEXT:188灵玉:20:20>',
    '#IF', '#SAY', '<$STR(S2)>',
  ].join('\n') },
  { name: 'wrapped output identity', engine: 'GOM', source: [
    '[@main]', '#ACT', 'MOV S$界面 <TEXT:88灵玉:20:20>',
    '#IF', 'CHECK [401] 1', '#ACT', 'MOV <$STR(S$界面)> <TEXT:188灵玉:20:20>',
    '#IF', '#SAY', '<$STR(S$界面)>',
  ].join('\n') },
  { name: 'inactive transitive GOTO', engine: 'GOM', source: [
    '[@main]', '#ACT', 'MOV S$界面 <TEXT:88灵玉:20:20>',
    '#IF', 'CHECK [401] 1', '#ACT', 'GOTO @第一层', '#IF', '#SAY', '<$STR(S$界面)>',
    '[@第一层]', '#ACT', 'GOTO @第二层',
    '[@第二层]', '#ACT', 'MOV S$界面 <TEXT:188灵玉:20:20>',
    '#IF', 'CHECK [402] 1', '#ACT', 'MOV N$内部 9',
  ].join('\n') },
  { name: 'inactive GOTO RETURN', engine: 'GEE', source: [
    '[@main]', '#ACT', 'MOV N$数量 88', '#IF', 'CHECK [401] 1', '#ACT',
    'GOTO @结果(|N$数量)', '#IF', '#SAY', '<TEXT:<$STR(N$数量)>灵玉:20:20>',
    '[@结果]', '#ACT', 'RETURN 188',
  ].join('\n') },
];

function run() {
  for (const test of cases) {
    const initial = parse(test.source, {}, test.engine);
    assert.ok(visible(initial).includes('88灵玉'), test.name + ' must not borrow inactive RHS');
    assert.ok(names(initial).includes('[401]'), test.name + ' lost enabling control');
    assert.ok(!names(initial).includes('[402]'), 'internal business condition leaked');
    assert.ok(!names(initial).includes('S$界面'), 'derived UI became editable input');
    assert.ok(visible(parse(test.source, { '[401]': '1' }, test.engine)).includes('188灵玉'), test.name + ' active value');
    assert.ok(visible(parse(test.source, {}, test.engine)).includes('88灵玉'), test.name + ' reset');
  }
  const killed = cases[2].source.replace('#IF\n#SAY', '#IF\n#ACT\nMOV S$界面 <TEXT:最终:20:20>\n#SAY');
  assert.ok(!names(parse(killed)).includes('[401]'), 'unconditional later write kills indirect control dependency');
  const unrelated = cases[2].source.replace('MOV S$界面 <TEXT:188灵玉:20:20>', 'MOV S$业务 <TEXT:188灵玉:20:20>');
  assert.ok(!names(parse(unrelated)).includes('[401]'), 'callee with only invisible writes must stay hidden');
  const prose = [
    '[@main]', '#ACT', 'MOV S$界面 <TEXT:88灵玉:20:20>', '#SAY', '<$STR(S$界面)>',
    '[@prose]', '#IF', 'CHECK [401] 1', '#SAY', 'MOV S$界面 <TEXT:188灵玉:20:20>',
  ].join('\n');
  const proseModel = parse(prose);
  assert.ok(!names(proseModel).includes('[401]'), 'dormant MOV-looking SAY prose is not a potential write');
  assert.ok(visible(proseModel).includes('88灵玉'), 'SAY prose must not replace the visible value');
  console.log('preview-indirect-write-inputs.test.js: PASS dynamic destinations, transitive inactive GOTO, RETURN, overwrite and business isolation');
}
if (require.main === module) run();
module.exports = { cases, run };
