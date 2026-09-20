const assert = require('node:assert/strict');
const { parse, visible } = require('./preview-inputs-integration.test');
const source = [
  '[@main]', '#ACT', 'GOTO @数据', '#SAY', '<$STR(S$界面)>', '<业务/@业务>',
  '[@数据]', '#ACT', 'MOV S$界面 <TEXT:88灵玉:20:20>',
  '#IF', 'CHECKITEMW 承影', '#ACT', 'MOV S$界面 <TEXT:188灵玉:20:20>',
  '#IF', 'CHECK [301] 1', '#ACT', 'MOV N$业务 42',
  '[@业务]', '#IF', 'CHECK [302] 1', '#ACT', 'MOV S$界面 <TEXT:业务:20:20>',
].join('\n');
const names = model => model.previewInputs.map(i => i.name);
for (const engine of ['GOM', 'GEE']) {
  const initial = parse(source, {}, engine);
  assert.ok(visible(initial).includes('88灵玉'));
  assert.ok(names(initial).includes('WORN(承影)'), 'a skipped helper write must retain the switch that can change visible data');
  assert.ok(!names(initial).includes('[301]') && !names(initial).includes('[302]'), 'unrelated/dormant business conditions stay hidden');
  assert.ok(!names(initial).includes('S$界面'), 'derived UI must not become a user text field');
  const selected = parse(source, { 'WORN(承影)': '1' }, engine);
  assert.ok(visible(selected).includes('188灵玉'));
  assert.ok(names(selected).includes('WORN(承影)'));
  assert.ok(visible(parse(source, {}, engine)).includes('88灵玉'));
  const overwritten = source.replace('GOTO @数据', 'GOTO @数据\nMOV S$界面 <TEXT:覆盖:20:20>');
  assert.ok(!names(parse(overwritten, {}, engine)).includes('WORN(承影)'), 'later unconditional assignment kills prior control dependency');
  const hiddenProse = '[@main]\n#ACT\nMOV N0 7\n#IF\nCHECK [303] 1\n#SAY\nMOV N0 1\n#IF\n#SAY\n<TEXT:<$STR(N0)>:20:20>';
  assert.equal(visible(parse(hiddenProse, {}, engine)), '7', 'hidden SAY prose is not an assignment');
}
console.log('preview-inactive-write-inputs.test.js: PASS false/true/reset, GOTO helper dependency, business isolation and overwrite order');
module.exports = { source };
