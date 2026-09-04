const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const { reflowNpcDialogLayout } = require('../out/ui-dialog/source-parser');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const {
  GOM_SOURCE, GEE_SOURCE, PC_SOURCE, parse,
} = require('./all-text-surface-contract.test');

/*
 * Real Chromium RED contract paired with all-text-surface-contract.test.js.
 * The model may keep raw expressions for Inspector/audit, but the coordinate
 * canvas itself must always remain legible and must never render them as body
 * text, glyphs, titles, tooltips or generic placeholders.
 */

const root = path.resolve(__dirname, '..');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X3fCZAAAAABJRU5ErkJggg==';

function elementsWithoutFlow(model) {
  return (model.pages[0]?.elements || []).filter(element => element.statementId !== 'flow-text');
}

function actionElements(model) {
  const byId = new Map();
  for (const element of (model.scenes || []).flatMap(scene => scene.elements || [])) {
    if (element.addButtonPreview) byId.set(element.id, element);
  }
  return [...byId.values()];
}

function findRaw(elements, marker) {
  const element = elements.find(candidate => String(candidate.raw || '').includes(marker));
  if (!element) throw new Error(`missing browser fixture ${marker}`);
  return element;
}

function findKeyed(elements, id) {
  const element = elements.find(candidate => candidate.containerElementId === id);
  if (!element) throw new Error(`missing browser keyed fixture ${id}`);
  return element;
}

function readyAsset(reference, label, width = 20, height = 20) {
  return {
    status: 'ready',
    url: `${pixel}#${encodeURIComponent(label)}`,
    archiveLabel: label,
    width,
    height,
    offsetX: 0,
    offsetY: 0,
    reference,
  };
}

function hydrateStaticReferences(element) {
  if (element.assetRef) {
    element.asset = readyAsset(element.assetRef, `STATIC_${element.id}_primary`, 24, 24);
  }
  for (const [index, layer] of (element.assetLayers || []).entries()) {
    if (!layer.assetRef) continue;
    layer.asset = readyAsset(layer.assetRef, `STATIC_${element.id}_${layer.role}_${index}`, 24, 24);
  }
  const imageText = element.imageTextPreview;
  if (imageText) {
    const atlasWidth = Number(imageText.glyphWidth) > 0
      ? Number(imageText.glyphWidth) * 10 : 140;
    const atlasHeight = Number(imageText.glyphHeight) > 0
      ? Number(imageText.glyphHeight) : 24;
    for (const [index, glyph] of (imageText.glyphs || []).entries()) {
      if (!glyph.assetRef) continue;
      glyph.asset = readyAsset(
        glyph.assetRef,
        `STATIC_${element.id}_glyph_${index}_${glyph.character}`,
        imageText.mode === 'atlas' ? atlasWidth : 16,
        imageText.mode === 'atlas' ? atlasHeight : 20
      );
    }
    for (const [index, glyph] of (imageText.glyphBank || []).entries()) {
      if (!glyph.assetRef) continue;
      glyph.asset = readyAsset(
        glyph.assetRef,
        `STATIC_${element.id}_bank_${index}_${glyph.character}`,
        imageText.mode === 'atlas' ? atlasWidth : 16,
        imageText.mode === 'atlas' ? atlasHeight : 20
      );
    }
  }
}

