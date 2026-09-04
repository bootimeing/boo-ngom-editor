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
(async function(){
  var results=[];
  if(typeof clearOriginalStaticChunkCache!=='function')window.clearOriginalStaticChunkCache=function(){};
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms)})}
  function send(data){window.dispatchEvent(new MessageEvent('message',{data:data}))}
  function check(value,message){if(!value)throw new Error(message)}
  function mapData(){return{
    map:{key:'viewport-map',mapId:'viewport-map',originalMapId:'viewport-map',name:'viewport-map',width:128,height:64},
    maps:[],markers:[],npcs:[],spawns:[],safeZones:[],merchantColumns:[],monGenColumns:[],
    engine:'GOM',entityWarnings:[],markerFile:'',warning:'',imageUrl:''
  }}
  function reset(){
    updateMap(mapData());window.__viewportPosted.length=0;switchToOriginalMap();
    var load=window.__viewportPosted.find(function(item){return item.type==='loadOriginalMap'});
    check(load,'original map load request was not posted');return load;
  }
  function ready(load,chunkWidth,chunkHeight){
    send({type:'originalMapReady',requestId:load.requestId,generation:101,
      fileName:'viewport-map.map',format:'classic-14',width:128,height:64,
      pixelWidth:128*48,pixelHeight:64*32,chunkCellWidth:chunkWidth,chunkCellHeight:chunkHeight});
    var requests=window.__viewportPosted.filter(function(item){return item.type==='loadOriginalMapViewport'});
    check(requests.length>0,'Ready did not trigger an initial viewport request: '+JSON.stringify({
      load:load,active:state.original.active,requestId:state.original.requestId,
      generation:state.original.generation,lastViewportKey:state.original.lastViewportKey,
      posted:window.__viewportPosted
    }));
    return requests[requests.length-1];
  }
  function viewportData(request){return{
    type:'originalMapViewportData',requestId:request.requestId,generation:request.generation,
    viewportSeq:request.viewportSeq,viewport:request.viewport,prefetch:false,
    resources:[],tiles:[],smTiles:[],objects:[],objectAnimationFrames:[],objectAnimationTicks:[],
    objectAnimationSetIds:[],objectAnimationSets:[],permanentMapEffects:[],permanentMapEffectSets:[],
    animatedObjectCount:0,permanentMapEffectCount:0,warning:''
  }}
  async function loaded(chunkWidth,chunkHeight){
    var load=reset(),request=ready(load,chunkWidth,chunkHeight);send(viewportData(request));await wait(20);
    check(state.original.ready&&state.original.layer,'initial viewport data was not applied');
    return{load:load,request:request,layer:state.original.layer};
  }
  function appliedKey(){
    return state.original.appliedViewportKey!==undefined
      ?state.original.appliedViewportKey:state.original.lastViewportKey;
  }
  async function run(name,body){
    try{await body();results.push({name:name,status:'pass'})}
    catch(error){results.push({name:name,status:'fail',message:error&&error.stack?error.stack:String(error)})}
  }

  await run('load-level error before Ready is visible',async function(){
    var load=reset();
    send({type:'originalMapError',requestId:load.requestId,generation:101,message:'pre-ready failure'});
    await wait(0);
    check(state.original.warning==='pre-ready failure','pre-Ready load error was hidden by generation gating');
    check(mapLayerToggle.disabled===false,'pre-Ready load error did not release the layer toggle');
  });

  await run('applied viewport key commits only after success',async function(){
    var load=reset(),request=ready(load,16,16),key=originalMapViewportKey(request.viewport);
    check(appliedKey()!==key,'requested viewport was marked applied before its data succeeded');
    send(viewportData(request));await wait(20);
    check(appliedKey()===key,'successful viewport data did not commit the applied key');
  });

  await run('non-square chunk width and height stay independent',async function(){
    var load=reset();ready(load,16,8);window.__viewportPosted.length=0;
    state.original.lastViewportKey='';
    if(state.original.appliedViewportKey!==undefined)state.original.appliedViewportKey='';
    centerWorldPoint(64*48,40*32,1,false);flushOriginalMapViewport();
    var request=window.__viewportPosted.find(function(item){return item.type==='loadOriginalMapViewport'});
    check(request,'non-square viewport request was not posted');
    var scale=Math.max(.0001,Number(state.scale)||1);
    var worldTop=Math.max(0,Math.min(state.worldH,-state.offsetY/scale));
    var worldBottom=Math.max(worldTop,Math.min(state.worldH,(viewport.clientHeight-state.offsetY)/scale));
    var cellTop=Math.max(0,Math.min(63,Math.floor(worldTop/32)));
    var cellBottom=Math.max(cellTop,Math.min(63,Math.floor(Math.max(worldTop,worldBottom-1)/32)));
    var expectedTop=Math.floor(cellTop/8)*8;
    var expectedBottom=Math.min(63,(Math.floor(cellBottom/8)+1)*8-1);
    check(state.original.chunkCellHeight===8,'Ready did not retain chunkCellHeight');
    check(request.viewport.top===expectedTop&&request.viewport.bottom===expectedBottom,
      'vertical viewport bounds reused chunkCellWidth instead of chunkCellHeight');
  });

  await run('viewport error is non-fatal and the same target can retry',async function(){
    var setup=await loaded(16,16),layer=setup.layer,applied=appliedKey();
    window.__viewportPosted.length=0;state.offsetX-=32*48;render();flushOriginalMapViewport();
    var request=window.__viewportPosted.find(function(item){return item.type==='loadOriginalMapViewport'});
    check(request,'second viewport request was not posted');
    check(appliedKey()===applied,'pending viewport replaced the applied key');
    send({type:'originalMapError',requestId:request.requestId,generation:request.generation,
      viewportSeq:request.viewportSeq,message:'viewport failure'});await wait(0);
    check(state.original.ready&&state.original.layer===layer,'viewport error destroyed the last good layer');
    var before=window.__viewportPosted.length;flushOriginalMapViewport();
    var retries=window.__viewportPosted.slice(before).filter(function(item){return item.type==='loadOriginalMapViewport'});
    check(retries.length===1&&retries[0].viewportSeq>request.viewportSeq,
      'failed viewport target could not be retried with a new sequence');
  });

  await run('navigator without MiniMap does not request the whole map',async function(){
    await loaded(16,16);state.image=null;window.__viewportPosted.length=0;
    renderMapNavigator();await wait(0);
    var loads=window.__viewportPosted.filter(function(item){
      return item.type==='loadOriginalMap'||item.type==='loadOriginalMapViewport';
    });
    check(loads.length===0,'navigator rendering triggered an original-map resource request');
  });

  await run('ready layer survives preview round trip',async function(){
    var setup=await loaded(16,16);
    var generation=state.original.generation;
    var layer=state.original.layer;
    var previousSeq=state.original.viewportSeq;

    reset100();
    var target=computeOriginalMapViewport();
    var targetKey=originalMapViewportKey(target);
    state.original.lastViewportKey='0:0:15:15';
    state.original.pendingViewportKey=targetKey;

    window.__viewportPosted.length=0;
    switchToPreviewMap();

    check(!window.__viewportPosted.some(function(item){return item.type==='cancelOriginalMap'}),
      'ready layer preview switch sent cancelOriginalMap');
    check(state.original.generation===generation,'ready preview switch cleared generation');
    check(state.original.layer===layer,'ready preview switch cleared layer');

    switchToOriginalMap();

    var request=window.__viewportPosted.find(function(item){return item.type==='loadOriginalMapViewport'});
    check(request,'cached original-map return did not request the current region');
    check(request.generation===generation,'cached return changed generation');
    check(request.viewportSeq>previousSeq,'cached return did not advance viewportSeq');
    check(state.original.layer===layer,'cached return replaced the ready layer before data arrived');
    check(state.original.pendingViewportKey===originalMapViewportKey(request.viewport),
      'stale pending key was not replaced by the current request');
  });

  await run('unfinished first viewport cancels and reloads',async function(){
    var load=reset();
    ready(load,16,16);

    check(state.original.generation===101,'Ready generation was not installed');
    check(!state.original.ready&&!state.original.layer,'scenario unexpectedly became ready');

    var requestIdBefore=state.original.requestId;
    window.__viewportPosted.length=0;
    switchToPreviewMap();

    var cancel=window.__viewportPosted.find(function(item){return item.type==='cancelOriginalMap'});
    check(cancel,'unfinished first viewport did not send cancelOriginalMap');
    check(cancel.requestId===requestIdBefore,'cancel requestId changed');
    check(cancel.generation===101,'cancel generation changed');
    check(state.original.generation===0,'unfinished switch did not clear generation');
    check(state.original.layer===null,'unfinished switch retained layer');

    window.__viewportPosted.length=0;
    switchToOriginalMap();

    var reload=window.__viewportPosted.find(function(item){return item.type==='loadOriginalMap'});
    check(reload,'return after unfinished cancellation did not reload original map');
    check(reload.requestId>requestIdBefore,'reload did not advance requestId');
  });

  await run('first visible viewport is followed by bounded neighbor prefetch',async function(){
    var setup=await loaded(16,16),layer=setup.layer,sequence=state.original.viewportSeq;
    window.__viewportPosted.length=0;
    await wait(650);
    var requests=window.__viewportPosted.filter(function(item){
      return item.type==='loadOriginalMapViewport'&&item.prefetch===true;
    });
    check(requests.length===1,'successful visible viewport did not schedule exactly one neighbor prefetch');
    check(requests[0].viewportSeq>sequence,'neighbor prefetch did not advance viewportSeq');
    check(state.original.layer===layer,'neighbor prefetch cleared the visible layer before data arrived');
    var target=requests[0].viewport,expanded=expandedOriginalMapViewport(target);
    check(expanded,'neighbor prefetch exceeded the 36-chunk safety budget');
    var width=Math.floor(expanded.right/16)-Math.floor(expanded.left/16)+1;
    var height=Math.floor(expanded.bottom/16)-Math.floor(expanded.top/16)+1;
    check(width*height<=36,'neighbor prefetch expanded beyond 36 chunks');

    check(renderProgress.hidden===true,'first viewport progress overlay did not finish before prefetch');
    send({type:'originalMapProgress',requestId:requests[0].requestId,
      generation:requests[0].generation,viewportSeq:requests[0].viewportSeq,
      percent:77,label:'正在读取当前区域素材包 3/3'});
    var prefetched=viewportData(requests[0]);prefetched.prefetch=true;
    send(prefetched);await wait(20);
    check(renderProgress.hidden===true,
      'completed background prefetch left the blocking first-screen progress overlay at 77%');
  });

  document.body.dataset.viewportProtocolResults=JSON.stringify(results);
  document.body.dataset.viewportProtocolTest=results.every(function(item){return item.status==='pass'})?'pass':'fail';
}());
</script>`;
}

function main() {
  const candidates = browserCandidates();
  assert.ok(candidates.length > 0, 'no installed Chromium browser was found');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-viewport-protocol-'));
  try {
    const harness = path.join(temporary, 'map-viewport-protocol.html');
    let html = fs.readFileSync(path.join(root, 'media', 'map-preview.html'), 'utf8');
    html = html.replace(
      '<script>',
      '<script>window.__viewportPosted=[];window.acquireVsCodeApi=function(){return{postMessage:function(message){window.__viewportPosted.push(message)}}};</script><script>'
    );
    html = html.replace('</body>', `${scenarioScript()}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    let selected;
    const diagnostics = [];
    for (let index = 0; index < candidates.length; index++) {
      const result = spawnSync(candidates[index], [
        '--headless=new', '--disable-gpu', '--disable-extensions',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--no-first-run',
        '--allow-file-access-from-files', '--force-device-scale-factor=1',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1200,800', '--virtual-time-budget=2500', '--dump-dom', pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
      diagnostics.push(`${candidates[index]}: status=${result.status}, error=${result.error?.message || '<none>'}`);
      if (!result.error && result.status === 0 && /data-viewport-protocol-test=/i.test(result.stdout || '')) {
        selected = { candidate: candidates[index], result };break;
      }
    }
    assert.ok(selected, `no browser completed the viewport scenario:\n${diagnostics.join('\n')}`);
    const encoded = /data-viewport-protocol-results="([^"]*)"/.exec(selected.result.stdout)?.[1] || '[]';
    const results = JSON.parse(decodeAttribute(encoded));
    const failed = results.filter(result => result.status !== 'pass');
    console.log(`map-viewport-protocol-browser.test.js: browser=${selected.candidate}`);
    for (const result of results) console.log(`map-viewport-protocol-browser.test.js: ${result.status.toUpperCase()} - ${result.name}`);
    assert.deepEqual(failed, [], failed.map(result => `${result.name}: ${result.message}`).join('\n'));
  } finally {
    removeTemporaryDirectory(temporary);
  }
  console.log('map-viewport-protocol-browser.test.js: PASS');
}

main();
