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
(async function(){
  var nativeSetTimeout=window.setTimeout.bind(window),nativeClearTimeout=window.clearTimeout.bind(window);
  var activeAnimationTimers=new Set(),scheduledAnimationTimers=0,maxActiveAnimationTimers=0;
  window.setTimeout=function(callback,delay){
    var tracked=String(callback).indexOf('renderOriginalMapAnimationFrame')>=0&&
      String(callback).indexOf('scheduleOriginalMapAnimation')>=0;
    var args=Array.prototype.slice.call(arguments,2),timer=0;
    timer=nativeSetTimeout(function(){
      if(tracked)activeAnimationTimers.delete(timer);
      callback.apply(window,args);
    },delay);
    if(tracked){
      activeAnimationTimers.add(timer);scheduledAnimationTimers++;
      maxActiveAnimationTimers=Math.max(maxActiveAnimationTimers,activeAnimationTimers.size);
    }
    return timer;
  };
  window.clearTimeout=function(timer){activeAnimationTimers.delete(timer);return nativeClearTimeout(timer)};
  function wait(ms){return new Promise(function(resolve){nativeSetTimeout(resolve,ms)})}
  function assertState(value,message){if(!value)throw new Error(message)}
  function samePixel(left,right){return left.length===right.length&&left.every(function(value,index){return value===right[index]})}
  async function waitForPixelChange(x,y,previous,timeout){
    var started=performance.now();
    while(performance.now()-started<timeout){
      await wait(25);
      var current=pixelAt(x,y);if(!samePixel(previous,current))return current;
    }
    throw new Error('animation did not resume within '+timeout+'ms');
  }
  var forcedHidden=false;
  try{
    Object.defineProperty(document,'hidden',{configurable:true,get:function(){return forcedHidden}});
  }catch(error){
    Object.defineProperty(Object.getPrototypeOf(document),'hidden',{configurable:true,get:function(){return forcedHidden}});
  }
  function setPageHidden(value){forcedHidden=Boolean(value);document.dispatchEvent(new Event('visibilitychange'))}
  function solidImage(colour,width,height){
    return new Promise(function(resolve,reject){
      var image=new Image();
      image.onload=function(){resolve(image)};image.onerror=reject;
      image.src='data:image/svg+xml,'+encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'"><rect width="'+width+'" height="'+height+'" fill="'+colour+'"/></svg>'
      );
    });
  }
  function pixelAt(x,y){return Array.from(ctx.getImageData(x,y,1,1).data)}
  function isRed(pixel){return pixel[0]>220&&pixel[1]<35&&pixel[2]<35&&pixel[3]>240}
  function isGreen(pixel){return pixel[0]<35&&pixel[1]>110&&pixel[2]<35&&pixel[3]>240}
  function isBlue(pixel){return pixel[0]<35&&pixel[1]<35&&pixel[2]>220&&pixel[3]>240}
  function isYellow(pixel){return pixel[0]>220&&pixel[1]>220&&pixel[2]<35&&pixel[3]>240}
  function isCanvasBackground(pixel){return pixel[0]===17&&pixel[1]===17&&pixel[2]===17&&pixel[3]===255}
  try{
    var images=await Promise.all([
      solidImage('#ff0000',48,32),solidImage('#008000',48,32),
      solidImage('#0000ff',8,8),solidImage('#ffff00',8,8)
    ]);
    var resources=images.map(function(image,index){
      var isEffect=index>=2;
      return{
        meta:{
          width:isEffect?8:48,height:isEffect?8:32,
          offsetX:isEffect?13:0,offsetY:isEffect?-11:0,url:'frame-'+index
        },
        image:image,blank:false,failed:false
      };
    });
    resources.push({
      meta:{width:1,height:1,offsetX:0,offsetY:0,url:''},
      image:null,blank:true,failed:false
    });
    var layer={
      resources:resources,tiles:[],smTiles:[],objects:[1,1,0],
      objectAnimationFrames:[2],objectAnimationTicks:[1],
      objectAnimationSetIds:[0],objectAnimationSets:[[0,1]],
      permanentMapEffects:[
        {x:2,y:2,speedMs:150,drawMode:0,frameSetId:0},
        {x:3,y:3,speedMs:150,drawMode:0,frameSetId:1}
      ],
      permanentMapEffectSets:[[2,3],[4,2]]
    };
    layer.objectRowRanges=originalMapObjectRowRanges(layer.objects);
    state.map={width:4,height:4};state.worldW=192;state.worldH=128;
    state.scale=1;state.offsetX=20;state.offsetY=20;
    state.original.active=true;state.original.ready=true;state.original.layer=layer;
    state.original.baseLayer=null;state.original.animationStartedAt=performance.now();
    state.original.requestId=42;state.original.warning='current request intact';
    refreshOriginalMapAnimationState(layer);
    assertState(state.original.animationCount===1,'animated MAP Object count was not exposed');
    assertState(state.original.permanentMapEffectCount===2,'permanent MAPEFFECT count was not exposed');
    assertState(JSON.stringify(layer.animationIntervalsMs)===JSON.stringify([150,200]),
      'animation intervals must contain the 150ms MAPEFFECT and 200ms MAP Object periods');
    assertState(layer.permanentMapEffectSetReady[1]===true,'blank MAPEFFECT timing slot made its sequence unready');
    assertState(originalMapEffectResource(layer,layer.permanentMapEffects[1],0).blank===true,
      'blank MAPEFFECT timing slot was not preserved at the first beat');
    assertState(originalMapEffectResource(layer,layer.permanentMapEffects[1],150)===resources[2],
      'blank MAPEFFECT sequence did not advance to its second frame');

    var mapPixelX=92,mapPixelY=68,effectPixelX=132,effectPixelY=76;
    drawOriginalMap(0,0);
    var mapFirst=pixelAt(mapPixelX,mapPixelY),effectFirst=pixelAt(effectPixelX,effectPixelY);
    var unshiftedEffectPixel=pixelAt(118,86),baseCanvas=state.original.baseCanvas;
    drawOriginalMap(1,149);
    var mapHeld=pixelAt(mapPixelX,mapPixelY),effectHeld=pixelAt(effectPixelX,effectPixelY);
    drawOriginalMap(1,150);
    var effectSecond=pixelAt(effectPixelX,effectPixelY);
    drawOriginalMap(2,200);
    var mapSecond=pixelAt(mapPixelX,mapPixelY);
    drawOriginalMap(3,300);
    var effectWrapped=pixelAt(effectPixelX,effectPixelY);
    drawOriginalMap(4,400);
    var mapWrapped=pixelAt(mapPixelX,mapPixelY);
    if(!isRed(mapFirst)||!isRed(mapHeld)||!isGreen(mapSecond)||!isRed(mapWrapped)||
      !isBlue(effectFirst)||!isBlue(effectHeld)||!isYellow(effectSecond)||!isBlue(effectWrapped)||
      !isCanvasBackground(unshiftedEffectPixel)){
      throw new Error('unexpected deterministic MAP/MAPEFFECT frames or placement: '+JSON.stringify({
        mapFirst:mapFirst,mapHeld:mapHeld,mapSecond:mapSecond,mapWrapped:mapWrapped,
        effectFirst:effectFirst,effectHeld:effectHeld,effectSecond:effectSecond,
        effectWrapped:effectWrapped,unshiftedEffectPixel:unshiftedEffectPixel,
        intervals:layer.animationIntervalsMs
      }));
    }

    state.original.animationStartedAt=performance.now();
    renderOriginalMapAnimationFrame();
    var liveMapFirst=pixelAt(mapPixelX,mapPixelY),liveEffectFirst=pixelAt(effectPixelX,effectPixelY);
    scheduleOriginalMapAnimation();
    var timerBeforeStaleError=state.original.animationTimer;
    window.dispatchEvent(new MessageEvent('message',{data:{
      type:'originalMapError',requestId:41,message:'stale request must be ignored'
    }}));
    assertState(state.original.ready&&state.original.layer===layer,'stale originalMapError replaced the current layer');
    assertState(state.original.warning==='current request intact','stale originalMapError replaced the current warning');
    assertState(state.original.animationTimer===timerBeforeStaleError,'stale originalMapError stopped the current scheduler');
    assertState(state.original.baseCanvas===baseCanvas,'stale originalMapError released the current background canvas');
    assertState(state.original.permanentMapEffectCount===2,
      'stale originalMapError changed the permanent MAPEFFECT count');
    var liveEffectSecond=await waitForPixelChange(effectPixelX,effectPixelY,liveEffectFirst,400);
    assertState(isBlue(liveEffectFirst)&&isYellow(liveEffectSecond),
      'the live 150ms MAPEFFECT did not advance from blue to yellow');
    var liveMapSecond=await waitForPixelChange(mapPixelX,mapPixelY,liveMapFirst,400);
    assertState(isRed(liveMapFirst)&&isGreen(liveMapSecond),
      'the live 200ms MAP Object did not advance from red to green');
    if(state.original.baseCanvas!==baseCanvas)throw new Error('static background canvas was rebuilt during ticks');
    if(!state.original.animationTimer)throw new Error('animation scheduler stopped unexpectedly');
    assertState(activeAnimationTimers.size===1,'animation must have exactly one pending scheduler');

    var beforeHidden=pixelAt(effectPixelX,effectPixelY),scheduledBeforeHidden=scheduledAnimationTimers;
    setPageHidden(true);
    assertState(state.original.animationTimer===0&&activeAnimationTimers.size===0,'hidden page did not stop the scheduler');
    await wait(260);
    var afterHidden=pixelAt(effectPixelX,effectPixelY);
    assertState(samePixel(beforeHidden,afterHidden),'hidden page continued changing the canvas');
    assertState(scheduledAnimationTimers===scheduledBeforeHidden,'hidden page scheduled another animation timer');
    setPageHidden(false);
    assertState(state.original.animationTimer!==0&&activeAnimationTimers.size===1,'visible page did not restore one scheduler');
    var resumedFrom=pixelAt(effectPixelX,effectPixelY);
    var resumedTo=await waitForPixelChange(effectPixelX,effectPixelY,resumedFrom,500);
    assertState(activeAnimationTimers.size===1,'visible page restored duplicate schedulers');

    var scheduledBeforePreview=scheduledAnimationTimers;
    switchToPreviewMap();
    assertState(!state.original.active&&state.original.animationTimer===0,'preview switch did not stop animation');
    assertState(activeAnimationTimers.size===0,'preview switch left an orphan animation timer');
    assertState(state.original.baseCanvas===null&&state.original.baseContext===null,'preview switch did not release the static canvas');
    await wait(260);
    assertState(scheduledAnimationTimers===scheduledBeforePreview,'old timer restarted after switching to preview');

    switchToOriginalMap();
    assertState(state.original.active&&state.original.animationTimer!==0,'cached original map did not restart animation');
    assertState(activeAnimationTimers.size===1,'cached original map started duplicate schedulers');
    var requestBeforeMapChange=state.original.requestId;
    var scheduledBeforeMapChange=scheduledAnimationTimers;
    updateMap({
      map:{key:'map-2',mapId:'map-2',originalMapId:'map-2',name:'map-2',width:4,height:4},
      maps:[],markers:[],npcs:[],spawns:[],safeZones:[],merchantColumns:[],monGenColumns:[],
      engine:'GOM',entityWarnings:[],markerFile:'',warning:'',imageUrl:''
    });
    assertState(state.original.requestId===requestBeforeMapChange+1,'map change did not invalidate the old request id');
    assertState(!state.original.active&&state.original.animationTimer===0,'map change did not stop animation');
    assertState(state.original.permanentMapEffectCount===0,'map change did not clear the permanent MAPEFFECT count');
    assertState(activeAnimationTimers.size===0,'map change left an orphan animation timer');
    assertState(state.original.baseCanvas===null&&state.original.baseContext===null,'map change did not release the static canvas');
    await wait(260);
    assertState(scheduledAnimationTimers===scheduledBeforeMapChange,'old timer restarted after changing maps');
    assertState(maxActiveAnimationTimers===1,'more than one map animation timer was pending');

    document.body.dataset.mapAnimationFrames=JSON.stringify({
      map:{first:mapFirst,held:mapHeld,second:mapSecond,wrapped:mapWrapped},
      mapEffect:{first:effectFirst,held:effectHeld,second:effectSecond,wrapped:effectWrapped},
      live:{mapFirst:liveMapFirst,mapSecond:liveMapSecond,effectFirst:liveEffectFirst,effectSecond:liveEffectSecond},
      intervals:layer.animationIntervalsMs,blankReady:layer.permanentMapEffectSetReady[1],
      unshiftedEffectPixel:unshiftedEffectPixel
    });
    document.body.dataset.mapAnimationLifecycle=JSON.stringify({
      hiddenBefore:beforeHidden,hiddenAfter:afterHidden,resumedFrom:resumedFrom,resumedTo:resumedTo,
      scheduled:scheduledAnimationTimers,maxActive:maxActiveAnimationTimers
    });
    document.body.dataset.mapAnimationTest='pass';
  }catch(error){
    stopOriginalMapAnimation();
    document.body.dataset.mapAnimationTest='fail';
    document.body.dataset.mapAnimationErrors=error&&error.stack?error.stack:String(error);
  }
}());
</script>`;
}

function main() {
  const candidates = browserCandidates();
  assert.ok(candidates.length > 0, 'no installed Chromium browser was found');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-animation-browser-'));
  try {
    const harness = path.join(temporary, 'map-animation.html');
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
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--no-first-run',
        '--allow-file-access-from-files',
        '--force-device-scale-factor=1',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1200,800',
        '--virtual-time-budget=5000',
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
        && /data-map-animation-test=/i.test(result.stdout || '')) {
        selected = { candidate: candidates[index], result };
        break;
      }
    }
    assert.ok(
      selected,
      `no installed browser completed the map animation scenario:\n${attempts.map(
        ({ candidate, result }) => diagnostic(candidate, result)
      ).join('\n')}`
    );
    const encodedError = /data-map-animation-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    assert.match(
      selected.result.stdout,
      /data-map-animation-test="pass"/,
      decodeAttribute(encodedError) || 'browser map animation scenario failed'
    );
    const frames = /data-map-animation-frames="([^"]*)"/.exec(selected.result.stdout)?.[1] || '<missing>';
    const lifecycle = /data-map-animation-lifecycle="([^"]*)"/.exec(selected.result.stdout)?.[1] || '<missing>';
    console.log(`map-animation-browser.test.js: browser=${selected.candidate}`);
    console.log(`map-animation-browser.test.js: frames=${decodeAttribute(frames)}`);
    console.log(`map-animation-browser.test.js: lifecycle=${decodeAttribute(lifecycle)}`);
  } finally {
    removeTemporaryDirectory(temporary);
  }
  console.log('map-animation-browser.test.js: PASS');
}

main();
