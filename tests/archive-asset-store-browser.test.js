const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {runChromiumDom}=require('./helpers/chromium-dom');
const {removeTemporaryDirectory}=require('./helpers/temp-cleanup');
const runtime=path.resolve(process.env.BOO_PAK_RUNTIME_ROOT||path.join(__dirname,'..'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'boo-compact-store-'));
async function main(){try{
 let html=fs.readFileSync(path.join(runtime,'media/editor.html'),'utf8');
 html=html.replace('<script>','<script>window.testMessages=[];window.acquireVsCodeApi=()=>({postMessage(m){window.testMessages.push(m);},getState(){return{}},setState(){}});</script><script>');
 html=html.replace(/        \}\)\(\);\s*<\/script>/,`
 (async function(){const assert=(v,m)=>{if(!v)throw Error(m);},$=id=>document.getElementById(id);
 const wait=p=>new Promise((res,rej)=>{let n=0;const tick=()=>p()?res():n++>200?rej(Error('wait timeout')):setTimeout(tick,10);tick();});
 const metrics={};try{
   const c=document.createElement('canvas');c.width=32;c.height=16;c.getContext('2d').fillRect(0,0,32,16);const url=c.toDataURL();
   const catalog={version:1,segments:[{kind:'direct',pakName:'million.pak',pakPath:'fixture.pak',willIdx:7,source:'pak',
     archiveId:'a'.repeat(64),indexGeneration:'b'.repeat(32),profileId:'pack4-plain-bgra',slotCount:1000000,urlTemplate:url+'#{id}',
     records:[[0,32,16,-23,17,'decoded'],[500000,32,16,0,0,'recovered','checksum-recovered'],[999999,32,16,0,0,'indexed-unverified']]}]};
   metrics.catalogBytes=new TextEncoder().encode(JSON.stringify(catalog)).length;assert(metrics.catalogBytes<10240,'sparse descriptor must be under 10 KiB');
   const load=catalog=>window.dispatchEvent(new MessageEvent('message',{data:{type:'loadAssets',assetCatalog:catalog,pakMode:true,pakList:[{name:'million.pak',willIdx:7}]}}));
   const start=performance.now();load(catalog);metrics.loadMs=performance.now()-start;
   assert(folderAssets.length===1000000,'million logical slots retained');assert(folderAssets._store.cacheSize()<200,'opening materializes visible rows only');
   assert($('fileCount').textContent==='1000000 槽 · 3 图 · 999997 空','metadata counts without full scan');
   assert(findAssetIndexByCode(7,999999)===999999&&findAssetIndexByCode(8,999999)===-1,'code index uses package identity');
   assert(assetSelectionView('million.pak','999999').at(0)===999999,'tail exact search');
   assert(assetSelectionView('million.pak','not-a-number').length===0,'canonical direct names do not invent text matches');
   const pinned=folderAssets[0];for(let i=1;i<3000;i++)void folderAssets[i];
   assert(folderAssets._store.cacheSize()===1024,'materialized object cache bound');assert(sameAssetIdentity(pinned,folderAssets[0]),'identity survives LRU eviction');
   const store=folderAssets._store,tail=folderAssets[999999];tail.decodeStatus='corrupt';tail.failureCode='invalid-image-header';store.commit(tail,'indexed-unverified');
   assert(store.count().failed===1&&store.serialize().segments[0].records[2][5]==='corrupt','status changes survive eviction/serialization');
   tail.decodeStatus='decoded';tail.failureCode=undefined;store.commit(tail,'corrupt');assert(store.count().failed===0&&!!folderAssets[999999].url,'recovered availability and counts');
   // Two retained references can outlive LRU eviction; count the canonical state exactly once.
   const oldZero=folderAssets[0];for(let i=1;i<1500;i++)void folderAssets[i];const newZero=folderAssets[0];
   oldZero.decodeStatus='corrupt';oldZero.failureCode='invalid-image-header';store.commit(oldZero,'decoded');
   newZero.decodeStatus='corrupt';newZero.failureCode='invalid-image-header';store.commit(newZero,'decoded');
   assert(store.count().failed===1,'duplicate replies after LRU eviction do not double-count failure');
   // Newest request wins even if its reply arrives before an older request.
   function pending(id){const request={requestId:id,assetGeneration:_archiveAssetGeneration,archiveId:catalog.segments[0].archiveId,indexGeneration:catalog.segments[0].indexGeneration};
     _archivePendingRequests.set(id,{at:Date.now(),request,slots:new Map([[0,folderAssets[0]]])});
     _archiveLatestSlotRequests.set(archiveInspectionSlotKey(request,0),id);return request;}
   const older=pending(9001),newer=pending(9002);
   receiveArchiveInspection({...newer,slots:[{logicalIndex:0,status:'decoded'}]});
   receiveArchiveInspection({...older,slots:[{logicalIndex:0,status:'corrupt',reasonCode:'invalid-image-header'}]});
   assert(store.count().failed===0&&folderAssets[0].decodeStatus==='decoded','late older result cannot restore a stale failure');
   assert(!_archivePendingRequests.has(9001)&&!_archivePendingRequests.has(9002)&&_archiveLatestSlotRequests.size<=3200,'request identities retired and bounded');
   // Force one-column, > CSS pixel-limit geometry; logical tail remains reachable.
   $('assetsList').style.width='95px';renderAllAssets();assert(_virtualList.colCount===1&&_virtualList.scrollScale>1,'compressed scroll surface');
   $('archiveSlotId').value='999999';locateArchiveAsset();await wait(()=>$('archiveInspectorStatus').textContent==='已显示');
   assert(document.querySelector('#assetsList [data-idx="999999"]'),'tail rendered on actual bounded scroll surface');closeArchiveInspector();
   // Request an actual full-state message: no million-element materialization/Proxy enters IPC.
   window.dispatchEvent(new MessageEvent('message',{data:{type:'getFullState'}}));const state=window.testMessages.findLast(m=>m.type==='fullState');
   assert(state.assetCatalog&&state.folderAssets===undefined,'full state carries compact plain catalog');
   metrics.fullStateBytes=new TextEncoder().encode(JSON.stringify(state)).length;assert(metrics.fullStateBytes<16000,'full state remains compact');
   const cloned=structuredClone(state);assert(cloned.assetCatalog.segments[0].slotCount===1000000,'IPC data is cloneable');
   // Two archives with the same logical ID must require disambiguation and keep their offsets.
   const second={...catalog.segments[0],pakName:'other.pak',willIdx:8,archiveId:'c'.repeat(64),slotCount:2,records:[[0,5,6,7,-8,'decoded']]};
   load({version:1,segments:[catalog.segments[0],second,{kind:'files',files:[{name:'old.png',path:'old.png',url,width:2,height:3,willIdx:9,imageIdx:27,pakName:'legacy',isBlank:false}]}]});
   assert(findAssetIndexByCode(8,0)===1000000&&folderAssets[1000000].offsetY===-8,'cross-package ID and offsets');
   assert(findAssetIndexByCode(9,27)===1000002,'legacy mixed segment');
   assert(assetSelectionView('','0').length===2&&assetSelectionView('other.pak','0').length===1,'duplicate ID query preserves choices');
   assert(assetSelectionView('legacy','old').at(0)===1000002,'legacy name search');
   const before=folderAssets,previousPaks=window._pakList,previousMode=window._pakMode;
   window.dispatchEvent(new MessageEvent('message',{data:{type:'loadAssets',assetCatalog:{...catalog,version:99},pakMode:false,pakList:[{name:'invalid'}]}}));
   assert(folderAssets===before&&window._pakList===previousPaks&&window._pakMode===previousMode,'invalid catalog preserves assets and mode atomically');
   for(const change of [{slotCount:1000001},{source:'unknown'},{willIdx:-1},{urlTemplate:url},{records:[[0,-1,16,0,0,'decoded']]},
     {records:[[0,32,16,0,0,'indexed-unverified','bad']]},{records:[[0,32,16,0,0,'empty']]}]){
     let rejected=false;try{createAssetStore({version:1,segments:[{...catalog.segments[0],...change}]});}catch(e){rejected=true;}
     assert(rejected,'invalid direct descriptor must be rejected');
   }
   window.dispatchEvent(new MessageEvent('message',{data:{type:'appendAssets',files:[{name:'new.png',url,imageIdx:28,width:1,height:1}]}}));
   assert(folderAssets.length===1000004&&folderAssets[1000003].name==='new.png','append does not flatten existing ranges');
   metrics.finalCache=folderAssets._store.cacheSize();document.body.dataset.testStatus='pass';
 }catch(e){document.body.dataset.testStatus='fail';document.body.dataset.testError=e.stack||e.message;}
 document.body.dataset.testMetrics=JSON.stringify(metrics);
 })();
        })();</script>`);
 const file=path.join(temp,'index.html');fs.writeFileSync(file,html);
 const result=await runChromiumDom(process.env.BOO_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',file,path.join(temp,'profile'));
 const body=result.match(/<body[^>]*>/)?.[0]||'';console.log(body);assert.match(body,/data-test-status="pass"/);
 console.log('archive-asset-store-browser: PASS million logical slots, bounded objects/DOM/IPC, tail scroll, identity, status, legacy and source replacement; synthetic DOM input');
}finally{removeTemporaryDirectory(temp);}}
main().catch(e=>{console.error(e);process.exitCode=1;});
