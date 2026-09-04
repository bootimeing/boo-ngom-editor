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
  data[26] = 0;
  data[27] = 0;
  data[28] = 0;
  data[29] = marker & 0xff;
  data.writeUInt32BE(0, 33);
  data.write('IEND', 37, 'ascii');
  data.writeUInt32BE(0, 41);
  return data;
}

class TestUri {
  constructor({ scheme = '', authority = '', path: uriPath = '', query = '', fragment = '', fsPath = '' }) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = uriPath;
    this.query = query;
    this.fragment = fragment;
    this.fsPath = fsPath;
  }

  static file(filePath) {
    const resolved = path.resolve(filePath);
    return new TestUri({
      scheme: 'file',
      path: `/${resolved.replace(/\\/g, '/')}`.replace(/^\/\//, '/'),
      fsPath: resolved,
    });
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
    if (this.scheme === 'file') return `file://${this.path}`;
    return `${this.scheme}:${this.authority ? `//${this.authority}` : ''}${this.path}`
      + `${this.query ? `?${this.query}` : ''}${this.fragment ? `#${this.fragment}` : ''}`;
  }
}

class TestEventEmitter {
  constructor() {
    this.event = () => ({ dispose() {} });
  }

  fire() {}

  dispose() {}
}

class TestDisposable {
  constructor(dispose = () => undefined) {
    this.dispose = dispose;
  }
}

function makeState() {
  return {
    get(_key, fallback) {
      return fallback;
    },
    async update() {},
  };
}

function makeContext(storagePath) {
  return {
    extensionPath: root,
    extensionUri: TestUri.file(root),
    globalStorageUri: TestUri.file(storagePath),
    workspaceState: makeState(),
    globalState: makeState(),
    subscriptions: {
      push() {},
    },
  };
}

function makeVscodeStub(workspaceRoot) {
  return {
    Uri: TestUri,
    EventEmitter: TestEventEmitter,
    Disposable: TestDisposable,
    FileType: { File: 1, Directory: 2 },
    FileSystemError: {
      FileNotFound: value => new Error(`FileNotFound: ${value}`),
      NoPermissions: value => new Error(`NoPermissions: ${value}`),
    },
    ViewColumn: { Active: 1, Beside: 2 },
    workspace: {
      workspaceFolders: [{ uri: TestUri.file(workspaceRoot) }],
      getConfiguration(section) {
        assert.equal(section, 'boo');
        return {
          get(key, fallback) {
            return key === 'engine' ? 'GOM' : fallback;
          },
        };
      },
      onDidChangeWorkspaceFolders() {
        return { dispose() {} };
      },
      onDidChangeConfiguration() {
        return { dispose() {} };
      },
      textDocuments: [],
    },
    window: {
      showWarningMessage() {},
      showErrorMessage() {},
      createWebviewPanel() {
        throw new Error('本测试直接调用 Provider 私有生产方法，不应创建真实 WebviewPanel');
      },
    },
  };
}

