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
  var results={};
  var nativeToBlob=HTMLCanvasElement.prototype.toBlob;
  var nativeDrawImage=CanvasRenderingContext2D.prototype.drawImage;
  function check(value,message){if(!value)throw new Error(message)}
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms)})}
  async function waitFor(predicate,message,timeout){
    var started=performance.now(),limit=timeout||2000;
    while(performance.now()-started<limit){if(predicate())return;await wait(10)}
    throw new Error(message);
  }
  function solidPng(colour,width,height){
    var source=document.createElement('canvas');source.width=width;source.height=height;
    var target=source.getContext('2d');target.fillStyle=colour;target.fillRect(0,0,width,height);
    return source.toDataURL('image/png');
  }
  function loadImage(url){
    return new Promise(function(resolve,reject){
      var image=new Image();image.onload=function(){resolve(image)};image.onerror=reject;image.src=url;
    });
  }
  function pixel(target,x,y){return Array.from(target.getImageData(x,y,1,1).data)}
  function samePixel(actual,expected){
    return actual.length===expected.length&&actual.every(function(value,index){return value===expected[index]});
  }
  function expectPixel(target,x,y,expected,label){
    var actual=pixel(target,x,y);
    check(samePixel(actual,expected),label+' pixel mismatch: '+JSON.stringify({actual:actual,expected:expected,x:x,y:y}));
    return actual;
  }
  function staticChunk(chunkId,cached,url){
    return{chunkId:chunkId,column:0,row:0,worldX:0,worldY:0,width:96,height:64,
      cached:cached===true,url:url||''};
  }
  function baseData(cacheKey,viewportSeq){
    return{
      type:'originalMapViewportData',requestId:700,generation:7,viewportSeq:viewportSeq,
      viewport:{left:0,top:0,right:1,bottom:1},prefetch:false,
      staticCacheEnabled:true,staticCacheKey:cacheKey,staticSourceIncluded:true,
      resources:[],tiles:[],smTiles:[],objects:[],objectAnimationFrames:[],objectAnimationTicks:[],
      objectAnimationSetIds:[],objectAnimationSets:[],permanentMapEffects:[],permanentMapEffectSets:[],
      animatedObjectCount:0,permanentMapEffectCount:0,warning:''
    };
  }
  function resetOriginal(viewportSeq){
    stopOriginalMapAnimation();releaseOriginalMapBase();clearOriginalImageCache();clearOriginalStaticChunkCache();
    state.map={width:2,height:2};state.worldW=96;state.worldH=64;state.scale=1;state.offsetX=0;state.offsetY=0;
    state.original.active=true;state.original.ready=false;state.original.requestId=700;
    state.original.generation=7;state.original.viewportSeq=viewportSeq;
    state.original.layer=null;state.original.animationStartedAt=performance.now();
  }
  function dummyRecord(key,estimatedBytes){
    return{key:key,generation:7,chunkId:key,worldX:0,worldY:0,width:1,height:1,
      drawable:null,image:null,canvas:null,promise:Promise.resolve(null),resolve:null,
      failed:false,disposed:false,estimatedBytes:estimatedBytes};
  }
  async function releaseDelayedBlob(item){
    await new Promise(function(resolve){
      nativeToBlob.call(item.canvas,function(blob){item.callback(blob);resolve()},item.type||'image/png');
    });
    await wait(25);
  }
  try{
    resetOriginal(11);
    var miss=baseData('miss-cache-key',11);
    miss.staticChunks=[staticChunk('c0-r0',false,'')];
    miss.resources=[
      {key:'tiles:1',width:48,height:32,offsetX:0,offsetY:0,url:solidPng('#ff0000',48,32)},
      {key:'smtiles:2',width:16,height:16,offsetX:0,offsetY:0,url:solidPng('#0000ff',16,16)},
      {key:'objects:3',width:8,height:8,offsetX:0,offsetY:0,url:solidPng('#00ff00',8,8)}
    ];
    miss.tiles=[0,0,0];miss.smTiles=[1,0,1];miss.objects=[0,1,2];
    miss.objectAnimationFrames=[0];miss.objectAnimationTicks=[0];miss.objectAnimationSetIds=[-1];
    await loadOriginalMapData(miss,false);
    await waitFor(function(){return window.__tilePosted.some(function(item){
      return item.type==='storeOriginalMapTile'&&item.cacheKey==='miss-cache-key';
    })},'cache miss did not post storeOriginalMapTile',2500);
    var upload=window.__tilePosted.find(function(item){
      return item.type==='storeOriginalMapTile'&&item.cacheKey==='miss-cache-key';
    });
    check(upload.requestId===700&&upload.generation===7&&upload.viewportSeq===11&&upload.chunkId==='c0-r0',
      'cache miss upload lost protocol identity: '+JSON.stringify(upload));
    check(/^data:image\\/png;base64,/.test(upload.pngDataUrl),'cache miss upload was not a PNG data URL');
    var bakedImage=await loadImage(upload.pngDataUrl),baked=document.createElement('canvas');
    baked.width=bakedImage.naturalWidth;baked.height=bakedImage.naturalHeight;
    var bakedContext=baked.getContext('2d');bakedContext.drawImage(bakedImage,0,0);
    var bakedPixels={
      tile:expectPixel(bakedContext,10,10,[255,0,0,255],'baked tile'),
      smTile:expectPixel(bakedContext,55,10,[0,0,255,255],'baked smTile'),
      objectSite:expectPixel(bakedContext,2,58,[0,0,0,0],'object excluded from baked chunk'),
      transparent:expectPixel(bakedContext,90,50,[0,0,0,0],'uncovered chunk area')
    };
    check(baked.width===96&&baked.height===64,'baked chunk dimensions changed');
    check(state.original.layer&&state.original.layer.usesStaticChunks&&state.original.layer.staticChunks.length===1,
      'cache miss did not install the composed static chunk layer');

    var rawDraws=0,chunkDraws=0,missLayer=state.original.layer;
    CanvasRenderingContext2D.prototype.drawImage=function(){
      var source=arguments[0];
      if(source===missLayer.resources[0].image||source===missLayer.resources[1].image)rawDraws++;
      if(source===missLayer.staticChunks[0].record.drawable)chunkDraws++;
      return nativeDrawImage.apply(this,arguments);
    };
    releaseOriginalMapBase();drawOriginalMap(0,0);
    CanvasRenderingContext2D.prototype.drawImage=nativeDrawImage;
    var objectPixel=expectPixel(ctx,2,58,[0,255,0,255],'dynamic object over composed chunk');
    check(rawDraws===0&&chunkDraws===1,
      'static chunk layer redrew raw Tiles/SmTiles: '+JSON.stringify({rawDraws:rawDraws,chunkDraws:chunkDraws}));
    results.miss={upload:{requestId:upload.requestId,generation:upload.generation,viewportSeq:upload.viewportSeq,
      cacheKey:upload.cacheKey,chunkId:upload.chunkId},pixels:bakedPixels,objectPixel:objectPixel,
      rawDraws:rawDraws,chunkDraws:chunkDraws};

    state.original.viewportSeq=12;state.original.ready=true;
    var cached=baseData('cached-cache-key',12);
    cached.staticSourceIncluded=false;
    cached.staticChunks=[staticChunk('c0-r0',true,solidPng('#800080',96,64))];
    cached.resources=[
      {key:'objects:4',width:8,height:8,offsetX:0,offsetY:0,url:solidPng('#00ff00',8,8)},
      {key:'mapeffect:5',width:8,height:8,offsetX:0,offsetY:0,url:solidPng('#ffff00',8,8)}
    ];
    cached.objects=[0,1,0];cached.objectAnimationFrames=[0];cached.objectAnimationTicks=[0];
    cached.objectAnimationSetIds=[-1];cached.permanentMapEffects=[{x:1,y:1,speedMs:100,drawMode:0,frameSetId:0}];
    cached.permanentMapEffectSets=[[1]];
    await loadOriginalMapData(cached,false);
    check(state.original.layer&&state.original.layer.usesStaticChunks&&state.original.layer.staticChunks.length===1,
      'cached=true chunk was not retained when tiles/smTiles were empty');
    check(state.original.layer.tiles.length===0&&state.original.layer.smTiles.length===0,
      'cached fast path unexpectedly required raw static placements');
    releaseOriginalMapBase();drawOriginalMap(0,0);
    var cachedPixels={
      chunk:expectPixel(ctx,90,50,[128,0,128,255],'cached static chunk'),
      object:expectPixel(ctx,2,58,[0,255,0,255],'cached path object'),
      mapEffect:expectPixel(ctx,50,34,[255,255,0,255],'cached path MAPEFFECT')
    };
    check(!window.__tilePosted.some(function(item){
      return item.type==='storeOriginalMapTile'&&item.cacheKey==='cached-cache-key';
    }),'cached=true chunk was uploaded again');
    results.cached={pixels:cachedPixels,tiles:state.original.layer.tiles.length,
      smTiles:state.original.layer.smTiles.length,objects:state.original.layer.objects.length,
      mapEffects:state.original.layer.permanentMapEffects.length};

    stopOriginalMapAnimation();releaseOriginalMapBase();clearOriginalStaticChunkCache();
    check(ORIGINAL_STATIC_CHUNK_CACHE_ENTRY_LIMIT===96,'static chunk entry limit is not 96');
    check(ORIGINAL_STATIC_CHUNK_CACHE_BYTE_LIMIT===128*1024*1024,'static chunk byte limit is not 128 MiB');
    for(var index=0;index<96;index++){
      var key='entry-'+index,record=dummyRecord(key,4);
      state.original.staticChunkCache.set(key,record);state.original.staticChunkCacheBytes+=record.estimatedBytes;
    }
    state.original.layer={staticChunkKeys:['entry-0']};
    check(cachedOriginalStaticChunk('entry-1')!==null,'LRU touch failed');
    check(reserveOriginalStaticChunkCache(4),'96-entry cache could not reserve after eviction');
    check(state.original.staticChunkCache.has('entry-0'),'entry-limit eviction removed the current layer');
    check(state.original.staticChunkCache.has('entry-1'),'LRU touch did not retain the recently used chunk');
    check(!state.original.staticChunkCache.has('entry-2'),'entry-limit eviction did not remove the oldest unprotected chunk');
    var entryNew=dummyRecord('entry-new',4);state.original.staticChunkCache.set(entryNew.key,entryNew);
    state.original.staticChunkCacheBytes+=entryNew.estimatedBytes;
    check(state.original.staticChunkCache.size===96,'entry-limit reservation did not restore exactly 96 entries');

    clearOriginalStaticChunkCache();
    var sixtyFourMiB=64*1024*1024;
    var byteCurrent=dummyRecord('byte-current',sixtyFourMiB),byteOld=dummyRecord('byte-old',sixtyFourMiB);
    state.original.staticChunkCache.set(byteCurrent.key,byteCurrent);
    state.original.staticChunkCache.set(byteOld.key,byteOld);
    state.original.staticChunkCacheBytes=128*1024*1024;
    state.original.layer={staticChunkKeys:['byte-current']};
    check(reserveOriginalStaticChunkCache(1024*1024),'128 MiB cache could not reserve after eviction');
    check(state.original.staticChunkCache.has('byte-current'),'byte-limit eviction removed the current layer');
    check(!state.original.staticChunkCache.has('byte-old'),'byte-limit eviction did not remove the old unprotected chunk');
    var byteNew=dummyRecord('byte-new',1024*1024);state.original.staticChunkCache.set(byteNew.key,byteNew);
    state.original.staticChunkCacheBytes+=byteNew.estimatedBytes;
    check(state.original.staticChunkCacheBytes===65*1024*1024,'byte-limit accounting drifted after eviction');
    results.lru={entryLimit:ORIGINAL_STATIC_CHUNK_CACHE_ENTRY_LIMIT,
      byteLimit:ORIGINAL_STATIC_CHUNK_CACHE_BYTE_LIMIT,entries:96,
      protectedEntry:state.original.staticChunkCache.has('byte-current'),bytesAfterEviction:state.original.staticChunkCacheBytes};

    clearOriginalStaticChunkCache();state.original.layer=null;
    var delayed=[];
    HTMLCanvasElement.prototype.toBlob=function(callback,type){delayed.push({canvas:this,callback:callback,type:type})};
    var directSource=document.createElement('canvas');directSource.width=8;directSource.height=8;
    directSource.getContext('2d').fillRect(0,0,8,8);
    Object.defineProperty(directSource,'complete',{configurable:true,value:true});
    var directLoaded=[{meta:{width:8,height:8,offsetX:0,offsetY:0},image:directSource,blank:false,failed:false}];
    var directMetas=[directLoaded[0].meta];
    async function staleUpload(kind,generation,viewportSeq){
      state.original.active=true;state.original.requestId=900;state.original.generation=generation;
      state.original.viewportSeq=viewportSeq;state.original.layer=null;
      var staleData=baseData('stale-'+kind,viewportSeq);
      staleData.requestId=900;staleData.generation=generation;staleData.tiles=[0,0,0];
      var currentRequest=function(){return state.original.active&&state.original.requestId===staleData.requestId&&
        state.original.generation===staleData.generation&&state.original.viewportSeq===staleData.viewportSeq};
      var before=delayed.length;
      composeOriginalStaticChunk(staleData,staticChunk('c0-r0',false,''),directLoaded,directMetas,
        originalStaticChunkCacheKey(generation,staleData.staticCacheKey,'c0-r0'),currentRequest);
      check(delayed.length===before+1,'stale '+kind+' scenario did not reach asynchronous PNG encoding');
      if(kind==='generation')state.original.generation=generation+1;
      else state.original.viewportSeq=viewportSeq+1;
      await releaseDelayedBlob(delayed[before]);
      check(!window.__tilePosted.some(function(item){
        return item.type==='storeOriginalMapTile'&&item.cacheKey===staleData.staticCacheKey;
      }),'stale '+kind+' upload posted after identity changed');
    }
    await staleUpload('viewportSeq',30,40);
    await staleUpload('generation',50,60);
    results.stale={delayedEncodes:delayed.length,posted:window.__tilePosted.filter(function(item){
      return item.type==='storeOriginalMapTile'&&/^stale-/.test(String(item.cacheKey||''));
    }).length};

    document.body.dataset.originalMapTileResults=JSON.stringify(results);
    document.body.dataset.originalMapTileTest='pass';
  }catch(error){
    document.body.dataset.originalMapTileTest='fail';
    document.body.dataset.originalMapTileErrors=error&&error.stack?error.stack:String(error);
  }finally{
    HTMLCanvasElement.prototype.toBlob=nativeToBlob;
    CanvasRenderingContext2D.prototype.drawImage=nativeDrawImage;
    try{stopOriginalMapAnimation()}catch{}
  }
}());
</script>`;
}

function main() {
  const candidates = browserCandidates();
  assert.ok(candidates.length > 0, 'no installed Chromium browser was found');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-original-map-tile-browser-'));
  try {
    const harness = path.join(temporary, 'original-map-tile.html');
    let html = fs.readFileSync(path.join(root, 'media', 'map-preview.html'), 'utf8');
    html = html.replace(
      '<script>',
      '<script>window.__tilePosted=[];window.acquireVsCodeApi=function(){return{postMessage:function(message){window.__tilePosted.push(message)}}};'
        + 'window.addEventListener("error",function(event){setTimeout(function(){if(document.body){document.body.dataset.originalMapTileTest="fail";document.body.dataset.originalMapTileErrors=event.error&&event.error.stack?event.error.stack:String(event.message||event.error)}},0)});'
        + 'window.addEventListener("unhandledrejection",function(event){setTimeout(function(){if(document.body){var reason=event.reason;document.body.dataset.originalMapTileTest="fail";document.body.dataset.originalMapTileErrors=reason&&reason.stack?reason.stack:String(reason)}},0)});'
        + '</script><script>'
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
        '--virtual-time-budget=6500',
        '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8',
        timeout: 25000,
        maxBuffer: 8 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-original-map-tile-test=/i.test(result.stdout || '')) {
        selected = { candidate: candidates[index], result };
        break;
      }
    }
    assert.ok(
      selected,
      `no installed browser completed the original map tile scenario:\n${attempts.map(
        ({ candidate, result }) => diagnostic(candidate, result)
      ).join('\n')}`
    );
    const encodedError = /data-original-map-tile-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    assert.match(
      selected.result.stdout,
      /data-original-map-tile-test="pass"/,
      decodeAttribute(encodedError) || 'browser original map tile scenario failed'
    );
    const encodedResults = /data-original-map-tile-results="([^"]*)"/.exec(selected.result.stdout)?.[1];
    assert.ok(encodedResults, 'browser scenario did not expose original-map tile results');
    const results = JSON.parse(decodeAttribute(encodedResults));
    assert.deepEqual(results.miss.pixels.transparent, [0, 0, 0, 0]);
    assert.equal(results.miss.rawDraws, 0);
    assert.equal(results.miss.chunkDraws, 1);
    assert.deepEqual(results.cached.pixels.object, [0, 255, 0, 255]);
    assert.deepEqual(results.cached.pixels.mapEffect, [255, 255, 0, 255]);
    assert.equal(results.lru.entryLimit, 96);
    assert.equal(results.lru.byteLimit, 128 * 1024 * 1024);
    assert.equal(results.stale.posted, 0);
    console.log(`original-map-tile-browser.test.js: browser=${selected.candidate}`);
    console.log(`original-map-tile-browser.test.js: results=${JSON.stringify(results)}`);
  } finally {
    removeTemporaryDirectory(temporary);
  }
  console.log('original-map-tile-browser.test.js: PASS');
}

main();
