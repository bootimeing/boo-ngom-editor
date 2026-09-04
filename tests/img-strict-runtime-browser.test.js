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
  const source = [
    '[@main]',
    '#ACT',
    'MOV N$IMG_VALUE 1',
    'MOV N$IMG_OPACITY 128',
    'MOV N$IMG_SHOW 4',
    'MOV N$IMG_LAYER 1000',
    'MOV N$IMG_SCALE 10',
    '#SAY',
    '<Img|id=STATIC|x=20|y=20|width=180|height=120|wil=NewopUI|pcimg=108|opacity=128|grey=1|bg=1|esc=1|move=1|reset=1|loadDelay=1|hideMain=1|forbidBagEquip=1|bagPos=1|reload=1|show=4|layerid=1000|scale9l=10|scale9r=11|scale9t=12|scale9b=13>',
    '<Img|id=DEFAULT|x=230|y=20|width=80|height=50|wil=NewopUI|pcimg=108>',
    '<Img|id=DYNAMIC|x=20|y=180|width=100|height=60|wil=NewopUI|pcimg=108|opacity=<$STR(N$IMG_OPACITY)>|grey=<$STR(N$IMG_VALUE)>|bg=<$STR(N$IMG_VALUE)>|esc=<$STR(N$IMG_VALUE)>|move=<$STR(N$IMG_VALUE)>|reset=<$STR(N$IMG_VALUE)>|loadDelay=<$STR(N$IMG_VALUE)>|hideMain=<$STR(N$IMG_VALUE)>|forbidBagEquip=<$STR(N$IMG_VALUE)>|bagPos=<$STR(N$IMG_VALUE)>|reload=<$STR(N$IMG_VALUE)>|show=<$STR(N$IMG_SHOW)>|layerid=<$STR(N$IMG_LAYER)>|scale9l=<$STR(N$IMG_SCALE)>|scale9r=<$STR(N$IMG_SCALE)>|scale9t=<$STR(N$IMG_SCALE)>|scale9b=<$STR(N$IMG_SCALE)>>',
    '<Img|id=INVALID|x=140|y=180|width=100|height=60|wil=NewopUI|pcimg=108|opacity=256|grey=2|bg=-1|esc=2|move=-1|reset=2|loadDelay=2|hideMain=-1|forbidBagEquip=3|bagPos=2|reload=-1|show=5|layerid=bad|scale9l=-1|scale9r=-2|scale9t=-3|scale9b=-4>',
    '<Img|id=DIRECT|x=270|y=180|width=160|height=80|img=public/bg_npc_01.png|bg=1|reset=1|show=0|layerid=1234|loadDelay=1|reload=1>',
    '<Img|id=TRAVERSAL|x=450|y=180|width=160|height=80|img=public/../../outside/secret.png|bg=1>',
  ].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/img-strict-runtime-browser.txt',
    fileName: 'img-strict-runtime-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\img-strict-runtime-browser.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
  const ids = new Map([
    ['STATIC', 'IMG_RUNTIME_STATIC'],
    ['DEFAULT', 'IMG_RUNTIME_DEFAULT'],
    ['DYNAMIC', 'IMG_RUNTIME_DYNAMIC'],
    ['INVALID', 'IMG_RUNTIME_INVALID'],
    ['DIRECT', 'IMG_RUNTIME_DIRECT'],
    ['TRAVERSAL', 'IMG_RUNTIME_TRAVERSAL'],
  ]);
  const elements = model.pages[0].elements.filter(element => ids.has(element.containerElementId));
  for (const element of elements) {
    element.id = ids.get(element.containerElementId);
    if (['STATIC', 'DEFAULT', 'DYNAMIC', 'INVALID'].includes(element.containerElementId)) {
      element.asset = {
        status: 'ready',
        url: `${pixel}#${element.containerElementId}`,
        archiveLabel: 'NewopUI/000108',
        width: 64,
        height: 48,
        offsetX: 0,
        offsetY: 0,
      };
    }
  }
  const scene = model.scenes.find(candidate => (
    candidate.elements || []
  ).some(element => element.containerElementId === 'STATIC')) || model.scenes[0];
  scene.elements = elements;
  model.pages[0].elements = elements;
  model.canvasWidth = 760;
  model.canvasHeight = 420;
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
    console.log('img-strict-runtime-browser.test.js: SKIP (Edge/Chrome is not installed)');
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-img-strict-runtime-browser-'));
  try {
    const harness = path.join(temporary, 'img-strict-runtime.html');
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
  var requiredFields = [
    'opacity', 'gray', 'background', 'escape-close', 'move', 'reset',
    'load-delay', 'hide-main', 'forbid-bag-equip', 'bag-position', 'reload',
    'show-position', 'layer-id', 'scale9-left', 'scale9-right',
    'scale9-top', 'scale9-bottom'
  ];
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function boundary(wrapper) {
    return [wrapper && wrapper.title, wrapper && wrapper.getAttribute('aria-label'),
      wrapper && wrapper.textContent].filter(Boolean).join(' ');
  }
  function fieldSet(value) {
    return new Set(String(value || '').split(',').filter(Boolean));
  }
  function missingFields(value) {
    var values = fieldSet(value);
    return requiredFields.filter(function (field) { return !values.has(field); });
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('IMG_RUNTIME_STATIC'); attempt++) await wait(20);
    if (!node('IMG_RUNTIME_STATIC')) throw new Error('Img strict-runtime fixture did not render');

    await check('static runtime metadata is typed and explicitly local-only', async function () {
      var wrapper = node('IMG_RUNTIME_STATIC');
      var expected = {
        imageOpacity: '128', imageGray: 'true', imageBackground: 'true',
        imageShowPosition: '4', imageScale9: '10,11,12,13',
        imageEscapeClose: 'true', imageMove: 'true', imageReset: 'true',
        imageLoadDelay: 'true', imageHideMain: 'true',
        imageForbidBagEquip: 'true', imageBagPosition: '1', imageReload: 'true',
        imageLayerId: '1000', imageRuntimeScope: 'local'
      };
      var errors = [];
      for (var entry of Object.entries(expected)) {
        if (wrapper.dataset[entry[0]] !== entry[1]) {
          errors.push(entry[0] + '=' + String(wrapper.dataset[entry[0]]));
        }
      }
      var text = boundary(wrapper);
      if (!wrapper.querySelector('.image-runtime-boundary')
        || !/仅展示|局部模拟|仅本地预览/.test(text)
        || !/不执行|不控制客户端|不会真实/.test(text)) {
        errors.push('visible local-only runtime boundary missing');
      }
      if (errors.length) throw new Error(errors.join('; '));
    });

    await check('opacity grey and scale9 are confined to the image element', async function () {
      var wrapper = node('IMG_RUNTIME_STATIC');
      var image = wrapper.querySelector('.dialog-image-nine-slice');
      if (!image) throw new Error('valid non-negative scale9 did not render a nine-slice');
      var opacity = Number(image.style.opacity);
      if (Math.abs(opacity - 128 / 255) > 0.0001 || image.style.filter !== 'grayscale(1)') {
        throw new Error('local opacity/grey effect mismatch: ' + image.style.opacity + ',' + image.style.filter);
      }
      if (getComputedStyle(document.getElementById('canvasViewport')).display === 'none'
        || getComputedStyle(document.getElementById('sceneList')).display === 'none') {
        throw new Error('hideMain escaped the preview wrapper and hid editor UI');
      }
    });

    await check('esc reset move loadDelay hideMain forbidBagEquip bagPos reload and layerid never execute', async function () {
      var before = window.__postedMessages.length;
      var wrapper = node('IMG_RUNTIME_STATIC');
      var left = wrapper.style.left;
      var top = wrapper.style.top;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      wrapper.click();
      await wait(80);
      if (!node('IMG_RUNTIME_STATIC') || !node('IMG_RUNTIME_DEFAULT')
        || !node('IMG_RUNTIME_DIRECT')) {
        throw new Error('runtime field closed, delayed or reloaded preview content');
      }
      wrapper = node('IMG_RUNTIME_STATIC');
      if (wrapper.style.left !== left || wrapper.style.top !== top) {
        throw new Error('move/reset changed coordinates without an editor drag');
      }
      var emitted = window.__postedMessages.slice(before).map(function (message) { return message.type; });
      if (emitted.length || window.__openedLinks.length) {
        throw new Error('runtime field executed host action: ' + emitted.join(','));
      }
    });

    await check('missing dynamic and invalid states remain visibly distinct', async function () {
      var defaults = node('IMG_RUNTIME_DEFAULT');
      var dynamic = node('IMG_RUNTIME_DYNAMIC');
      var invalid = node('IMG_RUNTIME_INVALID');
      var errors = [];
      var missingDefault = missingFields(defaults.dataset.imageDefaultFields);
      var missingDynamic = missingFields(dynamic.dataset.imageDynamicFields);
      var missingInvalid = missingFields(invalid.dataset.imageInvalidFields);
      if (missingDefault.length) errors.push('default=' + missingDefault.join(','));
      if (missingDynamic.length) errors.push('dynamic=' + missingDynamic.join(','));
      if (missingInvalid.length) errors.push('invalid=' + missingInvalid.join(','));
      if (dynamic.dataset.imageOpacity === '128'
        || dynamic.dataset.imageShowPosition === '4'
        || dynamic.dataset.imageLayerId === '1000') {
        errors.push('dynamic fields borrowed MOV values');
      }
      if (invalid.dataset.imageOpacity === '255'
        || invalid.dataset.imageGray === 'true'
        || invalid.dataset.imageScale9) {
        errors.push('invalid values were clamped/coerced into a valid draw');
      }
      if (!/默认|未填写|缺省/.test(boundary(defaults))) errors.push('default boundary missing');
      if (!/动态|运行时/.test(boundary(dynamic))
        || !/不借用.*当前值|当前值.*不借用/.test(boundary(dynamic))) {
        errors.push('dynamic source-safety boundary missing');
      }
      if (!/无效|超出|非法/.test(boundary(invalid))) errors.push('invalid boundary missing');
      if (errors.length) throw new Error(errors.join('; '));
    });

    await check('public direct path is Evidence-blocked rather than cache-missing', async function () {
      var wrapper = node('IMG_RUNTIME_DIRECT');
      var text = boundary(wrapper);
      if (wrapper.dataset.imageDirectPath !== 'public/bg_npc_01.png'
        || wrapper.dataset.imageDirectPathStatus !== 'evidence-blocked') {
        throw new Error('typed direct-path metadata missing');
      }
      if (!/Evidence-blocked/i.test(text)
        || !/直接路径|public\\/bg_npc_01\\.png/i.test(text)) {
        throw new Error('visible Evidence-blocked direct-path boundary missing: ' + text);
      }
      if (/素材未缓存|缓存已失效/.test(text)) {
        throw new Error('direct path was misreported as ordinary archive cache-missing');
      }
      if (wrapper.querySelector('img[src], [style*="background-image"], [style*="border-image-source"]')) {
        throw new Error('evidence-blocked direct path attempted a resource load');
      }
    });

    await check('path traversal stays blocked and never reaches a resource URL', async function () {
      var wrapper = node('IMG_RUNTIME_TRAVERSAL');
      var text = boundary(wrapper);
      if (!['blocked', 'invalid'].includes(wrapper.dataset.imageDirectPathStatus)) {
        throw new Error('traversal status=' + wrapper.dataset.imageDirectPathStatus);
      }
      if (!/路径穿越|\\.\\.|blocked|拒绝/i.test(text)) {
        throw new Error('visible traversal rejection missing: ' + text);
      }
      var attempted = Array.from(wrapper.querySelectorAll('[src], [style]')).some(function (item) {
        return /outside|secret|\\.\\./i.test((item.getAttribute('src') || '') + (item.getAttribute('style') || ''));
      });
      if (attempted) throw new Error('traversal path reached a DOM resource URL');
    });

    document.body.dataset.imgStrictRuntimeDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.imgStrictRuntimeTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.imgStrictRuntimeErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.imgStrictRuntimeTest = 'fail';
    document.body.dataset.imgStrictRuntimeErrors = '[dom] scenario: '
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
        '--virtual-time-budget=1400',
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
        && /data-img-strict-runtime-test=/i.test(result.stdout || '')) {
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
      console.log(`img-strict-runtime-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-img-strict-runtime-dom-count="([0-9]+)"/.exec(
      selected.result.stdout
    )?.[1] || '<missing>';
    console.log(`img-strict-runtime-browser.test.js: browser=${selected.candidate}`);
    console.log(`img-strict-runtime-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`img-strict-runtime-browser.test.js: DOM=${domCount}`);
    const encoded = /data-img-strict-runtime-errors="([^"]*)"/.exec(
      selected.result.stdout
    )?.[1];
    if (!/data-img-strict-runtime-test="pass"/.test(selected.result.stdout)) {
      return decodeAttribute(encoded).split(' || ').filter(Boolean);
    }
    return [];
  } finally {
    if (process.env.BOO_KEEP_IMG_STRICT_RUNTIME_TEST_TEMP === '1') {
      console.log(`img-strict-runtime-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

const failures = runBrowserMatrix();
if (failures.length > 0) {
  console.error('img-strict-runtime-browser.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('img-strict-runtime-browser.test.js: PASS');
}
