const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzNwAAAABJRU5ErkJggg==';

const SOURCE = [
  '[@main]',
  '#ACT',
  'MOV N$NORMAL 140',
  'MOV N$HOVER 141',
  'MOV N$SIZE 18',
  'MOV S$TEXT 动态文字',
  'MOV S$COLOR 250',
  'MOV S$WIL NewopUI',
  '#SAY',
  '<Button|id=BUTTON_STATIC|x=20|y=20|wil=NewopUI|pcnimg=140|pcmimg=141|pcpimg=142|text=静态按钮|size=14|link=@buttonStatic>',
  '<Button|id=BUTTON_MIXED|x=20|y=70|wil=NewopUI|pcnimg=140|pcmimg=<$STR(N$HOVER)>|pcpimg=-1|text=混合按钮|size=14|link=@buttonMixed>',
  '<Button|id=BUTTON_MISSING|x=20|y=120|wil=NewopUI|text=缺失按钮|size=14|link=@buttonMissing>',
  '<Button|id=BUTTON_DYNAMIC_NORMAL|x=20|y=170|wil=NewopUI|pcnimg=<$STR(N$NORMAL)>|pcmimg=141|pcpimg=142|text=动态主图|size=14|link=@buttonDynamicNormal>',
  '<Button|id=BUTTON_DYNAMIC_ARCHIVE|x=20|y=220|wil=<$STR(S$WIL)>|pcnimg=140|pcmimg=141|pcpimg=142|text=动态档案|size=14|link=@buttonDynamicArchive>',
  '<CheckBox|id=CHECK_STATIC|x=330|y=20|checkboxid=N0|wil=NewopUI|pcnimg=145|pcpimg=146|default=0|link=@checkStatic>',
  '<CheckBox|id=CHECK_MIXED|x=380|y=20|checkboxid=N1|wil=NewopUI|pcnimg=145|pcpimg=<$STR(N$HOVER)>|default=0|link=@checkMixed>',
  '<CheckBox|id=CHECK_INVALID|x=430|y=20|checkboxid=N2|wil=NewopUI|pcnimg=-1|pcpimg=1.5|default=0|link=@checkInvalid>',
  '<CheckBox|id=CHECK_MISSING|x=480|y=20|checkboxid=N3|wil=NewopUI|default=0|link=@checkMissing>',
  '<IMGEX:3:283:284:285:330:130/@imgexStatic>',
  '<IMGEX:3:283:<$STR(N$HOVER)>:-1:430:130/@imgexMixed>',
  '<IMGEX:3:283:::530:130/@imgexMissing>',
  '<IMGEX:3:<$STR(N$NORMAL)>:284:285:630:130/@imgexDynamicNormal>',
  '<Text|id=TEXT_VALID|x=330|y=260|text=合法文字|color=255|size=18|outline=2|outlinecolor=251>',
  '<Text|id=TEXT_BAD_NEGATIVE|x=330|y=310|text=负数字段|size=-1|outline=-2>',
  '<RText|id=RTEXT_DYNAMIC|x=330|y=360|text=<$STR(S$TEXT)>|color=<$STR(S$COLOR)>|size=<$STR(N$SIZE)>>',
  '<Button|id=BUTTON_BAD_STYLE|x=330|y=420|width=180|height=46|wil=NewopUI|pcnimg=140|pcmimg=141|pcpimg=142|text=非法按钮样式|size=0|outline=-1|grey=2|link=@badStyle>',
].join('\r\n');

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

function readyAsset(elementId, role, reference) {
  const archive = reference.archiveName || `WIL${reference.willIndex}`;
  const image = reference.imageIndex;
  return {
    status: 'ready',
    url: `${pixel}#${elementId}-${role}-${archive}-i${image}`,
    archiveLabel: `${archive}/${String(image).padStart(6, '0')}`,
    width: role === 'selected' ? 20 : 80,
    height: role === 'selected' ? 20 : 32,
    offsetX: 0,
    offsetY: 0,
  };
}

