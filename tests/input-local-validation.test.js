const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

function parse(source, engine) {
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/input-local-${engine}.txt`,
    fileName: `input-local-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\input-local-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine === '996PC' ? '996PC' : '新GOM',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function controls(model) {
  return new Map(model.pages[0].elements
    .filter(element => element.inputPreview)
    .map(element => [element.containerElementId || element.inputPreview.inputId || element.statementId, element]));
}

function fields(preview, property) {
  return new Set(preview?.[property] || []);
}

function assertFields(preview, property, expected, message) {
  assert.deepEqual(fields(preview, property), new Set(expected), message);
}

function test996KeyedInputModesAndLengthRules() {
  const source = [
    '[@main]',
    '#SAY',
    '<Input|id=TEXT|x=20|y=20|inputid=1|type=0|width=145|height=25|size=18|place=请输入|placecolor=251|errortips=请输入3到6个字符|mincount=3|maxcount=6|color=250|onlyCh=1|bgtype=1>',
    '<Input|id=NUMBER|x=20|y=60|inputid=2|type=1|mincount=1|maxcount=3|errortips=请输入1到3位数字>',
    '<Input|id=PASSWORD|x=20|y=100|inputid=3|type=2|mincount=4|maxcount=12|errortips=密码长度错误>',
    '<Input|id=ABS|x=20|y=140|inputid=4|type=3|mincount=1|maxcount=3|errortips=请输入绝对值数字>',
  ].join('\n');
  const byId = controls(parse(source, '996PC'));

  assert.deepEqual(byId.get('TEXT').inputPreview, {
    mode: 'text',
    inputId: 1,
    placeholder: '请输入',
    placeholderColor: '#ffff00',
    textColor: '#00ff00',
    fontSize: 18,
    minLength: 3,
    maxLength: 6,
    onlyChinese: true,
    showBackground: true,
    errorTips: '请输入3到6个字符',
  });
  assert.equal(byId.get('NUMBER').inputPreview.mode, 'number');
  assert.deepEqual(
    {
      minLength: byId.get('NUMBER').inputPreview.minLength,
      maxLength: byId.get('NUMBER').inputPreview.maxLength,
      minValue: byId.get('NUMBER').inputPreview.minValue,
      maxValue: byId.get('NUMBER').inputPreview.maxValue,
    },
    { minLength: 1, maxLength: 3, minValue: undefined, maxValue: undefined },
    '996PC keyed mincount/maxcount are character counts even for numeric input'
  );
  assert.equal(byId.get('PASSWORD').inputPreview.mode, 'password');
  assert.equal(byId.get('ABS').inputPreview.mode, 'absolute-number');
}

function testTraditionalInputModesAndDisabledZeroBounds() {
  const gom = controls(parse([
    '[@main]',
    '#SAY',
    '<&INPUTTEXT:5:20:180:120:24:-1:-1:255:2:8:文本长度错误:请输入文本:160>',
    '<&INPUTNUM:6:20:220:120:24:0:249:255:10:20:数值范围错误:请输入数字:160>',
    '<&INPUTMEMO:7:20:260:180:70:0:249:255:4:50:16:1:请输入4到50个字符>',
    '<&INPUTTEXT:8:20:340:120:24:0:249:255:0:0::请输入文本:160>',
    '<&INPUTNUM:9:20:380:120:24:0:249:255:0:0::请输入数字:160>',
  ].join('\n'), 'GOM'));

  assert.equal(gom.get(5).inputPreview.mode, 'text');
  assert.deepEqual(
    [gom.get(5).inputPreview.minLength, gom.get(5).inputPreview.maxLength],
    [2, 8]
  );
  assert.equal(gom.get(6).inputPreview.mode, 'number');
  assert.deepEqual(
    [gom.get(6).inputPreview.minValue, gom.get(6).inputPreview.maxValue],
    [10, 20]
  );
  assert.equal(gom.get(7).inputPreview.mode, 'memo');
  assert.equal(gom.get(7).inputPreview.autoWrap, true);
  assert.equal(gom.get(7).inputPreview.lineHeight, 16);

  const all = [...parse([
    '[@main]',
    '#SAY',
    '<&INPUTTEXT:8:20:340:120:24:0:249:255:0:0::请输入文本:160>',
    '<&INPUTNUM:9:20:380:120:24:0:249:255:0:0::请输入数字:160>',
  ].join('\n'), 'GOM').pages[0].elements].filter(element => element.inputPreview);
  assert.equal(all[0].inputPreview.minLength, undefined,
    'a traditional zero minimum length means no local lower bound');
  assert.equal(all[0].inputPreview.maxLength, undefined,
    'a traditional zero maximum length means no local upper bound');
  assert.equal(all[1].inputPreview.minValue, undefined,
    'traditional INPUTNUM 0/0 means unrestricted');
  assert.equal(all[1].inputPreview.maxValue, undefined,
    'traditional INPUTNUM 0/0 means unrestricted');
}

function testDynamicFieldsNeverBorrowMovValues() {
  const source = [
    '[@main]',
    '#ACT',
    'MOV N$TYPE 2',
    'MOV N$MIN 3',
    'MOV N$MAX 9',
    'MOV N$ONLY 1',
    'MOV N$BG 1',
    '#SAY',
    '<Input|id=DYNAMIC|x=240|y=20|inputid=8|type=<$STR(N$TYPE)>|mincount=<$STR(N$MIN)>|maxcount=<$STR(N$MAX)>|onlyCh=<$STR(N$ONLY)>|bgtype=<$STR(N$BG)>>',
  ].join('\n');
  const element = controls(parse(source, '996PC')).get('DYNAMIC');

  assert.equal(element.inputPreview.mode, 'text',
    'dynamic type must not borrow the current MOV value and masquerade as password');
  assert.equal(element.inputPreview.minLength, undefined);
  assert.equal(element.inputPreview.maxLength, undefined);
  assert.equal(element.inputPreview.onlyChinese, undefined,
    'dynamic onlyCh must remain unknown rather than false or the MOV value');
  assert.equal(element.inputPreview.showBackground, undefined,
    'dynamic bgtype must remain unknown rather than false or the MOV value');
  assert.equal(element.inputPreview.dynamic, true);
  assertFields(element.inputPreview, 'dynamicFields', [
    'mode', 'min-length', 'max-length', 'only-chinese', 'show-background',
  ], 'every source-dynamic validation field must be identified');
  assert.match(element.warning || '', /输入框.*动态|动态.*输入框/);

  const legacySource = [
    '[@main]',
    '#ACT',
    'MOV N$MIN 5',
    '#SAY',
    '<&INPUTTEXT:8:20:80:120:24:0:249:255:<$STR(N$MIN)>:9:长度错误:请输入:160>',
  ].join('\n');
  const legacy = parse(legacySource, 'GOM').pages[0].elements
    .find(candidate => candidate.inputPreview);
  assert.equal(legacy.inputPreview.minLength, undefined,
    'traditional source binding must remove a temporarily resolved MOV minimum');
  assertFields(legacy.inputPreview, 'dynamicFields', ['min-length']);
  assert.match(legacy.warning || '', /最小长度.*动态|动态.*最小长度/);
}

function testInvalidFieldsAreRejectedWithoutClamping() {
  const source = [
    '[@main]',
    '#SAY',
    '<Input|id=INVALID|x=20|y=20|inputid=10|type=9|size=-1|mincount=9|maxcount=3|onlyCh=2|bgtype=3|errortips=错误>',
  ].join('\n');
  const invalid = controls(parse(source, '996PC')).get('INVALID');
  assert.equal(invalid.inputPreview.mode, 'text');
  assert.equal(invalid.inputPreview.inputId, undefined);
  assert.equal(invalid.inputPreview.fontSize, undefined);
  assert.equal(invalid.inputPreview.minLength, undefined);
  assert.equal(invalid.inputPreview.maxLength, undefined);
  assert.equal(invalid.inputPreview.onlyChinese, undefined);
  assert.equal(invalid.inputPreview.showBackground, undefined);
  assertFields(invalid.inputPreview, 'invalidFields', [
    'input-id', 'mode', 'font-size', 'min-length', 'max-length',
    'only-chinese', 'show-background',
  ], 'invalid 996PC fields and reversed length range must remain explicit');
  assert.match(invalid.warning || '', /输入框.*无效|无效.*输入框/);

  const legacySource = [
    '[@main]',
    '#SAY',
    '<&INPUTNUM:41:20:60:120:24:-2:256:300:20:10:数值错误:数字:160>',
    '<&INPUTMEMO:7:20:100:120:60:0:249:255:-1:50:-2:7:文本错误>',
  ].join('\n');
  const legacy = parse(legacySource, 'GOM').pages[0].elements
    .filter(candidate => candidate.inputPreview);
  assertFields(legacy[0].inputPreview, 'invalidFields', [
    'input-id', 'background-color', 'border-color', 'text-color',
    'min-value', 'max-value',
  ]);
  assert.equal(legacy[0].inputPreview.minValue, undefined);
  assert.equal(legacy[0].inputPreview.maxValue, undefined);
  assertFields(legacy[1].inputPreview, 'invalidFields', [
    'min-length', 'line-height', 'auto-wrap',
  ]);
  assert.equal(legacy[1].inputPreview.autoWrap, undefined,
    'an invalid auto-wrap switch must not be treated as false');
}

test996KeyedInputModesAndLengthRules();
testTraditionalInputModesAndDisabledZeroBounds();
testDynamicFieldsNeverBorrowMovValues();
testInvalidFieldsAreRejectedWithoutClamping();

console.log('input-local-validation.test.js: PASS');
