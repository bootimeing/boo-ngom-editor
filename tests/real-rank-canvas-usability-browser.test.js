const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const {
  buildRealRankModel,
  rankSlot,
  RUNTIME_ROOT,
  verifyRealRankModel,
} = require('./real-rank-canvas-usability.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const runtimeRequire = relativePath => require(path.join(RUNTIME_ROOT, ...relativePath.split('/')));
const { readArchiveImagePng } = runtimeRequire('out/utils/archive-index');
const {
  isPatchCacheCurrent,
  listCachedPatchPaks,
  loadCachedPatchAssetTable,
} = runtimeRequire('out/utils/patch-cache');
const { loadPakIndex } = runtimeRequire('out/utils/pak');
const { reflowNpcDialogLayout } = runtimeRequire('out/ui-dialog/source-parser');

const REQUIRE_REAL_BACKGROUND = process.env.BOO_REQUIRE_REAL_RANK_BACKGROUND === '1';
const REAL_RANK_WORKSPACE_ROOT = process.env.BOO_REAL_RANK_WORKSPACE_ROOT || 'D:\\MirServer';
const REAL_PATCH_CACHE_ROOT = process.env.BOO_REAL_RANK_PATCH_CACHE
  || path.join(process.env.LOCALAPPDATA || '', 'BOO-NGOM-Editor', 'cache', 'patch-cache');
const EXPECTED_REAL_BACKGROUND_ARCHIVE_ID = String(
  process.env.BOO_REAL_RANK_BACKGROUND_ARCHIVE_ID || ''
).trim().toLowerCase();

function rankElementId(element) {
  const slot = rankSlot(element);
  if (!slot) return element.id;
  return `REAL_RANK_${slot.column.toUpperCase()}_${slot.index}`;
}

function unavailableBackground(result, reason) {
  result.backgroundEvidence = { status: 'unavailable', reason };
  if (REQUIRE_REAL_BACKGROUND) assert.fail(`real rank background is required: ${reason}`);
  return result.backgroundEvidence;
}

function inferredWorkspaceRoot(scriptPath) {
  let current = path.dirname(path.resolve(scriptPath || REAL_RANK_WORKSPACE_ROOT));
  while (true) {
    if (path.basename(current).toLowerCase() === 'mir200') return path.dirname(current);
    const parent = path.dirname(current);
    if (parent === current) return REAL_RANK_WORKSPACE_ROOT;
    current = parent;
  }
}

async function hydrateRealRankBackground(result) {
  if (result.provenance !== 'real-gbk-snapshot') {
    return unavailableBackground(result, 'real GBK rank source is unavailable');
  }
  const page = result.model.pages.find(candidate => candidate.sourceLabel === '@战力排行');
  const background = page?.background;
  if (!background || background.status !== 'static' || !background.assetRef
    || !Number.isInteger(background.willIndex) || !Number.isInteger(background.imageIndex)
    || background.dynamicFields?.length || background.invalidFields?.length) {
    return unavailableBackground(result, 'the real rank page has no static background reference');
  }

  const workspaceRoot = process.env.BOO_REAL_RANK_WORKSPACE_ROOT
    || inferredWorkspaceRoot(result.sourcePaths?.script);
  const pakIndex = loadPakIndex(workspaceRoot);
  const entry = pakIndex?.pakList.find(candidate => candidate.willIdx === background.willIndex);
  if (!entry) {
    return unavailableBackground(
      result,
      `EffectImageList does not map WIL ${background.willIndex} under ${workspaceRoot}`
    );
  }
  if (!fs.existsSync(REAL_PATCH_CACHE_ROOT)) {
    return unavailableBackground(result, `patch cache is absent: ${REAL_PATCH_CACHE_ROOT}`);
  }

  const expectedName = entry.name.trim().toLowerCase();
  const expectedExtension = String(entry.extension || '').toLowerCase();
  let candidates = listCachedPatchPaks(REAL_PATCH_CACHE_ROOT)
    .filter(candidate => candidate.format === 'GOM'
      && candidate.storageMode === 'direct'
      && Boolean(candidate.archiveId)
      && candidate.pakName.trim().toLowerCase() === expectedName
      && candidate.storedWillIdx === background.willIndex
      && background.imageIndex < candidate.slotCount
      && isPatchCacheCurrent(candidate))
    .filter(candidate => !expectedExtension
      || path.extname(candidate.pakPath).slice(1).toLowerCase() === expectedExtension);
  if (EXPECTED_REAL_BACKGROUND_ARCHIVE_ID) {
    candidates = candidates.filter(candidate => (
      candidate.archiveId.toLowerCase() === EXPECTED_REAL_BACKGROUND_ARCHIVE_ID
    ));
  }
  if (candidates.length !== 1) {
    return unavailableBackground(
      result,
      `expected one current ${entry.name}.${entry.extension || '*'} cache for WIL `
        + `${background.willIndex}, found ${candidates.length}`
    );
  }

  const archive = candidates[0];
  const table = loadCachedPatchAssetTable(archive);
  const index = background.imageIndex;
  if (table.present[index] !== 1 || table.blank[index] === 1
    || table.width[index] <= 0 || table.height[index] <= 0) {
    return unavailableBackground(result, `cached background slot ${index} is absent, blank, or empty`);
  }
  const png = await readArchiveImagePng({
    extensionPath: RUNTIME_ROOT,
    indexRoot: path.dirname(archive.cacheDir),
    archiveId: archive.archiveId,
    imageIndex: index,
  });
  if (png.length < 24 || png.subarray(1, 4).toString('ascii') !== 'PNG') {
    return unavailableBackground(result, `cached background slot ${index} did not decode as PNG`);
  }
  const pngWidth = png.readUInt32BE(16);
  const pngHeight = png.readUInt32BE(20);
  if (pngWidth !== table.width[index] || pngHeight !== table.height[index]) {
    return unavailableBackground(
      result,
      `decoded PNG is ${pngWidth}x${pngHeight}, cache table is `
        + `${table.width[index]}x${table.height[index]}`
    );
  }

  const asset = {
    status: 'ready',
    url: `data:image/png;base64,${png.toString('base64')}`,
    archiveLabel: `${archive.pakName}.${expectedExtension || 'pak'}/${String(index).padStart(6, '0')}`,
    width: table.width[index],
    height: table.height[index],
    offsetX: table.offsetX[index] || 0,
    offsetY: table.offsetY[index] || 0,
  };
  for (const scene of result.model.scenes) {
    const candidate = scene.background;
    if (candidate?.status === 'static'
      && !candidate.dynamicFields?.length
      && !candidate.invalidFields?.length
      && candidate.willIndex === background.willIndex
      && candidate.imageIndex === background.imageIndex) {
      candidate.asset = asset;
    }
  }
  reflowNpcDialogLayout(result.model);
  result.backgroundEvidence = {
    status: 'ready',
    provenance: 'real-patch-cache-archive-decode',
    workspaceRoot,
    patchCacheRoot: REAL_PATCH_CACHE_ROOT,
    archiveId: archive.archiveId,
    archiveName: `${entry.name}.${entry.extension || 'pak'}`,
    imageIndex: index,
    width: asset.width,
    height: asset.height,
    offsetX: asset.offsetX,
    offsetY: asset.offsetY,
    pngBytes: png.length,
    pngSha256: crypto.createHash('sha256').update(png).digest('hex'),
  };
  return result.backgroundEvidence;
}

async function browserModel() {
  const result = buildRealRankModel();
  verifyRealRankModel(result);
  await hydrateRealRankBackground(result);
  const mapElements = elements => (elements || []).map(element => ({
    ...element,
    id: rankElementId(element),
  }));
  result.model.pages = result.model.pages.map(page => ({
    ...page,
    elements: mapElements(page.elements),
  }));
  result.model.scenes = result.model.scenes.map(scene => ({
    ...scene,
    elements: mapElements(scene.elements),
  }));
  result.model.canvasWidth = Math.max(800, Number(result.model.canvasWidth) || 0);
  result.model.canvasHeight = Math.max(600, Number(result.model.canvasHeight) || 0);
  return result;
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
    + `complete=${/data-real-rank-canvas-test=/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(RUNTIME_ROOT, ...relativePath.split('/'))).href;
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function decodeAttribute(value) {
  return String(value || '')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function metric(dom, name) {
  return new RegExp(`data-real-rank-canvas-${name}="([^"]*)"`, 'i').exec(dom)?.[1] || '<missing>';
}

