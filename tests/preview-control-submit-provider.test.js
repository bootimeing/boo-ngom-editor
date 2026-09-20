const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test'),{manager}=require('./helpers/preview-image-hydration');
const {checkbox,slider,sourceFor}=require('./preview-control-submit.test');
async function run(){
 const host=manager();let source;const posted=[];
 const session={key:'control-submit',document:{version:1,getText:()=>source},dirty:true,conflict:false,modelRevision:1,previewConditions:{},previewValues:{},panel:{webview:{postMessage:m=>posted.push(m)}}};
 host.sessions=new Map([[session.key,session]]);host.hydrateAssets=async()=>{};
 host.createModel=async(_d,_c,_l,_s,values,_call,previewPath)=>parse(source,values,'996PC',{previewPath});
 const reset=text=>{source=text;session.model=parse(text,{},'996PC',{previewPath:[]});session.publishedPreview=undefined;session.previewPath=[];};
 const send=(controlValue,extra={})=>host.onMessage(session,{type:'previewNavigate',elementId:session.model.pages[0].elements[0].id,previewRevision:session.publishedPreview?.revision||session.modelRevision,trigger:'change',controlValue,...extra});
 for(const [markup,type,variable,value] of [[checkbox,2,'N66','1'],[slider,3,'N$amount','75']]){
  reset(sourceFor(markup));await send(value,{submittedControl:{type:2,variable:'N99',value:'1'},targetLabel:'@hack'});
  assert.deepEqual(session.previewPath[0].submittedControl,{type,variable,value});
  assert.equal(session.model.previewNavigation.activeLabel,'@done');assert.equal(session.dirty,true);
  for(const invalid of ['-1','101','NaN',null,{},'1'.repeat(100),...(type===2?['2','.5']:[])]){
   const revision=session.modelRevision;await send(invalid);assert.equal(session.modelRevision,revision,'invalid state rejected');
  }
  for(const extra of [{trigger:'click'},{trigger:'double-click'},{previewRevision:0},{elementId:'forged'}]){
   const revision=session.modelRevision;await send(value,extra);assert.equal(session.modelRevision,revision);
  }
  await host.onMessage(session,{type:'previewBack',previewRevision:session.publishedPreview.revision});
  assert.equal(session.model.previewNavigation.activeLabel,'@main');assert.equal(session.previewPath.length,0);
  session.document.version=2;const revision=session.modelRevision;await send(value);assert.equal(session.modelRevision,revision);session.document.version=1;
  reset(sourceFor(markup+'\n'+markup));const before=session.modelRevision;await send(value);assert.equal(session.modelRevision,before,'duplicate variable rejected');
 }
 reset(sourceFor(checkbox));await send('0');assert.ok(session.model.pages[1].elements[0].text.includes('状态=0'));
 source=sourceFor(require('./preview-control-values.test').ranged);
 session.previewValues={'N$max':'100','N$start':'25'};
 session.model=parse(source,session.previewValues,'996PC',{previewPath:[]});session.publishedPreview=undefined;session.previewPath=[];
 await send('75');assert.equal(session.model.previewNavigation.activeLabel,'@done');
 await host.onMessage(session,{type:'previewInput',name:'N$max',value:'50'});
 assert.equal(session.previewPath.length,0,'new range invalidates prior submitted value');assert.equal(session.model.previewNavigation.activeLabel,'@main');assert.equal(session.dirty,true);
 assert.ok(posted.every(m=>m.type!=='model'||m.preserveDrafts));console.log('preview-control-submit-provider.test.js: PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
