const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const staticLanguage = require('../data/static-language.json');
const {
  buildDialogStatementCatalog,
} = require('../out/ui-dialog/statement-catalog');
const {
  parseNpcDialogDocument,
} = require('../out/ui-dialog/source-parser');
const {
  applyTextReplacements,
  buildDialogCoordinateEdits,
} = require('../out/ui-dialog/source-patcher');
const {
  parseNpcDialogOffsets,
  workspaceNpcDialogOffsets,
} = require('../out/ui-dialog/offsets');
const {
  ScriptDataResolver,
} = require('../out/utils/script-data-resolver');
const {
  defaultItemFrameImageIndex,
  resolveItemFrameAssetReference,
} = require('../out/ui-dialog/item-preview');

function parse(text, engine, offsets, cursorNeedle = '[@main]', extra = {}) {
  const cursorOffset = text.indexOf(cursorNeedle) + cursorNeedle.length;
  assert.ok(cursorOffset >= cursorNeedle.length, `missing cursor marker ${cursorNeedle}`);
  return parseNpcDialogDocument(text, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/test.txt',
    fileName: 'test.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\test.txt',
    documentVersion: 7,
    engine,
    engineLabel: engine,
    cursorOffset,
    offsets,
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
    conditionStates: extra.conditionStates,
    dataOptions: extra.dataOptions,
  });
}

function testSetupOffsets() {
  const offsets = parseNpcDialogOffsets([
    'NpcMemoOffSetX=-28',
    'NpcMemoOffSetY=32',
    'NpcMenuListOffSetX=3',
    'NpcMenuListOffSetY=-4',
  ].join('\r\n'), 'D:\\MirServer\\Mir200\\!Setup.txt');
  assert.deepEqual(
    {
      memoX: offsets.memoX,
      memoY: offsets.memoY,
      menuX: offsets.menuX,
      menuY: offsets.menuY,
      source: offsets.source,
      configured: offsets.configured,
    },
    { memoX: -28, memoY: 32, menuX: 3, menuY: -4, source: 'setup', configured: true }
  );

  assert.deepEqual(workspaceNpcDialogOffsets(12.9, -6.8), {
    memoX: 12,
    memoY: -6,
    menuX: 0,
    menuY: 0,
    source: 'workspace',
    configured: true,
  });
}

function testGomScenesAndLosslessPatch() {
  const source = [
    '[@main]',
    '#IF',
    'CHECKLEVEL > 10',
    '#ACT',
    'OPENMERCHANTBIGDLG 1 3260 1 4 0 -50 1 431 40',
    '#SAY',
    '<&TEXT:绝对文字:74:86{FCOLOR=250}>',
    '<TEXT:相对文字:10:20{FCOLOR=251}>',
    '<&TEXT:动态坐标:<$STR(N$X)>:20{FCOLOR=252}>',
    '<UNCONFIRMEDUI:1:2:3>',
    '#ELSESAY',
    '<&TEXT:条件失败:40:50{FCOLOR=253}>',
    '',
  ].join('\r\n');
  const offsets = workspaceNpcDialogOffsets(7, -4);
  const model = parse(source, 'GOM', offsets);

  assert.equal(model.functionLabel, '@main');
  assert.equal(model.scenes.length, 2, 'each #SAY/#ELSESAY branch must be selectable');
  assert.deepEqual(model.scenes[0].conditions, ['CHECKLEVEL > 10']);
  assert.deepEqual(model.scenes[0].conditionOperators, ['AND']);
  assert.equal(model.scenes[0].conditionGroupId, model.scenes[1].conditionGroupId);
  assert.equal(model.scenes[0].previewPath[model.scenes[0].conditionGroupId], true);
  assert.equal(model.scenes[1].previewPath[model.scenes[1].conditionGroupId], false);
  assert.equal(model.scenes[0].background.willIndex, 1);
  assert.equal(model.scenes[0].background.imageIndex, 3260);
  assert.equal(model.scenes[0].unsupportedStatements.length, 1);

  const absolute = model.scenes[0].elements.find(item => item.text === '绝对文字');
  const relative = model.scenes[0].elements.find(item => item.text === '相对文字');
  const dynamic = model.scenes[0].elements.find(item => item.text === '动态坐标');
  assert.ok(absolute && relative && dynamic);
  assert.equal(absolute.coordinateMode, 'absolute');
  assert.equal(absolute.sourceCoordinateBiasX, 4);
  assert.equal(absolute.sourceCoordinateBiasY, 4);
  assert.equal(absolute.x.displayValue, 70);
  assert.equal(absolute.y.displayValue, 82);
  assert.equal(relative.coordinateMode, 'relative');
  assert.equal(relative.x.sourceValue, 10);
  assert.equal(relative.y.sourceValue, 20);
  assert.equal(relative.x.displayValue, 13, 'relative X must include M2 correction and the legacy 4px bias');
  assert.equal(relative.y.displayValue, 12, 'relative Y must include M2 correction and the legacy 4px bias');
  assert.equal(dynamic.editable, false, 'runtime expressions must remain source-locked');

  const edit = buildDialogCoordinateEdits(source, model, [
    { elementId: absolute.id, x: 100, y: 120 },
    { elementId: relative.id, x: 30, y: 40 },
  ]);
  assert.equal(edit.changedElements, 2);
  const patched = applyTextReplacements(source, edit.replacements);
  assert.match(patched, /<&TEXT:绝对文字:104:124\{FCOLOR=250\}>/);
  assert.match(patched, /<TEXT:相对文字:27:48\{FCOLOR=251\}>/);
  assert.ok(patched.includes('<UNCONFIRMEDUI:1:2:3>'), 'unknown syntax must be preserved verbatim');

  const noop = buildDialogCoordinateEdits(source, model, [
    { elementId: relative.id, x: 13, y: 12 },
  ]);
  assert.equal(noop.replacements.length, 0);
  assert.equal(applyTextReplacements(source, noop.replacements), source);
}

function test996KeyValueAndGotoScene() {
  const source = [
    '[@main]',
    '#ACT',
    'GOTO @会员界面',
    '',
    '[@会员界面]',
    '#IF',
    'CHECKGAMEGOLD > 0',
    '#SAY',
    '<Text|text=会员文字|x=10|y=20|color=250|size=14|link=@购买>',
    '',
  ].join('\n');
  const offsets = workspaceNpcDialogOffsets(-28, -32);
  const model = parse(source, '996PC', offsets);

  assert.equal(model.scenes.length, 1);
  assert.equal(model.scenes[0].sourceLabel, '@会员界面');
  assert.deepEqual(model.scenes[0].conditions, ['CHECKGAMEGOLD > 0']);
  const text = model.scenes[0].elements[0];
  assert.equal(text.statementId, 'newui-text-996pc');
  assert.equal(text.coordinateMode, 'relative');
  assert.equal(text.sourceCoordinateBiasX, 0, '996PC key-value UI must not inherit legacy positional bias');
  assert.equal(text.sourceCoordinateBiasY, 0);
  assert.equal(text.x.displayValue, -18);
  assert.equal(text.y.displayValue, -12);

  const edit = buildDialogCoordinateEdits(source, model, [
    { elementId: text.id, x: 0, y: 0 },
  ]);
  const patched = applyTextReplacements(source, edit.replacements);
  assert.match(patched, /<Text\|text=会员文字\|x=28\|y=32\|color=250/);
}

