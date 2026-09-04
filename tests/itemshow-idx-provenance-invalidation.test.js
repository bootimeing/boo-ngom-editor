const assert = require('node:assert/strict');
const path = require('node:path');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { resolveDialogVariables } = require('../out/ui-dialog/variable-resolver');

const sourceFile = path.join(
  'D:', 'fixture', 'MirServer', 'Mir200', 'Envir', 'Market_Def', 'idx-provenance.txt'
);

function databaseField({ field }) {
  return field.trim().toUpperCase() === 'IDX'
    ? { value: '935', complete: true }
    : undefined;
}

function parse(lines, engine = 'GOM', conditionStates) {
  const text = lines.join('\r\n');
  return parseNpcDialogDocument(text, {
    uri: `file:///${sourceFile.replaceAll('\\', '/')}`,
    fileName: path.basename(sourceFile),
    filePath: sourceFile,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: text.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
    conditionStates,
    dataOptions: {
      resolveDatabaseField: databaseField,
    },
  });
}

function resolveProbe(lines, names, engine = 'GOM', conditionStates) {
  const text = lines.join('\r\n');
  const probeLine = lines.findIndex(line => line.startsWith('PROBE '));
  assert.notEqual(probeLine, -1, 'fixture must include one PROBE line');
  const result = resolveDialogVariables(text, {
    rootLabel: '@main',
    targetLabels: ['@main'],
    engine,
    conditionStates,
    dataOptions: { resolveDatabaseField: databaseField },
  });
  const resolvedLine = result.byLabel.get('@MAIN')?.lines.get(probeLine);
  assert.ok(resolvedLine, 'probe line must expose its resolved variables');
  return new Map(names.map(name => [
    name,
    resolvedLine.variables.find(variable => variable.name === name),
  ]));
}

function item(model) {
  const result = model.pages[0].elements.find(element => element.statementId === 'item-show');
  assert.ok(result, 'fixture ITEMSHOW must parse');
  return result;
}

function variable(model, name) {
  return model.pages[0].resolvedVariables.find(candidate => candidate.name === name);
}

function assertUnknownOverwrite({ name, target, command, expectedValue, engine = 'GOM' }) {
  const model = parse([
    '[@main]',
    '#ACT',
    `GETDBITEMFIELDVALUE 传送戒指 IDX ${target}`,
    command,
    '#SAY',
    `<&ITEMSHOW:<$STR(${target})>:1:10:20:48>`,
  ], engine);
  const resolved = variable(model, target);
  assert.ok(resolved, `${name}: overwritten variable must remain inspectable`);
  assert.equal(resolved.value, expectedValue, `${name}: old IDX value must not survive the write`);
  assert.equal(resolved.status, 'default', `${name}: runtime output must remain unknown`);
  assert.equal(resolved.staticValueSource, undefined,
    `${name}: runtime output must clear database-item-index provenance`);
  assert.equal(item(model).itemPreview.itemIndex, undefined,
    `${name}: overwritten value must not unlock IDX -> Looks`);
  assert.equal(item(model).itemPreview.dynamicFields?.includes('itemid'), true);
}

function assertUnknownProbe(variable, label, expectedValue = '0') {
  assert.ok(variable, `${label}: output variable must remain inspectable`);
  assert.equal(variable.value, expectedValue, `${label}: old IDX value must not survive`);
  assert.equal(variable.status, 'default', `${label}: runtime output must remain unknown`);
  assert.equal(variable.staticValueSource, undefined,
    `${label}: runtime output must clear database-item-index provenance`);
}

function assertPreservedProbe(variable, label) {
  assert.ok(variable, `${label}: input variable must remain inspectable`);
  assert.equal(variable.value, '935', `${label}: pure input must retain its static database value`);
  assert.equal(variable.status, 'resolved', `${label}: pure input must stay resolved`);
  assert.equal(variable.staticValueSource, 'database-item-index',
    `${label}: pure input must retain database-item-index provenance`);
}

function conditionProbe(command, engine = 'GOM', target = 'N$IDX', satisfied = false) {
  return resolveProbe([
    '[@main]',
    '#ACT',
    `GETDBITEMFIELDVALUE 传送戒指 IDX ${target}`,
    '#IF',
    command,
    '#ACT',
    '#SAY',
    `PROBE <$STR(${target})>`,
  ], [target], engine, { '@MAIN:CONDITION:1': satisfied }).get(target);
}

