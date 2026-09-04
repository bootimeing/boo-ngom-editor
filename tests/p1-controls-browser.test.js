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

function parseModel(source, engine) {
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/p1-controls.txt',
    fileName: 'p1-controls.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\p1-controls.txt',
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function readyAsset(label, width, height, suffix) {
  return {
    status: 'ready',
    url: `${pixel}#${suffix}`,
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
    'MOV N$CHECK 1',
    'MOV N$SELECTED 194',
    'MOV N$MAX 100',
    'MOV N$VALUE 60',
    'MOV N$BUTTONWIDTH 240',
    'MOV N$BUTTONHEIGHT 90',
    'MOV N$TIME 5',
    '#SAY',
    '<CheckBox|id=CHECK_STATIC|x=20|y=20|checkboxid=N10|wil=NewopUI|pcnimg=192|pcpimg=193|default=0|delay=1|count=2|link=@toggleDone>',
    '<CheckBox|id=CHECK_DYNAMIC|x=100|y=20|checkboxid=N11|wil=NewopUI|pcnimg=192|pcpimg=193|default=<$STR(N$CHECK)>|link=@dynamicToggle>',
    '<CheckBox|id=CHECK_MIXED|x=180|y=20|checkboxid=N12|wil=NewopUI|pcnimg=192|pcpimg=<$STR(N$SELECTED)>|default=0|link=@mixedToggle>',
    '<CheckBox|id=CHECK_INVALID|x=260|y=20|checkboxid=N13|wil=NewopUI|pcnimg=192|pcpimg=193|default=2|link=@invalidToggle>',
    '<CheckBox|id=CHECK_MISSING|x=400|y=20|checkboxid=N14|wil=NewopUI|default=0|link=@missingToggle>',
    '<Slider|id=SLIDER_STATIC|x=20|y=70|width=200|height=20|sliderid=N20|wil=NewopUI|pcbgimg=298|pcbarimg=299|pcballimg=297|maxvalue=100|defvalue=25|link=@sliderDone>',
    '<Slider|id=SLIDER_DEFAULT|x=20|y=110|width=200|height=20|sliderid=N21|wil=NewopUI|pcbgimg=298|pcbarimg=299|pcballimg=297>',
    '<Slider|id=SLIDER_DYNAMIC_MAX|x=20|y=150|width=200|height=20|sliderid=N22|wil=NewopUI|pcbgimg=298|pcbarimg=299|pcballimg=297|maxvalue=<$STR(N$MAX)>|defvalue=25>',
    '<Slider|id=SLIDER_DYNAMIC_VALUE|x=20|y=190|width=200|height=20|sliderid=N23|wil=NewopUI|pcbgimg=298|pcbarimg=299|pcballimg=297|maxvalue=100|defvalue=<$STR(N$VALUE)>>',
    '<Slider|id=SLIDER_INVALID|x=20|y=390|width=200|height=20|sliderid=N24|wil=NewopUI|pcbgimg=298|pcbarimg=299|pcballimg=297|maxvalue=0|defvalue=-1|link=@invalidSlide>',
    '<COUNTDOWN|id=COUNT_TEXT|x=20|y=250|time=1|count=2|showWay=0|size=18|link=@textDone>',
    '<COUNTDOWN|id=COUNT_DYNAMIC|x=20|y=290|time=<$STR(N$TIME)>|count=1|showWay=0|link=@dynamicDone>',
    '<COUNTDOWN|id=COUNT_INVALID|x=20|y=330|time=-2|count=1|showWay=9|link=@invalidDone>',
    '<Button|id=BUTTON_SMALL|x=300|y=20|width=60|height=20|wil=NewopUI|pcnimg=140|pcmimg=141|pcpimg=142|text=小按钮>',
    '<Button|id=BUTTON_LARGE|x=300|y=80|width=180|height=60|wil=NewopUI|pcnimg=140|pcmimg=141|pcpimg=142|text=大按钮>',
    '<Button|id=BUTTON_DYNAMIC|x=300|y=170|width=<$STR(N$BUTTONWIDTH)>|height=<$STR(N$BUTTONHEIGHT)>|wil=NewopUI|pcnimg=140|pcmimg=141|pcpimg=142|text=动态尺寸>',
  ].join('\n');
  const model = parseModel(source, '996PC');
  const elements = model.pages[0].elements;
  for (const element of elements) {
    if (element.containerElementId) element.id = element.containerElementId;
  }

  const imageSource = [
    '[@main]',
    '#SAY',
    '<&IMGCOUNTDOWN:3:1:100:1:300:270:2/@imageDone>',
  ].join('\n');
  const imageCountdown = parseModel(imageSource, 'GOM').pages[0].elements.find(
    element => element.statementId === 'image-countdown'
  );
  imageCountdown.id = 'COUNT_IMAGE';
  elements.push(imageCountdown);

  for (const element of elements) {
    if (element.togglePreview) {
      if (element.assetRef) {
        element.asset = readyAsset('NewopUI/000192', 18, 18, `${element.id}-normal`);
      }
      const selected = element.assetLayers?.find(layer => layer.role === 'selected');
      if (selected?.assetRef) {
        selected.asset = readyAsset('NewopUI/000193', 18, 18, `${element.id}-selected`);
      }
    }
    if (element.sliderPreview) {
      for (const layer of element.assetLayers || []) {
        const thumb = layer.role === 'thumb';
        layer.asset = readyAsset(
          `NewopUI/${String(layer.assetRef?.imageIndex || 0).padStart(6, '0')}`,
          thumb ? 20 : 200,
          20,
          `${element.id}-${layer.role}`
        );
      }
    }
    if (element.kind === 'button' && !element.togglePreview) {
      element.asset = readyAsset('NewopUI/000140', 120, 40, `${element.id}-normal`);
      for (const layer of element.assetLayers || []) {
        layer.asset = readyAsset(
          `NewopUI/${String(layer.assetRef?.imageIndex || 0).padStart(6, '0')}`,
          120,
          40,
          `${element.id}-${layer.role}`
        );
      }
    }
  }

  imageCountdown.asset = readyAsset('NewopUI/000100', 12, 20, 'count-image-base');
  for (const glyph of imageCountdown.imageTextPreview.glyphBank || []) {
    glyph.asset = readyAsset(
      `NewopUI/${String(glyph.assetRef?.imageIndex || 0).padStart(6, '0')}`,
      12,
      20,
      `glyph-${glyph.character === ':' ? 'colon' : glyph.character}`
    );
  }
  for (const glyph of imageCountdown.imageTextPreview.glyphs || []) {
    const bank = imageCountdown.imageTextPreview.glyphBank?.find(
      candidate => candidate.character === glyph.character
    );
    glyph.asset = bank?.asset;
  }

  const scene = model.scenes.find(candidate => !candidate.conditionGroupId) || model.scenes[0];
  scene.elements = elements;
  model.pages[0].elements = elements;
  model.canvasWidth = 900;
  model.canvasHeight = 560;
  reflowNpcDialogLayout(model);
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
    console.log('p1-controls-browser.test.js: SKIP (Edge/Chrome not found)');
    return;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-p1-controls-browser-'));
  try {
    const harness = path.join(temporary, 'p1-controls.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.__postedMessages = [];
window.__nativeSetInterval = window.setInterval.bind(window);
window.setInterval = function (callback, delay) {
  var args = Array.prototype.slice.call(arguments, 2);
  var requested = Number(delay) || 0;
  var effective = requested > 0 && requested <= 1000 ? 2150 : requested;
  return window.__nativeSetInterval.apply(window, [callback, effective].concat(args));
};
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
  function px(value) { return Number(String(value || '').replace('px', '')); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function control(wrapper, role) {
    if (!wrapper) return null;
    if (wrapper.getAttribute('role') === role) return wrapper;
    return wrapper.querySelector('[role="' + role + '"]');
  }
  function toggleHandle(wrapper) {
    return wrapper && wrapper.querySelector('.toggle-drag-handle');
  }
  function sliderHandle(wrapper) {
    return wrapper && wrapper.querySelector('.slider-drag-handle');
  }
  function data(wrapper, role, key) {
    var target = control(wrapper, role);
    return (target && target.dataset[key] !== undefined)
      ? target.dataset[key]
      : wrapper && wrapper.dataset[key];
  }
  function mouse(target, type, x, y, buttons) {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0,
      buttons: buttons === undefined ? (type === 'mouseup' || type === 'click' ? 0 : 1) : buttons,
      clientX: x, clientY: y,
    }));
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  async function resetPreview() {
    document.getElementById('resetPreview').click();
    await wait(30);
  }
  function assertSize(id, width, height) {
    var wrapper = node(id);
    if (!wrapper) throw new Error(id + ' missing');
    if (px(wrapper.style.width) !== width || px(wrapper.style.height) !== height) {
      throw new Error(id + ' expected ' + width + 'x' + height + ', got '
        + wrapper.style.width + 'x' + wrapper.style.height);
    }
  }
  function toggleState(wrapper) {
    var target = control(wrapper, 'checkbox');
    return {
      checked: target && target.getAttribute('aria-checked'),
      disabled: target && target.getAttribute('aria-disabled'),
      value: data(wrapper, 'checkbox', 'toggleValue'),
      state: data(wrapper, 'checkbox', 'toggleState'),
      variable: data(wrapper, 'checkbox', 'toggleVariable'),
      image: wrapper && wrapper.querySelector('.toggle-asset-image')?.src,
    };
  }
  function sliderState(wrapper) {
    var target = control(wrapper, 'slider');
    return {
      minimum: target && target.getAttribute('aria-valuemin'),
      maximum: target && target.getAttribute('aria-valuemax'),
      value: target && target.getAttribute('aria-valuenow'),
      disabled: target && target.getAttribute('aria-disabled'),
      datasetValue: data(wrapper, 'slider', 'sliderValue'),
      interactive: data(wrapper, 'slider', 'sliderInteractive'),
      blocked: data(wrapper, 'slider', 'sliderBlocked'),
    };
  }
  async function clickSlider(id, ratio) {
    var wrapper = node(id);
    var target = control(wrapper, 'slider') || wrapper;
    var rect = wrapper.getBoundingClientRect();
    mouse(target, 'click', rect.left + rect.width * ratio, rect.top + rect.height / 2, 0);
    await wait(30);
  }
  async function dragSlider(id, startRatio, endRatio) {
    var wrapper = node(id);
    var target = control(wrapper, 'slider') || wrapper;
    var rect = wrapper.getBoundingClientRect();
    var startX = rect.left + rect.width * startRatio;
    var endX = rect.left + rect.width * endRatio;
    mouse(target, 'mousedown', startX, rect.top + rect.height / 2, 1);
    mouse(window, 'mousemove', endX, rect.top + rect.height / 2, 1);
    mouse(window, 'mouseup', endX, rect.top + rect.height / 2, 0);
    await wait(30);
  }
  function clipHiddenPercent(value) {
    var match = /([0-9.]+)%/.exec(String(value || ''));
    return match ? Number(match[1]) : NaN;
  }
  function countdownText(wrapper) {
    return wrapper?.querySelector('.styled-text-preview')?.textContent || '';
  }
  function countdownGlyphs(wrapper) {
    return Array.from(wrapper?.querySelectorAll(
      '.image-text-glyph-image, .image-text-glyph-placeholder'
    ) || []);
  }
  function countdownBoundary(wrapper) {
    return wrapper?.querySelector('.countdown-runtime-boundary')?.textContent || '';
  }
  function visible(target) {
    if (!target) return false;
    var style = getComputedStyle(target);
    var rect = target.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('CHECK_STATIC'); attempt++) await wait(20);
    if (!node('CHECK_STATIC')) throw new Error('fixture model did not render');

    await check('Button explicit size', async function () {
      assertSize('BUTTON_SMALL', 60, 20);
      assertSize('BUTTON_LARGE', 180, 60);
      var small = node('BUTTON_SMALL');
      var large = node('BUTTON_LARGE');
      if (small.dataset.sizeWidthMode !== 'explicit' || small.dataset.sizeHeightMode !== 'explicit'
        || large.dataset.sizeWidthMode !== 'explicit' || large.dataset.sizeHeightMode !== 'explicit') {
        throw new Error('explicit width/height modes are not exposed');
      }
    });

    await check('Button dynamic size source safety', async function () {
      var wrapper = node('BUTTON_DYNAMIC');
      if (!wrapper) throw new Error('dynamic button missing');
      if (px(wrapper.style.width) === 240 || px(wrapper.style.height) === 90) {
        throw new Error('borrowed MOV values 240x90 were used as deterministic geometry');
      }
      if (wrapper.dataset.sizeWidthMode !== 'dynamic'
        || wrapper.dataset.sizeHeightMode !== 'dynamic') {
        throw new Error('dynamic source size modes are not preserved in DOM');
      }
      var rect = wrapper.getBoundingClientRect();
      mouse(wrapper, 'click', rect.left + 2, rect.top + 2, 0);
      await wait(10);
      var boundary = document.getElementById('elementWarning').textContent;
      if (!boundary.includes('动态') || !/不采用|不借用|未知/.test(boundary)) {
        throw new Error('dynamic size safety boundary is not retained in Inspector');
      }
    });

    await check('CheckBox body is a real hit target that selects without coordinate drag', async function () {
      for (var id of [
        'CHECK_STATIC', 'CHECK_MIXED', 'CHECK_DYNAMIC', 'CHECK_INVALID', 'CHECK_MISSING'
      ]) {
        var wrapper = node(id);
        var target = control(wrapper, 'checkbox');
        if (!wrapper || !target) throw new Error(id + ' checkbox body is missing');
        var beforePosition = { left: px(wrapper.style.left), top: px(wrapper.style.top) };
        var beforeState = toggleState(wrapper);
        var rect = wrapper.getBoundingClientRect();
        var hit = document.elementFromPoint(rect.left + 3, rect.top + 3);
        if (!hit || !hit.closest('.toggle-hitarea')) {
          throw new Error(id + ' body cannot be hit through elementFromPoint: '
            + (hit ? hit.outerHTML : '<none>'));
        }
        mouse(hit, 'mousedown', rect.left + 3, rect.top + 3, 1);
        mouse(window, 'mousemove', rect.left + 70, rect.top + 60, 1);
        mouse(window, 'mouseup', rect.left + 70, rect.top + 60, 0);
        mouse(hit, 'click', rect.left + 3, rect.top + 3, 0);
        await wait(15);
        wrapper = node(id);
        var afterState = toggleState(wrapper);
        if (!wrapper.classList.contains('selected')) {
          throw new Error(id + ' body click did not select its canvas element');
        }
        if (px(wrapper.style.left) !== beforePosition.left
          || px(wrapper.style.top) !== beforePosition.top) {
          throw new Error(id + ' body gesture incorrectly dragged coordinates');
        }
        if (id === 'CHECK_DYNAMIC' || id === 'CHECK_INVALID') {
          if (JSON.stringify(afterState) !== JSON.stringify(beforeState)) {
            throw new Error(id + ' unknown/invalid body click invented a checked value');
          }
        } else if (afterState.checked !== 'true' || afterState.value !== '1') {
          throw new Error(id + ' known local state did not toggle: ' + JSON.stringify(afterState));
        }
      }
    });
    await resetPreview();

    await check('CheckBox coordinate handle is independently hittable and draggable in every source state', async function () {
      for (var id of [
        'CHECK_STATIC', 'CHECK_MIXED', 'CHECK_DYNAMIC', 'CHECK_INVALID', 'CHECK_MISSING'
      ]) {
        await resetPreview();
        var wrapper = node(id);
        var handle = toggleHandle(wrapper);
        if (!visible(handle) || handle.getAttribute('role') !== 'button') {
          throw new Error(id + ' has no visible coordinate drag handle');
        }
        var rect = handle.getBoundingClientRect();
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;
        var hit = document.elementFromPoint(x, y);
        if (!hit || !hit.closest('.toggle-drag-handle')) {
          throw new Error(id + ' coordinate handle cannot be hit: '
            + (hit ? hit.outerHTML : '<none>'));
        }
        var beforeLeft = px(wrapper.style.left);
        var beforeTop = px(wrapper.style.top);
        var beforeState = JSON.stringify(toggleState(wrapper));
        var sourceElement = window.__model.pages[0].elements.find(function (entry) {
          return entry.id === id;
        });
        var rawBefore = sourceElement && sourceElement.raw;
        var messageStart = window.__postedMessages.length;
        mouse(hit, 'mousedown', x, y, 1);
        mouse(window, 'mousemove', x + 24, y + 12, 1);
        mouse(window, 'mouseup', x + 24, y + 12, 0);
        await wait(10);
        wrapper = node(id);
        if (px(wrapper.style.left) !== beforeLeft + 24 || px(wrapper.style.top) !== beforeTop + 12) {
          throw new Error(id + ' handle drag failed: ' + beforeLeft + ',' + beforeTop
            + ' -> ' + wrapper.style.left + ',' + wrapper.style.top);
        }
        if (!wrapper.classList.contains('selected')) {
          throw new Error(id + ' handle drag did not select the element');
        }
        if (JSON.stringify(toggleState(wrapper)) !== beforeState) {
          throw new Error(id + ' handle drag changed its local checked state');
        }
        var inspectorX = Number(document.getElementById('elementX').value);
        document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, key: 'ArrowRight'
        }));
        await wait(10);
        if (Number(document.getElementById('elementX').value) !== inspectorX + 1
          || px(node(id).style.left) !== beforeLeft + 25) {
          throw new Error(id + ' selected coordinate did not respond to ArrowRight');
        }
        sourceElement = window.__model.pages[0].elements.find(function (entry) {
          return entry.id === id;
        });
        if (!sourceElement || sourceElement.raw !== rawBefore) {
          throw new Error(id + ' coordinate draft rewrote source before Apply');
        }
        var forbidden = window.__postedMessages.slice(messageStart).filter(function (message) {
          return message.type !== 'dirtyChanged';
        });
        if (forbidden.length) {
          throw new Error(id + ' coordinate drag emitted a host/action message: '
            + JSON.stringify(forbidden));
        }
      }
    });
    await resetPreview();

    await check('CheckBox click toggles both visual states', async function () {
      var wrapper = node('CHECK_STATIC');
      var target = control(wrapper, 'checkbox');
      if (!target) throw new Error('role=checkbox missing');
      var state = toggleState(wrapper);
      if (state.checked !== 'false' || state.value !== '0' || state.variable !== 'N10'
        || !state.image?.includes('CHECK_STATIC-normal')) {
        throw new Error('initial unchecked state/variable/normal image incorrect: ' + JSON.stringify(state));
      }
      mouse(target, 'click', 25, 25, 0);
      await wait(30);
      wrapper = node('CHECK_STATIC');
      state = toggleState(wrapper);
      if (state.checked !== 'true' || state.value !== '1'
        || !state.image?.includes('CHECK_STATIC-selected')) {
        throw new Error('checked state/selected image incorrect: ' + JSON.stringify(state));
      }
      if (!wrapper.querySelector('.toggle-runtime-value')?.textContent.includes('N10=1')) {
        throw new Error('preview variable value N10=1 is not visible');
      }
      target = control(wrapper, 'checkbox');
      mouse(target, 'click', 25, 25, 0);
      await wait(30);
      state = toggleState(node('CHECK_STATIC'));
      if (state.checked !== 'false' || state.value !== '0'
        || !state.image?.includes('CHECK_STATIC-normal')) {
        throw new Error('second click did not restore unchecked state: ' + JSON.stringify(state));
      }
    });

    await check('CheckBox dynamic default is disabled and unknown', async function () {
      var wrapper = node('CHECK_DYNAMIC');
      var target = control(wrapper, 'checkbox');
      if (!target) throw new Error('role=checkbox missing');
      var before = toggleState(wrapper);
      if (before.checked !== 'mixed' || before.disabled !== 'true'
        || before.state !== 'unknown' || before.value !== 'unknown') {
        throw new Error('dynamic default boundary incorrect: ' + JSON.stringify(before));
      }
      mouse(target, 'click', 65, 25, 0);
      await wait(30);
      var after = toggleState(node('CHECK_DYNAMIC'));
      if (JSON.stringify(after) !== JSON.stringify(before)) {
        throw new Error('disabled dynamic CheckBox changed after click');
      }
    });

    await check('Slider defaults and initial ARIA state', async function () {
      var explicit = sliderState(node('SLIDER_STATIC'));
      var defaults = sliderState(node('SLIDER_DEFAULT'));
      if (explicit.minimum !== '0' || explicit.maximum !== '100'
        || explicit.value !== '25' || explicit.datasetValue !== '25') {
        throw new Error('explicit slider initial state incorrect: ' + JSON.stringify(explicit));
      }
      if (defaults.minimum !== '0' || defaults.maximum !== '100'
        || defaults.value !== '0' || defaults.datasetValue !== '0') {
        throw new Error('documented 0/100 defaults incorrect: ' + JSON.stringify(defaults));
      }
    });

    await check('Slider click/drag clamps without moving element', async function () {
      var original = node('SLIDER_STATIC');
      var left = px(original.style.left);
      var top = px(original.style.top);
      await clickSlider('SLIDER_STATIC', 0.75);
      if (sliderState(node('SLIDER_STATIC')).value !== '75') throw new Error('track click did not set 75');
      await dragSlider('SLIDER_STATIC', 0.75, 1.5);
      if (sliderState(node('SLIDER_STATIC')).value !== '100') throw new Error('right clamp did not set 100');
      await dragSlider('SLIDER_STATIC', 1, -0.5);
      if (sliderState(node('SLIDER_STATIC')).value !== '0') throw new Error('left clamp did not set 0');
      await dragSlider('SLIDER_STATIC', 0, 0.6);
      var wrapper = node('SLIDER_STATIC');
      var state = sliderState(wrapper);
      if (state.value !== '60' || state.datasetValue !== '60') {
        throw new Error('drag did not set 60: ' + JSON.stringify(state));
      }
      if (px(wrapper.style.left) !== left || px(wrapper.style.top) !== top) {
        throw new Error('slider gesture moved the canvas element');
      }
      var fill = wrapper.querySelector('.progress-fill-image');
      var thumb = wrapper.querySelector('.slider-thumb-image');
      if (!fill || Math.abs(clipHiddenPercent(fill.style.clipPath) - 40) > 0.1) {
        throw new Error('60% bar clip is incorrect: ' + (fill && fill.style.clipPath));
      }
      if (!thumb || Math.abs(px(thumb.style.left) - 108) > 1) {
        throw new Error('60% thumb position is incorrect: ' + (thumb && thumb.style.left));
      }
    });

    await check('Slider dynamic max/value are disabled', async function () {
      for (var id of ['SLIDER_DYNAMIC_MAX', 'SLIDER_DYNAMIC_VALUE']) {
        var wrapper = node(id);
        var before = sliderState(wrapper);
        var left = px(wrapper.style.left);
        var top = px(wrapper.style.top);
        if (before.disabled !== 'true' || before.interactive !== 'false'
          || before.blocked !== 'dynamic' || before.value !== null) {
          throw new Error(id + ' dynamic boundary incorrect: ' + JSON.stringify(before));
        }
        await clickSlider(id, 0.9);
        await dragSlider(id, 0.2, 0.8);
        wrapper = node(id);
        var after = sliderState(wrapper);
        if (after.value !== null || after.datasetValue !== before.datasetValue
          || px(wrapper.style.left) !== left || px(wrapper.style.top) !== top) {
          throw new Error(id + ' accepted input or moved despite dynamic values');
        }
      }
    });

    await check('Slider invalid range stays disabled and unknown', async function () {
      var wrapper = node('SLIDER_INVALID');
      var before = sliderState(wrapper);
      if (before.disabled !== 'true' || before.interactive !== 'false'
        || before.blocked !== 'invalid' || before.value !== null) {
        throw new Error('invalid slider boundary incorrect: ' + JSON.stringify(before));
      }
      await clickSlider('SLIDER_INVALID', 0.9);
      await dragSlider('SLIDER_INVALID', 0.2, 0.8);
      var after = sliderState(node('SLIDER_INVALID'));
      if (after.value !== null || after.datasetValue !== before.datasetValue) {
        throw new Error('invalid slider invented a runtime value: ' + JSON.stringify(after));
      }
    });

    await check('Slider track is a real hit target that changes only local value', async function () {
      for (var id of [
        'SLIDER_STATIC', 'SLIDER_DEFAULT', 'SLIDER_DYNAMIC_MAX',
        'SLIDER_DYNAMIC_VALUE', 'SLIDER_INVALID'
      ]) {
        await resetPreview();
        var wrapper = node(id);
        var target = control(wrapper, 'slider');
        if (!wrapper || !target) throw new Error(id + ' slider track is missing');
        var beforePosition = { left: px(wrapper.style.left), top: px(wrapper.style.top) };
        var beforeState = sliderState(wrapper);
        var rect = wrapper.getBoundingClientRect();
        var hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        if (!hit || !hit.closest('.slider-hitarea')) {
          throw new Error(id + ' track cannot be hit through elementFromPoint: '
            + (hit ? hit.outerHTML : '<none>'));
        }
        mouse(hit, 'mousedown', rect.left + rect.width / 2, rect.top + rect.height / 2, 1);
        mouse(window, 'mousemove', rect.left + rect.width * 0.7, rect.top + rect.height / 2, 1);
        mouse(window, 'mouseup', rect.left + rect.width * 0.7, rect.top + rect.height / 2, 0);
        mouse(hit, 'click', rect.left + rect.width * 0.7, rect.top + rect.height / 2, 0);
        await wait(15);
        wrapper = node(id);
        if (!wrapper.classList.contains('selected')) {
          throw new Error(id + ' track interaction did not select its canvas element');
        }
        if (px(wrapper.style.left) !== beforePosition.left
          || px(wrapper.style.top) !== beforePosition.top) {
          throw new Error(id + ' track gesture incorrectly dragged coordinates');
        }
        var afterState = sliderState(wrapper);
        if (beforeState.disabled === 'true'
          && JSON.stringify(afterState) !== JSON.stringify(beforeState)) {
          throw new Error(id + ' blocked track invented a local value');
        }
      }
    });

    await check('Slider coordinate handle is independently hittable and draggable in every source state', async function () {
      for (var id of [
        'SLIDER_STATIC', 'SLIDER_DEFAULT', 'SLIDER_DYNAMIC_MAX',
        'SLIDER_DYNAMIC_VALUE', 'SLIDER_INVALID'
      ]) {
        await resetPreview();
        var wrapper = node(id);
        var handle = sliderHandle(wrapper);
        if (!visible(handle) || handle.getAttribute('role') !== 'button') {
          throw new Error(id + ' has no visible coordinate drag handle');
        }
        var rect = handle.getBoundingClientRect();
        var x = rect.left + rect.width / 2;
        var y = rect.top + rect.height / 2;
        var hit = document.elementFromPoint(x, y);
        if (!hit || !hit.closest('.slider-drag-handle')) {
          throw new Error(id + ' coordinate handle cannot be hit: '
            + (hit ? hit.outerHTML : '<none>'));
        }
        var beforeLeft = px(wrapper.style.left);
        var beforeTop = px(wrapper.style.top);
        var beforeState = JSON.stringify(sliderState(wrapper));
        var sourceElement = window.__model.pages[0].elements.find(function (entry) {
          return entry.id === id;
        });
        var rawBefore = sourceElement && sourceElement.raw;
        var messageStart = window.__postedMessages.length;
        mouse(hit, 'mousedown', x, y, 1);
        mouse(window, 'mousemove', x + 24, y + 12, 1);
        mouse(window, 'mouseup', x + 24, y + 12, 0);
        await wait(10);
        wrapper = node(id);
        if (px(wrapper.style.left) !== beforeLeft + 24 || px(wrapper.style.top) !== beforeTop + 12) {
          throw new Error(id + ' handle drag failed: ' + beforeLeft + ',' + beforeTop
            + ' -> ' + wrapper.style.left + ',' + wrapper.style.top);
        }
        if (!wrapper.classList.contains('selected')) {
          throw new Error(id + ' handle drag did not select the element');
        }
        if (JSON.stringify(sliderState(wrapper)) !== beforeState) {
          throw new Error(id + ' handle drag changed its local slider value');
        }
        var inspectorX = Number(document.getElementById('elementX').value);
        document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, key: 'ArrowRight'
        }));
        await wait(10);
        if (Number(document.getElementById('elementX').value) !== inspectorX + 1
          || px(node(id).style.left) !== beforeLeft + 25) {
          throw new Error(id + ' selected coordinate did not respond to ArrowRight');
        }
        sourceElement = window.__model.pages[0].elements.find(function (entry) {
          return entry.id === id;
        });
        if (!sourceElement || sourceElement.raw !== rawBefore) {
          throw new Error(id + ' coordinate draft rewrote source before Apply');
        }
        var forbidden = window.__postedMessages.slice(messageStart).filter(function (message) {
          return message.type !== 'dirtyChanged';
        });
        if (forbidden.length) {
          throw new Error(id + ' coordinate drag emitted a host/action message: '
            + JSON.stringify(forbidden));
        }
      }
    });

    await check('CheckBox and Slider coordinate handles select their own element on keyboard focus', async function () {
      for (var focusCase of [
        ['CHECK_STATIC', toggleHandle],
        ['SLIDER_STATIC', sliderHandle],
      ]) {
        await resetPreview();
        var previous = node('BUTTON_SMALL');
        var previousLeft = px(previous.style.left);
        previous.click();
        await wait(10);

        var id = focusCase[0];
        var wrapper = node(id);
        var handle = focusCase[1](wrapper);
        var beforeLeft = px(wrapper.style.left);
        if (!handle) throw new Error(id + ' focus handle is missing');
        handle.focus();
        if (document.activeElement !== handle) throw new Error(id + ' handle could not receive keyboard focus');
        handle.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true, cancelable: true, key: 'ArrowRight'
        }));
        await wait(10);
        if (px(node(id).style.left) !== beforeLeft + 1) {
          throw new Error(id + ' focused handle nudged a stale selection instead of itself');
        }
        if (px(node('BUTTON_SMALL').style.left) !== previousLeft) {
          throw new Error(id + ' focused handle moved the previously selected button');
        }
        if (Number(document.getElementById('elementX').value) !== beforeLeft + 1) {
          throw new Error(id + ' focused handle did not synchronize Inspector selection');
        }
      }
    });

    await resetPreview();
    await check('Default native tooltips stay concise while Inspector retains full diagnostics', async function () {
      var wrapper = node('BUTTON_DYNAMIC');
      var sourceElement = window.__model.pages[0].elements.find(function (entry) {
        return entry.id === 'BUTTON_DYNAMIC';
      });
      var warning = sourceElement && sourceElement.warning;
      if (!wrapper || !warning) throw new Error('dynamic button warning fixture is missing');
      var nativeTexts = [wrapper.title, wrapper.getAttribute('aria-label')].filter(Boolean);
      if (nativeTexts.some(function (value) { return value.includes(warning); })) {
        throw new Error('full diagnostic leaked into a default native tooltip');
      }
      if (nativeTexts.some(function (value) { return value.length > 120; })) {
        throw new Error('default native tooltip is still a long warning wall: '
          + JSON.stringify(nativeTexts));
      }
      mouse(wrapper, 'click', 305, 175, 0);
      await wait(10);
      if (document.getElementById('elementWarning').textContent !== warning) {
        throw new Error('Inspector did not retain the full diagnostic');
      }
    });

    await resetPreview();
    await check('countdown diagnostics are hidden by default and revealed explicitly', async function () {
      var boundary = node('COUNT_TEXT').querySelector('.countdown-runtime-boundary');
      var toggle = document.getElementById('canvasDiagnosticsToggle');
      if (!boundary || visible(boundary)) throw new Error('countdown boundary was not hidden by default');
      if (!toggle || toggle.getAttribute('aria-pressed') !== 'false') {
        throw new Error('diagnostics toggle did not start off');
      }
      toggle.click();
      await wait(10);
      if (!visible(boundary) || toggle.getAttribute('aria-pressed') !== 'true') {
        throw new Error('diagnostics toggle did not reveal countdown boundaries');
      }
    });
    await check('Text countdown initial live state', async function () {
      var text = node('COUNT_TEXT');
      if (text.dataset.countdownCurrent !== '1' || text.dataset.countdownRunning !== 'true'
        || countdownText(text) !== '1秒' || text.getAttribute('aria-live') !== 'polite') {
        throw new Error('text countdown initial live state incorrect');
      }
    });
    await check('Dynamic countdown shows its typed snapshot but keeps runtime stopped', async function () {
      var dynamic = node('COUNT_DYNAMIC');
      if (dynamic.dataset.countdownRunning !== 'false'
        || dynamic.dataset.countdownBlocked !== 'dynamic'
        || dynamic.dataset.countdownCurrent !== '?'
        || dynamic.dataset.countdownCompletedLoops !== '0'
        || dynamic.dataset.countdownLinkPending !== 'false'
        || countdownText(dynamic) !== '5秒') {
        throw new Error('dynamic countdown mixed its display snapshot with runtime state');
      }
    });
    await check('Invalid countdown stays unknown and stopped', async function () {
      var invalid = node('COUNT_INVALID');
      if (invalid.dataset.countdownRunning !== 'false'
        || invalid.dataset.countdownBlocked !== 'invalid' || countdownText(invalid) !== '?') {
        throw new Error('invalid countdown must remain unknown and stopped');
      }
    });
    await check('Image countdown initial glyph/runtime state', async function () {
      var image = node('COUNT_IMAGE');
      if (image.dataset.countdownCurrent !== '3' || image.dataset.countdownRunning !== 'true'
        || countdownGlyphs(image).map(function (glyph) { return glyph.dataset.character; }).join('') !== '3') {
        throw new Error('image countdown initial glyph/runtime state incorrect');
      }
    });

    var elapsedStart = Date.now();
    // The harness intentionally coalesces <=1s intervals into one 2.15s Chromium callback.
    // A renderer that decrements once per callback will be wrong; elapsed-time math catches up.
    await wait(2200);
    var elapsed = Date.now() - elapsedStart;
    document.body.dataset.p1CountdownElapsedMs = String(elapsed);

    await check('Text countdown uses elapsed time, loops, and exposes finish boundary', async function () {
      var text = node('COUNT_TEXT');
      if (text.dataset.countdownCurrent !== '0' || text.dataset.countdownRunning !== 'false'
        || text.dataset.countdownCompletedLoops !== '2' || countdownText(text) !== '0秒') {
        throw new Error('count=2 did not catch up and finish after >2 seconds: '
          + JSON.stringify(text.dataset));
      }
      if (text.dataset.countdownLinkPending !== 'true'
        || !countdownBoundary(text).includes('@textDone')
        || !/客户端|服务器/.test(countdownBoundary(text))) {
        throw new Error('finished link is not shown as a client/server runtime boundary');
      }
    });
    await check('Image countdown catches up with glyphBank', async function () {
      var image = node('COUNT_IMAGE');
      var glyphs = countdownGlyphs(image);
      if (image.dataset.countdownCurrent !== '1' || image.dataset.countdownRunning !== 'true'
        || glyphs.map(function (glyph) { return glyph.dataset.character; }).join('') !== '1'
        || !glyphs[0]?.src?.includes('glyph-1')) {
        throw new Error('image countdown did not catch up from 3 to 1 using glyphBank');
      }
    });

    await wait(2200);
    await check('Image countdown reaches zero and stops', async function () {
      var image = node('COUNT_IMAGE');
      var glyphs = countdownGlyphs(image);
      if (image.dataset.countdownCurrent !== '0' || image.dataset.countdownRunning !== 'false'
        || image.dataset.countdownCompletedLoops !== '1'
        || glyphs.map(function (glyph) { return glyph.dataset.character; }).join('') !== '0'
        || !glyphs[0]?.src?.includes('glyph-0')) {
        throw new Error('image countdown final zero/glyph/loop state incorrect');
      }
      if (image.dataset.countdownLinkPending !== 'true'
        || !countdownBoundary(image).includes('@imageDone')) {
        throw new Error('image countdown finish boundary missing');
      }
    });
    await check('Blocked countdowns remain stopped after elapsed time', async function () {
      var dynamic = node('COUNT_DYNAMIC');
      var invalid = node('COUNT_INVALID');
      if (countdownText(dynamic) !== '5秒' || dynamic.dataset.countdownRunning !== 'false'
        || dynamic.dataset.countdownCurrent !== '?'
        || dynamic.dataset.countdownCompletedLoops !== '0'
        || dynamic.dataset.countdownLinkPending !== 'false'
        || countdownText(invalid) !== '?' || invalid.dataset.countdownRunning !== 'false') {
        throw new Error('blocked countdown display/runtime state changed after elapsed time');
      }
    });

    await check('Control preview never executes server links', async function () {
      var posted = JSON.stringify(window.__postedMessages || []);
      for (var link of [
        '@toggleDone', '@dynamicToggle', '@mixedToggle', '@invalidToggle', '@missingToggle',
        '@sliderDone', '@invalidSlide', '@textDone', '@imageDone'
      ]) {
        if (posted.includes(link)) throw new Error('server link was posted from preview: ' + link);
      }
    });

    document.body.dataset.p1ControlsDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.p1ControlsTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.p1ControlsErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.p1ControlsTest = 'fail';
    document.body.dataset.p1ControlsErrors = error && error.stack ? error.stack : String(error);
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
        '--window-size=1200,800',
        '--virtual-time-budget=9000',
        '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8',
        timeout: 25000,
        maxBuffer: 12 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0 && /<body\b/i.test(result.stdout || '')) {
        selected = { candidate: candidates[index], result };
        break;
      }
    }

    assert.ok(selected, attempts.map(({ candidate, result }) => (
      browserDiagnostic(candidate, result)
    )).join('\n'));
    for (const { candidate, result } of attempts) {
      if (candidate === selected.candidate) break;
      console.log(`p1-controls-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-p1-controls-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`p1-controls-browser.test.js: browser=${selected.candidate}`);
    console.log(`p1-controls-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`p1-controls-browser.test.js: DOM=${domCount}`);
    const encodedError = /data-p1-controls-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    assert.match(
      selected.result.stdout,
      /data-p1-controls-test="pass"/,
      decodeAttribute(encodedError) || 'browser scenario did not finish'
    );
  } finally {
    removeTemporaryDirectory(temporary);
  }
  console.log('p1-controls-browser.test.js: PASS');
}

main();
