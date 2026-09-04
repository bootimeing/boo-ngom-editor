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
      '(Get-Item -LiteralPath $env:BOO_BACKGROUND_BROWSER).VersionInfo.ProductVersion',
    ], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      env: { ...process.env, BOO_BACKGROUND_BROWSER: executable },
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

function parse(engine, source) {
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/dialog-background-${engine}.txt`,
    fileName: `dialog-background-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\dialog-background-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function readyAsset(background) {
  const key = `${background.willIndex}/${background.imageIndex}`;
  const geometry = {
    '5/3': { width: 120, height: 90, offsetX: -2, offsetY: 3 },
    '16/109': { width: 180, height: 100, offsetX: 0, offsetY: 0 },
    '176/19': { width: 200, height: 100, offsetX: -4, offsetY: 5 },
    '8/109': { width: 180, height: 100, offsetX: 1, offsetY: -3 },
  }[key] || { width: 160, height: 90, offsetX: 0, offsetY: 0 };
  return {
    status: 'ready',
    url: `${pixel}#background-${key}`,
    archiveLabel: `WIL ${key}`,
    ...geometry,
  };
}

function hydrateFixtureBackgrounds(model) {
  for (const scene of model.scenes) {
    const background = scene.background;
    if (!background || background.status !== 'static' || !background.assetRef) continue;
    background.asset = readyAsset(background);
  }
  reflowNpcDialogLayout(model);
  model.canvasWidth = 800;
  model.canvasHeight = 600;
  return model;
}

function fixtureModels() {
  const gomSource = [
    '[@main]',
    '#ACT',
    'OPENMERCHANTBIGDLG 5 3|1|400|300 1 4 10 -20 1 190 8 1',
    '#SAY',
    '<动态字段/@dynamic>',
    '<非法字段/@invalid>',
    '<关闭生命周期/@closed>',
    '<OpenBig/@openbig>',
    '[@dynamic]',
    '#ACT',
    'MOV N$BG_WIL 5',
    'MOV N$BG_IMAGE 3',
    'MOV N$BG_MOVE 1',
    'MOV N$BG_POSITION 4',
    'MOV N$BG_X 10',
    'MOV N$BG_Y -20',
    'MOV N$BG_CLOSE 1',
    'MOV N$BG_CLOSE_X 190',
    'MOV N$BG_CLOSE_Y 8',
    'MOV N$BG_TAIL 1',
    'OPENMERCHANTBIGDLG <$STR(N$BG_WIL)> <$STR(N$BG_IMAGE)> '
      + '<$STR(N$BG_MOVE)> <$STR(N$BG_POSITION)> <$STR(N$BG_X)> <$STR(N$BG_Y)> '
      + '<$STR(N$BG_CLOSE)> <$STR(N$BG_CLOSE_X)> <$STR(N$BG_CLOSE_Y)> <$STR(N$BG_TAIL)>',
    '#SAY',
    '<返回/@main>',
    '[@invalid]',
    '#ACT',
    'OPENMERCHANTBIGDLG -1 nope 2 5 1.5 bad -1 x q 2',
    '#SAY',
    '<返回/@main>',
    '[@closed]',
    '#ACT',
    'OPENMERCHANTBIGDLG 5 3 1 4 10 -20 1 190 8 1',
    'CLOSEMERCHANTBIGDLG',
    '#SAY',
    '<返回/@main>',
    '[@openbig]',
    '#ACT',
    'OpenBigDialogBox 16 109',
    '#SAY',
    '<返回/@main>',
  ].join('\n');
  const geeSource = [
    '[@main]',
    '#ACT',
    'OPENMERCHANTBIGDLG 176 19 1 3 10 70 1 190 8 1',
    '#SAY',
    '<OpenBig/@openbig>',
    '[@openbig]',
    '#ACT',
    'OpenBigDialogBox 8 109 1 4 0 0 1 530 0',
    '#SAY',
    '<返回/@main>',
  ].join('\n');
  return {
    gom: hydrateFixtureBackgrounds(parse('GOM', gomSource)),
    gee: hydrateFixtureBackgrounds(parse('GEE', geeSource)),
  };
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function attribute(output, name) {
  const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(output || '');
  return match?.[1] || '';
}

function runBrowserMatrix() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    console.log('dialog-background-preview-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-dialog-background-browser-'));
  try {
    const harness = path.join(temporary, 'dialog-background.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__models = ${JSON.stringify(fixtureModels())};
window.__postedMessages = [];
window.__openedLinks = [];
window.open = function () { window.__openedLinks.push(Array.from(arguments)); return null; };
window.acquireVsCodeApi = function () { return { postMessage: function (message) {
  window.__postedMessages.push(message);
  if (message.type === 'ready') setTimeout(function () {
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'model', model: window.__models.gom, previewRevision: 1,
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
  function shell() { return document.querySelector('#dialogCanvas > .dialog-background-preview'); }
  function pageButton(label) {
    return Array.from(document.querySelectorAll('#sceneList .scene-button')).find(function (button) {
      var title = button.querySelector('strong');
      return title && title.textContent === label;
    });
  }
  async function selectPage(label) {
    var button = pageButton(label);
    if (!button) throw new Error('page button missing: ' + label);
    button.click();
    await wait(80);
  }
  function fields(value) {
    return new Set(String(value || '').split(',').filter(Boolean));
  }
  function requireFields(value, expected) {
    var actual = fields(value);
    var missing = expected.filter(function (field) { return !actual.has(field); });
    if (missing.length) throw new Error('missing fields=' + missing.join(',') + '; actual=' + value);
  }
  function resourceAttempted(wrapper) {
    if (!wrapper) return false;
    return Array.from(wrapper.querySelectorAll('[src], [style]')).some(function (node) {
      return /url\\(|data:image|vscode-resource/i.test(
        (node.getAttribute('src') || '') + ' ' + (node.getAttribute('style') || '')
      );
    });
  }
  async function check(name, callback) {
    try { await callback(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  async function waitForMainBackground() {
    for (var attempt = 0; attempt < 150; attempt++) {
      if (shell()) return;
      await wait(20);
    }
  }
  async function run() {
    await waitForMainBackground();

    await check('GOM nine-grid target geometry and source offsets are drawn', async function () {
      var wrapper = shell();
      if (!wrapper) throw new Error('dialog-background-preview wrapper missing');
      var expected = {
        backgroundCommand: 'OPENMERCHANTBIGDLG',
        backgroundStatus: 'static',
        backgroundRuntimeScope: 'local',
        backgroundMovable: 'true',
        backgroundPosition: '4',
        backgroundOffsetX: '10',
        backgroundOffsetY: '-20',
        backgroundShowClose: 'true',
        backgroundCloseX: '190',
        backgroundCloseY: '8',
        backgroundIndependentWindow: 'true',
        backgroundNineGrid: 'true',
        backgroundNineGridWidth: '400',
        backgroundNineGridHeight: '300',
        backgroundNineGridRendering: 'partial-simulation'
      };
      var errors = [];
      Object.entries(expected).forEach(function (entry) {
        if (wrapper.dataset[entry[0]] !== entry[1]) {
          errors.push(entry[0] + '=' + String(wrapper.dataset[entry[0]]));
        }
      });
      if (px(wrapper.style.left) !== 210 || px(wrapper.style.top) !== 130
        || px(wrapper.style.width) !== 400 || px(wrapper.style.height) !== 300) {
        errors.push('shell geometry=' + wrapper.getAttribute('style'));
      }
      var image = wrapper.querySelector('.dialog-background-nine-grid');
      if (!image || px(image.style.left) !== -2 || px(image.style.top) !== 3
        || px(image.style.width) !== 400 || px(image.style.height) !== 300) {
        errors.push('nine-grid image geometry=' + (image && image.getAttribute('style')));
      }
      var boundary = wrapper.querySelector('.dialog-background-runtime-boundary');
      var text = [wrapper.title, wrapper.textContent].filter(Boolean).join(' ');
      if (!boundary || !/Partial simulation/i.test(text) || !/九宫格/.test(text)) {
        errors.push('visible Partial simulation nine-grid boundary missing');
      }
      if (errors.length) throw new Error(errors.join('; '));
    });

    await check('close marker is visible metadata and never executes a client/host action', async function () {
      var wrapper = shell();
      var marker = wrapper && wrapper.querySelector('.dialog-background-close-marker');
      if (!marker || px(marker.style.left) !== 190 || px(marker.style.top) !== 8) {
        throw new Error('close marker geometry missing');
      }
      var before = window.__postedMessages.length;
      marker.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      await wait(60);
      if (!shell()) throw new Error('local marker closed the static preview');
      var emitted = window.__postedMessages.slice(before).map(function (message) { return message.type; });
      if (emitted.length || window.__openedLinks.length) {
        throw new Error('close marker executed host/runtime action: ' + emitted.join(','));
      }
      var text = [wrapper.title, wrapper.textContent].join(' ');
      if (!/不执行|不控制客户端|仅本地展示/.test(text)) {
        throw new Error('runtime-action boundary is not visible');
      }
    });

    await check('dynamic background stays visible but cannot borrow MOV values or load an asset', async function () {
      await selectPage('@dynamic');
      var wrapper = shell();
      if (!wrapper || wrapper.dataset.backgroundStatus !== 'dynamic') {
        throw new Error('typed dynamic background missing');
      }
      requireFields(wrapper.dataset.backgroundDynamicFields, [
        'will-index', 'image-index', 'movable', 'position', 'offset-x', 'offset-y',
        'show-close', 'close-x', 'close-y', 'independent-window'
      ]);
      if (resourceAttempted(wrapper)) throw new Error('dynamic background attempted a resource URL');
      var serialized = [
        wrapper.dataset.backgroundWillIndex,
        wrapper.dataset.backgroundImageIndex,
        wrapper.dataset.backgroundPosition,
        wrapper.dataset.backgroundOffsetX,
        wrapper.dataset.backgroundOffsetY,
      ].filter(Boolean).join(',');
      if (/^(?:5|3|4|10|-20)(?:,|$)/.test(serialized)) {
        throw new Error('dynamic metadata borrowed MOV values: ' + serialized);
      }
      if (!/不借用.*MOV|MOV.*不借用|不借用.*当前值/.test(wrapper.textContent)) {
        throw new Error('visible MOV source-safety boundary missing');
      }
    });

    await check('invalid background stays diagnostic-only and never loads a resource', async function () {
      await selectPage('@invalid');
      var wrapper = shell();
      if (!wrapper || wrapper.dataset.backgroundStatus !== 'invalid') {
        throw new Error('typed invalid background missing');
      }
      requireFields(wrapper.dataset.backgroundInvalidFields, [
        'will-index', 'image-index', 'movable', 'position', 'offset-x', 'offset-y',
        'show-close', 'close-x', 'close-y', 'independent-window'
      ]);
      if (resourceAttempted(wrapper)) throw new Error('invalid background attempted a resource URL');
      if (!/无效|非法|超出/.test(wrapper.textContent)) {
        throw new Error('visible invalid-field boundary missing');
      }
    });

    await check('matching close removes the background from the following SAY scene', async function () {
      await selectPage('@closed');
      if (shell() || document.querySelector('#dialogCanvas > img.dialog-background')) {
        throw new Error('closed background was still rendered');
      }
      var canvasText = document.getElementById('dialogCanvas').textContent || '';
      if (/CLOSEMERCHANTBIGDLG|OPENMERCHANTBIGDLG/i.test(canvasText)) {
        throw new Error('lifecycle commands leaked into canvas flow text');
      }
    });

    await check('GOM two-argument OpenBigDialogBox draws a typed static background', async function () {
      await selectPage('@openbig');
      var wrapper = shell();
      if (!wrapper || wrapper.dataset.backgroundCommand !== 'OPENBIGDIALOGBOX'
        || wrapper.dataset.backgroundStatus !== 'static') {
        throw new Error('GOM OpenBig typed wrapper missing');
      }
      if (!wrapper.querySelector('img.dialog-background')) {
        throw new Error('GOM OpenBig hydrated background missing');
      }
      if (wrapper.dataset.backgroundMovable || wrapper.dataset.backgroundPosition
        || wrapper.dataset.backgroundContinueUse || wrapper.dataset.backgroundIndependentWindow) {
        throw new Error('GOM OpenBig invented GEE/merchant parameters');
      }
    });

    await check('GEE merchant uses continue-use metadata and complete position geometry', async function () {
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'model', model: window.__models.gee, previewRevision: 2,
        preserveDrafts: false, geeOffsetHelp: ''
      }}));
      for (var attempt = 0; attempt < 100; attempt++) {
        var badge = document.getElementById('engineBadge');
        if (badge && badge.textContent === 'GEE' && shell()) break;
        await wait(20);
      }
      var wrapper = shell();
      if (!wrapper) throw new Error('GEE merchant wrapper missing');
      if (wrapper.dataset.backgroundCommand !== 'OPENMERCHANTBIGDLG'
        || wrapper.dataset.backgroundContinueUse !== 'true'
        || wrapper.dataset.backgroundIndependentWindow === 'true') {
        throw new Error('GEE tail semantics=' + JSON.stringify(wrapper.dataset));
      }
      if (px(wrapper.style.left) !== 610 || px(wrapper.style.top) !== 570
        || px(wrapper.style.width) !== 200 || px(wrapper.style.height) !== 100) {
        throw new Error('GEE merchant position geometry=' + wrapper.getAttribute('style'));
      }
      var image = wrapper.querySelector('img.dialog-background');
      if (!image || px(image.style.left) !== -4 || px(image.style.top) !== 5) {
        throw new Error('GEE source image offset missing');
      }
    });

    await check('GEE nine-argument OpenBigDialogBox exposes complete DOM metadata', async function () {
      await selectPage('@openbig');
      var wrapper = shell();
      if (!wrapper || wrapper.dataset.backgroundCommand !== 'OPENBIGDIALOGBOX') {
        throw new Error('GEE OpenBig wrapper missing');
      }
      var expected = {
        backgroundMovable: 'true', backgroundPosition: '4',
        backgroundOffsetX: '0', backgroundOffsetY: '0',
        backgroundShowClose: 'true', backgroundCloseX: '530', backgroundCloseY: '0'
      };
      var errors = [];
      Object.entries(expected).forEach(function (entry) {
        if (wrapper.dataset[entry[0]] !== entry[1]) {
          errors.push(entry[0] + '=' + String(wrapper.dataset[entry[0]]));
        }
      });
      if (px(wrapper.style.left) !== 310 || px(wrapper.style.top) !== 250
        || px(wrapper.style.width) !== 180 || px(wrapper.style.height) !== 100) {
        errors.push('geometry=' + wrapper.getAttribute('style'));
      }
      if (wrapper.dataset.backgroundContinueUse || wrapper.dataset.backgroundIndependentWindow) {
        errors.push('OpenBig inherited merchant tail');
      }
      if (errors.length) throw new Error(errors.join('; '));
    });

    document.body.dataset.dialogBackgroundDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.dialogBackgroundTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.dialogBackgroundErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.dialogBackgroundTest = 'fail';
    document.body.dataset.dialogBackgroundErrors = error && error.stack ? error.stack : String(error);
  });
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let passing;
    let lastResult;
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      const result = spawnSync(candidate, [
        '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
        '--allow-file-access-from-files',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1280,900', '--virtual-time-budget=8000', '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8', timeout: 25000, maxBuffer: 12 * 1024 * 1024,
      });
      lastResult = result;
      const diagnostic = browserDiagnostic(candidate, result);
      attempts.push(diagnostic);
      const body = /<body\b/i.test(result.stdout || '');
      const passed = /data-dialog-background-test="pass"/i.test(result.stdout || '');
      if (result.status === 0 && body && passed) {
        passing = { candidate, result };
        break;
      }
    }

    if (!passing) {
      const lastOutput = attempts.length > 0 ? attempts[attempts.length - 1] : '<no attempts>';
      const error = attribute(
        lastResult?.stdout || '',
        'data-dialog-background-errors'
      );
      const domCount = attribute(
        lastResult?.stdout || '',
        'data-dialog-background-dom-count'
      ) || '<missing>';
      throw new Error(`no Chromium candidate passed; ${lastOutput}; `
        + `DOM=${domCount}; DOM error=${error || '<missing>'}; attempts=${attempts.join(' || ')}`);
    }

    const version = browserVersion(passing.candidate);
    const domCount = attribute(passing.result.stdout, 'data-dialog-background-dom-count') || '<missing>';
    for (const attempt of attempts) console.log(`dialog-background browser attempt: ${attempt}`);
    console.log(`dialog-background browser PASS: ${passing.candidate}; version=${version}; DOM=${domCount}`);
    assert.match(passing.result.stdout, /data-dialog-background-test="pass"/i);
    return attempts;
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

runBrowserMatrix();
console.log('dialog-background-preview-browser.test.js: PASS');
