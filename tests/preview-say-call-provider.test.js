const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test'),{manager}=require('./helpers/preview-image-hydration');
const {source:baseSource}=require('./preview-say-call.test');
const source=baseSource.replace('WHILE N0 < 3','WHILE N0 < U101');
async function run(){
 const host=manager(),posted=[];
 const session={key:'say-call',model:parse(source,{U101:'3'},'GOM',{previewPath:[]}),document:{version:1,getText:()=>source},dirty:true,conflict:false,modelRevision:1,previewConditions:{},previewValues:{U101:'3'},panel:{webview:{postMessage:m=>posted.push(m)}}};
 host.sessions=new Map([[session.key,session]]);host.hydrateAssets=async()=>{};
 host.createModel=async(_d,_c,_l,_s,values,_call,previewPath)=>parse(source,values,'GOM',{previewPath});
 const revision=()=>session.publishedPreview?.revision||session.modelRevision;
 for(const i of [0,2,1]){
   const element=session.model.pages.find(p=>p.sourceLabel==='@main').elements[i];
   await host.onMessage(session,{type:'previewNavigate',trigger:'click',previewRevision:revision(),elementId:element.id,sayOccurrence:99});
   assert.equal(session.previewPath[0].sayOccurrence,i,'browser cannot choose occurrence');
   assert.equal(session.model.pages.find(p=>p.sourceLabel==='@page').elements[0].text,'参数='+i);
   assert.equal(session.dirty,true);
   const before=session.modelRevision;
   await host.onMessage(session,{type:'previewNavigate',trigger:'click',previewRevision:0,elementId:element.id});
   assert.equal(session.modelRevision,before);
   await host.onMessage(session,{type:'previewBack',previewRevision:revision()});
   assert.equal(session.model.previewNavigation.activeLabel,'@main');
 }
 const last=session.model.pages.find(p=>p.sourceLabel==='@main').elements[2];
 await host.onMessage(session,{type:'previewNavigate',trigger:'click',previewRevision:revision(),elementId:last.id});
 assert.equal(session.model.previewNavigation.activeLabel,'@page');
 await host.onMessage(session,{type:'previewInput',name:'U101',value:'1'});
 assert.equal(session.previewPath.length,0);
 assert.equal(session.model.previewNavigation.activeLabel,'@main');
 assert.equal(session.model.pages.find(p=>p.sourceLabel==='@main').elements.length,1);
 assert.equal(session.dirty,true,'input recompute retains coordinate draft');
 assert.ok(posted.length>0);console.log('preview-say-call-provider.test.js: PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
