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
      '-NoProfile', '-NonInteractive', '-Command',
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
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim().split(/\r?\n/, 1)[0]
    || '<unknown>';
}

function browserDiagnostic(candidate, result) {
  const stderr = String(result.stderr || '').trim().replace(/\r?\n/g, '\\n') || '<empty>';
  return `${candidate}: status=${result.status}, signal=${result.signal || '<none>'}, `
    + `error=${result.error?.message || '<none>'}, `
    + `body=${/<body\b/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function ready(label, width = 48, height = 24, offsetX = 0, offsetY = 0) {
  return {
    status: 'ready',
    url: `${pixel}#${label}`,
    archiveLabel: `AddButton/${label}`,
    width,
    height,
    offsetX,
    offsetY,
  };
}

function textPreview(text, color = '#f8fafc') {
  if (!text) return undefined;
  return {
    lines: [[{ text, color }]],
    color,
    align: 'center',
  };
}

function tooltipPreview(lines) {
  return {
    raw: lines.join('\\'),
    kind: 'text',
    lines: lines.map((text, index) => [{
      text,
      color: index === 0 ? '#ffd95a' : '#7dd3fc',
    }]),
    offsetX: 8,
    offsetY: 12,
  };
}

function effect(state, start, count, interval, drawMode, offsetX, offsetY) {
  return {
    state,
    assetRef: { willIndex: 9, imageIndex: start },
    frameCount: count,
    frameIntervalMs: interval,
    drawMode,
    offsetX,
    offsetY,
    frames: Array.from({ length: count }, (_, index) => (
      ready(`GOM-EX-${state}-${start + index}`, 20, 20, offsetX, offsetY)
    )),
  };
}

function actionButton(options) {
  const source = options.raw || `${options.command} fixture`;
  const normal = options.normal === undefined ? undefined : ready(`${options.id}-normal`);
  const hover = options.hover === undefined ? undefined : ready(`${options.id}-hover`);
  const pressed = options.pressed === undefined ? undefined : ready(`${options.id}-pressed`);
  return {
    id: options.id,
    statementId: 'action-addbutton-preview',
    token: options.command,
    description: `${options.engine} ${options.command} 动作按钮`,
    kind: options.status === 'evidence-blocked' ? 'generic' : 'button',
    raw: source,
    lineNumber: options.lineNumber || 3,
    sourceRange: { start: 0, end: source.length, original: source },
    coordinateMode: options.status === 'evidence-blocked' ? 'none' : 'absolute',
    sourceCoordinateBiasX: 0,
    sourceCoordinateBiasY: 0,
    editable: false,
    localLayoutX: options.x,
    localLayoutY: options.y,
    layoutX: options.x,
    layoutY: options.y,
    width: options.width || 48,
    height: options.height || 24,
    sizePreview: {
      width: { mode: 'intrinsic', baseValue: options.width || 48 },
      height: { mode: 'intrinsic', baseValue: options.height || 24 },
    },
    ...(normal ? {
      assetRef: { willIndex: options.willIndex, imageIndex: options.normal },
      asset: normal,
    } : {}),
    ...((hover || pressed) ? {
      assetLayers: [
        ...(hover ? [{
          role: 'hover',
          assetRef: { willIndex: options.willIndex, imageIndex: options.hover },
          asset: hover,
        }] : []),
        ...(pressed ? [{
          role: 'pressed',
          assetRef: { willIndex: options.willIndex, imageIndex: options.pressed },
          asset: pressed,
        }] : []),
      ],
    } : {}),
    ...(options.title ? { text: options.title, textPreview: textPreview(options.title) } : {}),
    ...(options.tips ? { tooltipPreview: tooltipPreview(options.tips) } : {}),
    ...(options.triggerId === undefined || options.status === 'evidence-blocked' ? {} : {
      runtimeActionPreview: {
        link: `@ButtonClick${options.triggerId}`,
        localOnly: true,
      },
    }),
    addButtonPreview: {
      command: options.command,
      engine: options.engine,
      status: options.status || 'partial-simulation',
      ...(options.triggerId === undefined ? {} : { triggerId: options.triggerId }),
      ...(options.movable === undefined ? {} : { movable: options.movable }),
      ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
      ...(options.createPosition === undefined ? {} : {
        createPosition: options.createPosition,
        createPositionLabel: options.createPositionLabel,
      }),
      localOnly: true,
      effects: options.effects || [],
      deleteActions: options.deleteActions || [],
      dynamicFields: [],
      invalidFields: [],
    },
    warning: options.warning || '[Partial simulation] 仅本地绘制按钮和点击摘要；不执行服务器标签或客户端宿主动作',
  };
}

