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

function findEdge() {
  const candidates = [
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

function firstCachedPng() {
  const cacheRoot = path.join(
    process.env.LOCALAPPDATA || '',
    'BOO-NGOM-Editor',
    'cache',
    'patch-cache'
  );
  if (!fs.existsSync(cacheRoot)) return undefined;
  const stack = [cacheRoot];
  let visited = 0;
  while (stack.length > 0 && visited < 50000) {
    const current = stack.pop();
    visited++;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && /\.png$/i.test(entry.name)) return fullPath;
      if (entry.isDirectory()) stack.push(fullPath);
    }
  }
  return undefined;
}

function parseModel(source, conditionStates) {
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/dom-test.txt',
    fileName: 'dom-test.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\dom-test.txt',
    documentVersion: 9,
    engine: 'GOM',
    engineLabel: 'GOM引擎',
    cursorOffset: source.indexOf('[@main]') + 7,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
    conditionStates,
  });
}

function hydrateDomFixture(model, imageUrl) {
  const all = model.scenes.flatMap(scene => scene.elements);
  for (const element of all) {
    if (element.statementId === 'item-show') {
      const background = element.assetLayers.find(layer => layer.role === 'background');
      background.asset = {
        status: 'ready', url: imageUrl, archiveLabel: 'NewopUI.Pak/000047',
        width: 40, height: 40, offsetX: 0, offsetY: 0,
      };
      element.assetLayers.push({
        role: 'item',
        assetRef: { archiveName: 'Items2', imageIndex: 73 },
        asset: {
          status: 'ready', url: imageUrl, archiveLabel: 'Items2.pak/000073',
          width: 34, height: 34, offsetX: 1, offsetY: -1,
        },
      });
    } else if (element.statementId === 'progress-bar') {
      for (const layer of element.assetLayers || []) {
        layer.asset = {
          status: 'ready', url: imageUrl,
          archiveLabel: layer.role === 'background' ? 'NewopUI.Pak/000100' : 'NewopUI.Pak/000101',
          width: 120, height: 18, offsetX: 0, offsetY: 0,
        };
      }
    } else if (element.statementId === 'imgex-absolute') {
      element.asset = {
        status: 'ready', url: `${imageUrl}#normal`, archiveLabel: 'NewopUI.Pak/000120',
        width: 40, height: 20, offsetX: 0, offsetY: 0,
      };
      for (const layer of element.assetLayers || []) {
        layer.asset = {
          status: 'ready',
          url: `${imageUrl}#${layer.role}`,
          archiveLabel: `NewopUI.Pak/${layer.role === 'hover' ? '000121' : '000122'}`,
          width: 40, height: 20, offsetX: 0, offsetY: 0,
        };
      }
    } else if (element.statementId === 'playimg-absolute') {
      element.animationPreview.intervalMs = 30;
      element.animationFrames = [0, 1, 2].map(index => ({
        status: 'ready', url: `${imageUrl}#frame${index}`,
        archiveLabel: `NewopUI.Pak/${String(130 + index).padStart(6, '0')}`,
        width: 32, height: 32, offsetX: 0, offsetY: 0,
      }));
    } else if (element.statementId === 'img-relative') {
      element.asset = {
        status: 'missing',
        archiveLabel: 'NewopUI.Pak/000010',
        message: '素材未缓存或缓存已失效',
      };
    }
  }

  const defaultScene = model.scenes.find(scene => !scene.conditionGroupId);
  const grid = {
    id: 'dom-grid', statementId: 'newui-bagitems-996pc', token: '<BAGITEMS',
    description: '运行时物品列表 DOM 验收', kind: 'container', raw: '<BAGITEMS|count=8|row=2>',
    lineNumber: 20, sourceRange: { start: 0, end: 0, original: '' },
    coordinateMode: 'flow', sourceCoordinateBiasX: 0, sourceCoordinateBiasY: 0,
    editable: false, localLayoutX: 330, localLayoutY: 260, layoutX: 330, layoutY: 260,
    width: 168, height: 84, text: '人物物品列表',
    parameters: [
      { index: 1, key: 'count', name: '格子数量', value: '8' },
      { index: 2, key: 'row', name: '行数', value: '2' },
    ],
    containerPreview: {
      variant: 'item-grid', label: '人物物品列表', cellCount: 8, rows: 2, columns: 4,
    },
    warning: '运行时物品内容使用空格占位',
  };
  if (defaultScene) defaultScene.elements.push(grid);
  for (const scene of model.scenes) {
    if (scene !== defaultScene && !scene.elements.some(element => element.id === grid.id)) {
      scene.elements.push(grid);
    }
  }
  for (const page of model.pages) {
    if (!page.elements.some(element => element.id === grid.id)) page.elements.push(grid);
  }
  return model;
}

