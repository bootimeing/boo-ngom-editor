const assert = require('node:assert/strict');
const fs = require('node:fs');

function main() {
  const {
    collectVariableWrapEdits,
    findVariableWrapEdits,
    isWrappableVariable,
    wrapVariablesInText,
  } = require('../out/utils/variable-wrap');

  for (const variable of ['N$Score', 's$名字', 'L$List1', 'G$全局', 'D$Data', 'GL$Global', 'A999', 'U499', 'T499', 'I999']) {
    assert.equal(isWrappableVariable(variable), true, `${variable} must be wrappable`);
  }
  for (const variable of ['U500', 'T500', 'A1000', 'N$', 'foo', 'U3tail']) {
    assert.equal(isWrappableVariable(variable), false, `${variable} must be rejected`);
  }

  assert.equal(
    wrapVariablesInText('N$Score S$Name G10').text,
    '<$STR(N$Score)> <$STR(S$Name)> <$STR(G10)>'
  );
  assert.equal(
    wrapVariablesInText('#IF\nCHECKLEVEL U3\n#ACT\nMOV N$Target S$Source').text,
    '#IF\nCHECKLEVEL <$STR(U3)>\n#ACT\nMOV <$STR(N$Target)> <$STR(S$Source)>'
  );
  assert.equal(
    wrapVariablesInText('<$STR(N$Score)> S$Name').text,
    '<$STR(N$Score)> <$STR(S$Name)>'
  );
  assert.equal(
    wrapVariablesInText('<$STR(N$base<$STR(N$index)>)> D$Outside').text,
    '<$STR(N$base<$STR(N$index)>)> <$STR(D$Outside)>'
  );
  assert.equal(
    wrapVariablesInText('; N$Comment\n// U3\nS$Live').text,
    '; N$Comment\n// U3\n<$STR(S$Live)>'
  );
  assert.equal(
    wrapVariablesInText('fooU3 U3tail U500 A1000 U499').text,
    'fooU3 U3tail U500 A1000 <$STR(U499)>'
  );

  const edits = collectVariableWrapEdits([
    { start: 10, text: 'N$One S$Two' },
    { start: 10, text: 'N$One' },
    { start: 30, text: 'U3' },
  ]);
  assert.deepEqual(edits, [
    { start: 30, end: 32, replacement: '<$STR(U3)>' },
    { start: 16, end: 21, replacement: '<$STR(S$Two)>' },
    { start: 10, end: 15, replacement: '<$STR(N$One)>' },
  ]);
  assert.deepEqual(
    collectVariableWrapEdits([{ start: 4, text: 'N$On' }], 'MOV N$One'),
    [],
    'a partial selection inside a longer variable must not be wrapped'
  );
  assert.deepEqual(
    collectVariableWrapEdits([{ start: 6, text: 'N$One' }], 'MOV <$N$One>'),
    [],
    'a selection inside an existing dynamic expression must not be wrapped'
  );
  assert.equal(findVariableWrapEdits('<$N$Already>').length, 0);

  const assistant = fs.readFileSync('src/assistant.ts', 'utf8');
  assert.match(assistant, /editor\.selections\.filter\(selection => !selection\.isEmpty\)/);
  assert.match(assistant, /collectVariableWrapEdits\(selections\.map/);
  assert.match(assistant, /已批量包裹 \$\{orderedEdits\.length\} 个变量/);

  console.log('variable-wrap.test.js: PASS');
}

main();
