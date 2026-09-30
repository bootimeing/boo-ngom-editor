const assert = require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const { runChromiumDom }=require('./helpers/chromium-dom');
const { removeTemporaryDirectory }=require('./helpers/temp-cleanup');
const runtime=path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname,'..'));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'boo-selectors-dom-'));
async function main(){try{
  let html=fs.readFileSync(path.join(runtime,'media/editor.html'),'utf8');
  html=html.replace('<script>','<script>window.__messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__messages.push(m),getState(){return{}},setState(){}});</script><script>');
  html=html.replace('</body>',`<script>(async()=>{
    const $=id=>document.getElementById(id),assert=(value,message)=>{if(!value)throw Error(message);};
    const wait=p=>new Promise((resolve,reject)=>{let n=0;const tick=()=>p()?resolve():n++>250?reject(Error('wait timeout')):setTimeout(tick,10);tick();});
    const change=(node,value)=>{node.value=value;
      if(node.classList.contains('archive-selector-query')){node.dispatchEvent(new Event('input',{bubbles:true}));node.parentElement.querySelector('.archive-selector-locate').click();}
      else node.dispatchEvent(new Event('change',{bubbles:true}));};
    const defs=[['imageSelectorModal',()=>window.showImageSelector(),()=>window.closeImageSelector()],
      ['buttonSelectorModal',()=>window.showButtonSelector(),()=>window.closeButtonSelector()],
      ['effectSelectorModal',()=>window.showEffectSelector(),()=>window.closeEffectSelector()],
      ['closeBtnDialog',()=>document.querySelector('[data-action="selectCloseBtnFiles"]').click(),()=>window.closeArchiveAssetSelectors()],
      ['equipFrameDialog',()=>document.querySelector('[data-action="selectEquipFrameFiles"]').click(),()=>window.closeArchiveAssetSelectors()]];
    const metrics=[];
    try{
      const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;const url=canvas.toDataURL();
      const files=Array.from({length:20000},(_,i)=>({name:i===11234?'needle<literal>':String(i%10000).padStart(6,'0'),imageIdx:i%10000,localIdx:i%10000,
        pakName:i<10000?'first.pak':'second.pak',willIdx:i<10000?2:7,width:4,height:4,offsetX:0,offsetY:0,url,
        decodeStatus:i===0?'empty':i===1?'corrupt':i===2?'unsupported':i===3?'recovered':'decoded',isBlank:i===0,
        failureCode:i===1?'decompression-failed':i===2?'unsupported-pixel-layout':i===3?'checksum-recovered':undefined}));
      const load=(files,catalog)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'loadAssets',files,assetCatalog:catalog,pakMode:true,
        pakList:catalog?[{name:'million.pak',willIdx:7}]:[{name:'first.pak',willIdx:2},{name:'second.pak',willIdx:7}]}}));
      load(files);
      for(const [id,open,close]of defs){
        const start=performance.now();open();const modal=$(id);
        const n=modal.querySelectorAll('.dialog-asset-item').length;
        metrics.push({id,slots:20000,items:n,openMs:performance.now()-start});assert(n===100,id+' must render 100 slots, got '+n);
        for(const bad of [0,1,2])assert(modal.querySelector('[data-idx="'+bad+'"]').disabled,id+' unavailable slot is disabled');
        assert(!modal.querySelector('[data-idx="3"]').disabled,id+' recovered slot stays selectable');
        modal.querySelector('.archive-selector-next').click();assert(modal.querySelector('[data-idx="100"]'),id+' next page keeps global identity');
        modal.querySelector('.archive-selector-prev').click();assert(modal.querySelector('[data-idx="0"]'),id+' previous page');
        change(modal.querySelector('.archive-selector-pak'),'second.pak');
        change(modal.querySelector('.archive-selector-query'),'1234');
        assert(modal.querySelectorAll('.dialog-asset-item').length===100&&modal.querySelector('[data-idx="11234"].archive-id-target'),id+' exact logical ID located among neighboring items in selected package');
        change(modal.querySelector('.archive-selector-query'),'needle<literal>');
        assert(modal.querySelector('[data-idx="11234"]')&&!modal.querySelector('literal'),id+' literal name search is escaped');
        close();assert(!$(id),id+' close removes modal');
      }
      // Every modal closes and rejects old work when the source list is replaced.
      for(const [id,open]of defs){open();load(files.slice(0,8));assert(!$(id),id+' source replacement closes selector');load(files);}
      // Buttons keep a single package and slot IDs across page changes.
      window.showButtonSelector();let modal=$('buttonSelectorModal');
      modal.querySelector('[data-idx="3"]').click();change(modal.querySelector('.archive-selector-pak'),'second.pak');
      modal.querySelector('[data-idx="10000"]').click();assert(window.buttonSelection.images[1]===null,'cross-package button frames rejected');
      change(modal.querySelector('.archive-selector-pak'),'first.pak');modal.querySelector('.archive-selector-next').click();
      modal.querySelector('[data-idx="100"]').click();modal.querySelector('[data-idx="101"]').click();
      assert(JSON.stringify(window.buttonSelection.images)==='[3,100,101]','button selection spans pages without renumbering');window.closeButtonSelector();
      const snapshot=()=>{window.dispatchEvent(new MessageEvent('message',{data:{type:'getFullState'}}));return window.__messages.findLast(message=>message.type==='fullState').elements;};
      const choose=(id,pak,logical)=>{const modal=$(id);change(modal.querySelector('.archive-selector-pak'),pak);change(modal.querySelector('.archive-selector-query'),String(logical));
        const item=modal.querySelector('.dialog-asset-item.archive-id-target');assert(item&&!item.disabled,'selectable located item');item.click();};
      window.showImageSelector();choose('imageSelectorModal','second.pak',1234);
      await wait(()=>snapshot().some(element=>element.isImgTag));
      const imageElement=snapshot().find(element=>element.isImgTag);
      assert(imageElement.assetIdx===1234&&imageElement.willIdx===7,'image commit uses logical ID and package index, not global 11234');
      window.showButtonSelector();choose('buttonSelectorModal','second.pak',1234);choose('buttonSelectorModal','second.pak',1235);choose('buttonSelectorModal','second.pak',1236);
      window.confirmAddButton();await wait(()=>snapshot().some(element=>element.isButton));
      const button=snapshot().find(element=>element.isButton);
      assert(JSON.stringify(button.buttonImages)==='[1234,1235,1236]'&&button.willIdx===7,'button commit keeps all three logical IDs and package index');
      window.showEffectSelector();choose('effectSelectorModal','second.pak',1234);$('effectFrameCount').value='2';$('effectX').value='-4';$('effectY').value='8';
      window.confirmAddEffect();await wait(()=>snapshot().some(element=>element.isEffect));
      const effect=snapshot().find(element=>element.isEffect);
      assert(effect.effectStartIdx===1234&&effect.effectFrameCount===2&&effect.willIdx===7&&effect.x===-4&&effect.y===8,'effect commit honors entered frame count and logical coordinates');
      for(const [id,open,type,confirm]of [[defs[3][0],defs[3][1],'closeBtn',()=>window.confirmCloseBtnSelection()],
        [defs[4][0],defs[4][1],'equipFrame',()=>window.confirmEquipFrameSelection()]]){
        open();choose(id,'second.pak',1234);confirm();const saved=window.__messages.findLast(message=>message.type==='saveQuickImport'&&message.importType===type);
        assert(saved.imageIdx===1234&&saved.willIdx===7&&saved.pakName==='second.pak',type+' save preserves resource identity');
        open();confirm();const resaved=window.__messages.findLast(message=>message.type==='saveQuickImport'&&message.importType===type);
        assert(resaved.imageIdx===1234&&resaved.willIdx===7,type+' reopened selection preserves resource identity');
      }
      const oldCount=snapshot().length,NativeImage=window.Image,pending=[];
      window.Image=function(){const image=new NativeImage();pending.push(image);return image;};
      window.showImageSelector();choose('imageSelectorModal','second.pak',1234);const oldLoad=pending.at(-1).onload;
      load(files.slice(0,8));oldLoad();assert(snapshot().length===oldCount,'source replacement cancels late image commit');window.Image=NativeImage;
      // Confirmed work belongs to the source, not to the next modal's session.
      load(files);
      for(const kind of ['image','button','effect']){
        const held=[];window.Image=function(){const image=new NativeImage();let callback;
          Object.defineProperty(image,'onload',{get:()=>callback,set:value=>{callback=value}});held.push(image);return image;};
        const before=snapshot().length;
        if(kind==='image'){window.showImageSelector();choose('imageSelectorModal','second.pak',1234);}
        if(kind==='button'){window.showButtonSelector();for(const id of [1234,1235,1236])choose('buttonSelectorModal','second.pak',id);window.confirmAddButton();}
        if(kind==='effect'){window.showEffectSelector();choose('effectSelectorModal','second.pak',1234);$('effectFrameCount').value='2';window.confirmAddEffect();}
        window.Image=NativeImage;window.showImageSelector();
        await wait(()=>held.length>0&&held.every(image=>image.complete&&image.naturalWidth>0));held.forEach(image=>image.onload());
        assert(snapshot().length===before+1,kind+' confirmed same-source commit survives opening next selector');window.closeImageSelector();
      }
      // Actual compact production protocol: one million logical slots, only three records.
      const catalog={version:1,segments:[{kind:'direct',pakName:'million.pak',pakPath:'fixture.pak',willIdx:7,source:'pak',archiveId:'a'.repeat(64),
        indexGeneration:'b'.repeat(32),profileId:'pack4-plain-bgra',slotCount:1000000,urlTemplate:url+'#{id}',
        records:[[0,4,4,0,0,'decoded'],[500000,4,4,0,0,'decoded'],[999999,4,4,0,0,'decoded']]}]};
      load(undefined,catalog);
      for(const [id,open,close]of defs){
        const start=performance.now();open();const modal=$(id);assert(modal,id+' compact source opens');
        const n=modal.querySelectorAll('.dialog-asset-item').length;metrics.push({id,slots:1000000,items:n,openMs:performance.now()-start});
        assert(n===100,id+' compact million slots remain bounded');
        change(modal.querySelector('.archive-selector-query'),'999999');
        assert(modal.querySelectorAll('.dialog-asset-item').length===100&&!modal.querySelector('[data-idx="999999"].archive-id-target').disabled,id+' compact last slot is reachable with neighboring slots');
        close();
      }
      document.body.dataset.testStatus='pass';
    }catch(error){document.body.dataset.testStatus='fail';document.body.dataset.testError=error.stack||String(error);}
    document.body.dataset.testMetrics=JSON.stringify(metrics);
  })();</script></body>`);
  const file=path.join(temporary,'test.html');fs.writeFileSync(file,html);
  const result=await runChromiumDom(process.env.BOO_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',file,path.join(temporary,'profile'));
  const body=result.match(/<body[^>]*>/)?.[0];console.log(body||'no DOM');assert.match(body||'',/data-test-status="pass"/);
  console.log('archive-selectors-browser.test.js: PASS (five production selectors, 20000 array/million compact slots, 100-item pages, ID navigation/name filter/package, status gates, source invalidation; synthetic DOM events)');
}finally{removeTemporaryDirectory(temporary);}}
main().catch(error=>{console.error(error);process.exitCode=1;});
