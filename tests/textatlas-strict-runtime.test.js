const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

function parse(lines, before = []) {
  const source = ['[@main]', '#ACT', ...before, '#SAY', ...lines].join('\n');
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/textatlas-strict-runtime.txt',
    fileName: 'textatlas-strict-runtime.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\textatlas-strict-runtime.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
}

function byRaw(model, marker) {
  return model.pages[0].elements.find(element => element.raw.includes(marker));
}

function fields(preview, name) {
  return [...new Set(preview?.[name] || [])].sort();
}

function testNewPanelAtlasStrictFields() {
  const model = parse([
    '<TextAtlas|id=GOOD|x=10|y=10|wil=NewopUI|pcimg=2522|iwidth=14|iheight=24|text=0123>',
    '<TextAtlas|id=BAD_IMAGE_NEG|x=10|y=50|wil=NewopUI|pcimg=-1|iwidth=14|iheight=24|text=12>',
    '<TextAtlas|id=BAD_IMAGE_FLOAT|x=10|y=90|wil=NewopUI|pcimg=1.5|iwidth=14|iheight=24|text=12>',
    '<TextAtlas|id=BAD_SIZE|x=10|y=130|wil=NewopUI|pcimg=2522|iwidth=-2|iheight=0|text=12>',
    '<TextAtlas|id=FLOAT_SIZE|x=10|y=170|wil=NewopUI|pcimg=2522|iwidth=2.5|iheight=3.5|text=12>',
    '<TextAtlas|id=BAD_TEXT|x=10|y=210|wil=NewopUI|pcimg=2522|iwidth=14|iheight=24|text=12A>',
    '<TextAtlas|id=DYNAMIC|x=10|y=250|wil=<$STR(S$WIL)>|pcimg=<$STR(N$IMG)>|iwidth=<$STR(N$W)>|iheight=<$STR(N$H)>|text=<$STR(S$VALUE)>>',
  ], [
    'MOV S$WIL NewopUI',
    'MOV N$IMG 2522',
    'MOV N$W 14',
    'MOV N$H 24',
    'MOV S$VALUE 9876',
  ]);
  const good = byRaw(model, 'id=GOOD|');
  const negative = byRaw(model, 'id=BAD_IMAGE_NEG|');
  const floatingImage = byRaw(model, 'id=BAD_IMAGE_FLOAT|');
  const badSize = byRaw(model, 'id=BAD_SIZE|');
  const floatSize = byRaw(model, 'id=FLOAT_SIZE|');
  const badText = byRaw(model, 'id=BAD_TEXT|');
  const dynamic = byRaw(model, 'id=DYNAMIC|');

  assert.equal(good.imageTextPreview?.textAtlasVariant, 'newui-atlas');
  assert.deepEqual(good.imageTextPreview?.baseAssetRef, {
    archiveName: 'NewopUI', imageIndex: 2522,
  });
  assert.deepEqual(good.imageTextPreview?.glyphs.map(glyph => glyph.sourceX), [0, 14, 28, 42]);
  assert.deepEqual(fields(good.imageTextPreview, 'dynamicFields'), []);
  assert.deepEqual(fields(good.imageTextPreview, 'invalidFields'), []);

  for (const element of [negative, floatingImage]) {
    assert.equal(element.assetRef, undefined, 'invalid pcimg leaked to the top-level resolver');
    assert.equal(element.imageTextPreview?.baseAssetRef, undefined);
    assert.ok(fields(element.imageTextPreview, 'invalidFields').includes('image'));
    assert.ok(element.imageTextPreview?.glyphs.every(glyph => !glyph.assetRef));
  }
  assert.deepEqual(fields(badSize.imageTextPreview, 'invalidFields'), ['glyph-height', 'glyph-width']);
  assert.deepEqual(fields(floatSize.imageTextPreview, 'invalidFields'), ['glyph-height', 'glyph-width']);
  assert.equal(badSize.imageTextPreview?.glyphWidth, undefined);
  assert.equal(floatSize.imageTextPreview?.glyphHeight, undefined);
  assert.ok(badSize.imageTextPreview?.glyphs.every(glyph => !glyph.assetRef && glyph.sourceX === undefined));
  assert.deepEqual(fields(badText.imageTextPreview, 'invalidFields'), ['text']);
  assert.deepEqual(badText.imageTextPreview?.glyphs, []);

  assert.deepEqual(fields(dynamic.imageTextPreview, 'dynamicFields'), [
    'archive', 'glyph-height', 'glyph-width', 'image', 'text',
  ]);
  assert.equal(dynamic.imageTextPreview?.value, '9876');
  assert.equal(
    dynamic.imageTextPreview?.glyphs.map(glyph => glyph.character).join(''),
    '9876',
    'a statically proven numeric display value should remain visible as glyph characters',
  );
  assert.equal(dynamic.assetRef, undefined);
  assert.equal(dynamic.imageTextPreview?.baseAssetRef, undefined);
  assert.equal(dynamic.imageTextPreview?.glyphWidth, undefined);
  assert.equal(dynamic.imageTextPreview?.glyphHeight, undefined);
  assert.ok(dynamic.imageTextPreview?.glyphs.every(glyph => (
    !glyph.assetRef && glyph.sourceX === undefined
  )), 'dynamic archive/image/geometry must not become requestable glyph resources');
  assert.doesNotMatch(JSON.stringify(dynamic.imageTextPreview), /2522|NewopUI/,
    'displaying a proven value must not borrow dynamic TextAtlas resources');
  assert.match(dynamic.warning || '', /不借用 MOV|动态/);
}

