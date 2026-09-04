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
const EXTERNAL_FILE = 'D:\\lfm-dialog\\d.txt';
const DYNAMIC_FIELDS = [
  'resource', 'backgroundImage', 'movable', 'windowOrigin',
  'textOffset', 'createPosition', 'content',
];

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

function fixtureModel() {
  // The action parser is gated independently by gee-adddlg.test.js. This browser
  // fixture supplies the evidence-bounded typed contract directly so renderer
  // failures remain observable even while engine=GEE currently skips the actions.
  const contentSource = [
    '[@inline]',
    '#SAY',
    '>浏览器行内内容|253#第二行\\<按钮/@1>',
  ].join('\n');
  const model = parseNpcDialogDocument(contentSource, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/gee-adddlg-browser.txt',
    fileName: 'gee-adddlg-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\gee-adddlg-browser.txt',
    documentVersion: 1,
    engine: 'GEE',
    engineLabel: '翎风引擎',
    cursorOffset: contentSource.indexOf('#SAY') + 4,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GEE'),
  });

  const inlineElements = model.pages[0].elements;
  const inlineText = inlineElements.find(element => /浏览器行内内容/.test(element.text || ''));
  if (inlineText) inlineText.id = 'GEE_ADDDLG_INLINE_TEXT';
  const common = {
    lineNumber: 12,
    sourceRange: { start: 100, end: 180, original: '' },
    parentSyncMove: undefined,
    refreshCoordinates: undefined,
    groupId: 0,
    displayMode: 0,
    popupDirection: 0,
    closeOnLeave: false,
    closeDelayMs: 300,
    closeActions: [],
    invalidFields: [],
  };
  const inlineWindow = {
    ...common,
    id: 'GEE:ADDDLG:11',
    command: 'ADDDLG',
    dialogId: 11,
    raw: 'ADDDLG 11 1 440 1 10:20 30:40 22 >浏览器行内内容|253#第二行\\<按钮/@1>',
    assetRef: { willIndex: 1, imageIndex: 440 },
    asset: {
      status: 'ready',
      url: `${pixel}#LFM-ADDDLG-11`,
      archiveLabel: 'LFM/000440',
      width: 240,
      height: 130,
      offsetX: -2,
      offsetY: 3,
    },
    movable: true,
    windowX: 10,
    windowY: 20,
    textOffsetX: 30,
    textOffsetY: 40,
    createPosition: 22,
    createPositionLabel: '宠物界面',
    contentPreview: {
      mode: 'inline',
      raw: '>浏览器行内内容|253#第二行\\<按钮/@1>',
      status: 'static',
    },
    dynamicFields: [],
    warnings: [
      'Partial simulation：只绘制 LFM ADDDLG 静态几何；不执行客户端宿主附着和真实移动',
    ],
  };
  const externalWindow = {
    ...common,
    id: 'GEE:ADDDLGEX:12',
    command: 'ADDDLGEX',
    dialogId: 12,
    raw: `ADDDLGEX 12 1 441 0 110:120 31:41 43 ${EXTERNAL_FILE} 1`,
    assetRef: { willIndex: 1, imageIndex: 441 },
    asset: {
      status: 'ready',
      url: `${pixel}#LFM-ADDDLG-12`,
      archiveLabel: 'LFM/000441',
      width: 260,
      height: 140,
      offsetX: 4,
      offsetY: -5,
    },
    movable: false,
    windowX: 110,
    windowY: 120,
    textOffsetX: 31,
    textOffsetY: 41,
    createPosition: 43,
    createPositionLabel: '可视化无限仓库',
    contentPreview: {
      mode: 'external-file',
      raw: EXTERNAL_FILE,
      absolute: true,
      status: 'evidence-blocked',
    },
    dynamicFields: [],
    warnings: [
      'Partial simulation：只绘制 LFM ADDDLGEX 静态窗口和宿主位置',
      `Evidence-blocked：外部文件 ${EXTERNAL_FILE} 的客户端解码和生命周期未公开，Ctrl+F12 不读取、不加载或执行该文件`,
    ],
  };
  const dynamicWindow = {
    ...common,
    id: 'GEE:ADDDLG:13',
    command: 'ADDDLG',
    dialogId: 13,
    raw: 'ADDDLG 13 <$STR(N1)> <$STR(N2)> <$STR(N3)> '
      + '<$STR(N4)>:<$STR(N5)> <$STR(N6)>:<$STR(N7)> '
      + '<$STR(N8)> <$STR(S1)>',
    movable: undefined,
    windowX: undefined,
    windowY: undefined,
    textOffsetX: undefined,
    textOffsetY: undefined,
    createPosition: undefined,
    contentPreview: {
      mode: 'inline',
      raw: '<$STR(S1)>',
      status: 'dynamic',
    },
    dynamicFields: [...DYNAMIC_FIELDS],
    warnings: [
      `ADDDLG 的 ${DYNAMIC_FIELDS.join('、')} 是动态/运行时字段，静态预览不借用 MOV 当前值`,
      'Partial simulation：未知几何只显示不确定位置窗口，不执行客户端动作',
    ],
  };

  const baseScene = model.scenes[0];
  function scene(id, sourceLabel, window, elements) {
    return {
      ...baseScene,
      id,
      title: sourceLabel,
      sourceLabel,
      marker: 'STATIC',
      conditions: [],
      conditionOperators: [],
      previewPath: {},
      conditionSummary: '默认界面',
      conditionGroupId: undefined,
      sourceStart: 0,
      sourceEnd: contentSource.length,
      addDlgWindow: window,
      elements,
      unsupportedStatements: [],
      warnings: [...window.warnings],
      resolvedVariables: [],
    };
  }
  model.functionLabel = '@main';
  model.conditionGroups = [];
  model.addDlgWindows = [inlineWindow, externalWindow, dynamicWindow];
  model.scenes = [
    scene('GEE:SCENE:11', '@LFM-ADDDLG-11', inlineWindow, inlineElements),
    scene('GEE:SCENE:12', '@LFM-ADDDLGEX-12', externalWindow, []),
    scene('GEE:SCENE:13', '@LFM-ADDDLG-13-DYNAMIC', dynamicWindow, []),
  ];
  model.warnings = [...new Set(model.addDlgWindows.flatMap(window => window.warnings))];
  reflowNpcDialogLayout(model);
  model.canvasWidth = Math.max(model.canvasWidth || 0, 760);
  model.canvasHeight = Math.max(model.canvasHeight || 0, 520);
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
    if (process.env.BOO_REQUIRE_REAL_BROWSER === '1') {
      return ['[browser] BOO_REQUIRE_REAL_BROWSER=1 but Edge/Chrome is not installed'];
    }
    console.log('gee-adddlg-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-gee-adddlg-browser-'));
  try {
    const harness = path.join(temporary, 'gee-adddlg.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.__postedMessages = [];
window.__externalLoads = [];
window.__windowActions = [];
window.open = function () { window.__externalLoads.push('window.open:' + Array.from(arguments).join('|')); return null; };
window.moveTo = function () { window.__windowActions.push('moveTo'); };
window.resizeTo = function () { window.__windowActions.push('resizeTo'); };
window.close = function () { window.__windowActions.push('close'); };
if (window.fetch) {
  window.fetch = function () {
    window.__externalLoads.push('fetch:' + Array.from(arguments).join('|'));
    return Promise.reject(new Error('network/file fetch blocked by test harness'));
  };
}
if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
  var originalXhrOpen = window.XMLHttpRequest.prototype.open;
  window.XMLHttpRequest.prototype.open = function (method, url) {
    window.__externalLoads.push('xhr:' + method + ':' + url);
    return originalXhrOpen.apply(this, arguments);
  };
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
  var requiredDynamicFields = ${JSON.stringify(DYNAMIC_FIELDS)};
  function px(value) { return Number(String(value || '').replace('px', '')); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function panel(id) { return document.querySelector('.adddlg-window[data-dialog-id="' + id + '"]'); }
  function boundary(node) {
    return [node && node.title, node && node.getAttribute('aria-label'),
      node && node.textContent].filter(Boolean).join(' ');
  }
  function pageLabel(id) {
    var page = (window.__model.pages || []).find(function (candidate) {
      return candidate.addDlgWindow && candidate.addDlgWindow.dialogId === id;
    });
    return page && page.sourceLabel;
  }
  async function selectDialog(id) {
    var label = pageLabel(id);
    if (!label) throw new Error('typed page missing for dialog ' + id);
    var button = Array.from(document.querySelectorAll('#sceneList .scene-button')).find(function (candidate) {
      return candidate.querySelector('strong') && candidate.querySelector('strong').textContent === label;
    });
    if (!button) throw new Error('scene button missing for dialog ' + id + ' label=' + label);
    button.click();
    for (var attempt = 0; attempt < 40 && !panel(id); attempt++) await wait(20);
    if (!panel(id)) throw new Error('window did not render after selecting dialog ' + id);
    return panel(id);
  }
  async function check(name, callback) {
    try { await callback(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }

  async function run() {
    for (var attempt = 0; attempt < 60 && !panel(11); attempt++) await wait(20);

    await check('LFM ADDDLG exposes typed inline metadata', async function () {
      var wrapper = await selectDialog(11);
      if (wrapper.dataset.adddlgCommand !== 'ADDDLG'
        || wrapper.dataset.adddlgContentMode !== 'inline') {
        throw new Error('typed LFM inline metadata missing: command='
          + wrapper.dataset.adddlgCommand + ', mode=' + wrapper.dataset.adddlgContentMode);
      }
    });

    await check('LFM ADDDLG draws background geometry and translated inline content', async function () {
      var wrapper = await selectDialog(11);
      if (px(wrapper.style.left) !== 10 || px(wrapper.style.top) !== 20
        || px(wrapper.style.width) !== 240 || px(wrapper.style.height) !== 130) {
        throw new Error('window/background geometry=' + [wrapper.style.left, wrapper.style.top,
          wrapper.style.width, wrapper.style.height].join(','));
      }
      var image = wrapper.querySelector('img.adddlg-background-image');
      if (!image || px(image.style.left) !== -2 || px(image.style.top) !== 3) {
        throw new Error('hydrated LFM background or archive offsets missing');
      }
      var origin = wrapper.querySelector('.adddlg-content-origin');
      if (!origin || px(origin.style.left) !== 30 || px(origin.style.top) !== 40) {
        throw new Error('inline content origin is not 30,40');
      }
      var text = document.querySelector('[data-element-id="GEE_ADDDLG_INLINE_TEXT"]');
      if (!text || !/浏览器行内内容/.test(text.textContent)
        || px(text.style.left) !== 40 || px(text.style.top) !== 60) {
        throw new Error('inline child was not translated from window + content origin');
      }
      if (wrapper.dataset.createPositionLabel !== '宠物界面'
        || wrapper.dataset.partialSimulation !== 'true') {
        throw new Error('LFM host-position/partial-simulation metadata missing');
      }
      if (/ADDDLG\s+11/i.test(document.getElementById('dialogCanvas').textContent)) {
        throw new Error('raw ADDDLG action leaked into canvas text');
      }
    });

    await check('LFM ADDDLG shows the host-runtime boundary', async function () {
      var wrapper = await selectDialog(11);
      var textBoundary = boundary(wrapper);
      if (!/Partial simulation/i.test(textBoundary)
        || !/静态几何/.test(textBoundary) || !/宿主|客户端/.test(textBoundary)) {
        throw new Error('visible host-runtime boundary missing: ' + textBoundary);
      }
    });

    await check('LFM ADDDLGEX exposes typed external-file metadata', async function () {
      var wrapper = await selectDialog(12);
      if (wrapper.dataset.adddlgCommand !== 'ADDDLGEX'
        || wrapper.dataset.adddlgContentMode !== 'external-file'
        || wrapper.dataset.adddlgContentStatus !== 'evidence-blocked'
        || wrapper.dataset.adddlgExternalAbsolute !== 'true') {
        throw new Error('ADDDLGEX typed metadata missing: ' + JSON.stringify(wrapper.dataset));
      }
      if (!/d:\\\\lfm-dialog\\\\d\.txt/i.test(wrapper.dataset.adddlgExternalPath || '')) {
        throw new Error('ADDDLGEX file name/path is not visible in DOM metadata');
      }
    });

    await check('LFM ADDDLGEX draws its independent static geometry', async function () {
      var wrapper = await selectDialog(12);
      if (px(wrapper.style.left) !== 110 || px(wrapper.style.top) !== 120
        || px(wrapper.style.width) !== 260 || px(wrapper.style.height) !== 140) {
        throw new Error('ADDDLGEX static window geometry is wrong');
      }
      var origin = wrapper.querySelector('.adddlg-content-origin');
      if (!origin || px(origin.style.left) !== 31 || px(origin.style.top) !== 41) {
        throw new Error('ADDDLGEX content origin is not 31,41');
      }
    });

    await check('LFM ADDDLGEX keeps external content Evidence-blocked', async function () {
      var wrapper = await selectDialog(12);
      var textBoundary = wrapper.querySelector('.adddlg-runtime-boundary')?.textContent || '';
      if (!/Evidence-blocked/i.test(textBoundary)
        || !/外部文件|文件内容|ADDDLGEX/i.test(textBoundary)
        || !/不读取|不加载|不执行|未读取/.test(textBoundary)) {
        throw new Error('visible external-file evidence boundary missing: ' + textBoundary);
      }
      var attempted = Array.from(wrapper.querySelectorAll('[src], [style]')).some(function (node) {
        return /lfm-dialog|d\.txt/i.test((node.getAttribute('src') || '') + (node.getAttribute('style') || ''));
      });
      if (attempted || window.__externalLoads.some(function (entry) { return /lfm-dialog|d\.txt/i.test(entry); })) {
        throw new Error('ADDDLGEX external content was loaded or converted into a resource URL');
      }
    });

    await check('dynamic LFM ADDDLG exposes every dynamic field in the DOM', async function () {
      var wrapper = await selectDialog(13);
      var fields = new Set(String(wrapper.dataset.adddlgDynamicFields || '').split(',').filter(Boolean));
      var missing = requiredDynamicFields.filter(function (field) { return !fields.has(field); });
      if (missing.length) throw new Error('dynamic DOM fields missing=' + missing.join(','));
    });

    await check('dynamic LFM ADDDLG stays visible without borrowing MOV values', async function () {
      var wrapper = await selectDialog(13);
      if (wrapper.dataset.positionKnown !== 'false' || wrapper.dataset.textOffsetKnown !== 'false') {
        throw new Error('dynamic geometry was presented as statically known');
      }
      if (px(wrapper.style.left) === 333 || px(wrapper.style.top) === 444
        || wrapper.querySelector('img.adddlg-background-image')) {
        throw new Error('dynamic window borrowed MOV geometry or WIL/image values');
      }
      var textBoundary = wrapper.querySelector('.adddlg-runtime-boundary')?.textContent || '';
      if (!/动态|运行时/.test(textBoundary)
        || !/不借用.*当前值|当前值.*不借用/.test(textBoundary)
        || !/Partial simulation/i.test(textBoundary)) {
        throw new Error('dynamic source-safety boundary missing: ' + textBoundary);
      }
      if (/777|浏览器不应借用的当前内容/.test(wrapper.textContent)) {
        throw new Error('dynamic renderer exposed a temporary MOV value');
      }
    });

    await check('window metadata never executes host/server runtime actions', async function () {
      var before = window.__postedMessages.length;
      var wrapper = panel(13) || panel(12) || panel(11);
      if (!wrapper) throw new Error('no typed LFM window rendered; runtime non-execution is unverified');
      wrapper.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      wrapper.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(60);
      var emitted = window.__postedMessages.slice(before).map(function (message) { return message.type; });
      if (emitted.length || window.__windowActions.length || window.__externalLoads.length) {
        throw new Error('static preview executed runtime actions: messages=' + emitted.join(',')
          + ', window=' + window.__windowActions.join(',')
          + ', loads=' + window.__externalLoads.join(','));
      }
    });

    document.body.dataset.geeAdddlgDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.geeAdddlgTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.geeAdddlgErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.geeAdddlgTest = 'fail';
    document.body.dataset.geeAdddlgErrors = '[dom] scenario: '
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
        '--window-size=1100,760',
        '--virtual-time-budget=2600',
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
        && /data-gee-adddlg-test=/i.test(result.stdout || '')) {
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
      console.log(`gee-adddlg-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-gee-adddlg-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`gee-adddlg-browser.test.js: browser=${selected.candidate}`);
    console.log(`gee-adddlg-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`gee-adddlg-browser.test.js: DOM=${domCount}`);
    const encoded = /data-gee-adddlg-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    if (!/data-gee-adddlg-test="pass"/.test(selected.result.stdout)) {
      return decodeAttribute(encoded).split(' || ').filter(Boolean);
    }
    return [];
  } finally {
    if (process.env.BOO_KEEP_GEE_ADDDLG_TEST_TEMP === '1') {
      console.log(`gee-adddlg-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

const failures = runBrowserMatrix();
if (failures.length > 0) {
  console.error('gee-adddlg-browser.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('gee-adddlg-browser.test.js: PASS');
}
