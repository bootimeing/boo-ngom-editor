const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

function parse(engine, actLines, before = []) {
  const source = ['[@main]', '#ACT', ...before, ...actLines, '#SAY', '<Text:画布仍然可用>'].join('\n');
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/act-ui-${engine}.txt`,
    fileName: `act-ui-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\act-ui-${engine}.txt`,
    documentVersion: 1, engine, engineLabel: engine,
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function preview(model, command, occurrence = 0) {
  const matches = (model.actUiPreviews || []).filter(value => value.command === command);
  assert.ok(matches[occurrence], `missing #ACT UI preview ${command} #${occurrence + 1}`);
  return matches[occurrence];
}

function field(card, name) {
  const value = (card.fields || []).find(candidate => candidate.name === name);
  assert.ok(value, `${card.command} lacks field ${name}`);
  return value;
}

function optionalField(card, name) {
  return (card.fields || []).find(candidate => candidate.name === name);
}

function expectField(card, name, status, value) {
  const actual = field(card, name);
  assert.equal(actual.status, status, `${card.command}/${name} status`);
  if (arguments.length >= 4) assert.deepEqual(actual.value, value, `${card.command}/${name} value`);
}

function expectDisplay(card, name, status, value, kind = 'text') {
  const source = field(card, name).displayValueSource;
  assert.ok(source, `${card.command}/${name} lacks a typed display-only value`);
  assert.equal(source.kind, kind, `${card.command}/${name} display kind`);
  assert.equal(source.status, status, `${card.command}/${name} display status`);
  assert.deepEqual(source.value, value, `${card.command}/${name} display value`);
  return source;
}

function assertCommonBoundary(model, commands) {
  assert.deepEqual((model.actUiPreviews || []).map(value => value.command), commands,
    '#ACT UI previews must preserve command source order');
  for (const card of model.actUiPreviews || []) {
    assert.equal(card.simulation, 'partial', `${card.command} cannot claim faithful/client simulation`);
    assert.equal(card.localOnly, true, `${card.command} may not perform a server/client action`);
    assert.ok(card.sourceRange && Number.isInteger(card.sourceRange.start)
      && Number.isInteger(card.sourceRange.end), `${card.command} lacks auditable source range`);
  }
  const rawElements = model.pages.flatMap(page => page.elements).map(element => element.raw || '').join('\n');
  const unsupported = model.pages.flatMap(page => page.unsupportedStatements || []).join('\n');
  for (const command of ['MESSAGEBOX', 'SHOWPROGRESSBARDLG', 'PLAYWINDOWEFFECT', 'SENDMOVEHINTMSG', 'OPENUPGRADEDLG', 'OPENCLIENTDLG']) {
    assert.doesNotMatch(rawElements, new RegExp(`^${command}\\b`, 'im'), `${command} leaked into #SAY canvas`);
    assert.doesNotMatch(unsupported, new RegExp(`^${command}\\b`, 'im'), `${command} was swallowed as unsupported text`);
  }
}

