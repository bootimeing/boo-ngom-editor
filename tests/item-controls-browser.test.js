const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzNwAAAABJRU5ErkJggg==';

function browsers() {
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

function readyAsset(label, width, height) {
  return { status: 'ready', url: pixel, archiveLabel: label, width, height, offsetX: 0, offsetY: 0 };
}

function element(id, x, y, overrides) {
  return {
    id, statementId: id, token: '<ItemShow>', description: id, kind: 'item', raw: id,
    lineNumber: 1, sourceRange: { start: 0, end: 1, original: id }, coordinateMode: 'absolute',
    sourceCoordinateBiasX: 0, sourceCoordinateBiasY: 0, editable: false,
    localLayoutX: x, localLayoutY: y, layoutX: x, layoutY: y, width: 40, height: 40,
    sizePreview: {
      width: { mode: 'default', baseValue: 40 },
      height: { mode: 'default', baseValue: 40 },
    },
    ...overrides,
  };
}

function fixtureModel() {
  const half = element('ITEM_HALF', 10, 10, {
    itemPreview: { mode: 'database-index', itemIndex: 1927, label: '物品 IDX 1927', scale: 0.5, showTips: true },
    assetLayers: [
      { role: 'background', assetRef: { archiveName: 'NewopUI', imageIndex: 47 }, asset: readyAsset('frame', 40, 40) },
      { role: 'item', assetRef: { archiveName: 'Items', imageIndex: 1 }, asset: readyAsset('item', 34, 34) },
    ],
    tooltipPreview: {
      raw: '物品 IDX 1927', kind: 'item', offsetX: 0, offsetY: 0, itemIndex: 1927,
      lines: [
        [{ text: '数据库基础属性预览' }], [{ text: '名称 承影' }],
        [{ text: 'StdMode 5' }], [{ text: '运行时极品、鉴定、强化属性不在静态预览中' }],
      ],
    },
  });
  const noFrame = element('ITEM_NO_FRAME', 60, 10, {
    itemPreview: { mode: 'database-index', itemIndex: 1927, label: '物品 IDX 1927', scale: 1.5, showTips: false },
    assetLayers: [
      { role: 'item', assetRef: { archiveName: 'Items', imageIndex: 1 }, asset: readyAsset('item', 34, 34) },
    ],
  });
  const grid = element('GRID_RUNTIME', 10, 90, {
    kind: 'container', width: 166, height: 82,
    containerPreview: {
      variant: 'item-grid', label: '人物背包物品列表', gridSource: 'character-bag',
      filterCondition: '5#6,10#*', selectedUniqueIds: ['1001', '1002'], selectionMode: 'multi',
      showTips: true, showStar: true, filterStar: true, starLevel: 3, starCondition: 0,
      excludedUniqueIds: ['1002'], excludedItemIds: ['1927'], excludedItemNames: ['屠龙'],
      includedItemRefs: ['1927', '测试物品'], excludeBound: true,
      cellCount: 8, rows: 2, columns: 4, cellWidth: 40, cellHeight: 40, cellGap: 2,
    },
  });
  const gridNoTips = element('GRID_NO_TIPS', 200, 90, {
    kind: 'container', width: 40, height: 40,
    containerPreview: {
      variant: 'item-grid', label: '英雄装备物品列表', gridSource: 'hero-equipment',
      equipmentPositions: '0#1', selectionMode: 'single', showTips: false, showStar: false,
      cellCount: 1, rows: 1, columns: 1, cellWidth: 40, cellHeight: 40, cellGap: 2,
    },
  });
  const elements = [half, noFrame, grid, gridNoTips];
  const page = {
    id: 'PAGE:@main', title: '@main', sourceLabel: '@main', conditionSummary: '默认界面',
    conditionGroupIds: [], activeBranchIds: [], elements, unsupportedStatements: [], warnings: [], resolvedVariables: [],
  };
  return {
    uri: 'file:///D:/MirServer/item-test.txt', fileName: 'item-test.txt', filePath: 'D:\\MirServer\\item-test.txt',
    documentVersion: 1, engine: '996PC', engineLabel: '996PC', functionLabel: '@main',
    functionStart: 0, functionEnd: 1,
    offsets: { memoX: 0, memoY: 0, menuX: 0, menuY: 0, source: 'default', configured: true },
    canvasWidth: 800, canvasHeight: 600, conditionGroups: [],
    scenes: [{ ...page, marker: '#SAY', conditions: [], conditionOperators: [], previewPath: {}, sourceStart: 0, sourceEnd: 1 }],
    pages: [page], warnings: [],
  };
}

function resourceUri(relative) {
  return pathToFileURL(path.join(root, ...relative.split('/'))).href;
}

function main() {
  const candidates = browsers();
  if (candidates.length === 0) {
    console.log('item-controls-browser.test.js: SKIP (Edge/Chrome not found)');
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-item-controls-browser-'));
  try {
    const harness = path.join(temporary, 'item-controls.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.acquireVsCodeApi = function () { return { postMessage: function (message) {
  if (message.type === 'ready') setTimeout(function () { window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'model', model: window.__model, previewRevision: 1, preserveDrafts: false, geeOffsetHelp: ''
  }})); }, 0);
}}; };
</script>`;
    html = html.replace(`<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`,
      `${mock}<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`);
    const scenario = `<script>
