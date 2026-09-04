const assert = require('node:assert/strict');
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

function parseModel(engine, statements) {
  const source = ['[@main]', '#SAY', ...statements].join('\n');
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/animation-${engine}.txt`,
    fileName: `animation-${engine}.txt`,
    filePath: `D:\\MirServer\\animation-${engine}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('[@main]') + 7,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function animationElements(model) {
  return model.pages[0].elements.filter(element => element.animationPreview);
}

function elementByContainer(model, id) {
  return animationElements(model).find(element => element.containerElementId === id);
}

function collectModelFailures() {
  const failures = [];
  const check = (name, callback) => {
    try {
      callback();
    } catch (error) {
      failures.push(`[model] ${name}: ${error && error.message ? error.message : String(error)}`);
    }
  };

  const pc = parseModel('996PC', [
    '<Frames|id=MODEL_FINISH|x=10|y=10|wil=NewopUI|start=100|count=3|speed=80|loop=1|finishframe=1|finishhide=0|DMode=1|slowcount=2>',
    '<Frames|id=MODEL_FINISH_OOB|x=10|y=90|wil=NewopUI|start=110|count=3|speed=80|loop=1|finishframe=99>',
    '<Effect|id=MODEL_SCALE_HALF|x=10|y=170|wil=NewopUI|start=120|num=2|gap=80|count=0|scale=0.5>',
    '<Effect|id=MODEL_SCALE_ONE_HALF|x=10|y=250|wil=NewopUI|start=130|num=2|gap=80|count=0|scale=1.5|DMode=1>',
    '<Frames|id=MODEL_FRAME_UNVERIFIED_SCALE|x=10|y=300|wil=NewopUI|start=140|count=2|speed=80|loop=0|scale=0.5>',
    '<PlayImg:3:200:2:80:10:340:1:1:0>',
    '<PlayImg:3:210:2:80:100:340:1:1:1>',
  ]);
  const finish = elementByContainer(pc, 'MODEL_FINISH');
  const outOfBounds = elementByContainer(pc, 'MODEL_FINISH_OOB');
  const half = elementByContainer(pc, 'MODEL_SCALE_HALF');
  const oneHalf = elementByContainer(pc, 'MODEL_SCALE_ONE_HALF');
  const unverifiedFrameScale = elementByContainer(pc, 'MODEL_FRAME_UNVERIFIED_SCALE');
  const pcPlay = animationElements(pc).filter(
    element => element.statementId === 'playimg-relative-996pc'
  );

  check('996 Frames keeps documented completion and evidence-bound parameters', () => {
    assert.ok(finish, 'MODEL_FINISH was not parsed');
    assert.equal(finish.animationPreview.finishFrame, 1);
    assert.equal(finish.animationPreview.finishFrameIndexBasis, 'unknown');
    assert.equal(finish.animationPreview.finishHide, false);
    assert.equal(finish.animationPreview.drawMode, 1);
    assert.equal(finish.animationPreview.slowCount, 2);
    assert.match(
      finish.warning || '',
      /finishframe[^；]*(?:0[^0-9]+1[ \t]*基|基数)[^；]*(?:未说明|未公开|不擅自)/i,
      'finishframe must expose that its client index base is not published'
    );
    assert.match(finish.warning || '', /slowcount.*(?:未公开|不伪造|边界)/i);
    assert.match(finish.warning || '', /(?:DMode|绘制模式).*(?:未公开|不伪造|边界|混合)/i);
  });

  check('996 Frames rejects an unambiguously out-of-range finishframe', () => {
    assert.ok(outOfBounds, 'MODEL_FINISH_OOB was not parsed');
    assert.equal(outOfBounds.animationPreview.finishFrame, undefined);
    assert.ok(
      outOfBounds.animationPreview.invalidFields?.includes('finish-frame'),
      `invalidFields=${JSON.stringify(outOfBounds.animationPreview.invalidFields)}`
    );
    assert.match(outOfBounds.warning || '', /finishframe.*(?:越界|超出|无效)/i);
  });

  check('996 Effect preserves documented scale while Frames refuses undocumented scale semantics', () => {
    assert.equal(half?.animationPreview.scale, 0.5);
    assert.equal(oneHalf?.animationPreview.scale, 1.5);
    assert.equal(unverifiedFrameScale?.animationPreview.scale, undefined);
    assert.ok(unverifiedFrameScale?.animationPreview.unverifiedFields?.includes('scale'));
    assert.match(unverifiedFrameScale?.warning || '', /Frames.*scale.*(?:不属于|未公开|不赋予)/i);
  });

  check('996 PlayImg isolates M/L/R and preserves repair mode', () => {
    assert.equal(pcPlay.length, 2);
    assert.deepEqual(
      pcPlay.map(element => ({
        drawMode: element.animationPreview.drawMode,
        repeatCount: element.animationPreview.repeatCount,
        repairMode: element.animationPreview.repairMode,
      })),
      [
        { drawMode: 1, repeatCount: 1, repairMode: 0 },
        { drawMode: 1, repeatCount: 1, repairMode: 1 },
      ]
    );
    for (const element of pcPlay) {
      assert.match(element.parameters?.find(parameter => parameter.index === 9)?.name || '', /修复|偏移/);
    }
  });

  const gom = parseModel('GOM', [
    '<&PlayImgEx:1:490:3:80:39:31:0:1>',
    '<&PlayImg:2:600:3:80:12:14:1:0:按钮,4,5,250#:1>',
  ]);
  const gomEx = animationElements(gom).find(element => element.statementId === 'playimgex-absolute');
  const gomTitle = animationElements(gom).find(element => element.statementId === 'playimg-absolute');

  check('GOM PlayImgEx uses F,N,C,T,X,Y,M,L (not GEE H,X,Y,M)', () => {
    assert.ok(gomEx, 'GOM PlayImgEx was not parsed');
    assert.equal(gomEx.assetRef?.willIndex, 1);
    assert.equal(gomEx.assetRef?.imageIndex, 490);
    assert.equal(gomEx.x?.sourceValue, 39);
    assert.equal(gomEx.y?.sourceValue, 31);
    assert.equal(gomEx.animationPreview.drawMode, 0);
    assert.equal(gomEx.animationPreview.repeatCount, 1);
    assert.match(gomEx.parameters?.find(parameter => parameter.index === 5)?.name || '', /^X$|X坐标/i);
    assert.match(gomEx.parameters?.find(parameter => parameter.index === 6)?.name || '', /^Y$|Y坐标/i);
    assert.match(gomEx.parameters?.find(parameter => parameter.index === 7)?.name || '', /绘制|M/i);
    assert.match(gomEx.parameters?.find(parameter => parameter.index === 8)?.name || '', /播放次数|L/i);
  });

  check('GOM PlayImg keeps parameter 9 title separate from parameter 10 repair mode', () => {
    assert.ok(gomTitle, 'GOM titled PlayImg was not parsed');
    assert.equal(gomTitle.animationPreview.drawMode, 1);
    assert.equal(gomTitle.animationPreview.repeatCount, 0);
    assert.equal(gomTitle.animationPreview.repairMode, 1);
    assert.equal(gomTitle.animationPreview.caption, '按钮,4,5,250#');
    assert.match(gomTitle.parameters?.find(parameter => parameter.index === 9)?.name || '', /标题|文字/);
    assert.match(gomTitle.parameters?.find(parameter => parameter.index === 10)?.name || '', /修复|偏移/);
  });

  const gee = parseModel('GEE', [
    ...[0, 1, 2, 3].map((mode, index) => (
      `<&PlayImg:5:${510 + index * 10}:3:80:${10 + index * 50}:20:${mode}:249#翎风提示${mode}:1,2/@go>`
    )),
    '<&PlayImgEx:1:700:3:80:1:50:100:2:250#Ex提示:*/@go>',
  ]);
  const geePlay = animationElements(gee).filter(element => element.statementId === 'playimg-absolute');
  const geeEx = animationElements(gee).find(element => element.statementId === 'playimgex-absolute');

  check('GEE/LFM PlayImg accepts M=0..3 and never treats tooltip/P as L/R', () => {
    assert.deepEqual(geePlay.map(element => element.animationPreview.drawMode), [0, 1, 2, 3]);
    for (const [index, element] of geePlay.entries()) {
      assert.equal(element.animationPreview.repeatCount, undefined);
      assert.equal(element.animationPreview.repairMode, undefined);
      assert.equal(element.tooltipPreview?.lines?.[0]?.[0]?.text, `翎风提示${index}`);
      assert.match(element.parameters?.find(parameter => parameter.index === 8)?.name || '', /备注|提示/);
      assert.match(element.parameters?.find(parameter => parameter.index === 9)?.name || '', /输入框|ID|P/i);
    }
  });

  check('GEE/LFM PlayImgEx keeps H,X,Y,M,tooltip,P ordering', () => {
    assert.ok(geeEx, 'GEE/LFM PlayImgEx was not parsed');
    assert.equal(geeEx.animationPreview.repeatCount, 1);
    assert.equal(geeEx.x?.sourceValue, 50);
    assert.equal(geeEx.y?.sourceValue, 100);
    assert.equal(geeEx.animationPreview.drawMode, 2);
    assert.equal(geeEx.animationPreview.repairMode, undefined);
    assert.equal(geeEx.tooltipPreview?.lines?.[0]?.[0]?.text, 'Ex提示');
    assert.match(geeEx.parameters?.find(parameter => parameter.index === 5)?.name || '', /播放次数|H/i);
    assert.match(geeEx.parameters?.find(parameter => parameter.index === 9)?.name || '', /备注|提示/);
    assert.match(geeEx.parameters?.find(parameter => parameter.index === 10)?.name || '', /输入框|ID|P/i);
  });

  return failures;
}

function readyFrame(label, width, height, offsetX = 0, offsetY = 0) {
  return {
    status: 'ready',
    url: `${pixel}#${label}`,
    archiveLabel: `Animation/${label}`,
    width,
    height,
    offsetX,
    offsetY,
  };
}

function missingFrame(label) {
  return {
    status: 'missing',
    archiveLabel: `Animation/${label}`,
    message: '测试夹具制造的缺帧槽位',
  };
}

function assignIds(elements, statementId, ids) {
  const matches = elements.filter(element => element.statementId === statementId);
  assert.equal(matches.length, ids.length, `${statementId} fixture count`);
  for (let index = 0; index < matches.length; index++) matches[index].id = ids[index];
  return matches;
}

function fixtureModel() {
  const pc = parseModel('996PC', [
    '<Frames|id=ANIM_SPARSE|x=20|y=20|wil=NewopUI|start=100|count=3|speed=100|loop=0|DMode=1|slowcount=2>',
    '<Effect|id=ANIM_SCALE_HALF|x=20|y=110|wil=NewopUI|start=110|num=2|gap=100|count=0|scale=0.5>',
    '<Effect|id=ANIM_SCALE_ONE_HALF|x=100|y=110|wil=NewopUI|start=120|num=2|gap=100|count=0|scale=1.5|DMode=1>',
    '<Frames|id=ANIM_FINISH|x=20|y=210|wil=NewopUI|start=130|count=3|speed=100|loop=1|finishframe=1|finishhide=0>',
    '<Frames|id=ANIM_HIDE|x=100|y=210|wil=NewopUI|start=140|count=2|speed=100|loop=1|finishhide=1>',
    '<PlayImg:3:200:2:100:20:320:1:1:0>',
    '<PlayImg:3:210:2:100:100:320:1:1:1>',
  ]);
  const pcElements = animationElements(pc);
  for (const element of pcElements.filter(element => element.containerElementId)) {
    element.id = element.containerElementId;
  }
  const [pcR0, pcR1] = assignIds(
    pcElements,
    'playimg-relative-996pc',
    ['ANIM_PC_R0', 'ANIM_PC_R1']
  );

  const gom = parseModel('GOM', [
    '<&PlayImgEx:1:490:3:100:39:31:0:0>',
    '<&PlayImg:2:600:3:100:260:120:1:0:按钮,4,5,250#:1>',
  ]);
  const gomElements = animationElements(gom);
  const [gomEx] = assignIds(gomElements, 'playimgex-absolute', ['ANIM_GOM_EX']);
  const [gomTitle] = assignIds(gomElements, 'playimg-absolute', ['ANIM_GOM_TITLE']);

  const gee = parseModel('GEE', [
    '<&PlayImg:5:510:3:100:260:220:3:249#翎风提示:1,2/@go>',
    '<&PlayImgEx:1:700:3:100:1:260:320:2:250#Ex提示:*/@go>',
  ]);
  const geeElements = animationElements(gee);
  const [geePlay] = assignIds(geeElements, 'playimg-absolute', ['ANIM_GEE']);
  const [geeEx] = assignIds(geeElements, 'playimgex-absolute', ['ANIM_GEE_EX']);

  const byId = new Map([...pcElements, ...gomElements, ...geeElements].map(element => [element.id, element]));
  byId.get('ANIM_SPARSE').animationFrames = [
    readyFrame('sparse-0', 24, 18, 1, 2),
    missingFrame('sparse-1'),
    readyFrame('sparse-2', 24, 18, 3, 4),
  ];
  byId.get('ANIM_SCALE_HALF').animationFrames = [
    readyFrame('scale-half-0', 40, 20, 6, 4),
    readyFrame('scale-half-1', 40, 20, 6, 4),
  ];
  byId.get('ANIM_SCALE_ONE_HALF').animationFrames = [
    readyFrame('scale-one-half-0', 30, 20, 4, 2),
    readyFrame('scale-one-half-1', 30, 20, 4, 2),
  ];
  byId.get('ANIM_FINISH').animationFrames = [0, 1, 2].map(index => (
    readyFrame(`finish-${index}`, 20, 20)
  ));
  byId.get('ANIM_HIDE').animationFrames = [0, 1].map(index => (
    readyFrame(`hide-${index}`, 20, 20)
  ));
  pcR0.animationFrames = [0, 1].map(index => readyFrame(`pc-r0-${index}`, 32, 24, 7, -5));
  pcR1.animationFrames = [0, 1].map(index => readyFrame(`pc-r1-${index}`, 32, 24, 7, -5));
  gomEx.animationFrames = [0, 1, 2].map(index => readyFrame(`gom-ex-${index}`, 18, 16, 5, -3));
  gomTitle.animationFrames = [0, 1, 2].map(index => readyFrame(`gom-title-${index}`, 30, 20, 9, 6));
  geePlay.animationFrames = [0, 1, 2].map(index => readyFrame(`gee-${index}`, 24, 18, 8, -4));
  geeEx.animationFrames = [0, 1, 2].map(index => readyFrame(`gee-ex-${index}`, 24, 18, 8, -4));

  const baseScene = pc.scenes.find(scene => !scene.conditionGroupId) || pc.scenes[0];
  baseScene.elements = [...pcElements, ...gomElements, ...geeElements];
  pc.pages[0].elements = baseScene.elements;
  pc.canvasWidth = 720;
  pc.canvasHeight = 520;
  reflowNpcDialogLayout(pc);
  return pc;
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
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
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
    + `complete=${/data-animation-controls-test=/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function decodeAttribute(value) {
  return String(value || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function runBrowserMatrix() {
  const candidates = findChromiumBrowsers();
  if (candidates.length === 0) {
    console.log('animation-controls-browser.test.js: SKIP Chromium DOM (Edge/Chrome not found)');
    return [];
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-animation-controls-browser-'));
  try {
    const harness = path.join(temporary, 'animation-controls.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model = ${JSON.stringify(fixtureModel())};
window.__postedMessages = [];
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
  function px(value) { return Number(String(value || '').replace('px', '')); }
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function node(id) { return document.querySelector('[data-element-id="' + id + '"]'); }
  function image(wrapper) { return wrapper && wrapper.querySelector('.animation-frame-image'); }
  function nearly(actual, expected) { return Math.abs(Number(actual) - Number(expected)) < 0.05; }
  async function check(name, callback) {
    try { await callback(); }
    catch (error) { failures.push('[dom] ' + name + ': ' + (error && error.message ? error.message : String(error))); }
  }
  function boundary(wrapper) {
    return [
      wrapper && wrapper.querySelector('.animation-runtime-boundary')?.textContent,
      wrapper && wrapper.getAttribute('aria-label'),
      wrapper && wrapper.title,
    ].filter(Boolean).join(' ');
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
  function visuallyHidden(target) {
    if (!target) return true;
    var style = window.getComputedStyle(target);
    return target.hidden || style.display === 'none' || style.visibility === 'hidden'
      || Number(style.opacity) === 0;
  }

  async function run() {
    var required = [
      'ANIM_SPARSE', 'ANIM_SCALE_HALF', 'ANIM_SCALE_ONE_HALF', 'ANIM_FINISH',
      'ANIM_HIDE', 'ANIM_PC_R0', 'ANIM_PC_R1', 'ANIM_GOM_EX', 'ANIM_GOM_TITLE',
      'ANIM_GEE', 'ANIM_GEE_EX'
    ];
    for (var attempt = 0; attempt < 200 && required.some(function (id) { return !node(id); }); attempt++) {
      await wait(10);
    }
    var missing = required.filter(function (id) { return !node(id); });
    if (missing.length) throw new Error('fixture model did not render: ' + missing.join(','));

    var sparse = node('ANIM_SPARSE');
    var sparseHistory = [sparse.dataset.animationCurrentFrame || ''];
    var observer = new MutationObserver(function () {
      sparseHistory.push(sparse.dataset.animationCurrentFrame || '');
    });
    observer.observe(sparse, { attributes: true, attributeFilter: ['data-animation-current-frame'] });

    await check('scale=0.5 scales image geometry and intrinsic wrapper once', async function () {
      var wrapper = node('ANIM_SCALE_HALF');
      var frame = image(wrapper);
      if (!frame) throw new Error('animation image missing');
      if (!nearly(px(frame.style.width), 20) || !nearly(px(frame.style.height), 10)
        || !nearly(px(frame.style.left), 3) || !nearly(px(frame.style.top), 2)
        || !nearly(px(wrapper.style.width), 23) || !nearly(px(wrapper.style.height), 12)) {
        throw new Error('expected image=20x10@3,2 wrapper=23x12; got image='
          + frame.style.width + 'x' + frame.style.height + '@' + frame.style.left + ',' + frame.style.top
          + ' wrapper=' + wrapper.style.width + 'x' + wrapper.style.height);
      }
      if (wrapper.dataset.animationScale !== '0.5') throw new Error('scale dataset missing');
    });

    await check('scale=1.5 scales image geometry and intrinsic wrapper once', async function () {
      var wrapper = node('ANIM_SCALE_ONE_HALF');
      var frame = image(wrapper);
      if (!frame) throw new Error('animation image missing');
      if (!nearly(px(frame.style.width), 45) || !nearly(px(frame.style.height), 30)
        || !nearly(px(frame.style.left), 6) || !nearly(px(frame.style.top), 3)
        || !nearly(px(wrapper.style.width), 51) || !nearly(px(wrapper.style.height), 33)) {
        throw new Error('expected image=45x30@6,3 wrapper=51x33; got image='
          + frame.style.width + 'x' + frame.style.height + '@' + frame.style.left + ',' + frame.style.top
          + ' wrapper=' + wrapper.style.width + 'x' + wrapper.style.height);
      }
      if (wrapper.dataset.animationScale !== '1.5') throw new Error('scale dataset missing');
    });

    await check('996 PlayImg R=0 ignores offsets while R=1 uses offsets', async function () {
      var r0 = node('ANIM_PC_R0');
      var r1 = node('ANIM_PC_R1');
      var r0Image = image(r0);
      var r1Image = image(r1);
      if (!r0Image || !r1Image) throw new Error('traditional animation images missing');
      if (px(r0.style.left) + px(r0Image.style.left) !== 20
        || px(r0.style.top) + px(r0Image.style.top) !== 320
        || r0.dataset.animationFrameOffsetX !== '0'
        || r0.dataset.animationFrameOffsetY !== '0'
        || r0.dataset.animationRepairMode !== '0'
        || r0.dataset.animationOffsetPolicy !== 'switch') {
        throw new Error('R=0 must ignore source offsets: ' + r0Image.getAttribute('style')
          + ' data=' + JSON.stringify(r0.dataset));
      }
      if (px(r1.style.left) + px(r1Image.style.left) !== 107
        || px(r1.style.top) + px(r1Image.style.top) !== 315
        || r1.dataset.animationFrameOffsetX !== '7'
        || r1.dataset.animationFrameOffsetY !== '-5'
        || r1.dataset.animationRepairMode !== '1'
        || r1.dataset.animationOffsetPolicy !== 'switch') {
        throw new Error('R=1 must use source offsets: ' + r1Image.getAttribute('style')
          + ' data=' + JSON.stringify(r1.dataset));
      }
    });

    await check('GOM PlayImgEx uses X/Y/M/L positions and metadata', async function () {
      var wrapper = node('ANIM_GOM_EX');
      if (px(wrapper.style.left) !== 39 || px(wrapper.style.top) !== 31) {
        throw new Error('expected 39,31; got ' + wrapper.style.left + ',' + wrapper.style.top);
      }
      if (wrapper.dataset.animationDrawMode !== '0'
        || wrapper.dataset.animationRepeat !== '0') {
        throw new Error('GOM M/L metadata incorrect: ' + JSON.stringify(wrapper.dataset));
      }
    });

    await check('GOM parameter 9 title stays visible while parameter 10 controls offsets', async function () {
      var wrapper = node('ANIM_GOM_TITLE');
      var frame = image(wrapper);
      var title = wrapper.querySelector('.animation-title');
      if (!frame || px(frame.style.left) !== 9 || px(frame.style.top) !== 6
        || wrapper.dataset.animationRepairMode !== '1'
        || wrapper.dataset.animationOffsetPolicy !== 'switch'
        || wrapper.dataset.animationFrameOffsetX !== '9'
        || wrapper.dataset.animationFrameOffsetY !== '6') {
        throw new Error('parameter 10 repair mode did not apply source offsets');
      }
      if (!title || title.textContent !== '按钮'
        || !['#00ff00', 'rgb(0, 255, 0)'].includes(title.style.color)
        || wrapper.dataset.animationTitleOffsetX !== '4'
        || wrapper.dataset.animationTitleOffsetY !== '5') {
        throw new Error('parameter 9 title was lost or reinterpreted: '
          + (title && title.outerHTML) + ' data=' + JSON.stringify(wrapper.dataset));
      }
    });

    await check('GEE/LFM M=3 is retained and tooltip/P are not L/R', async function () {
      var wrapper = node('ANIM_GEE');
      if (wrapper.dataset.animationDrawMode !== '3') {
        throw new Error('M=3 missing: ' + JSON.stringify(wrapper.dataset));
      }
      if (wrapper.dataset.animationRepairMode) {
        throw new Error('tooltip/P was reinterpreted as repair mode');
      }
      wrapper.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await wait(20);
      var tooltip = document.querySelector('.dialog-tooltip');
      if (!tooltip || tooltip.classList.contains('hidden') || !tooltip.textContent.includes('翎风提示')) {
        throw new Error('GEE/LFM tooltip did not render');
      }
      wrapper.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    });

    await check('GEE/LFM PlayImgEx keeps H repeat and M draw mode', async function () {
      var wrapper = node('ANIM_GEE_EX');
      if (wrapper.dataset.animationRepeat !== '1'
        || wrapper.dataset.animationDrawMode !== '2'
        || wrapper.dataset.animationRepairMode) {
        throw new Error('H/M/tooltip/P isolation incorrect: ' + JSON.stringify(wrapper.dataset));
      }
    });

    await wait(700);
    observer.disconnect();

    await check('missing animation frame remains a timed slot instead of being compressed', async function () {
      var wrapper = node('ANIM_SPARSE');
      if (wrapper.dataset.animationFrameCount !== '3'
        || wrapper.dataset.animationSlotCount !== '3'
        || wrapper.dataset.animationReadyCount !== '2'
        || wrapper.dataset.animationMissingCount !== '1') {
        throw new Error('requested/ready slot metadata incorrect: ' + JSON.stringify(wrapper.dataset));
      }
      if (!sparseHistory.includes('1')) {
        throw new Error('missing slot 1 was never visited; history=' + sparseHistory.join(','));
      }
    });

    await check('finishframe uses the explicit evidence-safe hold-last convention', async function () {
      var wrapper = node('ANIM_FINISH');
      var frame = image(wrapper);
      if (wrapper.dataset.animationStatus !== 'complete-hold'
        || wrapper.dataset.animationCurrentFrame !== '2'
        || wrapper.dataset.animationFinishFrame !== '1'
        || wrapper.dataset.animationFinishFrameIndexBasis !== 'unknown'
        || !frame || !frame.src.endsWith('#finish-2') || visuallyHidden(frame)) {
        throw new Error('unknown-base finishframe must preserve the source value and visibly hold the last safe slot: data='
          + JSON.stringify(wrapper.dataset) + ' image=' + (frame && frame.outerHTML));
      }
      if (!/finishframe[^；]*(?:0[^0-9]+1[ 	]*基|基数)[^；]*(?:未说明|未公开|不擅自)/i.test(await inspectorWarning(wrapper))) {
        throw new Error('finishframe basis warning is not available in Inspector');
      }
    });

    await check('finishhide hides only the layer and retains ended wrapper', async function () {
      var wrapper = node('ANIM_HIDE');
      if (!wrapper) throw new Error('wrapper was removed');
      if (wrapper.dataset.animationStatus !== 'complete-hidden') {
        throw new Error('ended/hidden status missing: ' + JSON.stringify(wrapper.dataset));
      }
      if (!visuallyHidden(image(wrapper))) throw new Error('animation image layer remains visible');
    });

    await check('traditional L=1 animations automatically hide after one loop', async function () {
      for (var id of ['ANIM_PC_R0', 'ANIM_PC_R1']) {
        var wrapper = node(id);
        if (!wrapper || wrapper.dataset.animationStatus !== 'complete-hidden'
          || !visuallyHidden(image(wrapper))) {
          throw new Error(id + ' did not auto-hide after L=1: '
            + (wrapper && JSON.stringify(wrapper.dataset)));
        }
      }
    });

    await check('DMode/slowcount are exposed without inventing hidden algorithms', async function () {
      var wrapper = node('ANIM_SPARSE');
      var text = await inspectorWarning(wrapper);
      if (wrapper.dataset.animationDrawMode !== '1'
        || wrapper.dataset.animationSlowCount !== '2') {
        throw new Error('DMode/slowcount datasets missing: ' + JSON.stringify(wrapper.dataset));
      }
      if (!/DMode|绘制/.test(text) || !/slowcount|放缓/i.test(text)
        || !/未公开|不伪造|边界/.test(text)) {
        throw new Error('evidence warning is not available in Inspector: ' + text);
      }
    });

    await check('animation preview never executes server links', async function () {
      var posted = JSON.stringify(window.__postedMessages || []);
      if (posted.includes('@go')) throw new Error('server link was posted from animation preview');
    });

    document.body.dataset.animationControlsDomCount = String(document.querySelectorAll('*').length);
    document.body.dataset.animationControlsTest = failures.length === 0 ? 'pass' : 'fail';
    if (failures.length) document.body.dataset.animationControlsErrors = failures.join(' || ');
  }
  run().catch(function (error) {
    document.body.dataset.animationControlsTest = 'fail';
    document.body.dataset.animationControlsErrors = '[dom] scenario: '
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
        '--window-size=1200,800',
        '--virtual-time-budget=3500',
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
        && /data-animation-controls-test=/i.test(result.stdout || '')) {
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
      console.log(`animation-controls-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-animation-controls-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1]
      || '<missing>';
    console.log(`animation-controls-browser.test.js: browser=${selected.candidate}`);
    console.log(`animation-controls-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`animation-controls-browser.test.js: DOM=${domCount}`);
    const encoded = /data-animation-controls-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    if (!/data-animation-controls-test="pass"/.test(selected.result.stdout)) {
      return decodeAttribute(encoded).split(' || ').filter(Boolean);
    }
    return [];
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

function main() {
  const failures = [...collectModelFailures(), ...runBrowserMatrix()];
  if (failures.length > 0) {
    console.error('animation-controls-browser.test.js: RED FAILURE MATRIX');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('animation-controls-browser.test.js: PASS');
}

main();
