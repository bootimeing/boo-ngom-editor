const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {runChromiumDom}=require('./helpers/chromium-dom');
const {removeTemporaryDirectory}=require('./helpers/temp-cleanup');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'boo-quick-import-dom-'));
async function main(){try{
  const runtime=path.resolve(process.env.BOO_PAK_RUNTIME_ROOT||path.join(__dirname,'..'));
  let html=fs.readFileSync(path.join(runtime,'media/editor.html'),'utf8');
  html=html.replace('<script>','<script>window.__messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__messages.push(m),getState(){return{}},setState(){}});</script><script>');
  html=html.replace('</body>',`<script>(async()=>{
    const assert=(ok,message)=>{if(!ok)throw Error(message)}, $=id=>document.getElementById(id);
    const send=data=>window.dispatchEvent(new MessageEvent('message',{data}));
    const open=type=>document.querySelector('[data-action="select'+(type==='closeBtn'?'CloseBtn':type==='equipFrame'?'EquipFrame':'ProgressBar')+'Files"]').click();
    const last=type=>window.__messages.findLast(message=>message.type===type),saveCount=()=>window.__messages.filter(m=>m.type==='saveQuickImport').length;
    try{
      const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;const url=canvas.toDataURL();
      const startupErrors=[];window.addEventListener('error',event=>startupErrors.push(event.message));
      send({type:'loadQuickImports',imports:{closeBtn:{name:'startup',imageIdx:999999,willIdx:7,pakName:'million.pak',archiveId:'a'.repeat(64),url:'stale://old'}}});
      assert(!startupErrors.length,'saved direct metadata before first asset catalog does not throw');
      const load=()=>send({type:'loadAssets',files:[],pakMode:true,pakList:[]});load();
      for(const [type,local,confirm,selected,modal]of [
        ['closeBtn',()=>window.selectCloseBtnLocal(),()=>window.confirmCloseBtnSelection(),'_closeBtnSelected','closeBtnDialog'],
        ['equipFrame',()=>window.selectEquipFrameLocal(),()=>window.confirmEquipFrameSelection(),'_equipFrameSelected','equipFrameDialog']]){
        open(type);local();const first=last('selectQuickImportFile');
        assert(Number.isSafeInteger(first.requestId)&&Number.isSafeInteger(first.sessionId),type+' picker request needs exact identities');
        window.closeArchiveAssetSelectors();open(type);
        send({...first,type:'loadQuickImport',url,name:'stale.png',filePath:'stale.png'});
        assert(!window[selected],type+' closed/reopened modal rejects old response');
        local();const current=last('selectQuickImportFile'),before=saveCount();
        send({...current,type:'loadQuickImport',requestId:current.requestId+1,url,name:'bad.png'});
        send({...current,type:'loadQuickImport',sessionId:current.sessionId+1,url,name:'bad.png'});
        assert(!window[selected],type+' mismatched request/session cannot preview');
        send({...current,type:'loadQuickImport',url,name:'picked.png',filePath:'picked.png'});
        assert(window[selected]?.name==='picked.png',type+' valid result previews');
        assert(saveCount()===before,type+' picker never saves before explicit confirmation');
        window.closeArchiveAssetSelectors();open(type);assert(!window[selected],type+' cancel modal must not mutate quick imports');
        local();const cancel=last('selectQuickImportFile');send({...cancel,type:'loadQuickImport',cancelled:true});
        send({...cancel,type:'loadQuickImport',url,name:'replay.png'});assert(!window[selected],type+' cancelled request cannot replay');
        local();const latest=last('selectQuickImportFile');send({...latest,type:'loadQuickImport',url,name:'confirmed.png',filePath:'confirmed.png'});confirm();
        assert(saveCount()===before+1&&last('saveQuickImport').filePath==='confirmed.png',type+' explicit local confirmation saves once');
        open(type);local();const changed=last('selectQuickImportFile');load();open(type);
        send({...changed,type:'loadQuickImport',url,name:'wrong-source.png'});assert(window[selected]?.name!=='wrong-source.png',type+' source replacement rejects late result');
        window.closeArchiveAssetSelectors();
      }
      open('progressBar');window.selectProgressBarBgLocal();const bg=last('selectQuickImportFile');window.selectProgressBarFillLocal();const fill=last('selectQuickImportFile');
      send({...bg,type:'loadQuickImport',url,name:'bg.png'});send({...fill,type:'loadQuickImport',url,name:'fill.png'});
      assert(window._progressBarBgSelected?.name==='bg.png'&&window._progressBarFillSelected?.name==='fill.png','progress picker channels are independent');
      window.closeProgressBarDialog();open('progressBar');assert(!window._progressBarBgSelected&&!window._progressBarFillSelected,'progress result remains temporary');window.closeProgressBarDialog();
      const archiveId='a'.repeat(64),saved={name:'frame',imageIdx:999999,willIdx:7,pakName:'million.pak',archiveId,assetIdx:0};
      send({type:'loadQuickImports',imports:{closeBtn:saved,equipFrame:saved}});
      for(const type of ['closeBtn','equipFrame']){open(type);assert(!window[type==='closeBtn'?'_closeBtnSelected':'_equipFrameSelected'],'unresolved archive import has no stale URL');window.closeArchiveAssetSelectors();}
      const segment={kind:'direct',pakName:'million.pak',pakPath:'fixture.pak',willIdx:7,source:'pak',archiveId,indexGeneration:'b'.repeat(32),profileId:'pack4-plain-bgra',slotCount:1000000,urlTemplate:url+'#{id}',records:[[999999,4,4,0,0,'decoded']]};
      const loadCatalog=segments=>send({type:'loadAssets',assetCatalog:{version:1,segments},pakMode:true,pakList:[{name:'million.pak',willIdx:7}]});
      loadCatalog([segment]);
      for(const type of ['closeBtn','equipFrame']){open(type);const item=window[type==='closeBtn'?'_closeBtnSelected':'_equipFrameSelected'];
        assert(item?.imageIdx===999999&&item.willIdx===7&&item.url.endsWith('#999999')&&item.archiveId===archiveId,type+' retained archive identity resolves when assets arrive');window.closeArchiveAssetSelectors();}
      loadCatalog([{...segment,indexGeneration:'c'.repeat(32)}]);open('closeBtn');assert(window._closeBtnSelected?.url,'index generation rebuild preserves stable archive identity');window.closeArchiveAssetSelectors();
      loadCatalog([{...segment,archiveId:'d'.repeat(64)}]);open('closeBtn');assert(!window._closeBtnSelected,'same-name different archive cannot inherit old saved slot');window.closeArchiveAssetSelectors();
      load();send({type:'loadQuickImports',imports:{closeBtn:{...saved,archiveId:undefined}}});
      loadCatalog([segment,{...segment,archiveId:'d'.repeat(64),pakPath:'other.pak'}]);open('closeBtn');assert(!window._closeBtnSelected,'ambiguous package/logical slot is not guessed');window.closeArchiveAssetSelectors();
      document.body.dataset.testStatus='pass';
    }catch(error){document.body.dataset.testStatus='fail';document.body.dataset.testError=error.stack||String(error);}
  })();</script></body>`);
  const file=path.join(temporary,'test.html');fs.writeFileSync(file,html);
  const dom=await runChromiumDom(process.env.BOO_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',file,path.join(temporary,'profile'));
  const body=dom.match(/<body[^>]*>/)?.[0]||'';console.log(body);assert.match(body,/data-test-status="pass"/);
  console.log('quick-import-browser.test.js: PASS (production DOM, exact picker identities, temporary preview/explicit save, stable archive restoration; synthetic events)');
}finally{removeTemporaryDirectory(temporary);}}
main().catch(error=>{console.error(error);process.exitCode=1;});