function buildModels(imageUrl) {
  const source = [
    '[@main]',
    '#SAY',
    '<&text:默认内容|这些是备注^换一行^250#这行字是绿色:20:30{FCOLOR=250}>',
    '<&TEXT::180:30{FCOLOR=250}>',
    '<Layout:~#L1:100:100:180:100:7>',
    '<IMG:#L1~#L2:10:1:5:6>',
    '<&ITEMSHOW:1927:2:220:100:1:0:0:40:0:0:0>',
    '<&PROGRESSBAR:220:170:10:100:101:1:100:0:0:0:100:40:0:250:0:0:%p/%m:进度>',
    '<&IMGEX:10:120:121:122:220:220>',
    '<&PLAYIMG:10:130:3:30:280:220>',
    '<UNCONFIRMEDUI:1:2:3>',
    '#IF',
    'CHECKGAMEGOLD > 0',
    '#SAY',
    '<&TEXT:条件满足:20:60{FCOLOR=251}>',
    '#ELSESAY',
    '<&TEXT:条件不满足:20:60{FCOLOR=253}>',
    '#IF',
    'CHECKGAMEGOLD > 0',
    '#SAY',
    '<&TEXT:第二处条件满足:20:90{FCOLOR=251}>',
    '#ELSESAY',
    '<&TEXT:第二处条件不满足:20:90{FCOLOR=253}>',
  ].join('\n');
  const falseModel = parseModel(source);
  assert.equal(falseModel.conditionGroups.length, 1,
    'equivalent source conditions must share one browser switch');
  const groupId = falseModel.conditionGroups[0].id;
  const trueModel = parseModel(source, { [groupId]: true });
  return {
    groupId,
    falseModel: hydrateDomFixture(falseModel, imageUrl),
    trueModel: hydrateDomFixture(trueModel, imageUrl),
  };
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, relativePath)).href;
}

function bodyAttribute(output, name) {
  const body = output.match(/<body\b([^>]*)>/i);
  if (!body) return undefined;
  return body[1].match(new RegExp(`data-${name}="([^"]*)"`))?.[1];
}

