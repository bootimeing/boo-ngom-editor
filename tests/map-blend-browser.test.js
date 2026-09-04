const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');

function browserCandidates() {
  return [...new Set([
    process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate)).map(candidate => path.resolve(candidate)))];
}

function diagnostic(candidate, result) {
  const stderr = String(result.stderr || '').trim().replace(/\r?\n/g, '\\n') || '<empty>';
  return `${candidate}: status=${result.status}, signal=${result.signal || '<none>'}, `
    + `error=${result.error?.message || '<none>'}, body=${/<body\b/i.test(result.stdout || '')}, `
    + `stderr=${stderr}`;
}

function decodeAttribute(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function scenarioScript() {
  return `<script>
(function(){
  function pixelAt(target,x){return Array.from(target.getImageData(x,0,1,1).data)}
  function makeSource(){
    var source=document.createElement('canvas');source.width=3;source.height=1;
    var sourceContext=source.getContext('2d'),pixels=sourceContext.createImageData(3,1);
    pixels.data.set([
      0,0,8,255,
      16,96,220,255,
      255,0,255,0
    ]);
    sourceContext.putImageData(pixels,0,0);
    Object.defineProperty(source,'complete',{configurable:true,value:true});
    return source;
  }
  function makeTarget(composite){
    var targetCanvas=document.createElement('canvas');targetCanvas.width=3;targetCanvas.height=1;
    var target=targetCanvas.getContext('2d');
    target.fillStyle='rgb(120,100,80)';target.fillRect(0,0,3,1);
    target.globalCompositeOperation=composite||'source-over';
    return target;
  }
  function sample(target){
    return{
      nearBlack:pixelAt(target,0),
      brightBlue:pixelAt(target,1),
      transparent:pixelAt(target,2),
      composite:target.globalCompositeOperation
    };
  }
  try{
    state.offsetX=0;state.offsetY=-31;state.scale=1;
    var source=makeSource();
    var resource={
      meta:{width:3,height:1,offsetX:0,offsetY:0,url:'canvas-pixel-fixture'},
      image:source,blank:false,failed:false
    };

    var ordinary=makeTarget('source-over');
    drawOriginalMapResource(ordinary,resource,'object',0,0,0);

    var bit7=makeTarget('source-over');
    drawOriginalMapResource(bit7,resource,'object',0,0,0x80);

    var restored=makeTarget('multiply');
    drawOriginalMapResource(restored,resource,'object',0,0,0x80);

    document.body.dataset.mapBlendResults=JSON.stringify({
      ordinary:sample(ordinary),
      bit7:sample(bit7),
      restored:sample(restored)
    });
    document.body.dataset.mapBlendTest='pass';
  }catch(error){
    document.body.dataset.mapBlendTest='fail';
    document.body.dataset.mapBlendErrors=error&&error.stack?error.stack:String(error);
  }
}());
</script>`;
}

function main() {
  const candidates = browserCandidates();
  assert.ok(candidates.length > 0, 'no installed Chromium browser was found');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-blend-browser-'));
  try {
    const harness = path.join(temporary, 'map-blend.html');
    let html = fs.readFileSync(path.join(root, 'media', 'map-preview.html'), 'utf8');
    html = html.replace(
      '<script>',
      '<script>window.acquireVsCodeApi=function(){return{postMessage:function(){}}};</script><script>'
    );
    html = html.replace('</body>', `${scenarioScript()}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let selected;
    for (let index = 0; index < candidates.length; index++) {
      const result = spawnSync(candidates[index], [
        '--headless=new',
        '--disable-gpu',
        '--disable-extensions',
        '--no-first-run',
        '--allow-file-access-from-files',
        '--force-device-scale-factor=1',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1200,800',
        '--virtual-time-budget=1500',
        '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8',
        timeout: 20000,
        maxBuffer: 8 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-map-blend-test=/i.test(result.stdout || '')) {
        selected = { candidate: candidates[index], result };
        break;
      }
    }
    assert.ok(
      selected,
      `no installed browser completed the map blend scenario:\n${attempts.map(
        ({ candidate, result }) => diagnostic(candidate, result)
      ).join('\n')}`
    );
    const encodedError = /data-map-blend-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    assert.match(
      selected.result.stdout,
      /data-map-blend-test="pass"/,
      decodeAttribute(encodedError) || 'browser map blend scenario failed'
    );
    const encodedResults = /data-map-blend-results="([^"]*)"/.exec(selected.result.stdout)?.[1];
    assert.ok(encodedResults, 'browser map blend scenario did not expose pixel results');
    const results = JSON.parse(decodeAttribute(encodedResults));
    const expected = {
      ordinary: {
        nearBlack: [0, 0, 8, 255],
        brightBlue: [16, 96, 220, 255],
        transparent: [120, 100, 80, 255],
        composite: 'source-over',
      },
      bit7: {
        nearBlack: [120, 100, 88, 255],
        brightBlue: [136, 196, 255, 255],
        transparent: [120, 100, 80, 255],
        composite: 'source-over',
      },
      restored: {
        nearBlack: [120, 100, 88, 255],
        brightBlue: [136, 196, 255, 255],
        transparent: [120, 100, 80, 255],
        composite: 'multiply',
      },
    };
    assert.deepEqual(
      results,
      expected,
      'ordinary MAP Objects must stay source-over; bit7 Objects must use lighter and restore the caller composite mode'
    );
    console.log(`map-blend-browser.test.js: browser=${selected.candidate}`);
    console.log(`map-blend-browser.test.js: pixels=${JSON.stringify(results)}`);
  } finally {
    removeTemporaryDirectory(temporary);
  }
  console.log('map-blend-browser.test.js: PASS');
}

main();
