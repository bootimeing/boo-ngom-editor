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

// This is the visible-runtime companion to listview-strict-runtime.test.js.
// Help evidence is recorded there. The fixture deliberately injects the
// target typed contract after parsing so this browser gate independently
// tests renderer/CSS behavior instead of failing only because Parser fields
// have not yet been implemented.

const root = path.resolve(__dirname, '..');
const ALL_SCROLL_ROLES = [
  'scrollbar',
  'scroll-start',
  'scroll-start-hover',
  'scroll-start-pressed',
  'scroll-thumb',
  'scroll-thumb-hover',
  'scroll-thumb-pressed',
  'scroll-end',
  'scroll-end-hover',
  'scroll-end-pressed',
];
const SCROLL_FIELDS = {
  scrollbar: 'Sdbg',
  'scroll-start': 'Sdupnimg',
  'scroll-start-hover': 'Sdupmimg',
  'scroll-start-pressed': 'Sduppimg',
  'scroll-thumb': 'Sdnimg',
  'scroll-thumb-hover': 'Sdmimg',
  'scroll-thumb-pressed': 'Sdpimg',
  'scroll-end': 'Sddwnimg',
  'scroll-end-hover': 'Sddwmimg',
  'scroll-end-pressed': 'Sddwpimg',
};

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
    + `error=${result.error?.message || '<none>'}, `
    + `body=${/<body\b/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function parse(engine, sayLines, actLines = []) {
  const source = [
    '[@main]',
    ...(actLines.length ? ['#ACT', ...actLines] : []),
    '#SAY',
    ...sayLines,
    '',
  ].join('\n');
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/listview-browser-${engine}.txt`,
    fileName: `listview-browser-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\listview-browser-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function svgData(width, height, label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="${color}"/>`
    + `<text x="1" y="10" font-size="7" fill="#fff">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

function readyAsset(role, index) {
  return {
    status: 'ready',
    url: svgData(12, 12, `${role}-${index}`, '#315f81'),
    archiveLabel: `GameUIPack/${index}`,
    width: 12,
    height: 12,
    offsetX: 0,
    offsetY: 0,
  };
}

function fixtureElements(model, containerId, fixtureId, x, y) {
  const sourceElements = model.pages[0].elements;
  const sourceList = sourceElements.find(element => (
    element.containerPreview?.variant === 'list'
    && element.containerElementId === containerId
  ));
  if (!sourceList) throw new Error(`missing source ListView ${containerId}`);
  const selected = [
    sourceList,
    ...sourceElements.filter(element => element.parentElementId === sourceList.id),
  ];
  const clones = selected.map(element => JSON.parse(JSON.stringify(element)));
  const idMap = new Map();
  const containerMap = new Map();
  clones.forEach((element, index) => {
    idMap.set(element.id, index === 0 ? fixtureId : `${fixtureId}_CHILD_${index}`);
    if (element.containerElementId) {
      containerMap.set(element.containerElementId, `${fixtureId}_${element.containerElementId}`);
    }
  });
  const deltaX = x - Number(clones[0].layoutX || 0);
  const deltaY = y - Number(clones[0].layoutY || 0);
  for (const element of clones) {
    element.id = idMap.get(element.id);
    if (element.parentElementId) element.parentElementId = idMap.get(element.parentElementId);
    if (element.containerElementId) {
      element.containerElementId = containerMap.get(element.containerElementId);
    }
    if (element.containerParentId) {
      element.containerParentId = containerMap.get(element.containerParentId)
        || element.containerParentId;
    }
    if (element.containerChildIds) {
      element.containerChildIds = element.containerChildIds.map(value => containerMap.get(value) || value);
    }
    element.layoutX = Number(element.layoutX || 0) + deltaX;
    element.layoutY = Number(element.layoutY || 0) + deltaY;
    element.editable = false;
  }
  return clones;
}

function listFrom(elements) {
  return elements.find(element => element.containerPreview?.variant === 'list');
}

function setVerticalOverflow(elements) {
  const listElement = listFrom(elements);
  const children = elements.filter(element => element.parentElementId === listElement.id);
  children.forEach((child, index) => {
    child.localLayoutX = 0;
    child.localLayoutY = index * 48;
    child.layoutX = listElement.layoutX;
    child.layoutY = listElement.layoutY + index * 48;
  });
  listElement.containerPreview.contentWidth = 40;
  listElement.containerPreview.contentHeight = Math.max(180, children.length * 48);
  listElement.containerPreview.scrollOffset = 0;
  listElement.containerPreview.defaultIndex = 0;
}

function diagnostic(field, sourceStatus, rawSource) {
  return {
    field,
    sourceStatus,
    status: sourceStatus,
    ...(rawSource ? { rawSource } : {}),
  };
}

function typedScrollbarDiagnostics(sourceStatus, layers = []) {
  const byRole = new Map(layers.map(layer => [layer.role, layer]));
  return ALL_SCROLL_ROLES.map(role => {
    const layer = byRole.get(role);
    return {
      field: SCROLL_FIELDS[role],
      role,
      sourceStatus,
      status: sourceStatus,
      ...(sourceStatus === 'static' && layer?.assetRef
        ? { assetRef: { ...layer.assetRef }, asset: layer.asset }
        : {}),
    };
  });
}

function buildBrowserModel() {
  const pc = parse('996PC', [
    '<ListView|id=VALID|children={V1,V2,V3,V4}|x=0|y=0|width=70|height=40|direction=2|margin=10|default=2|cantouch=1|Slider=1|Sdbg=300|Sdupnimg=301|Sdupmimg=302|Sduppimg=303|Sdnimg=304|Sdmimg=305|Sdpimg=306|Sddwnimg=307|Sddwmimg=308|Sddwpimg=309>',
    '<Layout|id=V1|width=40|height=30>',
    '<Layout|id=V2|width=40|height=30>',
    '<Layout|id=V3|width=40|height=30>',
    '<Layout|id=V4|width=40|height=30>',
    '<ListView|id=DYNAMIC|children={D1,D2,D3,D4}|x=0|y=100|width=100|height=40|direction=<$STR(N$DIR)>|margin=<$STR(N$MARGIN)>|default=<$STR(N$DEFAULT)>|cantouch=<$STR(N$TOUCH)>|Slider=<$STR(N$SLIDER)>|Sdbg=<$STR(N$SBG)>>',
    '<Layout|id=D1|width=40|height=40>',
    '<Layout|id=D2|width=40|height=40>',
    '<Layout|id=D3|width=40|height=40>',
    '<Layout|id=D4|width=40|height=40>',
    '<ListView|id=INVALID|children={I1,I2,I3,I4}|x=0|y=200|width=100|height=40|direction=1.5|margin=bad|default=-1|cantouch=2|Slider=1.5|Sdbg=-1>',
    '<Layout|id=I1|width=40|height=40>',
    '<Layout|id=I2|width=40|height=40>',
    '<Layout|id=I3|width=40|height=40>',
    '<Layout|id=I4|width=40|height=40>',
    '<ListView|id=DISABLED|children={X1,X2,X3,X4}|x=0|y=300|width=100|height=40|direction=1|margin=8|default=1|cantouch=0|Slider=0>',
    '<Layout|id=X1|width=40|height=40>',
    '<Layout|id=X2|width=40|height=40>',
    '<Layout|id=X3|width=40|height=40>',
    '<Layout|id=X4|width=40|height=40>',
  ], [
    'MOV N$DIR 1', 'MOV N$MARGIN 9', 'MOV N$DEFAULT 3',
    'MOV N$TOUCH 1', 'MOV N$SLIDER 1', 'MOV N$SBG 991',
  ]);
  const gom = parse('GOM', [
    '<ListView:~#GOM_REMEMBER:0:0:180:50:0:0:0:1:0:0>',
  ]);
  const gee = parse('GEE', [
    '<ListView:~#GEE_RESERVED:0:0:180:50:0:0:0:1:7:8>',
  ]);

  const validElements = fixtureElements(pc, 'VALID', 'LIST_VALID_LOCAL', 20, 20);
  const dynamicElements = fixtureElements(pc, 'DYNAMIC', 'LIST_DYNAMIC_BLOCKED', 260, 20);
  const invalidElements = fixtureElements(pc, 'INVALID', 'LIST_INVALID_BLOCKED', 500, 20);
  const disabledElements = fixtureElements(pc, 'DISABLED', 'LIST_TOUCH_DISABLED', 740, 20);
  const gomElements = fixtureElements(gom, 'GOM_REMEMBER', 'LIST_GOM_REMEMBER', 20, 280);
  const geeElements = fixtureElements(gee, 'GEE_RESERVED', 'LIST_GEE_RESERVED', 260, 280);

  const valid = listFrom(validElements);
  valid.containerPreview.requestedDefaultIndex = 2;
  valid.containerPreview.effectiveDefaultIndex = 1;
  valid.containerPreview.defaultIndex = 1;
  valid.containerPreview.localOnly = true;
  valid.containerPreview.interactionStatus = 'local-only';
  valid.containerPreview.fieldDiagnostics = [
    diagnostic('direction', 'static'), diagnostic('margin', 'static'),
    diagnostic('default', 'static'), diagnostic('cantouch', 'static'),
    diagnostic('slider', 'static'),
  ];
  valid.containerPreview.defaultFields = [];
  valid.containerPreview.dynamicFields = [];
  valid.containerPreview.invalidFields = [];
  for (const layer of valid.assetLayers || []) {
    layer.asset = readyAsset(layer.role, layer.assetRef.imageIndex);
  }
  valid.containerPreview.scrollbarDiagnostics = typedScrollbarDiagnostics(
    'static', valid.assetLayers || []
  );

  const dynamic = listFrom(dynamicElements);
  delete dynamic.containerPreview.direction;
  dynamic.containerPreview.gap = 0;
  delete dynamic.containerPreview.requestedDefaultIndex;
  dynamic.containerPreview.effectiveDefaultIndex = 0;
  dynamic.containerPreview.defaultIndex = 0;
  delete dynamic.containerPreview.touchEnabled;
  delete dynamic.containerPreview.bounce;
  dynamic.containerPreview.localOnly = true;
  dynamic.containerPreview.interactionStatus = 'blocked-dynamic';
  dynamic.containerPreview.dynamicFields = [
    'direction', 'margin', 'default', 'cantouch', 'slider',
  ];
  dynamic.containerPreview.invalidFields = [];
  dynamic.containerPreview.fieldDiagnostics = dynamic.containerPreview.dynamicFields
    .map(field => diagnostic(field, 'dynamic', `<$STR(N$${field.toUpperCase()})>`));
  dynamic.containerPreview.scrollbarMode = 'blocked';
  dynamic.containerPreview.scrollbarDiagnostics = typedScrollbarDiagnostics('dynamic');
  delete dynamic.assetLayers;
  setVerticalOverflow(dynamicElements);

  const invalid = listFrom(invalidElements);
  delete invalid.containerPreview.direction;
  invalid.containerPreview.gap = 0;
  delete invalid.containerPreview.requestedDefaultIndex;
  invalid.containerPreview.effectiveDefaultIndex = 0;
  invalid.containerPreview.defaultIndex = 0;
  delete invalid.containerPreview.touchEnabled;
  invalid.containerPreview.localOnly = true;
  invalid.containerPreview.interactionStatus = 'blocked-invalid';
  invalid.containerPreview.dynamicFields = [];
  invalid.containerPreview.invalidFields = [
    'direction', 'margin', 'default', 'cantouch', 'slider',
  ];
  invalid.containerPreview.fieldDiagnostics = invalid.containerPreview.invalidFields
    .map(field => diagnostic(field, 'invalid'));
  invalid.containerPreview.scrollbarMode = 'blocked';
  invalid.containerPreview.scrollbarDiagnostics = typedScrollbarDiagnostics('invalid');
  delete invalid.assetLayers;
  setVerticalOverflow(invalidElements);

  const disabled = listFrom(disabledElements);
  disabled.containerPreview.requestedDefaultIndex = 1;
  disabled.containerPreview.effectiveDefaultIndex = 0;
  disabled.containerPreview.defaultIndex = 0;
  disabled.containerPreview.localOnly = true;
  disabled.containerPreview.interactionStatus = 'disabled';
  disabled.containerPreview.touchEnabled = false;
  disabled.containerPreview.scrollbarMode = 'disabled';
  disabled.containerPreview.fieldDiagnostics = [
    diagnostic('cantouch', 'static'), diagnostic('slider', 'static'),
  ];
  disabled.containerPreview.scrollbarDiagnostics = typedScrollbarDiagnostics('disabled');
  delete disabled.assetLayers;
  setVerticalOverflow(disabledElements);

  const gomList = listFrom(gomElements);
  gomList.containerPreview.requestedDefaultIndex = 0;
  gomList.containerPreview.effectiveDefaultIndex = 0;
  gomList.containerPreview.rememberScrollPosition = true;
  gomList.containerPreview.localOnly = true;
  gomList.containerPreview.interactionStatus = 'local-only';
  gomList.containerPreview.fieldDiagnostics = [
    diagnostic('remember-scroll-position', 'static'),
    diagnostic('reserved-4', 'reserved'),
    diagnostic('reserved-5', 'reserved'),
  ];
  gomList.containerPreview.reservedFields = ['reserved-4', 'reserved-5'];
  delete gomList.assetLayers;

  const geeList = listFrom(geeElements);
  geeList.containerPreview.requestedDefaultIndex = 0;
  geeList.containerPreview.effectiveDefaultIndex = 0;
  delete geeList.containerPreview.rememberScrollPosition;
  geeList.containerPreview.localOnly = true;
  geeList.containerPreview.interactionStatus = 'local-only';
  geeList.containerPreview.fieldDiagnostics = [
    diagnostic('reserved-3', 'reserved'),
    diagnostic('reserved-4', 'reserved'),
    diagnostic('reserved-5', 'reserved'),
  ];
  geeList.containerPreview.reservedFields = ['reserved-3', 'reserved-4', 'reserved-5'];
  delete geeList.assetLayers;

  const elements = [
    ...validElements, ...dynamicElements, ...invalidElements, ...disabledElements,
    ...gomElements, ...geeElements,
  ];
  const base = pc;
  base.scenes = [{ ...base.scenes[0], id: 'LISTVIEW_STRICT_BROWSER_SCENE', elements }];
  base.pages = [{ ...base.pages[0], id: 'LISTVIEW_STRICT_BROWSER_PAGE', elements }];
  base.canvasWidth = 1040;
  base.canvasHeight = 430;
  return base;
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function decodeAttribute(value) {
  return String(value || '')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function main() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    console.log('listview-strict-runtime-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-listview-strict-browser-'));
  try {
    const harness = path.join(temporary, 'listview-strict-runtime.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(buildBrowserModel())};
window.__postedMessages = [];
window.__openedLinks = [];
window.__historyCalls = [];
window.__initialLocation = window.location.href;
window.addEventListener('error', function (event) {
  document.body.dataset.listviewTest = 'fail';
  document.body.dataset.listviewErrors = '[window.error] '
    + (event.error && event.error.stack ? event.error.stack : event.message);
});
window.addEventListener('unhandledrejection', function (event) {
  document.body.dataset.listviewTest = 'fail';
  document.body.dataset.listviewErrors = '[unhandledrejection] '
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
  function fields(value) { return String(value || '').split(',').filter(Boolean).sort(); }
  function visible(value) {
    if (!value) return false;
    var style = getComputedStyle(value);
    var rect = value.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }
  function visibleBoundary(wrapper, label) {
    var boundary = wrapper && wrapper.querySelector('.listview-runtime-boundary');
    if (!visible(boundary)) throw new Error(label + ' has no visibly drawn ListView boundary');
    var background = getComputedStyle(boundary).backgroundColor;
    if (!background || background === 'transparent' || background === 'rgba(0, 0, 0, 0)') {
      throw new Error(label + ' boundary has no visible background: ' + background);
    }
    return boundary;
  }
  function offset(id) {
    var wrapper = node(id);
    return Number(wrapper && wrapper.dataset.listScrollOffset);
  }
  async function wheel(id, delta) {
    var wrapper = node(id);
    wrapper.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, deltaY: delta,
    }));
    await wait(35);
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('LIST_VALID_LOCAL'); attempt++) await wait(20);
    if (!node('LIST_VALID_LOCAL')) throw new Error('ListView fixture model did not render');
    await wait(80);
    window.__postedMessages.length = 0;

    await check('ListView diagnostics stay off by default and the explicit toggle reveals them', async function () {
      var boundary = node('LIST_VALID_LOCAL').querySelector('.listview-runtime-boundary');
      var toggle = document.getElementById('canvasDiagnosticsToggle');
      if (!boundary || visible(boundary)) throw new Error('ListView boundary was not hidden by default');
      if (!toggle || toggle.getAttribute('aria-pressed') !== 'false') {
        throw new Error('diagnostics toggle did not start off');
      }
      toggle.click();
      await wait(20);
      if (!visible(boundary) || toggle.getAttribute('aria-pressed') !== 'true') {
        throw new Error('diagnostics toggle did not reveal ListView boundaries');
      }
    });

    await check('valid list exposes requested/effective indexes and a visible local-only boundary', async function () {
      var wrapper = node('LIST_VALID_LOCAL');
      if (wrapper.dataset.listRuntimeStatus !== 'local-only'
        || wrapper.dataset.listRequestedDefaultIndex !== '2'
        || wrapper.dataset.listEffectiveDefaultIndex !== '1'
        || wrapper.dataset.listLocalOnly !== 'true') {
        throw new Error('typed local-only dataset is incomplete: ' + wrapper.outerHTML.slice(0, 600));
      }
      var boundary = visibleBoundary(wrapper, 'valid');
      if (!/仅本地/.test(boundary.textContent || '')
        || !/不执行|不提交/.test(boundary.textContent || '')) {
        throw new Error('valid boundary does not state local-only behavior: ' + boundary.textContent);
      }
    });

    await check('valid wheel and scrollbar control stay local to the Webview', async function () {
      var before = offset('LIST_VALID_LOCAL');
      await wheel('LIST_VALID_LOCAL', 28);
      var after = offset('LIST_VALID_LOCAL');
      if (!(after > before)) throw new Error('valid local wheel did not advance: ' + before + ' -> ' + after);
      var end = node('LIST_VALID_LOCAL').querySelector('.container-scroll-end-image');
      if (!end) throw new Error('valid custom end control is not visibly drawn');
      end.click();
      await wait(35);
      if (offset('LIST_VALID_LOCAL') < after) throw new Error('end control moved backward');
    });

    await check('dynamic and invalid lists draw explicit boundaries and reject interactions', async function () {
      for (var fixture of [
        ['LIST_DYNAMIC_BLOCKED', 'blocked-dynamic', ['cantouch', 'default', 'direction', 'margin', 'slider']],
        ['LIST_INVALID_BLOCKED', 'blocked-invalid', ['cantouch', 'default', 'direction', 'margin', 'slider']],
      ]) {
        var id = fixture[0];
        var status = fixture[1];
        var wrapper = node(id);
        if (wrapper.dataset.listRuntimeStatus !== status) {
          throw new Error(id + ' runtime status=' + wrapper.dataset.listRuntimeStatus);
        }
        var dataFields = status === 'blocked-dynamic'
          ? fields(wrapper.dataset.listDynamicFields)
          : fields(wrapper.dataset.listInvalidFields);
        if (dataFields.join(',') !== fixture[2].sort().join(',')) {
          throw new Error(id + ' field diagnostics=' + dataFields.join(','));
        }
        if (wrapper.querySelector('.container-scrollbar-part')) {
          throw new Error(id + ' drew a speculative scrollbar asset');
        }
        var boundary = visibleBoundary(wrapper, id);
        var expected = status === 'blocked-dynamic'
          ? /动态.*不借用|不借用.*MOV|MOV.*不借用/
          : /无效|非法/;
        if (!expected.test(boundary.textContent || '')) {
          throw new Error(id + ' boundary text=' + boundary.textContent);
        }
        var before = offset(id);
        await wheel(id, 30);
        if (offset(id) !== before) {
          throw new Error(id + ' accepted wheel despite blocked fields: ' + before + ' -> ' + offset(id));
        }
      }
    });

    await check('cantouch=0 and Slider=0 expose a disabled local boundary', async function () {
      var id = 'LIST_TOUCH_DISABLED';
      var wrapper = node(id);
      if (wrapper.dataset.listRuntimeStatus !== 'disabled'
        || wrapper.dataset.listTouchEnabled !== 'false'
        || wrapper.dataset.listScrollbarMode !== 'disabled') {
        throw new Error('disabled ListView dataset is incomplete');
      }
      var before = offset(id);
      await wheel(id, 30);
      if (offset(id) !== before) throw new Error('cantouch=0 accepted wheel');
      visibleBoundary(wrapper, 'disabled');
    });

    await check('GOM rememberScrollPosition is visible but GEE reserved3 stays behaviorless', async function () {
      var gom = node('LIST_GOM_REMEMBER');
      var gee = node('LIST_GEE_RESERVED');
      if (gom.dataset.listRememberScrollPosition !== 'true') {
        throw new Error('GOM parameter 9 is not exposed as rememberScrollPosition');
      }
      var gomBoundary = visibleBoundary(gom, 'GOM remember');
      if (!/记录滚动位置/.test(gomBoundary.textContent || '')
        || !/客户端|运行时/.test(gomBoundary.textContent || '')) {
        throw new Error('GOM persistence boundary is incomplete: ' + gomBoundary.textContent);
      }
      if (gee.dataset.listRememberScrollPosition) {
        throw new Error('GEE/LFM reserved3 leaked GOM remember behavior');
      }
      if (fields(gee.dataset.listReservedFields).join(',') !== [
        'reserved-3', 'reserved-4', 'reserved-5',
      ].join(',')) {
        throw new Error('GEE/LFM reserved fields are not exposed separately');
      }
      var geeBoundary = visibleBoundary(gee, 'GEE reserved');
      if (!/预留|reserved/i.test(geeBoundary.textContent || '')
        || /记录滚动位置/.test(geeBoundary.textContent || '')) {
        throw new Error('GEE/LFM reserved boundary invented behavior: ' + geeBoundary.textContent);
      }
    });

    await check('all ListView preview actions avoid host, navigation, and server side effects', async function () {
      for (var id of [
        'LIST_VALID_LOCAL', 'LIST_DYNAMIC_BLOCKED', 'LIST_INVALID_BLOCKED',
        'LIST_TOUCH_DISABLED', 'LIST_GOM_REMEMBER', 'LIST_GEE_RESERVED',
      ]) {
        node(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await wait(10);
      }
      if (window.__postedMessages.length) {
        throw new Error('ListView posted to host: ' + JSON.stringify(window.__postedMessages));
      }
      if (window.__openedLinks.length) {
        throw new Error('ListView called window.open: ' + JSON.stringify(window.__openedLinks));
      }
      if (window.__historyCalls.length) {
        throw new Error('ListView changed browser history: ' + JSON.stringify(window.__historyCalls));
      }
      if (window.location.href !== window.__initialLocation) {
        throw new Error('ListView navigated to ' + window.location.href);
      }
    });

    document.body.dataset.listviewDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.listviewTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.listviewErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.listviewTest = 'fail';
    document.body.dataset.listviewErrors = error && error.stack ? error.stack : String(error);
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
        '--window-size=1280,760',
        '--virtual-time-budget=2600',
        '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8',
        timeout: 24000,
        maxBuffer: 12 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-listview-test=/i.test(result.stdout || '')) {
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
        `listview-strict-runtime-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`
      );
    }
    const domCount = /data-listview-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`listview-strict-runtime-browser.test.js: browser=${selected.candidate}`);
    console.log(
      `listview-strict-runtime-browser.test.js: ProductVersion=${browserVersion(selected.candidate)}`
    );
    console.log(`listview-strict-runtime-browser.test.js: DOM=${domCount}`);
    const encoded = /data-listview-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    assert.match(
      selected.result.stdout,
      /data-listview-test="pass"/,
      decodeAttribute(encoded) || 'browser scenario did not finish'
    );
  } finally {
    if (process.env.BOO_KEEP_LISTVIEW_BROWSER_TEMP === '1') {
      console.log(`listview-strict-runtime-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
  console.log('listview-strict-runtime-browser.test.js: PASS');
}

main();
