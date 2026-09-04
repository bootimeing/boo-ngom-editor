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
    '#SAY',
    '<MenuItem|id=LOCAL_MENU|x=180|y=166|menuid=S$自定义|itemname=我要变强#我要装备#我要经验|select=我要变强|direction=0|fontcolor=250|selectcolor=254|itemhei=30|link=@菜单触发2>',
    '[@菜单触发2]',
    '#SAY',
    '<Text|x=20|y=20|color=251|size=18|text=服务器触发页面>',
  ].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/menuitem-local-selection-browser.txt',
    fileName: 'menuitem-local-selection-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\menuitem-local-selection-browser.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
  const page = model.pages.find(candidate => (
    candidate.elements || []
  ).some(element => element.statementId === 'newui-menuitem-996pc')) || model.pages[0];
  const menu = page.elements.find(element => element.statementId === 'newui-menuitem-996pc');
  if (menu) menu.id = 'MENU_LOCAL';
  const scene = model.scenes.find(candidate => (
    candidate.elements || []
  ).some(element => element.statementId === 'newui-menuitem-996pc')) || model.scenes[0];
  scene.elements = menu ? [menu] : [];
  page.elements = menu ? [menu] : [];
  model.canvasWidth = 560;
  model.canvasHeight = 300;
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
    console.log('menuitem-local-selection-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-menuitem-local-browser-'));
  try {
    const harness = path.join(temporary, 'menuitem-local-selection.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(parseModel())};
window.__postedMessages = [];
window.__openedLinks = [];
window.open = function () { window.__openedLinks.push(Array.from(arguments)); return null; };
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
  var localSelectionSucceeded = false;
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node() { return document.querySelector('[data-element-id="MENU_LOCAL"]'); }
  function selectedText(wrapper) {
    var value = wrapper && wrapper.querySelector('.menu-selected-value');
    return value ? value.textContent.trim() : '';
  }
  function runtimeText(wrapper) {
    var value = wrapper && wrapper.querySelector('.menu-runtime-value');
    return value ? value.textContent.trim() : '';
  }
  function boundary(wrapper) {
    return [wrapper && wrapper.title, wrapper && wrapper.getAttribute('aria-label'),
      wrapper && wrapper.textContent].filter(Boolean).join(' ');
  }
  function postTypes(from) {
    return window.__postedMessages.slice(from).map(function (message) { return message.type; });
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node(); attempt++) await wait(20);
    if (!node()) throw new Error('fixture MenuItem did not render');

    await check('MenuItem exposes variable/link and local-only boundary', async function () {
      var wrapper = node();
      var errors = [];
      if (wrapper.dataset.menuId !== 'S$自定义') {
        errors.push('menuid S$自定义 is not retained in DOM: ' + wrapper.dataset.menuId);
      }
      if (wrapper.dataset.menuLink !== '@菜单触发2') {
        errors.push('MenuItem link is not retained for display: ' + wrapper.dataset.menuLink);
      }
      if (wrapper.dataset.menuSelectionScope !== 'local') {
        errors.push('MenuItem selection is not marked local-only');
      }
      if (selectedText(wrapper) !== '我要变强') {
        errors.push('documented default selection was not drawn');
      }
      if (!/S\\$自定义=我要变强/.test(runtimeText(wrapper))
        || !/仅本地预览/.test(runtimeText(wrapper))
        || !/不提交服务器/.test(runtimeText(wrapper))) {
        errors.push('visible local variable state is missing: ' + runtimeText(wrapper));
      }
      var notice = boundary(wrapper);
      if (!/@菜单触发2/.test(notice) || !/仅展示|不执行/.test(notice)) {
        errors.push('link display-only boundary is missing');
      }
      if (errors.length) throw new Error(errors.join('; '));
    });

    await check('MenuItem option click updates only local state after renderScene', async function () {
      var beforeExpand = node();
      var toggle = beforeExpand.querySelector('.menu-toggle-hitarea');
      toggle.click();
      await wait(30);
      var expanded = node();
      if (expanded === beforeExpand || beforeExpand.isConnected) {
        throw new Error('toggle did not replace the MenuItem DOM through renderScene');
      }
      var options = Array.from(expanded.querySelectorAll('.menu-option'));
      var target = options.find(function (option) {
        return option.querySelector('.menu-option-label')?.textContent.trim() === '我要装备';
      });
      if (!target) throw new Error('target option 我要装备 was not rendered');
      var postStart = window.__postedMessages.length;
      var hrefBefore = location.href;
      var sceneBefore = document.getElementById('sceneTitle').textContent;
      var expandedBeforeSelection = expanded;
      target.click();
      await wait(30);

      // Option selection may call renderScene(), so every assertion below uses a fresh query.
      var selected = node();
      var interactionErrors = [];
      if (selected === expandedBeforeSelection || expandedBeforeSelection.isConnected) {
        interactionErrors.push('option selection did not replace the MenuItem DOM through renderScene');
      }
      if (selectedText(selected) !== '我要装备') {
        interactionErrors.push('local selected value did not change: ' + selectedText(selected));
      }
      if (selected.dataset.menuSelected !== '我要装备') {
        interactionErrors.push('local selected value is absent from DOM state');
      }
      if (!/S\\$自定义=我要装备/.test(runtimeText(selected))
        || !/仅本地预览/.test(runtimeText(selected))
        || !/不提交服务器/.test(runtimeText(selected))) {
        interactionErrors.push('updated local-only variable state is not visible: '
          + runtimeText(selected));
      }
      if (selected.dataset.menuExpanded !== 'false') {
        interactionErrors.push('menu did not collapse after local selection');
      }
      var emitted = postTypes(postStart);
      if (emitted.length) {
        interactionErrors.push('local selection posted messages to extension/server: '
          + emitted.join(','));
      }
      if (location.href !== hrefBefore
        || document.getElementById('sceneTitle').textContent !== sceneBefore
        || window.__openedLinks.length !== 0) {
        interactionErrors.push('MenuItem link was executed instead of displayed only');
      }
      if (interactionErrors.length) throw new Error(interactionErrors.join('; '));
      localSelectionSucceeded = true;
    });

    await check('reset restores documented default without server submission', async function () {
      if (!localSelectionSucceeded) throw new Error('precondition: local option selection did not succeed');
      var beforeReset = node();
      var postStart = window.__postedMessages.length;
      document.getElementById('resetPreview').click();
      await wait(30);

      // resetPreviewState() calls renderAll()/renderScene(), so re-query the live DOM.
      var reset = node();
      if (reset === beforeReset || beforeReset.isConnected) {
        throw new Error('reset did not replace the MenuItem DOM');
      }
      if (selectedText(reset) !== '我要变强'
        || reset.dataset.menuSelected !== '我要变强') {
        throw new Error('reset did not restore the source default selection');
      }
      if (!/S\\$自定义=我要变强/.test(runtimeText(reset))) {
        throw new Error('reset local variable display is incorrect: ' + runtimeText(reset));
      }
      if (reset.dataset.menuExpanded !== 'false') {
        throw new Error('reset did not restore the collapsed default state');
      }
      var emitted = postTypes(postStart);
      if (emitted.filter(function (type) { return type === 'resetPreview'; }).length !== 1
        || emitted.some(function (type) { return type !== 'resetPreview'; })) {
        throw new Error('reset emitted an unexpected server/action message: ' + emitted.join(','));
      }
      if (window.__openedLinks.length !== 0) throw new Error('reset executed the MenuItem link');
    });

    document.body.dataset.menuLocalDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.menuLocalTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.menuLocalErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.menuLocalTest = 'fail';
    document.body.dataset.menuLocalErrors = '[dom] scenario: '
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
        '--window-size=1000,700',
        '--virtual-time-budget=1500',
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
        && /data-menu-local-test=/i.test(result.stdout || '')) {
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
      console.log(`menuitem-local-selection-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-menu-local-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`menuitem-local-selection-browser.test.js: browser=${selected.candidate}`);
    console.log(`menuitem-local-selection-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`menuitem-local-selection-browser.test.js: DOM=${domCount}`);
    const encoded = /data-menu-local-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    if (!/data-menu-local-test="pass"/.test(selected.result.stdout)) {
      return decodeAttribute(encoded).split(' || ').filter(Boolean);
    }
    return [];
  } finally {
    if (process.env.BOO_KEEP_MENU_LOCAL_TEST_TEMP === '1') {
      console.log(`menuitem-local-selection-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

function main() {
  const failures = runBrowserMatrix();
  if (failures.length > 0) {
    console.error('menuitem-local-selection-browser.test.js: RED FAILURE MATRIX');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('menuitem-local-selection-browser.test.js: PASS');
}

main();
