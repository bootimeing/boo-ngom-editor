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
    engineLabel: engine === '996PC' ? '996PC' : '新GOM',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function readyAsset(label) {
  return {
    status: 'ready',
    url: `${pixel}#${label}`,
    archiveLabel: `ITEMBOX/${label}`,
    width: 40,
    height: 40,
    offsetX: 0,
    offsetY: 0,
  };
}

function fixtureModel() {
  const gomSource = [
    '[@main]',
    '#ACT',
    'MOV N$BOX_F 2',
    'MOV S$BOX_STDMODE 10,11',
    'MOV N$BOX_INDEX 6',
    '#SAY',
    '<ITEMBOX:3:-1:117:20:30:76:78:10,11:254#只允许衣服^251#运行时校验>',
    '<ITEMBOX:4:2:117:120:30:80:82:*:允许所有物品>',
    '<ITEMBOX:<$STR(N$BOX_INDEX)>:<$STR(N$BOX_F)>:117:20:150:76:78:<$STR(S$BOX_STDMODE)>:动态框>',
    '<ITEMBOX:oops:-2:117:120:150:76:78:10,-1,2.5,,x:非法约束>',
  ].join('\n');
  const pcSource = [
    '[@main]',
    '#SAY',
    '<ITEMBOX|id=PC_BOX|boxindex=5|x=240|y=30|width=70|height=72|stdmode=5,6|wil=NewopUI|pcimg=112|tips=<只能放武器/FCOLOR=249>>',
    '<ITEMBOX|id=PC_INVALID|boxindex=-1|x=240|y=150|width=70|height=72|stdmode=*,5|wil=NewopUI|pcimg=112|tips=非法星号混用>',
  ].join('\n');
  const model = parse('GOM', gomSource, 'itembox-browser-gom');
  const pc = parse('996PC', pcSource, 'itembox-browser-996pc');
  const gomBoxes = model.pages.flatMap(page => page.elements || [])
    .filter(element => element.statementId === 'item-box');
  const pcBoxes = pc.pages.flatMap(page => page.elements || [])
    .filter(element => element.statementId === 'newui-itembox-996pc');
  const wanted = [
    [gomBoxes[0], 'ITEMBOX_LIMITED'],
    [gomBoxes[1], 'ITEMBOX_ANY'],
    [gomBoxes[2], 'ITEMBOX_DYNAMIC'],
    [gomBoxes[3], 'ITEMBOX_INVALID'],
    [pcBoxes.find(element => element.containerElementId === 'PC_BOX'), 'ITEMBOX_PC'],
    [pcBoxes.find(element => element.containerElementId === 'PC_INVALID'), 'ITEMBOX_PC_INVALID'],
  ];
  for (const [element, id] of wanted) {
    if (!element) throw new Error(`missing fixture element ${id}`);
    element.id = id;
    for (const layer of element.assetLayers || []) {
      if (layer.role === 'background') layer.asset = readyAsset(`${id}-background`);
    }
  }
  const all = wanted.map(([element]) => element);
  const page = model.pages.find(candidate => (candidate.elements || []).includes(gomBoxes[0]))
    || model.pages[0];
  const scene = model.scenes.find(candidate => (candidate.elements || []).includes(gomBoxes[0]))
    || model.scenes[0];
  page.elements = all;
  scene.elements = all;
  model.pages = [page];
  model.scenes = [scene];
  model.canvasWidth = 430;
  model.canvasHeight = 310;
  reflowNpcDialogLayout(model);
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
    + `error=${result.error?.message || '<none>'}, body=${/<body\b/i.test(result.stdout || '')}, `
    + `complete=${/data-itembox-test=/i.test(result.stdout || '')}, stderr=${stderr}`;
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
    const message = '[browser] Edge/Chrome is not installed; the ITEMBOX real-Chromium gate cannot run';
    if (process.env.BOO_REQUIRE_REAL_BROWSER === '1') return [message];
    console.log(`itembox-constraints-browser.test.js: SKIP (${message})`);
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-itembox-browser-'));
  try {
    const harness = path.join(temporary, 'itembox-constraints.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
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
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function text(wrapper) {
    return [wrapper && wrapper.textContent, wrapper && wrapper.title,
      wrapper && wrapper.getAttribute('aria-label')].filter(Boolean).join(' ');
  }
  function summary(wrapper) {
    var value = wrapper && wrapper.querySelector('.itembox-constraint-summary');
    return value ? value.textContent.trim() : '';
  }
  function px(value) { return Number(String(value || '').replace('px', '')); }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('ITEMBOX_LIMITED'); attempt++) await wait(20);
    if (!node('ITEMBOX_LIMITED')) throw new Error('ITEMBOX fixture did not render');

    await check('traditional list constraints and F=-1 are visibly modeled', async function () {
      var wrapper = node('ITEMBOX_LIMITED');
      var value = summary(wrapper);
      var errors = [];
      if (!wrapper.classList.contains('itembox-preview')) errors.push('semantic ITEMBOX class missing');
      if (wrapper.dataset.itemBoxIndex !== '3') errors.push('box index dataset missing');
      if (wrapper.dataset.itemBoxAllowedStdModes !== '10,11') errors.push('typed StdMode dataset missing');
      if (wrapper.dataset.itemBoxAcceptsAnyStdMode !== 'false') errors.push('list/accept-all distinction missing');
      if (wrapper.dataset.itemBoxBackground !== 'disabled') errors.push('F=-1 disabled state missing');
      if (px(wrapper.style.width) !== 76 || px(wrapper.style.height) !== 78) {
        errors.push('documented 76x78 geometry missing');
      }
      if (!/OK框\\s*3|编号[：:]?\\s*3/.test(value)
        || !/允许\\s*StdMode[：:]?\\s*10[、,，]\\s*11/i.test(value)
        || !/76\\s*[×xX]\\s*78/.test(value)
        || !/无背景/.test(value)) {
        errors.push('visible index/StdMode/size/no-background summary incomplete: ' + value);
      }
      if (wrapper.querySelector('.item-frame-image')) errors.push('F=-1 still drew a background image');
      if (errors.length) throw new Error(errors.join('; '));
    });

    await check('wildcard and 996PC lists remain distinct visible states', async function () {
      var any = node('ITEMBOX_ANY');
      var pc = node('ITEMBOX_PC');
      var errors = [];
      if (any.dataset.itemBoxAcceptsAnyStdMode !== 'true'
        || any.dataset.itemBoxAllowedStdModes) {
        errors.push('S=* was not modeled as a distinct accept-all state');
      }
      if (!/允许全部\\s*StdMode/i.test(summary(any))) {
        errors.push('accept-all summary missing: ' + summary(any));
      }
      if (!any.querySelector('.item-frame-image')) errors.push('static wildcard box background did not draw');
      if (pc.dataset.itemBoxIndex !== '5'
        || pc.dataset.itemBoxAllowedStdModes !== '5,6'
        || pc.dataset.itemBoxAcceptsAnyStdMode !== 'false') {
        errors.push('996PC boxindex/stdmode datasets missing');
      }
      if (!/OK框\\s*5|编号[：:]?\\s*5/.test(summary(pc))
        || !/允许\\s*StdMode[：:]?\\s*5[、,，]\\s*6/i.test(summary(pc))
        || !/70\\s*[×xX]\\s*72/.test(summary(pc))) {
        errors.push('996PC visible constraint summary incomplete: ' + summary(pc));
      }
      if (!pc.querySelector('.item-frame-image')) errors.push('996PC background did not draw');
      if (errors.length) throw new Error(errors.join('; '));
    });

    await check('tips and runtime-data boundary are visible but no runtime is forged', async function () {
      var limited = node('ITEMBOX_LIMITED');
      var pc = node('ITEMBOX_PC');
      var readyCount = window.__postedMessages.length;
      limited.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 30, clientY: 40 }));
      await wait(20);
      var tooltip = document.querySelector('.dialog-tooltip:not(.hidden)');
      if (!tooltip || !/只允许衣服/.test(tooltip.textContent)
        || !/运行时校验/.test(tooltip.textContent)) {
        throw new Error('traditional tips were not retained: ' + (tooltip ? tooltip.textContent : '<none>'));
      }
      limited.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      pc.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 250, clientY: 40 }));
      await wait(20);
      tooltip = document.querySelector('.dialog-tooltip:not(.hidden)');
      if (!tooltip || !/只能放武器/.test(tooltip.textContent)) {
        throw new Error('996PC tips were not retained');
      }
      for (var wrapper of [limited, node('ITEMBOX_ANY'), pc]) {
        var boundary = wrapper.querySelector('.itembox-runtime-boundary');
        var boundaryText = boundary ? boundary.textContent : text(wrapper);
        if (!boundary || !/Runtime-data blocked/i.test(boundaryText)
          || !/实际拖入/.test(boundaryText)
          || !/人物背包/.test(boundaryText)
          || !/服务器.*接受.*拒绝|服务器.*拒绝.*接受/.test(boundaryText)) {
          throw new Error(wrapper.dataset.elementId + ' runtime boundary is incomplete: ' + boundaryText);
        }
        if (wrapper.draggable || wrapper.querySelector('[draggable="true"], form, .runtime-action-hitarea')) {
          throw new Error(wrapper.dataset.elementId + ' forged a real drag/server action');
        }
      }
      if (window.__postedMessages.length !== readyCount) {
        throw new Error('hover/runtime boundary posted an extension or server action');
      }
    });

    await check('dynamic and invalid constraints are blocked without borrowing MOV values', async function () {
      var dynamic = node('ITEMBOX_DYNAMIC');
      var invalid = node('ITEMBOX_INVALID');
      var pcInvalid = node('ITEMBOX_PC_INVALID');
      if (dynamic.dataset.itemBoxConstraintState !== 'dynamic'
        || !/boxindex/.test(dynamic.dataset.itemBoxDynamicFields || '')
        || !/background/.test(dynamic.dataset.itemBoxDynamicFields || '')
        || !/stdmode/.test(dynamic.dataset.itemBoxDynamicFields || '')) {
        throw new Error('dynamic constraint metadata missing');
      }
      if (/OK框\\s*6/.test(text(dynamic))
        || /10[、,，]\\s*11/.test(summary(dynamic))
        || dynamic.dataset.itemBoxIndex === '6'
        || dynamic.dataset.itemBoxAllowedStdModes === '10,11') {
        throw new Error('dynamic ITEMBOX borrowed MOV values');
      }
      if (dynamic.querySelector('.item-frame-image')) {
        throw new Error('dynamic F borrowed MOV N$BOX_F=2 and drew a background');
      }
      if (!/动态/.test(text(dynamic)) || !/不借用|当前值/.test(text(dynamic))) {
        throw new Error('dynamic source-safety boundary is not visible');
      }
      if (invalid.dataset.itemBoxConstraintState !== 'invalid'
        || !/boxindex/.test(invalid.dataset.itemBoxInvalidFields || '')
        || !/background/.test(invalid.dataset.itemBoxInvalidFields || '')
        || !/stdmode/.test(invalid.dataset.itemBoxInvalidFields || '')
        || invalid.querySelector('.item-frame-image')) {
        throw new Error('invalid traditional fields/background were not blocked');
      }
      if (pcInvalid.dataset.itemBoxConstraintState !== 'invalid'
        || pcInvalid.dataset.itemBoxAcceptsAnyStdMode === 'true'
        || !/无效/.test(text(pcInvalid))) {
        throw new Error('invalid 996PC wildcard mix was presented as accept-all');
      }
    });

    document.body.dataset.itemboxDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.itemboxTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.itemboxErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.itemboxTest = 'fail';
    document.body.dataset.itemboxErrors = '[dom] scenario: '
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
        && /data-itembox-test=/i.test(result.stdout || '')) {
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
      console.log(`itembox-constraints-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-itembox-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`itembox-constraints-browser.test.js: browser=${selected.candidate}`);
    console.log(`itembox-constraints-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`itembox-constraints-browser.test.js: DOM=${domCount}`);
    const encoded = /data-itembox-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    if (!/data-itembox-test="pass"/.test(selected.result.stdout)) {
      return decodeAttribute(encoded).split(' || ').filter(Boolean);
    }
    return [];
  } finally {
    if (process.env.BOO_KEEP_ITEMBOX_TEST_TEMP === '1') {
      console.log(`itembox-constraints-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

const failures = runBrowserMatrix();
if (failures.length > 0) {
  console.error('itembox-constraints-browser.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('itembox-constraints-browser.test.js: PASS');
}
