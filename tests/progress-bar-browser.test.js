const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-progress-dom-'));
async function main() { try {
  let html = fs.readFileSync(path.join(runtime, 'media/editor.html'), 'utf8');
  html = html.replace('<script>', '<script>window.__messages=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__messages.push(m);},getState(){return{}},setState(){}});</script><script>');
  html = html.replace('</body>', `<script>
  (async function(){
    const $=id=>document.getElementById(id), assert=(ok,m)=>{if(!ok)throw Error(m);};
    const wait=p=>new Promise((res,rej)=>{let n=0;const tick=()=>p()?res():n++>200?rej(Error('wait timeout')):setTimeout(tick,10);tick();});
    const metrics={};window.addEventListener('error',e=>{metrics.runtimeError=e.message;});
    try {
      const c=document.createElement('canvas');c.width=32;c.height=16;c.getContext('2d').fillRect(0,0,32,16);const url=c.toDataURL();
      const files=Array.from({length:20000},(_,id)=>({name:String(id).padStart(6,'0'),imageIdx:id,localIdx:id,
        pakName:id<10000?'first.pak':'second.pak',willIdx:id<10000?1:7,width:32,height:16,offsetX:0,offsetY:0,isBlank:false,decodeStatus:'decoded',url}));
      const load=files=>window.dispatchEvent(new MessageEvent('message',{data:{type:'loadAssets',files,pakMode:true,
        pakList:[{name:'first.pak',willIdx:1},{name:'second.pak',willIdx:2}],totalCount:files.length,folderName:'fixture'}}));
      load(files);
      const start=performance.now();document.querySelector('[data-action="selectProgressBarFiles"]').click();
      metrics.openSyncMs=performance.now()-start;
      metrics.items=document.querySelectorAll('#progressBarPakGrid .dialog-asset-item').length;
      metrics.images=document.querySelectorAll('#progressBarPakGrid img').length;
      metrics.totalSlots=files.length;
      assert(metrics.items===100,'opening must create a 100-item page, actual='+metrics.items);
      $('progressBarPageNext').click();
      assert(document.querySelector('#progressBarPakGrid [data-asset-index="100"]'),'next page preserves original array/slot identity');
      $('progressBarPagePrev').click();
      assert(document.querySelector('#progressBarPakGrid [data-asset-index="0"]'),'previous page restores the first slot');
      const filter=$('progressBarPakFilter');assert(filter,'package filter exists');filter.value='second.pak';filter.dispatchEvent(new Event('change'));
      $('progressBarSlotSearch').value='19999';$('progressBarSlotSearch').dispatchEvent(new Event('input'));
      metrics.stage='search';await wait(()=>document.querySelector('#progressBarPakGrid [data-asset-index="19999"]'));
      assert(document.querySelectorAll('#progressBarPakGrid .dialog-asset-item').length===100,'numeric ID navigates without hiding neighboring items');
      assert(document.querySelector('#progressBarPakGrid [data-asset-index="19999"].archive-id-target'),'located item highlighted');
      document.querySelector('#progressBarPakGrid [data-asset-index="19999"]').click();
      document.querySelector('input[name="progressBarSlot"][value="fill"]').click();
      document.querySelector('#progressBarPakGrid [data-asset-index="19999"]').click();
      metrics.stage='preview';await wait(()=>$('progressBarComposite').dataset.drawn==='true');
      let created=0;const NativeImage=window.Image;window.Image=function(){created++;return new NativeImage();};
      const offsetStart=performance.now();
      for(let i=0;i<100;i++){$('progressBarOffsetX').value=i;$('progressBarOffsetX').dispatchEvent(new Event('input'));}
      metrics.stage='offset';await wait(()=>$('progressBarComposite').dataset.offsetX==='99');
      metrics.offsetBurstMs=performance.now()-offsetStart;metrics.newImagesOnOffset=created;
      assert(created===0,'offset changes reuse decoded images');window.Image=NativeImage;
      window.confirmProgressBarSelection();
      const save=window.__messages.findLast(m=>m.type==='saveQuickImport'&&m.importType==='progressBar');
      assert(save?.data.bg.imageIdx===19999&&save.data.fill.imageIdx===19999&&save.data.offsetX===99&&save.data.willIdx===7,'save preserves original ID, package index and offset');
      document.querySelector('[data-action="selectProgressBarFiles"]').click();
      window.confirmProgressBarSelection();
      const reopened=window.__messages.findLast(m=>m.type==='saveQuickImport'&&m.importType==='progressBar');
      assert(reopened.data.willIdx===7&&reopened.data.bg.willIdx===7&&reopened.data.fill.willIdx===7,
        'reopening and confirming must preserve package index for both images');
      assert(reopened.data.bg.imageIdx===19999&&reopened.data.fill.imageIdx===19999&&reopened.data.offsetX===99,
        'reconfirming preserves image IDs and offsets');
      const saveCount=()=>window.__messages.filter(m=>m.type==='saveQuickImport'&&m.importType==='progressBar').length;
      const beforeMismatch=saveCount();
      document.querySelector('[data-action="selectProgressBarFiles"]').click();
      document.querySelector('#progressBarPakGrid [data-asset-index="0"]').click();
      document.querySelector('input[name="progressBarSlot"][value="fill"]').click();
      $('progressBarPakFilter').value='second.pak';$('progressBarPakFilter').dispatchEvent(new Event('change'));
      await wait(()=>document.querySelector('#progressBarPakGrid [data-asset-index="10000"]'));
      document.querySelector('#progressBarPakGrid [data-asset-index="10000"]').click();window.confirmProgressBarSelection();
      assert(saveCount()===beforeMismatch&&$('progressBarDialog'),'cross-package background/fill must remain rejected');
      window.closeProgressBarDialog();
      for(let i=0;i<5;i++){document.querySelector('[data-action="selectProgressBarFiles"]').click();window.closeProgressBarDialog();}
      assert(!document.querySelector('#progressBarDialog'),'repeat close releases dialog');
      document.querySelector('[data-action="selectProgressBarFiles"]').click();load(files.slice(0,2));
      // An old selection must not be applied after the data source has been replaced.
      window.confirmProgressBarSelection();
      assert(saveCount()===2,'source replacement invalidates dialog');window.closeProgressBarDialog();
      load(files.slice(0,2).map(asset=>({...asset,willIdx:undefined})));
      document.querySelector('[data-action="selectProgressBarFiles"]').click();
      document.querySelector('#progressBarPakGrid [data-asset-index="0"]').click();
      document.querySelector('input[name="progressBarSlot"][value="fill"]').click();
      document.querySelector('#progressBarPakGrid [data-asset-index="1"]').click();window.confirmProgressBarSelection();
      let noIndex=window.__messages.findLast(m=>m.type==='saveQuickImport'&&m.importType==='progressBar');
      assert(noIndex.data.willIdx===undefined&&noIndex.data.bg.willIdx===undefined&&noIndex.data.fill.willIdx===undefined,
        'new images with unknown package index must not borrow index 7 from the previous selection');
      document.querySelector('[data-action="selectProgressBarFiles"]').click();window.confirmProgressBarSelection();
      noIndex=window.__messages.findLast(m=>m.type==='saveQuickImport'&&m.importType==='progressBar');
      assert(noIndex.data.willIdx===undefined,'reopening unknown package index must not fabricate zero');
      const oldBg={name:'000000',imageIdx:0,pakName:'first.pak',url},oldFill={...oldBg,name:'000001',imageIdx:1};
      window.dispatchEvent(new MessageEvent('message',{data:{type:'loadQuickImports',imports:{progressBar:{bg:oldBg,fill:oldFill,
        willIdx:0,offsetX:-8,offsetY:3}}}}));
      document.querySelector('[data-action="selectProgressBarFiles"]').click();window.confirmProgressBarSelection();
      const legacy=window.__messages.findLast(m=>m.type==='saveQuickImport'&&m.importType==='progressBar');
      assert(legacy.data.willIdx===0&&legacy.data.bg.willIdx===0&&legacy.data.fill.willIdx===0,
        'legacy pair-level package index, including explicit zero, restores into both saved images');
      assert(legacy.data.offsetX===-8&&legacy.data.offsetY===3,'legacy reopen preserves negative and positive offsets');
      document.body.dataset.testStatus='pass';
    }catch(e){document.body.dataset.testStatus='fail';document.body.dataset.testError=e.message;metrics.bg=window._progressBarBgSelected?.name;metrics.fill=window._progressBarFillSelected?.name;metrics.canvas=$('progressBarComposite')?.outerHTML;}
    document.body.dataset.testMetrics=JSON.stringify(metrics);
  })();</script></body>`);
  const file=path.join(temporary,'test.html');fs.writeFileSync(file,html);
  const browser=process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert.ok(fs.existsSync(browser),'real Chrome required');
  const result=await runChromiumDom(browser,file,path.join(temporary,'profile'));
  const body=result.match(/<body[^>]*>/)?.[0];
  console.log(body || 'no DOM');
  assert.match(body||'',/data-test-status="pass"/);
  console.log('progress-bar-browser.test.js: PASS (production HTML, 20000 slots, bounded DOM, pagination/filter/search, reuse, save/reopen package identity, cross-package rejection, unknown/legacy index, source switch; synthetic browser events)');
} finally { removeTemporaryDirectory(temporary); } }
main().catch(error=>{console.error(error);process.exitCode=1;});
