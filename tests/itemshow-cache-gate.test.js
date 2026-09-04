const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || repositoryRoot);
const runtimeRequire = relativePath => require(path.join(runtimeRoot, relativePath));
const staticLanguage = runtimeRequire('data/static-language.json');
const { buildDialogStatementCatalog } = runtimeRequire('out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = runtimeRequire('out/ui-dialog/offsets');
const { parseNpcDialogDocument } = runtimeRequire('out/ui-dialog/source-parser');
const { GOM_DECODER_REVISION } = runtimeRequire('out/utils/pak-reader');
const {
  ARCHIVE_INDEX_DECODER_REVISION,
  ARCHIVE_INDEX_FILE,
  ARCHIVE_INDEX_SCHEMA_VERSION,
} = runtimeRequire('out/utils/archive-index');
const {
  invalidatePatchCacheIndex,
  isPatchCacheCurrent,
  listCachedPatchPaks,
  patchManagerStateKey,
} = runtimeRequire('out/utils/patch-cache');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const INDEX_MAGIC = Buffer.from('BOOIDX01', 'ascii');
const INDEX_HEADER_SIZE = 24;
const INDEX_RECORD_SIZE = 40;

class TestUri {
  constructor(scheme, uriPath, fsPath = '') {
    this.scheme = scheme;
    this.path = uriPath;
    this.fsPath = fsPath;
  }

  static file(filePath) {
    const resolved = path.resolve(filePath);
    return new TestUri('file', `/${resolved.replace(/\\/g, '/')}`.replace(/^\/\//, '/'), resolved);
  }

  static parse(value) {
    const match = /^([a-z][a-z0-9+.-]*):(.*)$/i.exec(String(value));
    return match
      ? new TestUri(match[1], match[2] || '/', '')
      : TestUri.file(value);
  }

  static from(parts) {
    return new TestUri(parts.scheme, parts.path || '/', parts.fsPath || '');
  }

  static joinPath(base, ...parts) {
    return TestUri.file(path.join(base.fsPath, ...parts));
  }

  toString() {
    return this.scheme === 'file' ? `file://${this.path}` : `${this.scheme}:${this.path}`;
  }
}

class TestEventEmitter {
  constructor() { this.event = () => ({ dispose() {} }); }
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

function md5(value) {
  return crypto.createHash('md5').update(value).digest('hex');
}

function cacheBase(localAppData) {
  return path.join(localAppData, 'BOO-NGOM-Editor', 'cache');
}

function writeLegacyCache(cacheRoot, id, pakPath, slotCount) {
  const cacheDir = path.join(cacheRoot, id);
  fs.mkdirSync(cacheDir, { recursive: true });
  const assets = [];
  for (let index = 0; index < slotCount; index++) {
    const imagePath = path.join(cacheDir, `${String(index).padStart(6, '0')}.png`);
    fs.writeFileSync(imagePath, Buffer.from(`png-${id}-${index}`));
    assets.push({
      name: String(index).padStart(6, '0'),
      path: imagePath,
      pakName: path.basename(pakPath, path.extname(pakPath)),
      pakPath,
      willIdx: 0,
      localIdx: index,
      imageIdx: index,
      width: 35,
      height: 35,
      offsetX: 0,
      offsetY: 0,
      isBlank: false,
      source: 'pak',
    });
  }
  fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify({
    version: 4,
    format: 'GOM',
    pakName: path.basename(pakPath, path.extname(pakPath)),
    pakPath,
    sourceMd5: md5(fs.readFileSync(pakPath)),
    decoderRevision: GOM_DECODER_REVISION,
    willIdx: 0,
    slotCount,
    assets,
  }));
}

function encodeIndex(slotCount, blocks) {
  const result = Buffer.alloc(INDEX_HEADER_SIZE + blocks.length * INDEX_RECORD_SIZE);
  INDEX_MAGIC.copy(result, 0);
  result.writeUInt32LE(ARCHIVE_INDEX_SCHEMA_VERSION, 8);
  result.writeUInt32LE(INDEX_RECORD_SIZE, 12);
  result.writeUInt32LE(blocks.length, 16);
  result.writeUInt32LE(slotCount, 20);
  blocks.forEach((block, index) => {
    const offset = INDEX_HEADER_SIZE + index * INDEX_RECORD_SIZE;
    result.writeUInt32LE(block.logicalIndex, offset);
    result.writeBigUInt64LE(BigInt(block.payloadOffset || 0), offset + 4);
    result.writeUInt32LE(block.payloadSize || 4, offset + 12);
    result.writeUInt32LE(block.compressedSize || 0, offset + 16);
    result.writeUInt32LE(block.rawSize || 4, offset + 20);
    result.writeUInt16LE(block.imageType || 7, offset + 24);
    result.writeUInt16LE(block.flags || 1, offset + 26);
    result.writeUInt16LE(block.width || 35, offset + 28);
    result.writeUInt16LE(block.height || 35, offset + 30);
    result.writeInt32LE(block.offsetX || 0, offset + 32);
    result.writeInt32LE(block.offsetY || 0, offset + 36);
  });
  return result;
}

function writeDirectCache(
  indexRoot,
  archiveId,
  pakPath,
  slotCount,
  blocks,
  sourceMd5,
  format = 'GOM'
) {
  const stat = fs.statSync(pakPath);
  const cacheDir = path.join(indexRoot, archiveId);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, ARCHIVE_INDEX_FILE), encodeIndex(slotCount, blocks));
  fs.writeFileSync(path.join(cacheDir, 'summary.json'), JSON.stringify({
    schemaVersion: ARCHIVE_INDEX_SCHEMA_VERSION,
    decoderRevision: ARCHIVE_INDEX_DECODER_REVISION,
    archiveId,
    format,
    pakName: path.basename(pakPath, path.extname(pakPath)),
    pakPath,
    sourceSize: stat.size,
    sourceMtimeMs: stat.mtimeMs,
    sourceMd5,
    passwordHash: '0'.repeat(64),
    storedWillIdx: 0,
    slotCount,
    blockCount: blocks.length,
    createdAt: Date.now(),
  }));
}

function parseItemShow(sourceFile, itemIndices, engine = 'GOM') {
  const source = [
    '[@main]',
    '#SAY',
    ...itemIndices.map((itemIndex, index) => engine === '996PC'
      ? `<ItemShow|id=${index + 1}|x=${10 + index * 40}|y=20|itemid=${itemIndex}|itemcount=1|bgtype=1>`
      : `<&ITEMSHOW:${itemIndex}:0:${10 + index * 40}:20:48>`),
  ].join('\r\n');
  return parseNpcDialogDocument(source, {
    uri: TestUri.file(sourceFile).toString(),
    fileName: path.basename(sourceFile),
    filePath: sourceFile,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function itemLayers(model) {
  return model.pages[0].elements
    .filter(element => element.statementId === 'item-show'
      || element.statementId === 'newui-itemshow-996pc')
    .map(element => (element.assetLayers || []).find(layer => layer.role === 'item'));
}

function makeScenario(root, options = {}) {
  const engine = options.engine || 'GOM';
  const localAppData = path.join(root, 'LocalAppData');
  const workspaceRoot = path.join(root, 'MirServer');
  const sourceFile = path.join(workspaceRoot, 'Mir200', 'Envir', 'Market_Def', 'cache-gate.txt');
  const clientRoot = path.join(root, 'Client');
  const customData = path.join(clientRoot, 'CustomPatch', 'Data');
  const baseData = path.join(clientRoot, 'Data');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.mkdirSync(customData, { recursive: true });
  fs.mkdirSync(baseData, { recursive: true });
  fs.writeFileSync(sourceFile, 'fixture');

  const state = {
    clientDirectory: clientRoot,
    customPatchName: 'CustomPatch',
    passwordFile: '',
    entries: [],
    stateVersion: 1,
    engine,
  };
  const vscodeStub = {
    Uri: TestUri,
    EventEmitter: TestEventEmitter,
    Disposable: { from: () => ({ dispose() {} }) },
    workspace: {
      workspaceFolders: [{ uri: TestUri.file(workspaceRoot) }],
      getWorkspaceFolder() { return { uri: TestUri.file(workspaceRoot) }; },
    },
    window: {},
    commands: {},
  };
  const context = {
    extensionPath: runtimeRoot,
    extensionUri: TestUri.file(runtimeRoot),
    globalStorageUri: TestUri.file(path.join(root, 'legacy-storage')),
    workspaceState: {
      get(key) { return key === patchManagerStateKey(engine) ? state : undefined; },
      update() { throw new Error('cache gate test must not write workspace state'); },
    },
  };
  return {
    ...options,
    engine,
    localAppData,
    workspaceRoot,
    sourceFile,
    clientRoot,
    customData,
    baseData,
    patchCacheRoot: path.join(cacheBase(localAppData), 'patch-cache'),
    indexRoot: path.join(cacheBase(localAppData), 'archive-index-v1'),
    vscodeStub,
    context,
  };
}

async function hydrateScenario(scenario, itemIndices, looksByIdx) {
  const { __NpcDialogVisualEditorManager: Manager } = loadProviderInternals(scenario.vscodeStub);
  const manager = Object.create(Manager.prototype);
  const databaseRequests = [];
  const assetRequests = [];
  manager.context = scenario.context;
  manager.scriptDataResolver = {
    resolveItemFieldByIndex(fileName, itemIndex, field) {
      databaseRequests.push({ fileName, itemIndex, field });
      return field === 'Looks' ? String(looksByIdx.get(itemIndex)) : undefined;
    },
    resolveItemFieldByName() { return undefined; },
  };
  const productionResolveAsset = manager.resolveAsset.bind(manager);
  manager.resolveAsset = (...args) => {
    assetRequests.push({ ...args[0] });
    return productionResolveAsset(...args);
  };
  const model = parseItemShow(scenario.sourceFile, itemIndices, scenario.engine);
  await manager.hydrateAssets(model, { asWebviewUri: uri => uri }, {
    fileName: scenario.sourceFile,
    uri: TestUri.file(scenario.sourceFile),
  });
  return { model, databaseRequests, assetRequests, layers: itemLayers(model) };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-itemshow-cache-gate-'));
  const originalLocalAppData = process.env.LOCALAPPDATA;
  try {
    {
      const scenario = makeScenario(path.join(root, 'priority-slot'));
      process.env.LOCALAPPDATA = scenario.localAppData;
      const preferredPak = path.join(scenario.customData, 'Items2.pak');
      const fallbackPak = path.join(scenario.baseData, 'Items2.pak');
      fs.writeFileSync(preferredPak, 'preferred');
      fs.writeFileSync(fallbackPak, 'fallback-');
      writeLegacyCache(scenario.patchCacheRoot, 'preferred', preferredPak, 1);
      writeLegacyCache(scenario.patchCacheRoot, 'fallback', fallbackPak, 2);
      invalidatePatchCacheIndex();

      const result = await hydrateScenario(scenario, [935], new Map([[935, 20001]]));
      assert.deepEqual(result.assetRequests.find(request => request.archiveName === 'Items2'), {
        archiveName: 'Items2',
        imageIndex: 1,
      }, 'ITEMSHOW must request the image derived from StdItems.Looks, never IDX 935 itself');
      assert.equal(result.layers[0].asset.status, 'missing',
        'a missing slot in the selected higher-priority Items2 package must not fall through to another root');
      assert.equal(result.layers[0].asset.url, undefined);
    }

    {
      const scenario = makeScenario(path.join(root, 'priority-not-indexed'));
      process.env.LOCALAPPDATA = scenario.localAppData;
      const preferredPak = path.join(scenario.customData, 'Items2.pak');
      const fallbackPak = path.join(scenario.baseData, 'Items2.pak');
      fs.writeFileSync(preferredPak, 'preferred');
      fs.writeFileSync(fallbackPak, 'fallback-');
      writeLegacyCache(scenario.patchCacheRoot, 'fallback', fallbackPak, 2);
      invalidatePatchCacheIndex();

      const result = await hydrateScenario(scenario, [935], new Map([[935, 20001]]));
      assert.equal(result.layers[0].asset.status, 'missing',
        'an uncached selected package must not be replaced by a lower-priority cached package');
      assert.match(result.layers[0].asset.message || '', /未缓存|未建立|索引/);
    }

    {
      const scenario = makeScenario(path.join(root, 'direct-blank'));
      process.env.LOCALAPPDATA = scenario.localAppData;
      const pakPath = path.join(scenario.customData, 'Items2.pak');
      fs.writeFileSync(pakPath, 'direct-blank');
      writeDirectCache(
        scenario.indexRoot,
        '1'.repeat(64),
        pakPath,
        2,
        [{ logicalIndex: 0 }],
        md5(fs.readFileSync(pakPath))
      );
      invalidatePatchCacheIndex();

      const result = await hydrateScenario(scenario, [935], new Map([[935, 20001]]));
      assert.equal(result.layers[0].asset.status, 'missing',
        'a direct-cache logical blank must not be advertised as a ready transparent PNG');
      assert.equal(result.layers[0].asset.url, undefined);
      assert.match(result.layers[0].asset.message || '', /空槽|空图/);
    }

    {
      const scenario = makeScenario(path.join(root, 'same-stat-md5'));
      process.env.LOCALAPPDATA = scenario.localAppData;
      const pakPath = path.join(scenario.customData, 'Items2.pak');
      const original = Buffer.from('ABCD');
      fs.writeFileSync(pakPath, original);
      const originalStat = fs.statSync(pakPath);
      fs.writeFileSync(pakPath, Buffer.from('WXYZ'));
      fs.utimesSync(pakPath, originalStat.atime, originalStat.mtime);
      // Record the now-current size+mtime with the MD5 of the bytes from which
      // the cached index was built. This deterministically models an external
      // same-stat replacement even on filesystems that round utimes values.
      writeDirectCache(
        scenario.indexRoot,
        '2'.repeat(64),
        pakPath,
        2,
        [{ logicalIndex: 0 }, { logicalIndex: 1 }],
        md5(original)
      );
      invalidatePatchCacheIndex();
      const current = listCachedPatchPaks(scenario.patchCacheRoot, [scenario.customData]);
      assert.equal(current.length, 1);
      assert.equal(isPatchCacheCurrent(current[0]), true,
        'the fixture must preserve size+mtime so only exact MD5 can catch it');

      const patchCache = runtimeRequire('out/utils/patch-cache');
      const originalValidate = patchCache.validatePatchCacheMd5;
      let validationCalls = 0;
      patchCache.validatePatchCacheMd5 = async item => {
        validationCalls++;
        return originalValidate(item);
      };
      let result;
      try {
        result = await hydrateScenario(
          scenario,
          [935, 936],
          new Map([[935, 20000], [936, 20001]])
        );
      } finally {
        patchCache.validatePatchCacheMd5 = originalValidate;
      }
      assert.equal(validationCalls, 1,
        'one hydrate session must hash one selected Items2 package only once');
      assert.deepEqual(
        result.layers.map(layer => layer.asset.status),
        ['missing', 'missing'],
        'same-size/same-mtime source replacement must invalidate every ITEMSHOW preview from that package'
      );
      for (const layer of result.layers) {
        assert.equal(layer.asset.url, undefined);
        assert.match(layer.asset.message || '', /MD5|身份|过期|变化/);
      }
      assert.equal(result.assetRequests.some(request => request.imageIndex === 935), false,
        'IDX itself must never become a fallback package image index after exact-cache failure');
      assert.equal(result.assetRequests.some(request => request.imageIndex === 936), false,
        'a second IDX must never become a fallback package image index');
    }

    {
      const scenario = makeScenario(path.join(root, 'gee-same-stat-md5'), { engine: 'GEE' });
      process.env.LOCALAPPDATA = scenario.localAppData;
      const pakPath = path.join(scenario.customData, 'Items2.pak');
      const original = Buffer.from('GEE1');
      fs.writeFileSync(pakPath, original);
      const originalStat = fs.statSync(pakPath);
      fs.writeFileSync(pakPath, Buffer.from('GEE2'));
      fs.utimesSync(pakPath, originalStat.atime, originalStat.mtime);
      writeDirectCache(
        scenario.indexRoot,
        '4'.repeat(64),
        pakPath,
        2,
        [{ logicalIndex: 0 }, { logicalIndex: 1 }],
        md5(original)
      );
      invalidatePatchCacheIndex();

      const patchCache = runtimeRequire('out/utils/patch-cache');
      const originalValidate = patchCache.validatePatchCacheMd5;
      let validationCalls = 0;
      patchCache.validatePatchCacheMd5 = async item => {
        validationCalls++;
        return originalValidate(item);
      };
      let result;
      try {
        result = await hydrateScenario(
          scenario,
          [935, 936],
          new Map([[935, 20000], [936, 20001]])
        );
      } finally {
        patchCache.validatePatchCacheMd5 = originalValidate;
      }
      assert.equal(validationCalls, 1,
        'GEE ITEMSHOW must perform the same one-package exact identity check as GOM');
      assert.deepEqual(result.layers.map(layer => layer.asset.status), ['missing', 'missing'],
        'GEE ITEMSHOW must not display stale same-stat Items2 cache entries');
      assert.equal(result.assetRequests.some(request => request.imageIndex === 935), false,
        'GEE must not fall back from Looks to the database IDX as an image slot');
      assert.equal(result.assetRequests.some(request => request.imageIndex === 936), false,
        'GEE must not use a second database IDX as an image slot');
    }

    {
      const scenario = makeScenario(path.join(root, '996pc-same-stat-md5'), { engine: '996PC' });
      process.env.LOCALAPPDATA = scenario.localAppData;
      const jpkPath = path.join(scenario.customData, 'Items2.jpk');
      const original = Buffer.from('PC01');
      fs.writeFileSync(jpkPath, original);
      const originalStat = fs.statSync(jpkPath);
      fs.writeFileSync(jpkPath, Buffer.from('PC02'));
      fs.utimesSync(jpkPath, originalStat.atime, originalStat.mtime);
      writeDirectCache(
        scenario.indexRoot,
        '5'.repeat(64),
        jpkPath,
        2,
        [{ logicalIndex: 0 }, { logicalIndex: 1 }],
        md5(original),
        'JPK'
      );
      invalidatePatchCacheIndex();

      const patchCache = runtimeRequire('out/utils/patch-cache');
      const originalValidate = patchCache.validatePatchCacheMd5;
      let validationCalls = 0;
      patchCache.validatePatchCacheMd5 = async item => {
        validationCalls++;
        return originalValidate(item);
      };
      let result;
      try {
        result = await hydrateScenario(
          scenario,
          [935, 936],
          new Map([[935, 20000], [936, 20001]])
        );
      } finally {
        patchCache.validatePatchCacheMd5 = originalValidate;
      }
      assert.equal(validationCalls, 1,
        '996PC ITEMSHOW must exact-check its selected Items2.jpk package once per hydration');
      assert.deepEqual(result.layers.map(layer => layer.asset.status), ['missing', 'missing'],
        '996PC ITEMSHOW must not display stale same-stat Items2.jpk cache entries');
      assert.equal(result.assetRequests.some(request => request.imageIndex === 935), false,
        '996PC must not fall back from Looks to the database IDX as an image slot');
      assert.equal(result.assetRequests.some(request => request.imageIndex === 936), false,
        '996PC must not use a second database IDX as an image slot');
    }

    {
      const scenario = makeScenario(path.join(root, 'missing-md5'));
      process.env.LOCALAPPDATA = scenario.localAppData;
      const pakPath = path.join(scenario.customData, 'Items2.pak');
      fs.writeFileSync(pakPath, 'missing-md5');
      writeDirectCache(
        scenario.indexRoot,
        '3'.repeat(64),
        pakPath,
        1,
        [{ logicalIndex: 0 }],
        undefined
      );
      invalidatePatchCacheIndex();

      const result = await hydrateScenario(scenario, [935], new Map([[935, 20000]]));
      assert.equal(result.layers[0].asset.status, 'missing',
        'an old direct cache without a stored source MD5 cannot prove its existing index identity');
      assert.equal(result.layers[0].asset.url, undefined);
      assert.match(result.layers[0].asset.message || '', /MD5|重新缓存/);
    }
  } finally {
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    invalidatePatchCacheIndex();
    await removeTemporaryDirectory(root);
  }
  console.log(`itemshow-cache-gate.test.js: runtime-root=${runtimeRoot}`);
  console.log('itemshow-cache-gate.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
