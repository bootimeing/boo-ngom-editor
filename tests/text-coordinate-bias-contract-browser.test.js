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
const {
  parseNpcDialogDocument,
  reflowNpcDialogLayout,
} = runtimeRequire('out/ui-dialog/source-parser');
const {
  applyTextReplacements,
  buildDialogCoordinateEdits,
} = runtimeRequire('out/ui-dialog/source-patcher');
const { workspaceNpcDialogOffsets } = runtimeRequire('out/ui-dialog/offsets');

const MAIN_ORIGIN = Object.freeze({ x: 210, y: 130 });
const DRAG_DELTA = Object.freeze({ x: 10, y: 6 });
const GOM_SOURCE = [
  '[@main]',
  '#ACT',
  'OPENMERCHANTBIGDLG 1 3262 1 4 10 -20 1 476 40',
  '#SAY',
  '<TEXT:相对文字:104:204{FCOLOR=250}>',
  '<&TEXT:绝对文字:124:224{FCOLOR=251}>',
  '<&IMGEX:1:10:11:12:50:60/@非文字控件>',
].join('\r\n');
const NEWUI_SOURCE = [
  '[@main]',
  '#SAY',
  '<Text|id=KEYED|x=144|y=244|text=新UI文字|color=250>',
].join('\r\n');