async function runBrowserMatrix() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    console.log('real-rank-canvas-usability-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }

  const real = await browserModel();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-real-rank-browser-'));
  try {
    const harness = path.join(temporary, 'real-rank-canvas-usability.html');
    let html = fs.readFileSync(path.join(RUNTIME_ROOT, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const renderer = `<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`;
    const mock = `<script>
window.__model = ${serializeForInlineScript(real.model)};
window.__rankFixtureProvenance = ${serializeForInlineScript(real.provenance)};
window.__expectedRankRows = ${serializeForInlineScript(real.expectedRows)};
window.__realBackgroundEvidence = ${serializeForInlineScript(real.backgroundEvidence)};
window.__postedMessages = [];
window.__openedLinks = [];
window.__historyCalls = [];
window.__initialLocation = window.location.href;
window.open = function () { window.__openedLinks.push(Array.from(arguments)); return null; };
(function () {
  var originalPush = history.pushState.bind(history);
  var originalReplace = history.replaceState.bind(history);
  history.pushState = function () {
    window.__historyCalls.push(['push', Array.from(arguments)]);
    return originalPush.apply(history, arguments);
  };
  history.replaceState = function () {
    window.__historyCalls.push(['replace', Array.from(arguments)]);
    return originalReplace.apply(history, arguments);
  };
}());
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
    html = html.replace(renderer, `${mock}${renderer}`);

    const scenario = `<script>
(function () {
  var failures = [];
  var metrics = {
    rankNodes: 0,
    hitNodes: 0,
    maxOverlap: 0,
    visibleSourceExpressions: 0,
    diagnosticNodes: 0,
    hiddenDiagnosticNodes: 0,
    dragDelta: '',
    backgroundState: '',
    backgroundNaturalWidth: 0,
    backgroundNaturalHeight: 0,
    backgroundCoveredRankNodes: 0
  };
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function id(column, index) { return 'REAL_RANK_' + column + '_' + index; }
  function label(wrapper) { return wrapper && wrapper.querySelector('.element-text'); }
  function renderedText(elementId) {
    var value = label(node(elementId));
    return value ? value.textContent.trim() : '';
  }
  function visible(target) {
    if (!target) return false;
    var style = getComputedStyle(target);
    var rect = target.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }
  function fire(target, type, options) {
    target.dispatchEvent(new MouseEvent(type, Object.assign({
      bubbles: true, cancelable: true, button: 0
    }, options || {})));
  }
  function textHit(wrapper) {
    var visual = label(wrapper) || wrapper;
    var rect = visual.getBoundingClientRect();
    var x = rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2));
    var y = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2));
    return { target: document.elementFromPoint(x, y), x: x, y: y };
  }
  function overlapArea(first, second) {
    var width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
    var height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
    return width * height;
  }
  function visibleSourceExpressionTexts() {
    var rootNode = document.getElementById('dialogCanvas');
    var walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    var found = [];
    while (walker.nextNode()) {
      var textNode = walker.currentNode;
      var value = String(textNode.nodeValue || '').trim();
      if (value.toUpperCase().indexOf('<$STR(') < 0) continue;
      var range = document.createRange();
      range.selectNodeContents(textNode);
      var hasPaintedRect = Array.from(range.getClientRects()).some(function (rect) {
        return rect.width > 0 && rect.height > 0;
      });
      if (hasPaintedRect) found.push(value);
    }
    return found;
  }
  async function check(name, callback) {
    try { await callback(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  async function run() {
    for (var attempt = 0; attempt < 160 && !node(id('VALUE', 10)); attempt++) await wait(10);
    if (!node(id('VALUE', 10))) throw new Error('the real @战力排行 page did not render');

    await check('the real cached dialog background is decoded and painted behind the rank', async function () {
      var evidence = window.__realBackgroundEvidence || {};
      metrics.backgroundState = evidence.status || 'unknown';
      if (evidence.status !== 'ready') return;
      var wrapper;
      var image;
      for (var attempt = 0; attempt < 160; attempt++) {
        wrapper = document.querySelector('#dialogCanvas > .dialog-background-preview');
        image = wrapper && wrapper.querySelector('img.dialog-background');
        if (image && image.complete && image.naturalWidth > 0) break;
        await wait(10);
      }
      if (!wrapper || !image || !image.complete || image.naturalWidth <= 0) {
        throw new Error('the hydrated background produced no decoded browser image');
      }
      if (wrapper.dataset.backgroundWillIndex !== '1'
        || wrapper.dataset.backgroundImageIndex !== '290') {
        throw new Error('background identity changed: '
          + wrapper.dataset.backgroundWillIndex + '/' + wrapper.dataset.backgroundImageIndex);
      }
      if (wrapper.querySelector('.background-placeholder')) {
        throw new Error('the ready real background still renders a missing-asset placeholder');
      }
      if (wrapper.dataset.backgroundCommand !== 'OPENMERCHANTBIGDLG'
        || wrapper.dataset.backgroundStatus !== 'static'
        || wrapper.dataset.backgroundPosition !== '4'
        || wrapper.dataset.backgroundOffsetX !== '0'
        || wrapper.dataset.backgroundOffsetY !== '-50') {
        throw new Error('background command geometry changed: '
          + JSON.stringify(Object.assign({}, wrapper.dataset)));
      }
      if (String(image.src || '').indexOf('data:image/png;base64,') !== 0) {
        throw new Error('real background did not use the decoded PNG data URI');
      }
      metrics.backgroundNaturalWidth = image.naturalWidth;
      metrics.backgroundNaturalHeight = image.naturalHeight;
      if (image.naturalWidth !== evidence.width || image.naturalHeight !== evidence.height) {
        throw new Error('browser decoded ' + image.naturalWidth + 'x' + image.naturalHeight
          + ' instead of cache geometry ' + evidence.width + 'x' + evidence.height);
      }
      var backgroundRect = wrapper.getBoundingClientRect();
      var imageRect = image.getBoundingClientRect();
      if (Math.abs(backgroundRect.width - evidence.width) > 0.5
        || Math.abs(backgroundRect.height - evidence.height) > 0.5) {
        throw new Error('painted background geometry is ' + backgroundRect.width + 'x'
          + backgroundRect.height + ' instead of ' + evidence.width + 'x' + evidence.height);
      }
      if (imageRect.width <= 0 || imageRect.height <= 0
        || Math.abs(imageRect.width - evidence.width) > 0.5
        || Math.abs(imageRect.height - evidence.height) > 0.5) {
        throw new Error('painted background image geometry is ' + imageRect.width + 'x'
          + imageRect.height + ' instead of ' + evidence.width + 'x' + evidence.height);
      }
      for (var index = 1; index <= 10; index++) {
        for (var column of ['NAME', 'VALUE']) {
          var rect = node(id(column, index)).getBoundingClientRect();
          var centerX = rect.left + rect.width / 2;
          var centerY = rect.top + rect.height / 2;
          if (centerX >= backgroundRect.left && centerX <= backgroundRect.right
            && centerY >= backgroundRect.top && centerY <= backgroundRect.bottom) {
            metrics.backgroundCoveredRankNodes++;
          }
        }
      }
      if (metrics.backgroundCoveredRankNodes !== 20) {
        throw new Error('real background covers only ' + metrics.backgroundCoveredRankNodes
          + '/20 rank hit targets');
      }
    });

    await check('real determined values and typed placeholders are painted', async function () {
      for (var index = 1; index <= 10; index++) {
        var expected = window.__expectedRankRows[index - 1];
        var expectedName = expected.name;
        var expectedValue = expected.value;
        var actualName = renderedText(id('NAME', index));
        var actualValue = renderedText(id('VALUE', index));
        if (actualName !== expectedName || actualValue !== expectedValue) {
          throw new Error('row ' + index + ' drew [' + actualName + ', ' + actualValue
            + '] instead of [' + expectedName + ', ' + expectedValue + ']');
        }
      }
    });

    await check('default canvas paints no source expressions or long diagnostics', async function () {
      var toggle = document.getElementById('canvasDiagnosticsToggle');
      if (!toggle || toggle.getAttribute('aria-pressed') !== 'false') {
        throw new Error('diagnostics are not explicitly off by default');
      }
      var boundaries = Array.from(document.querySelectorAll(
        '#dialogCanvas [class*="-boundary"], #dialogCanvas .runtime-action-summary'
      ));
      metrics.diagnosticNodes = boundaries.length;
      metrics.hiddenDiagnosticNodes = boundaries.filter(function (entry) { return !visible(entry); }).length;
      if (!boundaries.length) throw new Error('the real dynamic page retained no auditable diagnostic nodes');
      var drawn = boundaries.filter(visible);
      if (drawn.length) {
        throw new Error(drawn.length + ' diagnostic overlays still cover the default canvas');
      }
      var sourceTexts = visibleSourceExpressionTexts();
      metrics.visibleSourceExpressions = sourceTexts.length;
      if (sourceTexts.length) {
        throw new Error('visible raw expressions remain: ' + sourceTexts.slice(0, 3).join(' | '));
      }
    });

    await check('all ten rows and both columns have positive, non-overlapping hit geometry', async function () {
      var entries = [];
      for (var index = 1; index <= 10; index++) {
        for (var column of ['NAME', 'VALUE']) {
          var elementId = id(column, index);
          var wrapper = node(elementId);
          var visual = label(wrapper);
          if (!wrapper || !visible(wrapper) || !visual || !visible(visual)) {
            throw new Error(elementId + ' has no positive visible wrapper/text geometry');
          }
          var rect = wrapper.getBoundingClientRect();
          var visualRect = visual.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0 || visualRect.width <= 0 || visualRect.height <= 0) {
            throw new Error(elementId + ' collapsed to zero area');
          }
          var hit = textHit(wrapper);
          if (!hit.target || !wrapper.contains(hit.target)) {
            throw new Error(elementId + ' elementFromPoint hit '
              + (hit.target ? hit.target.tagName + '.' + hit.target.className : '<null>'));
          }
          entries.push({ id: elementId, wrapper: wrapper, rect: rect });
          metrics.hitNodes++;
        }
      }
      metrics.rankNodes = entries.length;
      for (var left = 0; left < entries.length; left++) {
        for (var right = left + 1; right < entries.length; right++) {
          var area = overlapArea(entries[left].rect, entries[right].rect);
          metrics.maxOverlap = Math.max(metrics.maxOverlap, area);
          if (area > 0) {
            throw new Error(entries[left].id + ' overlaps ' + entries[right].id
              + ' by ' + area.toFixed(2) + ' CSS px²');
          }
        }
      }
    });

    await check('every text slash-at link is visibly yellow and underlined', async function () {
      for (var index = 1; index <= 3; index++) {
        var wrapper = node(id('NAME', index));
        var run = wrapper && wrapper.querySelector('.styled-text-line > span');
        if (!wrapper || !wrapper.classList.contains('text-action-link') || !run) {
          throw new Error('rank name ' + index + ' has no text-link visual identity');
        }
        var style = getComputedStyle(run);
        if (style.color !== 'rgb(255, 255, 0)' && style.color !== 'rgb(255, 242, 0)') {
          throw new Error('rank name ' + index + ' is not yellow: ' + style.color);
        }
        if (String(style.textDecorationLine || '').indexOf('underline') < 0) {
          throw new Error('rank name ' + index + ' is not underlined: ' + style.textDecorationLine);
        }
      }
    });

    await check('a local link click never reaches the host, server, window, history, or navigation', async function () {
      var wrapper = node(id('NAME', 1));
      var hit = textHit(wrapper);
      var interactive = wrapper.dataset.runtimeActionInteractive === 'true';
      var postStart = window.__postedMessages.length;
      var openStart = window.__openedLinks.length;
      var historyStart = window.__historyCalls.length;
      var href = location.href;
      fire(hit.target, 'mousedown', { clientX: hit.x, clientY: hit.y, buttons: 1 });
      fire(window, 'mouseup', { clientX: hit.x, clientY: hit.y, buttons: 0 });
      fire(hit.target, 'click', { clientX: hit.x, clientY: hit.y });
      await wait(20);
      var summary = node(id('NAME', 1)).querySelector('.runtime-action-summary');
      if (interactive) {
        if (!summary || summary.textContent.indexOf('@查看装备') < 0
          || summary.textContent.indexOf('仅本地预览') < 0) {
          throw new Error('the click did not stay inside the explicit local-only summary');
        }
      } else if (summary && summary.textContent.trim()) {
        throw new Error('a runtime-unknown action produced a local execution summary');
      }
      if (window.__postedMessages.length !== postStart) {
        throw new Error('the local @ action posted a host/server message: '
          + JSON.stringify(window.__postedMessages.slice(postStart)));
      }
      if (window.__openedLinks.length !== openStart || window.__historyCalls.length !== historyStart
        || location.href !== href) {
        throw new Error('the local @ action opened or navigated a real target');
      }
    });

    await check('a real static-coordinate text hit can be selected and dragged into a coordinate change', async function () {
      var elementId = id('NAME', 4);
      var wrapper = node(elementId);
      var hit = textHit(wrapper);
      if (!hit.target || !wrapper.contains(hit.target) || wrapper.classList.contains('locked')) {
        throw new Error('rank name 4 has no directly draggable real hit target');
      }
      var beforeLeft = Number.parseFloat(wrapper.style.left);
      var beforeTop = Number.parseFloat(wrapper.style.top);
      var postsBefore = window.__postedMessages.length;
      fire(hit.target, 'mousedown', { clientX: hit.x, clientY: hit.y, buttons: 1 });
      fire(window, 'mousemove', { clientX: hit.x + 24, clientY: hit.y + 12, buttons: 1 });
      fire(window, 'mouseup', { clientX: hit.x + 24, clientY: hit.y + 12, buttons: 0 });
      await wait(20);
      wrapper = node(elementId);
      var afterLeft = Number.parseFloat(wrapper.style.left);
      var afterTop = Number.parseFloat(wrapper.style.top);
      metrics.dragDelta = (afterLeft - beforeLeft) + ',' + (afterTop - beforeTop);
      if (afterLeft !== beforeLeft + 24 || afterTop !== beforeTop + 12) {
        throw new Error('drag failed: ' + beforeLeft + ',' + beforeTop
          + ' -> ' + afterLeft + ',' + afterTop);
      }
      if (!wrapper.classList.contains('selected')) {
        throw new Error('the dragged source text did not remain selected');
      }
      var x = Number(document.getElementById('elementX').value);
      var y = Number(document.getElementById('elementY').value);
      var change = document.querySelector('#changeList .change-row b');
      if (!Number.isFinite(x) || !Number.isFinite(y) || !change
        || change.textContent.indexOf(String(x)) < 0 || change.textContent.indexOf(String(y)) < 0) {
        throw new Error('the drag produced no concrete coordinate change row: '
          + document.getElementById('changeList').textContent.trim());
      }
      var emitted = window.__postedMessages.slice(postsBefore);
      if (emitted.some(function (message) { return message.type !== 'dirtyChanged'; })) {
        throw new Error('drag emitted an unrelated host action: ' + JSON.stringify(emitted));
      }
      if (node(elementId).querySelector('.runtime-action-summary')?.textContent.trim()) {
        throw new Error('dragging ordinary text unexpectedly executed a runtime action');
      }
    });

    await check('the completed canvas session has no external side effects', async function () {
      var unexpected = window.__postedMessages.filter(function (message) {
        return message.type !== 'ready' && message.type !== 'dirtyChanged';
      });
      if (unexpected.length) {
        throw new Error('unexpected host messages: ' + JSON.stringify(unexpected));
      }
      if (window.__openedLinks.length || window.__historyCalls.length
        || window.location.href !== window.__initialLocation) {
        throw new Error('the canvas opened a window or changed location/history');
      }
    });

    document.body.dataset.realRankCanvasFixture = window.__rankFixtureProvenance;
    document.body.dataset.realRankCanvasRankNodes = String(metrics.rankNodes);
    document.body.dataset.realRankCanvasHitNodes = String(metrics.hitNodes);
    document.body.dataset.realRankCanvasMaxOverlap = String(metrics.maxOverlap);
    document.body.dataset.realRankCanvasVisibleSourceExpressions = String(metrics.visibleSourceExpressions);
    document.body.dataset.realRankCanvasDiagnosticNodes = String(metrics.diagnosticNodes);
    document.body.dataset.realRankCanvasHiddenDiagnosticNodes = String(metrics.hiddenDiagnosticNodes);
    document.body.dataset.realRankCanvasDragDelta = metrics.dragDelta;
    document.body.dataset.realRankCanvasBackgroundState = metrics.backgroundState;
    document.body.dataset.realRankCanvasBackgroundNaturalWidth = String(metrics.backgroundNaturalWidth);
    document.body.dataset.realRankCanvasBackgroundNaturalHeight = String(metrics.backgroundNaturalHeight);
    document.body.dataset.realRankCanvasBackgroundCoveredRankNodes = String(metrics.backgroundCoveredRankNodes);
    document.body.dataset.realRankCanvasDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.realRankCanvasTest = failures.length ? 'fail' : 'pass';
    if (failures.length) {
      document.body.dataset.realRankCanvasErrors = encodeURIComponent(failures.join(' || '));
    }
  }
  run().catch(function (error) {
    document.body.dataset.realRankCanvasTest = 'fail';
    document.body.dataset.realRankCanvasErrors = encodeURIComponent('[dom] '
      + (error && error.stack ? error.stack : String(error)));
  });
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let selected;
    for (let index = 0; index < candidates.length; index++) {
      const result = spawnSync(candidates[index], [
        '--headless=new', '--disable-gpu', '--disable-extensions',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--no-first-run', '--allow-file-access-from-files', '--disable-web-security',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1600,1000', '--virtual-time-budget=3200', '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8', timeout: 35000, windowsHide: true,
        maxBuffer: 24 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-real-rank-canvas-test=/i.test(result.stdout || '')) {
        selected = { candidate: candidates[index], result };
        break;
      }
    }

    if (!selected) {
      return [`[browser] no installed candidate produced a completed real-rank DOM:\n${attempts.map(
        ({ candidate, result }) => browserDiagnostic(candidate, result)
      ).join('\n')}`];
    }
    for (const { candidate, result } of attempts) {
      if (candidate === selected.candidate) break;
      console.log(`real-rank-canvas-usability-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }

    const dom = selected.result.stdout || '';
    console.log(`real-rank-canvas-usability-browser.test.js: browser=${selected.candidate}`);
    console.log(`real-rank-canvas-usability-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`real-rank-canvas-usability-browser.test.js: runtime-root=${RUNTIME_ROOT}`);
    console.log(`real-rank-canvas-usability-browser.test.js: fixture=${metric(dom, 'fixture')}`);
    console.log(`real-rank-canvas-usability-browser.test.js: DOM=${metric(dom, 'dom-count')}`);
    console.log(`real-rank-canvas-usability-browser.test.js: hit=${metric(dom, 'hit-nodes')}/${metric(dom, 'rank-nodes')}`);
    console.log(`real-rank-canvas-usability-browser.test.js: max-overlap=${metric(dom, 'max-overlap')}`);
    console.log(`real-rank-canvas-usability-browser.test.js: visible-source-expressions=${metric(dom, 'visible-source-expressions')}`);
    console.log(`real-rank-canvas-usability-browser.test.js: hidden-diagnostics=${metric(dom, 'hidden-diagnostic-nodes')}/${metric(dom, 'diagnostic-nodes')}`);
    console.log(`real-rank-canvas-usability-browser.test.js: drag-delta=${metric(dom, 'drag-delta')}`);
    console.log(`real-rank-canvas-usability-browser.test.js: background-state=${metric(dom, 'background-state')}`);
    console.log(`real-rank-canvas-usability-browser.test.js: background-natural=${metric(dom, 'background-natural-width')}x${metric(dom, 'background-natural-height')}`);
    console.log(`real-rank-canvas-usability-browser.test.js: background-covered-rank=${metric(dom, 'background-covered-rank-nodes')}/20`);
    if (real.backgroundEvidence?.status === 'ready') {
      console.log(`real-rank-canvas-usability-browser.test.js: background-archive=${real.backgroundEvidence.archiveId}/${real.backgroundEvidence.imageIndex}`);
      console.log(`real-rank-canvas-usability-browser.test.js: background-png=${real.backgroundEvidence.pngBytes} bytes sha256=${real.backgroundEvidence.pngSha256}`);
    } else {
      console.log(`real-rank-canvas-usability-browser.test.js: background-unavailable=${real.backgroundEvidence?.reason || '<unknown>'}`);
    }
    if (/data-real-rank-canvas-test="pass"/i.test(dom)) return [];
    const encoded = /data-real-rank-canvas-errors="([^"]*)"/i.exec(dom)?.[1];
    return decodeURIComponent(decodeAttribute(encoded)).split(' || ').filter(Boolean);
  } finally {
    if (process.env.BOO_KEEP_REAL_RANK_TEMP === '1') {
      console.log(`real-rank-canvas-usability-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

runBrowserMatrix().then(failures => {
  if (failures.length > 0) {
    console.error('real-rank-canvas-usability-browser.test.js: RED FAILURE MATRIX');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('real-rank-canvas-usability-browser.test.js: PASS');
  }
}).catch(error => {
  console.error('real-rank-canvas-usability-browser.test.js: RED SETUP FAILURE');
  console.error(error);
  process.exitCode = 1;
});
