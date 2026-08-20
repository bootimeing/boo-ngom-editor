const assert = require('node:assert/strict');
const {
  commandContext,
  normalizeSyntax,
  snippetParams,
} = require('../tools/data-maintenance/apply-help-command-coverage');

function main() {
  assert.equal(
    normalizeSyntax('格式：ChangeHumNewValue 属性(0-54) 属性值', 'CHANGEHUMNEWVALUE'),
    'CHANGEHUMNEWVALUE 属性(0-54) 属性值'
  );
  assert.deepEqual(
    snippetParams('CHANGEHUMNEWVALUE 属性(0-54) 属性值', 'CHANGEHUMNEWVALUE', true),
    ['属性(0-54)', '属性值']
  );
  assert.deepEqual(snippetParams('DARTMAP 333 333 0', 'DARTMAP', true), []);
  assert.equal(commandContext({ relativePath: '功能操作命令/x.htm', lines: [
    '#IF',
    'GENDER MAN',
  ] }, 'GENDER'), 'check');
  assert.equal(commandContext({ relativePath: '功能操作命令/x.htm', lines: [
    '#ACT',
    'TAKETIME 2025-01-01 2026-01-01',
  ] }, 'TAKETIME'), 'action');
  console.log('Help command apply tests passed.');
}

main();
