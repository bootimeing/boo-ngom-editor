const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const { encodePng } = require(path.join(runtime, 'out/utils/pak-reader'));
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-inspector-dom-'));
try {
  let html = fs.readFileSync(path.join(runtime, 'media/editor.html'), 'utf8');
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  html = html.replace('<script>', '<script>window.testMessages=[];window.acquireVsCodeApi=()=>({postMessage(message){window.testMessages.push(message)},getState(){return{}},setState(){}});</script><script>');
  const image = 'data:image/png;base64,' + encodePng(3, 2, new Uint8ClampedArray([
    255,0,0,255,0,255,0,128,0,0,255,1,255,255,255,255,0,0,0,0,8,4,8,127,
  ])).toString('base64');
  const largeImage = 'data:image/png;base64,' + encodePng(1024, 1024, new Uint8ClampedArray(1024 * 1024 * 4).fill(128)).toString('base64');
  html = html.replace('</body>', `<script>
  (async function() {
    const assert = (ok, message) => { if (!ok) throw Error(message); };
    const wait = predicate => new Promise((resolve,reject) => {
      let n=0; const tick=()=>predicate()?resolve():n++>200?reject(Error('DOM wait timed out')):setTimeout(tick,10); tick();
    });
    const $ = id => document.getElementById(id);
    const change = (id,value) => { $(id).value=value; $(id).dispatchEvent(new Event('change',{bubbles:true})); };
    const openDetails = idx => {
      const item=document.querySelector('#assetsList [data-idx="'+idx+'"]');
      assert(item,'detail target retains its original slot');
      item.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-2,clientY:innerHeight-2}));
      const menu=$('assetContextMenu'), action=menu.querySelector('[data-action="ctxInspectAsset"]');
      assert(getComputedStyle(menu).display!=='none' && !action.hidden,'right-click offers slot details');
      const bounds=menu.getBoundingClientRect();
      assert(bounds.right<=innerWidth && bounds.bottom<=innerHeight,'context menu fits viewport');
      action.click();
      assert(getComputedStyle(menu).display==='none','details action dismisses context menu');
    };
    try {
      const files=Array.from({length:10000},(_,id)=>({name:String(id).padStart(6,'0'),imageIdx:id,localIdx:id,
        pakName:'test.pak',archiveId:'a'.repeat(64),indexGeneration:'b'.repeat(32),profileId:'hxm2-lz-v0',width:3,height:2,offsetX:-23,offsetY:17,isBlank:true,decodeStatus:'empty',url:''}));
      files[1]={...files[1],name:'<not-markup>',isBlank:false,decodeStatus:'indexed-unverified',url:${JSON.stringify(image)}};
      files[2]={...files[2],isBlank:false,decodeStatus:'corrupt',failureCode:'decompression-failed'};
      files[3]={...files[3],isBlank:false,decodeStatus:'unsupported',failureCode:'unsupported-image-layout'};
      files[9999]={...files[1],name:'009999',imageIdx:9999,localIdx:9999};
      const load=files=>window.dispatchEvent(new MessageEvent('message',{data:{type:'loadAssets',files,pakMode:true,
        pakList:[{name:'test.pak',willIdx:0}],totalCount:files.length,folderName:'fixture'}}));
      load(files);
      assert($('fileCount').textContent==='10000 槽 · 2 图 · 9996 空 · 2 异常','counts must distinguish all slots');
      assert(document.querySelectorAll('#assetsList .asset-item').length<200,'virtual window must remain bounded');
      assert(!document.querySelector('#assetsList [data-idx="0"] img'),'empty slot must not fetch a blank PNG');
      assert(!document.querySelector('#assetsList .asset-inspect-btn, #assetsList .asset-item button'),'cards have no view buttons');
      const blank=document.querySelector('#assetsList [data-idx="0"]');
      assert(blank.textContent==='000000' && !blank.querySelector('.asset-state'),'empty card shows only its original ID, no empty labels');
      const placeholder=blank.querySelector('.asset-placeholder');
      assert(placeholder.textContent==='' && getComputedStyle(placeholder).backgroundColor==='rgba(0, 0, 0, 0)','empty thumbnail stays blank and transparent');
      assert(placeholder.getBoundingClientRect().height===35,'empty thumbnail retains grid geometry');
      assert(!document.querySelector('#assetsList [data-idx="2"] img'),'corrupt slot must not be a broken normal thumbnail');
      assert(document.querySelector('#assetsList [data-idx="2"] .asset-state').textContent==='损坏','real failures remain distinct from empty slots');
      $('assetsList').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
      assert($('assetContextMenu').querySelector('[data-action="ctxInspectAsset"]').hidden,'list background has no stale slot details action');
      document.body.click();
      openDetails(0);
      assert($('archiveInspectorStatus').textContent==='空槽','empty slot metadata remains available outside the thumbnail grid');
      $('archiveInspectorClose').click();
      openDetails(1);
      await wait(()=>$('archiveInspectorStatus')?.textContent==='已显示');
      assert(!$('archiveInspector').hidden,'actual context-menu action must open the inspector');
      assert(!$('archiveInspector').querySelector('not-markup'),'names are rendered as text');
      const request=window.testMessages.find(message=>message.command==='inspectArchiveSlots');
      assert(request && request.indices.includes(1) && request.indices.length<=400,'bounded current-window status request');
      const respond=(request,slots,extra={})=>window.dispatchEvent(new MessageEvent('message',{data:{...request,...extra,
        command:'archiveSlotsInspected',type:'archiveSlotsInspected',slots}}));
      respond(request,[{logicalIndex:1,status:'recovered',reasonCode:'checksum-recovered',metadata:{profileId:'hxm2-lz-v0',format:'HXM2',
        imageType:7,flags:2,pixelFormat:'BGRA32',compression:'zlib',alpha:'source BGRA',payloadOffset:900,payloadSize:25,compressedSize:25,rawSize:24}}]);
      assert($('archiveInspectorDetails').textContent.includes('状态：已恢复'),'live ledger must replace snapshot status');
      assert($('archiveInspectorDetails').textContent.includes('像素：BGRA32') && $('archiveInspectorDetails').textContent.includes('数据起点：900'),'codec and physical range details');
      assert(document.querySelector('#assetsList [data-idx="1"]').dataset.slotStatus==='recovered','recovered reason is not corruption');
      change('archiveInspectorMode','offset'); change('archiveInspectorZoom','2');
      const img=$('archiveInspectorStage').querySelector('img'), origin=$('archiveInspectorOrigin');
      assert(img.style.left==='12px' && img.style.top==='46px','negative X and positive Y positioning');
      assert(origin.style.left==='58px' && origin.style.top==='12px','origin must be independent of image bounds');
      assert(img.style.width==='6px' && img.style.height==='4px','integer pixel scaling');
      assert(getComputedStyle(img).imageRendering==='pixelated','nearest-neighbor display');
      change('archiveInspectorBackground','white'); assert(getComputedStyle($('archiveInspectorViewport')).backgroundColor==='rgb(255, 255, 255)','white backdrop');
      change('archiveInspectorBackground','black'); assert(getComputedStyle($('archiveInspectorViewport')).backgroundColor==='rgb(0, 0, 0)','black backdrop');
      change('archiveInspectorBackground','checker'); assert(getComputedStyle($('archiveInspectorViewport')).backgroundImage!=='none','checker backdrop');
      let behindKeys=0; document.addEventListener('keydown',()=>behindKeys++);
      $('archiveInspectorClose').dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));
      assert(behindKeys===0,'read-only dialog must isolate editor shortcuts');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      assert($('archiveInspector').hidden && getComputedStyle($('archiveInspector')).display==='none','Escape really hides modal');
      // User-defined consecutive animation must preserve empty/corrupt slots and one common coordinate frame.
      openDetails(1);
      await wait(()=>$('archiveInspectorStatus').textContent==='已显示');
      change('archiveInspectorMode','offset'); change('archiveInspectorZoom','1');
      change('archiveAnimationStart','1'); change('archiveAnimationCount','4'); change('archiveAnimationInterval','10000');
      $('archiveAnimationPlay').click();
      await wait(()=>$('archiveInspectorStage').dataset.frameId==='1' && $('archiveInspectorStage').querySelector('img'));
      $('archiveAnimationPlay').click();
      const groupWidth=$('archiveInspectorStage').style.width, groupHeight=$('archiveInspectorStage').style.height;
      const originLeft=$('archiveInspectorOrigin').style.left, originTop=$('archiveInspectorOrigin').style.top;
      $('archiveAnimationStep').click();
      assert($('archiveInspectorStage').dataset.frameId==='2' && !$('archiveInspectorStage').querySelector('img') && $('archiveInspectorStatus').textContent.includes('损坏'),'corrupt animation frame not skipped or substituted');
      $('archiveAnimationStep').click(); $('archiveAnimationStep').click();
      assert($('archiveInspectorStage').dataset.frameId==='4' && !$('archiveInspectorStage').querySelector('img') && $('archiveInspectorStatus').textContent.includes('空槽'),'empty animation frame not skipped');
      assert($('archiveInspectorStage').style.width===groupWidth && $('archiveInspectorStage').style.height===groupHeight,'stable full-sequence dimensions');
      assert($('archiveInspectorOrigin').style.left===originLeft && $('archiveInspectorOrigin').style.top===originTop,'stable common origin across bad and empty frames');
      assert(Number($('archiveInspectorStage').dataset.cacheBytes)<=64*1024*1024 && Number($('archiveInspectorStage').dataset.cacheEntries)<=24,'RGBA bounded cache');
      change('archiveAnimationDirection','reverse'); $('archiveAnimationPlay').click(); $('archiveAnimationPlay').click();
      assert($('archiveInspectorStage').dataset.frameId==='4','reverse starts at range end'); $('archiveAnimationStep').click();
      assert($('archiveInspectorStage').dataset.frameId==='3','reverse uses logical ID sequence');
      change('archiveAnimationCount','241'); $('archiveAnimationPlay').click();
      assert($('archiveInspectorStatus').textContent.includes('1–240'),'oversized animation range rejected');
      change('archiveAnimationCount','1'); change('archiveAnimationBlend','screen'); $('archiveAnimationPlay').click();
      await wait(()=>$('archiveInspectorStage').querySelector('img'));
      assert($('archiveInspectorStage').querySelector('img').style.mixBlendMode==='screen','explicit user screen blend');
      $('archiveInspectorClose').click();
      openDetails(2);
      assert($('archiveInspectorStatus').textContent==='损坏','bad slot status');
      assert(!$('archiveInspectorStage').querySelector('img'),'bad slot does not fabricate an image');
      assert($('archiveInspectorDetails').textContent.includes('decompression-failed'),'reason code remains available');
      $('archiveInspectorClose').click();
      $('archiveSlotId').value='9999'; $('archiveSlotId').closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      await wait(()=>$('archiveInspectorStatus').textContent==='已显示');
      assert($('archiveInspectorTitle').textContent.endsWith('#9999'),'exact ID locator');
      assert(document.querySelector('#assetsList [data-idx="9999"]'),'last logical slot stays reachable');
      assert(document.querySelectorAll('#assetsList .asset-item').length<200,'end of list remains virtual');
      $('archiveInspectorClose').click();
      // Deterministic late callback injection tests the real handler, not native mouse timing.
      const OriginalImage=window.Image, pending=[];
      window.Image=function(){const img=new OriginalImage();pending.push(img);return img;};
      openDetails(9999);
      $('archiveInspectorClose').click(); pending.at(-1).onload();
      assert($('archiveInspector').hidden && !$('archiveInspectorStage').querySelector('img'),'late decode cannot reopen closed inspector');
      openDetails(9999);
      const old=pending.at(-1); load([{...files[1],profileId:'gee3-legacy-v2'}]); old.onload();
      assert($('archiveInspector').hidden,'new archive invalidates old inspection');
      window.Image=OriginalImage;
      // Old scrollTop must not strand a newly loaded short archive at an empty window.
      assert(document.querySelector('#assetsList [data-idx="0"]'),'shorter archive resets/clamps the viewport');
      openDetails(0);
      await wait(()=>$('archiveInspectorStatus').textContent==='已显示');
      assert($('archiveInspectorMode').options[1].disabled && $('archiveInspectorMode').value==='raw','unknown legacy XY not displayed as original zero');
      $('archiveInspectorClose').click();
      window.Image=function(){const img=new OriginalImage();pending.push(img);return img;};
      const item=document.querySelector('#assetsList [data-idx="0"]');
      item.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,clientX:50,clientY:50}));
      const hover=pending.at(-1); $('assetsList').dispatchEvent(new MouseEvent('mouseleave')); hover.onload();
      assert($('hoverPreview').style.display==='none','late hover callback cannot reveal stale image');
      window.Image=OriginalImage;
      const animationFrames=Array.from({length:20},(_,id)=>({...files[1],imageIdx:id,localIdx:id,name:String(id),
        indexGeneration:'c'.repeat(32),width:1024,height:1024,offsetX:-id*2,offsetY:id*3,url:${JSON.stringify(largeImage)}}));
      load(animationFrames);
      openDetails(0);
      await wait(()=>$('archiveInspectorStatus').textContent==='已显示');
      const newRequest=window.testMessages.filter(message=>message.command==='inspectArchiveSlots').at(-1);
      assert(newRequest.assetGeneration!==request.assetGeneration,'source replacement uses new request generation');
      respond(request,[{logicalIndex:0,status:'corrupt'}]);
      assert(!$('archiveInspectorDetails').textContent.includes('状态：损坏'),'stale source response ignored');
      change('archiveInspectorMode','offset'); change('archiveAnimationStart','0'); change('archiveAnimationCount','20');
      change('archiveAnimationDirection','forward'); change('archiveAnimationBlend','normal');
      $('archiveAnimationPlay').click(); $('archiveAnimationPlay').click();
      await wait(()=>$('archiveInspectorStage').querySelector('img'));
      const fullWidth=$('archiveInspectorStage').style.width, fullHeight=$('archiveInspectorStage').style.height;
      const initialLeft=$('archiveInspectorStage').querySelector('img').style.left;
      for(let id=1;id<20;id++) {
        $('archiveAnimationStep').click(); await wait(()=>$('archiveInspectorStage').querySelector('img'));
        assert($('archiveInspectorStage').dataset.frameId===String(id),'20-frame sequence retains every ID');
        assert($('archiveInspectorStage').style.width===fullWidth && $('archiveInspectorStage').style.height===fullHeight,'varying XY never resize sequence stage');
        assert(Number($('archiveInspectorStage').dataset.cacheBytes)<=64*1024*1024,'decoded RGBA never exceeds 64 MiB');
        assert(Number($('archiveInspectorStage').dataset.cacheEntries)<=16,'1024-square RGBA budget evicts before 24-item bound');
      }
      assert($('archiveInspectorStage').querySelector('img').style.left!==initialLeft,'different frame offsets preserved instead of recentering');
      assert(Number($('archiveInspectorStage').dataset.cacheBytes)===64*1024*1024,'cache charges RGBA not highly compressed PNG bytes');
      change('archiveAnimationStart','19'); change('archiveAnimationCount','3'); $('archiveAnimationPlay').click(); $('archiveAnimationPlay').click();
      $('archiveAnimationStep').click();
      assert($('archiveInspectorStage').dataset.frameId==='20' && !$('archiveInspectorStage').querySelector('img') && $('archiveInspectorStatus').textContent.includes('缺少槽位'),'nonexistent ID stays an explicit missing frame');
      const requestCount=()=>window.testMessages.filter(message=>message.command==='inspectArchiveSlots').length;
      Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'));
      const hiddenCount=requestCount(); await new Promise(resolve=>setTimeout(resolve,2100));
      assert(requestCount()===hiddenCount,'hidden webview does not poll archive slots');
      delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
      assert(requestCount()>hiddenCount,'visible webview resumes bounded requests');
      const identityRequest=window.testMessages.filter(message=>message.command==='inspectArchiveSlots').at(-1);
      respond(identityRequest,[{logicalIndex:0,status:'corrupt'}],{indexGeneration:'wrong-generation'});
      assert(!$('archiveInspectorDetails').textContent.includes('状态：损坏'),'wrong index generation cannot overwrite inspected status');
      // Deterministic injection validates callback invalidation after parameter change and close.
      window.Image=function(){const img=new OriginalImage();pending.push(img);return img;};
      change('archiveAnimationStart','0'); $('archiveAnimationPlay').click();
      const cancelledAnimationCallback=pending.at(-1).onload;
      change('archiveAnimationStart','1'); cancelledAnimationCallback();
      assert(!$('archiveInspectorStage').querySelector('img'),'changed parameters cannot publish an old image');
      $('archiveAnimationPlay').click(); const closedAnimationCallback=pending.at(-1).onload;
      $('archiveInspectorClose').click(); closedAnimationCallback();
      assert($('archiveInspector').hidden && !$('archiveInspectorStage').querySelector('img'),'closed animation cannot publish late image');
      window.Image=OriginalImage;
      // An authoritative metadata refresh must invalidate a stale geometry-derived decode error/cache.
      load([{...files[1],imageIdx:0,localIdx:0,name:'0',width:2,height:2,indexGeneration:'d'.repeat(32)}]);
      openDetails(0);
      await wait(()=>$('archiveInspectorStatus').textContent==='已显示');
      const geometryRequest=window.testMessages.filter(message=>message.command==='inspectArchiveSlots').at(-1);
      change('archiveAnimationStart','0'); change('archiveAnimationCount','1'); $('archiveAnimationPlay').click(); $('archiveAnimationPlay').click();
      await wait(()=>$('archiveInspectorStatus').textContent.includes('解码尺寸与索引不一致'));
      respond(geometryRequest,[{logicalIndex:0,status:'decoded',metadata:{width:3,height:2,offsetX:-23,offsetY:17,profileId:'hxm2-lz-v0'}}]);
      await wait(()=>$('archiveInspectorStage').querySelector('img'));
      assert($('archiveInspectorStage').querySelector('img').naturalWidth===3,'corrected authoritative dimensions retry stale failed frame');
      $('archiveInspectorClose').click();
      document.body.dataset.testStatus='pass';
    } catch(e) {document.body.dataset.testStatus='fail';document.body.dataset.testError=e.stack||e.message;}
  })();
  </script></body>`);
  const harness = path.join(temporary, 'harness.html'); fs.writeFileSync(harness, html);
  const browsers = [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe')].filter(p => p && fs.existsSync(p)))];
  let response, selected;
  for (const [id, browser] of browsers.entries()) {
    const attempt = spawnSync(browser, ['--headless=new','--disable-gpu','--disable-extensions','--no-first-run',
      '--allow-file-access-from-files','--window-size=1200,850','--virtual-time-budget=8000','--dump-dom',
      '--user-data-dir=' + path.join(temporary, 'profile-' + id), pathToFileURL(harness).href],
    { encoding:'utf8', windowsHide:true, timeout:30000, maxBuffer:4*1024*1024 });
    if (!attempt.error && attempt.status===0 && /<body\b/.test(attempt.stdout || '')) { response=attempt; selected=browser; break; }
    console.warn(`archive-inspector: no DOM from ${browser}, status=${attempt.status}, stderr=${attempt.stderr || '<empty>'}`);
  }
  assert.ok(response,'a real browser DOM is required');
  const body = response.stdout.match(/<body[^>]*>/)?.[0];
  assert.match(body || '', /data-test-status="pass"/, body);
  console.log(`archive-inspector-browser.test.js: PASS (actual editor HTML/Chromium DOM, 10000 slots, live status/profile metadata, exact ID, offsets, common-origin forward/reverse animation, preserved empty/bad slots, 64 MiB RGBA eviction, late callbacks; browser=${selected})`);
} finally {
  assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(temporary).startsWith('boo-inspector-dom-'));
  removeTemporaryDirectory(temporary);
}
