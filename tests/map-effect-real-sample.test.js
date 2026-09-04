const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');
const defaultMirServerRoot = 'D:\\MirServer';

function skip(reason) {
  console.log(`map-effect-real-sample.test.js: SKIP - ${reason}`);
}

function normalizeArchiveName(value) {
  const text = String(value || '');
  return path.basename(text, path.extname(text)).toLocaleLowerCase('zh-CN');
}

function browserCandidates() {
  return [...new Set([
    process.env.BOO_BROWSER_EXECUTABLE,
    process.env.BOO_TEST_EDGE_EXECUTABLE,
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]
    .filter(candidate => candidate && fs.existsSync(candidate))
    .map(candidate => path.resolve(candidate)))];
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

function browserScenario(sample) {
  const serialized = JSON.stringify(sample).replace(/</g, '\\u003c');
  return `<script>
(async function(){
  var sample=${serialized};
  var nativeSetTimeout=window.setTimeout.bind(window);
  var nativeClearTimeout=window.clearTimeout.bind(window);
  var activeAnimationTimers=new Set();
  var scheduledAnimationTimers=0;
  var maxActiveAnimationTimers=0;
  window.setTimeout=function(callback,delay){
    var tracked=String(callback).indexOf('renderOriginalMapAnimationFrame')>=0&&
      String(callback).indexOf('scheduleOriginalMapAnimation')>=0;
    var args=Array.prototype.slice.call(arguments,2),timer=0;
    timer=nativeSetTimeout(function(){
      if(tracked)activeAnimationTimers.delete(timer);
      callback.apply(window,args);
    },delay);
    if(tracked){
      activeAnimationTimers.add(timer);
      scheduledAnimationTimers++;
      maxActiveAnimationTimers=Math.max(maxActiveAnimationTimers,activeAnimationTimers.size);
    }
    return timer;
  };
  window.clearTimeout=function(timer){
    activeAnimationTimers.delete(timer);
    return nativeClearTimeout(timer);
  };
  function wait(ms){return new Promise(function(resolve){nativeSetTimeout(resolve,ms)})}
  function assertState(value,message){if(!value)throw new Error(message)}
  function loadImage(frame){
    return new Promise(function(resolve,reject){
      var image=new Image();
      image.onload=function(){
        if(image.naturalWidth!==frame.width||image.naturalHeight!==frame.height){
          reject(new Error('decoded PNG dimensions changed for slot '+frame.imageIndex));return;
        }
        resolve(image);
      };
      image.onerror=function(){reject(new Error('real PNG failed to load for slot '+frame.imageIndex))};
      image.src=frame.url;
    });
  }
  function regionSnapshot(region){
    var left=Math.max(0,Math.floor(region.left));
    var top=Math.max(0,Math.floor(region.top));
    var right=Math.min(canvas.width,Math.ceil(region.right));
    var bottom=Math.min(canvas.height,Math.ceil(region.bottom));
    assertState(right>left&&bottom>top,'expected MAPEFFECT bounds are outside the real Canvas');
    var pixels=ctx.getImageData(left,top,right-left,bottom-top).data;
    var hash=2166136261,nonBackground=0;
    for(var index=0;index<pixels.length;index+=4){
      if(pixels[index]!==17||pixels[index+1]!==17||pixels[index+2]!==17||pixels[index+3]!==255){
        nonBackground++;
      }
      hash=Math.imul(hash^pixels[index],16777619);
      hash=Math.imul(hash^pixels[index+1],16777619);
      hash=Math.imul(hash^pixels[index+2],16777619);
      hash=Math.imul(hash^pixels[index+3],16777619);
    }
    return{hash:hash>>>0,nonBackground:nonBackground,left:left,top:top,right:right,bottom:bottom};
  }
  try{
    resize();
    var images=await Promise.all(sample.frames.map(loadImage));
    var resources=sample.frames.map(function(frame,index){
      return{
        meta:{
          key:'mapeffect:'+frame.imageIndex,
          width:frame.width,height:frame.height,
          offsetX:frame.offsetX,offsetY:frame.offsetY,url:frame.url
        },
        image:images[index],blank:false,failed:false
      };
    });
    var frameIds=resources.map(function(_,index){return index});
    var effect={
      x:sample.effect.x,y:sample.effect.y,speedMs:sample.effect.speedMs,
      drawMode:sample.effect.drawMode,frameSetId:0
    };
    var layer={
      resources:resources,tiles:[],smTiles:[],objects:[],
      objectAnimationFrames:[],objectAnimationTicks:[],objectAnimationSetIds:[],objectAnimationSets:[],
      permanentMapEffects:[effect],permanentMapEffectSets:[frameIds]
    };
    layer.objectRowRanges=originalMapObjectRowRanges(layer.objects);
    state.map={width:sample.map.width,height:sample.map.height};
    state.worldW=sample.map.width*48;state.worldH=sample.map.height*32;
    state.scale=1;
    var worldLeft=Math.min.apply(null,sample.frames.map(function(frame){
      return sample.effect.x*48+frame.offsetX;
    }));
    var worldTop=Math.min.apply(null,sample.frames.map(function(frame){
      return sample.effect.y*32+frame.offsetY;
    }));
    var worldRight=Math.max.apply(null,sample.frames.map(function(frame){
      return sample.effect.x*48+frame.offsetX+frame.width;
    }));
    var worldBottom=Math.max.apply(null,sample.frames.map(function(frame){
      return sample.effect.y*32+frame.offsetY+frame.height;
    }));
    state.offsetX=160-worldLeft;state.offsetY=160-worldTop;
    var expectedRegion={
      left:state.offsetX+worldLeft,top:state.offsetY+worldTop,
      right:state.offsetX+worldRight,bottom:state.offsetY+worldBottom
    };
    state.original.active=true;state.original.ready=true;state.original.layer=layer;
    state.original.baseLayer=null;state.original.animationStartedAt=performance.now();
    refreshOriginalMapAnimationState(layer);
    assertState(state.original.permanentMapEffectCount===1,
      'expected exactly one injected permanent MAPEFFECT');
    assertState(JSON.stringify(layer.animationIntervalsMs)===JSON.stringify([150]),
      'real MAPEFFECT interval must be exactly [150]');
    assertState(layer.permanentMapEffectSetReady[0]===true,
      'real 360..369 MAPEFFECT sequence is not ready');

    drawOriginalMap(0,0);
    var first=regionSnapshot(expectedRegion);
    drawOriginalMap(1,150);
    var second=regionSnapshot(expectedRegion);
    drawOriginalMap(15,1500);
    var wrapped=regionSnapshot(expectedRegion);
    assertState(first.nonBackground>0&&second.nonBackground>0&&wrapped.nonBackground>0,
      'expected MAPEFFECT bounds contain only #111 Canvas background');
    assertState(first.hash!==second.hash,
      'real Canvas did not change between 0ms slot 360 and 150ms slot 361');
    assertState(first.hash===wrapped.hash,
      'real Canvas did not return to slot 360 at the 1500ms cycle boundary');

    state.original.animationStartedAt=performance.now();
    renderOriginalMapAnimationFrame();
    scheduleOriginalMapAnimation();
    assertState(state.original.animationTimer!==0&&activeAnimationTimers.size===1,
      'scheduler did not create exactly one pending timer');
    await wait(475);
    assertState(maxActiveAnimationTimers<=1&&activeAnimationTimers.size===1,
      'more than one MAPEFFECT scheduler timer was pending');
    stopOriginalMapAnimation();
    assertState(activeAnimationTimers.size===0,'scheduler timer was not cleared');

    document.body.dataset.mapEffectRealSampleResult=JSON.stringify({
      map:sample.map,effect:sample.effect,archive:sample.archive,
      slots:sample.frames.map(function(frame){return frame.imageIndex}),
      hashes:{at0:first.hash,at150:second.hash,at1500:wrapped.hash},
      nonBackground:first.nonBackground,count:state.original.permanentMapEffectCount,
      intervals:layer.animationIntervalsMs,scheduled:scheduledAnimationTimers,
      maxActive:maxActiveAnimationTimers,region:expectedRegion
    });
    document.body.dataset.mapEffectRealSample='pass';
  }catch(error){
    stopOriginalMapAnimation();
    document.body.dataset.mapEffectRealSample='fail';
    document.body.dataset.mapEffectRealSampleErrors=error&&error.stack?error.stack:String(error);
  }
}());
</script>`;
}

async function main() {
  const mirServerRoot = path.resolve(process.env.BOO_TEST_MIRSERVER || defaultMirServerRoot);
  const envirDirectory = path.join(mirServerRoot, 'Mir200', 'Envir');
  const mapPath = path.resolve(
    process.env.BOO_TEST_MAP_EFFECT_MAP_PATH
      || process.env.BOO_TEST_MAP_PATH
      || path.join(mirServerRoot, 'Mir200', 'Map', 'boo_钓鱼台.map')
  );
  const cacheRoot = path.resolve(
    process.env.BOO_TEST_PATCH_CACHE_ROOT
      || path.join(
        process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
        'BOO-NGOM-Editor',
        'cache',
        'patch-cache'
      )
  );
  const viewerPath = path.join(root, 'media', 'map-preview.html');
  const candidates = browserCandidates();

  if (!fs.existsSync(mirServerRoot)) return skip(`MirServer 不存在: ${mirServerRoot}`);
  if (!fs.existsSync(envirDirectory)) return skip(`Envir 不存在: ${envirDirectory}`);
  if (!fs.existsSync(mapPath)) return skip(`真实 MAP 不存在: ${mapPath}`);
  if (!fs.existsSync(cacheRoot)) return skip(`BOO 素材缓存不存在: ${cacheRoot}`);
  if (!candidates.length) return skip('未找到真实 Chromium 浏览器（Edge / Chrome）');

  const { scanStartupPermanentMapEffects } = require('../out/utils/map-effects');
  const { parseOriginalMap } = require('../out/utils/original-map');
  const { loadPakIndex } = require('../out/utils/pak');
  const { selectCustomNpcArchive } = require('../out/utils/map-entities');
  const {
    isPatchCacheCurrent,
    listCachedPatchPaks,
    loadCachedPatchAssetTable,
  } = require('../out/utils/patch-cache');
  const { readArchiveImagePng } = require('../out/utils/archive-index');

  const scan = scanStartupPermanentMapEffects(envirDirectory);
  assert.equal(scan.truncated, false, 'real startup MAPEFFECT scan was truncated');
  const canonical = scan.definitions.find(effect => (
    effect.mapName === '钓鱼台'
    && effect.x === 29
    && effect.y === 35
    && effect.wilIndex === 9
    && effect.startImage === 360
    && effect.frameCount === 10
    && effect.playCount === -1
    && effect.speedMs === 150
    && effect.drawMode === 0
    && effect.brightness === 0
    && effect.visibility === 0
  ));
  assert.ok(canonical, 'scanStartupPermanentMapEffects did not return the canonical 钓鱼台 360..369 definition');

  const model = await parseOriginalMap(fs.readFileSync(mapPath));
  assert.ok(
    canonical.x >= 0 && canonical.y >= 0
      && canonical.x < model.width && canonical.y < model.height,
    `canonical MAPEFFECT (${canonical.x},${canonical.y}) is outside ${model.width}x${model.height}`
  );

  const pakIndex = loadPakIndex(mirServerRoot);
  assert.ok(pakIndex, 'EffectImageList.txt could not be loaded from the real MirServer');
  const configured = pakIndex.pakList.find(entry => entry.willIdx === canonical.wilIndex);
  assert.deepEqual(
    configured,
    { name: '技能特效', willIdx: 9, extension: 'pak' },
    'EffectImageList WIL 9 no longer maps strictly to 技能特效.Pak'
  );

  const expectedName = normalizeArchiveName(configured.name);
  const matchingArchives = listCachedPatchPaks(cacheRoot)
    .filter(item => normalizeArchiveName(item.pakName) === expectedName)
    .filter(item => item.storedWillIdx === canonical.wilIndex)
    .filter(item => item.format === 'GOM' && item.storageMode === 'direct' && item.archiveId)
    .filter(isPatchCacheCurrent);
  if (!matchingArchives.length) {
    return skip('未找到名称=技能特效、storedWillIdx=9 的当前 GOM/direct 归档缓存');
  }
  assert.equal(
    matchingArchives.length,
    1,
    '名称=技能特效、storedWillIdx=9 的当前 GOM/direct 归档缓存不唯一'
  );
  const selected = selectCustomNpcArchive(
    canonical.wilIndex,
    pakIndex.pakList,
    matchingArchives
  );
  assert.equal(selected.expectedPakName, '技能特效');
  assert.equal(selected.archive, matchingArchives[0]);
  const archive = selected.archive;
  assert.equal(archive.pakName, '技能特效');
  assert.equal(archive.storedWillIdx, 9);
  assert.ok(archive.archiveId);

  const table = loadCachedPatchAssetTable(archive);
  const indexRoot = path.dirname(archive.cacheDir);
  assert.equal(path.basename(indexRoot).toLowerCase(), 'archive-index-v1');
  const frames = [];
  for (let imageIndex = canonical.startImage;
    imageIndex < canonical.startImage + canonical.frameCount;
    imageIndex++) {
    assert.ok(imageIndex >= 0 && imageIndex < table.slotCount, `slot ${imageIndex} is outside the archive`);
    assert.equal(table.present[imageIndex], 1, `slot ${imageIndex} is not present`);
    assert.equal(table.blank[imageIndex], 0, `slot ${imageIndex} is unexpectedly blank`);
    const png = await readArchiveImagePng({
      extensionPath: root,
      indexRoot,
      archiveId: archive.archiveId,
      imageIndex,
    });
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', `slot ${imageIndex} did not decode as PNG`);
    frames.push({
      imageIndex,
      width: table.width[imageIndex],
      height: table.height[imageIndex],
      offsetX: table.offsetX[imageIndex],
      offsetY: table.offsetY[imageIndex],
      url: `data:image/png;base64,${png.toString('base64')}`,
    });
  }
  assert.deepEqual(frames.map(frame => frame.imageIndex), [360, 361, 362, 363, 364, 365, 366, 367, 368, 369]);

  const sample = {
    map: { path: mapPath, width: model.width, height: model.height, format: model.format },
    effect: {
      mapName: canonical.mapName,
      x: canonical.x,
      y: canonical.y,
      wilIndex: canonical.wilIndex,
      startImage: canonical.startImage,
      frameCount: canonical.frameCount,
      speedMs: canonical.speedMs,
      drawMode: canonical.drawMode,
    },
    archive: {
      pakName: archive.pakName,
      storedWillIdx: archive.storedWillIdx,
      archiveId: archive.archiveId,
      format: archive.format,
    },
    frames,
  };

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-effect-real-sample-'));
  try {
    const harness = path.join(temporary, 'map-effect-real-sample.html');
    let html = fs.readFileSync(viewerPath, 'utf8');
    html = html.replace(
      '<script>',
      '<script>window.acquireVsCodeApi=function(){return{postMessage:function(){}}};</script><script>'
    );
    html = html.replace('</body>', `${browserScenario(sample)}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let selectedRun;
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
        '--virtual-time-budget=4000',
        '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8',
        timeout: 25000,
        maxBuffer: 32 * 1024 * 1024,
      });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-map-effect-real-sample=/i.test(result.stdout || '')) {
        selectedRun = { candidate: candidates[index], result };
        break;
      }
    }
    assert.ok(
      selectedRun,
      `no installed Chromium browser completed the real MAPEFFECT scenario:\n${attempts.map(
        ({ candidate, result }) => diagnostic(candidate, result)
      ).join('\n')}`
    );
    const encodedError = /data-map-effect-real-sample-errors="([^"]*)"/.exec(selectedRun.result.stdout)?.[1];
    assert.match(
      selectedRun.result.stdout,
      /data-map-effect-real-sample="pass"/,
      decodeAttribute(encodedError) || 'real browser MAPEFFECT scenario failed'
    );
    const encodedResult = /data-map-effect-real-sample-result="([^"]*)"/.exec(selectedRun.result.stdout)?.[1]
      || '<missing>';
    console.log(`map-effect-real-sample.test.js: browser=${selectedRun.candidate}`);
    console.log(`map-effect-real-sample.test.js: result=${decodeAttribute(encodedResult)}`);
  } finally {
    removeTemporaryDirectory(temporary);
  }

  console.log('map-effect-real-sample.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
