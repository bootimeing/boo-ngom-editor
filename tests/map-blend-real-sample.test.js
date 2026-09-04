const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');
const defaultMapPath = 'D:\\MirServer\\Mir200\\Map\\NEW_WYC.map';
const objectSlot = 14954;
const cell = { x: 23, y: 61 };

function skip(reason) {
  console.log(`map-blend-real-sample.test.js: SKIP - ${reason}`);
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
  var background=[120,100,80,255];
  function assertState(value,message){if(!value)throw new Error(message)}
  function samePixel(left,right){
    return left.length===right.length&&left.every(function(value,index){return value===right[index]});
  }
  function loadImage(){
    return new Promise(function(resolve,reject){
      var image=new Image();
      image.onload=function(){resolve(image)};
      image.onerror=function(){reject(new Error('real Objects111 slot 14954 PNG failed to load'))};
      image.src=sample.frame.url;
    });
  }
  function pixelAt(context,point){
    return Array.from(context.getImageData(point.x,point.y,1,1).data);
  }
  function pointAt(index,width){return{x:index%width,y:Math.floor(index/width)}}
  function sourcePixel(pixels,index){
    var offset=index*4;
    return[pixels[offset],pixels[offset+1],pixels[offset+2],pixels[offset+3]];
  }
  function locateRepresentativePixels(pixels,width){
    var nearBlackIndex=-1,nearBlackScore=Number.POSITIVE_INFINITY;
    var brightBlueIndex=-1,brightBlueScore=Number.NEGATIVE_INFINITY;
    var transparentIndex=-1,nearBlackCount=0,brightBlueCount=0,transparentCount=0;
    var height=pixels.length/4/width,minX=width,minY=height,maxX=-1,maxY=-1;
    var visiblePerRow=new Array(height).fill(0),blueEnergyPerRow=new Array(height).fill(0);
    for(var offset=0;offset<pixels.length;offset+=4){
      var index=offset/4,r=pixels[offset],g=pixels[offset+1],b=pixels[offset+2],a=pixels[offset+3];
      if(a===0){transparentCount++;if(transparentIndex<0)transparentIndex=index}
      else{
        var point=pointAt(index,width);
        minX=Math.min(minX,point.x);minY=Math.min(minY,point.y);
        maxX=Math.max(maxX,point.x);maxY=Math.max(maxY,point.y);
        visiblePerRow[point.y]++;
        blueEnergyPerRow[point.y]+=Math.max(0,b-Math.max(r,g));
      }
      var maximum=Math.max(r,g,b),sum=r+g+b;
      if(a===255&&sum>0&&maximum<=32){
        nearBlackCount++;
        if(sum<nearBlackScore){nearBlackScore=sum;nearBlackIndex=index}
      }
      if(a===255&&b>=96&&b>=r+24&&b>=g+16){
        brightBlueCount++;
        var score=b*3-r-g;
        if(score>brightBlueScore){brightBlueScore=score;brightBlueIndex=index}
      }
    }
    assertState(nearBlackIndex>=0,'real frame has no opaque nonzero near-black pixel (max RGB <= 32)');
    assertState(brightBlueIndex>=0,'real frame has no opaque bright-blue pixel');
    assertState(transparentIndex>=0,'real frame has no fully transparent pixel');
    var peakVisibleRow=visiblePerRow.indexOf(Math.max.apply(null,visiblePerRow));
    var peakBlueRow=blueEnergyPerRow.indexOf(Math.max.apply(null,blueEnergyPerRow));
    return{
      nearBlack:{point:pointAt(nearBlackIndex,width),rgba:sourcePixel(pixels,nearBlackIndex)},
      brightBlue:{point:pointAt(brightBlueIndex,width),rgba:sourcePixel(pixels,brightBlueIndex)},
      transparent:{point:pointAt(transparentIndex,width),rgba:sourcePixel(pixels,transparentIndex)},
      counts:{nearBlack:nearBlackCount,brightBlue:brightBlueCount,transparent:transparentCount},
      alphaBounds:{minX:minX,minY:minY,maxX:maxX,maxY:maxY},
      peakVisibleRow:peakVisibleRow,peakBlueRow:peakBlueRow
    };
  }
  function makeTarget(composite){
    var targetCanvas=document.createElement('canvas');
    targetCanvas.width=sample.frame.width;targetCanvas.height=sample.frame.height;
    var target=targetCanvas.getContext('2d');
    target.imageSmoothingEnabled=false;
    target.fillStyle='rgb('+background[0]+','+background[1]+','+background[2]+')';
    target.fillRect(0,0,targetCanvas.width,targetCanvas.height);
    target.globalCompositeOperation=composite;
    return target;
  }
  function sampleTarget(target,representatives){
    return{
      nearBlack:pixelAt(target,representatives.nearBlack.point),
      brightBlue:pixelAt(target,representatives.brightBlue.point),
      transparent:pixelAt(target,representatives.transparent.point),
      composite:target.globalCompositeOperation
    };
  }
  function lighterExpected(source){
    return[
      Math.min(255,background[0]+source[0]),
      Math.min(255,background[1]+source[1]),
      Math.min(255,background[2]+source[2]),
      255
    ];
  }
  try{
    resize();
    var image=await loadImage();
    assertState(image.naturalWidth===sample.frame.width&&image.naturalHeight===sample.frame.height,
      'real PNG dimensions differ from the production asset table');
    var sourceCanvas=document.createElement('canvas');
    sourceCanvas.width=image.naturalWidth;sourceCanvas.height=image.naturalHeight;
    var sourceContext=sourceCanvas.getContext('2d');
    sourceContext.drawImage(image,0,0);
    var sourcePixels=sourceContext.getImageData(0,0,sourceCanvas.width,sourceCanvas.height).data;
    var representatives=locateRepresentativePixels(sourcePixels,sourceCanvas.width);

    var resource={
      meta:{
        key:'objects111:'+sample.reference.imageIndex,
        width:sample.frame.width,height:sample.frame.height,
        offsetX:sample.frame.offsetX,offsetY:sample.frame.offsetY,
        blendAnchorRows:sample.frame.blendAnchorRows,url:sample.frame.url
      },
      image:image,blank:false,failed:false
    };
    state.scale=1;
    var placement=originalMapPlacement(
      'object',sample.cell.x,sample.cell.y,resource.meta,sample.reference.animationFrame
    );
    assertState(placement.worldX===sample.expectedPlacement.worldX&&
      placement.worldY===sample.expectedPlacement.worldY,
      'real Objects111 bit7 placement does not match the verified three-row client anchor: expected '+
        JSON.stringify(sample.expectedPlacement)+' actual '+JSON.stringify(placement));

    var ordinaryAnimationFrame=sample.reference.animationFrame&0x7f;
    var ordinaryPlacement=originalMapPlacement(
      'object',sample.cell.x,sample.cell.y,resource.meta,ordinaryAnimationFrame
    );
    var ordinary=makeTarget('source-over');
    state.offsetX=-ordinaryPlacement.worldX;state.offsetY=-ordinaryPlacement.worldY;
    drawOriginalMapResource(
      ordinary,resource,'object',sample.cell.x,sample.cell.y,ordinaryAnimationFrame
    );
    var bit7=makeTarget('source-over');
    state.offsetX=-placement.worldX;state.offsetY=-placement.worldY;
    drawOriginalMapResource(
      bit7,resource,'object',sample.cell.x,sample.cell.y,sample.reference.animationFrame
    );
    var restored=makeTarget('multiply');
    state.offsetX=-placement.worldX;state.offsetY=-placement.worldY;
    drawOriginalMapResource(
      restored,resource,'object',sample.cell.x,sample.cell.y,sample.reference.animationFrame
    );

    var result={
      map:sample.map,cell:sample.cell,reference:sample.reference,
      ordinaryPlacement:ordinaryPlacement,placement:placement,
      archive:sample.archive,frame:{
        width:sample.frame.width,height:sample.frame.height,
        offsetX:sample.frame.offsetX,offsetY:sample.frame.offsetY,sha256:sample.frame.sha256
      },
      representatives:representatives,
      ordinary:sampleTarget(ordinary,representatives),
      bit7:sampleTarget(bit7,representatives),
      restored:sampleTarget(restored,representatives)
    };
    document.body.dataset.mapBlendRealSampleResult=JSON.stringify(result);

    assertState(samePixel(result.ordinary.nearBlack,representatives.nearBlack.rgba),
      'ordinary source-over no longer preserves the real near-black source pixel');
    assertState(samePixel(result.ordinary.brightBlue,representatives.brightBlue.rgba),
      'ordinary source-over no longer preserves the real bright-blue source pixel');
    assertState(samePixel(result.ordinary.transparent,background),
      'ordinary source-over changed the background under a transparent source pixel');

    var expectedNearBlack=lighterExpected(representatives.nearBlack.rgba);
    var expectedBrightBlue=lighterExpected(representatives.brightBlue.rgba);
    assertState(samePixel(result.bit7.nearBlack,expectedNearBlack),
      'bit7 lighter did not add the real near-black pixel to the background: expected '+
        JSON.stringify(expectedNearBlack)+' actual '+JSON.stringify(result.bit7.nearBlack));
    assertState(samePixel(result.bit7.brightBlue,expectedBrightBlue),
      'bit7 lighter did not preserve/add the real bright-blue glow: expected '+
        JSON.stringify(expectedBrightBlue)+' actual '+JSON.stringify(result.bit7.brightBlue));
    assertState(samePixel(result.bit7.transparent,background),
      'bit7 lighter changed the background under a transparent source pixel');
    assertState(result.bit7.nearBlack[0]>=background[0]&&
      result.bit7.nearBlack[1]>=background[1]&&result.bit7.nearBlack[2]>=background[2],
      'bit7 real near-black pixel darkened the map background');
    assertState(result.ordinary.nearBlack[0]<background[0]||
      result.ordinary.nearBlack[1]<background[1]||result.ordinary.nearBlack[2]<background[2],
      'ordinary source-over control did not demonstrate near-black background coverage');
    assertState(result.bit7.brightBlue[2]>background[2],
      'bit7 real bright-blue pixel did not brighten the blue channel');

    assertState(samePixel(result.restored.nearBlack,expectedNearBlack)&&
      samePixel(result.restored.brightBlue,expectedBrightBlue)&&
      samePixel(result.restored.transparent,background),
      'bit7 drawing inherited the caller composite mode instead of temporarily using lighter');
    assertState(result.ordinary.composite==='source-over'&&result.bit7.composite==='source-over',
      'drawing changed the default caller composite mode');
    assertState(result.restored.composite==='multiply',
      'bit7 drawing did not restore the caller composite mode');
    document.body.dataset.mapBlendRealSample='pass';
  }catch(error){
    document.body.dataset.mapBlendRealSample='fail';
    document.body.dataset.mapBlendRealSampleErrors=error&&error.stack?error.stack:String(error);
  }
}());
</script>`;
}

async function main() {
  const mapPath = path.resolve(process.env.BOO_TEST_MAP_BLEND_MAP_PATH || defaultMapPath);
  const cacheRoot = path.resolve(
    process.env.BOO_TEST_PATCH_CACHE_ROOT
      || path.join(
        process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
        'BOO-NGOM-Editor',
        'cache',
        'patch-cache'
      )
  );
  const clientRoot = process.env.BOO_TEST_CLIENT_ROOT
    ? path.resolve(process.env.BOO_TEST_CLIENT_ROOT)
    : undefined;
  const viewerPath = path.join(root, 'media', 'map-preview.html');
  const browsers = browserCandidates();

  if (!fs.existsSync(mapPath)) return skip(`真实 NEW_WYC.map 不存在: ${mapPath}`);
  if (!fs.existsSync(cacheRoot)) return skip(`BOO 补丁缓存不存在: ${cacheRoot}`);
  if (!browsers.length) return skip('未找到真实 Chromium 浏览器（Edge / Chrome）');

  const {
    collectOriginalMapViewport,
    originalMapObjectBlendAnchorRows,
    parseOriginalMap,
  } = require('../out/utils/original-map');
  const {
    isPatchCacheCurrent,
    listCachedPatchPaks,
    loadCachedPatchAssetTable,
  } = require('../out/utils/patch-cache');
  const { readArchiveImagePng } = require('../out/utils/archive-index');

  const model = await parseOriginalMap(fs.readFileSync(mapPath));
  assert.equal(model.width, 420, 'NEW_WYC width changed');
  assert.equal(model.height, 330, 'NEW_WYC height changed');
  assert.equal(model.cellSize, 14, 'NEW_WYC must remain a 14-byte MAP');
  assert.equal(model.animationProfile, 'classic-14', 'NEW_WYC animation profile is no longer verified classic-14');
  const modelIndex = cell.y * model.width + cell.x;
  assert.equal(model.frontImages[modelIndex], objectSlot + 1, 'MAP cell no longer points to raw image 14955');
  assert.equal(model.objectFiles[modelIndex], 110, 'MAP cell no longer points to Objects111 file index 110');
  assert.equal(model.objectAnimationFrames[modelIndex], 0x8a, 'MAP cell blend/frame byte must be 0x8A');
  assert.equal(model.objectAnimationTicks[modelIndex], 0, 'MAP cell animation tick must be 0');
  const references = collectOriginalMapViewport(model, {
    left: cell.x,
    top: cell.y,
    right: cell.x,
    bottom: cell.y,
  });
  const reference = references.find(item => (
    item.layer === 'object' && item.x === cell.x && item.y === cell.y
  ));
  assert.deepEqual(
    reference,
    {
      layer: 'object',
      x: 23,
      y: 61,
      archiveName: 'Objects111',
      imageIndex: objectSlot,
      resourceKey: `objects111:${objectSlot}`,
      animationFrame: 0x8a,
      animationTick: 0,
    },
    'production original-map reference for NEW_WYC (23,61) changed'
  );
  const blendAnchorRows = originalMapObjectBlendAnchorRows(
    'GOM',
    model.animationProfile
  );
  assert.equal(
    blendAnchorRows,
    3,
    'the production NEW_WYC / Objects111 bit7 sample must select the verified three-row anchor'
  );

  const cached = listCachedPatchPaks(cacheRoot, clientRoot)
    .filter(item => normalizeArchiveName(item.pakName) === 'objects111')
    .filter(item => item.format === 'GOM' && item.storageMode === 'direct' && item.archiveId)
    .filter(item => item.slotCount > objectSlot)
    .filter(item => fs.existsSync(item.pakPath))
    .filter(isPatchCacheCurrent);
  if (!cached.length) {
    return skip('未找到当前有效的 GOM/direct Objects111 归档索引（slot 14954）');
  }
  if (cached.length !== 1) {
    return skip(`找到 ${cached.length} 个可用 GOM Objects111 样本，请用 BOO_TEST_CLIENT_ROOT 限定当前客户端`);
  }
  const archive = cached[0];
  const table = loadCachedPatchAssetTable(archive);
  assert.ok(objectSlot < table.slotCount, 'Objects111 slot 14954 is outside the production asset table');
  assert.equal(table.present[objectSlot], 1, 'Objects111 slot 14954 is not present');
  assert.equal(table.blank[objectSlot], 0, 'Objects111 slot 14954 is unexpectedly blank');
  assert.equal(table.width[objectSlot], 328, 'Objects111 slot 14954 width changed');
  assert.equal(table.height[objectSlot], 358, 'Objects111 slot 14954 height changed');
  assert.equal(table.offsetX[objectSlot], 0, 'Objects111 slot 14954 offsetX changed');
  assert.equal(table.offsetY[objectSlot], 0, 'Objects111 slot 14954 offsetY changed');
  const indexRoot = path.dirname(archive.cacheDir);
  assert.equal(path.basename(indexRoot).toLowerCase(), 'archive-index-v1');
  const png = await readArchiveImagePng({
    extensionPath: root,
    indexRoot,
    archiveId: archive.archiveId,
    imageIndex: objectSlot,
  });
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'slot 14954 did not decode as PNG');

  const sample = {
    map: {
      path: mapPath,
      width: model.width,
      height: model.height,
      cellSize: model.cellSize,
      animationProfile: model.animationProfile,
    },
    cell,
    reference,
    archive: {
      pakName: archive.pakName,
      pakPath: archive.pakPath,
      format: archive.format,
      storageMode: archive.storageMode,
      slotCount: archive.slotCount,
    },
    frame: {
      width: table.width[objectSlot],
      height: table.height[objectSlot],
      offsetX: table.offsetX[objectSlot],
      offsetY: table.offsetY[objectSlot],
      blendAnchorRows,
      sha256: crypto.createHash('sha256').update(png).digest('hex'),
      url: `data:image/png;base64,${png.toString('base64')}`,
    },
    expectedPlacement: {
      worldX: cell.x * 48 + table.offsetX[objectSlot],
      worldY: (cell.y + 1) * 32 - blendAnchorRows * 32 + table.offsetY[objectSlot],
    },
  };

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-blend-real-sample-'));
  try {
    const harness = path.join(temporary, 'map-blend-real-sample.html');
    let html = fs.readFileSync(viewerPath, 'utf8');
    html = html.replace(
      '<script>',
      '<script>window.acquireVsCodeApi=function(){return{postMessage:function(){}}};</script><script>'
    );
    html = html.replace('</body>', `${browserScenario(sample)}</body>`);
    fs.writeFileSync(harness, html, 'utf8');

    const attempts = [];
    let selected;
    for (let index = 0; index < browsers.length; index++) {
      const result = spawnSync(browsers[index], [
        '--headless=new',
        '--disable-gpu',
        '--disable-extensions',
        '--no-first-run',
        '--allow-file-access-from-files',
        '--force-device-scale-factor=1',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`,
        '--window-size=1200,800',
        '--virtual-time-budget=2500',
        '--dump-dom',
        pathToFileURL(harness).href,
      ], {
        encoding: 'utf8',
        timeout: 25000,
        maxBuffer: 32 * 1024 * 1024,
      });
      attempts.push({ candidate: browsers[index], result });
      if (!result.error && result.status === 0
        && /<body\b/i.test(result.stdout || '')
        && /data-map-blend-real-sample=/i.test(result.stdout || '')) {
        selected = { candidate: browsers[index], result };
        break;
      }
    }
    assert.ok(
      selected,
      `no installed Chromium browser completed the real MAP blend scenario:\n${attempts.map(
        ({ candidate, result }) => diagnostic(candidate, result)
      ).join('\n')}`
    );
    const encodedError = /data-map-blend-real-sample-errors="([^"]*)"/.exec(selected.result.stdout)?.[1];
    const encodedResult = /data-map-blend-real-sample-result="([^"]*)"/.exec(selected.result.stdout)?.[1];
    const details = encodedResult ? decodeAttribute(encodedResult) : '<no pixel result>';
    assert.match(
      selected.result.stdout,
      /data-map-blend-real-sample="pass"/,
      `${decodeAttribute(encodedError) || 'real browser MAP blend scenario failed'}\nPixels: ${details}`
    );
    console.log(`map-blend-real-sample.test.js: browser=${selected.candidate}`);
    console.log(`map-blend-real-sample.test.js: result=${details}`);
  } finally {
    removeTemporaryDirectory(temporary);
  }
  console.log('map-blend-real-sample.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
