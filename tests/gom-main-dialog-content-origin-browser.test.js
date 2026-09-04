const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const REPO_ROOT = path.resolve(__dirname, '..');
const RUNTIME_ROOT = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || REPO_ROOT);
const runtimeRequire = relativePath => require(path.join(RUNTIME_ROOT, ...relativePath.split('/')));
const staticLanguage = runtimeRequire('data/static-language.json');
const { readArchiveImagePng } = runtimeRequire('out/utils/archive-index');
const { buildDialogStatementCatalog } = runtimeRequire('out/ui-dialog/statement-catalog');
const { parseNpcDialogOffsets } = runtimeRequire('out/ui-dialog/offsets');
const {
  parseNpcDialogDocument,
  reflowNpcDialogLayout,
} = runtimeRequire('out/ui-dialog/source-parser');
const { decodeTextFile } = runtimeRequire('out/utils/text');

// Real user fixture captured before this regression test was added. The full
// GBK file remains the preferred source only while its byte hash still matches;
// otherwise the stable minimal snapshot below prevents a concurrently edited
// production script from silently changing this test's meaning.
const REAL_SCRIPT_PATH = 'D:\\MirServer\\Mir200\\Envir\\Market_Def\\账号管理\\角色保值-账号管理.txt';
const REAL_SCRIPT_SHA256 = 'e7d16254e65a204714254ec44406af012da8b7e215234768d522d2e905f92b02';
const REAL_SETUP_PATH = 'D:\\MirServer\\Mir200\\!Setup.txt';
const REAL_ARCHIVE_ID = 'c24ed05377911becc6d036f64e04e3c040a2cee24c49b648efba209b79291b88';
const REAL_BACKGROUND_INDEX = 3262;
const REAL_BACKGROUND_WIDTH = 579;
const REAL_BACKGROUND_HEIGHT = 364;
const FALLBACK_SOURCE = [
  '[@Main]',
  '#if',
  'equal T47',
  '#ACT',
  'MESSAGEBOX 系统提示:请绑定微信!',
  'close',
  'break',
  '',
  '#if',
  '#act',
  'readconfigfileitem ..\\..\\..\\..\\boo通区数据\\转区系统\\角色保值\\<$str(T47)>.TXT 角色保值 灵玉 n$可领取灵玉 FAST',
  '',
  '#if',
  '#act',
  'OPENMERCHANTBIGDLG 1 3262 1 4 0 -50 1 476 40',
  '#say',
  '<&text:10%:391:84{fcolor=250}>',
  '<&text:<$gameglory>:148:189{fcolor=250}>',
  '<&text:<$str(n$可领取灵玉)>:148:221{fcolor=251}>',
  '<&imgex:1:3267:3267:3268:63:255/@点击保值>',
  '<&imgex:1:3269:3269:3270:182:256/@领取保值>',
].join('\r\n');

function hash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sourceFixture() {
  if (fs.existsSync(REAL_SCRIPT_PATH)) {
    const bytes = fs.readFileSync(REAL_SCRIPT_PATH);
    if (hash(bytes) === REAL_SCRIPT_SHA256) {
      return { text: decodeTextFile(bytes).text, provenance: 'real-gbk-snapshot' };
    }
  }
  return { text: FALLBACK_SOURCE, provenance: 'embedded-real-source-fragment' };
}

function setupFixture() {
  if (fs.existsSync(REAL_SETUP_PATH)) {
    const parsed = parseNpcDialogOffsets(
      decodeTextFile(fs.readFileSync(REAL_SETUP_PATH)).text,
      REAL_SETUP_PATH
    );
    if (parsed.memoX === 0 && parsed.memoY === 0
      && parsed.menuX === 0 && parsed.menuY === 0) return parsed;
  }
  return parseNpcDialogOffsets([
    'NpcMemoOffSetX=0', 'NpcMemoOffSetY=0',
    'NpcMenuListOffSetX=0', 'NpcMenuListOffSetY=0',
  ].join('\r\n'), REAL_SETUP_PATH);
}

