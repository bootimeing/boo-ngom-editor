const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { VariableListScanner, variableListScanRoots } = require('../out/utils/variable-list');
const { findScriptVariables } = require('../out/utils/variable-statistics');
const { findMapCodeRangesInText } = require('../out/utils/map-code-context');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-variable-list-'));
  const root = path.join(temporary, 'Server');
  const envir = path.join(root, 'Mir200', 'Envir');
  const scripts = path.join(envir, 'Market_Def');
  function write(relative, text, encoding = 'gbk') {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, encoding === 'utf8-bom' ? Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(text)]) : iconv.encode(text, encoding));
    return file;
  }
  const names = text => [...findScriptVariables(text)].map(item => item.name);
  try {
    assert.deepEqual(names('MOV N$累计充值 1 S$角色名字 L$物品列表 D$字典 GL$名单 N$rank中文 N$充值1 s2 U3 u3'),
      ['N$累计充值', 'S$角色名字', 'L$物品列表', 'D$字典', 'GL$名单', 'N$rank中文', 'N$充值1', 'S2', 'U3', 'U3']);
    assert.deepEqual(names('MOV N$Score n$Score N$score'), ['N$Score', 'N$Score', 'N$score']);
    assert.deepEqual(names('ABC_U3 XN$中文 U3suffix N$rank中文后缀'), ['N$rank中文后缀']);
    assert.deepEqual(names('<$STR(N$中文)>+u3'), ['N$中文', 'U3']);
    assert.equal([...findScriptVariables('MOV N$中文 1')][0].index, 4);

    let analyses = 0;
    const scanner = new VariableListScanner({
      mapRanges: (text, file) => {
        analyses++;
        return findMapCodeRangesInText(text, file, new Set(['U99']), token => token.toUpperCase() === 'MAP' ? { params: ['地图编号'], completionVerified: true } : undefined);
      },
    });
    const file = write('Mir200/Envir/Market_Def/main.txt', [
      'MOV N$最大转生等级 1', 'MOV N$当前转生等级 2', 'MOV S$货币 金币', 'MOV S$类型 转生', 'MOV N$数量 100',
      'MOV s2 1', 'MOV U3 1', 'INC u3 1', '; MOV U401 1', 'MAP U99',
      'MOV N$idx 2', 'MOV U1<$STR(N$idx)> 1', 'SET [101] 1', 'CHECK [101] 1',
    ].join('\r\n'));
    write('Mir200/Envir/Market_Def/utf8.TXT', 'MOV N$中文1 1', 'utf8');
    write('Mir200/Envir/Market_Def/bom.InI', 'MOV S$中文名 1', 'utf8-bom');
    write('Mir200/Envir/Market_Def/same/a/shared.txt', 'MOV U31 1');
    write('Mir200/Envir/Market_Def/same/b/shared.txt', 'MOV U31 1');
    write('Mir200/Envir/UserData/data.txt', 'MOV U402 1');
    write('Backup/Mir200/Envir/Market_Def/backup.txt', 'MOV U403 1');
    const first = await scanner.scan([root]);
    assert.equal(first.errors.length, 0);
    for (const name of ['N$最大转生等级', 'N$当前转生等级', 'S$货币', 'S$类型', 'N$数量', 'S2', 'N$中文1', 'S$中文名', 'U12', '[101]']) assert.ok(first.usages.has(name), name);
    for (const name of ['U401', 'U402', 'U403', 'U99', 'U1']) assert.equal(first.usages.has(name), false, name);
    assert.equal(first.usages.get('U3').count, 2);
    assert.equal(first.usages.get('[101]').count, 2);
    assert.equal(first.usages.get('U31').files.size, 2);
    assert.equal(first.occurrences.get('N$当前转生等级')[0].line, 1);
    assert.equal(first.occurrences.get('U12')[0].line, 11);
    const firstAnalyses = analyses;
    await scanner.scan([root]);
    assert.equal(analyses, firstAnalyses, 'unchanged files reuse analysis');
    for (const selected of [path.join(root, 'Mir200'), envir, scripts]) {
      const result = await scanner.scan([selected]);
      assert.deepEqual([...result.usages.keys()], [...first.usages.keys()], selected);
    }
    const onlyA = await scanner.scan([path.join(scripts, 'same/a')]);
    assert.equal(onlyA.usages.get('U31').count, 1, 'subtree must not expand to sibling scripts');
    const overlap = await scanner.scan([root, envir, scripts, scripts.toUpperCase()]);
    if (process.platform === 'win32') assert.equal(overlap.usages.get('U3').count, 2, 'case aliases/overlap cannot duplicate');
    assert.equal((await scanner.scan([path.join(envir, 'UserData')])).usages.size, 0);
    assert.ok(variableListScanRoots([scripts]).every(item => item === scripts));

    const root2 = path.join(temporary, 'Server2');
    const other = path.join(root2, 'Envir/Robot_def/other.INI');
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, 'MOV U201 1');
    assert.ok((await scanner.scan([root, root2])).usages.has('U201'));

    const doc = { filePath: file, text: 'MOV U302 1\rMOV S$未保存 1' };
    await scanner.scan([root]);
    const beforeDraft = analyses;
    const dirty = await scanner.scan([root], [doc]);
    assert.equal(analyses, beforeDraft + 1, 'one changed document must not reanalyze every file');
    assert.ok(dirty.usages.has('U302'));
    assert.equal(dirty.occurrences.get('S$未保存')[0].line, 1);
    assert.equal(dirty.usages.has('N$最大转生等级'), false);
    const afterClose = await scanner.scan([root]);
    assert.ok(afterClose.usages.has('N$最大转生等级'));
    assert.equal(afterClose.usages.has('U302'), false);
    const newFile = path.join(scripts, 'not-saved.txt');
    assert.ok((await scanner.scan([root], [{ filePath: newFile, text: 'MOV U303 1' }])).usages.has('U303'));
    assert.equal((await scanner.scan([root], [{ filePath: path.join(temporary, 'unrelated.txt'), text: 'MOV U304 1' }])).usages.has('U304'), false);
    write('Mir200/Envir/Market_Def/main.txt', 'MOV U305 1');
    scanner.invalidate(file);
    assert.ok((await scanner.scan([root])).usages.has('U305'));
    fs.renameSync(file, path.join(scripts, 'renamed.txt'));
    const renamed = await scanner.scan([root]);
    assert.equal(renamed.occurrences.get('U305')[0].file, path.join(scripts, 'renamed.txt'));
    fs.unlinkSync(path.join(scripts, 'renamed.txt'));
    assert.equal((await scanner.scan([root])).usages.has('U305'), false);

    const originalRead = fs.promises.readFile;
    const unreadable = write('Mir200/Envir/Market_Def/unreadable.txt', 'MOV U499 1');
    try {
      fs.promises.readFile = async function(target, ...args) {
        if (target === unreadable) throw Object.assign(new Error('fixture read denied'), { code: 'EACCES' });
        return originalRead.call(this, target, ...args);
      };
      const partial = await scanner.scan([root]);
      assert.equal(partial.errors.length, 1);
      assert.ok(partial.errors[0].includes('unreadable.txt'));
      assert.ok(partial.usages.has('N$中文1'), 'one unreadable file must not discard other results');
      assert.equal(partial.usages.has('U499'), false);
    } finally { fs.promises.readFile = originalRead; }
    assert.ok((await scanner.scan([root])).usages.has('U499'), 'read errors are retried');

    let configValue = '2';
    const externalScanner = new VariableListScanner({ nestedOptions: () => ({
      resolveConfigValues: () => ({ values: [configValue], complete: true }),
    }) });
    write('Mir200/Envir/Market_Def/dependent.txt', 'READCONFIGFILEITEM data.ini setup slot N$idx\nMOV U2<$STR(N$idx)> 1');
    assert.ok((await externalScanner.scan([root])).usages.has('U22'));
    configValue = '3';
    assert.ok((await externalScanner.scan([root])).usages.has('U23'), 'dependency changed while script was unchanged');
    assert.equal(await scanner.scan([root], [], () => true), undefined);
    assert.equal((await scanner.scan([])).usages.size, 0);
    console.log('variable-list.test.js: PASS (extraction, encodings, scope, snapshots, cache, dependencies, map exclusion, navigation)');
  } finally {
    removeTemporaryDirectory(temporary);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
