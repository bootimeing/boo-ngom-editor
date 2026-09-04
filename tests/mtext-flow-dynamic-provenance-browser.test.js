const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');

function sourceFixture() {
  return [
    '[@main]',
    '#ACT',
    'MOV S$KNOWN_TEXT 已知文字',
    'MOV N$KNOWN_NUMBER 42',
    '#SAY',
    '<&Layout:~#L02:205:20:300:180>',
    '<MText:#L02~:10:20:251:第一行<$STR(S$KNOWN_TEXT)>|',
    '第二行<$STR(S$UNKNOWN_TEXT)>|',
    '第三行<$STR(N$KNOWN_NUMBER)>/<$STR(N$UNKNOWN_NUMBER)>>',
    '欢迎<$STR(S$KNOWN_TEXT)>，未知<$STR(S$UNKNOWN_TEXT)>，数值<$STR(N$KNOWN_NUMBER)>/<$STR(N$UNKNOWN_NUMBER)>',
    '前缀<彩色<$STR(S$KNOWN_TEXT)>与<$STR(S$UNKNOWN_TEXT)>/FCOLOR=250>尾缀',
    '甲<$STR(S$KNOWN_TEXT)>\\乙<$STR(S$UNKNOWN_TEXT)>',
    '',
  ].join('\r\n');
}

function visibleText(element) {
  const preview = (element.textPreview?.lines || [])
    .map(line => (line || []).map(run => String(run.text || '')).join(''))
    .join('\n');
  return preview || String(element.text || '');
}

function buildModel() {
  const source = sourceFixture();
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/mtext-flow-browser.txt',
    fileName: 'mtext-flow-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\mtext-flow-browser.txt',
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: 'GOM',
    cursorOffset: source.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });
  const elements = model.pages[0].elements.map(element => {
    const text = visibleText(element);
    let id = element.id;
    if (element.statementId === 'container-mtext') id = 'MTEXT';
    else if (text.startsWith('欢迎')) id = 'FLOW_PLAIN';
    else if (text.startsWith('前缀彩色')) id = 'FLOW_COLOR';
    else if (text.startsWith('甲')) id = 'FLOW_BREAK_A';
    else if (text.startsWith('乙')) id = 'FLOW_BREAK_B';
    return { ...element, id };
  });
  model.pages = [{ ...model.pages[0], id: 'MTEXT_FLOW_PAGE', elements }];
  model.scenes = [{ ...model.scenes[0], id: 'MTEXT_FLOW_SCENE', elements }];
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
  return '<unknown>';
}

