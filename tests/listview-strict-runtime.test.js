const assert = require('node:assert/strict');
const Module = require('node:module');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

// Primary local-help evidence (rechecked 2026-08-31):
//
// - GOM:
//   D:/AI界面/mir-plugin/knowledge/gom/manual/NPC对话框容器.md:129-136,694-741
//   Positional parameter 9 is the 0/1 "remember scroll position" switch.
//   Parameters 10/11 are reserved; default is a zero-based child index.
// - GEE in this extension means the LFM/GEE-compatible language profile:
//   D:/AI界面/mir-plugin/knowledge/lfm/manual/容器.md:67-74
//   Positional parameters 9/10/11 are reserved3/reserved4/reserved5. They must
//   never inherit GOM's remember-position meaning.
// - 996PC new panel:
//   D:/AI界面/mir-plugin/knowledge/996pc/manual/列表容器ListView.md:29-65,69-82
//   direction=1/2, default is one-based (default=8 selects the eighth child),
//   cantouch is 0/1, Slider=1 enables either custom or client-default parts,
//   and all ten custom scrollbar image fields are individually documented.
//   The help calls margin merely numeric and does not publish an integer or
//   non-negative restriction, so this test deliberately preserves -2.5.

const ALL_SCROLL_ROLES = [
  'scrollbar',
  'scroll-start',
  'scroll-start-hover',
  'scroll-start-pressed',
  'scroll-thumb',
  'scroll-thumb-hover',
  'scroll-thumb-pressed',
  'scroll-end',
  'scroll-end-hover',
  'scroll-end-pressed',
];

const failures = [];

