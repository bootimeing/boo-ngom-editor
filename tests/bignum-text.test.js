const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

const memoX = 11;
const memoY = 13;

function parse(statements, actStatements = ['MOV N1 10000000000']) {
  const source = [
    '[@main]',
    '#ACT',
    ...actStatements,
    '#SAY',
    ...statements,
  ].join('\n');
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/bignum-text.txt',
    fileName: 'bignum-text.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\bignum-text.txt',
    documentVersion: 1,
    engine: 'GEE',
    engineLabel: '翎风引擎',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(memoX, memoY),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GEE'),
  });
}

function bigNumElement(model) {
  return model.pages[0].elements.find(element => /^<BigNum:/i.test(element.raw));
}

function visibleText(element) {
  return (element.textPreview?.lines || [])
    .flat()
    .map(run => run.text || '')
    .join('');
}

function testDocumentedBigNumCatalogAndStaticTextModel() {
  const model = parse([
    '<BigNum:1234567891234567:73:91:{FColor=249;FSize=19;FName=微软雅黑}>',
  ]);
  const element = bigNumElement(model);
  assert.ok(element, 'documented BigNum markup must create a typed model element');
  assert.deepEqual({
    kind: element.kind,
    unsupported: model.pages[0].unsupportedStatements.some(statement => /<BigNum:/i.test(statement)),
  }, {
    kind: 'text',
    unsupported: false,
  }, 'BigNum must be a typed text control and must leave unsupportedStatements');
  assert.notEqual(element.statementId, 'unsupported');

  const catalog = buildDialogStatementCatalog(staticLanguage, 'GEE');
  const schema = catalog.find(candidate => candidate.token.toUpperCase() === '<BIGNUM');
  assert.ok(schema, 'GEE/LFM <BigNum:...> must be present in the Ctrl+F12 statement catalog');
  for (const engine of ['GOM', '996PC']) {
    assert.equal(
      buildDialogStatementCatalog(staticLanguage, engine)
        .some(candidate => candidate.token.toUpperCase() === '<BIGNUM'),
      false,
      `${engine} must not inherit the GEE/LFM-only BigNum markup`
    );
  }
  assert.equal(schema.syntax, 'positional');
  assert.equal(schema.textParameter, 1, 'BigNum parameter 1 is the numeric display source');
  assert.equal(schema.xParameter, 2);
  assert.equal(schema.yParameter, 3);

  assert.equal(element.coordinateMode, 'relative', 'the documented token has no &, so memo offsets apply');
  assert.equal(element.x?.sourceValue, 73);
  assert.equal(element.y?.sourceValue, 91);
  assert.equal(element.x?.displayValue, 73 + memoX);
  assert.equal(element.y?.displayValue, 91 + memoY);
  assert.equal(element.layoutX, 73 + memoX);
  assert.equal(element.layoutY, 91 + memoY);
  assert.ok(element.textPreview, 'BigNum must use a styled text preview');
  assert.equal(element.textPreview.color, '#ff0000', 'FColor=249 must remain visibly applied');
  assert.equal(element.textPreview.fontSize, 19, 'FSize must remain visibly applied');
  assert.equal(
    element.textPreview.fontFamily || element.textPreview.fontName,
    '微软雅黑',
    'FName must be retained as a renderable font family'
  );
  assert.ok(visibleText(element), 'BigNum must draw non-empty text');
  assert.doesNotMatch(visibleText(element), /^<BigNum:/i, 'the raw command is not the visible control');
  assert.match(element.warning || '', /Partial simulation/i,
    'without the client unit configuration, BigNum must be classified as Partial simulation');
  assert.match(element.warning || '', /最低显示单位|单位阈值|单位配置/,
    'the model must expose the evidence-blocked unit-threshold boundary');
  assert.equal(
    model.pages[0].unsupportedStatements.some(statement => /<BigNum:/i.test(statement)),
    false,
    'recognized BigNum markup must leave unsupportedStatements'
  );
}

function testResolvedBigNumUsesProvenStaticValue() {
  const model = parse([
    '<BigNum:<$STR(N1)>:133:141:{FColor=249;FSize=18;FName=宋体}>',
  ]);
  const element = bigNumElement(model);
  assert.ok(element, 'source-bound BigNum must remain a recognized typed text element');
  assert.equal(element.kind, 'text');
  assert.equal(element.x?.sourceValue, 133);
  assert.equal(element.y?.sourceValue, 141);
  assert.equal(element.x?.displayValue, 133 + memoX);
  assert.equal(element.y?.displayValue, 141 + memoY);
  const text = visibleText(element);
  assert.equal(text, '10000000000',
    'a direct constant MOV on the selected path is statically proven and must be visible');
  assert.equal(element.textPreview?.textValueStatus, 'resolved-static');
  assert.ok(element.textPreview?.resolvedFields?.includes('text'));
  assert.equal(Boolean(element.textPreview?.dynamicFields?.includes('text')), false);
  assert.match(element.raw, /<\$STR\(N1\)>/i,
    'Inspector/source routing must retain the original BigNum expression');
  assert.match(element.warning || '', /Partial simulation/i);
  assert.equal(
    model.pages[0].unsupportedStatements.some(statement => /<BigNum:/i.test(statement)),
    false
  );
}

function testUnknownBigNumUsesNeutralNumericPlaceholder() {
  const model = parse([
    '<BigNum:<$STR(N1)>:133:141:{FColor=249;FSize=18;FName=宋体}>',
  ], []);
  const element = bigNumElement(model);
  assert.ok(element);
  assert.equal(visibleText(element), '0');
  assert.equal(element.textPreview?.textValueStatus, 'runtime-placeholder');
  assert.ok(element.textPreview?.dynamicFields?.includes('text'));
  assert.equal(Boolean(element.textPreview?.invalidFields?.includes('simplify-number')), false);
  assert.match(element.raw, /<\$STR\(N1\)>/i);
}

testDocumentedBigNumCatalogAndStaticTextModel();
testResolvedBigNumUsesProvenStaticValue();
testUnknownBigNumUsesNeutralNumericPlaceholder();
console.log('bignum-text.test.js: PASS');
