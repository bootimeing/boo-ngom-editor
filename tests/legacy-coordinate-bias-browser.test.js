const assert = require('node:assert/strict');
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
const { buildDialogStatementCatalog } = runtimeRequire('out/ui-dialog/statement-catalog');
const { parseNpcDialogOffsets } = runtimeRequire('out/ui-dialog/offsets');
const { parseNpcDialogDocument } = runtimeRequire('out/ui-dialog/source-parser');
const {
  applyTextReplacements,
  buildDialogCoordinateEdits,
} = runtimeRequire('out/ui-dialog/source-patcher');

const SOURCE = [
  '[@main]',
  '#SAY',
  '<&TEXT:绝对文字:104:204{FCOLOR=250}>',
  '<TEXT:相对文字:104:204{FCOLOR=251}>',
  '<&COUNTDOWN:59:1:255:114:214>',
  '<&INPUTTEXT:1:124:224:120:30:0:255:255:0:20:错误:请输入:128>',
  '<&INPUTNUM:2:134:234:100:30:0:255:255:0:999:错误:请输入数字:128>',
  '<&IMG:1:2:144:244>',
].join('\r\n');

function fixture() {
  const offsets = parseNpcDialogOffsets([
    'NpcMemoOffSetX=10',
    'NpcMemoOffSetY=-20',
    'NpcMenuListOffSetX=0',
    'NpcMenuListOffSetY=0',
  ].join('\r\n'), 'D:\\MirServer\\Mir200\\!Setup.txt');
  const filePath = 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\legacy-bias.txt';
  const model = parseNpcDialogDocument(SOURCE, {
    uri: pathToFileURL(filePath).toString(),
    fileName: path.basename(filePath),
    filePath,
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: 'GOM引擎',
    cursorOffset: SOURCE.indexOf('[@main]') + 3,
    offsets,
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });
  const elements = model.pages[0].elements;
  const find = needle => elements.find(element => element.raw.includes(needle));
  const values = {
    absoluteText: find('绝对文字'),
    relativeText: find('相对文字'),
    countdown: find('COUNTDOWN'),
    inputText: find('INPUTTEXT'),
    inputNumber: find('INPUTNUM'),
    image: find('<&IMG:'),
  };
  for (const [name, element] of Object.entries(values)) {
    assert.ok(element, `${name} fixture element missing`);
  }
  assert.deepEqual(
    Object.fromEntries(Object.entries(values).map(([name, element]) => (
      [name, [element.layoutX, element.layoutY, element.sourceCoordinateBiasX]]
    ))),
    {
      absoluteText: [100, 200, 4],
      relativeText: [110, 180, 4],
      countdown: [110, 210, 4],
      inputText: [120, 220, 4],
      inputNumber: [130, 230, 4],
      image: [144, 244, 0],
    },
    'model paint coordinates must preserve the original UI editor offset table'
  );

  const edit = buildDialogCoordinateEdits(SOURCE, model, [{
    elementId: values.absoluteText.id,
    x: 112,
    y: 207,
  }]);
  assert.match(
    applyTextReplacements(SOURCE, edit.replacements),
    /<&TEXT:绝对文字:116:211\{FCOLOR=250\}>/,
    'paint-space drag must restore the 4px bias exactly once during source writeback'
  );
  return {
    model,
    ids: Object.fromEntries(Object.entries(values).map(([name, element]) => [name, element.id])),
  };
}

function browserCandidates() {
  return [...new Set([
    process.env.BOO_BROWSER_EXECUTABLE,
    process.env.BOO_CHROMIUM_PATH,
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate)).map(candidate => path.resolve(candidate)))];
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
  return String(result.stdout || '').trim().split(/\r?\n/u, 1)[0] || '<unknown>';
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(RUNTIME_ROOT, ...relativePath.split('/'))).href;
}

function serialize(value) {
  return JSON.stringify(value).replace(/</gu, '\\u003c').replace(/>/gu, '\\u003e');
}

function diagnostic(executable, result) {
  return JSON.stringify({
    executable,
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    body: /<body\b/iu.test(result.stdout || ''),
    stderr: String(result.stderr || '').trim().slice(0, 500),
  });
}

