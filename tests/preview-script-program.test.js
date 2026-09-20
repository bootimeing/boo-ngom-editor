const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { buildPreviewScriptProgram } = require(path.join(runtime, 'out/ui-dialog/preview-script-program'));

function source(name, text) {
  return { uri: 'file:///D:/fixture/' + name, filePath: 'D:\\fixture\\' + name,
    fileName: name, text, documentVersion: 3 };
}
function build(text, files, engine = 'GOM') {
  const primary = source('npc.txt', text), reads = [];
  const result = buildPreviewScriptProgram(primary, engine, raw => {
    reads.push(raw);
    const found = files[raw];
    return found ? { status: 'found', source: typeof found === 'string' ? source(raw.replace(/^\\/, ''), found) : found,
      candidateFilePaths: [] } : { status: 'missing', message: 'fixture missing', candidateFilePaths: [] };
  });
  return { ...result, reads };
}
function checkMap(program) {
  let offset = 0;
  for (const s of program.segments) {
    assert.equal(s.start, offset, 'segments cover all generated text without gaps or overlap');
    assert.ok(s.end > s.start);
    assert.ok(s.sourceStart >= 0 && s.sourceEnd >= s.sourceStart && s.sourceEnd <= s.source.text.length);
    if (!s.rewritten) assert.equal(program.text.slice(s.start, s.end), s.source.text.slice(s.sourceStart, s.sourceEnd));
    offset = s.end;
  }
  assert.equal(offset, program.text.length);
}
function run() {
  const unchanged = build('[@main]\r\n#SAY\r\n原文\r\n', {});
  assert.equal(unchanged.text, unchanged.primary.text); checkMap(unchanged);
  const basic = build('[@main]\r\n#ACT\r\n#CALL [\\calc.txt] @calc ;调用\r\n#SAY\r\n主文', {
    '\\calc.txt': '[@calc]\n{\n#ACT\nRETURN 6\n}\n[@unused]\n{\n#SAY\n不应导入\n}\n',
  });
  assert.match(basic.text, /GOTO @calc ;调用\r\n/);
  assert.match(basic.text, /\[@calc\]\n\n#ACT\nRETURN 6\n/);
  assert.ok(!basic.text.includes('不应导入')); assert.ok(!/^\s*[{}]\s*$/m.test(basic.text));
  assert.equal(basic.resolutions.size, 1); checkMap(basic);
  const copies = build('[@main]\n#ACT\n#CALL [\\a.txt] @same\n#CALL [\\a.txt] @same', { '\\a.txt': '[@same]\n{\n#SAY\n一\n}' });
  assert.equal((copies.text.match(/\[@same\]/g) || []).length, 1);
  assert.equal((copies.text.match(/GOTO @same/g) || []).length, 2); assert.equal(copies.reads.length, 1); checkMap(copies);
  const conflict = build('[@main]\n#ACT\n#CALL [\\a.txt] @same\n#CALL [\\b.txt] @same', {
    '\\a.txt': '[@same]\n{\n#SAY\nA\n}', '\\b.txt': '[@same]\n{\n#SAY\nB\n}',
  });
  assert.ok(!conflict.text.includes('GOTO @same')); assert.ok(!conflict.text.includes('[@same]'));
  assert.match(conflict.warnings.join('\n'), /同名|歧义|冲突/); checkMap(conflict);
  const primaryCollision = build('[@main]\n#ACT\n#CALL [\\a.txt] @same\n[@same]\n#SAY\n主标签', { '\\a.txt': '[@same]\n{\n#SAY\n外部\n}' });
  assert.ok(!primaryCollision.text.includes('GOTO @same')); assert.equal((primaryCollision.text.match(/\[@same\]/g) || []).length, 1);
  const ex = build('[@main]\n#ACT\n#CALLEX [\\a.txt] @same\n#CALLEX [\\b.txt] @same', {
    '\\a.txt': '[@same]\n{\n#ACT\nGOTO @same\n}', '\\b.txt': '[@same]\n{\n#SAY\nB\n}',
  });
  assert.match(ex.text, /GOTO @same~1/); assert.match(ex.text, /\[@same~1\]/);
  assert.equal((ex.text.match(/GOTO @same\n/g) || []).length, 2, 'CALLEX must not rename internal GOTO'); checkMap(ex);
  const suffix = build('[@main]\n#ACT\n#CALLEX [\\a.txt] @same\n#CALLEX [\\b.txt] @same\n[@same~1]\n#SAY\n手写', {
    '\\a.txt': '[@same]\n{\n#SAY\nA\n}', '\\b.txt': '[@same]\n{\n#SAY\nB\n}',
  });
  assert.ok(!suffix.text.includes('GOTO @same~1')); assert.ok(!suffix.text.includes('[@same~2]'));
  const nested = build('[@main]\n#ACT\n#CALL [\\a.txt] @a', {
    '\\a.txt': '[@a]\n{\n#ACT\n#CALL [\\b.txt] @b\nRETURN 2\n}',
    '\\b.txt': '[@b]\n{\n#ACT\nRETURN 1\n}',
  });
  assert.match(nested.text, /GOTO @a/); assert.match(nested.text, /GOTO @b/); checkMap(nested);
  const cycle = build('[@main]\n#ACT\n#CALLEX [\\a.txt] @a', { '\\a.txt': '[@a]\n{\n#ACT\n#CALLEX [\\a.txt] @a\nRETURN 2\n}' });
  assert.equal((cycle.text.match(/\[@a(?:~\d+)?\]/g) || []).length, 1);
  assert.match(cycle.text, /#CALLEX \[\\a.txt\]/); assert.match(cycle.warnings.join('\n'), /循环|递归/); checkMap(cycle);
  const branches = build('[@main]\n#IF\nEQUAL N0 1\n#ACT\n#CALL [\\a.txt] @a\n#ELSEACT\n#CALL [\\b.txt] @b', {
    '\\a.txt': '[@a]\n{\n#SAY\nA\n}', '\\b.txt': '[@b]\n{\n#SAY\nB\n}',
  });
  assert.deepEqual(branches.reads, ['\\a.txt', '\\b.txt']); assert.match(branches.text, /#ELSEACT\nGOTO @b/);
  for (const engine of ['GOM', 'GEE']) {
    const one = build('[@main]\n#ACT\n#CALL [\\a.txt] @a', { '\\a.txt': '[@a]\n#SAY\n一个无括号入口' }, engine);
    assert.match(one.text, /GOTO @a/); checkMap(one);
    const many = build('[@main]\n#ACT\n#CALL [\\a.txt] @a', { '\\a.txt': '[@a]\n#SAY\nA\n[@b]\n#SAY\nB' }, engine);
    assert.ok(!many.text.includes('GOTO @a')); assert.match(many.warnings.join('\n'), /括号|边界/);
  }
  const gee = build('[@main]\n#ACT\n#CALLEX [\\a.txt] @a', { '\\a.txt': '[@a]\n{\n#SAY\nA\n}' }, 'GEE');
  assert.match(gee.text, /GOTO @a/); assert.match(gee.warnings.join('\n'), /LFM|翎风|GEE/);
  const pc = build('[@main]\n#ACT\n#CALL [\\a.txt] @a\n#CALLEX [\\b.txt] @b', {
    '\\a.txt': '[@a]\n{\n#SAY\nA\n}', '\\b.txt': '[@b]\n{\n#SAY\nB\n}',
  }, '996PC');
  assert.match(pc.text, /GOTO @a/); assert.ok(!pc.text.includes('GOTO @b')); assert.deepEqual(pc.reads, ['\\a.txt']);
  assert.ok(!build('[@main]\n#ACT\n#CALL [\\a.txt] @a', { '\\a.txt': '[@a]\n#SAY\nA' }, '996PC').text.includes('GOTO @a'));
  const fake = build('[@main]\n#SAY\n文字 #CALL [\\a.txt] @a\n;#CALL [\\a.txt] @a\n#CALL [<$STR(S0)>] @a', {});
  assert.deepEqual(fake.reads, []); checkMap(fake);
  const duplicate = build('[@main]\n#ACT\n#CALL [\\a.txt] @a', { '\\a.txt': '[@a]\n{\n#SAY\nA\n}\n[@A]\n{\n#SAY\nB\n}' });
  assert.ok(!duplicate.text.includes('GOTO @a')); assert.match(duplicate.warnings.join('\n'), /歧义|重复/);
  const chain = {};
  for (let i = 0; i < 20; i++) chain['\\c' + i + '.txt'] = '[@c' + i + ']\n{\n#ACT\n#CALLEX [\\c' + (i+1) + '.txt] @c' + (i+1) + '\n}';
  const deep = build('[@main]\n#ACT\n#CALL [\\c0.txt] @c0', chain);
  assert.ok(deep.reads.length <= 16); assert.match(deep.warnings.join('\n'), /深度|上限/); checkMap(deep);
  const tooBig = build('[@main]\n#ACT\n#CALL [\\a.txt] @a', { '\\a.txt': '[@a]\n{\n' + 'x'.repeat(8*1024*1024) + '\n}' });
  assert.ok(!tooBig.text.includes('GOTO @a')); assert.match(tooBig.warnings.join('\n'), /上限|大小/);
  const missing = build('[@main]\n#ACT\n#CALL [\\absent.txt] @x', {});
  assert.match(missing.text, /#CALL/); assert.match(missing.warnings.join('\n'), /missing/); checkMap(missing);
  const directives = build('#INCLUDE x.ini\n#DEFINE $A 1\n[@main]\n#SAY\n($A)', {});
  assert.equal(directives.text, directives.primary.text); assert.match(directives.warnings.join('\n'), /INCLUDE|DEFINE/);
  for (const body of ['{\n[@a]\n{\n#SAY\nA\n}', '[@old]\n{\n}\n{\n[@a]\n{\n#SAY\nA\n}']) {
    const outer = build('[@main]\n#ACT\n#CALL [\\a.txt] @a', { '\\a.txt': body });
    assert.ok(!outer.text.includes('GOTO @a')); assert.match(outer.warnings.join('\n'), /大括号/);
  }
  for (const suffix of ['((0)', '(0))', '(0)more', '(\"unterminated)']) {
    assert.ok(!build('[@main]\n#ACT\n#CALL [\\a.txt] @a' + suffix, { '\\a.txt': '[@a]\n{\n#ACT\nRETURN 1\n}' }).text.includes('GOTO @a'));
  }
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const parameters = build('[@main]\n#ACT\n#CALL [\\a.txt] @a(\"a;b\") ;outside', { '\\a.txt': '[@a]\n{\n#ACT\nRETURN 1\n}' }, engine);
    assert.ok(!parameters.text.includes('GOTO @a')); assert.match(parameters.warnings.join('\n'), /参数.*未确认/);
  }
  const marker = build('[@main]\r\n#IF\r\nEQUAL N0 1\r\n#CALL [\\a.txt] @a\r\n#ELSEACT\r\n#CALL [\\b.txt] @b', {
    '\\a.txt': '[@a]\n{\n#SAY\nA\n}', '\\b.txt': '[@b]\n{\n#SAY\nB\n}',
  });
  assert.match(marker.text, /EQUAL N0 1\r\n#ACT\r\nGOTO @a\r\n#ELSEACT\r\nGOTO @b/); checkMap(marker);
  const markerFailed = build('[@main]\n#IF\nEQUAL N0 1\n#CALL [\\missing.txt] @a\n#ACT\nRETURN 1', {});
  assert.match(markerFailed.text, /EQUAL N0 1\n#ACT\n#CALL/); checkMap(markerFailed);
  const elseSay = build('[@main]\n#IF\nEQUAL N0 1\n#ELSESAY\n否\n#CALL [\\a.txt] @a', { '\\a.txt': '[@a]\n{\n#SAY\nA\n}' });
  assert.match(elseSay.text, /否\n#ELSEACT\nGOTO @a/); checkMap(elseSay);
  const comments = build('[@main]\n#ACT\n#CALL [\\a.txt] @a //调用注释', {
    '\\a.txt': '[@a]\n//块前注释\n{ //块开始\n#SAY\n网址 https://example.invalid/a\n} //结束\n//块后注释\n',
  });
  assert.match(comments.text, /GOTO @a \/\/调用注释/); assert.ok(comments.text.includes('https://example.invalid/a')); checkMap(comments);
  const sayFailure = build('[@main]\n#SAY\n文字 #CALL [\\a.txt] @a\n#CALL [\\missing.txt] @a', {});
  assert.match(sayFailure.text, /文字 #CALL.*\n#ACT\n#CALL/); assert.deepEqual(sayFailure.reads, ['\\missing.txt']); checkMap(sayFailure);
  const lateFailure = build('[@main]\n#ACT\n' + Array(4097).fill('#CALL [\\missing.txt] @a').join('\n') + '\n#SAY\n文字\n#CALL [\\missing.txt] @a', {});
  assert.match(lateFailure.text, /#SAY\n文字\n#ACT\n#CALL/); checkMap(lateFailure);
  const differentSnapshots = build('[@main]\n#ACT\n#CALL [\\a.txt] @a\n#CALL [\\alias.txt] @a', {
    '\\a.txt': source('a.txt', '[@a]\n{\n#SAY\nOLD\n}'),
    '\\alias.txt': source('a.txt', '[@a]\n{\n#SAY\nNEW\n}'),
  });
  assert.ok(!differentSnapshots.text.includes('GOTO @a')); assert.ok(!differentSnapshots.text.includes('OLD'));
  assert.match(differentSnapshots.warnings.join('\n'), /身份冲突/); checkMap(differentSnapshots);
  const budgetFiles = {}, budgetCalls = [];
  for (let i = 0; i < 70; i++) { budgetFiles['\\f' + i + '.txt'] = '[@f' + i + ']\n{\n#SAY\n' + i + '\n}'; budgetCalls.push('#CALL [\\f' + i + '.txt] @f' + i); }
  const budget = build('[@main]\n#ACT\n' + budgetCalls.join('\n'), budgetFiles);
  assert.ok((budget.text.match(/GOTO @f\d+/g) || []).length <= 63); assert.match(budget.warnings.join('\n'), /64 个源/); checkMap(budget);
  console.log('preview-script-program.test.js: PASS');
}
if (require.main === module) run();
module.exports = { run, source, build, checkMap };
