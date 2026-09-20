const assert=require('node:assert/strict');
const {manager}=require('./helpers/preview-image-hydration'),{parse}=require('./preview-inputs-integration.test');
const {source}=require('./preview-double-click.test');
async function run(){
 const host=manager(),posted=[];
 const session={key:'double',model:parse(source,{},'996PC',{previewPath:[]}),document:{version:1,getText:()=>source},dirty:true,conflict:false,modelRevision:1,previewConditions:{},previewValues:{},panel:{webview:{postMessage:m=>posted.push(m)}}};
 host.sessions=new Map([[session.key,session]]);host.hydrateAssets=async()=>{};
 host.createModel=async(_d,_c,_l,_s,values,_call,previewPath)=>parse(source,values,'996PC',{previewPath});
 const click=(trigger,revision=session.publishedPreview?.revision||session.modelRevision)=>host.onMessage(session,{type:'previewNavigate',trigger,previewRevision:revision,elementId:session.model.pages[0].elements[0].id});
 await click('double-click');assert.equal(session.previewPath[0].trigger,'double-click');assert.equal(session.model.previewNavigation.activeLabel,'@double');
 assert.equal(posted.at(-1).navigatePageId,session.model.pages.find(p=>p.sourceLabel==='@double').id);
 const before=session.modelRevision;await click('double-click',0);assert.equal(session.modelRevision,before,'stale event');
 await click('completion');assert.equal(session.modelRevision,before,'forged gesture');
 await host.onMessage(session,{type:'previewBack',previewRevision:session.publishedPreview.revision});assert.equal(session.model.previewNavigation.activeLabel,'@main');
 await click('click');assert.equal(session.model.previewNavigation.activeLabel,'@single');assert.equal(session.dirty,true);
 console.log('preview-double-click-provider.test.js: PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
