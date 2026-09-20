const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { makeContext, makeVscodeStub, loadCompiledProvider, makePanel } = require('./map-preview-persistent-tile-provider.test');

function fixture() {
  const workspace = path.join(os.tmpdir(), 'boo-entity-frame-readonly');
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    const value = originalLoad.call(this, request, parent, isMain);
    return /[\\/]patch-cache$/.test(request)
      ? { ...value, isPatchCacheCurrent: () => true } : value;
  };
  let MapPreviewProvider;
  try { ({ MapPreviewProvider } = loadCompiledProvider(makeVscodeStub(workspace))); }
  finally { Module._load = originalLoad; }
  const provider = new MapPreviewProvider(makeContext(workspace));
  provider.panel = makePanel([]);
  const pak = { pakName: 'SafePointEffect', pakPath: path.join(workspace, 'SafePointEffect.pak'),
    archiveId: 'e'.repeat(64), slotCount: 10, cacheDir: workspace };
  const table = { slotCount: 10, present: Array(10).fill(1), blank: Array(10).fill(0),
    width: Array(10).fill(8), height: Array(10).fill(8), offsetX: Array(10).fill(0), offsetY: Array(10).fill(0) };
  table.blank[1] = 1; table.width[1] = 0; table.height[1] = 0;
  provider.originalAssetTable = () => table;
  const context = { engine: 'GEE', clientLayout: undefined, patchPaks: [pak],
    resourceRoots: new Set(), effectImageArchives: [{ name: 'SafePointEffect', willIdx: 1 }] };
  return { provider, table, context };
}

function main() {
  const { provider, table, context } = fixture();
  const resolve = () => provider.resolveSafeZoneAnimation(20, context);
  assert.equal(resolve().frames.length, 10, 'blank slot must keep its original timing position');
  assert.equal(resolve().frames[1].blank, true);
  assert.equal(resolve().frames[1].url, '', 'blank must not request a PNG');
  assert.match(resolve().frames[2].url, /2/);
  assert.equal(resolve().interval, 120);
  table.present[4] = 0;
  assert.equal(resolve().frames.length, 0, 'missing nonblank slot must reject the whole sequence');
  table.present[4] = 1; table.slotCount = 9;
  assert.equal(resolve().frames.length, 0, 'out of range must not shorten the animation');
  table.slotCount = 10; table.width[4] = 0;
  assert.equal(resolve().frames.length, 0, 'invalid nonblank dimensions must not publish a URL');
  table.width[4] = 8;
  assert.equal(provider.resolveSafeZoneAnimation(20, { ...context, engine: 'GOM' }).frames.length, 0);
  const icon = { lineNumber: 1, raw: '', wilIndex: 1, imageIndex: 0, frameCount: 3,
    x: 0, y: 0, effect: 0, speedMs: 120, playCount: 0, layer: 0 };
  const icons = () => provider.resolveNpcIconPreviews([icon], context);
  assert.equal(icons()[0].frames.length, 3);
  assert.equal(icons()[0].frames[1].blank, true);
  table.present[2] = 0;
  assert.equal(icons()[0].frames.length, 0, 'NPC icon with a missing slot must not squeeze the cycle');
  table.present[2] = 1;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-custom-npc-frames-'));
  try {
    const configDirectory = path.join(temporary, 'UserData', 'CustomNpc');
    fs.mkdirSync(configDirectory, { recursive: true });
    fs.writeFileSync(path.join(configDirectory, '10000.ini'),
      '[Setup]\nFileIndex=1\nDir4=1\n[Stand]\nStart4=0\nFrame4=3\nTime4=120\n');
    const custom = () => provider.resolveCustomNpcAnimation(temporary, 10000, 'GOM',
      context.patchPaks, context.effectImageArchives, new Set());
    assert.equal(custom().frames.length, 3);
    assert.equal(custom().frames[1].blank, true);
    table.present[2] = 0;
    assert.equal(custom().frames.length, 0, 'explicit custom NPC sequence cannot hide a missing frame');
    table.present[2] = 1;
  } finally { removeTemporaryDirectory(temporary); }
  provider.originalAssetTable = () => { throw new Error('fixture unavailable index'); };
  assert.equal(icons()[0].frames.length, 0, 'unreadable table must not manufacture archive URLs');
  console.log('map-entity-frame-contract.test.js: PASS blank beats, missing/out-of-range/invalid slots, icon metadata and engine gate');
}

module.exports = { fixture };
if (require.main === module) main();
