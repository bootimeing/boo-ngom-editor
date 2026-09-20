const assert = require('node:assert/strict');
const { parse, visible } = require('./preview-inputs-integration.test');

const checks = [];
const check = (name, test) => checks.push({ name, test });
const texts = model => model.pages.flatMap(page => page.elements).map(element => element.text);

check('scalar copies preserve variable-looking user literals in values AND conditions', () => {
  const literal = '<$STR(U101)>';
  const model = parse(['[@main]', '#ACT', 'MOV U101 42', 'MOV S$copy <$STR(S$source)>', '#SAY',
    '<TEXT:copy=<$STR(S$copy)>:30:30>', '<TEXT:source=<$STR(S$source)>:30:60>',
    '#IF', 'EQUAL S$copy <$STR(S$source)>', '#SAY', '<TEXT:equal:30:90>', '#ELSESAY', '<TEXT:unequal:30:90>'].join('\n'),
  { 'S$source': literal });
  assert.ok(visible(model).includes(`copy=${literal}`));
  assert.ok(visible(model).includes(`source=${literal}`));
  const copy = model.pages.flatMap(page => page.resolvedVariables || []).find(value => value.name === 'S$copy');
  assert.equal(copy.value, literal, 'literal input must not become a second evaluation pass');
  assert.equal(model.conditionGroups[0].satisfied, true, 'equal visible string values use equal semantic values');
});

// Every fixture below has an evidenced direct output, not a guessed last argument.
const writers = [
  ['GOM', 'GETDBMONSTERFIELDVALUE 稻草人 LEVEL U101', 'U101', '42', '6'],
  ['GEE', 'GETDBMONSTERFIELDVALUE 稻草人 LEVEL U101', 'U101', '42', '6'],
  ['996PC', 'GETDBMONSTERFIELDVALUE 稻草人 LEVEL U101', 'U101', '42', '6'],
  ['GOM', 'GETITEMNAMEBYMAKEINDEX 123 S$target', 'S$target', '静态旧值', '预览新值'],
  ['996PC', 'GETITEMNAMEBYMAKEINDEX 123 S$target 1', 'S$target', '静态旧值', '预览新值'],
  ['GOM', 'GETBINDMONEY 元宝 U101', 'U101', '42', '6'],
  ['GEE', 'GETBINDMONEY 元宝 U101', 'U101', '42', '6'],
  ['996PC', 'GETBINDMONEY 元宝 U101', 'U101', '42', '6'],
  ['996PC', 'HUMVARRANK 积分 U101 0 1', 'U101', '42', '6'],
  ['996PC', 'GETDBIDXITEMFIELDVALUE 935 LEVEL U101', 'U101', '42', '6'],
];
for (const [engine, command, target, prior, fallback] of writers) {
  check(`${engine} ${command} revokes stale static state before applying fallback`, () => {
    const prefix = ['[@main]', '#ACT', `MOV ${target} ${prior}`];
    const suffix = ['#SAY', `<TEXT:<$STR(${target})>:30:30>`];
    const before = parse([...prefix, ...suffix].join('\n'), { [target]: fallback }, engine);
    assert.ok(texts(before).includes(prior), 'deterministic source MOV continues to override initial inputs');
    const model = parse([...prefix, command, ...suffix].join('\n'), { [target]: fallback }, engine);
    assert.ok(texts(model).includes(fallback), `runtime output should use explicit ${fallback}, not obsolete ${visible(model)}`);
    const automatic = parse([...prefix, command, ...suffix].join('\n'), {}, engine);
    assert.ok(!texts(automatic).includes(prior), 'Auto must not keep the pre-write snapshot either');
  });
}

check('996PC SortHumVar invalidates numbered output families, not source prefix or unrelated keys', () => {
  const model = parse(['[@main]', '#ACT', 'MOV S$rank1 旧人物', 'MOV N$rank1 42',
    'MOV S$rank 前缀自身', 'MOV S$rankExtra 无关变量', 'SORTHUMVAR 积分 S$rank N$rank 0 1 10', '#SAY',
    '<TEXT:<$STR(S$rank1)>/<$STR(N$rank1)>/<$STR(S$rank)>/<$STR(S$rankExtra)>:30:30>'].join('\n'),
  { 'S$rank1': '预览人物', 'N$rank1': '6' }, '996PC');
  assert.ok(visible(model).includes('预览人物/6/前缀自身/无关变量'));
});

for (const engine of ['GOM', '996PC']) {
  check(`${engine} AddMirrorMap invalidates implicit D99`, () => {
    const model = parse('[@main]\n#ACT\nMOV D99 42\nADDMIRRORMAP 0 123 比奇副本 60 0159 101\n#SAY\n<TEXT:<$STR(D99)>:30:30>',
      { D99: '1' }, engine);
    assert.ok(texts(model).includes('1'));
  });
}

