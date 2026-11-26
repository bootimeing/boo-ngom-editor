const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { VariableListScanner, analyzeVariableListFile, isCatalogSystemField, variableListScanRoots, recordVariableListUsage, variableListSourceSummary } = require('../out/utils/variable-list');
const { findScriptVariables } = require('../out/utils/variable-statistics');
const { findMapCodeRangesInText } = require('../out/utils/map-code-context');

async function main() {
  const { indexes } = require('../tools/data-maintenance/runtime-audit-catalog').loadAuditCatalog();
  const systemReads = '<$C.GameGold> <$h.hp> <$NO.HP> <$C..HP> <$CUSTJOBABIL[109]> <$CUSTJOBABIL> <$ATTR[8]> <$H.ATTR[8]> <$H.USEITEMNAME[1]> <$H.HP[1]> <$CUSTJOBABIL[]> <$CUSTJOBABIL[X]> <$CUSTJOBABIL[1]';
  const script = ['[@main]', '#SAY', systemReads, '<$C.GameGold> <$STR(N$Quest)> <$U31> <$FLAG(32)> <$FLAG> <$HUMAN(Points)>',
    '<$ATTR[238]> <$ATTR[239]> <$ATTR[237]> <$USEITEMNAME[1]> <$USEITEM[71]> <$USEITEMID[71]> <$FORMULATION[2+3]>', '; <$C.GameGold>'].join('\r\n');
  for (const [engine, expected] of [
    ['GOM', ['<$C.GAMEGOLD>', '<$H.HP>', '<$CUSTJOBABIL[109]>', '<$C.GAMEGOLD>', '<$ATTR[238]>', '<$ATTR[239]>']],
    ['GEE', ['<$C.GAMEGOLD>', '<$C.GAMEGOLD>']],
    ['996PC', ['<$C.GAMEGOLD>', '<$H.HP>', '<$CUSTJOBABIL[109]>', '<$ATTR[8]>', '<$H.ATTR[8]>', '<$H.USEITEMNAME[1]>', '<$C.GAMEGOLD>',
      '<$ATTR[238]>', '<$ATTR[239]>', '<$ATTR[237]>', '<$USEITEMNAME[1]>', '<$USEITEM[71]>', '<$USEITEMID[71]>']],
  ]) {
    const options = { engine: () => engine, systemField: (name, indexed) => isCatalogSystemField(indexes[engine], name, indexed) };
    const analysis = analyzeVariableListFile(script, 'field-reads.txt', options);
    const fields = analysis.variables.filter(row => row.type === '系统字段读取');
    assert.deepEqual(fields.map(row => row.name), expected, engine);
    for (const row of fields) assert.equal(script.slice(row.source.start, row.source.end), row.source.expression);
    for (const name of ['N$Quest','U31']) assert.equal(analysis.variables.filter(row => row.name === name).length, 1, engine + name);
    if (engine === 'GOM') {
      assert.equal(analysis.variables.filter(row => row.name === '[32]').length, 1);
      assert.equal(analysis.variables.filter(row => row.name === 'HUMAN(Points)').length, 1);
    }
  }
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

    const sourcesFile = write('Mir200/Envir/Market_Def/sources.txt', [
      'MOV U30 1',
      'READCONFIGFILEITEM slots.ini setup choices N$choice',
      'EQUAL U<$STR(N$choice)> 0',
      'MOV N$fixed 30',
      'EQUAL U<$STR(N$fixed)> 0',
      'EQUAL U<$STR(N$unknown)> 0',
      'SET [101] 1',
      'CHECK [<$STR(N$choice)>] 1',
      'CHECK [<$STR(N$fixed)>] 1',
      'RESET [41] 3',
    ].join('\n'));
    const sourceScanner = new VariableListScanner({ nestedOptions: () => ({
      resolveConfigValues: request => request.path === 'slots.ini' ? { values: ['30', '40'], complete: true } : undefined,
    }) });
    const sources = await sourceScanner.scan([path.dirname(sourcesFile)], [{ filePath: sourcesFile, text: fs.readFileSync(sourcesFile).toString('utf8') }]);
    const u30 = sources.usages.get('U30');
    assert.equal(u30.count, 3, 'one direct token and two dynamic source expressions are three references, not executions');
    assert.equal(u30.directCount, 1);
    assert.equal(u30.inferredCount, 1);
    assert.equal(u30.possibleCount, 1, 'complete multi-value domain is still a possible reference to each slot');
    assert.equal(sources.usages.get('U40').count, 1, 'expanding one expression must not multiply its per-slot reference count');
    assert.equal(sources.usages.get('U40').possibleCount, 1);
    const possible = sources.occurrences.get('U40').find(item => item.file === sourcesFile);
    assert.equal(possible.line, 2);
    assert.equal(possible.source.kind, 'possible');
    assert.equal(possible.source.expression, 'U<$STR(N$choice)>');
    assert.equal(possible.source.status, 'resolved', 'complete value set must not be confused with a single definite slot');
    assert.ok(possible.source.reasons.some(reason => reason.includes('多个') || reason.includes('可能编号')));
    const inferred = sources.occurrences.get('U30').find(item => item.source.kind === 'inferred');
    assert.equal(inferred.source.expression, 'U<$STR(N$fixed)>');
    assert.equal(sources.usages.get('U<$STR(N$unknown)>').unknownCount, 1);
    assert.equal(sources.usages.get('[101]').directCount, 1, 'static flag is a direct reference');
    assert.equal(sources.usages.get('[30]').possibleCount, 1);
    assert.equal(sources.usages.get('[30]').inferredCount, 1);
    for (const flag of ['[41]', '[42]', '[43]']) assert.equal(sources.usages.get(flag).directCount, 1, 'static RESET range names every affected flag');
    const legacyUsage = new Map();
    recordVariableListUsage(legacyUsage, 'u003', sourcesFile, () => ({ count: 0, files: new Set() }));
    assert.equal(legacyUsage.get('U3').directCount, 1, 'callers without metadata retain direct-reference semantics');
    assert.equal(variableListSourceSummary(legacyUsage.get('U3')), '直接引用 1处');

    const semanticFile = write('Mir200/Envir/Market_Def/semantic/scopes.txt', [
      '#ACT',
      'VAR INTEGER HUMAN QQQQ',
      'CALCVAR HUMAN QQQQ + 5',
      'LOADVAR HUMAN QQQQ VARSAVE.TXT',
      'SAVEVAR HUMAN QQQQ VARSAVE.TXT',
      '#SAY',
      '<$HUMAN(QQQQ)> <$GUILD(QQQQ)>',
      'VAR INTEGER HUMAN 展示示例',
      '#ACT',
      'VAR INTEGER GUILD QQQQ',
      'CALCVAR GUILD QQQQ = 100',
      'SAVEVAR GUILD QQQQ guild.txt',
      'LOADVAR GUILD LOADONLY guild.txt',
      'VAR INTEGER HUMAN U3',
      'SENDMSG 6 <$HUMAN(U3)>',
      'CLEARVAR S0 5',
      '#ELSEACT CLEARVAR S003 2',
      'CLEARVAR U20 5',
      '#SAY',
      'CLEARVAR S20 5',
      '; CALCVAR HUMAN 注释 + 5',
      '// CLEARVAR S30 5',
    ].join('\n'), 'utf8');
    let semanticEngine = 'GOM';
    const semanticScanner = new VariableListScanner({ engine: () => semanticEngine });
    const semanticRoot = path.dirname(semanticFile);
    const gom = await semanticScanner.scan([semanticRoot]);
    assert.equal(gom.usages.get('HUMAN(QQQQ)').count, 5);
    assert.equal(gom.usages.get('HUMAN(QQQQ)').directCount, 5);
    assert.equal(gom.usages.get('HUMAN(QQQQ)').type, 'HUMAN命名变量');
    assert.equal(gom.usages.get('HUMAN(U3)').count, 2);
    assert.equal(gom.usages.get('GUILD(QQQQ)').count, 4);
    assert.equal(gom.usages.get('GUILD(LOADONLY)').count, 1);
    for (const name of ['QQQQ', 'HUMAN(展示示例)', 'HUMAN(注释)', 'U3', 'S21', 'S30', 'U21']) assert.equal(gom.usages.has(name), false, name);
    for (const name of ['S0', 'S1', 'S2']) assert.equal(gom.usages.get(name).count, 1, 'CLEARVAR starting token must not be double-counted');
    for (const name of ['S3', 'S4']) assert.equal(gom.usages.get(name).count, 2, 'each command position contributes one range reference');
    assert.equal(gom.occurrences.get('S4')[0].line, 15);
    assert.ok(gom.occurrences.get('S4')[0].source.reasons.some(reason => reason.includes('CLEARVAR')));
    semanticEngine = 'GEE';
    const gee = await semanticScanner.scan([semanticRoot]);
    assert.equal(gee.usages.get('GUILD(QQQQ)').count, 4);
    assert.equal(gee.usages.get('GUILD(QQQQ)').type, 'GUILD命名变量');
    assert.equal(gee.usages.get('HUMAN(QQQQ)').count, 5, 'equal bare names in different scopes stay distinct');
    assert.equal(gee.usages.has('GUILD(LOADONLY)'), false);
    semanticEngine = '996PC';
    const pc = await semanticScanner.scan([semanticRoot]);
    assert.equal([...pc.usages.keys()].some(name => /^(?:HUMAN|GUILD)\(/.test(name)), false, 'new scoped semantics never leak into 996PC');
    assert.equal(pc.usages.has('S1'), false, 'implicit ranges require engine-specific evidence');
    assert.equal(pc.usages.has('U3'), false, 'a named HUMAN variable called U3 is not an ordinary U3 token');
    const special = 'N$荧惑·战乱〩ろ';
    const fixtures = [
      ['MapQuest.txt', 'N3 [99] 1 怪物 * 任务', '[99]'],
      ['MapEvent.txt', 'N3 3 4 0 98:1 4:*:0 0 1:@通知', '[98]'],
      ['MapInfo.txt', '[U3 地图] NEEDSET_ON(97) NEEDSET_OFF(96) NORECONNECT(T8)\nU3 1 2 -> N3 3 4', '[97]'],
      ['GroupItemList.txt', ['U3','名','0','0','0','0','0','0',special+',1,0,0'].join('\t'), special],
    ];
    for (const [file, content] of fixtures) write('Mir200/Envir/' + file, content, 'utf8-bom');
    write('Mir200/Envir/Market_Def/metadata.ini', '[配置]\nsample=SET [723] 1\nvalue=<$STR(N$模板)>', 'utf8-bom');
    const cfg = await new VariableListScanner({ systemField: name => name === 'REALUSERNAME' }).scan([root], [{
      filePath: path.join(scripts, 'scope-test.txt'),
      text: '#ACT\nVAR STRING GLOBAL 排名\nMOV GD$活动 x\n#IF\nNOT CHECKVAR GLOBAL 排名 = 测试\n#SAY\n<$GLOBAL(排名)> <$REALUSERNAME>',
    }]);
    for (const [file, content, name] of fixtures) {
      const occurrence = cfg.occurrences.get(name).find(o => path.basename(o.file) === file);
      assert.ok(occurrence && content.slice(occurrence.source.start, occurrence.source.end) === occurrence.source.expression, name);
    }
    assert.ok([96, 97, 98, 99].every(n => cfg.candidates.personalFlags.has(n)));
    for (const engine of ['GEE', '996PC']) {
      const configScanner = new VariableListScanner({ engine: () => engine });
      const config = await configScanner.scan([envir], [{
        filePath: path.join(envir, 'MapEvent.txt'),
        text: '3 333 333 0 800:1 4:*:0 0 1:@走路\n3 333 333 0 801:0 4:*:0 0 1:@越界\n3 333 333 0 -1:0 4:*:0 0 1:@忽略',
      }]);
      for (const n of [96, 97, 99, 800]) {
        assert.ok(config.candidates.personalFlags.has(n) && config.usages.has('[' + n + ']'), engine + ' ' + n);
      }
      assert.ok(!config.occurrences.get('[801]')?.some(o => path.basename(o.file) === 'MapEvent.txt'));
      assert.ok(!config.occurrences.get(special)?.some(o => path.basename(o.file) === 'GroupItemList.txt'));
    }
    assert.ok(!cfg.candidates.personalFlags.has(723) && cfg.usages.has('N$模板'));
    assert.equal(cfg.occurrences.get('U3')?.some(o => path.dirname(o.file) === envir) || false, false);
    assert.equal(cfg.usages.get('GLOBAL(排名)').count, 3);
    assert.equal(cfg.usages.get('GD$活动').count, 1);
    assert.equal(cfg.usages.get('<$REALUSERNAME>').type, '系统字段读取');
    assert.deepEqual([...findScriptVariables('GD$活动', 'GEE')], []);
    assert.equal(await scanner.scan([root], [], () => true), undefined);
    assert.equal((await scanner.scan([])).usages.size, 0);
    console.log('variable-list.test.js: PASS (extraction, encodings, scope, snapshots, cache, dependencies, map exclusion, source layers, named scopes, CLEARVAR, navigation)');
  } finally {
    removeTemporaryDirectory(temporary);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
