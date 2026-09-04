const assert = require('node:assert/strict');
const Module = require('node:module');

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

const { hydrateTextAtlasAssets } = loadProviderWithVscodeStub();

function refKey(reference) {
  return reference.archiveName
    ? `${reference.archiveName}:${reference.imageIndex}`
    : `WIL${reference.willIndex}:${reference.imageIndex}`;
}

function ready(reference, width, height) {
  return {
    status: 'ready',
    url: `data:image/png;base64,${refKey(reference)}`,
    archiveLabel: refKey(reference),
    width,
    height,
    offsetX: 0,
    offsetY: 0,
  };
}

function atlas(id, overrides = {}) {
  return {
    id,
    assetRef: { archiveName: 'NewopUI', imageIndex: 999 },
    asset: ready({ archiveName: 'NewopUI', imageIndex: 999 }, 140, 24),
    imageTextPreview: {
      mode: 'atlas',
      textAtlasVariant: 'newui-atlas',
      value: '90',
      gap: 0,
      glyphWidth: 14,
      glyphHeight: 24,
      baseAssetRef: { archiveName: 'NewopUI', imageIndex: 2522 },
      assetContract: 'unverified',
      glyphs: [
        { character: '9', sourceX: -9, assetRef: { archiveName: 'Evil', imageIndex: 8 }, asset: ready({ archiveName: 'Evil', imageIndex: 8 }, 1, 1) },
        { character: '0', sourceX: 999, assetRef: { archiveName: 'Evil', imageIndex: 9 }, asset: ready({ archiveName: 'Evil', imageIndex: 9 }, 1, 1) },
      ],
      ...overrides,
    },
  };
}

function testTypedGateAndRebuild() {
  const matched = atlas('matched');
  const mismatch = atlas('mismatch', {
    baseAssetRef: { archiveName: 'Mismatch', imageIndex: 1 },
  });
  const dynamic = atlas('dynamic', {
    value: '?',
    dynamicFields: ['archive', 'text'],
    baseAssetRef: { archiveName: 'PollutedDynamic', imageIndex: 77 },
  });
  const dynamicGeometry = atlas('dynamic-geometry', {
    value: '9876',
    glyphWidth: undefined,
    glyphHeight: undefined,
    baseAssetRef: undefined,
    dynamicFields: ['archive', 'image', 'glyph-width', 'glyph-height', 'text'],
  });
  const textOnlyDynamic = atlas('text-only-dynamic', {
    value: '0',
    dynamicFields: ['text'],
  });
  const invalid = atlas('invalid', {
    invalidFields: ['glyph-width'],
    baseAssetRef: { archiveName: 'PollutedInvalid', imageIndex: 88 },
  });
  const legacy = {
    id: 'legacy',
    assetRef: { willIndex: 99, imageIndex: 99 },
    imageTextPreview: {
      mode: 'individual',
      textAtlasVariant: 'legacy-individual',
      value: '90',
      gap: 0,
      baseAssetRef: { willIndex: 7, imageIndex: 2470 },
      assetContract: 'unverified',
      glyphs: [{ character: '9', assetRef: { willIndex: 99, imageIndex: 99 } }],
    },
  };
  const calls = [];
  const resolve = reference => {
    calls.push(refKey(reference));
    if (reference.archiveName === 'NewopUI') return ready(reference, 140, 24);
    if (reference.archiveName === 'Mismatch') return ready(reference, 139, 24);
    if (reference.willIndex === 7) return ready(reference, reference.imageIndex === 2479 ? 17 : 13, 22);
    throw new Error(`blocked reference reached resolver: ${refKey(reference)}`);
  };
  hydrateTextAtlasAssets({ scenes: [{
    elements: [matched, mismatch, dynamic, dynamicGeometry, textOnlyDynamic, invalid, legacy],
  }] }, resolve);

  assert.equal(matched.imageTextPreview.assetContract, 'matched');
  assert.deepEqual(matched.imageTextPreview.glyphs.map(glyph => glyph.sourceX), [126, 0]);
  assert.ok(matched.imageTextPreview.glyphs.every(glyph => (
    glyph.assetRef.archiveName === 'NewopUI'
    && glyph.assetRef.imageIndex === 2522
    && glyph.asset.status === 'ready'
  )));
  assert.equal(mismatch.imageTextPreview.assetContract, 'mismatch');
  assert.ok(mismatch.imageTextPreview.glyphs.every(glyph => !glyph.asset));
  assert.match(mismatch.imageTextPreview.assetContractMessage || '', /140.*24|10.*14/);

  for (const element of [dynamic, invalid]) {
    assert.equal(element.imageTextPreview.assetContract, 'blocked');
    assert.equal(element.assetRef, undefined);
    assert.equal(element.asset, undefined);
    assert.ok(element.imageTextPreview.glyphs.every(glyph => !glyph.assetRef && !glyph.asset));
  }
  assert.equal(dynamicGeometry.imageTextPreview.assetContract, 'blocked');
  assert.equal(
    dynamicGeometry.imageTextPreview.glyphs.map(glyph => glyph.character).join(''),
    '9876',
    'a blocked dynamic atlas must retain its renderer-facing display characters',
  );
  assert.ok(dynamicGeometry.imageTextPreview.glyphs.every(glyph => (
    glyph.sourceX === undefined && !glyph.assetRef && !glyph.asset
  )), 'dynamic glyph width leaked crop geometry or requestable resources');
  assert.equal(textOnlyDynamic.imageTextPreview.assetContract, 'matched');
  assert.equal(textOnlyDynamic.imageTextPreview.glyphs.map(glyph => glyph.character).join(''), '0');
  assert.ok(textOnlyDynamic.imageTextPreview.glyphs.every(glyph => (
    glyph.sourceX === 0
    && glyph.assetRef.archiveName === 'NewopUI'
    && glyph.assetRef.imageIndex === 2522
    && glyph.asset.status === 'ready'
  )), 'text-only uncertainty incorrectly blocked a statically proven atlas sheet');
  assert.equal(legacy.imageTextPreview.assetContract, 'matched');
  assert.deepEqual(legacy.imageTextPreview.glyphs.map(glyph => glyph.assetRef.imageIndex), [2479, 2470]);
  assert.deepEqual(legacy.imageTextPreview.glyphs.map(glyph => glyph.asset.width), [17, 13]);
  assert.deepEqual(calls.sort(), [
    'Mismatch:1', 'NewopUI:2522', 'WIL7:2470', 'WIL7:2479',
  ].sort());
  assert.ok(!calls.some(value => /Polluted|Evil|WIL99/.test(value)),
    `stale TextAtlas reference reached resolver: ${calls.join(',')}`);
}

try {
  assert.equal(typeof hydrateTextAtlasAssets, 'function', 'hydrateTextAtlasAssets is not exported');
  testTypedGateAndRebuild();
  console.log('textatlas-provider-gate.test.js: PASS');
} catch (error) {
  console.error(`textatlas-provider-gate.test.js: RED ${error.stack || error}`);
  process.exitCode = 1;
}
