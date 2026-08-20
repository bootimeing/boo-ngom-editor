const assert = require('node:assert/strict');

function main() {
  const {
    findAtLabelReplacementStart,
    findCommandReplacementStart,
    findDirectiveReplacementStart,
    findMapInfoReplacementStart,
    findPathPartialReplacementStart,
    findSayMarkupReplacementStart,
    findSectionLabelReplacementStart,
    findVariableReplacementStart,
  } = require('../out/utils/completion-range');

  assert.equal(findAtLabelReplacementStart('@'), 0);
  assert.equal(findAtLabelReplacementStart('GOTO @'), 5);
  assert.equal(findAtLabelReplacementStart('<关闭/@'), 4);
  assert.equal(findAtLabelReplacementStart('<关闭/@ma'), 4);
  assert.equal(findAtLabelReplacementStart('GOTO @_@神秘代码#'), 5);
  assert.equal(findAtLabelReplacementStart('<测试/@sfjdkjhs*'), 4);
  assert.equal(findAtLabelReplacementStart('[@main]'), -1);
  assert.equal(findAtLabelReplacementStart('SENDMSG 5 测试'), -1);

  assert.equal(findVariableReplacementStart('<'), 0);
  assert.equal(findVariableReplacementStart('<$USER'), 0);
  assert.equal(findVariableReplacementStart('内容 D$'), 3);
  assert.equal(findVariableReplacementStart('<IMG'), -1);

  assert.equal(findCommandReplacementStart('H.Move'), 0);
  assert.equal(findCommandReplacementStart('M.CHANGEATTACK'), 0);
  assert.equal(findCommandReplacementStart('  SEND'), 2);

  assert.equal(findDirectiveReplacementStart('#I'), 0);
  assert.equal(findDirectiveReplacementStart('  #CALL'), 2);

  assert.equal(findSectionLabelReplacementStart('['), 0);
  assert.equal(findSectionLabelReplacementStart('  [@ma'), 2);
  assert.equal(findSectionLabelReplacementStart('#CALL [\\'), -1);

  assert.equal(findSayMarkupReplacementStart('文字 <&IM'), 3);
  assert.equal(findSayMarkupReplacementStart('文字 <IMG>'), -1);

  assert.equal(findPathPartialReplacementStart('[\\Quest\\NpcFi'), 8);
  assert.equal(findPathPartialReplacementStart('没有路径'), -1);

  assert.equal(findMapInfoReplacementStart('[0] FIGHT3('), 4);
  assert.equal(findMapInfoReplacementStart('[0] FIGHT'), 4);

  console.log('completion-range.test.js: PASS');
}

main();