function hydrateStaticStateDiagnostics(element) {
  const diagnostics = Array.isArray(element.assetStateDiagnostics)
    ? element.assetStateDiagnostics : [];
  const staticRoles = new Set();
  for (const diagnostic of diagnostics) {
    if (diagnostic.status !== 'static' || !diagnostic.assetRef) continue;
    const asset = readyAsset(element.id, diagnostic.role, diagnostic.assetRef);
    diagnostic.asset = asset;
    staticRoles.add(diagnostic.role);
    if (diagnostic.role === 'normal') {
      element.asset = asset;
      continue;
    }
    element.assetLayers = Array.isArray(element.assetLayers) ? element.assetLayers : [];
    let layer = element.assetLayers.find(candidate => candidate.role === diagnostic.role);
    if (!layer) {
      layer = { role: diagnostic.role, assetRef: diagnostic.assetRef };
      element.assetLayers.push(layer);
    }
    layer.asset = asset;
  }

  // The browser fixture intentionally mirrors the provider's security gate:
  // a stale parser-era ref may exist, but a non-static diagnostic never gets pixels.
  if (!staticRoles.has('normal')) element.asset = undefined;
  for (const layer of element.assetLayers || []) {
    if (['hover', 'pressed', 'selected'].includes(layer.role)
      && !staticRoles.has(layer.role)) {
      layer.asset = undefined;
    }
  }
}

