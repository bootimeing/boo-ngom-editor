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
    'MOV N1 10000000000',
    '#SAY',
    '<BigNum:1234567891234567:73:91:{FColor=249;FSize=19;FName=微软雅黑}>',
    '<BigNum:<$STR(N1)>:133:141:{FColor=249;FSize=18;FName=宋体}>',
    '<BigNum:<$STR(N2)>:193:191:{FColor=249;FSize=18;FName=宋体}>',
  ].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/bignum-text-browser.txt',
    fileName: 'bignum-text-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\bignum-text-browser.txt',
    documentVersion: 1,
    engine: 'GEE',
    engineLabel: '翎风引擎',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(11, 13),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GEE'),
  });
  const elements = model.pages[0].elements.filter(element => /^<BigNum:/i.test(element.raw));
  if (elements[0]) elements[0].id = 'BIGNUM_STATIC';
  if (elements[1]) elements[1].id = 'BIGNUM_RESOLVED';
  if (elements[2]) elements[2].id = 'BIGNUM_UNKNOWN';
  const scene = model.scenes.find(candidate => !candidate.conditionGroupId) || model.scenes[0];
  scene.elements = elements;
  model.pages[0].elements = elements;
  model.canvasWidth = 520;
  model.canvasHeight = 340;
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
    console.log('bignum-text-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-bignum-text-browser-'));
  try {
    const harness = path.join(temporary, 'bignum-text.html');
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
  function visible(target) {
    return Boolean(target) && getComputedStyle(target).display !== 'none'
      && getComputedStyle(target).visibility !== 'hidden';
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
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('BIGNUM_STATIC'); attempt++) await wait(20);
    if (!node('BIGNUM_STATIC')) throw new Error('fixture model did not render BigNum');

    await check('BigNum typed text geometry and font styles', async function () {
      var wrapper = node('BIGNUM_STATIC');
      var label = wrapper.querySelector('.styled-text-preview');
      if (!wrapper.classList.contains('kind-text') || !label || wrapper.querySelector('.element-placeholder')) {
        throw new Error('BigNum remained an unknown/generic placeholder');
      }
      if (px(wrapper.style.left) !== 84 || px(wrapper.style.top) !== 104) {
        throw new Error('BigNum X/Y plus GEE memo offsets were not drawn: '
          + wrapper.style.left + ',' + wrapper.style.top);
      }
      if (!['#ff0000', 'rgb(255, 0, 0)'].includes(label.style.color)
        || label.style.fontSize !== '19px') {
        throw new Error('FColor/FSize are not visible: color=' + label.style.color
          + ', size=' + label.style.fontSize);
      }
      var family = String(label.style.fontFamily || getComputedStyle(label).fontFamily || '');
      if (!/微软雅黑|Microsoft YaHei/i.test(family)) {
        throw new Error('FName is not visible as the rendered font family: ' + family);
      }
      if (!label.textContent.trim() || /^<BigNum:/i.test(label.textContent.trim())) {
        throw new Error('BigNum did not draw typed visible text');
      }
    });

    await check('BigNum evidence boundary stays out of native hints and remains inspectable', async function () {
      var wrapper = node('BIGNUM_STATIC');
      var nativeHint = [wrapper.title, wrapper.getAttribute('aria-label')].filter(Boolean).join(' ');
      if (/Partial simulation|最低显示单位|单位阈值|单位配置/i.test(nativeHint)) {
        throw new Error('BigNum full diagnostic leaked into its default native hint');
      }
      var text = await inspectorWarning(wrapper);
      if (!/Partial simulation/i.test(text)) {
        throw new Error('BigNum was not explicitly classified as Partial simulation');
      }
      if (!/最低显示单位|单位阈值|单位配置/.test(text)) {
        throw new Error('the unknown client unit threshold/configuration boundary is not inspectable');
      }
    });

    await check('statically proven BigNum draws its resolved numeric value', async function () {
      var wrapper = node('BIGNUM_RESOLVED');
      var label = wrapper && wrapper.querySelector('.styled-text-preview');
      if (!wrapper || !wrapper.classList.contains('kind-text') || !label) {
        throw new Error('resolved BigNum is not a typed text control');
      }
      if (px(wrapper.style.left) !== 144 || px(wrapper.style.top) !== 154) {
        throw new Error('resolved BigNum lost its static X/Y coordinates');
      }
      if (label.textContent.trim() !== '10000000000') {
        throw new Error('resolved BigNum did not draw the proven MOV N1 value: ' + label.textContent);
      }
      if (/STR\(N1\)/i.test(label.textContent)) {
        throw new Error('resolved BigNum leaked its source expression onto the canvas');
      }
      var text = await inspectorWarning(wrapper);
      if (!/Partial simulation/i.test(text)) {
        throw new Error('BigNum unit-conversion boundary disappeared from Inspector after static resolution');
      }
    });

    await check('unknown BigNum draws neutral numeric zero without exposing source', async function () {
      var wrapper = node('BIGNUM_UNKNOWN');
      var label = wrapper && wrapper.querySelector('.styled-text-preview');
      if (!wrapper || !wrapper.classList.contains('kind-text') || !label) {
        throw new Error('unknown BigNum is not a typed text control');
      }
      if (px(wrapper.style.left) !== 204 || px(wrapper.style.top) !== 204) {
        throw new Error('unknown BigNum lost its static X/Y coordinates');
      }
      if (label.textContent.trim() !== '0' || /STR\(N2\)/i.test(label.textContent)) {
        throw new Error('unknown BigNum did not draw the neutral 0 placeholder: ' + label.textContent);
      }
      var text = await inspectorWarning(wrapper);
      if (!/数值在当前静态路径无法确定/.test(text) || !/画布显示 0/.test(text)
        || !/Partial simulation/i.test(text)) {
        throw new Error('unknown BigNum placeholder/evidence boundary is missing from Inspector: ' + text);
      }
      var typedBoundary = wrapper.querySelector('.text-field-boundary');
      var toggle = document.getElementById('canvasDiagnosticsToggle');
      if (!typedBoundary || visible(typedBoundary)) {
        throw new Error('unknown BigNum typed boundary was not hidden by default');
      }
      toggle.click();
      await wait(10);
      if (!visible(typedBoundary) || !/动态字段 text/.test(typedBoundary.textContent || '')) {
        throw new Error('explicit diagnostics toggle did not reveal the typed BigNum boundary');
      }
    });

    document.body.dataset.bignumDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.bignumTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.bignumErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.bignumTest = 'fail';
    document.body.dataset.bignumErrors = '[dom] scenario: '
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
        '--virtual-time-budget=1200',
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
        && /data-bignum-test=/i.test(result.stdout || '')) {
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
      console.log(`bignum-text-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-bignum-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`bignum-text-browser.test.js: browser=${selected.candidate}`);
    console.log(`bignum-text-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`bignum-text-browser.test.js: DOM=${domCount}`);
    const encoded = /data-bignum-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    if (!/data-bignum-test="pass"/.test(selected.result.stdout)) {
      return decodeAttribute(encoded).split(' || ').filter(Boolean);
    }
    return [];
  } finally {
    if (process.env.BOO_KEEP_BIGNUM_TEST_TEMP === '1') {
      console.log(`bignum-text-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

function main() {
  const failures = runBrowserMatrix();
  if (failures.length > 0) {
    console.error('bignum-text-browser.test.js: RED FAILURE MATRIX');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('bignum-text-browser.test.js: PASS');
}

main();