function testGomActUiPreview() {
  const model = parse('GOM', [
    'MESSAGEBOX 静态提示 @确定 @取消',
    'SHOWPROGRESSBARDLG 5 @完成 正在采集%d% 1 @中断',
    'PLAYWINDOWEFFECT 0 1 3 10 12 100 1 8 9 1|1',
    'SENDMOVEHINTMSG GOM提示 249 0 10 60 1',
    'OPENUPGRADEDLG 装备升级',
    'OPENCLIENTDLG 15 2 100 20',
    'MESSAGEBOX 系统提示：<$STR(S$KNOWN)> @已确定 @取消',
    'MESSAGEBOX 系统提示：<$STR(S$UNKNOWN)>，数量<$STR(N$UNKNOWN)> @<$STR(S$CONFIRM)> @取消',
  ], ['MOV S$KNOWN 已确定文字']);
  assertCommonBoundary(model, [
    'messagebox', 'show-progress-bar', 'play-window-effect', 'send-move-hint',
    'open-upgrade-dialog', 'open-client-dialog', 'messagebox', 'messagebox',
  ]);
  const message = preview(model, 'messagebox');
  expectField(message, 'message', 'static', '静态提示');
  expectField(message, 'confirm-label', 'static', '@确定');
  expectField(message, 'cancel-label', 'static', '@取消');
  assert.match(message.warning || '', /仅展示|不执行|Partial simulation/i,
    'MessageBox must visibly state that its labels cannot execute');
  const resolvedMessage = preview(model, 'messagebox', 1);
  expectField(resolvedMessage, 'message', 'dynamic');
  const resolvedDisplay = expectDisplay(
    resolvedMessage,
    'message',
    'resolved-static',
    '系统提示：已确定文字'
  );
  assert.deepEqual(resolvedDisplay.variableNames, ['S$KNOWN']);
  assert.equal(field(resolvedMessage, 'message').value, undefined,
    'a display snapshot must not replace the source/runtime field value');

  const unknownMessage = preview(model, 'messagebox', 2);
  expectField(unknownMessage, 'message', 'dynamic');
  expectDisplay(
    unknownMessage,
    'message',
    'runtime-placeholder',
    '系统提示：预览文字，数量0'
  );
  expectDisplay(unknownMessage, 'confirm-label', 'runtime-placeholder', '@预览文字');
  assert.match(field(unknownMessage, 'message').raw || '', /<\$STR\(S\$UNKNOWN\)>/i,
    'the raw expression must remain available as provenance');

  const progress = preview(model, 'show-progress-bar');
  expectField(progress, 'duration-seconds', 'static', 5);
  expectField(progress, 'complete-label', 'static', '@完成');
  expectField(progress, 'interrupt-mode', 'static', true);
  expectField(progress, 'interrupt-label', 'static', '@中断');
  expectDisplay(progress, 'message', 'literal', '正在采集%d%');
  expectDisplay(progress, 'complete-label', 'literal', '@完成');
  assert.match(progress.warning || '', /不执行|不会完成|Partial simulation/i,
    'progress completion/cancellation must be display-only');

  const effect = preview(model, 'play-window-effect');
  expectField(effect, 'target-window', 'static', 0);
  expectField(effect, 'will-index', 'static', 3);
  expectField(effect, 'start-image', 'static', 10);
  expectField(effect, 'end-image', 'static', 12);
  expectField(effect, 'interval-ms', 'static', 100);
  expectField(effect, 'offset', 'static', [8, 9]);
  expectField(effect, 'draw-mode', 'static', '1|1');

  const hint = preview(model, 'send-move-hint');
  expectField(hint, 'message', 'static', 'GOM提示');
  expectField(hint, 'parameter-6-semantics', 'static', 'screen-coordinate-mode');
  expectField(hint, 'screen-coordinate-mode', 'static', true);

  const upgrade = preview(model, 'open-upgrade-dialog');
  expectField(upgrade, 'title', 'static', '装备升级');
  expectDisplay(upgrade, 'title', 'literal', '装备升级');
  expectField(upgrade, 'item-slot', 'evidence-blocked');
  assert.match(upgrade.warning || '', /Runtime-data blocked|运行时/,
    'an offline preview cannot fabricate the player item-slot state');

  const client = preview(model, 'open-client-dialog');
  expectField(client, 'dialog-id', 'static', 15);
  expectField(client, 'dialog-name', 'static', '背包');
  expectField(client, 'coordinate-mode', 'static', 2);
  expectField(client, 'coordinate', 'static', [100, 20]);
}

function testGeeLfmActUiDifferencesAndEvidenceBlock() {
  const model = parse('GEE', [
    'SHOWPROGRESSBARDLG 5 @完成 正在采集%d% 1 @中断 1 NewUI 234 NewUI 235 15,12 17,29',
    'SENDMOVEHINTMSG LFM提示 249 0 10 60 5',
    'OPENCLIENTDLG 15 1 100 20',
    'OPENCLIENTDLG <$STR(N$DIALOG)> 1 100 20',
  ], ['MOV N$DIALOG 17']);
  assertCommonBoundary(model, [
    'show-progress-bar', 'send-move-hint', 'open-client-dialog', 'open-client-dialog',
  ]);
  const progress = preview(model, 'show-progress-bar');
  expectField(progress, 'duration-seconds', 'static', 5);
  expectField(progress, 'custom-ui-enabled', 'static', true);
  // The help's parameter description contradicts its syntax/example. Both
  // pairs must survive verbatim and neither may become rendered geometry.
  expectField(progress, 'text-offset-candidate', 'evidence-blocked', [15, 12]);
  expectField(progress, 'progress-offset-candidate', 'evidence-blocked', [17, 29]);
  assert.equal(progress.evidenceStatus, 'evidence-blocked');
  assert.match(progress.warning || '', /Evidence-blocked|证据|冲突/,
    'GEE/LFM custom offset ambiguity must be visible');

  const hint = preview(model, 'send-move-hint');
  expectField(hint, 'parameter-6-semantics', 'static', 'duration-seconds');
  expectField(hint, 'duration-seconds', 'static', 5);
  assert.equal(optionalField(hint, 'screen-coordinate-mode'), undefined,
    'GOM parameter-6 meaning must not bleed into GEE/LFM');

  const client = preview(model, 'open-client-dialog');
  expectField(client, 'dialog-id', 'static', 15);
  expectField(client, 'dialog-name', 'static', '内挂');
  expectField(client, 'coordinate-mode', 'static', 1);
  const dynamicClient = preview(model, 'open-client-dialog', 1);
  expectField(dynamicClient, 'dialog-id', 'dynamic');
  assert.equal(field(dynamicClient, 'dialog-id').displayValueSource, undefined,
    'display placeholder 0 must not be attached to a client window ID');
  assert.equal(optionalField(dynamicClient, 'dialog-name'), undefined,
    'display placeholder 0 must not unlock a client dialog-name mapping');
  assert.doesNotMatch(JSON.stringify(dynamicClient), /17/,
    'dynamic OpenClientDlg ID borrowed MOV=17');
}

