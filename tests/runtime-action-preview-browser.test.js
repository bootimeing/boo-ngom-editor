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
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Item -LiteralPath $env:BOO_BROWSER_VERSION_EXECUTABLE).VersionInfo.ProductVersion',
    ], {
      encoding: 'utf8', timeout: 5000, windowsHide: true,
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

function parseModel() {
  const source = [
    '[@main]',
    '#ACT',
    'MOV N$SUBMIT_ID 2',
    'MOV S$ACTION_LINK @动态提交',
    '#SAY',
    '<Input|id=INPUT_ONE|x=20|y=20|width=120|height=24|inputid=1|type=0|place=名字>',
    '<Input|id=INPUT_TWO|x=20|y=55|width=120|height=24|inputid=2|type=1|place=数量>',
    '<Img|id=SUBMIT_STATIC|x=170|y=20|width=60|height=30|wil=NewopUI|pcimg=115|submitInput=1,2|link=@提交>',
    '<EquipShow|id=EQUIP_ACTION|x=170|y=70|width=45|height=45|index=0|showtips=1|bgtype=1|link=@单击装备|dblink=@双击装备|reload=1>',
    '<CheckBox|id=CHECK_ACTION|x=170|y=130|width=30|height=30|checkboxid=N0|wil=NewopUI|pcnimg=145|pcpimg=144|default=0|delay=3|count=2|link=@勾选触发>',
    '<Img|id=DYNAMIC_ACTION|x=260|y=20|width=60|height=30|wil=NewopUI|pcimg=116|submitInput=1,<$STR(N$SUBMIT_ID)>|link=<$STR(S$ACTION_LINK)>>',
    '<EquipShow|id=INVALID_EQUIP|x=260|y=70|width=45|height=45|index=1|reload=2|dblink=>',
    '<CheckBox|id=INVALID_AUTO|x=260|y=130|width=30|height=30|checkboxid=N1|wil=NewopUI|pcnimg=145|pcpimg=144|default=0|delay=-1|count=1.5|link=@无效自动提交>',
  ].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/runtime-action-preview-browser.txt',
    fileName: 'runtime-action-preview-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\runtime-action-preview-browser.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
  const page = model.pages.find(candidate => (
    candidate.elements || []
  ).some(element => element.containerElementId === 'SUBMIT_STATIC')) || model.pages[0];
  const wanted = new Map([
    ['INPUT_ONE', 'ACTION_INPUT_ONE'],
    ['INPUT_TWO', 'ACTION_INPUT_TWO'],
    ['SUBMIT_STATIC', 'ACTION_SUBMIT'],
    ['EQUIP_ACTION', 'ACTION_EQUIP'],
    ['CHECK_ACTION', 'ACTION_CHECK'],
    ['DYNAMIC_ACTION', 'ACTION_DYNAMIC'],
    ['INVALID_EQUIP', 'ACTION_INVALID_EQUIP'],
    ['INVALID_AUTO', 'ACTION_INVALID_AUTO'],
  ]);
  const elements = page.elements.filter(element => wanted.has(element.containerElementId));
  for (const element of elements) element.id = wanted.get(element.containerElementId);
  const scene = model.scenes.find(candidate => (
    candidate.elements || []
  ).some(element => element.containerElementId === 'SUBMIT_STATIC')) || model.scenes[0];
  scene.elements = elements;
  page.elements = elements;
  model.canvasWidth = 620;
  model.canvasHeight = 360;
  return model;
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
    console.log('runtime-action-preview-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-runtime-action-browser-'));
  try {
    const harness = path.join(temporary, 'runtime-action-preview.html');
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
  var submitSimulationSucceeded = false;
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function boundary(wrapper) {
    return [wrapper && wrapper.title, wrapper && wrapper.getAttribute('aria-label'),
      wrapper && wrapper.textContent].filter(Boolean).join(' ');
  }
  function summary(wrapper) {
    var value = wrapper && wrapper.querySelector('.runtime-action-summary');
    return value ? value.textContent.trim() : '';
  }
  function postedTypes(from) {
    return window.__postedMessages.slice(from).map(function (message) { return message.type; });
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('ACTION_SUBMIT'); attempt++) await wait(20);
    if (!node('ACTION_SUBMIT')) throw new Error('runtime-action fixture did not render');

    await check('typed runtime actions are visible and explicitly local-only', async function () {
      var submit = node('ACTION_SUBMIT');
      var equip = node('ACTION_EQUIP');
      var checkNode = node('ACTION_CHECK');
      var errors = [];
      if (submit.dataset.runtimeActionScope !== 'local'
        || submit.dataset.runtimeSubmitInputs !== '1,2'
        || submit.dataset.runtimeLink !== '@提交') {
        errors.push('Img submitInput/link datasets missing');
      }
      if (equip.dataset.runtimeLink !== '@单击装备'
        || equip.dataset.runtimeDoubleClickLink !== '@双击装备'
        || equip.dataset.runtimeReload !== 'true') {
        errors.push('EquipShow link/dblink/reload datasets missing');
      }
      if (checkNode.dataset.runtimeDelay !== '3'
        || checkNode.dataset.runtimeCount !== '2'
        || checkNode.dataset.runtimeDelayUnit !== 'manual-unspecified') {
        errors.push('CheckBox delay/count or unknown-unit boundary missing');
      }
      for (var wrapper of [submit, equip, checkNode]) {
        var text = boundary(wrapper);
        if (!wrapper.querySelector('.runtime-action-boundary')
          || !/仅本地预览/.test(text)
          || !/不提交服务器/.test(text)
          || !/不执行/.test(text)) {
          errors.push('local-only visible boundary missing for ' + wrapper.dataset.elementId);
        }
      }
      if (!/delay.*单位.*未公开|单位.*未公开.*delay/i.test(boundary(checkNode))) {
        errors.push('CheckBox delay unit evidence boundary missing');
      }
      if (errors.length) throw new Error(errors.join('; '));
    });

    await check('Img click summarizes local Input values without server execution', async function () {
      node('ACTION_INPUT_ONE').querySelector('.dialog-input-control').value = '张三';
      node('ACTION_INPUT_TWO').querySelector('.dialog-input-control').value = '42';
      var before = node('ACTION_SUBMIT');
      var hit = before.querySelector('.runtime-action-hitarea[data-runtime-trigger="click"]');
      if (!hit || hit.disabled) throw new Error('static Img action has no local click target');
      var postStart = window.__postedMessages.length;
      var hrefBefore = location.href;
      var sceneBefore = document.getElementById('sceneTitle').textContent;
      hit.click();
      await wait(40);
      var live = node('ACTION_SUBMIT');
      var text = summary(live);
      var errors = [];
      if (!/1=张三/.test(text) || !/2=42/.test(text)) {
        errors.push('local Input value summary missing: ' + text);
      }
      if (!/@提交/.test(text) || !/仅本地预览/.test(text)) {
        errors.push('local label simulation boundary missing: ' + text);
      }
      if (live.dataset.runtimeActionStatus !== 'simulated') {
        errors.push('local action status was not retained');
      }
      var emitted = postedTypes(postStart);
      if (emitted.length) errors.push('action posted messages: ' + emitted.join(','));
      if (location.href !== hrefBefore
        || document.getElementById('sceneTitle').textContent !== sceneBefore
        || window.__openedLinks.length !== 0) {
        errors.push('server link/navigation was executed');
      }
      if (errors.length) throw new Error(errors.join('; '));
      submitSimulationSucceeded = true;
    });

    await check('single/double click and CheckBox auto-submit config stay local', async function () {
      var equip = node('ACTION_EQUIP');
      var hit = equip.querySelector('.runtime-action-hitarea');
      if (!hit) throw new Error('EquipShow has no local runtime hit target');
      var postStart = window.__postedMessages.length;
      hit.click();
      await wait(30);
      equip = node('ACTION_EQUIP');
      if (!/@单击装备/.test(summary(equip)) || !/不执行/.test(summary(equip))) {
        throw new Error('single-click local simulation missing: ' + summary(equip));
      }
      hit = equip.querySelector('.runtime-action-hitarea');
      hit.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await wait(30);
      equip = node('ACTION_EQUIP');
      if (!/@双击装备/.test(summary(equip)) || !/不执行/.test(summary(equip))) {
        throw new Error('double-click local simulation missing: ' + summary(equip));
      }
      var checkbox = node('ACTION_CHECK');
      checkbox.querySelector('.toggle-hitarea').click();
      await wait(40);
      checkbox = node('ACTION_CHECK');
      if (checkbox.querySelector('.toggle-hitarea').dataset.toggleState !== 'checked') {
        throw new Error('CheckBox local state did not change');
      }
      if (!/delay=3|间隔.*3/i.test(boundary(checkbox))
        || !/count=2|次数.*2/i.test(boundary(checkbox))) {
        throw new Error('auto-submit configuration is not visible');
      }
      if (postedTypes(postStart).length || window.__openedLinks.length) {
        throw new Error('local action simulation reached extension/server');
      }
    });

    await check('dynamic and invalid actions are visibly blocked', async function () {
      var dynamic = node('ACTION_DYNAMIC');
      var invalidEquip = node('ACTION_INVALID_EQUIP');
      var invalidAuto = node('ACTION_INVALID_AUTO');
      for (var wrapper of [dynamic, invalidEquip, invalidAuto]) {
        if (wrapper.dataset.runtimeActionInteractive !== 'false') {
          throw new Error(wrapper.dataset.elementId + ' is not blocked');
        }
        var active = wrapper.querySelector('.runtime-action-hitarea:not([disabled])');
        if (active) throw new Error(wrapper.dataset.elementId + ' retained an active server action');
      }
      if (!/动态.*不借用|不借用.*动态/.test(boundary(dynamic))) {
        throw new Error('dynamic source-safety boundary missing');
      }
      if (/动态提交/.test(boundary(dynamic)) || /submit.*1,2/i.test(boundary(dynamic))) {
        throw new Error('dynamic action borrowed MOV values');
      }
      if (!/无效/.test(boundary(invalidEquip) + boundary(invalidAuto))) {
        throw new Error('invalid action boundary missing');
      }
    });

    await check('reset clears local inputs and action simulation only', async function () {
      if (!submitSimulationSucceeded) throw new Error('precondition: submit simulation did not succeed');
      var postStart = window.__postedMessages.length;
      document.getElementById('resetPreview').click();
      await wait(40);
      var inputOne = node('ACTION_INPUT_ONE').querySelector('.dialog-input-control');
      var inputTwo = node('ACTION_INPUT_TWO').querySelector('.dialog-input-control');
      var submit = node('ACTION_SUBMIT');
      var checkNode = node('ACTION_CHECK');
      if (inputOne.value !== '' || inputTwo.value !== '') {
        throw new Error('reset retained local Input values');
      }
      if (submit.dataset.runtimeActionStatus !== 'idle'
        || /张三|42/.test(summary(submit))) {
        throw new Error('reset retained a simulated submission');
      }
      if (checkNode.querySelector('.toggle-hitarea').dataset.toggleState !== 'unchecked') {
        throw new Error('reset did not restore CheckBox source default');
      }
      var emitted = postedTypes(postStart);
      if (emitted.filter(function (type) { return type === 'resetPreview'; }).length !== 1
        || emitted.some(function (type) { return type !== 'resetPreview'; })) {
        throw new Error('reset emitted unexpected runtime/server messages: ' + emitted.join(','));
      }
      if (window.__openedLinks.length) throw new Error('reset executed a server link');
    });

    document.body.dataset.runtimeActionDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.runtimeActionTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.runtimeActionErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.runtimeActionTest = 'fail';
    document.body.dataset.runtimeActionErrors = '[dom] scenario: '
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
        '--window-size=1100,760', '--virtual-time-budget=1800', '--dump-dom',
        pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 20000, maxBuffer: 12 * 1024 * 1024 });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-runtime-action-test=/i.test(result.stdout || '')) {
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
      console.log(`runtime-action-preview-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-runtime-action-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`runtime-action-preview-browser.test.js: browser=${selected.candidate}`);
    console.log(`runtime-action-preview-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`runtime-action-preview-browser.test.js: DOM=${domCount}`);
    if (/data-runtime-action-test="pass"/.test(selected.result.stdout)) return [];
    const encoded = /data-runtime-action-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    return decodeAttribute(encoded).split(' || ').filter(Boolean);
  } finally {
    if (process.env.BOO_KEEP_RUNTIME_ACTION_TEST_TEMP === '1') {
      console.log(`runtime-action-preview-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

function main() {
  const failures = runBrowserMatrix();
  if (failures.length) {
    console.error('runtime-action-preview-browser.test.js: RED FAILURE MATRIX');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('runtime-action-preview-browser.test.js: PASS');
}

main();
