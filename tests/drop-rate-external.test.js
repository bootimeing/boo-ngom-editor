const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { analyzeDropRatesWithExternal } = require(path.join(runtime, 'out/utils/drop-rate-external'));
const { dropAnalysisMarkdown } = require(path.join(runtime, 'out/utils/drop-rate-analysis'));
const iconv = require('iconv-lite');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-drop-external-'));
const envir = path.join(temporary, 'Mir200', 'Envir');
const diary = path.join(envir, 'QuestDiary');
const main = path.join(envir, 'MonItems', '白野猪.txt');
const originals = new Map();
function write(relative, text, encoding = 'utf8') {
  const target = path.join(diary, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const bytes = Buffer.isBuffer(text) ? text : iconv.encode(text, encoding);
  fs.writeFileSync(target, bytes);
  originals.set(target, crypto.createHash('sha256').update(bytes).digest('hex'));
  return target;
}
const body = (text, label = '@药水') => `[${label}]\n{\n${text}\n}\n`;
const call = (file, label = '@药水') => `#CALL [\\\\${file}] ${label}`;
const analyze = (text, engine = 'GOM', limits) => analyzeDropRatesWithExternal(text, engine, main, limits);
const warningText = result => result.warnings.map(warning => warning.message).join('\n');
try {
  fs.mkdirSync(path.dirname(main), { recursive: true });
  fs.writeFileSync(main, '1/1 磁盘旧内容\n');
  originals.set(main, crypto.createHash('sha256').update(fs.readFileSync(main)).digest('hex'));
  const potions = write('爆率系统/基础爆率.txt', body('1/2 超强金创药\n1/4 超强魔法药'), 'gbk');
  write('另一份.txt', body('1/8 太阳水'), 'utf8');
  write('UTF8BOM.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body('1/3 中文药水'))]));
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const result = analyze(`#CHILD 1/2 RANDOM\n(\n1/1 木剑\n${call('爆率系统\\基础爆率.txt')}\n)\n1/5 编辑缓冲区物品`, engine);
    assert.deepEqual(result.rows.map(row => row.item), ['木剑', '超强金创药', '超强魔法药', '编辑缓冲区物品']);
    assert.deepEqual(result.rows.map(row => row.baselineFraction), engine === 'GEE' ? ['1/6', '1/12', '1/24', '1/5'] : ['1/6', '1/6', '1/6', '1/5']);
    assert.equal(result.rows[1].source.filePath, fs.realpathSync(potions));
    assert.equal(result.rows[1].source.line, 3);
    assert.equal(result.rows[1].line, 3);
    assert.equal(result.rows[1].section, '@药水');
    assert.deepEqual(result.rows[1].source.callChain, [{ filePath: main, line: 4, label: '@药水' }]);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.external.filesRead, 1);
    assert.equal(result.external.expandedCalls, 1);
    assert.equal(result.external.unresolvedCalls, 0);
    const report = dropAnalysisMarkdown(result, main);
    assert.ok(report.includes('调用链：'));
    assert.ok(report.includes('基础爆率'));
    assert.ok(!report.includes('磁盘旧内容'), 'main editor buffer must not be replaced by disk');

    // MonItems CALL is insertion, not NPC GOTO: same labels in two files and
    // repeated calls must keep all candidates, with one cached read per file.
    const repeated = analyze(`${call('爆率系统\\基础爆率.txt')}\n${call('另一份.txt')}\n${call('爆率系统\\基础爆率.txt')}`, engine);
    assert.equal(repeated.rows.length, 5);
    assert.equal(repeated.external.expandedCalls, 3);
    assert.equal(repeated.external.filesRead, 2);
    assert.deepEqual(repeated.rows.map(row => row.baselineFraction), ['1/2', '1/4', '1/8', '1/2', '1/4']);
    assert.equal(analyze(call('UTF8BOM.txt'), engine).rows[0].item, '中文药水');

    const unsupported = analyze(`#CHILD 1/1 RANDOM\n(\n1/1 木剑\n#CALLEX [\\另一份.txt] @药水\n)`, engine);
    assert.equal(unsupported.rows[0].baselineFraction, undefined);
    assert.match(warningText(unsupported), /CALLEX.*NPC/);
    assert.equal(unsupported.external.filesRead, 0, 'unsupported command must not read target');
  }

  write('深层/中间.txt', body(`${call('另一份.txt')}\n1/10 中间层物品`));
  const nested = analyze(call('深层\\中间.txt'));
  assert.deepEqual(nested.rows.map(row => row.item), ['太阳水', '中间层物品']);
  assert.equal(nested.rows[0].source.callChain.length, 2);
  assert.equal(nested.external.expandedCalls, 2);

  write('条件.txt', body('#IF [N20>100,N20<110|1] RANDOM\n(\n1/9 条件物品\n1/7 条件物品二\n)'));
  const condition = analyze(call('条件.txt'));
  assert.deepEqual(condition.rows.map(row => row.baselineFraction), ['1/2', '1/2']);
  assert.ok(condition.rows[0].runtimeReasons.some(reason => reason.includes('N20>100')));
  assert.equal(condition.groups[0].source.filePath, path.join(diary, '条件.txt'));
  assert.equal(condition.groups[0].line, 3);
  write('CASE.txt', body('#CASE N10\n100\n(\n1/1 分支一\n)\n101\n(\n1/1 分支二\n)'));
  const cases = analyze(call('CASE.txt'));
  assert.deepEqual(cases.rows.map(row => row.item), ['分支一', '分支二']);
  assert.ok(cases.rows.every(row => !row.baselineFraction));

  write('循环甲.txt', body(call('循环乙.txt')));
  write('循环乙.txt', body(`1/2 循环前物品\n${call('循环甲.txt')}`));
  const cycle = analyze(`#CHILD 1/1 RANDOM\n(\n1/1 主物品\n${call('循环甲.txt')}\n)\n1/3 后续独立物品`);
  assert.match(warningText(cycle), /循环/);
  assert.equal(cycle.rows.find(row => row.item === '主物品').baselineFraction, undefined);
  assert.equal(cycle.rows.find(row => row.item === '后续独立物品').baselineFraction, '1/3');
  assert.equal(cycle.warnings[0].source.callChain.length, 2);

  write('重复.txt', body('1/1 错误一') + body('1/1 错误二', '@药水'));
  write('坏括号.txt', body(')\n1/1 错误物品'));
  write('少括号.txt', body('#CHILD 1/1\n(\n1/1 错误物品'));
  write('未闭合.txt', '[@药水]\n{\n1/1 错误物品\n[@其他]\n{\n1/1 其他\n}');
  write('无花括号.txt', '[@药水]\n1/1 错误物品');
  write('无标签.txt', body('1/1 错误物品', '@另一个'));
  write('UTF16.txt', body('1/1 错误物品'), 'utf16le');
  write('坏编码.txt', Buffer.from([0xff]));
  write('空.txt', body(''));
  const invalid = [
    [call('不存在.txt'), /ENOENT/], [call('重复.txt'), /重复/], [call('坏括号.txt'), /右括号/],
    [call('少括号.txt'), /未闭合/], [call('未闭合.txt'), /未闭合/], [call('无花括号.txt'), /缺少/],
    [call('无标签.txt'), /不存在/], [call('UTF16.txt'), /UTF-16/], [call('坏编码.txt'), /编码/],
    [call('..\\外部.txt'), /越界/], [call('..\\QuestDiaryBackup\\外部.txt'), /越界/],
    [call('C:\\外部.txt'), /路径/], [call('http:\\外部.txt'), /路径/],
    [call('<$STR(S0)>.txt'), /路径/], [call('另一份.txt', '@<$STR(S0)>'), /静态/],
    [call('另一份.txt') + ' extra', /静态/], [call('另一份'), /\.txt/],
  ];
  for (const [source, expected] of invalid) {
    const result = analyze(`#CHILD 1/1 RANDOM\n(\n1/1 不应伪精确\n${source}\n)\n1/5 后续物品`);
    assert.equal(result.rows.length, 2, source);
    assert.equal(result.rows[0].baselineFraction, undefined, source);
    assert.equal(result.rows[1].baselineFraction, '1/5', source);
    assert.match(warningText(result), expected, source);
    assert.equal(result.external.unresolvedCalls, 1);
    assert.equal(result.warnings[0].source.line, 4);
  }
  const empty = analyze(`#CHILD 1/1 RANDOM\n(\n1/10 唯一物品\n${call('空.txt')}\n)`);
  assert.equal(empty.rows[0].baselineFraction, '1/1', 'valid empty expansion adds zero random candidates');

  // Reparse after each call; never use another server or preserve a previous
  // run's successful expansion after a dependency is removed.
  const mutable = write('后来删除.txt', body('1/1 曾经存在'));
  assert.equal(analyze(call('后来删除.txt')).rows.length, 1);
  fs.unlinkSync(mutable); originals.delete(mutable);
  assert.equal(analyze(call('后来删除.txt')).external.unresolvedCalls, 1);

  const outside = path.join(temporary, 'Outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, '外部.txt'), body('1/1 不得读取'));
  fs.symlinkSync(outside, path.join(diary, '联接'), process.platform === 'win32' ? 'junction' : 'dir');
  const linked = analyze(call('联接\\外部.txt'));
  assert.equal(linked.rows.length, 0);
  assert.match(warningText(linked), /真实路径/);
  assert.equal(linked.external.filesRead, 0);
  const noRoot = analyzeDropRatesWithExternal(call('另一份.txt') + '\n1/3 独立物品', 'GOM', path.join(temporary, '非服务端.txt'));
  assert.match(warningText(noRoot), /Envir/);
  assert.equal(noRoot.rows[0].baselineFraction, '1/3');

  for (const [limits, source, message] of [
    [{ maxDepth: 1 }, call('深层\\中间.txt'), /深度/],
    [{ maxCalls: 1 }, call('另一份.txt') + '\n' + call('另一份.txt'), /次数/],
    [{ maxFiles: 1 }, call('深层\\中间.txt'), /文件数/],
    [{ maxBytes: 1 }, call('另一份.txt'), /字节/],
    [{ maxExpandedLines: 1 }, call('爆率系统\\基础爆率.txt'), /行数/],
    [{ maxExpandedCharacters: 35 }, call('条件.txt'), /字符/],
  ]) {
    const result = analyze(source, 'GOM', limits);
    assert.match(warningText(result), message);
    assert.ok(result.external.unresolvedCalls > 0);
  }
  assert.throws(() => analyze('1/1 物品', 'GOM', { maxFiles: NaN }), /预算/);
  assert.throws(() => analyze('x'.repeat(1_000_001)), /上限/);

  for (const [file, expected] of originals) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), expected, `source unchanged: ${file}`);
  }
  console.log('drop-rate-external.test.js: PASS three-engine CALL insertion, RANDOM count/rates, conditions/CASE, origins, GBK/UTF8/BOM, read-only hashes, root/realpath fences, ambiguity/cycles/budgets, recovery and CALLEX isolation');
} finally {
  // Only this test's uniquely-created directory; never a server/workspace root.
  fs.rmSync(temporary, { recursive: true, force: true });
}