function fixtureModel() {
  const gom = parse('GOM', GOM_SOURCE, 'browser-gom');
  const gee = parse('GEE', GEE_SOURCE, 'browser-gee');
  const pc = parse('996PC', PC_SOURCE, 'browser-996pc');
  const gomElements = elementsWithoutFlow(gom);
  const geeElements = elementsWithoutFlow(gee);
  const pcElements = elementsWithoutFlow(pc);
  const gomActions = actionElements(gom);

  const fixtures = [
    ['IMGNUM_KNOWN', findRaw(gomElements, 'N$KNOWN_NUM')],
    ['IMGNUM_UNKNOWN', findRaw(gomElements, 'N$UNKNOWN_NUM')],
    ['GENERIC_DYNAMIC_IMG', findRaw(gomElements, 'N$DYNAMIC_IMAGE')],
    ['IMG_TITLE_KNOWN', findRaw(gomElements, 'S$IMG_TITLE')],
    ['IMG_TITLE_UNKNOWN', findRaw(gomElements, 'S$UNKNOWN_IMG_TITLE')],
    ['ANIM_TITLE_KNOWN', findRaw(gomElements, 'S$ANIM_TITLE')],
    ['ANIM_TITLE_UNKNOWN', findRaw(gomElements, 'S$UNKNOWN_ANIM_TITLE')],
    ['ANIM_TIP_KNOWN', findRaw(geeElements, 'S$ANIM_TIP')],
    ['ANIM_TIP_UNKNOWN', findRaw(geeElements, 'S$UNKNOWN_ANIM_TIP')],
    ['ATLAS_UNKNOWN', findKeyed(pcElements, 'ATLAS_UNKNOWN')],
    ['INPUT_KNOWN', findKeyed(pcElements, 'INPUT_KNOWN')],
    ['INPUT_UNKNOWN', findKeyed(pcElements, 'INPUT_UNKNOWN')],
    ['MENU_KNOWN', findKeyed(pcElements, 'MENU_KNOWN')],
    ['MENU_UNKNOWN', findKeyed(pcElements, 'MENU_UNKNOWN')],
    ['COST_KNOWN', findKeyed(pcElements, 'COST_KNOWN')],
    ['COST_UNKNOWN', findKeyed(pcElements, 'COST_UNKNOWN')],
    ['ITEM_KNOWN', findKeyed(pcElements, 'ITEM_KNOWN')],
    ['ITEM_UNKNOWN', findKeyed(pcElements, 'ITEM_UNKNOWN')],
    ['COUNT_KNOWN', findKeyed(pcElements, 'COUNT_KNOWN')],
    ['COUNT_UNKNOWN', findKeyed(pcElements, 'COUNT_UNKNOWN')],
    ['PROGRESS_KNOWN', findKeyed(pcElements, 'PROGRESS_KNOWN')],
    ['PROGRESS_UNKNOWN', findKeyed(pcElements, 'PROGRESS_UNKNOWN')],
  ];

  const knownAction = gomActions.find(element => element.addButtonPreview?.triggerId === 9);
  const unknownAction = gomActions.find(element => element.addButtonPreview?.triggerId === 10);
  const dynamicAction = gomActions.find(element => (
    /N\$DYNAMIC_BUTTON_ID/i.test(element.raw || '')
  ));
  if (!knownAction || !unknownAction || !dynamicAction) {
    throw new Error('ADDBUTTON browser fixtures are incomplete');
  }
  fixtures.push(
    ['ADD_KNOWN', knownAction],
    ['ADD_UNKNOWN', unknownAction],
    ['ADD_DYNAMIC_GATE', dynamicAction]
  );

  const elements = fixtures.map(([id, element]) => {
    element.id = id;
    hydrateStaticReferences(element);
    return element;
  });
  const page = {
    ...pc.pages[0],
    id: 'ALL_TEXT_PAGE',
    sourceLabel: '@main',
    elements,
    unsupportedStatements: [],
  };
  const scene = {
    ...(pc.scenes.find(candidate => !candidate.conditionGroupId) || pc.scenes[0]),
    id: 'ALL_TEXT_SCENE',
    sourceLabel: '@main',
    elements,
    unsupportedStatements: [],
  };
  pc.pages = [page];
  pc.scenes = [scene];
  pc.actUiPreviews = [];
  pc.canvasWidth = 1050;
  pc.canvasHeight = 700;
  reflowNpcDialogLayout(pc);
  return pc;
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
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Item -LiteralPath $env:BOO_BROWSER_VERSION_EXECUTABLE).VersionInfo.ProductVersion',
    ], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
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
    + `complete=${/data-all-text-surface-test=/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function decodeAttribute(value) {
  return String(value || '')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function runBrowserMatrix() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    console.log('all-text-surface-contract-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-all-text-surface-'));
  try {
    const harness = path.join(temporary, 'all-text-surface.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__allTextModel = ${JSON.stringify(fixtureModel())};
window.__allTextPostedMessages = [];
window.__allTextOpenedLinks = [];
window.open = function (url) { window.__allTextOpenedLinks.push(String(url)); return null; };
window.acquireVsCodeApi = function () { return { postMessage: function (message) {
  if (message && message.type === 'ready') setTimeout(function () {
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'model', model: window.__allTextModel, previewRevision: 1,
      preserveDrafts: false, geeOffsetHelp: ''
    }}));
  }, 0);
  else window.__allTextPostedMessages.push(message);
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
  function text(id, selector) {
    var wrapper = typeof id === 'string' ? node(id) : id;
    var target = selector ? wrapper && wrapper.querySelector(selector) : wrapper;
    return target ? (target.textContent || '').trim() : '';
  }
  function glyphText(id) {
    return Array.from(node(id).querySelectorAll(
      '.image-text-atlas-cell, .image-text-glyph-image, .image-text-glyph-placeholder'
    )).filter(function (item) {
      return !item.classList.contains('image-text-glyph-image')
        || !item.closest('.image-text-atlas-cell');
    }).map(function (item) { return item.dataset.character || item.textContent || ''; }).join('');
  }
  function hover(wrapper) {
    wrapper.dispatchEvent(new MouseEvent('mouseenter', {
      bubbles: false, clientX: 500, clientY: 300,
    }));
  }
  function leave(wrapper) {
    wrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
  }
  async function tooltipText(id) {
    var wrapper = node(id);
    hover(wrapper);
    await wait(25);
    var tooltip = document.querySelector('.dialog-tooltip:not(.hidden)');
    var value = tooltip ? (tooltip.textContent || '').trim() : '';
    leave(wrapper);
    return value;
  }
  async function check(name, callback) {
    try { await callback(); }
    catch (error) {
      failures.push(name + ': ' + (error && error.message ? error.message : String(error)));
    }
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('IMGNUM_KNOWN'); attempt++) await wait(20);
    if (!node('IMGNUM_KNOWN')) throw new Error('all-text fixture did not render');

    await check('IMGNUM proved and unknown values are visible glyphs', async function () {
      if (glyphText('IMGNUM_KNOWN') !== '456') {
        throw new Error('known IMGNUM glyphs=' + glyphText('IMGNUM_KNOWN'));
      }
      if (glyphText('IMGNUM_UNKNOWN') !== '0') {
        throw new Error('unknown IMGNUM glyphs=' + glyphText('IMGNUM_UNKNOWN'));
      }
    });

    await check('TextAtlas static sheet draws neutral zero', async function () {
      if (glyphText('ATLAS_UNKNOWN') !== '0') {
        throw new Error('TextAtlas glyphs=' + glyphText('ATLAS_UNKNOWN'));
      }
      if (node('ATLAS_UNKNOWN').dataset.imageTextState !== 'dynamic') {
        throw new Error('TextAtlas source provenance was lost');
      }
    });

    await check('CostItem title and slash quantity obey display contract', async function () {
      var expected = [
        ['COST_KNOWN', '已知消耗', '/12'],
        ['COST_UNKNOWN', '预览文字', '/0'],
      ];
      for (var row of expected) {
        if (text(row[0], '.cost-item-title') !== row[1]
          || text(row[0], '.cost-item-quantity') !== row[2]) {
          throw new Error(row[0] + '=' + text(row[0]));
        }
      }
    });

    await check('Input placeholders obey proved/preview text contract', async function () {
      var known = node('INPUT_KNOWN').querySelector('.dialog-input-control');
      var unknown = node('INPUT_UNKNOWN').querySelector('.dialog-input-control');
      if (!known || known.placeholder !== '已知输入提示') {
        throw new Error('known placeholder=' + (known && known.placeholder));
      }
      if (!unknown || unknown.placeholder !== '预览文字') {
        throw new Error('unknown placeholder=' + (unknown && unknown.placeholder));
      }
    });

    await check('MenuItem selected value and item list remain visible', async function () {
      var known = node('MENU_KNOWN');
      var unknown = node('MENU_UNKNOWN');
      if (known.dataset.menuItems !== '甲#乙'
        || text(known, '.menu-selected-value') !== '乙') {
        throw new Error('known menu=' + known.dataset.menuItems + '/' + text(known, '.menu-selected-value'));
      }
      if (unknown.dataset.menuItems !== '预览文字'
        || text(unknown, '.menu-selected-value') !== '预览文字') {
        throw new Error('unknown menu=' + unknown.dataset.menuItems + '/' + text(unknown, '.menu-selected-value'));
      }
      var knownShellTitle = known.querySelector('.menu-shell')?.getAttribute('title') || '';
      if (knownShellTitle !== '菜单共 2 项') {
        throw new Error('menu shell kept an unbounded native item-list title: ' + knownShellTitle);
      }
    });

    await check('ItemShow quantity draws proved seven and neutral zero', async function () {
      if (text('ITEM_KNOWN', '.item-quantity') !== '7') {
        throw new Error('known ItemShow quantity=' + text('ITEM_KNOWN', '.item-quantity'));
      }
      if (text('ITEM_UNKNOWN', '.item-quantity') !== '0') {
        throw new Error('unknown ItemShow quantity=' + text('ITEM_UNKNOWN', '.item-quantity'));
      }
    });

    await check('Countdown shows snapshots but never starts a dynamic timer', async function () {
      for (var row of [['COUNT_KNOWN', '65秒'], ['COUNT_UNKNOWN', '0秒']]) {
        var wrapper = node(row[0]);
        if (text(wrapper, '.styled-text-preview') !== row[1]) {
          throw new Error(row[0] + ' text=' + text(wrapper, '.styled-text-preview'));
        }
        if (wrapper.dataset.countdownRunning !== 'false'
          || wrapper.dataset.countdownBlocked === 'none') {
          throw new Error(row[0] + ' started a fake runtime timer: ' + JSON.stringify(wrapper.dataset));
        }
      }
    });

    await check('Progress captions show snapshots without a fake ratio', async function () {
      for (var row of [['PROGRESS_KNOWN', '25%'], ['PROGRESS_UNKNOWN', '0%']]) {
        var wrapper = node(row[0]);
        if (text(wrapper, '.progress-caption') !== row[1]) {
          throw new Error(row[0] + ' caption=' + text(wrapper, '.progress-caption'));
        }
        if (wrapper.dataset.progressBlocked !== 'dynamic'
          || wrapper.hasAttribute('data-progress-ratio')) {
          throw new Error(row[0] + ' invented a deterministic progress ratio');
        }
      }
    });

    await check('IMG title and tooltip obey proved/preview text contract', async function () {
      if (text('IMG_TITLE_KNOWN', '.image-title') !== '已知图片标题'
        || text('IMG_TITLE_UNKNOWN', '.image-title') !== '预览文字') {
        throw new Error('IMG title nodes are incomplete');
      }
      if ((await tooltipText('IMG_TITLE_KNOWN')) !== '已知图片提示'
        || (await tooltipText('IMG_TITLE_UNKNOWN')) !== '预览文字') {
        throw new Error('IMG tooltip values are incomplete');
      }
    });

    await check('Animation title and tooltip obey proved/preview text contract', async function () {
      if (text('ANIM_TITLE_KNOWN', '.animation-title') !== '已知动画标题'
        || text('ANIM_TITLE_UNKNOWN', '.animation-title') !== '预览文字') {
        throw new Error('Animation title nodes are incomplete');
      }
      if ((await tooltipText('ANIM_TIP_KNOWN')) !== '已知动画提示'
        || (await tooltipText('ANIM_TIP_UNKNOWN')) !== '预览文字') {
        throw new Error('Animation tooltip values are incomplete');
      }
    });

    await check('ADDBUTTON title/tips are visible and local-only', async function () {
      if (text('ADD_KNOWN', '.button-caption') !== '已知动作按钮'
        || text('ADD_UNKNOWN', '.button-caption') !== '预览文字') {
        throw new Error('ADDBUTTON captions are incomplete');
      }
      if ((await tooltipText('ADD_KNOWN')) !== '已知动作提示'
        || (await tooltipText('ADD_UNKNOWN')) !== '预览文字') {
        throw new Error('ADDBUTTON tooltip values are incomplete');
      }
      for (var id of ['ADD_KNOWN', 'ADD_UNKNOWN']) {
        var wrapper = node(id);
        var before = window.__allTextPostedMessages.length;
        var href = location.href;
        wrapper.click();
        await wait(20);
        if (window.__allTextPostedMessages.length !== before
          || window.__allTextOpenedLinks.length !== 0 || location.href !== href) {
          throw new Error(id + ' escaped local-only action boundary');
        }
      }
    });

    await check('generic dynamic fallback is typed and never leaks source', async function () {
      var wrapper = node('GENERIC_DYNAMIC_IMG');
      var placeholder = text(wrapper, '.element-placeholder');
      if (!/图片|素材/.test(placeholder) || !/未确定|动态|未知|不可用/.test(placeholder)) {
        throw new Error('generic image placeholder is not useful: ' + placeholder);
      }
      if (/<\\$STR\\(|\\$STR\\(/i.test(placeholder)) {
        throw new Error('generic image placeholder leaked expression: ' + placeholder);
      }
    });

    await check('entire coordinate canvas contains no source expression', async function () {
      var canvas = document.getElementById('dialogCanvas');
      var content = canvas ? canvas.textContent || '' : '';
      if (/<\\$STR\\(|\\$STR\\(/i.test(content)) {
        throw new Error('canvas leaked source expression: ' + content.slice(0, 500));
      }
    });

    await check('native hints stay concise while full warnings remain inspectable', async function () {
      var modelElements = window.__allTextModel.pages[0].elements || [];
      var warned = modelElements.filter(function (element) { return Boolean(element.warning); });
      if (!warned.length) throw new Error('fixture has no warned elements');
      for (var element of warned) {
        var wrapper = node(element.id);
        var title = wrapper.getAttribute('title') || '';
        var label = wrapper.getAttribute('aria-label') || '';
        if (title.length > 80 || label.length > 120) {
          throw new Error(element.id + ' native hint is too long: ' + title.length + '/' + label.length);
        }
        if (title.includes(element.warning) || label.includes(element.warning)) {
          throw new Error(element.id + ' leaked its full warning into a native hint');
        }
        if (/<\\$|\\$STR\\s*\\(/i.test(title + ' ' + label)) {
          throw new Error(element.id + ' native hint leaked source: ' + title + ' / ' + label);
        }
        var nativeHint = title + ' ' + label;
        if (element.editable && (!/\u62d6\u52a8/.test(nativeHint) || !/\u65b9\u5411\u952e/.test(nativeHint))) {
          throw new Error(element.id + ' lost its short drag/keyboard hint: ' + nativeHint);
        }
        if (!element.editable && !/\u53ea\u8bfb/.test(nativeHint)) {
          throw new Error(element.id + ' lost its short read-only hint: ' + nativeHint);
        }
      }

      var inspected = warned.find(function (element) { return node(element.id); });
      node(inspected.id).click();
      await wait(20);
      var inspectorWarning = document.getElementById('elementWarning');
      if (!inspectorWarning || inspectorWarning.classList.contains('hidden')
        || (inspectorWarning.textContent || '') !== inspected.warning) {
        throw new Error('Inspector did not retain the complete warning for ' + inspected.id);
      }

      var canvas = document.getElementById('dialogCanvas');
      if (canvas.classList.contains('show-canvas-diagnostics')) {
        throw new Error('canvas diagnostics unexpectedly visible by default');
      }
      document.getElementById('canvasDiagnosticsToggle').click();
      await wait(20);
      if (!canvas.classList.contains('show-canvas-diagnostics')) {
        throw new Error('explicit diagnostics toggle did not reveal typed boundaries');
      }
      var visibleBoundaries = Array.from(canvas.querySelectorAll('[class*="-boundary"]')).filter(function (item) {
        var style = getComputedStyle(item);
        return style.display !== 'none' && style.visibility !== 'hidden'
          && item.getBoundingClientRect().width > 0 && item.getBoundingClientRect().height > 0;
      });
      if (!visibleBoundaries.length) {
        throw new Error('explicit diagnostics mode exposed no typed boundary');
      }
      document.getElementById('canvasDiagnosticsToggle').click();

      for (var tooltipCase of [
        ['IMG_TITLE_KNOWN', '\u5df2\u77e5\u56fe\u7247\u63d0\u793a'],
        ['ANIM_TIP_KNOWN', '\u5df2\u77e5\u52a8\u753b\u63d0\u793a'],
        ['ADD_KNOWN', '\u5df2\u77e5\u52a8\u4f5c\u63d0\u793a'],
      ]) {
        var tooltipWrapper = node(tooltipCase[0]);
        if (tooltipWrapper.hasAttribute('title')) {
          throw new Error(tooltipCase[0] + ' custom tooltip was replaced by a native title');
        }
        if ((await tooltipText(tooltipCase[0])) !== tooltipCase[1]) {
          throw new Error(tooltipCase[0] + ' custom tooltip content changed');
        }
      }
    });

    await check('dynamic asset DB and action gates remain closed in DOM', async function () {
      var sources = Array.from(document.querySelectorAll('#dialogCanvas img')).map(function (image) {
        return image.getAttribute('src') || image.src || '';
      });
      if (sources.some(function (source) { return /9901|DYNAMIC_WIL|WIL37/i.test(source); })) {
        throw new Error('dynamic asset URL reached DOM: ' + sources.join(','));
      }
      var action = node('ADD_DYNAMIC_GATE');
      if (action.dataset.addbuttonTriggerId
        || action.querySelector('.runtime-action-hitarea')
        || /ButtonClick88/.test(action.textContent || '')) {
        throw new Error('dynamic ADDBUTTON action became executable');
      }
      for (var id of ['COST_KNOWN', 'ITEM_KNOWN']) {
        if (node(id).querySelector('.cost-item-image, .item-content-image')) {
          throw new Error(id + ' rendered a dynamic database-derived item image');
        }
      }
    });

    document.body.dataset.allTextSurfaceDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.allTextSurfaceTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.allTextSurfaceErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.allTextSurfaceTest = 'fail';
    document.body.dataset.allTextSurfaceErrors = error && error.stack ? error.stack : String(error);
  });
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let selected;
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const result = spawnSync(candidate, [
        '--headless=new', '--disable-gpu', '--disable-extensions',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--no-first-run', '--allow-file-access-from-files',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1280,900', '--virtual-time-budget=5000', '--dump-dom',
        pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 30000, windowsHide: true });
      attempts.push({ candidate, result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-all-text-surface-test=/i.test(result.stdout || '')) {
        selected = { candidate, result };
        break;
      }
      console.log(`all-text-surface-contract-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    if (!selected) {
      throw new Error(`installed Chromium candidates produced no completed DOM:\n${attempts.map(
        attempt => browserDiagnostic(attempt.candidate, attempt.result)
      ).join('\n')}`);
    }
    const domCount = /data-all-text-surface-dom-count="([0-9]+)"/i
      .exec(selected.result.stdout)?.[1] || '<missing>';
    console.log(`all-text-surface-contract-browser.test.js: browser=${selected.candidate}`);
    console.log(`all-text-surface-contract-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`all-text-surface-contract-browser.test.js: DOM=${domCount}`);
    if (/data-all-text-surface-test="pass"/i.test(selected.result.stdout)) return [];
    const encoded = /data-all-text-surface-errors="([^"]*)"/i.exec(selected.result.stdout)?.[1];
    return decodeAttribute(encoded).split(' || ').filter(Boolean);
  } finally {
    if (process.env.BOO_KEEP_ALL_TEXT_TEST_TEMP === '1') {
      console.log(`all-text-surface-contract-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

let failures;
try {
  failures = runBrowserMatrix();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
  failures = null;
}
if (Array.isArray(failures) && failures.length > 0) {
  console.error(`all-text-surface-contract-browser.test.js: RED FAILURE MATRIX (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else if (Array.isArray(failures)) {
  console.log('all-text-surface-contract-browser.test.js: PASS');
}
