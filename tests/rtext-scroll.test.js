const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

function parse(statements, actStatements = [
  'MOV N$RICHWIDTH 180',
  'MOV N$RICHHEIGHT 36',
  'MOV N$RICHWAY 1',
  'MOV N$RICHTIME 9',
]) {
  const source = [
    '[@main]',
    '#ACT',
    ...actStatements,
    '#SAY',
    ...statements,
  ].join('\n');
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/rtext-scroll.txt',
    fileName: 'rtext-scroll.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\rtext-scroll.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
}

function richTextById(model, id) {
  return model.pages[0].elements.find(element => (
    element.statementId === 'newui-rtext-996pc'
      && element.containerElementId === id
  ));
}

function testDocumentedStaticRTextScrolling() {
  const model = parse([
    '<RText|id=RICH_X|x=20|y=20|color=70|size=20|text=默认<横向/FCOLOR=250><滚动/FCOLOR=251>|scrollWidth=120|scrollHeight=24|scrollWay=0|scrollTime=2>',
    '<RText|id=RICH_Y|x=20|y=60|color=255|size=18|text=<纵向/FCOLOR=253>滚动|scrollWidth=90|scrollHeight=40|scrollWay=1|scrollTime=3>',
  ]);
  const horizontal = richTextById(model, 'RICH_X');
  const vertical = richTextById(model, 'RICH_Y');

  assert.ok(horizontal, 'horizontal RText must be recognized');
  assert.ok(vertical, 'vertical RText must be recognized');
  assert.deepEqual(horizontal.textPreview, {
    lines: [[
      { text: '默认', color: '#ff7700' },
      { text: '横向', color: '#00ff00' },
      { text: '滚动', color: '#ffff00' },
    ]],
    fontSize: 20,
    color: '#ff7700',
    align: 'left',
    scrollWidth: 120,
    scrollHeight: 24,
    scrollDirection: 0,
    scrollDurationMs: 2000,
  }, 'RText must retain rich-color runs and all documented scrolling fields');
  assert.equal(horizontal.width, 120, 'scrollWidth must define the RText viewport width');
  assert.equal(horizontal.height, 24, 'scrollHeight must define the RText viewport height');
  assert.equal(vertical.textPreview.scrollDirection, 1,
    'scrollWay=1 must preserve the documented bottom-to-top direction');
  assert.equal(vertical.textPreview.scrollDurationMs, 3000,
    'RText scrollTime is documented in seconds and must become milliseconds');
  assert.equal(vertical.width, 90);
  assert.equal(vertical.height, 40);
}

function testResolvedRTextScrollingUsesStaticPathValues() {
  const model = parse([
    '<RText|id=RICH_DYNAMIC|x=20|y=120|color=255|size=18|text=动态滚动|scrollWidth=<$STR(N$RICHWIDTH)>|scrollHeight=<$STR(N$RICHHEIGHT)>|scrollWay=<$STR(N$RICHWAY)>|scrollTime=<$STR(N$RICHTIME)>>',
  ]);
  const rich = richTextById(model, 'RICH_DYNAMIC');
  const expected = ['scroll-width', 'scroll-height', 'scroll-direction', 'scroll-duration'];

  assert.ok(rich, 'source-bound RText must remain recognized');
  for (const field of expected) {
    assert.ok(rich.textPreview.resolvedFields?.includes(field),
      `a direct constant MOV must classify ${field} as resolved-static`);
    assert.equal(Boolean(rich.textPreview.dynamicFields?.includes(field)), false);
  }
  assert.equal(rich.textPreview.scrollWidth, 180);
  assert.equal(rich.textPreview.scrollHeight, 36);
  assert.equal(rich.textPreview.scrollDirection, 1);
  assert.equal(rich.textPreview.scrollDurationMs, 9000);
  assert.equal(rich.width, 180);
  assert.equal(rich.height, 36);
  assert.match(rich.raw, /scrollWidth=<\$STR\(N\$RICHWIDTH\)>/i);
}

function testUnknownRTextScrollingUsesSafeGeometryWithoutInvalidSourceClaims() {
  const model = parse([
    '<RText|id=RICH_DYNAMIC|x=20|y=120|color=255|size=18|text=动态滚动|scrollWidth=<$STR(N$RICHWIDTH)>|scrollHeight=<$STR(N$RICHHEIGHT)>|scrollWay=<$STR(N$RICHWAY)>|scrollTime=<$STR(N$RICHTIME)>>',
  ], []);
  const rich = richTextById(model, 'RICH_DYNAMIC');
  const expected = ['scroll-width', 'scroll-height', 'scroll-direction', 'scroll-duration'];
  assert.ok(rich);
  for (const field of expected) {
    assert.ok(rich.textPreview.dynamicFields?.includes(field));
    assert.equal(Boolean(rich.textPreview.invalidFields?.includes(field)), false,
      `placeholder 0 for ${field} is not evidence that the source is invalid`);
  }
  assert.equal(rich.textPreview.scrollWidth, undefined);
  assert.equal(rich.textPreview.scrollHeight, undefined);
  assert.equal(rich.textPreview.scrollDirection, undefined);
  assert.equal(rich.textPreview.scrollDurationMs, undefined);
  assert.ok(rich.width > 0 && rich.height > 0, 'unknown scrolling still needs selectable safe geometry');
}

function testInvalidRTextScrollingRemainsStopped() {
  const model = parse([
    '<RText|id=RICH_INVALID|x=20|y=170|color=255|size=18|text=非法滚动|scrollWidth=0|scrollHeight=-5|scrollWay=7|scrollTime=0>',
  ]);
  const rich = richTextById(model, 'RICH_INVALID');
  const expected = ['scroll-width', 'scroll-height', 'scroll-direction', 'scroll-duration'];

  assert.ok(rich, 'invalid RText must remain recognized');
  for (const field of expected) {
    assert.ok(rich.textPreview.invalidFields?.includes(field),
      `invalid RText must classify ${field} instead of starting a guessed animation`);
  }
  assert.equal(rich.textPreview.scrollWidth, undefined);
  assert.equal(rich.textPreview.scrollHeight, undefined);
  assert.equal(rich.textPreview.scrollDirection, undefined);
  assert.equal(rich.textPreview.scrollDurationMs, undefined);
  assert.match(rich.warning || '', /RText.*(?:无效|非法)|(?:无效|非法).*RText/i,
    'invalid RText scrolling must expose a visible boundary');
}

testDocumentedStaticRTextScrolling();
testResolvedRTextScrollingUsesStaticPathValues();
testUnknownRTextScrollingUsesSafeGeometryWithoutInvalidSourceClaims();
testInvalidRTextScrollingRemainsStopped();
console.log('rtext-scroll.test.js: PASS');
