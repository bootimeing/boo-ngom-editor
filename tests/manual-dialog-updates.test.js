const assert = require('node:assert/strict');
const path = require('node:path');
const { parse } = require('./preview-inputs-integration.test');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { applyTextReplacements, buildDialogCoordinateEdits } = require('../out/ui-dialog/source-patcher');
const { loadStaticLanguageData } = require('../out/data/loader');
const { activeStaticLanguageEntries } = require('../out/utils/static-language');
const { buildSayMarkupIndex, findDocumentSayHover } = require('../out/utils/say-markup');
const root = path.join(__dirname, '..');
const renderer = loadStaticLanguageData(root, () => {}, 'renderer');
const say = loadStaticLanguageData(root, () => {}).saySnippets;
function model(engine, source) {
  return parse(source, {}, engine, { catalog: buildDialogStatementCatalog(renderer, engine) });
}
const npc = raw => '[@main]\n#SAY\n' + raw + '\n[@done]\n#SAY\n完成';
const element = (engine, raw) => model(engine, npc(raw)).pages[0].elements[0];

for (const control of ['UserItem', 'HeroUserItem']) {
  for (const [args, slots] of [['2:30:40:10:11/@done', '2:80:90:10:11/@done'], ['2:8:30:40:10:11:1', '2:8:80:90:10:11:1']]) {
    const source = npc('<' + control + ':' + args + '>');
    const document = model('GEE', source);
    const e = document.pages[0].elements[0];
    assert.deepEqual([e.x.sourceValue, e.y.sourceValue], [30, 40]);
    assert.equal(e.itemPreview.lightCode, 11);
    const edits = buildDialogCoordinateEdits(source, document, [{ elementId: e.id, x: 80, y: 90 }]);
    assert.equal(applyTextReplacements(source, edits.replacements), source.replace(args, slots));
  }
}
for (const [slot, target, drag, enabled] of [[71,0,1,true],[120,'',1,true],[71,1,1,false],[70,0,1,false],[71,0,0,false]]) {
  const e = element('GOM', '<UserItem:' + [slot,30,40,0,target,0,0,40,0,0,drag].join(':') + '/@done>');
  assert.equal(Boolean(e.itemPreview.allowItemDrag), enabled);
  assert.equal(e.runtimeActionPreview?.link, enabled ? undefined : '@done');
}
for (const [control, mode] of [['EquipShow','equipment'], ['DBItemShow','unique-item']]) {
  const e = element('996PC', '<' + control + ':2:30:40:1:0/@done>');
  assert.equal(e.itemPreview.mode, mode);
  assert.deepEqual([e.x.sourceValue, e.y.sourceValue, e.localParameterTarget], [30, 40, '@done']);
}
assert.equal(element('996PC', '<EquipShow|index=2|effectshow=3>').itemPreview.effectShow, 3);
assert.equal(element('996PC', '<EquipShow|index=2|effectshow=4>').itemPreview.effectShow, undefined);
assert.equal(element('996PC', '<ITEMBOX:1:2:3:4:5:6:7:0:说明>').itemPreview.boxIndex, 1);
for (const [ids, target] of [['1,40','@done'], ['41', undefined], ['*','@done']]) {
  const e = element('GEE', '<ImgNum:9:1234:-3:0:0:' + ids + '|备注/@done>');
  assert.equal(e.localParameterTarget, target);
  if (ids === '*') assert.equal(e.runtimeActionPreview.submitAllInputs, true);
}
const icon = '<Button|wil=NewopUI|pcnimg=140|text=领取|link=@done>';
function icons(commands) {
  const source = ['[@main]', '#ACT', 'MOV S$控件 ' + icon, ...commands, '#SAY', '面板', '[@done]', '#SAY', '结束'].join('\n');
  return model('996PC', source).pages[0].elements.filter(e => e.panelButton);
}
const add = 'ADDBUTTON 101 1 <$STR(S$控件)>';
assert.equal(icons([add])[0].runtimeActionPreview.link, '@done');
assert.equal(icons([add])[0].localParameterTarget, undefined);
assert.equal(icons([add, 'DELBUTTON 101 1']).length, 0);
assert.equal(icons([add, 'DELBUTTON 102 1']).length, 1);
assert.equal(icons([add, 'ADDBUTTON 101 1 ' + icon.replace('领取', '提交')])[0].text, '提交');

function hover(engine, source, needle) {
  const index = buildSayMarkupIndex(activeStaticLanguageEntries(say, engine));
  return findDocumentSayHover(source, source.lastIndexOf(needle) + Math.floor((needle.length - 1) / 2), index);
}
const packed = ['[@main]', '#IF', '#ACT', 'MOV S$显示1 1:2:3', 'MOV S$选择1 3:3:3',
  'MOV S$显示<$STR(N$按钮)> <$STR(S$选择<$STR(N$按钮)>)>', '#IF', 'CHECK [12] 1', '#ACT',
  'MOV S$图标 <&IMGEX:1:<$STR(S$显示1)>:504:042/@切换(1)>'].join('\n');
assert.match(hover('GOM', packed, '504').parameter.meaning, /横向/);
assert.match(hover('GOM', packed, '042').parameter.meaning, /纵向/);
assert.match(hover('GOM', packed.replace('3:3:3', '<$USERNAME>'), '042').parameter.meaning, /运行时/);
assert.match(hover('GOM', packed.replace('MOV S$图标', '#SAY\n正文\n#ACT\nMOV S$显示1 未知\nMOV S$图标'), '042').parameter.meaning, /运行时/);
const multiline = '#SAY\r\n<MText:#L02~:0:0:70:第一行|\r\n第二行<$USERNAME>|\r\n第三行>\r\n#ACT\r\nMOV S$字 结束';
assert.match(hover('GEE', multiline, '第三行').parameter.meaning, /文字|内容/);
assert.equal(hover('GEE', multiline, '结束'), undefined);
assert.equal(hover('GEE', '#SAY\n<MText:#L02~:0:0:70:未结束\n#ACT\nMOV S$新 <$USERNAME>','新'), undefined);
assert.match(hover('996PC','<Img|x=5|submitInput=1|pcimg=115>', 'submitInput').parameter.meaning, /输入/);
for (const engine of ['GOM','GEE','996PC']) {
  assert.match(hover(engine, '<说明|查看详情/@打开>', '查看详情').parameter.meaning, /提示/);
  assert.match(hover(engine, '<说明/AUTOCOLOR=251,254>', '251').parameter.meaning, /颜色/);
}
console.log('manual-dialog-updates.test.js: PASS');