function testLegacyCoordinateBiasByControlType() {
  const source = [
    '[@main]',
    '#SAY',
    '<&TEXT:文字:104:204{FCOLOR=250}>',
    '<&COUNTDOWN:59:1:255:114:214>',
    '<&INPUTTEXT:1:124:224:120:30:0:255:255:0:20:错误:请输入:128>',
    '<&INPUTNUM:2:134:234:100:30:0:255:255:0:999:错误:请输入数字:128>',
    '<&IMG:1:2:144:244>',
    '<&PLAYIMG:1:10:4:100:154:254>',
    '<&ITEMSHOW:1927:0:164:264:1>',
    '',
  ].join('\r\n');
  const model = parse(source, 'GOM', workspaceNpcDialogOffsets(0, 0));
  const page = model.pages[0];
  const byCommand = command => page.elements.find(element => (
    element.token.replace(/^<&?/, '').toUpperCase() === command
  ));
  const expected = {
    TEXT: [100, 200],
    COUNTDOWN: [110, 210],
    INPUTTEXT: [120, 220],
    INPUTNUM: [130, 230],
    IMG: [144, 244],
    PLAYIMG: [154, 254],
    ITEMSHOW: [164, 264],
  };
  for (const [command, [x, y]] of Object.entries(expected)) {
    const element = byCommand(command);
    assert.ok(element, `${command} must be parsed`);
    assert.equal(element.x.displayValue, x, `${command} display X`);
    assert.equal(element.y.displayValue, y, `${command} display Y`);
    const biased = ['TEXT', 'COUNTDOWN', 'INPUTTEXT', 'INPUTNUM'].includes(command);
    assert.equal(element.sourceCoordinateBiasX, biased ? 4 : 0, `${command} source bias`);
  }
  assert.equal(byCommand('INPUTTEXT').kind, 'input');
  assert.equal(byCommand('INPUTNUM').kind, 'input');
  assert.deepEqual(
    {
      sourceX: byCommand('ITEMSHOW').x.sourceValue,
      sourceY: byCommand('ITEMSHOW').y.sourceValue,
      displayX: byCommand('ITEMSHOW').x.displayValue,
      displayY: byCommand('ITEMSHOW').y.displayValue,
    },
    { sourceX: 164, sourceY: 264, displayX: 164, displayY: 264 },
    'ITEMSHOW source and canvas coordinates must be identical'
  );

  const moved = ['TEXT', 'COUNTDOWN', 'INPUTTEXT', 'INPUTNUM', 'ITEMSHOW'].map(command => {
    const element = byCommand(command);
    return { elementId: element.id, x: element.x.displayValue + 1, y: element.y.displayValue + 2 };
  });
  const patched = applyTextReplacements(
    source,
    buildDialogCoordinateEdits(source, model, moved).replacements
  );
  assert.match(patched, /<&TEXT:文字:105:206\{FCOLOR=250\}>/);
  assert.match(patched, /<&COUNTDOWN:59:1:255:115:216>/);
  assert.match(patched, /<&INPUTTEXT:1:125:226:/);
  assert.match(patched, /<&INPUTNUM:2:135:236:/);
  assert.match(patched, /<&ITEMSHOW:1927:0:165:266:1>/,
    'ITEMSHOW must round-trip exact coordinates without the legacy 4px text bias');
}

function testEquivalentConditionsShareSingleSwitch() {
  const source = [
    '[@main]',
    '#SAY',
    '<&TEXT:默认内容:10:20>',
    '#IF',
    'check [732] 0',
    '#SAY',
    '<&TEXT:按钮可用:30:40>',
    '#IF',
    'check [732] 0',
    '#SAY',
    '<&TEXT:已突破:50:60>',
    '#ELSESAY',
    '<&TEXT:未突破:70:80>',
    '',
  ].join('\n');
  const initial = parse(source, 'GOM', workspaceNpcDialogOffsets(0, 0));
  assert.equal(initial.conditionGroups.length, 1,
    'equivalent conditions in one function must produce one preview switch');
  const [group] = initial.conditionGroups;
  assert.deepEqual(group.conditions, ['check [732] 0']);
  assert.deepEqual(initial.pages[0].conditionGroupIds, [group.id]);
  assert.ok(initial.pages[0].elements.some(element => element.text === '默认内容'));
  assert.ok(initial.pages[0].elements.some(element => element.text === '未突破'));
  assert.ok(!initial.pages[0].elements.some(element => element.text === '按钮可用'));
  assert.ok(!initial.pages[0].elements.some(element => element.text === '已突破'));

  const selected = parse(
    source,
    'GOM',
    workspaceNpcDialogOffsets(0, 0),
    '[@main]',
    { conditionStates: { [group.id]: true } }
  );
  assert.equal(selected.conditionGroups.length, 1);
  assert.ok(selected.pages[0].elements.some(element => element.text === '按钮可用'));
  assert.ok(selected.pages[0].elements.some(element => element.text === '已突破'));
  assert.ok(!selected.pages[0].elements.some(element => element.text === '未突破'));
  assert.ok(selected.scenes.filter(scene => scene.conditionGroupId).every(
    scene => scene.conditionGroupId === group.id
  ), 'all equivalent source blocks must follow the canonical switch');
}

function testTextContentExtraction() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<&text:普通正文:10:20>',
    '<&TEXT::30:40>',
    '<MText:~#M1:50:60:250:第一行|第二行|第三行>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const page = model.pages[0];
  assert.ok(page.elements.some(element => element.text === '普通正文'),
    'lower-case TEXT tokens must still expose their actual content');
  assert.ok(page.elements.some(element => element.text === ''),
    'an unresolved or intentionally empty text value must remain empty instead of becoming the command token');
  const multi = page.elements.find(element => element.statementId === 'container-mtext');
  assert.equal(multi.text, '第一行\n第二行\n第三行');
}

