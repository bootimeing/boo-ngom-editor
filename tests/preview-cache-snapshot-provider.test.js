const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || repositoryRoot);
const staticLanguage = require(path.join(runtimeRoot, 'data/static-language.json'));
const { buildDialogStatementCatalog } = require(path.join(runtimeRoot, 'out/ui-dialog/statement-catalog'));
const { workspaceNpcDialogOffsets } = require(path.join(runtimeRoot, 'out/ui-dialog/offsets'));
const { parseNpcDialogDocument } = require(path.join(runtimeRoot, 'out/ui-dialog/source-parser'));
const { GOM_DECODER_REVISION } = require(path.join(runtimeRoot, 'out/utils/pak-reader'));

function loadProviderInternals() {
  const fileName = path.join(runtimeRoot, 'out/providers/npc-dialog-visual.js');
  const source = fs.readFileSync(fileName, 'utf8')
    + '\nmodule.exports.__NpcDialogVisualEditorManager = NpcDialogVisualEditorManager;\n';
  const uri = value => ({
    fsPath: value,
    path: value,
    scheme: 'file',
    toString() { return value; },
  });
  const vscode = {
    Uri: { parse: uri, file: uri, joinPath(base, ...parts) { return uri(path.join(base.fsPath, ...parts)); } },
    EventEmitter: class { constructor() { this.event = () => undefined; } fire() {} dispose() {} },
    Disposable: { from: () => ({ dispose() {} }) },
    workspace: {
      workspaceFolders: [],
      getWorkspaceFolder(documentUri) { return { uri: uri(documentUri.fsPath) }; },
    },
    window: {},
    commands: {},
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscode;
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

function parseModel(sourceFile) {
  const text = [
    '[@main]',
    '#SAY',
    '<&ITEMSHOW:1:1:10:20:32:32>',
  ].join('\r\n');
  return parseNpcDialogDocument(text, {
    uri: `file:///${sourceFile.replaceAll('\\', '/')}`,
    fileName: path.basename(sourceFile),
    filePath: sourceFile,
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: 'GOM',
    cursorOffset: text.indexOf('[@main]') + 7,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });
}

function writeLegacyCache(cacheRoot, id, sourcePath, sourceText) {
  const cacheDir = path.join(cacheRoot, id);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, '000000.png'), `png-${id}`);
  fs.writeFileSync(path.join(cacheDir, 'manifest.json'), JSON.stringify({
    version: 4,
    format: 'GOM',
    pakName: path.basename(sourcePath, path.extname(sourcePath)),
    pakPath: sourcePath,
    sourceMd5: require('node:crypto').createHash('md5').update(sourceText).digest('hex'),
    decoderRevision: GOM_DECODER_REVISION,
    willIdx: 0,
    slotCount: 1,
    assets: [{
      name: '000000', path: path.join(cacheDir, '000000.png'), pakName: path.basename(sourcePath, path.extname(sourcePath)),
      pakPath: sourcePath, willIdx: 0, localIdx: 0, imageIdx: 0, width: 32, height: 32,
      offsetX: 0, offsetY: 0, isBlank: false, source: 'pak',
    }],
  }));
}

function makeContext(globalStoragePath) {
  return { globalStorageUri: { fsPath: globalStoragePath } };
}

async function main() {
  const { __NpcDialogVisualEditorManager: Manager } = loadProviderInternals();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-preview-cache-snapshot-'));
  const originalLocalAppData = process.env.LOCALAPPDATA;
  try {
    process.env.LOCALAPPDATA = path.join(root, 'local');
    const sourceFile = path.join(root, 'workspace', 'dialog.txt');
    const dataRoot = path.join(root, 'client', 'Data');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(sourceFile, 'fixture');
    const context = makeContext(path.join(root, 'global'));
    const patchRoot = path.join(process.env.LOCALAPPDATA, 'BOO-NGOM-Editor', 'cache', 'patch-cache');

    // Text-only hydration with no selected client must not scan every cache
    // manifest just to construct an unused snapshot.
    {
      const manager = Object.create(Manager.prototype);
      manager.context = context;
      manager.patchState = () => undefined;
      const model = parseModel(sourceFile);
      model.scenes = [{
        id: 'scene-text', sourceLabel: 'main', elements: [], conditions: [], warnings: [], unsupportedStatements: [], resolvedVariables: [],
      }];
      const originalReaddir = fs.readdirSync;
      let readdirCalls = 0;
      fs.readdirSync = (...args) => { readdirCalls += 1; return originalReaddir(...args); };
      try {
        await manager.hydrateAssets(model, { asWebviewUri: uri => uri }, { fileName: sourceFile, uri: { fsPath: sourceFile } });
      } finally {
        fs.readdirSync = originalReaddir;
      }
      assert.equal(readdirCalls, 0, 'text-only/no-client hydration must not scan patch cache');
    }

    const itemsPath = path.join(dataRoot, 'Items.pak');
    const dialogPath = path.join(dataRoot, 'Dialog.pak');
    const itemsText = 'items-source';
    const dialogText = 'dialog-source';
    fs.writeFileSync(itemsPath, itemsText);
    fs.writeFileSync(dialogPath, dialogText);
    fs.mkdirSync(patchRoot, { recursive: true });
    writeLegacyCache(patchRoot, 'items', itemsPath, itemsText);
    writeLegacyCache(patchRoot, 'dialog', dialogPath, dialogText);

    // A non-ITEMSHOW preview is resolved from the same request snapshot as an
    // exact-identity ITEMSHOW.  Mutate the ordinary package while the latter
    // is being hashed; the final distinct-package gate must remove the former.
    {
      const manager = Object.create(Manager.prototype);
      manager.context = context;
      manager.patchState = () => ({ dataDirectory: dataRoot });
      manager.scriptDataResolver = { resolveItemFieldByIndex() { return undefined; }, resolveItemFieldByName() { return undefined; } };
      const model = parseModel(sourceFile);
      const item = model.scenes[0].elements.find(element => element.statementId === 'item-show');
      assert.ok(item, 'fixture ITEMSHOW element missing');
      item.itemPreview = { mode: 'direct-archive', archiveName: 'Items', imageIndex: 0 };
      item.assetRef = { archiveName: 'Dialog', imageIndex: 0 };
      item.assetLayers = undefined;
      item.statementId = 'item-show';
      const mutation = invalidateItemSourceDuringHash(itemsPath, dialogPath);
      try {
        await manager.hydrateAssets(model, { asWebviewUri: uri => uri }, { fileName: sourceFile, uri: { fsPath: sourceFile } });
      } finally {
        mutation.restore();
      }
      assert.equal(mutation.count, 1, 'the ordinary package must change during the awaited exact-identity hash');
      assert.equal(item.asset?.status, 'missing', 'ordinary package changed during MD5 must not publish old preview');
      assert.match(item.asset?.message || '', /绘制期间发生变化|过期|变化/);
    }
  } finally {
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('preview-cache-snapshot-provider.test.js: PASS');
}

function invalidateItemSourceDuringHash(itemsPath, dialogPath) {
  const originalCreateReadStream = fs.createReadStream;
  const mutation = { count: 0, restore() { fs.createReadStream = originalCreateReadStream; } };
  fs.createReadStream = (...args) => {
    const stream = originalCreateReadStream(...args);
    if (path.resolve(String(args[0])) === path.resolve(itemsPath)) {
      stream.once('open', () => {
        mutation.count += 1;
        const newer = new Date(Date.now() + 60000);
        fs.utimesSync(dialogPath, newer, newer);
        fs.createReadStream = originalCreateReadStream;
      });
    }
    return stream;
  };
  return mutation;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
