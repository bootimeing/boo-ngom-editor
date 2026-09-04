const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzNwAAAABJRU5ErkJggg==';
const mainPath = 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\coordinate-handles.txt';
const companionPath = 'D:\\MirServer\\Mir200\\Envir\\Market_Def\\QFunction-0.txt';

function browsers() {
  const values = [
    process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate));
  return [...new Set(values.map(candidate => path.resolve(candidate)))];
}

function browserVersion(executable) {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Item -LiteralPath $env:BOO_BROWSER_EXE).VersionInfo.ProductVersion',
    ], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
      env: { ...process.env, BOO_BROWSER_EXE: executable },
    });
    const value = String(result.stdout || '').trim().split(/\r?\n/, 1)[0];
    if (!result.error && result.status === 0 && value) return value;
  }
  return '<unknown>';
}

function diagnostic(executable, result) {
  return `${executable}: status=${result.status}, signal=${result.signal || '<none>'}, `
    + `error=${result.error?.message || '<none>'}, body=${/<body\b/i.test(result.stdout || '')}, `
    + `stderr=${String(result.stderr || '').trim().replace(/\r?\n/g, '\\n') || '<empty>'}`;
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function coordinate(value, start) {
  const original = String(value);
  return {
    sourceValue: value,
    displayValue: value,
    span: { start, end: start + original.length, original },
  };
}

function binding(id, targetKind, x, y, options = {}) {
  return {
    id,
    targetKind,
    editable: options.editable !== false,
    sourceKind: options.sourceKind || 'primary',
    sourceUri: options.sourceUri || pathToFileURL(mainPath).toString(),
    sourceFilePath: options.sourceFilePath || mainPath,
    sourceDocumentVersion: options.sourceDocumentVersion ?? 7,
    x: coordinate(x, options.xStart || 10),
    y: coordinate(y, options.yStart || 20),
  };
}

function fixtureModel() {
  const mainBackground = {
    command: 'OPENMERCHANTBIGDLG',
    status: 'static',
    raw: 'OPENMERCHANTBIGDLG 5 3 1 0 10 20 1 190 8 0',
    lineNumber: 3,
    sourceRange: { start: 14, end: 61, original: 'OPENMERCHANTBIGDLG 5 3 1 0 10 20 1 190 8 0' },
    sourceUri: pathToFileURL(mainPath).toString(),
    sourceFilePath: mainPath,
    sourceDocumentVersion: 7,
    willIndex: 5,
    imageIndex: 3,
    movable: true,
    position: 0,
    offsetX: 10,
    offsetY: 20,
    showCloseButton: true,
    closeButtonX: 190,
    closeButtonY: 8,
    independentWindow: false,
    runtimeScope: 'local-only',
    warnings: ['仅本地预览'],
    assetRef: { willIndex: 5, imageIndex: 3 },
    asset: {
      status: 'ready', url: `${pixel}#main-background`, archiveLabel: 'Main/000003',
      width: 300, height: 220, offsetX: -2, offsetY: 3,
    },
    offsetBinding: binding('binding:main-background-offset', 'dialog-background-offset', 10, 20, {
      xStart: 44, yStart: 47,
    }),
  };

  const windowPreview = {
    id: 'adddlg-window-main',
    command: 'ADDDLG',
    dialogId: 11,
    raw: 'ADDDLG 11 1 440 1 100:120 30:40 22 <inline>',
    lineNumber: 4,
    sourceRange: { start: 62, end: 112, original: 'ADDDLG 11 1 440 1 100:120 30:40 22 <inline>' },
    assetRef: { willIndex: 1, imageIndex: 440 },
    asset: {
      status: 'ready', url: `${pixel}#adddlg`, archiveLabel: 'LFM/000440',
      width: 240, height: 130, offsetX: 0, offsetY: 0,
    },
    movable: true,
    windowX: 100,
    windowY: 120,
    textOffsetX: 30,
    textOffsetY: 40,
    createPosition: 22,
    createPositionLabel: '宠物界面',
    contentPreview: { mode: 'inline', raw: '<inline>', status: 'static' },
    groupId: 0,
    displayMode: 0,
    popupDirection: 0,
    closeOnLeave: false,
    closeDelayMs: 300,
    closeActions: [],
    dynamicFields: [],
    invalidFields: [],
    warnings: ['Partial simulation：静态几何'],
    windowOriginBinding: binding('binding:adddlg-window-origin', 'adddlg-window-origin', 100, 120, {
      xStart: 82, yStart: 86,
    }),
    contentOriginBinding: binding('binding:adddlg-content-origin', 'adddlg-content-origin', 30, 40, {
      xStart: 90, yStart: 93,
    }),
  };

  const flow = {
    id: 'inline-flow-child',
    statementId: 'flow-text',
    token: '<文字>',
    description: 'LFM 行内流式子元素',
    kind: 'text',
    raw: '行内内容',
    lineNumber: 4,
    sourceRange: { start: 103, end: 107, original: '行内内容' },
    coordinateMode: 'flow',
    sourceCoordinateBiasX: 0,
    sourceCoordinateBiasY: 0,
    editable: false,
    localLayoutX: 18,
    localLayoutY: 24,
    layoutX: 18,
    layoutY: 24,
    width: 72,
    height: 20,
    text: '行内内容',
  };

  const externalUri = pathToFileURL(companionPath).toString();
  const companionBackground = {
    command: 'OPENMERCHANTBIGDLG',
    status: 'static',
    raw: 'OPENMERCHANTBIGDLG 5 3 1 0 70 80 1 190 8 0',
    lineNumber: 3,
    sourceRange: { start: 13, end: 60, original: 'OPENMERCHANTBIGDLG 5 3 1 0 70 80 1 190 8 0' },
    sourceUri: externalUri,
    sourceFilePath: companionPath,
    sourceDocumentVersion: 12,
    willIndex: 5,
    imageIndex: 3,
    movable: true,
    position: 0,
    offsetX: 70,
    offsetY: 80,
    showCloseButton: true,
    closeButtonX: 190,
    closeButtonY: 8,
    independentWindow: false,
    runtimeScope: 'local-only',
    warnings: ['外部 QFunction companion 只读预览'],
    assetRef: { willIndex: 5, imageIndex: 3 },
    asset: {
      status: 'ready', url: `${pixel}#external-background`, archiveLabel: 'External/000003',
      width: 260, height: 180, offsetX: 0, offsetY: 0,
    },
    offsetBinding: binding('binding:external-background-offset', 'dialog-background-offset', 70, 80, {
      editable: false,
      sourceKind: 'external-companion',
      sourceUri: externalUri,
      sourceFilePath: companionPath,
      sourceDocumentVersion: 12,
      xStart: 43,
      yStart: 46,
    }),
  };

  function page(id, sourceLabel, background, addDlgWindow, elements) {
    return {
      id,
      title: sourceLabel,
      sourceLabel,
      conditionSummary: '默认界面',
      conditionGroupIds: [],
      activeBranchIds: [],
      background,
      addDlgWindow,
      elements,
      unsupportedStatements: [],
      warnings: [],
      resolvedVariables: [],
    };
  }

  const main = page('page-main', '@main-coordinate-targets', mainBackground, windowPreview, [flow]);
  const external = page('page-companion', '@companion-background', companionBackground, undefined, []);
  return {
    uri: pathToFileURL(mainPath).toString(),
    fileName: path.basename(mainPath),
    filePath: mainPath,
    documentVersion: 7,
    engine: 'GEE',
    engineLabel: '翎风引擎',
    functionLabel: '@main',
    functionStart: 0,
    functionEnd: 180,
    offsets: { memoX: 0, memoY: 0, menuX: 0, menuY: 0, source: 'default', configured: true },
    canvasWidth: 800,
    canvasHeight: 600,
    conditionGroups: [],
    addDlgWindows: [windowPreview],
    companionUris: [externalUri],
    companionFilePaths: [companionPath],
    companionCandidateFilePaths: [companionPath],
    pages: [main, external],
    scenes: [
      { ...main, marker: 'STATIC', conditions: [], conditionOperators: [], previewPath: {}, sourceStart: 0, sourceEnd: 120 },
      { ...external, marker: 'STATIC', conditions: [], conditionOperators: [], previewPath: {}, sourceStart: 0, sourceEnd: 70 },
    ],
    actUiPreviews: [],
    warnings: [],
  };
}

function decode(value) {
  return String(value || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function run() {
  const candidates = browsers();
  if (candidates.length === 0) {
    console.log('window-background-coordinate-bindings-browser.test.js: SKIP (Edge/Chrome not installed)');
    return [];
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-coordinate-bindings-browser-'));
  try {
    const harness = path.join(temporary, 'coordinate-bindings.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.__postedMessages = [];
window.__unsafeEffects = [];
window.__initialHref = location.href;
window.open = function () { window.__unsafeEffects.push('window.open'); return null; };
var originalPushState = history.pushState.bind(history);
var originalReplaceState = history.replaceState.bind(history);
history.pushState = function () { window.__unsafeEffects.push('pushState'); return originalPushState.apply(history, arguments); };
history.replaceState = function () { window.__unsafeEffects.push('replaceState'); return originalReplaceState.apply(history, arguments); };
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
  function px(value) { return Number(String(value || '').replace('px', '')); }
  function target(kind) {
    return document.querySelector('[data-coordinate-target-kind="' + kind + '"]');
  }
  function rectVisible(node) {
    if (!node) return false;
    var rect = node.getBoundingClientRect();
    var style = getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none'
      && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0;
  }
  function hit(node) {
    var rect = node.getBoundingClientRect();
    var found = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return found === node || node.contains(found);
  }
  function click(node) { node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 })); }
  function setInspector(x, y) {
    var inputX = document.getElementById('elementX');
    var inputY = document.getElementById('elementY');
    inputX.value = String(x);
    inputX.dispatchEvent(new Event('change', { bubbles: true }));
    inputY.value = String(y);
    inputY.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function check(name, callback) {
    try { await callback(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  async function selectPage(label) {
    var button = Array.from(document.querySelectorAll('#sceneList .scene-button')).find(function (candidate) {
      return candidate.querySelector('strong') && candidate.querySelector('strong').textContent === label;
    });
    if (!button) throw new Error('page button missing: ' + label);
    button.click();
    await wait(40);
  }
  async function runScenario() {
    for (var attempt = 0; attempt < 80 && !document.querySelector('.adddlg-window'); attempt++) await wait(20);

    await check('all three primary coordinate handles are hidden by default', async function () {
      var kinds = ['adddlg-window-origin', 'adddlg-content-origin', 'dialog-background-offset'];
      for (var index = 0; index < kinds.length; index++) {
        var node = target(kinds[index]);
        if (!node) throw new Error(kinds[index] + ' target is missing from the DOM');
        if (rectVisible(node)) throw new Error(kinds[index] + ' target leaked into the client-like canvas');
      }
    });

    await check('Show diagnostics reveals all three primary coordinate handles', async function () {
      var toggle = document.getElementById('canvasDiagnosticsToggle');
      if (!toggle) throw new Error('canvas diagnostics toggle is missing');
      toggle.click();
      await wait(20);
      if (!document.getElementById('dialogCanvas').classList.contains('show-canvas-diagnostics')) {
        throw new Error('Show diagnostics did not enable the canvas diagnostics state');
      }
    });

    await check('all three primary coordinate pairs have visible hit targets in diagnostics mode', async function () {
      var kinds = ['adddlg-window-origin', 'adddlg-content-origin', 'dialog-background-offset'];
      for (var index = 0; index < kinds.length; index++) {
        var node = target(kinds[index]);
        if (!rectVisible(node)) throw new Error(kinds[index] + ' target missing or invisible');
        if (!hit(node)) throw new Error(kinds[index] + ' target is covered and cannot be hit');
        if (node.dataset.coordinateEditable !== 'true') {
          throw new Error(kinds[index] + ' literal primary target is not editable');
        }
      }
    });

    await check('background, AddDlg, and coordinate handles keep diagnostics out of native hints', async function () {
      var background = document.querySelector('.dialog-background-preview');
      var panel = document.querySelector('.adddlg-window[data-dialog-id="11"]');
      if (!background || !panel) throw new Error('background/AddDlg native-hint fixtures are missing');

      var surfaces = [background, panel,
        target('adddlg-window-origin'), target('adddlg-content-origin'), target('dialog-background-offset')];
      for (var index = 0; index < surfaces.length; index++) {
        var node = surfaces[index];
        if (!node) throw new Error('native-hint surface #' + index + ' is missing');
        var hint = [node.title || '', node.getAttribute('aria-label') || ''].join(' ');
        if (hint.length > 120) throw new Error('native hint is too long: ' + hint.length + ' / ' + hint);
        if (/仅本地预览|Partial simulation：静态几何|来自主文档直接数值|安全回写对应坐标对/.test(hint)) {
          throw new Error('full diagnostic leaked into native hint: ' + hint);
        }
        var dollar = String.fromCharCode(36);
        if (hint.includes('<' + dollar) || hint.toUpperCase().includes(dollar + 'STR(')) {
          throw new Error('source expression leaked into native hint: ' + hint);
        }
      }

      var backgroundBoundary = background.querySelector('.dialog-background-runtime-boundary');
      var addDlgBoundary = panel.querySelector('.adddlg-runtime-boundary');
      if (!backgroundBoundary || !backgroundBoundary.textContent.includes('仅本地预览')) {
        throw new Error('background full diagnostic was not retained in its typed boundary');
      }
      if (!addDlgBoundary || !addDlgBoundary.textContent.includes('Partial simulation：静态几何')) {
        throw new Error('AddDlg full diagnostic was not retained in its typed boundary');
      }

      var windowHandle = target('adddlg-window-origin');
      click(windowHandle);
      await wait(10);
      if (!document.getElementById('elementWarning').textContent.includes('来自主文档直接数值')) {
        throw new Error('coordinate-handle full diagnostic was not retained in Inspector');
      }
    });

    await check('coordinate binding handle selects itself on keyboard focus', async function () {
      var stale = target('adddlg-content-origin');
      var focused = target('adddlg-window-origin');
      click(stale);
      var panel = document.querySelector('.adddlg-window[data-dialog-id="11"]');
      var beforeLeft = px(panel.style.left);
      focused.focus();
      if (document.activeElement !== focused) throw new Error('window-origin handle could not receive focus');
      focused.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'ArrowRight'
      }));
      await wait(10);
      if (px(document.querySelector('.adddlg-window[data-dialog-id="11"]').style.left) !== beforeLeft + 1) {
        throw new Error('focused coordinate binding handle nudged a stale selection instead of itself');
      }
      focused.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'ArrowLeft'
      }));
      await wait(10);
      if (px(document.querySelector('.adddlg-window[data-dialog-id="11"]').style.left) !== beforeLeft) {
        throw new Error('window-origin focus probe did not restore its starting coordinate');
      }
    });

    await check('windowOrigin is selectable and Inspector moves the complete AddDlg window', async function () {
      var handle = target('adddlg-window-origin');
      if (!handle) throw new Error('windowOrigin handle missing');
      click(handle);
      var inputX = document.getElementById('elementX');
      var inputY = document.getElementById('elementY');
      if (inputX.disabled || inputY.disabled || inputX.value !== '100' || inputY.value !== '120') {
        throw new Error('Inspector did not select editable windowOrigin');
      }
      if (!document.getElementById('rawStatement').textContent.includes('ADDDLG 11')) {
        throw new Error('Inspector lost the owning ADDDLG source');
      }
      setInspector(106, 127);
      await wait(20);
      var panel = document.querySelector('.adddlg-window[data-dialog-id="11"]');
      if (px(panel.style.left) !== 106 || px(panel.style.top) !== 127) {
        throw new Error('Inspector edit did not move window: ' + panel.style.left + ',' + panel.style.top);
      }
      if (!document.getElementById('changeList').textContent.includes('106')) {
        throw new Error('windowOrigin edit did not enter the change list');
      }
    });

    await check('contentOrigin drag moves translated content without moving the window', async function () {
      var handle = target('adddlg-content-origin');
      if (!handle) throw new Error('contentOrigin handle missing');
      var panel = document.querySelector('.adddlg-window[data-dialog-id="11"]');
      var panelBefore = [px(panel.style.left), px(panel.style.top)];
      var child = document.querySelector('[data-element-id="inline-flow-child"]');
      var childBefore = child.getBoundingClientRect();
      var rect = handle.getBoundingClientRect();
      var startX = rect.left + rect.width / 2;
      var startY = rect.top + rect.height / 2;
      handle.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button: 0, clientX: startX, clientY: startY
      }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, buttons: 1, clientX: startX + 6, clientY: startY + 8
      }));
      window.dispatchEvent(new MouseEvent('mouseup', {
        bubbles: true, button: 0, clientX: startX + 6, clientY: startY + 8
      }));
      await wait(20);
      panel = document.querySelector('.adddlg-window[data-dialog-id="11"]');
      var origin = panel.querySelector('.adddlg-content-origin');
      child = document.querySelector('[data-element-id="inline-flow-child"]');
      var childAfter = child.getBoundingClientRect();
      if (px(origin.style.left) !== 36 || px(origin.style.top) !== 48) {
        throw new Error('contentOrigin did not move to 36,48');
      }
      if (px(panel.style.left) !== panelBefore[0] || px(panel.style.top) !== panelBefore[1]) {
        throw new Error('contentOrigin drag incorrectly moved the AddDlg window');
      }
      if (Math.abs((childAfter.left - childBefore.left) - 6) > 1
        || Math.abs((childAfter.top - childBefore.top) - 8) > 1) {
        throw new Error('translated child did not follow contentOrigin');
      }
    });

    await check('background offset accepts keyboard micro-adjustment independently', async function () {
      var handle = target('dialog-background-offset');
      if (!handle) throw new Error('primary background offset handle missing');
      click(handle);
      var viewport = document.getElementById('canvasViewport');
      viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await wait(20);
      var background = document.querySelector('.dialog-background-preview');
      if (px(background.style.left) !== 11 || px(background.style.top) !== 21) {
        throw new Error('background offset did not move independently to 11,21');
      }
      var panel = document.querySelector('.adddlg-window[data-dialog-id="11"]');
      if (px(panel.style.left) !== 106 || px(panel.style.top) !== 127) {
        throw new Error('background offset incorrectly moved the AddDlg window');
      }
    });

    await check('apply payload contains three stable coordinate binding ids', async function () {
      document.getElementById('applyButton').click();
      await wait(20);
      var apply = window.__postedMessages.filter(function (message) { return message.type === 'apply'; }).at(-1);
      if (!apply || !Array.isArray(apply.changes)) throw new Error('apply payload missing');
      var ids = new Set(apply.changes.map(function (change) { return change.elementId; }));
      var expected = ['binding:adddlg-window-origin', 'binding:adddlg-content-origin', 'binding:main-background-offset'];
      var missing = expected.filter(function (id) { return !ids.has(id); });
      if (missing.length) throw new Error('binding ids missing from payload: ' + missing.join(','));
    });

    await check('external companion background is visible, selectable, and locked', async function () {
      await selectPage('@companion-background');
      var handle = target('dialog-background-offset');
      if (!rectVisible(handle)) throw new Error('external background target is not visible/selectable');
      if (handle.dataset.coordinateEditable !== 'false'
        || handle.dataset.coordinateSourceKind !== 'external-companion') {
        throw new Error('external read-only provenance missing from target dataset');
      }
      click(handle);
      if (!document.getElementById('elementX').disabled || !document.getElementById('elementY').disabled) {
        throw new Error('Inspector enabled an external companion target');
      }
      if (!document.getElementById('rawStatement').textContent.includes('OPENMERCHANTBIGDLG')) {
        throw new Error('external target cannot be inspected/located');
      }
    });

    await check('external companion target rejects drag and arrow writes', async function () {
      var handle = target('dialog-background-offset');
      if (!handle) throw new Error('external background handle missing');
      var background = document.querySelector('.dialog-background-preview');
      var before = [px(background.style.left), px(background.style.top)];
      var changeText = document.getElementById('changeList').textContent;
      var rect = handle.getBoundingClientRect();
      handle.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button: 0, clientX: rect.left + 2, clientY: rect.top + 2
      }));
      window.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, buttons: 1, clientX: rect.left + 22, clientY: rect.top + 22
      }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      document.getElementById('canvasViewport').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
      await wait(20);
      background = document.querySelector('.dialog-background-preview');
      if (px(background.style.left) !== before[0] || px(background.style.top) !== before[1]) {
        throw new Error('external companion background moved despite read-only provenance');
      }
      if (document.getElementById('changeList').textContent !== changeText) {
        throw new Error('external companion target entered the primary-file change list');
      }
    });

    await check('coordinate editing does not execute server or navigation actions', async function () {
      var allowed = new Set(['ready', 'dirtyChanged', 'apply']);
      var unexpected = window.__postedMessages.map(function (message) { return message.type; })
        .filter(function (type) { return !allowed.has(type); });
      if (unexpected.length || window.__unsafeEffects.length || location.href !== window.__initialHref) {
        throw new Error('unsafe side effect: messages=' + unexpected.join(',')
          + ', effects=' + window.__unsafeEffects.join(',') + ', href=' + location.href);
      }
    });

    document.body.dataset.coordinateBindingsDom = String(document.querySelectorAll('*').length);
    document.body.dataset.coordinateBindingsTest = failures.length ? 'fail' : 'pass';
    if (failures.length) document.body.dataset.coordinateBindingsErrors = failures.join(' || ');
  }
  runScenario().catch(function (error) {
    document.body.dataset.coordinateBindingsTest = 'fail';
    document.body.dataset.coordinateBindingsErrors = 'scenario: '
      + (error && error.stack ? error.stack : String(error));
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
        '--no-first-run', '--allow-file-access-from-files',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1200,820', '--virtual-time-budget=3500', '--dump-dom',
        pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 25000, maxBuffer: 16 * 1024 * 1024 });
      attempts.push({ executable: candidates[index], result });
      if (!result.error && result.status === 0 && /<body\b/i.test(result.stdout || '')
        && /data-coordinate-bindings-test=/i.test(result.stdout || '')) {
        selected = { executable: candidates[index], result };
        break;
      }
    }
    if (!selected) {
      return [`no installed browser completed the DOM scenario:\n${attempts.map(
        attempt => diagnostic(attempt.executable, attempt.result)
      ).join('\n')}`];
    }
    for (const attempt of attempts) {
      if (attempt.executable === selected.executable) break;
      console.log(`window-background-coordinate-bindings-browser.test.js: candidate-failure=${diagnostic(
        attempt.executable, attempt.result
      )}`);
    }
    const dom = /data-coordinate-bindings-dom="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`window-background-coordinate-bindings-browser.test.js: browser=${selected.executable}`);
    console.log(`window-background-coordinate-bindings-browser.test.js: version=${browserVersion(selected.executable)}`);
    console.log(`window-background-coordinate-bindings-browser.test.js: DOM=${dom}`);
    if (!/data-coordinate-bindings-test="pass"/.test(selected.result.stdout)) {
      const encoded = /data-coordinate-bindings-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
      return decode(encoded).split(' || ').filter(Boolean);
    }
    return [];
  } finally {
    if (process.env.BOO_KEEP_COORDINATE_BINDING_TEST_TEMP === '1') {
      console.log(`window-background-coordinate-bindings-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

const failures = run();
if (failures.length > 0) {
  console.error('window-background-coordinate-bindings-browser.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('window-background-coordinate-bindings-browser.test.js: PASS');
}