function parse(source, engine, offsets) {
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/${engine.toLowerCase()}-text-coordinate-contract.txt`,
    fileName: `${engine.toLowerCase()}-text-coordinate-contract.txt`,
    filePath: `D:\\MirServer\\${engine.toLowerCase()}-text-coordinate-contract.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: source.indexOf('[@main]') + '[@main]'.length,
    offsets,
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function stableSvgDataUri(width, height) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#151515"/>`
    + '</svg>';
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function makeFixture() {
  const model = parse(GOM_SOURCE, 'GOM', workspaceNpcDialogOffsets(7, -3));
  const scene = model.pages[0];
  assert.ok(scene?.background, 'GOM main-dialog background fixture was not parsed');
  scene.background.asset = {
    status: 'ready',
    url: stableSvgDataUri(400, 300),
    archiveLabel: 'stable-dialog-background/003262',
    width: 400,
    height: 300,
    offsetX: 0,
    offsetY: 0,
  };
  reflowNpcDialogLayout(model);
  model.canvasWidth = 800;
  model.canvasHeight = 600;

  const relative = scene.elements.find(element => element.text === '相对文字');
  const absolute = scene.elements.find(element => element.text === '绝对文字');
  const image = scene.elements.find(element => element.raw.includes('<&IMGEX:'));
  assert.ok(relative && absolute && image, 'GOM Text/ImgEx coordinate probes were not parsed');
  return {
    model,
    source: GOM_SOURCE,
    ids: { relative: relative.id, absolute: absolute.id, image: image.id },
    elements: { relative, absolute, image },
  };
}

function actualElement(element) {
  return {
    biasX: element.sourceCoordinateBiasX,
    biasY: element.sourceCoordinateBiasY,
    sourceX: element.x?.sourceValue,
    sourceY: element.y?.sourceValue,
    displayX: element.x?.displayValue,
    displayY: element.y?.displayValue,
    layoutX: element.layoutX,
    layoutY: element.layoutY,
  };
}

function capture(failures, label, callback) {
  try {
    callback();
  } catch (error) {
    failures.push(`${label}: ${error?.message || error}`);
  }
}

function verifyModelContract(fixture) {
  const failures = [];
  const { relative, absolute, image } = fixture.elements;
  const newuiModel = parse(NEWUI_SOURCE, '996PC', workspaceNpcDialogOffsets(0, 0));
  const keyed = newuiModel.pages[0].elements.find(
    element => element.statementId === 'newui-text-996pc'
  );
  assert.ok(keyed, '996PC key-value Text probe was not parsed');

  capture(failures, 'relative positional TEXT uses logical minus one 4px paint bias', () => {
    assert.deepEqual(actualElement(relative), {
      biasX: 4,
      biasY: 4,
      sourceX: 104,
      sourceY: 204,
      displayX: 107,
      displayY: 197,
      layoutX: 107,
      layoutY: 197,
    });
  });
  capture(failures, 'absolute positional TEXT uses the same one 4px paint bias', () => {
    assert.deepEqual(actualElement(absolute), {
      biasX: 4,
      biasY: 4,
      sourceX: 124,
      sourceY: 224,
      displayX: 120,
      displayY: 220,
      layoutX: 120,
      layoutY: 220,
    });
  });
  capture(failures, '996PC key-value Text keeps zero paint bias', () => {
    assert.deepEqual(actualElement(keyed), {
      biasX: 0,
      biasY: 0,
      sourceX: 144,
      sourceY: 244,
      displayX: 144,
      displayY: 244,
      layoutX: 144,
      layoutY: 244,
    });
  });
  capture(failures, 'non-Text positional ImgEx coordinates stay unchanged', () => {
    assert.deepEqual(actualElement(image), {
      biasX: 0,
      biasY: 0,
      sourceX: 50,
      sourceY: 60,
      displayX: 50,
      displayY: 60,
      layoutX: 50,
      layoutY: 60,
    });
  });
  capture(failures, 'source patch writes only the requested visual movement delta', () => {
    const edit = buildDialogCoordinateEdits(fixture.source, fixture.model, [{
      elementId: absolute.id,
      x: absolute.layoutX + DRAG_DELTA.x,
      y: absolute.layoutY + DRAG_DELTA.y,
    }]);
    const patched = applyTextReplacements(fixture.source, edit.replacements);
    assert.match(patched, /<&TEXT:绝对文字:134:230\{FCOLOR=251\}>/u);
    assert.doesNotMatch(patched, /<&TEXT:绝对文字:(?:138|344):(?:234|356)/u,
      'fixed paint bias or main-dialog origin leaked into source');
  });

  return {
    failures,
    actual: {
      relative: actualElement(relative),
      absolute: actualElement(absolute),
      keyed: actualElement(keyed),
      image: actualElement(image),
    },
  };
}

function browsers() {
  const candidates = [
    process.env.BOO_BROWSER_EXECUTABLE,
    process.env.BOO_CHROMIUM_PATH,
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

function decodeAttribute(value) {
  return String(value || '').replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

function domMetric(dom, name) {
  const encoded = new RegExp(`data-text-coordinate-${name}="([^"]*)"`, 'iu').exec(dom)?.[1];
  if (!encoded) return undefined;
  return decodeURIComponent(decodeAttribute(encoded));
}

function makeHarness(fixture, temporary) {
  const harness = path.join(temporary, 'text-coordinate-bias-contract.html');
  let html = fs.readFileSync(path.join(RUNTIME_ROOT, 'media', 'npc-dialog-visual.html'), 'utf8')
    .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
    .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
  const renderer = `<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`;
  const mock = `<script>
window.__model=${serialize(fixture.model)};window.__ids=${serialize(fixture.ids)};
window.__postedMessages=[];window.acquireVsCodeApi=function(){return{postMessage:function(message){
  window.__postedMessages.push(message);
  if(message.type==='ready')setTimeout(function(){window.dispatchEvent(new MessageEvent('message',{data:{
    type:'model',model:window.__model,previewRevision:1,preserveDrafts:false,geeOffsetHelp:''
  }}));},0);
}}};
</script>`;
  assert.ok(html.includes(renderer), 'renderer script marker missing from HTML template');
  html = html.replace(renderer, `${mock}${renderer}`);
  const scenario = `<script>
(function(){
  var failures=[];var metrics={};
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
  function px(value){return Number(String(value||'').replace('px',''));}
  function close(actual,expected,label){if(Math.abs(actual-expected)>0.51)throw new Error(label+' actual='+actual+' expected='+expected);}
  function node(name){return document.querySelector('[data-element-id="'+window.__ids[name]+'"]');}
  function positions(){return{
    relative:[px(node('relative').style.left),px(node('relative').style.top)],
    absolute:[px(node('absolute').style.left),px(node('absolute').style.top)],
    image:[px(node('image').style.left),px(node('image').style.top)]
  };}
  function same(actual,expected,label){if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(label+' actual='+JSON.stringify(actual)+' expected='+JSON.stringify(expected));}
  async function check(name,callback){try{await callback();}catch(error){failures.push(name+': '+(error&&error.message?error.message:String(error)));}}
  async function run(){
    for(var attempt=0;attempt<150&&!node('absolute');attempt++)await wait(20);
    var expected={relative:[317,327],absolute:[330,350],image:[260,190]};
    await check('main-dialog origin composes after exactly one Text paint bias',async function(){
      if(!node('relative')||!node('absolute')||!node('image'))throw new Error('fixture DOM incomplete');
      var actual=positions();metrics.initial=actual;same(actual,expected,'initial positions');
    });
    await check('repeat model, zoom/reset, and preview reset never accumulate coordinates',async function(){
      window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:window.__model,previewRevision:2,preserveDrafts:false,geeOffsetHelp:''}}));
      await wait(20);var repeated=positions();
      document.getElementById('zoomIn').click();document.getElementById('zoomIn').click();await wait(20);
      document.getElementById('zoomReset').click();await wait(20);var zoomReset=positions();
      document.getElementById('resetPreview').click();await wait(20);var previewReset=positions();
      metrics.repeat={repeated:repeated,zoomReset:zoomReset,previewReset:previewReset};
      same(repeated,expected,'repeat model');same(zoomReset,expected,'zoom reset');same(previewReset,expected,'preview reset');
    });
    await check('Inspector separates painted coordinates from logical source coordinates',async function(){
      node('absolute').dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}));await wait(10);
      var actual={
        x:document.getElementById('elementX').value,y:document.getElementById('elementY').value,
        sourceX:document.getElementById('sourceX').textContent,sourceY:document.getElementById('sourceY').textContent
      };
      metrics.inspector=actual;
      same(actual,{x:'120',y:'220',sourceX:'124',sourceY:'224'},'paint/source Inspector');
    });
    await check('pointer drag moves pixels by delta and Apply does not expose origin or fixed bias',async function(){
      var absolute=node('absolute');var before=absolute.getBoundingClientRect();
      var clientX=before.left+Math.min(5,before.width/2);var clientY=before.top+Math.min(5,before.height/2);
      absolute.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:clientX,clientY:clientY}));
      window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:clientX+10,clientY:clientY+6}));
      window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:clientX+10,clientY:clientY+6}));await wait(20);
      absolute=node('absolute');var after=absolute.getBoundingClientRect();
      close(after.left-before.left,10,'drag pixel delta x');close(after.top-before.top,6,'drag pixel delta y');
      var inspector={x:document.getElementById('elementX').value,y:document.getElementById('elementY').value,
        sourceX:document.getElementById('sourceX').textContent,sourceY:document.getElementById('sourceY').textContent};
      metrics.dragInspector=inspector;
      same(inspector,{x:'130',y:'226',sourceX:'134',sourceY:'230'},'drag paint/source Inspector');
      document.getElementById('applyButton').click();await wait(10);
      var apply=window.__postedMessages.filter(function(message){return message.type==='apply';}).at(-1);
      var change=apply&&apply.changes&&apply.changes.find(function(candidate){return candidate.elementId===window.__ids.absolute;});
      if(!change)throw new Error('Apply payload missing absolute Text change');
      metrics.apply=change;
    });
    document.body.dataset.textCoordinateMetrics=encodeURIComponent(JSON.stringify(metrics));
    document.body.dataset.textCoordinateApply=encodeURIComponent(JSON.stringify(metrics.apply||null));
    document.body.dataset.textCoordinateErrors=encodeURIComponent(failures.join(' || '));
    document.body.dataset.textCoordinateTest=failures.length?'fail':'pass';
  }
  run().catch(function(error){document.body.dataset.textCoordinateTest='fail';document.body.dataset.textCoordinateErrors=encodeURIComponent(String(error&&error.stack||error));});
}());
</script>`;
  html = html.replace('</body>', `${scenario}</body>`);
  fs.writeFileSync(harness, html, 'utf8');
  return harness;
}

function runBrowserContract(fixture) {
  const candidates = browsers();
  if (!candidates.length) {
    return { failures: ['no installed Edge/Chrome is available; browser coordinate gate cannot skip'] };
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-text-coordinate-contract-'));
  try {
    const harness = makeHarness(fixture, temporary);
    const attempts = [];
    let selected;
    for (let index = 0; index < candidates.length; index++) {
      const executable = candidates[index];
      const result = spawnSync(executable, [
        '--headless=new', '--disable-gpu', '--disable-extensions',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
        '--no-first-run', '--allow-file-access-from-files', '--disable-web-security',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1440,920', '--virtual-time-budget=4500', '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8', timeout: 30000, windowsHide: true,
        maxBuffer: 24 * 1024 * 1024,
      });
      attempts.push({ executable, result });
      if (!result.error && result.status === 0 && /<body\b/iu.test(result.stdout || '')
        && /data-text-coordinate-test=/iu.test(result.stdout || '')) {
        selected = { executable, result };
        break;
      }
    }
    if (!selected) {
      return { failures: [`no installed browser completed the Text coordinate scenario:\n${attempts.map(({ executable, result }) => (
        `${executable}: status=${result.status}, error=${result.error?.message || '<none>'}, `
        + `body=${/<body\b/iu.test(result.stdout || '')}, stderr=${String(result.stderr || '').trim() || '<empty>'}`
      )).join('\n')}`] };
    }
    const dom = selected.result.stdout || '';
    const failures = (domMetric(dom, 'errors') || '').split(' || ').filter(Boolean);
    const apply = JSON.parse(domMetric(dom, 'apply') || 'null');
    capture(failures, 'browser Apply plus source patch preserves only drag delta', () => {
      assert.ok(apply, 'browser did not return an Apply coordinate change');
      const edit = buildDialogCoordinateEdits(fixture.source, fixture.model, [apply]);
      const patched = applyTextReplacements(fixture.source, edit.replacements);
      assert.match(patched, /<&TEXT:绝对文字:134:230\{FCOLOR=251\}>/u,
        `patched source=${JSON.stringify(patched)}`);
      assert.doesNotMatch(patched, /<&TEXT:绝对文字:(?:138|344):(?:234|356)/u,
        'fixed paint bias or main-dialog origin leaked into source');
    });
    return {
      failures,
      browser: selected.executable,
      version: browserVersion(selected.executable),
      metrics: domMetric(dom, 'metrics'),
      apply,
    };
  } finally {
    if (process.env.BOO_KEEP_TEXT_COORDINATE_TEMP === '1') {
      console.log(`text-coordinate-bias-contract-browser.test.js: retained=${temporary}`);
    } else {
      removeTemporaryDirectory(temporary);
    }
  }
}

function main() {
  const fixture = makeFixture();
  const model = verifyModelContract(fixture);
  const browser = runBrowserContract(fixture);
  const failures = [...model.failures, ...browser.failures];

  console.log(`text-coordinate-bias-contract-browser.test.js: runtime-root=${RUNTIME_ROOT}`);
  console.log(`text-coordinate-bias-contract-browser.test.js: expected-main-origin=${MAIN_ORIGIN.x},${MAIN_ORIGIN.y}`);
  console.log(`text-coordinate-bias-contract-browser.test.js: expected-model=${JSON.stringify({
    relative: { biasX: 4, biasY: 4, sourceX: 104, sourceY: 204, displayX: 107, displayY: 197 },
    absolute: { biasX: 4, biasY: 4, sourceX: 124, sourceY: 224, displayX: 120, displayY: 220 },
    keyed: { biasX: 0, biasY: 0, sourceX: 144, sourceY: 244, displayX: 144, displayY: 244 },
    image: { biasX: 0, biasY: 0, sourceX: 50, sourceY: 60, displayX: 50, displayY: 60 },
  })}`);
  console.log(`text-coordinate-bias-contract-browser.test.js: actual-model=${JSON.stringify(model.actual)}`);
  if (browser.browser) {
    console.log(`text-coordinate-bias-contract-browser.test.js: browser=${browser.browser}`);
    console.log(`text-coordinate-bias-contract-browser.test.js: version=${browser.version}`);
    console.log(`text-coordinate-bias-contract-browser.test.js: actual-browser=${browser.metrics || '<missing>'}`);
    console.log(`text-coordinate-bias-contract-browser.test.js: apply=${JSON.stringify(browser.apply)}`);
  }

  if (failures.length) {
    console.error('text-coordinate-bias-contract-browser.test.js: RED FAILURE MATRIX');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log('text-coordinate-bias-contract-browser.test.js: PASS');
  }
}

main();
