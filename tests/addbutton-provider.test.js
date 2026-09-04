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

function baseButton(id, normal, hover, pressed) {
  return {
    id,
    assetRef: normal,
    assetLayers: [
      { role: 'hover', assetRef: hover },
      { role: 'pressed', assetRef: pressed },
    ],
    addButtonPreview: {
      command: 'ADDBUTTON',
      triggerId: Number(id.replace(/\D/g, '')) || 1,
      localOnly: true,
      dynamicFields: [],
      invalidFields: [],
      deleteActions: [],
    },
  };
}

function referenceKey(reference) {
  return [
    reference.willIndex === undefined ? '' : `w${reference.willIndex}`,
    reference.archiveName || '',
    reference.imageIndex === undefined ? '' : `i${reference.imageIndex}`,
  ].join(':');
}

function effectFrames(effect) {
  return effect.frames || effect.animationFrames || [];
}

function testAddButtonProviderHydration() {
  const { hydrateAddButtonAssets } = loadProviderWithVscodeStub();
  assert.equal(typeof hydrateAddButtonAssets, 'function',
    'provider must expose a pure ADDBUTTON hydration gate for model/provider regression coverage');

  const legacy = baseButton(
    'ADD1',
    { willIndex: 3, imageIndex: 283 },
    { willIndex: 3, imageIndex: 284 },
    { willIndex: 3, imageIndex: 285 }
  );
  const extended = baseButton(
    'ADD2',
    { willIndex: 5, imageIndex: 275 },
    { willIndex: 5, imageIndex: 276 },
    { willIndex: 5, imageIndex: 277 }
  );
  extended.addButtonPreview.command = 'ADDBUTTONEX';
  extended.addButtonPreview.effects = [
    {
      state: 'normal',
      assetRef: { willIndex: 9, imageIndex: 840 },
      frameCount: 3,
      frameIntervalMs: 80,
      drawMode: 0,
      offsetX: 2,
      offsetY: -3,
    },
    {
      state: 'hover',
      assetRef: { willIndex: 9, imageIndex: 850 },
      frameCount: 2,
      frameIntervalMs: 100,
      drawMode: 1,
      offsetX: 4,
      offsetY: 5,
    },
    {
      state: 'pressed',
      assetRef: { willIndex: 9, imageIndex: 860 },
      frameCount: 4,
      frameIntervalMs: 120,
      drawMode: 0,
      offsetX: -1,
      offsetY: 6,
    },
  ];
  const dynamic = {
    id: 'ADD_DYNAMIC',
    addButtonPreview: {
      command: 'ADDBUTTON',
      triggerId: 9,
      localOnly: true,
      dynamicFields: ['archive', 'normal-image'],
      invalidFields: [],
      deleteActions: [],
    },
  };
  const evidenceBlocked = {
    id: 'ADD_996_EX',
    raw: 'ADDBUTTONEX 7|320|160|1|4 5 275|276|277 ...',
    addButtonPreview: {
      command: 'ADDBUTTONEX',
      status: 'evidence-blocked',
      localOnly: true,
      dynamicFields: [],
      invalidFields: [],
      effects: [],
      deleteActions: [],
    },
  };
  const model = {
    scenes: [{ elements: [legacy, extended, dynamic, evidenceBlocked] }],
  };

  const requests = [];
  hydrateAddButtonAssets(model, reference => {
    assert.ok(reference, 'provider must never call the resolver with an absent reference');
    requests.push({ ...reference });
    const key = referenceKey(reference);
    return {
      status: 'ready',
      url: `vscode-resource:/AddButton/${key}.png`,
      archiveLabel: key,
      width: 48,
      height: 24,
      offsetX: 0,
      offsetY: 0,
    };
  });

  assert.equal(legacy.asset?.status, 'ready');
  assert.equal(legacy.assetLayers[0].asset?.status, 'ready');
  assert.equal(legacy.assetLayers[1].asset?.status, 'ready');
  assert.equal(extended.asset?.status, 'ready');
  assert.equal(extended.assetLayers[0].asset?.status, 'ready');
  assert.equal(extended.assetLayers[1].asset?.status, 'ready');

  const expectedEffects = [
    ['normal', [840, 841, 842]],
    ['hover', [850, 851]],
    ['pressed', [860, 861, 862, 863]],
  ];
  for (const [state, indices] of expectedEffects) {
    const effect = extended.addButtonPreview.effects.find(candidate => candidate.state === state);
    const frames = effectFrames(effect);
    assert.equal(frames.length, indices.length, `${state} effect must retain every time slot`);
    assert.deepEqual(
      frames.map(frame => Number(/:i(\d+)$/.exec(frame.archiveLabel || '')?.[1])),
      indices,
      `${state} effect frames must be resolved from consecutive archive indices`
    );
    assert.ok(frames.every(frame => frame.status === 'ready'));
  }

  const requestedKeys = requests.map(referenceKey);
  const expectedKeys = [
    'w3::i283', 'w3::i284', 'w3::i285',
    'w5::i275', 'w5::i276', 'w5::i277',
    'w9::i840', 'w9::i841', 'w9::i842',
    'w9::i850', 'w9::i851',
    'w9::i860', 'w9::i861', 'w9::i862', 'w9::i863',
  ];
  assert.deepEqual([...requestedKeys].sort(), [...expectedKeys].sort(),
    'provider must request every static visual layer and no speculative layer');
  assert.equal(dynamic.asset, undefined);
  assert.equal(evidenceBlocked.asset, undefined);
  assert.equal((evidenceBlocked.assetLayers || []).length, 0);
  assert.equal((evidenceBlocked.addButtonPreview.effects || []).length, 0);
  assert.doesNotMatch(requestedKeys.join('\n'), /i320|i275.*996/i,
    'dynamic/Evidence-blocked controls must not reach the asset resolver');
}

try {
  testAddButtonProviderHydration();
  console.log('addbutton-provider.test.js: PASS');
} catch (error) {
  console.error('addbutton-provider.test.js: RED FAILURE');
  console.error(`- ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
}
