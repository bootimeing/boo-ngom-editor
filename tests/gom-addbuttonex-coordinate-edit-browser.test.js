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

function browserCandidates() {
  return [
    process.env.BOO_CHROMIUM_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter((candidate, index, values) => candidate && values.indexOf(candidate) === index)
    .filter(candidate => fs.existsSync(candidate));
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function ready(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="28"><rect width="72" height="28" rx="4" fill="${color}"/><text x="36" y="18" text-anchor="middle" font-size="10" fill="white">${label}</text></svg>`;
  return {
    status: 'ready',
    url: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
    archiveLabel: label,
    width: 72,
    height: 28,
    offsetX: 0,
    offsetY: 0,
  };
}

function fixtureModel() {
  const source = [
    '[@main]',
    '#ACT',
    'MOV N$X 70',
    'ADDBUTTONEX 10|70|410|0|0 1 3243|3243|3242 0 * * * -1 15',
    'ADDBUTTONEX 11|<$STR(N$X)>|110|0|0 1 3243|3243|3242 0 * * * -1 15',
    'ADDBUTTONEX 12|abc|180|0|0 1 3243|3243|3242 0 * * * -1 15',
    '#SAY',
    '<Ctrl+F12 GOM ADDBUTTONEX 坐标交互红测>',
  ].join('\r\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/gom-addbuttonex-browser.txt',
    fileName: 'gom-addbuttonex-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\gom-addbuttonex-browser.txt',
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: 'GOM',
    cursorOffset: source.indexOf('[@main]') + 2,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });
  const seen = new Set();
  const buttons = [];
  for (const element of (model.scenes || []).flatMap(scene => scene.elements || [])) {
    if (element.addButtonPreview?.command !== 'ADDBUTTONEX' || seen.has(element.id)) continue;
    seen.add(element.id);
    buttons.push(element);
  }
  const byTrigger = new Map(buttons.map(button => [button.addButtonPreview.triggerId, button]));
  const staticButton = byTrigger.get(10);
  if (!staticButton) throw new Error('static ADDBUTTONEX browser fixture was not parsed');

  // Browser interaction is intentionally isolated from the provider test. A
  // visible three-state asset lets elementFromPoint exercise the real wrapper
  // even while the Parser-side asset contract is red.
  staticButton.asset = ready('normal', '#4169e1');
  staticButton.assetLayers = [
    { role: 'hover', assetRef: { willIndex: 1, imageIndex: 3243 }, asset: ready('hover', '#2e8b57') },
    { role: 'pressed', assetRef: { willIndex: 1, imageIndex: 3242 }, asset: ready('pressed', '#8b008b') },
  ];
  model.canvasWidth = 640;
  model.canvasHeight = 520;
  return {
    model,
    ids: {
      static: staticButton.id,
      dynamic: byTrigger.get(11)?.id,
      invalid: byTrigger.get(12)?.id,
    },
  };
}

function decodeAttribute(value) {
  return String(value || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function run() {
  const candidates = browserCandidates();
  if (candidates.length === 0) throw new Error('No installed Edge/Chrome executable found');
  const fixture = fixtureModel();
  if (!fixture.ids.dynamic || !fixture.ids.invalid) {
    throw new Error(`unsafe ADDBUTTONEX fixtures were not parsed: ${JSON.stringify(fixture.ids)}`);
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-gom-addbuttonex-coordinate-browser-'));
  try {
    const harness = path.join(temporary, 'gom-addbuttonex-coordinate-edit.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixture.model)};
window.__ids = ${JSON.stringify(fixture.ids)};
window.__postedMessages = [];
window.__openedLinks = [];
window.__historyCalls = [];
window.open = function () { window.__openedLinks.push(Array.from(arguments)); return null; };
(function () {
  var push = history.pushState.bind(history);
  var replace = history.replaceState.bind(history);
  history.pushState = function () { window.__historyCalls.push(['push'].concat(Array.from(arguments))); return push.apply(history, arguments); };
  history.replaceState = function () { window.__historyCalls.push(['replace'].concat(Array.from(arguments))); return replace.apply(history, arguments); };
}());
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
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  function visibleHit(wrapper) {
    wrapper.scrollIntoView({ block: 'center', inline: 'center' });
    var rect = wrapper.getBoundingClientRect();
    var x = Math.max(rect.left + 3, Math.min(rect.right - 3, rect.left + rect.width / 2));
    var y = Math.max(rect.top + 3, Math.min(rect.bottom - 3, rect.top + rect.height / 2));
    var hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === wrapper || wrapper.contains(hit))) {
      throw new Error('elementFromPoint missed visible wrapper: hit=' + (hit && (hit.className || hit.tagName)));
    }
    if (hit.closest && hit.closest('.runtime-action-boundary, .runtime-action-summary, .addbutton-lifecycle-boundary')) {
      throw new Error('elementFromPoint hit a diagnostic overlay instead of the button visual');
    }
    return { hit: hit, x: x, y: y };
  }
  function mouse(target, type, x, y, detail) {
    target.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === 'mouseup' || type === 'click' ? 0 : 1,
      clientX: x,
      clientY: y,
      detail: detail === undefined ? 1 : detail,
    }));
  }

  async function runScenario() {
    for (var attempt = 0; attempt < 150 && !node(window.__ids.static); attempt++) await wait(20);
    if (!node(window.__ids.static)) throw new Error('ADDBUTTONEX browser fixture did not render');

    await check('static and unsafe editability classes are separated', async function () {
      var editable = node(window.__ids.static);
      var dynamic = node(window.__ids.dynamic);
      var invalid = node(window.__ids.invalid);
      if (editable.classList.contains('locked')) throw new Error('literal packed X/Y button is locked');
      if (!dynamic.classList.contains('locked')) throw new Error('dynamic packed X button is editable');
      if (!invalid.classList.contains('locked')) throw new Error('invalid packed X button is editable');
    });

    await check('elementFromPoint selects and drags the visible static button', async function () {
      var wrapper = node(window.__ids.static);
      var point = visibleHit(wrapper);
      var beforeLeft = parseFloat(wrapper.style.left);
      var beforeTop = parseFloat(wrapper.style.top);
      mouse(point.hit, 'mousedown', point.x, point.y);
      mouse(window, 'mousemove', point.x + 20, point.y + 10);
      mouse(window, 'mouseup', point.x + 20, point.y + 10);
      await wait(30);
      wrapper = node(window.__ids.static);
      if (!wrapper.classList.contains('selected')) throw new Error('visible hit did not select the wrapper');
      if (parseFloat(wrapper.style.left) !== beforeLeft + 20 || parseFloat(wrapper.style.top) !== beforeTop + 10) {
        throw new Error('drag did not move DOM by +20,+10: ' + wrapper.style.left + ',' + wrapper.style.top);
      }
      var xInput = document.getElementById('elementX');
      var yInput = document.getElementById('elementY');
      if (xInput.disabled || yInput.disabled || xInput.value !== '90' || yInput.value !== '420') {
        throw new Error('Inspector did not enable/sync after drag: ' + xInput.value + ',' + yInput.value);
      }

      // A browser-generated click normally follows mouseup. Dispatch it on a
      // fresh elementFromPoint target and require the drag suppression gate.
      var movedPoint = visibleHit(wrapper);
      mouse(movedPoint.hit, 'click', movedPoint.x, movedPoint.y);
      await wait(30);
      var summary = wrapper.querySelector('.runtime-action-summary');
      if (summary && !summary.hidden && /@ButtonClick/i.test(summary.textContent || '')) {
        throw new Error('drag leaked into a local @ action click');
      }
    });

    await check('ArrowRight performs one-pixel source-safe nudge', async function () {
      var wrapper = node(window.__ids.static);
      var before = parseFloat(wrapper.style.left);
      document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight', bubbles: true, cancelable: true,
      }));
      await wait(20);
      wrapper = node(window.__ids.static);
      if (parseFloat(wrapper.style.left) !== before + 1) throw new Error('ArrowRight did not add one pixel');
      if (document.getElementById('elementX').value !== '91') throw new Error('Inspector X did not become 91');
    });

    await check('no-move click remains local-only with no host, open or navigation side effect', async function () {
      await wait(550);
      var wrapper = node(window.__ids.static);
      var point = visibleHit(wrapper);
      var hostBefore = window.__postedMessages.length;
      var openedBefore = window.__openedLinks.length;
      var historyBefore = window.__historyCalls.length;
      var hrefBefore = location.href;
      mouse(point.hit, 'mousedown', point.x, point.y);
      mouse(window, 'mouseup', point.x, point.y);
      mouse(point.hit, 'click', point.x, point.y);
      await wait(30);
      var summary = wrapper.querySelector('.runtime-action-summary');
      if (!summary || summary.hidden || !/@ButtonClick10/.test(summary.textContent || '')
        || !/仅本地预览|不执行服务器/.test(summary.textContent || '')) {
        throw new Error('no-move click did not produce a local-only summary');
      }
      var newMessages = window.__postedMessages.slice(hostBefore);
      if (newMessages.some(function (message) { return /ButtonClick|server|action/i.test(JSON.stringify(message)); })) {
        throw new Error('local click escaped through vscode.postMessage: ' + JSON.stringify(newMessages));
      }
      if (window.__openedLinks.length !== openedBefore || window.__historyCalls.length !== historyBefore
        || location.href !== hrefBefore) {
        throw new Error('local click escaped through window.open/history/navigation');
      }
    });

    await check('dynamic and invalid buttons can be selected but cannot create coordinate drafts', async function () {
      for (var id of [window.__ids.dynamic, window.__ids.invalid]) {
        var wrapper = node(id);
        var point = visibleHit(wrapper);
        var beforeLeft = wrapper.style.left;
        var beforeTop = wrapper.style.top;
        mouse(point.hit, 'mousedown', point.x, point.y);
        mouse(window, 'mousemove', point.x + 20, point.y + 10);
        mouse(window, 'mouseup', point.x + 20, point.y + 10);
        mouse(point.hit, 'click', point.x, point.y);
        await wait(20);
        wrapper = node(id);
        if (!wrapper.classList.contains('selected')) throw new Error(id + ' was not selectable');
        if (wrapper.style.left !== beforeLeft || wrapper.style.top !== beforeTop) {
          throw new Error(id + ' moved despite unsafe coordinates');
        }
        if (!document.getElementById('elementX').disabled || !document.getElementById('elementY').disabled) {
          throw new Error(id + ' enabled Inspector coordinate inputs');
        }
      }
      var changeText = document.getElementById('changeList').textContent || '';
      if (/ADDBUTTONEX.*(?:11|12)/i.test(changeText)) {
        throw new Error('unsafe button leaked into the coordinate change list: ' + changeText);
      }
    });

    document.body.dataset.gomAddbuttonexCoordinateDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.gomAddbuttonexCoordinateTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.gomAddbuttonexCoordinateErrors = failures.join(' || ');
  }
  runScenario().catch(function (error) {
    document.body.dataset.gomAddbuttonexCoordinateTest = 'fail';
    document.body.dataset.gomAddbuttonexCoordinateErrors = '[dom] ' + (error && error.stack ? error.stack : String(error));
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
        '--window-size=1600,1000',
        '--virtual-time-budget=9000',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--dump-dom',
        pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
      attempts.push({ browser: candidates[index], result });
      if (result.status === 0 && /data-gom-addbuttonex-coordinate-test="(?:pass|fail)"/.test(result.stdout || '')) {
        selected = attempts.at(-1);
        break;
      }
    }
    if (!selected) {
      throw new Error(attempts.map(attempt => [
        attempt.browser,
        `status=${attempt.result.status}`,
        attempt.result.error ? `error=${attempt.result.error.message}` : '',
        (attempt.result.stderr || '').slice(-1200),
      ].filter(Boolean).join('\n')).join('\n---\n'));
    }
    const body = selected.result.stdout || '';
    const state = /data-gom-addbuttonex-coordinate-test="([^"]+)"/.exec(body)?.[1];
    const encodedErrors = /data-gom-addbuttonex-coordinate-errors="([^"]*)"/.exec(body)?.[1] || '';
    const errors = decodeAttribute(encodedErrors);
    const dom = /data-gom-addbuttonex-coordinate-dom-count="([^"]+)"/.exec(body)?.[1] || '?';
    if (state !== 'pass') throw new Error(errors || `browser state=${state || 'missing'}`);
    console.log(`browser=${selected.browser}`);
    console.log(`DOM=${dom}`);
    console.log('gom-addbuttonex-coordinate-edit-browser.test.js: PASS');
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

try {
  run();
} catch (error) {
  console.error('gom-addbuttonex-coordinate-edit-browser.test.js: RED FAILURE');
  console.error(`- ${error && error.message ? error.message : String(error)}`);
  process.exitCode = 1;
}
