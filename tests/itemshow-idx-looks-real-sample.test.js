const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || repositoryRoot);
const runtimeRequire = relativePath => require(path.join(runtimeRoot, relativePath));
const staticLanguage = runtimeRequire('data/static-language.json');
const { ScriptDataResolver } = runtimeRequire('out/utils/script-data-resolver');
const { buildDialogStatementCatalog } = runtimeRequire('out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = runtimeRequire('out/ui-dialog/offsets');
const { parseNpcDialogDocument } = runtimeRequire('out/ui-dialog/source-parser');
const { decodeTextFile } = runtimeRequire('out/utils/text');

const defaultMirServerRoot = 'D:\\MirServer';
const defaultClientDirectory = 'D:\\老卢专用客户端';
const defaultCustomPatchName = 'boo独家制作';
const defaultSampleRelativePath = path.join(
  'Mir200', 'Envir', 'Market_Def', '1大陆', '主城', '53燕山-西岐.txt'
);
const expectedSampleSha256 = '98280A3FF210F45E66A94CC3021C37F799FEB24C58C61B3AAB840E5B9C1AD5E8';

function skip(reason) {
  if (process.env.BOO_REQUIRE_REAL_ITEMSHOW_SAMPLE === '1') {
    throw new Error(`强制真实 ITEMSHOW 样本不允许跳过: ${reason}`);
  }
  console.log(`itemshow-idx-looks-real-sample.test.js: SKIP - ${reason}`);
}

function makeState(values = new Map()) {
  return {
    get(key, fallback) {
      return values.has(key) ? values.get(key) : fallback;
    },
    update() {
      throw new Error('ITEMSHOW 真实样本测试不允许写入 VS Code 状态');
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

  static joinPath(base, ...parts) {
    return TestUri.file(path.join(base.fsPath, ...parts));
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

function loadProviderInternals(vscodeStub) {
  const fileName = require.resolve(path.join(runtimeRoot, 'out/providers/npc-dialog-visual.js'));
  const source = fs.readFileSync(fileName, 'utf8')
    + '\nmodule.exports.__NpcDialogVisualEditorManager = NpcDialogVisualEditorManager;\n';
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscodeStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const testModule = new Module(fileName, module);
    testModule.filename = fileName;
    testModule.paths = Module._nodeModulePaths(path.dirname(fileName));
    testModule._compile(source, fileName);
    return testModule.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
}

function isPathInside(filePath, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function itemLayer(element) {
  return (element.assetLayers || []).find(layer => layer.role === 'item');
}

async function main() {
  const mirServerRoot = path.resolve(process.env.BOO_TEST_MIRSERVER || defaultMirServerRoot);
  const clientDirectory = path.resolve(
    process.env.BOO_TEST_ITEMSHOW_CLIENT_DIRECTORY || defaultClientDirectory
  );
  const customPatchName = process.env.BOO_TEST_ITEMSHOW_CUSTOM_PATCH_NAME
    ?? defaultCustomPatchName;
  const sampleFile = path.resolve(
    process.env.BOO_TEST_ITEMSHOW_SCRIPT || path.join(mirServerRoot, defaultSampleRelativePath)
  );
  const databaseFile = path.join(mirServerRoot, 'MUD2', 'db', 'herodb.DB');
  const cacheRoot = path.join(
    process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
    'BOO-NGOM-Editor', 'cache', 'patch-cache'
  );

  if (!fs.existsSync(sampleFile)) return skip(`真实脚本不存在: ${sampleFile}`);
  if (!fs.existsSync(databaseFile)) return skip(`真实 herodb.DB 不存在: ${databaseFile}`);
  if (!fs.existsSync(clientDirectory)) return skip(`当前 GOM 客户端不存在: ${clientDirectory}`);
  if (!fs.existsSync(cacheRoot)) return skip(`BOO 补丁缓存不存在: ${cacheRoot}`);

  const sampleBytes = fs.readFileSync(sampleFile);
  assert.equal(
    sha256(sampleBytes),
    expectedSampleSha256,
    '真实脚本样本已变化；请先人工复核 GETDBITEMFIELDVALUE/ITEMSHOW 对应关系再更新哈希'
  );
  const decoded = decodeTextFile(sampleBytes);
  assert.equal(decoded.encoding, 'gbk', '已核验真实样本应保持 GBK 编码');

  const expectedItems = [
    { name: '浪人冠', itemIndex: 119, looks: 30031, archiveName: 'Items3', imageIndex: 31 },
    { name: '回忆之眸', itemIndex: 170, looks: 20052, archiveName: 'Items2', imageIndex: 52 },
    { name: '传送戒指', itemIndex: 935, looks: 20450, archiveName: 'Items2', imageIndex: 450 },
  ];
  const patchState = {
    clientDirectory,
    customPatchName,
    passwordFile: '',
    entries: [],
    stateVersion: 1,
    engine: 'GOM',
  };
  const {
    findCachedPatchImage,
    isPatchCacheCurrent,
    listCachedPatchPaks,
    loadCachedPatchAssetTable,
    patchManagerStateKey,
  } = runtimeRequire('out/utils/patch-cache');
  const { clientResourceLayoutFromState } = runtimeRequire('out/utils/client-resources');
  const layout = clientResourceLayoutFromState(patchState);
  assert.ok(layout && layout.dataRoots.length > 0, '当前 GOM 客户端未生成资源根');

  const workspaceState = makeState(new Map([
    [patchManagerStateKey('GOM'), patchState],
  ]));
  const vscodeStub = {
    Uri: TestUri,
    EventEmitter: TestEventEmitter,
    Disposable: { from: () => ({ dispose() {} }) },
    workspace: {
      workspaceFolders: [{ uri: TestUri.file(mirServerRoot) }],
      getWorkspaceFolder() {
        return { uri: TestUri.file(mirServerRoot), name: 'MirServer', index: 0 };
      },
    },
    window: {},
    commands: {},
  };
  const context = {
    extensionPath: runtimeRoot,
    extensionUri: TestUri.file(runtimeRoot),
    globalStorageUri: TestUri.file(path.join(runtimeRoot, '.provider-real-sample-storage')),
    workspaceState,
  };
  const { __NpcDialogVisualEditorManager: Manager } = loadProviderInternals(vscodeStub);
  const resolver = new ScriptDataResolver();
  try {
    await resolver.prepareFor(sampleFile, 'GOM');
    const model = parseNpcDialogDocument(decoded.text, {
      uri: TestUri.file(sampleFile).toString(),
      fileName: path.basename(sampleFile),
      filePath: sampleFile,
      documentVersion: 1,
      engine: 'GOM',
      engineLabel: 'GOM',
      cursorOffset: decoded.text.indexOf('[@main]') + '[@main]'.length,
      offsets: workspaceNpcDialogOffsets(0, 0),
      catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
      dataOptions: resolver.optionsFor(sampleFile, 'GOM'),
    });
    const elements = model.pages[0].elements.filter(element => element.statementId === 'item-show');
    assert.equal(elements.length, 3, '真实样本应包含三个 ITEMSHOW 控件');

    const manager = Object.create(Manager.prototype);
    manager.context = context;
    manager.scriptDataResolver = resolver;
    const requests = [];
    const productionResolveAsset = manager.resolveAsset.bind(manager);
    manager.resolveAsset = (...args) => {
      requests.push({ ...args[0] });
      return productionResolveAsset(...args);
    };
    const webview = { asWebviewUri: uri => uri };
    await manager.hydrateAssets(model, webview, {
      fileName: sampleFile,
      uri: TestUri.file(sampleFile),
    });

    const activeCaches = listCachedPatchPaks(cacheRoot, layout.dataRoots)
      .filter(candidate => candidate.format === 'GOM' && isPatchCacheCurrent(candidate));
    const selectedEvidence = [];
    for (const [index, expected] of expectedItems.entries()) {
      const element = elements[index];
      assert.equal(element.itemPreview.itemIndex, expected.itemIndex,
        `${expected.name} 的数据库 IDX 未保留`);
      assert.equal(element.itemPreview.looks, expected.looks,
        `${expected.name} 未按 IDX 查询到真实 Looks`);
      assert.equal(element.itemPreview.dynamicFields?.includes('itemid') || false, false,
        `${expected.name} 的数据库证明 IDX 被误判为普通动态变量`);
      assert.deepEqual(itemLayer(element)?.assetRef, {
        archiveName: expected.archiveName,
        imageIndex: expected.imageIndex,
      }, `${expected.name} 的 Looks 分包映射错误`);
      const asset = itemLayer(element)?.asset;
      assert.equal(asset?.status, 'ready', `${expected.name} 的真实缓存素材未就绪`);
      assert.equal(asset?.width, 35, `${expected.name} 的真实素材宽度错误`);
      assert.equal(asset?.height, 35, `${expected.name} 的真实素材高度错误`);

      const selected = findCachedPatchImage(
        cacheRoot,
        expected.archiveName,
        expected.imageIndex,
        layout.dataRoots,
        ['pak']
      );
      assert.ok(selected, `${expected.archiveName}/${expected.imageIndex} 未命中当前 GOM 缓存`);
      assert.ok(isPathInside(selected.pak.pakPath, clientDirectory),
        `Provider 借用了当前客户端之外的同名缓存: ${selected.pak.pakPath}`);
      assert.equal(selected.pak.format, 'GOM');
      assert.equal(selected.pak.storageMode, 'direct');
      assert.ok(activeCaches.includes(selected.pak), '选中缓存不属于当前 GOM resourceRoots');
      assert.match(selected.pak.sourceMd5 || '', /^[a-f0-9]{32}$/i,
        `${expected.archiveName} 缓存缺少可核验的源包 MD5`);
      assert.match(asset.url, new RegExp(
        `^boo-archive:/${selected.pak.archiveId}/${String(expected.imageIndex).padStart(6, '0')}\\.png$`,
        'i'
      ), `${expected.name} 的 Provider URL 未指向选中的真实 archiveId`);
      const table = loadCachedPatchAssetTable(selected.pak);
      assert.equal(table.present[expected.imageIndex], 1,
        `${expected.archiveName}/${expected.imageIndex} 在真实缓存中不是有效图片槽`);
      assert.notEqual(table.blank[expected.imageIndex], 1,
        `${expected.archiveName}/${expected.imageIndex} 在真实缓存中是逻辑空槽`);
      selectedEvidence.push({
        ...expected,
        pakPath: selected.pak.pakPath,
        archiveId: selected.pak.archiveId,
        sourceMd5: selected.pak.sourceMd5,
        storageMode: selected.pak.storageMode,
        present: table.present[expected.imageIndex],
        blank: table.blank[expected.imageIndex],
      });
    }

    assert.equal(requests.some(reference => (
      reference.archiveName === 'Items' && [119, 170, 935].includes(reference.imageIndex)
    )), false, 'Provider 仍把 StdItems IDX 当成 Items 图片序号请求');
    const legacyOrForeignItems = listCachedPatchPaks(cacheRoot)
      .filter(candidate => /^items[23]$/i.test(candidate.pakName))
      .filter(candidate => !layout.dataRoots.some(dataRoot => isPathInside(candidate.pakPath, dataRoot)));
    assert.ok(legacyOrForeignItems.every(candidate => (
      !elements.some(element => itemLayer(element)?.asset?.url?.includes(candidate.archiveId || '__none__'))
    )), '真实 ITEMSHOW 借用了其它客户端或其它引擎的同名缓存');

    console.log(`itemshow-idx-looks-real-sample.test.js: script=${sampleFile}`);
    console.log(`itemshow-idx-looks-real-sample.test.js: runtime-root=${runtimeRoot}`);
    console.log(`itemshow-idx-looks-real-sample.test.js: scriptSha256=${expectedSampleSha256}`);
    console.log(`itemshow-idx-looks-real-sample.test.js: database=${databaseFile}; sha256=${sha256(fs.readFileSync(databaseFile))}`);
    console.log(`itemshow-idx-looks-real-sample.test.js: clientDirectory=${clientDirectory}`);
    console.log(`itemshow-idx-looks-real-sample.test.js: resourceRoots=${JSON.stringify(layout.dataRoots)}`);
    for (const [index, expected] of expectedItems.entries()) {
      const layer = itemLayer(elements[index]);
      const evidence = selectedEvidence[index];
      console.log(
        `itemshow-idx-looks-real-sample.test.js: ${expected.name} IDX=${expected.itemIndex} -> Looks=${expected.looks} -> ${expected.archiveName}/${String(expected.imageIndex).padStart(6, '0')} (${layer.asset.width}x${layer.asset.height}) pak=${evidence.pakPath} archiveId=${evidence.archiveId} sourceMd5=${evidence.sourceMd5} storage=${evidence.storageMode} present=${evidence.present} blank=${evidence.blank} url=${layer.asset.url}`
      );
    }
  } finally {
    resolver.dispose();
  }
  console.log('itemshow-idx-looks-real-sample.test.js: PASS');
}

main().catch(error => {
  console.error('itemshow-idx-looks-real-sample.test.js: RED FAILURE');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
