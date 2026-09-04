const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const defaultMirServerRoot = 'D:\\MirServer';
const defaultClientDirectory = 'D:\\老卢专用客户端';
const defaultCustomPatchName = 'boo独家制作';

function skip(reason) {
  console.log(`map-effect-provider-real-sample.test.js: SKIP - ${reason}`);
}

function samePath(left, right) {
  return path.resolve(left).toLocaleLowerCase('zh-CN')
    === path.resolve(right).toLocaleLowerCase('zh-CN');
}

function isPathInside(filePath, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function archiveBaseName(value) {
  const text = String(value || '');
  return path.basename(text, path.extname(text)).toLocaleLowerCase('zh-CN');
}

function findFileCaseInsensitive(directory, fileName) {
  if (!fs.existsSync(directory)) return undefined;
  const key = fileName.toLocaleLowerCase('zh-CN');
  const entry = fs.readdirSync(directory, { withFileTypes: true })
    .find(candidate => candidate.isFile()
      && candidate.name.toLocaleLowerCase('zh-CN') === key);
  return entry ? path.join(directory, entry.name) : undefined;
}

function makeState(values = new Map()) {
  return {
    get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    update() {
      throw new Error('真实 Provider 集成测试不允许写入 VS Code 状态');
    },
  };
}

class TestUri {
  constructor(scheme, uriPath, fsPath = '') {
    this.scheme = scheme;
    this.path = uriPath;
    this.fsPath = fsPath;
  }

  static file(filePath) {
    const resolved = path.resolve(filePath);
    const uriPath = `/${resolved.replace(/\\/g, '/')}`.replace(/^\/\//, '/');
    return new TestUri('file', uriPath, resolved);
  }

  static parse(value) {
    const match = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(String(value));
    if (!match) return TestUri.file(value);
    return new TestUri(match[1], match[2] || '/', '');
  }

  static from(parts) {
    return new TestUri(parts.scheme, parts.path || '/', parts.fsPath || '');
  }

  toString() {
    if (this.scheme === 'file') return `file://${this.path}`;
    return `${this.scheme}:${this.path}`;
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

function slotSequence(data, frameSet) {
  return frameSet.map(resourceId => {
    const resource = data.resources[resourceId];
    assert.ok(resource, `MAPEFFECT 帧资源 ${resourceId} 不存在`);
    const match = /:(\d+)$/.exec(resource.key);
    assert.ok(match, `MAPEFFECT 资源键缺少槽号: ${resource.key}`);
    return Number(match[1]);
  });
}

async function main() {
  const mirServerRoot = path.resolve(
    process.env.BOO_TEST_MIRSERVER || defaultMirServerRoot
  );
  const clientDirectory = path.resolve(
    process.env.BOO_TEST_MAP_EFFECT_CLIENT_DIRECTORY || defaultClientDirectory
  );
  const customPatchName = process.env.BOO_TEST_MAP_EFFECT_CUSTOM_PATCH_NAME
    ?? defaultCustomPatchName;
  const envirDirectory = path.join(mirServerRoot, 'Mir200', 'Envir');
  const mapInfoPath = path.join(envirDirectory, 'MapInfo.txt');
  const startupPath = path.join(envirDirectory, 'MapQuest_Def', 'QManage.txt');
  const cacheRoot = path.join(
    process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
    'BOO-NGOM-Editor',
    'cache',
    'patch-cache'
  );

  if (!fs.existsSync(mirServerRoot)) return skip(`MirServer 不存在: ${mirServerRoot}`);
  if (!fs.existsSync(mapInfoPath)) return skip(`MapInfo.txt 不存在: ${mapInfoPath}`);
  if (!fs.existsSync(startupPath)) return skip(`QManage.txt 不存在: ${startupPath}`);
  if (!fs.existsSync(clientDirectory)) return skip(`当前客户端不存在: ${clientDirectory}`);
  if (!fs.existsSync(cacheRoot)) return skip(`BOO 补丁缓存不存在: ${cacheRoot}`);

  const {
    isPatchCacheCurrent,
    listCachedPatchPaks,
    loadCachedPatchAssetTable,
    patchManagerStateKey,
  } = require('../out/utils/patch-cache');
  const { loadPakIndex } = require('../out/utils/pak');
  const { scanStartupPermanentMapEffects } = require('../out/utils/map-effects');
  const { selectCustomNpcArchive } = require('../out/utils/map-entities');

  const patchState = {
    clientDirectory,
    customPatchName,
    passwordFile: '',
    entries: [],
    stateVersion: 1,
    engine: 'GOM',
  };
  const workspaceStateValues = new Map([
    [patchManagerStateKey('GOM'), patchState],
  ]);
  const workspaceState = makeState(workspaceStateValues);
  const globalState = makeState();
  const disposables = [];
  const vscodeStub = {
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
      workspaceFolders: [{ uri: TestUri.file(mirServerRoot) }],
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
        throw new Error('本测试通过私有生产方法加载，不应创建真实 WebviewPanel');
      },
    },
  };
  const context = {
    extensionPath: root,
    extensionUri: TestUri.file(root),
    globalStorageUri: TestUri.file(path.join(root, '.provider-real-sample-storage')),
    workspaceState,
    globalState,
    subscriptions: {
      push(...items) {
        disposables.push(...items);
      },
    },
  };

  const { MapPreviewProvider } = loadCompiledProvider(vscodeStub);
  const provider = new MapPreviewProvider(context);
  try {
    const targetMap = provider.maps.find(map => map.mapId === '钓鱼台');
    if (!targetMap) return skip('MapInfo.txt 中不存在逻辑地图 ID “钓鱼台”');
    assert.equal(targetMap.originalMapId, 'boo_钓鱼台');
    assert.notEqual(
      targetMap.mapId.toLocaleLowerCase('zh-CN'),
      targetMap.originalMapId.toLocaleLowerCase('zh-CN'),
      '真实样本必须能区分逻辑 mapId 与物理 originalMapId'
    );

    const layout = provider.clientResourceLayout('GOM');
    assert.ok(layout, '当前 GOM 客户端状态未生成资源布局');
    assert.ok(layout.dataRoots.length > 0, '当前客户端没有 data 资源根');
    const expectedPakPath = layout.dataRoots
      .map(dataRoot => findFileCaseInsensitive(dataRoot, '技能特效.pak'))
      .find(Boolean);
    if (!expectedPakPath) {
      return skip(`当前客户端未找到技能特效.pak: ${layout.dataRoots.join(' | ')}`);
    }

    const pakIndex = loadPakIndex(mirServerRoot);
    assert.ok(pakIndex, '真实 MirServer 的 EffectImageList.txt 无法加载');
    const configured = pakIndex.pakList.find(entry => entry.willIdx === 9);
    assert.deepEqual(
      configured,
      { name: '技能特效', willIdx: 9, extension: 'pak' },
      'EffectImageList WIL 9 必须精确映射到技能特效.Pak'
    );

    const activePatchPaks = provider.activePatchPaks('GOM', layout);
    const activeSameName = activePatchPaks.filter(
      item => archiveBaseName(item.pakName) === '技能特效'
    );
    const expectedActiveArchive = activePatchPaks.find(
      item => samePath(item.pakPath, expectedPakPath)
    );
    if (!expectedActiveArchive) {
      return skip(`当前客户端的技能特效.pak 尚无当前可用缓存: ${expectedPakPath}`);
    }
    const selected = selectCustomNpcArchive(9, pakIndex.pakList, activePatchPaks).archive;
    assert.ok(selected, 'EffectImageList WIL 9 未从 activePatchPaks 选出技能特效归档');
    assert.ok(
      samePath(selected.pakPath, expectedPakPath),
      `Provider 没有选中当前客户端的技能特效.pak: ${selected.pakPath}`
    );
    assert.equal(activeSameName.length, 1, '当前客户端中的同名技能特效缓存应唯一');
    assert.equal(activeSameName[0], selected);
    assert.equal(selected.format, 'GOM');
    assert.equal(selected.storageMode, 'direct');
    assert.equal(selected.storedWillIdx, 9);
    assert.equal(isPatchCacheCurrent(selected), true, '当前客户端的技能特效缓存已过期');
    assert.ok(
      layout.dataRoots.some(dataRoot => isPathInside(selected.pakPath, dataRoot)),
      `Provider 选中了当前客户端之外的缓存: ${selected.pakPath}`
    );

    const allSameName = listCachedPatchPaks(cacheRoot)
      .filter(item => archiveBaseName(item.pakName) === '技能特效');
    const foreignSameName = allSameName.filter(item => (
      !layout.dataRoots.some(dataRoot => isPathInside(item.pakPath, dataRoot))
    ));
    assert.ok(
      foreignSameName.every(item => item.archiveId !== selected.archiveId),
      '当前客户端缓存与其它客户端同名缓存身份混淆'
    );
    assert.ok(
      foreignSameName.every(item => !activePatchPaks.includes(item)),
      'activePatchPaks 泄漏了其它客户端的同名技能特效缓存'
    );

    const table = loadCachedPatchAssetTable(selected);
    const requiredSlots = [
      ...Array.from({ length: 12 }, (_, index) => 340 + index),
      ...Array.from({ length: 10 }, (_, index) => 360 + index),
    ];
    const missingSlots = requiredSlots.filter(imageIndex => (
      imageIndex < 0
      || imageIndex >= table.slotCount
      || !table.present[imageIndex]
    ));
    if (missingSlots.length) {
      return skip(`真实技能特效样本帧不完整: ${missingSlots.join(', ')}`);
    }

    const scan = scanStartupPermanentMapEffects(envirDirectory);
    assert.equal(scan.truncated, false, '真实启动脚本 MAPEFFECT 扫描被安全预算截断');
    const logicalDefinitions = scan.definitions.filter(effect => (
      effect.mapName.trim().toLocaleLowerCase('zh-CN')
        === targetMap.mapId.trim().toLocaleLowerCase('zh-CN')
    ));
    assert.equal(logicalDefinitions.length, 9, '钓鱼台逻辑 mapId 应有 9 条永久 MAPEFFECT');
    assert.ok(
      logicalDefinitions.every(effect => effect.mapName !== targetMap.originalMapId),
      '样本定义必须由逻辑 mapId 命中，不能靠物理 MAP 文件名命中'
    );
    assert.deepEqual(
      logicalDefinitions.map(effect => [effect.startImage, effect.frameCount]),
      [
        ...Array.from({ length: 8 }, () => [360, 10]),
        [340, 12],
      ],
      '真实脚本样本不再是 8 个 360..369 与 1 个 340..351'
    );

    const posted = [];
    provider.currentMap = targetMap;
    provider.panel = {
      webview: {
        asWebviewUri(uri) {
          return uri;
        },
        async postMessage(message) {
          if (
            message?.type === 'originalMapReady'
            || message?.type === 'originalMapViewportData'
            || message?.type === 'originalMapError'
          ) {
            posted.push(message);
          }
          return true;
        },
      },
    };
    await provider.loadOriginalMap({ type: 'loadOriginalMap', requestId: 90401 });

    const ready = posted.find(message => message.type === 'originalMapReady');
    assert.ok(ready, 'Provider 未发送 originalMapReady');
    assert.ok(Number.isSafeInteger(ready.generation), 'originalMapReady 未返回有效 generation');
    await provider.loadOriginalMapViewport({
      type: 'loadOriginalMapViewport',
      requestId: 90401,
      generation: ready.generation,
      viewportSeq: 1,
      viewport: { left: 0, top: 0, right: 85, bottom: 85 },
    });

    const loadError = posted.find(message => message.type === 'originalMapError');
    assert.equal(loadError, undefined, loadError?.message || 'Provider 真实原始地图加载失败');
    const data = posted.find(message => message.type === 'originalMapViewportData');
    assert.ok(data, 'Provider 未发送 originalMapViewportData');
    assert.deepEqual(
      { width: ready.width, height: ready.height, fileName: ready.fileName },
      { width: 86, height: 86, fileName: 'boo_钓鱼台.map' },
      '真实钓鱼台 MAP 样本应为 86x86 的 boo_钓鱼台.map'
    );
    assert.equal(data.permanentMapEffectCount, 9);
    assert.equal(data.permanentMapEffects.length, 9);
    assert.equal(data.permanentMapEffectSets.length, 2, '相同连续帧应在 Provider 中去重为 2 组');

    const frameSetSlots = data.permanentMapEffectSets.map(
      frameSet => slotSequence(data, frameSet)
    );
    assert.deepEqual(frameSetSlots, [
      Array.from({ length: 10 }, (_, index) => 360 + index),
      Array.from({ length: 12 }, (_, index) => 340 + index),
    ]);
    assert.deepEqual(
      data.permanentMapEffects.map(effect => effect.frameSetId),
      [0, 0, 0, 0, 0, 0, 0, 0, 1],
      '8 个 360..369 placement 应共用第一组帧，340..351 应独立为第二组'
    );
    assert.deepEqual(
      data.permanentMapEffects.map(effect => [effect.x, effect.y]),
      [
        [29, 35],
        [37, 27],
        [48, 26],
        [57, 35],
        [57, 47],
        [49, 55],
        [38, 56],
        [30, 48],
        [24, 41],
      ]
    );
    assert.ok(
      data.permanentMapEffects.every(effect => (
        effect.x >= 0 && effect.x < ready.width
        && effect.y >= 0 && effect.y < ready.height
        && effect.speedMs === 150
        && effect.drawMode === 0
      )),
      '有永久 MAPEFFECT 超出 86x86 坐标或动画参数被改写'
    );

    const permanentResourceIds = new Set(data.permanentMapEffectSets.flat());
    assert.equal(permanentResourceIds.size, 22, '2 组连续帧应只产生 22 个去重帧资源');
    const expectedResourcePrefix = `mapeffect:${path.normalize(selected.manifestPath).toLocaleLowerCase('zh-CN')}:`;
    for (const resourceId of permanentResourceIds) {
      const resource = data.resources[resourceId];
      assert.ok(resource.key.startsWith(expectedResourcePrefix));
      assert.equal(resource.animationOnly, true);
      if (!resource.blank) {
        assert.match(
          resource.url,
          new RegExp(`^boo-archive:/${selected.archiveId}/\\d{6}\\.png$`),
          '永久 MAPEFFECT URL 未指向当前客户端选中的 archiveId'
        );
      }
    }

    console.log(`map-effect-provider-real-sample.test.js: map=${targetMap.mapId} -> ${ready.fileName} (${ready.width}x${ready.height})`);
    console.log(`map-effect-provider-real-sample.test.js: archive=${selected.pakPath}`);
    console.log(`map-effect-provider-real-sample.test.js: archiveId=${selected.archiveId}`);
    console.log(`map-effect-provider-real-sample.test.js: foreignSameNameCaches=${foreignSameName.length}`);
    console.log(`map-effect-provider-real-sample.test.js: placements=${data.permanentMapEffectCount}, frameSets=${JSON.stringify(frameSetSlots)}`);
    console.log('map-effect-provider-real-sample.test.js: PASS');
  } finally {
    for (const disposable of disposables) disposable?.dispose?.();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
