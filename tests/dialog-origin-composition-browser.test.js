const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const RUNTIME_ROOT = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || REPOSITORY_ROOT);
const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzNwAAAABJRU5ErkJggg==';

function browsers() {
  const values = [
    process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate));
  return [...new Set(values.map(candidate => path.resolve(candidate)))];
}

function browserVersion(executable) {
  if (process.platform !== 'win32') return '<unknown>';
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command',
    '(Get-Item -LiteralPath $env:BOO_BROWSER_EXE).VersionInfo.ProductVersion',
  ], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
    env: { ...process.env, BOO_BROWSER_EXE: executable },
  });
  return String(result.stdout || '').trim().split(/\r?\n/, 1)[0] || '<unknown>';
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(RUNTIME_ROOT, ...relativePath.split('/'))).href;
}

function textElement(id, x, y, options = {}) {
  return {
    id,
    statementId: 'test-text',
    token: '<TEXT>',
    description: id,
    kind: 'text',
    raw: id,
    lineNumber: 1,
    coordinateMode: 'absolute',
    editable: false,
    ...(options.parentElementId ? { parentElementId: options.parentElementId } : {}),
    localLayoutX: options.localX ?? x,
    localLayoutY: options.localY ?? y,
    layoutX: x,
    layoutY: y,
    width: 36,
    height: 18,
    text: id,
  };
}

function showBackgroundElement() {
  return {
    id: 'show-root',
    statementId: '996-img',
    token: 'Img',
    description: '996PC show-positioned background',
    kind: 'image',
    raw: '<Img|id=BG|width=120|height=80|bg=1|show=4>',
    lineNumber: 1,
    coordinateMode: 'absolute',
    editable: false,
    localLayoutX: 340,
    localLayoutY: 260,
    layoutX: 340,
    layoutY: 260,
    width: 120,
    height: 80,
    imagePreview: {
      variant: 'newui-img-996pc',
      opacity: 255,
      gray: false,
      background: true,
      showPosition: 4,
      localOnly: true,
      runtimeScope: 'local-only',
      defaultFields: [],
      dynamicFields: [],
      invalidFields: [],
    },
    asset: {
      status: 'ready', url: `${pixel}#show-root`, archiveLabel: 'NewopUI/000108',
      width: 120, height: 80, offsetX: 0, offsetY: 0,
    },
  };
}

function dialogBackground(overrides = {}) {
  const ready = overrides.ready === true;
  return {
    command: 'OPENMERCHANTBIGDLG',
    status: overrides.status || 'static',
    raw: 'OPENMERCHANTBIGDLG test fixture',
    lineNumber: 1,
    willIndex: 5,
    imageIndex: 3,
    position: overrides.position ?? 0,
    ...(overrides.offsetX !== undefined ? { offsetX: overrides.offsetX } : {}),
    ...(overrides.offsetY !== undefined ? { offsetY: overrides.offsetY } : {}),
    ...(overrides.nineGrid ? { nineGrid: overrides.nineGrid } : {}),
    dynamicFields: overrides.dynamicFields || [],
    invalidFields: overrides.invalidFields || [],
    runtimeScope: 'local-only',
    warnings: [],
    asset: ready ? {
      status: 'ready', url: `${pixel}#dialog-background`, archiveLabel: 'Main/000003',
      width: overrides.width || 300,
      height: overrides.height || 220,
      offsetX: overrides.assetOffsetX || 0,
      offsetY: overrides.assetOffsetY || 0,
    } : {
      status: 'missing', archiveLabel: 'Main/000003', message: 'fixture intentionally missing',
    },
  };
}

function page(id, background, elements) {
  return {
    id: `page-${id}`,
    title: `@${id}`,
    sourceLabel: `@${id}`,
    conditionSummary: 'default',
    conditionGroupIds: [],
    activeBranchIds: [],
    background,
    elements,
    unsupportedStatements: [],
    warnings: [],
    resolvedVariables: [],
    marker: 'STATIC',
    conditions: [],
    conditionOperators: [],
    previewPath: {},
    sourceStart: 0,
    sourceEnd: 1,
  };
}

