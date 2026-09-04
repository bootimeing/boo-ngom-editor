const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

// Evidence used by this red test:
// - 996PC manual `图片Img.md` documents opacity=0..255 (default 255), grey,
//   bg, esc, move, reset, show=0..4, layerid, loadDelay, hideMain,
//   forbidBagEquip, scale9l/r/t/b and bagPos.
// - The official red-dot-system example additionally puts reload=1 and
//   img=public/bg_npc_01.png on Img.
// - The manuals do not publish how a public/... path is rooted or loaded.
//   Ctrl+F12 must therefore classify it as Evidence-blocked, not feed it to
//   the archive cache and not turn ../ segments into a filesystem request.

const RUNTIME_FIELDS = [
  'opacity',
  'gray',
  'background',
  'escape-close',
  'move',
  'reset',
  'load-delay',
  'hide-main',
  'forbid-bag-equip',
  'bag-position',
  'reload',
  'show-position',
  'layer-id',
  'scale9-left',
  'scale9-right',
  'scale9-top',
  'scale9-bottom',
];

function parseImgFixtures() {
  const source = [
    '[@main]',
    '#ACT',
    'MOV N$IMG_VALUE 1',
    'MOV N$IMG_OPACITY 128',
    'MOV N$IMG_SHOW 4',
    'MOV N$IMG_LAYER 1000',
    'MOV N$IMG_SCALE 10',
    '#SAY',
    '<Img|id=IMG_DEFAULT|x=10|y=10|wil=NewopUI|pcimg=108>',
    '<Img|id=IMG_STATIC_ZERO|x=20|y=20|width=180|height=120|wil=NewopUI|pcimg=108|opacity=0|grey=1|bg=1|esc=1|move=1|reset=1|loadDelay=1|hideMain=1|forbidBagEquip=1|bagPos=1|reload=1|show=4|layerid=1000|scale9l=10|scale9r=11|scale9t=12|scale9b=13>',
    '<Img|id=IMG_STATIC_FULL|x=30|y=30|wil=NewopUI|pcimg=108|opacity=255|grey=0|bg=0|esc=0|move=0|reset=0|loadDelay=0|hideMain=0|forbidBagEquip=0|bagPos=0|reload=0|show=0|layerid=0|scale9l=0|scale9r=0|scale9t=0|scale9b=0>',
    '<Img|id=IMG_DYNAMIC|x=40|y=40|wil=NewopUI|pcimg=108|opacity=<$STR(N$IMG_OPACITY)>|grey=<$STR(N$IMG_VALUE)>|bg=<$STR(N$IMG_VALUE)>|esc=<$STR(N$IMG_VALUE)>|move=<$STR(N$IMG_VALUE)>|reset=<$STR(N$IMG_VALUE)>|loadDelay=<$STR(N$IMG_VALUE)>|hideMain=<$STR(N$IMG_VALUE)>|forbidBagEquip=<$STR(N$IMG_VALUE)>|bagPos=<$STR(N$IMG_VALUE)>|reload=<$STR(N$IMG_VALUE)>|show=<$STR(N$IMG_SHOW)>|layerid=<$STR(N$IMG_LAYER)>|scale9l=<$STR(N$IMG_SCALE)>|scale9r=<$STR(N$IMG_SCALE)>|scale9t=<$STR(N$IMG_SCALE)>|scale9b=<$STR(N$IMG_SCALE)>>',
    '<Img|id=IMG_INVALID_LOW|x=50|y=50|wil=NewopUI|pcimg=108|opacity=-1>',
    '<Img|id=IMG_INVALID_HIGH|x=60|y=60|wil=NewopUI|pcimg=108|opacity=256|grey=2|bg=-1|esc=2|move=-1|reset=2|loadDelay=2|hideMain=-1|forbidBagEquip=3|bagPos=2|reload=-1|show=5|layerid=not-a-number|scale9l=-1|scale9r=-2|scale9t=-3|scale9b=-4>',
    '<Img|id=IMG_DIRECT|x=70|y=70|img=public/bg_npc_01.png|bg=1|reset=1|show=0|layerid=1234|loadDelay=1|reload=1>',
    '<Img|id=IMG_TRAVERSAL|x=80|y=80|img=public/../../outside/secret.png|bg=1>',
  ].join('\n');
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/img-strict-runtime.txt',
    fileName: 'img-strict-runtime.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\img-strict-runtime.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
}