const mixtures = [
  ['source leaf survives a different user append', 'MOV L$UI [<TEXT:源码控件:30:30>]\nADDTOLIST L$UI <$STR(S$user)>',
    { 'S$user': '<TEXT:用户文字:1:1>' }, '<$STR(L$UI[0])>', '<TEXT:<$STR(L$UI[1])>:30:60>'],
  ['source append survives existing user list', 'ADDTOLIST L$UI <TEXT:源码控件:30:30>',
    { 'L$UI': '["<TEXT:用户文字:1:1>"]' }, '<$STR(L$UI[1])>', '<TEXT:<$STR(L$UI[0])>:30:60>'],
  ['source dictionary member survives unrelated user key', 'MOV D$UI[源码] <TEXT:源码控件:30:30>',
    { 'D$UI': '{"用户":"<TEXT:用户文字:1:1>"}' }, '<$STR(D$UI[源码])>', '<TEXT:<$STR(D$UI[用户])>:30:60>'],
];
for (const [name, actions, values, sourceExpression, userExpression] of mixtures) {
  check(name, () => {
    const model = parse(`[@main]\n#ACT\n${actions}\n#SAY\n${sourceExpression}\n${userExpression}`, values);
    assert.equal(texts(model).length, 2);
    assert.ok(texts(model).includes('源码控件'), 'only the chosen leaf controls source-markup interpretation');
    assert.ok(texts(model).includes('<TEXT:用户文字:1:1>'), 'user leaf remains literal-only');
  });
}

check('mixed collection user template leaf copied to scalar keeps identical semantic and painted values', () => {
  const literal = '<$STR(U101)>';
  const model = parse(['[@main]', '#ACT', 'MOV U101 42', 'MOV L$mix [源码值]', 'ADDTOLIST L$mix <$STR(S$user)>',
    'MOV S$copy <$STR(L$mix[1])>', '#SAY', '<TEXT:copy=<$STR(S$copy)>:30:30>',
    '#IF', 'EQUAL S$copy <$STR(S$user)>', '#SAY', '<TEXT:相同:30:60>'].join('\n'), { 'S$user': literal });
  assert.ok(visible(model).includes(`copy=${literal}`));
  assert.equal(model.conditionGroups[0].satisfied, true);
  const copy = model.pages.flatMap(page => page.resolvedVariables || []).find(value => value.name === 'S$copy');
  assert.equal(copy.value, literal);
});

for (const engine of ['GOM', 'GEE', '996PC']) {
  check(`${engine} source markup survives mixed-list sorting and user index then scalar copy`, () => {
    const model = parse(['[@main]', '#ACT', 'MOV L$mix [<TEXT:Z源码控件:30:30>]', 'ADDTOLIST L$mix <$STR(S$user)>',
      'SORTLIST L$mix L$sorted 0 1', 'MOV S$copy <$STR(L$sorted[<$STR(N$selector)>])>', '#SAY', '<$STR(S$copy)>',
      '<TEXT:<$STR(L$sorted[0])>:30:60>'].join('\n'), { 'S$user': '<TEXT:A用户文字:1:1>', 'N$selector': '1' }, engine);
    assert.deepEqual(texts(model), ['Z源码控件', '<TEXT:A用户文字:1:1>']);
  });
}

check('JOINLIST then SPLITTOLIST preserves source/user origin through mixed scalar fragments', () => {
  const model = parse(['[@main]', '#ACT', 'MOV L$mix [<TEXT:源码控件:30:30>]', 'ADDTOLIST L$mix <$STR(S$user)>',
    'JOINLIST L$mix S$joined ,', 'SPLITTOLIST S$joined , L$again', '#SAY', '<$STR(L$again[0])>',
    '<TEXT:<$STR(L$again[1])>:30:60>'].join('\n'), { 'S$user': '<TEXT:用户文字:1:1>' });
  assert.deepEqual(texts(model), ['源码控件', '<TEXT:用户文字:1:1>']);
});

for (const engine of ['GOM', 'GEE', '996PC']) {
  check(`${engine} EXTRACTSTRING retains per-span source markup and user literals`, () => {
    const literal = '<TEXT:用户文字:1:1>';
    const model = parse(['[@main]', '#ACT', 'MOV S$mix <TEXT:来源控件:30:30>,<$STR(S$user)>',
      'EXTRACTSTRING , <$STR(S$mix)> S$first S$second', '#SAY', '<$STR(S$first)>',
      '<TEXT:<$STR(S$second)>:30:60>'].join('\n'), { 'S$user': literal }, engine);
    assert.deepEqual(texts(model), ['来源控件', literal],
      'unrelated user text must not turn the source-authored first field into a raw tag');
    const values = model.pages.flatMap(page => page.resolvedVariables || []);
    assert.equal(values.find(value => value.name === 'S$first').value, '<TEXT:来源控件:30:30>');
    assert.equal(values.find(value => value.name === 'S$second').value, literal);
    assert.ok(values.every(value => value.staticValueSource !== 'database-item-index'));
  });
}

for (const engine of ['GOM', 'GEE']) {
  check(`${engine} raw punctuation-bearing user key chooses source dictionary leaf after edits`, () => {
    const model = parse(['[@main]', '#ACT', 'MOV D$mix {"A:B":"<TEXT:源码控件:30:30>"}',
      'MOV D$mix[用户] <$STR(S$user)>', 'MOV D$mix[其他] 旁路数据', '#SAY', '<$STR(D$mix[<$STR(S$key)>])>',
      '<TEXT:<$STR(D$mix[用户])>:30:60>'].join('\n'), { 'S$key': 'A:B', 'S$user': '<TEXT:用户文字:1:1>' }, engine);
    assert.deepEqual(texts(model), ['源码控件', '<TEXT:用户文字:1:1>']);
  });
}

function run() {
  const failures = [];
  for (const { name, test } of checks) {
    try { test(); } catch (error) { failures.push({ name, error }); }
  }
  for (const { name, error } of failures) console.error(`FAIL ${name}\n${error.message}`);
  assert.equal(failures.length, 0, `${failures.length}/${checks.length} remaining-preview regressions failed`);
  console.log(`preview-remaining-audit.test.js: PASS ${checks.length}/${checks.length}`);
}
if (require.main === module) run();
module.exports = { run };