function stableSvgDataUri(width, height) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="100%" height="100%" fill="#171717"/>`
    + '<rect x="1" y="1" width="577" height="362" fill="none" stroke="#967c45"/>'
    + '</svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

async function backgroundAsset() {
  const indexRoot = path.join(
    process.env.LOCALAPPDATA || '',
    'BOO-NGOM-Editor', 'cache', 'archive-index-v1'
  );
  try {
    const png = await readArchiveImagePng({
      extensionPath: RUNTIME_ROOT,
      indexRoot,
      archiveId: REAL_ARCHIVE_ID,
      imageIndex: REAL_BACKGROUND_INDEX,
    });
    if (png.length >= 24 && png.subarray(1, 4).toString('ascii') === 'PNG'
      && png.readUInt32BE(16) === REAL_BACKGROUND_WIDTH
      && png.readUInt32BE(20) === REAL_BACKGROUND_HEIGHT) {
      return {
        status: 'ready',
        url: `data:image/png;base64,${png.toString('base64')}`,
        archiveLabel: `对话框.pak/${String(REAL_BACKGROUND_INDEX).padStart(6, '0')}`,
        width: REAL_BACKGROUND_WIDTH,
        height: REAL_BACKGROUND_HEIGHT,
        offsetX: 0,
        offsetY: 0,
        provenance: 'real-patch-cache-archive-decode',
        pngSha256: hash(png),
      };
    }
  } catch {
    // The source/geometry contract remains testable without a user's cache.
  }
  return {
    status: 'ready',
    url: stableSvgDataUri(REAL_BACKGROUND_WIDTH, REAL_BACKGROUND_HEIGHT),
    archiveLabel: '对话框.pak/003262（稳定几何替身）',
    width: REAL_BACKGROUND_WIDTH,
    height: REAL_BACKGROUND_HEIGHT,
    offsetX: 0,
    offsetY: 0,
    provenance: 'embedded-geometry-fallback',
  };
}

async function fixtureModel() {
  const source = sourceFixture();
  const zeroOriginLine = '<&imgex:1:3267:3267:3268:0:0/@原点测试>';
  const zeroTextLine = '<&text:原点文字:0:0{fcolor=250}>';
  const fixtureText = source.text.replace(
    /(\#say\s*\r?\n)/i,
    (_match, sayDirective) => `${sayDirective}${zeroOriginLine}\r\n${zeroTextLine}\r\n`
  );
  const model = parseNpcDialogDocument(fixtureText, {
    uri: pathToFileURL(REAL_SCRIPT_PATH).toString(),
    fileName: path.basename(REAL_SCRIPT_PATH),
    filePath: REAL_SCRIPT_PATH,
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: 'GOM引擎',
    cursorOffset: source.text.indexOf('[@Main]') + 3,
    offsets: setupFixture(),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });
  const scene = model.scenes.find(candidate => candidate.sourceLabel.toLowerCase() === '@main');
  assert.ok(scene, 'real @Main scene missing');
  assert.equal(model.canvasWidth, 800);
  assert.equal(model.canvasHeight, 600);
  assert.deepEqual(
    [scene.background?.willIndex, scene.background?.imageIndex,
      scene.background?.position, scene.background?.offsetX, scene.background?.offsetY],
    [1, 3262, 4, 0, -50],
    'real OPENMERCHANTBIGDLG placement contract changed'
  );
  const percent = scene.elements.find(element => element.raw.includes('<&text:10%:391:84'));
  const save = scene.elements.find(element => (
    element.raw.includes('<&imgex:1:3267:') && element.raw.includes(':63:255')
  ));
  const receive = scene.elements.find(element => element.raw.includes('<&imgex:1:3269:'));
  const zeroOrigin = scene.elements.find(element => element.raw === zeroOriginLine);
  const zeroText = scene.elements.find(element => element.raw === zeroTextLine);
  assert.ok(percent && save && receive && zeroOrigin && zeroText,
    'real @Main controls or zero-origin probes missing');
  assert.deepEqual([percent.x?.sourceValue, percent.y?.sourceValue], [391, 84],
    'absolute Text source coordinates must remain unchanged');
  assert.deepEqual([percent.layoutX, percent.layoutY], [387, 80],
    'absolute Text paint coordinates must apply the original UI editor 4px bias');
  assert.deepEqual([save.layoutX, save.layoutY], [63, 255],
    'button source coordinates must stay local in the model');
  assert.deepEqual([receive.layoutX, receive.layoutY], [182, 256]);
  assert.deepEqual([zeroOrigin.layoutX, zeroOrigin.layoutY], [0, 0]);
  assert.deepEqual([zeroText.x?.sourceValue, zeroText.y?.sourceValue], [0, 0]);
  assert.deepEqual([zeroText.layoutX, zeroText.layoutY], [-4, -4],
    'source Text 0,0 must paint at -4,-4 without changing its source values');

  const asset = await backgroundAsset();
  for (const candidate of model.scenes) {
    if (candidate.background?.willIndex === 1
      && candidate.background?.imageIndex === REAL_BACKGROUND_INDEX) {
      candidate.background.asset = asset;
    }
  }
  reflowNpcDialogLayout(model);
  model.canvasWidth = 800;
  model.canvasHeight = 600;
  return {
    model,
    sourceProvenance: source.provenance,
    assetProvenance: asset.provenance,
    assetSha256: asset.pngSha256 || '',
    ids: {
      percent: percent.id,
      save: save.id,
      receive: receive.id,
      zeroOrigin: zeroOrigin.id,
      zeroText: zeroText.id,
    },
  };
}

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

function serialize(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

function decodeAttribute(value) {
  return String(value || '').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

function metric(dom, name) {
  return new RegExp(`data-main-origin-${name}="([^"]*)"`, 'i').exec(dom)?.[1] || '<missing>';
}

