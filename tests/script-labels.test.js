const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const {
    findAtLabelTokenAt,
    findScriptCommandCallbackAt,
    findScriptCommandCallbackReferences,
    findScriptLabelDefinitions,
    findScriptLabelReferences,
    findScriptLabelReferencesInText,
    findUndefinedScriptLabelReferences,
    isSectionedScriptDataDocument,
    normalizeScriptLabelKey,
  } = require('../out/utils/script-labels');
  const {
    findScriptLabelInFirstAvailableCandidate,
    findScriptLabelInPrimaryOrFallbackCandidates,
    findScriptLabelPosition,
  } = require('../out/utils/robot-definition');
  const {
    buildQuickFileCandidates,
    QUICK_FILE_DEFINITIONS,
  } = require('../out/utils/quick-files');

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

  const timerLine = '  SetOnTimer 7 30 ; 七号定时器';
  const timer = findScriptCommandCallbackAt(
    timerLine,
    timerLine.indexOf('7'),
    'GOM'
  );
  assert.equal(timer.kind, 'timer');
  assert.equal(timer.command, 'SETONTIMER');
  assert.equal(timer.id, '7');
  assert.equal(timer.label, 'OnTimer7');
  assert.equal(timer.targetFileName, 'QManage.txt');
  assert.equal(timerLine.slice(timer.commandSpan.start, timer.commandSpan.end), 'SetOnTimer');
  assert.equal(timerLine.slice(timer.idSpan.start, timer.idSpan.end), '7');
  assert.equal(
    findScriptCommandCallbackAt(timerLine, timerLine.indexOf('SetOnTimer') + 2, 'GOM')?.label,
    'OnTimer7',
    'the command token itself should be navigable'
  );
  assert.equal(
    findScriptCommandCallbackAt(timerLine, timerLine.indexOf('30'), 'GOM'),
    undefined,
    'the interval argument must not become a callback link'
  );
  assert.equal(
    findScriptCommandCallbackAt(timerLine, timerLine.indexOf('SetOnTimer') + 'SetOnTimer'.length, 'GOM'),
    undefined,
    'the whitespace immediately after the command must not become a callback link'
  );
  assert.equal(
    findScriptCommandCallbackAt(timerLine, timerLine.indexOf('7') + 1, 'GOM'),
    undefined,
    'the whitespace immediately after the timer ID must not become a callback link'
  );
  assert.equal(
    findScriptCommandCallbackAt('#ACT(SetOnTimer 007 30)', 6, '996PC')?.label,
    'OnTimer7',
    'directive-wrapped static IDs should be normalized to the engine callback label'
  );
  assert.equal(findScriptCommandCallbackReferences('SETONTIMER 255 1', 'GEE')[0]?.label, 'OnTimer255');
  assert.deepEqual(findScriptCommandCallbackReferences('SETONTIMER 256 1', 'GEE'), []);

  const addButtonLine = 'ADDBUTTON 3 17 283 284 285 10 200 1 -1 253/按钮';
  const button = findScriptCommandCallbackAt(
    addButtonLine,
    addButtonLine.indexOf('17'),
    'GEE'
  );
  assert.equal(button.kind, 'button');
  assert.equal(button.command, 'ADDBUTTON');
  assert.equal(button.id, '17');
  assert.equal(button.label, 'ButtonClick17');
  assert.equal(button.targetFileName, 'QFunction-0.txt');
  assert.equal(addButtonLine.slice(button.idSpan.start, button.idSpan.end), '17');
  assert.equal(
    findScriptCommandCallbackAt(addButtonLine, addButtonLine.indexOf('3'), 'GEE'),
    undefined,
    'the first AddButton argument is WIL, not the callback ID'
  );
  assert.equal(
    findScriptCommandCallbackAt(addButtonLine, addButtonLine.indexOf('ADDBUTTON') + 2, 'GEE')?.label,
    'ButtonClick17',
    'the AddButton command token itself should be navigable'
  );
  assert.equal(
    findScriptCommandCallbackAt(addButtonLine, addButtonLine.indexOf('17') - 1, 'GEE'),
    undefined,
    'the whitespace before the AddButton callback ID must not become a callback link'
  );
  assert.equal(
    findScriptCommandCallbackAt(addButtonLine, addButtonLine.indexOf('17') + 2, 'GEE'),
    undefined,
    'the whitespace after the AddButton callback ID must not become a callback link'
  );
  assert.equal(findScriptCommandCallbackReferences('addbutton 3 100 1 2 3 4 5', 'GOM')[0]?.label, 'ButtonClick100');
  assert.deepEqual(findScriptCommandCallbackReferences('addbutton 3 101 1 2 3 4 5', 'GOM'), []);
  assert.equal(findScriptCommandCallbackReferences('addbutton 3 200 1 2 3 4 5', 'GEE')[0]?.label, 'ButtonClick200');
  assert.deepEqual(findScriptCommandCallbackReferences('addbutton 3 201 1 2 3 4 5', 'GEE'), []);
  assert.deepEqual(findScriptCommandCallbackReferences('addbutton 3 0 1 2 3 4 5', '996PC'), []);
  assert.equal(findScriptCommandCallbackReferences('addbutton 3 100 1 2 3 4 5', '996PC')[0]?.label, 'ButtonClick100');
  assert.deepEqual(findScriptCommandCallbackReferences('addbutton 3 101 1 2 3 4 5', '996PC'), []);

  const addDlgLine = 'adddlg 8 0 49 0 70:228 0:0 3 @特殊装备1';
  const addDlgTargetStart = addDlgLine.indexOf('@特殊装备1');
  const addDlg = findScriptCommandCallbackAt(addDlgLine, addDlgTargetStart, 'GOM');
  assert.equal(addDlg.kind, 'addDlg');
  assert.equal(addDlg.command, 'ADDDLG');
  assert.equal(addDlg.id, '特殊装备1');
  assert.equal(addDlg.label, '特殊装备1');
  assert.equal(addDlg.targetFileName, 'QFunction-0.txt');
  assert.equal(addDlgLine.slice(addDlg.commandSpan.start, addDlg.commandSpan.end), 'adddlg');
  assert.equal(addDlgLine.slice(addDlg.idSpan.start, addDlg.idSpan.end), '@特殊装备1');
  assert.equal(
    findScriptCommandCallbackAt(addDlgLine, addDlgLine.indexOf('adddlg') + 2, 'GOM')?.label,
    '特殊装备1',
    'the GOM AddDlg command token itself should be navigable'
  );
  assert.equal(
    findScriptCommandCallbackAt(
      '#ACT(AddDlg 8 0 49 0 70:228 0:0 3 @特殊装备1)',
      '#ACT(AddDlg'.indexOf('AddDlg') + 2,
      'GOM'
    )?.label,
    '特殊装备1',
    'directive-wrapped GOM AddDlg should preserve the direct QF field'
  );
  assert.equal(
    findScriptCommandCallbackAt(addDlgLine, addDlgTargetStart + '@特殊装备1'.length - 1, 'GOM')?.label,
    '特殊装备1',
    'the complete static AddDlg QF field should be navigable'
  );
  assert.equal(
    findScriptCommandCallbackAt(addDlgLine, addDlgLine.indexOf('3'), 'GOM'),
    undefined,
    'AddDlg arguments other than the eighth QF field must not become definition links'
  );
  assert.equal(
    findScriptCommandCallbackAt(addDlgLine, addDlgTargetStart - 1, 'GOM'),
    undefined,
    'the whitespace before the AddDlg QF field must not become a definition link'
  );
  assert.equal(
    findScriptCommandCallbackAt(addDlgLine, addDlgLine.length, 'GOM'),
    undefined,
    'the AddDlg QF field span must remain half-open at the end of the line'
  );

  const extendedAddDlgLine = 'AddDlg 8 0 49 0 70:228 0:0 3 @特殊装备1 0:0 1:2:2:1:300';
  const extendedAddDlg = findScriptCommandCallbackReferences(extendedAddDlgLine, 'GOM')[0];
  assert.equal(extendedAddDlg.label, '特殊装备1');
  assert.equal(
    extendedAddDlgLine.slice(extendedAddDlg.idSpan.start, extendedAddDlg.idSpan.end),
    '@特殊装备1',
    'optional AddDlg arguments 9 and 10 must not displace the eighth QF field'
  );
  assert.equal(
    findScriptCommandCallbackAt(
      extendedAddDlgLine,
      extendedAddDlgLine.indexOf('0:0', extendedAddDlg.idSpan.end),
      'GOM'
    ),
    undefined,
    'AddDlg argument 9 must not inherit the QF field definition link'
  );
  assert.deepEqual(
    findScriptCommandCallbackReferences(addDlgLine, 'GEE'),
    [],
    'GEE AddDlg argument 8 is inline content, not a GOM QF label'
  );
  assert.deepEqual(
    findScriptCommandCallbackReferences(addDlgLine, '996PC'),
    [],
    '996PC must not borrow the new GOM AddDlg QF-label semantics'
  );

  for (const ignored of [
    'AddDlg 8 0 49 0 70:228 0:0 3 特殊装备1',
    'AddDlg 8 0 49 0 70:228 0:0 3 @',
    'AddDlg 8 0 49 0 70:228 0:0 3 @<$STR(S$QF)>',
    'AddDlgEx 8 0 49 0 70:228 0:0 3 @特殊装备1',
    'MyAddDlg 8 0 49 0 70:228 0:0 3 @特殊装备1',
    '; AddDlg 8 0 49 0 70:228 0:0 3 @特殊装备1',
    '// AddDlg 8 0 49 0 70:228 0:0 3 @特殊装备1',
    'SENDMSG 6 示例：AddDlg 8 0 49 0 70:228 0:0 3 @特殊装备1',
    '#SAY AddDlg 8 0 49 0 70:228 0:0 3 @特殊装备1',
    '#IF(AddDlg 8 0 49 0 70:228 0:0 3 @特殊装备1)',
    '#OR(AddDlg 8 0 49 0 70:228 0:0 3 @特殊装备1)',
  ]) {
    assert.deepEqual(
      findScriptCommandCallbackReferences(ignored, 'GOM'),
      [],
      `must not infer a GOM AddDlg QF label from: ${ignored}`
    );
  }

  for (const ignored of [
    '; SetOnTimer 7 30',
    '// SetOnTimer 7 30',
    '; AddButton 3 17 283 284 285 10 200',
    '// AddButton 3 17 283 284 285 10 200',
    'SENDMSG 6 示例：AddButton 3 17 283 284 285',
    'SetOnTimerEx 7 300 1',
    'ResetOnTimer 7 30',
    'MySetOnTimer 7 30',
    '#IF(SetOnTimer 7 30)',
    '#SAY SetOnTimer 7 30',
    '#SAY(SetOnTimer 7 30)',
    'AddButtonEx 17|10|20|0 3 283|284|285',
    'AddArrButton 1 17 3 283 284 285',
    'MyAddButton 3 17 283 284 285',
    '#OR(AddButton 3 17 283 284 285)',
    '#SAY AddButton 3 17 283 284 285',
    '#ELSESAY(AddButton 3 17 283 284 285)',
    'SetOnTimer N0 30',
    'SetOnTimer <$STR(N$ID)> 30',
    'AddButton 3 N0 283 284 285',
    'AddButton 3 <$STR(N$ID)> 283 284 285',
    'AddButton 3 -1 283 284 285',
    'AddButton 3',
  ]) {
    assert.deepEqual(
      findScriptCommandCallbackReferences(ignored, 'GEE'),
      [],
      `must not infer a static callback from: ${ignored}`
    );
  }

  const assistant = fs.readFileSync('src/assistant.ts', 'utf8');
  const callbackBranch = assistant.indexOf('// SetOnTimer/AddButton 的静态触发编号与新 GOM AddDlg');
  const ordinaryLabelBranch = assistant.indexOf('const scriptLabelReferences = findScriptLabelReferences(line);');
  assert.ok(callbackBranch >= 0 && ordinaryLabelBranch > callbackBranch);
  const callbackProviderSource = assistant.slice(callbackBranch, ordinaryLabelBranch);
  assert.match(callbackProviderSource, /getConfiguration\('boo', document\.uri\)/);
  assert.match(callbackProviderSource, /callbackContext\.inSay \|\| callbackContext\.inCondition/);
  assert.match(callbackProviderSource, /findScriptCommandCallbackAt\(line, charPos, callbackEngine\)/);
  assert.match(
    callbackProviderSource,
    /findScriptCommandCallbackTarget\(document, commandCallback, cancellationToken\)/
  );
  assert.doesNotMatch(callbackProviderSource, /showWarningMessage|createMissingFile|writeFile/);
  assert.match(assistant, /buildQuickFileCandidates\([\s\S]*sourceDocument\.uri\.fsPath/);
  assert.match(assistant, /findScriptLabelInFirstAvailableCandidate\([\s\S]*callback\.label/);
  assert.match(
    assistant,
    /callback\.kind === 'button' \|\| callback\.kind === 'addDlg'[\s\S]*findEnvirRootForPath\(sourceDocument\.uri\.fsPath\)[\s\S]*return findQFunctionCallbackTargets\(envirRoot, callback, cancellationToken\)/,
    'AddButton and new GOM AddDlg must share the same source-Envir-scoped QFunction/QD resolver'
  );
  assert.match(
    assistant,
    /findScriptLabelInPrimaryOrFallbackCandidates\([\s\S]*findQuestDiaryTextFiles/,
    'AddButton must prefer QFunction and lazily fall back to QuestDiary'
  );
  assert.match(
    assistant,
    /RelativePattern\([\s\S]*questDiaryRoot[\s\S]*'\*\*\/\*\.\[tT\]\[xX\]\[tT\]'/,
    'QuestDiary discovery must recurse through every subdirectory and include .txt case variants'
  );
  assert.match(assistant, /workspace\.fs\.readFile\(candidateUri\)/);
  assert.match(assistant, /mergeQuestDiaryTextFileCandidates\(/);

  const candidateReads = [];
  const missingInAuthoritativeTarget = await findScriptLabelInFirstAvailableCandidate(
    ['current-qmanage', 'other-server-qmanage'],
    'OnTimer7',
    async candidate => {
      candidateReads.push(candidate);
      return candidate === 'current-qmanage'
        ? { value: candidate, text: '[@OtherTimer]\r\n' }
        : { value: candidate, text: '[@OnTimer7]\r\n' };
    }
  );
  assert.equal(missingInAuthoritativeTarget, undefined);
  assert.deepEqual(
    candidateReads,
    ['current-qmanage'],
    'a missing label in the authoritative file must not fall through to another server'
  );

  const fallbackReads = [];
  const fallback = await findScriptLabelInFirstAvailableCandidate(
    ['missing-qmanage', 'current-qmanage'],
    'OnTimer7',
    async candidate => {
      fallbackReads.push(candidate);
      return candidate === 'missing-qmanage'
        ? undefined
        : { value: candidate, text: '\uFEFF  [@ontimer7]\r\n' };
    }
  );
  assert.equal(fallback.value, 'current-qmanage');
  assert.deepEqual(fallback.position, { line: 0, character: 3 });
  assert.deepEqual(fallbackReads, ['missing-qmanage', 'current-qmanage']);

  let primaryFallbackCalls = 0;
  const primaryReads = [];
  const primaryMatch = await findScriptLabelInPrimaryOrFallbackCandidates(
    'current-qfunction',
    async () => {
      primaryFallbackCalls += 1;
      return ['QuestDiary/不应读取.txt'];
    },
    'ButtonClick17',
    async candidate => {
      primaryReads.push(candidate);
      return { value: candidate, text: '  [@buttonclick17]\r\n#ACT\r\n' };
    }
  );
  assert.deepEqual(primaryMatch, [{
    value: 'current-qfunction',
    position: { line: 0, character: 2 },
  }]);
  assert.equal(primaryFallbackCalls, 0, 'a primary QFunction hit must not enumerate QuestDiary');
  assert.deepEqual(primaryReads, ['current-qfunction']);

  const orderedFallbacks = [
    'QuestDiary/一级/二级/按钮-a.txt',
    'QuestDiary/一级/无关.txt',
    'QuestDiary/另一级/三级/按钮-b.txt',
  ];
  const fallbackCandidateReads = [];
  const fallbackMatches = await findScriptLabelInPrimaryOrFallbackCandidates(
    'current-qfunction',
    async () => orderedFallbacks,
    'ButtonClick17',
    async candidate => {
      fallbackCandidateReads.push(candidate);
      const texts = {
        'current-qfunction': '[@OtherCallback]\r\n',
        [orderedFallbacks[0]]: '#ACT\r\n  [@ButtonClick17]\r\n',
        [orderedFallbacks[1]]: '[@ButtonClick18]\r\n',
        [orderedFallbacks[2]]: '\uFEFF [@buttonclick17]\n',
      };
      return { value: candidate, text: texts[candidate] };
    }
  );
  assert.deepEqual(
    fallbackCandidateReads,
    ['current-qfunction', ...orderedFallbacks],
    'fallback candidates must be read in the supplier order after the primary misses'
  );
  assert.deepEqual(fallbackMatches, [
    { value: orderedFallbacks[0], position: { line: 1, character: 2 } },
    { value: orderedFallbacks[2], position: { line: 0, character: 2 } },
  ], 'all deep QuestDiary matches must be returned in stable input order');

  const missingPrimaryMatch = await findScriptLabelInPrimaryOrFallbackCandidates(
    'missing-qfunction',
    async () => ['QuestDiary/深层/按钮.txt'],
    'ButtonClick17',
    async candidate => candidate === 'missing-qfunction'
      ? undefined
      : { value: candidate, text: '[@ButtonClick17]\r\n' }
  );
  assert.deepEqual(missingPrimaryMatch, [{
    value: 'QuestDiary/深层/按钮.txt',
    position: { line: 0, character: 0 },
  }], 'a missing QFunction file must fall back to QuestDiary candidates');

  const dirtyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-dirty-callback-'));
  try {
    const dirtyQFunction = path.join(dirtyRoot, 'Market_Def', 'QFunction-0.txt');
    const dirtyAdded = path.join(dirtyRoot, 'QuestDiary', '一级', '二级', '新增.txt');
    const dirtyRemoved = path.join(dirtyRoot, 'QuestDiary', '旧定义.txt');
    for (const filePath of [dirtyQFunction, dirtyAdded, dirtyRemoved]) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    fs.writeFileSync(dirtyQFunction, '[@ButtonClick17]\r\n', 'utf8');
    fs.writeFileSync(dirtyAdded, '[@OtherCallback]\r\n', 'utf8');
    fs.writeFileSync(dirtyRemoved, '[@ButtonClick17]\r\n', 'utf8');

    const dirtyTexts = new Map([
      [dirtyQFunction, '[@OtherCallback]\r\n'],
      [dirtyAdded, '  [@ButtonClick17]\r\n'],
      [dirtyRemoved, '[@OtherCallback]\r\n'],
    ]);
    const dirtyMatches = await findScriptLabelInPrimaryOrFallbackCandidates(
      dirtyQFunction,
      async () => [dirtyAdded, dirtyRemoved],
      'ButtonClick17',
      async candidate => ({
        value: candidate,
        text: dirtyTexts.has(candidate)
          ? dirtyTexts.get(candidate)
          : fs.readFileSync(candidate, 'utf8'),
      })
    );
    assert.deepEqual(dirtyMatches, [{
      value: dirtyAdded,
      position: { line: 0, character: 2 },
    }], 'loader-provided dirty text must override both added and removed on-disk labels');
  } finally {
    fs.rmSync(dirtyRoot, { recursive: true, force: true });
  }

  const noMatchReads = [];
  const noMatches = await findScriptLabelInPrimaryOrFallbackCandidates(
    'missing-qfunction',
    async () => ['QuestDiary/a.txt', 'QuestDiary/b.txt'],
    'ButtonClick17',
    async candidate => {
      noMatchReads.push(candidate);
      return candidate === 'missing-qfunction'
        ? undefined
        : { value: candidate, text: '[@OtherCallback]\r\n' };
    }
  );
  assert.deepEqual(noMatches, []);
  assert.deepEqual(noMatchReads, [
    'missing-qfunction',
    'QuestDiary/a.txt',
    'QuestDiary/b.txt',
  ]);

  const callbackRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-command-callback-'));
  try {
    const envir = path.join(callbackRoot, 'Mir200', 'Envir');
    const source = path.join(envir, 'QuestDiary', '按钮与定时器.txt');
    const qManage = path.join(envir, 'MapQuest_Def', 'QManage.txt');
    const qFunction = path.join(envir, 'Market_Def', 'QFunction-0.txt');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.mkdirSync(path.dirname(qManage), { recursive: true });
    fs.mkdirSync(path.dirname(qFunction), { recursive: true });
    fs.writeFileSync(source, `${timerLine}\r\n${addButtonLine}\r\n`, 'utf8');
    fs.writeFileSync(qManage, '\uFEFF  [@ontimer7]\r\n#ACT\r\nSENDMSG 6 TIMER\r\n', 'utf8');
    fs.writeFileSync(qFunction, '  [@buttonclick17]\r\n#ACT\r\nSENDMSG 6 BUTTON\r\n', 'utf8');

    for (const [reference, expectedPath, expectedCharacter] of [
      [timer, qManage, 3],
      [button, qFunction, 2],
    ]) {
      const definition = QUICK_FILE_DEFINITIONS.find(item => (
        item.fileName.toLowerCase() === reference.targetFileName.toLowerCase()
      ));
      assert.ok(definition, `${reference.targetFileName} must remain a registered quick file`);
      const candidates = buildQuickFileCandidates(
        callbackRoot,
        callbackRoot,
        source,
        definition
      );
      assert.equal(candidates[0], expectedPath, 'the active Envir target must have first priority');
      assert.deepEqual(
        findScriptLabelPosition(fs.readFileSync(expectedPath, 'utf8'), reference.label),
        { line: 0, character: expectedCharacter },
        `the anchored ${reference.label} definition should resolve case-insensitively`
      );
    }
  } finally {
    fs.rmSync(callbackRoot, { recursive: true, force: true });
  }

  console.log('script-labels.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
