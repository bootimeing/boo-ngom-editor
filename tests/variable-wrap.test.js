const assert = require('node:assert/strict');
const fs = require('node:fs');

function main() {
  const {
    collectVariableWrapEdits,
    findVariableWrapEdits,
    isWrappableVariable,
    wrapVariablesInText,
  } = require('../out/utils/variable-wrap');

  for (const variable of [
    'N$Score', 's$名字', 'L$List1', 'G$全局', 'D$Data', 'GL$Global',
    'A999', 'U499', 'T499', 'I999',
    'U<$STR(N$变量)>', 'T<$str(S$索引)>', 'A<$STR(U3)>', 'G<$STR(T4)>',
    'N$属性<$STR(N$下标)>', 'S$文本<$STR(U3)>',
    'N$矩阵<$STR(N$行)><$STR(N$列)>',
  ]) {
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
  assert.equal(
    wrapVariablesInText('U<$STR(N$变量)> T<$str(S$索引)> A<$STR(U3)> G<$STR(T4)>').text,
    '<$STR(U<$STR(N$变量)>)> <$STR(T<$str(S$索引)>)> <$STR(A<$STR(U3)>)> <$STR(G<$STR(T4)>)>'
  );
  assert.equal(
    wrapVariablesInText('N$属性<$STR(N$下标)> S$文本<$STR(U3)> N$矩阵<$STR(N$行)><$STR(N$列)>').text,
    '<$STR(N$属性<$STR(N$下标)>)> <$STR(S$文本<$STR(U3)>)> <$STR(N$矩阵<$STR(N$行)><$STR(N$列)>)>'
  );
  assert.equal(
    wrapVariablesInText('<$STR(U<$STR(N$变量)>)>\n; T<$STR(U3)>\nS$普通').text,
    '<$STR(U<$STR(N$变量)>)>\n; T<$STR(U3)>\n<$STR(S$普通)>'
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

  const nestedDocument = [
    'MOV U<$STR(N$变量)> T<$STR(S$索引)>',
    'MOV N$属性<$STR(U3)> S$普通',
  ].join('\n');
  const uDynamic = 'U<$STR(N$变量)>';
  const tDynamic = 'T<$STR(S$索引)>';
  const nDynamic = 'N$属性<$STR(U3)>';
  const sPlain = 'S$普通';
  const nestedSelections = [
    { start: nestedDocument.indexOf(uDynamic), text: uDynamic },
    { start: nestedDocument.indexOf('N$变量'), text: 'N$变量' },
    {
      start: nestedDocument.indexOf(uDynamic),
      text: nestedDocument.slice(nestedDocument.indexOf(uDynamic), nestedDocument.indexOf(tDynamic) + tDynamic.length),
    },
    { start: nestedDocument.indexOf(nDynamic), text: nDynamic },
    { start: nestedDocument.indexOf(sPlain), text: sPlain },
  ];
  assert.deepEqual(
    collectVariableWrapEdits(nestedSelections, nestedDocument),
    [
      {
        start: nestedDocument.indexOf(sPlain),
        end: nestedDocument.indexOf(sPlain) + sPlain.length,
        replacement: '<$STR(S$普通)>',
      },
      {
        start: nestedDocument.indexOf(nDynamic),
        end: nestedDocument.indexOf(nDynamic) + nDynamic.length,
        replacement: '<$STR(N$属性<$STR(U3)>)>',
      },
      {
        start: nestedDocument.indexOf(tDynamic),
        end: nestedDocument.indexOf(tDynamic) + tDynamic.length,
        replacement: '<$STR(T<$STR(S$索引)>)>',
      },
      {
        start: nestedDocument.indexOf(uDynamic),
        end: nestedDocument.indexOf(uDynamic) + uDynamic.length,
        replacement: '<$STR(U<$STR(N$变量)>)>',
      },
    ],
    'overlapping multi-selections must keep complete outer dynamic variables and reject inner dependencies'
  );
  assert.deepEqual(
    collectVariableWrapEdits(
      [{ start: 3, text: uDynamic }],
      `foo${uDynamic}`
    ),
    [],
    'a dynamic variable selected inside a longer name must not be wrapped'
  );

  const assistant = fs.readFileSync('src/assistant.ts', 'utf8');
  assert.match(assistant, /editor\.selections\.filter\(selection => !selection\.isEmpty\)/);
  assert.match(assistant, /collectVariableWrapEdits\(selections\.map/);
  assert.match(assistant, /已批量包裹 \$\{orderedEdits\.length\} 个变量/);

  console.log('variable-wrap.test.js: PASS');
}

main();
