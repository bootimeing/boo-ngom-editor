const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

function parseMenuItems(lines, before = []) {
  const source = ['[@main]', '#ACT', ...before, '#SAY', ...lines].join('\n');
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/menuitem-strict-assets.txt',
    fileName: 'menuitem-strict-assets.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\menuitem-strict-assets.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
}

function byId(model, id) {
  const element = model.pages[0].elements.find(candidate => (
    candidate.statementId === 'newui-menuitem-996pc'
      && new RegExp(`(?:\\||<)id=${id}(?:\\||>)`, 'i').test(candidate.raw || '')
  ));
  assert.ok(element, `fixture ${id} was not recognized as MenuItem`);
  // The source parser owns the stable element identity. Retaining the source
  // marker separately avoids assuming it will mirror the optional 996PC id.
  element.fixtureId = id;
  return element;
}

function diagnostic(element, field) {
  const value = (element.menuPreview?.assetDiagnostics || [])
    .find(candidate => candidate.field === field);
  assert.ok(value, `${element.id}/${field} has no typed asset diagnostic`);
  return value;
}

function assertionFor(element, field, expected) {
  const actual = diagnostic(element, field);
  assert.equal(actual.sourceStatus, expected.status,
    `${element.id}/${field} source status expected ${expected.status}, got ${actual.sourceStatus}`);
  assert.equal(actual.status, expected.status,
    `${element.id}/${field} expected ${expected.status}, got ${actual.status}`);
  if (expected.assetRef) {
    assert.deepEqual(actual.assetRef, expected.assetRef,
      `${element.id}/${field} does not retain its proven/default asset reference`);
  } else {
    assert.equal(actual.assetRef, undefined,
      `${element.id}/${field} ${expected.status} must not carry a requestable reference`);
  }
}

function layersByRole(element) {
  return new Map((element.assetLayers || []).map(layer => [layer.role, layer.assetRef]));
}

function testPerFieldAssetStatusAndNoFallbackBorrowing() {
  const model = parseMenuItems([
    // Omitted fields use the documented preview defaults, including the arrow
    // selected from a statically known direction.
    '<MenuItem|id=DEFAULT_DOWN|x=10|y=10|itemname=甲#乙|select=甲|direction=0>',
    '<MenuItem|id=DEFAULT_UP|x=10|y=50|itemname=甲#乙|select=甲|direction=1|img=|arrowimg=|selectimg=|listimg=>',
    '<MenuItem|id=STATIC|x=10|y=90|itemname=甲#乙|select=甲|direction=0|img=CustomUI-2100|arrowimg=CustomUI-1449|selectimg=CustomUI-2048|listimg=CustomUI-2101>',
    '<MenuItem|id=INVALID|x=10|y=130|itemname=甲#乙|select=甲|direction=0|img=bad|arrowimg=-1|selectimg=1.5|listimg=garbage>',
    '<MenuItem|id=DYNAMIC|x=10|y=170|itemname=甲#乙|select=甲|direction=<$STR(N$DIR)>|img=<$STR(N$IMG)>|arrowimg=<$STR(N$ARROW)>|selectimg=<$STR(N$SELECT)>|listimg=<$STR(N$LIST)>>',
    '<MenuItem|id=BAD_DIRECTION|x=10|y=210|itemname=甲#乙|select=甲|direction=9>',
  ], [
    // If source binding accidentally trusts MOV values, these would become
    // visually plausible positive cache requests. They must remain unknown.
    'MOV N$DIR 1',
    'MOV N$IMG 2999',
    'MOV N$ARROW 2444',
    'MOV N$SELECT 2777',
    'MOV N$LIST 2888',
  ]);

  const defaultDown = byId(model, 'DEFAULT_DOWN');
  const defaultUp = byId(model, 'DEFAULT_UP');
  const stat = byId(model, 'STATIC');
  const invalid = byId(model, 'INVALID');
  const dynamic = byId(model, 'DYNAMIC');
  const badDirection = byId(model, 'BAD_DIRECTION');

  for (const element of [defaultDown, defaultUp]) {
    assertionFor(element, 'img', { status: 'default', assetRef: { archiveName: 'NewopUI', imageIndex: 2000 } });
    assertionFor(element, 'selectimg', { status: 'default', assetRef: { archiveName: 'NewopUI', imageIndex: 2047 } });
    assertionFor(element, 'listimg', { status: 'default', assetRef: { archiveName: 'NewopUI', imageIndex: 2000 } });
  }
  assertionFor(defaultDown, 'arrowimg', { status: 'default', assetRef: { archiveName: 'NewopUI', imageIndex: 1448 } });
  assertionFor(defaultUp, 'arrowimg', { status: 'default', assetRef: { archiveName: 'NewopUI', imageIndex: 1451 } });

  assertionFor(stat, 'img', { status: 'static', assetRef: { archiveName: 'CustomUI', imageIndex: 2100 } });
  assertionFor(stat, 'arrowimg', { status: 'static', assetRef: { archiveName: 'CustomUI', imageIndex: 1449 } });
  assertionFor(stat, 'selectimg', { status: 'static', assetRef: { archiveName: 'CustomUI', imageIndex: 2048 } });
  assertionFor(stat, 'listimg', { status: 'static', assetRef: { archiveName: 'CustomUI', imageIndex: 2101 } });

  for (const field of ['img', 'arrowimg', 'selectimg', 'listimg']) {
    assertionFor(invalid, field, { status: 'invalid' });
    assertionFor(dynamic, field, { status: 'dynamic' });
  }
  assertionFor(badDirection, 'img', { status: 'default', assetRef: { archiveName: 'NewopUI', imageIndex: 2000 } });
  assertionFor(badDirection, 'arrowimg', { status: 'invalid' });
  assertionFor(badDirection, 'selectimg', { status: 'default', assetRef: { archiveName: 'NewopUI', imageIndex: 2047 } });
  assertionFor(badDirection, 'listimg', { status: 'default', assetRef: { archiveName: 'NewopUI', imageIndex: 2000 } });

  for (const [element, fields] of [
    [invalid, ['img', 'arrowimg', 'selectimg', 'listimg']],
    [dynamic, ['img', 'arrowimg', 'selectimg', 'listimg']],
    [badDirection, ['arrowimg']],
  ]) {
    const layers = layersByRole(element);
    const roleFor = { img: undefined, arrowimg: 'arrow', selectimg: 'selected', listimg: 'list-background' };
    for (const field of fields) {
      const role = roleFor[field];
      const reference = role ? layers.get(role) : element.assetRef;
      assert.equal(reference, undefined,
        `${element.id}/${field} ${diagnostic(element, field).status} borrowed a fallback/cache reference`);
    }
  }
  assert.doesNotMatch(JSON.stringify(dynamic), /2999|2444|2777|2888/,
    'dynamic MenuItem assets borrowed current MOV numeric values');
  assert.match(
    dynamic.warning || '',
    /动态.*不借用|不借用.*动态|源码含运行时表达式|未确定文字显示|未确定数量显示/,
    'the source uncertainty must be visible to the user');
  assert.match(invalid.warning || '', /无效/,
    'invalid asset fields must have a visible boundary');
}

try {
  testPerFieldAssetStatusAndNoFallbackBorrowing();
  console.log('menuitem-strict-assets.test.js: PASS');
} catch (error) {
  console.error('menuitem-strict-assets.test.js: RED FAILURE');
  console.error(`- ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
}
