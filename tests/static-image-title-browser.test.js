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

function readyAsset(label, width, height, offsetX, offsetY) {
  return {
    status: 'ready',
    url: `${pixel}#${label}`,
    archiveLabel: `Title/${label}`,
    width,
    height,
    offsetX,
    offsetY,
  };
}

function fixtureModel() {
  const source = [
    '[@main]',
    '#SAY',
    '<IMG:1600:0:30:40:按钮,10,11,250#|254#标题^250#说明/@图片标签>',
    '<IMGEX:0:1700:1701:1702:80:90:1,2:领取,-3,4,#112233#|普通备注/@提交标签>',
  ].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/static-image-title-browser.txt',
    fileName: 'static-image-title-browser.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\static-image-title-browser.txt',
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: '新GOM',
    cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });
  const elements = model.pages[0].elements.filter(element => element.assetRef);
  const image = elements.find(element => element.assetRef.imageIndex === 1600);
  const button = elements.find(element => element.assetRef.imageIndex === 1700);
  image.id = 'STATIC_IMG_TITLE';
  image.asset = readyAsset('img-normal', 40, 20, 5, 7);
  button.id = 'STATIC_IMGEX_TITLE';
  button.asset = readyAsset('imgex-normal', 50, 24, -2, 3);
  button.assetLayers = [
    {
      role: 'hover',
      assetRef: { willIndex: 0, imageIndex: 1701 },
      asset: readyAsset('imgex-hover', 50, 24, 4, -1),
    },
    {
      role: 'pressed',
      assetRef: { willIndex: 0, imageIndex: 1702 },
      asset: readyAsset('imgex-pressed', 50, 24, 6, 2),
    },
  ];
  const scene = model.scenes.find(candidate => !candidate.conditionGroupId) || model.scenes[0];
  scene.elements = [image, button];
  model.pages[0].elements = scene.elements;
  model.canvasWidth = 360;
  model.canvasHeight = 240;
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
    + `error=${result.error?.message || '<none>'}, body=${/<body\b/i.test(result.stdout || '')}, `
    + `complete=${/data-static-image-title-test=/i.test(result.stdout || '')}, stderr=${stderr}`;
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
    return ['[browser] Edge/Chrome is not installed; the required real Chromium test cannot run'];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-static-image-title-browser-'));
  try {
    const harness = path.join(temporary, 'static-image-title.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.acquireVsCodeApi = function () { return { postMessage: function (message) {
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
  function px(value) { return Number(String(value || '').replace('px', '')); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function colorIs(value, expected) {
    return [expected, expected.replace('#00ff00', 'rgb(0, 255, 0)')].includes(value);
  }
  async function check(name, task) {
    try { await task(); }
    catch (error) { failures.push(name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  function titlePosition(wrapper) {
    var title = wrapper.querySelector('.image-title');
    return title ? [px(title.style.left), px(title.style.top)] : [];
  }

  async function run() {
    for (var attempt = 0; attempt < 150 && !node('STATIC_IMG_TITLE'); attempt++) await wait(20);
    if (!node('STATIC_IMG_TITLE')) throw new Error('fixture model did not render');

    await check('IMG title is a permanent safe text node relative to the drawn image', async function () {
      var wrapper = node('STATIC_IMG_TITLE');
      var image = wrapper.querySelector('.dialog-image-preview-image');
      var title = wrapper.querySelector('.image-title');
      if (!image || !title || title.textContent !== '按钮') {
        throw new Error('image or permanent title node is missing: ' + wrapper.innerHTML);
      }
      if (px(wrapper.style.left) !== 30 || px(wrapper.style.top) !== 40) {
        throw new Error('title changed image wrapper coordinates: ' + wrapper.style.cssText);
      }
      if (px(image.style.left) !== 5 || px(image.style.top) !== 7
        || titlePosition(wrapper).join(',') !== '15,18') {
        throw new Error('title is not image offset + documented relative 10,11: ' + wrapper.innerHTML);
      }
      if (!colorIs(title.style.color, '#00ff00')
        || wrapper.dataset.imageTitleOffsetX !== '10'
        || wrapper.dataset.imageTitleOffsetY !== '11'
        || wrapper.dataset.imageTitleColorValue !== '250'
        || wrapper.dataset.imageLink !== '@图片标签') {
        throw new Error('title color/metadata/link is incomplete: ' + JSON.stringify(wrapper.dataset));
      }
    });

    await check('title and colored tooltip remain distinct visible layers', async function () {
      var wrapper = node('STATIC_IMG_TITLE');
      wrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 20, clientY: 20 }));
      await wait(20);
      var tooltip = document.querySelector('.dialog-tooltip');
      var runs = tooltip ? Array.from(tooltip.querySelectorAll('.dialog-tooltip-line > span')) : [];
      if (!tooltip || tooltip.classList.contains('hidden')
        || runs.map(function (run) { return run.textContent; }).join('|') !== '标题|说明'
        || !['#00ffff', 'rgb(0, 255, 255)'].includes(runs[0].style.color)
        || !['#00ff00', 'rgb(0, 255, 0)'].includes(runs[1].style.color)) {
        throw new Error('colored tooltip runs were lost or confused with title');
      }
      if (wrapper.querySelector('.image-title').textContent !== '按钮') {
        throw new Error('showing tooltip replaced the permanent title');
      }
      wrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    });

    await check('IMGEX title follows each image state without moving the wrapper', async function () {
      var wrapper = node('STATIC_IMGEX_TITLE');
      var image = wrapper.querySelector('.interactive-asset-image');
      var title = wrapper.querySelector('.image-title');
      if (!image || !title || title.textContent !== '领取') {
        throw new Error('IMGEX state image or title is missing: ' + wrapper.innerHTML);
      }
      if (px(wrapper.style.left) !== 80 || px(wrapper.style.top) !== 90
        || titlePosition(wrapper).join(',') !== '-5,7') {
        throw new Error('normal-state title geometry is wrong: ' + wrapper.style.cssText);
      }
      if (wrapper.dataset.imageSubmitIds !== '1,2'
        || wrapper.dataset.imageLink !== '@提交标签'
        || wrapper.dataset.imageTitleColorValue !== '#112233') {
        throw new Error('IMGEX E/title/link segmentation is missing: ' + JSON.stringify(wrapper.dataset));
      }
      wrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      if (wrapper.dataset.interactiveState !== 'hover'
        || px(image.style.left) !== 4 || px(image.style.top) !== -1
        || titlePosition(wrapper).join(',') !== '1,3') {
        throw new Error('hover state did not keep title relative to current image: ' + wrapper.innerHTML);
      }
      wrapper.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      if (wrapper.dataset.interactiveState !== 'pressed'
        || px(image.style.left) !== 6 || px(image.style.top) !== 2
        || titlePosition(wrapper).join(',') !== '3,6') {
        throw new Error('pressed state did not keep title relative to current image: ' + wrapper.innerHTML);
      }
      if (px(wrapper.style.left) !== 80 || px(wrapper.style.top) !== 90) {
        throw new Error('state/title interaction changed wrapper coordinates');
      }
    });

    document.body.dataset.staticImageTitleDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.staticImageTitleTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.staticImageTitleErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.staticImageTitleTest = 'fail';
    document.body.dataset.staticImageTitleErrors = '[dom] scenario: '
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
        '--window-size=900,600',
        '--virtual-time-budget=1800',
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
        && /data-static-image-title-test=/i.test(result.stdout || '')) {
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
      console.log(`static-image-title-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-static-image-title-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`static-image-title-browser.test.js: browser=${selected.candidate}`);
    console.log(`static-image-title-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`static-image-title-browser.test.js: DOM=${domCount}`);
    const encoded = /data-static-image-title-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    if (!/data-static-image-title-test="pass"/.test(selected.result.stdout)) {
      return decodeAttribute(encoded).split(' || ').filter(Boolean);
    }
    return [];
  } finally {
    if (process.env.BOO_KEEP_STATIC_IMAGE_TITLE_TEST_TEMP === '1') {
      console.log(`static-image-title-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

const failures = runBrowserMatrix();
if (failures.length > 0) {
  console.error('static-image-title-browser.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('static-image-title-browser.test.js: PASS');
}
