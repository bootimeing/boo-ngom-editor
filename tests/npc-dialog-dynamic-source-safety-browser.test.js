const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const {
  parseNpcDialogDocument,
  reflowNpcDialogLayout,
} = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzNwAAAABJRU5ErkJggg==';

function parseModel(source, engine) {
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/dynamic-source-safety-browser.txt',
    fileName: 'dynamic-source-safety-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\dynamic-source-safety-browser.txt',
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function readyAsset(reference, role) {
  const imageIndex = Number(reference?.imageIndex);
  const dynamic = Number.isFinite(imageIndex) && imageIndex >= 9800;
  const archive = reference?.archiveName || `WIL${reference?.willIndex ?? 'unknown'}`;
  const marker = `${dynamic ? 'DYNAMIC' : 'STATIC'}_${archive}_${imageIndex}_${role}`
    .replace(/[^A-Za-z0-9_-]/g, '_');
  return {
    status: 'ready',
    url: `${pixel}#${marker}`,
    archiveLabel: marker,
    width: role === 'atlas' ? 170 : 48,
    height: role === 'atlas' ? 23 : 28,
    offsetX: 0,
    offsetY: 0,
  };
}

function hydrateFixtureElement(element) {
  if (element.assetRef) element.asset = readyAsset(element.assetRef, 'primary');
  for (const layer of element.assetLayers || []) {
    if (layer.assetRef) layer.asset = readyAsset(layer.assetRef, layer.role);
  }
  for (const glyph of element.imageTextPreview?.glyphs || []) {
    if (glyph.assetRef) glyph.asset = readyAsset(glyph.assetRef, 'atlas');
  }
  for (const glyph of element.imageTextPreview?.glyphBank || []) {
    if (glyph.assetRef) glyph.asset = readyAsset(glyph.assetRef, 'glyph-bank');
  }
}

function fixtureModel() {
  const gomSource = [
    '[@main]',
    '#ACT',
    'MOV N$WIL 39',
    'MOV N$IMAGE 9810',
    'MOV N$HOVER 9811',
    '#SAY',
    '<&IMG:<$STR(N$IMAGE)>:<$STR(N$WIL)>:20:20>',
    '<&IMGEX:5:100:<$STR(N$HOVER)>:102:20:80>',
  ].join('\n');
  const gom = parseModel(gomSource, 'GOM');
  const gomElements = gom.pages[0].elements.filter(element => element.statementId !== 'flow-text');
  const dynamicImage = gomElements.find(element => element.statementId === 'img-absolute');
  const mixedImage = gomElements.find(element => element.statementId === 'imgex-absolute');
  assert.ok(dynamicImage && mixedImage, 'GOM browser fixtures must parse');
  dynamicImage.id = 'GOM_DYNAMIC_IMG';
  mixedImage.id = 'GOM_MIXED_IMGEX';

  const pcSource = [
    '[@main]',
    '#ACT',
    'MOV N$NORMAL 9820',
    'MOV N$HOVER 9821',
    'MOV N$PRESSED 9822',
    'MOV N$COLOR 250',
    'MOV N$SIZE 20',
    'MOV N$TIPX 91',
    'MOV N$TIPY 92',
    'MOV N$ATLAS 9830',
    'MOV N$GLYPHW 17',
    'MOV N$GLYPHH 23',
    'MOV N$ITEMID 993',
    'MOV N$ITEMCOUNT 654321',
    'MOV N$ITEMSCALE 0.75',
    'MOV S$BUTTON __MOV_BUTTON__',
    'MOV S$TEXT __MOV_TEXT__',
    'MOV S$TIP __MOV_TOOLTIP__',
    'MOV S$ATLASTEXT 6789',
    'MOV S$COSTTITLE __MOV_COST_TITLE__',
    '#SAY',
    '<Button|id=PC_DYNAMIC_BUTTON|x=250|y=20|width=150|height=34|wil=NewopUI|pcnimg=<$STR(N$NORMAL)>|pcmimg=<$STR(N$HOVER)>|pcpimg=<$STR(N$PRESSED)>|text=<$STR(S$BUTTON)>|color=<$STR(N$COLOR)>|size=<$STR(N$SIZE)>>',
    '<Button|id=PC_MIXED_BUTTON|x=250|y=75|width=150|height=34|wil=NewopUI|pcnimg=140|pcmimg=<$STR(N$HOVER)>|pcpimg=142|text=static-button>',
    '<Text|id=PC_DYNAMIC_TEXT|x=250|y=130|text=<$STR(S$TEXT)>|color=<$STR(N$COLOR)>|size=<$STR(N$SIZE)>|tips=<$STR(S$TIP)>|tipsx=<$STR(N$TIPX)>|tipsy=<$STR(N$TIPY)>>',
    '<RText|id=PC_DYNAMIC_RTEXT|x=250|y=175|text=<$STR(S$TEXT)>|color=<$STR(N$COLOR)>|size=<$STR(N$SIZE)>|tips=<$STR(S$TIP)>|tipsx=<$STR(N$TIPX)>|tipsy=<$STR(N$TIPY)>>',
    '<TextAtlas|id=PC_DYNAMIC_ATLAS|x=250|y=220|wil=NewopUI|pcimg=<$STR(N$ATLAS)>|iwidth=<$STR(N$GLYPHW)>|iheight=<$STR(N$GLYPHH)>|text=<$STR(S$ATLASTEXT)>>',
    '<CostItem|id=PC_DYNAMIC_COST|x=250|y=275|itemid=<$STR(N$ITEMID)>|itemcount=<$STR(N$ITEMCOUNT)>|title=<$STR(S$COSTTITLE)>|itemscale=<$STR(N$ITEMSCALE)>|fontsize=<$STR(N$SIZE)>>',
  ].join('\n');
  const model = parseModel(pcSource, '996PC');
  const pcElements = model.pages[0].elements.filter(element => element.statementId !== 'flow-text');
  for (const element of pcElements) {
    if (element.containerElementId) element.id = element.containerElementId;
  }
  const elements = [...gomElements, ...pcElements];
  for (const element of elements) hydrateFixtureElement(element);
  const scene = model.scenes.find(candidate => !candidate.conditionGroupId) || model.scenes[0];
  scene.elements = elements;
  model.pages[0].elements = elements;
  model.canvasWidth = 920;
  model.canvasHeight = 560;
  reflowNpcDialogLayout(model);
  return model;
}

function findChromiumBrowsers() {
  const candidates = [
    process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate));
  return [...new Set(candidates.map(candidate => path.resolve(candidate)))];
}