function testTooltipRemarksAcrossEngines() {
  const gom = parse([
    '[@main]',
    '#SAY',
    '<&text:移动查看备注|这些是备注^换一行^250#这行字是绿色:20:30/@查看>',
    '<IMG:1600:0:40:50|254#标题^250#说明内容/@测试>',
    '<IMGEX:0:1600:1601:1602:60:70|ItemShow#13#0/@物品>',
    '<PLAYIMG:0:1610:10:100:80:90:0:0|动态图片备注>',
    '<ITEMBOX:2:10:99:100:110:42:43:5:放入物品^250#绿色提示>',
    '<GOM引擎官方网站|253#网站备注^254#第二行/@打开>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const gomPage = gom.pages[0];
  const text = gomPage.elements.find(element => element.text === '移动查看备注');
  assert.ok(text?.tooltipPreview);
  assert.equal(text.tooltipPreview.kind, 'text');
  assert.deepEqual(text.tooltipPreview.lines.map(line => line.map(run => run.text).join('')), [
    '这些是备注', '换一行', '这行字是绿色',
  ]);
  assert.equal(text.tooltipPreview.lines[2][0].color, '#00ff00');
  const image = gomPage.elements.find(element => element.statementId === 'img-relative');
  assert.equal(image.tooltipPreview.lines[0][0].color, '#00ffff');
  const imageEx = gomPage.elements.find(element => element.statementId === 'imgex-absolute-relative-compat');
  assert.deepEqual({
    kind: imageEx.tooltipPreview.kind,
    itemIndex: imageEx.tooltipPreview.itemIndex,
    itemMode: imageEx.tooltipPreview.itemMode,
  }, { kind: 'item', itemIndex: 13, itemMode: 0 });
  assert.equal(
    gomPage.elements.find(element => /playimg/i.test(element.statementId)).tooltipPreview.lines[0][0].text,
    '动态图片备注'
  );
  assert.equal(
    gomPage.elements.find(element => element.statementId === 'item-box').tooltipPreview.lines[1][0].color,
    '#00ff00'
  );
  const flow = gomPage.elements.find(element => element.statementId === 'flow-text-tooltip');
  assert.equal(flow.text, 'GOM引擎官方网站');
  assert.equal(flow.tooltipPreview.lines.length, 2);

  const gee = parse([
    '[@main]',
    '#SAY',
    '<PlayImg:5:510:3:100:10:10:0:249#翎风提示^250#第二行/@播放图片>',
    '<PlayImgEx:1:520:10:150:5:280:-50:0:250#循环提示/@播放图片>',
    '<CustomItem:0:1:1549:1:2:0:自定义装备框提示>',
    '<StateItem:30:20:30:0|253#状态物品提示/@状态>',
  ].join('\n'), 'GEE', workspaceNpcDialogOffsets(0, 0));
  const geePage = gee.pages[0];
  const geePlay = geePage.elements.find(element => statementName(element) === 'PLAYIMG');
  const geePlayEx = geePage.elements.find(element => statementName(element) === 'PLAYIMGEX');
  assert.equal(geePlay.tooltipPreview.lines[0][0].color, '#ff0000');
  assert.equal(geePlayEx.tooltipPreview.lines[0][0].color, '#00ff00');
  assert.equal(
    geePage.elements.find(element => element.statementId === 'custom-item-preview').tooltipPreview.lines[0][0].text,
    '自定义装备框提示'
  );
  assert.equal(
    geePage.elements.find(element => element.statementId === 'state-item-preview').tooltipPreview.lines[0][0].color,
    '#ff00ff'
  );

  const pc = parse([
    '[@main]',
    '#SAY',
    '<Text|text=新界面文字|x=10|y=20|tips=普通备注^250#绿色{使用数量|246}|tipsx=10|tipsy=80>',
    '<Button|wil=NewopUI|pcnimg=10|pcmimg=11|pcpimg=12|text=测试|tips={点击查看/FCOLOR=250}|x=30|y=40>',
    '<ITEMBOX|boxindex=2|stdmode=5|wil=NewopUI|pcimg=400|tips=<只能放入衣服/FCOLOR=249>|tipsx=4|tipsy=100>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const pcPage = pc.pages[0];
  const pcText = pcPage.elements.find(element => element.statementId === 'newui-text-996pc');
  assert.equal(pcText.text, '新界面文字');
  assert.deepEqual(
    { x: pcText.tooltipPreview.offsetX, y: pcText.tooltipPreview.offsetY },
    { x: 10, y: 80 }
  );
  assert.equal(pcText.tooltipPreview.lines[1][0].color, '#00ff00');
  assert.equal(pcText.tooltipPreview.lines[1][1].color, '#fffbf0');
  const button = pcPage.elements.find(element => element.statementId === 'newui-button-996pc');
  assert.equal(button.tooltipPreview.lines[0][0].color, '#00ff00');
  const pcBox = pcPage.elements.find(element => element.statementId === 'newui-itembox-996pc');
  assert.equal(pcBox.text, 'OK框 2', 'ITEMBOX tips must not replace the control label');
  assert.equal(pcBox.tooltipPreview.lines[0][0].color, '#ff0000');
}

function statementName(element) {
  return element.token.replace(/^<&?/, '').toUpperCase();
}

function testSayLinkTraversalAndOrConditions() {
  const source = [
    '[@main]',
    '#SAY',
    '<&IMGEX:1:2:3:4:5:6/@会员界面>',
    '',
    '[@会员界面]',
    '#IF',
    'CHECKGAMEGOLD > 0',
    '#OR',
    'CHECKGAMEPOINT > 0',
    '#SAY',
    '<&TEXT:满足:10:20{FCOLOR=250}>',
    '#ELSESAY',
    '<&TEXT:不满足:30:40{FCOLOR=251}>',
    '',
  ].join('\n');
  const model = parse(source, 'GOM', workspaceNpcDialogOffsets(0, 0));
  assert.equal(model.scenes.length, 3, 'clickable /@ labels must add all linked #SAY branches');
  const linked = model.scenes.filter(scene => scene.sourceLabel === '@会员界面');
  assert.equal(linked.length, 2);
  assert.deepEqual(linked[0].conditionOperators, ['AND', 'OR']);
  assert.match(linked[0].conditionSummary, /或 CHECKGAMEPOINT/);
  assert.equal(linked[0].conditionGroupId, linked[1].conditionGroupId);
}

function testConditionalSceneInheritsDefaultOutput() {
  const source = [
    '[@main]',
    '#IF',
    '#ACT',
    'OPENMERCHANTBIGDLG 1 1050 1 4 0 -50 1 367 40',
    '#SAY',
    '<&TEXT:默认标题:20:30{FCOLOR=250}>',
    '<&IMG:100:1:40:50>',
    '#IF(1)',
    'CHECKITEMW 承影',
    '#SAY',
    '<&TEXT:满足条件:60:70{FCOLOR=251}>',
    '#ELSESAY',
    '<&TEXT:不满足条件:80:90{FCOLOR=253}>',
    '',
  ].join('\n');
  const model = parse(source, 'GOM', workspaceNpcDialogOffsets(0, 0));
  assert.equal(model.conditionGroups[0].title, '@main · 条件 1',
    'setup-only #IF blocks must not make the visible condition numbering start at 2');
  const defaultScene = model.scenes.find(scene => scene.conditionGroupId === undefined);
  const trueScene = model.scenes.find(scene => scene.marker === '#SAY' && scene.conditionGroupId);
  const falseScene = model.scenes.find(scene => scene.marker === '#ELSESAY');
  assert.ok(defaultScene && trueScene && falseScene);
  assert.deepEqual(defaultScene.elements.map(element => element.text), ['默认标题', '<&IMG:100:1:40:50>']);
  assert.ok(trueScene.elements.some(element => element.text === '默认标题'));
  assert.ok(trueScene.elements.some(element => element.text === '满足条件'));
  assert.ok(falseScene.elements.some(element => element.text === '默认标题'));
  assert.ok(falseScene.elements.some(element => element.text === '不满足条件'));
  assert.equal(trueScene.background.imageIndex, 1050);
  assert.equal(falseScene.background.imageIndex, 1050);
  assert.equal(defaultScene.previewPath[trueScene.conditionGroupId], false);
  assert.equal(trueScene.previewPath[trueScene.conditionGroupId], true);
  assert.equal(falseScene.previewPath[falseScene.conditionGroupId], false);
  assert.equal(model.pages.length, 1);
  assert.ok(model.pages[0].elements.some(element => element.text === '默认标题'));
  assert.ok(model.pages[0].elements.some(element => element.text === '不满足条件'));
  assert.ok(!model.pages[0].elements.some(element => element.text === '满足条件'));
}

function testScenePreviewPathsPreserveOtherSimulationState() {
  const source = [
    '[@main]',
    '#SAY',
    '<&TEXT:默认界面:10:20>',
    '#IF(1)',
    'CHECKITEMW 承影',
    '#SAY',
    '<&TEXT:物品满足:30:40>',
    '#ELSESAY',
    '<&TEXT:物品不满足:50:60>',
    '#IF(2)',
    'CHECKGAMEGOLD > 0',
    '#SAY',
    '<&TEXT:元宝满足:70:80>',
    '#ELSESAY',
    '<&TEXT:元宝不满足:90:100>',
    '',
  ].join('\n');
  const initial = parse(source, 'GOM', workspaceNpcDialogOffsets(0, 0));
  assert.equal(initial.conditionGroups.length, 2);
  const [itemGroup, goldGroup] = initial.conditionGroups;
  const selected = parse(
    source,
    'GOM',
    workspaceNpcDialogOffsets(0, 0),
    '[@main]',
    { conditionStates: { [itemGroup.id]: true, [goldGroup.id]: true } }
  );
  const itemFalse = selected.scenes.find(scene => (
    scene.conditionGroupId === itemGroup.id && scene.marker === '#ELSESAY'
  ));
  const goldFalse = selected.scenes.find(scene => (
    scene.conditionGroupId === goldGroup.id && scene.marker === '#ELSESAY'
  ));
  const defaultScene = selected.scenes.find(scene => !scene.conditionGroupId);
  assert.ok(itemFalse && goldFalse && defaultScene);
  assert.deepEqual(itemFalse.previewPath, {
    [itemGroup.id]: false,
    [goldGroup.id]: true,
  });
  assert.deepEqual(goldFalse.previewPath, {
    [itemGroup.id]: true,
    [goldGroup.id]: false,
  });
  assert.deepEqual(defaultScene.previewPath, {
    [itemGroup.id]: false,
    [goldGroup.id]: false,
  });
  assert.equal(selected.pages.length, 1);
  assert.equal(selected.pages[0].activeBranchIds.length, 2,
    'all simultaneously satisfied #SAY blocks must be part of the page preview');
  assert.ok(selected.pages[0].elements.some(element => element.text === '默认界面'));
  assert.ok(selected.pages[0].elements.some(element => element.text === '物品满足'));
  assert.ok(selected.pages[0].elements.some(element => element.text === '元宝满足'));
  assert.ok(!selected.pages[0].elements.some(element => element.text === '物品不满足'));
  assert.ok(!selected.pages[0].elements.some(element => element.text === '元宝不满足'));

  const unsatisfied = parse(source, 'GOM', workspaceNpcDialogOffsets(0, 0));
  assert.equal(unsatisfied.pages[0].activeBranchIds.length, 2,
    'each unsatisfied condition must contribute its #ELSESAY block');
  assert.ok(unsatisfied.pages[0].elements.some(element => element.text === '默认界面'));
  assert.ok(unsatisfied.pages[0].elements.some(element => element.text === '物品不满足'));
  assert.ok(unsatisfied.pages[0].elements.some(element => element.text === '元宝不满足'));
  assert.ok(!unsatisfied.pages[0].elements.some(element => element.text === '物品满足'));
  assert.ok(!unsatisfied.pages[0].elements.some(element => element.text === '元宝满足'));
}

function testGotoVariableExpansionAndConditionOverride() {
  const source = [
    '[@main]',
    '#IF',
    '#ACT',
    'GOTO @获取界面数据',
    '#IF',
    '#ACT',
    '#SAY',
    '<$STR(S$下级特效)>',
    '<$STR(S$下级展示)>',
    '<$STR(S$动态文字)>',
    '<$STR(N$未定义数值)>',
    '<$STR(S$未定义文字)>',
    '',
    '[@获取界面数据]',
    '#IF',
    '#ACT',
    'MOV S$下级物品 承影',
    'MOV S$下级特效 <&PLAYIMG:1:1060:15:100:95:172><&IMG:1053:1:57:93>',
    'GETDBITEMFIELDVALUE <$STR(S$下级物品)> IDX N$展示IDX',
    'MOV N$动态序号 3',
    'MOV U<$STR(N$动态序号)> 42',
    'MOV S$动态文字 <&TEXT:<$STR(U<$STR(N$动态序号)>)>:20:30{FCOLOR=250}>',
    'MOV S$下级展示 <&ITEMSHOW:<$STR(N$展示IDX)>:0:334:177:48>',
    'MOV N$升级货币 88',
    'INC S$下级展示 <&TEXT:<$STR(N$升级货币)>灵玉:156:430{FCOLOR=255}>',
    '#IF(1)',
    'CHECKITEMW 承影',
    '#ACT',
    'MOV S$下级物品 金刚',
    'MOV S$下级特效 <&PLAYIMG:1:1080:15:100:87:174><&IMG:1054:1:57:93>',
    'GETDBITEMFIELDVALUE <$STR(S$下级物品)> IDX N$展示IDX',
    'MOV S$下级展示 <&ITEMSHOW:<$STR(N$展示IDX)>:0:334:177:48>',
    'MOV N$升级货币 188',
    'INC S$下级展示 <&TEXT:<$STR(N$升级货币)>灵玉:156:430{FCOLOR=255}>',
    '',
  ].join('\r\n');
  const dataOptions = {
    resolveDatabaseField({ itemName, field }) {
      if (field.toUpperCase() !== 'IDX') return undefined;
      if (itemName === '承影') return { value: '1927', complete: true };
      if (itemName === '金刚') return { value: '1928', complete: true };
      return undefined;
    },
  };
  const defaultModel = parse(
    source,
    'GOM',
    workspaceNpcDialogOffsets(0, 0),
    '[@main]',
    { dataOptions }
  );
  const helperCondition = defaultModel.conditionGroups.find(group => (
    group.sourceLabel === '@获取界面数据' && group.conditions.includes('CHECKITEMW 承影')
  ));
  assert.ok(helperCondition, '#IF(1) in the linked data function must be exposed as a condition');
  assert.equal(helperCondition.satisfied, false, 'linked conditions default to unsatisfied');

  const defaultScene = defaultModel.scenes.find(scene => scene.sourceLabel === '@main');
  assert.ok(defaultScene);
  assert.ok(defaultScene.elements.some(element => element.raw.includes('PLAYIMG:1:1060')));
  assert.ok(defaultScene.elements.some(element => element.raw.includes('ITEMSHOW:1927')));
  assert.ok(defaultScene.elements.some(element => element.text === '88灵玉'));
  assert.ok(defaultScene.elements.some(element => element.text === '42'));
  assert.ok(defaultScene.elements.filter(element => /1060|1053|1927|88灵玉|42/.test(element.raw)).every(
    element => element.editable === false
  ), 'variable-generated UI must remain source locked');
  const defaultVariables = new Map(defaultScene.resolvedVariables.map(variable => [variable.name, variable]));
  assert.equal(defaultVariables.get('N$展示IDX').value, '1927');
  assert.equal(defaultVariables.get('N$升级货币').value, '88');
  assert.equal(defaultVariables.get('U3').value, '42');
  assert.deepEqual(
    {
      value: defaultVariables.get('N$未定义数值').value,
      status: defaultVariables.get('N$未定义数值').status,
    },
    { value: '0', status: 'default' }
  );
  assert.deepEqual(
    {
      value: defaultVariables.get('S$未定义文字').value,
      status: defaultVariables.get('S$未定义文字').status,
    },
    { value: '', status: 'default' }
  );

  const selectedModel = parse(
    source,
    'GOM',
    workspaceNpcDialogOffsets(0, 0),
    '[@main]',
    {
      dataOptions,
      conditionStates: { [helperCondition.id]: true },
    }
  );
  const selectedScene = selectedModel.scenes.find(scene => scene.sourceLabel === '@main');
  assert.ok(selectedScene.elements.some(element => element.raw.includes('PLAYIMG:1:1080')));
  assert.ok(selectedScene.elements.some(element => element.raw.includes('ITEMSHOW:1928')));
  assert.ok(selectedScene.elements.some(element => element.text === '188灵玉'));
  const selectedVariables = new Map(selectedScene.resolvedVariables.map(variable => [variable.name, variable]));
  assert.equal(selectedVariables.get('N$展示IDX').value, '1928');
  assert.equal(selectedVariables.get('N$升级货币').value, '188');
  assert.equal(selectedScene.previewPath[helperCondition.id], false, 'default scene must reset preview conditions');
}

function testStaticConfigTableListAndFormulaValues() {
  const source = [
    '[@main]',
    '#IF',
    '#ACT',
    'GOTO @读取数据',
    '#IF',
    '#ACT',
    '#SAY',
    '<$STR(S$界面)>',
    '',
    '[@读取数据]',
    '#IF',
    '#ACT',
    'READCONFIGFILEITEM ..\\配置.ini 设置 金额 N$金额 FAST',
    'CSVGETCELLTEXT ..\\数据.csv 1 2 S$单元格',
    'GETLISTSTRING ..\\列表.txt 0 S$字段1 S$字段2 0',
    'FORMULATION <$STR(N$金额)>*2+3 N$合计',
    'MOV S$界面 <&TEXT:<$STR(N$合计)>-<$STR(S$单元格)>-<$STR(S$字段1)>-<$STR(S$字段2)>:20:30>',
    '',
  ].join('\n');
  const model = parse(
    source,
    'GOM',
    workspaceNpcDialogOffsets(0, 0),
    '[@main]',
    {
      dataOptions: {
        resolveConfigValues: () => ({ values: ['12'], complete: true }),
        resolveTableData: () => ({ rows: [['0', '0', '0'], ['A', 'B', 'C']], complete: true }),
        resolveListData: () => ({ lines: ['甲:乙'], complete: true }),
      },
    }
  );
  const scene = model.scenes.find(candidate => candidate.sourceLabel === '@main');
  assert.ok(scene.elements.some(element => element.text === '27-C-甲-乙'));
  const variables = new Map(scene.resolvedVariables.map(variable => [variable.name, variable]));
  assert.equal(variables.get('N$金额').value, '12');
  assert.equal(variables.get('N$合计').value, '27');
  assert.equal(variables.get('S$单元格').value, 'C');
  assert.equal(variables.get('S$字段1').value, '甲');
  assert.equal(variables.get('S$字段2').value, '乙');
}

function testItemFramesAndLayeredControls() {
  assert.equal(defaultItemFrameImageIndex('GOM'), 47);
  assert.equal(defaultItemFrameImageIndex('996PC'), 47);
  assert.equal(defaultItemFrameImageIndex('GEE'), 250);
  assert.deepEqual(resolveItemFrameAssetReference('GOM', 1), {
    archiveName: 'NewopUI', imageIndex: 47,
  });
  assert.deepEqual(resolveItemFrameAssetReference('GEE', 1), {
    archiveName: 'NewopUI', imageIndex: 250,
  });
  assert.deepEqual(resolveItemFrameAssetReference('GOM', 318), {
    archiveName: 'NewopUI', imageIndex: 318,
  });
  assert.equal(resolveItemFrameAssetReference('GOM', 0), undefined);

  const gom = parse([
    '[@main]',
    '#SAY',
    '<&ITEMSHOW:1927:3:10:20:1:0:1:40:0:0:1>',
    '<UserItem:0:30:40:1:0:0:0:40:0:0/@装备>',
    '<ITEMBOX:2:10:99:50:60:42:43:5:放入物品>',
    '<&PROGRESSBAR:70:80:10:100:101:1:100:2:3:0:200:50:0:250:0:0:%p/%m:测试>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const item = gom.pages[0].elements.find(element => element.statementId === 'item-show');
  assert.ok(item?.itemPreview);
  assert.equal(item.itemPreview.itemIndex, 1927);
  assert.equal(item.itemPreview.quantity, 3);
  assert.equal(item.parameters.length, 11, 'GOM ITEMSHOW must expose every documented parameter');
  assert.equal(item.parameters[9].name, '内观素材');
  assert.deepEqual(item.assetLayers[0].assetRef, { archiveName: 'NewopUI', imageIndex: 47 });

  const userItem = gom.pages[0].elements.find(element => element.statementId === 'user-item-preview');
  assert.equal(userItem.itemPreview.mode, 'equipment');
  assert.deepEqual(userItem.assetLayers[0].assetRef, { archiveName: 'NewopUI', imageIndex: 47 });
  const itemBox = gom.pages[0].elements.find(element => element.statementId === 'item-box');
  assert.equal(itemBox.itemPreview.mode, 'empty-box');
  assert.deepEqual(itemBox.assetLayers[0].assetRef, { willIndex: 10, imageIndex: 99 });
  assert.deepEqual({ width: itemBox.width, height: itemBox.height }, { width: 42, height: 43 });
  const progress = gom.pages[0].elements.find(element => element.statementId === 'progress-bar');
  assert.equal(progress.progressPreview.ratio, .25);
  assert.equal(progress.parameters[9].name, '最小值');
  assert.deepEqual(progress.assetLayers.map(layer => layer.role), ['background', 'progress']);
  assert.deepEqual(
    { willIndex: progress.assetLayers[1].assetRef.willIndex, imageIndex: progress.assetLayers[1].assetRef.imageIndex },
    { willIndex: 10, imageIndex: 101 }
  );

  const gee = parse([
    '[@main]',
    '#SAY',
    '<&ITEMSHOW:1927:0:10:20:1:0:0:1/@查看>',
    '<HeroUserItem:1:20:30:1:0/@英雄>',
    '<MakeIndexItem:12345:2:40:50:1:0:0:W/@唯一>',
    '<CustomItem:3:11:120:60:70:1:提示>',
    '<StateItem:88:80:90:1|提示/@状态>',
    '<DnItems:99:100:110:0|提示/@掉落>',
    '<NewopUI:300:120:130>',
  ].join('\n'), 'GEE', workspaceNpcDialogOffsets(0, 0));
  const geeItem = gee.pages[0].elements.find(element => element.statementId === 'item-show');
  assert.equal(geeItem.parameters.length, 9, 'GEE ITEMSHOW must include the click label parameter');
  assert.equal(geeItem.parameters[7].name, '数量单位');
  assert.deepEqual(geeItem.assetLayers[0].assetRef, { archiveName: 'NewopUI', imageIndex: 250 });
  assert.equal(gee.pages[0].elements.find(element => element.statementId === 'hero-user-item-preview').itemPreview.mode, 'hero-equipment');
  assert.equal(gee.pages[0].elements.find(element => element.statementId === 'makeindex-item-preview').itemPreview.mode, 'unique-item');
  const custom = gee.pages[0].elements.find(element => element.statementId === 'custom-item-preview');
  assert.equal(custom.itemPreview.mode, 'equipment');
  assert.deepEqual(custom.assetLayers[0].assetRef, { willIndex: 11, imageIndex: 120 });
  const state = gee.pages[0].elements.find(element => element.statementId === 'state-item-preview');
  assert.equal(state.itemPreview.mode, 'direct-archive');
  assert.deepEqual(state.assetRef, { archiveName: 'StateItem', imageIndex: 88 });
  assert.deepEqual(state.assetLayers.map(layer => layer.role), ['background', 'item']);
  const dn = gee.pages[0].elements.find(element => element.statementId === 'dnitems-preview');
  assert.deepEqual(dn.assetRef, { archiveName: 'DnItems', imageIndex: 99 });
  const newopui = gee.pages[0].elements.find(element => element.statementId === 'newopui-preview');
  assert.deepEqual(newopui.assetRef, { archiveName: 'NewopUI', imageIndex: 300 });
}

function test996ItemListsAndLoadingBar() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<ItemShow|itemid=1927|itemcount=2|showtips=1|bgtype=1|x=10|y=20|id=I1>',
    '<EquipShow|index=3|showtips=1|bgtype=1>',
    '<HEROEquipShow|index=4|showtips=1|bgtype=1>',
    '<ITEMBOX|boxindex=2|stdmode=5|wil=NewopUI|pcimg=400|tips=放入物品>',
    '<BAGITEMS|condition=5#6|select=0|count=8|row=2>',
    '<HEROEQUIPITEMS|positions=0#1|select=0|count=6|row=3>',
    '<LoadingBar|wil=NewopUI|pcloadingbg=500|pcloadingbar=501|startper=25|endper=100|maxper=100|offsetX=2|offsetY=3>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const page = model.pages[0];
  const item = page.elements.find(element => element.statementId === 'newui-itemshow-996pc');
  assert.equal(item.itemPreview.itemIndex, 1927);
  assert.deepEqual(item.assetLayers[0].assetRef, { archiveName: 'NewopUI', imageIndex: 47 });
  assert.equal(page.elements.find(element => element.statementId === 'newui-equipshow-996pc').itemPreview.mode, 'equipment');
  assert.equal(page.elements.find(element => element.statementId === 'newui-heroequipshow-996pc').itemPreview.mode, 'hero-equipment');
  const itemBox = page.elements.find(element => element.statementId === 'newui-itembox-996pc');
  assert.deepEqual(itemBox.assetLayers[0].assetRef, { archiveName: 'NewopUI', imageIndex: 400 });
  const bag = page.elements.find(element => element.statementId === 'newui-bagitems-996pc');
  assert.deepEqual(bag.containerPreview, {
    variant: 'item-grid', label: '人物物品列表', cellCount: 8, rows: 2, columns: 4,
  });
  assert.deepEqual({ width: bag.width, height: bag.height }, { width: 168, height: 84 });
  const hero = page.elements.find(element => element.statementId === 'newui-heroequipitems-996pc');
  assert.equal(hero.containerPreview.label, '英雄物品列表');
  const loading = page.elements.find(element => element.statementId === 'newui-loadingbar-996pc');
  assert.equal(loading.progressPreview.ratio, .25);
  assert.deepEqual(loading.assetLayers.map(layer => layer.assetRef), [
    { archiveName: 'NewopUI', imageIndex: 500 },
    { archiveName: 'NewopUI', imageIndex: 501 },
  ]);
}

function testAnimationsAndInteractiveButtonStates() {
  const gom = parse([
    '[@main]',
    '#SAY',
    '<&IMGEX:10:100:101:102:20:30>',
    '<&PLAYIMG:11:200:4:75:40:50>',
    '<&PLAYIMGEX:12:300:5:90:2:60:70>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const imgex = gom.pages[0].elements.find(element => element.statementId === 'imgex-absolute');
  assert.deepEqual(imgex.assetLayers.map(layer => [layer.role, layer.assetRef]), [
    ['hover', { willIndex: 10, imageIndex: 101 }],
    ['pressed', { willIndex: 10, imageIndex: 102 }],
  ]);
  const play = gom.pages[0].elements.find(element => element.statementId === 'playimg-absolute');
  assert.deepEqual(play.animationPreview, { frameCount: 4, intervalMs: 75 });
  const playEx = gom.pages[0].elements.find(element => element.statementId === 'playimgex-absolute');
  assert.deepEqual(playEx.animationPreview, { frameCount: 5, intervalMs: 90, repeatCount: 2 });

  const pc = parse([
    '[@main]',
    '#SAY',
    '<Button|wil=NewopUI|pcnimg=10|pcmimg=11|pcpimg=12|text=测试|x=20|y=30|link=@ok>',
    '<Frames|wil=NewopUI|start=100|count=6|speed=80|loop=3>',
    '<Effect|wil=NewopUI|start=200|num=7|DMode=0|gap=95|count=4|link=@ok>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const button = pc.pages[0].elements.find(element => element.statementId === 'newui-button-996pc');
  assert.deepEqual(button.assetLayers.map(layer => [layer.role, layer.assetRef]), [
    ['hover', { archiveName: 'NewopUI', imageIndex: 11 }],
    ['pressed', { archiveName: 'NewopUI', imageIndex: 12 }],
  ]);
  const frames = pc.pages[0].elements.find(element => element.statementId === 'newui-frames-996pc');
  assert.deepEqual(frames.animationPreview, { frameCount: 6, intervalMs: 80, repeatCount: 3 });
  const effect = pc.pages[0].elements.find(element => element.statementId === 'newui-effect-996pc');
  assert.equal(effect.assetRef.frameCount, 7, 'Effect num is the frame count; count is the repeat count');
  assert.deepEqual(effect.animationPreview, { frameCount: 7, intervalMs: 95, repeatCount: 4 });
}

function testTraditionalFlowAndUnknownPreservation() {
  const model = parse([
    '[@main]',
    '#SAY',
    '甲  乙\\丙&#x20;丁',
    '<UNCONFIRMEDUI:1:2:3>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const page = model.pages[0];
  const first = page.elements.find(element => element.text === '甲  乙');
  const second = page.elements.find(element => element.text === '丙 丁');
  assert.ok(first && second);
  assert.equal(second.layoutX, 18, 'backslash must start a new visual line at the flow origin');
  assert.ok(second.layoutY >= first.layoutY + 22);
  const unknown = page.elements.filter(element => element.kind === 'unknown');
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].raw, '<UNCONFIRMEDUI:1:2:3>');
  assert.equal(unknown[0].editable, false);
  assert.ok(!page.elements.some(element => (
    element.kind === 'text' && element.text.includes('UNCONFIRMEDUI')
  )), 'unknown markup must not be rendered a second time as ordinary text');
}

function testNestedContainersAndCoordinateRoundTrip() {
  const source = [
    '[@main]',
    '#SAY',
    '<Layout:~#L1:100:200:200:100:7>',
    '<IMG:#L1~#L2:10:1:5:6>',
    '<&TEXT:#L2~:子控件:4:8{FCOLOR=250}>',
    '<ListView:~#LIST:300:200:120:80:2:0:0:1:0:0:10:600:601:602:603:604:605:606:607:608:609>',
  ].join('\n');
  const model = parse(source, 'GOM', workspaceNpcDialogOffsets(10, 20));
  const page = model.pages[0];
  const root = page.elements.find(element => element.containerElementId === 'L1');
  const image = page.elements.find(element => element.containerElementId === 'L2');
  const text = page.elements.find(element => element.text === '子控件');
  assert.ok(root && image && text);
  assert.deepEqual({ x: root.layoutX, y: root.layoutY }, { x: 110, y: 220 });
  assert.equal(image.parentElementId, root.id);
  assert.deepEqual({ x: image.localLayoutX, y: image.localLayoutY }, { x: 5, y: 6 });
  assert.deepEqual({ x: image.layoutX, y: image.layoutY }, { x: 115, y: 226 });
  assert.equal(text.parentElementId, image.id);
  assert.deepEqual({ x: text.localLayoutX, y: text.localLayoutY }, { x: 0, y: 4 });
  assert.deepEqual({ x: text.layoutX, y: text.layoutY }, { x: 115, y: 230 });
  assert.equal(image.parameters[0].name, '父子容器');
  assert.equal(image.parameters[0].value, '#L1~#L2');
  const list = page.elements.find(element => element.statementId === 'container-listview');
  assert.deepEqual(list.assetLayers[0].assetRef, { willIndex: 10, imageIndex: 600 });

  const patched = applyTextReplacements(source, buildDialogCoordinateEdits(source, model, [
    { elementId: root.id, x: 120, y: 230 },
    { elementId: text.id, x: 126, y: 235 },
  ]).replacements);
  assert.match(patched, /<Layout:~#L1:110:210:/, 'root source coordinates must retain M2 correction');
  assert.match(patched, /<&TEXT:#L2~:子控件:5:3\{FCOLOR=250\}>/,
    'nested child must be written as a local coordinate after parent movement');

  const pc = parse([
    '[@main]',
    '#SAY',
    '<Layout|id=L1|children={T1}|x=100|y=100|width=200|height=100>',
    '<Text|id=T1|text=子节点|x=5|y=6|color=250>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(7, -4));
  const pcRoot = pc.pages[0].elements.find(element => element.containerElementId === 'L1');
  const pcChild = pc.pages[0].elements.find(element => element.containerElementId === 'T1');
  assert.equal(pcChild.parentElementId, pcRoot.id);
  assert.deepEqual({ x: pcChild.localLayoutX, y: pcChild.localLayoutY }, { x: 5, y: 6 });
  assert.deepEqual({ x: pcChild.layoutX, y: pcChild.layoutY }, { x: 112, y: 102 });
  assert.equal(pcRoot.parameters.find(parameter => parameter.key === 'children').value, '{T1}',
    'key-value parameter display must preserve brace syntax');
}

function testSourcePatchConflictGuards() {
  const source = '[@main]\n#SAY\n<&TEXT:测试:14:24>\n';
  const model = parse(source, 'GOM', workspaceNpcDialogOffsets(0, 0));
  const element = model.pages[0].elements.find(candidate => candidate.text === '测试');
  assert.ok(element);
  assert.throws(
    () => buildDialogCoordinateEdits(source.replace(':14:24', ':15:24'), model, [
      { elementId: element.id, x: 20, y: 20 },
    ]),
    /源码中的 X 坐标已被修改/,
    'stale source spans must stop visual writeback'
  );
  assert.throws(
    () => buildDialogCoordinateEdits(source, model, [
      { elementId: element.id, x: Number.NaN, y: 20 },
    ]),
    /坐标必须是有效数字/
  );
  const rounded = buildDialogCoordinateEdits(source, model, [
    { elementId: element.id, x: 20.4, y: -6.6 },
  ]);
  assert.match(applyTextReplacements(source, rounded.replacements), /<&TEXT:测试:24:-3>/);
}

function testEveryCatalogStatementBuildsADomModel() {
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const variants = (staticLanguage.saySnippets || []).filter(entry => entry.engineVariants?.[engine]);
    for (const entry of variants) {
      const snippet = entry.engineVariants[engine].snippet.replace(/\$\{\d+:[^}]+\}/g, '1');
      const model = parse(`[@main]\n#SAY\n${snippet}\n`, engine, workspaceNpcDialogOffsets(0, 0));
      assert.equal(model.pages.length, 1, `${engine}/${entry.id} must create one page`);
      assert.deepEqual(
        model.pages[0].unsupportedStatements,
        [],
        `${engine}/${entry.id} is in the catalog and must not fall back to an unsupported statement`
      );
      assert.ok(
        model.pages[0].elements.length > 0,
        `${engine}/${entry.id} must become at least one DOM element`
      );
    }
  }
}

async function testWorkspaceDatabaseFieldResolver() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-npc-dialog-data-'));
  try {
    const sourceFile = path.join(tempRoot, 'MirServer', 'Mir200', 'Envir', 'Market_Def', 'test.txt');
    const databaseFile = path.join(tempRoot, 'MirServer', 'MUD2', 'db', 'herodb.DB');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
    fs.writeFileSync(sourceFile, '[@main]\r\n#SAY\r\n');
    const SQL = await require('sql.js')();
    const database = new SQL.Database();
    database.run('CREATE TABLE StdItems (Idx INTEGER, Name TEXT, Looks INTEGER)');
    database.run('INSERT INTO StdItems VALUES (?, ?, ?)', [1927, '承影', 20699]);
    fs.writeFileSync(databaseFile, Buffer.from(database.export()));
    database.close();

    const resolver = new ScriptDataResolver();
    await resolver.prepareFor(sourceFile);
    assert.deepEqual(
      resolver.optionsFor(sourceFile).resolveDatabaseField({ itemName: '承影', field: 'idx' }),
      { value: '1927', complete: true }
    );
    assert.deepEqual(
      resolver.optionsFor(sourceFile).resolveDatabaseField({ itemName: '承影', field: 'FLD_LOOKS' }),
      { value: '20699', complete: true }
    );
    assert.equal(resolver.resolveItemFieldByIndex(sourceFile, 1927, 'Looks'), '20699');
    assert.equal(resolver.resolveItemFieldByName(sourceFile, '承影', 'Looks'), '20699');
    assert.equal(resolver.resolveItemFieldByIndex(sourceFile, 9999, 'Looks'), undefined);
    resolver.dispose();
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function testManifestAndEditorIsolation() {
  const root = path.join(__dirname, '..');
  const manifest = require('../package.json');
  assert.ok(manifest.activationEvents.includes('onCommand:boo.openNpcDialogVisualEditor'));
  assert.ok(manifest.contributes.commands.some(command => (
    command.command === 'boo.openNpcDialogVisualEditor'
  )));
  assert.ok(manifest.contributes.keybindings.some(binding => (
    binding.command === 'boo.openNpcDialogVisualEditor'
    && binding.key === 'ctrl+f12'
    && binding.when.includes('editorLangId == gomscript')
  )));

  const provider = fs.readFileSync(
    path.join(root, 'src', 'providers', 'npc-dialog-visual.ts'),
    'utf8'
  );
  assert.doesNotMatch(provider, /['"]editor\.html['"]/, 'new editor must not load the old UI editor');
  assert.doesNotMatch(provider, /enableFindWidget/, 'floating webview must not retain a stale find frame');
  assert.match(provider, /workbench\.action\.moveEditorToNewWindow/);
  assert.match(provider, /case 'ready':[\s\S]*moveToFloatingWindow\(session\)/);
  assert.match(provider, /workspaceState\.update\(GEE_OFFSET_STATE_KEY/);
  assert.match(provider, /new ScriptDataResolver\(\)/);
  assert.match(provider, /case 'previewCondition':/);
  assert.match(provider, /case 'resetPreview':/);
  assert.match(provider, /modelRevision/);
  assert.match(provider, /preserveDrafts/);
  assert.match(provider, /confirmDiscardDrafts\(session, '重新载入'\)/);
  assert.match(provider, /confirmDiscardDrafts\(session, '修改坐标修正值'\)/);
  assert.match(provider, /reloadSession\(session, true, session\.dirty\)/,
    'engine changes must preserve compatible visual drafts');
  assert.ok(
    provider.indexOf('panel.webview.onDidReceiveMessage') < provider.indexOf('panel.webview.html ='),
    'the ready listener must be installed before assigning Webview HTML'
  );
  const previewHandlers = provider.slice(
    provider.indexOf('private async previewCondition('),
    provider.indexOf('private async reloadSession(')
  );
  assert.doesNotMatch(previewHandlers, /WorkspaceEdit|applyEdit|document\.save/,
    'preview scene and condition changes must never write source text');
  const webviewScript = fs.readFileSync(
    path.join(root, 'media', 'npc-dialog-visual.js'),
    'utf8'
  );
  assert.match(webviewScript, /let previewConditions = new Map\(\)/);
  assert.match(webviewScript, /createSceneGroup/);
  assert.match(webviewScript, /createBranchButton/);
  assert.match(webviewScript, /advancedConditionList/);
  assert.doesNotMatch(webviewScript, /checkbox|conditionChanged/);
  assert.match(webviewScript, /model\?\.pages/);
  assert.match(webviewScript, /formatPageConditions/);
  assert.match(webviewScript, /elements\.variableList/);
  assert.match(webviewScript, /history = history\.filter\(entry => validElements\.has\(entry\.id\)\)/);
  const webviewHtml = fs.readFileSync(
    path.join(root, 'media', 'npc-dialog-visual.html'),
    'utf8'
  );
  assert.match(webviewHtml, /id="resetPreview"/);
  assert.match(webviewHtml, /id="advancedConditions"/);
  assert.doesNotMatch(webviewHtml, /type="checkbox"/);
  const webviewCss = fs.readFileSync(
    path.join(root, 'media', 'npc-dialog-visual.css'),
    'utf8'
  );
  assert.match(webviewCss, /\.background-placeholder\s*\{[\s\S]*?align-items:\s*flex-start/,
    'missing-background status must not sit over the center of dialog content');
  const oldEditor = fs.readFileSync(path.join(root, 'media', 'editor.html'));
  assert.equal(
    crypto.createHash('sha256').update(oldEditor).digest('hex').toUpperCase(),
    '606CFA148B63D691239572FDFBD669D45FA58687BD04C7E0597ED8BCDAC89743',
    'the independent Ctrl+F12 editor must not modify the original UI editor'
  );
}

async function main() {
  testSetupOffsets();
  testGomScenesAndLosslessPatch();
  testLegacyCoordinateBiasByControlType();
  testEquivalentConditionsShareSingleSwitch();
  testTextContentExtraction();
  testTooltipRemarksAcrossEngines();
  test996KeyValueAndGotoScene();
  testSayLinkTraversalAndOrConditions();
  testConditionalSceneInheritsDefaultOutput();
  testScenePreviewPathsPreserveOtherSimulationState();
  testGotoVariableExpansionAndConditionOverride();
  testStaticConfigTableListAndFormulaValues();
  testItemFramesAndLayeredControls();
  test996ItemListsAndLoadingBar();
  testAnimationsAndInteractiveButtonStates();
  testTraditionalFlowAndUnknownPreservation();
  testNestedContainersAndCoordinateRoundTrip();
  testSourcePatchConflictGuards();
  testEveryCatalogStatementBuildsADomModel();
  await testWorkspaceDatabaseFieldResolver();
  testManifestAndEditorIsolation();
  console.log('npc-dialog-visual.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