function main() {
  const edge = findEdge();
  if (!edge) {
    console.log('npc-dialog-visual-browser.test.js: SKIP (Microsoft Edge not found)');
    return;
  }
  const cachedPng = firstCachedPng();
  const imageUrl = cachedPng
    ? pathToFileURL(cachedPng).href
    : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzNwAAAABJRU5ErkJggg==';
  const models = buildModels(imageUrl);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-npc-dom-browser-'));
  const profile = path.join(temporary, 'profile');
  const harness = path.join(temporary, 'npc-dialog-dom-test.html');
  try {
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__booMessages = [];
window.__models = ${JSON.stringify(models)};
window.addEventListener('error', function (event) {
  document.body.dataset.appError = (event.error && event.error.stack
    ? event.error.stack : (event.message || 'unknown error')) +
    ' @ ' + event.filename + ':' + event.lineno + ':' + event.colno;
});
window.acquireVsCodeApi = function () {
  return { postMessage: function (message) {
    window.__booMessages.push(message);
    if (message.type === 'ready') {
      setTimeout(function () {
        window.dispatchEvent(new MessageEvent('message', { data: {
          type: 'model', model: window.__models.falseModel, previewRevision: 1,
          preserveDrafts: false, geeOffsetHelp: ''
        }}));
      }, 0);
    } else if (message.type === 'previewCondition') {
      setTimeout(function () {
        window.dispatchEvent(new MessageEvent('message', { data: {
          type: 'model',
          model: message.satisfied ? window.__models.trueModel : window.__models.falseModel,
          previewRevision: message.satisfied ? 2 : 3, preserveDrafts: true, geeOffsetHelp: ''
        }}));
      }, 0);
    } else if (message.type === 'resetPreview') {
      setTimeout(function () {
        window.dispatchEvent(new MessageEvent('message', { data: {
          type: 'model', model: window.__models.falseModel, previewRevision: 4,
          preserveDrafts: true, geeOffsetHelp: ''
        }}));
      }, 0);
    }
  }};
};
</script>`;
    html = html.replace(`<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`,
      `${mock}<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`);
    const scenario = `<script>
(function () {
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function px(value) { return Number(String(value || '').replace('px', '')); }
  async function run() {
    for (var attempt = 0; attempt < 100; attempt++) {
      if (document.querySelectorAll('.canvas-element').length >= 8) break;
      await wait(40);
    }
    if (document.body.dataset.appError) throw new Error(document.body.dataset.appError);
    var falseModel = window.__models.falseModel;
    var page = falseModel.pages[0];
    var root = page.elements.find(function (element) { return element.containerElementId === 'L1'; });
    var child = page.elements.find(function (element) { return element.containerElementId === 'L2'; });
    var item = page.elements.find(function (element) { return element.statementId === 'item-show'; });
    var progress = page.elements.find(function (element) { return element.statementId === 'progress-bar'; });
    if (!root || !child || !item || !progress) throw new Error('fixture elements missing');
    if (document.querySelectorAll('.item-frame-image').length !== 1) throw new Error('item frame missing');
    if (document.querySelectorAll('.item-content-image').length !== 1) throw new Error('item content missing');
    if (document.querySelectorAll('.progress-fill-image').length !== 1) throw new Error('progress fill missing');
    if (document.querySelectorAll('.item-grid-cell').length !== 8) throw new Error('item grid cells missing');
    var interactive = document.querySelector('.interactive-asset-image');
    var interactiveWrapper = interactive && interactive.closest('.canvas-element');
    if (!interactive || !interactiveWrapper) throw new Error('interactive button states missing');
    interactiveWrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    if (!interactive.src.endsWith('#hover')) throw new Error('hover image did not activate');
    interactiveWrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    if (!interactive.src.endsWith('#pressed')) throw new Error('pressed image did not activate');
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    interactiveWrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    if (!interactive.src.endsWith('#normal')) throw new Error('normal image did not restore');
    var animation = document.querySelector('.animation-frame-image');
    if (!animation) throw new Error('animation frame missing');
    var animationStart = animation.src;
    await wait(45);
    if (animation.src === animationStart) throw new Error('animation frame did not advance');
    if (!document.getElementById('unsupportedList').textContent.includes('UNCONFIRMEDUI')) throw new Error('locked statement missing');
    if (document.querySelectorAll('.kind-unknown').length !== 1) throw new Error('unknown statement duplicated');
    if (document.querySelectorAll('.scene-group').length !== 1) throw new Error('equivalent conditions were not coalesced');
    if ((document.getElementById('conditionText').textContent.match(/CHECKGAMEGOLD > 0/g) || []).length !== 1) throw new Error('condition summary duplicated');
    if (!document.getElementById('dialogCanvas').textContent.includes('默认内容')) throw new Error('TEXT content missing');
    if (document.getElementById('dialogCanvas').textContent.toLowerCase().includes('<&text')) throw new Error('TEXT token leaked into canvas');
    var tooltipElement = page.elements.find(function (element) { return element.tooltipPreview; });
    var tooltipOwner = tooltipElement && node(tooltipElement.id);
    if (!tooltipOwner) throw new Error('tooltip fixture missing');
    tooltipOwner.dispatchEvent(new MouseEvent('mouseenter', {
      bubbles: true, clientX: 160, clientY: 140
    }));
    await wait(20);
    var tooltip = document.querySelector('.dialog-tooltip:not(.hidden)');
    if (!tooltip) throw new Error('custom tooltip did not open');
    if (!tooltip.textContent.includes('这些是备注') || !tooltip.textContent.includes('换一行')) {
      throw new Error('tooltip multiline content missing');
    }
    var coloredTooltipRun = Array.from(tooltip.querySelectorAll('span')).find(function (span) {
      return span.textContent.includes('这行字是绿色');
    });
    if (!coloredTooltipRun || getComputedStyle(coloredTooltipRun).color !== 'rgb(0, 255, 0)') {
      throw new Error('tooltip color segment missing');
    }
    if (px(tooltip.style.left) !== 172 || px(tooltip.style.top) !== 152) {
      throw new Error('tooltip cursor positioning incorrect');
    }
    tooltipOwner.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    if (!tooltip.classList.contains('hidden')) throw new Error('custom tooltip did not close');

    var itemNode = node(item.id);
    if (px(itemNode.style.left) !== 220 || px(itemNode.style.top) !== 100) throw new Error('ITEMSHOW received an unexpected coordinate bias');
    itemNode.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await wait(20);
    if (!document.getElementById('elementParameters').textContent.includes('内观素材')) throw new Error('item parameters missing');
    if (!document.getElementById('assetState').textContent.includes('Items2.pak/000073')) throw new Error('item asset detail missing');

    var rootNode = node(root.id);
    var childNode = node(child.id);
    var rootBefore = { x: px(rootNode.style.left), y: px(rootNode.style.top) };
    var childBefore = { x: px(childNode.style.left), y: px(childNode.style.top) };
    rootNode.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 110, clientY: 106 }));
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 110 }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 110 }));
    await wait(30);
    rootNode = node(root.id);
    childNode = node(child.id);
    if (px(rootNode.style.left) !== rootBefore.x + 20 || px(rootNode.style.top) !== rootBefore.y + 10) throw new Error('parent drag incorrect');
    if (px(childNode.style.left) !== childBefore.x + 20 || px(childNode.style.top) !== childBefore.y + 10) throw new Error('child did not follow parent');

    document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true, cancelable: true
    }));
    await wait(20);
    if (px(node(root.id).style.left) !== rootBefore.x + 21) throw new Error('arrow-key nudge failed');
    document.getElementById('undoButton').click();
    await wait(20);
    if (px(node(root.id).style.left) !== rootBefore.x + 20) throw new Error('undo failed');
    document.getElementById('redoButton').click();
    await wait(20);
    if (px(node(root.id).style.left) !== rootBefore.x + 21) throw new Error('redo failed');

    document.getElementById('zoomIn').click();
    if (document.getElementById('zoomValue').textContent !== '110%') throw new Error('zoom-in failed');
    document.getElementById('zoomReset').click();
    if (document.getElementById('zoomValue').textContent !== '100%') throw new Error('zoom reset failed');

    var trueButton = document.querySelector('.scene-group .branch-button:nth-child(2)');
    trueButton.click();
    await wait(80);
    if (!document.getElementById('dialogCanvas').textContent.includes('条件满足')) throw new Error('satisfied branch missing');
    if (!document.getElementById('dialogCanvas').textContent.includes('第二处条件满足')) throw new Error('second equivalent satisfied branch missing');
    if (document.getElementById('dialogCanvas').textContent.includes('条件不满足')) throw new Error('else branch remained active');
    if (px(node(root.id).style.left) !== rootBefore.x + 21) throw new Error('draft lost during condition switch');
    document.getElementById('resetPreview').click();
    await wait(80);
    if (!document.getElementById('dialogCanvas').textContent.includes('条件不满足')) throw new Error('default branch reset failed');
    if (!document.getElementById('dialogCanvas').textContent.includes('第二处条件不满足')) throw new Error('second equivalent else branch reset failed');

    node(child.id).dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await wait(20);
    if (document.getElementById('patchButton').classList.contains('hidden')) throw new Error('missing-asset action hidden');
    document.getElementById('patchButton').click();
    document.getElementById('locateButton').click();
    document.getElementById('applyButton').click();
    document.getElementById('saveButton').click();
    await wait(20);

    var messages = window.__booMessages;
    var dirtyMessages = messages.filter(function (message) { return message.type === 'dirtyChanged'; });
    var apply = messages.find(function (message) { return message.type === 'apply'; });
    var save = messages.find(function (message) { return message.type === 'save'; });
    var rootChange = apply && apply.changes.find(function (change) { return change.elementId === root.id; });
    if (dirtyMessages.length !== 1 || dirtyMessages[0].dirty !== true) throw new Error('dirty notifications were spammed');
    if (!rootChange || rootChange.x !== rootBefore.x + 21 || rootChange.y !== rootBefore.y + 10) throw new Error('apply coordinates incorrect');
    if (!save || !save.changes.length) throw new Error('save message missing changes');
    if (!messages.some(function (message) { return message.type === 'openPatchManager'; })) throw new Error('patch manager message missing');
    if (!messages.some(function (message) { return message.type === 'locate'; })) throw new Error('locate message missing');

    window.dispatchEvent(new MessageEvent('message', { data: { type: 'conflict', message: '源码冲突测试' } }));
    await wait(20);
    if (!document.getElementById('applyButton').disabled || !document.getElementById('saveButton').disabled) throw new Error('conflict did not disable writes');
    if (!document.getElementById('statusBanner').textContent.includes('源码冲突测试')) throw new Error('conflict banner missing');

    document.body.dataset.testStatus = 'pass';
    document.body.dataset.realCache = ${JSON.stringify(Boolean(cachedPng))};
    document.body.dataset.elementCount = String(document.querySelectorAll('.canvas-element').length);
    document.body.dataset.messageTypes = messages.map(function (message) { return message.type; }).join(',');
  }
  run().catch(function (error) {
    document.body.dataset.testStatus = 'fail';
    document.body.dataset.testError = error && error.stack ? error.stack : String(error);
  });
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const result = spawnSync(edge, [
      '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
      '--allow-file-access-from-files', `--user-data-dir=${profile}`,
      '--window-size=1440,900', '--virtual-time-budget=12000', '--dump-dom',
      pathToFileURL(harness).href,
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    if (!/<body\b/i.test(result.stdout) && !result.stderr.trim()) {
      console.log('npc-dialog-visual-browser.test.js: SKIP (headless Edge returned no DOM)');
      return;
    }
    assert.equal(
      bodyAttribute(result.stdout, 'test-status'),
      'pass',
      bodyAttribute(result.stdout, 'test-error') || result.stderr
    );
    assert.ok(Number(bodyAttribute(result.stdout, 'element-count')) >= 8);
    console.log(
      `npc-dialog-visual-browser.test.js: PASS (` +
      `${bodyAttribute(result.stdout, 'element-count')} DOM elements, ` +
      `real cache=${bodyAttribute(result.stdout, 'real-cache')})`
    );
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

main();
