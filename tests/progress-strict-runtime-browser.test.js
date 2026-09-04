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

function parse(engine, sayLines, actLines = []) {
  const source = [
    '[@main]',
    ...(actLines.length > 0 ? ['#ACT', ...actLines] : []),
    '#SAY',
    ...sayLines,
    '',
  ].join('\n');
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/progress-browser-${engine}.txt`,
    fileName: `progress-browser-${engine}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\progress-browser-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function byRaw(elements, marker) {
  return elements.find(element => String(element.raw || '').includes(marker));
}

function byContainer(elements, id) {
  return elements.find(element => element.containerElementId === id);
}

function buildBrowserModel() {
  const gom = parse('GOM', [
    '<&ProgressBar:10:20:1:620:630:1:100:0:0:100:200:190:0:249:0:0:%p/%m:valid>',
    '<&ProgressBar:10:50:-1:-2:-3:3.5:-1:0:0:100:100:150:4:999:0:0:%p/%m:invalid>',
    '<&COUNTDOWN:0:1:251:0:0:0/@gomDone>',
    '<&IMGCOUNTDOWN:0:1:1320:10:0:0:0/@gomImageDone>',
  ]);
  const gee = parse('GEE', [
    '<&COUNTDOWN:0:1:251:0:0:0/@geeDone>',
    '<&IMGCOUNTDOWN:0:1:1320:10:0:0:0/@geeImageDone>',
  ]);
  const pc = parse('996PC', [
    '<COUNTDOWN:0:1:250:10:10/@pcLegacyDone>',
    '<TIMETIPS:0:1:250:10:10/@pcLegacyTimeDone>',
    '<COUNTDOWN|id=PC_COUNT|x=10|y=20|time=0|count=1|link=@pcCountDone>',
    '<TIMETIPS|id=PC_TIME|x=10|y=50|time=0|count=1|link=@pcTimeDone>',
    '<LoadingBar|id=LOAD_VALID|x=10|y=80|width=180|height=24|wil=NewopUI|pcloadingbg=100|pcloadingbar=101|startper=0|endper=1|maxper=100|interval=0.01|loadvalue=1|direction=0|HideText=0|link=@loadDone>',
    '<LoadingBar|id=LOAD_INVALID|x=10|y=110|width=180|height=24|wil=NewopUI|pcloadingbg=-1|pcloadingbar=1.5|startper=-1|endper=101|maxper=0|interval=0|loadvalue=0|direction=2|HideText=2|link=@invalidDone>',
    '<LoadingBar|id=LOAD_DYNAMIC|x=10|y=140|width=180|height=24|wil=NewopUI|pcloadingbg=100|pcloadingbar=<$STR(N$FILL)>|startper=<$STR(N$START)>|endper=<$STR(N$END)>|maxper=<$STR(N$MAX)>|interval=<$STR(N$INTERVAL)>|loadvalue=<$STR(N$STEP)>|direction=<$STR(N$DIR)>|HideText=<$STR(N$HIDE)>|link=@dynamicDone>',
    '<PercentImg|id=P_VALID|x=10|y=170|width=180|height=24|direction=2|wil=NewopUI|pcimg=231|minValue=50|maxValue=100>',
    '<PercentImg|id=P_INVALID|x=10|y=200|width=180|height=24|direction=4|wil=NewopUI|pcimg=-1|minValue=200|maxValue=0>',
    '<Slider|id=S_VALID|x=10|y=230|width=200|height=24|sliderid=N0|wil=NewopUI|pcbgimg=298|pcbarimg=299|pcballimg=297|maxvalue=100|defvalue=25|link=@slideDone>',
    '<Slider|id=S_INVALID|x=10|y=260|width=200|height=24|sliderid=S0|wil=NewopUI|pcbgimg=-1|pcbarimg=1.5|pcballimg=-2|maxvalue=0|defvalue=-1|link=@invalidSlide>',
  ], [
    'MOV N$FILL 9970', 'MOV N$START 37', 'MOV N$END 73', 'MOV N$MAX 77',
    'MOV N$INTERVAL 2', 'MOV N$STEP 9', 'MOV N$DIR 1', 'MOV N$HIDE 1',
  ]);

  const gomElements = gom.pages[0].elements;
  const geeElements = gee.pages[0].elements;
  const pcElements = pc.pages[0].elements;
  const fixtures = [
    ['GOM_PROGRESS_VALID', byRaw(gomElements, ':valid>')],
    ['GOM_PROGRESS_INVALID', byRaw(gomElements, ':invalid>')],
    ['GOM_COUNTDOWN', byRaw(gomElements, '/@gomDone>')],
    ['GOM_IMGCOUNTDOWN', byRaw(gomElements, '/@gomImageDone>')],
    ['GEE_COUNTDOWN', byRaw(geeElements, '/@geeDone>')],
    ['GEE_IMGCOUNTDOWN', byRaw(geeElements, '/@geeImageDone>')],
    ['PC_LEGACY_COUNTDOWN', byRaw(pcElements, '/@pcLegacyDone>')],
    ['PC_LEGACY_TIMETIPS', byRaw(pcElements, '/@pcLegacyTimeDone>')],
    ['PC_COUNTDOWN', byContainer(pcElements, 'PC_COUNT')],
    ['PC_TIMETIPS', byContainer(pcElements, 'PC_TIME')],
    ['PC_LOADING_VALID', byContainer(pcElements, 'LOAD_VALID')],
    ['PC_LOADING_INVALID', byContainer(pcElements, 'LOAD_INVALID')],
    ['PC_LOADING_DYNAMIC', byContainer(pcElements, 'LOAD_DYNAMIC')],
    ['PC_PERCENT_VALID', byContainer(pcElements, 'P_VALID')],
    ['PC_PERCENT_INVALID', byContainer(pcElements, 'P_INVALID')],
    ['PC_SLIDER_VALID', byContainer(pcElements, 'S_VALID')],
    ['PC_SLIDER_INVALID', byContainer(pcElements, 'S_INVALID')],
  ];
  const elements = fixtures.flatMap(([id, sourceElement], index) => {
    if (!sourceElement) return [];
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = 20 + column * 350;
    const y = 25 + row * 88;
    return [{
      ...sourceElement,
      id,
      editable: false,
      x: undefined,
      y: undefined,
      coordinateMode: 'absolute',
      localLayoutX: x,
      localLayoutY: y,
      layoutX: x,
      layoutY: y,
      width: Math.max(235, Number(sourceElement.width) || 0),
      height: Math.max(56, Number(sourceElement.height) || 0),
    }];
  });
  const base = pc;
  base.scenes = [{ ...base.scenes[0], id: 'PROGRESS_BROWSER_SCENE', elements }];
  base.pages = [{ ...base.pages[0], id: 'PROGRESS_BROWSER_PAGE', elements }];
  base.canvasWidth = 1100;
  base.canvasHeight = 620;
  return base;
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
    console.log('progress-strict-runtime-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-progress-strict-browser-'));
  try {
    const harness = path.join(temporary, 'progress-strict-runtime.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(buildBrowserModel())};
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
  function text(wrapper, selector) {
    var value = wrapper && wrapper.querySelector(selector);
    return value ? value.textContent.trim() : '';
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  function assertNoGenericClick(wrapper, id) {
    if (wrapper.querySelector('.runtime-action-hitarea')) {
      throw new Error(id + ' invented a generic click hit-area');
    }
    if (wrapper.querySelector('[data-runtime-trigger="click"]')) {
      throw new Error(id + ' exposes click semantics for a non-click action');
    }
  }
  function assertCompletion(id, link) {
    var wrapper = node(id);
    if (!wrapper) throw new Error(id + ' did not render');
    if (wrapper.dataset.runtimeActionScope !== 'local'
      || wrapper.dataset.runtimeTrigger !== 'completion'
      || wrapper.dataset.runtimeLink !== link
      || wrapper.dataset.runtimeActionInteractive !== 'false') {
      throw new Error(id + ' is not a typed local-only completion action');
    }
    assertNoGenericClick(wrapper, id);
    var boundary = text(wrapper, '.runtime-action-boundary');
    if (boundary.indexOf(link) < 0 || !/仅本地预览/.test(boundary) || !/不执行/.test(boundary)) {
      throw new Error(id + ' completion boundary is incomplete: ' + boundary);
    }
    var summary = text(wrapper, '.runtime-action-summary');
    if (wrapper.dataset.runtimeActionStatus !== 'simulated'
      || summary.indexOf(link) < 0
      || !/仅本地预览/.test(summary)
      || !/不执行/.test(summary)) {
      throw new Error(id + ' did not produce a local completion summary: ' + summary);
    }
  }
  function assertBlockedProgress(id, kind) {
    var wrapper = node(id);
    if (!wrapper) throw new Error(id + ' did not render');
    if (wrapper.dataset.progressBlocked !== kind) {
      throw new Error(id + ' progressBlocked=' + wrapper.dataset.progressBlocked + ', expected ' + kind);
    }
    if (wrapper.querySelector('.progress-caption')) {
      throw new Error(id + ' rendered a plausible caption from an unknown/invalid value');
    }
    var boundary = text(wrapper, '.progress-runtime-boundary');
    var expected = kind === 'dynamic' ? /动态.*不借用|不借用.*动态/ : /无效/;
    if (!expected.test(boundary)) throw new Error(id + ' has no visible ' + kind + ' boundary: ' + boundary);
    assertNoGenericClick(wrapper, id);
  }

  async function run() {
    for (var attempt = 0; attempt < 120 && !node('GOM_PROGRESS_VALID'); attempt++) await wait(10);
    if (!node('GOM_PROGRESS_VALID')) throw new Error('progress fixture did not render');
    await wait(240);

    await check('valid progress values remain visible and directional', async function () {
      var legacy = node('GOM_PROGRESS_VALID');
      var percent = node('PC_PERCENT_VALID');
      if (legacy.dataset.progressBlocked !== 'none') {
        throw new Error('valid GOM ProgressBar was blocked');
      }
      if (text(legacy, '.progress-caption').indexOf('190/200') < 0) {
        throw new Error('valid GOM caption is not faithful: ' + text(legacy, '.progress-caption'));
      }
      if (percent.dataset.progressBlocked !== 'none'
        || percent.dataset.progressDirection !== '2'
        || percent.dataset.progressRatio !== '0.5') {
        throw new Error('valid PercentImg lost direction/ratio metadata');
      }
    });

    await check('invalid and dynamic progress never masquerade as a clamped value', async function () {
      assertBlockedProgress('GOM_PROGRESS_INVALID', 'invalid');
      assertBlockedProgress('PC_LOADING_INVALID', 'invalid');
      assertBlockedProgress('PC_LOADING_DYNAMIC', 'dynamic');
      assertBlockedProgress('PC_PERCENT_INVALID', 'invalid');
      assertBlockedProgress('PC_SLIDER_INVALID', 'invalid');
      var dynamicText = node('PC_LOADING_DYNAMIC').textContent;
      if (/9970|37%|73%|77%/.test(dynamicText)) {
        throw new Error('dynamic LoadingBar borrowed a MOV value into the DOM: ' + dynamicText);
      }
      if (node('PC_LOADING_DYNAMIC').dataset.progressRunning === 'true') {
        throw new Error('dynamic LoadingBar started a fake deterministic animation');
      }
    });

    await check('COUNTDOWN TIMETIPS IMGCOUNTDOWN and LoadingBar fire completion locally', async function () {
      var actions = [
        ['GOM_COUNTDOWN', '@gomDone'],
        ['GOM_IMGCOUNTDOWN', '@gomImageDone'],
        ['GEE_COUNTDOWN', '@geeDone'],
        ['GEE_IMGCOUNTDOWN', '@geeImageDone'],
        ['PC_LEGACY_COUNTDOWN', '@pcLegacyDone'],
        ['PC_LEGACY_TIMETIPS', '@pcLegacyTimeDone'],
        ['PC_COUNTDOWN', '@pcCountDone'],
        ['PC_TIMETIPS', '@pcTimeDone'],
        ['PC_LOADING_VALID', '@loadDone'],
      ];
      for (var action of actions) assertCompletion(action[0], action[1]);
      if (node('PC_LOADING_VALID').dataset.progressRunning !== 'false'
        || node('PC_LOADING_VALID').dataset.progressCurrent !== '1') {
        throw new Error('LoadingBar did not finish its deterministic local progress');
      }
    });

    await check('Slider uses change semantics and summarizes without a generic click action', async function () {
      var wrapper = node('PC_SLIDER_VALID');
      var control = wrapper && wrapper.querySelector('.slider-hitarea');
      if (!wrapper || !control) throw new Error('valid Slider did not render its local control');
      if (wrapper.dataset.runtimeActionScope !== 'local'
        || wrapper.dataset.runtimeTrigger !== 'change'
        || wrapper.dataset.runtimeLink !== '@slideDone') {
        throw new Error('Slider link is not typed as a local change action');
      }
      assertNoGenericClick(wrapper, 'PC_SLIDER_VALID');
      var before = window.__postedMessages.length;
      var rect = wrapper.getBoundingClientRect();
      control.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width * 0.75,
      }));
      await wait(30);
      wrapper = node('PC_SLIDER_VALID');
      var summary = text(wrapper, '.runtime-action-summary');
      if (wrapper.dataset.runtimeActionStatus !== 'simulated'
        || summary.indexOf('@slideDone') < 0
        || !/仅本地预览/.test(summary)) {
        throw new Error('Slider change did not create a local link summary: ' + summary);
      }
      var unexpected = window.__postedMessages.slice(before).filter(function (message) {
        return message && message.type !== 'select';
      });
      if (unexpected.length) throw new Error('Slider action escaped to extension/server: ' + JSON.stringify(unexpected));
    });

    await check('runtime completion never posts, navigates, or opens a target', async function () {
      var unexpected = window.__postedMessages.filter(function (message) {
        return message && message.type !== 'ready' && message.type !== 'select';
      });
      if (unexpected.length) throw new Error('completion posted messages: ' + JSON.stringify(unexpected));
      if (window.__openedLinks.length) throw new Error('runtime action called window.open');
      if (!/progress-strict-runtime\.html/i.test(location.pathname)) {
        throw new Error('runtime action navigated away: ' + location.href);
      }
    });

    document.body.dataset.progressStrictDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.progressStrictTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.progressStrictErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.progressStrictTest = 'fail';
    document.body.dataset.progressStrictErrors = '[dom] scenario: '
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
        '--window-size=1280,900', '--virtual-time-budget=3000', '--dump-dom',
        pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-progress-strict-test=/i.test(result.stdout || '')) {
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
      console.log(`progress-strict-runtime-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-progress-strict-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`progress-strict-runtime-browser.test.js: browser=${selected.candidate}`);
    console.log(`progress-strict-runtime-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`progress-strict-runtime-browser.test.js: DOM=${domCount}`);
    if (/data-progress-strict-test="pass"/.test(selected.result.stdout)) return [];
    const encoded = /data-progress-strict-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    return decodeAttribute(encoded).split(' || ').filter(Boolean);
  } finally {
    if (process.env.BOO_KEEP_PROGRESS_STRICT_TEST_TEMP === '1') {
      console.log(`progress-strict-runtime-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

function main() {
  const failures = runBrowserMatrix();
  if (failures.length) {
    console.error('progress-strict-runtime-browser.test.js: RED FAILURE MATRIX');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('progress-strict-runtime-browser.test.js: PASS');
}

main();
