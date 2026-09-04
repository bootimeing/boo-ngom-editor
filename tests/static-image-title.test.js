const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

function parse(source) {
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/static-image-title.txt',
    fileName: 'static-image-title.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\static-image-title.txt',
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: '新GOM',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });
}

function imageByIndex(model, imageIndex) {
  return model.pages[0].elements.find(element => element.assetRef?.imageIndex === imageIndex);
}

const source = [
  '[@main]',
  '#ACT',
  'MOV S$TITLE 运行时标题',
  'MOV N$TITLEX 19',
  '#SAY',
  '<IMG:1600:0:30:40:按钮,10,11,250#|254#标题^250#说明/@图片标签>',
  '<IMGEX:0:1700:1701:1702:80:90:1,2:领取,-3,4,#112233#|普通备注/@提交标签>',
  '<IMG:1800:0:100:120:兑换,2,3,$332211#>',
  '<IMG:1801:0:140:120:旧参数,2,3,250>',
  '<IMG:1802:0:180:120:<$STR(S$TITLE)>,<$STR(N$TITLEX)>,4,250#>',
].join('\n');

const model = parse(source);
const image = imageByIndex(model, 1600);
const button = imageByIndex(model, 1700);
const bgr = imageByIndex(model, 1800);
const legacy = imageByIndex(model, 1801);
const dynamic = imageByIndex(model, 1802);

assert.ok(image, 'GOM IMG fixture was not parsed');
assert.deepEqual(image.imagePreview, {
  variant: 'gom-img',
  opacity: 255,
  gray: false,
  title: {
    raw: '按钮,10,11,250#',
    text: '按钮',
    offsetX: 10,
    offsetY: 11,
    colorValue: '250',
    color: '#00ff00',
  },
  link: '@图片标签',
}, 'IMG parameter 5 must be a typed image title, not a tooltip or generic parameter');
assert.deepEqual(image.tooltipPreview, {
  raw: '254#标题^250#说明/@图片标签',
  kind: 'text',
  lines: [
    [{ text: '标题', color: '#00ffff' }],
    [{ text: '说明', color: '#00ff00' }],
  ],
  offsetX: 0,
  offsetY: 0,
}, 'pipe tooltip color runs must remain separate from the always-visible image title');

assert.ok(button, 'GOM IMGEX fixture was not parsed');
assert.equal(button.kind, 'button');
assert.deepEqual(button.imagePreview, {
  variant: 'gom-imgex',
  opacity: 255,
  gray: false,
  title: {
    raw: '领取,-3,4,#112233#',
    text: '领取',
    offsetX: -3,
    offsetY: 4,
    colorValue: '#112233',
    color: '#112233',
  },
  submitIds: '1,2',
  link: '@提交标签',
}, 'IMGEX parameter 7 submit IDs, parameter 8 title, tooltip and /@ link must not overlap');
assert.equal(button.tooltipPreview?.lines?.[0]?.[0]?.text, '普通备注');

assert.equal(bgr.imagePreview?.title?.color, '#112233',
  '$BBGGRR must use the documented BGR-to-CSS conversion for image titles');
assert.equal(bgr.imagePreview?.title?.colorValue, '$332211');

assert.equal(legacy.imagePreview?.title, undefined,
  'a title without its required trailing # must remain an old compatibility parameter');
assert.deepEqual(legacy.imagePreview?.invalidFields, ['title']);
assert.match(legacy.warning || '', /标题.*(?:#|旧.*参数|兼容)|(?:#|兼容).*标题/);

assert.deepEqual(dynamic.imagePreview?.title, {
  raw: '运行时标题,19,4,250#',
  text: '运行时标题',
  offsetX: 19,
  offsetY: 4,
  colorValue: '250',
  color: '#00ff00',
}, 'a statically proven MOV title should remain useful visible text while its source stays auditable');
assert.deepEqual(dynamic.imagePreview?.dynamicFields, ['title']);
assert.equal(dynamic.imagePreview?.dynamic, true);
assert.equal(dynamic.assetRef?.imageIndex, 1802,
  'displaying a proven title must not change the independently static image resource');
assert.match(
  dynamic.warning || '',
  /标题.*动态|动态.*标题|源码含运行时表达式|未确定文字显示|未确定数量显示/,
);

console.log('static-image-title.test.js: PASS');
