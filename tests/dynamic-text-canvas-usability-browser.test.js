const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const RUNTIME_ROOT = path.resolve(
  process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || REPOSITORY_ROOT
);
const runtimeRequire = relativePath => require(path.join(RUNTIME_ROOT, ...relativePath.split('/')));

const staticLanguage = runtimeRequire('data/static-language.json');
const { buildDialogStatementCatalog } = runtimeRequire('out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = runtimeRequire('out/ui-dialog/offsets');
const { parseNpcDialogDocument } = runtimeRequire('out/ui-dialog/source-parser');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

function sourceFixture() {
  const rows = Array.from({ length: 10 }, (_, index) => (
    `<&TEXT:<$STR(N$RANK_${index + 1})>:458:${147 + index * 24}{FCOLOR=251}>`
  ));
  return [
    '[@rank]',
    '#ACT',
    'MOV S$KNOWN_TITLE 已确定榜首',
    '#SAY',
    '<&TEXT:<$STR(S$KNOWN_TITLE)>:120:60{FCOLOR=251}/@openRank>',
    '<&TEXT:<$STR(S$UNKNOWN_TITLE)>:120:88{FCOLOR=251}/@openUnknown(20,安全参数)>',
    '<&TEXT:<$STR(N$UNKNOWN_COUNT)>:120:116{FCOLOR=251}>',
    ...rows,
    '',
  ].join('\n');
}

function buildModel() {
  const source = sourceFixture();
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/dynamic-text-usability-browser.txt',
    fileName: 'dynamic-text-usability-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\dynamic-text-usability-browser.txt',
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: 'GOM',
    cursorOffset: source.indexOf('[@rank]') + '[@rank]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });
  const sourceElements = model.pages[0]?.elements || [];
  const elements = sourceElements.map(element => {
    const raw = String(element.raw || '');
    let id = element.id;
    if (raw.includes('S$KNOWN_TITLE')) id = 'KNOWN_TEXT';
    else if (raw.includes('S$UNKNOWN_TITLE')) id = 'UNKNOWN_STRING';
    else if (raw.includes('N$UNKNOWN_COUNT')) id = 'UNKNOWN_NUMBER';
    else {
      const rank = /N\$RANK_(\d+)/i.exec(raw)?.[1];
      if (rank) id = `RANK_${rank}`;
    }
    return { ...element, id };
  });
  const page = {
    ...model.pages[0],
    id: 'DYNAMIC_TEXT_USABILITY_PAGE',
    sourceLabel: '@rank',
    elements,
  };
  const scene = {
    ...model.scenes[0],
    id: 'DYNAMIC_TEXT_USABILITY_SCENE',
    sourceLabel: '@rank',
    elements,
  };
  const otherPage = {
    ...page,
    id: 'DYNAMIC_TEXT_OTHER_PAGE',
    sourceLabel: '@other',
    conditionSummary: '跨页 #ACT 隔离夹具',
    conditionGroupIds: [],
    elements: [],
  };
  const otherScene = {
    ...scene,
    id: 'DYNAMIC_TEXT_OTHER_SCENE',
    sourceLabel: '@other',
    conditionSummary: '跨页 #ACT 隔离夹具',
    conditionGroupId: undefined,
    elements: [],
  };
  model.pages = [page, otherPage];
  model.scenes = [scene, otherScene];
  model.actUiPreviews = [
    {
      id: 'ACT_RANK_ONLY',
      command: 'messagebox',
      simulation: 'partial',
      localOnly: true,
      sourceLabel: '@rank',
      fields: [{ name: 'message', status: 'static', value: '排行页动作' }],
      warning: 'Partial simulation：仅本地展示',
    },
    {
      id: 'ACT_OTHER_ONLY',
      command: 'messagebox',
      simulation: 'partial',
      localOnly: true,
      sourceLabel: '@other',
      fields: [{ name: 'message', status: 'static', value: '另一页动作' }],
      warning: 'Partial simulation：仅本地展示',
    },
  ];
  model.canvasWidth = 900;
  model.canvasHeight = 520;
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
    + `complete=${/data-dynamic-text-usability-test=/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(RUNTIME_ROOT, ...relativePath.split('/'))).href;
}

function decodeAttribute(value) {
  return String(value || '')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function runBrowserMatrix() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    console.log('dynamic-text-canvas-usability-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-dynamic-text-usability-'));
  try {
    const harness = path.join(temporary, 'dynamic-text-canvas-usability.html');
    let html = fs.readFileSync(path.join(RUNTIME_ROOT, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const renderer = `<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`;
    const mock = `<script>
window.__model = ${JSON.stringify(buildModel())};
window.__postedMessages = [];
window.__openedLinks = [];
window.__historyCalls = [];
window.__initialLocation = window.location.href;
window.open = function () { window.__openedLinks.push(Array.from(arguments)); return null; };
(function () {
  var push = history.pushState.bind(history);
  var replace = history.replaceState.bind(history);
  history.pushState = function () { window.__historyCalls.push(['push', Array.from(arguments)]); return push.apply(history, arguments); };
  history.replaceState = function () { window.__historyCalls.push(['replace', Array.from(arguments)]); return replace.apply(history, arguments); };
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
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function modelElement(id) {
    var pages = Array.isArray(window.__model && window.__model.pages) ? window.__model.pages : [];
    for (var pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      var elements = Array.isArray(pages[pageIndex].elements) ? pages[pageIndex].elements : [];
      for (var elementIndex = 0; elementIndex < elements.length; elementIndex++) {
        if (elements[elementIndex].id === id) return elements[elementIndex];
      }
    }
    return null;
  }
  function fire(target, type, options) {
    target.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0 }, options || {})));
  }
  function visible(target) {
    if (!target) return false;
    var style = getComputedStyle(target);
    var rect = target.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }
  function renderedText(id) {
    var wrapper = node(id);
    var label = wrapper && wrapper.querySelector('.styled-text-preview, .element-text');
    return label ? label.textContent.trim() : '';
  }
  async function check(name, callback) {
    try { await callback(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  async function run() {
    for (var attempt = 0; attempt < 120 && !node('RANK_10'); attempt++) await wait(10);
    if (!node('RANK_10')) throw new Error('rank fixture did not render');

    await check('deterministic and unresolved values remain useful on canvas', async function () {
      if (renderedText('KNOWN_TEXT') !== '已确定榜首') {
        throw new Error('known MOV is not drawn: ' + renderedText('KNOWN_TEXT'));
      }
      if (renderedText('UNKNOWN_STRING') !== '预览文字') {
        throw new Error('unknown string placeholder mismatch: ' + renderedText('UNKNOWN_STRING'));
      }
      if (renderedText('UNKNOWN_NUMBER') !== '0') {
        throw new Error('unknown numeric placeholder mismatch: ' + renderedText('UNKNOWN_NUMBER'));
      }
      for (var index = 1; index <= 10; index++) {
        if (renderedText('RANK_' + index) !== '0') {
          throw new Error('rank row ' + index + ' is not a useful numeric placeholder');
        }
      }
    });

    await check('canvas diagnostics stay hidden by default and require the explicit toolbar toggle', async function () {
      var diagnosticClasses = [
        'dialog-background-close-marker',
        'adddlg-content-origin',
        'adddlg-static-status',
        'itembox-constraint-summary',
        'slider-runtime-value',
        'toggle-runtime-value',
        'menu-runtime-value',
        'container-label',
        'container-client-default-scrollbar',
        'item-grid-runtime-empty',
        'item-grid-runtime-star',
        'item-grid-runtime-status',
        'item-runtime-star'
      ];
      var canvas = document.getElementById('dialogCanvas');
      diagnosticClasses.forEach(function (className, index) {
        var sentinel = document.createElement('span');
        sentinel.className = className + ' diagnostics-toggle-sentinel';
        sentinel.dataset.diagnosticsClass = className;
        sentinel.textContent = '诊断';
        sentinel.style.cssText = 'display:block;position:absolute;left:' + (8 + index * 23)
          + 'px;top:470px;width:20px;height:12px;';
        canvas.appendChild(sentinel);
      });
      var selector = '.text-field-boundary, .runtime-action-boundary, .diagnostics-toggle-sentinel';
      var all = Array.from(document.querySelectorAll('#dialogCanvas ' + selector));
      var toggle = document.getElementById('canvasDiagnosticsToggle');
      if (!toggle) throw new Error('toolbar has no explicit canvas diagnostics toggle');
      if (!all.length) throw new Error('fixture produced no long diagnostic boundaries to exercise');
      if (toggle.getAttribute('aria-pressed') !== 'false') {
        throw new Error('canvas diagnostics toggle is not off by default');
      }
      var drawn = all.filter(visible);
      if (drawn.length) {
        var sample = drawn.slice(0, 3).map(function (entry) {
          var rect = entry.getBoundingClientRect();
          return entry.className + '[' + Math.round(rect.width) + 'x' + Math.round(rect.height) + ']';
        }).join(', ');
        throw new Error(drawn.length + ' long diagnostic overlays remain visible: ' + sample);
      }

      toggle.click();
      await wait(20);
      if (toggle.getAttribute('aria-pressed') !== 'true') {
        throw new Error('toolbar toggle did not enter the explicit diagnostics-on state');
      }
      var explicitlyDrawn = all.filter(visible);
      if (!explicitlyDrawn.some(function (entry) { return entry.matches('.text-field-boundary'); })) {
        throw new Error('explicit diagnostics mode did not reveal a text field boundary');
      }
      if (!explicitlyDrawn.some(function (entry) { return entry.matches('.runtime-action-boundary'); })) {
        throw new Error('explicit diagnostics mode did not reveal a runtime action boundary');
      }
      var missingSentinels = diagnosticClasses.filter(function (className) {
        var sentinel = document.querySelector('[data-diagnostics-class="' + className + '"]');
        return !visible(sentinel);
      });
      if (missingSentinels.length) {
        throw new Error('explicit diagnostics mode did not reveal: ' + missingSentinels.join(', '));
      }

      toggle.click();
      await wait(20);
      if (toggle.getAttribute('aria-pressed') !== 'false' || all.some(visible)) {
        throw new Error('toolbar toggle did not restore the unobstructed canvas');
      }
    });

    await check('document-level #ACT previews remain scoped to the selected page', async function () {
      function actCard(id) {
        return document.querySelector('[data-act-ui-card-id="' + id + '"]');
      }
      function pageButton(label) {
        return Array.from(document.querySelectorAll('#sceneList .scene-button')).find(function (button) {
          return button.querySelector('strong')?.textContent.trim() === label;
        });
      }
      var postStart = window.__postedMessages.length;
      var href = location.href;
      if (!actCard('ACT_RANK_ONLY') || actCard('ACT_OTHER_ONLY')) {
        throw new Error('initial rank page contains a foreign #ACT preview');
      }
      var other = pageButton('@other');
      if (!other) throw new Error('other page switch is absent');
      other.click();
      await wait(20);
      if (actCard('ACT_RANK_ONLY') || !actCard('ACT_OTHER_ONLY')) {
        throw new Error('rank #ACT preview leaked after switching to @other');
      }
      if (document.querySelector('#dialogCanvas [data-act-ui-card-id]')) {
        throw new Error('document-level #ACT preview leaked into the coordinate canvas');
      }
      var rank = pageButton('@rank');
      if (!rank) throw new Error('rank page switch is absent after rerender');
      rank.click();
      await wait(20);
      if (!actCard('ACT_RANK_ONLY') || actCard('ACT_OTHER_ONLY')) {
        throw new Error('other #ACT preview leaked after returning to @rank');
      }
      if (window.__postedMessages.length !== postStart) {
        throw new Error('page-local #ACT inspection posted a host message');
      }
      if (window.__openedLinks.length || window.__historyCalls.length || location.href !== href) {
        throw new Error('page-local #ACT inspection navigated a real target');
      }
    });

    await check('linked text is yellow and underlined without executing its @ label', async function () {
      var wrapper = node('KNOWN_TEXT');
      var runNode = wrapper && wrapper.querySelector('.styled-text-line > span');
      if (!wrapper || !runNode) throw new Error('linked text run did not render');
      var candidates = [runNode, runNode.parentElement, wrapper];
      var yellow = candidates.some(function (entry) {
        var value = getComputedStyle(entry).color;
        return value === 'rgb(255, 255, 0)' || value === 'rgba(255, 255, 0, 1)'
          || entry.style.color === '#ffff00';
      });
      var underlined = candidates.some(function (entry) {
        return String(getComputedStyle(entry).textDecorationLine || '').includes('underline');
      });
      if (!yellow) throw new Error('FCOLOR=251 is not visibly yellow');
      if (!underlined) throw new Error('the visible /@ label text has no underline affordance');

      var hit = wrapper.querySelector('.runtime-action-hitarea');
      if (!hit) throw new Error('linked text has no local preview hit area');
      var postStart = window.__postedMessages.length;
      var href = location.href;
      hit.click();
      await wait(20);
      if (window.__postedMessages.length !== postStart) {
        throw new Error('/@ preview posted a host/server message');
      }
      if (window.__openedLinks.length || window.__historyCalls.length || location.href !== href) {
        throw new Error('/@ preview opened or navigated a real target');
      }
    });

    await check('Inspector keeps the original expression and each warning clause once', async function () {
      fire(node('UNKNOWN_STRING'), 'click');
      await wait(20);
      var selected = node('UNKNOWN_STRING');
      if (!selected || !selected.classList.contains('selected')) {
        throw new Error('click did not select the dynamic text');
      }
      var raw = document.getElementById('rawStatement').textContent;
      if (raw.indexOf('<$STR(S$UNKNOWN_TITLE)>') < 0) {
        throw new Error('Inspector lost the original expression: ' + raw);
      }
      var warningNode = document.getElementById('elementWarning');
      var warning = warningNode && warningNode.textContent.trim();
      if (!warning || warningNode.classList.contains('hidden')) {
        throw new Error('Inspector has no source-safety explanation');
      }
      var clauses = warning.split('；').map(function (value) { return value.trim(); }).filter(Boolean);
      if (new Set(clauses).size !== clauses.length) {
        throw new Error('Inspector repeats warning clauses: ' + clauses.join(' | '));
      }
    });

    await check(
      'Inspector local preview value changes only the unresolved canvas display',
      async function () {
      fire(node('UNKNOWN_STRING'), 'click');
      await wait(20);
      var selected = node('UNKNOWN_STRING');
      if (!selected || !selected.classList.contains('selected')) {
        throw new Error('unknown string did not remain selected');
      }
      var sourceElement = modelElement('UNKNOWN_STRING');
      if (!sourceElement) throw new Error('unknown string is absent from the source model');
      if (sourceElement.textPreview && sourceElement.textPreview.textValueStatus !== 'runtime-placeholder') {
        throw new Error('unknown string is not typed as a runtime placeholder');
      }
      var action = sourceElement.runtimeActionPreview;
      if (!action || action.link !== '@openUnknown'
        || JSON.stringify(action.parameters || []) !== JSON.stringify(['20', '安全参数'])) {
        throw new Error('local override fixture lacks a stable runtimeActionPreview link/parameter contract');
      }

      var container = document.getElementById('elementLocalPreview');
      var control = document.getElementById('elementLocalPreviewValue');
      var state = document.getElementById('elementLocalPreviewState');
      if (!container || !control || !state || container.classList.contains('hidden') || !visible(control)) {
        throw new Error('Inspector has no visible local preview input for unresolved text');
      }

      var rawBefore = document.getElementById('rawStatement').textContent;
      var modelRawBefore = sourceElement.raw;
      var modelTextBefore = sourceElement.text;
      var textPreviewBefore = JSON.stringify(sourceElement.textPreview || null);
      var runtimeActionBefore = JSON.stringify(sourceElement.runtimeActionPreview || null);
      var parametersBefore = document.getElementById('elementParameters').textContent;
      var xBefore = document.getElementById('elementX').value;
      var yBefore = document.getElementById('elementY').value;
      var changesBefore = document.getElementById('changeList').textContent.trim();
      var postsBefore = window.__postedMessages.length;
      var hrefBefore = location.href;

      fire(node('KNOWN_TEXT'), 'click');
      await wait(20);
      if (!document.getElementById('elementLocalPreview').classList.contains('hidden')) {
        throw new Error('Inspector exposes a local override for statically determined text');
      }
      fire(node('UNKNOWN_NUMBER'), 'click');
      await wait(20);
      if (!document.getElementById('elementLocalPreview').classList.contains('hidden')) {
        throw new Error('Inspector exposes a text override for an unresolved numeric slot');
      }
      fire(node('UNKNOWN_STRING'), 'click');
      await wait(20);
      control = document.getElementById('elementLocalPreviewValue');

      control.value = '张三';
      control.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      await wait(20);

      container = document.getElementById('elementLocalPreview');
      control = document.getElementById('elementLocalPreviewValue');
      state = document.getElementById('elementLocalPreviewState');
      sourceElement = modelElement('UNKNOWN_STRING');
      if (renderedText('UNKNOWN_STRING') !== '张三') {
        throw new Error('local value was not redrawn on canvas: ' + renderedText('UNKNOWN_STRING'));
      }
      if (!container || !control || control.value !== '张三') {
        throw new Error('Inspector lost the local preview value after redraw');
      }
      var stateText = state ? state.textContent.trim() : '';
      if (!stateText || stateText.indexOf('本地') < 0) {
        throw new Error('Inspector does not identify 张三 as local preview state: ' + stateText);
      }
      if (document.getElementById('rawStatement').textContent !== rawBefore
        || sourceElement.raw !== modelRawBefore) {
        throw new Error('local preview rewrote the raw source expression');
      }
      if (sourceElement.text !== modelTextBefore
        || JSON.stringify(sourceElement.textPreview || null) !== textPreviewBefore) {
        throw new Error('local preview mutated the source display model');
      }
      if (JSON.stringify(sourceElement.runtimeActionPreview || null) !== runtimeActionBefore) {
        throw new Error('local preview changed runtimeActionPreview link/parameters');
      }
      if (document.getElementById('elementParameters').textContent !== parametersBefore) {
        throw new Error('local preview changed the Inspector source parameters');
      }
      if (document.getElementById('elementX').value !== xBefore
        || document.getElementById('elementY').value !== yBefore
        || document.getElementById('changeList').textContent.trim() !== changesBefore) {
        throw new Error('local preview polluted the coordinate change payload');
      }
      var localPosts = window.__postedMessages.slice(postsBefore);
      var unexpected = localPosts.filter(function (message) {
        return message.type !== 'ready' && message.type !== 'dirtyChanged';
      });
      if (unexpected.length) {
        throw new Error('local preview posted an unexpected host message: ' + JSON.stringify(unexpected));
      }
      if (window.__openedLinks.length || window.__historyCalls.length || location.href !== hrefBefore) {
        throw new Error('local preview opened or navigated a real target');
      }

      var localWrapper = node('UNKNOWN_STRING');
      var localRun = localWrapper && localWrapper.querySelector('.styled-text-line > span');
      var localHit = localWrapper && localWrapper.querySelector('.runtime-action-hitarea');
      if (!localWrapper || localWrapper.dataset.localTextPreview !== 'true' || !localRun || !localHit) {
        throw new Error('local redraw lost the styled text or local-only @ action surface');
      }
      var localColor = getComputedStyle(localRun).color;
      var localUnderlined = [localRun, localRun.parentElement, localWrapper].some(function (entry) {
        return String(getComputedStyle(entry).textDecorationLine || '').includes('underline');
      });
      if ((localColor !== 'rgb(255, 255, 0)' && localColor !== 'rgba(255, 255, 0, 1)')
        || !localUnderlined) {
        throw new Error('local value lost the yellow underlined /@ text styling');
      }

      var dialogCanvas = document.getElementById('dialogCanvas');
      var canvasStage = document.getElementById('canvasStage');
      var canvasViewport = document.getElementById('canvasViewport');
      var baseCanvasWidth = Number.parseFloat(dialogCanvas.style.width);
      var baseCanvasHeight = Number.parseFloat(dialogCanvas.style.height);
      var baseStageWidth = Number.parseFloat(canvasStage.style.width);
      var baseStageHeight = Number.parseFloat(canvasStage.style.height);
      var baseScrollWidth = canvasViewport.scrollWidth;

      control = document.getElementById('elementLocalPreviewValue');
      control.value = '很长的本地预览文字' + 'ABCDEFGHIJKLMN'.repeat(24);
      control.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      await wait(20);
      localWrapper = node('UNKNOWN_STRING');
      localRun = localWrapper && localWrapper.querySelector('.styled-text-preview');
      localHit = localWrapper && localWrapper.querySelector('.runtime-action-hitarea');
      var expandedCanvasWidth = Number.parseFloat(dialogCanvas.style.width);
      var expandedCanvasHeight = Number.parseFloat(dialogCanvas.style.height);
      var expandedStageWidth = Number.parseFloat(canvasStage.style.width);
      var expandedStageHeight = Number.parseFloat(canvasStage.style.height);
      if (!(expandedCanvasWidth > baseCanvasWidth)
        || !(expandedStageWidth > baseStageWidth)
        || !(canvasViewport.scrollWidth > baseScrollWidth)) {
        throw new Error('long local text did not expand the local canvas/stage scroll range: '
          + baseCanvasWidth + '/' + baseStageWidth + '/' + baseScrollWidth + ' -> '
          + expandedCanvasWidth + '/' + expandedStageWidth + '/' + canvasViewport.scrollWidth);
      }
      canvasViewport.scrollLeft = canvasViewport.scrollWidth;
      await wait(20);
      var wrapperRect = localWrapper && localWrapper.getBoundingClientRect();
      var labelRect = localRun && localRun.getBoundingClientRect();
      var hitRect = localHit && localHit.getBoundingClientRect();
      var canvasRect = dialogCanvas.getBoundingClientRect();
      var farTextHit = labelRect && document.elementFromPoint(
        Math.max(labelRect.left + 1, labelRect.right - 2),
        labelRect.top + Math.max(1, Math.min(labelRect.height - 1, labelRect.height / 2))
      );
      var longTextGeometryFailures = [];
      if (!wrapperRect || !labelRect || !hitRect) longTextGeometryFailures.push('missing geometry');
      else {
        if (wrapperRect.left - 0.5 > labelRect.left
          || wrapperRect.top - 0.5 > labelRect.top
          || wrapperRect.right + 0.5 < labelRect.right
          || wrapperRect.bottom + 0.5 < labelRect.bottom) {
          longTextGeometryFailures.push('wrapper does not contain label');
        }
        if (hitRect.left - 0.5 > labelRect.left
          || hitRect.top - 0.5 > labelRect.top
          || hitRect.right + 0.5 < labelRect.right
          || hitRect.bottom + 0.5 < labelRect.bottom) {
          longTextGeometryFailures.push('action hitarea does not contain label');
        }
        if (canvasRect.left - 0.5 > labelRect.left
          || canvasRect.top - 0.5 > labelRect.top
          || canvasRect.right + 0.5 < labelRect.right
          || canvasRect.bottom + 0.5 < labelRect.bottom) {
          longTextGeometryFailures.push('canvas clips label');
        }
      }
      if (!farTextHit || (farTextHit !== localWrapper && !localWrapper.contains(farTextHit))) {
        longTextGeometryFailures.push('far-right text point misses wrapper');
      }
      if (longTextGeometryFailures.length) {
        throw new Error('long local text geometry failed: ' + longTextGeometryFailures.join(', ')
          + '; wrapper=' + JSON.stringify(wrapperRect && {
            left: wrapperRect.left, top: wrapperRect.top,
            right: wrapperRect.right, bottom: wrapperRect.bottom
          }) + '; label=' + JSON.stringify(labelRect && {
            left: labelRect.left, top: labelRect.top,
            right: labelRect.right, bottom: labelRect.bottom
          }) + '; hit=' + JSON.stringify(hitRect && {
            left: hitRect.left, top: hitRect.top,
            right: hitRect.right, bottom: hitRect.bottom
          }) + '; canvas=' + JSON.stringify(canvasRect && {
            left: canvasRect.left, top: canvasRect.top,
            right: canvasRect.right, bottom: canvasRect.bottom
          }) + '; far=' + (farTextHit ? farTextHit.className : '<none>'));
      }

      var localWidthAt100 = Number.parseFloat(localWrapper.style.width);
      var localCanvasWidthAt100 = Number.parseFloat(dialogCanvas.style.width);
      for (var zoomStep = 0; zoomStep < 10; zoomStep += 1) {
        document.getElementById('zoomIn').click();
      }
      await wait(20);
      localWrapper = node('UNKNOWN_STRING');
      localRun = localWrapper && localWrapper.querySelector('.styled-text-preview');
      localHit = localWrapper && localWrapper.querySelector('.runtime-action-hitarea');
      var zoomedLocalWidth = localWrapper && Number.parseFloat(localWrapper.style.width);
      var zoomedCanvasWidth = Number.parseFloat(dialogCanvas.style.width);
      var zoomedStageWidth = Number.parseFloat(canvasStage.style.width);
      if (document.getElementById('zoomValue').textContent.trim() !== '200%'
        || Math.abs(zoomedLocalWidth - localWidthAt100) > 1
        || Math.abs(zoomedCanvasWidth - localCanvasWidthAt100) > 1
        || Math.abs(zoomedStageWidth - Math.round(zoomedCanvasWidth * 2)) > 1) {
        throw new Error('200% zoom reapplied the transform to local CSS geometry: wrapper '
          + localWidthAt100 + ' -> ' + zoomedLocalWidth + ', canvas '
          + localCanvasWidthAt100 + ' -> ' + zoomedCanvasWidth + ', stage=' + zoomedStageWidth);
      }
      canvasViewport.scrollLeft = canvasViewport.scrollWidth;
      await wait(20);
      wrapperRect = localWrapper && localWrapper.getBoundingClientRect();
      labelRect = localRun && localRun.getBoundingClientRect();
      hitRect = localHit && localHit.getBoundingClientRect();
      canvasRect = dialogCanvas.getBoundingClientRect();
      farTextHit = labelRect && document.elementFromPoint(
        Math.max(labelRect.left + 2, labelRect.right - 3),
        labelRect.top + Math.max(2, Math.min(labelRect.height - 2, labelRect.height / 2))
      );
      if (!wrapperRect || !labelRect || !hitRect
        || wrapperRect.right + 0.5 < labelRect.right
        || wrapperRect.bottom + 0.5 < labelRect.bottom
        || hitRect.right + 0.5 < labelRect.right
        || hitRect.bottom + 0.5 < labelRect.bottom
        || canvasRect.right + 0.5 < labelRect.right
        || canvasRect.bottom + 0.5 < labelRect.bottom
        || !farTextHit || (farTextHit !== localWrapper && !localWrapper.contains(farTextHit))) {
        throw new Error('long local text is clipped or misses its action surface at 200% zoom');
      }
      document.getElementById('zoomReset').click();
      await wait(20);
      if (document.getElementById('zoomValue').textContent.trim() !== '100%'
        || Math.abs(Number.parseFloat(node('UNKNOWN_STRING').style.width) - localWidthAt100) > 1) {
        throw new Error('zoom reset did not restore stable local text geometry');
      }

      control = document.getElementById('elementLocalPreviewValue');
      control.value = '';
      control.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      await wait(20);
      if (renderedText('UNKNOWN_STRING') !== '预览文字') {
        throw new Error('clearing the local value did not restore the safe text placeholder');
      }
      if (node('UNKNOWN_STRING')?.dataset.localTextPreview === 'true') {
        throw new Error('clearing the local value left a stale local-preview state on canvas');
      }
      if (Number.parseFloat(dialogCanvas.style.width) !== baseCanvasWidth
        || Number.parseFloat(dialogCanvas.style.height) !== baseCanvasHeight
        || Number.parseFloat(canvasStage.style.width) !== baseStageWidth
        || Number.parseFloat(canvasStage.style.height) !== baseStageHeight) {
        throw new Error('clearing the local value did not restore the source-model canvas size');
      }
      if (window.__postedMessages.length !== postsBefore
        || window.__openedLinks.length || window.__historyCalls.length || location.href !== hrefBefore) {
        throw new Error('clearing the local value caused a host or navigation side effect');
      }

      control = document.getElementById('elementLocalPreviewValue');
      control.value = '李四';
      control.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      await wait(20);
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'model', model: window.__model, previewRevision: 2,
        preserveDrafts: true, geeOffsetHelp: ''
      }}));
      await wait(30);
      if (renderedText('UNKNOWN_STRING') !== '李四'
        || document.getElementById('elementLocalPreviewValue').value !== '李四') {
        throw new Error('same-model preserve reload lost the local preview value');
      }

      var resolvedModel = JSON.parse(JSON.stringify(window.__model));
      [resolvedModel.pages, resolvedModel.scenes].forEach(function (collections) {
        (collections || []).forEach(function (collection) {
          (collection.elements || []).forEach(function (entry) {
            if (entry.id !== 'UNKNOWN_STRING') return;
            entry.text = '已确定称号';
            entry.textPreview.textValueStatus = 'resolved-static';
            entry.textPreview.lines = [[{ text: '已确定称号', color: '#ffff00' }]];
            (entry.textPreview.fieldSources || []).forEach(function (source) {
              if (source.field === 'text') source.status = 'resolved-static';
            });
          });
        });
      });
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'model', model: resolvedModel, previewRevision: 3,
        preserveDrafts: true, geeOffsetHelp: ''
      }}));
      await wait(30);
      if (renderedText('UNKNOWN_STRING') !== '已确定称号'
        || !document.getElementById('elementLocalPreview').classList.contains('hidden')) {
        throw new Error('a statically resolved reload did not supersede and hide the local override');
      }

      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'model', model: window.__model, previewRevision: 4,
        preserveDrafts: true, geeOffsetHelp: ''
      }}));
      await wait(30);
      if (renderedText('UNKNOWN_STRING') !== '预览文字'
        || document.getElementById('elementLocalPreviewValue').value !== '') {
        throw new Error('an obsolete local value revived after the field became unresolved again');
      }

      control = document.getElementById('elementLocalPreviewValue');
      control.value = '王五';
      control.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      await wait(20);
      var otherIdentityModel = JSON.parse(JSON.stringify(window.__model));
      otherIdentityModel.uri = 'file:///D:/MirServer/other-dynamic-text-usability.txt';
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'model', model: otherIdentityModel, previewRevision: 5,
        preserveDrafts: true, geeOffsetHelp: ''
      }}));
      await wait(30);
      if (renderedText('UNKNOWN_STRING') !== '预览文字'
        || document.getElementById('elementLocalPreviewValue').value !== '') {
        throw new Error('a different model identity inherited the old local preview value');
      }

      control = document.getElementById('elementLocalPreviewValue');
      control.value = '赵六';
      control.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      await wait(20);
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'model', model: window.__model, previewRevision: 6,
        preserveDrafts: false, geeOffsetHelp: ''
      }}));
      await wait(30);
      if (renderedText('UNKNOWN_STRING') !== '预览文字'
        || window.__postedMessages.length !== postsBefore) {
        throw new Error('ordinary reload retained the local value or emitted a host message');
      }

      fire(node('UNKNOWN_STRING'), 'click');
      await wait(20);
      control = document.getElementById('elementLocalPreviewValue');
      var inputPostsBefore = window.__postedMessages.length;
      control.value = '重置前文字';
      control.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      await wait(20);
      if (window.__postedMessages.length !== inputPostsBefore) {
        throw new Error('typing a reset fixture emitted a Host message');
      }
      var resetPostsBefore = window.__postedMessages.length;
      document.getElementById('resetPreview').click();
      await wait(30);
      var resetPosts = window.__postedMessages.slice(resetPostsBefore);
      if (renderedText('UNKNOWN_STRING') !== '预览文字') {
        throw new Error('Reset Preview did not clear the local text value');
      }
      if (resetPosts.length !== 1
        || JSON.stringify(resetPosts[0]) !== JSON.stringify({ type: 'resetPreview' })) {
        throw new Error('Reset Preview emitted unexpected Host messages: ' + JSON.stringify(resetPosts));
      }
    });

    await check('static-coordinate dynamic text can be selected and dragged', async function () {
      var wrapper = node('RANK_1');
      fire(wrapper, 'click');
      await wait(20);
      wrapper = node('RANK_1');
      if (!wrapper || !wrapper.classList.contains('selected')) {
        throw new Error('rank row click did not select itself');
      }
      var beforeX = Number(document.getElementById('elementX').value);
      var beforeY = Number(document.getElementById('elementY').value);
      var rect = wrapper.getBoundingClientRect();
      var startX = rect.left + Math.min(8, Math.max(2, rect.width / 3));
      var startY = rect.top + Math.min(8, Math.max(2, rect.height / 3));
      fire(wrapper, 'mousedown', { clientX: startX, clientY: startY, buttons: 1 });
      fire(window, 'mousemove', { clientX: startX + 26, clientY: startY + 14, buttons: 1 });
      fire(window, 'mouseup', { clientX: startX + 26, clientY: startY + 14, buttons: 0 });
      await wait(20);
      var afterX = Number(document.getElementById('elementX').value);
      var afterY = Number(document.getElementById('elementY').value);
      if (afterX !== beforeX + 26 || afterY !== beforeY + 14) {
        throw new Error('drag did not update the draft coordinates: '
          + beforeX + ',' + beforeY + ' -> ' + afterX + ',' + afterY);
      }
      if (!node('RANK_1')?.classList.contains('selected')) {
        throw new Error('drag lost the selected element');
      }
    });

    await check('canvas interaction has no host-action or navigation side effect', async function () {
      var readyMessages = window.__postedMessages.filter(function (message) {
        return JSON.stringify(message) === JSON.stringify({ type: 'ready' });
      });
      var resetMessages = window.__postedMessages.filter(function (message) {
        return JSON.stringify(message) === JSON.stringify({ type: 'resetPreview' });
      });
      if (readyMessages.length !== 1 || resetMessages.length !== 1) {
        throw new Error('unexpected ready/reset message count: ready=' + readyMessages.length
          + ', reset=' + resetMessages.length);
      }
      var unexpected = window.__postedMessages.filter(function (message) {
        return JSON.stringify(message) !== JSON.stringify({ type: 'ready' })
          && message.type !== 'dirtyChanged'
          && JSON.stringify(message) !== JSON.stringify({ type: 'resetPreview' });
      });
      if (unexpected.length) {
        throw new Error('canvas emitted unexpected host messages: ' + JSON.stringify(unexpected));
      }
      if (window.__openedLinks.length || window.__historyCalls.length
        || window.location.href !== window.__initialLocation) {
        throw new Error('canvas interaction opened/navigated/mutated history');
      }
    });

    document.body.dataset.dynamicTextUsabilityDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.dynamicTextUsabilityTest = failures.length ? 'fail' : 'pass';
    if (failures.length) {
      document.body.dataset.dynamicTextUsabilityErrors = encodeURIComponent(failures.join(' || '));
    }
  }
  run().catch(function (error) {
    document.body.dataset.dynamicTextUsabilityTest = 'fail';
    document.body.dataset.dynamicTextUsabilityErrors = encodeURIComponent('[dom] '
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
        '--window-size=1600,1000', '--virtual-time-budget=2600', '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8', timeout: 30000, windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-dynamic-text-usability-test=/i.test(result.stdout || '')) {
        selected = { candidate: candidates[index], result };
        break;
      }
    }

    if (!selected) {
      return [`[browser] no installed candidate produced a completed DOM:\n${attempts.map(
        ({ candidate, result }) => browserDiagnostic(candidate, result)
      ).join('\n')}`];
    }
    for (const { candidate, result } of attempts) {
      if (candidate === selected.candidate) break;
      console.log(`dynamic-text-canvas-usability-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }

    const domCount = /data-dynamic-text-usability-dom-count="([0-9]+)"/i
      .exec(selected.result.stdout)?.[1] || '<missing>';
    console.log(`dynamic-text-canvas-usability-browser.test.js: browser=${selected.candidate}`);
    console.log(`dynamic-text-canvas-usability-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`dynamic-text-canvas-usability-browser.test.js: runtime-root=${RUNTIME_ROOT}`);
    console.log(`dynamic-text-canvas-usability-browser.test.js: DOM=${domCount}`);
    if (/data-dynamic-text-usability-test="pass"/i.test(selected.result.stdout)) return [];
    const encoded = /data-dynamic-text-usability-errors="([^"]*)"/i
      .exec(selected.result.stdout)?.[1];
    return decodeURIComponent(decodeAttribute(encoded)).split(' || ').filter(Boolean);
  } finally {
    if (process.env.BOO_KEEP_DYNAMIC_TEXT_USABILITY_TEMP === '1') {
      console.log(`dynamic-text-canvas-usability-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

const failures = runBrowserMatrix();
if (failures.length > 0) {
  console.error('dynamic-text-canvas-usability-browser.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('dynamic-text-canvas-usability-browser.test.js: PASS');
}