function check(name, task) {
  try {
    task();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : String(error)}`);
  }
}

function parse(engine, sayLines, actLines = []) {
  const source = [
    '[@main]',
    ...(actLines.length ? ['#ACT', ...actLines] : []),
    '#SAY',
    ...sayLines,
    '',
  ].join('\r\n');
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/listview-strict-${engine}.txt`,
    fileName: `listview-strict-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\listview-strict-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function list(model, containerId) {
  const value = model.pages[0].elements.find(element => (
    element.containerPreview?.variant === 'list'
    && element.containerElementId === containerId
  ));
  assert.ok(value, `missing ListView ${containerId}`);
  return value;
}

function fields(preview, name) {
  return [...(preview?.[name] || [])].sort();
}

function fieldDiagnostic(preview, field) {
  return (preview?.fieldDiagnostics || []).find(value => value.field === field);
}

function scrollbarDiagnostic(preview, role) {
  return (preview?.scrollbarDiagnostics || []).find(value => value.role === role);
}

function assertField(preview, field, sourceStatus) {
  const diagnostic = fieldDiagnostic(preview, field);
  assert.ok(diagnostic, `missing ${field} field diagnostic`);
  assert.equal(diagnostic.sourceStatus, sourceStatus, `${field} source status`);
  return diagnostic;
}

function assertScrollbar(preview, role, sourceStatus, assetRef) {
  const diagnostic = scrollbarDiagnostic(preview, role);
  assert.ok(diagnostic, `missing ${role} scrollbar diagnostic`);
  assert.equal(diagnostic.sourceStatus, sourceStatus, `${role} source status`);
  if (assetRef) assert.deepEqual(diagnostic.assetRef, assetRef, `${role} asset ref`);
  else assert.equal(diagnostic.assetRef, undefined, `${role} ${sourceStatus} must not carry a ref`);
  return diagnostic;
}

function assertNoScrollbarResolverLayers(element) {
  const roles = new Set(ALL_SCROLL_ROLES);
  const leaked = (element.assetLayers || []).filter(layer => roles.has(layer.role));
  assert.deepEqual(leaked, [], `blocked scrollbar layers leaked: ${JSON.stringify(leaked)}`);
}

function testEngineSpecificPositionNineAndDefaultIndexes() {
  const gom = parse('GOM', [
    '<ListView:~#GOM_STATIC:10:20:70:30:4:2:1:1:7:8:22:85:9:10:11:6:7:8:12:13:14>',
    '<Layout:#GOM_STATIC~#GA:0:0:20:20>',
    '<Layout:#GOM_STATIC~#GB:0:0:20:20>',
    '<Layout:#GOM_STATIC~#GC:0:0:20:20>',
  ]);
  const gomElement = list(gom, 'GOM_STATIC');
  const gp = gomElement.containerPreview;
  assert.equal(gp.requestedDefaultIndex, 2, 'GOM must retain the requested zero-based index');
  assert.equal(gp.effectiveDefaultIndex, 2, 'GOM effective index must be clamped separately');
  assert.equal(gp.rememberScrollPosition, true, 'GOM parameter 9 is rememberScrollPosition');
  assertField(gp, 'remember-scroll-position', 'static');
  assertField(gp, 'reserved-4', 'reserved');
  assertField(gp, 'reserved-5', 'reserved');
  assert.doesNotMatch(gomElement.warning || '', /bounce/i,
    'legacy GOM without bounce must not receive a false bounce warning');

  const gee = parse('GEE', [
    '<ListView:~#GEE_STATIC:10:20:70:30:4:2:1:1:7:8:22:85:9:10:11:6:7:8:12:13:14>',
    '<Layout:#GEE_STATIC~#EA:0:0:20:20>',
    '<Layout:#GEE_STATIC~#EB:0:0:20:20>',
    '<Layout:#GEE_STATIC~#EC:0:0:20:20>',
  ]);
  const geeElement = list(gee, 'GEE_STATIC');
  const ep = geeElement.containerPreview;
  assert.equal(ep.requestedDefaultIndex, 2);
  assert.equal(ep.effectiveDefaultIndex, 2);
  assert.equal(ep.rememberScrollPosition, undefined,
    'GEE/LFM reserved3 must never become GOM rememberScrollPosition');
  assertField(ep, 'reserved-3', 'reserved');
  assertField(ep, 'reserved-4', 'reserved');
  assertField(ep, 'reserved-5', 'reserved');
  assert.doesNotMatch(geeElement.warning || '', /bounce|记录滚动位置/i,
    'GEE/LFM reserved parameters must not invent runtime behavior');

  const pc = parse('996PC', [
    '<ListView|id=PC_INDEX|children={A,B,C}|x=10|y=20|width=70|height=30|direction=2|margin=4|default=8|cantouch=1>',
    '<Layout|id=A|width=20|height=20>',
    '<Layout|id=B|width=20|height=20>',
    '<Layout|id=C|width=20|height=20>',
  ]);
  const pp = list(pc, 'PC_INDEX').containerPreview;
  assert.equal(pp.requestedDefaultIndex, 8,
    '996PC must retain the one-based value written in default=');
  assert.equal(pp.effectiveDefaultIndex, 2,
    '996PC must convert to zero-based and clamp only in the effective field');
  if (pp.defaultIndex !== undefined) {
    assert.equal(pp.defaultIndex, pp.effectiveDefaultIndex,
      'legacy defaultIndex compatibility alias may only mirror effectiveDefaultIndex');
  }
  assertField(pp, 'default', 'static');
}

function testDynamicValuesNeverBorrowMov() {
  const mov = [
    'MOV N$GAP 9',
    'MOV N$DEFAULT 3',
    'MOV N$DIRECTION 1',
    'MOV N$REMEMBER 1',
    'MOV N$TOUCH 1',
    'MOV N$BOUNCE 1',
    'MOV N$SLIDER 1',
    'MOV N$ARCHIVE 22',
    'MOV N$BACKGROUND 991',
  ];
  const gom = parse('GOM', [
    '<ListView:~#GOM_DYNAMIC:0:0:100:40:<$STR(N$GAP)>:<$STR(N$DEFAULT)>:<$STR(N$DIRECTION)>:<$STR(N$REMEMBER)>:0:0:<$STR(N$ARCHIVE)>:<$STR(N$BACKGROUND)>:9:10:11:6:7:8:12:13:14>',
  ], mov);
  const gomElement = list(gom, 'GOM_DYNAMIC');
  const gp = gomElement.containerPreview;
  for (const field of ['gap', 'default', 'direction', 'remember-scroll-position']) {
    assert.ok(fields(gp, 'dynamicFields').includes(field), `GOM missing dynamic field ${field}`);
  }
  assert.notEqual(gp.gap, 9, 'GOM dynamic gap borrowed MOV N$GAP');
  assert.notEqual(gp.direction, 'horizontal', 'GOM dynamic direction borrowed MOV N$DIRECTION');
  assert.equal(gp.requestedDefaultIndex, undefined, 'GOM dynamic default borrowed MOV N$DEFAULT');
  assert.equal(gp.rememberScrollPosition, undefined, 'GOM dynamic remember borrowed MOV N$REMEMBER');
  assertNoScrollbarResolverLayers(gomElement);
  assert.match(
    gomElement.warning || '',
    /不借用\s*MOV|动态源码|源码含运行时表达式|未确定文字显示|未确定数量显示/i,
  );

  const gee = parse('GEE', [
    '<ListView:~#GEE_RESERVED_DYNAMIC:0:0:100:40:0:0:0:<$STR(N$REMEMBER)>:0:0:22:85:9:10:11:6:7:8:12:13:14>',
  ], mov);
  const gep = list(gee, 'GEE_RESERVED_DYNAMIC').containerPreview;
  assert.equal(gep.rememberScrollPosition, undefined);
  const reserved = assertField(gep, 'reserved-3', 'reserved');
  assert.match(String(reserved.rawSource || reserved.raw || ''), /<\$STR\(N\$REMEMBER\)>/i,
    'reserved GEE/LFM source must be preserved without resolving MOV');

  const pc = parse('996PC', [
    '<ListView|id=PC_DYNAMIC|children={A,B,C}|x=0|y=0|width=50|height=30|direction=<$STR(N$DIRECTION)>|margin=<$STR(N$GAP)>|default=<$STR(N$DEFAULT)>|cantouch=<$STR(N$TOUCH)>|bounce=<$STR(N$BOUNCE)>|Slider=<$STR(N$SLIDER)>|Sdbg=<$STR(N$BACKGROUND)>>',
    '<Layout|id=A|width=20|height=20>',
    '<Layout|id=B|width=20|height=20>',
    '<Layout|id=C|width=20|height=20>',
  ], mov);
  const pcElement = list(pc, 'PC_DYNAMIC');
  const pp = pcElement.containerPreview;
  for (const field of ['direction', 'margin', 'default', 'cantouch', 'bounce', 'slider']) {
    assert.ok(fields(pp, 'dynamicFields').includes(field), `996PC missing dynamic field ${field}`);
  }
  assert.notEqual(pp.gap, 9, '996PC dynamic margin borrowed MOV N$GAP');
  assert.notEqual(pp.direction, 'vertical',
    'dynamic direction must remain unknown rather than impersonating MOV=1 vertical');
  assert.equal(pp.requestedDefaultIndex, undefined, 'dynamic default borrowed MOV N$DEFAULT');
  assert.equal(pp.touchEnabled, undefined, 'dynamic cantouch borrowed MOV N$TOUCH');
  assert.equal(pp.bounce, undefined, 'dynamic bounce borrowed MOV N$BOUNCE');
  assert.equal(pp.scrollbarMode, undefined, 'dynamic Slider borrowed MOV N$SLIDER');
  assert.equal(pp.effectiveDefaultIndex, 0, 'blocked dynamic default needs a separate safe effective index');
  assertNoScrollbarResolverLayers(pcElement);
}

function testNumericDomainsAndTypedFieldDiagnostics() {
  const pc = parse('996PC', [
    '<ListView|id=PC_NUMERIC_MARGIN|children={A}|direction=1|margin=-2.5|default=1|cantouch=1|Slider=0>',
    '<Layout|id=A|width=20|height=20>',
    '<ListView|id=PC_INVALID|children={B}|direction=1.5|margin=bad|default=-1|cantouch=2|Slider=1.5|Sdbg=-1|Sdupnimg=2.5|Sdnimg=oops>',
    '<Layout|id=B|width=20|height=20>',
  ]);
  const numeric = list(pc, 'PC_NUMERIC_MARGIN').containerPreview;
  assert.equal(numeric.gap, -2.5,
    'help only proves numeric margin; preview must not invent integer/non-negative clamping');
  assertField(numeric, 'margin', 'static');
  assert.equal(numeric.requestedDefaultIndex, 1);
  assert.equal(numeric.effectiveDefaultIndex, 0);
  assert.equal(numeric.scrollbarMode, 'disabled');
  assertField(numeric, 'slider', 'static');

  const invalidElement = list(pc, 'PC_INVALID');
  const invalid = invalidElement.containerPreview;
  for (const field of ['direction', 'margin', 'default', 'cantouch', 'slider']) {
    assert.ok(fields(invalid, 'invalidFields').includes(field), `missing invalid field ${field}`);
    assertField(invalid, field, 'invalid');
  }
  assert.equal(invalid.requestedDefaultIndex, undefined);
  assert.equal(invalid.touchEnabled, undefined);
  assert.equal(invalid.scrollbarMode, 'blocked');
  assertNoScrollbarResolverLayers(invalidElement);

  const gom = parse('GOM', [
    '<ListView:~#GOM_INVALID:0:0:100:40:-2.5:1.5:2:3:0:0:-1:2.5:bad:10:11:6:7:8:12:13:14>',
  ]);
  const gl = list(gom, 'GOM_INVALID');
  assert.equal(gl.containerPreview.gap, -2.5,
    'legacy child gap has no documented non-negative/integer restriction');
  for (const field of ['default', 'direction', 'remember-scroll-position']) {
    assert.ok(fields(gl.containerPreview, 'invalidFields').includes(field),
      `GOM missing invalid field ${field}`);
  }
  assertNoScrollbarResolverLayers(gl);
}

function testEveryScrollbarRoleHasTypedSourceStatus() {
  const pc = parse('996PC', [
    '<ListView|id=PC_CUSTOM|direction=1|Slider=1|Sdbg=300|Sdupnimg=301|Sdupmimg=302|Sduppimg=303|Sdnimg=304|Sdmimg=305|Sdpimg=306|Sddwnimg=307|Sddwmimg=308|Sddwpimg=309>',
    '<ListView|id=PC_MIXED|direction=1|Slider=1|Sdbg=<$STR(N$BACKGROUND)>|Sdupnimg=-1|Sdupmimg=2.5|Sduppimg=bad|Sdnimg=304|Sdpimg=306|Sddwnimg=307>',
    '<ListView|id=PC_DEFAULT|direction=1|Slider=1>',
    '<ListView|id=PC_DISABLED|direction=1|Slider=0|Sdbg=999|Sdupnimg=998|Sdnimg=997|Sddwnimg=996>',
    '<ListView|id=PC_DYNAMIC_SLIDER|direction=1|Slider=<$STR(N$SLIDER)>|Sdbg=999>',
  ], ['MOV N$BACKGROUND 991', 'MOV N$SLIDER 1']);
  const custom = list(pc, 'PC_CUSTOM');
  assert.deepEqual(
    custom.containerPreview.scrollbarDiagnostics.map(value => value.role),
    ALL_SCROLL_ROLES,
    'all ten documented 996PC scrollbar roles need ordered diagnostics'
  );
  assertScrollbar(custom.containerPreview, 'scrollbar', 'static', {
    archiveRole: 'game-ui-pack', imageIndex: 300,
  });
  assertScrollbar(custom.containerPreview, 'scroll-end-pressed', 'static', {
    archiveRole: 'game-ui-pack', imageIndex: 309,
  });

  const mixed = list(pc, 'PC_MIXED');
  assertScrollbar(mixed.containerPreview, 'scrollbar', 'dynamic');
  assertScrollbar(mixed.containerPreview, 'scroll-start', 'invalid');
  assertScrollbar(mixed.containerPreview, 'scroll-start-hover', 'invalid');
  assertScrollbar(mixed.containerPreview, 'scroll-start-pressed', 'invalid');
  assertScrollbar(mixed.containerPreview, 'scroll-thumb', 'static', {
    archiveRole: 'game-ui-pack', imageIndex: 304,
  });
  assertScrollbar(mixed.containerPreview, 'scroll-thumb-hover', 'missing');
  assertScrollbar(mixed.containerPreview, 'scroll-thumb-pressed', 'static', {
    archiveRole: 'game-ui-pack', imageIndex: 306,
  });
  assert.ok(!JSON.stringify(mixed).includes('991'), 'dynamic Sdbg borrowed MOV N$BACKGROUND=991');

  const clientDefault = list(pc, 'PC_DEFAULT').containerPreview;
  assert.equal(clientDefault.scrollbarMode, 'client-default');
  for (const role of ALL_SCROLL_ROLES) assertScrollbar(clientDefault, role, 'default');

  const disabled = list(pc, 'PC_DISABLED');
  assert.equal(disabled.containerPreview.scrollbarMode, 'disabled');
  for (const role of ALL_SCROLL_ROLES) assertScrollbar(disabled.containerPreview, role, 'disabled');
  assertNoScrollbarResolverLayers(disabled);

  const dynamicSlider = list(pc, 'PC_DYNAMIC_SLIDER');
  assert.equal(dynamicSlider.containerPreview.scrollbarMode, 'blocked');
  for (const role of ALL_SCROLL_ROLES) {
    assertScrollbar(dynamicSlider.containerPreview, role, 'dynamic');
  }
  assertNoScrollbarResolverLayers(dynamicSlider);

  const legacy = parse('GOM', [
    '<ListView:~#LEGACY_MIXED:0:0:100:40:0:0:0:0:0:0:22:<$STR(N$BACKGROUND)>:-1:2.5:bad:6::8:12:13:14>',
  ], ['MOV N$BACKGROUND 991']);
  const legacyElement = list(legacy, 'LEGACY_MIXED');
  assert.deepEqual(
    legacyElement.containerPreview.scrollbarDiagnostics.map(value => value.role),
    ALL_SCROLL_ROLES
  );
  assertScrollbar(legacyElement.containerPreview, 'scrollbar', 'dynamic');
  assertScrollbar(legacyElement.containerPreview, 'scroll-start', 'invalid');
  assertScrollbar(legacyElement.containerPreview, 'scroll-start-hover', 'invalid');
  assertScrollbar(legacyElement.containerPreview, 'scroll-start-pressed', 'invalid');
  assertScrollbar(legacyElement.containerPreview, 'scroll-thumb', 'static', {
    willIndex: 22, imageIndex: 6,
  });
  assertScrollbar(legacyElement.containerPreview, 'scroll-thumb-hover', 'missing');
  assert.ok(!JSON.stringify(legacyElement).includes('991'), 'legacy dynamic background borrowed MOV');
}

function loadProviderWithVscodeStub() {
  const originalLoad = Module._load;
  const uri = value => ({ fsPath: value, path: value, toString() { return value; } });
  const vscode = {
    Uri: { parse: uri, file: uri, joinPath: (base, ...parts) => uri([base.fsPath, ...parts].join('/')) },
    EventEmitter: class { constructor() { this.event = () => undefined; } fire() {} dispose() {} },
    Disposable: { from: () => ({ dispose() {} }) },
    workspace: {}, window: {}, commands: {},
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../out/providers/npc-dialog-visual');
  } finally {
    Module._load = originalLoad;
  }
}

function testProviderRebuildsOnlyTypedStaticScrollbarReferences() {
  const { hydrateListViewAssets } = loadProviderWithVscodeStub();
  assert.equal(typeof hydrateListViewAssets, 'function',
    'Provider must export hydrateListViewAssets for an isolated pollution-gate test');
  const ready = reference => ({
    status: 'ready',
    url: `data:image/png;base64,${reference.archiveRole || reference.archiveName || reference.willIndex}-${reference.imageIndex}`,
    archiveLabel: 'fixture', width: 12, height: 12, offsetX: 0, offsetY: 0,
  });
  const listElement = {
    id: 'LIST_PROVIDER_GATE',
    assetLayers: [
      { role: 'scrollbar', assetRef: { archiveName: 'PollutedLayer', imageIndex: 900 } },
      { role: 'scroll-start', assetRef: { archiveName: 'PollutedLayer', imageIndex: 901 } },
      { role: 'scroll-thumb', assetRef: { archiveName: 'PollutedLayer', imageIndex: 902 } },
      { role: 'scroll-end', assetRef: { archiveName: 'PollutedLayer', imageIndex: 903 } },
    ],
    containerPreview: {
      variant: 'list', label: '列表容器', scrollbarMode: 'custom',
      scrollbarDiagnostics: [
        {
          field: 'Sdbg', role: 'scrollbar', sourceStatus: 'static', status: 'static',
          assetRef: { archiveRole: 'game-ui-pack', imageIndex: 300 },
        },
        {
          field: 'Sdupnimg', role: 'scroll-start', sourceStatus: 'dynamic', status: 'dynamic',
          assetRef: { archiveName: 'PollutedDynamic', imageIndex: 777 },
          asset: ready({ archiveName: 'PollutedDynamic', imageIndex: 777 }),
        },
        {
          field: 'Sdnimg', role: 'scroll-thumb', sourceStatus: 'invalid', status: 'invalid',
          assetRef: { archiveName: 'PollutedInvalid', imageIndex: 778 },
        },
        {
          field: 'Sddwnimg', role: 'scroll-end', sourceStatus: 'static', status: 'static',
          assetRef: { archiveRole: 'game-ui-pack', imageIndex: 307 },
        },
      ],
    },
  };
  const disabled = {
    id: 'LIST_DISABLED_GATE',
    assetLayers: [{ role: 'scrollbar', assetRef: { archiveName: 'PollutedDisabled', imageIndex: 1 } }],
    containerPreview: {
      variant: 'list', label: '列表容器', scrollbarMode: 'disabled',
      scrollbarDiagnostics: ALL_SCROLL_ROLES.map(role => ({
        field: role, role, sourceStatus: 'disabled', status: 'disabled',
        assetRef: { archiveName: 'PollutedDisabled', imageIndex: 1 },
      })),
    },
  };
  const calls = [];
  hydrateListViewAssets({ scenes: [{ elements: [listElement, disabled] }] }, reference => {
    calls.push(reference);
    if (reference.archiveRole === 'game-ui-pack') return ready(reference);
    throw new Error(`blocked stale reference reached resolver: ${JSON.stringify(reference)}`);
  });
  assert.deepEqual(calls.map(value => value.imageIndex).sort((a, b) => a - b), [300, 307]);
  const diagnostics = listElement.containerPreview.scrollbarDiagnostics;
  for (const role of ['scrollbar', 'scroll-end']) {
    assert.equal(diagnostics.find(value => value.role === role).asset.status, 'ready');
  }
  for (const role of ['scroll-start', 'scroll-thumb']) {
    const diagnostic = diagnostics.find(value => value.role === role);
    assert.equal(diagnostic.assetRef, undefined, `${role} stale ref survived Provider gate`);
    assert.equal(diagnostic.asset, undefined, `${role} received speculative asset`);
  }
  assert.deepEqual(
    listElement.assetLayers.map(layer => layer.role).sort(),
    ['scroll-end', 'scrollbar'],
    'Provider must rebuild resolver-bearing layers from typed static diagnostics only'
  );
  assert.deepEqual(disabled.assetLayers || [], []);
}

check('engine-specific parameter 9 and requested/effective default indexes',
  testEngineSpecificPositionNineAndDefaultIndexes);
check('dynamic ListView fields never borrow MOV values', testDynamicValuesNeverBorrowMov);
check('negative, fractional, and invalid fields follow evidenced domains',
  testNumericDomainsAndTypedFieldDiagnostics);
check('every scrollbar role exposes a typed source diagnostic',
  testEveryScrollbarRoleHasTypedSourceStatus);
check('Provider rejects stale/polluted ListView asset references',
  testProviderRebuildsOnlyTypedStaticScrollbarReferences);

if (failures.length > 0) {
  console.error(`listview-strict-runtime.test.js: RED (${failures.length} checks)`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('listview-strict-runtime.test.js: PASS');
}