function testTraditionalTextAtlasCatalogAndDigits() {
  const schemas = buildDialogStatementCatalog(staticLanguage, '996PC')
    .filter(schema => schema.token.toUpperCase() === '<TEXTATLAS');
  assert.ok(schemas.some(schema => schema.id === 'textatlas-996pc'
    && schema.syntax === 'positional'), 'traditional TextAtlas catalog entry is missing');
  assert.ok(schemas.some(schema => schema.id === 'newui-textatlas-996pc'
    && schema.syntax === 'key-value'), 'new-panel TextAtlas catalog entry was lost');

  const model = parse([
    '<TextAtlas:7:2470:0:0:908>',
    '<TextAtlas:7:2470:0:30:<$STR(N$VALUE)>>',
    '<TextAtlas:-1:1.5:0:60:12>',
    '<TextAtlas:7:2470:0:90:12A>',
  ], ['MOV N$VALUE 996123']);
  const stat = byRaw(model, ':0:0:908>');
  const dynamic = byRaw(model, ':0:30:<$STR(N$VALUE)>>');
  const invalidAsset = byRaw(model, '<TextAtlas:-1:1.5:');
  const invalidText = byRaw(model, ':0:90:12A>');

  assert.equal(stat.statementId, 'textatlas-996pc');
  assert.equal(stat.imageTextPreview?.textAtlasVariant, 'legacy-individual');
  assert.equal(stat.imageTextPreview?.mode, 'individual');
  assert.deepEqual(stat.imageTextPreview?.baseAssetRef, { willIndex: 7, imageIndex: 2470 });
  assert.deepEqual(stat.imageTextPreview?.glyphs.map(glyph => glyph.assetRef?.imageIndex), [
    2479, 2470, 2478,
  ]);
  assert.deepEqual(fields(stat.imageTextPreview, 'invalidFields'), []);

  assert.equal(dynamic.imageTextPreview?.value, '996123');
  assert.equal(
    dynamic.imageTextPreview?.glyphs.map(glyph => glyph.character).join(''),
    '996123',
    'a statically proven traditional TextAtlas value should remain visible',
  );
  assert.deepEqual(
    dynamic.imageTextPreview?.glyphs.map(glyph => glyph.assetRef?.imageIndex),
    [2479, 2479, 2476, 2471, 2472, 2473],
    'static legacy atlas resources may render the proven display digits',
  );
  assert.deepEqual(fields(dynamic.imageTextPreview, 'dynamicFields'), ['text']);
  assert.match(dynamic.raw, /<\$STR\(N\$VALUE\)>/i,
    'the original dynamic source expression must remain auditable');
  assert.deepEqual(fields(invalidAsset.imageTextPreview, 'invalidFields'), ['archive', 'image']);
  assert.equal(invalidAsset.assetRef, undefined);
  assert.deepEqual(invalidAsset.imageTextPreview?.glyphs, []);
  assert.deepEqual(fields(invalidText.imageTextPreview, 'invalidFields'), ['text']);
  assert.deepEqual(invalidText.imageTextPreview?.glyphs, []);
}

const failures = [];
for (const [name, test] of [
  ['new-panel TextAtlas strict fields', testNewPanelAtlasStrictFields],
  ['traditional TextAtlas catalog and digits', testTraditionalTextAtlasCatalogAndDigits],
]) {
  try { test(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error.message || error}`); }
}

if (failures.length) {
  console.error('textatlas-strict-runtime.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('textatlas-strict-runtime.test.js: PASS');
}
