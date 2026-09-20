const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test'),{manager}=require('./helpers/preview-image-hydration');
const {markups,sourceFor}=require('./preview-completion-call.test');
async function run(){
 const host=manager();let source;const session={key:'completion',document:{version:1,getText:()=>source},dirty:true,conflict:false,modelRevision:1,previewConditions:{},previewValues:{},panel:{webview:{postMessage(){}}}};
 host.sessions=new Map([[session.key,session]]);host.hydrateAssets=async()=>{};
 host.createModel=async(_d,_c,_l,_s,values,_call,previewPath)=>parse(source,values,'996PC',{previewPath});
 const send=extra=>host.onMessage(session,{type:'previewNavigate',elementId:session.model.pages[0].elements[0].id,trigger:'completion',previewRevision:session.publishedPreview?.revision||session.modelRevision,...extra});
 for(const markup of markups){source=sourceFor(markup);session.model=parse(source,{},'996PC',{previewPath:[]});session.publishedPreview=undefined;session.previewPath=[];
  await send({targetLabel:'@hack',submittedInputs:{'1':'伪造'},controlValue:'99'});assert.equal(session.previewPath[0].trigger,'completion');assert.equal(session.previewPath[0].targetLabel,'@done');assert.equal(session.previewPath[0].submittedInputs,undefined);assert.equal(session.previewPath[0].submittedControl,undefined);assert.equal(session.dirty,true);
  for(const extra of [{trigger:'click'},{trigger:'change'},{previewRevision:0},{elementId:'forged'}]){const revision=session.modelRevision;await send(extra);assert.equal(session.modelRevision,revision);}
  session.document.version=2;const revision=session.modelRevision;await send({});assert.equal(session.modelRevision,revision);session.document.version=1;
  await host.onMessage(session,{type:'previewBack',previewRevision:session.publishedPreview.revision});assert.equal(session.model.previewNavigation.activeLabel,'@main');
 }
 console.log('preview-completion-call-provider.test.js: PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
