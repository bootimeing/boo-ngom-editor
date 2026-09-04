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

function parseGom(text, sourceFile, dataOptions) {
  return parseNpcDialogDocument(text, {
    uri: `file:///${sourceFile.replaceAll('\\', '/')}`,
    fileName: path.basename(sourceFile),
    filePath: sourceFile,
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: 'GOM',
    cursorOffset: text.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
    dataOptions,
  });
}

function itemElement(model) {
  const item = model.pages[0].elements.find(element => element.statementId === 'item-show');
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

    const harness = path.join(temporary, 'itemshow-idx-looks.html');
    let html = fs.readFileSync(path.join(RUNTIME_ROOT, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__itemElementId = ${JSON.stringify(item.id)};
window.__itemPixel = ${JSON.stringify(itemPixel)};
window.__framePixel = ${JSON.stringify(framePixel)};
window.__model = ${JSON.stringify(model)};
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
