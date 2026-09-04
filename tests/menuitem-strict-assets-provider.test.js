const assert = require('node:assert/strict');
const Module = require('node:module');

function loadProviderWithVscodeStub() {
  const originalLoad = Module._load;
  const uri = value => ({ fsPath: value, path: value, toString() { return value; } });
  const vscode = {
    Uri: { parse: uri, file: uri, joinPath(base, ...parts) { return uri([base.fsPath || base.path, ...parts].join('/')); } },
    EventEmitter: class { constructor() { this.event = () => undefined; } fire() {} dispose() {} },
    Disposable: { from: () => ({ dispose() {} }) },
    workspace: {}, window: {}, commands: {},
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try { return require('../out/providers/npc-dialog-visual'); }
  finally { Module._load = originalLoad; }
}

function referenceKey(reference) {
  return `${reference.archiveName || ''}:${reference.imageIndex === undefined ? '' : reference.imageIndex}`;
}

function diagnostic(field, status, assetRef) {
  return { field, sourceStatus: status, status, ...(assetRef ? { assetRef } : {}) };
}

function state(element, field) {
  return (element.menuPreview.assetDiagnostics || []).find(value => value.field === field);
}

function layer(element, role) {
  return (element.assetLayers || []).find(value => value.role === role);
}

function testMenuItemProviderStrictlyRebuildsFourAssetSlots() {
  const { hydrateMenuItemAssets } = loadProviderWithVscodeStub();
  assert.equal(typeof hydrateMenuItemAssets, 'function',
    'provider must expose a pure MenuItem asset hydration gate');

  const defaults = {
    img: { archiveName: 'NewopUI', imageIndex: 2000 },
    arrowimg: { archiveName: 'NewopUI', imageIndex: 1448 },
    selectimg: { archiveName: 'NewopUI', imageIndex: 2047 },
    listimg: { archiveName: 'NewopUI', imageIndex: 2000 },
  };
  const staticRefs = {
    img: { archiveName: 'CustomUI', imageIndex: 2100 },
    arrowimg: { archiveName: 'CustomUI', imageIndex: 1449 },
    selectimg: { archiveName: 'CustomUI', imageIndex: 2048 },
    listimg: { archiveName: 'CustomUI', imageIndex: 2101 },
  };
  const element = {
    id: 'MENU_STRICT_PROVIDER',
    statementId: 'newui-menuitem-996pc',
    // These are intentionally valid positive indexes. A generic provider would
    // happily resolve them, so only the typed diagnostic can protect source
    // uncertainty after a stale model is serialized.
    assetRef: { archiveName: 'OldCache', imageIndex: 9991 },
    assetLayers: [
      { role: 'arrow', assetRef: { archiveName: 'OldCache', imageIndex: 9992 } },
      { role: 'selected', assetRef: { archiveName: 'OldCache', imageIndex: 9993 } },
      { role: 'list-background', assetRef: { archiveName: 'OldCache', imageIndex: 9994 } },
    ],
    menuPreview: {
      direction: 0,
      itemHeight: 30,
      items: ['甲', '乙'],
      selected: '甲',
      assetDiagnostics: [
        diagnostic('img', 'default', defaults.img),
        diagnostic('arrowimg', 'static', staticRefs.arrowimg),
        diagnostic('selectimg', 'dynamic'),
        diagnostic('listimg', 'invalid'),
      ],
    },
  };
  const model = { scenes: [{ elements: [element] }] };
  const requests = [];
  hydrateMenuItemAssets(model, reference => {
    requests.push({ ...reference });
    return {
      status: 'ready',
      url: `vscode-resource:/MenuStrict/${referenceKey(reference)}.png`,
      archiveLabel: referenceKey(reference),
      width: 64, height: 24, offsetX: 0, offsetY: 0,
    };
  });

  assert.deepEqual(requests.map(referenceKey).sort(), [
    referenceKey(defaults.img), referenceKey(staticRefs.arrowimg),
  ].sort(), 'provider must resolve only default/static MenuItem slots');
  assert.equal(element.assetRef?.archiveName, 'NewopUI');
  assert.equal(element.assetRef?.imageIndex, 2000);
  assert.equal(element.asset?.status, 'ready');
  assert.deepEqual(layer(element, 'arrow')?.assetRef, staticRefs.arrowimg);
  assert.equal(layer(element, 'arrow')?.asset?.status, 'ready');
  for (const field of ['selectimg', 'listimg']) {
    assert.equal(state(element, field)?.assetRef, undefined,
      `${field} ${state(element, field)?.status} retained a requestable stale ref`);
  }
  assert.equal(layer(element, 'selected'), undefined, 'dynamic selectimg reached asset layer');
  assert.equal(layer(element, 'list-background'), undefined, 'invalid listimg reached asset layer');
  assert.doesNotMatch(requests.map(referenceKey).join('\n'), /OldCache|999[1-4]/,
    'a stale positive MenuItem ref reached the resolver');
}

try {
  testMenuItemProviderStrictlyRebuildsFourAssetSlots();
  console.log('menuitem-strict-assets-provider.test.js: PASS');
} catch (error) {
  console.error('menuitem-strict-assets-provider.test.js: RED FAILURE');
  console.error(`- ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
}
