const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const {
  applyTextReplacements,
  buildDialogCoordinateEdits,
} = require('../out/ui-dialog/source-patcher');

function parse(source, engine = 'GOM') {
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/mtext-flow-${engine}.txt`,
    fileName: `mtext-flow-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\mtext-flow-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function visibleText(element) {
  const preview = (element.textPreview?.lines || [])
    .map(line => (line || []).map(run => String(run.text || '')).join(''))
    .join('\n');
  return preview || String(element.text || '');
}

function mtextSource(x = '10', y = '20') {
  const markup = [
    `<MText:#L02~:${x}:${y}:251:第一行<$STR(S$KNOWN_TEXT)>|`,
    '第二行<$STR(S$UNKNOWN_TEXT)>|',
    '第三行<$STR(N$KNOWN_NUMBER)>/<$STR(N$UNKNOWN_NUMBER)>>',
  ].join('\r\n');
  return {
    markup,
    source: [
      '[@main]',
      '#ACT',
      'MOV S$KNOWN_TEXT 已知文字',
      'MOV N$KNOWN_NUMBER 42',
      'MOV N$X 10',
      '#SAY',
      '<&Layout:~#L02:205:20:195:140>',
      markup,
      '',
    ].join('\r\n'),
  };
}

function flowSource() {
  return [
    '[@main]',
    '#ACT',
    'MOV S$KNOWN_TEXT 已知文字',
    'MOV N$KNOWN_NUMBER 42',
    '#SAY',
    '欢迎<$STR(S$KNOWN_TEXT)>，未知<$STR(S$UNKNOWN_TEXT)>，数值<$STR(N$KNOWN_NUMBER)>/<$STR(N$UNKNOWN_NUMBER)>',
    '前缀<彩色<$STR(S$KNOWN_TEXT)>与<$STR(S$UNKNOWN_TEXT)>/FCOLOR=250>尾缀',
    '甲<$STR(S$KNOWN_TEXT)>\\乙<$STR(S$UNKNOWN_TEXT)>',
    '',
  ].join('\r\n');
}

function assertExactSourceBinding(source, element, message) {
  assert.ok(element, `${message}: element missing`);
  const exact = source.slice(element.sourceRange.start, element.sourceRange.end);
  assert.equal(element.raw, exact, `${message}: raw must be the exact source slice`);
  assert.equal(element.sourceRange.original, exact,
    `${message}: sourceRange.original must remain the exact source slice`);
}

function testResolvedMultilineMTextKeepsEditableOpenerCoordinates() {
  for (const engine of ['GOM', 'GEE']) {
    const { source, markup } = mtextSource();
    const model = parse(source, engine);
    const page = model.pages[0];
    const mtext = page.elements.find(element => element.statementId === 'container-mtext');
    assert.ok(mtext, `${engine}: multiline MText missing`);

    assert.equal(visibleText(mtext), [
      '第一行已知文字',
      '第二行预览文字',
      '第三行42/0',
    ].join('\n'), `${engine}: MText did not resolve each physical line independently`);
    assert.doesNotMatch(visibleText(mtext), /<\$STR\(/i,
      `${engine}: source expressions leaked into visible MText`);
    assert.equal(mtext.raw, markup, `${engine}: MText raw changed`);
    assert.equal(source.slice(mtext.sourceRange.start, mtext.sourceRange.end), markup,
      `${engine}: MText sourceRange no longer covers the complete physical-line span`);
    assert.equal(mtext.sourceRange.original, markup,
      `${engine}: MText sourceRange.original changed`);
    assert.equal(mtext.editable, true,
      `${engine}: literal opener X/Y must remain editable despite dynamic text`);
    assert.equal(mtext.x?.span.original, '10', `${engine}: opener X span is not exact`);
    assert.equal(mtext.y?.span.original, '20', `${engine}: opener Y span is not exact`);
    assert.equal(source.slice(mtext.x.span.start, mtext.x.span.end), '10');
    assert.equal(source.slice(mtext.y.span.start, mtext.y.span.end), '20');

    const edits = buildDialogCoordinateEdits(source, model, [{
      elementId: mtext.id,
      x: mtext.layoutX + 5,
      y: mtext.layoutY + 6,
    }]);
    assert.equal(edits.replacements.length, 2,
      `${engine}: moving MText should patch exactly opener X/Y`);
    const patched = applyTextReplacements(source, edits.replacements);
    assert.equal(patched, source.replace(
      '<MText:#L02~:10:20:251:',
      '<MText:#L02~:15:26:251:'
    ), `${engine}: coordinate patch changed text expressions or following physical lines`);
  }
}

function testDynamicMTextCoordinateRemainsReadOnly() {
  const { source, markup } = mtextSource('<$STR(N$X)>', '20');
  const model = parse(source, 'GOM');
  const mtext = model.pages[0].elements.find(element => element.statementId === 'container-mtext');
  assert.ok(mtext, 'dynamic-coordinate MText missing');
  assert.equal(visibleText(mtext), [
    '第一行已知文字',
    '第二行预览文字',
    '第三行42/0',
  ].join('\n'), 'a dynamic coordinate must not suppress useful MText content');
  assert.equal(mtext.editable, false, 'dynamic MText coordinate must remain read-only');
  assert.equal(mtext.x, undefined, 'dynamic X must not receive an editable numeric source span');
  assert.equal(mtext.y?.span.original, '20', 'the remaining literal Y source span must stay exact');
  assert.equal(mtext.raw, markup);
  assert.throws(() => buildDialogCoordinateEdits(source, model, [{
    elementId: mtext.id,
    x: mtext.layoutX + 1,
    y: mtext.layoutY + 1,
  }]), /坐标不是可安全修改的直接数值/);
}

function testResolvedFlowTextKeepsIndependentSourceFragments() {
  for (const engine of ['GOM', 'GEE']) {
    const source = flowSource();
    const model = parse(source, engine);
    const flow = model.pages[0].elements.filter(element => element.statementId === 'flow-text');
    const plain = flow.find(element => visibleText(element).startsWith('欢迎已知文字'));
    const colored = flow.find(element => visibleText(element) === '前缀彩色已知文字与预览文字尾缀');
    const firstBreak = flow.find(element => visibleText(element) === '甲已知文字');
    const secondBreak = flow.find(element => visibleText(element) === '乙预览文字');

    assert.equal(visibleText(plain), '欢迎已知文字，未知预览文字，数值42/0',
      `${engine}: ordinary flow values are not useful`);
    for (const [name, element] of [
      ['plain flow', plain],
      ['colored flow', colored],
      ['first backslash fragment', firstBreak],
      ['second backslash fragment', secondBreak],
    ]) {
      assertExactSourceBinding(source, element, `${engine} ${name}`);
      assert.equal(element.coordinateMode, 'flow', `${engine} ${name}: must remain flow layout`);
      assert.equal(element.editable, false, `${engine} ${name}: flow text must remain read-only`);
      assert.equal(element.x, undefined, `${engine} ${name}: flow text must not gain X`);
      assert.equal(element.y, undefined, `${engine} ${name}: flow text must not gain Y`);
    }

    assert.deepEqual(colored.textPreview?.lines, [[
      { text: '前缀' },
      { text: '彩色已知文字与预览文字', color: '#00ff00' },
      { text: '尾缀' },
    ]], `${engine}: resolved FCOLOR runs changed`);
    assert.notEqual(firstBreak.sourceRange.start, secondBreak.sourceRange.start,
      `${engine}: backslash fragments incorrectly share one source range`);
    assert.ok(firstBreak.sourceRange.end < secondBreak.sourceRange.start,
      `${engine}: backslash fragment source ranges overlap`);
    assert.equal(source.slice(firstBreak.sourceRange.end, secondBreak.sourceRange.start), '\\',
      `${engine}: fragment gap must be the original flow line break`);
    assert.equal(secondBreak.layoutX, 18,
      `${engine}: second backslash fragment must return to the flow origin`);
    assert.ok(secondBreak.layoutY >= firstBreak.layoutY + 22,
      `${engine}: second backslash fragment did not advance to the next flow row`);
  }
}

testResolvedMultilineMTextKeepsEditableOpenerCoordinates();
testDynamicMTextCoordinateRemainsReadOnly();
testResolvedFlowTextKeepsIndependentSourceFragments();
console.log('mtext-flow-dynamic-provenance.test.js: PASS');