function fixtureModel() {
  const showRoot = showBackgroundElement();
  const pages = [
    page('show-composition', dialogBackground({
      ready: true, position: 0, offsetX: 10, offsetY: 20,
      assetOffsetX: -7, assetOffsetY: 9,
    }), [
      showRoot,
      textElement('show-child', 360, 290, {
        parentElementId: showRoot.id, localX: 20, localY: 30,
      }),
      textElement('ordinary-zero', 0, 0),
    ]),
    page('dynamic-unrelated', dialogBackground({
      status: 'dynamic', position: 0, offsetX: 10, offsetY: 20,
      dynamicFields: ['movable'],
    }), [textElement('dynamic-unrelated-zero', 0, 0)]),
    page('invalid-unrelated', dialogBackground({
      status: 'invalid', position: 0, offsetX: 11, offsetY: 21,
      invalidFields: ['show-close'],
    }), [textElement('invalid-unrelated-zero', 0, 0)]),
    page('partial-axis', dialogBackground({
      status: 'dynamic', position: 0, offsetY: 20,
      dynamicFields: ['offset-x'],
    }), [textElement('partial-axis-zero', 0, 0)]),
    page('extended-canvas-center', dialogBackground({
      ready: true, position: 4, width: 300, height: 220,
    }), [textElement('extended-canvas-center-zero', 0, 0)]),
    page('dynamic-nine-grid-width', dialogBackground({
      ready: true, status: 'dynamic', position: 4, offsetX: 10, offsetY: 20,
      width: 200, height: 100,
      nineGrid: { enabled: true, targetHeight: 300, rendering: 'partial-simulation' },
      dynamicFields: ['nine-grid-width'],
    }), [textElement('dynamic-nine-grid-width-zero', 0, 0)]),
    page('dynamic-nine-grid-height', dialogBackground({
      ready: true, status: 'dynamic', position: 4, offsetX: 10, offsetY: 20,
      width: 200, height: 100,
      nineGrid: { enabled: true, targetWidth: 400, rendering: 'partial-simulation' },
      dynamicFields: ['nine-grid-height'],
    }), [textElement('dynamic-nine-grid-height-zero', 0, 0)]),
    page('dynamic-nine-grid-enabled', dialogBackground({
      ready: true, status: 'dynamic', position: 4, offsetX: 10, offsetY: 20,
      width: 200, height: 100,
      nineGrid: { targetWidth: 400, targetHeight: 300, rendering: 'partial-simulation' },
      dynamicFields: ['nine-grid-enabled'],
    }), [textElement('dynamic-nine-grid-enabled-zero', 0, 0)]),
    ...[1, 2, 3, 4].map(position => page(
      `unknown-size-${position}`,
      dialogBackground({ position, offsetX: 10, offsetY: 20 }),
      [textElement(`unknown-size-${position}-zero`, 0, 0)]
    )),
  ];
  return {
    uri: 'file:///D:/MirServer/dialog-origin-composition.txt',
    fileName: 'dialog-origin-composition.txt',
    filePath: 'D:\\MirServer\\dialog-origin-composition.txt',
    documentVersion: 1,
    engine: '996PC',
    engineLabel: '996PC',
    functionLabel: '@show-composition',
    functionStart: 0,
    functionEnd: 1,
    offsets: { memoX: 0, memoY: 0, menuX: 0, menuY: 0, source: 'default', configured: true },
    clientWidth: 800,
    clientHeight: 600,
    canvasWidth: 1120,
    canvasHeight: 804,
    conditionGroups: [],
    pages,
    scenes: pages,
    actUiPreviews: [],
    warnings: [],
  };
}

