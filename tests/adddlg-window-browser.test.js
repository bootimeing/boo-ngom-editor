const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');

function findBrowsers() {
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

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function fixtureModel() {
  const addDlgWindow = {
    id: 'adddlg-window-1',
    dialogId: 1,
    raw: 'AddDlg 1 1 440 0 10:20 30:40 9 @QF脚本字段 0:0 1:2:2:1:300',
    lineNumber: 3,
    sourceRange: { start: 14, end: 83, original: 'AddDlg 1 1 440' },
    assetRef: { willIndex: 1, imageIndex: 440 },
    asset: {
      status: 'ready',
      url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzNwAAAABJRU5ErkJggg==',
      archiveLabel: 'GOM.pak/000440',
      width: 220,
      height: 120,
      offsetX: -2,
      offsetY: 3,
    },
    movable: false,
    windowX: 10,
    windowY: 20,
    textOffsetX: 30,
    textOffsetY: 40,
    createPosition: 9,
    createPositionLabel: '包裹',
    qfTarget: '@QF脚本字段',
    parentSyncMove: false,
    refreshCoordinates: false,
    groupId: 1,
    displayMode: 2,
    popupDirection: 2,
    closeOnLeave: true,
    closeDelayMs: 300,
    closeActions: [{ dialogId: 1, sourceLabel: '@关闭', lineNumber: 10, dynamic: false }],
    dynamicFields: [],
    invalidFields: [],
    warnings: ['渐缓弹出只做静态预览'],
  };
  const flow = {
    id: 'qf-flow-text',
    statementId: 'flow-text',
    token: '<文字>',
    description: '传统 NPC 流式文字',
    kind: 'text',
    raw: '任务说明',
    lineNumber: 6,
    sourceRange: { start: 100, end: 104, original: '任务说明' },
    coordinateMode: 'flow',
    sourceCoordinateBiasX: 0,
    sourceCoordinateBiasY: 0,
    editable: false,
    localLayoutX: 18,
    localLayoutY: 24,
    layoutX: 18,
    layoutY: 24,
    width: 48,
    height: 20,
    text: '任务说明',
  };
  const page = {
    id: 'PAGE:@QF脚本字段',
    title: '@QF脚本字段',
    sourceLabel: '@QF脚本字段',
    conditionSummary: '默认界面',
    conditionGroupIds: [],
    activeBranchIds: [],
    addDlgWindow,
    elements: [flow],
    unsupportedStatements: [],
    warnings: [...addDlgWindow.warnings],
    resolvedVariables: [],
  };
  return {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/adddlg.txt',
    fileName: 'adddlg.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\adddlg.txt',
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: 'GOM',
    functionLabel: '@main',
    functionStart: 0,
    functionEnd: 120,
    offsets: { memoX: 0, memoY: 0, menuX: 0, menuY: 0, source: 'default', configured: true },
    canvasWidth: 800,
    canvasHeight: 600,
    conditionGroups: [],
    scenes: [{ ...page, marker: 'STATIC', conditions: [], conditionOperators: [], previewPath: {}, sourceStart: 90, sourceEnd: 120 }],
    pages: [page],
    warnings: [...addDlgWindow.warnings],
  };
}

function main() {
  const browsers = findBrowsers();
  if (browsers.length === 0) {
    console.log('adddlg-window-browser.test.js: SKIP (Chromium browser not found)');
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-adddlg-browser-'));
  const profile = path.join(temporary, 'profile');
  const harness = path.join(temporary, 'adddlg-window.html');
  try {
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.acquireVsCodeApi = function () {
  return { postMessage: function (message) {
    if (message.type !== 'ready') return;
    setTimeout(function () {
      window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'model', model: window.__model, previewRevision: 1,
        preserveDrafts: false, geeOffsetHelp: ''
      }}));
    }, 0);
  }};
};
</script>`;
    html = html.replace(`<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`,
      `${mock}<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`);
    const scenario = `<script>
(function () {
  function px(value) { return Number(String(value || '').replace('px', '')); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  async function run() {
    for (var attempt = 0; attempt < 100; attempt++) {
      if (document.querySelector('.adddlg-window')) break;
      await wait(30);
    }
    var panel = document.querySelector('.adddlg-window[data-dialog-id="1"]');
    if (!panel) throw new Error('AddDlg window missing');
    if (px(panel.style.left) !== 10 || px(panel.style.top) !== 20) throw new Error('window origin incorrect');
    if (px(panel.style.width) !== 220 || px(panel.style.height) !== 120) throw new Error('window asset size incorrect');
    if (!panel.querySelector('img.adddlg-background-image')) throw new Error('hydrated background missing');
    var origin = panel.querySelector('.adddlg-content-origin');
    if (!origin || px(origin.style.left) !== 30 || px(origin.style.top) !== 40) throw new Error('text offset marker incorrect');
    var text = document.querySelector('[data-element-id="qf-flow-text"]');
    if (!text || px(text.style.left) !== 40 || px(text.style.top) !== 60) throw new Error('QF flow content offset incorrect');
    if (panel.dataset.partialSimulation !== 'true') throw new Error('partial-simulation boundary missing');
    if (panel.dataset.createPositionLabel !== '包裹') throw new Error('create-position state missing');
    if (panel.dataset.displayMode !== '2' || panel.dataset.popupDirection !== '2') throw new Error('popup state missing');
    if (!panel.textContent.includes('Partial simulation') || !panel.textContent.includes('DelDlg')) throw new Error('static status missing');
    if (document.getElementById('dialogCanvas').textContent.includes('AddDlg 1 1 440')) throw new Error('AddDlg command leaked into canvas');
    document.body.dataset.adddlgTest = 'pass';
  }
  run().catch(function (error) {
    document.body.dataset.adddlgTest = 'fail';
    document.body.dataset.adddlgError = error && error.stack ? error.stack : String(error);
  });
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    let result;
    for (let index = 0; index < browsers.length; index++) {
      result = spawnSync(browsers[index], [
        '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
        '--allow-file-access-from-files', `--user-data-dir=${path.join(profile, String(index))}`,
        '--window-size=1200,800', '--virtual-time-budget=5000', '--dump-dom',
        pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
      if (result.status === 0 && result.stdout) break;
    }
    assert.equal(result.status, 0, result.stderr || 'Chromium failed');
    assert.match(result.stdout, /data-adddlg-test="pass"/, result.stdout.match(/data-adddlg-error="[^"]*/)?.[0]);
  } finally {
    removeTemporaryDirectory(temporary);
  }
  console.log('adddlg-window-browser.test.js: PASS');
}

main();