function browserVersion(executable) {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(Get-Item -LiteralPath $env:BOO_BROWSER_VERSION_EXECUTABLE).VersionInfo.ProductVersion',
    ], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      env: { ...process.env, BOO_BROWSER_VERSION_EXECUTABLE: executable },
    });
    const value = String(result.stdout || '').trim().split(/\r?\n/, 1)[0];
    if (!result.error && result.status === 0 && value) return value;
  }
  for (const argument of ['--version', '--product-version']) {
    const result = spawnSync(executable, [argument], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
    });
    const value = `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/, 1)[0];
    if (!result.error && result.status === 0 && value) return value;
  }
  return '<unknown>';
}

function browserDiagnostic(candidate, result) {
  const stderr = String(result.stderr || '').trim().replace(/\r?\n/g, '\\n') || '<empty>';
  return `${candidate}: status=${result.status}, signal=${result.signal || '<none>'}, `
    + `error=${result.error?.message || '<none>'}, body=${/<body\b/i.test(result.stdout || '')}, `
    + `complete=${/data-dynamic-source-safety-test=/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function decodeAttribute(value) {
  return String(value || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function main() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    console.log('npc-dialog-dynamic-source-safety-browser.test.js: SKIP (Edge/Chrome not found)');
    return;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-dynamic-source-safety-browser-'));
  try {
    const harness = path.join(temporary, 'dynamic-source-safety.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.acquireVsCodeApi = function () { return { postMessage: function (message) {
  if (message.type === 'ready') setTimeout(function () {
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'model', model: window.__model, previewRevision: 1,
      preserveDrafts: false, geeOffsetHelp: ''
    }}));
  }, 0);
}}; };
</script>`;
    html = html.replace(
      `<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`,
      `${mock}<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`
    );

    const scenario = `<script>
