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
  reflowNpcDialogLayout,
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
const {
  progressFrameAssetReferences,
} = require('../out/ui-dialog/progress-preview');
const {
  gameUiPackArchiveNameFromConfig,
} = require('../out/utils/ui-archive');

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

function testGomAddDlgBuildsIndependentStaticWindowPages() {
  const source = [
    '[@main]',
    '#ACT',
    'AddDlg 1 1 440 0 10:20 30:40 9 @QF脚本字段 1:0 1:2:2:1:300',
    '',
    '[@QF脚本字段]',
    '任务说明<下一页/@下一页>',
    '',
    '[@下一页]',
    '第二页<关闭/@关闭>',
    '',
    '[@关闭]',
    '#ACT',
    'DelDlg 1',
  ].join('\n');
  const model = parse(source, 'GOM', workspaceNpcDialogOffsets(0, 0));
  assert.deepEqual(model.pages.map(page => page.sourceLabel), ['@QF脚本字段', '@下一页'],
    'AddDlg QF root and linked visible labels must become pages; action-only labels must not');
  for (const page of model.pages) {
    assert.deepEqual({
      dialogId: page.addDlgWindow.dialogId,
      assetRef: page.addDlgWindow.assetRef,
      movable: page.addDlgWindow.movable,
      x: page.addDlgWindow.windowX,
      y: page.addDlgWindow.windowY,
      textX: page.addDlgWindow.textOffsetX,
      textY: page.addDlgWindow.textOffsetY,
      createPosition: page.addDlgWindow.createPosition,
      qfTarget: page.addDlgWindow.qfTarget,
      syncMove: page.addDlgWindow.parentSyncMove,
      refresh: page.addDlgWindow.refreshCoordinates,
      groupId: page.addDlgWindow.groupId,
      displayMode: page.addDlgWindow.displayMode,
      direction: page.addDlgWindow.popupDirection,
      closeOnLeave: page.addDlgWindow.closeOnLeave,
      closeDelayMs: page.addDlgWindow.closeDelayMs,
    }, {
      dialogId: 1,
      assetRef: { willIndex: 1, imageIndex: 440 },
      movable: false,
      x: 10,
      y: 20,
      textX: 30,
      textY: 40,
      createPosition: 9,
      qfTarget: '@QF脚本字段',
      syncMove: true,
      refresh: false,
      groupId: 1,
      displayMode: 2,
      direction: 2,
      closeOnLeave: true,
      closeDelayMs: 300,
    });
  }
  assert.ok(model.pages[1].addDlgWindow.closeActions.some(action => (
    action.dialogId === 1 && action.sourceLabel === '@关闭'
  )), 'DelDlg must be associated with the matching AddDlg lifecycle');
  const visibleText = model.pages.flatMap(page => page.elements.map(element => element.text || '')).join(' ');
  assert.doesNotMatch(visibleText, /#ACT|AddDlg|DelDlg/, 'script actions must never leak onto the canvas');
  assert.match(visibleText, /任务说明/);
  assert.match(visibleText, /第二页/);
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
    assert.equal(element.sourceCoordinateBiasY, biased ? 4 : 0, `${command} source Y bias`);
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

function testLegacyCoordinateBiasAcrossEngineSyntaxBoundaries() {
  const positionalByEngine = {
    GOM: [
      '<&TEXT:文字:104:204{FCOLOR=250}>',
      '<&COUNTDOWN:59:1:255:114:214>',
      '<&INPUTTEXT:1:124:224:120:30:0:255:255:0:20:错误:请输入:128>',
      '<&INPUTNUM:2:134:234:100:30:0:255:255:0:999:错误:请输入数字:128>',
    ],
    GEE: [
      '<&TEXT:文字:104:204{FCOLOR=250}>',
      '<&COUNTDOWN:59:1:255:114:214>',
      '<&INPUTTEXT:1:124:224:120:30:0:255:255:0:20:错误:请输入:128>',
      '<&INPUTNUM:2:134:234:100:30:0:255:255:0:999:错误:请输入数字:128>',
    ],
    '996PC': [
      '<TEXT:文字:104:204{FCOLOR=250}>',
      '<COUNTDOWN:59:1:255:114:214/@完成>',
      '<INPUTTEXT:1:124:224:120:30:0:255:255:0:20:错误:请输入:128>',
      '<INPUTNUM:2:134:234:100:30:0:255:255:0:999:错误:请输入数字:128>',
    ],
  };
  const expected = [
    ['TEXT', 100, 200],
    ['COUNTDOWN', 110, 210],
    ['INPUTTEXT', 120, 220],
    ['INPUTNUM', 130, 230],
  ];

  for (const [engine, statements] of Object.entries(positionalByEngine)) {
    const model = parse(['[@main]', '#SAY', ...statements].join('\n'), engine,
      workspaceNpcDialogOffsets(0, 0));
    for (const [index, [command, x, y]] of expected.entries()) {
      const element = model.pages[0].elements[index];
      assert.ok(element, `${engine} ${command} positional control missing`);
      assert.equal(element.token.replace(/^<&?/, '').toUpperCase(), command);
      assert.equal(element.sourceCoordinateBiasX, 4, `${engine} ${command} X bias`);
      assert.equal(element.sourceCoordinateBiasY, 4, `${engine} ${command} Y bias`);
      assert.deepEqual([element.layoutX, element.layoutY], [x, y],
        `${engine} ${command} must paint at source x-4,y-4`);
    }
  }

  const modern = parse([
    '[@main]',
    '#SAY',
    '<Text|id=T1|x=104|y=204|text=新式文字|color=250>',
    '<COUNTDOWN|id=C1|x=114|y=214|time=59|color=255>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  for (const element of modern.pages[0].elements) {
    assert.equal(element.sourceCoordinateBiasX, 0,
      `996PC key-value ${element.statementId} must not borrow the positional 4px bias`);
    assert.equal(element.sourceCoordinateBiasY, 0);
  }
  assert.deepEqual(
    modern.pages[0].elements.map(element => [element.layoutX, element.layoutY]),
    [[104, 204], [114, 214]],
    'new 996PC key-value layout must preserve its independently evidenced coordinate contract'
  );
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

function testOfficialMultilineMTextDrawsAsOneStyledControl() {
  for (const engine of ['GOM', 'GEE']) {
    const markup = [
      '<MText:#L02~:0:0:70:第一行文字|',
      '第二行文字|',
      '第三行文字',
      '>',
    ].join('\n');
    const source = [
      '[@main]',
      '#SAY',
      '<&Layout:~#L02:205:20:195:140>',
      markup,
    ].join('\n');
    const model = parse(source, engine, workspaceNpcDialogOffsets(0, 0));
    const page = model.pages[0];
    const layout = page.elements.find(element => element.containerElementId === 'L02');
    const multiTexts = page.elements.filter(element => element.statementId === 'container-mtext');

    assert.equal(multiTexts.length, 1,
      `${engine} official cross-line MText must become exactly one visual element`);
    const multi = multiTexts[0];
    assert.equal(page.unsupportedStatements.some(statement => /<MText/i.test(statement)), false,
      `${engine} official cross-line MText must not be classified as unsupported`);
    assert.equal(page.elements.some(element => (
      element.statementId === 'flow-text' && /MText|第二行文字|第三行文字|^>$/.test(element.text)
    )), false, `${engine} MText source fragments must not leak into flow text`);
    assert.equal(source.slice(multi.sourceRange.start, multi.sourceRange.end), markup,
      `${engine} MText source range must cover the complete physical-line span`);
    assert.equal(multi.lineNumber, 4,
      `${engine} MText diagnostics must point at its opening physical line`);
    assert.equal(multi.raw, markup);
    assert.equal(multi.text, '第一行文字\n第二行文字\n第三行文字');
    assert.deepEqual(multi.textPreview, {
      lines: [
        [{ text: '第一行文字' }],
        [{ text: '第二行文字' }],
        [{ text: '第三行文字' }],
      ],
      color: '#ff7700',
      align: 'left',
    }, `${engine} MText must model its documented color and independent lines`);
    assert.equal(multi.color, '#ff7700');
    assert.equal(multi.height, 60,
      `${engine} three-line MText must reserve three preview line boxes`);
    assert.ok(layout, `${engine} MText fixture layout missing`);
    assert.equal(multi.parentElementId, layout.id);
    assert.deepEqual({
      localX: multi.localLayoutX,
      localY: multi.localLayoutY,
      absoluteX: multi.layoutX,
      absoluteY: multi.layoutY,
    }, {
      localX: 0,
      localY: 0,
      absoluteX: layout.layoutX,
      absoluteY: layout.layoutY,
    });

    const moved = applyTextReplacements(source, buildDialogCoordinateEdits(source, model, [{
      elementId: multi.id,
      x: layout.layoutX + 5,
      y: layout.layoutY + 6,
    }]).replacements);
    assert.ok(moved.includes([
      '<MText:#L02~:5:6:70:第一行文字|',
      '第二行文字|',
      '第三行文字',
      '>',
    ].join('\n')), `${engine} moving MText must edit only opener X/Y and preserve all following source lines`);

    const dynamic = parse([
      '[@main]',
      '#SAY',
      '<&Layout:~#L02:205:20:195:140>',
      '<MText:#L02~:0:0:70:第一行<$STR(S$运行时文字)>|',
      '第二行文字',
      '>',
    ].join('\n'), engine, workspaceNpcDialogOffsets(0, 0));
    const dynamicMulti = dynamic.pages[0].elements.find(
      element => element.statementId === 'container-mtext'
    );
    assert.ok(dynamicMulti);
    assert.equal(dynamicMulti.editable, true,
      `${engine} runtime MText text must not lock literal opener X/Y`);
    assert.equal(dynamicMulti.text, '第一行预览文字\n第二行文字',
      `${engine} unresolved MText strings must use the neutral visible placeholder`);
    assert.match(dynamicMulti.raw, /<\$STR\(S\$运行时文字\)>/,
      `${engine} MText raw must remain source-auditable`);
    assert.ok(dynamicMulti.textPreview.dynamicFields?.includes('text'));
    assert.match(
      dynamicMulti.warning,
      /未确定.*中性占位|动态.*静态预览|未确定文字.*预览文字|未确定数量.*0/
    );

    const unclosed = parse([
      '[@main]',
      '#SAY',
      '<MText:~#BROKEN:0:0:70:未闭合第一行|',
      '未闭合第二行',
      '<Text:后续控件:20:30>',
    ].join('\n'), engine, workspaceNpcDialogOffsets(0, 0));
    assert.ok(unclosed.pages[0].unsupportedStatements.some(statement => /<MText/i.test(statement)),
      `${engine} an unclosed MText must remain explicitly unsupported`);
    assert.ok(unclosed.pages[0].elements.some(element => element.text === '后续控件'),
      `${engine} an unclosed MText must not consume the next UI statement`);
  }
}

function test996LayoutDrawsDocumentedFillColor() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<Layout|id=FILLED|x=20|y=30|width=50|height=40|color=58|link=@ok>',
    '<Layout|id=TRANSPARENT|x=80|y=30|width=50|height=40>',
    '<Layout|id=UNSET|x=140|y=30|width=50|height=40|color=32>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const layouts = new Map(model.pages[0].elements.map(element => (
    [element.containerElementId, element]
  )));
  const filled = layouts.get('FILLED');
  const transparent = layouts.get('TRANSPARENT');
  const unset = layouts.get('UNSET');

  assert.deepEqual(filled.containerPreview, {
    variant: 'layout',
    label: '布局容器',
    fillColor: '#fb0000',
  }, '996PC Layout color is the documented container fill, not a border color');
  assert.equal(filled.containerPreview.borderColor, undefined);
  assert.deepEqual({ width: filled.width, height: filled.height }, { width: 50, height: 40 });
  assert.equal(transparent.containerPreview.fillColor, undefined,
    '996PC Layout without color must remain transparent');
  assert.equal(transparent.containerPreview.borderColor, undefined);
  assert.equal(unset.containerPreview.fillColor, undefined,
    'an unset palette slot must not invent a Layout fill');
  assert.match(unset.warning, /32.*未设置|未设置.*32/);

  const legacy = parse([
    '[@main]',
    '#SAY',
    '<&Layout:~#LEGACY:20:30:50:40:58>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const legacyLayout = legacy.pages[0].elements.find(
    element => element.statementId === 'container-layout'
  );
  assert.equal(legacyLayout.containerPreview.borderColor, '#fb0000',
    'traditional Layout parameter 6 remains its documented border color');
  assert.equal(legacyLayout.containerPreview.fillColor, undefined);
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
  const image = gomPage.elements.find(element => element.statementId === 'img-hover');
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
    '<$STR(S$占位界面)>',
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
    'MOV S$占位界面 <&TEXT:<$STR(S$未定义嵌套文字)>:64:120{FCOLOR=250}>',
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
  assert.ok(defaultScene.elements.some(element => (
    element.text === '预览文字'
    && element.raw.includes(':64:120')
    && element.editable
  )), 'unknown text nested inside a UI variable must retain its preview placeholder and editable coordinates');
  assert.ok(defaultScene.elements.filter(element => /1060|1053|1927|88灵玉|42/.test(element.raw)).every(
    element => element.editable === true
  ), 'variable-generated UI with literal source coordinates must remain editable');
  const generatedItem = defaultScene.elements.find(element => element.raw.includes('ITEMSHOW:1927'));
  assert.ok(generatedItem?.x && generatedItem?.y);
  const generatedEdits = buildDialogCoordinateEdits(source, defaultModel, [{
    elementId: generatedItem.id,
    x: 340,
    y: 180,
  }]);
  const generatedPatched = applyTextReplacements(source, generatedEdits.replacements);
  assert.match(
    generatedPatched,
    /MOV S\$下级展示 <&ITEMSHOW:<\$STR\(N\$展示IDX\)>:0:340:180:48>/,
    'moving expanded UI must patch the coordinate tokens in its MOV assignment'
  );
  assert.match(generatedPatched, /<\$STR\(S\$下级展示\)>/,
    'moving expanded UI must preserve the variable reference in #SAY');
  const defaultVariables = new Map(defaultScene.resolvedVariables.map(variable => [variable.name, variable]));
  assert.equal(defaultVariables.get('N$展示IDX').value, '1927');
  assert.equal(defaultVariables.get('N$升级货币').value, '88');
  assert.equal(defaultVariables.get('U3').value, '42');
  assert.equal(defaultVariables.get('S$下级展示').sourceReferences.length, 2,
    'MOV and INC source lines must both remain available for coordinate writeback');
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

function testInlineVariablePreviewKeepsLiteralCoordinatesEditable() {
  const source = [
    '[@main]',
    '#IF',
    '#ACT',
    '#SAY',
    '<&TEXT:<$STR(S$未定义文字)>:98:66{FCOLOR=251}>',
    '<&TEXT:<$STR(N$未定义数值)>:98:90{FCOLOR=160}>',
    '',
  ].join('\r\n');
  const model = parse(source, 'GOM', workspaceNpcDialogOffsets(0, 0));
  const scene = model.scenes.find(value => value.sourceLabel === '@main');
  assert.ok(scene);
  const textPreview = scene.elements.find(element => element.text === '预览文字');
  const numberPreview = scene.elements.find(element => element.text === '0');
  assert.ok(textPreview?.editable && textPreview.x && textPreview.y,
    'an unknown string must use preview text without locking literal coordinates');
  assert.ok(numberPreview?.editable && numberPreview.x && numberPreview.y,
    'an unknown number must use zero without locking literal coordinates');
  assert.match(
    textPreview.warning || '',
    /动态.*静态预览|静态预览.*动态|未确定文字.*预览文字|未确定数量.*0/,
    'an unresolved inline text value must remain visibly marked as a static-preview boundary'
  );

  const edits = buildDialogCoordinateEdits(source, model, [{
    elementId: textPreview.id,
    x: textPreview.layoutX + 10,
    y: textPreview.layoutY + 5,
  }]);
  const patched = applyTextReplacements(source, edits.replacements);
  assert.match(patched, /<&TEXT:<\$STR\(S\$未定义文字\)>:108:71\{FCOLOR=251\}>/,
    'inline preview movement must update only the original literal X/Y tokens');
}

function testDynamicControlSizeDoesNotBorrowResolvedVariableValue() {
  const source = [
    '[@main]',
    '#IF',
    '#ACT',
    'MOV N$宽度 40',
    'MOV N$高度 20',
    '#SAY',
    '<Button|id=DYNAMIC_SIZE|x=10|y=20|width=<$STR(N$宽度)>|height=<$STR(N$高度)>|wil=NewopUI|pcnimg=113|text=动态尺寸>',
    '',
  ].join('\r\n');
  const model = parse(source, '996PC', workspaceNpcDialogOffsets(0, 0));
  const button = model.pages[0].elements.find(element => element.statementId === 'newui-button-996pc');
  assert.ok(button, 'dynamic-size Button must still build a preview element');
  assert.deepEqual({
    widthMode: button.sizePreview?.width.mode,
    heightMode: button.sizePreview?.height.mode,
    width: button.width,
    height: button.height,
  }, {
    widthMode: 'dynamic',
    heightMode: 'dynamic',
    width: 96,
    height: 30,
  }, 'dynamic source axes must retain safe source geometry instead of borrowing MOV values');
  assert.match(button.warning || '', /动态.*尺寸|尺寸.*动态/,
    'dynamic source axes must disclose their non-deterministic geometry');
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

function testExtendedItemControlVisualParameters() {
  const gom = parse([
    '[@main]',
    '#SAY',
    '<&ITEMSHOW:1927:12345:10:20:300:1:1:72:1:1:1>',
    '<UserItem:0:50:20:300:1:1:1:72:1:1/@装备>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const gomItem = gom.pages[0].elements.find(element => element.statementId === 'item-show');
  const gomEquip = gom.pages[0].elements.find(element => element.statementId === 'user-item-preview');
  assert.deepEqual({
    gray: gomItem.itemPreview.gray,
    align: gomItem.itemPreview.align,
    customWidth: gomItem.itemPreview.customWidth,
    titleMode: gomItem.itemPreview.titleMode,
    imageSource: gomItem.itemPreview.imageSource,
    drawEffect: gomItem.itemPreview.drawEffect,
    width: gomItem.width,
  }, {
    gray: true,
    align: 'custom-width',
    customWidth: 72,
    titleMode: true,
    imageSource: 'std-item',
    drawEffect: true,
    width: 72,
  }, 'GOM ItemShow must preserve every documented static visual switch');
  assert.deepEqual({
    displayTarget: gomEquip.itemPreview.displayTarget,
    gray: gomEquip.itemPreview.gray,
    align: gomEquip.itemPreview.align,
    customWidth: gomEquip.itemPreview.customWidth,
    imageSource: gomEquip.itemPreview.imageSource,
    drawEffect: gomEquip.itemPreview.drawEffect,
    width: gomEquip.width,
  }, {
    displayTarget: 'viewed-character',
    gray: true,
    align: 'custom-width',
    customWidth: 72,
    imageSource: 'std-item',
    drawEffect: true,
    width: 72,
  }, 'GOM UserItem must model target, geometry, source, and effect switches');

  const gee = parse([
    '[@main]',
    '#SAY',
    '<&ITEMSHOW:1927:12345:10:20:300:9:1:1/@物品>',
    '<MakeIndexItem:123456:23456:80:20:300:9:1:1/@唯一>',
  ].join('\n'), 'GEE', workspaceNpcDialogOffsets(0, 0));
  for (const id of ['item-show', 'makeindex-item-preview']) {
    const item = gee.pages[0].elements.find(element => element.statementId === id);
    assert.deepEqual({
      lightCode: item.itemPreview.lightCode,
      gray: item.itemPreview.gray,
      compactQuantity: item.itemPreview.compactQuantity,
    }, {
      lightCode: 9,
      gray: true,
      compactQuantity: true,
    }, `GEE ${id} must preserve light, gray, and W-unit parameters`);
  }

  const pc = parse([
    '[@main]',
    '#SAY',
    '<ItemShow|itemid=1927|itemcount=5|bgtype=1|scale=1.5|showtips=1>',
    '<EquipShow|index=3|bgtype=1|scale=1.5|effectshow=2|showstar=1|showtips=1>',
    '<DBItemShow|makeindex=123456|bgtype=1|grey=1|showstar=1|showtips=1>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const byId = new Map(pc.pages[0].elements.map(element => [element.statementId, element.itemPreview]));
  assert.deepEqual({
    scale: byId.get('newui-itemshow-996pc').scale,
    showTips: byId.get('newui-itemshow-996pc').showTips,
  }, { scale: 1.5, showTips: true }, '996PC ItemShow scale and tooltip switch must be modeled');
  assert.deepEqual({
    scale: byId.get('newui-equipshow-996pc').scale,
    effectShow: byId.get('newui-equipshow-996pc').effectShow,
    showStar: byId.get('newui-equipshow-996pc').showStar,
    showTips: byId.get('newui-equipshow-996pc').showTips,
  }, { scale: 1.5, effectShow: 2, showStar: true, showTips: true },
  'EquipShow extended visual switches must be modeled');
  assert.deepEqual({
    gray: byId.get('newui-dbitemshow-996pc').gray,
    showStar: byId.get('newui-dbitemshow-996pc').showStar,
    showTips: byId.get('newui-dbitemshow-996pc').showTips,
  }, { gray: true, showStar: true, showTips: true }, 'DBItemShow static switches must be modeled');
}

function testItemControlDynamicAndInvalidBoundaries() {
  const setup = [
    '[@main]',
    '#ACT',
    'MOV N$ITEM 1927',
    'MOV N$COUNT 2',
    'MOV N$BG 1',
    'MOV N$FLAG 1',
    'MOV N$WIDTH 72',
    'MOV N$LIGHT 9',
    'MOV N$INDEX 3',
    'MOV N$MAKE 123456',
    'MOV N$SCALE 1.5',
    'MOV N$EFFECT 2',
    '#SAY',
  ];
  const gom = parse(setup.concat([
    '<&ITEMSHOW:<$STR(N$ITEM)>:<$STR(N$COUNT)>:10:20:<$STR(N$BG)>:<$STR(N$FLAG)>:<$STR(N$FLAG)>:<$STR(N$WIDTH)>:<$STR(N$FLAG)>:<$STR(N$FLAG)>:<$STR(N$FLAG)>>',
    '<UserItem:<$STR(N$INDEX)>:50:20:<$STR(N$BG)>:<$STR(N$FLAG)>:<$STR(N$FLAG)>:<$STR(N$FLAG)>:<$STR(N$WIDTH)>:<$STR(N$FLAG)>:<$STR(N$FLAG)>/@装备>',
  ]).join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const gomItem = gom.pages[0].elements.find(element => element.statementId === 'item-show');
  const gomEquip = gom.pages[0].elements.find(element => element.statementId === 'user-item-preview');
  assert.deepEqual(gomItem.itemPreview.dynamicFields, [
    'itemid', 'itemcount', 'bgtype', 'grey', 'align', 'customwidth', 'title', 'source', 'effect',
  ]);
  assert.equal(gomItem.itemPreview.itemIndex, undefined);
  assert.equal(gomItem.itemPreview.customWidth, undefined);
  assert.equal(gomItem.itemPreview.imageSource, undefined);
  assert.equal(gomItem.assetLayers, undefined,
    'dynamic GOM frame/source fields must not borrow resolved background or item-source truth');
  assert.equal(gomItem.width, 40,
    'dynamic custom width must retain the safe source geometry instead of borrowing MOV N$WIDTH');
  assert.deepEqual(gomEquip.itemPreview.dynamicFields, [
    'index', 'bgtype', 'target', 'grey', 'align', 'customwidth', 'source', 'effect',
  ]);
  assert.equal(gomEquip.itemPreview.equipmentSlot, undefined);
  assert.equal(gomEquip.itemPreview.displayTarget, undefined);
  assert.equal(gomEquip.itemPreview.imageSource, undefined);

  const gee = parse(setup.concat([
    '<&ITEMSHOW:<$STR(N$ITEM)>:<$STR(N$COUNT)>:10:20:<$STR(N$BG)>:<$STR(N$LIGHT)>:<$STR(N$FLAG)>:<$STR(N$FLAG)>/@物品>',
    '<MakeIndexItem:<$STR(N$MAKE)>:<$STR(N$COUNT)>:80:20:<$STR(N$BG)>:<$STR(N$LIGHT)>:<$STR(N$FLAG)>:<$STR(N$FLAG)>/@唯一>',
  ]).join('\n'), 'GEE', workspaceNpcDialogOffsets(0, 0));
  const geeItem = gee.pages[0].elements.find(element => element.statementId === 'item-show');
  const geeUnique = gee.pages[0].elements.find(element => element.statementId === 'makeindex-item-preview');
  assert.deepEqual([...geeItem.itemPreview.dynamicFields].sort(),
    ['itemid', 'itemcount', 'bgtype', 'light', 'grey', 'unit'].sort());
  assert.equal(geeItem.itemPreview.itemIndex, undefined);
  assert.equal(geeItem.itemPreview.lightCode, undefined);
  assert.deepEqual([...geeUnique.itemPreview.dynamicFields].sort(),
    ['makeindex', 'itemcount', 'bgtype', 'light', 'grey', 'unit'].sort());
  assert.equal(geeUnique.itemPreview.uniqueIndex, undefined);

  const pc = parse(setup.concat([
    '<ItemShow|id=ITEM|itemid=1927|scale=<$STR(N$SCALE)>|showtips=<$STR(N$FLAG)>|grey=<$STR(N$FLAG)>>',
    '<EquipShow|id=EQUIP|index=<$STR(N$INDEX)>|bgtype=<$STR(N$BG)>|scale=<$STR(N$SCALE)>|showtips=<$STR(N$FLAG)>|showstar=<$STR(N$FLAG)>|effectshow=<$STR(N$EFFECT)>>',
    '<DBItemShow|id=DB|makeindex=<$STR(N$MAKE)>|bgtype=<$STR(N$BG)>|grey=<$STR(N$FLAG)>|showstar=<$STR(N$FLAG)>|showtips=<$STR(N$FLAG)>>',
    '<EquipShow|id=BAD_EQUIP|index=56|bgtype=2|scale=0|showtips=9|showstar=2|effectshow=9>',
    '<DBItemShow|id=BAD_DB|makeindex=abc|bgtype=-1|grey=9|showstar=2|showtips=-1>',
  ]).join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const controls = new Map(pc.pages[0].elements.map(element => [element.containerElementId, element]));
  const dynamicItem = controls.get('ITEM');
  assert.deepEqual(dynamicItem.itemPreview.dynamicFields, ['grey', 'scale', 'showtips']);
  assert.equal(dynamicItem.itemPreview.scale, undefined);
  assert.equal(dynamicItem.itemPreview.showTips, undefined);
  const dynamicEquip = controls.get('EQUIP');
  assert.deepEqual(dynamicEquip.itemPreview.dynamicFields,
    ['index', 'bgtype', 'scale', 'showtips', 'showstar', 'effectshow']);
  assert.deepEqual({
    slot: dynamicEquip.itemPreview.equipmentSlot,
    frame: dynamicEquip.itemPreview.frameValue,
    scale: dynamicEquip.itemPreview.scale,
    tips: dynamicEquip.itemPreview.showTips,
    star: dynamicEquip.itemPreview.showStar,
    effect: dynamicEquip.itemPreview.effectShow,
  }, { slot: undefined, frame: undefined, scale: undefined, tips: undefined,
    star: undefined, effect: undefined });
  assert.equal(dynamicEquip.assetLayers, undefined);
  const dynamicDb = controls.get('DB');
  assert.deepEqual(dynamicDb.itemPreview.dynamicFields,
    ['makeindex', 'bgtype', 'grey', 'showstar', 'showtips']);
  assert.equal(dynamicDb.itemPreview.uniqueIndex, undefined);
  assert.equal(dynamicDb.assetLayers, undefined);
  assert.deepEqual(controls.get('BAD_EQUIP').itemPreview.invalidFields,
    ['index', 'bgtype', 'scale', 'showtips', 'showstar', 'effectshow']);
  assert.equal(controls.get('BAD_EQUIP').assetLayers, undefined);
  assert.deepEqual(controls.get('BAD_DB').itemPreview.invalidFields,
    ['makeindex', 'bgtype', 'grey', 'showstar', 'showtips']);
  assert.equal(controls.get('BAD_DB').assetLayers, undefined);
}

function testLegacyProgressBarBuildsDocumentedPreview() {
  const gom = parse([
    '[@main]',
    '#SAY',
    '<&PROGRESSBAR:70:80:10:100:101:3:100:2:3:0:200:50:0:250:4:5:%p/%m/%r:测试>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const progress = gom.pages[0].elements.find(element => element.statementId === 'progress-bar');
  assert.ok(progress?.progressPreview);
  assert.deepEqual(progress.progressPreview, {
    minimum: 0,
    maximum: 200,
    value: 50,
    ratio: .25,
    direction: 0,
    offsetX: 2,
    offsetY: 3,
    text: '%p/%m/%r',
    frameCount: 3,
    frameInterval: 100,
    captionColor: '#00ff00',
    captionOffsetX: 4,
    captionOffsetY: 5,
  });
  assert.deepEqual(progress.assetRef, { willIndex: 10, imageIndex: 100 },
    'ProgressBar background must not inherit the fill animation frame count');
  assert.deepEqual(progress.assetLayers.map(layer => [layer.role, layer.assetRef]), [
    ['background', { willIndex: 10, imageIndex: 100 }],
    ['progress', { willIndex: 10, imageIndex: 101, frameCount: 3 }],
  ], 'ProgressBar frames must start from P; B remains a single background image');
  assert.deepEqual(
    progressFrameAssetReferences(progress.assetLayers[1].assetRef, progress.progressPreview.frameCount),
    [
      { willIndex: 10, imageIndex: 101 },
      { willIndex: 10, imageIndex: 102 },
      { willIndex: 10, imageIndex: 103 },
    ],
    'Provider frame references must start from the progress layer P rather than background B'
  );

  const gee = parse([
    '[@main]',
    '#SAY',
    '<ProgressBar:0:0:24:770:771:1:100:0:0:100:200:170:3:255:2:3:%r%:ui_n.pak中/@Label>',
  ].join('\n'), 'GEE', workspaceNpcDialogOffsets(0, 0));
  const relative = gee.pages[0].elements.find(element => element.statementId === 'progress-bar');
  assert.ok(relative?.progressPreview,
    'the documented no-& ProgressBar form must use the dedicated progress renderer');
  assert.equal(relative.coordinateMode, 'relative');
  assert.equal(relative.progressPreview.direction, 3);
  assert.equal(relative.progressPreview.captionColor, '#ffffff');
  assert.deepEqual(relative.assetLayers.map(layer => [layer.role, layer.assetRef]), [
    ['background', { willIndex: 24, imageIndex: 770 }],
    ['progress', { willIndex: 24, imageIndex: 771, frameCount: 1 }],
  ]);

  const nested = parse([
    '[@main]',
    '#SAY',
    '<&ProgressBar:#L3~L4:165:12:0:490:492:1:0:5:1:0:20:<$str(U5)>:0:250:-2:-1:%p/%m:真实服务端>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const nestedProgress = nested.pages[0].elements.find(element => element.statementId === 'progress-bar');
  assert.ok(nestedProgress?.progressPreview);
  assert.deepEqual({
    parentId: nestedProgress.containerParentId,
    elementId: nestedProgress.containerElementId,
    x: nestedProgress.x?.sourceValue,
    y: nestedProgress.y?.sourceValue,
    background: nestedProgress.assetLayers[0].assetRef.imageIndex,
    fill: nestedProgress.assetLayers[1].assetRef.imageIndex,
    maximum: nestedProgress.progressPreview.maximum,
    direction: nestedProgress.progressPreview.direction,
    captionOffsetX: nestedProgress.progressPreview.captionOffsetX,
    captionOffsetY: nestedProgress.progressPreview.captionOffsetY,
  }, {
    parentId: 'L3', elementId: 'L4', x: 165, y: 12,
    background: 490, fill: 492, maximum: 20, direction: 0,
    captionOffsetX: -2, captionOffsetY: -1,
  }, 'a second container id without # must not shift every ProgressBar parameter');
  assert.deepEqual(nestedProgress.progressPreview.dynamicFields, ['value']);
  assert.match(nestedProgress.warning, /动态.*当前值|当前值.*动态/,
    'runtime progress must be identified instead of presented as a confirmed zero value');

  const staticZero = parse([
    '[@main]',
    '#SAY',
    '<&PROGRESSBAR:10:20:3:120:121:0:0:1:2:0:100:50:3:250:0:0:%r%:静态边界>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0)).pages[0].elements.find(
    element => element.statementId === 'progress-bar'
  );
  assert.ok(staticZero?.progressPreview);
  assert.equal(staticZero.progressPreview.frameCount, undefined);
  assert.equal(staticZero.progressPreview.frameInterval, 0);
  assert.deepEqual(staticZero.assetLayers.map(layer => [layer.role, layer.assetRef]), [
    ['background', { willIndex: 3, imageIndex: 120 }],
    ['progress', { willIndex: 3, imageIndex: 121 }],
  ], 'C=0/T=0 real-world usage must retain a static P fill without inventing animation frames');
  assert.deepEqual(progressFrameAssetReferences(staticZero.assetLayers[1].assetRef, 0), []);
}

function test996ItemListsAndLoadingBar() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<ItemShow|itemid=1927|itemcount=100|color=250|grey=1|lock=1|showtips=1|bgtype=1|x=10|y=20|id=I1>',
    '<ItemShow|itemname=测试物品|itemcount=1|color=251|grey=0|lock=0|showtips=0|bgtype=0|x=60|y=20|id=I2>',
    '<EquipShow|index=3|showtips=1|bgtype=1>',
    '<HEROEquipShow|index=4|showtips=1|bgtype=1>',
    '<ITEMBOX|boxindex=2|stdmode=5|wil=NewopUI|pcimg=400|tips=放入物品>',
    '<BAGITEMS|condition=5#6|select=0|count=8|row=2>',
    '<HEROEQUIPITEMS|positions=0#1|select=0|count=6|row=3>',
    '<LoadingBar|wil=NewopUI|pcloadingbg=500|pcloadingbar=501|startper=25|endper=100|maxper=100|offsetX=2|offsetY=3>',
    '<PercentImg|id=P0|x=30|y=60|direction=0|wil=NewopUI|pcimg=231|minValue=50|maxValue=148>',
    '<PercentImg|id=P1|x=30|y=90|direction=1|wil=NewopUI|pcimg=231|minValue=50|maxValue=148>',
    '<PercentImg|id=P2|x=30|y=120|direction=2|wil=NewopUI|pcimg=231|minValue=50|maxValue=148>',
    '<PercentImg|id=P3|x=30|y=150|direction=3|wil=NewopUI|pcimg=231|minValue=50|maxValue=148>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const page = model.pages[0];
  const item = page.elements.find(element => element.statementId === 'newui-itemshow-996pc');
  assert.equal(item.itemPreview.itemIndex, 1927);
  assert.equal(item.itemPreview.quantity, 100);
  assert.equal(item.itemPreview.quantityColor, '#00ff00');
  assert.equal(item.itemPreview.gray, true);
  assert.equal(item.itemPreview.locked, true);
  assert.deepEqual(item.assetLayers[0].assetRef, { archiveName: 'NewopUI', imageIndex: 47 });
  const plainItem = page.elements.find(element => element.containerElementId === 'I2');
  assert.equal(plainItem.itemPreview.itemName, '测试物品');
  assert.equal(plainItem.itemPreview.quantityColor, '#ffff00');
  assert.equal(plainItem.itemPreview.gray, false);
  assert.equal(plainItem.itemPreview.locked, false);
  assert.equal(plainItem.assetLayers, undefined, 'bgtype=0 must not draw the ItemShow frame');

  const itemBoundaries = parse([
    '[@main]',
    '#ACT',
    'MOV N$IID 1927',
    'MOV N$COUNT 100',
    'MOV N$COLOR 250',
    'MOV N$GREY 1',
    'MOV N$LOCK 1',
    'MOV N$BG 1',
    '#SAY',
    '<ItemShow|id=DYNAMICITEM|x=10|y=20|itemid=<$STR(N$IID)>|itemcount=<$STR(N$COUNT)>|color=<$STR(N$COLOR)>|grey=<$STR(N$GREY)>|lock=<$STR(N$LOCK)>|bgtype=<$STR(N$BG)>>',
    '<ItemShow|id=INVALIDITEM|x=60|y=20|itemid=1927|itemcount=1|grey=9|lock=-1|bgtype=2>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const dynamicItem = itemBoundaries.pages[0].elements.find(
    element => element.containerElementId === 'DYNAMICITEM'
  );
  assert.deepEqual(dynamicItem.itemPreview, {
    mode: 'database-index',
    quantity: 100,
    gray: false,
    locked: false,
    frameValue: 0,
    label: '动态物品 IDX',
    dynamic: true,
    dynamicFields: ['itemid', 'itemcount', 'color', 'grey', 'lock', 'bgtype'],
  }, 'resolved ItemShow quantity must stay visible without promoting its runtime-only fields');
  assert.equal(dynamicItem.itemPreview.itemIndex, undefined,
    'a visible quantity snapshot must not promote the dynamic database ID');
  assert.deepEqual(
    dynamicItem.displayValueSources?.find(source => source.field === 'item-quantity'),
    {
      field: 'item-quantity',
      kind: 'number',
      expression: '<$STR(N$COUNT)>',
      status: 'resolved-static',
      value: 100,
      variableNames: ['N$COUNT'],
    },
    'the canvas quantity must retain exact source provenance for Inspector/audit'
  );
  assert.equal(dynamicItem.assetLayers, undefined,
    'a dynamic bgtype must not borrow its temporary value and draw a definite background');
  assert.match(dynamicItem.warning, /ItemShow.*动态|动态.*ItemShow/);
  const invalidItem = itemBoundaries.pages[0].elements.find(
    element => element.containerElementId === 'INVALIDITEM'
  );
  assert.deepEqual(invalidItem.itemPreview.invalidFields, ['grey', 'lock', 'bgtype']);
  assert.equal(invalidItem.itemPreview.gray, false);
  assert.equal(invalidItem.itemPreview.locked, false);
  assert.equal(invalidItem.assetLayers, undefined);
  assert.match(invalidItem.warning, /grey.*lock.*bgtype.*0.*1|0.*1.*grey.*lock.*bgtype/);
  assert.equal(page.elements.find(element => element.statementId === 'newui-equipshow-996pc').itemPreview.mode, 'equipment');
  assert.equal(page.elements.find(element => element.statementId === 'newui-heroequipshow-996pc').itemPreview.mode, 'hero-equipment');
  const itemBox = page.elements.find(element => element.statementId === 'newui-itembox-996pc');
  assert.deepEqual(itemBox.assetLayers[0].assetRef, { archiveName: 'NewopUI', imageIndex: 400 });
  const bag = page.elements.find(element => element.statementId === 'newui-bagitems-996pc');
  assert.deepEqual(bag.containerPreview, {
    variant: 'item-grid', label: '人物背包物品列表', gridSource: 'character-bag',
    filterCondition: '5#6', selectedUniqueIds: ['0'], cellCount: 8, rows: 2, columns: 4,
    cellWidth: 40, cellHeight: 40, cellGap: 2,
    defaultFields: ['iwidth', 'iheight'],
  });
  assert.deepEqual({ width: bag.width, height: bag.height }, { width: 166, height: 82 });
  const hero = page.elements.find(element => element.statementId === 'newui-heroequipitems-996pc');
  assert.equal(hero.containerPreview.label, '英雄装备物品列表');
  assert.equal(hero.containerPreview.gridSource, 'hero-equipment');
  const loading = page.elements.find(element => element.statementId === 'newui-loadingbar-996pc');
  assert.equal(loading.progressPreview.ratio, .25);
  assert.deepEqual(loading.assetLayers.map(layer => layer.assetRef), [
    { archiveName: 'NewopUI', imageIndex: 500 },
    { archiveName: 'NewopUI', imageIndex: 501 },
  ]);
  const percentages = page.elements.filter(
    element => element.statementId === 'newui-percentimg-996pc'
  );
  assert.equal(percentages.length, 4);
  for (const [direction, percentage] of percentages.entries()) {
    assert.equal(percentage.progressPreview.direction, direction);
    assert.ok(Math.abs(percentage.progressPreview.ratio - (50 / 148)) < 1e-12);
    assert.equal(percentage.progressPreview.showCaption, false);
    assert.deepEqual(percentage.assetLayers, [{
      role: 'progress',
      assetRef: { archiveName: 'NewopUI', imageIndex: 231 },
    }], 'PercentImg must expose only its clipped image, never an uncut background copy');
  }
}

function test996ItemGridUsesDocumentedCellGeometry() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<BAGITEMS|id=BAG|count=8|row=2|iwidth=70|iheight=60>',
    '<HEROBAGITEMS|id=HEROBAG|count=9|row=3|iwidth=71|iheight=61>',
    '<EQUIPITEMS|id=EQUIP|count=10|row=2|iwidth=72|iheight=62>',
    '<HEROEQUIPITEMS|id=HEROEQUIP|count=6|row=3|iwidth=73|iheight=63>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const grids = new Map(model.pages[0].elements.map(element => (
    [element.containerElementId, element]
  )));
  const expected = new Map([
    ['BAG', {
      statementId: 'newui-bagitems-996pc', label: '人物背包物品列表',
      gridSource: 'character-bag',
      cellCount: 8, rows: 2, columns: 4, cellWidth: 70, cellHeight: 60,
      width: 286, height: 122,
    }],
    ['HEROBAG', {
      statementId: 'newui-herobagitems-996pc', label: '英雄背包物品列表',
      gridSource: 'hero-bag',
      cellCount: 9, rows: 3, columns: 3, cellWidth: 71, cellHeight: 61,
      width: 217, height: 187,
    }],
    ['EQUIP', {
      statementId: 'newui-equipitems-996pc', label: '人物装备物品列表',
      gridSource: 'character-equipment',
      cellCount: 10, rows: 2, columns: 5, cellWidth: 72, cellHeight: 62,
      width: 368, height: 126,
    }],
    ['HEROEQUIP', {
      statementId: 'newui-heroequipitems-996pc', label: '英雄装备物品列表',
      gridSource: 'hero-equipment',
      cellCount: 6, rows: 3, columns: 2, cellWidth: 73, cellHeight: 63,
      width: 148, height: 193,
    }],
  ]);
  for (const [id, geometry] of expected) {
    const grid = grids.get(id);
    assert.equal(grid.statementId, geometry.statementId);
    assert.deepEqual(grid.containerPreview, {
      variant: 'item-grid',
      label: geometry.label,
      gridSource: geometry.gridSource,
      cellCount: geometry.cellCount,
      rows: geometry.rows,
      columns: geometry.columns,
      cellWidth: geometry.cellWidth,
      cellHeight: geometry.cellHeight,
      cellGap: 2,
    }, `${geometry.statementId} must consume the documented iwidth/iheight fields`);
    assert.deepEqual({ width: grid.width, height: grid.height }, {
      width: geometry.width,
      height: geometry.height,
    }, `${geometry.statementId} wrapper must match cells plus the Ctrl+F12 preview gaps`);
  }

  const boundaries = parse([
    '[@main]',
    '#SAY',
    '<BAGITEMS|id=DEFAULT|count=8|row=2>',
    '<BAGITEMS|id=ONLYWIDTH|count=8|row=2|iwidth=70>',
    '<BAGITEMS|id=ONLYHEIGHT|count=8|row=2|iheight=60>',
    '<BAGITEMS|id=DYNAMIC|count=8|row=2|iwidth=<$STR(N$W)>|iheight=60>',
    '<BAGITEMS|id=INVALID|count=8|row=2|iwidth=0|iheight=-5>',
    '<BAGITEMS|id=DECIMAL|count=8|row=2|iwidth=70.5|iheight=60.25>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const byId = new Map(boundaries.pages[0].elements.map(element => (
    [element.containerElementId, element]
  )));
  assert.deepEqual({
    preview: byId.get('DEFAULT').containerPreview,
    width: byId.get('DEFAULT').width,
    height: byId.get('DEFAULT').height,
  }, {
    preview: {
      variant: 'item-grid', label: '人物背包物品列表', gridSource: 'character-bag',
      cellCount: 8, rows: 2, columns: 4,
      cellWidth: 40, cellHeight: 40, cellGap: 2,
      defaultFields: ['iwidth', 'iheight'],
    },
    width: 166,
    height: 82,
  }, 'omitted cell dimensions must use an explicit Ctrl+F12 preview convention');
  assert.match(byId.get('DEFAULT').warning, /手册.*默认.*40|40.*预览.*手册/);

  assert.deepEqual({
    cellWidth: byId.get('ONLYWIDTH').containerPreview.cellWidth,
    cellHeight: byId.get('ONLYWIDTH').containerPreview.cellHeight,
    defaultFields: byId.get('ONLYWIDTH').containerPreview.defaultFields,
    width: byId.get('ONLYWIDTH').width,
    height: byId.get('ONLYWIDTH').height,
  }, { cellWidth: 70, cellHeight: 40, defaultFields: ['iheight'], width: 286, height: 82 });
  assert.deepEqual({
    cellWidth: byId.get('ONLYHEIGHT').containerPreview.cellWidth,
    cellHeight: byId.get('ONLYHEIGHT').containerPreview.cellHeight,
    defaultFields: byId.get('ONLYHEIGHT').containerPreview.defaultFields,
    width: byId.get('ONLYHEIGHT').width,
    height: byId.get('ONLYHEIGHT').height,
  }, { cellWidth: 40, cellHeight: 60, defaultFields: ['iwidth'], width: 166, height: 122 });

  const dynamic = byId.get('DYNAMIC');
  assert.deepEqual({
    cellWidth: dynamic.containerPreview.cellWidth,
    cellHeight: dynamic.containerPreview.cellHeight,
    dynamicFields: dynamic.containerPreview.dynamicFields,
    invalidFields: dynamic.containerPreview.invalidFields,
    width: dynamic.width,
    height: dynamic.height,
  }, {
    cellWidth: 40,
    cellHeight: 60,
    dynamicFields: ['iwidth'],
    invalidFields: undefined,
    width: 166,
    height: 122,
  }, 'a dynamic cell axis must fall back independently without discarding the static axis');
  assert.match(dynamic.warning, /iwidth.*动态.*40|动态.*iwidth.*40/);
  assert.doesNotMatch(dynamic.warning, /ListView/);
  assert.doesNotMatch(dynamic.warning, /必须是正数/,
    'a runtime expression must not inherit an invalid-number warning from its resolver fallback');

  const resolvedDynamicModel = parse([
    '[@main]',
    '#IF',
    '#ACT',
    'MOV N$W 70',
    '#SAY',
    '<BAGITEMS|id=RESOLVEDDYNAMIC|count=8|row=2|iwidth=<$STR(N$W)>|iheight=60>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const resolvedDynamic = resolvedDynamicModel.pages[0].elements.find(
    element => element.containerElementId === 'RESOLVEDDYNAMIC'
  );
  assert.deepEqual({
    cellWidth: resolvedDynamic.containerPreview.cellWidth,
    cellHeight: resolvedDynamic.containerPreview.cellHeight,
    dynamicFields: resolvedDynamic.containerPreview.dynamicFields,
    width: resolvedDynamic.width,
    height: resolvedDynamic.height,
  }, {
    cellWidth: 40,
    cellHeight: 60,
    dynamicFields: ['iwidth'],
    width: 166,
    height: 122,
  }, 'a currently resolved runtime size must remain a safe fallback in both grid tracks and wrapper geometry');
  assert.match(resolvedDynamic.warning, /iwidth.*动态.*40|动态.*iwidth.*40/);
  assert.doesNotMatch(resolvedDynamic.warning, /必须是正数/);

  const invalid = byId.get('INVALID');
  assert.deepEqual({
    cellWidth: invalid.containerPreview.cellWidth,
    cellHeight: invalid.containerPreview.cellHeight,
    dynamicFields: invalid.containerPreview.dynamicFields,
    invalidFields: invalid.containerPreview.invalidFields,
    width: invalid.width,
    height: invalid.height,
  }, {
    cellWidth: 40,
    cellHeight: 40,
    dynamicFields: undefined,
    invalidFields: ['iwidth', 'iheight'],
    width: 166,
    height: 82,
  }, 'zero and negative cell dimensions must not leak invalid CSS geometry');
  assert.match(invalid.warning, /iwidth.*iheight.*正数.*40|正数.*iwidth.*iheight.*40/);

  const decimal = byId.get('DECIMAL');
  assert.deepEqual({
    cellWidth: decimal.containerPreview.cellWidth,
    cellHeight: decimal.containerPreview.cellHeight,
    width: decimal.width,
    height: decimal.height,
  }, { cellWidth: 70.5, cellHeight: 60.25, width: 288, height: 122.5 },
  'positive fractional cell dimensions are documented as dimensions and must not be truncated');
}

function test996ItemGridBuildsTypedConfigurationAndSafeCounts() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<BAGITEMS|id=BAG|condition=5#6,10#*|select=1001,1002|count=8|row=2|iwidth=70|iheight=60|selecttype=0|showstar=1|conditionEx=1|conditionParam=3|conditionOnOff=0|exclude=1002|filter1=1927,1928|filter2=屠龙,麻痹戒指|filter3=1927,测试物品|exbind=1|showtips=0|link=@选择>',
    '<HEROBAGITEMS|id=HBAG|condition=*|select=1001|count=6|row=2|selecttype=1|showtips=1|link=@选择>',
    '<EQUIPITEMS|id=EQUIP|positions=0#1|select=1001|count=4|row=1|selecttype=0|showstar=1|showtips=1|link=@选择>',
    '<HEROEQUIPITEMS|id=HEQUIP|positions=*|select=1001|count=4|row=1|selecttype=1|showtips=0|link=@选择>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const grids = new Map(model.pages[0].elements.map(element => (
    [element.containerElementId, element.containerPreview]
  )));
  assert.deepEqual(grids.get('BAG'), {
    variant: 'item-grid',
    label: '人物背包物品列表',
    gridSource: 'character-bag',
    filterCondition: '5#6,10#*',
    selectedUniqueIds: ['1001', '1002'],
    selectionMode: 'multi',
    showTips: false,
    showStar: true,
    filterStar: true,
    starLevel: 3,
    starCondition: 0,
    excludedUniqueIds: ['1002'],
    excludedItemIds: ['1927', '1928'],
    excludedItemNames: ['屠龙', '麻痹戒指'],
    includedItemRefs: ['1927', '测试物品'],
    excludeBound: true,
    cellCount: 8,
    rows: 2,
    columns: 4,
    cellWidth: 70,
    cellHeight: 60,
    cellGap: 2,
  });
  assert.deepEqual({
    source: grids.get('HBAG').gridSource,
    condition: grids.get('HBAG').filterCondition,
    selectionMode: grids.get('HBAG').selectionMode,
    showTips: grids.get('HBAG').showTips,
  }, { source: 'hero-bag', condition: '*', selectionMode: 'single', showTips: true });
  assert.deepEqual({
    source: grids.get('EQUIP').gridSource,
    positions: grids.get('EQUIP').equipmentPositions,
    selectionMode: grids.get('EQUIP').selectionMode,
    showStar: grids.get('EQUIP').showStar,
  }, { source: 'character-equipment', positions: '0#1', selectionMode: 'multi', showStar: true });
  assert.deepEqual({
    source: grids.get('HEQUIP').gridSource,
    positions: grids.get('HEQUIP').equipmentPositions,
    selectionMode: grids.get('HEQUIP').selectionMode,
    showTips: grids.get('HEQUIP').showTips,
  }, { source: 'hero-equipment', positions: '*', selectionMode: 'single', showTips: false });

  const boundaries = parse([
    '[@main]',
    '#ACT',
    'MOV N$COUNT 8',
    'MOV N$ROW 2',
    'MOV N$FLAG 1',
    'MOV N$LEVEL 3',
    '#SAY',
    '<BAGITEMS|id=DYNAMIC|condition=<$STR(S$COND)>|select=<$STR(S$SELECT)>|count=<$STR(N$COUNT)>|row=<$STR(N$ROW)>|selecttype=<$STR(N$FLAG)>|showstar=<$STR(N$FLAG)>|conditionEx=<$STR(N$FLAG)>|conditionParam=<$STR(N$LEVEL)>|conditionOnOff=<$STR(N$FLAG)>|exclude=<$STR(S$EXCLUDE)>|filter1=<$STR(S$F1)>|filter2=<$STR(S$F2)>|filter3=<$STR(S$F3)>|exbind=<$STR(N$FLAG)>|showtips=<$STR(N$FLAG)>>',
    '<BAGITEMS|id=INVALID|count=0|row=2.5|selecttype=9|showstar=2|conditionex=1|conditionParam=x|conditionOnOff=2|exbind=3|showtips=-1>',
    '<BAGITEMS|id=DEFAULT>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const byId = new Map(boundaries.pages[0].elements.map(element => (
    [element.containerElementId, element]
  )));
  const dynamic = byId.get('DYNAMIC');
  assert.deepEqual({
    cellCount: dynamic.containerPreview.cellCount,
    rows: dynamic.containerPreview.rows,
    columns: dynamic.containerPreview.columns,
    condition: dynamic.containerPreview.filterCondition,
    selected: dynamic.containerPreview.selectedUniqueIds,
    mode: dynamic.containerPreview.selectionMode,
    showStar: dynamic.containerPreview.showStar,
    showTips: dynamic.containerPreview.showTips,
  }, { cellCount: 12, rows: 4, columns: 3, condition: undefined, selected: undefined,
    mode: undefined, showStar: undefined, showTips: undefined },
  'resolved grid variables must retain source-safe preview conventions and unknown configuration');
  assert.deepEqual([...(dynamic.containerPreview.dynamicFields || [])].sort(), [
    'condition', 'select', 'count', 'row', 'selecttype', 'showstar', 'conditionEx',
    'conditionParam', 'conditionOnOff', 'exclude', 'filter1', 'filter2', 'filter3',
    'exbind', 'showtips',
  ].sort());
  assert.match(dynamic.warning, /count.*row.*动态|动态.*count.*row/);

  const invalid = byId.get('INVALID');
  assert.deepEqual({
    cellCount: invalid.containerPreview.cellCount,
    rows: invalid.containerPreview.rows,
    columns: invalid.containerPreview.columns,
  }, { cellCount: 12, rows: 4, columns: 3 });
  assert.deepEqual([...(invalid.containerPreview.invalidFields || [])].sort(), [
    'count', 'row', 'selecttype', 'showstar', 'conditionEx', 'conditionParam',
    'conditionOnOff', 'exbind', 'showtips',
  ].sort());
  assert.match(invalid.warning, /count.*row.*正整数|正整数.*count.*row/);
  assert.match(invalid.warning, /conditionEx.*大小写|大小写.*conditionEx/);

  const defaults = byId.get('DEFAULT');
  assert.deepEqual(defaults.containerPreview.defaultFields,
    ['count', 'row', 'iwidth', 'iheight']);
  assert.deepEqual({
    cellCount: defaults.containerPreview.cellCount,
    rows: defaults.containerPreview.rows,
    columns: defaults.containerPreview.columns,
    width: defaults.width,
    height: defaults.height,
  }, { cellCount: 12, rows: 4, columns: 3, width: 124, height: 166 });
  assert.match(defaults.warning, /count.*12.*row.*4|12.*count.*4.*row/);
}

function test996LoadingBarBuildsDocumentedRuntimeAndCaptionModel() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<LoadingBar|id=STYLE|x=10|y=20|width=200|height=20|wil=TestUI|pcloadingbg=100|pcloadingbar=101|startper=25|endper=25|maxper=100|interval=0.05|loadvalue=10|direction=1|offsetX=2|offsetY=3|size=18|color=250|outline=2|outlinecolor=249|HideText=0|link=@done>',
    '<LoadingBar|id=HIDDEN|x=10|y=50|width=200|height=20|wil=TestUI|pcloadingbg=100|pcloadingbar=101|startper=25|endper=25|maxper=100|interval=0.05|loadvalue=10|direction=0|HideText=1|link=@done>',
    '<LoadingBar|id=ANIM|x=10|y=80|width=200|height=20|wil=TestUI|pcloadingbg=100|pcloadingbar=101|startper=10|endper=12|maxper=100|interval=0.02|loadvalue=1|direction=1|HideText=1|link=@done>',
    '<LoadingBar|id=DEFAULTS|x=10|y=110|wil=TestUI|pcloadingbg=100|pcloadingbar=101|startper=0|direction=0>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const controls = new Map(model.pages[0].elements
    .filter(element => element.statementId === 'newui-loadingbar-996pc')
    .map(element => [element.containerElementId, element]));
  const styled = controls.get('STYLE');
  const hidden = controls.get('HIDDEN');
  const animated = controls.get('ANIM');
  const defaults = controls.get('DEFAULTS');
  assert.ok(styled && hidden && animated && defaults);
  assert.deepEqual(styled.progressPreview, {
    minimum: 0,
    maximum: 100,
    value: 25,
    ratio: .25,
    direction: 1,
    offsetX: 2,
    offsetY: 3,
    text: '',
    endValue: 25,
    valueIntervalMs: 50,
    valueStep: 10,
    captionMode: 'percent',
    captionColor: '#00ff00',
    captionOffsetX: 0,
    captionOffsetY: 0,
    fontSize: 18,
    outlineWidth: 2,
    outlineColor: '#ff0000',
    showCaption: true,
  });
  assert.equal(hidden.progressPreview.showCaption, false,
    'HideText=1 must suppress the generated percentage caption');
  assert.deepEqual({
    value: animated.progressPreview.value,
    endValue: animated.progressPreview.endValue,
    maximum: animated.progressPreview.maximum,
    valueIntervalMs: animated.progressPreview.valueIntervalMs,
    valueStep: animated.progressPreview.valueStep,
    direction: animated.progressPreview.direction,
  }, {
    value: 10, endValue: 12, maximum: 100,
    valueIntervalMs: 20, valueStep: 1, direction: 1,
  }, 'LoadingBar interval seconds must become a deterministic preview timer in milliseconds');
  assert.deepEqual({
    endValue: defaults.progressPreview.endValue,
    maximum: defaults.progressPreview.maximum,
    valueIntervalMs: defaults.progressPreview.valueIntervalMs,
    valueStep: defaults.progressPreview.valueStep,
    showCaption: defaults.progressPreview.showCaption,
  }, {
    endValue: 100,
    maximum: 100,
    valueIntervalMs: 50,
    valueStep: 10,
    showCaption: true,
  }, 'LoadingBar must preserve every documented default without inventing style defaults');

  const dynamic = parse([
    '[@main]',
    '#SAY',
    '<LoadingBar|id=DYNAMIC|x=10|y=140|wil=TestUI|pcloadingbg=100|pcloadingbar=101|startper=<$STR(S0)>|endper=<$STR(S1)>|maxper=<$STR(S2)>|interval=<$STR(S3)>|loadvalue=<$STR(S4)>|HideText=<$STR(S5)>>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0)).pages[0].elements.find(
    element => element.statementId === 'newui-loadingbar-996pc'
  );
  assert.ok(dynamic?.progressPreview);
  for (const field of ['value', 'end-value', 'maximum', 'value-interval', 'value-step', 'visibility']) {
    assert.ok(dynamic.progressPreview.dynamicFields?.includes(field),
      `LoadingBar dynamic field ${field} must not masquerade as a confirmed default`);
  }
  assert.match(dynamic.warning, /动态.*进度|进度.*动态/);
}

function test996CostItemBuildsDedicatedPreview() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<CostItem|x=166|y=120|itemid=1|itemcount=200000|title=进入扣除|titlecolor=251|color=250|fontsize=18|itemscale=0.5>',
    '<CostItem|x=166|y=160|itemid=1|itemcount=1>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const controls = model.pages[0].elements.filter(
    element => element.statementId === 'newui-costitem-996pc'
  );
  assert.equal(controls.length, 2);
  const [styled, clientDefault] = controls;
  assert.deepEqual(styled.costItemPreview, {
    title: '进入扣除',
    titleUsesClientDefault: false,
    titleColor: '#ffff00',
    quantityText: '200000',
    quantityColor: '#00ff00',
    fontSize: 18,
    itemScale: 0.5,
  }, 'CostItem must preserve title and slash-quantity styling separately from ItemShow');
  assert.equal(styled.itemPreview.itemIndex, 1,
    'CostItem must retain its database-backed item preview for provider hydration');
  assert.equal(styled.itemPreview.quantity, 200000);
  assert.equal(styled.sizePreview.width.mode, 'intrinsic');
  assert.equal(styled.sizePreview.height.mode, 'intrinsic');
  styled.assetLayers = [{
    role: 'item',
    assetRef: { archiveName: 'Items', imageIndex: 1 },
    asset: {
      status: 'ready', url: 'data:image/png;base64,AA==',
      width: 34, height: 36, offsetX: 2, offsetY: -4,
    },
  }];
  reflowNpcDialogLayout(model);
  let hydrated = model.pages[0].elements.find(element => element.id === styled.id);
  assert.deepEqual({ width: hydrated.width, height: hydrated.height }, { width: 161, height: 22 },
    'CostItem intrinsic size must include scaled text, icon offsets, and slash quantity');
  reflowNpcDialogLayout(model);
  hydrated = model.pages[0].elements.find(element => element.id === styled.id);
  assert.deepEqual({ width: hydrated.width, height: hydrated.height }, { width: 161, height: 22 },
    'CostItem hydrated reflow must be idempotent');

  assert.equal(clientDefault.costItemPreview.title, '客户端默认标题');
  assert.equal(clientDefault.costItemPreview.titleUsesClientDefault, true);
  assert.equal(clientDefault.costItemPreview.quantityText, '1');
  assert.equal(clientDefault.costItemPreview.itemScale, 1);
  assert.match(clientDefault.warning, /客户端默认标题.*未公开|默认标题.*手册未公开/,
    'an omitted title must expose the documented client-default boundary without inventing text');
}

function testAnimationsAndInteractiveButtonStates() {
  const gom = parse([
    '[@main]',
    '#SAY',
    '<&IMGEX:10:100:101:102:20:30>',
    '<&PLAYIMG:11:200:4:75:40:50>',
    '<&PLAYIMGEX:12:300:5:90:60:70:0:2>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const imgex = gom.pages[0].elements.find(element => element.statementId === 'imgex-absolute');
  assert.deepEqual(imgex.assetLayers.map(layer => [layer.role, layer.assetRef]), [
    ['hover', { willIndex: 10, imageIndex: 101 }],
    ['pressed', { willIndex: 10, imageIndex: 102 }],
  ]);
  const play = gom.pages[0].elements.find(element => element.statementId === 'playimg-absolute');
  assert.deepEqual({
    variant: play.animationPreview.variant,
    frameCount: play.animationPreview.frameCount,
    intervalMs: play.animationPreview.intervalMs,
    previewIntervalMs: play.animationPreview.previewIntervalMs,
    offsetPolicy: play.animationPreview.offsetPolicy,
    finiteCompletion: play.animationPreview.finiteCompletion,
  }, {
    variant: 'gom-playimg', frameCount: 4, intervalMs: 75, previewIntervalMs: 75,
    offsetPolicy: 'switch', finiteCompletion: 'hide',
  });
  const playEx = gom.pages[0].elements.find(element => element.statementId === 'playimgex-absolute');
  assert.deepEqual({
    variant: playEx.animationPreview.variant,
    frameCount: playEx.animationPreview.frameCount,
    intervalMs: playEx.animationPreview.intervalMs,
    previewIntervalMs: playEx.animationPreview.previewIntervalMs,
    repeatCount: playEx.animationPreview.repeatCount,
    offsetPolicy: playEx.animationPreview.offsetPolicy,
    finiteCompletion: playEx.animationPreview.finiteCompletion,
  }, {
    variant: 'gom-playimgex', frameCount: 5, intervalMs: 90, previewIntervalMs: 90,
    repeatCount: 2, offsetPolicy: 'ignore', finiteCompletion: 'hide',
  });

  const pc = parse([
    '[@main]',
    '#SAY',
    '<Button|wil=NewopUI|pcnimg=10|pcmimg=11|pcpimg=12|text=测试|color=250|size=18|outline=2|outlinecolor=249|grey=1|tips={<提示/FCOLOR=253>}|x=20|y=30|link=@ok>',
    '<Frames|wil=NewopUI|start=100|count=6|speed=80|loop=3>',
    '<Effect|wil=NewopUI|start=200|num=7|DMode=0|gap=95|count=4|link=@ok>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const button = pc.pages[0].elements.find(element => element.statementId === 'newui-button-996pc');
  assert.deepEqual(button.assetLayers.map(layer => [layer.role, layer.assetRef]), [
    ['hover', { archiveName: 'NewopUI', imageIndex: 11 }],
    ['pressed', { archiveName: 'NewopUI', imageIndex: 12 }],
  ]);
  assert.deepEqual(button.textPreview, {
    lines: [[{ text: '测试' }]],
    fontSize: 18,
    color: '#00ff00',
    outlineWidth: 2,
    outlineColor: '#ff0000',
    align: 'center',
    gray: true,
  }, 'Button text style must use exact keyed fields instead of the FCOLOR inside tips');
  const frames = pc.pages[0].elements.find(element => element.statementId === 'newui-frames-996pc');
  assert.deepEqual({
    variant: frames.animationPreview.variant,
    frameCount: frames.animationPreview.frameCount,
    intervalMs: frames.animationPreview.intervalMs,
    previewIntervalMs: frames.animationPreview.previewIntervalMs,
    repeatCount: frames.animationPreview.repeatCount,
    offsetPolicy: frames.animationPreview.offsetPolicy,
    finiteCompletion: frames.animationPreview.finiteCompletion,
  }, {
    variant: '996pc-frames', frameCount: 6, intervalMs: 80, previewIntervalMs: 80,
    repeatCount: 3, offsetPolicy: 'asset', finiteCompletion: 'frames-policy',
  });
  const effect = pc.pages[0].elements.find(element => element.statementId === 'newui-effect-996pc');
  assert.equal(effect.assetRef.frameCount, 7, 'Effect num is the frame count; count is the repeat count');
  assert.deepEqual({
    variant: effect.animationPreview.variant,
    frameCount: effect.animationPreview.frameCount,
    intervalMs: effect.animationPreview.intervalMs,
    previewIntervalMs: effect.animationPreview.previewIntervalMs,
    repeatCount: effect.animationPreview.repeatCount,
    drawMode: effect.animationPreview.drawMode,
    offsetPolicy: effect.animationPreview.offsetPolicy,
    finiteCompletion: effect.animationPreview.finiteCompletion,
    link: effect.animationPreview.link,
  }, {
    variant: '996pc-effect', frameCount: 7, intervalMs: 95, previewIntervalMs: 95,
    repeatCount: 4, drawMode: 0, offsetPolicy: 'asset', finiteCompletion: 'unknown',
    link: '@ok',
  });
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

function testTraditionalFlowFColorBuildsIndependentRuns() {
  for (const engine of ['GOM', 'GEE']) {
    const model = parse([
      '[@main]',
      '#SAY',
      '普通<绿色/FCOLOR=250><黄色/FCOLOR=251>尾部',
      '<网页色/FCOLOR=#CCFFFF>',
    ].join('\n'), engine, workspaceNpcDialogOffsets(0, 0));
    const flowTexts = model.pages[0].elements.filter(
      element => element.statementId === 'flow-text'
    );
    assert.equal(flowTexts.length, 1,
      'embedded color runs stay one flow line; standalone catalog markup has a typed identity');
    assert.deepEqual({
      text: flowTexts[0].text,
      width: flowTexts[0].width,
      preview: flowTexts[0].textPreview,
    }, {
      text: '普通绿色黄色尾部',
      width: 96,
      preview: {
        lines: [[
          { text: '普通' },
          { text: '绿色', color: '#00ff00' },
          { text: '黄色', color: '#ffff00' },
          { text: '尾部' },
        ]],
        align: 'left',
      },
    }, `${engine} traditional FCOLOR markup must build per-span visible runs`);
    const standaloneColor = model.pages[0].elements.find(
      element => element.statementId === 'text-color'
    );
    assert.ok(standaloneColor, `${engine} standalone FCOLOR must use the catalog statement id`);
    assert.deepEqual(standaloneColor.textPreview?.lines, [
      [{ text: '网页色', color: '#CCFFFF' }],
    ], `${engine} traditional FCOLOR must preserve documented web colors`);
    assert.equal(standaloneColor.textPreview?.color, '#CCFFFF');
    assert.doesNotMatch(
      [...flowTexts, standaloneColor].map(element => element.text).join(''),
      /FCOLOR|[<>]/,
      `${engine} traditional FCOLOR markup must never leak into visible text`);
  }
}

function testTraditionalAutoColorBuildsAnimatedRuns() {
  for (const engine of ['GOM', 'GEE']) {
    const model = parse([
      '[@main]',
      '#SAY',
      '<自动变色/AUTOCOLOR=254,251,168>',
      '<&TEXT:绝对自动:10:20{AUTOCOLOR=254,251,168}>',
    ].join('\n'), engine, workspaceNpcDialogOffsets(0, 0));
    const flow = model.pages[0].elements.find(
      element => element.statementId === 'flow-text' && element.text === '自动变色'
    );
    const absolute = model.pages[0].elements.find(
      element => element.statementId === 'text-absolute'
    );
    assert.ok(flow && absolute, `${engine} AUTOCOLOR fixtures must remain visible text controls: ${JSON.stringify(
      model.pages[0].elements.map(element => ({ id: element.statementId, text: element.text, raw: element.raw }))
    )}`);
    assert.deepEqual(flow.textPreview, {
      lines: [[{
        text: '自动变色',
        colorValues: ['254', '251', '168'],
        colorFrames: ['#00ffff', '#ffff00', '#007bde'],
        colorIntervalMs: 1000,
      }]],
      align: 'left',
    }, `${engine} flow AUTOCOLOR must animate only its marked text run`);
    assert.deepEqual(absolute.textPreview, {
      lines: [[{
        text: '绝对自动',
        colorValues: ['254', '251', '168'],
        colorFrames: ['#00ffff', '#ffff00', '#007bde'],
        colorIntervalMs: 1000,
      }]],
      align: 'left',
    }, `${engine} positioned TEXT AUTOCOLOR must keep the documented color sequence`);
    assert.doesNotMatch(
      model.pages[0].elements.map(element => element.text || '').join(''),
      /AUTOCOLOR|[<>]/,
      `${engine} AUTOCOLOR markup must never leak into visible text`
    );
  }
}

function testTraditionalTextBuildsDocumentedFontSimpleNumberAndCenterPreview() {
  const gom = parse([
    '[@main]',
    '#IF',
    '#ACT',
    'MOV N$FONT_SIZE 25',
    'MOV S$FONT_NAME 宋体',
    'MOV N$FONT_BOLD 1',
    'MOV N$SIMPLE_NUM 1',
    'MOV N$CENTER_OFFSET 30',
    '#SAY',
    '<Text:100200300400|提示信息:*:*30{FCOLOR=253;FSIZE=25;FNAME=宋体;FBOLD=1;SIMPLENUM=1}/@测试>',
    '<Text:左右居中:*:20>',
    '<Text:上下居中:10:*>',
    '<Text:完全居中:*:*>',
    '<Text:右偏:*30:*>',
    '<Text:左偏:*-30:*>',
    '<Text:下偏:*:*20>',
    '<Text:上偏:*:*-20>',
    '<Text:双轴偏:*30:*20>',
    '<Text:120000:*<$STR(N$CENTER_OFFSET)>:*{FSIZE=<$STR(N$FONT_SIZE)>;FNAME=<$STR(S$FONT_NAME)>;FBOLD=<$STR(N$FONT_BOLD)>;SIMPLENUM=<$STR(N$SIMPLE_NUM)>}>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const elements = gom.pages[0].elements.filter(element => /^text-/.test(element.statementId));
  const styled = elements.find(element => element.raw.includes('100200300400'));
  assert.ok(styled, 'the official GOM traditional Text style sample must build one text control');
  assert.deepEqual(styled.textPreview, {
    lines: [[{ text: '1002亿', color: '#ff00ff' }]],
    fontSize: 25,
    fontFamily: '宋体',
    bold: true,
    color: '#ff00ff',
    align: 'center',
    simplifyNumber: true,
    simplifyNumberApproximate: true,
  }, 'traditional Text must retain every documented static style and simplify its number');
  assert.equal(styled.text, '1002亿');
  assert.equal(styled.coordinateMode, 'anchored');
  assert.equal(styled.editable, false, 'center-relative source cannot be rewritten as literal X/Y');
  assert.deepEqual(styled.layoutPreview, {
    legacyCenterX: true,
    legacyCenterY: true,
    legacyCenterOffsetX: 0,
    legacyCenterOffsetY: 30,
  });
  assert.equal(styled.layoutX + styled.width / 2, 400,
    'official * X must center the Text wrapper in the 800px preview reference');
  assert.equal(styled.layoutY + styled.height / 2, 330,
    'official *30 Y must center and then move down by 30px');
  assert.match(styled.warning || '', /居中.*(?:800|600)|(?:800|600).*居中/,
    'the preview reference boundary must be disclosed instead of claiming an unknown client size');
  assert.match(styled.warning || '', /小数精度|近似/,
    'non-integral SIMPLENUM precision must remain an explicit approximation boundary');

  const centeredByText = new Map(elements.map(element => [element.text, element]));
  assert.deepEqual({
    horizontal: centeredByText.get('左右居中').layoutPreview,
    vertical: centeredByText.get('上下居中').layoutPreview,
    both: centeredByText.get('完全居中').layoutPreview,
    right: centeredByText.get('右偏').layoutPreview,
    left: centeredByText.get('左偏').layoutPreview,
    down: centeredByText.get('下偏').layoutPreview,
    up: centeredByText.get('上偏').layoutPreview,
    bothOffset: centeredByText.get('双轴偏').layoutPreview,
  }, {
    horizontal: { legacyCenterX: true, legacyCenterY: false, legacyCenterOffsetX: 0 },
    vertical: { legacyCenterX: false, legacyCenterY: true, legacyCenterOffsetY: 0 },
    both: {
      legacyCenterX: true, legacyCenterY: true,
      legacyCenterOffsetX: 0, legacyCenterOffsetY: 0,
    },
    right: {
      legacyCenterX: true, legacyCenterY: true,
      legacyCenterOffsetX: 30, legacyCenterOffsetY: 0,
    },
    left: {
      legacyCenterX: true, legacyCenterY: true,
      legacyCenterOffsetX: -30, legacyCenterOffsetY: 0,
    },
    down: {
      legacyCenterX: true, legacyCenterY: true,
      legacyCenterOffsetX: 0, legacyCenterOffsetY: 20,
    },
    up: {
      legacyCenterX: true, legacyCenterY: true,
      legacyCenterOffsetX: 0, legacyCenterOffsetY: -20,
    },
    bothOffset: {
      legacyCenterX: true, legacyCenterY: true,
      legacyCenterOffsetX: 30, legacyCenterOffsetY: 20,
    },
  }, 'all seven official GOM center/offset forms must remain distinguishable');

  const dynamic = elements.find(element => (
    element.layoutPreview?.legacyCenterDynamicAxes?.includes('x')
    && element.raw.includes('N$CENTER_OFFSET')
  ));
  assert.ok(dynamic, 'source-bound traditional Text fixture must remain represented');
  for (const field of ['font-size', 'font-family', 'font-bold', 'simplify-number']) {
    assert.ok(dynamic.textPreview.resolvedFields?.includes(field),
      `direct constant MOV for legacy Text ${field} must be statically proven`);
    assert.equal(Boolean(dynamic.textPreview.dynamicFields?.includes(field)), false);
  }
  assert.equal(dynamic.text, '12万');
  assert.equal(dynamic.textPreview.fontSize, 25);
  assert.equal(dynamic.textPreview.fontFamily, '宋体');
  assert.equal(dynamic.textPreview.bold, true);
  assert.equal(dynamic.textPreview.simplifyNumber, true);
  assert.deepEqual(dynamic.layoutPreview, {
    legacyCenterX: true,
    legacyCenterY: true,
    legacyCenterOffsetX: 0,
    legacyCenterOffsetY: 0,
    legacyCenterDynamicAxes: ['x'],
    positionDynamic: true,
    dynamic: true,
  }, 'a resolved MOV value must not become a confirmed center offset');
  assert.equal(dynamic.layoutX + dynamic.width / 2, 400,
    'an unknown center offset must use the safe zero-offset center preview');
  assert.match(dynamic.warning || '', /动态.*偏移|偏移.*动态/,
    'the unresolved center offset remains a separate coordinate boundary');

  const gee = parse([
    '[@main]',
    '#SAY',
    '<Text:翎风字体|提示:30:20{FCOLOR=250;FSIZE=14;FNAME=黑体;FBOLD=1}/@测试>',
    '<Text:翎风无证据语法:*:*{SIMPLENUM=1}>',
  ].join('\n'), 'GEE', workspaceNpcDialogOffsets(0, 0));
  const geeStyled = gee.pages[0].elements.find(element => element.text === '翎风字体');
  assert.deepEqual(geeStyled.textPreview, {
    lines: [[{ text: '翎风字体', color: '#00ff00' }]],
    fontSize: 14,
    fontFamily: '黑体',
    bold: true,
    color: '#00ff00',
    align: 'left',
  }, 'GEE must draw the three font fields explicitly documented by its own manual');
  const geeUnsupported = gee.pages[0].elements.find(element => element.text === '翎风无证据语法');
  assert.equal(geeUnsupported.text, '翎风无证据语法',
    'GEE must not borrow GOM SIMPLENUM behavior without engine-specific evidence');
  assert.equal(geeUnsupported.layoutPreview, undefined,
    'GEE must not borrow GOM * coordinate semantics without engine-specific evidence');
  assert.match(geeUnsupported.warning || '', /GEE.*(?:SIMPLENUM|\*)|(?:SIMPLENUM|\*).*GEE/);
}

function testOfficialLegendPaletteAcrossDialogControls() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<Text|id=T31|x=10|y=10|text=标准文字|color=31|outline=1|outlinecolor=33>',
    '<Button|id=B58|x=10|y=40|wil=NewopUI|pcnimg=10|text=标准按钮|color=58|outline=1|outlinecolor=70>',
    '<LoadingBar|id=L125|x=10|y=70|wil=NewopUI|pcloadingbg=100|pcloadingbar=101|startper=25|color=125|outline=1|outlinecolor=143>',
    '<Input|id=I146|x=10|y=100|width=120|height=24|inputid=1|type=0|place=提示|placecolor=150|color=146>',
    '<MenuItem|id=M151|x=10|y=130|menuid=S0|itemname=甲#乙|select=乙|fontcolor=151|selectcolor=220>',
    '<CostItem|id=C246|x=10|y=160|itemid=1|itemcount=2|title=消耗|titlecolor=246|color=7>',
    '<Text|id=HEX|x=10|y=190|text=十六进制|color=$8FCF88>',
    '<Text|id=BLACK|x=10|y=220|text=黑色|color=0>',
    '<Text|id=WHITE|x=10|y=250|text=兼容白色|color=255>',
    '<Text|id=UNSET|x=10|y=280|text=未设色槽|color=32>',
    '<Text|id=CUSTOM|x=10|y=310|text=自定义色|color=1005>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const byId = new Map(model.pages[0].elements.map(element => [element.containerElementId, element]));

  assert.deepEqual({
    text: byId.get('T31').textPreview.color,
    textOutline: byId.get('T31').textPreview.outlineColor,
    button: byId.get('B58').textPreview.color,
    buttonOutline: byId.get('B58').textPreview.outlineColor,
    loading: byId.get('L125').progressPreview.captionColor,
    loadingOutline: byId.get('L125').progressPreview.outlineColor,
    input: byId.get('I146').inputPreview.textColor,
    inputPlaceholder: byId.get('I146').inputPreview.placeholderColor,
    menu: byId.get('M151').menuPreview.fontColor,
    menuSelected: byId.get('M151').menuPreview.selectedColor,
    costTitle: byId.get('C246').costItemPreview.titleColor,
    costQuantity: byId.get('C246').costItemPreview.quantityColor,
  }, {
    text: '#ffaa99',
    textOutline: '#733929',
    button: '#fb0000',
    buttonOutline: '#ff7700',
    loading: '#dea500',
    loadingOutline: '#18424a',
    input: '#44ddff',
    inputPlaceholder: '#f7ef8c',
    menu: '#f7e700',
    menuSelected: '#008800',
    costTitle: '#fffbf0',
    costQuantity: '#c0c0c0',
  }, 'every Ctrl+F12 control must share the documented GOM/LFM/996PC default palette');
  assert.equal(byId.get('HEX').textPreview.color, '#88CF8F',
    'documented $BBGGRR colors must be converted to CSS #RRGGBB');
  assert.equal(byId.get('BLACK').textPreview.color, '#000000');
  assert.equal(byId.get('WHITE').textPreview.color, '#ffffff',
    '255 is an explicit white compatibility convention even though the original palette cell is unset');
  assert.equal(byId.get('UNSET').textPreview.color, undefined,
    'the undocumented slot 32 must not be invented as black or white');
  assert.match(byId.get('UNSET').warning, /32.*未设置|未设置.*32/);
  assert.ok(!byId.get('UNSET').textPreview.dynamicFields?.includes('color'),
    'a static but unset color slot is not a runtime expression');
  assert.equal(byId.get('CUSTOM').textPreview.color, undefined,
    'an unavailable custom-palette index must not silently become white');
  assert.match(byId.get('CUSTOM').warning, /1005.*(?:cfg_colour_style|自定义颜色表)|(?:cfg_colour_style|自定义颜色表).*1005/);
  assert.ok(!byId.get('CUSTOM').textPreview.dynamicFields?.includes('color'),
    'a static custom-palette index is unknown, not dynamic');

  const {
    LEGEND_STANDARD_COLORS,
    resolveLegendColorIndex,
  } = require('../out/utils/legend-colors');
  assert.equal(LEGEND_STANDARD_COLORS.length, 256);
  assert.equal(LEGEND_STANDARD_COLORS[32], undefined);
  assert.equal(LEGEND_STANDARD_COLORS[255], undefined);
  assert.deepEqual(resolveLegendColorIndex(0), {
    index: 0, color: '#000000', status: 'standard',
  });
  assert.deepEqual(resolveLegendColorIndex(32), { index: 32, status: 'unset' });
  assert.deepEqual(resolveLegendColorIndex(255), {
    index: 255, color: '#ffffff', status: 'compatibility',
  });
  assert.deepEqual(resolveLegendColorIndex(1005), { index: 1005, status: 'out-of-range' });
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
  assert.deepEqual({ x: text.localLayoutX, y: text.localLayoutY }, { x: 0, y: 4 },
    'nested absolute text must apply its 4px paint bias in parent-local space');
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
    'nested child writeback must restore the 4px source bias after parent movement');

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

function testListViewStaticLayoutAndContainerNewLine() {
  const pick = (value, fields) => Object.fromEntries(fields.map(field => [field, value[field]]));
  const gom = parse([
    '[@main]',
    '#SAY',
    '<ListView:~#LIST:100:100:100:55:5:1:0>',
    '<Layout:#LIST~#A:7:0:80:30>',
    '<Layout:#LIST~#B:7:0:80:30>',
    '<Layout:#LIST~#C:7:0:80:30>',
    '<Layout:~#FLOW:300:100:200:80>',
    '<Text:#FLOW~:甲:0:0>',
    '<Text:#FLOW~:BB:0:0>',
    '<NewLine:#FLOW~>',
    '<Text:#FLOW~:丙:0:0>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const gomPage = gom.pages[0];
  const vertical = gomPage.elements.find(
    element => element.statementId === 'container-listview'
  );
  assert.deepEqual(pick(vertical.containerPreview, [
    'variant', 'label', 'direction', 'gap', 'defaultIndex', 'viewportClipped',
    'scrollOffset', 'contentWidth', 'contentHeight',
  ]), {
    variant: 'list',
    label: '列表容器',
    direction: 'vertical',
    gap: 5,
    defaultIndex: 1,
    viewportClipped: true,
    scrollOffset: 35,
    contentWidth: 87,
    contentHeight: 100,
  }, 'GOM ListView must model its zero-based initial index and vertical viewport');
  assert.equal(vertical.containerPreview.requestedDefaultIndex, 1);
  assert.equal(vertical.containerPreview.effectiveDefaultIndex, 1);
  assert.equal(vertical.containerPreview.rememberScrollPosition, false,
    'omitted GOM remember-scroll-position uses the documented disabled switch state');
  const gomChildren = ['A', 'B', 'C'].map(id => gomPage.elements.find(
    element => element.containerElementId === id
  ));
  assert.deepEqual(gomChildren.map(element => ({
    localX: element.localLayoutX,
    localY: element.localLayoutY,
    globalX: element.layoutX,
    globalY: element.layoutY,
  })), [
    { localX: 7, localY: -35, globalX: 107, globalY: 65 },
    { localX: 7, localY: 0, globalX: 107, globalY: 100 },
    { localX: 7, localY: 35, globalX: 107, globalY: 135 },
  ], 'ListView children must be arranged by height and gap before applying initial scroll');

  const flowTexts = ['甲', 'BB', '丙'].map(text => gomPage.elements.find(
    element => element.text === text
  ));
  assert.deepEqual(flowTexts.map(element => ({
    width: element.width,
    localX: element.localLayoutX,
    localY: element.localLayoutY,
  })), [
    { width: 12, localX: 0, localY: 0 },
    { width: 12, localX: 12, localY: 0 },
    { width: 12, localX: 0, localY: 20 },
  ], 'container text at 0:0 must flow horizontally and NewLine must start the next row');
  const newLine = gomPage.elements.find(element => element.statementId === 'container-newline');
  assert.equal(newLine.parentElementId, gomPage.elements.find(
    element => element.containerElementId === 'FLOW'
  ).id);

  const pc = parse([
    '[@main]',
    '#SAY',
    '<ListView|id=LV|children={C,B,A}|x=200|y=100|width=70|height=40|direction=2|margin=10|default=2|cantouch=0|bounce=1>',
    '<Layout|id=A|width=40|height=30>',
    '<Layout|id=B|width=40|height=30>',
    '<Layout|id=C|width=40|height=30>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const pcPage = pc.pages[0];
  const horizontal = pcPage.elements.find(
    element => element.statementId === 'newui-listview-996pc'
  );
  assert.deepEqual(pick(horizontal.containerPreview, [
    'variant', 'label', 'direction', 'gap', 'defaultIndex', 'viewportClipped',
    'touchEnabled', 'bounce', 'scrollOffset', 'contentWidth', 'contentHeight',
  ]), {
    variant: 'list',
    label: '列表容器',
    direction: 'horizontal',
    gap: 10,
    defaultIndex: 1,
    viewportClipped: true,
    touchEnabled: false,
    bounce: 1,
    scrollOffset: 50,
    contentWidth: 140,
    contentHeight: 30,
  }, '996PC ListView default is one-based and children order comes from children={...}');
  assert.equal(horizontal.containerPreview.requestedDefaultIndex, 2,
    '996PC must retain the one-based source default separately');
  assert.equal(horizontal.containerPreview.effectiveDefaultIndex, 1,
    '996PC must expose the clamped zero-based effective default separately');
  const pcChildren = ['C', 'B', 'A'].map(id => pcPage.elements.find(
    element => element.containerElementId === id
  ));
  assert.deepEqual(pcChildren.map(element => ({
    localX: element.localLayoutX,
    localY: element.localLayoutY,
    globalX: element.layoutX,
    globalY: element.layoutY,
  })), [
    { localX: -50, localY: 0, globalX: 150, globalY: 100 },
    { localX: 0, localY: 0, globalX: 200, globalY: 100 },
    { localX: 50, localY: 0, globalX: 250, globalY: 100 },
  ], '996PC ListView must honor declared child order, horizontal margin, and initial index');
}

function testListViewNormalScrollbarAssets() {
  for (const engine of ['GOM', 'GEE']) {
    const model = parse([
      '[@main]',
      '#SAY',
      '<ListView:~#LIST:10:20:120:90:0:0:0:0:0:0:22:76:82:83:84:86:87:88:79:80:81>',
    ].join('\n'), engine, workspaceNpcDialogOffsets(0, 0));
    const list = model.pages[0].elements.find(
      element => element.statementId === 'container-listview'
    );
    assert.equal(list.containerPreview.scrollbarMode, 'custom');
    assert.deepEqual(list.assetLayers.filter(layer => (
      !/-hover|-pressed/.test(layer.role)
    )).map(layer => [layer.role, layer.assetRef]), [
      ['scrollbar', { willIndex: 22, imageIndex: 76 }],
      ['scroll-start', { willIndex: 22, imageIndex: 82 }],
      ['scroll-thumb', { willIndex: 22, imageIndex: 86 }],
      ['scroll-end', { willIndex: 22, imageIndex: 79 }],
    ], `${engine} ListView must expose all four documented normal-state scrollbar assets`);
  }

  const custom = parse([
    '[@main]',
    '#SAY',
    '<ListView|id=LV|children={A}|x=10|y=20|width=120|height=90|direction=1|Slider=1|Sdbg=300|Sdupnimg=301|Sdnimg=304|Sddwnimg=307>',
    '<Layout|id=A|width=80|height=40>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const customList = custom.pages[0].elements.find(
    element => element.statementId === 'newui-listview-996pc'
  );
  assert.equal(customList.containerPreview.scrollbarMode, 'custom');
  assert.deepEqual(customList.assetLayers.filter(layer => (
    !/-hover|-pressed/.test(layer.role)
  )).map(layer => [layer.role, layer.assetRef]), [
    ['scrollbar', { archiveRole: 'game-ui-pack', imageIndex: 300 }],
    ['scroll-start', { archiveRole: 'game-ui-pack', imageIndex: 301 }],
    ['scroll-thumb', { archiveRole: 'game-ui-pack', imageIndex: 304 }],
    ['scroll-end', { archiveRole: 'game-ui-pack', imageIndex: 307 }],
  ], '996PC custom ListView slider must use its four documented normal-state fields');
  assert.equal(
    gameUiPackArchiveNameFromConfig('[Setup]\r\nGameUIPack=NewopUI.Jpk\r\n'),
    'NewopUI.Jpk',
    '996PC ListView slider assets must resolve through the configured GameUIPack'
  );

  const clientDefault = parse([
    '[@main]',
    '#SAY',
    '<ListView|id=LV|children={A}|direction=1|Slider=1>',
    '<Layout|id=A|width=80|height=40>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const defaultList = clientDefault.pages[0].elements.find(
    element => element.statementId === 'newui-listview-996pc'
  );
  assert.equal(defaultList.containerPreview.scrollbarMode, 'client-default');
  assert.equal(defaultList.assetLayers, undefined,
    'undocumented client-default slider assets must not be guessed');
  assert.match(defaultList.warning, /客户端默认滑块.*手册未公开默认素材/);

  const dynamicLegacy = parse([
    '[@main]',
    '#SAY',
    '<ListView:~#LIST:10:20:120:90:0:0:0:0:0:0:<$STR(S0)>:76:82:83:84:86:87:88:79:80:81>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const dynamicList = dynamicLegacy.pages[0].elements.find(
    element => element.statementId === 'container-listview'
  );
  assert.equal(dynamicList.assetLayers, undefined,
    'a variable preview fallback must never be misrepresented as WZL index 0');
  assert.equal(dynamicList.containerPreview.scrollbarMode, 'blocked',
    'a dynamic legacy archive must expose an explicit blocked scrollbar mode');
  assert.equal(dynamicList.containerPreview.scrollbarDynamic, true);
  assert.ok(dynamicList.containerPreview.scrollbarDiagnostics.every(
    diagnostic => diagnostic.sourceStatus === 'dynamic' && diagnostic.assetRef === undefined
  ), 'every dynamic legacy scrollbar role must remain non-requestable');
  assert.match(dynamicList.warning, /滚动条素材.*动态.*不绘制/);
}

function testListViewScrollbarInteractionAssets() {
  const legacy = parse([
    '[@main]',
    '#SAY',
    '<ListView:~#LIST:10:20:120:90:0:0:0:0:0:0:22:76:82:83:84:86:87:88:79:80:81>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const legacyList = legacy.pages[0].elements.find(
    element => element.statementId === 'container-listview'
  );
  assert.deepEqual(legacyList.assetLayers.filter(layer => (
    /-hover|-pressed/.test(layer.role)
  )).map(layer => [layer.role, layer.assetRef]), [
    ['scroll-start-hover', { willIndex: 22, imageIndex: 83 }],
    ['scroll-start-pressed', { willIndex: 22, imageIndex: 84 }],
    ['scroll-thumb-hover', { willIndex: 22, imageIndex: 87 }],
    ['scroll-thumb-pressed', { willIndex: 22, imageIndex: 88 }],
    ['scroll-end-hover', { willIndex: 22, imageIndex: 80 }],
    ['scroll-end-pressed', { willIndex: 22, imageIndex: 81 }],
  ], 'legacy ListView must preserve hover/pressed states for all three controls');

  const pc = parse([
    '[@main]',
    '#SAY',
    '<ListView|id=LV|direction=2|Slider=1|Sdbg=300|Sdupnimg=301|Sdupmimg=302|Sduppimg=303|Sdnimg=304|Sdmimg=305|Sdpimg=306|Sddwnimg=307|Sddwmimg=308|Sddwpimg=309>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const pcList = pc.pages[0].elements.find(
    element => element.statementId === 'newui-listview-996pc'
  );
  assert.deepEqual(pcList.assetLayers.filter(layer => (
    /-hover|-pressed/.test(layer.role)
  )).map(layer => [layer.role, layer.assetRef]), [
    ['scroll-start-hover', { archiveRole: 'game-ui-pack', imageIndex: 302 }],
    ['scroll-start-pressed', { archiveRole: 'game-ui-pack', imageIndex: 303 }],
    ['scroll-thumb-hover', { archiveRole: 'game-ui-pack', imageIndex: 305 }],
    ['scroll-thumb-pressed', { archiveRole: 'game-ui-pack', imageIndex: 306 }],
    ['scroll-end-hover', { archiveRole: 'game-ui-pack', imageIndex: 308 }],
    ['scroll-end-pressed', { archiveRole: 'game-ui-pack', imageIndex: 309 }],
  ], '996PC ListView must preserve every documented hover/pressed slider field');
}

function testOfficialAbsoluteContainerAliasesAreRecognized() {
  for (const engine of ['GOM', 'GEE']) {
    const model = parse([
      '[@main]',
      '#SAY',
      '<&Layout:~#L1:100:200:200:100:7>',
      '<&ListView:~#LIST:300:200:120:80:2:0:0:1:0:0:10:600:601:602:603:604:605:606:607:608:609>',
    ].join('\n'), engine, workspaceNpcDialogOffsets(10, 20));
    const page = model.pages[0];
    const layout = page.elements.find(element => (
      element.statementId === 'container-layout' && element.token === '<&Layout'
    ));
    const list = page.elements.find(element => (
      element.statementId === 'container-listview' && element.token === '<&ListView'
    ));

    assert.deepEqual(page.unsupportedStatements, [],
      `${engine} official & container aliases must not fall through as unsupported markup`);
    assert.ok(layout && list, `${engine} official & Layout/ListView aliases must enter the catalog`);
    assert.deepEqual({
      layoutMode: layout.coordinateMode,
      layoutX: layout.layoutX,
      layoutY: layout.layoutY,
      listMode: list.coordinateMode,
      listX: list.layoutX,
      listY: list.layoutY,
    }, {
      layoutMode: 'absolute',
      layoutX: 100,
      layoutY: 200,
      listMode: 'absolute',
      listX: 300,
      listY: 200,
    }, `${engine} & container aliases must use absolute coordinates without memo offsets`);
  }
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
  assert.match(applyTextReplacements(source, rounded.replacements), /<&TEXT:测试:24:-3>/,
    'absolute text writeback must restore the 4px source bias after rounding the paint position');
}

function test996DecimalAndAnchoredPercentageLayout() {
  const decimalSource = [
    '[@main]',
    '#SAY',
    '<Slider|wil=NewopUI|sliderid=N0|x=50.0|y=60.0|width=400|height=14|maxvalue=10000|defvalue=5000|pcbgimg=298|pcbarimg=299|pcballimg=297>',
  ].join('\n');
  const decimalModel = parse(decimalSource, '996PC', workspaceNpcDialogOffsets(0, 0));
  const slider = decimalModel.pages[0].elements.find(element => element.statementId === 'newui-slider-996pc');
  assert.ok(slider?.editable && slider.x && slider.y,
    '996PC decimal X/Y values must remain editable coordinates');
  assert.deepEqual(
    { x: slider.x.displayValue, y: slider.y.displayValue },
    { x: 50, y: 60 }
  );
  assert.deepEqual(
    { x: slider.x.span.original, y: slider.y.span.original },
    { x: '50.0', y: '60.0' },
    'decimal source spans must be retained for conflict-safe writeback'
  );
  const decimalNoop = buildDialogCoordinateEdits(
    decimalSource,
    decimalModel,
    [{ elementId: slider.id, x: 50, y: 60 }]
  );
  assert.deepEqual(decimalNoop.replacements, [],
    'numerically unchanged decimal coordinates must preserve their original source formatting');
  assert.equal(applyTextReplacements(decimalSource, decimalNoop.replacements), decimalSource);
  assert.deepEqual(
    slider.assetLayers.map(layer => ({ role: layer.role, assetRef: layer.assetRef })),
    [
      { role: 'background', assetRef: { archiveName: 'NewopUI', imageIndex: 298 } },
      { role: 'progress', assetRef: { archiveName: 'NewopUI', imageIndex: 299 } },
      { role: 'thumb', assetRef: { archiveName: 'NewopUI', imageIndex: 297 } },
    ],
    'Slider must model its background, filled bar, and thumb as three independent assets'
  );
  assert.deepEqual(
    { minimum: slider.progressPreview.minimum, maximum: slider.progressPreview.maximum,
      value: slider.progressPreview.value, ratio: slider.progressPreview.ratio },
    { minimum: 0, maximum: 10000, value: 5000, ratio: 0.5 },
    'Slider default value must produce a deterministic static ratio'
  );
  const decimalPatched = applyTextReplacements(decimalSource, buildDialogCoordinateEdits(
    decimalSource,
    decimalModel,
    [{ elementId: slider.id, x: 55, y: 66 }]
  ).replacements);
  assert.match(decimalPatched, /\|x=55\|y=66\|/,
    'moving a decimal-positioned control must safely replace its original numeric spans');

  const anchored = parse([
    '[@main]',
    '#SAY',
    '<Layout|id=L1|children={B1}|x=100|y=100|width=50|height=50>',
    '<Button|id=B1|a=4|percentx=50|percenty=50|width=20|height=10|wil=NewopUI|pcnimg=113|pcmimg=113|pcpimg=114>',
    '<LoadingBar|id=P1|a=4|percentx=55|percenty=73|width=200|height=20|wil=NewopUI|pcloadingbg=102|pcloadingbar=103|startper=10|endper=50|maxper=150>',
    '<Layout|id=SIZE|x=0|y=0|percentwidth=25|percentheight=10>',
    '<Layout|id=MIX_X|a=0|percentx=25|y=30|width=20|height=10>',
    '<Layout|id=MIX_Y|a=0|x=40|percenty=50|width=20|height=10>',
    '<Layout|id=ANCHOR_POINT|a=0|ax=0.5|ay=0.5|x=200|y=100|width=20|height=10>',
    '<Button|id=DIRECT_ANCHOR|a=4|x=0|y=0|width=20|height=10|wil=NewopUI|pcnimg=113>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const page = anchored.pages[0];
  const child = page.elements.find(element => element.containerElementId === 'B1');
  const loading = page.elements.find(element => element.containerElementId === 'P1');
  const sized = page.elements.find(element => element.containerElementId === 'SIZE');
  const mixedX = page.elements.find(element => element.containerElementId === 'MIX_X');
  const mixedY = page.elements.find(element => element.containerElementId === 'MIX_Y');
  const anchorPoint = page.elements.find(element => element.containerElementId === 'ANCHOR_POINT');
  const directAnchor = page.elements.find(element => element.containerElementId === 'DIRECT_ANCHOR');
  assert.deepEqual(
    { x: child.localLayoutX, y: child.localLayoutY, gx: child.layoutX, gy: child.layoutY },
    { x: 15, y: 20, gx: 115, gy: 120 },
    'a=4 with 50%/50% must center a child inside its parent bounds'
  );
  assert.deepEqual(
    { x: loading.layoutX, y: loading.layoutY },
    { x: 340, y: 428 },
    'top-level percentage coordinates must use the 800x600 preview canvas and the declared anchor'
  );
  assert.deepEqual(
    { width: sized.width, height: sized.height },
    { width: 200, height: 60 },
    'percentage dimensions must receive a deterministic static preview size'
  );
  assert.deepEqual({ x: mixedX.layoutX, y: mixedX.layoutY }, { x: 200, y: 30 },
    'percentx must be allowed to mix with a direct Y coordinate');
  assert.deepEqual({ x: mixedY.layoutX, y: mixedY.layoutY }, { x: 40, y: 300 },
    'a direct X coordinate must be allowed to mix with percenty');
  assert.deepEqual({ x: anchorPoint.layoutX, y: anchorPoint.layoutY }, { x: 190, y: 95 },
    'ax/ay must be treated as normalized element anchor points in the static preview');
  assert.deepEqual(
    { mode: directAnchor.coordinateMode, x: directAnchor.layoutX, y: directAnchor.layoutY,
      sourceX: directAnchor.x.sourceValue, sourceY: directAnchor.y.sourceValue },
    { mode: 'anchored', x: 390, y: 295, sourceX: 0, sourceY: 0 },
    'direct X/Y combined with a non-zero anchor must retain source values while using anchored layout'
  );
  assert.equal(child.editable, false,
    'anchor/percentage-only positions must stay read-only until safe percentage writeback exists');
  assert.match(child.warning, /锚点|百分比/);
}

function test996PercentageSizeKeepsDirectPositionEditable() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<Layout|id=SIZE_ONLY|x=10|y=20|percentwidth=25|percentheight=10>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(7, -4));
  const element = model.pages[0].elements.find(
    candidate => candidate.containerElementId === 'SIZE_ONLY'
  );
  assert.ok(element);
  assert.deepEqual(
    {
      mode: element.coordinateMode,
      editable: element.editable,
      x: element.layoutX,
      y: element.layoutY,
      width: element.width,
      height: element.height,
    },
    {
      mode: 'relative',
      editable: true,
      x: 17,
      y: 16,
      width: 200,
      height: 60,
    },
    'percentage size must not turn direct X/Y into anchored read-only coordinates or discard M2 offsets'
  );
}

function test996IntrinsicAssetSizeReflowsAnchoredLayoutIdempotently() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<Layout|id=L1|children={B1,T1,PCT}|x=100|y=100|width=50|height=50>',
    '<Button|id=B1|a=4|percentx=50|percenty=50|wil=NewopUI|pcnimg=113>',
    '<Text|id=T1|x=5|y=6|text=子节点|color=250>',
    '<Layout|id=PCT|x=0|y=0|percentwidth=50|height=10>',
    '<Img|id=BIG|x=750|y=0|wil=NewopUI|pcimg=500>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(7, -4));
  const page = model.pages[0];
  const button = page.elements.find(element => element.containerElementId === 'B1');
  const text = page.elements.find(element => element.containerElementId === 'T1');
  const percentage = page.elements.find(element => element.containerElementId === 'PCT');
  const big = page.elements.find(element => element.containerElementId === 'BIG');
  assert.ok(button && text && percentage && big);
  button.asset = {
    status: 'ready', url: 'data:image/png;base64,button', width: 20, height: 10,
    offsetX: 0, offsetY: 0,
  };
  big.asset = {
    status: 'ready', url: 'data:image/png;base64,big', width: 300, height: 20,
    offsetX: 0, offsetY: 0,
  };

  reflowNpcDialogLayout(model);
  const snapshot = () => ({
    button: {
      width: button.width, height: button.height,
      localX: button.localLayoutX, localY: button.localLayoutY,
      x: button.layoutX, y: button.layoutY,
    },
    text: {
      localX: text.localLayoutX, localY: text.localLayoutY,
      x: text.layoutX, y: text.layoutY,
    },
    percentage: {
      width: percentage.width, height: percentage.height,
      localX: percentage.localLayoutX, localY: percentage.localLayoutY,
    },
    big: { width: big.width, height: big.height, x: big.layoutX, y: big.layoutY },
    canvas: { width: model.canvasWidth, height: model.canvasHeight },
  });
  const once = snapshot();
  assert.deepEqual(once, {
    button: { width: 20, height: 10, localX: 15, localY: 20, x: 122, y: 116 },
    text: { localX: 5, localY: 6, x: 112, y: 102 },
    percentage: { width: 25, height: 10, localX: 0, localY: 0 },
    big: { width: 300, height: 20, x: 757, y: -4 },
    canvas: { width: 1137, height: 600 },
  }, 'hydrated intrinsic dimensions must drive anchor pivots and canvas bounds');

  reflowNpcDialogLayout(model);
  assert.deepEqual(snapshot(), once,
    'reflow must be idempotent for nested M2 coordinates and percentage dimensions');
}

function test996CheckBoxInitialStatePreview() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<CheckBox|id=C0|x=10|y=10|checkboxid=N0|wil=NewopUI|pcnimg=192|pcpimg=193|default=0>',
    '<CheckBox|id=C1|x=10|y=40|checkboxid=N1|wil=NewopUI|pcnimg=192|pcpimg=193|default=1>',
    '<CheckBox|id=CD|x=10|y=70|checkboxid=N2|wil=NewopUI|pcnimg=192|pcpimg=193|default=N2>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const controls = model.pages[0].elements.filter(
    element => element.statementId === 'newui-checkbox-996pc'
  );
  assert.equal(controls.length, 3);
  assert.deepEqual(controls.map(element => element.togglePreview?.checked), [false, true, undefined],
    'CheckBox default must preserve unselected, selected, and dynamic initial states');
  for (const control of controls) {
    assert.deepEqual(control.assetRef, { archiveName: 'NewopUI', imageIndex: 192 });
    assert.deepEqual(
      control.assetLayers?.map(layer => ({ role: layer.role, assetRef: layer.assetRef })),
      [{ role: 'selected', assetRef: { archiveName: 'NewopUI', imageIndex: 193 } }],
      'CheckBox must model its selected image separately from the unselected primary image'
    );
  }
  assert.match(controls[2].warning, /动态.*默认|默认.*动态/,
    'a dynamic default must be explicit instead of pretending to be selected or unselected');
}

function test996MenuItemStaticPreviewModel() {
  const pick = (value, fields) => Object.fromEntries(fields.map(field => [field, value[field]]));
  const assetDiagnostic = (element, field) => element.menuPreview.assetDiagnostics.find(
    diagnostic => diagnostic.field === field
  );
  const model = parse([
    '[@main]',
    '#SAY',
    '<MenuItem|id=M1|x=300|y=50|menuid=S0|itemname=刘德华#张学友#黎明#郭富城|select=张学友|direction=1|fontcolor=250|selectcolor=254|itemhei=30|maxhei=60>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const menu = model.pages[0].elements.find(
    element => element.statementId === 'newui-menuitem-996pc'
  );
  assert.ok(menu);
  assert.equal(menu.kind, 'menu', 'MenuItem must not be misclassified as an item/equipment preview');
  assert.equal(menu.itemPreview, undefined);
  assert.deepEqual(pick(menu.menuPreview, [
    'items', 'selected', 'menuId', 'direction', 'itemHeight', 'maxHeight',
    'fontColor', 'selectedColor',
  ]), {
    items: ['刘德华', '张学友', '黎明', '郭富城'],
    selected: '张学友',
    menuId: 'S0',
    direction: 1,
    itemHeight: 30,
    maxHeight: 60,
    fontColor: '#00ff00',
    selectedColor: '#00ffff',
  });
  assert.deepEqual(menu.menuPreview.defaultFields, [
    'img', 'arrowimg', 'selectimg', 'listimg',
  ], 'omitted MenuItem resources must be classified as documented defaults');
  assert.deepEqual(menu.assetRef, { archiveName: 'NewopUI', imageIndex: 2000 },
    'MenuItem without img must request the documented default background');
  assert.deepEqual(menu.assetLayers.map(layer => ({ role: layer.role, assetRef: layer.assetRef })), [
    { role: 'arrow', assetRef: { archiveName: 'NewopUI', imageIndex: 1451 } },
    { role: 'selected', assetRef: { archiveName: 'NewopUI', imageIndex: 2047 } },
    { role: 'list-background', assetRef: { archiveName: 'NewopUI', imageIndex: 2000 } },
  ], 'MenuItem must expose its arrow, selected row, and list background assets');
  assert.notEqual(menu.text, '物品/装备');

  const boundaries = parse([
    '[@main]',
    '#ACT',
    'MOV N$D 1',
    'MOV N$IH 50',
    'MOV N$MH 80',
    'MOV N$IMG 2100',
    'MOV N$ARROW 2101',
    'MOV N$SELECT 2102',
    'MOV N$LIST 2103',
    '#SAY',
    '<MenuItem|id=DYNAMIC|x=10|y=20|itemname=甲#乙|select=乙|direction=<$STR(N$D)>|itemhei=<$STR(N$IH)>|maxhei=<$STR(N$MH)>|img=<$STR(N$IMG)>|arrowimg=<$STR(N$ARROW)>|selectimg=<$STR(N$SELECT)>|listimg=<$STR(N$LIST)>>',
    '<MenuItem|id=CONTENT|x=10|y=60|itemname=<$STR(S$ITEMS)>|select=<$STR(S$SELECT)>|fontcolor=<$STR(N$FC)>|selectcolor=<$STR(N$SC)>>',
    '<MenuItem|id=INVALID|x=10|y=100|itemname=甲#乙|select=甲|direction=9|itemhei=0|maxhei=-2>',
    '<MenuItem|id=DEFAULT|x=10|y=140|itemname=甲#乙|select=甲>',
    '<MenuItem|id=DECIMAL|x=10|y=180|itemname=甲#乙|select=甲|direction=1|itemhei=30.5|maxhei=61.5>',
    '<MenuItem|id=ONLYDIRECTION|x=10|y=220|itemname=甲#乙|select=甲|itemhei=22>',
    '<MenuItem|id=ONLYITEMHEIGHT|x=10|y=260|itemname=甲#乙|select=甲|direction=1>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const byId = new Map(boundaries.pages[0].elements.map(element => (
    [element.containerElementId, element]
  )));
  const dynamic = byId.get('DYNAMIC');
  assert.deepEqual(pick(dynamic.menuPreview, [
    'items', 'selected', 'direction', 'itemHeight', 'dynamic', 'dynamicFields',
  ]), {
    items: ['甲', '乙'],
    selected: '乙',
    direction: 0,
    itemHeight: 30,
    dynamic: true,
    dynamicFields: [
      'direction', 'itemhei', 'maxhei', 'img', 'arrowimg', 'selectimg', 'listimg',
    ],
  }, 'runtime MenuItem geometry must retain explicit source uncertainty');
  assert.equal(dynamic.assetRef, undefined,
    'a dynamic MenuItem background must not borrow the empty-field default');
  assert.deepEqual(dynamic.assetLayers, undefined,
    'dynamic MenuItem resource slots must not emit requestable fallback layers');
  for (const field of ['img', 'arrowimg', 'selectimg', 'listimg']) {
    assert.equal(assetDiagnostic(dynamic, field).sourceStatus, 'dynamic');
    assert.equal(assetDiagnostic(dynamic, field).assetRef, undefined,
      `${field} must not retain the current MOV value or an empty-field default`);
  }
  assert.doesNotMatch(JSON.stringify(dynamic), /2100|2101|2102|2103/,
    'runtime MenuItem resources borrowed current MOV numeric values');
  assert.match(dynamic.warning, /MenuItem.*动态|动态.*MenuItem/);

  assert.deepEqual(pick(byId.get('CONTENT').menuPreview, [
    'items', 'selected', 'direction', 'itemHeight', 'dynamic', 'dynamicFields',
  ]), {
    items: ['预览文字'],
    selected: '预览文字',
    direction: 0,
    itemHeight: 30,
    dynamic: true,
    dynamicFields: ['itemname', 'select', 'fontcolor', 'selectcolor'],
  }, 'unknown MenuItem text must stay visible while dynamic colors remain source-gated');
  assert.equal(byId.get('CONTENT').menuPreview.fontColor, undefined);
  assert.equal(byId.get('CONTENT').menuPreview.selectedColor, undefined);
  assert.deepEqual(
    byId.get('CONTENT').displayValueSources?.filter(source => (
      source.field === 'menu-items' || source.field === 'menu-selected'
    )),
    [
      {
        field: 'menu-items', kind: 'text', expression: '<$STR(S$ITEMS)>',
        status: 'runtime-placeholder', value: '预览文字', variableNames: ['S$ITEMS'],
      },
      {
        field: 'menu-selected', kind: 'text', expression: '<$STR(S$SELECT)>',
        status: 'runtime-placeholder', value: '预览文字', variableNames: ['S$SELECT'],
      },
    ]
  );
  assert.ok(byId.get('CONTENT').menuPreview.defaultFields.includes('direction'));
  assert.ok(byId.get('CONTENT').menuPreview.defaultFields.includes('itemhei'));
  assert.deepEqual(pick(byId.get('INVALID').menuPreview, [
    'items', 'selected', 'direction', 'itemHeight', 'invalidFields',
  ]), {
    items: ['甲', '乙'],
    selected: '甲',
    direction: 0,
    itemHeight: 30,
    invalidFields: ['direction', 'itemhei', 'maxhei', 'arrowimg'],
  });
  assert.match(byId.get('INVALID').warning, /direction.*itemhei.*maxhei|无效.*参数/);
  assert.deepEqual(pick(byId.get('DEFAULT').menuPreview, [
    'items', 'selected', 'direction', 'itemHeight',
  ]), {
    items: ['甲', '乙'],
    selected: '甲',
    direction: 0,
    itemHeight: 30,
  });
  assert.ok(byId.get('DEFAULT').menuPreview.defaultFields.includes('direction'));
  assert.ok(byId.get('DEFAULT').menuPreview.defaultFields.includes('itemhei'));
  assert.match(byId.get('DEFAULT').warning, /手册未公开.*30px|30px.*手册未公开/);
  assert.deepEqual(pick(byId.get('DECIMAL').menuPreview, [
    'items', 'selected', 'direction', 'itemHeight', 'maxHeight',
  ]), {
    items: ['甲', '乙'],
    selected: '甲',
    direction: 1,
    itemHeight: 30.5,
    maxHeight: 61.5,
  }, 'positive MenuItem decimal geometry must not be truncated');
  assert.ok(byId.get('ONLYDIRECTION').menuPreview.defaultFields.includes('direction'));
  assert.ok(!byId.get('ONLYDIRECTION').menuPreview.defaultFields.includes('itemhei'));
  assert.match(byId.get('ONLYDIRECTION').warning, /未填写 direction.*direction=0/);
  assert.doesNotMatch(byId.get('ONLYDIRECTION').warning, /itemhei=30|30px/,
    'a missing direction must not claim that itemhei was also omitted');
  assert.ok(byId.get('ONLYITEMHEIGHT').menuPreview.defaultFields.includes('itemhei'));
  assert.ok(!byId.get('ONLYITEMHEIGHT').menuPreview.defaultFields.includes('direction'));
  assert.match(byId.get('ONLYITEMHEIGHT').warning, /未填写 itemhei.*30px/);
  assert.doesNotMatch(byId.get('ONLYITEMHEIGHT').warning, /direction=0/,
    'a missing itemhei must not claim that direction was also omitted');
}

function testCountdownInitialTextAcrossEngines() {
  const gom = parse([
    '[@main]',
    '#SAY',
    '<&COUNTDOWN:90:3:251:10:20:0/@fixed>',
    '<&COUNTDOWN:90:3:251:10:50:1/@compact>',
    '<&COUNTDOWN:50:3:251:10:80:1/@secondsCompact>',
    '<&COUNTDOWN:90:3:251:10:110:2/@seconds>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const gomCountdowns = gom.pages[0].elements.filter(element => element.statementId === 'countdown');
  assert.deepEqual(gomCountdowns.map(element => ({
    format: element.countdownPreview?.format,
    text: element.countdownPreview?.initialText,
    renderedText: element.text,
  })), [
    { format: 'legacy-fixed', text: '00:01:30', renderedText: '00:01:30' },
    { format: 'legacy-compact', text: '01:30', renderedText: '01:30' },
    { format: 'legacy-compact', text: '50', renderedText: '50' },
    { format: 'seconds', text: '90', renderedText: '90' },
  ]);

  const pcLegacy = parse([
    '[@main]',
    '#SAY',
    '<COUNTDOWN:90:3:251:10:20/@seconds>',
    '<TIMETIPS:90061:1:250:10:50/@details>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const pcLegacyCountdown = pcLegacy.pages[0].elements.find(
    element => element.statementId === 'countdown'
  );
  const pcLegacyTips = pcLegacy.pages[0].elements.find(
    element => element.statementId === 'time-tips'
  );
  assert.deepEqual(
    [pcLegacyCountdown.countdownPreview.initialText, pcLegacyTips.countdownPreview.initialText],
    ['90秒', '1天1时1分1秒']
  );

  const pc = parse([
    '[@main]',
    '#SAY',
    '<COUNTDOWN|id=C0|x=10|y=20|time=90|count=2|showWay=0|size=18|color=250|outline=1|outlinecolor=249>',
    '<COUNTDOWN|id=C1|x=10|y=50|time=90061|count=1|showWay=1|size=16|color=251>',
    '<TIMETIPS|id=T1|x=10|y=80|time=90061|count=1|size=14|color=254>',
    '<COUNTDOWN|id=CD|x=10|y=110|time=N1|showWay=0>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const byId = new Map(pc.pages[0].elements.map(element => [element.containerElementId, element]));
  assert.deepEqual(
    ['C0', 'C1', 'T1', 'CD'].map(id => byId.get(id).countdownPreview.initialText),
    ['90秒', '1天01时01分', '1天1时1分1秒', '?']
  );
  assert.deepEqual(byId.get('C0').textPreview, {
    lines: [[{ text: '90秒' }]],
    fontSize: 18,
    color: '#00ff00',
    outlineWidth: 1,
    outlineColor: '#ff0000',
    align: 'left',
  });
  assert.equal(byId.get('CD').countdownPreview.dynamic, true);
  assert.match(byId.get('CD').warning, /动态.*倒计时|倒计时.*动态/);
}

function testImageCountdownBuildsPerCharacterGlyphs() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<&IMGCOUNTDOWN:90:1:100:3:20:30:0/@fixed>',
    '<&IMGCOUNTDOWN:90:1:200:-2:20:60:1/@compact>',
    '<&IMGCOUNTDOWN:90:1:300:0:20:90:2/@seconds>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const controls = model.pages[0].elements.filter(
    element => element.statementId === 'image-countdown'
  );
  assert.deepEqual(controls.map(element => ({
    format: element.countdownPreview?.format,
    mode: element.imageTextPreview?.mode,
    value: element.imageTextPreview?.value,
    gap: element.imageTextPreview?.gap,
  })), [
    { format: 'legacy-fixed', mode: 'individual', value: '00:01:30', gap: 3 },
    { format: 'legacy-compact', mode: 'individual', value: '01:30', gap: -2 },
    { format: 'seconds', mode: 'individual', value: '90', gap: 0 },
  ]);
  assert.deepEqual(
    controls[0].imageTextPreview.glyphs.map(glyph => ({
      character: glyph.character,
      assetRef: glyph.assetRef,
    })),
    [
      ['0', 100], ['0', 100], [':', 110], ['0', 100],
      ['1', 101], [':', 110], ['3', 103], ['0', 100],
    ].map(([character, imageIndex]) => ({
      character,
      assetRef: { archiveName: 'NewopUI', imageIndex },
    })),
    'IMGCOUNTDOWN must map digits and colon to start+digit/start+10'
  );
  assert.equal(controls[0].text, '00:01:30');
  controls[0].asset = {
    status: 'ready', url: 'data:image/png;base64,start', width: 16, height: 20,
  };
  for (const [index, glyph] of controls[0].imageTextPreview.glyphs.entries()) {
    glyph.asset = {
      status: 'ready', url: `data:image/png;base64,glyph-${index}`, width: 16, height: 20,
    };
  }
  reflowNpcDialogLayout(model);
  assert.deepEqual(
    { width: controls[0].width, height: controls[0].height },
    { width: 149, height: 20 },
    'IMGCOUNTDOWN intrinsic width must include every glyph and seven 3px gaps'
  );
}

function testImageNumberUsesEngineSpecificDigitAssets() {
  const gom = parse([
    '[@main]',
    '#SAY',
    '<&IMGNUM:3170:1234:-3:10:20:1,2>',
    '<&IMGNUM:3170:-123:0:10:50:*>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const gomNumbers = gom.pages[0].elements.filter(
    element => element.statementId === 'image-number'
  );
  assert.equal(gomNumbers.length, 2);
  assert.deepEqual({
    kind: gomNumbers[0].kind,
    mode: gomNumbers[0].imageTextPreview?.mode,
    value: gomNumbers[0].imageTextPreview?.value,
    gap: gomNumbers[0].imageTextPreview?.gap,
    submitInputIds: gomNumbers[0].parameters.find(parameter => parameter.index === 6)?.value,
  }, {
    kind: 'image',
    mode: 'individual',
    value: '1234',
    gap: -3,
    submitInputIds: '1,2',
  });
  assert.deepEqual(
    gomNumbers[0].imageTextPreview.glyphs.map(glyph => glyph.assetRef?.imageIndex),
    [3171, 3172, 3173, 3174],
    'GOM IMGNUM must map each digit to start+digit'
  );

  assert.equal(gomNumbers[1].imageTextPreview.value, '-123');
  assert.deepEqual(
    gomNumbers[1].imageTextPreview.glyphs.map(glyph => ({
      character: glyph.character,
      imageIndex: glyph.assetRef?.imageIndex,
    })),
    [
      { character: '-', imageIndex: undefined },
      { character: '1', imageIndex: 3171 },
      { character: '2', imageIndex: 3172 },
      { character: '3', imageIndex: 3173 },
    ],
    'unsupported minus signs must remain explicit placeholders rather than inventing an image index'
  );
  assert.match(gomNumbers[1].warning, /不支持负数/);

  const gee = parse([
    '[@main]',
    '#SAY',
    '<&IMGNUM:2:1234:1:10:20:*>',
  ].join('\n'), 'GEE', workspaceNpcDialogOffsets(0, 0));
  const geeNumber = gee.pages[0].elements.find(
    element => element.statementId === 'image-number'
  );
  assert.deepEqual({
    mode: geeNumber.imageTextPreview?.mode,
    value: geeNumber.imageTextPreview?.value,
    gap: geeNumber.imageTextPreview?.gap,
    glyphIndexes: geeNumber.imageTextPreview?.glyphs.map(glyph => glyph.assetRef?.imageIndex),
    submitInputIds: geeNumber.parameters.find(parameter => parameter.index === 6)?.value,
  }, {
    mode: 'individual',
    value: '1234',
    gap: 1,
    glyphIndexes: [1251, 1252, 1253, 1254],
    submitInputIds: '*',
  }, 'GEE IMGNUM type 2 must use NewopUI 1250-1259');
}

function testTextAtlasSlicesHorizontalDigitSheet() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<TextAtlas|x=151|y=79|wil=NewopUI|pcimg=2522|iwidth=14|iheight=24|text=0123>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const atlas = model.pages[0].elements.find(
    element => element.statementId === 'newui-textatlas-996pc'
  );
  assert.deepEqual({
    kind: atlas.kind,
    mode: atlas.imageTextPreview?.mode,
    value: atlas.imageTextPreview?.value,
    gap: atlas.imageTextPreview?.gap,
    glyphWidth: atlas.imageTextPreview?.glyphWidth,
    glyphHeight: atlas.imageTextPreview?.glyphHeight,
    width: atlas.width,
    height: atlas.height,
  }, {
    kind: 'image',
    mode: 'atlas',
    value: '0123',
    gap: 0,
    glyphWidth: 14,
    glyphHeight: 24,
    width: 56,
    height: 24,
  });
  assert.deepEqual(
    atlas.imageTextPreview.glyphs.map(glyph => ({
      character: glyph.character,
      sourceX: glyph.sourceX,
      assetRef: glyph.assetRef,
    })),
    [0, 1, 2, 3].map(digit => ({
      character: String(digit),
      sourceX: digit * 14,
      assetRef: { archiveName: 'NewopUI', imageIndex: 2522 },
    })),
    'TextAtlas must reuse one 0-9 sheet and crop each digit at digit*iwidth'
  );
  assert.equal(atlas.text, '0123');
}

function test996RTextBuildsInlineColorRuns() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<RText|x=140|y=75|color=70|size=20|text=默认<我是/FCOLOR=250><富文本/FCOLOR=251><996/FCOLOR=253>>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const richText = model.pages[0].elements.find(
    element => element.statementId === 'newui-rtext-996pc'
  );
  assert.deepEqual(richText.textPreview, {
    lines: [[
      { text: '默认', color: '#ff7700' },
      { text: '我是', color: '#00ff00' },
      { text: '富文本', color: '#ffff00' },
      { text: '996', color: '#ff00ff' },
    ]],
    fontSize: 20,
    color: '#ff7700',
    align: 'left',
  }, 'RText inline FCOLOR runs must override only their own text');
  assert.equal(richText.text, '默认我是富文本996');
  assert.doesNotMatch(richText.text, /FCOLOR|[<>]/);
}

function test996RTextKeepsUnavailableCustomColorsAsUnstyledRuns() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<RText|x=140|y=75|color=70|size=20|text=普通<自定义/FCOLOR=1005>>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const richText = model.pages[0].elements.find(
    element => element.statementId === 'newui-rtext-996pc'
  );
  assert.deepEqual(richText.textPreview.lines, [[
    { text: '普通', color: '#ff7700' },
    { text: '自定义' },
  ]], 'an unavailable custom color must remain a recognized, unstyled rich-text run');
  assert.equal(richText.text, '普通自定义');
  assert.doesNotMatch(richText.text, /FCOLOR|[<>]/,
    'unavailable custom-color markup must never leak into visible text');
  assert.match(richText.warning, /1005.*(?:cfg_colour_style|自定义颜色表)|(?:cfg_colour_style|自定义颜色表).*1005/);
  assert.equal(richText.textPreview.dynamicFields, undefined,
    'an unavailable static custom color is not a runtime text expression');
}

function test996TextBuildsDocumentedStaticStyle() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<Text|x=140|y=75|text=核心文字|color=250|size=18|outline=2|outlinecolor=249>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const text = model.pages[0].elements.find(
    element => element.statementId === 'newui-text-996pc'
  );
  assert.deepEqual(text.textPreview, {
    lines: [[{ text: '核心文字' }]],
    fontSize: 18,
    color: '#00ff00',
    outlineWidth: 2,
    outlineColor: '#ff0000',
    align: 'left',
  }, '996PC Text must preserve its documented size, color, and outline fields');
  assert.equal(text.text, '核心文字');

  const documentedFeatures = parse([
    '[@main]',
    '#SAY',
    '<Text|id=SCROLLX|x=140|y=105|text=120000|simplenum=1|color=250,251,249|size=18|outline=2|outlinecolor=249|scrollWidth=120|scrollHeight=24|scrollWay=0|scrollTime=2>',
    '<Text|id=SCROLLY|x=140|y=135|text=纵向滚动|color=255|scrollWidth=90|scrollHeight=40|scrollWay=1|scrollTime=3>',
    '<Text|id=BILLION|x=140|y=185|text=300000000|simplenum=1|color=255>',
    '<Text|id=PLAIN|x=140|y=215|text=120000|simplenum=0|color=255>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const featureTexts = documentedFeatures.pages[0].elements.filter(
    element => element.statementId === 'newui-text-996pc'
  );
  assert.deepEqual(featureTexts[0].textPreview, {
    lines: [[{ text: '12万' }]],
    fontSize: 18,
    color: '#00ff00',
    outlineWidth: 2,
    outlineColor: '#ff0000',
    align: 'left',
    simplifyNumber: true,
    colorValues: ['250', '251', '249'],
    colorFrames: ['#00ff00', '#ffff00', '#ff0000'],
    colorIntervalMs: 1000,
    scrollWidth: 120,
    scrollHeight: 24,
    scrollDirection: 0,
    scrollDurationMs: 2000,
  }, '996PC Text must preserve simplenum, all scrolling fields, and the documented 1s color sequence');
  assert.equal(featureTexts[0].width, 120,
    'scrollWidth must become the visible text viewport when no ordinary width is supplied');
  assert.equal(featureTexts[0].height, 24,
    'scrollHeight must become the visible text viewport when no ordinary height is supplied');
  assert.deepEqual(featureTexts[1].textPreview, {
    lines: [[{ text: '纵向滚动' }]],
    color: '#ffffff',
    align: 'left',
    scrollWidth: 90,
    scrollHeight: 40,
    scrollDirection: 1,
    scrollDurationMs: 3000,
  }, 'scrollWay=1 must retain the documented bottom-to-top viewport model');
  assert.equal(featureTexts[2].textPreview.lines[0][0].text, '3亿',
    'simplenum=1 must use the documented 亿 unit for an exact hundred-million multiple');
  assert.equal(featureTexts[3].textPreview.lines[0][0].text, '120000',
    'simplenum=0 must leave the source number unchanged');

  const dynamic = parse([
    '[@main]',
    '#SAY',
    '<Text|id=DYNAMIC|x=140|y=245|text=动态参数|simplenum=<$STR(S0)>|color=<$STR(S1)>|scrollWidth=<$STR(S2)>|scrollHeight=<$STR(S3)>|scrollWay=<$STR(S4)>|scrollTime=<$STR(S5)>>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0)).pages[0].elements.find(
    element => element.statementId === 'newui-text-996pc'
  );
  for (const field of [
    'simplify-number', 'color', 'scroll-width', 'scroll-height',
    'scroll-direction', 'scroll-duration',
  ]) {
    assert.ok(dynamic.textPreview.dynamicFields?.includes(field),
      `996PC Text dynamic field ${field} must not masquerade as a confirmed static value`);
  }
  assert.match(dynamic.warning, /文字.*动态|动态.*文字/,
    '996PC Text must disclose runtime-only drawing fields');
}

function test996ImgBuildsOpacityAndGrayPreview() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<Img|x=140|y=75|wil=NewopUI|pcimg=108|opacity=128|grey=1>',
    '<Img|x=240|y=75|wil=NewopUI|pcimg=109>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const images = model.pages[0].elements.filter(
    element => element.statementId === 'newui-img-996pc'
  );
  assert.deepEqual(images.map(image => ({
    variant: image.imagePreview?.variant,
    opacity: image.imagePreview?.opacity,
    gray: image.imagePreview?.gray,
  })), [
    { variant: 'newui-img-996pc', opacity: 128, gray: true },
    { variant: 'newui-img-996pc', opacity: 255, gray: false },
  ], '996PC Img must preserve explicit opacity/grey and documented defaults');
}

function test996ImgBuildsStretchGeometry() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<Img|x=140|y=75|width=120|height=60|wil=NewopUI|pcimg=108>',
    '<Img|x=280|y=75|width=180|height=100|wil=NewopUI|pcimg=109|scale9l=10|scale9r=12|scale9t=8|scale9b=9>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const images = model.pages[0].elements.filter(
    element => element.statementId === 'newui-img-996pc'
  );
  assert.deepEqual({
    width: images[0].width,
    height: images[0].height,
    widthMode: images[0].sizePreview.width.mode,
    heightMode: images[0].sizePreview.height.mode,
    preview: {
      variant: images[0].imagePreview?.variant,
      opacity: images[0].imagePreview?.opacity,
      gray: images[0].imagePreview?.gray,
    },
  }, {
    width: 120,
    height: 60,
    widthMode: 'explicit',
    heightMode: 'explicit',
    preview: { variant: 'newui-img-996pc', opacity: 255, gray: false },
  });
  assert.deepEqual({
    variant: images[1].imagePreview?.variant,
    opacity: images[1].imagePreview?.opacity,
    gray: images[1].imagePreview?.gray,
    scale9: images[1].imagePreview?.scale9,
  }, {
    variant: 'newui-img-996pc',
    opacity: 255,
    gray: false,
    scale9: { left: 10, right: 12, top: 8, bottom: 9 },
  }, '996PC Img must preserve every documented nine-slice margin');
}

function test996ImgBuildsBackgroundLayerAndShowPlacement() {
  const model = parse([
    '[@main]',
    '#SAY',
    ...[0, 1, 2, 3, 4].map(show => (
      `<Img|id=BG${show}${show === 4 ? '|children={BGCHILD}' : ''}|x=999|y=999|width=120|height=80|wil=NewopUI|pcimg=${108 + show}|bg=1|show=${show}>`
    )),
    '<Layout|id=BGCHILD|x=20|y=30|width=80|height=20|color=58>',
    '<Img|id=NORMAL|x=60|y=70|width=40|height=30|wil=NewopUI|pcimg=120|bg=0|show=4>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const images = new Map(model.pages[0].elements.map(element => (
    [element.containerElementId, element]
  )));

  for (const show of [0, 1, 2, 3, 4]) {
    const image = images.get(`BG${show}`);
    assert.deepEqual({
      variant: image.imagePreview?.variant,
      opacity: image.imagePreview?.opacity,
      gray: image.imagePreview?.gray,
      background: image.imagePreview?.background,
      showPosition: image.imagePreview?.showPosition,
    }, {
      variant: 'newui-img-996pc',
      opacity: 255,
      gray: false,
      background: true,
      showPosition: show,
    }, `996PC Img show=${show} must preserve documented panel-background placement`);
    assert.equal(image.editable, false,
      'show-positioned background images must not expose ineffective X/Y dragging');
    assert.match(image.warning, /背景.*show.*(?:只读|锁定)|show.*背景.*(?:只读|锁定)/i);
    assert.deepEqual([image.layoutX, image.layoutY], [
      [0, 0],
      [680, 0],
      [0, 520],
      [680, 520],
      [340, 260],
    ][show], `996PC Img show=${show} must use the documented panel position`);
  }
  assert.deepEqual({
    variant: images.get('NORMAL').imagePreview?.variant,
    opacity: images.get('NORMAL').imagePreview?.opacity,
    gray: images.get('NORMAL').imagePreview?.gray,
    showPosition: images.get('NORMAL').imagePreview?.showPosition,
  }, {
    variant: 'newui-img-996pc',
    opacity: 255,
    gray: false,
    showPosition: 4,
  }, 'bg=0 must preserve show metadata without becoming a background layer');
  assert.equal(images.get('NORMAL').editable, true,
    'show must not override an ordinary Img when bg is disabled');
  const centeredBackground = images.get('BG4');
  const backgroundChild = images.get('BGCHILD');
  assert.equal(backgroundChild.parentElementId, centeredBackground.id,
    'the documented children={} relationship must attach controls to a background Img');
  assert.deepEqual({
    rootX: centeredBackground.layoutX,
    rootY: centeredBackground.layoutY,
    childLocalX: backgroundChild.localLayoutX,
    childLocalY: backgroundChild.localLayoutY,
    childX: backgroundChild.layoutX,
    childY: backgroundChild.layoutY,
  }, {
    rootX: 340,
    rootY: 260,
    childLocalX: 20,
    childLocalY: 30,
    childX: 360,
    childY: 290,
  }, 'show=4 must move the complete background subtree into the 800x600 panel centre');
  assert.deepEqual({ width: model.canvasWidth, height: model.canvasHeight }, { width: 800, height: 600 },
    'show-positioned background subtrees must not enlarge the panel from irrelevant root X/Y values');

  const intrinsicModel = parse([
    '[@main]',
    '#SAY',
    '<Img|id=INTRINSICROOT|children={INTRINSICCHILD}|x=999|y=999|wil=NewopUI|pcimg=108|bg=1|show=4>',
    '<Layout|id=INTRINSICCHILD|x=20|y=30|width=80|height=20|color=58>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const intrinsicRoot = intrinsicModel.pages[0].elements.find(
    element => element.containerElementId === 'INTRINSICROOT'
  );
  intrinsicRoot.asset = {
    status: 'ready',
    url: 'file:///panel.png',
    archiveLabel: 'NewopUI.Jpk/000108',
    width: 400,
    height: 300,
    offsetX: 0,
    offsetY: 0,
  };
  reflowNpcDialogLayout(intrinsicModel);
  const intrinsicElements = new Map(intrinsicModel.pages[0].elements.map(element => (
    [element.containerElementId, element]
  )));
  assert.deepEqual({
    width: intrinsicElements.get('INTRINSICROOT').width,
    height: intrinsicElements.get('INTRINSICROOT').height,
    rootX: intrinsicElements.get('INTRINSICROOT').layoutX,
    rootY: intrinsicElements.get('INTRINSICROOT').layoutY,
    childX: intrinsicElements.get('INTRINSICCHILD').layoutX,
    childY: intrinsicElements.get('INTRINSICCHILD').layoutY,
  }, {
    width: 400,
    height: 300,
    rootX: 200,
    rootY: 150,
    childX: 220,
    childY: 180,
  }, 'post-hydration reflow must reposition an intrinsic-size show background and all descendants');

  const extendedAnchorModel = parse([
    '[@main]',
    '#SAY',
    '<Img|id=FIXEDANCHOR|x=0|y=0|width=120|height=80|wil=NewopUI|pcimg=108|bg=1|show=4>',
    '<Text|id=OUTLIER|x=1000|y=700|text=扩展编辑画布|color=250>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const fixedAnchor = extendedAnchorModel.pages[0].elements.find(
    element => element.containerElementId === 'FIXEDANCHOR'
  );
  assert.ok(extendedAnchorModel.canvasWidth > 800 && extendedAnchorModel.canvasHeight > 600,
    'out-of-client elements must remain reachable through an expanded editor canvas');
  assert.deepEqual({
    clientWidth: extendedAnchorModel.clientWidth,
    clientHeight: extendedAnchorModel.clientHeight,
    x: fixedAnchor.layoutX,
    y: fixedAnchor.layoutY,
  }, {
    clientWidth: 800,
    clientHeight: 600,
    x: 340,
    y: 260,
  }, 'expanding the editor canvas must not move a client show=4 anchor away from the 800x600 surface');

  const boundaryModel = parse([
    '[@main]',
    '#SAY',
    '<Img|id=INVALID|x=10|y=20|wil=NewopUI|pcimg=108|bg=1|show=9>',
    '<Img|id=INVALIDBG|x=30|y=40|wil=NewopUI|pcimg=109|bg=2|show=4>',
    '<Img|id=DYNAMICSHOW|x=50|y=60|wil=NewopUI|pcimg=110|bg=1|show=<$STR(S0)>>',
    '<Img|id=DYNAMICBG|x=70|y=80|wil=NewopUI|pcimg=111|bg=<$STR(S1)>|show=4>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const boundaryImages = new Map(boundaryModel.pages[0].elements.map(element => (
    [element.containerElementId, element]
  )));
  const invalidImage = boundaryImages.get('INVALID');
  assert.equal(invalidImage.imagePreview.background, true);
  assert.equal(invalidImage.imagePreview.showPosition, undefined);
  assert.ok(invalidImage.imagePreview.invalidFields?.includes('show-position'),
    'out-of-range show values must be classified as invalid instead of inventing a placement');
  assert.equal(invalidImage.editable, false,
    'an invalid show value on a confirmed background must not expose ineffective X/Y dragging');

  const invalidBackground = boundaryImages.get('INVALIDBG');
  assert.equal(invalidBackground.imagePreview.background, undefined);
  assert.equal(invalidBackground.imagePreview.showPosition, 4);
  assert.ok(invalidBackground.imagePreview.invalidFields?.includes('background'));
  assert.equal(invalidBackground.editable, false,
    'an invalid bg value can change panel placement at runtime and must keep X/Y read-only');

  const dynamicShow = boundaryImages.get('DYNAMICSHOW');
  assert.equal(dynamicShow.imagePreview.background, true);
  assert.equal(dynamicShow.imagePreview.showPosition, undefined,
    'a runtime show expression must not masquerade as the resolver default show=0');
  assert.equal(dynamicShow.imagePreview.dynamic, true);
  assert.ok(dynamicShow.imagePreview.dynamicFields?.includes('show-position'));
  assert.equal(dynamicShow.editable, false);
  assert.match(dynamicShow.warning, /Img.*(?:动态|无效)|(?:动态|无效).*Img/i);

  const dynamicBackground = boundaryImages.get('DYNAMICBG');
  assert.equal(dynamicBackground.imagePreview.background, undefined,
    'a runtime bg expression must not masquerade as a confirmed ordinary image');
  assert.equal(dynamicBackground.imagePreview.showPosition, 4);
  assert.equal(dynamicBackground.imagePreview.dynamic, true);
  assert.ok(dynamicBackground.imagePreview.dynamicFields?.includes('background'));
  assert.equal(dynamicBackground.editable, false);
  assert.match(dynamicBackground.warning, /Img.*(?:动态|无效)|(?:动态|无效).*Img/i);
}

function test996UIModelBuildsStateItemLayers() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<UIModel|x=150|y=110|sex=0|headID=344|capID=1188|clothID=2540|weaponID=2523|shieldID=10005|veilID=20006|scale=1.5|hairID=3|clothEffectID=506#1#0#0|weaponEffectID=505#1#0#0>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const uiModel = model.pages[0].elements.find(
    element => element.statementId === 'newui-uimodel-996pc'
  );
  assert.equal(uiModel.kind, 'monster');
  assert.equal(uiModel.modelPreview?.variant, 'ui-model-996pc');
  assert.equal(uiModel.modelPreview?.sex, 0);
  assert.equal(uiModel.modelPreview?.scale, 1.5);
  assert.deepEqual(
    uiModel.modelPreview?.layers.map(layer => ({
      role: layer.role,
      label: layer.label,
      looks: layer.looks,
      assetRef: layer.assetRef,
    })),
    [
      ['cloth', '衣服', 2540, 'StateItem', 2540],
      ['weapon', '武器', 2523, 'StateItem', 2523],
      ['head', '头盔', 344, 'StateItem', 344],
      ['cap', '斗笠', 1188, 'StateItem', 1188],
      ['shield', '盾牌', 10005, 'StateItem1', 5],
      ['veil', '面巾', 20006, 'StateItem2', 6],
    ].map(([role, label, looks, archiveName, imageIndex]) => ({
      role,
      label,
      looks,
      assetRef: { archiveName, imageIndex },
    })),
    'UIModel must keep model parts separate from database item layers'
  );
  assert.equal(uiModel.assetLayers, undefined,
    'UIModel layers must not use the database-item asset layer path');
  assert.match(uiModel.warning, /裸模.*头发|头发.*裸模/);
  assert.match(uiModel.warning, /特效.*未绘制/);

  const assets = [
    { width: 80, height: 120, offsetX: -40, offsetY: -100 },
    { width: 100, height: 100, offsetX: -60, offsetY: -80 },
    { width: 50, height: 40, offsetX: -25, offsetY: -120 },
    { width: 60, height: 30, offsetX: -30, offsetY: -130 },
    { width: 40, height: 80, offsetX: 30, offsetY: -90 },
    { width: 50, height: 30, offsetX: -25, offsetY: -115 },
  ];
  uiModel.modelPreview.layers.forEach((layer, index) => {
    layer.asset = {
      status: 'ready',
      url: `data:image/png;base64,model-${index}`,
      ...assets[index],
    };
  });
  reflowNpcDialogLayout(model);
  assert.deepEqual(uiModel.modelPreview.bounds, {
    minX: -60,
    minY: -130,
    maxX: 70,
    maxY: 20,
    width: 195,
    height: 225,
  });
  assert.deepEqual(
    { width: uiModel.width, height: uiModel.height },
    { width: 195, height: 225 },
    'UIModel intrinsic size must use the scaled union of all part offsets'
  );
}

function test996UIModelRejectsDynamicAndInvalidVisualInputs() {
  const model = parse([
    '[@main]',
    '#ACT',
    'MOV N$SEX 1',
    'MOV N$SCALE 2',
    'MOV N$CLOTH 2540',
    'MOV N$HAIR 3',
    'MOV S$EFFECT 506#1#0#0',
    '#SAY',
    '<UIModel|id=DYNAMIC|sex=<$STR(N$SEX)>|scale=<$STR(N$SCALE)>|clothID=<$STR(N$CLOTH)>|weaponID=2523.5|headID=-1|capID=1188|hairID=<$STR(N$HAIR)>|notShowMold=<$STR(N$SEX)>|notShowHair=maybe|clothEffectID=<$STR(S$EFFECT)>|weaponEffectID=505#1#0#0>',
    '<UIModel|id=STATIC|sex=0|scale=1.25|clothID=2540|hairID=3|notShowMold=true|notShowHair=false|clothEffectID=506#1#0#0&507#0#2#3>',
    '<UIModel|id=INVALID|sex=2|scale=0|clothID=0|weaponID=abc|hairID=-2|notShowMold=1>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const controls = new Map(model.pages[0].elements.map(element => (
    [element.containerElementId, element]
  )));

  const dynamic = controls.get('DYNAMIC');
  assert.equal(dynamic.modelPreview.sex, undefined,
    'dynamic sex must not borrow the current MOV value');
  assert.equal(dynamic.modelPreview.scale, 1,
    'dynamic scale must use a safe source fallback instead of the current MOV value');
  assert.deepEqual(dynamic.modelPreview.layers.map(layer => layer.role), ['cap'],
    'dynamic/invalid Looks values must not request deterministic StateItem assets');
  assert.equal(dynamic.modelPreview.hairId, undefined);
  assert.equal(dynamic.modelPreview.notShowMold, undefined);
  assert.equal(dynamic.modelPreview.notShowHair, undefined);
  assert.deepEqual(dynamic.modelPreview.dynamicFields, [
    'sex', 'scale', 'cloth-id', 'hair-id', 'not-show-mold', 'cloth-effect',
  ]);
  assert.deepEqual(dynamic.modelPreview.invalidFields, [
    'weapon-id', 'head-id', 'not-show-hair',
  ]);
  assert.deepEqual(dynamic.modelPreview.effectConfigs, {
    cloth: '<$STR(S$EFFECT)>',
    weapon: '505#1#0#0',
  }, 'EffectID source configuration must remain auditable even when it cannot be hydrated');
  assert.match(dynamic.warning, /动态.*不(?:请求|采用|借用)|不(?:请求|采用|借用).*动态/);
  assert.match(dynamic.warning, /无效/);

  const staticModel = controls.get('STATIC').modelPreview;
  assert.equal(staticModel.sex, 0);
  assert.equal(staticModel.scale, 1.25);
  assert.equal(staticModel.hairId, 3);
  assert.equal(staticModel.notShowMold, true);
  assert.equal(staticModel.notShowHair, false);
  assert.deepEqual(staticModel.dynamicFields, undefined);
  assert.deepEqual(staticModel.invalidFields, undefined);
  assert.deepEqual(staticModel.effectConfigs, {
    cloth: '506#1#0#0&507#0#2#3',
  });

  const invalid = controls.get('INVALID').modelPreview;
  assert.equal(invalid.sex, undefined);
  assert.equal(invalid.scale, 1);
  assert.equal(invalid.hairId, undefined);
  assert.equal(invalid.notShowMold, undefined,
    'the documented notShow switch accepts true/false, not a truthy number');
  assert.deepEqual(invalid.layers, []);
  assert.deepEqual(invalid.invalidFields, [
    'sex', 'scale', 'cloth-id', 'weapon-id', 'hair-id', 'not-show-mold',
  ]);
}

function test996UIModelUsesOriginAndAlwaysBuildsVisualBounds() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<UIModel|id=DIRECT|x=720|y=300|clothID=2540|scale=1.5>',
    '<UIModel|id=EXPLICIT|x=100|y=100|width=50|height=60|clothID=2540|scale=1.5>',
    '<UIModel|id=ANCHORED|a=4|percentx=50|percenty=50|clothID=2540|scale=1.5>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const controls = new Map(model.pages[0].elements.map(element => (
    [element.containerElementId, element]
  )));
  for (const id of ['DIRECT', 'EXPLICIT', 'ANCHORED']) {
    controls.get(id).modelPreview.layers[0].asset = {
      status: 'ready',
      url: `data:image/png;base64,${id}`,
      width: 130,
      height: 150,
      offsetX: -60,
      offsetY: -130,
    };
  }

  reflowNpcDialogLayout(model);
  const direct = controls.get('DIRECT');
  const explicit = controls.get('EXPLICIT');
  const anchored = controls.get('ANCHORED');
  const expectedBounds = {
    minX: -60,
    minY: -130,
    maxX: 70,
    maxY: 20,
    width: 195,
    height: 225,
  };
  assert.deepEqual(direct.modelPreview.bounds, expectedBounds);
  assert.deepEqual(explicit.modelPreview.bounds, expectedBounds,
    'explicit width and height must not suppress ready UIModel layers');
  assert.deepEqual(
    { width: explicit.width, height: explicit.height },
    { width: 50, height: 60 },
    'explicit UIModel dimensions remain container metadata while the visual bounds stay available'
  );
  assert.deepEqual(
    { x: direct.layoutX, y: direct.layoutY },
    { x: 720, y: 300 },
    'direct UIModel coordinates represent the unshifted model origin'
  );
  assert.deepEqual(
    { x: anchored.layoutX, y: anchored.layoutY },
    { x: 392.5, y: 382.5 },
    'anchoring must align the visible union box while preserving the model origin'
  );
  assert.equal(model.canvasWidth, 905,
    'canvas bounds must use origin plus the scaled model max offset');
}

function testGomInputMemoSupportsAbsoluteAndRelativeForms() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<&INPUTMEMO:1:10:20:80:40:-1:249:250:0:100:16:1:数据无效>',
    '<INPUTMEMO:2:30:50:100:60:-1:249:250:0:200:18:0:数据无效>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(3, 4));
  assert.deepEqual(model.pages[0].unsupportedStatements, []);
  const memos = model.pages[0].elements.filter(element => (
    /^input-memo/.test(element.statementId)
  ));
  assert.deepEqual(memos.map(element => ({
    statementId: element.statementId,
    coordinateMode: element.coordinateMode,
    sourceX: element.x?.sourceValue,
    sourceY: element.y?.sourceValue,
  })), [
    { statementId: 'input-memo', coordinateMode: 'absolute', sourceX: 10, sourceY: 20 },
    { statementId: 'input-memo-relative-compat', coordinateMode: 'relative', sourceX: 30, sourceY: 50 },
  ]);
}

function testGomInputMemoBuildsStaticMultilinePreview() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<&INPUTMEMO:1:10:20:150:50:-1:249:250:4:50:18:0:提示：这一段文字长度最小值4，最大值50>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const memo = model.pages[0].elements.find(
    element => element.statementId === 'input-memo'
  );
  assert.deepEqual(memo.inputPreview, {
    mode: 'memo',
    inputId: 1,
    textColor: '#00ff00',
    borderColor: '#ff0000',
    transparentBackground: true,
    borderless: false,
    minLength: 4,
    maxLength: 50,
    lineHeight: 18,
    autoWrap: false,
    errorTips: '提示：这一段文字长度最小值4，最大值50',
  });
  assert.equal(memo.inputPreview.placeholder, undefined,
    'INPUTMEMO parameter 13 is an invalid-data message, not placeholder text');
  assert.deepEqual({ width: memo.width, height: memo.height }, { width: 150, height: 50 });
}

function testInputTextBuildsStaticSingleLinePreview() {
  for (const [engine, token] of [
    ['GOM', '<&INPUTTEXT'],
    ['GEE', '<&INPUTTEXT'],
    ['996PC', '<INPUTTEXT'],
  ]) {
    const model = parse([
      '[@main]',
      '#SAY',
      `${token}:1:10:20:80:15:-1:249:250:2:12:错误提示:请输入名字:251>`,
    ].join('\n'), engine, workspaceNpcDialogOffsets(0, 0));
    const input = model.pages[0].elements.find(
      element => element.statementId === 'input-text'
    );
    assert.deepEqual(input.inputPreview, {
      mode: 'text',
      inputId: 1,
      placeholder: '请输入名字',
      placeholderColor: '#ffff00',
      textColor: '#00ff00',
      borderColor: '#ff0000',
      transparentBackground: true,
      borderless: false,
      minLength: 2,
      maxLength: 12,
      errorTips: '错误提示',
    }, `${engine} INPUTTEXT must preserve its documented visual and validation fields`);
    assert.deepEqual({ width: input.width, height: input.height }, { width: 80, height: 15 });
  }
}

function testInputNumberBuildsStaticNumericPreview() {
  for (const [engine, token] of [
    ['GOM', '<&INPUTNUM'],
    ['GEE', '<&INPUTNUM'],
    ['996PC', '<INPUTNUM'],
  ]) {
    const model = parse([
      '[@main]',
      '#SAY',
      `${token}:2:10:40:90:16:-1:249:250:-10:100:请输入-10到100:请输入数字:251>`,
    ].join('\n'), engine, workspaceNpcDialogOffsets(0, 0));
    const input = model.pages[0].elements.find(
      element => element.statementId === 'input-number'
    );
    assert.deepEqual(input.inputPreview, {
      mode: 'number',
      inputId: 2,
      placeholder: '请输入数字',
      placeholderColor: '#ffff00',
      textColor: '#00ff00',
      borderColor: '#ff0000',
      transparentBackground: true,
      borderless: false,
      minValue: -10,
      maxValue: 100,
      errorTips: '请输入-10到100',
    }, `${engine} INPUTNUM must preserve numeric bounds separately from text length`);
    assert.deepEqual({ width: input.width, height: input.height }, { width: 90, height: 16 });
  }
}

function test996NewPanelInputBuildsTypedPreview() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<Input|x=20|y=40|width=145|height=25|size=18|place=请输入|placecolor=251|errortips=输入不对|mincount=3|color=250|maxcount=15|inputid=1|type=0|onlyCh=1|bgtype=1>',
    '<Input|x=20|y=80|width=100|height=20|inputid=2|type=1>',
    '<Input|x=20|y=110|width=100|height=20|inputid=3|type=2>',
    '<Input|x=20|y=140|width=100|height=20|inputid=4|type=3>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const inputs = model.pages[0].elements.filter(
    element => element.statementId === 'newui-input-996pc'
  );
  assert.deepEqual(inputs.map(element => element.inputPreview?.mode), [
    'text', 'number', 'password', 'absolute-number',
  ]);
  assert.deepEqual(inputs.map(element => element.inputPreview?.showBackground), [
    true, false, false, false,
  ], '996PC Input must treat omitted bgtype as the documented no-frame default');
  assert.deepEqual(inputs[0].inputPreview, {
    mode: 'text',
    inputId: 1,
    placeholder: '请输入',
    placeholderColor: '#ffff00',
    textColor: '#00ff00',
    fontSize: 18,
    minLength: 3,
    maxLength: 15,
    onlyChinese: true,
    showBackground: true,
    errorTips: '输入不对',
  }, '996PC Input must preserve all documented visual and validation fields');
  assert.deepEqual(
    inputs.map(element => ({ width: element.width, height: element.height })),
    [
      { width: 145, height: 25 },
      { width: 100, height: 20 },
      { width: 100, height: 20 },
      { width: 100, height: 20 },
    ]
  );
  assert.match(inputs[0].warning, /背景框.*近似|近似.*背景框/,
    'bgtype=1 must not be presented as a proven client frame asset');
}

function testGomMonsterUsesVerifiedRepresentativeFrame() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<MONSTER:1120:81:3:7:100:200>',
    '<MONSTER:0:156:0:4:260:200>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const monsters = model.pages[0].elements.filter(
    element => element.statementId === 'monster-preview'
  );
  assert.equal(monsters.length, 2);
  assert.deepEqual(monsters[0].assetRef, {
    archiveName: 'Mon113',
    imageIndex: 40,
  }, 'GOM MONSTER must reuse the verified Appr representative-frame mapping');
  assert.deepEqual(monsters[0].monsterPreview, {
    variant: 'gom',
    status: 'static-representative',
    appr: 1120,
    race: 81,
    action: 3,
    direction: 7,
    message: 'Mon113 / 000040 静态代表帧',
  });
  assert.match(monsters[0].warning, /静态代表帧.*动作.*方向|动作.*方向.*静态代表帧/,
    'the representative frame must not claim full action/direction fidelity');
  assert.equal(monsters[1].assetRef, undefined,
    'Race=156 must not invent a Mon archive from its unrelated Appr value');
  assert.equal(monsters[1].monsterPreview.status, 'smart-monster-unresolved');
  assert.match(monsters[1].monsterPreview.message, /SmartMonster.*怪物名/);
  assert.match(monsters[1].warning, /标签不含怪物名|没有怪物名/,
    'Race=156 must explain why its SmartMonster config cannot be resolved');
}