function controlsById(model) {
  return new Map(model.pages[0].elements.map(element => [element.containerElementId, element]));
}

function requireFields(actual, expected, message) {
  const values = new Set(actual || []);
  const missing = expected.filter(field => !values.has(field));
  assert.deepEqual(missing, [], `${message}; missing=${missing.join(',')}; actual=${JSON.stringify(actual)}`);
}

function requireLocalOnly(preview, warning) {
  assert.ok(
    preview?.localOnly === true || preview?.runtimeScope === 'local-only',
    `Img runtime fields must be explicitly local-only: ${JSON.stringify(preview)}`
  );
  assert.match(warning || '', /仅展示|局部模拟|仅本地预览/);
  assert.match(warning || '', /不执行|不控制客户端|不会真实/);
}

function collectFailures() {
  const failures = [];
  const check = (name, callback) => {
    try {
      callback();
    } catch (error) {
      failures.push(`${name}: ${error && error.message ? error.message : String(error)}`);
    }
  };
  const model = parseImgFixtures();
  const controls = controlsById(model);
  const defaults = controls.get('IMG_DEFAULT');
  const zero = controls.get('IMG_STATIC_ZERO');
  const full = controls.get('IMG_STATIC_FULL');
  const dynamic = controls.get('IMG_DYNAMIC');
  const low = controls.get('IMG_INVALID_LOW');
  const high = controls.get('IMG_INVALID_HIGH');
  const direct = controls.get('IMG_DIRECT');
  const traversal = controls.get('IMG_TRAVERSAL');

  check('all documented Img fixtures remain typed', () => {
    for (const [id, element] of controls) {
      if (!id?.startsWith('IMG_')) continue;
      assert.equal(element.imagePreview?.variant, 'newui-img-996pc', `${id} is not typed Img`);
      assert.equal(element.kind, 'image', `${id} kind`);
    }
    assert.equal(model.pages[0].unsupportedStatements.length, 0);
  });

  check('explicit endpoint values and runtime fields are retained without coercion', () => {
    assert.ok(zero?.imagePreview && full?.imagePreview, 'static endpoint fixtures were not parsed');
    assert.deepEqual({
      opacity: zero.imagePreview.opacity,
      gray: zero.imagePreview.gray,
      background: zero.imagePreview.background,
      escapeClose: zero.imagePreview.escapeClose,
      movable: zero.imagePreview.movable,
      resetPosition: zero.imagePreview.resetPosition,
      loadDelay: zero.imagePreview.loadDelay,
      hideMain: zero.imagePreview.hideMain,
      forbidBagEquip: zero.imagePreview.forbidBagEquip,
      bagPosition: zero.imagePreview.bagPosition,
      reload: zero.imagePreview.reload,
      showPosition: zero.imagePreview.showPosition,
      layerId: zero.imagePreview.layerId,
      scale9: zero.imagePreview.scale9,
    }, {
      opacity: 0,
      gray: true,
      background: true,
      escapeClose: true,
      movable: true,
      resetPosition: true,
      loadDelay: true,
      hideMain: true,
      forbidBagEquip: true,
      bagPosition: 1,
      reload: true,
      showPosition: 4,
      layerId: 1000,
      scale9: { left: 10, right: 11, top: 12, bottom: 13 },
    });
    assert.equal(full.imagePreview.opacity, 255);
    assert.equal(full.imagePreview.gray, false);
    assert.equal(full.imagePreview.background, false);
    assert.equal(full.imagePreview.showPosition, 0);
    assert.equal(full.imagePreview.layerId, 0);
    requireLocalOnly(zero.imagePreview, zero.warning);
  });

  check('missing Img runtime keys are classified as defaults', () => {
    assert.ok(defaults?.imagePreview, 'default fixture was not parsed');
    requireFields(defaults.imagePreview.defaultFields, RUNTIME_FIELDS, 'Img defaultFields');
    assert.equal(defaults.imagePreview.opacity, 255, 'documented opacity default');
    assert.equal(defaults.imagePreview.gray, false, 'documented grey default');
    assert.deepEqual(defaults.imagePreview.dynamicFields || [], []);
    assert.deepEqual(defaults.imagePreview.invalidFields || [], []);
    assert.match(defaults.warning || '', /默认|未填写|缺省/);
  });

  check('dynamic Img runtime keys stay dynamic and never borrow MOV values', () => {
    assert.ok(dynamic?.imagePreview, 'dynamic fixture was not parsed');
    requireFields(dynamic.imagePreview.dynamicFields, RUNTIME_FIELDS, 'Img dynamicFields');
    assert.notEqual(dynamic.imagePreview.opacity, 128, 'dynamic opacity borrowed MOV');
    assert.notEqual(dynamic.imagePreview.showPosition, 4, 'dynamic show borrowed MOV');
    assert.notEqual(dynamic.imagePreview.layerId, 1000, 'dynamic layerid borrowed MOV');
    assert.notEqual(dynamic.imagePreview.gray, true, 'dynamic grey borrowed MOV');
    assert.notEqual(dynamic.imagePreview.background, true, 'dynamic bg borrowed MOV');
    assert.equal(dynamic.imagePreview.scale9, undefined, 'dynamic scale9 borrowed MOV');
    assert.match(dynamic.warning || '', /动态|运行时/);
    assert.match(dynamic.warning || '', /不借用.*当前值|当前值.*不借用/);
  });

  check('invalid opacity, binary, show, layerid and scale9 values are rejected', () => {
    assert.ok(low?.imagePreview && high?.imagePreview, 'invalid fixtures were not parsed');
    requireFields(low.imagePreview.invalidFields, ['opacity'], 'negative opacity invalidFields');
    requireFields(high.imagePreview.invalidFields, RUNTIME_FIELDS, 'high/invalid Img fields');
    assert.notEqual(low.imagePreview.opacity, 0, 'opacity=-1 was silently clamped to 0');
    assert.notEqual(high.imagePreview.opacity, 255, 'opacity=256 was silently clamped to 255');
    assert.notEqual(high.imagePreview.gray, true, 'grey=2 was coerced to true');
    assert.notEqual(high.imagePreview.background, true, 'bg=-1 was coerced to true');
    assert.equal(high.imagePreview.scale9, undefined, 'negative scale9 was clamped and rendered');
    assert.match(`${low.warning || ''};${high.warning || ''}`, /opacity.*0\s*(?:\.\.|-|~|至)\s*255|0\s*(?:\.\.|-|~|至)\s*255.*opacity/i);
    assert.match(high.warning || '', /0\s*\/\s*1/);
    assert.match(high.warning || '', /show.*0\s*(?:\.\.|-|~|至)\s*4|0\s*(?:\.\.|-|~|至)\s*4.*show/i);
    assert.match(high.warning || '', /scale9.*非负|非负.*scale9/i);
  });

  check('public direct path is typed as Evidence-blocked and bypasses archive cache', () => {
    assert.ok(direct?.imagePreview, 'direct-path fixture was not parsed');
    assert.deepEqual(direct.imagePreview.directPathPreview, {
      raw: 'public/bg_npc_01.png',
      normalized: 'public/bg_npc_01.png',
      status: 'evidence-blocked',
    });
    assert.equal(direct.assetRef, undefined, 'direct path must not become an archive cache request');
    assert.notEqual(direct.asset?.status, 'missing');
    assert.doesNotMatch(JSON.stringify(direct), /素材未缓存|缓存已失效/);
    assert.match(direct.warning || '', /Evidence-blocked/i);
    assert.match(direct.warning || '', /直接路径|public\/bg_npc_01\.png/i);
    assert.match(direct.warning || '', /根目录|加载规则|未公开|证据不足/);
  });

  check('direct path traversal is blocked before provider hydration', () => {
    assert.ok(traversal?.imagePreview, 'traversal fixture was not parsed');
    assert.equal(traversal.imagePreview.directPathPreview?.raw, 'public/../../outside/secret.png');
    assert.ok(
      ['blocked', 'invalid'].includes(traversal.imagePreview.directPathPreview?.status),
      `status=${traversal.imagePreview.directPathPreview?.status}`
    );
    assert.equal(traversal.imagePreview.directPathPreview?.normalized, undefined);
    assert.equal(traversal.assetRef, undefined, 'traversal path must never reach archive/provider lookup');
    assert.doesNotMatch(JSON.stringify(traversal.assetRef || {}), /outside|secret/i);
    assert.match(traversal.warning || '', /路径穿越|\.\.|blocked|拒绝/i);
  });

  return failures;
}

const failures = collectFailures();
if (failures.length > 0) {
  console.error('img-strict-runtime.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('img-strict-runtime.test.js: PASS');
}
