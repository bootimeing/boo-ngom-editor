const assert = require('node:assert/strict');
const path = require('node:path');

const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const runtimeRequire = file => require(path.join(runtimeRoot, file));
const { parseNpcDialogDocument } = runtimeRequire('out/ui-dialog/source-parser');
const { parseNpcDialogScriptProgram } = runtimeRequire('out/ui-dialog/preview-script-model');
const { buildDialogStatementCatalog } = runtimeRequire('out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = runtimeRequire('out/ui-dialog/offsets');
const language = runtimeRequire('data/static-language.json');

const businessOnlySource = [
  '[@main]',
  '#SAY',
  '<TEXT:完成这个任务后获得属性:20:20>',
  '<领取/@属性重载>',
  '[@属性重载]',
  '#IF',
  'LARGE U201 0',
  '#ACT',
  'MOV U202 1',
  'INC N$攻击 2',
  'MOV S$内部 仅业务',
  'GOTO @业务二层',
  '[@业务二层]',
  '#IF',
  'CHECK [301] 1',
  '#ACT',
  'INC U202 1',
  'SENDMSG 6 <$STR(S$内部)>',
].join('\n');

const interactiveSource = [
  '[@main]',
  '#ACT',
  'GOTO @prepare',
  '#SAY',
  '<TEXT:随机结果=<$STR(U203)>:20:20>',
  '<TEXT:完成这个任务后获得属性:20:50>',
  '<领取/@属性重载>',
  '[@prepare]',
  '#ACT',
  'MOVR U203 100',
  '[@属性重载]',
  '#IF',
  'LARGE U201 0',
  '#ACT',
  'MOV U202 1',
  'INC N$攻击 2',
  'MOV S$内部 仅业务',
  'GOTO @业务二层',
  '[@业务二层]',
  '#IF',
  'CHECK [301] 1',
  '#ACT',
  'INC U202 1',
  'SENDMSG 6 <$STR(S$内部)>',
].join('\n');

function parse(text, previewValues = {}, engine = 'GOM', dataOptions) {
  return parseNpcDialogDocument(text, {
    uri: 'file:///D:/preview-input-surface-scope.txt',
    fileName: 'preview-input-surface-scope.txt',
    filePath: 'D:/preview-input-surface-scope.txt',
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: 2,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(language, engine),
    previewValues,
    dataOptions,
  });
}

function parseExternalCall(command, externalText, previewValues = {}, visibleLine) {
  const primaryText = [
    '[@main]', '#ACT', `#${command} [\\property.txt] @reload`, '#SAY',
    visibleLine || '<TEXT:完成这个任务后获得属性:20:20>',
  ].join('\n');
  const primary = { uri: 'file:///D:/program/main.txt', filePath: 'D:/program/main.txt',
    fileName: 'main.txt', documentVersion: 1, text: primaryText };
  const external = { uri: 'file:///D:/program/Envir/QuestDiary/property.txt',
    filePath: 'D:/program/Envir/QuestDiary/property.txt', fileName: 'property.txt',
    documentVersion: 0, text: externalText };
  return parseNpcDialogScriptProgram(primary, {
    ...primary, engine: 'GOM', engineLabel: 'GOM', cursorOffset: 2,
    offsets: workspaceNpcDialogOffsets(0, 0), catalog: buildDialogStatementCatalog(language, 'GOM'),
    previewValues, previewPath: [],
  }, { status: 'missing', candidateFilePaths: [] }, () => ({
    status: 'found', source: external, candidateFilePaths: [external.filePath],
  }));
}

const inputNames = model => (model.previewInputs || []).map(input => input.name).sort();
const visibleText = model => model.pages
  .flatMap(page => page.elements)
  .map(element => element.text)
  .join('\n');

function actUiField(card, name) {
  const field = (card?.fields || []).find(candidate => candidate.name === name);
  assert.ok(field, `${card?.command || 'ACT UI card'} must expose ${name}`);
  return field;
}

function addButtons(model) {
  const seen = new Set();
  return (model.scenes || [])
    .flatMap(scene => scene.elements || [])
    .filter(candidate => {
      if (!candidate.addButtonPreview || seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    });
}

function addButton(model, triggerId) {
  const element = addButtons(model).find(candidate => (
    candidate.addButtonPreview.triggerId === triggerId
  ));
  assert.ok(element, `ADDBUTTON ${triggerId} must remain on the visible preview surface`);
  return element;
}

function flattened(preview) {
  return (preview?.lines || [])
    .map(line => (line || []).map(run => String(run.text || '')).join(''))
    .join('\n');
}

function testSameFileBareBusinessBodyStaysOffCanvas() {
  const sameFile = parse([
    '[@main]', '#SAY', '<领取/@业务>',
    '[@业务]',
    'SENDMSG 6 <$STR(S$内部)>',
    'MOV U250 1',
    'INC N$攻击 2',
  ].join('\n'));
  assert.deepEqual(
    sameFile.pages.map(page => page.sourceLabel),
    ['@main'],
    'a dormant same-file /@ handler without #SAY must not turn bare business commands into a page',
  );
  assert.deepEqual(
    inputNames(sameFile),
    [],
    'variables used only by bare business commands in a dormant same-file handler must stay evaluator-private',
  );
  assert.equal(visibleText(sameFile), '领取');
}

function testExternalBareBusinessBodyStaysOffCanvas(command) {
  const externalBusiness = [
    '[@reload]', '{',
    'SENDMSG 6 <$STR(S$外部内部)>',
    'MOV U251 1',
    'INC N$外部攻击 2',
    '}',
  ].join('\n');
  const model = parseExternalCall(command, externalBusiness);
  assert.deepEqual(
    model.pages.map(page => page.sourceLabel),
    ['@main'],
    `${command} body without #SAY must not turn bare business commands into a page`,
  );
  assert.deepEqual(
    inputNames(model),
    [],
    `${command} variables used only by bare business commands must stay evaluator-private`,
  );
  assert.equal(visibleText(model), '完成这个任务后获得属性');
}

function testDormantHandlerCannotPublishReturnCondition() {
  const model = parse([
    '[@main]', '#SAY',
    '<TEXT:主界面:20:20>',
    '<领取/@业务>',
    '[@业务]', '#IF', 'EQUAL U230 1', '#ACT', 'GOTO @main',
  ].join('\n'));
  assert.deepEqual(
    inputNames(model),
    [],
    'a condition inside an unclicked /@ handler must not publish its variable merely because it can GOTO a visible page',
  );
  assert.deepEqual(
    model.conditionGroups,
    [],
    'a condition inside an unclicked /@ handler must not become a main-page condition control',
  );
  assert.deepEqual(model.pages.map(page => page.sourceLabel), ['@main']);
}

function testCommentedAndBusinessTextReferencesStayDormant() {
  const model = parse([
    '[@main]', '#SAY', '<TEXT:主界面:20:20>',
    '; GOTO @panel',
    '// <隐藏链接/@panel>',
    '#ACT',
    'SENDMSG 6 "GOTO @panel /@panel"',
    '[@panel]', '#SAY', '<TEXT:隐藏=<$STR(U231)>:20:20>',
  ].join('\n'));
  assert.deepEqual(model.pages.map(page => page.sourceLabel), ['@main'],
    'comments and business-message text must not create a reachable UI page');
  assert.deepEqual(inputNames(model), [],
    'variables from a label referenced only by comments or business text must stay private');
}

function testExecutedHelperActCardRemainsVisible() {
  const source = [
    '[@main]', '#ACT', 'GOTO @helper', '#SAY', '<TEXT:主界面:20:20>',
    '[@helper]', '#ACT', 'MESSAGEBOX 提示：<$STR(S$VISIBLE)> @确定 @取消',
  ].join('\n');
  const model = parse(source);
  assert.deepEqual(
    inputNames(model),
    ['S$VISIBLE'],
    'a root-executed helper ACT card must keep the text input that changes its visible message',
  );
  assert.equal(model.actUiPreviews.length, 1,
    'a root-executed helper MESSAGEBOX must remain in the published read-only ACT card panel');
  assert.equal(model.actUiPreviews[0].sourceLabel, '@helper');
  assert.equal(
    actUiField(model.actUiPreviews[0], 'message').displayValueSource?.value,
    '提示：预览文字',
  );

  const edited = parse(source, { 'S$VISIBLE': '属性已重载' });
  assert.equal(
    actUiField(edited.actUiPreviews[0], 'message').displayValueSource?.value,
    '提示：属性已重载',
    'the retained helper-card input must update the visible card text',
  );
}

function testProgressPublishesOnlyVisibleTextInput() {
  const source = [
    '[@main]', '#ACT',
    'SHOWPROGRESSBARDLG <$STR(N$DURATION)> @完成 处理中：<$STR(S$MESSAGE)> 1 @中断',
    '#SAY', '<TEXT:主界面:20:20>',
  ].join('\n');
  const model = parse(source);
  assert.deepEqual(
    inputNames(model),
    ['S$MESSAGE'],
    'a dynamic progress duration must stay runtime-only while its visible dynamic message remains editable',
  );
  assert.equal(model.actUiPreviews.length, 1);
  assert.equal(
    actUiField(model.actUiPreviews[0], 'message').displayValueSource?.value,
    '处理中：预览文字',
  );
  assert.equal(
    actUiField(model.actUiPreviews[0], 'duration-seconds').displayValueSource,
    undefined,
    'the local text placeholder/input channel must not manufacture a timer duration',
  );

  const edited = parse(source, { 'S$MESSAGE': '正在写入属性' });
  assert.equal(
    actUiField(edited.actUiPreviews[0], 'message').displayValueSource?.value,
    '处理中：正在写入属性',
  );
}

function testActElseActPublishesOnlyCurrentCardBranch() {
  const source = [
    '[@main]', '#IF', 'EQUAL U240 1',
    '#ACT', 'MESSAGEBOX 开启分支 @确定 @取消',
    '#ELSEACT', 'MESSAGEBOX 关闭分支 @确定 @取消',
    '#SAY', '<TEXT:主界面:20:20>',
  ].join('\n');
  const messages = model => (model.actUiPreviews || []).map(card => (
    actUiField(card, 'message').displayValueSource?.value
      ?? actUiField(card, 'message').value
  ));

  const disabled = parse(source);
  assert.deepEqual(inputNames(disabled), ['U240']);
  assert.deepEqual(
    messages(disabled),
    ['关闭分支'],
    'when the condition is false, only the #ELSEACT card is visible',
  );

  const enabled = parse(source, { U240: '1' });
  assert.deepEqual(inputNames(enabled), ['U240']);
  assert.deepEqual(
    messages(enabled),
    ['开启分支'],
    'when the condition is true, only the #ACT card is visible',
  );
}

function testAddButtonDirectTitleAndTooltipInputs() {
  const source = [
    '[@main]', '#ACT',
    String.raw`ADDBUTTON 3 31 283 284 285 20 90 0|1 <$STR(S$ADD_TITLE)> 253/<$STR(S$ADD_TIP)>`,
    '#SAY', '<TEXT:主界面:20:20>',
  ].join('\n');
  const model = parse(source);
  assert.deepEqual(
    inputNames(model),
    ['S$ADD_TIP', 'S$ADD_TITLE'],
    'direct dynamic ADDBUTTON title and tooltip text must remain actionable preview inputs',
  );
  const initial = addButton(model, 31);
  assert.equal(flattened(initial.textPreview), '预览文字');
  assert.equal(flattened(initial.tooltipPreview), '预览文字');

  const edited = addButton(parse(source, {
    'S$ADD_TITLE': '领取奖励',
    'S$ADD_TIP': '点击后重载属性',
  }), 31);
  assert.equal(flattened(edited.textPreview), '领取奖励');
  assert.equal(flattened(edited.tooltipPreview), '点击后重载属性');
}

function testAddButtonDerivedTextPublishesOnlyUpstreamInputs() {
  const source = [
    '[@main]', '#ACT',
    'MOV S$ADD_TITLE_RESULT <$STR(S$ADD_TITLE_SOURCE)>',
    'MOV S$ADD_TIP_RESULT <$STR(S$ADD_TIP_SOURCE)>',
    String.raw`ADDBUTTON 3 32 283 284 285 20 120 0|1 <$STR(S$ADD_TITLE_RESULT)> 253/<$STR(S$ADD_TIP_RESULT)>`,
    '#SAY', '<TEXT:主界面:20:20>',
  ].join('\n');
  const model = parse(source, {
    'S$ADD_TITLE_SOURCE': '上游标题',
    'S$ADD_TIP_SOURCE': '上游提示',
  });
  assert.deepEqual(
    inputNames(model),
    ['S$ADD_TIP_SOURCE', 'S$ADD_TITLE_SOURCE'],
    'derived ADDBUTTON text must publish its true upstream inputs, not the assigned result variables',
  );
  assert.equal(inputNames(model).includes('S$ADD_TITLE_RESULT'), false);
  assert.equal(inputNames(model).includes('S$ADD_TIP_RESULT'), false);
  const element = addButton(model, 32);
  assert.equal(flattened(element.textPreview), '上游标题');
  assert.equal(flattened(element.tooltipPreview), '上游提示');
}

function testAddButtonStaticAssignmentsDoNotPublishInputs() {
  const source = [
    '[@main]', '#ACT',
    'MOV S$ADD_TITLE_RESULT 固定标题',
    'MOV S$ADD_TIP_RESULT 固定提示',
    String.raw`ADDBUTTON 3 33 283 284 285 20 150 0|1 <$STR(S$ADD_TITLE_RESULT)> 253/<$STR(S$ADD_TIP_RESULT)>`,
    '#SAY', '<TEXT:主界面:20:20>',
  ].join('\n');
  const model = parse(source);
  assert.deepEqual(
    inputNames(model),
    [],
    'statically assigned ADDBUTTON title and tooltip values must render directly without useless inputs',
  );
  const element = addButton(model, 33);
  assert.equal(flattened(element.textPreview), '固定标题');
  assert.equal(flattened(element.tooltipPreview), '固定提示');
}

function testAddButtonRuntimeUnknownTitleKeepsTargetFallback() {
  const source = [
    '[@main]', '#ACT',
    'MOVR U304 100',
    String.raw`ADDBUTTON 3 34 283 284 285 20 180 0|1 编号<$STR(U304)> 253/随机结果`,
    '#SAY', '<TEXT:主界面:20:20>',
  ].join('\n');
  const model = parse(source);
  assert.deepEqual(
    inputNames(model),
    ['U304'],
    'a runtime-unknown writer feeding an ADDBUTTON title must retain its target as one local fallback input',
  );
  assert.equal(flattened(addButton(model, 34).textPreview), '编号0');
  assert.equal(
    flattened(addButton(parse(source, { U304: '42' }), 34).textPreview),
    '编号42',
    'the retained runtime fallback must update the visible ADDBUTTON title',
  );
}

function testFalseCheckKeepsMessageBoxControlInput() {
  const source = [
    '[@main]', '#SAY', '<TEXT:主界面:20:20>',
    '#IF', 'CHECK [101] 1', '#ACT',
    'MESSAGEBOX 条件已开 @确定 @取消',
  ].join('\n');

  const disabled = parse(source);
  assert.deepEqual(
    inputNames(disabled),
    ['[101]'],
    'a false current-label CHECK must retain its flag when it controls a potentially visible MESSAGEBOX',
  );
  assert.equal(disabled.actUiPreviews.length, 0,
    'the MESSAGEBOX itself must remain hidden while CHECK [101] is false');
  assert.equal(disabled.conditionGroups.length, 1,
    'the hidden current-label card must keep its actionable condition group');
  assert.equal(disabled.conditionGroups[0].satisfied, false);

  const enabled = parse(source, { '[101]': '1' });
  assert.deepEqual(inputNames(enabled), ['[101]']);
  assert.equal(enabled.conditionGroups.length, 1);
  assert.equal(enabled.conditionGroups[0].satisfied, true);
  assert.equal(enabled.actUiPreviews.length, 1,
    'enabling [101] must make the guarded MESSAGEBOX visible');
  assert.equal(
    actUiField(enabled.actUiPreviews[0], 'message').displayValueSource?.value,
    '条件已开',
  );
}

function testFalseCheckDefersHiddenCardTextInput() {
  const source = [
    '[@main]', '#SAY', '<TEXT:主界面:20:20>',
    '#IF', 'CHECK [102] 1', '#ACT',
    'MESSAGEBOX 条件消息：<$STR(S$MSG)> @确定 @取消',
  ].join('\n');

  const disabled = parse(source, { 'S$MSG': '不应提前出现' });
  assert.deepEqual(
    inputNames(disabled),
    ['[102]'],
    'a hidden card must retain its enable switch without publishing its currently invisible text input',
  );
  assert.equal(disabled.actUiPreviews.length, 0);

  const enabled = parse(source, { '[102]': '1' });
  assert.deepEqual(
    inputNames(enabled),
    ['S$MSG', '[102]'],
    'the card text input must appear only after its controlling branch becomes visible',
  );
  assert.equal(enabled.actUiPreviews.length, 1);
  assert.equal(
    actUiField(enabled.actUiPreviews[0], 'message').displayValueSource?.value,
    '条件消息：预览文字',
  );

  const filled = parse(source, { '[102]': '1', 'S$MSG': '属性已重载' });
  assert.equal(
    actUiField(filled.actUiPreviews[0], 'message').displayValueSource?.value,
    '条件消息：属性已重载',
  );
  assert.deepEqual(
    inputNames(parse(source, { '[102]': '0', 'S$MSG': '属性已重载' })),
    ['[102]'],
    'turning the branch off again must remove the now-invisible text input from the published surface',
  );
}

function testHiddenSayBranchDefersContentInput() {
  const source = [
    '[@main]', '#IF', 'CHECK [103] 1', '#SAY',
    '<TEXT:开启值=<$STR(U9)>:20:20>',
    '#ELSESAY', '<TEXT:关闭:20:20>',
  ].join('\n');

  const disabled = parse(source, { U9: '99' });
  assert.deepEqual(inputNames(disabled), ['[103]'],
    'a hidden #SAY branch must not publish its content input before the branch is enabled');
  assert.equal(visibleText(disabled), '关闭');

  const enabled = parse(source, { '[103]': '1' });
  assert.deepEqual(inputNames(enabled), ['U9', '[103]'],
    'the #SAY content input must appear when that branch becomes active');
  assert.equal(visibleText(enabled), '开启值=0');
  assert.equal(visibleText(parse(source, { '[103]': '1', U9: '99' })), '开启值=99');
}

function testHidden996ClientTextBranchDefersInput() {
  const source = [
    '[@main]', '#IF', 'CHECK [104] 1', '#SAY',
    '<Text|id=1|x=20|y=20|text=$STM(HP)>',
    '#ELSESAY', '<Text|id=2|x=20|y=20|text=关闭>',
  ].join('\n');

  const disabled = parse(source, { 'STM(HP)': '999' }, '996PC');
  assert.deepEqual(inputNames(disabled), ['[104]'],
    'a hidden 996PC $STM surface must not publish its client-text input');
  assert.equal(visibleText(disabled), '关闭');

  const enabled = parse(source, { '[104]': '1' }, '996PC');
  assert.deepEqual(inputNames(enabled), ['STM(HP)', '[104]']);
  assert.equal(visibleText(enabled), '0');
  assert.equal(visibleText(parse(source, { '[104]': '1', 'STM(HP)': '999' }, '996PC')), '999');
}

function testActCardsUnionSourceOrderDependencies() {
  const source = [
    '[@main]', '#ACT',
    'MOV S$R <$STR(S$SRC)>',
    'MESSAGEBOX 第一<$STR(S$R)> @确定 @取消',
    'MOV S$R 固定',
    'MESSAGEBOX 第二<$STR(S$R)> @确定 @取消',
    '#SAY', '<TEXT:主界面:20:20>',
  ].join('\n');

  const initial = parse(source);
  assert.deepEqual(inputNames(initial), ['S$SRC'],
    'all visible ACT-card snapshots must contribute their input dependencies, not only the last value of S$R');
  assert.deepEqual(initial.actUiPreviews.map(card => actUiField(card, 'message').displayValueSource?.value), [
    '第一预览文字', '第二固定',
  ]);
  const supplied = parse(source, { 'S$SRC': '来源值' });
  assert.deepEqual(supplied.actUiPreviews.map(card => actUiField(card, 'message').displayValueSource?.value), [
    '第一来源值', '第二固定',
  ]);
}

function testAddButtonsUnionSourceOrderDependencies() {
  const source = [
    '[@main]', '#ACT',
    'MOV S$R <$STR(S$SRC)>',
    String.raw`ADDBUTTON 3 61 283 284 285 20 260 0|1 <$STR(S$R)> 253/第一提示`,
    'MOV S$R 固定',
    String.raw`ADDBUTTON 3 62 283 284 285 120 260 0|1 <$STR(S$R)> 253/第二提示`,
    '#SAY', '<TEXT:主界面:20:20>',
  ].join('\n');

  const initial = parse(source);
  assert.deepEqual(inputNames(initial), ['S$SRC'],
    'all visible ADDBUTTON snapshots must contribute dependencies before same-name variables are coalesced');
  assert.equal(flattened(addButton(initial, 61).textPreview), '预览文字');
  assert.equal(flattened(addButton(initial, 62).textPreview), '固定');
  const supplied = parse(source, { 'S$SRC': '来源按钮' });
  assert.equal(flattened(addButton(supplied, 61).textPreview), '来源按钮');
  assert.equal(flattened(addButton(supplied, 62).textPreview), '固定');
}

function testDeleteButtonConditionRequiresAButtonSurface() {
  const isolated = parse([
    '[@main]', '#SAY', '<TEXT:主界面:20:20>',
    '#IF', 'CHECK [105] 1', '#ACT', 'DELBUTTON 999',
  ].join('\n'));
  assert.deepEqual(inputNames(isolated), [],
    'an isolated DELBUTTON with no attachable button must not manufacture a preview switch');
  assert.deepEqual(isolated.conditionGroups, []);
  assert.equal(addButtons(isolated).length, 0);

  const attachedSource = [
    '[@main]', '#ACT',
    String.raw`ADDBUTTON 3 63 283 284 285 20 290 0|1 可见按钮 253/提示`,
    '#IF', 'CHECK [106] 1', '#ACT', 'DELBUTTON 63',
    '#SAY', '<TEXT:主界面:20:20>',
  ].join('\n');
  const attached = parse(attachedSource);
  assert.deepEqual(inputNames(attached), ['[106]'],
    'a DELBUTTON condition must remain switchable when it controls a known visible button');
  assert.equal(attached.conditionGroups.length, 1);
  assert.equal(addButton(attached, 63).addButtonPreview.deleteActions.length, 0);
  const enabled = parse(attachedSource, { '[106]': '1' });
  assert.equal(addButton(enabled, 63).addButtonPreview.deleteActions.length, 1);
}

function testFalseCheckKeepsAddButtonControlInput() {
  const source = [
    '[@main]', '#SAY', '<TEXT:主界面:20:20>',
    '#IF', 'CHECK [101] 1', '#ACT',
    String.raw`ADDBUTTON 3 41 283 284 285 20 210 0|1 条件按钮 253/条件已开`,
  ].join('\n');

  const disabled = parse(source);
  assert.deepEqual(
    inputNames(disabled),
    ['[101]'],
    'a false current-label CHECK must retain its flag when it controls a potentially visible ADDBUTTON',
  );
  assert.equal(addButtons(disabled).length, 0,
    'the ADDBUTTON itself must remain hidden while CHECK [101] is false');
  assert.equal(disabled.conditionGroups.length, 1,
    'the hidden current-label button must keep its actionable condition group');
  assert.equal(disabled.conditionGroups[0].satisfied, false);

  const enabled = parse(source, { '[101]': '1' });
  assert.deepEqual(inputNames(enabled), ['[101]']);
  assert.equal(enabled.conditionGroups.length, 1);
  assert.equal(enabled.conditionGroups[0].satisfied, true);
  const element = addButton(enabled, 41);
  assert.equal(flattened(element.textPreview), '条件按钮');
  assert.equal(flattened(element.tooltipPreview), '条件已开');
}

function testFalseWhileKeepsMessageBoxControlInput() {
  const source = [
    '[@main]', '#SAY', '<TEXT:主界面:20:20>', '#ACT',
    'WHILE U1 > 0',
    'MESSAGEBOX 循环卡片 @确定 @取消',
    'DEC U1 1',
    'ENDWHILE',
  ].join('\n');

  const disabled = parse(source);
  assert.deepEqual(
    inputNames(disabled),
    ['U1'],
    'a false current-label WHILE must retain the input that can reveal a visible MESSAGEBOX',
  );
  assert.equal(disabled.actUiPreviews.length, 0,
    'the loop MESSAGEBOX must remain hidden while U1 is zero');

  const enabled = parse(source, { U1: '1' });
  assert.deepEqual(inputNames(enabled), ['U1']);
  assert.equal(enabled.actUiPreviews.length, 1,
    'U1=1 must execute one bounded loop iteration and reveal the MESSAGEBOX');
  assert.equal(
    actUiField(enabled.actUiPreviews[0], 'message').displayValueSource?.value,
    '循环卡片',
  );
}

function testExecutedHelperWhileKeepsMessageBoxControlInput() {
  const source = [
    '[@main]', '#ACT', 'GOTO @helper', '#SAY', '<TEXT:主界面:20:20>',
    '[@helper]', '#ACT', 'WHILE U1 > 0',
    'MESSAGEBOX 辅助循环卡片 @确定 @取消',
    'DEC U1 1', 'ENDWHILE',
  ].join('\n');

  const disabled = parse(source);
  assert.deepEqual(inputNames(disabled), ['U1'],
    'a false WHILE in an actually executed helper must retain its surface control input');
  assert.equal(disabled.actUiPreviews.length, 0);

  const enabled = parse(source, { U1: '1' });
  assert.deepEqual(inputNames(enabled), ['U1']);
  assert.equal(enabled.actUiPreviews.length, 1,
    'the executed helper must reveal its loop card when U1 enables one iteration');
  assert.equal(enabled.actUiPreviews[0].sourceLabel, '@helper');
  assert.equal(enabled.actUiPreviews[0].activeInPreview, true);
}

function testDormantBusinessHandlerConditionsStayPrivate() {
  const source = [
    '[@main]', '#SAY', '<TEXT:主界面:20:20>', '<领取/@business>',
    '[@business]', '#IF', 'CHECK [101] 1', '#ACT',
    'SENDMSG 6 仅业务副作用',
    'WHILE U1 > 0',
    'INC U2 1',
    'DEC U1 1',
    'ENDWHILE',
  ].join('\n');
  const model = parse(source);
  assert.deepEqual(
    inputNames(model),
    [],
    'CHECK and WHILE variables inside an unclicked pure-business /@ handler must stay evaluator-private',
  );
  assert.deepEqual(model.conditionGroups, [],
    'a dormant pure-business handler must not publish condition controls');
  assert.equal(model.actUiPreviews.length, 0);
  assert.equal(addButtons(model).length, 0);
  assert.deepEqual(model.pages.map(page => page.sourceLabel), ['@main']);
}

function testExecutedBusinessGotoStaysPrivate() {
  const source = [
    '[@main]', '#ACT', 'GOTO @属性重载', '#SAY',
    '<TEXT:完成这个任务后获得属性:20:20>',
    '[@属性重载]', '#IF', 'LARGE U201 0', '#ACT',
    'MOV U202 1',
    'INC N$攻击 2',
    'SENDMSG 6 属性已重载',
  ].join('\n');
  const model = parse(source);
  assert.deepEqual(inputNames(model), [],
    'an automatically executed helper that has only business effects must not publish its internal variables');
  assert.deepEqual(model.conditionGroups, [],
    'an automatically executed business-only condition must not become a canvas switch');
  assert.deepEqual(model.pages.map(page => page.sourceLabel), ['@main']);
  assert.equal(visibleText(model), '完成这个任务后获得属性');
}

function testDormantUiHandlerPotentialControlsStayPrivate() {
  const source = [
    '[@main]', '#SAY', '<TEXT:主界面:20:20>', '<领取/@business>',
    '[@business]', '#ACT',
    'WHILE U1 > 0',
    'MESSAGEBOX 休眠循环卡片 @确定 @取消',
    String.raw`ADDBUTTON 3 51 283 284 285 20 240 0|1 休眠循环按钮 253/不应显示`,
    'DEC U1 1',
    'ENDWHILE',
    '#IF', 'CHECK [101] 1', '#ACT',
    'MESSAGEBOX 休眠条件卡片 @确定 @取消',
    String.raw`ADDBUTTON 3 52 286 287 288 120 240 0|1 休眠条件按钮 253/不应显示`,
  ].join('\n');

  const model = parse(source);
  assert.deepEqual(
    inputNames(model),
    [],
    'potentially visible controls inside an unclicked no-SAY /@ handler must not publish [101] or U1',
  );
  assert.deepEqual(model.conditionGroups, [],
    'a dormant no-SAY handler must not publish CHECK condition groups');
  assert.equal(model.actUiPreviews.length, 0,
    'a dormant no-SAY handler must not publish potential MESSAGEBOX cards');
  assert.equal(addButtons(model).length, 0,
    'a dormant no-SAY handler must not publish potential ADDBUTTON controls');
  assert.deepEqual(model.pages.map(page => page.sourceLabel), ['@main'],
    'a reachable but unclicked action handler must not become a synthetic page');
  assert.equal(visibleText(model), '主界面\n领取',
    'filtering the dormant handler must not remove the visible main-page action caption');
}

function run() {
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const staticPage = parse([
      '[@main]', 'VIP 特权', 'HP: <$STR(U9)>', '<下一页/@next>',
      '[@next]', 'VIP 第二页', '<TEXT:页面内容:20:20>', '<继续/@last>',
      '[@last]', '#SAY', '<TEXT:最后一页:20:20>',
    ].join('\n'), {}, engine);
    assert.deepEqual(staticPage.pages.map(page => page.sourceLabel), ['@main', '@next', '@last'],
      `${engine}: directive-free entry links must retain the complete visible page chain`);
    assert.ok(visibleText(staticPage).includes('VIP 特权'), 'English captions must remain visible');
    assert.ok(visibleText(staticPage).includes('HP: 0'), 'mixed caption and variable text must remain visible');
    assert.ok(inputNames(staticPage).includes('U9'), 'visible static text must retain its input');
    const entry = parse([
      '[@main]', 'GOTO @next', '[@next]', '#SAY', '<TEXT:全部界面:20:20>',
    ].join('\n'), {}, engine);
    assert.ok(visibleText(entry).includes('全部界面'), 'a bare GOTO entry must retain its target page');
    assert.ok(!visibleText(entry).includes('GOTO'), 'the GOTO command itself is not canvas prose');
  }
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const businessOnly = parse(businessOnlySource, {}, engine);
    assert.deepEqual(
      inputNames(businessOnly),
      [],
      `${engine}: a reachable /@ business handler and its GOTO-only helper must not become canvas inputs`,
    );
    assert.deepEqual(
      businessOnly.conditionGroups,
      [],
      `${engine}: conditions that only guard business side effects must not appear as canvas branch controls`,
    );
    assert.deepEqual(businessOnly.pages.map(page => page.sourceLabel), ['@main']);
    assert.equal(visibleText(businessOnly), '完成这个任务后获得属性\n领取');
  }

  const runtimeResult = parse([
    '[@main]', '#ACT', 'GOTO @prepare', '#SAY',
    '<TEXT:随机结果=<$STR(U203)>:20:20>',
    '[@prepare]', '#ACT', 'MOVR U203 100',
  ].join('\n'));
  assert.deepEqual(
    inputNames(runtimeResult),
    ['U203'],
    'a runtime-only helper result that reaches visible text still needs one local fallback input',
  );
  assert.ok(visibleText(runtimeResult).includes('随机结果=0'));
  assert.ok(visibleText(parse([
    '[@main]', '#ACT', 'GOTO @prepare', '#SAY',
    '<TEXT:随机结果=<$STR(U203)>:20:20>',
    '[@prepare]', '#ACT', 'MOVR U203 100',
  ].join('\n'), { U203: '42' })).includes('随机结果=42'));

  const deterministicResult = parse([
    '[@main]', '#ACT', 'GOTO @prepare', '#SAY',
    '<TEXT:固定结果=<$STR(U204)>:20:20>',
    '[@prepare]', '#ACT', 'MOV U204 77',
  ].join('\n'));
  assert.deepEqual(
    inputNames(deterministicResult),
    [],
    'a deterministic helper assignment must render its value without exposing the derived target',
  );
  assert.ok(visibleText(deterministicResult).includes('固定结果=77'));

  const conditionalDerived = [
    '[@main]', '#ACT', 'GOTO @prepare', '#SAY',
    '<TEXT:称号=<$STR(S$称号)>:20:20>',
    '[@prepare]', '#IF', 'EQUAL S$任务状态 已完成', '#ACT',
    'MOV S$称号 任务达人', '#ELSEACT', 'MOV S$称号 未完成',
  ].join('\n');
  const conditionalInitial = parse(conditionalDerived);
  assert.deepEqual(
    inputNames(conditionalInitial),
    ['S$任务状态'],
    'a condition leaf that decides a visible derived value remains editable, but the derived output does not',
  );
  assert.ok(visibleText(conditionalInitial).includes('称号=未完成'));
  assert.ok(visibleText(parse(conditionalDerived, { 'S$任务状态': '已完成' })).includes('称号=任务达人'));

  const visibleCallee = parse([
    '[@main]', '#SAY', '<打开面板/@panel>',
    '[@panel]', '#IF', 'LARGE U205 0', '#SAY',
    '<TEXT:面板数值=<$STR(U205)>:20:20>', '#ELSESAY', '<TEXT:面板数值=0:20:20>',
  ].join('\n'));
  assert.deepEqual(inputNames(visibleCallee), ['U205'], 'a called function with a real visible page must retain its input');
  assert.ok(visibleCallee.pages.some(page => page.sourceLabel === '@panel'));
  assert.ok(visibleCallee.conditionGroups.some(group => group.sourceLabel === '@panel'));

  const interactive = parse(interactiveSource);
  assert.deepEqual(inputNames(interactive), ['U203']);
  assert.deepEqual(interactive.conditionGroups, []);
  assert.ok(visibleText(interactive).includes('随机结果=0'));

  const externalBusiness = [
    '[@reload]', '{', '#IF', 'LARGE U211 0', '#ACT',
    'MOVR U212 10', 'INC N$攻击 2', '}',
  ].join('\n');
  for (const command of ['CALL', 'CALLEX']) {
    const model = parseExternalCall(command, externalBusiness);
    assert.deepEqual(inputNames(model), [], `${command} action-only external variables must stay evaluator-private`);
    assert.deepEqual(model.conditionGroups, [], `${command} action-only external conditions must stay hidden`);
    assert.deepEqual(model.pages.map(page => page.sourceLabel), ['@main']);
  }

  const externalCalculation = [
    '[@reload]', '{', '#ACT', 'MOV N$result <$STR(N$base)>', 'INC N$result 2', '}',
  ].join('\n');
  const calculatedPrimary = parseExternalCall(
    'CALL',
    externalCalculation,
    { 'N$base': '40' },
    '<TEXT:结果=<$STR(N$result)>:20:20>',
  );
  assert.deepEqual(inputNames(calculatedPrimary), ['N$base'],
    'an external helper that feeds visible caller text keeps only its upstream input');
  assert.ok(visibleText(calculatedPrimary).includes('结果=42'));

  const executedRootActCard = parse([
    '[@main]', '#ACT', 'MESSAGEBOX <$STR(U220)>', 'GOTO @panel',
    '[@panel]', '#SAY', '<TEXT:面板:20:20>',
  ].join('\n'));
  assert.deepEqual(inputNames(executedRootActCard), ['U220'],
    'an actually executed root ACT card keeps its visible message input even when its source label has no page');
  assert.equal(executedRootActCard.actUiPreviews.length, 1);
  assert.equal(executedRootActCard.actUiPreviews[0].activeInPreview, true,
    'an executed card without a matching page must remain displayable on the active preview');

  const rootActFallback = parse([
    '[@main]', '#ACT', 'MESSAGEBOX <$STR(U220)>',
  ].join('\n'));
  assert.deepEqual(inputNames(rootActFallback), ['U220'],
    'when there is no page at all, the root ACT-card fallback keeps its visible message input');
  assert.equal(rootActFallback.actUiPreviews.length, 1);
  assert.equal(rootActFallback.actUiPreviews[0].sourceLabel, '@main');

  const regressions = [
    ['same-file bare business body stays off canvas', testSameFileBareBusinessBodyStaysOffCanvas],
    ['external CALL bare business body stays off canvas', () => testExternalBareBusinessBodyStaysOffCanvas('CALL')],
    ['external CALLEX bare business body stays off canvas', () => testExternalBareBusinessBodyStaysOffCanvas('CALLEX')],
    ['dormant handler cannot publish return condition', testDormantHandlerCannotPublishReturnCondition],
    ['commented and business-text references stay dormant', testCommentedAndBusinessTextReferencesStayDormant],
    ['executed helper ACT card remains visible', testExecutedHelperActCardRemainsVisible],
    ['progress publishes only visible text input', testProgressPublishesOnlyVisibleTextInput],
    ['ACT/ELSEACT publishes only current card branch', testActElseActPublishesOnlyCurrentCardBranch],
    ['ADDBUTTON direct title and tooltip inputs', testAddButtonDirectTitleAndTooltipInputs],
    ['ADDBUTTON derived text publishes only upstream inputs', testAddButtonDerivedTextPublishesOnlyUpstreamInputs],
    ['ADDBUTTON static assignments do not publish inputs', testAddButtonStaticAssignmentsDoNotPublishInputs],
    ['ADDBUTTON runtime-unknown title keeps target fallback', testAddButtonRuntimeUnknownTitleKeepsTargetFallback],
    ['false CHECK keeps MESSAGEBOX control input', testFalseCheckKeepsMessageBoxControlInput],
    ['false CHECK defers hidden card text input', testFalseCheckDefersHiddenCardTextInput],
    ['hidden SAY branch defers content input', testHiddenSayBranchDefersContentInput],
    ['hidden 996PC client-text branch defers input', testHidden996ClientTextBranchDefersInput],
    ['ACT cards union source-order dependencies', testActCardsUnionSourceOrderDependencies],
    ['ADDBUTTONs union source-order dependencies', testAddButtonsUnionSourceOrderDependencies],
    ['DELBUTTON condition requires a button surface', testDeleteButtonConditionRequiresAButtonSurface],
    ['false CHECK keeps ADDBUTTON control input', testFalseCheckKeepsAddButtonControlInput],
    ['false WHILE keeps MESSAGEBOX control input', testFalseWhileKeepsMessageBoxControlInput],
    ['executed helper WHILE keeps MESSAGEBOX control input', testExecutedHelperWhileKeepsMessageBoxControlInput],
    ['dormant business-handler conditions stay private', testDormantBusinessHandlerConditionsStayPrivate],
    ['executed business GOTO stays private', testExecutedBusinessGotoStaysPrivate],
    ['dormant UI-handler potential controls stay private', testDormantUiHandlerPotentialControlsStayPrivate],
  ];
  const failures = [];
  for (const [name, regression] of regressions) {
    try {
      regression();
    } catch (error) {
      failures.push(`${name}: ${error?.message || error}`);
    }
  }
  if (failures.length > 0) {
    assert.fail(`preview surface-scope regressions:\n- ${failures.join('\n- ')}`);
  }

  console.log('preview-input-surface-scope.test.js: PASS');
}

if (require.main === module) run();

module.exports = {
  businessOnlySource,
  inputNames,
  interactiveSource,
  parse,
  visibleText,
};
