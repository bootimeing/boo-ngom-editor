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
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Item -LiteralPath $env:BOO_BROWSER_VERSION_EXECUTABLE).VersionInfo.ProductVersion',
    ], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
      env: { ...process.env, BOO_BROWSER_VERSION_EXECUTABLE: executable },
    });
    const value = String(result.stdout || '').trim().split(/\r?\n/, 1)[0];
    if (!result.error && result.status === 0 && value) return value;
  }
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/, 1)[0] || '<unknown>';
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function decodeAttribute(value) {
  return String(value || '')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function browserDiagnostic(candidate, result) {
  const stderr = String(result.stderr || '').trim().replace(/\r?\n/g, '\\n') || '<empty>';
  return `${candidate}: status=${result.status}, signal=${result.signal || '<none>'}, `
    + `error=${result.error?.message || '<none>'}, `
    + `body=${/<body\b/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function parseModel() {
  const source = [
    '[@main]', '#ACT',
    // The MOV values must not escape into this fixture's static resource state.
    'MOV N$DIR 1', 'MOV N$IMG 2999', 'MOV N$ARROW 2444',
    '#SAY',
    '<MenuItem|id=STRICT_MENU|x=120|y=100|menuid=S$安全菜单|itemname=甲#乙|select=甲|direction=<$STR(N$DIR)>|img=<$STR(N$IMG)>|arrowimg=bad|selectimg=1.5|listimg=garbage|link=@不可执行>',
  ].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/menuitem-strict-assets-browser.txt',
    fileName: 'menuitem-strict-assets-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\menuitem-strict-assets-browser.txt',
    documentVersion: 1, engine: '996PC', engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
  const page = model.pages.find(candidate => candidate.elements.some(element => /STRICT_MENU/.test(element.raw))) || model.pages[0];
  const menu = page.elements.find(element => /STRICT_MENU/.test(element.raw));
  assert.ok(menu, 'MenuItem browser fixture did not parse');
  menu.id = 'MENU_STRICT';
  // Supply the post-repair typed model shape deliberately without assets. The
  // browser test proves that the renderer preserves the source boundary rather
  // than treating current MOV values/default resources as visible pixels.
  menu.assetRef = undefined;
  menu.asset = undefined;
  menu.assetLayers = undefined;
  menu.menuPreview = {
    ...menu.menuPreview,
    direction: 0,
    assetDiagnostics: [
      { field: 'img', role: 'background', sourceStatus: 'dynamic', status: 'dynamic' },
      { field: 'arrowimg', role: 'arrow', sourceStatus: 'invalid', status: 'invalid' },
      { field: 'selectimg', role: 'selected', sourceStatus: 'invalid', status: 'invalid' },
      { field: 'listimg', role: 'list-background', sourceStatus: 'invalid', status: 'invalid' },
    ],
  };
  page.elements = [menu];
  const scene = model.scenes.find(candidate => candidate.elements.some(element => /STRICT_MENU/.test(element.raw))) || model.scenes[0];
  scene.elements = [menu];
  model.canvasWidth = 560;
  model.canvasHeight = 320;
  return model;
}

function runBrowserMatrix() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    console.log('menuitem-strict-assets-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-menuitem-strict-browser-'));
  try {
    const harness = path.join(temporary, 'menuitem-strict-assets.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(parseModel())};
window.__postedMessages = []; window.__openedLinks = [];
window.open = function () { window.__openedLinks.push(Array.from(arguments)); return null; };
window.acquireVsCodeApi = function () { return { postMessage: function (message) {
  window.__postedMessages.push(message);
  if (message.type === 'ready') setTimeout(function () { window.dispatchEvent(new MessageEvent('message', {data:{
    type:'model', model:window.__model, previewRevision:1, preserveDrafts:false, geeOffsetHelp:''
  }})); }, 0);
}}; };
</script>`;
    html = html.replace(`<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`,
      `${mock}<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`);
    const scenario = `<script>
(function () {
  var failures = [];
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node() { return document.querySelector('[data-element-id="MENU_STRICT"]'); }
  function statuses(wrapper) { return ['img', 'arrowimg', 'selectimg', 'listimg'].map(function (field) {
    return [field, wrapper.dataset['menu' + field[0].toUpperCase() + field.slice(1) + 'Status'],
      wrapper.dataset['menu' + field[0].toUpperCase() + field.slice(1) + 'SourceStatus']];
  }); }
  async function run() {
    for (var attempt = 0; attempt < 150 && !node(); attempt++) await wait(20);
    var wrapper = node(); if (!wrapper) throw new Error('fixture MenuItem did not render');
    var expected = { img:'dynamic', arrowimg:'invalid', selectimg:'invalid', listimg:'invalid' };
    var errors = [];
    statuses(wrapper).forEach(function (entry) {
      if (entry[1] !== expected[entry[0]] || entry[2] !== expected[entry[0]]) {
        errors.push(entry[0] + ' DOM status/sourceStatus differs: ' + entry[1] + '/' + entry[2]);
      }
    });
    var boundaries = Array.from(wrapper.querySelectorAll('.menu-resource-boundary'));
    if (boundaries.length !== 4) errors.push('expected four visible resource boundaries, got ' + boundaries.length);
    var boundaryStates = boundaries.map(function (boundary) { return boundary.dataset.field + ':' + boundary.dataset.status; });
    ['img:dynamic', 'arrowimg:invalid', 'selectimg:invalid', 'listimg:invalid'].forEach(function (expectedState) {
      if (!boundaryStates.includes(expectedState)) errors.push('missing distinct boundary ' + expectedState + ': ' + boundaryStates.join(','));
    });
    if (/2999|2444/.test(wrapper.textContent)) errors.push('MOV resource value leaked into static DOM');
    if (!/动态|无效/.test(wrapper.textContent)) errors.push('source uncertainty is not visibly explained');
    if (errors.length) throw new Error(errors.join('; '));

    var before = node(); var postStart = window.__postedMessages.length; var href = location.href;
    var toggle = before.querySelector('.menu-toggle-hitarea'); if (!toggle) throw new Error('menu toggle was not rendered');
    toggle.click(); await wait(30);
    var expanded = node(); if (expanded === before || before.isConnected) throw new Error('expand did not re-render MenuItem');
    var target = Array.from(expanded.querySelectorAll('.menu-option')).find(function (option) {
      return option.textContent.trim() === '乙';
    });
    if (!target) throw new Error('expanded local option was not rendered');
    target.click(); await wait(30);
    var selected = node();
    if (selected.dataset.menuSelected !== '乙') throw new Error('local selection did not update');
    if (selected.dataset.menuSelectionScope !== 'local') throw new Error('selection scope is not local');
    if (window.__postedMessages.slice(postStart).length !== 0) throw new Error('selection posted a host/server message');
    if (location.href !== href || window.__openedLinks.length !== 0) throw new Error('selection navigated or executed a link');
    document.body.dataset.menuStrictDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.menuStrictTest = 'pass';
  }
  run().catch(function (error) {
    document.body.dataset.menuStrictDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.menuStrictTest = 'fail';
    document.body.dataset.menuStrictErrors = error && error.stack ? error.stack : String(error);
  });
}());
</script>`;
    fs.writeFileSync(harness, html.replace('</body>', `${scenario}</body>`), 'utf8');
    const attempts = [];
    let selected;
    for (let index = 0; index < candidates.length; index++) {
      const result = spawnSync(candidates[index], [
        '--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', '--no-first-run', '--allow-file-access-from-files',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1000,700', '--virtual-time-budget=1500', '--dump-dom', pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 20000, maxBuffer: 12 * 1024 * 1024 });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0 && /<body\b/i.test(result.stdout || '')
        && /data-menu-strict-test=/i.test(result.stdout || '')) {
        selected = { candidate: candidates[index], result }; break;
      }
    }
    if (!selected) return [`[browser] no installed candidate produced a completed DOM:\n${attempts.map(
      ({ candidate, result }) => browserDiagnostic(candidate, result)
    ).join('\n')}`];
    for (const { candidate, result } of attempts) {
      if (candidate === selected.candidate) break;
      console.log(`menuitem-strict-assets-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-menu-strict-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1] || '<missing>';
    console.log(`menuitem-strict-assets-browser.test.js: browser=${selected.candidate}`);
    console.log(`menuitem-strict-assets-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`menuitem-strict-assets-browser.test.js: DOM=${domCount}`);
    if (!/data-menu-strict-test="pass"/.test(selected.result.stdout)) {
      return [decodeAttribute(/data-menu-strict-errors="([^"]*)"/.exec(selected.result.stdout)?.[1])];
    }
    return [];
  } finally {
    if (process.env.BOO_KEEP_MENU_STRICT_TEST_TEMP === '1') console.log(`menuitem-strict-assets-browser.test.js: retained=${temporary}`);
    else removeTemporaryDirectory(temporary);
  }
}

const failures = runBrowserMatrix();
if (failures.length) {
  console.error('menuitem-strict-assets-browser.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else console.log('menuitem-strict-assets-browser.test.js: PASS');
