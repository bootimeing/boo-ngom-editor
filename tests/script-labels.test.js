const assert = require('node:assert/strict');

function main() {
  const {
    findAtLabelTokenAt,
    findScriptLabelDefinitions,
    findScriptLabelReferences,
    findScriptLabelReferencesInText,
    findUndefinedScriptLabelReferences,
    isSectionedScriptDataDocument,
    normalizeScriptLabelKey,
  } = require('../out/utils/script-labels');

  const line = '<测试/@_@神秘代码#> GOTO @sfjdkjhs*';
  const references = findScriptLabelReferences(line);
  assert.deepEqual(references.map(reference => reference.name), ['_@神秘代码#', 'sfjdkjhs*']);
  assert.deepEqual(references.map(reference => reference.kind), ['ui', 'goto']);
  assert.equal(line.slice(references[0].nameStart, references[0].end), '_@神秘代码#');
  assert.equal(line.slice(references[1].nameStart, references[1].end), 'sfjdkjhs*');

  const input = findScriptLabelReferences('<输入/@@InputString12(请输入)>');
  assert.equal(input[0].rawName, '@InputString12');
  assert.equal(input[0].name, 'InputString12');

  const doubleAt = findScriptLabelReferences('<创建行会/@@donate>');
  assert.equal(doubleAt[0].name, '@donate');

  assert.deepEqual(findScriptLabelReferences('; GOTO @不存在*'), []);
  assert.deepEqual(findScriptLabelReferences('// GOTO @不存在*'), []);
  assert.equal(findAtLabelTokenAt('SEC 1 @_@神秘代码#', 14), '_@神秘代码#');
  assert.equal(findAtLabelTokenAt('SEC 1 @sfjdkjhs*', 16), 'sfjdkjhs*');

  const text = '[@_@神秘代码#]\r\n<测试/@_@神秘代码#>\r\n[@sfjdkjhs*]\nGOTO @sfjdkjhs*';
  const textReferences = findScriptLabelReferencesInText(text);
  assert.equal(textReferences.length, 2);
  assert.equal(text.slice(textReferences[0].nameStart, textReferences[0].end), '_@神秘代码#');
  assert.equal(text.slice(textReferences[1].nameStart, textReferences[1].end), 'sfjdkjhs*');

  const defined = new Set([
    normalizeScriptLabelKey('_@神秘代码#'),
    normalizeScriptLabelKey('sfjdkjhs*'),
    normalizeScriptLabelKey('InputString12'),
    normalizeScriptLabelKey('@donate'),
  ]);
  assert.deepEqual(findUndefinedScriptLabelReferences(text.split(/\r?\n/), defined), []);
  assert.deepEqual(
    findUndefinedScriptLabelReferences(['GOTO @确实不存在*'], defined).map(reference => reference.name),
    ['确实不存在*']
  );
  assert.deepEqual(findUndefinedScriptLabelReferences(['<按钮/@123>'], defined), []);
  assert.deepEqual(findUndefinedScriptLabelReferences(['<按钮/@<$STR(S$标签)>>'], defined), []);
  assert.deepEqual(
    findUndefinedScriptLabelReferences(['GOTO @engineDefault'], new Set(), {
      isAdditionalDefinedLabel: (key) => key === 'ENGINEDEFAULT'
    }).map(reference => reference.name),
    []
  );
  assert.deepEqual(
    findUndefinedScriptLabelReferences(['GOTO @engineDefault'], new Set(), {
      isAdditionalDefinedLabel: () => false
    }).map(reference => reference.name),
    ['engineDefault']
  );

  const commentedDuplicate = [
    ';[@开始经验合成]',
    '//[@开始经验合成]',
    'SENDMSG 6 示例写法：[@开始经验合成]',
    '[@开始经验合成]',
  ];
  assert.deepEqual(
    findScriptLabelDefinitions(commentedDuplicate).map(definition => definition.line),
    [3],
    'comments and inline examples must not participate in duplicate-definition diagnostics'
  );

  const sectionedData = [
    '[0]',
    '地图1显示=<ImgEx:39:80:91:102:347:372|151#地图/@地图1传送>',
    '[1]',
    '地图1显示=<ImgEx:39:80:91:102:10:190|151#地图/@地图1传送>',
  ];
  assert.equal(isSectionedScriptDataDocument(sectionedData), true);
  assert.deepEqual(
    findUndefinedScriptLabelReferences(sectionedData, new Set(), {
      engine: '996PC',
      skipSectionedDataDocuments: true,
    }),
    [],
    'sectioned config values can carry labels that are resolved by their consuming script'
  );

  const pc996Native = [
    '<创建行会/@@buildguildnow>',
    '<行会战争/@@guildwar>',
    '<取款/@@withdrawal>',
    '<存款/@@receipts>',
    '<修复城门/@repairdoornow>',
    '<修复城墙/@repairwallnow3>',
    '<聘请守卫/@hireguardnow4>',
    '<聘请弓箭手/@hirearchernow12>',
    '<真正拼错/@hirearchernow13>',
  ];
  assert.deepEqual(
    findUndefinedScriptLabelReferences(pc996Native, new Set(), { engine: '996PC' })
      .map(reference => reference.name),
    ['hirearchernow13'],
    '996PC native castle and guild handlers must be allowed without hiding nearby typos'
  );

  const officialLfmLabels = [
    '<沙城公告/@CASTLENAME>',
    '<沙城公告/@sendmsg>',
    '<沙城公告/@@sendMsg>',
    '<沙城公告/@@CASTLENAME>',
    '<行会/@@buildguildnow>',
    '<沙城宣言/@@guildwar>',
    '<城门/@@withdrawal>',
    '<城门/@@receipts>',
    '<离线挂机/@@offlinemsg>',
    '<反馈/@@donate>',
    '<元宝交易/@@dealybme>',
    '<元宝交易/@@dealgold>',
    '<改名/@@useitemname0>',
    '<改名/@@useitemname10>',
    '<改名/@@useitemname12>',
    '<行会战争/@@COPYTOCLIPBOARD1>',
    '<行会战争/@@INPUTINTEGER2>',
    '<行会战争/@@INPUTINTEGER300>',
    '<行会战争/@@INPUTSTRING10>',
    '<行会战争/@@INPUTSTRING60>',
    '<行会战争/@@INPUTSTRING61>',
    '<行会战争/@@INPUTSTRING62>',
    '<行会战争/@@INPUTSTRING63>',
    '<行会战争/@@buildGuildNow>',
    '<行会战争/@@GuildWar>',
  ];
  assert.deepEqual(
    findUndefinedScriptLabelReferences(officialLfmLabels, new Set(), {
      engine: 'GEE',
    }).map(reference => reference.name),
    [],
    'GEE official double-at labels should not be flagged'
  );
  assert.deepEqual(
    findUndefinedScriptLabelReferences(officialLfmLabels, new Set(), {
      engine: 'GOM',
    }).map(reference => reference.name),
    [],
    'GOM official double-at labels should not be flagged'
  );
  assert.deepEqual(
    findUndefinedScriptLabelReferences(officialLfmLabels, new Set(), {
      engine: '996PC',
    }).map(reference => reference.name),
    [],
    '996PC should also allow official double-at labels when they appear in scripts'
  );

  console.log('script-labels.test.js: PASS');
}

main();