function decode(value) {
  return String(value || '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function run() {
  const candidates = browsers();
  if (!candidates.length) {
    console.log('dialog-origin-composition-browser.test.js: SKIP (Edge/Chrome not installed)');
    return [];
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-dialog-origin-composition-'));
  try {
    const harness = path.join(temporary, 'dialog-origin-composition.html');
    let html = fs.readFileSync(path.join(RUNTIME_ROOT, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model=${JSON.stringify(fixtureModel())};
window.__postedMessages=[];
window.acquireVsCodeApi=function(){return{postMessage:function(message){
  window.__postedMessages.push(message);
  if(message.type==='ready')setTimeout(function(){window.dispatchEvent(new MessageEvent('message',{data:{
    type:'model',model:window.__model,previewRevision:1,preserveDrafts:false,geeOffsetHelp:''
  }}));},0);
}};};
</script>`;
    html = html.replace(
      `<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`,
      `${mock}<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`
    );
    const scenario = `<script>
(function(){
  var failures=[];
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
  function px(value){return Number(String(value||'').replace('px',''));}
  function node(id){return document.querySelector('[data-element-id="'+id+'"]');}
  function assertPosition(id,x,y){var value=node(id);if(!value)throw new Error(id+' missing');
    if(px(value.style.left)!==x||px(value.style.top)!==y)throw new Error(id+' expected '+x+','+y+' got '+value.style.left+','+value.style.top);}
  function pageButton(label){return Array.from(document.querySelectorAll('#sceneList .scene-button')).find(function(value){
    return value.querySelector('strong')&&value.querySelector('strong').textContent===label;
  });}
  async function select(label){var button=pageButton(label);if(!button)throw new Error('page missing '+label);button.click();await wait(20);}
  async function check(name,callback){try{await callback();}catch(error){failures.push(name+': '+(error&&error.message?error.message:String(error)));}}
  async function runChecks(){
    for(var attempt=0;attempt<100&&!node('show-root');attempt++)await wait(20);
    await check('show-positioned subtree uses canvas coordinates once',async function(){
      assertPosition('show-root',340,260);assertPosition('show-child',360,290);assertPosition('ordinary-zero',10,20);
    });
    await check('archive pixel offset stays inside logical background',async function(){
      var wrapper=document.querySelector('.dialog-background-preview');var image=wrapper&&wrapper.querySelector('img.dialog-background');
      if(!wrapper||!image)throw new Error('background image missing');
      if(px(wrapper.style.left)!==10||px(wrapper.style.top)!==20)throw new Error('logical background origin changed');
      if(px(image.style.left)!==-7||px(image.style.top)!==9)throw new Error('asset offset not retained independently');
    });
    await check('zoom and repeated model render do not accumulate origin',async function(){
      document.getElementById('zoomIn').click();document.getElementById('zoomIn').click();await wait(20);
      assertPosition('show-root',340,260);assertPosition('show-child',360,290);assertPosition('ordinary-zero',10,20);
      document.getElementById('zoomReset').click();await wait(20);
      window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:window.__model,previewRevision:2,preserveDrafts:false,geeOffsetHelp:''}}));
      await wait(20);assertPosition('show-root',340,260);assertPosition('show-child',360,290);assertPosition('ordinary-zero',10,20);
      var image=document.querySelector('.dialog-background-preview img.dialog-background');
      if(!image||px(image.style.left)!==-7||px(image.style.top)!==9)throw new Error('asset offset changed after rerender');
    });
    await check('unrelated dynamic background field preserves known origin',async function(){
      await select('@dynamic-unrelated');assertPosition('dynamic-unrelated-zero',10,20);
    });
    await check('unrelated invalid background field preserves known origin',async function(){
      await select('@invalid-unrelated');assertPosition('invalid-unrelated-zero',11,21);
    });
    await check('one dynamic offset axis preserves the other static axis',async function(){
      await select('@partial-axis');assertPosition('partial-axis-zero',0,20);
    });
    await check('expanded editor canvas does not move the 800x600 client-centred dialog',async function(){
      await select('@extended-canvas-center');assertPosition('extended-canvas-center-zero',250,190);
      var wrapper=document.querySelector('.dialog-background-preview');
      if(!wrapper||px(wrapper.style.left)!==250||px(wrapper.style.top)!==190)throw new Error('background wrapper did not use client anchor surface');
    });
    await check('dynamic nine-grid width preserves only the independently known Y axis',async function(){
      await select('@dynamic-nine-grid-width');assertPosition('dynamic-nine-grid-width-zero',0,170);
      if(!document.querySelector('.dialog-background-preview img.dialog-background'))throw new Error('static source image was suppressed');
    });
    await check('dynamic nine-grid height preserves only the independently known X axis',async function(){
      await select('@dynamic-nine-grid-height');assertPosition('dynamic-nine-grid-height-zero',210,0);
      if(!document.querySelector('.dialog-background-preview img.dialog-background'))throw new Error('static source image was suppressed');
    });
    await check('dynamic nine-grid enabled state never borrows natural size for content origin',async function(){
      await select('@dynamic-nine-grid-enabled');assertPosition('dynamic-nine-grid-enabled-zero',0,0);
      if(!document.querySelector('.dialog-background-preview img.dialog-background'))throw new Error('static source image was suppressed');
    });
    var expected={1:[0,20],2:[10,0],3:[0,0],4:[0,0]};
    for(var position=1;position<=4;position++)await check('unknown size position '+position+' stays axis-safe',async function(){
      await select('@unknown-size-'+position);var pair=expected[position];assertPosition('unknown-size-'+position+'-zero',pair[0],pair[1]);
    });
    document.body.dataset.dialogOriginComposition=failures.length?'fail':'pass';
    document.body.dataset.dialogOriginCompositionFailures=failures.join(' || ');
    document.body.dataset.dialogOriginCompositionDom=String(document.querySelectorAll('*').length);
  }
  runChecks().catch(function(error){document.body.dataset.dialogOriginComposition='fail';document.body.dataset.dialogOriginCompositionFailures=String(error&&error.stack||error);});
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    for (const executable of candidates) {
      const result = spawnSync(executable, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files',
        '--virtual-time-budget=8000', '--dump-dom', pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 30000, windowsHide: true });
      const dom = result.stdout || '';
      const match = /data-dialog-origin-composition="([^"]+)"/i.exec(dom);
      const failures = decode(/data-dialog-origin-composition-failures="([^"]*)"/i.exec(dom)?.[1]);
      attempts.push({ executable, result, dom, state: match?.[1], failures });
      if (result.status === 0 && match?.[1] === 'pass') {
        const count = /data-dialog-origin-composition-dom="([^"]+)"/i.exec(dom)?.[1] || '<missing>';
        console.log(`dialog-origin-composition-browser.test.js: browser=${executable}`);
        console.log(`dialog-origin-composition-browser.test.js: version=${browserVersion(executable)}`);
        console.log(`dialog-origin-composition-browser.test.js: runtime-root=${RUNTIME_ROOT}`);
        console.log(`dialog-origin-composition-browser.test.js: DOM=${count}`);
        console.log('dialog-origin-composition-browser.test.js: PASS');
        return [];
      }
      console.error(`dialog-origin-composition-browser.test.js: candidate-failure=${executable}: state=${match?.[1] || '<missing>'}; ${failures || 'no browser assertion'}; status=${result.status}`);
    }
    const details = attempts.map(attempt => `${attempt.executable}: ${attempt.failures || attempt.result.stderr || 'no DOM result'}`);
    throw new Error(`dialog-origin-composition-browser.test.js: RED FAILURE MATRIX\n${details.join('\n')}`);
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

try {
  run();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