function main() {
  assertUnknownOverwrite({
    name: 'GETRANDOMLINETEXT explicit string output',
    target: 'S$展示IDX',
    command: 'GETRANDOMLINETEXT ..\\QuestDiary\\随机.txt S$展示IDX 0',
    expectedValue: '',
  });
  assertUnknownOverwrite({
    name: 'CALCPER explicit numeric output',
    target: 'N$展示IDX',
    command: 'CALCPER 100 50 N$展示IDX',
    expectedValue: '0',
  });
  assertUnknownOverwrite({
    name: 'unmodeled standalone variable argument',
    target: 'N$展示IDX',
    command: 'UNMODELEDWRITE N$展示IDX',
    expectedValue: '0',
  });

  const embeddedInputModel = parse([
    '[@main]',
    '#ACT',
    'GETDBITEMFIELDVALUE 传送戒指 IDX N$展示IDX',
    'SENDMSG 6 <$STR(N$展示IDX)>',
    '#SAY',
    '<&ITEMSHOW:<$STR(N$展示IDX)>:1:10:20:48>',
  ]);
  assert.equal(variable(embeddedInputModel, 'N$展示IDX')?.staticValueSource,
    'database-item-index',
    'an embedded SENDMSG input expression must not be mistaken for an output target');
  assert.equal(item(embeddedInputModel).itemPreview.itemIndex, 935,
    'an input-only embedded expression must not revoke the direct database result');

  const explicitOutputOnlyModel = parse([
    '[@main]',
    '#ACT',
    'GETDBITEMFIELDVALUE 传送戒指 IDX N$输入IDX',
    'CALCPER N$输入IDX 50 N$结果',
    '#SAY',
    '<&ITEMSHOW:<$STR(N$输入IDX)>:1:10:20:48>',
  ]);
  assert.equal(variable(explicitOutputOnlyModel, 'N$输入IDX')?.staticValueSource,
    'database-item-index',
    'a known output spec must invalidate only CALCPER result, not its direct input argument');
  assert.equal(item(explicitOutputOnlyModel).itemPreview.itemIndex, 935);

  const singleGotoReturn = parse([
    '[@main]',
    '#ACT',
    'GETDBITEMFIELDVALUE 传送戒指 IDX N$返回IDX',
    'GOTO @callee(|N$返回IDX)',
    '#SAY',
    '<&ITEMSHOW:<$STR(N$返回IDX)>:1:10:20:48>',
    '[@callee]',
    '#ACT',
    'RETURN 777',
  ]);
  assertUnknownProbe(variable(singleGotoReturn, 'N$返回IDX'), 'GOTO single return');
  assert.equal(item(singleGotoReturn).itemPreview.itemIndex, undefined,
    'a GOTO return value must not unlock IDX -> Looks');

  const gotoVariables = resolveProbe([
    '[@main]',
    '#ACT',
    'GETDBITEMFIELDVALUE 传送戒指 IDX N$输入IDX',
    'GETDBITEMFIELDVALUE 传送戒指 IDX N$返回IDX1',
    'GETDBITEMFIELDVALUE 传送戒指 IDX S$返回IDX2',
    'GOTO @callee(N$输入IDX|N$返回IDX1,S$返回IDX2)',
    '#SAY',
    'PROBE <$STR(N$输入IDX)> <$STR(N$返回IDX1)> <$STR(S$返回IDX2)>',
    '[@callee]',
    '#ACT',
    'RETURN 777 返回文字',
  ], ['N$输入IDX', 'N$返回IDX1', 'S$返回IDX2']);
  assertPreservedProbe(gotoVariables.get('N$输入IDX'), 'GOTO input argument');
  assertUnknownProbe(gotoVariables.get('N$返回IDX1'), 'GOTO first return');
  assertUnknownProbe(gotoVariables.get('S$返回IDX2'), 'GOTO second return', '');

  const gotoWithoutReturn = resolveProbe([
    '[@main]',
    '#ACT',
    'GETDBITEMFIELDVALUE 传送戒指 IDX N$输入IDX',
    'GOTO @callee(N$输入IDX)',
    '#SAY',
    'PROBE <$STR(N$输入IDX)>',
    '[@callee]',
    '#ACT',
    'RETURN N$输入IDX',
  ], ['N$输入IDX']);
  assertPreservedProbe(gotoWithoutReturn.get('N$输入IDX'), 'GOTO without return list');

  const conditionOutputs = [
    ['GOM', 'CHECKBAGITEM 1,2 N$IDX 1', 'CHECKBAGITEM GOM output'],
    ['GOM', 'NOT CHECKBAGITEM 1,2 N$IDX 1', 'negated CHECKBAGITEM GOM output'],
    ['996PC', 'CHECKBAGITEM 1,2 N$IDX 1', 'CHECKBAGITEM 996PC output'],
    ['GOM', 'CHECKSLAVENAME 神兽 N$IDX', 'CHECKSLAVENAME GOM optional output'],
    ['GOM', 'CHECKITEMADDVALUE 1 0 > 5 N$IDX', 'CHECKITEMADDVALUE GOM output'],
    ['GEE', 'CHECKITEMADDVALUE 1 0 > 5 N$IDX', 'CHECKITEMADDVALUE GEE output'],
    ['996PC', 'CHECKITEMADDVALUE 1 0 > 5 N$IDX', 'CHECKITEMADDVALUE 996PC optional output'],
    ['GOM', 'CHECKITEMADDVALUEEX 1 > 5 1 N$IDX', 'CHECKITEMADDVALUEEX GOM optional output'],
    ['996PC', 'CHECKNAMELISTPOSITION list.txt = 1 N$IDX', 'CHECKNAMELISTPOSITION 996PC output'],
    ['GOM', 'CHECKNAMELISTPOSITION list.txt = 1 N$IDX', 'CHECKNAMELISTPOSITION GOM output'],
    ['GEE', 'CHECKNAMELISTPOSITION list.txt = 1 N$IDX', 'CHECKNAMELISTPOSITION GEE output'],
    ['GOM', 'CHECKREVIVAL N$IDX 0', 'CHECKREVIVAL GOM output'],
    ['996PC', 'CHECKREVIVAL N$IDX', 'CHECKREVIVAL 996PC optional output'],
    ['GOM', 'CHECKNAMEDATETIMELIST member.txt 1 N$IDX S$DAY S$HOUR S$MIN',
      'CHECKNAMEDATETIMELIST GOM expiry output'],
    ['GOM', 'CHECKNAMEDATETIMELIST member.txt 1 S$DATE N$IDX S$HOUR S$MIN',
      'CHECKNAMEDATETIMELIST GOM day output'],
    ['GOM', 'CHECKNAMEDATETIMELIST member.txt 1 S$DATE S$DAY N$IDX S$MIN',
      'CHECKNAMEDATETIMELIST GOM hour output'],
    ['GOM', 'CHECKNAMEDATETIMELIST member.txt 1 S$DATE S$DAY S$HOUR N$IDX',
      'CHECKNAMEDATETIMELIST GOM minute output'],
    ['GEE', 'CHECKNAMEDATETIMELIST member.txt 1 S$DATE N$IDX S$HOUR S$MIN',
      'CHECKNAMEDATETIMELIST GEE output'],
    ['996PC', 'CHECKNAMEDATETIMELIST member.txt 1 S$DATE N$IDX S$HOUR S$MIN',
      'CHECKNAMEDATETIMELIST 996PC output'],
    ['GOM', 'CHECKNAMEDATETIMELIST member.txt 1 S$DATE <$STR(N$IDX)> S$HOUR S$MIN',
      'CHECKNAMEDATETIMELIST direct STR projection output'],
    ['GOM', 'CHECKSKILL 冰咆哮 = 0 1 N$IDX S$LEVEL', 'CHECKSKILL GOM level output'],
    ['GOM', 'CHECKSKILL 冰咆哮 = 0 1 N$LEVEL N$IDX', 'CHECKSKILL GOM enhanced-level output'],
    ['GOM', 'FINDMONPOINT 3 怪物 N$IDX N$Y N$COUNT', 'FINDMONPOINT GOM X output'],
    ['GOM', 'FINDMONPOINT 3 怪物 N$X N$IDX N$COUNT', 'FINDMONPOINT GOM Y output'],
    ['GOM', 'FINDMONPOINT 3 怪物 N$X N$Y N$IDX', 'FINDMONPOINT GOM count output'],
    ['GEE', 'FINDMONPOINT 3 怪物 N$IDX N$Y', 'FINDMONPOINT GEE X output'],
    ['GEE', 'FINDMONPOINT 3 怪物 N$X N$IDX', 'FINDMONPOINT GEE Y output'],
    ['GOM', 'CHECKUSERDATE member.txt < 30 N$IDX N$LEFT', 'CHECKUSERDATE GOM used-days output'],
    ['GOM', 'CHECKUSERDATE member.txt < 30 N$USED N$IDX', 'CHECKUSERDATE GOM remaining-days output'],
    ['GEE', 'CHECKUSERDATE member.txt < 30 N$IDX N$LEFT', 'CHECKUSERDATE GEE used-days output'],
    ['GOM', 'GETSTRINGPOSEX list.txt needle N$IDX S$LINE', 'GETSTRINGPOSEX GOM row output'],
    ['GOM', 'GETSTRINGPOSEX list.txt needle N$ROW N$IDX', 'GETSTRINGPOSEX GOM line output'],
    ['GEE', 'GETSTRINGPOSEX list.txt needle N$IDX S$LINE 0 0', 'GETSTRINGPOSEX GEE row output'],
    ['996PC', 'GETSTRINGPOSEX list.txt needle N$IDX S$LINE', 'GETSTRINGPOSEX 996PC row output'],
    ['GOM', 'GETGUILDMEMBERCOUNT guild N$IDX 0', 'GETGUILDMEMBERCOUNT GOM count output'],
    ['GEE', 'GETGUILDMEMBERCOUNT guild N$IDX 0', 'GETGUILDMEMBERCOUNT GEE count output'],
    ['GOM', 'GETSHOPITEMCOUNT 0 N$IDX', 'GETSHOPITEMCOUNT GOM count output'],
    ['GOM', 'GETSHOPITEMCOUNT 0 N$COUNT 1 N$IDX', 'GETSHOPITEMCOUNT GOM item-name output'],
  ];
  for (const [engine, command, label] of conditionOutputs) {
    assertUnknownProbe(conditionProbe(command, engine), label);
  }
  assertUnknownProbe(
    conditionProbe('CHECKBAGITEM 1,2 N$IDX 1', 'GOM', 'N$IDX', true),
    'CHECKBAGITEM output when ACT is selected'
  );
  for (const engine of ['GOM', 'GEE']) {
    assertUnknownProbe(
      conditionProbe('CHECKNAMELISTPOSITION list.txt < 10', engine, 'P0'),
      `CHECKNAMELISTPOSITION ${engine} implicit P0 output`
    );
  }
  assertPreservedProbe(
    conditionProbe('CHECKNAMELISTPOSITION list.txt < 10', '996PC', 'P0'),
    'CHECKNAMELISTPOSITION 996PC does not borrow implicit P0'
  );

  const conditionalItemModel = parse([
    '[@main]',
    '#ACT',
    'GETDBITEMFIELDVALUE 传送戒指 IDX N$IDX',
    '#IF',
    'CHECKBAGITEM 1,2 N$IDX 1',
    '#ACT',
    'GOTO @view',
    '#ELSEACT',
    'GOTO @view',
    '[@view]',
    '#SAY',
    '<&ITEMSHOW:<$STR(N$IDX)>:1:10:20:48>',
  ]);
  assert.equal(item(conditionalItemModel).itemPreview.itemIndex, undefined,
    'a condition output must not unlock ITEMSHOW through either preview branch');

  const conditionInputs = [
    ['GOM', 'EQUAL N$IDX 935', 'EQUAL pure input'],
    ['GEE', 'CHECKSLAVENAME N$IDX', 'CHECKSLAVENAME GEE input-only'],
    ['996PC', 'CHECKSLAVENAME N$IDX', 'CHECKSLAVENAME 996PC unproved signature'],
    ['GEE', 'CHECKITEMADDVALUEEX 1 > 5 N$IDX', 'CHECKITEMADDVALUEEX GEE mode input'],
    ['996PC', 'CHECKITEMADDVALUEEX 1 > 5 N$IDX', 'CHECKITEMADDVALUEEX 996PC mode input'],
    ['GOM', 'CHECKNAMELISTPOSITION list.txt = N$IDX', 'CHECKNAMELISTPOSITION GOM input'],
    ['GEE', 'CHECKNAMELISTPOSITION list.txt = N$IDX', 'CHECKNAMELISTPOSITION GEE input'],
    ['GOM', 'GETSHOPITEMCOUNT 0 N$COUNT N$IDX S$NAME', 'GETSHOPITEMCOUNT GOM slot input'],
    ['GEE', 'CHECKSKILL 冰咆哮 = N$IDX 1', 'CHECKSKILL GEE level input'],
    ['996PC', 'CHECKSKILL 冰咆哮 = N$IDX 1', 'CHECKSKILL 996PC level input'],
  ];
  for (const [engine, command, label] of conditionInputs) {
    assertPreservedProbe(conditionProbe(command, engine), label);
  }

  for (const engine of ['GOM', '996PC']) {
    const mirror = resolveProbe([
      '[@main]',
      '#ACT',
      'GETDBITEMFIELDVALUE 传送戒指 IDX D99',
      'MIRRORMAPTIME mirror-map 60',
      '#SAY',
      'PROBE <$STR(D99)>',
    ], ['D99'], engine).get('D99');
    assertUnknownProbe(mirror, `MIRRORMAPTIME ${engine} implicit D99 output`);
  }
  assertPreservedProbe(resolveProbe([
    '[@main]',
    '#ACT',
    'GETDBITEMFIELDVALUE 传送戒指 IDX D99',
    'MIRRORMAPTIME mirror-map 60',
    '#SAY',
    'PROBE <$STR(D99)>',
  ], ['D99'], 'GEE').get('D99'), 'MIRRORMAPTIME GEE isolation');

  const indirectGetDbCases = [
    {
      label: 'dynamic database field name',
      setup: ['MOV S$字段 IDX'],
      query: 'GETDBITEMFIELDVALUE 传送戒指 <$STR(S$字段)> N$IDX',
    },
    {
      label: 'dynamic database item key',
      setup: ['MOV S$物品 传送戒指'],
      query: 'GETDBITEMFIELDVALUE <$STR(S$物品)> IDX N$IDX',
    },
    {
      label: 'dynamic database output target',
      setup: ['MOV S$目标 N$IDX'],
      query: 'GETDBITEMFIELDVALUE 传送戒指 IDX <$STR(S$目标)>',
    },
  ];
  for (const fixture of indirectGetDbCases) {
    const model = parse([
      '[@main]',
      '#ACT',
      ...fixture.setup,
      fixture.query,
      '#SAY',
      '<&ITEMSHOW:<$STR(N$IDX)>:1:10:20:48>',
    ]);
    const resolved = variable(model, 'N$IDX');
    assert.ok(resolved, `${fixture.label}: resolved database value must remain inspectable`);
    assert.equal(resolved.value, '935', `${fixture.label}: ordinary display value may still resolve`);
    assert.equal(resolved.staticValueSource, undefined,
      `${fixture.label}: indirect source must not receive database-item-index capability`);
    assert.equal(item(model).itemPreview.itemIndex, undefined,
      `${fixture.label}: indirect source must not unlock IDX -> Looks`);
  }

  const directGetDb = parse([
    '[@main]',
    '#ACT',
    'GETDBITEMFIELDVALUE 传送戒指 idx N$IDX',
    '#SAY',
    '<&ITEMSHOW:<$STR(N$IDX)>:1:10:20:48>',
  ]);
  assert.equal(variable(directGetDb, 'N$IDX')?.staticValueSource, 'database-item-index',
    'a complete direct GETDBITEMFIELDVALUE IDX result must retain the capability');
  assert.equal(item(directGetDb).itemPreview.itemIndex, 935);

  console.log('itemshow-idx-provenance-invalidation.test.js: PASS');
}

main();