function testGeeMonsterUsesVerifiedRepresentativeFrame() {
  const model = parse([
    '[@main]',
    '#SAY',
    '<MONSTER:11:160:11:1:100:200>',
    '<MONSTER:156:0:1:4:260:200>',
  ].join('\n'), 'GEE', workspaceNpcDialogOffsets(0, 0));
  const monsters = model.pages[0].elements.filter(
    element => element.statementId === 'monster-preview'
  );
  assert.equal(monsters.length, 2);
  assert.deepEqual(monsters[0].assetRef, {
    archiveName: 'Mon17',
    imageIndex: 40,
  }, 'GEE/LFM MONSTER must map its second Appr parameter, not RaceImg, to the representative frame');
  assert.deepEqual(monsters[0].monsterPreview, {
    variant: 'gee',
    status: 'static-representative',
    raceImg: 11,
    appr: 160,
    displayMode: 11,
    direction: 1,
    message: 'Mon17 / 000040 静态代表帧',
  });
  assert.match(monsters[0].warning, /静态代表帧.*显示方式.*方向|显示方式.*方向.*静态代表帧/,
    'the representative frame must not claim GEE/LFM F/Dir fidelity');
  assert.equal(monsters[1].assetRef, undefined,
    'RaceImg=156 must not invent a Mon archive without the SmartMonster name');
  assert.equal(monsters[1].monsterPreview.status, 'smart-monster-unresolved');
  assert.match(monsters[1].monsterPreview.message, /SmartMonster.*怪物名/);
  assert.match(monsters[1].warning, /标签不含怪物名|没有怪物名/,
    'GEE/LFM RaceImg=156 must explain why its named SmartMonster config cannot be resolved');
}

