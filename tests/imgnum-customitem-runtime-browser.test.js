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

function parse(engine, source, name) {
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/${name}.txt`,
    fileName: `${name}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\${name}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function readyAsset(label) {
  return {
    status: 'ready',
    url: `${pixel}#${label}`,
    archiveLabel: `CustomItem/${label}`,
    width: 40,
    height: 40,
    offsetX: 0,
    offsetY: 0,
  };
}

function fixtureModel() {
  const gom = parse('GOM', [
    '[@main]',
    '#ACT',
    'MOV S$IMGNUM_IDS 2,4',
    '#SAY',
    '<&IMGNUM:3170:1234:-3:200:20:1,3|提示/@IMGNUM_SUBMIT>',
    '<&IMGNUM:3170:1234:-3:200:70:<$STR(S$IMGNUM_IDS)>>',
    '<&IMGNUM:3170:1234:-3:200:120:1,10,bad>',
  ].join('\n'), 'imgnum-custom-runtime-gom');
  const inputs = parse('996PC', [
    '[@main]',
    '#SAY',
    '<Input|id=INPUT_ONE|x=20|y=20|width=150|height=26|inputid=1|type=0|place=名字>',
    '<Input|id=INPUT_THREE|x=20|y=65|width=150|height=26|inputid=3|type=0|place=数量>',
  ].join('\n'), 'imgnum-custom-runtime-inputs');
  const gee = parse('GEE', [
    '[@main]',
    '#ACT',
    'MOV N$SHOW_INTERIOR 1',
    '#SAY',
    '<CustomItem:3:11:120:20:190:0:人物内观关闭>',
    '<HeroCustomItem:4:12:130:90:190:1:英雄内观开启>',
    '<CustomItem:5:13:140:160:190:<$STR(N$SHOW_INTERIOR)>:动态内观>',
    '<HeroCustomItem:6:14:150:230:190:2:无效内观>',
  ].join('\n'), 'imgnum-custom-runtime-gee');

  const gomElements = gom.pages.flatMap(page => page.elements || [])
    .filter(element => /IMGNUM/i.test(element.raw || ''));
  const inputElements = inputs.pages.flatMap(page => page.elements || [])
    .filter(element => ['INPUT_ONE', 'INPUT_THREE'].includes(element.containerElementId));
  const geeElements = gee.pages.flatMap(page => page.elements || [])
    .filter(element => /<(?:Hero)?CustomItem:/i.test(element.raw || ''));
  const wanted = [
    [inputElements.find(element => element.containerElementId === 'INPUT_ONE'), 'IMGNUM_INPUT_ONE'],
    [inputElements.find(element => element.containerElementId === 'INPUT_THREE'), 'IMGNUM_INPUT_THREE'],
    [gomElements[0], 'IMGNUM_STATIC'],
    [gomElements[1], 'IMGNUM_DYNAMIC'],
    [gomElements[2], 'IMGNUM_INVALID'],
    [geeElements[0], 'CUSTOM_INTERIOR_OFF'],
    [geeElements[1], 'CUSTOM_INTERIOR_ON'],
    [geeElements[2], 'CUSTOM_INTERIOR_DYNAMIC'],
    [geeElements[3], 'CUSTOM_INTERIOR_INVALID'],
  ];
  for (const [element, id] of wanted) {
    if (!element) throw new Error(`missing fixture element ${id}`);
    element.id = id;
    for (const layer of element.assetLayers || []) {
      if (layer.role === 'background') layer.asset = readyAsset(`${id}-background`);
    }
  }
  const all = wanted.map(([element]) => element);
  const page = gom.pages[0];
  const scene = gom.scenes[0];
  page.elements = all;
  scene.elements = all;
  gom.pages = [page];
  gom.scenes = [scene];
  gom.canvasWidth = 460;
  gom.canvasHeight = 310;
  reflowNpcDialogLayout(gom);
  return gom;
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
    + `complete=${/data-imgnum-customitem-test=/i.test(result.stdout || '')}, stderr=${stderr}`;
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

function runBrowserMatrix() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    console.log('imgnum-customitem-runtime-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-imgnum-customitem-browser-'));
  try {
    const harness = path.join(temporary, 'imgnum-customitem-runtime.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.__postedMessages = [];
window.__openedLinks = [];
window.__historyCalls = [];
window.open = function () { window.__openedLinks.push(Array.from(arguments)); return null; };
for (const name of ['pushState', 'replaceState']) {
  const original = history[name].bind(history);
  history[name] = function () { window.__historyCalls.push(name); return original.apply(null, arguments); };
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
  function text(wrapper) {
    return [wrapper && wrapper.textContent, wrapper && wrapper.title,
      wrapper && wrapper.getAttribute('aria-label')].filter(Boolean).join(' ');
  }
  function summary(wrapper) {
    var value = wrapper && wrapper.querySelector('.runtime-action-summary');
    return value ? value.textContent.trim() : '';
  }
  function visible(target) {
    return Boolean(target) && getComputedStyle(target).display !== 'none';
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('IMGNUM_STATIC'); attempt++) await wait(20);
    if (!node('IMGNUM_STATIC')) throw new Error('IMGNUM/CustomItem fixture did not render');

    await check('canvas diagnostics are hidden by default and visible only after the toolbar toggle', async function () {
      var boundary = node('IMGNUM_STATIC').querySelector('.runtime-action-boundary');
      var toggle = document.getElementById('canvasDiagnosticsToggle');
      if (!boundary || visible(boundary)) throw new Error('runtime boundary was not hidden by default');
      if (!toggle || toggle.getAttribute('aria-pressed') !== 'false') {
        throw new Error('diagnostics toggle did not start off');
      }
      toggle.click();
      await wait(10);
      if (!visible(boundary) || toggle.getAttribute('aria-pressed') !== 'true') {
        throw new Error('diagnostics toggle did not reveal the runtime boundary');
      }
    });

    await check('GOM IMGNUM static submit IDs are typed, local-only, and read visible Input values', async function () {
      var staticAction = node('IMGNUM_STATIC');
      var errors = [];
      if (staticAction.dataset.runtimeActionScope !== 'local'
        || staticAction.dataset.runtimeSubmitInputs !== '1,3'
        || staticAction.dataset.runtimeActionInteractive !== 'true') {
        errors.push('static IMGNUM runtime dataset is incomplete');
      }
      if (!staticAction.querySelector('.runtime-action-boundary')
        || !/仅本地预览/.test(text(staticAction))
        || !/不提交服务器/.test(text(staticAction))
        || !/不执行 @ 标签/.test(text(staticAction))) {
        errors.push('static IMGNUM data/runtime boundary is not visible');
      }
      node('IMGNUM_INPUT_ONE').querySelector('.dialog-input-control').value = '张三';
      node('IMGNUM_INPUT_THREE').querySelector('.dialog-input-control').value = '77';
      var postedAtStart = window.__postedMessages.length;
      var openedAtStart = window.__openedLinks.length;
      var historyAtStart = window.__historyCalls.length;
      var href = location.href;
      var hit = staticAction.querySelector('.runtime-action-hitarea[data-runtime-trigger="click"]');
      if (!hit || hit.disabled) errors.push('static IMGNUM lacks an enabled local click target');
      else hit.click();
      await wait(40);
      staticAction = node('IMGNUM_STATIC');
      var result = summary(staticAction);
      if (!/1=张三/.test(result) || !/3=77/.test(result)) {
        errors.push('IMGNUM did not read local visible inputs: ' + result);
      }
      if (!/@IMGNUM_SUBMIT/.test(result) || !/仅本地预览/.test(result)) {
        errors.push('server @ action was not retained solely as a local summary: ' + result);
      }
      if (staticAction.dataset.runtimeActionStatus !== 'simulated') errors.push('local simulation state missing');
      if (window.__postedMessages.length !== postedAtStart
        || window.__openedLinks.length !== openedAtStart
        || window.__historyCalls.length !== historyAtStart
        || location.href !== href) {
        errors.push('IMGNUM click performed postMessage/window.open/history/location navigation');
      }
      if (errors.length) throw new Error(errors.join('; '));
    });

    await check('dynamic and invalid GOM IMGNUM submit sources are disabled without MOV borrowing', async function () {
      var dynamic = node('IMGNUM_DYNAMIC');
      var invalid = node('IMGNUM_INVALID');
      var errors = [];
      for (var wrapper of [dynamic, invalid]) {
        if (wrapper.dataset.runtimeActionInteractive !== 'false') {
          errors.push(wrapper.dataset.elementId + ' is not disabled');
        }
        var hit = wrapper.querySelector('.runtime-action-hitarea');
        if (hit) errors.push(wrapper.dataset.elementId + ' retained a blocked full-size hit area');
      }
      if (dynamic.dataset.runtimeSubmitInputs || /2,4/.test(text(dynamic))
        || !/动态.*不借用|不借用.*当前值/.test(text(dynamic))) {
        errors.push('dynamic IMGNUM borrowed MOV S$IMGNUM_IDS=2,4 or lacks the visible boundary');
      }
      if (invalid.dataset.runtimeSubmitInputs !== '1'
        || !/无效/.test(text(invalid))
        || !/submit-inputs/.test(invalid.dataset.runtimeActionInvalidFields || '')
        || invalid.querySelector('.runtime-action-hitarea')) {
        errors.push('invalid IMGNUM did not retain only proven IDs plus invalid boundary');
      }
      if (errors.length) throw new Error(errors.join('; '));
    });

    await check('GEE CustomItem/HeroCustomItem preserve all four interior states and static frames', async function () {
      var fixtures = [
        ['CUSTOM_INTERIOR_OFF', 'disabled'],
        ['CUSTOM_INTERIOR_ON', 'enabled'],
        ['CUSTOM_INTERIOR_DYNAMIC', 'dynamic'],
        ['CUSTOM_INTERIOR_INVALID', 'invalid'],
      ];
      var errors = [];
      for (var entry of fixtures) {
        var wrapper = node(entry[0]);
        if (wrapper.dataset.itemShowInterior !== entry[1]) {
          errors.push(entry[0] + ' state=' + wrapper.dataset.itemShowInterior);
        }
        var boundary = wrapper.querySelector('.custom-item-runtime-boundary');
        if (!boundary || !/Runtime-data blocked|动态值|无效/.test(boundary.textContent)) {
          errors.push(entry[0] + ' visible custom item runtime boundary missing');
        }
        var frame = wrapper.querySelector('.item-frame-image');
        if (!frame || !String(frame.getAttribute('src') || '').includes('#' + entry[0] + '-background')) {
          errors.push(entry[0] + ' manually hydrated static background was not drawn');
        }
        if (wrapper.querySelector('.item-content-image, .item-quantity, .item-runtime-star, .item-lock-indicator')) {
          errors.push(entry[0] + ' forged runtime equipment content');
        }
      }
      var dynamic = node('CUSTOM_INTERIOR_DYNAMIC');
      var invalid = node('CUSTOM_INTERIOR_INVALID');
      if (/内观=1 已保留/.test(text(dynamic)) || /内观=1 已保留/.test(text(invalid))
        || /MOV/.test(text(dynamic)) && !/不借用/.test(text(dynamic))) {
        errors.push('dynamic/invalid interior state borrowed MOV=1 or forged enabled state');
      }
      if (errors.length) throw new Error(errors.join('; '));
    });

    document.body.dataset.imgnumCustomitemDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.imgnumCustomitemTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.imgnumCustomitemErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.imgnumCustomitemTest = 'fail';
    document.body.dataset.imgnumCustomitemErrors = '[dom] scenario: '
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
        '--window-size=1000,700', '--virtual-time-budget=1800', '--dump-dom', pathToFileURL(harness).href,
      ], {
        encoding: 'utf8', timeout: 20000, maxBuffer: 12 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-imgnum-customitem-test=/i.test(result.stdout || '')) {
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
      console.log(`imgnum-customitem-runtime-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-imgnum-customitem-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`imgnum-customitem-runtime-browser.test.js: browser=${selected.candidate}`);
    console.log(`imgnum-customitem-runtime-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`imgnum-customitem-runtime-browser.test.js: DOM=${domCount}`);
    const encoded = /data-imgnum-customitem-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    if (!/data-imgnum-customitem-test="pass"/.test(selected.result.stdout)) {
      return decodeAttribute(encoded).split(' || ').filter(Boolean);
    }
    return [];
  } finally {
    if (process.env.BOO_KEEP_IMGNUM_CUSTOMITEM_TEST_TEMP === '1') {
      console.log(`imgnum-customitem-runtime-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

const failures = runBrowserMatrix();
if (failures.length > 0) {
  console.error('imgnum-customitem-runtime-browser.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('imgnum-customitem-runtime-browser.test.js: PASS');
}
