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

function parse(source, engine) {
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/input-browser-${engine}.txt`,
    fileName: `input-browser-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\input-browser-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine === '996PC' ? '996PC' : '新GOM',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function fixtureModel() {
  const pcSource = [
    '[@main]',
    '#ACT',
    'MOV N$TYPE 2',
    'MOV N$MIN 3',
    'MOV N$MAX 9',
    'MOV N$ONLY 1',
    'MOV N$BG 1',
    '#SAY',
    '<Input|id=TEXT|x=20|y=20|inputid=1|type=0|width=160|height=28|size=16|place=请输入中文|placecolor=251|errortips=请输入3到6个中文字符|mincount=3|maxcount=6|color=250|onlyCh=1|bgtype=1>',
    '<Input|id=PASSWORD|x=20|y=80|inputid=2|type=2|width=160|height=28|mincount=4|maxcount=12|errortips=密码长度错误>',
    '<Input|id=ABS|x=20|y=140|inputid=3|type=3|width=160|height=28|mincount=1|maxcount=3|errortips=请输入1到3位绝对值数字>',
    '<Input|id=DYNAMIC|x=20|y=200|inputid=8|type=<$STR(N$TYPE)>|width=160|height=28|mincount=<$STR(N$MIN)>|maxcount=<$STR(N$MAX)>|onlyCh=<$STR(N$ONLY)>|bgtype=<$STR(N$BG)>>',
    '<Input|id=INVALID|x=20|y=260|inputid=10|type=9|width=160|height=28|mincount=9|maxcount=3|onlyCh=2|bgtype=3|errortips=错误>',
  ].join('\n');
  const gomSource = [
    '[@main]',
    '#SAY',
    '<&INPUTNUM:6:240:20:160:28:0:249:255:10:20:请输入10到20之间的数字:请输入数字:160>',
    '<&INPUTMEMO:7:240:100:200:80:0:249:255:4:50:16:1:请输入4到50个字符>',
  ].join('\n');
  const model = parse(pcSource, '996PC');
  const pcInputs = model.pages[0].elements.filter(element => element.inputPreview);
  const gomInputs = parse(gomSource, 'GOM').pages[0].elements.filter(element => element.inputPreview);
  const ids = new Map([
    ['TEXT', 'INPUT_TEXT'],
    ['PASSWORD', 'INPUT_PASSWORD'],
    ['ABS', 'INPUT_ABSOLUTE'],
    ['DYNAMIC', 'INPUT_DYNAMIC'],
    ['INVALID', 'INPUT_INVALID'],
  ]);
  for (const element of pcInputs) element.id = ids.get(element.containerElementId);
  gomInputs.find(element => element.inputPreview.inputId === 6).id = 'INPUT_NUMBER';
  gomInputs.find(element => element.inputPreview.inputId === 7).id = 'INPUT_MEMO';
  const all = [...pcInputs, ...gomInputs];
  const scene = model.scenes.find(candidate => !candidate.conditionGroupId) || model.scenes[0];
  scene.elements = all;
  model.pages[0].elements = all;
  model.canvasWidth = 520;
  model.canvasHeight = 390;
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
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Item -LiteralPath $env:BOO_BROWSER_VERSION_EXECUTABLE).VersionInfo.ProductVersion',
    ], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
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
    + `complete=${/data-input-local-test=/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function decodeAttribute(value) {
  return String(value || '')
    .replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function runBrowserMatrix() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    return ['[browser] Edge/Chrome is not installed; the required real Chromium test cannot run'];
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-input-local-browser-'));
  try {
    const harness = path.join(temporary, 'input-local-validation.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.__booMessages = [];
window.acquireVsCodeApi = function () { return { postMessage: function (message) {
  window.__booMessages.push(message);
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
  function wrapper(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function control(id) { var root = wrapper(id); return root && root.querySelector('.dialog-input-control'); }
  function dragHandle(id) { var root = wrapper(id); return root && root.querySelector('.dialog-input-drag-handle'); }
  function errorNode(id) { var root = wrapper(id); return root && root.querySelector('.dialog-input-error'); }
  function fire(target, type, options) {
    target.dispatchEvent(new MouseEvent(type, Object.assign({
      bubbles: true, cancelable: true, button: 0, buttons: type === 'mousemove' ? 1 : 0,
    }, options || {})));
  }
  function visible(target) {
    if (!target) return false;
    var style = getComputedStyle(target);
    var rect = target.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden'
      && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
  }
  function setValue(id, value) {
    var node = control(id); node.focus(); node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    return node;
  }
  function assertError(id, text) {
    var node = errorNode(id);
    if (!node || node.hidden || node.textContent !== text || node.getAttribute('role') !== 'alert') {
      throw new Error(id + ' visible error mismatch: ' + (node && node.outerHTML));
    }
  }
  function assertValid(id) {
    var node = control(id), error = errorNode(id);
    if (!node || node.getAttribute('aria-invalid') !== 'false' || (error && !error.hidden)) {
      throw new Error(id + ' did not clear local validation: ' + wrapper(id).innerHTML);
    }
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  async function run() {
    for (var attempt = 0; attempt < 150 && !control('INPUT_MEMO'); attempt++) await wait(20);
    if (!control('INPUT_MEMO')) throw new Error('fixture model did not render all input controls');

    await check('all static inputs are focusable local-only controls', async function () {
      ['INPUT_TEXT', 'INPUT_PASSWORD', 'INPUT_ABSOLUTE', 'INPUT_NUMBER', 'INPUT_MEMO'].forEach(function (id) {
        var node = control(id), root = wrapper(id), handle = dragHandle(id);
        if (!node || node.readOnly || node.disabled || node.tabIndex < 0) {
          throw new Error(id + ' is not writable/focusable');
        }
        if (getComputedStyle(node).pointerEvents === 'none') throw new Error(id + ' blocks pointer events');
        if (!visible(handle) || handle.getAttribute('role') !== 'button') {
          throw new Error(id + ' has no visible explicit drag handle');
        }
        var boundary = root.querySelector('.dialog-input-local-boundary');
        if (!boundary || !/仅本地预览.*不提交服务器/.test(boundary.textContent)
          || root.dataset.inputCoverage !== 'local-preview') {
          throw new Error(id + ' has no visible local-only boundary');
        }
      });
    });

    await check('text length and onlyChinese validation show and clear errorTips', async function () {
      var node = setValue('INPUT_TEXT', '中文');
      assertError('INPUT_TEXT', '请输入3到6个中文字符');
      node = setValue('INPUT_TEXT', '中文A');
      assertError('INPUT_TEXT', '请输入3到6个中文字符');
      node = setValue('INPUT_TEXT', '中文汉');
      assertValid('INPUT_TEXT');
      node = setValue('INPUT_TEXT', '中文汉字测试者');
      assertError('INPUT_TEXT', '请输入3到6个中文字符');
    });

    await check('password remains masked and validates length locally', async function () {
      var node = control('INPUT_PASSWORD');
      if (node.type !== 'password') throw new Error('password input is not masked');
      setValue('INPUT_PASSWORD', 'abc');
      assertError('INPUT_PASSWORD', '密码长度错误');
      setValue('INPUT_PASSWORD', 'secret9');
      assertValid('INPUT_PASSWORD');
      if (document.getElementById('dialogCanvas').textContent.includes('secret9')) {
        throw new Error('password leaked into ordinary rendered canvas text');
      }
    });

    await check('traditional number validates numeric syntax and min/max value', async function () {
      setValue('INPUT_NUMBER', 'abc');
      assertError('INPUT_NUMBER', '请输入10到20之间的数字');
      setValue('INPUT_NUMBER', '9');
      assertError('INPUT_NUMBER', '请输入10到20之间的数字');
      setValue('INPUT_NUMBER', '15');
      assertValid('INPUT_NUMBER');
    });

    await check('absolute-number normalizes leading zero without inventing negative semantics', async function () {
      var node = setValue('INPUT_ABSOLUTE', '09');
      if (node.value !== '9') throw new Error('09 was not displayed as 9: ' + node.value);
      assertValid('INPUT_ABSOLUTE');
      setValue('INPUT_ABSOLUTE', '-9');
      assertError('INPUT_ABSOLUTE', '请输入1到3位绝对值数字');
    });

    await check('memo is a textarea with wrap and length validation', async function () {
      var node = control('INPUT_MEMO');
      if (node.tagName !== 'TEXTAREA' || node.wrap !== 'soft') {
        throw new Error('memo tag/wrap mismatch: ' + node.outerHTML);
      }
      setValue('INPUT_MEMO', 'abc');
      assertError('INPUT_MEMO', '请输入4到50个字符');
      setValue('INPUT_MEMO', 'abcd\\nefgh');
      assertValid('INPUT_MEMO');
    });

    await check('input body selects without dragging and keeps editing focus', async function () {
      var root = wrapper('INPUT_TEXT'), node = control('INPUT_TEXT');
      var before = root.style.left + ',' + root.style.top;
      var messageStart = window.__booMessages.length;
      node.focus();
      fire(node, 'mousedown', { buttons: 1, clientX: 30, clientY: 30 });
      fire(window, 'mousemove', { buttons: 1, clientX: 100, clientY: 100 });
      fire(window, 'mouseup', { buttons: 0, clientX: 100, clientY: 100 });
      fire(node, 'click', { clientX: 30, clientY: 30 });
      if (!root.classList.contains('selected')) throw new Error('input body did not select its wrapper');
      if (document.activeElement !== node) throw new Error('selecting the input stole its editing focus');
      node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
      if (root.style.left + ',' + root.style.top !== before) throw new Error('input gesture moved the canvas wrapper');
      var forbidden = window.__booMessages.slice(messageStart).filter(function (message) {
        return message.type !== 'dirtyChanged' && message.type !== 'ready';
      });
      if (forbidden.length) throw new Error('input gesture emitted host actions: ' + JSON.stringify(forbidden));
    });

    await check('input coordinate handle selects itself on keyboard focus', async function () {
      var previous = control('INPUT_NUMBER');
      previous.focus();
      await wait(10);
      var previousRoot = wrapper('INPUT_NUMBER');
      var previousLeft = Number.parseFloat(previousRoot.style.left);
      var root = wrapper('INPUT_TEXT');
      var beforeLeft = Number.parseFloat(root.style.left);
      var handle = dragHandle('INPUT_TEXT');
      handle.focus();
      if (document.activeElement !== handle) throw new Error('input drag handle could not receive focus');
      handle.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'ArrowRight'
      }));
      await wait(10);
      if (Number.parseFloat(wrapper('INPUT_TEXT').style.left) !== beforeLeft + 1) {
        throw new Error('focused input handle nudged a stale selection instead of itself');
      }
      if (Number.parseFloat(wrapper('INPUT_NUMBER').style.left) !== previousLeft) {
        throw new Error('focused input handle moved the previously selected input');
      }
      document.getElementById('resetPreview').click();
      await wait(20);
    });

    await check('real drag-handle hit selects, drags and keyboard-nudges the input', async function () {
      var root = wrapper('INPUT_TEXT'), handle = dragHandle('INPUT_TEXT');
      var rect = handle && handle.getBoundingClientRect();
      if (!rect || !visible(handle)) throw new Error('input drag handle is missing or invisible');
      var x = rect.left + rect.width / 2;
      var y = rect.top + rect.height / 2;
      var hit = document.elementFromPoint(x, y);
      if (!hit || !hit.closest('.dialog-input-drag-handle')) {
        throw new Error('elementFromPoint cannot hit the input drag handle: '
          + (hit ? hit.outerHTML : '<none>'));
      }
      var beforeLeft = Number.parseFloat(root.style.left);
      var beforeTop = Number.parseFloat(root.style.top);
      var rawBefore = window.__model.pages[0].elements.find(function (entry) {
        return entry.id === 'INPUT_TEXT';
      }).raw;
      var messageStart = window.__booMessages.length;
      fire(hit, 'mousedown', { buttons: 1, clientX: x, clientY: y });
      fire(window, 'mousemove', { buttons: 1, clientX: x + 24, clientY: y + 12 });
      fire(window, 'mouseup', { buttons: 0, clientX: x + 24, clientY: y + 12 });
      root = wrapper('INPUT_TEXT');
      if (Number.parseFloat(root.style.left) !== beforeLeft + 24
        || Number.parseFloat(root.style.top) !== beforeTop + 12) {
        throw new Error('drag handle did not move input wrapper: ' + beforeLeft + ',' + beforeTop
          + ' -> ' + root.style.left + ',' + root.style.top);
      }
      if (!root.classList.contains('selected')) throw new Error('drag handle did not select the input');
      var inspectorX = Number(document.getElementById('elementX').value);
      document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true, cancelable: true, key: 'ArrowRight'
      }));
      await wait(10);
      if (Number(document.getElementById('elementX').value) !== inspectorX + 1) {
        throw new Error('selected input did not respond to keyboard coordinate nudge');
      }
      var sourceElement = window.__model.pages[0].elements.find(function (entry) {
        return entry.id === 'INPUT_TEXT';
      });
      if (!sourceElement || sourceElement.raw !== rawBefore) {
        throw new Error('local input drag rewrote source before Apply');
      }
      var forbidden = window.__booMessages.slice(messageStart).filter(function (message) {
        return message.type !== 'dirtyChanged';
      });
      if (forbidden.length) throw new Error('drag handle emitted host actions: ' + JSON.stringify(forbidden));
    });

    await check('dynamic and invalid rules do not borrow resolved MOV values', async function () {
      var dynamic = wrapper('INPUT_DYNAMIC'), invalid = wrapper('INPUT_INVALID');
      if (!dynamic || !invalid) throw new Error('boundary controls are missing');
      if (!visible(dragHandle('INPUT_DYNAMIC')) || !visible(dragHandle('INPUT_INVALID'))) {
        throw new Error('read-only runtime input lost coordinate manipulation handles');
      }
      if (!control('INPUT_DYNAMIC').readOnly || !control('INPUT_INVALID').readOnly) {
        throw new Error('uncertain controls still accept deterministic local input');
      }
      if (control('INPUT_DYNAMIC').type === 'password'
        || dynamic.dataset.inputDynamicFields !== 'mode,min-length,max-length,only-chinese,show-background'
        || dynamic.dataset.inputCoverage !== 'runtime-placeholder') {
        throw new Error('dynamic source-safe metadata mismatch: ' + JSON.stringify(dynamic.dataset));
      }
      if (!invalid.dataset.inputInvalidFields || invalid.dataset.inputCoverage !== 'invalid-placeholder') {
        throw new Error('invalid boundary metadata mismatch: ' + JSON.stringify(invalid.dataset));
      }
      var dynamicBoundary = dynamic.querySelector('.dialog-input-local-boundary');
      if (!dynamicBoundary || !/运行时.*未知.*禁用/.test(dynamicBoundary.textContent)) {
        throw new Error('dynamic boundary is not visible');
      }
    });

    await check('reset clears local state and re-rendered controls are re-queried', async function () {
      setValue('INPUT_TEXT', '中文汉');
      setValue('INPUT_NUMBER', '15');
      setValue('INPUT_MEMO', 'abcd');
      var oldText = control('INPUT_TEXT');
      document.getElementById('resetPreview').click();
      await wait(30);
      var text = control('INPUT_TEXT'), number = control('INPUT_NUMBER'), memo = control('INPUT_MEMO');
      if (!text || text === oldText || text.value || number.value || memo.value) {
        throw new Error('reset did not replace DOM and clear local values');
      }
      if (text.getAttribute('aria-invalid') !== 'false' || !errorNode('INPUT_TEXT').hidden) {
        throw new Error('reset retained local validation error state');
      }
    });

    document.body.dataset.inputLocalDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.inputLocalTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.inputLocalErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.inputLocalTest = 'fail';
    document.body.dataset.inputLocalErrors = '[dom] scenario: '
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
        '--window-size=1000,760', '--virtual-time-budget=4200', '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8', timeout: 20000, maxBuffer: 12 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0 && /<body\b/i.test(result.stdout || '')
        && /data-input-local-test=/i.test(result.stdout || '')) {
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
      console.log(`input-local-validation-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-input-local-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`input-local-validation-browser.test.js: browser=${selected.candidate}`);
    console.log(`input-local-validation-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`input-local-validation-browser.test.js: DOM=${domCount}`);
    const encoded = /data-input-local-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    if (!/data-input-local-test="pass"/.test(selected.result.stdout)) {
      return decodeAttribute(encoded).split(' || ').filter(Boolean);
    }
    return [];
  } finally {
    if (process.env.BOO_KEEP_INPUT_LOCAL_TEST_TEMP === '1') {
      console.log(`input-local-validation-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

const failures = runBrowserMatrix();
if (failures.length > 0) {
  console.error('input-local-validation-browser.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('input-local-validation-browser.test.js: PASS');
}
