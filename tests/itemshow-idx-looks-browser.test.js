const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const RUNTIME_ROOT = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || REPOSITORY_ROOT);
const runtimeRequire = relativePath => require(path.join(RUNTIME_ROOT, ...relativePath.split('/')));
const packagedRequire = Module.createRequire(path.join(RUNTIME_ROOT, 'package.json'));
const staticLanguage = runtimeRequire('data/static-language.json');
const { ScriptDataResolver } = runtimeRequire('out/utils/script-data-resolver');
const { buildDialogStatementCatalog } = runtimeRequire('out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = runtimeRequire('out/ui-dialog/offsets');
const { parseNpcDialogDocument } = runtimeRequire('out/ui-dialog/source-parser');

function svgDataUri(width, height, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

const framePixel = svgDataUri(
  40,
  40,
  '<rect x="0.5" y="0.5" width="39" height="39" fill="#20180d" stroke="#ffd45c"/><rect x="4" y="4" width="32" height="32" fill="#090909"/>'
);
const itemPixel = svgDataUri(
  35,
  35,
  '<rect width="35" height="35" fill="#164a2d"/><circle cx="17.5" cy="17.5" r="12" fill="#7cffb2"/>'
);
const lightPixelA = svgDataUri(
  20,
  16,
  '<circle cx="10" cy="8" r="7" fill="#fff36b" fill-opacity=".7"/>'
);
const lightPixelB = svgDataUri(
  24,
  20,
  '<circle cx="12" cy="10" r="9" fill="#6be9ff" fill-opacity=".7"/>'
);

function browserCandidates() {
  const candidates = [
    process.env.BOO_BROWSER_EXECUTABLE,
    process.env.BOO_CHROMIUM_PATH,
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate));
  return [...new Set(candidates.map(candidate => path.resolve(candidate)))];
}

function loadProviderInternals() {
  const fileName = path.join(RUNTIME_ROOT, 'out', 'providers', 'npc-dialog-visual.js');
  const source = fs.readFileSync(fileName, 'utf8')
    + '\nmodule.exports.__NpcDialogVisualEditorManager = NpcDialogVisualEditorManager;\n';
  const uri = value => ({
    fsPath: value,
    path: value,
    scheme: 'file',
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

function parseGom(text, sourceFile, dataOptions, engine = 'GOM') {
  return parseNpcDialogDocument(text, {
    uri: `file:///${sourceFile.replaceAll('\\', '/')}`,
    fileName: path.basename(sourceFile),
    filePath: sourceFile,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: text.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
    dataOptions,
  });
}

function itemElement(model) {
  const item = model.pages[0].elements.find(element => /^item-show(?:-relative-compat)?$/.test(element.statementId));
  assert.ok(item, 'the GOM ITEMSHOW fixture must produce a typed item element');
  return item;
}

function itemLayer(element, role) {
  return (element.assetLayers || []).find(layer => layer.role === role);
}

function resourceUri(relative) {
  return pathToFileURL(path.join(RUNTIME_ROOT, ...relative.split('/'))).href;
}

function browserVersion(executable) {
  if (process.platform === 'win32') {
    const escapedExecutable = executable.replaceAll("'", "''");
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Item -LiteralPath '${escapedExecutable}').VersionInfo.ProductVersion`,
    ], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    const productVersion = String(result.stdout || '').trim();
    if (productVersion) return productVersion;
  }
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  return String(result.stdout || '').trim() || 'version unavailable';
}

async function main() {
  const candidates = browserCandidates();
  if (candidates.length === 0) {
    if (process.env.BOO_REQUIRE_REAL_BROWSER === '1') {
      throw new Error('itemshow-idx-looks-browser.test.js: Edge/Chrome is required');
    }
    console.log('itemshow-idx-looks-browser.test.js: SKIP (Edge/Chrome not found)');
    return;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-itemshow-idx-browser-'));
  const resolver = new ScriptDataResolver();
  try {
    const sourceFile = path.join(
      temporary, 'MirServer', 'Mir200', 'Envir', 'Market_Def', 'itemshow-idx.txt'
    );
    const databaseFile = path.join(temporary, 'MirServer', 'MUD2', 'db', 'herodb.DB');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
    fs.writeFileSync(sourceFile, '[@main]\r\n#SAY\r\n', 'utf8');

    const SQL = await packagedRequire('sql.js')();
    const database = new SQL.Database();
    database.run('CREATE TABLE StdItems (Idx INTEGER, Name TEXT, Looks INTEGER)');
    database.run('INSERT INTO StdItems VALUES (?, ?, ?)', [935, '传送戒指', 20450]);
    fs.writeFileSync(databaseFile, Buffer.from(database.export()));
    database.close();
    await resolver.prepareFor(sourceFile);

    const source = [
      '[@main]',
      '#ACT',
      'GETDBITEMFIELDVALUE 传送戒指 IDX N$展示IDX1',
      '#SAY',
      '<&ITEMSHOW:<$STR(N$展示IDX1)>:0:320:116:48>',
    ].join('\r\n');
    const model = parseGom(source, sourceFile, resolver.optionsFor(sourceFile));
    const item = itemElement(model);
    assert.equal(item.itemPreview.paintProfile, undefined, 'GOM must not borrow the GEE paint policy');
    const databaseRequests = [];
    const assetRequests = [];
    const { __NpcDialogVisualEditorManager: Manager } = loadProviderInternals();
    const manager = Object.create(Manager.prototype);
    manager.scriptDataResolver = {
      resolveItemFieldByIndex(fileName, itemIndex, field) {
        databaseRequests.push({ fileName, itemIndex, field });
        return resolver.resolveItemFieldByIndex(fileName, itemIndex, field);
      },
      resolveItemFieldByName() { return undefined; },
    };
    manager.resolveAsset = reference => {
      assetRequests.push({ ...reference });
      if (reference.archiveName === 'NewopUI' && reference.imageIndex === 48) {
        return {
          status: 'ready', url: framePixel, archiveLabel: 'NewopUI/000048',
          width: 40, height: 40, offsetX: 0, offsetY: 0,
        };
      }
      if (reference.archiveName === 'Items2' && reference.imageIndex === 450) {
        return {
          status: 'ready', url: itemPixel, archiveLabel: 'Items2/000450',
          width: 35, height: 35, offsetX: 0, offsetY: 0,
        };
      }
      return {
        status: 'missing',
        archiveLabel: `${reference.archiveName || 'unknown'}/${reference.imageIndex}`,
        message: 'fixture cache miss',
      };
    };
    await manager.hydrateAssets(model, {}, { fileName: sourceFile });

    assert.equal(item.itemPreview.itemIndex, 935);
    assert.equal(item.itemPreview.looks, 20450);
    assert.deepEqual(itemLayer(item, 'item')?.assetRef, { archiveName: 'Items2', imageIndex: 450 });
    assert.equal(itemLayer(item, 'item')?.asset?.status, 'ready');
    assert.deepEqual(itemLayer(item, 'background')?.assetRef, { archiveName: 'NewopUI', imageIndex: 48 });
    assert.equal(itemLayer(item, 'background')?.asset?.status, 'ready');
    assert.ok(databaseRequests.some(request => (
      request.itemIndex === 935 && request.field === 'Looks'
    )), 'Provider must resolve Looks by StdItems IDX before creating the item layer');
    assert.equal(assetRequests.some(reference => (
      reference.archiveName === 'Items' && reference.imageIndex === 935
    )), false, 'IDX 935 must never be requested as Items/000935');

    // Separate GEE parser -> real Provider -> browser geometry contract. The
    // database is real SQLite; the two archive responses are deterministic pixels.
    const geeModels = [];
    const geeCases = [
      { frame: true, width: 35, height: 29, count: 7 },
      { frame: false, width: 35, height: 29, count: 7 },
      { frame: true, width: 47, height: 51, count: 7 },
      { frame: true, missing: true, width: 35, height: 29, count: 7 },
      { frame: true, tiny: true, width: 35, height: 29, count: 7 },
      { frame: true, width: 35, height: 29, count: 0 },
      { frame: false, relative: true, width: 35, height: 29, count: 0 },
    ];
    for (const fixture of geeCases) {
      const gee = parseGom(`[@main]\r\n#SAY\r\n<${fixture.relative ? '' : '&'}ITEMSHOW:935:${fixture.count}:80:80:${fixture.frame ? 1 : 0}:0:1>`, sourceFile, undefined, 'GEE');
      const entry = itemElement(gee);
      assert.equal(entry.itemPreview.paintProfile, 'gee-itemshow', 'GEE ITEMSHOW needs an isolated paint contract');
      manager.resolveAsset = reference => {
        assetRequests.push({ ...reference });
        if (reference.archiveName === 'NewopUI' && reference.imageIndex === 250) {
          return fixture.missing ? { status: 'missing', message: 'fixture missing frame' } : {
            status: 'ready', url: framePixel, width: fixture.tiny ? 4 : 40, height: 40,
            offsetX: -9, offsetY: 11,
          };
        }
        if (reference.archiveName === 'Items2' && reference.imageIndex === 450) return {
          status: 'ready', url: svgDataUri(fixture.width, fixture.height, '<rect width="100%" height="100%" fill="#7cffb2"/>'),
          width: fixture.width, height: fixture.height, offsetX: -7, offsetY: 6,
        };
        if (reference.archiveName === 'Prguse2' && reference.imageIndex === 230) return {
          status: 'ready', url: lightPixelA, archiveLabel: 'Prguse2/000230',
          width: 20, height: 16, offsetX: -2, offsetY: 3,
        };
        if (reference.archiveName === 'Prguse2' && reference.imageIndex === 231) return {
          status: 'ready', url: lightPixelB, archiveLabel: 'Prguse2/000231',
          width: 24, height: 20, offsetX: 1, offsetY: 4,
        };
        return { status: 'missing' };
      };
      await manager.hydrateAssets(gee, {}, { fileName: sourceFile });
      const framed = fixture.frame && !fixture.missing && !fixture.tiny;
      assert.equal(entry.width, framed ? 40 : fixture.width, 'model width must use effective image surface');
      assert.equal(entry.height, framed ? 40 : fixture.height, 'model height must use effective image surface');
      assert.deepEqual(itemLayer(entry, 'item')?.assetRef, { archiveName: 'Items2', imageIndex: 450 });
      if (fixture.frame) assert.deepEqual(itemLayer(entry, 'background')?.assetRef, { archiveName: 'NewopUI', imageIndex: 250 });
      geeModels.push(gee);
    }
    const lightModel = JSON.parse(JSON.stringify(geeModels[0]));
    const lightEntry = itemElement(lightModel);
    lightEntry.itemPreview.lightCode = 1;
    for (const scene of lightModel.scenes || []) {
      const sceneEntry = scene.elements?.find(element => element.id === lightEntry.id);
      if (sceneEntry?.itemPreview) sceneEntry.itemPreview.lightCode = 1;
    }
    await manager.hydrateAssets(lightModel, {}, { fileName: sourceFile });
    const hydratedLightEntry = (lightModel.scenes || [])
      .flatMap(scene => scene.elements || [])
      .find(element => element.id === lightEntry.id);
    if (hydratedLightEntry?.itemPreview?.lightPreview) {
      lightEntry.itemPreview.lightPreview = hydratedLightEntry.itemPreview.lightPreview;
    }
    assert.deepEqual({
      archiveName: lightEntry.itemPreview.lightPreview?.archiveName,
      startIndex: lightEntry.itemPreview.lightPreview?.startIndex,
      frameCount: lightEntry.itemPreview.lightPreview?.frameCount,
      intervalMs: lightEntry.itemPreview.lightPreview?.intervalMs,
      blendMode: lightEntry.itemPreview.lightPreview?.blendMode,
      ready: lightEntry.itemPreview.lightPreview?.frames?.filter(frame => frame.status === 'ready').length,
    }, {
      archiveName: 'Prguse2', startIndex: 230, frameCount: 20,
      intervalMs: 200, blendMode: 'src-alpha-color', ready: 2,
    }, 'GXX lightCode=1 must map to Prguse2/230 and retain the 200ms blend contract');
    for (const token of ['<&ITEMSHOW', '<ITEMSHOW']) {
      const unknown = parseGom(`[@main]\r\n#ACT\r\nMOV N$假IDX 935\r\n#SAY\r\n${token}:<$STR(N$假IDX)>:0:80:80:0>`, sourceFile, undefined, 'GEE');
      const entry = itemElement(unknown);
      assert.equal(entry.itemPreview.itemIndex, undefined, 'display-only MOV must not acquire IDX authority');
      const before = assetRequests.length;
      await manager.hydrateAssets(unknown, {}, { fileName: sourceFile });
      assert.equal(assetRequests.length, before, 'dynamic IDX must not request an item or fallback slot');
      assert.equal(itemLayer(entry, 'item'), undefined);
    }

    const harness = path.join(temporary, 'itemshow-idx-looks.html');
    let html = fs.readFileSync(path.join(RUNTIME_ROOT, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__itemElementId = ${JSON.stringify(item.id)};
window.__itemPixel = ${JSON.stringify(itemPixel)};
window.__framePixel = ${JSON.stringify(framePixel)};
window.__model = ${JSON.stringify(model)};
window.__geeModels = ${JSON.stringify(geeModels)};
window.__geeCases = ${JSON.stringify(geeCases)};
window.__lightModel = ${JSON.stringify(lightModel)};
window.acquireVsCodeApi = function () { return { postMessage: function (message) {
  if (message.type === 'ready') setTimeout(function () { window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'model', model: window.__model, previewRevision: 1, preserveDrafts: false, geeOffsetHelp: ''
  }})); }, 0);
}}; };
</script>`;
    html = html.replace(
      `<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`,
      `${mock}<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`
    );
    const scenario = `<script>
(function () {
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function near(actual, expected, tolerance) { return Math.abs(actual - expected) <= tolerance; }
  function visible(node) {
    if (!node) return false;
    var style = getComputedStyle(node);
    var rect = node.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  }
  async function run() {
    var selector = '[data-element-id="' + window.__itemElementId + '"]';
    var wrapper;
    for (var attempt = 0; attempt < 150; attempt += 1) {
      wrapper = document.querySelector(selector);
      if (wrapper) break;
      await wait(20);
    }
    if (!wrapper) throw new Error('ITEMSHOW wrapper did not render');
    if (wrapper.querySelector('.item-quantity')) throw new Error('ITEMSHOW quantity zero must not draw a number');
    let quantityRevision=10;
    for (const count of [1, 5, 0]) {
      const next=JSON.parse(JSON.stringify(window.__model));
      for (const scene of [...next.scenes,...next.pages]) for (const entry of scene.elements) {
        if(entry.id===window.__itemElementId)entry.itemPreview.quantity=count;
      }
      window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:next,previewRevision:quantityRevision++}}));
      await wait(30);wrapper=document.querySelector(selector);
      const badge=wrapper.querySelector('.item-quantity');
      if (count===0 ? !!badge : !badge || badge.textContent!==String(count)) throw new Error('quantity transition failed: '+count);
    }
    var frame = wrapper.querySelector('.item-frame-image');
    var item = wrapper.querySelector('.item-content-image');
    if (!visible(wrapper) || !visible(frame) || !visible(item)) {
      throw new Error('ITEMSHOW wrapper/frame/content must all have positive visible geometry');
    }
    for (var imageAttempt = 0; imageAttempt < 100 && (!frame.complete || !item.complete); imageAttempt += 1) {
      await wait(20);
    }
    if (!frame.complete || frame.naturalWidth !== 40 || frame.naturalHeight !== 40) {
      throw new Error('frame URL did not load as a 40x40 image');
    }
    if (!item.complete || item.naturalWidth !== 35 || item.naturalHeight !== 35) {
      throw new Error('Looks-derived item URL did not load as a 35x35 image');
    }
    if (frame.getAttribute('src') !== window.__framePixel || item.getAttribute('src') !== window.__itemPixel) {
      throw new Error('renderer did not preserve the Provider URLs');
    }
    if (frame.alt !== 'NewopUI/000048' || item.alt !== 'Items2/000450') {
      throw new Error('rendered layers do not identify NewopUI/48 and Looks-derived Items2/450');
    }
    if (wrapper.querySelectorAll('.item-frame-image').length !== 1
      || wrapper.querySelectorAll('.item-content-image').length !== 1
      || frame === item) {
      throw new Error('frame and item content must be distinct single DOM layers');
    }
    if (Number(getComputedStyle(frame).zIndex) >= Number(getComputedStyle(item).zIndex)) {
      throw new Error('item content must render above the frame layer');
    }
    var wrapperRect = wrapper.getBoundingClientRect();
    var frameRect = frame.getBoundingClientRect();
    var itemRect = item.getBoundingClientRect();
    if (!near(wrapperRect.width, 40, 0.25) || !near(wrapperRect.height, 40, 0.25)
      || !near(frameRect.width, 40, 0.25) || !near(frameRect.height, 40, 0.25)
      || !near(itemRect.width, 35, 0.25) || !near(itemRect.height, 35, 0.25)) {
      throw new Error('ITEMSHOW wrapper/frame/item CSS dimensions are incorrect');
    }
    if (!near(itemRect.left - frameRect.left, 3, 0.25)
      || !near(itemRect.top - frameRect.top, 3, 0.25)) {
      throw new Error('35x35 item content is not centered inside the 40x40 frame');
    }
    var canvas = document.getElementById('dialogCanvas');
    if (!canvas || wrapper.querySelector('.element-placeholder') || wrapper.querySelector('.item-runtime-label')
      || /(?:物品\s*)?IDX\s*935/i.test(wrapper.textContent || '')
      || /(?:物品\s*)?IDX\s*935/i.test(canvas.textContent || '')) {
      throw new Error('ready Items2/450 pixels were replaced or covered by an IDX 935 placeholder');
    }
    var hit = document.elementFromPoint(
      itemRect.left + itemRect.width / 2,
      itemRect.top + itemRect.height / 2
    );
    if (!hit || hit.closest(selector) !== wrapper) {
      throw new Error('visible ITEMSHOW content is not reachable on the canvas hit surface');
    }
    for (let index = 0; index < window.__geeModels.length; index += 1) {
      const next = window.__geeModels[index];
      const fixture = window.__geeCases[index];
      const entry = next.pages[0].elements.find(value => /^item-show/.test(value.statementId));
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'model', model: next, previewRevision: 30 + index, preserveDrafts: false,
      }}));
      await wait(40);
      const node = document.querySelector('[data-element-id="' + entry.id + '"]');
      const framed = fixture.frame && !fixture.missing && !fixture.tiny;
      const sprite = node.querySelector('.item-content-image');
      const border = node.querySelector('.item-frame-image');
      const quantity = node.querySelector('.item-quantity');
      const width = framed ? 40 : fixture.width;
      const height = framed ? 40 : fixture.height;
      if (!visible(node) || !visible(sprite)) throw new Error('GEE item invisible: ' + index);
      if (parseFloat(node.style.width) !== width || parseFloat(node.style.height) !== height)
        throw new Error('GEE frame must own selection size, not oversized item: ' + index);
      if (entry.width !== width || entry.height !== height)
        throw new Error('GEE Provider reflow must agree with DOM bounds: ' + index);
      if (!!border !== !!framed) throw new Error('GEE unusable frame must degrade to unframed: ' + index);
      if (border && (parseFloat(border.style.left) !== 0 || parseFloat(border.style.top) !== 0))
        throw new Error('GEE frame must not apply archive offsets: ' + index);
      if (parseFloat(sprite.style.left) !== (framed ? Math.trunc((40 - fixture.width) / 2) : 0)
        || parseFloat(sprite.style.top) !== (framed ? Math.trunc((40 - fixture.height) / 2) : 0))
        throw new Error('GEE item centering must truncate and ignore archive offsets: ' + index);
      if (framed && getComputedStyle(node).overflow !== 'hidden')
        throw new Error('GEE framed ITEMSHOW must clip oversized item content to the visible frame: ' + index);
      if (!framed && getComputedStyle(node).overflow === 'hidden')
        throw new Error('GEE unframed ITEMSHOW must not inherit frame clipping: ' + index);
      if (!!quantity !== (fixture.count > 0)) throw new Error('GEE zero quantity rendered: ' + index);
      if (quantity) {
        const style = getComputedStyle(quantity);
        if (style.right !== (framed ? '4px' : '2px') || style.bottom !== (framed ? '2px' : '0px')
          || style.color !== 'rgb(166, 202, 240)' || style.backgroundColor !== 'rgba(0, 0, 0, 0)')
          throw new Error('GEE quantity anchor/color incorrect: ' + index);
      }
      if (getComputedStyle(sprite).filter === 'none' || (border && getComputedStyle(border).filter !== 'none'))
        throw new Error('GEE gray must affect item only: ' + index);
      if (entry.itemPreview.paintProfile !== 'gee-itemshow') throw new Error('GEE typed profile missing');
      const bounds = node.getBoundingClientRect();
      const target = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      if (!target || target.closest('[data-element-id]') !== node) throw new Error('GEE selection hit surface incorrect: ' + index);
    }
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'model', model: window.__lightModel, previewRevision: 80, preserveDrafts: false,
    }}));
    await wait(40);
    var lightNode = document.querySelector('[data-element-id="' + window.__lightModel.pages[0].elements[0].id + '"]');
    var lightImage = lightNode && lightNode.querySelector('.item-light-image');
    if (!lightImage || !visible(lightImage)) throw new Error('GXX light overlay is not visible');
    if (lightNode.dataset.itemLightArchive !== 'Prguse2'
      || lightNode.dataset.itemLightStartIndex !== '230'
      || lightNode.dataset.itemLightFrameCount !== '20'
      || lightNode.dataset.itemLightReadyCount !== '2'
      || lightNode.dataset.itemLightIntervalMs !== '200'
      || lightNode.dataset.itemLightBlend !== 'src-alpha-color') {
      throw new Error('GXX light metadata is incomplete');
    }
    if (getComputedStyle(lightImage).mixBlendMode !== 'plus-lighter') {
      throw new Error('GXX light must use the documented additive blend approximation');
    }
    var firstLightSrc = lightImage.getAttribute('src');
    await wait(240);
    if (lightImage.getAttribute('src') === firstLightSrc) throw new Error('GXX light frame did not advance at 200ms');
    if (!lightNode.querySelector('.item-frame-image') || !lightNode.querySelector('.item-content-image')) {
      throw new Error('GXX light must preserve the frame and item layers');
    }
    document.body.dataset.itemshowIdxLooksDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.itemshowIdxLooksTest = 'pass';
  }
  run().catch(function (error) {
    document.body.dataset.itemshowIdxLooksTest = 'fail';
    document.body.dataset.itemshowIdxLooksError = error && error.stack ? error.stack : String(error);
  });
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let successful;
    for (let index = 0; index < candidates.length; index += 1) {
      const executable = candidates[index];
      const attempt = spawnSync(executable, [
        '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
        '--allow-file-access-from-files', `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1200,800', '--virtual-time-budget=7000', '--dump-dom', pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 25000, maxBuffer: 12 * 1024 * 1024, windowsHide: true });
      attempts.push({ executable, attempt });
      if (!attempt.error && attempt.status === 0 && /<body\b/i.test(attempt.stdout || '')) {
        successful = { executable, attempt };
        break;
      }
    }
    assert.ok(successful, attempts.map(({ executable, attempt }) => (
      `${executable}: status=${attempt.status} error=${attempt.error?.message || ''} stderr=${attempt.stderr || ''}`
    )).join('\n'));
    const error = /data-itemshow-idx-looks-error="([^"]*)/i.exec(successful.attempt.stdout)?.[1];
    assert.match(successful.attempt.stdout, /data-itemshow-idx-looks-test="pass"/i, error);
    const domCount = Number(
      /data-itemshow-idx-looks-dom-count="(\d+)"/i.exec(successful.attempt.stdout)?.[1]
    );
    assert.ok(Number.isSafeInteger(domCount) && domCount > 0, 'real Chromium DOM count missing');
    console.log(
      `itemshow-idx-looks-browser.test.js: browser=${successful.executable}; version=${browserVersion(successful.executable)}; dom=${domCount}`
    );
    console.log(`itemshow-idx-looks-browser.test.js: runtime-root=${RUNTIME_ROOT}`);
  } finally {
    resolver.dispose();
    removeTemporaryDirectory(temporary);
  }
  console.log('itemshow-idx-looks-browser.test.js: PASS');
}

main().catch(error => {
  console.error('itemshow-idx-looks-browser.test.js: RED FAILURE');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
