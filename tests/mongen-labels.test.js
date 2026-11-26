const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_SCRIPT_RUNTIME_ROOT || path.join(__dirname, '..'));
const { findMonGenQFunctionReferenceAt: find } = require(path.join(runtime, 'out/utils/mongen-labels'));

let checks = 0;
const label = '@刷怪_回调-结束';
for (const [engine, prefix] of [
  ['GOM', '3 100 85 白野猪 75 1 180 0 254 '],
  ['996PC', '3 100 85 白野猪 75 1 180 100#1#1 254 '],
  ['GEE', '3 180 275 毒蜘蛛 2 4 1 100 249 0 0 0 0 0 '],
]) {
  for (const indent of ['', ' \t', '\uFEFF\t', ' \t\uFEFF ']) {
    const line = indent + prefix.replaceAll(' ', '\t') + label + ' 0 G9 > 9 ; @注释';
    const start = line.indexOf(label), end = start + label.length;
    for (let character = start; character < end; character++) {
      assert.deepEqual(find(line, character, engine), { label: label.slice(1), start, end });
      checks++;
    }
    for (const character of [start - 1, end, line.indexOf('@注释'), line.indexOf('白野猪'), 0]) {
      assert.equal(find(line, character, engine), undefined);
      checks++;
    }
  }

  for (const value of ['*', '@', '刷怪_回调', '@<$STR(S$字段)>', '@字段(1)', '前缀@字段', '@字段:30', '@字段/后缀']) {
    const line = prefix + value;
    assert.equal(find(line, line.indexOf(value), engine), undefined, `${engine}: ${value}`);
    checks++;
  }
  for (const comment of [';', '//']) {
    const line = `\uFEFF\t${comment} ` + prefix + label;
    assert.equal(find(line, line.indexOf(label), engine), undefined);
    const tail = prefix.trimEnd().split(' ').slice(0, -1).join(' ') + ` ${comment} ` + label;
    assert.equal(find(tail, tail.indexOf(label), engine), undefined);
    const attached = prefix.trimEnd() + `${comment} ` + label;
    assert.equal(find(attached, attached.indexOf(label), engine), undefined, 'an attached comment marker cannot fabricate a QF column');
    checks += 3;
  }
}

for (const [engine, line] of [
  ['GEE', '3 100 85 白野猪 75 1 180 0 254 ' + label],
  ['GOM', '3 180 275 毒蜘蛛 2 4 1 100 249 0 0 0 0 0 ' + label],
  ['996PC', '3 180 275 毒蜘蛛 2 4 1 100 249 0 0 0 0 0 ' + label],
  ['GOM', '3 100 85 白野猪 75 1 180 0 254 * 0 * 0 0 0 1 0 1@RespawnAlert:60,30,10'],
  ['GOM', '3 invalid 85 白野猪 75 1 180 0 254 ' + label],
]) {
  assert.equal(find(line, line.indexOf('@'), engine), undefined, `${engine}: wrong column/target or invalid row`);
  checks++;
}
console.log(`mongen-labels.test.js: PASS (${checks} static-field/span/engine checks)`);