function fixtureModel() {
  const model = parseNpcDialogDocument(SOURCE, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/strict-control-states-browser.txt',
    fileName: 'strict-control-states-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\strict-control-states-browser.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: SOURCE.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
  const elements = model.pages[0].elements;
  for (const element of elements) {
    if (element.containerElementId) element.id = element.containerElementId;
    const imgExId = [
      ['/@imgexStatic>', 'IMGEX_STATIC'],
      ['/@imgexMixed>', 'IMGEX_MIXED'],
      ['/@imgexMissing>', 'IMGEX_MISSING'],
      ['/@imgexDynamicNormal>', 'IMGEX_DYNAMIC_NORMAL'],
    ].find(([marker]) => element.raw.includes(marker))?.[1];
    if (imgExId) element.id = imgExId;
    hydrateStaticStateDiagnostics(element);
  }
  const scene = model.scenes.find(candidate => !candidate.conditionGroupId) || model.scenes[0];
  scene.elements = elements;
  model.pages[0].elements = elements;
  model.canvasWidth = 1000;
  model.canvasHeight = 720;
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
    console.log('strict-control-states-browser.test.js: SKIP (Edge/Chrome not found)');
    return;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-strict-control-states-browser-'));
  try {
    const harness = path.join(temporary, 'strict-control-states.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.__postedMessages = [];
window.__navigationAttempts = [];
window.__initialLocation = window.location.href;
window.open = function () {
  window.__navigationAttempts.push('window.open:' + Array.prototype.join.call(arguments, ','));
  return null;
};
(function () {
  var nativePushState = window.history.pushState.bind(window.history);
  var nativeReplaceState = window.history.replaceState.bind(window.history);
  window.history.pushState = function () {
    window.__navigationAttempts.push('pushState:' + Array.prototype.join.call(arguments, ','));
    return nativePushState.apply(window.history, arguments);
  };
  window.history.replaceState = function () {
    window.__navigationAttempts.push('replaceState:' + Array.prototype.join.call(arguments, ','));
    return nativeReplaceState.apply(window.history, arguments);
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
    html = html.replace(
      `<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`,
      `${mock}<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`
    );

    const scenario = `<script>
(function () {
  var failures = [];
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function mouse(target, type, button, buttons) {
    var rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: type !== 'mouseenter' && type !== 'mouseleave',
      cancelable: true,
      button: button === undefined ? 0 : button,
      buttons: buttons === undefined ? 0 : buttons,
      clientX: rect.left + Math.max(1, rect.width / 2),
      clientY: rect.top + Math.max(1, rect.height / 2),
    }));
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  function stateStatus(wrapper, role) {
    return wrapper && wrapper.getAttribute('data-asset-state-' + role);
  }
  function visible(nodeValue) {
    if (!nodeValue) return false;
    var style = getComputedStyle(nodeValue);
    var rects = nodeValue.getClientRects();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && style.visibility !== 'collapse'
      && Number(style.opacity || 1) > 0
      && rects.length > 0
      && rects[0].width > 0
      && rects[0].height > 0;
  }
  function visibleInteractiveSrc(wrapper) {
    var image = wrapper && wrapper.querySelector('.interactive-asset-image');
    return image && !image.hidden && getComputedStyle(image).display !== 'none' ? image.src : '';
  }
  function visibleToggleSrc(wrapper) {
    var image = wrapper && wrapper.querySelector('.toggle-asset-image');
    return image && !image.hidden && getComputedStyle(image).display !== 'none' ? image.src : '';
  }
  function assertSuffix(actual, expected, label) {
    if (!String(actual || '').includes(expected)) {
      throw new Error(label + ' expected source containing ' + expected + ', got ' + actual);
    }
  }
  function assertNoStateImage(wrapper, label) {
    var sources = Array.from(wrapper.querySelectorAll(
      '.interactive-asset-image, .toggle-asset-image'
    )).filter(function (image) {
      return !image.hidden && getComputedStyle(image).display !== 'none';
    }).map(function (image) { return image.src; });
    if (sources.length) throw new Error(label + ' drew a non-static state: ' + sources.join(','));
  }
  function fields(value) {
    return String(value || '').split(',').filter(Boolean).sort();
  }
  function assertTextBoundary(wrapper, state, dynamicFields, invalidFields) {
    if (!wrapper) throw new Error('strict text wrapper missing');
    if (wrapper.dataset.textFieldState !== state) {
      throw new Error('text field state expected ' + state + ', got '
        + wrapper.dataset.textFieldState);
    }
    if (fields(wrapper.dataset.textDynamicFields).join(',') !== dynamicFields.slice().sort().join(',')) {
      throw new Error('dynamic text fields mismatch: ' + wrapper.dataset.textDynamicFields);
    }
    if (fields(wrapper.dataset.textInvalidFields).join(',') !== invalidFields.slice().sort().join(',')) {
      throw new Error('invalid text fields mismatch: ' + wrapper.dataset.textInvalidFields);
    }
    var boundary = wrapper.querySelector('.text-field-boundary');
    if (!boundary || !visible(boundary)) throw new Error('text field boundary is not visibly drawn');
    var text = boundary.textContent || '';
    if (dynamicFields.length && (!text.includes('动态')
      || !/不借用.*(?:MOV|当前值)|(?:MOV|当前值).*不借用/.test(text))) {
      throw new Error('dynamic source-safety boundary missing: ' + text);
    }
    if (invalidFields.length && (!text.includes('无效')
      || !/不钳制|不转换|不生成.*伪造/.test(text))) {
      throw new Error('invalid no-coercion boundary missing: ' + text);
    }
  }
  function assertStateContract(id, expected) {
    var wrapper = node(id);
    if (!wrapper) throw new Error(id + ' missing');
    var roles = Object.keys(expected);
    for (var role of roles) {
      var actual = stateStatus(wrapper, role);
      if (actual !== expected[role]) {
        throw new Error(id + '/' + role + ' expected ' + expected[role] + ', got ' + actual);
      }
    }
    var boundary = wrapper.querySelector('.asset-state-boundary');
    if (!boundary) throw new Error(id + ' asset-state-boundary missing');
    if (!visible(boundary)) throw new Error(id + ' asset-state-boundary is not visibly drawn');
    var diagnostics = Array.from(boundary.querySelectorAll('.asset-state-diagnostic'));
    var seenRoles = diagnostics.map(function (item) { return item.dataset.assetStateRole; });
    if (seenRoles.join(',') !== roles.join(',')) {
      throw new Error(id + ' diagnostic roles expected ' + roles.join(',')
        + ', got ' + seenRoles.join(','));
    }
    for (var role of roles) {
      var item = diagnostics.find(function (candidate) {
        return candidate.dataset.assetStateRole === role;
      });
      if (!item || item.dataset.assetStateStatus !== expected[role]) {
        throw new Error(id + '/' + role + ' diagnostic metadata missing');
      }
      if (!visible(item)) throw new Error(id + '/' + role + ' diagnostic is not visible');
      var text = item.textContent || '';
      if (expected[role] === 'dynamic'
        && (!text.includes('动态') || !/不借用.*(?:MOV|当前值)|(?:MOV|当前值).*不借用/.test(text))) {
        throw new Error(id + '/' + role + ' does not show dynamic/MOV source-safety: ' + text);
      }
      if (expected[role] === 'invalid'
        && (!text.includes('无效') || !/不推测|不猜测|拒绝/.test(text))) {
        throw new Error(id + '/' + role + ' does not show invalid/no-guess boundary: ' + text);
      }
      if (expected[role] === 'missing'
        && (!text.includes('缺失') || !/不.*默认|不补图|未.*默认/.test(text))) {
        throw new Error(id + '/' + role + ' does not show missing/no-default boundary: ' + text);
      }
    }
  }
  async function interactiveState(id, expectedRole, expectedSuffix) {
    var wrapper = node(id);
    if (!wrapper) throw new Error(id + ' missing after interaction');
    if (wrapper.dataset.interactiveState !== expectedRole) {
      throw new Error(id + ' expected interactive state ' + expectedRole
        + ', got ' + wrapper.dataset.interactiveState);
    }
    assertSuffix(visibleInteractiveSrc(wrapper), expectedSuffix, id + '/' + expectedRole);
  }
  async function exerciseThreeStaticStates(id, normal, hover, pressed) {
    await interactiveState(id, 'normal', normal);
    mouse(node(id), 'mouseenter', 0, 0);
    await wait(15);
    await interactiveState(id, 'hover', hover);
    // Middle-button mousedown exercises the renderer's pressed-state path without
    // starting the canvas editor's independent left-button drag/select gesture.
    mouse(node(id), 'mousedown', 1, 4);
    await wait(15);
    await interactiveState(id, 'pressed', pressed);
    mouse(node(id), 'mouseup', 1, 0);
    await wait(15);
    await interactiveState(id, 'hover', hover);
    mouse(node(id), 'mouseleave', 0, 0);
    await wait(15);
    await interactiveState(id, 'normal', normal);
  }
  async function clickCheckbox(id) {
    var wrapper = node(id);
    var target = wrapper && wrapper.querySelector('[role="checkbox"]');
    if (!target) throw new Error(id + ' role=checkbox missing');
    mouse(target, 'click', 0, 0);
    await wait(20);
    return node(id);
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('BUTTON_STATIC'); attempt++) await wait(20);
    if (!node('BUTTON_STATIC')) throw new Error('fixture model did not render');
    window.__postedMessages.length = 0;

    await check('diagnostic overlays are opt-in on the client-like canvas', async function () {
      var toggle = document.getElementById('canvasDiagnosticsToggle');
      var boundaries = Array.from(document.querySelectorAll(
        '#dialogCanvas .asset-state-boundary, #dialogCanvas .text-field-boundary'
      ));
      if (!toggle || !boundaries.length) throw new Error('diagnostics toggle fixture is incomplete');
      if (toggle.getAttribute('aria-pressed') !== 'false' || boundaries.some(visible)) {
        throw new Error('diagnostic overlays are visible before explicit opt-in');
      }
      toggle.click();
      await wait(20);
      if (toggle.getAttribute('aria-pressed') !== 'true' || boundaries.some(function (boundary) {
        return !visible(boundary);
      })) {
        throw new Error('explicit diagnostics mode did not reveal every typed boundary');
      }
    });

    await check('DOM exposes complete per-role state contracts and visible boundaries', async function () {
      assertStateContract('BUTTON_STATIC', { normal: 'static', hover: 'static', pressed: 'static' });
      assertStateContract('BUTTON_MIXED', { normal: 'static', hover: 'dynamic', pressed: 'invalid' });
      assertStateContract('BUTTON_MISSING', { normal: 'missing', hover: 'missing', pressed: 'missing' });
      assertStateContract('BUTTON_DYNAMIC_NORMAL', { normal: 'dynamic', hover: 'static', pressed: 'static' });
      assertStateContract('BUTTON_DYNAMIC_ARCHIVE', { normal: 'dynamic', hover: 'dynamic', pressed: 'dynamic' });
      assertStateContract('IMGEX_STATIC', { normal: 'static', hover: 'static', pressed: 'static' });
      assertStateContract('IMGEX_MIXED', { normal: 'static', hover: 'dynamic', pressed: 'invalid' });
      assertStateContract('IMGEX_MISSING', { normal: 'static', hover: 'missing', pressed: 'missing' });
      assertStateContract('IMGEX_DYNAMIC_NORMAL', { normal: 'dynamic', hover: 'static', pressed: 'static' });
      assertStateContract('CHECK_STATIC', { normal: 'static', selected: 'static' });
      assertStateContract('CHECK_MIXED', { normal: 'static', selected: 'dynamic' });
      assertStateContract('CHECK_INVALID', { normal: 'invalid', selected: 'invalid' });
      assertStateContract('CHECK_MISSING', { normal: 'missing', selected: 'missing' });
    });

    await check('strict Text RText and Button fields draw proven values without coercing invalid styles', async function () {
      var valid = node('TEXT_VALID');
      var validLabel = valid && valid.querySelector('.styled-text-preview');
      if (!validLabel || validLabel.style.fontSize !== '18px'
        || validLabel.style.webkitTextStrokeWidth !== '2px') {
        throw new Error('valid text style endpoints were not drawn');
      }

      var negative = node('TEXT_BAD_NEGATIVE');
      var negativeLabel = negative && negative.querySelector('.styled-text-preview');
      assertTextBoundary(negative, 'invalid', [], ['font-size', 'outline-width']);
      if (!negativeLabel || negativeLabel.style.fontSize
        || negativeLabel.style.webkitTextStrokeWidth) {
        throw new Error('negative text fields generated a plausible CSS style');
      }

      var rich = node('RTEXT_DYNAMIC');
      var richLabel = rich && rich.querySelector('.styled-text-preview');
      var richRun = richLabel && richLabel.querySelector('.styled-text-line > span');
      var richColor = String(
        (richRun && (richRun.style.color || getComputedStyle(richRun).color)) || ''
      ).replaceAll(' ', '').toLowerCase();
      if (!richLabel || richLabel.textContent.trim() !== '动态文字'
        || richLabel.style.fontSize !== '18px'
        || !['rgb(0,255,0)', '#00ff00'].includes(richColor)) {
        throw new Error('RText did not draw its statically proven text/color/size values: '
          + JSON.stringify({
            text: richLabel && richLabel.textContent.trim(),
            fontSize: richLabel && richLabel.style.fontSize,
            labelColor: richLabel && (richLabel.style.color || getComputedStyle(richLabel).color),
            runColor: richRun && (richRun.style.color || getComputedStyle(richRun).color),
            html: richLabel && richLabel.outerHTML,
          }));
      }
      if (rich.dataset.textFieldState || rich.querySelector('.text-field-boundary')) {
        throw new Error('resolved RText values remain mislabeled as dynamic/invalid');
      }

      var badButton = node('BUTTON_BAD_STYLE');
      var caption = badButton && badButton.querySelector('.button-caption');
      assertTextBoundary(badButton, 'invalid', [], ['font-size', 'gray', 'outline-width']);
      if (!caption || caption.style.fontSize || caption.style.webkitTextStrokeWidth
        || badButton.classList.contains('gray')) {
        throw new Error('Button coerced an invalid style field');
      }
    });

    await check('static Button and IMGEX pixels switch normal hover pressed states', async function () {
      await exerciseThreeStaticStates(
        'BUTTON_STATIC',
        'BUTTON_STATIC-normal-NewopUI-i140',
        'BUTTON_STATIC-hover-NewopUI-i141',
        'BUTTON_STATIC-pressed-NewopUI-i142'
      );
      await exerciseThreeStaticStates(
        'IMGEX_STATIC',
        'IMGEX_STATIC-normal-WIL3-i283',
        'IMGEX_STATIC-hover-WIL3-i284',
        'IMGEX_STATIC-pressed-WIL3-i285'
      );
    });

    await check('mixed Button and IMGEX never borrow dynamic or invalid state pixels', async function () {
      for (var id of ['BUTTON_MIXED', 'IMGEX_MIXED']) {
        var normal = visibleInteractiveSrc(node(id));
        if (!normal) throw new Error(id + ' static normal image missing');
        mouse(node(id), 'mouseenter', 0, 0);
        await wait(15);
        var wrapper = node(id);
        if (visibleInteractiveSrc(wrapper) !== normal || wrapper.dataset.interactiveState !== 'normal') {
          throw new Error(id + ' dynamic hover borrowed MOV or changed the drawn role');
        }
        mouse(node(id), 'mousedown', 1, 4);
        await wait(15);
        wrapper = node(id);
        if (visibleInteractiveSrc(wrapper) !== normal || wrapper.dataset.interactiveState !== 'normal') {
          throw new Error(id + ' invalid pressed state was guessed or drawn');
        }
        mouse(node(id), 'mouseleave', 0, 0);
        await wait(15);
      }
    });

    await check('missing IMGEX states stay on the proven static normal pixels', async function () {
      var normal = visibleInteractiveSrc(node('IMGEX_MISSING'));
      assertSuffix(normal, 'IMGEX_MISSING-normal-WIL3-i283', 'IMGEX_MISSING/normal');
      mouse(node('IMGEX_MISSING'), 'mouseenter', 0, 0);
      await wait(15);
      if (visibleInteractiveSrc(node('IMGEX_MISSING')) !== normal) {
        throw new Error('missing hover was replaced with a default image');
      }
      mouse(node('IMGEX_MISSING'), 'mousedown', 1, 4);
      await wait(15);
      if (visibleInteractiveSrc(node('IMGEX_MISSING')) !== normal) {
        throw new Error('missing pressed was replaced with a default image');
      }
    });

    await check('dynamic normal states start blank but retain proven static hover pressed states', async function () {
      for (var fixture of [
        ['BUTTON_DYNAMIC_NORMAL', 'NewopUI-i141', 'NewopUI-i142'],
        ['IMGEX_DYNAMIC_NORMAL', 'WIL3-i284', 'WIL3-i285'],
      ]) {
        var id = fixture[0];
        assertNoStateImage(node(id), id + '/dynamic-normal');
        mouse(node(id), 'mouseenter', 0, 0);
        await wait(15);
        await interactiveState(id, 'hover', id + '-hover-' + fixture[1]);
        mouse(node(id), 'mousedown', 1, 4);
        await wait(15);
        await interactiveState(id, 'pressed', id + '-pressed-' + fixture[2]);
        mouse(node(id), 'mouseleave', 0, 0);
        await wait(15);
        assertNoStateImage(node(id), id + '/dynamic-normal-restored');
      }
      assertNoStateImage(node('BUTTON_DYNAMIC_ARCHIVE'), 'BUTTON_DYNAMIC_ARCHIVE/all-dynamic');
    });

    await check('static CheckBox selected state switches after a live DOM re-query', async function () {
      var wrapper = node('CHECK_STATIC');
      assertSuffix(visibleToggleSrc(wrapper), 'CHECK_STATIC-normal-NewopUI-i145', 'CHECK_STATIC/normal');
      wrapper = await clickCheckbox('CHECK_STATIC');
      var checkbox = wrapper.querySelector('[role="checkbox"]');
      if (checkbox.getAttribute('aria-checked') !== 'true') throw new Error('CHECK_STATIC did not select');
      assertSuffix(visibleToggleSrc(wrapper), 'CHECK_STATIC-selected-NewopUI-i146', 'CHECK_STATIC/selected');
      wrapper = await clickCheckbox('CHECK_STATIC');
      if (wrapper.querySelector('[role="checkbox"]').getAttribute('aria-checked') !== 'false') {
        throw new Error('CHECK_STATIC did not return to normal');
      }
      assertSuffix(visibleToggleSrc(wrapper), 'CHECK_STATIC-normal-NewopUI-i145', 'CHECK_STATIC/normal-restored');
    });

    await check('dynamic invalid and missing CheckBox pixels are never guessed', async function () {
      var mixed = node('CHECK_MIXED');
      assertSuffix(visibleToggleSrc(mixed), 'CHECK_MIXED-normal-NewopUI-i145', 'CHECK_MIXED/normal');
      mixed = await clickCheckbox('CHECK_MIXED');
      if (mixed.querySelector('[role="checkbox"]').getAttribute('aria-checked') !== 'true') {
        throw new Error('CHECK_MIXED local value did not toggle');
      }
      assertNoStateImage(mixed, 'CHECK_MIXED/dynamic-selected');
      for (var id of ['CHECK_INVALID', 'CHECK_MISSING']) {
        assertNoStateImage(node(id), id + '/normal');
        var wrapper = await clickCheckbox(id);
        assertNoStateImage(wrapper, id + '/selected');
      }
    });

    await check('missing states never receive imageIndex=0 default pixels', async function () {
      var sources = Array.from(document.querySelectorAll(
        '[data-element-id] .interactive-asset-image, [data-element-id] .toggle-asset-image'
      )).map(function (image) { return image.src; });
      var defaultSources = sources.filter(function (source) {
        return /(?:^|[-_])i0(?:$|[-_])|000000/.test(source);
      });
      if (defaultSources.length) {
        throw new Error('imageIndex=0/default state pixels were drawn: ' + defaultSources.join(','));
      }
    });

    await check('local state interactions do not post server actions or navigate', async function () {
      for (var id of ['BUTTON_STATIC', 'IMGEX_STATIC']) {
        var hit = node(id).querySelector('.runtime-action-hitarea');
        if (!hit) throw new Error(id + ' local runtime hit area missing');
        mouse(hit, 'click', 0, 0);
        await wait(20);
        var wrapper = node(id);
        var summary = wrapper.querySelector('.runtime-action-summary');
        if (!summary || summary.hidden || !/仅本地|不会执行|不执行/.test(summary.textContent || '')) {
          throw new Error(id + ' did not expose a local-only action summary');
        }
      }
      if ((window.__postedMessages || []).length !== 0) {
        throw new Error('state interaction posted to the host: '
          + JSON.stringify(window.__postedMessages));
      }
      if ((window.__navigationAttempts || []).length !== 0) {
        throw new Error('state interaction attempted navigation: '
          + JSON.stringify(window.__navigationAttempts));
      }
      if (window.location.href !== window.__initialLocation) {
        throw new Error('state interaction changed location to ' + window.location.href);
      }
      for (var link of ['@buttonStatic', '@imgexStatic', '@checkStatic', '@checkMixed']) {
        if (JSON.stringify(window.__postedMessages).includes(link)) {
          throw new Error('server link escaped local preview: ' + link);
        }
      }
    });

    document.body.dataset.strictControlStatesDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.strictControlStatesTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.strictControlStatesErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.strictControlStatesTest = 'fail';
    document.body.dataset.strictControlStatesErrors = error && error.stack ? error.stack : String(error);
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
        '--window-size=1280,900',
        '--virtual-time-budget=4500',
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
        && /data-strict-control-states-test=/i.test(result.stdout || '')) {
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
        `strict-control-states-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`
      );
    }
    const domCount = /data-strict-control-states-dom-count="([0-9]+)"/.exec(
      selected.result.stdout
    )?.[1] || '<missing>';
    console.log(`strict-control-states-browser.test.js: browser=${selected.candidate}`);
    console.log(
      `strict-control-states-browser.test.js: ProductVersion=${browserVersion(selected.candidate)}`
    );
    console.log(`strict-control-states-browser.test.js: DOM=${domCount}`);
    const encoded = /data-strict-control-states-errors="([^"]*)"/.exec(
      selected.result.stdout
    )?.[1];
    assert.match(
      selected.result.stdout,
      /data-strict-control-states-test="pass"/,
      decodeAttribute(encoded) || 'browser scenario did not finish'
    );
  } finally {
    if (process.env.BOO_KEEP_STRICT_CONTROL_STATES_BROWSER_TEMP === '1') {
      console.log(`strict-control-states-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
  console.log('strict-control-states-browser.test.js: PASS');
}

main();
