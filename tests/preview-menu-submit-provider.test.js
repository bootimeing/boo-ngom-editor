const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test'),{manager}=require('./helpers/preview-image-hydration');
const fixture=require('./preview-menu-submit.test');
async function run(){
 const host=manager();let source=fixture.source;const posted=[];
 const session={key:'menu-submit',document:{version:1,getText:()=>source},dirty:true,conflict:false,modelRevision:1,previewConditions:{},previewValues:{},panel:{webview:{postMessage:m=>posted.push(m)}}};
 host.sessions=new Map([[session.key,session]]);host.hydrateAssets=async()=>{};
 host.createModel=async(_d,_c,_l,_s,values,_call,previewPath)=>parse(source,values,'996PC',{previewPath});
 const reset=()=>{session.model=parse(source,{},'996PC',{previewPath:[]});session.publishedPreview=undefined;session.previewPath=[];};reset();
 const send=(value,extra={})=>host.onMessage(session,{type:'previewNavigate',elementId:session.model.pages[0].elements[0].id,previewRevision:session.publishedPreview?.revision||session.modelRevision,trigger:'change',controlValue:value,...extra});
 await send('装备',{submittedControl:{type:4,variable:'S$forged',value:'攻击'},targetLabel:'@forged'});
 assert.deepEqual(session.previewPath[0].submittedControl,{type:4,variable:'S$choice',value:'装备'});assert.equal(session.model.pages[1].elements[0].text,'选择=装备');
 for(const value of ['不存在','<IMG:1:1:1:1>',null,{},'1'.repeat(65537)]){const before=session.modelRevision;await send(value);assert.equal(session.modelRevision,before);}
 for(const extra of [{trigger:'click'},{trigger:'double-click'},{previewRevision:0},{elementId:'forged'}]){const before=session.modelRevision;await send('金币',extra);assert.equal(session.modelRevision,before);}
 await host.onMessage(session,{type:'previewBack',previewRevision:session.publishedPreview.revision});assert.equal(session.model.previewNavigation.activeLabel,'@main');assert.equal(session.dirty,true);
 source=fixture.source.replace(fixture.markup,fixture.markup+'\n'+fixture.markup.replace('itemname=金币#装备#地图','itemname=<$STR(S2)>'));reset();const before=session.modelRevision;await send('金币');assert.equal(session.modelRevision,before);
 source=fixture.source.replaceAll('金币','$STM(USERNAME)').replace('装备','$STM(WEAPON)');reset();session.previewValues={};
 await host.onMessage(session,{type:'previewInput',name:'STM(USERNAME)',value:'相同显示'});
 await host.onMessage(session,{type:'previewInput',name:'STM(WEAPON)',value:'相同显示'});
 const menu=session.model.pages[0].elements[0].menuPreview;
 assert.deepEqual(menu.clientDisplay.items.slice(0,2).map(r=>r.map(x=>x.text).join('')),['相同显示','相同显示']);
 const displayRevision=session.modelRevision;
 await send('相同显示');assert.equal(session.modelRevision,displayRevision,'display label must not acquire option authority');
 await send('$STM(WEAPON)');
 assert.equal(session.previewPath[0].submittedControl.value,'$STM(WEAPON)','second identical label retains its own source identity');
 assert.equal(session.model.pages[1].elements[0].text,'选择=$STM(WEAPON)','result remains literal; no recursive client expansion');
 assert.equal(session.dirty,true);
 console.log('preview-menu-submit-provider.test.js: PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