function loadCompiledProvider(vscodeStub) {
  const providerPath = path.join(root, 'out', 'providers', 'map-preview.js');
  assert.ok(
    fs.existsSync(providerPath),
    'out/providers/map-preview.js 不存在；请先运行 npm run compile'
  );
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

function makePanel(messages) {
  return {
    webview: {
      asWebviewUri(uri) {
        return uri;
      },
      async postMessage(message) {
        messages.push(message);
        return true;
      },
    },
  };
}

function makeSession(identity, requestId, generation) {
  return {
    mapKey: 'map:test',
    engineId: 'GOM',
    filePath: path.join(root, 'test.map'),
    model: {
      width: 2,
      height: 2,
    },
    requestId,
    generation,
    latestViewportSeq: -1,
    mapSha256: identity.mapSha256,
    staticCacheIdentity: identity,
  };
}

function resolvedViewportData(includeStaticSources) {
  return {
    resources: [
      { key: 'tiles:0' },
      { key: 'smtiles:0' },
      { key: 'objects:0' },
      { key: 'mapeffect:test:1' },
    ],
    tiles: includeStaticSources ? [0, 0, 0] : [],
    smTiles: includeStaticSources ? [1, 1, 1] : [],
    objects: [1, 1, 2],
    objectAnimationFrames: [2],
    objectAnimationTicks: [1],
    objectAnimationSetIds: [0],
    objectAnimationSets: [[2]],
    permanentMapEffects: [{ x: 1, y: 1, speedMs: 150, drawMode: 0, frameSetId: 0 }],
    permanentMapEffectSets: [[3]],
    animatedObjectCount: 1,
    permanentMapEffectCount: 1,
    warning: '',
  };
}

async function requestViewport(provider, identity, requestId, generation, messages) {
  const session = makeSession(identity, requestId, generation);
  provider.currentMap = { key: session.mapKey };
  provider.originalMapVersion = generation;
  provider.originalMapSession = session;
  provider.panel = makePanel(messages);
  provider.prepareOriginalMapStaticCache = async () => identity;
  provider.resolveOriginalMapData = async (
    _session,
    _requestId,
    _generation,
    _viewport,
    _viewportSeq,
    includeStaticSources
  ) => resolvedViewportData(includeStaticSources);
  await provider.loadOriginalMapViewport({
    type: 'loadOriginalMapViewport',
    requestId,
    generation,
    viewportSeq: 1,
    viewport: { left: 0, top: 0, right: 1, bottom: 1 },
  });
  const data = messages.find(message => message.type === 'originalMapViewportData');
  assert.ok(data, 'Provider 必须发布 originalMapViewportData');
  return { session, data };
}

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-provider-cache-hit-'));
  const previousLocalAppData = process.env.LOCALAPPDATA;
  try {
    const localAppData = path.join(temporaryRoot, 'Local');
    const workspaceRoot = path.join(temporaryRoot, 'workspace');
    const storagePath = path.join(
      temporaryRoot,
      'Roaming',
      'Code',
      'User',
      'globalStorage',
      'boo'
    );
    fs.mkdirSync(workspaceRoot, { recursive: true });
    process.env.LOCALAPPDATA = localAppData;

    const vscodeStub = makeVscodeStub(workspaceRoot);
    const { MapPreviewProvider } = loadCompiledProvider(vscodeStub);
    const {
      createOriginalMapTileIdentity,
      ensureOriginalMapTileManifest,
      originalMapTilePath,
    } = require('../out/utils/original-map-tile-cache');
    const { getOriginalMapTileCacheRoot } = require('../out/utils/cache-storage');

    const context = makeContext(storagePath);
    const cacheRoot = getOriginalMapTileCacheRoot(context);
    assert.equal(
      cacheRoot,
      path.join(localAppData, 'BOO-NGOM-Editor', 'cache', 'original-map-tiles-v1')
    );
    const identity = createOriginalMapTileIdentity({
      mapSha256: 'a'.repeat(64),
      engine: 'GOM',
      profile: 'classic-14',
      mapWidth: 2,
      mapHeight: 2,
      archives: [
        { archiveName: 'Tiles', archiveId: '1'.repeat(64), status: 'direct' },
        { archiveName: 'SmTiles', archiveId: '2'.repeat(64), status: 'direct' },
      ],
      decoderRevision: 'archive-direct-provider-test-v1',
      rendererRevision: 'browser-canvas-static-v1',
      placementRevision: 'tile-sm-top-left-48x32-seam1-v1',
      blendRevision: 'source-over-nearest-v1',
      chunkRevision: 'cells-16x16-lod0-v1',
    });
    ensureOriginalMapTileManifest(cacheRoot, identity);
    const tilePath = originalMapTilePath(cacheRoot, identity.cacheKey, 'c0-r0');

    const firstMessages = [];
    const firstProvider = new MapPreviewProvider(context);
    const first = await requestViewport(
      firstProvider,
      identity,
      100,
      7,
      firstMessages
    );
    assert.equal(first.data.staticCacheEnabled, true);
    assert.equal(first.data.staticSourceIncluded, true);
    assert.equal(first.data.staticChunks.length, 1);
    assert.equal(first.data.staticChunks[0].chunkId, 'c0-r0');
    assert.equal(first.data.staticChunks[0].cached, false);
    assert.equal(first.data.staticChunks[0].url, '');
    assert.deepEqual(first.data.tiles, [0, 0, 0]);
    assert.deepEqual(first.data.smTiles, [1, 1, 1]);
    assert.deepEqual(first.data.objects, [1, 1, 2]);

    const pngDataUrl = `data:image/png;base64,${testPng(96, 64, 7).toString('base64')}`;
    const storeMessage = {
      type: 'storeOriginalMapTile',
      requestId: 100,
      generation: 7,
      viewportSeq: 1,
      cacheKey: identity.cacheKey,
      chunkId: 'c0-r0',
      pngDataUrl,
    };
    await firstProvider.storeOriginalMapTile({ ...storeMessage, generation: 6 });
    assert.equal(fs.existsSync(tilePath), false, '旧 generation 不得落盘');
    await firstProvider.storeOriginalMapTile({ ...storeMessage, viewportSeq: 0 });
    assert.equal(fs.existsSync(tilePath), false, '旧 viewportSeq 不得落盘');
    await firstProvider.storeOriginalMapTile(storeMessage);
    assert.equal(fs.existsSync(tilePath), true, '当前 generation/viewportSeq 必须发布切片');
    const stored = firstMessages.find(message => message.type === 'originalMapTileStored');
    assert.ok(stored, '有效落盘必须回报 originalMapTileStored');
    assert.equal(stored.status, 'published');

    firstProvider.originalMapSession = undefined;
    firstProvider.panel = undefined;

    const secondMessages = [];
    const secondProvider = new MapPreviewProvider(makeContext(storagePath));
    const second = await requestViewport(
      secondProvider,
      identity,
      200,
      8,
      secondMessages
    );
    assert.equal(second.data.staticCacheEnabled, true);
    assert.equal(second.data.staticSourceIncluded, false);
    assert.equal(second.data.staticChunks.length, 1);
    assert.equal(second.data.staticChunks[0].cached, true);
    assert.equal(
      second.data.staticChunks[0].url,
      `boo-map-tile:/${identity.cacheKey}/c0-r0.png`
    );
    assert.equal(second.data.staticChunks[0].url.startsWith('file:'), false);
    assert.deepEqual(second.data.tiles, [], '持久命中后不得再次发送 Tiles placement');
    assert.deepEqual(second.data.smTiles, [], '持久命中后不得再次发送 SmTiles placement');
    assert.deepEqual(second.data.objects, [1, 1, 2], 'Objects 动态层必须保留');
    assert.deepEqual(second.data.objectAnimationFrames, [2], 'Objects 动画控制必须保留');
    assert.deepEqual(second.data.objectAnimationSets, [[2]], 'Objects 动画帧组必须保留');
    assert.deepEqual(
      second.data.permanentMapEffects,
      [{ x: 1, y: 1, speedMs: 150, drawMode: 0, frameSetId: 0 }],
      '永久 MAPEFFECT 必须保留'
    );
    assert.deepEqual(second.data.permanentMapEffectSets, [[3]]);

    console.log('map-preview-persistent-tile-provider.test.js: PASS');
  } finally {
    if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previousLocalAppData;
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
