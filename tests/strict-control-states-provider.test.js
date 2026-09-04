const assert = require('node:assert/strict');
const Module = require('node:module');

function loadProviderWithVscodeStub() {
  const originalLoad = Module._load;
  const uri = value => ({
    fsPath: value,
    path: value,
    toString() { return value; },
  });
  const vscode = {
    Uri: {
      parse: uri,
      file: uri,
      joinPath(base, ...parts) {
        return uri([base.fsPath || base.path, ...parts].join('/'));
      },
    },
    EventEmitter: class {
      constructor() { this.event = () => undefined; }
      fire() {}
      dispose() {}
    },
    Disposable: { from: () => ({ dispose() {} }) },
    workspace: {},
    window: {},
    commands: {},
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

function state(role, status, assetRef) {
  return {
    role,
    status,
    ...(status === 'static' ? { assetRef } : {}),
  };
}

function layer(role, assetRef) {
  return { role, assetRef };
}

function referenceKey(reference) {
  return [
    reference.willIndex === undefined ? '' : `w${reference.willIndex}`,
    reference.archiveName || '',
    reference.imageIndex === undefined ? '' : `i${reference.imageIndex}`,
  ].join(':');
}

function hydratedAsset(element, role) {
  const diagnostic = (element.assetStateDiagnostics || [])
    .find(candidate => candidate.role === role);
  if (diagnostic?.asset) return diagnostic.asset;
  if (role === 'normal') return element.asset;
  return (element.assetLayers || []).find(candidate => candidate.role === role)?.asset;
}

function testStatefulControlProviderGate() {
  const { hydrateStatefulControlAssets } = loadProviderWithVscodeStub();
  assert.equal(typeof hydrateStatefulControlAssets, 'function',
    'provider must expose a pure stateful-control hydration gate');

  const button = {
    id: 'BUTTON_MIXED',
    statementId: 'newui-button-996pc',
    assetRef: { archiveName: 'NewopUI', imageIndex: 140 },
    // These two stale refs model the dangerous pre-fix shape. The typed
    // diagnostics are authoritative: neither may reach the resolver.
    assetLayers: [
      layer('hover', { archiveName: 'NewopUI', imageIndex: 0 }),
      layer('pressed', { archiveName: 'NewopUI', imageIndex: 0 }),
    ],
    assetStateDiagnostics: [
      state('normal', 'static', { archiveName: 'NewopUI', imageIndex: 140 }),
      state('hover', 'dynamic'),
      state('pressed', 'invalid'),
    ],
  };
  const imgEx = {
    id: 'IMGEX_MIXED',
    statementId: 'imgex-relative-996pc',
    assetRef: { willIndex: 3, imageIndex: 283 },
    assetLayers: [
      layer('hover', { willIndex: 3, imageIndex: 0 }),
      layer('pressed', { willIndex: 3, imageIndex: 285 }),
    ],
    assetStateDiagnostics: [
      state('normal', 'static', { willIndex: 3, imageIndex: 283 }),
      state('hover', 'missing'),
      state('pressed', 'static', { willIndex: 3, imageIndex: 285 }),
    ],
  };
  const checkbox = {
    id: 'CHECK_MIXED',
    statementId: 'newui-checkbox-996pc',
    assetRef: { archiveName: 'NewopUI', imageIndex: 145 },
    assetLayers: [layer('selected', { archiveName: 'NewopUI', imageIndex: 0 })],
    assetStateDiagnostics: [
      state('normal', 'static', { archiveName: 'NewopUI', imageIndex: 145 }),
      state('selected', 'dynamic'),
    ],
  };
  const dynamicNormal = {
    id: 'BUTTON_DYNAMIC_NORMAL',
    statementId: 'newui-button-996pc',
    // A source-bound MOV value or old default must not override the diagnostic.
    assetRef: { archiveName: 'NewopUI', imageIndex: 0 },
    assetLayers: [
      layer('hover', { archiveName: 'NewopUI', imageIndex: 0 }),
      layer('pressed', { archiveName: 'NewopUI', imageIndex: 0 }),
    ],
    assetStateDiagnostics: [
      state('normal', 'dynamic'),
      state('hover', 'invalid'),
      state('pressed', 'missing'),
    ],
  };
  const model = {
    scenes: [{ elements: [button, imgEx, checkbox, dynamicNormal] }],
  };

  const requests = [];
  hydrateStatefulControlAssets(model, reference => {
    assert.ok(reference, 'resolver was called with an absent reference');
    requests.push({ ...reference });
    const key = referenceKey(reference);
    return {
      status: 'ready',
      url: `vscode-resource:/StrictState/${key}.png`,
      archiveLabel: key,
      width: 48,
      height: 24,
      offsetX: 0,
      offsetY: 0,
    };
  });

  assert.deepEqual(requests.map(referenceKey).sort(), [
    ':NewopUI:i140',
    ':NewopUI:i145',
    'w3::i283',
    'w3::i285',
  ].sort(), 'provider requested a dynamic, invalid, missing or default-derived state');

  for (const [element, role] of [
    [button, 'normal'],
    [imgEx, 'normal'],
    [imgEx, 'pressed'],
    [checkbox, 'normal'],
  ]) {
    assert.equal(hydratedAsset(element, role)?.status, 'ready',
      `${element.id}/${role} static state was not hydrated`);
  }

  for (const [element, role, status] of [
    [button, 'hover', 'dynamic'],
    [button, 'pressed', 'invalid'],
    [imgEx, 'hover', 'missing'],
    [checkbox, 'selected', 'dynamic'],
    [dynamicNormal, 'normal', 'dynamic'],
    [dynamicNormal, 'hover', 'invalid'],
    [dynamicNormal, 'pressed', 'missing'],
  ]) {
    const diagnostic = element.assetStateDiagnostics.find(value => value.role === role);
    assert.equal(diagnostic.status, status);
    assert.equal(diagnostic.assetRef, undefined,
      `${element.id}/${role} ${status} diagnostic carried a ref`);
    assert.equal(hydratedAsset(element, role), undefined,
      `${element.id}/${role} ${status} state received a speculative asset`);
  }

  assert.equal(dynamicNormal.asset, undefined,
    'dynamic normal state borrowed imageIndex=0 and was hydrated');
  assert.doesNotMatch(requests.map(referenceKey).join('\n'), /i0(?:\D|$)/,
    'default imageIndex=0 reached the resolver');
}

try {
  testStatefulControlProviderGate();
  console.log('strict-control-states-provider.test.js: PASS');
} catch (error) {
  console.error('strict-control-states-provider.test.js: RED FAILURE');
  console.error(`- ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
}