function testImageBackedTextControlsUseAssetRenderer() {
  const gom = parse([
    '[@main]',
    '#SAY',
    '<&IMGCOUNTDOWN:30:1:100:10:20:30:0/@done>',
  ].join('\n'), 'GOM', workspaceNpcDialogOffsets(0, 0));
  const imageCountdown = gom.pages[0].elements.find(
    element => element.statementId === 'image-countdown'
  );
  assert.equal(imageCountdown.kind, 'image',
    'IMGCOUNTDOWN must reach the asset renderer instead of leaking its raw markup as text');
  assert.deepEqual(imageCountdown.assetRef, { archiveName: 'NewopUI', imageIndex: 100 });

  const pc = parse([
    '[@main]',
    '#SAY',
    '<TextAtlas|x=151|y=79|wil=NewopUI|pcimg=2522|iheight=24|iwidth=14|text=0123>',
  ].join('\n'), '996PC', workspaceNpcDialogOffsets(0, 0));
  const atlas = pc.pages[0].elements.find(
    element => element.statementId === 'newui-textatlas-996pc'
  );
  assert.equal(atlas.kind, 'image',
    'TextAtlas must reach the image renderer instead of displaying plain fallback text');
  assert.deepEqual(atlas.assetRef, { archiveName: 'NewopUI', imageIndex: 2522 });
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
  assert.doesNotMatch(webviewScript, /conditionChanged/,
    'condition previews must use the dedicated scene controls, not the retired conditionChanged path');
  assert.match(webviewScript, /setAttribute\('role', 'checkbox'\)/,
    'the 996PC CheckBox renderer must remain isolated from condition preview controls');
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
  testGomAddDlgBuildsIndependentStaticWindowPages();
  testLegacyCoordinateBiasByControlType();
  testLegacyCoordinateBiasAcrossEngineSyntaxBoundaries();
  testEquivalentConditionsShareSingleSwitch();
  testTextContentExtraction();
  testOfficialMultilineMTextDrawsAsOneStyledControl();
  test996LayoutDrawsDocumentedFillColor();
  testTooltipRemarksAcrossEngines();
  test996KeyValueAndGotoScene();
  testSayLinkTraversalAndOrConditions();
  testConditionalSceneInheritsDefaultOutput();
  testScenePreviewPathsPreserveOtherSimulationState();
  testGotoVariableExpansionAndConditionOverride();
  testInlineVariablePreviewKeepsLiteralCoordinatesEditable();
  testDynamicControlSizeDoesNotBorrowResolvedVariableValue();
  testStaticConfigTableListAndFormulaValues();
  testItemFramesAndLayeredControls();
  testExtendedItemControlVisualParameters();
  testItemControlDynamicAndInvalidBoundaries();
  testLegacyProgressBarBuildsDocumentedPreview();
  test996ItemListsAndLoadingBar();
  test996ItemGridUsesDocumentedCellGeometry();
  test996ItemGridBuildsTypedConfigurationAndSafeCounts();
  test996LoadingBarBuildsDocumentedRuntimeAndCaptionModel();
  test996CostItemBuildsDedicatedPreview();
  testAnimationsAndInteractiveButtonStates();
  testTraditionalFlowAndUnknownPreservation();
  testTraditionalFlowFColorBuildsIndependentRuns();
  testTraditionalAutoColorBuildsAnimatedRuns();
  testTraditionalTextBuildsDocumentedFontSimpleNumberAndCenterPreview();
  testOfficialLegendPaletteAcrossDialogControls();
  testNestedContainersAndCoordinateRoundTrip();
  testListViewStaticLayoutAndContainerNewLine();
  testListViewNormalScrollbarAssets();
  testListViewScrollbarInteractionAssets();
  testOfficialAbsoluteContainerAliasesAreRecognized();
  testSourcePatchConflictGuards();
  test996DecimalAndAnchoredPercentageLayout();
  test996PercentageSizeKeepsDirectPositionEditable();
  test996IntrinsicAssetSizeReflowsAnchoredLayoutIdempotently();
  test996CheckBoxInitialStatePreview();
  test996MenuItemStaticPreviewModel();
  testCountdownInitialTextAcrossEngines();
  testImageCountdownBuildsPerCharacterGlyphs();
  testImageNumberUsesEngineSpecificDigitAssets();
  testTextAtlasSlicesHorizontalDigitSheet();
  test996RTextBuildsInlineColorRuns();
  test996RTextKeepsUnavailableCustomColorsAsUnstyledRuns();
  test996TextBuildsDocumentedStaticStyle();
  test996ImgBuildsOpacityAndGrayPreview();
  test996ImgBuildsStretchGeometry();
  test996ImgBuildsBackgroundLayerAndShowPlacement();
  test996UIModelBuildsStateItemLayers();
  test996UIModelRejectsDynamicAndInvalidVisualInputs();
  test996UIModelUsesOriginAndAlwaysBuildsVisualBounds();
  testGomInputMemoSupportsAbsoluteAndRelativeForms();
  testGomInputMemoBuildsStaticMultilinePreview();
  testInputTextBuildsStaticSingleLinePreview();
  testInputNumberBuildsStaticNumericPreview();
  test996NewPanelInputBuildsTypedPreview();
  testGomMonsterUsesVerifiedRepresentativeFrame();
  testGeeMonsterUsesVerifiedRepresentativeFrame();
  testImageBackedTextControlsUseAssetRenderer();
  testEveryCatalogStatementBuildsADomModel();
  await testWorkspaceDatabaseFieldResolver();
  testManifestAndEditorIsolation();
  console.log('npc-dialog-visual.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
