const assert = require('node:assert/strict');

function main() {
  const { findScriptSectionSymbols } = require('../out/utils/document-symbols');
  const text = [
    '开头说明',
    '[@逐鹿武将]',
    '#IF',
    'CHECK [1] 1',
    '#ACT',
    'GOTO @下一段',
    '[~失败分支]',
    '#SAY',
    '失败',
    '[@下一段]',
    '#ACT',
    'BREAK',
  ].join('\r\n');
  const symbols = findScriptSectionSymbols(text);

  assert.deepEqual(symbols.map(item => item.name), ['@逐鹿武将', '~失败分支', '@下一段']);
  assert.equal(symbols[0].kind, 'function');
  assert.equal(symbols[1].kind, 'branch');
  assert.equal(text.slice(symbols[0].selectionStart, symbols[0].selectionEnd), '[@逐鹿武将]');
  assert.equal(text.slice(symbols[0].rangeStart, symbols[0].rangeEnd).includes('GOTO @下一段'), true);
  assert.equal(symbols[0].rangeEnd, symbols[1].rangeStart);
  assert.equal(symbols[2].rangeEnd, text.length);

  const bodyOffset = text.indexOf('CHECK [1] 1');
  const active = symbols.find(item => item.rangeStart <= bodyOffset && bodyOffset < item.rangeEnd);
  assert.equal(active.name, '@逐鹿武将');
  assert.equal(
    symbols.some(item => item.rangeStart <= text.indexOf('开头说明') && text.indexOf('开头说明') < item.rangeEnd),
    false,
    'text before the first label must keep the breadcrumb fallback'
  );

  assert.deepEqual(findScriptSectionSymbols('; [@注释标签]\r\n普通文字'), []);
  console.log('document-symbols.test.js: PASS');
}

main();
