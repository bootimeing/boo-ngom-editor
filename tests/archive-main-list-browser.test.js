const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-archive-main-list-'));

async function main() {
  try {
    let html = fs.readFileSync(path.join(runtime, 'media/editor.html'), 'utf8');
    html = html.replace('<script>', '<script>window.acquireVsCodeApi=()=>({postMessage(){},getState(){return{}},setState(){}});</script><script>');
    html = html.replace(/        \}\)\(\);\s*<\/script>/, `
    (async function() {
      const assert=(v,m)=>{if(!v)throw Error(m);}, $=id=>document.getElementById(id);
      const wait=p=>new Promise((resolve,reject)=>{let n=0;const tick=()=>p()?resolve():n++>200?reject(Error('wait timeout')):setTimeout(tick,10);tick();});
      const nativeImage=window.Image, metrics={};
      try {
        const fixture=document.createElement('canvas');fixture.width=8;fixture.height=8;
        fixture.getContext('2d').fillRect(0,0,8,8);const url=fixture.toDataURL();
        const load=(name='old.pak',will=7)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'loadAssets',pakMode:true,
          pakList:[{name,willIdx:will}],assetCatalog:{version:1,segments:[{kind:'direct',pakName:name,pakPath:name,willIdx:will,
          source:'pak',archiveId:(will===7?'a':'c').repeat(64),indexGeneration:'b'.repeat(32),slotCount:2048,urlTemplate:url+'#{id}',
          records:[[0,8,8,0,0,'decoded'],[2047,8,8,0,0,'decoded']]}]}}}));
        // Real image decoding, but deliberately delay the consumer callback to control the source-swap race.
        const deferredImage=(fail=false)=>{
          let release,created=0;
          window.Image=function(){created++;const image=new nativeImage();let onload,onerror;
            Object.defineProperty(image,'onload',{configurable:true,get:()=>onload,set:v=>onload=v});
            Object.defineProperty(image,'onerror',{configurable:true,get:()=>onerror,set:v=>onerror=v});
            image.addEventListener('load',e=>{release=()=>onload?.call(image,e);});
            image.addEventListener('error',e=>{release=()=>onerror?.call(image,e);});
            if(fail)Object.defineProperty(image,'src',{set(){nativeImage.prototype.__lookupSetter__('src').call(image,'data:image/png;base64,AAAA');}});
            return image;
          };
          return {ready:()=>!!release,release:()=>release(),created:()=>created};
        };
        load();
        const blank=$('assetsList').querySelector('[data-idx="1"]');
        assert(blank && blank.dataset.slotStatus==='empty' && !blank.querySelector('img,.asset-state,button'),'compact empty slot keeps only a blank thumbnail and ID');
        assert(blank.textContent===blank.querySelector('.name').textContent,'compact empty slot has no empty or view text');
        assert(getComputedStyle(blank.querySelector('.asset-placeholder')).backgroundColor==='rgba(0, 0, 0, 0)','compact placeholder is transparent');
        const blankTransfer=new DataTransfer();let blocked=false;
        dragStart({dataTransfer:blankTransfer,preventDefault(){blocked=true}},1);addToCanvas(1);
        assert(blocked && elements.length===0 && !blankTransfer.getData('idx'),'blank slots remain unselectable, without fabricated canvas images');
        const pending=deferredImage();addToCanvas(0);window.Image=nativeImage;await wait(pending.ready);
        blank.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}));
        assert(getComputedStyle($('assetContextMenu')).display!=='none','slot menu opens');
        load('new.pak',8);pending.release();
        assert(getComputedStyle($('assetContextMenu')).display==='none','source change closes stale slot menu');
        assert(elements.length===0,'late old-source load must not add a canvas element');
        metrics.lateSourceSuccessRejected=true;
        let staleToasts=0;const nativeToast=showToast;showToast=()=>staleToasts++;
        const failed=deferredImage(true);addToCanvas(0);window.Image=nativeImage;await wait(failed.ready);
        load();failed.release();showToast=nativeToast;
        assert(staleToasts===0,'late old-source error must not display a toast');metrics.lateSourceErrorRejected=true;
        // A valid current-source addition still works after another selector changes its own epoch.
        const valid=deferredImage();addToCanvas(0);window.Image=nativeImage;await wait(valid.ready);
        closeArchiveAssetSelectors();valid.release();
        assert(elements.length===1&&elements[0].willIdx===7,'current-source image still adds, independent of selector lifetime');
        clearCanvas();
        const transfer=new DataTransfer();dragStart({dataTransfer:transfer},0);load('new.pak',8);
        canvas.ondrop({preventDefault(){},dataTransfer:transfer});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        assert(elements.length===0,'old-source drag must not resolve the same index in a new package');metrics.staleDragRejected=true;
        const freshTransfer=new DataTransfer();dragStart({dataTransfer:freshTransfer},0);
        canvas.ondrop({preventDefault(){},dataTransfer:freshTransfer});await wait(()=>elements.length===1);
        assert(elements[0].willIdx===8,'fresh same-source drag remains usable');clearCanvas();
        // Closing the last package must retire the old logical range before a queued scroll renderer runs.
        $('assetsList').scrollTop=2000;_renderVisibleAssets();
        window.dispatchEvent(new MessageEvent('message',{data:{type:'loadAssets',pakMode:true,pakList:[],assetCatalog:{version:1,segments:[]}}}));
        _renderVisibleAssets();assert(_virtualList.filteredItems.length===0,'empty source retires old virtual range');
        assert(!$('assetsList').querySelector('[data-idx]'),'empty source has no old slot nodes');metrics.emptyQueuedRenderSafe=true;
        document.body.dataset.testStatus='pass';
      } catch(error) {document.body.dataset.testStatus='fail';document.body.dataset.testError=error.stack||error.message;}
      finally {window.Image=nativeImage;}
      document.body.dataset.testMetrics=JSON.stringify(metrics);
    })();
        })();</script>`);
    const file = path.join(temp, 'index.html');
    for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new (require('node:vm').Script)(script[1]);
    fs.writeFileSync(file, html);
    const result = await runChromiumDom(process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', file, path.join(temp, 'profile'));
    const body = result.match(/<body[^>]*>/)?.[0] || '';
    console.log(body);
    assert.match(body, /data-test-status="pass"/);
    console.log('archive-main-list-browser: PASS current/stale image success/error, source-bound drag/drop, empty queued virtual render; real Chromium with synthetic DOM input and controlled image callback timing');
  } finally { removeTemporaryDirectory(temp); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
