const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function testPng(width, height, marker = 0) {
  const data = Buffer.alloc(45);
  PNG_SIGNATURE.copy(data, 0);
  data.writeUInt32BE(13, 8);
  data.write('IHDR', 12, 'ascii');
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  data[24] = 8;
  data[25] = 6;
  data[29] = marker & 0xff;
  data.writeUInt32BE(0, 33);
  data.write('IEND', 37, 'ascii');
  data.writeUInt32BE(0, 41);
  return data;
}

class TestUri {
  constructor({ scheme = '', authority = '', path: uriPath = '', query = '', fragment = '' }) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = uriPath;
    this.query = query;
    this.fragment = fragment;
  }

  static parse(value) {
    const match = /^([a-z][a-z0-9+.-]*):\/\/(.*?)((?:\/[^?#]*)?)(?:\?([^#]*))?(?:#(.*))?$/i.exec(value)
      || /^([a-z][a-z0-9+.-]*):((?:\/[^?#]*)?)(?:\?([^#]*))?(?:#(.*))?$/i.exec(value);
    if (!match) throw new Error(`URI 无效: ${value}`);
    if (value.includes('://')) {
      return new TestUri({
        scheme: match[1],
        authority: match[2],
        path: match[3] || '',
        query: match[4] || '',
        fragment: match[5] || '',
      });
    }
    return new TestUri({
      scheme: match[1],
      path: match[2] || '',
      query: match[3] || '',
      fragment: match[4] || '',
    });
  }

  static from(parts) {
    return new TestUri(parts);
  }

  toString() {
    return `${this.scheme}:${this.authority ? `//${this.authority}` : ''}${this.path}`
      + `${this.query ? `?${this.query}` : ''}${this.fragment ? `#${this.fragment}` : ''}`;
  }
}

class TestEventEmitter {
  constructor() {
    this.event = () => ({ dispose() {} });
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
  }
}

class TestDisposable {
  constructor(dispose = () => undefined) {
    this.dispose = dispose;
  }
}

function vscodeError(code, value) {
  const error = new Error(`${code}: ${value}`);
  error.code = code;
  return error;
}

function loadProvider() {
  const providerPath = path.join(root, 'out', 'utils', 'original-map-tile-resource-provider.js');
  assert.equal(fs.existsSync(providerPath), true, '请先运行 npm run compile');
  const vscodeStub = {
    Uri: TestUri,
    EventEmitter: TestEventEmitter,
    Disposable: TestDisposable,
    FileType: { File: 1, Directory: 2 },
    FileSystemError: {
      FileNotFound: value => vscodeError('FileNotFound', value),
      NoPermissions: value => vscodeError('NoPermissions', value),
    },
  };
  const originalLoad = Module._load;
  Module._load = function loadWithVscodeStub(request, parent, isMain) {
    if (request === 'vscode') return vscodeStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(providerPath)];
    return require(providerPath);
  } finally {
    Module._load = originalLoad;
  }
}

function identity() {
  return {
    mapSha256: 'a'.repeat(64),
    engine: 'GOM',
    profile: 'classic-14',
    mapWidth: 18,
    mapHeight: 17,
    archives: [
      { archiveName: 'Tiles', archiveId: '1'.repeat(64), status: 'direct' },
      { archiveName: 'SmTiles2', archiveId: '2'.repeat(64), status: 'direct' },
    ],
    decoderRevision: 'archive-direct-v1',
    rendererRevision: 'static-renderer-v1',
    placementRevision: 'top-left-48x32-v1',
    blendRevision: 'source-over-v1',
    chunkRevision: 'cells-16x16-v1',
  };
}

function expectFileNotFound(callback, label) {
  assert.throws(callback, error => error?.code === 'FileNotFound', label);
}

function expectNoPermissions(callback, label) {
  assert.throws(callback, error => error?.code === 'NoPermissions', label);
}

function main() {
  const {
    createOriginalMapTileIdentity,
    ensureOriginalMapTileManifest,
    originalMapTilePath,
    publishOriginalMapTile,
  } = require('../out/utils/original-map-tile-cache');
  const {
    OriginalMapTileResourceProvider,
    ORIGINAL_MAP_TILE_RESOURCE_ROOT,
    ORIGINAL_MAP_TILE_RESOURCE_SCHEME,
    originalMapTileResourceUri,
  } = loadProvider();

  assert.equal(ORIGINAL_MAP_TILE_RESOURCE_SCHEME, 'boo-map-tile');
  assert.equal(ORIGINAL_MAP_TILE_RESOURCE_ROOT.scheme, 'boo-map-tile');
  assert.equal(ORIGINAL_MAP_TILE_RESOURCE_ROOT.path, '/');

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-tile-resource-'));
  try {
    const cacheRoot = path.join(temporaryRoot, 'cache');
    fs.mkdirSync(cacheRoot, { recursive: true });
    const created = createOriginalMapTileIdentity(identity());
    ensureOriginalMapTileManifest(cacheRoot, created);
    const fullChunk = testPng(768, 512, 1);
    const edgeChunk = testPng(96, 32, 2);
    publishOriginalMapTile({
      cacheRoot,
      cacheKey: created.cacheKey,
      chunkId: 'c0-r0',
      mapWidth: 18,
      mapHeight: 17,
      png: fullChunk,
    });
    publishOriginalMapTile({
      cacheRoot,
      cacheKey: created.cacheKey,
      chunkId: 'c1-r1',
      mapWidth: 18,
      mapHeight: 17,
      png: edgeChunk,
    });

    const provider = new OriginalMapTileResourceProvider(cacheRoot);
    const fullUri = originalMapTileResourceUri(created.cacheKey, 'c0-r0');
    const edgeUri = originalMapTileResourceUri(created.cacheKey, 'c1-r1');
    assert.equal(
      fullUri.toString(),
      `boo-map-tile:/${created.cacheKey}/c0-r0.png`
    );
    assert.deepEqual(Buffer.from(provider.readFile(fullUri)), fullChunk);
    assert.deepEqual(Buffer.from(provider.readFile(edgeUri)), edgeChunk);
    const stat = provider.stat(edgeUri);
    assert.equal(stat.type, 1);
    assert.equal(stat.size, edgeChunk.byteLength);
    assert.ok(Number.isFinite(stat.ctime) && stat.ctime > 0);
    assert.ok(Number.isFinite(stat.mtime) && stat.mtime > 0);
    assert.deepEqual(provider.readDirectory(ORIGINAL_MAP_TILE_RESOURCE_ROOT), []);
    provider.watch(ORIGINAL_MAP_TILE_RESOURCE_ROOT, { recursive: false, excludes: [] }).dispose();

    assert.throws(
      () => originalMapTileResourceUri(created.cacheKey.toUpperCase(), 'c0-r0'),
      /cacheKey 无效/
    );
    assert.throws(
      () => originalMapTileResourceUri(created.cacheKey, 'c01-r0'),
      /chunkId 无效/
    );

    const invalidUris = [
      new TestUri({ scheme: 'file', path: `/${created.cacheKey}/c0-r0.png` }),
      new TestUri({ scheme: 'boo-map-tile', path: `/${created.cacheKey.toUpperCase()}/c0-r0.png` }),
      new TestUri({ scheme: 'boo-map-tile', path: `/${'a'.repeat(63)}/c0-r0.png` }),
      new TestUri({ scheme: 'boo-map-tile', path: `/${created.cacheKey}/c01-r0.png` }),
      new TestUri({ scheme: 'boo-map-tile', path: `/${created.cacheKey}/c0-r01.png` }),
      new TestUri({ scheme: 'boo-map-tile', path: `/${created.cacheKey}/c0-r0.PNG` }),
      new TestUri({ scheme: 'boo-map-tile', path: `/${created.cacheKey}/c0-r0.png/extra` }),
      new TestUri({ scheme: 'boo-map-tile', path: `//${created.cacheKey}/c0-r0.png` }),
      new TestUri({ scheme: 'boo-map-tile', path: `/${created.cacheKey}/c0-r0.png/` }),
      new TestUri({ scheme: 'boo-map-tile', authority: 'host', path: `/${created.cacheKey}/c0-r0.png` }),
      new TestUri({ scheme: 'boo-map-tile', path: `/${created.cacheKey}/c0-r0.png`, query: 'x=1' }),
      new TestUri({ scheme: 'boo-map-tile', path: `/${created.cacheKey}/c0-r0.png`, fragment: 'x' }),
    ];
    for (const uri of invalidUris) {
      expectFileNotFound(() => provider.readFile(uri), `必须拒绝非 canonical URI: ${uri}`);
      expectFileNotFound(() => provider.stat(uri), `stat 必须拒绝非 canonical URI: ${uri}`);
    }

    expectFileNotFound(
      () => provider.readFile(new TestUri({
        scheme: 'boo-map-tile',
        path: `/${'b'.repeat(64)}/c0-r0.png`,
      })),
      '没有 manifest 时即使 URI canonical 也必须拒绝'
    );
    expectFileNotFound(
      () => provider.readFile(originalMapTileResourceUri(created.cacheKey, 'c0-r1')),
      '缺少切片必须返回 FileNotFound'
    );
    expectFileNotFound(
      () => provider.readFile(originalMapTileResourceUri(created.cacheKey, 'c2-r0')),
      '超出 manifest 地图范围的 chunk 必须返回 FileNotFound'
    );

    const noManifestKey = 'c'.repeat(64);
    const noManifestPath = originalMapTilePath(cacheRoot, noManifestKey, 'c0-r0');
    fs.mkdirSync(path.dirname(noManifestPath), { recursive: true });
    fs.writeFileSync(noManifestPath, fullChunk);
    expectFileNotFound(
      () => provider.readFile(originalMapTileResourceUri(noManifestKey, 'c0-r0')),
      '不得绕过 manifest 直接返回孤立 PNG'
    );

    const wrongSizePath = originalMapTilePath(cacheRoot, created.cacheKey, 'c1-r1');
    fs.writeFileSync(wrongSizePath, fullChunk);
    expectFileNotFound(
      () => provider.readFile(edgeUri),
      '必须按 manifest 地图尺寸校验边缘切片 PNG'
    );

    expectNoPermissions(() => provider.createDirectory(fullUri), 'createDirectory 必须只读');
    expectNoPermissions(() => provider.writeFile(fullUri, fullChunk, {}), 'writeFile 必须只读');
    expectNoPermissions(() => provider.delete(fullUri, {}), 'delete 必须只读');
    expectNoPermissions(() => provider.rename(fullUri, edgeUri, {}), 'rename 必须只读');
    provider.dispose();

    const extensionSource = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
    assert.match(extensionSource, /new OriginalMapTileResourceProvider\(\s*cacheMigration\.roots\.originalMapTiles\s*\)/);
    assert.match(extensionSource, /registerFileSystemProvider\(\s*ORIGINAL_MAP_TILE_RESOURCE_SCHEME/);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }

  console.log('original-map-tile-resource-provider.test.js: PASS');
}

main();
