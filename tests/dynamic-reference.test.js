const assert = require('node:assert/strict');

function main() {
  const {
    findInvalidDynamicReferences,
  } = require('../out/utils/dynamic-reference');

  const valid = [
    'large <$human(大雁塔)> 0',
    'dec <$GUILD(变量测试)> 10',
    'sendmsg 6 <$C.HUMAN(QQQQ)>',
    'sendmsg 6 <$CHUMAN(QQQQ)>',
    'sendmsg 6 <$SLAVE(0).NAME>',
    'large <$str(n$进入层数)> 0',
    'large <$C.STR(S1)> 0',
    '; <$STR(缺少变量)>',
  ];
  assert.deepEqual(findInvalidDynamicReferences(valid), []);

  const invalid = findInvalidDynamicReferences([
    'large <$STR(活动要求)> 0',
    'small <$cstr(固定名字)> 1',
  ]);
  assert.deepEqual(
    invalid.map(item => item.text),
    ['<$STR(活动要求)>', '<$cstr(固定名字)>']
  );
  assert.deepEqual(
    invalid.map(item => item.line),
    [0, 1]
  );

  console.log('dynamic-reference.test.js: PASS');
}

main();