function fixtureModel() {
  const source = ['[@main]', '#SAY', '<Ctrl+F12 ADDBUTTON 浏览器夹具>'].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/addbutton-browser.txt',
    fileName: 'addbutton-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\addbutton-browser.txt',
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: 'GOM',
    cursorOffset: source.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });

  const buttons = [
    actionButton({
      id: 'ADD_GOM_OLD', engine: 'GOM', command: 'ADDBUTTON', triggerId: 1,
      x: 20, y: 30, willIndex: 3, normal: 283, hover: 284, pressed: 285,
      title: '主线按钮', tips: ['主线提示', '第二行'], movable: false, groupId: 4,
      deleteActions: [{
        buttonId: 1, scope: 'self', sourceLabel: '@remove', lineNumber: 11, dynamic: false,
      }],
      raw: String.raw`ADDBUTTON 3 1 283 284 285 20 30 0|4 主线按钮 253/主线提示\254/第二行`,
    }),
    actionButton({
      id: 'ADD_GOM_EX', engine: 'GOM', command: 'ADDBUTTONEX', triggerId: 2,
      x: 180, y: 30, willIndex: 5, normal: 275, hover: 276, pressed: 277,
      tips: ['特效提示'], movable: true, groupId: 4,
      createPosition: 17, createPositionLabel: '大地图',
      effects: [
        effect('normal', 840, 3, 80, 0, 2, -3),
        effect('hover', 850, 2, 100, 1, 4, 5),
        effect('pressed', 860, 4, 120, 0, -1, 6),
      ],
      deleteActions: [{
        buttonId: 2, scope: 'all-users', sourceLabel: '@remove', lineNumber: 12, dynamic: false,
      }],
      warning: '[Partial simulation] GOM ADDBUTTONEX 三态特效静态分层可见；真实绘制混合和客户端宿主行为不离线执行',
    }),
    actionButton({
      id: 'ADD_GEE_MAP', engine: 'GEE', command: 'ADDBUTTON', triggerId: 101,
      x: 20, y: 160, willIndex: 3, normal: 283, hover: 284, pressed: 285,
      title: '地图按钮', tips: ['地图提示', '第二行'],
      createPosition: 33, createPositionLabel: 'M大地图',
      deleteActions: [{
        buttonId: 101, scope: 'self', sourceLabel: '@remove', lineNumber: 9, dynamic: false,
      }],
    }),
    actionButton({
      id: 'ADD_GEE_MOVE', engine: 'GEE', command: 'ADDBUTTON', triggerId: 102,
      x: 180, y: 160, willIndex: 3, normal: 286, hover: 287, pressed: 288,
      title: '可移动按钮', tips: ['可移动提示'], movable: true,
      createPosition: 1, createPositionLabel: '主界面-可以移动',
    }),
    actionButton({
      id: 'ADD_996_OLD', engine: '996PC', command: 'ADDBUTTON', triggerId: 7,
      x: 340, y: 160, willIndex: 3, normal: 283, hover: 284, pressed: 285,
      title: '旧按钮', tips: ['旧提示', '第二行'], movable: true,
      deleteActions: [{
        buttonId: 7, scope: 'self', sourceLabel: '@remove', lineNumber: 9, dynamic: false,
      }],
    }),
    actionButton({
      id: 'ADD_996_EX_BLOCKED', engine: '996PC', command: 'ADDBUTTONEX',
      status: 'evidence-blocked', x: 500, y: 150, width: 245, height: 80,
      warning: '[Evidence-blocked] 996PC ADDBUTTONEX 存在 legacy/new-NPC 方言与版本消歧缺口，不能套用 GOM 五段分组语法；不请求素材',
      raw: 'ADDBUTTONEX 7|320|160|1|4 5 275|276|277 ...',
    }),
  ];

  const scene = model.scenes[0];
  scene.elements = buttons;
  scene.unsupportedStatements = [];
  const page = model.pages[0];
  page.elements = buttons;
  page.unsupportedStatements = [];
  model.canvasWidth = 820;
  model.canvasHeight = 360;
  model.warnings = [...new Set(buttons.map(button => button.warning).filter(Boolean))];
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
    console.log('addbutton-action-preview-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-addbutton-action-browser-'));
  try {
    const harness = path.join(temporary, 'addbutton-action-preview.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
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
  function imageSource(wrapper) {
    var image = wrapper && wrapper.querySelector('.interactive-asset-image');
    return image ? image.getAttribute('src') || image.src || '' : '';
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('ADD_GOM_OLD'); attempt++) await wait(20);
    if (!node('ADD_GOM_OLD')) throw new Error('ADDBUTTON browser fixture did not render');

    await check('typed engine metadata is visible in the real DOM', async function () {
      var gom = node('ADD_GOM_OLD');
      var ex = node('ADD_GOM_EX');
      var map = node('ADD_GEE_MAP');
      var move = node('ADD_GEE_MOVE');
      var pc = node('ADD_996_OLD');
      var errors = [];
      if (gom.dataset.addbuttonCommand !== 'ADDBUTTON'
        || gom.dataset.addbuttonTriggerId !== '1'
        || gom.dataset.addbuttonMovable !== 'false'
        || gom.dataset.addbuttonGroupId !== '4') {
        errors.push('GOM legacy movement/group metadata missing');
      }
      if (ex.dataset.addbuttonCommand !== 'ADDBUTTONEX'
        || ex.dataset.addbuttonTriggerId !== '2'
        || ex.dataset.addbuttonCreatePosition !== '17') {
        errors.push('GOM EX identity/create-position metadata missing');
      }
      if (map.dataset.addbuttonCreatePosition !== '33'
        || !/M.*大地图|大地图/.test(map.dataset.addbuttonCreatePositionLabel || '')) {
        errors.push('LFM M-map create-position metadata missing');
      }
      if (map.dataset.addbuttonGroupId) errors.push('LFM create position was mislabeled as GOM group');
      if (move.dataset.addbuttonCreatePosition !== '1'
        || move.dataset.addbuttonMovable !== 'true') {
        errors.push('LFM movable main-screen mode missing');
      }
      if (pc.dataset.addbuttonMovable !== 'true'
        || pc.dataset.addbuttonGroupId || pc.dataset.addbuttonCreatePosition) {
        errors.push('996PC legacy movement metadata borrowed another engine field');
      }
      if (errors.length) throw new Error(errors.join('; '));
    });

    await check('normal, hover and pressed images are visually stateful', async function () {
      var wrapper = node('ADD_GOM_OLD');
      if (!/ADD_GOM_OLD-normal/.test(imageSource(wrapper))) {
        throw new Error('normal state image is not drawn: ' + imageSource(wrapper));
      }
      wrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      await wait(20);
      if (!/ADD_GOM_OLD-hover/.test(imageSource(wrapper))) {
        throw new Error('hover state image is not drawn: ' + imageSource(wrapper));
      }
      wrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await wait(20);
      if (!/ADD_GOM_OLD-pressed/.test(imageSource(wrapper))) {
        throw new Error('pressed state image is not drawn: ' + imageSource(wrapper));
      }
      wrapper.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });

    await check('title and tooltip are actually visible', async function () {
      var wrapper = node('ADD_GOM_OLD');
      var caption = wrapper.querySelector('.button-caption');
      if (!caption || caption.textContent.trim() !== '主线按钮') {
        throw new Error('button title is not rendered');
      }
      wrapper.dispatchEvent(new MouseEvent('mouseenter', {
        bubbles: false, clientX: 30, clientY: 30,
      }));
      await wait(30);
      var tooltip = document.querySelector('.dialog-tooltip:not(.hidden)');
      if (!tooltip || !/主线提示/.test(tooltip.textContent) || !/第二行/.test(tooltip.textContent)) {
        throw new Error('multi-line tooltip is not visible');
      }
      wrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
    });

    await check('click is a local-only ButtonClick summary', async function () {
      var wrapper = node('ADD_GOM_OLD');
      var hit = wrapper.querySelector('.runtime-action-hitarea[data-runtime-trigger="click"]');
      if (!hit || hit.disabled) throw new Error('local click target is missing');
      var postStart = window.__postedMessages.length;
      var hrefBefore = location.href;
      hit.click();
      await wait(30);
      wrapper = node('ADD_GOM_OLD');
      var summary = wrapper.querySelector('.runtime-action-summary');
      if (!summary || !/@ButtonClick1/i.test(summary.textContent)
        || !/仅本地预览|不执行服务器/.test(summary.textContent)) {
        throw new Error('local click summary is missing: ' + (summary && summary.textContent));
      }
      if (window.__postedMessages.length !== postStart
        || location.href !== hrefBefore || window.__openedLinks.length !== 0) {
        throw new Error('button click escaped to extension/server/navigation');
      }
    });

    await check('GOM ADDBUTTONEX draws three independent effect states', async function () {
      var wrapper = node('ADD_GOM_EX');
      var effects = Array.from(wrapper.querySelectorAll('[data-addbutton-effect-state]'));
      if (effects.length !== 3) throw new Error('effect DOM layer count=' + effects.length);
      var byState = new Map(effects.map(function (item) {
        return [item.dataset.addbuttonEffectState, item];
      }));
      var expected = { normal: '3', hover: '2', pressed: '4' };
      for (var state of Object.keys(expected)) {
        var layer = byState.get(state);
        if (!layer || layer.dataset.addbuttonEffectFrameCount !== expected[state]) {
          throw new Error(state + ' effect metadata missing');
        }
        if (!layer.querySelector('img')) throw new Error(state + ' effect image is not drawn');
      }
      if (wrapper.dataset.addbuttonEffectState !== 'normal') {
        throw new Error('initial effect state is not normal');
      }
      wrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      await wait(30);
      if (wrapper.dataset.addbuttonEffectState !== 'hover') {
        throw new Error('hover effect state did not activate');
      }
      wrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      await wait(30);
      if (wrapper.dataset.addbuttonEffectState !== 'pressed') {
        throw new Error('pressed effect state did not activate');
      }
      var warning = await inspectorWarning(wrapper);
      if (!/Partial simulation|部分模拟|客户端.*混合|混合.*客户端/i.test(warning)) {
        throw new Error('effect draw-mode warning is not available in Inspector: ' + warning);
      }
    });

    await check('DELBUTTON lifecycle is linked but never executed against the client', async function () {
      var legacy = node('ADD_GOM_OLD');
      var extended = node('ADD_GOM_EX');
      var legacyBoundary = legacy.querySelector('.addbutton-lifecycle-boundary');
      var extendedBoundary = extended.querySelector('.addbutton-lifecycle-boundary');
      if (!legacyBoundary || !/DELBUTTON.*1/i.test(legacyBoundary.textContent)
        || !/自己|self/i.test(legacyBoundary.textContent)) {
        throw new Error('self DELBUTTON lifecycle is missing');
      }
      if (!extendedBoundary || !/DELBUTTON.*2/i.test(extendedBoundary.textContent)
        || !/全服|all-users/i.test(extendedBoundary.textContent)) {
        throw new Error('all-users DELBUTTON lifecycle is missing');
      }
      if (!/仅本地|不执行|Partial simulation|部分模拟/i.test(
        legacyBoundary.textContent + ' ' + extendedBoundary.textContent
      )) {
        throw new Error('DELBUTTON local-only boundary is missing');
      }
    });

    await check('996PC ADDBUTTONEX is visibly Evidence-blocked without speculative assets', async function () {
      var wrapper = node('ADD_996_EX_BLOCKED');
      if (wrapper.dataset.addbuttonStatus !== 'evidence-blocked') {
        throw new Error('996PC EX status is not evidence-blocked');
      }
      var evidence = wrapper.querySelector('.addbutton-evidence-boundary');
      if (!evidence || !/Evidence-blocked/i.test(evidence.textContent)
        || !/996PC.*ADDBUTTONEX|ADDBUTTONEX.*996PC/i.test(evidence.textContent)
        || !/不能套用 GOM|方言|版本|消歧/.test(evidence.textContent)) {
        throw new Error('996PC EX evidence boundary is not visible');
      }
      if (wrapper.querySelector('img') || wrapper.querySelector('[data-addbutton-effect-state]')) {
        throw new Error('996PC EX speculatively rendered GOM assets/effects');
      }
      if (wrapper.dataset.addbuttonGroupId === '4') {
        throw new Error('996PC EX borrowed GOM group semantics');
      }
    });

    await check('raw creation commands do not leak into ordinary canvas labels', async function () {
      var text = document.getElementById('dialogCanvas').textContent;
      if (/ADDBUTTON 3 1 283 284 285/.test(text)) {
        throw new Error('raw legacy creation action leaked as flow text');
      }
    });

    document.body.dataset.addbuttonDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.addbuttonTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.addbuttonErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.addbuttonTest = 'fail';
    document.body.dataset.addbuttonErrors = '[dom] scenario: '
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
        '--headless=new', '--disable-gpu', '--disable-extensions',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--no-first-run', '--allow-file-access-from-files',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1200,760', '--virtual-time-budget=2200', '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8', timeout: 25000, maxBuffer: 16 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-addbutton-test=/i.test(result.stdout || '')) {
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
      console.log(`addbutton-action-preview-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-addbutton-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`addbutton-action-preview-browser.test.js: browser=${selected.candidate}`);
    console.log(`addbutton-action-preview-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`addbutton-action-preview-browser.test.js: DOM=${domCount}`);
    if (/data-addbutton-test="pass"/.test(selected.result.stdout)) return [];
    const encoded = /data-addbutton-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    return decodeAttribute(encoded).split(' || ').filter(Boolean);
  } finally {
    if (process.env.BOO_KEEP_ADDBUTTON_TEST_TEMP === '1') {
      console.log(`addbutton-action-preview-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

const failures = runBrowserMatrix();
if (failures.length > 0) {
  console.error('addbutton-action-preview-browser.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('addbutton-action-preview-browser.test.js: PASS');
}