function decodeError(dom) {
  const encoded = /data-legacy-coordinate-errors="([^"]*)"/iu.exec(dom)?.[1];
  return encoded ? decodeURIComponent(encoded.replaceAll('&amp;', '&')) : '<missing browser error>';
}

async function main() {
  const browsers = browserCandidates();
  if (browsers.length === 0) {
    if (process.env.BOO_REQUIRE_REAL_BROWSER === '1') {
      throw new Error('real Edge/Chrome is required; SKIP is not accepted');
    }
    console.log('legacy-coordinate-bias-browser.test.js: SKIP (Edge/Chrome not installed)');
    return;
  }

  const data = fixture();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-legacy-coordinate-bias-'));
  try {
    const harness = path.join(temporary, 'legacy-coordinate-bias.html');
    let html = fs.readFileSync(path.join(RUNTIME_ROOT, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const renderer = `<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`;
    const mock = `<script>
window.__legacyCoordinateModel=${serialize(data.model)};
window.__legacyCoordinateIds=${serialize(data.ids)};
window.__legacyCoordinatePosts=[];
window.acquireVsCodeApi=function(){return{postMessage:function(message){
  window.__legacyCoordinatePosts.push(message);
  if(message.type==='ready')setTimeout(function(){
    window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:window.__legacyCoordinateModel,previewRevision:1,preserveDrafts:false,geeOffsetHelp:''}}));
  },0);
}}};
</script>`;
    html = html.replace(renderer, `${mock}${renderer}`);
    const scenario = `<script>
(function(){
  var failures=[];var metrics={};
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
  function px(value){return Number(String(value||'').replace('px',''));}
  function node(name){return document.querySelector('[data-element-id="'+window.__legacyCoordinateIds[name]+'"]');}
  function close(actual,expected,label){if(Math.abs(actual-expected)>0.51)throw new Error(label+'='+actual+' expected '+expected);}
  async function check(name,callback){try{await callback();}catch(error){failures.push(name+': '+(error&&error.message?error.message:String(error)));}}
  async function run(){
    for(var attempt=0;attempt<120&&!node('absoluteText');attempt++)await wait(20);
    await check('all original UI editor paint offsets reach the DOM',async function(){
      var expected={absoluteText:[100,200],relativeText:[110,180],countdown:[110,210],inputText:[120,220],inputNumber:[130,230],image:[144,244]};
      Object.keys(expected).forEach(function(name){var target=node(name);if(!target)throw new Error(name+' missing');close(px(target.style.left),expected[name][0],name+' x');close(px(target.style.top),expected[name][1],name+' y');});
      metrics.initial='100,200|110,180|110,210|120,220|130,230|144,244';
    });
    await check('Inspector separates paint coordinates from source coordinates',async function(){
      var target=node('absoluteText');target.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}));await wait(10);
      if(document.getElementById('elementX').value!=='100'||document.getElementById('elementY').value!=='200'||document.getElementById('sourceX').textContent!=='104'||document.getElementById('sourceY').textContent!=='204')throw new Error('absolute Inspector='+[document.getElementById('elementX').value,document.getElementById('elementY').value,document.getElementById('sourceX').textContent,document.getElementById('sourceY').textContent].join(','));
      target=node('relativeText');target.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}));await wait(10);
      if(document.getElementById('elementX').value!=='110'||document.getElementById('elementY').value!=='180'||document.getElementById('sourceX').textContent!=='104'||document.getElementById('sourceY').textContent!=='204')throw new Error('relative Inspector did not remove M2 and restore source bias');
    });
    await check('pointer drag moves visually and Apply retains reversible source semantics',async function(){
      var target=node('absoluteText');var before=target.getBoundingClientRect();var x=before.left+before.width/2;var y=before.top+before.height/2;
      target.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:x,clientY:y}));
      window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:x+12,clientY:y+7}));
      window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:x+12,clientY:y+7}));await wait(10);
      target=node('absoluteText');close(px(target.style.left),112,'drag paint x');close(px(target.style.top),207,'drag paint y');
      if(document.getElementById('elementX').value!=='112'||document.getElementById('elementY').value!=='207'||document.getElementById('sourceX').textContent!=='116'||document.getElementById('sourceY').textContent!=='211')throw new Error('drag Inspector/source mismatch');
      document.getElementById('applyButton').click();await wait(10);
      var apply=window.__legacyCoordinatePosts.filter(function(message){return message.type==='apply';}).at(-1);
      var change=apply&&apply.changes&&apply.changes.find(function(value){return value.elementId===window.__legacyCoordinateIds.absoluteText;});
      if(!change||change.x!==112||change.y!==207)throw new Error('paint-space Apply payload='+JSON.stringify(apply));
      metrics.drag=change.x+','+change.y+'=>116,211';
    });
    await check('Reset and zoom preserve the current draft without accumulating the bias',async function(){
      document.getElementById('resetPreview').click();await wait(10);
      close(px(node('absoluteText').style.left),112,'reset draft x');close(px(node('absoluteText').style.top),207,'reset draft y');
      document.getElementById('zoomIn').click();document.getElementById('zoomIn').click();await wait(10);
      close(px(node('absoluteText').style.left),112,'zoom draft x');close(px(node('absoluteText').style.top),207,'zoom draft y');
      document.getElementById('zoomReset').click();await wait(10);
      close(px(node('absoluteText').style.left),112,'zoom reset draft x');close(px(node('absoluteText').style.top),207,'zoom reset draft y');
    });
    await check('Fresh and repeated model delivery restores source paint coordinates without accumulating the bias',async function(){
      window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:window.__legacyCoordinateModel,previewRevision:2,preserveDrafts:false,geeOffsetHelp:''}}));await wait(20);
      window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:window.__legacyCoordinateModel,previewRevision:3,preserveDrafts:false,geeOffsetHelp:''}}));await wait(20);
      close(px(node('absoluteText').style.left),100,'repeat x');close(px(node('absoluteText').style.top),200,'repeat y');
      close(px(node('image').style.left),144,'non-text repeat x');close(px(node('image').style.top),244,'non-text repeat y');
      metrics.repeat='100,200|144,244';
    });
    document.body.dataset.legacyCoordinateInitial=metrics.initial||'';
    document.body.dataset.legacyCoordinateDrag=metrics.drag||'';
    document.body.dataset.legacyCoordinateRepeat=metrics.repeat||'';
    document.body.dataset.legacyCoordinateDom=String(document.querySelectorAll('*').length);
    document.body.dataset.legacyCoordinateTest=failures.length?'fail':'pass';
    if(failures.length)document.body.dataset.legacyCoordinateErrors=encodeURIComponent(failures.join(' || '));
  }
  run().catch(function(error){document.body.dataset.legacyCoordinateTest='fail';document.body.dataset.legacyCoordinateErrors=encodeURIComponent(String(error&&error.stack||error));});
}());
</script>`;
    html = html.replace('</body>', `${scenario}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let selected;
    for (const [index, executable] of browsers.entries()) {
      const result = spawnSync(executable, [
        '--headless=new', '--disable-gpu', '--disable-extensions',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--no-first-run', '--allow-file-access-from-files', '--disable-web-security',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1440,920', '--virtual-time-budget=4000', '--dump-dom',
        pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 20000, windowsHide: true });
      attempts.push({ executable, result });
      if (!result.error && result.status === 0 && /<body\b/iu.test(result.stdout || '')
        && /data-legacy-coordinate-test=/iu.test(result.stdout || '')) {
        selected = { executable, result };
        break;
      }
      console.log(`legacy-coordinate-bias-browser.test.js: candidate-failure=${diagnostic(executable, result)}`);
    }
    if (!selected) {
      throw new Error(`No browser produced the scenario DOM: ${attempts.map(item => diagnostic(item.executable, item.result)).join(' | ')}`);
    }
    const dom = selected.result.stdout || '';
    console.log(`legacy-coordinate-bias-browser.test.js: browser=${selected.executable}`);
    console.log(`legacy-coordinate-bias-browser.test.js: version=${browserVersion(selected.executable)}`);
    console.log(`legacy-coordinate-bias-browser.test.js: DOM=${/data-legacy-coordinate-dom="([0-9]+)"/iu.exec(dom)?.[1] || '<missing>'}`);
    if (!/data-legacy-coordinate-test="pass"/iu.test(dom)) {
      throw new Error(decodeError(dom));
    }
    console.log('legacy-coordinate-bias-browser.test.js: PASS');
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

main().catch(error => {
  console.error(`legacy-coordinate-bias-browser.test.js: FAIL (${error?.stack || error})`);
  process.exitCode = 1;
});
