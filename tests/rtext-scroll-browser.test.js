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

function parseModel() {
  const source = [
    '[@main]',
    '#ACT',
    'MOV N$RICHWIDTH 180',
    'MOV N$RICHHEIGHT 36',
    'MOV N$RICHWAY 1',
    'MOV N$RICHTIME 9',
    '#SAY',
    '<RText|id=RICH_X|x=20|y=20|color=70|size=20|text=默认<横向/FCOLOR=250><滚动/FCOLOR=251>|scrollWidth=120|scrollHeight=24|scrollWay=0|scrollTime=2>',
    '<RText|id=RICH_Y|x=20|y=70|color=255|size=18|text=<纵向/FCOLOR=253>滚动|scrollWidth=90|scrollHeight=40|scrollWay=1|scrollTime=3>',
    '<RText|id=RICH_DYNAMIC|x=20|y=130|color=255|size=18|text=动态滚动|scrollWidth=<$STR(N$RICHWIDTH)>|scrollHeight=<$STR(N$RICHHEIGHT)>|scrollWay=<$STR(N$RICHWAY)>|scrollTime=<$STR(N$RICHTIME)>>',
    '<RText|id=RICH_INVALID|x=20|y=180|color=255|size=18|text=非法滚动|scrollWidth=0|scrollHeight=-5|scrollWay=7|scrollTime=0>',
  ].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/rtext-scroll-browser.txt',
    fileName: 'rtext-scroll-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\rtext-scroll-browser.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
  const elements = model.pages[0].elements.filter(
    element => element.statementId === 'newui-rtext-996pc'
  );
  for (const element of elements) element.id = element.containerElementId;
  const scene = model.scenes.find(candidate => !candidate.conditionGroupId) || model.scenes[0];
  scene.elements = elements;
  model.pages[0].elements = elements;
  model.canvasWidth = 500;
  model.canvasHeight = 280;
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

function runBrowserMatrix() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    return ['[browser] Edge/Chrome is not installed; the required real Chromium test cannot run'];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-rtext-scroll-browser-'));
  try {
    const harness = path.join(temporary, 'rtext-scroll.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(parseModel())};
window.__postedMessages = [];
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
  function boundary(wrapper) {
    return [wrapper && wrapper.title, wrapper && wrapper.getAttribute('aria-label'),
      wrapper && wrapper.textContent].filter(Boolean).join(' ');
  }
  async function inspectorWarning(wrapper) {
    var rect = wrapper.getBoundingClientRect();
    var x = rect.left + Math.max(1, Math.min(4, rect.width / 2));
    var y = rect.top + Math.max(1, Math.min(4, rect.height / 2));
    wrapper.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true, button: 0, clientX: x, clientY: y,
    }));
    window.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true, button: 0, clientX: x, clientY: y,
    }));
    await wait(10);
    var warning = document.getElementById('elementWarning');
    return warning && !warning.classList.contains('hidden')
      ? (warning.textContent || '').trim() : '';
  }
  function visible(target) {
    return Boolean(target) && getComputedStyle(target).display !== 'none';
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  function stopped(wrapper) {
    var label = wrapper && wrapper.querySelector('.styled-text-preview');
    return wrapper
      && !wrapper.querySelector('.text-scroll-viewport')
      && !label.classList.contains('text-scroll-content')
      && !label.style.transform
      && getComputedStyle(label).animationName === 'none'
      && !wrapper.dataset.textScrollOffset
      && !wrapper.dataset.textScrollDurationMs;
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('RICH_X'); attempt++) await wait(20);
    if (!node('RICH_X')) throw new Error('fixture model did not render');

    await check('RText diagnostics stay hidden by default and require the explicit toggle', async function () {
      var invalidBoundary = node('RICH_INVALID').querySelector('.text-field-boundary');
      var toggle = document.getElementById('canvasDiagnosticsToggle');
      if (!invalidBoundary || visible(invalidBoundary)) {
        throw new Error('invalid RText boundary was not hidden by default');
      }
      if (!toggle || toggle.getAttribute('aria-pressed') !== 'false') {
        throw new Error('diagnostics toggle did not start off');
      }
      toggle.click();
      await wait(10);
      if (!visible(invalidBoundary) || toggle.getAttribute('aria-pressed') !== 'true') {
        throw new Error('diagnostics toggle did not reveal the RText boundary');
      }
    });

    await check('RText horizontal scrolling viewport and rich runs', async function () {
      var wrapper = node('RICH_X');
      var viewport = wrapper.querySelector('.text-scroll-viewport');
      var label = wrapper.querySelector('.styled-text-preview');
      var runs = Array.from(label.querySelectorAll('.styled-text-line > span'));
      if (!viewport || !label.classList.contains('text-scroll-content')) {
        throw new Error('real scroll viewport/content DOM is missing');
      }
      if (px(wrapper.style.width) !== 120 || px(wrapper.style.height) !== 24
        || px(viewport.style.width) !== 120 || px(viewport.style.height) !== 24) {
        throw new Error('documented 120x24 viewport geometry was not drawn');
      }
      if (wrapper.dataset.textScrollDirection !== '0'
        || wrapper.dataset.textScrollDurationMs !== '2000'
        || !/^translateX\\(/.test(label.style.transform)) {
        throw new Error('horizontal direction/time/transform is missing: ' + JSON.stringify(wrapper.dataset));
      }
      if (runs.map(function (run) { return run.textContent; }).join('|') !== '默认|横向|滚动'
        || !['#00ff00', 'rgb(0, 255, 0)'].includes(runs[1].style.color)
        || !['#ffff00', 'rgb(255, 255, 0)'].includes(runs[2].style.color)) {
        throw new Error('FCOLOR runs were lost inside scrolling RText');
      }
    });

    await check('RText vertical direction and seconds conversion', async function () {
      var wrapper = node('RICH_Y');
      var viewport = wrapper.querySelector('.text-scroll-viewport');
      var label = wrapper.querySelector('.styled-text-preview');
      if (!viewport || px(viewport.style.width) !== 90 || px(viewport.style.height) !== 40
        || wrapper.dataset.textScrollDirection !== '1'
        || wrapper.dataset.textScrollDurationMs !== '3000'
        || !/^translateY\\(/.test(label.style.transform)) {
        throw new Error('vertical RText did not use 90x40, direction=1, duration=3000ms');
      }
    });

    var xBefore = node('RICH_X').dataset.textScrollOffset;
    var yBefore = node('RICH_Y').dataset.textScrollOffset;
    var dynamicBefore = node('RICH_DYNAMIC').dataset.textScrollOffset;
    await wait(120);
    await check('both documented directions actively advance', async function () {
      var horizontal = node('RICH_X');
      var vertical = node('RICH_Y');
      if (!horizontal.dataset.textScrollOffset || horizontal.dataset.textScrollOffset === xBefore
        || !vertical.dataset.textScrollOffset || vertical.dataset.textScrollOffset === yBefore) {
        throw new Error('scroll offsets did not advance in real Chromium');
      }
      if (!/^translateX\\(/.test(horizontal.querySelector('.styled-text-preview').style.transform)
        || !/^translateY\\(/.test(vertical.querySelector('.styled-text-preview').style.transform)) {
        throw new Error('the two directions are not observably distinct');
      }
    });

    await check('resolved MOV RText scroll fields use typed static values and animate locally', async function () {
      var wrapper = node('RICH_DYNAMIC');
      var viewport = wrapper.querySelector('.text-scroll-viewport');
      var label = wrapper.querySelector('.styled-text-preview');
      if (!viewport || !label.classList.contains('text-scroll-content')
        || px(wrapper.style.width) !== 180 || px(wrapper.style.height) !== 36
        || px(viewport.style.width) !== 180 || px(viewport.style.height) !== 36
        || wrapper.dataset.textScrollDirection !== '1'
        || wrapper.dataset.textScrollDurationMs !== '9000'
        || !/^translateY\\(/.test(label.style.transform)
        || !wrapper.dataset.textScrollOffset
        || wrapper.dataset.textScrollOffset === dynamicBefore) {
        throw new Error('resolved-static RText scroll preview is incomplete');
      }
      if (wrapper.dataset.textDynamicFields || wrapper.querySelector('.text-field-boundary')
        || /<\\$STR\\(|\\$STR\\(/i.test(wrapper.textContent || '')) {
        throw new Error('resolved-static scroll fields remained dynamic or leaked source text');
      }
      var modelElement = (window.__model.pages[0].elements || []).find(function (element) {
        return element.id === 'RICH_DYNAMIC';
      });
      var sources = modelElement && modelElement.textPreview && modelElement.textPreview.fieldSources || [];
      var statuses = new Map(sources.map(function (source) { return [source.field, source.status]; }));
      for (var field of ['scroll-width', 'scroll-height', 'scroll-direction', 'scroll-duration']) {
        if (statuses.get(field) !== 'resolved-static') {
          throw new Error(field + ' status=' + statuses.get(field));
        }
      }
    });

    await check('invalid RText remains static with an explicit typed boundary and Inspector detail', async function () {
      var wrapper = node('RICH_INVALID');
      if (!stopped(wrapper)) throw new Error('invalid RText started animation');
      var typedBoundary = wrapper.querySelector('.text-field-boundary');
      if (!visible(typedBoundary) || !/无效字段/.test(typedBoundary.textContent || '')) {
        throw new Error('invalid scrolling typed boundary is not visible in explicit diagnostics mode');
      }
      var detail = await inspectorWarning(wrapper);
      if (!/RText/i.test(detail) || !/无效|非法/.test(detail)) {
        throw new Error('invalid RText full diagnostic is missing from Inspector: ' + detail);
      }
    });

    document.body.dataset.rtextScrollDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.rtextScrollTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.rtextScrollErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.rtextScrollTest = 'fail';
    document.body.dataset.rtextScrollErrors = '[dom] scenario: '
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
        '--headless=new',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--no-first-run',
        '--allow-file-access-from-files',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=900,600',
        '--virtual-time-budget=1800',
        '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 12 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-rtext-scroll-test=/i.test(result.stdout || '')) {
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
      console.log(`rtext-scroll-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-rtext-scroll-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`rtext-scroll-browser.test.js: browser=${selected.candidate}`);
    console.log(`rtext-scroll-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`rtext-scroll-browser.test.js: DOM=${domCount}`);
    const encoded = /data-rtext-scroll-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    if (!/data-rtext-scroll-test="pass"/.test(selected.result.stdout)) {
      return decodeAttribute(encoded).split(' || ').filter(Boolean);
    }
    return [];
  } finally {
    if (process.env.BOO_KEEP_RTEXT_TEST_TEMP === '1') {
      console.log(`rtext-scroll-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

function main() {
  const failures = runBrowserMatrix();
  if (failures.length > 0) {
    console.error('rtext-scroll-browser.test.js: RED FAILURE MATRIX');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('rtext-scroll-browser.test.js: PASS');
}

main();
