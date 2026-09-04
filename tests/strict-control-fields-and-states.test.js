const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

// Primary local-manual evidence, rechecked from the 996PC CHM on 2026-08-29.
//
// CHM SHA-256
//   DDA97B230FA2CE2F85A6104E8F21D4DF5C8708AE6107871CB2EBF2E4B57673E5
//
// 新NPC界面写法/文字.htm
//   extracted page SHA-256
//   57B115A276F37089D5E59E3CB74392BEDAF3FBE73CB860928801EF9951E04B7D
//   Text documents size=14/16/18/20 and outline/outlinecolor. RText
//   documents text, size and color. This test keeps the implementation's
//   broader positive-size contract, but never accepts zero/negative sizes.
//
// 新NPC界面写法/按钮.htm
//   extracted page SHA-256
//   B79DBAA0A29921D8ECCA8F1435915CB528229B8CEF39F33DE41B97DD74ADFAE2
//   pcnimg/pcmimg/pcpimg are normal/hover/pressed; grey accepts only 0/1.
//
// 新NPC界面写法/复选框CheckBox.htm
//   extracted page SHA-256
//   4FCFE7ECA20FABBBDEBBF951B7667B0B82DF71A012B4961B2A72B53198641330
//   pcnimg is normal/unselected and pcpimg is selected.
//
// 游戏功能详解/脚本中使用图标功能[!].htm
//   extracted page SHA-256
//   A6B076D589C8A958FFCB03C9235AE3643927BD14120497DE111336C7ABE47543
//   IMGEX U/H/D are normal/hover/pressed.

const SOURCE = [
  '[@main]',
  '#ACT',
  'MOV N$SIZE 18',
  'MOV N$OUTLINE 2',
  'MOV N$NORMAL 140',
  'MOV N$HOVER 141',
  'MOV S$TEXT 动态文字',
  'MOV S$COLOR 250',
  'MOV S$WIL NewopUI',
  '#SAY',
  '<Text|id=TEXT_VALID|x=10|y=10|text=合法文字|color=255|size=18|outline=0|outlinecolor=251>',
  '<Text|id=TEXT_BAD_NEGATIVE|x=10|y=40|text=负数字段|size=-1|outline=-2>',
  '<Text|id=TEXT_BAD_ZERO|x=10|y=70|text=零字号|size=0|outline=0>',
  '<Text|id=TEXT_DYNAMIC|x=10|y=100|text=<$STR(S$TEXT)>|color=<$STR(S$COLOR)>|size=<$STR(N$SIZE)>>',
  '<RText|id=RTEXT_DYNAMIC|x=10|y=130|text=<$STR(S$TEXT)>|color=<$STR(S$COLOR)>|size=<$STR(N$SIZE)>>',
  '<RText|id=RTEXT_BAD_ZERO|x=10|y=160|text=坏富文本|color=250|size=0>',
  '<Button|id=BUTTON_STATIC|x=220|y=10|wil=NewopUI|pcnimg=140|pcmimg=141|pcpimg=142|text=静态按钮|size=14|outline=0|grey=0|link=@static>',
  '<Button|id=BUTTON_GRAY_ONE|x=220|y=40|wil=NewopUI|pcnimg=140|pcmimg=141|pcpimg=142|text=灰按钮|size=14|outline=1|grey=1|link=@gray>',
  '<Button|id=BUTTON_MIXED|x=220|y=70|wil=NewopUI|pcnimg=140|pcmimg=<$STR(N$HOVER)>|pcpimg=-1|text=混合按钮|size=0|outline=-1|grey=2|link=@mixed>',
  '<Button|id=BUTTON_BAD_GRAY_NEG|x=220|y=100|wil=NewopUI|pcnimg=140|pcmimg=141|pcpimg=142|text=负灰度|size=14|grey=-1|link=@badneg>',
  '<Button|id=BUTTON_BAD_GRAY_DECIMAL|x=220|y=130|wil=NewopUI|pcnimg=140|pcmimg=141|pcpimg=142|text=小数灰度|size=14|grey=0.5|link=@baddecimal>',
  '<Button|id=BUTTON_BAD_GRAY_TEXT|x=220|y=160|wil=NewopUI|pcnimg=140|pcmimg=141|pcpimg=142|text=文本灰度|size=14|grey=bad|link=@badtext>',
  '<Button|id=BUTTON_MISSING|x=420|y=10|wil=NewopUI|text=缺少状态|size=14|link=@missing>',
  '<Button|id=BUTTON_DYNAMIC_NORMAL|x=420|y=40|wil=NewopUI|pcnimg=<$STR(N$NORMAL)>|pcmimg=141|pcpimg=142|text=动态主图|size=14|link=@dynamicnormal>',
  '<Button|id=BUTTON_DYNAMIC_ARCHIVE|x=420|y=70|wil=<$STR(S$WIL)>|pcnimg=140|pcmimg=141|pcpimg=142|text=动态资源|size=14|link=@dynamicarchive>',
  '<CheckBox|id=CHECK_STATIC|x=420|y=110|checkboxid=N0|wil=NewopUI|pcnimg=145|pcpimg=146|default=0>',
  '<CheckBox|id=CHECK_MIXED|x=450|y=110|checkboxid=N1|wil=NewopUI|pcnimg=145|pcpimg=<$STR(N$HOVER)>|default=0>',
  '<CheckBox|id=CHECK_INVALID|x=480|y=110|checkboxid=N2|wil=NewopUI|pcnimg=-1|pcpimg=1.5|default=0>',
  '<CheckBox|id=CHECK_MISSING|x=510|y=110|checkboxid=N3|wil=NewopUI|default=0>',
  '<IMGEX:3:283:284:285:20:220/@imgex-static>',
  '<IMGEX:3:283:<$STR(N$HOVER)>:-1:180:220/@imgex-mixed>',
  '<IMGEX:3:283:::340:220/@imgex-missing>',
  '<IMGEX:3:<$STR(N$NORMAL)>:284:285:500:220/@imgex-dynamic-normal>',
].join('\r\n');

