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
    + `error=${result.error?.message || '<none>'}, `
    + `body=${/<body\b/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function svgData(width, height, label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<rect width="${width}" height="${height}" fill="${color}"/>`
    + `<text x="1" y="${Math.max(9, height - 3)}" font-size="8" fill="#fff">${label}</text>`
    + '</svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function readyAsset(label, width, height, color) {
  return {
    status: 'ready',
    url: svgData(width, height, label, color),
    archiveLabel: label,
    width,
    height,
    offsetX: 0,
    offsetY: 0,
  };
}

function fixtureModel() {
  const source = [
    '[@main]',
    '#ACT',
    'MOV S$WIL NewopUI',
    'MOV N$IMG 2522',
    'MOV N$W 14',
    'MOV N$H 24',
    'MOV S$VALUE 9876',
    '#SAY',
    '<TextAtlas|id=MATCHED|x=20|y=20|wil=NewopUI|pcimg=2522|iwidth=14|iheight=24|text=90>',
    '<TextAtlas|id=MISMATCH|x=20|y=70|wil=NewopUI|pcimg=2522|iwidth=14|iheight=24|text=90>',
    '<TextAtlas|id=DYNAMIC|x=20|y=120|wil=<$STR(S$WIL)>|pcimg=<$STR(N$IMG)>|iwidth=<$STR(N$W)>|iheight=<$STR(N$H)>|text=<$STR(S$VALUE)>>',
    '<TextAtlas|id=INVALID|x=20|y=170|wil=NewopUI|pcimg=2522|iwidth=-2|iheight=0|text=90>',
    '<TextAtlas:7:2470:20:220:90>',
  ].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/textatlas-strict-runtime-browser.txt',
    fileName: 'textatlas-strict-runtime-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\textatlas-strict-runtime-browser.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
  const elements = model.pages[0].elements.filter(element => /<TextAtlas[|:]/i.test(element.raw));
  const byRaw = marker => elements.find(element => element.raw.includes(marker));
  const matched = byRaw('id=MATCHED|');
  const mismatch = byRaw('id=MISMATCH|');
  const dynamic = byRaw('id=DYNAMIC|');
  const invalid = byRaw('id=INVALID|');
  const legacy = byRaw('<TextAtlas:7:2470:');
  for (const [element, id] of [
    [matched, 'TEXTATLAS_MATCHED'],
    [mismatch, 'TEXTATLAS_MISMATCH'],
    [dynamic, 'TEXTATLAS_DYNAMIC'],
    [invalid, 'TEXTATLAS_INVALID'],
    [legacy, 'TEXTATLAS_LEGACY'],
  ]) {
    if (!element?.imageTextPreview) throw new Error(`missing TextAtlas fixture ${id}`);
    element.id = id;
  }

  const sheetReference = { archiveName: 'NewopUI', imageIndex: 2522 };
  const matchedSheet = readyAsset('matched-140x24', 140, 24, '#176742');
  matched.assetRef = { ...sheetReference };
  matched.asset = matchedSheet;
  matched.imageTextPreview.assetContract = 'matched';
  matched.imageTextPreview.assetContractMessage = '整图尺寸 140×24 与 10 个数字字形合同一致';
  matched.imageTextPreview.glyphs = [
    { character: '9', sourceX: 126, assetRef: { ...sheetReference }, asset: matchedSheet },
    { character: '0', sourceX: 0, assetRef: { ...sheetReference }, asset: matchedSheet },
  ];

  const mismatchSheet = readyAsset('mismatch-139x24', 139, 24, '#78401c');
  mismatch.assetRef = { ...sheetReference };
  mismatch.asset = mismatchSheet;
  mismatch.imageTextPreview.assetContract = 'mismatch';
  mismatch.imageTextPreview.assetContractMessage = '素材实际 139×24，预期 10×14=140 且高度 24';
  mismatch.imageTextPreview.glyphs = [
    { character: '9', sourceX: 126, assetRef: { ...sheetReference } },
    { character: '0', sourceX: 0, assetRef: { ...sheetReference } },
  ];

  for (const element of [dynamic, invalid]) {
    delete element.assetRef;
    delete element.asset;
    element.imageTextPreview.assetContract = 'blocked';
    element.imageTextPreview.assetContractMessage = element === dynamic
      ? '动态字段未请求素材，不借用 MOV 当前值'
      : '无效字段已阻止 TextAtlas 素材请求';
    element.imageTextPreview.glyphs = element.imageTextPreview.glyphs.map(glyph => ({
      character: glyph.character,
    }));
  }

  const legacyNine = readyAsset('legacy-nine-17x22', 17, 22, '#394b83');
  const legacyZero = readyAsset('legacy-zero-13x22', 13, 22, '#684088');
  legacy.assetRef = { willIndex: 7, imageIndex: 2470 };
  legacy.asset = legacyNine;
  legacy.imageTextPreview.assetContract = 'matched';
  legacy.imageTextPreview.assetContractMessage = '连续 0-9 单图素材已按各自真实尺寸解析';
  legacy.imageTextPreview.glyphs = [
    {
      character: '9',
      assetRef: { willIndex: 7, imageIndex: 2479 },
      asset: legacyNine,
    },
    {
      character: '0',
      assetRef: { willIndex: 7, imageIndex: 2470 },
      asset: legacyZero,
    },
  ];

  const scene = model.scenes.find(candidate => !candidate.conditionGroupId) || model.scenes[0];
  scene.elements = elements;
  model.scenes = [scene];
  reflowNpcDialogLayout(model);
  model.canvasWidth = Math.max(model.canvasWidth, 520);
  model.canvasHeight = Math.max(model.canvasHeight, 310);
  return model;
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
    console.log('textatlas-strict-runtime-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-textatlas-strict-browser-'));
  try {
    const harness = path.join(temporary, 'textatlas-strict-runtime.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.__postedMessages = [];
window.__openedLinks = [];
window.__historyCalls = [];
window.__initialLocation = window.location.href;
window.addEventListener('error', function (event) {
  document.body.dataset.textatlasTest = 'fail';
  document.body.dataset.textatlasErrors = '[window.error] '
    + (event.error && event.error.stack ? event.error.stack : event.message);
});
window.addEventListener('unhandledrejection', function (event) {
  document.body.dataset.textatlasTest = 'fail';
  document.body.dataset.textatlasErrors = '[unhandledrejection] '
    + (event.reason && event.reason.stack ? event.reason.stack : String(event.reason));
});
window.open = function () { window.__openedLinks.push(Array.from(arguments)); return null; };
for (var historyName of ['pushState', 'replaceState']) {
  (function (name) {
    var original = window.history[name].bind(window.history);
    window.history[name] = function () {
      window.__historyCalls.push(name);
      return original.apply(window.history, arguments);
    };
  }(historyName));
}
window.acquireVsCodeApi = function () { return { postMessage: function (message) {
  window.__postedMessages.push(message);
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
  function px(value) { return Number(String(value || '').replace('px', '')); }
  function fields(value) { return String(value || '').split(',').filter(Boolean).sort(); }
  function visible(value) {
    if (!value) return false;
    var style = getComputedStyle(value);
    var rect = value.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }
  function boundary(wrapper) {
    return wrapper && wrapper.querySelector(
      '.image-text-field-boundary, .image-text-runtime-boundary'
    );
  }
  function visibleBoundary(wrapper, label) {
    var notice = boundary(wrapper);
    if (!visible(notice)) throw new Error(label + ' boundary is not visibly drawn');
    var background = getComputedStyle(notice).backgroundColor;
    if (!background || background === 'transparent' || background === 'rgba(0, 0, 0, 0)') {
      throw new Error(label + ' boundary has no visible background: ' + background);
    }
    return notice;
  }
  function assertState(wrapper, state) {
    if (!wrapper) throw new Error('TextAtlas wrapper is missing');
    if (wrapper.dataset.imageTextState !== state) {
      throw new Error('image text state expected ' + state + ', got '
        + wrapper.dataset.imageTextState);
    }
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('TEXTATLAS_MATCHED'); attempt++) await wait(20);
    if (!node('TEXTATLAS_MATCHED')) throw new Error('fixture model did not render TextAtlas');
    await wait(50);
    window.__postedMessages.length = 0;

    await check('TextAtlas diagnostics are hidden by default and shown only after the toolbar toggle', async function () {
      var notice = boundary(node('TEXTATLAS_MATCHED'));
      var toggle = document.getElementById('canvasDiagnosticsToggle');
      if (!notice || visible(notice)) throw new Error('TextAtlas boundary was not hidden by default');
      if (!toggle || toggle.getAttribute('aria-pressed') !== 'false') {
        throw new Error('diagnostics toggle did not start off');
      }
      toggle.click();
      await wait(20);
      if (!visible(notice) || toggle.getAttribute('aria-pressed') !== 'true') {
        throw new Error('diagnostics toggle did not reveal TextAtlas boundaries');
      }
    });

    await check('matched 140x24 atlas draws exact 14x24 cells and sheet crops', async function () {
      var wrapper = node('TEXTATLAS_MATCHED');
      assertState(wrapper, 'matched');
      if (wrapper.dataset.imageTextAssetContract !== 'matched') {
        throw new Error('matched provider contract is not exposed');
      }
      var cells = Array.from(wrapper.querySelectorAll('.image-text-atlas-cell'));
      if (cells.length !== 2) throw new Error('expected two atlas cells, got ' + cells.length);
      var expected = [
        { character: '9', left: 0, sheetLeft: -126 },
        { character: '0', left: 14, sheetLeft: 0 },
      ];
      for (var index = 0; index < expected.length; index++) {
        var cell = cells[index];
        var sheet = cell.querySelector('.image-text-atlas-sheet');
        if (cell.dataset.character !== expected[index].character
          || px(cell.style.left) !== expected[index].left
          || px(cell.style.width) !== 14
          || px(cell.style.height) !== 24) {
          throw new Error('cell ' + index + ' geometry is not faithful: ' + cell.outerHTML);
        }
        if (!sheet || px(sheet.style.left) !== expected[index].sheetLeft) {
          throw new Error('cell ' + index + ' sheet crop expected left '
            + expected[index].sheetLeft + 'px, got ' + (sheet && sheet.style.left));
        }
        if (!sheet.complete || sheet.naturalWidth !== 140 || sheet.naturalHeight !== 24) {
          throw new Error('cell ' + index + ' did not load the real 140x24 sheet');
        }
      }
      visibleBoundary(wrapper, 'new-panel matched');
    });

    await check('139x24 mismatch never crops its sheet and exposes a visible boundary', async function () {
      var wrapper = node('TEXTATLAS_MISMATCH');
      assertState(wrapper, 'mismatch');
      if (wrapper.querySelector('.image-text-atlas-cell, .image-text-atlas-sheet')) {
        throw new Error('mismatched 139x24 sheet was cropped as a 140x24 atlas');
      }
      var notice = visibleBoundary(wrapper, 'mismatch');
      if (!/\u4e0d\u5339\u914d/.test(notice.textContent || '')
        || (!(notice.textContent || '').includes('139×24')
          && !(notice.textContent || '').includes('139x24'))) {
        throw new Error('mismatch evidence is absent from the boundary: ' + notice.textContent);
      }
    });

    await check('dynamic display text stays useful while assets and geometry remain blocked', async function () {
      var dynamic = node('TEXTATLAS_DYNAMIC');
      var invalid = node('TEXTATLAS_INVALID');
      assertState(dynamic, 'dynamic');
      assertState(invalid, 'invalid');
      var dynamicFields = fields(dynamic.dataset.imageTextDynamicFields);
      if (dynamicFields.join(',') !== ['archive', 'glyph-height', 'glyph-width', 'image', 'text'].join(',')) {
        throw new Error('dynamic fields mismatch: ' + dynamicFields.join(','));
      }
      var invalidFields = fields(invalid.dataset.imageTextInvalidFields);
      if (invalidFields.join(',') !== ['glyph-height', 'glyph-width'].join(',')) {
        throw new Error('invalid fields mismatch: ' + invalidFields.join(','));
      }
      if (!(dynamic.getAttribute('aria-label') || '').includes('9876')) {
        throw new Error('dynamic TextAtlas omitted its proven display value from the accessible canvas');
      }
      var dynamicModel = window.__model.scenes[0].elements.find(function (element) {
        return element.id === 'TEXTATLAS_DYNAMIC';
      });
      if (!dynamicModel || String(dynamicModel.imageTextPreview.value) !== '9876') {
        throw new Error('dynamic TextAtlas model did not preserve the proven display value 9876');
      }
      if (dynamicModel.imageTextPreview.glyphs.map(function (glyph) {
        return glyph.character;
      }).join('') !== '9876' || dynamicModel.imageTextPreview.glyphs.some(function (glyph) {
        return glyph.sourceX !== undefined || glyph.assetRef || glyph.asset;
      })) {
        throw new Error('dynamic TextAtlas characters leaked crop geometry or requestable resources');
      }
      if ((dynamic.textContent || '').includes('$STR(')) {
        throw new Error('dynamic TextAtlas leaked its raw $STR source into visible canvas text');
      }
      for (var fixture of [
        [dynamic, 'dynamic'],
        [invalid, 'invalid'],
      ]) {
        var wrapper = fixture[0];
        var state = fixture[1];
        var fallback = wrapper.querySelector('.image-text-value-fallback');
        var expectedValue = state === 'dynamic' ? '9876' : '90';
        if (!visible(fallback) || fallback.textContent !== expectedValue
          || wrapper.dataset.imageTextFallback !== 'plain-text'
          || fallback.getBoundingClientRect().width <= 0
          || fallback.getBoundingClientRect().height <= 0) {
          throw new Error(state + ' did not draw a positive-size plain-text fallback: '
            + (fallback && fallback.outerHTML));
        }
        if (wrapper.querySelector(
          '.image-text-atlas-cell, .image-text-atlas-sheet, .image-text-glyph-image, .image-text-glyph-placeholder'
        )) {
          throw new Error(state + ' fields generated a guessed sheet/cell/glyph');
        }
        var notice = visibleBoundary(wrapper, state);
        if (state === 'dynamic'
          && (!/\u52a8\u6001/.test(notice.textContent || '')
            || !/\u4e0d\u501f\u7528.*MOV|MOV.*\u4e0d\u501f\u7528/.test(notice.textContent || ''))) {
          throw new Error('dynamic source-safety boundary is incomplete: ' + notice.textContent);
        }
        if (state === 'invalid'
          && (!/\u65e0\u6548/.test(notice.textContent || '')
            || !(notice.textContent || '').includes('12/16'))) {
          throw new Error('invalid no-default boundary is incomplete: ' + notice.textContent);
        }
        if (wrapper.querySelector('img[src], [style*="background-image"]')) {
          throw new Error(state + ' fields generated a dynamic asset URL');
        }
        if (wrapper.style.width === '12px' || wrapper.style.height === '16px') {
          throw new Error(state + ' wrapper guessed the old 12x16 geometry');
        }
      }
    });

    await check('traditional TextAtlas uses each hydrated glyph real width continuously', async function () {
      var wrapper = node('TEXTATLAS_LEGACY');
      assertState(wrapper, 'matched');
      if (wrapper.dataset.imageTextVariant !== 'legacy-individual') {
        throw new Error('traditional TextAtlas variant is not exposed');
      }
      var images = Array.from(wrapper.querySelectorAll(
        '.image-text-glyph-image:not(.image-text-atlas-sheet)'
      ));
      if (images.length !== 2) throw new Error('expected two legacy glyph images, got ' + images.length);
      if (images[0].dataset.character !== '9' || images[1].dataset.character !== '0') {
        throw new Error('legacy glyph order is not 9,0');
      }
      if (px(images[0].style.left) !== 0 || px(images[1].style.left) !== 17) {
        throw new Error('legacy positions did not use real widths 17/13: '
          + images.map(function (image) { return image.style.left; }).join(','));
      }
      if (!images[0].complete || images[0].naturalWidth !== 17
        || !images[1].complete || images[1].naturalWidth !== 13) {
        throw new Error('legacy images did not retain their real 17/13 widths');
      }
      if (images[0].src === images[1].src) throw new Error('legacy glyphs reused one guessed image');
      if (px(wrapper.style.width) !== 30 || px(wrapper.style.height) !== 22) {
        throw new Error('legacy wrapper is not the real 17+13 by 22 geometry: '
          + wrapper.style.width + ' x ' + wrapper.style.height);
      }
      visibleBoundary(wrapper, 'legacy matched');
    });

    await check('TextAtlas render and local selection never call host or navigation APIs', async function () {
      for (var id of [
        'TEXTATLAS_MATCHED', 'TEXTATLAS_MISMATCH', 'TEXTATLAS_DYNAMIC',
        'TEXTATLAS_INVALID', 'TEXTATLAS_LEGACY',
      ]) {
        node(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await wait(10);
      }
      if (window.__postedMessages.length) {
        throw new Error('TextAtlas posted to host: ' + JSON.stringify(window.__postedMessages));
      }
      if (window.__openedLinks.length) {
        throw new Error('TextAtlas called window.open: ' + JSON.stringify(window.__openedLinks));
      }
      if (window.__historyCalls.length) {
        throw new Error('TextAtlas changed history: ' + JSON.stringify(window.__historyCalls));
      }
      if (window.location.href !== window.__initialLocation) {
        throw new Error('TextAtlas navigated to ' + window.location.href);
      }
    });

    document.body.dataset.textatlasDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.textatlasTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.textatlasErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.textatlasTest = 'fail';
    document.body.dataset.textatlasErrors = error && error.stack ? error.stack : String(error);
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
        '--window-size=1000,760',
        '--virtual-time-budget=2200',
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
        && /data-textatlas-test=/i.test(result.stdout || '')) {
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
        `textatlas-strict-runtime-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`
      );
    }
    const domCount = /data-textatlas-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`textatlas-strict-runtime-browser.test.js: browser=${selected.candidate}`);
    console.log(
      `textatlas-strict-runtime-browser.test.js: ProductVersion=${browserVersion(selected.candidate)}`
    );
    console.log(`textatlas-strict-runtime-browser.test.js: DOM=${domCount}`);
    const encoded = /data-textatlas-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    assert.match(
      selected.result.stdout,
      /data-textatlas-test="pass"/,
      decodeAttribute(encoded) || 'browser scenario did not finish'
    );
  } finally {
    if (process.env.BOO_KEEP_TEXTATLAS_BROWSER_TEMP === '1') {
      console.log(`textatlas-strict-runtime-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
  console.log('textatlas-strict-runtime-browser.test.js: PASS');
}

main();