(function () {
  var failures = [];
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function imageSources(wrapper) {
    return Array.from(wrapper ? wrapper.querySelectorAll('img') : []).map(function (image) {
      return image.src || '';
    });
  }
  function fire(target, type, x, y) {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0,
      clientX: x || 20, clientY: y || 20,
    }));
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('GOM_DYNAMIC_IMG'); attempt++) await wait(20);
    if (!node('GOM_DYNAMIC_IMG')) throw new Error('fixture model did not render');

    await check('dynamic GOM and 996PC assets never reach an IMG src', async function () {
      var ids = ['GOM_DYNAMIC_IMG', 'PC_DYNAMIC_BUTTON', 'PC_DYNAMIC_ATLAS'];
      for (var id of ids) {
        var wrapper = node(id);
        if (!wrapper) throw new Error(id + ' missing');
        var sources = imageSources(wrapper);
        if (sources.some(function (source) { return source.includes('#DYNAMIC_'); })) {
          throw new Error(id + ' leaked dynamic asset URL: ' + sources.join(','));
        }
      }
      var allSources = Array.from(document.images).map(function (image) { return image.src || ''; });
      if (allSources.some(function (source) { return source.includes('#DYNAMIC_'); })) {
        throw new Error('page contains dynamic-derived URL: ' + allSources.join(','));
      }
    });

    await check('mixed GOM IMGEX keeps static normal and pressed but no dynamic hover', async function () {
      var wrapper = node('GOM_MIXED_IMGEX');
      var image = wrapper && wrapper.querySelector('.interactive-asset-image');
      if (!image || !image.src.includes('#STATIC_WIL5_100_primary')) {
        throw new Error('static normal state missing: ' + (wrapper ? wrapper.innerHTML : '<missing>'));
      }
      fire(wrapper, 'mouseenter');
      if (!image.src.includes('#STATIC_WIL5_100_primary') || image.src.includes('#DYNAMIC_')) {
        throw new Error('dynamic hover state entered DOM URL: ' + image.src);
      }
      fire(wrapper, 'mousedown');
      if (!image.src.includes('#STATIC_WIL5_102_pressed')) {
        throw new Error('static pressed state was discarded: ' + image.src);
      }
    });

    await check('mixed 996PC Button keeps static normal and pressed but no dynamic hover', async function () {
      var wrapper = node('PC_MIXED_BUTTON');
      var image = wrapper && wrapper.querySelector('.interactive-asset-image');
      if (!image || !image.src.includes('#STATIC_NewopUI_140_primary')) {
        throw new Error('static normal state missing: ' + (wrapper ? wrapper.innerHTML : '<missing>'));
      }
      fire(wrapper, 'mouseenter');
      if (!image.src.includes('#STATIC_NewopUI_140_primary') || image.src.includes('#DYNAMIC_')) {
        throw new Error('dynamic hover state entered DOM URL: ' + image.src);
      }
      fire(wrapper, 'mousedown');
      if (!image.src.includes('#STATIC_NewopUI_142_pressed')) {
        throw new Error('static pressed state was discarded: ' + image.src);
      }
    });

    await check('proven display text and quantities draw while CostItem database identity stays gated', async function () {
      for (var fixture of [
        ['PC_DYNAMIC_BUTTON', '__MOV_BUTTON__'],
        ['PC_DYNAMIC_TEXT', '__MOV_TEXT__'],
        ['PC_DYNAMIC_RTEXT', '__MOV_TEXT__'],
      ]) {
        var wrapper = node(fixture[0]);
        if (!wrapper) throw new Error(fixture[0] + ' missing');
        if (!(wrapper.textContent || '').includes(fixture[1])) {
          throw new Error(fixture[0] + ' did not draw its statically proven text: ' + wrapper.textContent);
        }
      }
      var cost = node('PC_DYNAMIC_COST');
      if (!cost) throw new Error('PC_DYNAMIC_COST missing');
      var costTitle = cost.querySelector('.cost-item-title');
      var costQuantity = cost.querySelector('.cost-item-quantity');
      if (!costTitle || costTitle.textContent !== '__MOV_COST_TITLE__'
        || !costQuantity || costQuantity.textContent !== '/654321') {
        throw new Error('CostItem lost its separately typed display values: ' + cost.textContent);
      }
      if (cost.querySelector('.cost-item-image')
        || !cost.querySelector('.cost-item-icon-placeholder')
        || imageSources(cost).some(function (source) { return /993|DYNAMIC_/i.test(source); })) {
        throw new Error('CostItem display values unlocked a database-derived item image');
      }
      if (cost.dataset.costItemScale === '0.75') {
        throw new Error('CostItem used MOV itemscale=0.75');
      }
    });

    await check('proven TextAtlas digits remain visible without borrowing dynamic glyph geometry or sheet', async function () {
      var wrapper = node('PC_DYNAMIC_ATLAS');
      var fallback = wrapper && wrapper.querySelector('.image-text-value-fallback');
      if (!fallback || (fallback.textContent || '').trim() !== '6789') {
        throw new Error('TextAtlas lost its statically proven display value: '
          + (wrapper ? wrapper.textContent : '<missing>'));
      }
      var bounds = fallback.getBoundingClientRect();
      if (!(bounds.width > 0 && bounds.height > 0)) {
        throw new Error('TextAtlas plain-text fallback has no visible geometry: '
          + bounds.width + 'x' + bounds.height);
      }
      if (wrapper.querySelector('.image-text-atlas-cell, .image-text-glyph-image')) {
        throw new Error('TextAtlas created a glyph/sheet node from dynamic geometry: ' + wrapper.innerHTML);
      }
      var sources = imageSources(wrapper);
      if (sources.some(function (source) { return source.includes('9830') || source.includes('#DYNAMIC_'); })) {
        throw new Error('TextAtlas displayed MOV atlas asset: ' + sources.join(','));
      }
      if ((fallback.textContent || '').includes('$STR(')) {
        throw new Error('TextAtlas leaked the raw source expression into canvas text');
      }
      var modelElement = window.__model.pages[0].elements.find(function (element) {
        return element.id === 'PC_DYNAMIC_ATLAS';
      });
      var glyphs = modelElement && modelElement.imageTextPreview
        ? modelElement.imageTextPreview.glyphs || []
        : [];
      if (!modelElement || glyphs.map(function (glyph) { return glyph.character; }).join('') !== '6789') {
        throw new Error('TextAtlas model lost the proven characters');
      }
      if (glyphs.some(function (glyph) {
        return glyph.sourceX !== undefined || glyph.assetRef || glyph.asset;
      })) {
        throw new Error('TextAtlas model borrowed dynamic glyph coordinates or assets');
      }
    });

    await check('statically proven tooltip text and offsets are visible', async function () {
      for (var id of ['PC_DYNAMIC_TEXT', 'PC_DYNAMIC_RTEXT']) {
        var wrapper = node(id);
        fire(wrapper, 'mouseenter', 300, 300);
        await wait(20);
        var tooltip = document.querySelector('.dialog-tooltip:not(.hidden)');
        if (!tooltip || !(tooltip.textContent || '').includes('__MOV_TOOLTIP__')) {
          throw new Error(id + ' did not draw its statically proven tooltip');
        }
        if (tooltip.style.left !== '403px' || tooltip.style.top !== '404px') {
          throw new Error(id + ' did not apply proven tooltip offsets: ' + tooltip.style.cssText);
        }
        fire(wrapper, 'mouseleave', 300, 300);
      }
    });

    await check('dynamic source safety boundary is visible after selecting the control', async function () {
      fire(node('GOM_DYNAMIC_IMG'), 'click');
      await wait(30);
      var boundary = document.getElementById('elementWarning');
      var text = boundary ? boundary.textContent || '' : '';
      if (!boundary || boundary.classList.contains('hidden')) {
        throw new Error('element warning boundary is hidden');
      }
      if (!/\u8fd0\u884c\u65f6\u8868\u8fbe\u5f0f/.test(text)
        || !/\u9759\u6001\u5df2\u786e\u5b9a\u503c\u76f4\u63a5\u663e\u793a/.test(text)
        || !/\u9884\u89c8\u6587\u5b57/.test(text) || !/\u6570\u91cf\u663e\u793a 0/.test(text)) {
        throw new Error('\u9875\u9762\u672a\u663e\u793a“\u5df2\u786e\u5b9a\u771f\u503c / \u6587\u5b57\u4e0e\u6570\u91cf\u5360\u4f4d”\u8fb9\u754c: ' + text);
      }
    });

    document.body.dataset.dynamicSourceSafetyDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.dynamicSourceSafetyTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.dynamicSourceSafetyErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.dynamicSourceSafetyTest = 'fail';
    document.body.dataset.dynamicSourceSafetyErrors = error && error.stack ? error.stack : String(error);
  });
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let selected;
    for (let index = 0; index < candidates.length; index++) {
      const result = spawnSync(candidates[index], [
        '--headless=new',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--no-first-run',
        '--allow-file-access-from-files',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1100,800',
        '--virtual-time-budget=2600',
        '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8',
        timeout: 22000,
        maxBuffer: 12 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-dynamic-source-safety-test=/i.test(result.stdout || '')) {
        selected = { candidate: candidates[index], result };
        break;
      }
    }

    assert.ok(selected, attempts.map(({ candidate, result }) => (
      browserDiagnostic(candidate, result)
    )).join('\n'));
    for (const { candidate, result } of attempts) {
      if (candidate === selected.candidate) break;
      console.log(
        `npc-dialog-dynamic-source-safety-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`
      );
    }
    const domCount = /data-dynamic-source-safety-dom-count="([0-9]+)"/.exec(
      selected.result.stdout
    )?.[1] || '<missing>';
    console.log(`npc-dialog-dynamic-source-safety-browser.test.js: browser=${selected.candidate}`);
    console.log(
      `npc-dialog-dynamic-source-safety-browser.test.js: ProductVersion=${browserVersion(selected.candidate)}`
    );
    console.log(`npc-dialog-dynamic-source-safety-browser.test.js: DOM=${domCount}`);
    const encoded = /data-dynamic-source-safety-errors="([^"]*)"/.exec(
      selected.result.stdout
    )?.[1];
    assert.match(
      selected.result.stdout,
      /data-dynamic-source-safety-test="pass"/,
      decodeAttribute(encoded) || 'browser scenario did not finish'
    );
  } finally {
    if (process.env.BOO_KEEP_DYNAMIC_SOURCE_SAFETY_BROWSER_TEMP === '1') {
      console.log(`npc-dialog-dynamic-source-safety-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
  console.log('npc-dialog-dynamic-source-safety-browser.test.js: PASS');
}

main();