function parseFixtures() {
  return parseNpcDialogDocument(SOURCE, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/strict-control-fields-and-states.txt',
    fileName: 'strict-control-fields-and-states.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\strict-control-fields-and-states.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: SOURCE.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
}

function controlsById(model) {
  return new Map(model.pages[0].elements
    .filter(element => element.containerElementId)
    .map(element => [element.containerElementId, element]));
}

function imgEx(model, link) {
  return model.pages[0].elements.find(element => (
    element.statementId === 'imgex-relative-996pc'
      && element.raw.includes(`/@${link}`)
  ));
}

function fields(preview, key) {
  return [...new Set(preview?.[key] || [])].sort();
}

function flattened(preview) {
  return (preview?.lines || [])
    .map(line => (line || []).map(run => run.text || '').join(''))
    .join('\n');
}

function diagnostic(element, role) {
  return (element?.assetStateDiagnostics || []).find(candidate => candidate.role === role);
}

function assertDiagnostic(element, role, status, assetRef) {
  const value = diagnostic(element, role);
  assert.ok(value, `${element?.containerElementId || element?.raw}: missing ${role} diagnostic`);
  assert.equal(value.status, status, `${element?.containerElementId || element?.raw}: ${role} status`);
  if (status === 'static') {
    assert.deepEqual(value.assetRef, assetRef, `${role} static assetRef`);
  } else {
    assert.equal(value.assetRef, undefined, `${role} ${status} must not carry a resolver reference`);
  }
}

function assertStateRoles(element, roles) {
  assert.deepEqual(
    (element?.assetStateDiagnostics || []).map(value => value.role),
    roles,
    `${element?.containerElementId || element?.raw}: every documented state needs one diagnostic`
  );
}

function requireInvalidOnly(preview, expected) {
  const invalid = fields(preview, 'invalidFields');
  const dynamic = fields(preview, 'dynamicFields');
  for (const field of expected) {
    assert.ok(invalid.includes(field), `${field} was not classified invalid: ${JSON.stringify(preview)}`);
    assert.ok(!dynamic.includes(field), `${field} was mislabeled dynamic: ${JSON.stringify(preview)}`);
  }
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
  const model = parseFixtures();
  const controls = controlsById(model);

  check('all strict-field and state fixtures remain typed', () => {
    const expected = [
      'TEXT_VALID', 'TEXT_BAD_NEGATIVE', 'TEXT_BAD_ZERO', 'TEXT_DYNAMIC',
      'RTEXT_DYNAMIC', 'RTEXT_BAD_ZERO',
      'BUTTON_STATIC', 'BUTTON_GRAY_ONE', 'BUTTON_MIXED', 'BUTTON_BAD_GRAY_NEG',
      'BUTTON_BAD_GRAY_DECIMAL', 'BUTTON_BAD_GRAY_TEXT', 'BUTTON_MISSING',
      'BUTTON_DYNAMIC_NORMAL', 'BUTTON_DYNAMIC_ARCHIVE',
      'CHECK_STATIC', 'CHECK_MIXED', 'CHECK_INVALID', 'CHECK_MISSING',
    ];
    for (const id of expected) assert.ok(controls.has(id), `${id} was discarded`);
    for (const link of ['imgex-static', 'imgex-mixed', 'imgex-missing', 'imgex-dynamic-normal']) {
      assert.ok(imgEx(model, link), `IMGEX ${link} was discarded`);
    }
    assert.equal(model.pages[0].unsupportedStatements.length, 0);
  });

  check('positive font size and non-negative outline endpoints are retained', () => {
    const text = controls.get('TEXT_VALID')?.textPreview;
    const button = controls.get('BUTTON_STATIC')?.textPreview;
    assert.equal(text?.fontSize, 18);
    assert.equal(text?.outlineWidth, 0);
    assert.equal(button?.fontSize, 14);
    assert.equal(button?.outlineWidth, 0);
    assert.deepEqual(fields(text, 'invalidFields'), []);
    assert.deepEqual(fields(button, 'invalidFields'), []);
  });

  check('zero/negative font size and negative outline are invalid, never dynamic or clamped', () => {
    const negative = controls.get('TEXT_BAD_NEGATIVE')?.textPreview;
    const zero = controls.get('TEXT_BAD_ZERO')?.textPreview;
    const richZero = controls.get('RTEXT_BAD_ZERO')?.textPreview;
    const button = controls.get('BUTTON_MIXED')?.textPreview;
    requireInvalidOnly(negative, ['font-size', 'outline-width']);
    requireInvalidOnly(zero, ['font-size']);
    requireInvalidOnly(richZero, ['font-size']);
    requireInvalidOnly(button, ['font-size', 'outline-width']);
    assert.equal(negative.fontSize, undefined);
    assert.equal(negative.outlineWidth, undefined, 'outline=-2 was silently clamped to zero');
    assert.equal(zero.fontSize, undefined);
    assert.equal(richZero.fontSize, undefined);
    assert.equal(button.fontSize, undefined);
    assert.equal(button.outlineWidth, undefined, 'Button outline=-1 was silently clamped to zero');
  });

  check('Text and RText apply independently proven text/color/size MOV values', () => {
    const text = controls.get('TEXT_DYNAMIC')?.textPreview;
    const rich = controls.get('RTEXT_DYNAMIC')?.textPreview;
    const expected = ['color', 'font-size', 'text'];
    assert.deepEqual(fields(text, 'resolvedFields'), expected);
    assert.deepEqual(fields(rich, 'resolvedFields'), expected);
    assert.deepEqual(fields(text, 'dynamicFields'), []);
    assert.deepEqual(fields(rich, 'dynamicFields'), []);
    assert.deepEqual(fields(text, 'invalidFields'), []);
    assert.deepEqual(fields(rich, 'invalidFields'), []);
    assert.equal(text.fontSize, 18);
    assert.equal(rich.fontSize, 18);
    assert.equal(flattened(text), '动态文字');
    assert.equal(flattened(rich), '动态文字');
    assert.equal(text.color, '#00ff00');
    assert.equal(rich.color, '#00ff00');
    assert.equal(text.textValueStatus, 'resolved-static');
    assert.equal(rich.textValueStatus, 'resolved-static');
  });

  check('Button grey accepts exactly static 0 and 1', () => {
    assert.equal(controls.get('BUTTON_STATIC')?.textPreview?.gray, false);
    assert.equal(controls.get('BUTTON_GRAY_ONE')?.textPreview?.gray, true);
    for (const id of [
      'BUTTON_MIXED', 'BUTTON_BAD_GRAY_NEG', 'BUTTON_BAD_GRAY_DECIMAL', 'BUTTON_BAD_GRAY_TEXT',
    ]) {
      const preview = controls.get(id)?.textPreview;
      requireInvalidOnly(preview, ['gray']);
      assert.equal(preview.gray, undefined, `${id} coerced an invalid grey value to Boolean`);
    }
  });

  check('Button state diagnostics distinguish static, dynamic, invalid and missing', () => {
    const staticButton = controls.get('BUTTON_STATIC');
    const mixed = controls.get('BUTTON_MIXED');
    const missing = controls.get('BUTTON_MISSING');
    const dynamicNormal = controls.get('BUTTON_DYNAMIC_NORMAL');
    const dynamicArchive = controls.get('BUTTON_DYNAMIC_ARCHIVE');
    for (const element of [staticButton, mixed, missing, dynamicNormal, dynamicArchive]) {
      assertStateRoles(element, ['normal', 'hover', 'pressed']);
    }
    assertDiagnostic(staticButton, 'normal', 'static', { archiveName: 'NewopUI', imageIndex: 140 });
    assertDiagnostic(staticButton, 'hover', 'static', { archiveName: 'NewopUI', imageIndex: 141 });
    assertDiagnostic(staticButton, 'pressed', 'static', { archiveName: 'NewopUI', imageIndex: 142 });
    assertDiagnostic(mixed, 'normal', 'static', { archiveName: 'NewopUI', imageIndex: 140 });
    assertDiagnostic(mixed, 'hover', 'dynamic');
    assertDiagnostic(mixed, 'pressed', 'invalid');
    for (const role of ['normal', 'hover', 'pressed']) assertDiagnostic(missing, role, 'missing');
    assertDiagnostic(dynamicNormal, 'normal', 'dynamic');
    assertDiagnostic(dynamicNormal, 'hover', 'static', { archiveName: 'NewopUI', imageIndex: 141 });
    assertDiagnostic(dynamicNormal, 'pressed', 'static', { archiveName: 'NewopUI', imageIndex: 142 });
    for (const role of ['normal', 'hover', 'pressed']) {
      assertDiagnostic(dynamicArchive, role, 'dynamic');
    }
    assert.equal(dynamicNormal.assetRef, undefined, 'dynamic normal state leaked a primary resolver ref');
    assert.equal(missing.assetRef, undefined, 'missing normal image leaked a partial resolver ref');
    assert.equal(dynamicArchive.assetRef, undefined, 'dynamic archive borrowed MOV and leaked a ref');
  });

  check('IMGEX state diagnostics preserve the three positional state roles', () => {
    const staticImg = imgEx(model, 'imgex-static');
    const mixed = imgEx(model, 'imgex-mixed');
    const missing = imgEx(model, 'imgex-missing');
    const dynamicNormal = imgEx(model, 'imgex-dynamic-normal');
    for (const element of [staticImg, mixed, missing, dynamicNormal]) {
      assertStateRoles(element, ['normal', 'hover', 'pressed']);
    }
    assertDiagnostic(staticImg, 'normal', 'static', { willIndex: 3, imageIndex: 283 });
    assertDiagnostic(staticImg, 'hover', 'static', { willIndex: 3, imageIndex: 284 });
    assertDiagnostic(staticImg, 'pressed', 'static', { willIndex: 3, imageIndex: 285 });
    assertDiagnostic(mixed, 'normal', 'static', { willIndex: 3, imageIndex: 283 });
    assertDiagnostic(mixed, 'hover', 'dynamic');
    assertDiagnostic(mixed, 'pressed', 'invalid');
    assertDiagnostic(missing, 'normal', 'static', { willIndex: 3, imageIndex: 283 });
    assertDiagnostic(missing, 'hover', 'missing');
    assertDiagnostic(missing, 'pressed', 'missing');
    assertDiagnostic(dynamicNormal, 'normal', 'dynamic');
    assertDiagnostic(dynamicNormal, 'hover', 'static', { willIndex: 3, imageIndex: 284 });
    assertDiagnostic(dynamicNormal, 'pressed', 'static', { willIndex: 3, imageIndex: 285 });
    assert.equal(dynamicNormal.assetRef, undefined, 'dynamic IMGEX normal state leaked a resolver ref');
  });

  check('CheckBox state diagnostics distinguish normal and selected independently', () => {
    const staticCheck = controls.get('CHECK_STATIC');
    const mixed = controls.get('CHECK_MIXED');
    const invalid = controls.get('CHECK_INVALID');
    const missing = controls.get('CHECK_MISSING');
    for (const element of [staticCheck, mixed, invalid, missing]) {
      assertStateRoles(element, ['normal', 'selected']);
    }
    assertDiagnostic(staticCheck, 'normal', 'static', { archiveName: 'NewopUI', imageIndex: 145 });
    assertDiagnostic(staticCheck, 'selected', 'static', { archiveName: 'NewopUI', imageIndex: 146 });
    assertDiagnostic(mixed, 'normal', 'static', { archiveName: 'NewopUI', imageIndex: 145 });
    assertDiagnostic(mixed, 'selected', 'dynamic');
    assertDiagnostic(invalid, 'normal', 'invalid');
    assertDiagnostic(invalid, 'selected', 'invalid');
    assertDiagnostic(missing, 'normal', 'missing');
    assertDiagnostic(missing, 'selected', 'missing');
    assert.equal(invalid.assetRef, undefined, 'invalid CheckBox normal state leaked a resolver ref');
    assert.equal(missing.assetRef, undefined, 'missing CheckBox normal state leaked a partial resolver ref');
  });

  check('only static diagnostics are mirrored into legacy resolver-bearing fields', () => {
    for (const element of model.pages[0].elements) {
      const diagnostics = element.assetStateDiagnostics || [];
      if (diagnostics.length === 0) continue;
      const staticRoles = new Set(diagnostics
        .filter(value => value.status === 'static')
        .map(value => value.role));
      if (!staticRoles.has('normal')) assert.equal(element.assetRef, undefined);
      for (const layer of element.assetLayers || []) {
        if (['hover', 'pressed', 'selected'].includes(layer.role)) {
          assert.ok(staticRoles.has(layer.role),
            `${element.containerElementId || element.raw}: ${layer.role} non-static layer leaked assetRef`);
        }
      }
      for (const value of diagnostics) {
        assert.equal(Boolean(value.assetRef), value.status === 'static',
          `${element.containerElementId || element.raw}: ${value.role}/${value.status} ref invariant`);
      }
    }
  });

  return failures;
}

const failures = collectFailures();
if (failures.length > 0) {
  console.error('strict-control-fields-and-states.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('strict-control-fields-and-states.test.js: PASS');
}