async function run() {
  const candidates = browsers();
  if (!candidates.length) {
    return ['No installed Edge/Chrome is available for the main-dialog content-origin gate'];
  }
  const fixture = await fixtureModel();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-main-dialog-origin-'));
  try {
    const harness = path.join(temporary, 'main-dialog-content-origin.html');
    let html = fs.readFileSync(path.join(RUNTIME_ROOT, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const renderer = `<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`;
    const mock = `<script>
window.__model=${serialize(fixture.model)};window.__ids=${serialize(fixture.ids)};
window.__postedMessages=[];window.__opened=[];window.__initialHref=location.href;
window.open=function(){window.__opened.push(Array.from(arguments));return null;};
window.acquireVsCodeApi=function(){return{postMessage:function(message){window.__postedMessages.push(message);if(message.type==='ready')setTimeout(function(){window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:window.__model,previewRevision:1,preserveDrafts:false,geeOffsetHelp:''}}));},0);}}};
</script>`;
    html = html.replace(renderer, `${mock}${renderer}`);
    const scenario = `<script>
(function(){
  var failures=[];var metrics={};
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
  function px(value){return Number(String(value||'').replace('px',''));}
  function close(actual,expected,label){if(Math.abs(actual-expected)>0.51)throw new Error(label+'='+actual+' expected '+expected);}
  function node(name){return document.querySelector('[data-element-id="'+window.__ids[name]+'"]');}
  function visible(target){var style=getComputedStyle(target);var rect=target.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;}
  async function check(name,callback){try{await callback();}catch(error){failures.push(name+': '+(error&&error.message?error.message:String(error)));}}
  async function runScenario(){
    for(var attempt=0;attempt<120&&!node('save');attempt++)await wait(20);
    var canvas=document.getElementById('dialogCanvas');
    var viewport=document.getElementById('canvasViewport');
    var background=document.querySelector('.dialog-background-preview');
    var backgroundImage=background&&background.querySelector('img.dialog-background');
    var percent=node('percent');var save=node('save');var receive=node('receive');var zeroOrigin=node('zeroOrigin');var zeroText=node('zeroText');
    await check('real main-dialog nodes and decoded background are present',async function(){
      if(!canvas||!background||!backgroundImage||!percent||!save||!receive||!zeroOrigin||!zeroText)throw new Error('fixture DOM incomplete');
      for(var i=0;i<100&&!backgroundImage.complete;i++)await wait(10);
      if(!backgroundImage.complete||backgroundImage.naturalWidth!==579||backgroundImage.naturalHeight!==364){
        throw new Error('background image geometry='+backgroundImage.naturalWidth+'x'+backgroundImage.naturalHeight);
      }
    });
    await check('canvas, logical window, asset pixels, and content origin stay separate',async function(){
      close(px(background.style.left),110.5,'background logical left');
      close(px(background.style.top),68,'background logical top');
      close(px(backgroundImage.style.left),0,'archive pixel offset x');
      close(px(backgroundImage.style.top),0,'archive pixel offset y');
      close(px(save.style.left),173.5,'button final x');
      close(px(save.style.top),323,'button final y');
      close(px(percent.style.left),497.5,'text final x');
      close(px(percent.style.top),148,'text final y');
      close(px(receive.style.left),292.5,'second button final x');
      close(px(receive.style.top),324,'second button final y');
      close(px(zeroOrigin.style.left),110.5,'zero-origin control final x');
      close(px(zeroOrigin.style.top),68,'zero-origin control final y');
      close(px(zeroText.style.left),106.5,'zero-origin text final x');
      close(px(zeroText.style.top),64,'zero-origin text final y');
      var canvasRect=canvas.getBoundingClientRect();var origin=document.querySelector('.canvas-origin').getBoundingClientRect();
      var backgroundRect=background.getBoundingClientRect();var saveRect=save.getBoundingClientRect();
      close(origin.left,backgroundRect.left-4,'dialog origin marker x');
      close(origin.top,backgroundRect.top-4,'dialog origin marker y');
      if(document.querySelector('.canvas-origin').dataset.originSpace!=='dialog'){
        throw new Error('origin marker still identifies the outer canvas instead of the dialog');
      }
      close(saveRect.left-backgroundRect.left,63,'button local x relative to logical dialog');
      close(saveRect.top-backgroundRect.top,255,'button local y relative to logical dialog');
      close(px(percent.style.left)-px(background.style.left),387,'Text paint x relative to logical dialog');
      close(px(percent.style.top)-px(background.style.top),80,'Text paint y relative to logical dialog');
      close(px(zeroText.style.left)-px(background.style.left),-4,'zero Text paint x relative to logical dialog');
      close(px(zeroText.style.top)-px(background.style.top),-4,'zero Text paint y relative to logical dialog');
      if(saveRect.left<backgroundRect.left||saveRect.right>backgroundRect.right
        ||saveRect.top<backgroundRect.top||saveRect.bottom>backgroundRect.bottom){
        throw new Error('button remains outside the real dialog background');
      }
      metrics.initial='110.5,68=>173.5,323';
    });
    await check('B/W/C origin handles are opt-in diagnostics',async function(){
      var handle=document.querySelector('[data-coordinate-target-kind="dialog-background-offset"]');
      if(!handle)throw new Error('B handle missing from DOM');
      if(visible(handle))throw new Error('B handle leaked into the client-like default canvas');
      document.getElementById('canvasDiagnosticsToggle').click();await wait(10);
      handle=document.querySelector('[data-coordinate-target-kind="dialog-background-offset"]');
      if(!visible(handle))throw new Error('B handle did not appear after Show diagnostics');
      close(px(handle.style.left),110.5,'B visual x');close(px(handle.style.top),68,'B visual y');
    });
    await check('mouse readout reports dialog-local coordinates',async function(){
      var rect=background.getBoundingClientRect();
      viewport.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:rect.left+7,clientY:rect.top+9}));
      var text=document.getElementById('coordinateReadout').textContent;
      if(!/7,\\s*9$/.test(text))throw new Error('readout='+text);
    });
    await check('zero-origin control keeps 0,0 in Inspector and source coordinates',async function(){
      zeroOrigin.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}));await wait(10);
      if(document.getElementById('elementX').value!=='0'||document.getElementById('elementY').value!=='0'
        ||document.getElementById('sourceX').textContent!=='0'||document.getElementById('sourceY').textContent!=='0'){
        throw new Error('zero-origin Inspector/source coordinates were converted to screen space');
      }
      zeroText=node('zeroText');zeroText.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}));await wait(10);
      if(document.getElementById('elementX').value!=='-4'||document.getElementById('elementY').value!=='-4'
        ||document.getElementById('sourceX').textContent!=='0'||document.getElementById('sourceY').textContent!=='0'){
        throw new Error('Text paint/source coordinate separation was lost');
      }
    });
    await check('Inspector and arrow movement keep local source coordinates',async function(){
      save.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}));await wait(10);
      if(document.getElementById('elementX').value!=='63'||document.getElementById('elementY').value!=='255'
        ||document.getElementById('sourceX').textContent!=='63'||document.getElementById('sourceY').textContent!=='255'){
        throw new Error('Inspector exposed screen-space coordinates');
      }
      var before=save.getBoundingClientRect();
      viewport.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
      viewport.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await wait(10);
      save=node('save');var after=save.getBoundingClientRect();
      close(after.left-before.left,1,'arrow visual delta x');close(after.top-before.top,1,'arrow visual delta y');
      if(document.getElementById('elementX').value!=='64'||document.getElementById('elementY').value!=='256'
        ||document.getElementById('sourceX').textContent!=='64'||document.getElementById('sourceY').textContent!=='256'){
        throw new Error('arrow movement converted a local coordinate to screen space');
      }
      document.getElementById('undoButton').click();document.getElementById('undoButton').click();await wait(10);
      save=node('save');close(px(save.style.left),173.5,'undo final x');close(px(save.style.top),323,'undo final y');
    });
    await check('pointer drag redraws with origin but submits only local coordinates',async function(){
      save=node('save');var before=save.getBoundingClientRect();var x=before.left+before.width/2;var y=before.top+before.height/2;
      save.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:x,clientY:y}));
      window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:x+10,clientY:y+6}));
      window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:x+10,clientY:y+6}));await wait(10);
      save=node('save');var after=save.getBoundingClientRect();close(after.left-before.left,10,'drag x');close(after.top-before.top,6,'drag y');
      if(document.getElementById('elementX').value!=='73'||document.getElementById('elementY').value!=='261'){
        throw new Error('drag Inspector is not local');
      }
      document.getElementById('applyButton').click();await wait(10);
      var apply=window.__postedMessages.filter(function(message){return message.type==='apply';}).at(-1);
      var change=apply&&apply.changes&&apply.changes.find(function(value){return value.elementId===window.__ids.save;});
      if(!change||change.x!==73||change.y!==261)throw new Error('apply payload='+JSON.stringify(apply));
      metrics.drag=change.x+','+change.y;
    });
    await check('background offset movement translates background and content together',async function(){
      var handle=document.querySelector('[data-coordinate-target-kind="dialog-background-offset"]');
      handle.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}));await wait(5);
      background=document.querySelector('.dialog-background-preview');save=node('save');
      var bgBefore=background.getBoundingClientRect();var saveBefore=save.getBoundingClientRect();
      viewport.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
      viewport.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await wait(10);
      background=document.querySelector('.dialog-background-preview');save=node('save');
      var bgAfter=background.getBoundingClientRect();var saveAfter=save.getBoundingClientRect();
      close(bgAfter.left-bgBefore.left,1,'background delta x');close(bgAfter.top-bgBefore.top,1,'background delta y');
      close(saveAfter.left-saveBefore.left,1,'content delta x');close(saveAfter.top-saveBefore.top,1,'content delta y');
      close((saveAfter.left-bgAfter.left),(saveBefore.left-bgBefore.left),'relative x after background movement');
      close((saveAfter.top-bgAfter.top),(saveBefore.top-bgBefore.top),'relative y after background movement');
      if(document.getElementById('elementX').value!=='1'||document.getElementById('elementY').value!=='-49'){
        throw new Error('background Inspector lost local offset');
      }
      document.getElementById('applyButton').click();await wait(10);
      var apply=window.__postedMessages.filter(function(message){return message.type==='apply';}).at(-1);
      var change=apply&&apply.changes&&apply.changes.find(function(value){return value.elementId==='182:dialog-background-offset';});
      if(!change||change.x!==1||change.y!==-49)throw new Error('background apply payload='+JSON.stringify(apply));
      metrics.offset=change.x+','+change.y;
    });
    await check('local editing has no server, window, history, or navigation side effects',async function(){
      var unexpected=window.__postedMessages.map(function(message){return message.type;})
        .filter(function(type){return !['ready','dirtyChanged','apply'].includes(type);});
      if(unexpected.length||window.__opened.length||location.href!==window.__initialHref){
        throw new Error('unsafe effects='+JSON.stringify({unexpected:unexpected,opened:window.__opened,href:location.href}));
      }
    });
    document.body.dataset.mainOriginInitial=metrics.initial||'';
    document.body.dataset.mainOriginDrag=metrics.drag||'';
    document.body.dataset.mainOriginOffset=metrics.offset||'';
    document.body.dataset.mainOriginDom=String(document.querySelectorAll('*').length);
    document.body.dataset.mainOriginTest=failures.length?'fail':'pass';
    if(failures.length)document.body.dataset.mainOriginErrors=encodeURIComponent(failures.join(' || '));
  }
  runScenario().catch(function(error){document.body.dataset.mainOriginTest='fail';document.body.dataset.mainOriginErrors=encodeURIComponent(String(error&&error.stack||error));});
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let selected;
    for (let index = 0; index < candidates.length; index++) {
      const executable = candidates[index];
      const result = spawnSync(executable, [
        '--headless=new', '--disable-gpu', '--disable-extensions',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--no-first-run', '--allow-file-access-from-files', '--disable-web-security',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1440,920', '--virtual-time-budget=3500', '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8', timeout: 30000, windowsHide: true,
        maxBuffer: 24 * 1024 * 1024,
      });
      attempts.push({ executable, result });
      if (!result.error && result.status === 0 && /<body\b/i.test(result.stdout || '')
        && /data-main-origin-test=/i.test(result.stdout || '')) {
        selected = { executable, result };
        break;
      }
    }
    if (!selected) {
      return [`no installed browser completed the real main-dialog scenario:\n${attempts.map(({ executable, result }) => (
        `${executable}: status=${result.status}, error=${result.error?.message || '<none>'}, `
        + `body=${/<body\b/i.test(result.stdout || '')}, stderr=${String(result.stderr || '').trim() || '<empty>'}`
      )).join('\n')}`];
    }
    const dom = selected.result.stdout || '';
    console.log(`gom-main-dialog-content-origin-browser.test.js: browser=${selected.executable}`);
    console.log(`gom-main-dialog-content-origin-browser.test.js: version=${browserVersion(selected.executable)}`);
    console.log(`gom-main-dialog-content-origin-browser.test.js: runtime-root=${RUNTIME_ROOT}`);
    console.log(`gom-main-dialog-content-origin-browser.test.js: source=${fixture.sourceProvenance}`);
    console.log(`gom-main-dialog-content-origin-browser.test.js: asset=${fixture.assetProvenance}`);
    if (fixture.assetSha256) console.log(`gom-main-dialog-content-origin-browser.test.js: asset-sha256=${fixture.assetSha256}`);
    console.log(`gom-main-dialog-content-origin-browser.test.js: initial=${metric(dom, 'initial')}`);
    console.log(`gom-main-dialog-content-origin-browser.test.js: drag=${metric(dom, 'drag')}`);
    console.log(`gom-main-dialog-content-origin-browser.test.js: offset=${metric(dom, 'offset')}`);
    console.log(`gom-main-dialog-content-origin-browser.test.js: DOM=${metric(dom, 'dom')}`);
    if (/data-main-origin-test="pass"/i.test(dom)) return [];
    const encoded = /data-main-origin-errors="([^"]*)"/i.exec(dom)?.[1];
    return decodeURIComponent(decodeAttribute(encoded)).split(' || ').filter(Boolean);
  } finally {
    if (process.env.BOO_KEEP_MAIN_DIALOG_ORIGIN_TEMP === '1') {
      console.log(`gom-main-dialog-content-origin-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

run().then(failures => {
  if (failures.length) {
    console.error('gom-main-dialog-content-origin-browser.test.js: RED FAILURE MATRIX');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('gom-main-dialog-content-origin-browser.test.js: PASS');
  }
}).catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
