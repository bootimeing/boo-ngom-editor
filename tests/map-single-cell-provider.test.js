const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const {
  makeContext, makeVscodeStub, loadCompiledProvider, makePanel,
} = require('./map-preview-persistent-tile-provider.test');
const { parseOriginalMap } = require('../out/utils/original-map');

// Production parser and Provider; archive discovery/table and VS Code APIs are
// synthetic. No user MAP, archive, cache or workspace state is written.
async function resolveFixture({ oddOnly = false, oddArchive = false,
  width = 4, height = 4, imageWidth = 48, imageHeight = 32,
  status = 'ready', includeStaticSources = true, viewport, upperLayers = true } = {}) {
  const bytes = Buffer.alloc(52 + width * height * 14);
  bytes.writeUInt16LE(width, 0); bytes.writeUInt16LE(height, 2);
  bytes[4] = 15; bytes.write('Legend of mir', 5, 'ascii'); bytes[18] = 13; bytes[19] = 10;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const odd = x % 2 !== 0 || y % 2 !== 0;
      const offset = 52 + (x * height + y) * 14;
      if (!oddOnly || odd) bytes.writeUInt16LE(1, offset);
      if (oddArchive && odd) bytes[offset + 12] = 1;
      if (upperLayers) {
        bytes.writeUInt16LE(1, offset + 2);
        bytes.writeUInt16LE(1, offset + 4);
      }
    }
  }
  const model = await parseOriginalMap(bytes);
  const workspace = path.join(os.tmpdir(), 'boo-single-cell-readonly-fixture');
  const { MapPreviewProvider } = loadCompiledProvider(makeVscodeStub(workspace));
  const provider = new MapPreviewProvider(makeContext(workspace));
  const session = {
    model, mapKey: 'single-cell', engineId: 'GOM', requestId: 9, generation: 3,
    latestViewportSeq: 1,
  };
  provider.currentMap = { key: session.mapKey };
  provider.originalMapSession = session;
  provider.originalMapVersion = 3;
  provider.panel = makePanel([]);
  provider.postOriginalProgress = () => {};
  provider.originalMapSourceContext = async () => ({
    definition: { id: 'GOM', shortLabel: 'GOM' }, resourceRoots: [workspace],
    archiveFiles: [], supportedExtensions: ['.pak'], sourceScanWarning: '',
  });
  const requested = [];
  provider.resolveOriginalArchive = name => {
    requested.push(name);
    return {
      status: /^Tiles/.test(name) ? status : 'ready', sourcePath: `${name}.pak`,
      pak: { archiveId: (name === 'Tiles2' ? 'b' : 'a').repeat(64),
        storageMode: 'direct', pakName: name, cacheDir: workspace },
    };
  };
  provider.originalAssetTable = pak => ({
    slotCount: 1, present: [1], blank: [0],
    width: [/^Tiles/.test(pak.pakName) ? imageWidth : 48],
    height: [/^Tiles/.test(pak.pakName) ? imageHeight : 32],
    offsetX: [0], offsetY: [0],
  });
  const data = await provider.resolveOriginalMapData(session, 9, 3,
    viewport || { left: 0, top: 0, right: width - 1, bottom: height - 1 },
    1, includeStaticSources);
  return { model, data, requested };
}

function cells(data) {
  return Array.from({ length: data.tiles.length / 3 }, (_, i) => data.tiles.slice(i * 3, i * 3 + 2));
}

async function main() {
  const repeated = await resolveFixture();
  assert.equal(repeated.data.tiles.length / 3, 16,
    'one repeated image must have all 16 placements, not just four even cells');
  assert.equal(new Set(cells(repeated.data).map(pair => pair.join(','))).size, 16);
  assert.equal(repeated.data.resources.filter(r => r.key.startsWith('tiles:')).length, 1,
    'image decoding identity must still be deduplicated');
  assert.equal(repeated.data.smTiles.length / 3, 16);
  assert.equal(repeated.data.objects.length / 3, 16);
  assert.equal(repeated.data.objectAnimationFrames.length, 16);

  const odd = await resolveFixture({ oddOnly: true });
  assert.equal(odd.data.tiles.length / 3, 12, 'odd-only archive must be discoverable');
  assert.ok(odd.model.archiveNames.includes('Tiles'), 'cache identity must include odd-only archive');
  const split = await resolveFixture({ oddArchive: true });
  assert.equal(split.data.tiles.length / 3, 16, 'odd-only second archive must not disappear');
  assert.ok(split.model.archiveNames.includes('Tiles2'), 'cache must bind the second archive too');
  assert.equal(split.data.resources.filter(r => /^tiles/.test(r.key)).length, 2);

  const quad = await resolveFixture({ imageWidth: 96, imageHeight: 64 });
  assert.deepEqual(cells(quad.data), [[0, 0], [2, 0], [0, 2], [2, 2]],
    'classic large tiles must not be overdrawn at odd cells');
  for (const status of ['missing-source', 'not-indexed', 'stale']) {
    const missing = await resolveFixture({ status });
    assert.equal(missing.data.tiles.length, 0, `${status} must not invent tiles`);
    assert.ok(missing.data.warning);
  }
  const fast = await resolveFixture({ includeStaticSources: false });
  assert.equal(fast.data.tiles.length, 0);
  assert.equal(fast.data.smTiles.length, 0);
  assert.equal(fast.data.objects.length / 3, 16);
  assert.ok(!fast.requested.some(name => /^(Tiles|SmTiles)/.test(name)),
    'persistent cache hit must not resolve static source archives again');
  const border = await resolveFixture({ width: 20, height: 20,
    viewport: { left: 15, top: 15, right: 16, bottom: 16 } });
  assert.equal(border.data.tiles.length / 3, 36, 'chunk boundary halo retains every placement');
  console.log('map-single-cell-provider.test.js: PASS repeated/odd-only/split archives, classic, missing, fast path and chunk boundary');
}

module.exports = { resolveFixture };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
