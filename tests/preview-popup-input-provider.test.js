const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test'),{manager}=require('./helpers/preview-image-hydration'),fixture=require('./preview-popup-input.test');
async function run(){
 const host=manager();let source=fixture.source;const posted=[];
 const session={key:'popup',document:{version:1,getText:()=>source},dirty:true,conflict:false,modelRevision:1,previewConditions:{},previewValues:{},panel:{webview:{postMessage:m=>posted.push(m)}}};
 host.sessions=new Map([[session.key,session]]);host.hydrateAssets=async()=>{};
 host.createModel=async(_d,_c,_l,_s,values,_call,previewPath)=>parse(source,values,'996PC',{previewPath});
 const reset=()=>{session.model=parse(source,{},'996PC',{previewPath:[]});session.publishedPreview=undefined;session.previewPath=[];};reset();
 const send=(value,extra={})=>host.onMessage(session,{type:'previewNavigate',elementId:session.model.pages[0].elements[0].id,previewRevision:session.publishedPreview?.revision||session.modelRevision,trigger:'popup-submit',popupValue:value,...extra});
 await send('勇士',{variable:'S99',targetLabel:'@forged',submittedPopup:'伪造'});
 assert.equal(session.previewPath[0].submittedPopup,'勇士');assert.equal(session.previewPath[0].targetLabel,'@InPutString22');assert.ok(session.model.pages[1].elements[0].text.includes('结果=勇士'));
 for(const value of ['x\ny',null,{},42,'x'.repeat(4097)]){const before=session.modelRevision;await send(value);assert.equal(session.modelRevision,before);}
 for(const extra of [{trigger:'click'},{trigger:'change'},{previewRevision:0},{elementId:'forged'}]){const before=session.modelRevision;await send('x',extra);assert.equal(session.modelRevision,before);}
 await host.onMessage(session,{type:'previewBack',previewRevision:session.publishedPreview.revision});assert.equal(session.model.previewNavigation.activeLabel,'@main');assert.equal(session.dirty,true);
 const before=session.modelRevision;session.document.version=2;await send('x');assert.equal(session.modelRevision,before);session.document.version=1;
 source=fixture.source.replace('请输入姓名：','新标题');await send('x');assert.equal(session.modelRevision,before,'changed raw source is rejected');
 source=fixture.source;reset();session.model.pages[0].elements[0].sourceUri='file:///external.txt';await send('x');assert.equal(session.modelRevision,before,'external companion is rejected');
 source=fixture.source.replaceAll('InPutString','InPutInteger').replaceAll('S22','N22');reset();await send('1.5');assert.equal(session.modelRevision,before);await send('9007199254740993');assert.ok(session.model.pages[1].elements[0].text.includes('9007199254740993'));
 source=fixture.source.replace('请输入姓名：','提示/@不是链接');reset();await send('标题安全');assert.equal(session.previewPath[0].column,fixture.markup.indexOf('|link='));assert.ok(session.model.pages[1].elements[0].text.includes('标题安全'));
 console.log('preview-popup-input-provider.test.js: PASS');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
