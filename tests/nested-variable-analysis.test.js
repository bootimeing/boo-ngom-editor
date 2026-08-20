const assert = require('node:assert/strict');

function resultFor(analysis, raw) {
  const result = analysis.references.find(item => item.raw === raw);
  assert.ok(result, `missing nested reference: ${raw}`);
  return result;
}

function main() {
  const {
    analyzeNestedVariables,
    extractNestedVariableReferences,
    isNestedVariableBaseOffset,
    normalizeNestedVariableReference,
  } = require('../out/utils/nested-variable-analysis');
  const {
    isBinarySpreadsheet,
    parseScriptTableData,
  } = require('../out/utils/table-data');

  assert.deepEqual(
    parseScriptTableData(';注释\r\n名称,变量\r\n"技能,一",321\r\n', 'csv'),
    [['名称', '变量'], ['技能,一', '321']],
  );
  assert.deepEqual(
    parseScriptTableData('名称\t变量\r\n技能一\t121\r\n', 'excel'),
    [['名称', '变量'], ['技能一', '121']],
  );
  assert.equal(
    isBinarySpreadsheet(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    true,
  );

  const balanced = 'mov u38<$str(U<$STR(N$五行灵根变量)>)> 1';
  const balancedRefs = extractNestedVariableReferences(balanced);
  assert.deepEqual(balancedRefs.map(item => item.raw), [
    'u38<$str(U<$STR(N$五行灵根变量)>)>',
    'U<$STR(N$五行灵根变量)>',
  ]);
  assert.equal(isNestedVariableBaseOffset(balanced.indexOf('u38') + 1, balancedRefs), true);
  assert.equal(isNestedVariableBaseOffset(balanced.indexOf('N$五行灵根变量'), balancedRefs), false);
  assert.equal(
    normalizeNestedVariableReference(balancedRefs[0]),
    'U38<$STR(U<$STR(N$五行灵根变量)>)>',
  );

  const direct = analyzeNestedVariables([
    '[@main]',
    'mov N$技能变量 21',
    'small U<$STR(N$技能变量)> 5',
  ].join('\n'));
  assert.deepEqual(
    resultFor(direct, 'U<$STR(N$技能变量)>').variables,
    ['U21'],
  );
  assert.equal(resultFor(direct, 'U<$STR(N$技能变量)>').status, 'resolved');

  const eventParameters = analyzeNestedVariables([
    '<&IMGEX:2:1:1:1:1:1/@选择技能(攻杀剑术,21)>',
    '<&IMGEX:2:1:1:1:1:1/@选择技能(刺杀剑术,22)>',
    '[@选择技能]',
    '#act',
    'mov n$技能变量 <$SCRIPTPARAM2>',
    'equal u<$str(n$技能变量)> 0',
  ].join('\n'));
  assert.deepEqual(
    resultFor(eventParameters, 'u<$str(n$技能变量)>').variables,
    ['U21', 'U22'],
  );

  const directEventParameters = analyzeNestedVariables([
    '[@选择技能]',
    '#OR',
    'CHECKSCRIPTPARAM 21,攻杀剑术',
    'CHECKSCRIPTPARAM 22,刺杀剑术',
    '#ACT',
    'equal U<$STR(<$SCRIPTPARAM1>)> 0',
  ].join('\n'));
  assert.deepEqual(
    resultFor(directEventParameters, 'U<$STR(<$SCRIPTPARAM1>)>').variables,
    ['U21', 'U22'],
  );
  assert.equal(
    resultFor(directEventParameters, 'U<$STR(<$SCRIPTPARAM1>)>').status,
    'resolved',
  );

  const dynamicEventParameters = analyzeNestedVariables([
    'mov N$技能按钮1 31',
    'mov N$技能按钮2 32',
    '<&IMGEX:2:1:1:1:1:1/@选择技能(攻杀剑术,<$STR(N$技能按钮1)>)>',
    '<&IMGEX:2:1:1:1:1:1/@选择技能(刺杀剑术,<$STR(N$技能按钮2)>)>',
    '[@选择技能]',
    '#act',
    'mov N$技能变量 <$SCRIPTPARAM2>',
    'equal U<$STR(N$技能变量)> 0',
  ].join('\n'));
  assert.deepEqual(
    resultFor(dynamicEventParameters, 'U<$STR(N$技能变量)>').variables,
    ['U31', 'U32'],
  );

  const extracted = analyzeNestedVariables([
    '<&text:A/@选择梅山(康安裕,21)>',
    '<&text:B/@选择梅山(张伯时,22)>',
    '[@选择梅山]',
    'mov s$挑战目标 <$SCRIPTPARAM1>',
    'mov n$挑战变量 <$SCRIPTPARAM2>',
    'mov T2 <$str(s$挑战目标)>|<$str(n$挑战变量)>',
    '[@main]',
    'extractstring | <$str(T2)> s$目标 n$挑战次数变量',
    'equal J<$str(n$挑战次数变量)> 0',
  ].join('\n'));
  assert.deepEqual(
    resultFor(extracted, 'J<$str(n$挑战次数变量)>').variables,
    ['J21', 'J22'],
  );

  const formula = analyzeNestedVariables([
    'mov n$五行标识 111',
    'formulation <$str(n$五行标识)>+10 n$五行次数标识',
    'inc U<$str(n$五行次数标识)> 1',
  ].join('\n'));
  assert.deepEqual(
    resultFor(formula, 'U<$str(n$五行次数标识)>').variables,
    ['U121'],
  );

  const family = analyzeNestedVariables([
    'MOV S$答案1 A',
    'MOV S$答案2 B',
    'messagebox <$str(S$答案<$str(S$正确答案)>)>',
  ].join('\n'));
  assert.deepEqual(
    resultFor(family, 'S$答案<$str(S$正确答案)>').variables,
    ['S$答案1', 'S$答案2'],
  );
  assert.equal(resultFor(family, 'S$答案<$str(S$正确答案)>').status, 'partial');

  const numericFamily = analyzeNestedVariables([
    'MOV N$序号 1',
    'INC N$序号 1',
    'MOV S$数量1 一',
    'MOV S$数量2 二',
    'MOV S$数量颜色1 红',
    'messagebox <$str(S$数量<$str(N$序号)>)>',
  ].join('\n'));
  assert.deepEqual(
    resultFor(numericFamily, 'S$数量<$str(N$序号)>').variables,
    ['S$数量1', 'S$数量2'],
  );

  const emptyIndexWithFamily = analyzeNestedVariables([
    'MOV S101',
    'MOV S$施法位置1 9:6',
    'MOV S$施法位置2 10:6',
    'extractstring : <$str(S$施法位置<$str(S101)>)> N1 N2',
  ].join('\n'));
  assert.deepEqual(
    resultFor(emptyIndexWithFamily, 'S$施法位置<$str(S101)>').variables,
    ['S$施法位置1', 'S$施法位置2'],
  );

  const numberedFamily = analyzeNestedVariables([
    'MOV T40 暂未获取',
    'MOV T41 暂未获取',
    'not equal T4<$STR(U50)> 暂未获取',
  ].join('\n'));
  assert.deepEqual(
    resultFor(numberedFamily, 'T4<$STR(U50)>').variables,
    ['T40', 'T41'],
  );

  const unresolved = analyzeNestedVariables('equal U<$STR(N$运行时下标)> 0');
  assert.deepEqual(resultFor(unresolved, 'U<$STR(N$运行时下标)>').variables, []);
  assert.equal(resultFor(unresolved, 'U<$STR(N$运行时下标)>').status, 'unresolved');

  const configDriven = analyzeNestedVariables([
    'readconfigfileitem ..\\QuestDiary\\名单\\降妖簿.ini 介绍 <$str(S$怪物)> S$数据',
    'extractstring | <$str(S$数据)> S$介绍 N$等级 N$进度下标',
    'inc U<$str(N$进度下标)> 1',
  ].join('\n'), {
    resolveConfigValues(request) {
      assert.equal(request.path, '..\\QuestDiary\\名单\\降妖簿.ini');
      assert.equal(request.section, '介绍');
      return { values: ['青蛙|1|211', '蜘蛛|2|212'], complete: true };
    },
  });
  assert.deepEqual(
    resultFor(configDriven, 'U<$str(N$进度下标)>').variables,
    ['U211', 'U212'],
  );

  const tableRows = {
    '..\\QuestDiary\\自定义配置表.xls': [
      ['121', '122'],
      ['221', '222'],
    ],
    '..\\QuestDiary\\技能.csv': [
      ['技能一', '321', '331'],
      ['技能二', '322', '332'],
    ],
  };
  const resolveTableData = request => {
    const rows = tableRows[request.path];
    return rows ? { rows, complete: true } : undefined;
  };

  const readExcel = analyzeNestedVariables([
    '[@读取表格]',
    'ReadExcel ..\\QuestDiary\\自定义配置表.xls 2',
    'mov N$表格变量 <$GLOBAL(Excel1)>',
    'equal U<$STR(N$表格变量)> 0',
    'equal J<$STR(<$GLOBAL(Excel0)>)> 0',
  ].join('\n'), { resolveTableData });
  assert.deepEqual(
    resultFor(readExcel, 'U<$STR(N$表格变量)>').variables,
    ['U222'],
  );
  assert.deepEqual(
    resultFor(readExcel, 'J<$STR(<$GLOBAL(Excel0)>)>').variables,
    ['J221'],
  );

  const csvCell = analyzeNestedVariables([
    '[@读取CSV]',
    'mov N$行号 1',
    'CSVGetCellText ..\\QuestDiary\\技能.csv <$STR(N$行号)> 1 N$技能变量',
    'equal U<$STR(N$技能变量)> 0',
  ].join('\n'), { resolveTableData });
  assert.deepEqual(
    resultFor(csvCell, 'U<$STR(N$技能变量)>').variables,
    ['U322'],
  );

  const csvShortcut = analyzeNestedVariables([
    '[@Startup]',
    'CSVOpenCache ..\\QuestDiary\\技能.csv',
    '[@读取缓存]',
    'mov N$技能变量 <$技能(0,2)>',
    'equal U<$STR(N$技能变量)> 0',
    'equal J<$STR(<$技能(1,1)>)> 0',
  ].join('\n'), { resolveTableData });
  assert.deepEqual(
    resultFor(csvShortcut, 'U<$STR(N$技能变量)>').variables,
    ['U331'],
  );
  assert.deepEqual(
    resultFor(csvShortcut, 'J<$STR(<$技能(1,1)>)>').variables,
    ['J322'],
  );

  const comments = analyzeNestedVariables([
    '; mov N$下标 9',
    '; equal U<$STR(N$下标)> 0',
    'mov N$下标 3',
    'equal U<$STR(N$下标)> 0',
  ].join('\n'));
  assert.equal(comments.references.length, 1);
  assert.deepEqual(comments.references[0].variables, ['U3']);

  console.log('nested-variable-analysis.test.js: PASS');
}

main();
