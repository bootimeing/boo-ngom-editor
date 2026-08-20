const assert = require('node:assert/strict');

function main() {
  const {
    describeCommandParameter,
    findScriptCommandArgumentAt,
    findScriptCommandInvocations,
    formatCommandParameterMeaning,
    isMapParameterDescription,
  } = require('../out/utils/command-arguments');
  const {
    collectConfiguredMapCodes,
    findMapCodeRangesInLine,
    isOffsetInTextRanges,
  } = require('../out/utils/map-code-context');

  const commands = new Map([
    ['CHECK', { params: ['标识序号(0-999)', '值(0/1)'], completionVerified: true }],
    ['MAPMOVE', { params: ['地图', 'X', 'Y', '[范围:0为固定坐标]'], completionVerified: true }],
    ['GETMAPROUTEINFO', { params: ['标识', '模式', '地图变量', 'X变量', 'Y变量'], completionVerified: true }],
    ['IMG', { params: ['资源序号', '图片序号', 'X', 'Y'], completionVerified: true }],
    ['M.ADDHPPER', { params: ['数值'], completionVerified: true }],
    ['MOV', { params: ['目标变量', '值'], completionVerified: true }],
  ]);
  const resolve = name => commands.get(name.toUpperCase());

  const checkLine = '#IF(CHECK [12] 1)';
  const check = findScriptCommandInvocations(checkLine, resolve)[0];
  assert.equal(check.typedName, 'CHECK');
  assert.deepEqual(check.arguments.map(item => item.text), ['[12]', '1']);
  assert.equal(findScriptCommandArgumentAt(checkLine, checkLine.indexOf('12'), resolve).index, 0);

  const objectLine = '  M.ADDHPPER 25';
  const object = findScriptCommandInvocations(objectLine, resolve)[0];
  assert.equal(object.typedName, 'M.ADDHPPER');
  assert.equal(object.arguments[0].text, '25');

  const markupLine = '文字<&IMG:7:110:<$STR(N$X)>:20>尾部';
  const markup = findScriptCommandInvocations(markupLine, resolve)[0];
  assert.equal(markup.form, 'markup');
  assert.deepEqual(markup.arguments.map(item => item.text), ['7', '110', '<$STR(N$X)>', '20']);
  assert.equal(findScriptCommandArgumentAt(markupLine, markupLine.indexOf('110'), resolve).index, 1);

  assert.deepEqual(describeCommandParameter('[范围:0为固定坐标]'), {
    raw: '[范围:0为固定坐标]', label: '范围', detail: '0为固定坐标', optional: true,
  });
  assert.deepEqual(describeCommandParameter('参数1(地图编号)'), {
    raw: '参数1(地图编号)', label: '参数1', detail: '地图编号', optional: false,
  });
  assert.equal(formatCommandParameterMeaning('WIL文件序号'), 'WIL文件序号');
  assert.equal(formatCommandParameterMeaning('参数1(地图编号)'), '地图编号');
  assert.equal(formatCommandParameterMeaning('[范围:0为固定坐标]'), '范围：0为固定坐标');
  assert.equal(isMapParameterDescription('地图编号'), true);
  assert.equal(isMapParameterDescription('目标地图'), true);
  assert.equal(isMapParameterDescription('地图变量'), false);
  assert.equal(isMapParameterDescription('新地图显示名'), false);
  assert.equal(isMapParameterDescription('小地图编号'), false);

  const mapCodes = collectConfiguredMapCodes([
    '[N3 N3地图]',
    '[D132|D2004 测试地图]',
    '[M001 M001]',
  ].join('\r\n'));
  assert.deepEqual([...mapCodes].sort(), ['D132', 'D2004', 'M001', 'N3']);

  const mapMove = 'MAPMOVE N3 100 200';
  const mapMoveRanges = findMapCodeRangesInLine(mapMove, 'script.txt', mapCodes, resolve);
  assert.deepEqual(mapMoveRanges.map(range => range.text), ['N3']);
  assert.equal(isOffsetInTextRanges(mapMove.indexOf('N3'), mapMoveRanges), true);

  assert.deepEqual(
    findMapCodeRangesInLine('MOV N3 D132', 'script.txt', mapCodes, resolve),
    [],
    'real variables must not be hidden outside a map parameter'
  );
  assert.deepEqual(
    findMapCodeRangesInLine('MAPMOVE N999 100 200', 'script.txt', mapCodes, resolve),
    [],
    'an undeclared variable-like token must not be assumed to be a map code'
  );
  assert.deepEqual(
    findMapCodeRangesInLine('GETMAPROUTEINFO 1 0 N3 X Y', 'script.txt', mapCodes, resolve),
    [],
    'a documented map output variable must remain a variable'
  );

  assert.deepEqual(
    findMapCodeRangesInLine('[M001 M001] SAFE', 'MapInfo.txt', mapCodes, resolve).map(item => item.text),
    ['M001', 'M001']
  );
  assert.deepEqual(
    findMapCodeRangesInLine('D2004 125', 'MiniMap.txt', mapCodes, resolve).map(item => item.text),
    ['D2004']
  );
  assert.deepEqual(
    findMapCodeRangesInLine('npc\\test N3 10 20 测试 0 1', 'Merchant.txt', mapCodes, resolve).map(item => item.text),
    ['N3']
  );

  console.log('command-arguments.test.js: PASS');
}

main();