function browserDiagnostic(candidate, result) {
  const stderr = String(result.stderr || '').trim().replace(/\r?\n/g, '\\n') || '<empty>';
  return `${candidate}: status=${result.status}, signal=${result.signal || '<none>'}, `
    + `error=${result.error?.message || '<none>'}, body=${/<body\b/i.test(result.stdout || '')}, `
    + `complete=${/data-mtext-flow-test=/i.test(result.stdout || '')}, stderr=${stderr}`;
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
    console.log('mtext-flow-dynamic-provenance-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-mtext-flow-'));
  try {
    const harness = path.join(temporary, 'mtext-flow.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
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
  function fire(target, type, options) {
    target.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0 }, options || {})));
  }
  function text(id) {
    var wrapper = node(id);
    var label = wrapper && wrapper.querySelector('.styled-text-preview, .element-text');
    return label ? label.textContent.trim() : '';
  }
  function lines(id) {
    var wrapper = node(id);
    return Array.from(wrapper ? wrapper.querySelectorAll('.styled-text-line') : [])
      .map(function (line) { return line.textContent; });
  }
  async function check(name, callback) {
    try { await callback(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  async function run() {
    for (var attempt = 0; attempt < 120 && !node('FLOW_BREAK_B'); attempt++) await wait(10);
    if (!node('FLOW_BREAK_B')) throw new Error('fixture did not render');

    await check('MText draws resolved and neutral placeholder lines', async function () {
      var actual = lines('MTEXT');
      var expected = ['第一行已知文字', '第二行预览文字', '第三行42/0'];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error('MText lines=' + JSON.stringify(actual));
      }
      if (document.getElementById('dialogCanvas').textContent.indexOf('<$STR(') >= 0) {
        throw new Error('source expression leaked into canvas text');
      }
    });

    await check('MText Inspector separates visible value from auditable raw and remains draggable', async function () {
      var wrapper = node('MTEXT');
      fire(wrapper, 'click');
      await wait(20);
      var display = document.getElementById('elementText').textContent;
      var raw = document.getElementById('rawStatement').textContent;
      if (display.indexOf('<$STR(') >= 0 || display.indexOf('预览文字') < 0) {
        throw new Error('Inspector display is not resolved/placeholder text: ' + display);
      }
      if (raw.indexOf('<$STR(S$KNOWN_TEXT)>') < 0 || raw.indexOf('<$STR(N$UNKNOWN_NUMBER)>') < 0) {
        throw new Error('Inspector raw lost the original multiline expressions: ' + raw);
      }
      var xInput = document.getElementById('elementX');
      var yInput = document.getElementById('elementY');
      if (xInput.disabled || yInput.disabled) throw new Error('literal MText X/Y is locked');
      var beforeX = Number(xInput.value);
      var beforeY = Number(yInput.value);
      wrapper = node('MTEXT');
      var rect = wrapper.getBoundingClientRect();
      var startX = rect.left + 8;
      var startY = rect.top + 8;
      fire(wrapper, 'mousedown', { clientX: startX, clientY: startY, buttons: 1 });
      fire(window, 'mousemove', { clientX: startX + 12, clientY: startY + 8, buttons: 1 });
      fire(window, 'mouseup', { clientX: startX + 12, clientY: startY + 8, buttons: 0 });
      await wait(20);
      if (Number(document.getElementById('elementX').value) !== beforeX + 12
        || Number(document.getElementById('elementY').value) !== beforeY + 8) {
        throw new Error('MText drag did not update draft coordinates');
      }
    });

    await check('flow text keeps client-like values and source-only Inspector audit', async function () {
      if (text('FLOW_PLAIN') !== '欢迎已知文字，未知预览文字，数值42/0') {
        throw new Error('plain flow display=' + text('FLOW_PLAIN'));
      }
      fire(node('FLOW_PLAIN'), 'click');
      await wait(20);
      var display = document.getElementById('elementText').textContent;
      var raw = document.getElementById('rawStatement').textContent;
      if (display.indexOf('<$STR(') >= 0 || display.indexOf('预览文字') < 0) {
        throw new Error('flow Inspector visible text leaked source expression: ' + display);
      }
      if (raw.indexOf('<$STR(S$KNOWN_TEXT)>') < 0 || raw.indexOf('<$STR(N$UNKNOWN_NUMBER)>') < 0) {
        throw new Error('flow Inspector raw no longer points to source: ' + raw);
      }
      if (!document.getElementById('elementX').disabled || !document.getElementById('elementY').disabled) {
        throw new Error('flow text incorrectly gained coordinate editing');
      }
      if (document.getElementById('coordinateMode').textContent.indexOf('流式') < 0) {
        throw new Error('flow coordinate mode changed');
      }
    });

    await check('FCOLOR and backslash flow fragments remain visible and laid out', async function () {
      var colorWrapper = node('FLOW_COLOR');
      var green = Array.from(colorWrapper.querySelectorAll('.styled-text-line > span')).find(function (run) {
        return run.textContent.indexOf('彩色') >= 0;
      });
      if (!green || getComputedStyle(green).color !== 'rgb(0, 255, 0)') {
        throw new Error('resolved FCOLOR run is not visibly green');
      }
      if (text('FLOW_BREAK_A') !== '甲已知文字' || text('FLOW_BREAK_B') !== '乙预览文字') {
        throw new Error('backslash flow fragments are not resolved independently');
      }
      var first = node('FLOW_BREAK_A').getBoundingClientRect();
      var second = node('FLOW_BREAK_B').getBoundingClientRect();
      // The first fragment may continue the preceding physical flow row. The
      // explicit backslash must still move its second fragment onto a later
      // visible row; the model test separately proves it resets to flow X=18.
      if (second.top < first.top + 20) {
        throw new Error('backslash flow fragments lost their next-line layout');
      }
    });

    await check('canvas interactions do not execute host, navigation, or history actions', async function () {
      var unexpected = window.__postedMessages.filter(function (message) {
        return message.type !== 'ready' && message.type !== 'dirtyChanged';
      });
      if (unexpected.length) throw new Error('unexpected host messages: ' + JSON.stringify(unexpected));
      if (window.__openedLinks.length || window.__historyCalls.length
        || window.location.href !== window.__initialLocation) {
        throw new Error('canvas interaction navigated a real target');
      }
    });

    document.body.dataset.mtextFlowDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.mtextFlowTest = failures.length ? 'fail' : 'pass';
    if (failures.length) document.body.dataset.mtextFlowErrors = encodeURIComponent(failures.join(' || '));
  }
  run().catch(function (error) {
    document.body.dataset.mtextFlowTest = 'fail';
    document.body.dataset.mtextFlowErrors = encodeURIComponent('[dom] '
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
        && /data-mtext-flow-test=/i.test(result.stdout || '')) {
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
      console.log(`mtext-flow-dynamic-provenance-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }

    const domCount = /data-mtext-flow-dom-count="([0-9]+)"/i.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`mtext-flow-dynamic-provenance-browser.test.js: browser=${selected.candidate}`);
    console.log(`mtext-flow-dynamic-provenance-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`mtext-flow-dynamic-provenance-browser.test.js: DOM=${domCount}`);
    if (/data-mtext-flow-test="pass"/i.test(selected.result.stdout)) return [];
    const encoded = /data-mtext-flow-errors="([^"]*)"/i.exec(selected.result.stdout)?.[1];
    return decodeURIComponent(decodeAttribute(encoded)).split(' || ').filter(Boolean);
  } finally {
    if (process.env.BOO_KEEP_MTEXT_FLOW_TEMP === '1') {
      console.log(`mtext-flow-dynamic-provenance-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

const failures = runBrowserMatrix();
if (failures.length > 0) {
  console.error('mtext-flow-dynamic-provenance-browser.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('mtext-flow-dynamic-provenance-browser.test.js: PASS');
}