(function () {
  function px(value) { return Number(String(value || '').replace('px', '')); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  async function run() {
    for (var attempt = 0; attempt < 100 && !node('ITEM_HALF'); attempt++) await wait(20);
    var half = node('ITEM_HALF');
    var halfFrame = half && half.querySelector('.item-frame-image');
    var halfItem = half && half.querySelector('.item-content-image');
    if (!half || px(half.style.width) !== 20 || px(half.style.height) !== 20) throw new Error('scale=0.5 wrapper geometry incorrect');
    if (!halfFrame || px(halfFrame.style.width) !== 20 || px(halfFrame.style.height) !== 20) throw new Error('scale=0.5 frame geometry incorrect');
    if (!halfItem || px(halfItem.style.width) !== 17 || px(halfItem.style.height) !== 17
      || px(halfItem.style.left) !== 2 || px(halfItem.style.top) !== 2) throw new Error('scale=0.5 item centering incorrect');
    var noFrame = node('ITEM_NO_FRAME');
    var noFrameItem = noFrame && noFrame.querySelector('.item-content-image');
    if (!noFrame || px(noFrame.style.width) !== 51 || px(noFrame.style.height) !== 51) throw new Error('bgtype=0 wrapper scale incorrect');
    if (!noFrameItem || px(noFrameItem.style.width) !== 51 || px(noFrameItem.style.height) !== 51
      || px(noFrameItem.style.left) !== 0 || px(noFrameItem.style.top) !== 0) throw new Error('bgtype=0 item was scaled or centered twice');

    half.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 20, clientY: 20 }));
    await wait(20);
    var tooltip = document.querySelector('.dialog-tooltip:not(.hidden)');
    if (!tooltip || !tooltip.textContent.includes('数据库基础属性预览') || !tooltip.textContent.includes('承影')) {
      throw new Error('showtips=1 database hover tooltip missing');
    }
    half.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

    var grid = node('GRID_RUNTIME');
    if (!grid || grid.dataset.gridSource !== 'character-bag' || grid.dataset.gridSelectionMode !== 'multi'
      || grid.dataset.gridShowTips !== 'true' || grid.dataset.gridShowStar !== 'true') throw new Error('typed grid dataset missing');
    if (!grid.textContent.includes('人物背包') || !grid.textContent.includes('运行时')
      || !grid.textContent.includes('5#6,10#*') || !grid.textContent.includes('1001')) throw new Error('grid configuration/runtime boundary not visible');
    var cells = grid.querySelectorAll('.item-grid-cell');
    if (cells.length !== 8 || cells[0].dataset.runtimeTooltip !== 'true' || !cells[0].textContent.includes('☆?')) {
      throw new Error('grid runtime cells/star boundary missing');
    }
    cells[0].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 30, clientY: 120 }));
    await wait(20);
    tooltip = document.querySelector('.dialog-tooltip:not(.hidden)');
    if (!tooltip || !tooltip.textContent.includes('运行时背包') || !tooltip.textContent.includes('无法离线还原')) {
      throw new Error('grid showtips runtime hover boundary missing');
    }
    var noTipsCell = node('GRID_NO_TIPS').querySelector('.item-grid-cell');
    if (noTipsCell.dataset.runtimeTooltip) throw new Error('showtips=0 must suppress grid runtime tooltip');
    document.body.dataset.itemControlsTest = 'pass';
  }
  run().catch(function (error) {
    document.body.dataset.itemControlsTest = 'fail';
    document.body.dataset.itemControlsError = error && error.stack ? error.stack : String(error);
  });
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let result;
    for (let index = 0; index < candidates.length; index++) {
      const attempt = spawnSync(candidates[index], [
        '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
        '--allow-file-access-from-files', `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1200,800', '--virtual-time-budget=6000', '--dump-dom', pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 20000, maxBuffer: 10 * 1024 * 1024 });
      attempts.push({ candidate: candidates[index], attempt });
      if (!attempt.error && attempt.status === 0 && /<body\b/i.test(attempt.stdout || '')) {
        result = attempt;
        break;
      }
    }
    assert.ok(result, attempts.map(({ candidate, attempt }) => `${candidate}: ${attempt.status} ${attempt.stderr || ''}`).join('\n'));
    const error = /data-item-controls-error="([^"]*)/.exec(result.stdout)?.[1];
    assert.match(result.stdout, /data-item-controls-test="pass"/, error);
  } finally {
    removeTemporaryDirectory(temporary);
  }
  console.log('item-controls-browser.test.js: PASS');
}

main();