function test996DocumentedAndEvidenceBoundedActUi() {
  const model = parse('996PC', [
    'MESSAGEBOX 996提示 @确定 @取消',
    'SHOWPROGRESSBARDLG 5 @完成 正在采集%d% 1 @中断',
    'PLAYWINDOWEFFECT 0 1 3 10 12 100 1 8 9 1|1',
    'OPENUPGRADEDLG 996装备升级',
  ]);
  assertCommonBoundary(model, [
    'messagebox', 'show-progress-bar', 'play-window-effect', 'open-upgrade-dialog',
  ]);
  expectField(preview(model, 'messagebox'), 'message', 'static', '996提示');
  const progress = preview(model, 'show-progress-bar');
  expectField(progress, 'duration-seconds', 'static', 5);
  assert.equal(progress.evidenceStatus, 'evidence-blocked',
    '996PC catalog is name-only; the card must label its parameter evidence boundary');
  const effect = preview(model, 'play-window-effect');
  expectField(effect, 'will-index', 'static', 3);
  assert.equal(effect.evidenceStatus, 'evidence-blocked',
    '996PC catalog is name-only even though local extracted help describes the command');
  expectField(preview(model, 'open-upgrade-dialog'), 'item-slot', 'evidence-blocked');
}

function testSixCommandDisplaySnapshotsStaySeparateFromRuntimeState() {
  const model = parse('GOM', [
    'MESSAGEBOX 提示：<$STR(S$KNOWN)> @确定 @取消',
    'SHOWPROGRESSBARDLG <$STR(N$DURATION)> @完成 采集：<$STR(S$UNKNOWN)> 1 @中断',
    'PLAYWINDOWEFFECT 0 1 <$STR(N$WIL)> 10 12 100 1 8 9 1|1',
    'SENDMOVEHINTMSG 提示：<$STR(S$HINT)> 249 0 <$STR(N$X)> 60 1',
    'OPENUPGRADEDLG 升级：<$STR(S$UNKNOWN)>',
    'OPENCLIENTDLG <$STR(N$DIALOG)> 2 <$STR(N$X)> 20',
  ], [
    'MOV S$KNOWN 已确定消息',
    'MOV S$HINT 已确定滚动提示',
  ]);

  expectDisplay(preview(model, 'messagebox'), 'message', 'resolved-static', '提示：已确定消息');

  const progress = preview(model, 'show-progress-bar');
  expectDisplay(progress, 'message', 'runtime-placeholder', '采集：预览文字');
  expectDisplay(progress, 'complete-label', 'literal', '@完成');
  expectField(progress, 'duration-seconds', 'dynamic');
  assert.equal(field(progress, 'duration-seconds').value, undefined);
  assert.equal(field(progress, 'duration-seconds').displayValueSource, undefined,
    '0 may not become a fake timer duration');

  const effect = preview(model, 'play-window-effect');
  expectField(effect, 'will-index', 'dynamic');
  assert.equal(field(effect, 'will-index').value, undefined);
  assert.equal(field(effect, 'will-index').displayValueSource, undefined,
    '0 may not become a guessed WIL/archive index');

  const hint = preview(model, 'send-move-hint');
  expectDisplay(hint, 'message', 'resolved-static', '提示：已确定滚动提示');
  expectField(hint, 'x', 'dynamic');
  assert.equal(field(hint, 'x').displayValueSource, undefined,
    '0 may not become a guessed hint coordinate');

  expectDisplay(
    preview(model, 'open-upgrade-dialog'),
    'title',
    'runtime-placeholder',
    '升级：预览文字'
  );

  const client = preview(model, 'open-client-dialog');
  expectField(client, 'dialog-id', 'dynamic');
  expectField(client, 'coordinate', 'dynamic');
  assert.equal(field(client, 'dialog-id').displayValueSource, undefined);
  assert.equal(field(client, 'coordinate').displayValueSource, undefined);
  assert.equal(optionalField(client, 'dialog-name'), undefined,
    '0 may not unlock an OPENCLIENTDLG id mapping');
}

const failures = [];
for (const [name, test] of [
  ['GOM six #ACT UI commands', testGomActUiPreview],
  ['GEE/LFM differences and offset ambiguity', testGeeLfmActUiDifferencesAndEvidenceBlock],
  ['996PC evidence boundary', test996DocumentedAndEvidenceBoundedActUi],
  ['six-command display/runtime separation', testSixCommandDisplaySnapshotsStaySeparateFromRuntimeState],
]) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message || error}`); }
}
if (failures.length) {
  console.error('act-ui-preview.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else console.log('act-ui-preview.test.js: PASS');
