const assert = require('node:assert/strict');
const path = require('node:path');
const { parse, visible } = require('./preview-inputs-integration.test');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { resolveDialogVariables } = require(path.join(runtime, 'out/ui-dialog/variable-resolver'));

function value(model, name) {
  return model.pages.flatMap(page => page.resolvedVariables || []).find(variable => variable.name === name);
}

function probe(actions, previewValues = {}, engine = 'GOM') {
  const lines = ['[@main]', '#ACT', ...actions, '#SAY', 'PROBE <$STR(N$IDX)>'];
  const resolution = resolveDialogVariables(lines.join('\n'), { engine, rootLabel: '@main', targetLabels: ['@main'], previewValues,
    dataOptions: { resolveDatabaseField: ({ field }) => field.toUpperCase() === 'IDX' ? { value: '935', complete: true } : undefined } });
  const resolved = resolution.byLabel.get('@MAIN')?.lines.get(lines.length - 1);
  assert.ok(resolved, 'resolver probe line exists');
  return resolved.variables.find(variable => variable.name === 'N$IDX');
}

function run() {
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const source = ['[@main]', '#IF', 'CHECKVARINLIST L$名单 张三', '#SAY', '<TEXT:报名张三:30:30>', '#ELSESAY', '<TEXT:没有张三:30:30>',
      '#ACT', 'ADDTOLIST L$名单 李四', 'GETLISTVARCOUNT L$名单 N$人数', '#IF', 'EQUAL N$人数 2', '#SAY',
      '<TEXT:共<$STR(N$人数)>人 首位<$STR(L$名单[0])> 次位<$STR(L$名单[1])>:30:60>'].join('\n');
    const model = parse(source, { 'L$名单': '["张三"]' }, engine);
    assert.deepEqual(model.conditionGroups.map(group => group.satisfied), [true, true], `${engine} local list conditions and source-order writes`);
    assert.ok(visible(model).includes('共2人 首位张三 次位李四'), `${engine} canvas reads committed source-order list state`);
    assert.equal(model.previewInputs.filter(input => input.name === 'L$名单').length, 1, `${engine} collection shared across every reference`);
    assert.equal(model.previewInputs.find(input => input.name === 'L$名单').kind, 'list');
    assert.equal(value(model, 'N$人数').localPreview, true, `${engine} derived scalar retains local preview origin`);
    const noInput = parse(source, {}, engine);
    assert.equal(noInput.conditionGroups[0].satisfied, false);
    assert.equal(noInput.conditionGroups[1].satisfied, false);
  }
  for (const engine of ['GOM', 'GEE']) {
    const source = ['[@main]', '#IF', 'CHECKINDICT D$积分 张三 0', '#SAY', '<TEXT:有张三:30:30>', '#ACT',
      'MOV D$积分[<$STR(S$姓名)>] 200', 'GETDICTKEYCOUNT D$积分 N$人数', '#IF', 'EQUAL <$STR(D$积分[李四])> 200',
      'CHECKDICTALLDIGIT D$积分', '#SAY', '<TEXT:共<$STR(N$人数)>人 张三<$STR(D$积分[张三])> 李四<$STR(D$积分[李四])>:30:60>'].join('\n');
    const model = parse(source, { 'D$积分': '{"张三":"100"}', 'S$姓名': '李四' }, engine);
    assert.deepEqual(model.conditionGroups.map(group => group.satisfied), [true, true], `${engine} dictionary conditions`);
    assert.ok(visible(model).includes('共2人 张三100 李四200'));
    assert.equal(value(model, 'N$人数').localPreview, true);
  }
  const global = parse('[@main]\n#ACT\nADDTOLIST GL$队列 李四\n#SAY\n<TEXT:<$STR(GL$队列)>:30:30>', { 'GL$队列': '["张三"]' });
  assert.ok(visible(global).includes('[张三,李四]'));
  for (const engine of ['GEE', '996PC']) {
    const isolated = parse('[@main]\n#SAY\n<TEXT:<$STR(GL$队列[0])>:30:30>', { 'GL$队列': '["不应出现"]' }, engine);
    assert.ok(!visible(isolated).includes('不应出现'));
    assert.ok(!isolated.previewInputs.some(input => input.name === 'GL$队列' && input.kind === 'list'));
  }
  const isolatedDictionary = parse('[@main]\n#SAY\n<TEXT:<$STR(D$积分[张三])>:30:30>', { 'D$积分': '{"张三":"不应出现"}' }, '996PC');
  assert.ok(!visible(isolatedDictionary).includes('不应出现'));
  const precision = parse('[@main]\n#ACT\nMOV L$金额 [9007199254740993,0.0000000000000000001]\nSUMLIST L$金额 N$合计\n#IF\nLARGE N$合计 9007199254740993\n#SAY\n<TEXT:<$STR(N$合计)>:30:30>');
  assert.equal(precision.conditionGroups[0].satisfied, true);
  assert.ok(visible(precision).includes('9007199254740993.0000000000000000001'));

  for (const literal of ['A:B|C/@x', '<TEXT:不能成为控件:1:1>', '<$STR(U101)>', '"quoted"', 'U101']) {
    const source = '[@main]\n#ACT\nGETLISTVARCOUNT L$内容 N$数量\nJOINLIST L$内容 S$合并 、\n#SAY\n<TEXT:首项<$STR(L$内容[0])>:30:30>\n<TEXT:合并<$STR(S$合并)>:30:60>';
    const model = parse(source, { 'L$内容': JSON.stringify([literal]), U101: '999' });
    assert.equal(model.pages.flatMap(page => page.elements).length, 2, `local collection ${literal} cannot introduce controls`);
    assert.ok(visible(model).includes(`首项${literal}`), `indexed value preserves literal ${literal}`);
    assert.ok(visible(model).includes(`合并${literal}`), `derived value preserves literal ${literal}`);
    assert.equal(value(model, 'S$合并').localPreview, true);
  }
  const literalMap = parse('[@main]\n#SAY\n<TEXT:<$STR(D$内容[键])>:30:30>', { 'D$内容': '{"键":"A:B|C/@x"}' });
  assert.equal(literalMap.pages.flatMap(page => page.elements).length, 1);
  assert.ok(visible(literalMap).includes('A:B|C/@x'));
  const sourceMarkup = parse('[@main]\n#ACT\nMOV L$UI [<TEXT:源码控件:30:30>]\n#SAY\n<$STR(L$UI[0])>', { 'L$UI': '["旧输入"]' });
  assert.ok(sourceMarkup.pages.some(page => page.elements.some(element => element.text === '源码控件')),
    'deterministic whole MOV clears old local taint and retains intentional source markup');
  assert.equal(value(sourceMarkup, 'L$UI').localPreview, undefined);
  const selectedMarkup = parse('[@main]\n#ACT\nMOV L$UI [<TEXT:源码选择控件:30:30>]\n#SAY\n<$STR(L$UI[<$STR(L$选择[0])>])>', { 'L$选择': '["0"]' });
  assert.ok(selectedMarkup.pages.some(page => page.elements.some(element => element.text === '源码选择控件')),
    'a local selector chooses source-authored markup; selector taint must not escape the independent source leaf');

  const db = 'GETDBITEMFIELDVALUE 传送戒指 IDX N$IDX';
  assert.equal(probe([db]).staticValueSource, 'database-item-index', 'positive baseline has actual DB IDX provenance');
  for (const command of ['GETLISTVARCOUNT L$值 N$IDX', 'GETLISTVARINDEX L$值 935 N$IDX', 'SUMLIST L$值 N$IDX',
    'GETLISTMAXVAR L$值 N$IDX', 'GETLISTMINVAR L$值 N$IDX', 'MOV N$IDX <$STR(L$值[0])>']) {
    const variable = probe([db, command], { 'L$值': '["935"]' });
    assert.ok(variable, command);
    assert.equal(variable.staticValueSource, undefined, `${command} clears resource capability`);
    assert.equal(variable.localPreview, true, `${command} retains preview origin`);
  }
  const copiedThroughList = probe([db, 'MOV L$值 [<$STR(N$IDX)>]', 'MOV N$IDX <$STR(L$值[0])>']);
  assert.equal(copiedThroughList.value, '935');
  assert.equal(copiedThroughList.staticValueSource, undefined, 'collection roundtrip cannot preserve direct IDX capability');
  const unknown = probe([db, 'MOV L$值 bad', 'GETLISTMAXVAR L$值 N$IDX']);
  assert.equal(unknown.staticValueSource, undefined);
  assert.notEqual(unknown.value, '935', 'unknown collection output cannot retain old DB number');
  const item = parse('[@main]\n#ACT\nMOV U101 <$STR(L$索引[0])>\n#SAY\n<ITEMSHOW:<$STR(U101)>:0:0>', { 'L$索引': '["935"]' });
  assert.ok(item.pages.flatMap(page => page.elements).every(element => !element.itemPreview?.assetRef && element.itemPreview?.itemIndex === undefined));
  const commented = parse('[@main]\n#ACT\nMOV L$列表 [a,b] ; source comment\nGETLISTVARCOUNT L$列表 N0 ; source count\n#SAY\n<TEXT:<$STR(N0)> <$STR(L$列表)>:30:30>');
  assert.ok(visible(commented).includes('2 [a,b]'), 'source inline comments must not corrupt collection operands');
  const literalSemicolon = parse('[@main]\n#ACT\nADDTOLIST L$列表 <$STR(S$文字)> ; real comment\n#SAY\n<TEXT:<$STR(L$列表[0])>:30:30>', { 'S$文字': 'A ; literal' });
  assert.ok(visible(literalSemicolon).includes('A ; literal'), 'comment stripping must happen before template substitution');
  const sourceLinkSemicolon = parse('[@main]\n#ACT\nMOV S$UI <链接 ; 字面量/@main> ; real comment\n#SAY\n<$STR(S$UI)>');
  assert.ok(sourceLinkSemicolon.pages.some(page => page.elements.some(element => element.text === '链接 ; 字面量')),
    'comment stripping preserves source-authored link markup, including Chinese captions');
  const dynamicLiteralKey = parse('[@main]\n#SAY\n<TEXT:<$STR(D$内容[<$STR(S$键)>])>:30:30>', { 'D$内容': '{"A:B":"正确值"}', 'S$键': 'A:B' });
  assert.ok(visible(dynamicLiteralKey).includes('正确值'), 'dynamic lookup keys use raw semantic values, not escaped display text');
  console.log('preview-collections-integration.test.js: PASS');
}
if (require.main === module) run();
module.exports = { run };
