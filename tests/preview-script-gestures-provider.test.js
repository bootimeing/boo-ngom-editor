const assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./preview-script-events-provider.test');
const {scenarios,selfScenario,branchScenario,elementFor,page}=require('./preview-script-gestures.test');
function messageFor(session,f,extra={}){
 const element=elementFor(session.model,f);assert.ok(element,f.kind+' actual external element is present');
 return {type:'previewNavigate',elementId:element.id,previewRevision:session.publishedPreview.revision,trigger:f.trigger,
  ...(f.control?{controlValue:f.control.value}:{}),...(f.popupValue!==undefined?{popupValue:f.popupValue}:{}),
  ...(f.submittedInputs?{submittedInputs:{...f.submittedInputs,'40':'forged extra'}}:{}),...extra};
}
async function run(){
 for(const config of scenarios){
  const f=await fixture({...config,values:{}});
  try{
   const {host,session,revision}=f;
   assert.equal(session.model.engine,config.engine);
   const initialElement=elementFor(session.model,config);
   assert.equal(initialElement.sourceFilePath,f.externalPath,'actual source gateway returns physical QuestDiary source');
   for(const invalid of config.invalid||[]){
    const patch=config.control?{controlValue:invalid}:config.submittedInputs?{submittedInputs:invalid}:{popupValue:invalid};
    const before=revision();await host.onMessage(session,messageFor(session,config,patch));
    assert.equal(revision(),before,config.kind+' invalid submitted value rejected before replay');
   }
   for(const patch of [{previewRevision:0},{elementId:'forged'},
     {trigger:config.trigger==='click'||config.trigger==='double-click'?'completion':'click'}]){
    const before=revision();await host.onMessage(session,messageFor(session,config,patch));
    assert.equal(revision(),before,config.kind+' wrong identity/revision/gesture rejected');
   }
   await host.onMessage(session,messageFor(session,config,{sourceUri:'file:///C:/Windows/win.ini',sourceRootLabel:'@forged',
    sourceLabel:'@forged',targetLabel:'@forged',sayOccurrence:999,submittedControl:{type:2,variable:'N99',value:'0'}}));
   assert.equal(session.previewPath.length,1,config.kind+' production external Provider replay');
   const accepted=session.previewPath[0];
   assert.equal(accepted.sourceLabel,'@panel');assert.equal(accepted.sourceRootLabel,'@main');
   assert.equal(accepted.targetLabel,config.target);assert.equal(accepted.sayOccurrence,initialElement.sayOccurrence);
   if(config.control)assert.deepEqual(accepted.submittedControl,config.control,'source-owned control type/variable override frontend forgery');
   if(config.submittedInputs)assert.deepEqual(accepted.submittedInputs,config.submittedInputs,'GOM implicit-all submits only current external page IDs');
   assert.ok(page(session.model,config.target).elements.some(element=>element.text?.includes(config.expected)),config.kind+' correct host result');
   assert.equal(session.dirty,true,'external event leaves coordinate drafts intact');
   await host.onMessage(session,{type:'previewBack',previewRevision:revision()});
   assert.equal(session.previewPath.length,0);assert.equal(session.model.previewNavigation.activeLabel,'@main');
   f.document.version++;const before=revision();await host.onMessage(session,messageFor(session,config));
   assert.equal(revision(),before,config.kind+' primary document version gate');f.document.version--;
   fs.writeFileSync(f.externalPath,config.external+'\n;changed');
   await host.onMessage(session,messageFor(session,config));assert.equal(revision(),before,config.kind+' dependency byte gate');
   assert.equal(session.conflict,true);assert.deepEqual(f.effects,[],'no engine/host command or script write');
   assert.equal(fs.readFileSync(f.primaryPath,'utf8'),config.source);
  }finally{f.dispose();}
 }
 for(const config of scenarios.filter(item=>item.control||item.submittedInputs)){
  const initial=await fixture({...config,values:{}});let external;
  try{
   const element=config.control?elementFor(initial.session.model,config):page(initial.session.model,'@panel').elements.find(element=>element.inputPreview?.inputId===1);
   external=config.external.replace('\n}','\n'+element.raw+'\n}');
  }finally{initial.dispose();}
  const f=await fixture({...config,external,values:{}});
  try{
   const element=page(f.session.model,'@panel').elements.find(element=>config.control?element.raw.includes('|link='):element.localParameterTarget);
   const before=f.revision();
   await f.host.onMessage(f.session,{type:'previewNavigate',elementId:element.id,trigger:config.trigger,previewRevision:before,
    ...(config.control?{controlValue:config.control.value}:{submittedInputs:config.submittedInputs})});
   assert.equal(f.revision(),before,config.kind+' duplicate current external-page ID rejects submission');
  }finally{f.dispose();}
 }
 const branching=await fixture({...branchScenario,values:{}});
 try{
  const {host,session,revision}=branching;
  const clickText=async text=>{const element=page(session.model,'@panel').elements.find(element=>element.text===text);assert.ok(element?.localParameterTarget,text+' is source-authorized');
   await host.onMessage(session,{type:'previewNavigate',elementId:element.id,trigger:'click',previewRevision:revision()});};
  await clickText('继续10');assert.equal(session.previewPath.length,1);
  assert.deepEqual(page(session.model,'@panel').elements.map(element=>element.text),['继续10','去目标10','继续20','去目标20']);
  await clickText('去目标10');assert.equal(session.previewPath.length,1,'selecting an old root button truncates to its host-owned history prefix');
  assert.equal(session.previewPath[0].sourceRootLabel,'@main');
  assert.ok(page(session.model,'@done').elements.some(element=>element.text==='结果=10/当前=10'),'old root button uses caller10, not final20');
  await clickText('继续10');await clickText('去目标20');assert.equal(session.previewPath.length,2);
  assert.equal(session.previewPath[1].sourceRootLabel,'@next');
  assert.ok(page(session.model,'@done').elements.some(element=>element.text==='结果=20/当前=20'),'current root button retains its actual caller20');
  await host.onMessage(session,{type:'previewBack',previewRevision:revision()});assert.equal(session.previewPath.length,1);
  await clickText('去目标10');assert.equal(session.previewPath.length,1,'Back then an old-root branch remains usable');
  assert.ok(page(session.model,'@done').elements.some(element=>element.text==='结果=10/当前=10'));
  assert.deepEqual(branching.effects,[]);assert.equal(fs.readFileSync(branching.externalPath,'utf8'),branchScenario.external);
 }finally{branching.dispose();}
 const self=await fixture({...selfScenario,values:{}});
 try{
  const {host,session,revision}=self;
  assert.equal(elementFor(session.model,selfScenario).text,'继续1');
  await host.onMessage(session,messageFor(session,selfScenario));
  assert.equal(session.previewPath.length,1,'production Provider preserves an accepted self-call after its button disappears');
  assert.ok(page(session.model,'@panel').elements.some(element=>element.text===selfScenario.expected));
  assert.ok(!elementFor(session.model,selfScenario),'completed self-call is no longer actionable');
  await host.onMessage(session,{type:'previewBack',previewRevision:revision()});
  assert.equal(session.previewPath.length,0);assert.equal(elementFor(session.model,selfScenario).text,'继续1','Back restores pre-call source state');
  assert.deepEqual(self.effects,[]);assert.equal(fs.readFileSync(self.externalPath,'utf8'),selfScenario.external);
 }finally{self.dispose();}
 for(const engine of ['GOM','GEE','996PC']){
  const repeated=await fixture({...selfScenario,engine,external:selfScenario.external.replace('SMALL N0 2','SMALL N0 4'),values:{}});
  try{
  for(let count=1;count<=3;count++){
   const element=elementFor(repeated.session.model,selfScenario);assert.ok(element,'actual external self-call '+count+' remains actionable after revisiting its own label');
   assert.equal(element.text,'继续'+count);await repeated.host.onMessage(repeated.session,messageFor(repeated.session,selfScenario));
   assert.equal(repeated.session.previewPath.length,count,'Provider retains all valid preceding self-call edges');
  }
  assert.ok(page(repeated.session.model,'@panel').elements.some(element=>element.text==='完成4'));
  await repeated.host.onMessage(repeated.session,{type:'previewBack',previewRevision:repeated.revision()});
  assert.equal(repeated.session.previewPath.length,2);assert.equal(elementFor(repeated.session.model,selfScenario).text,'继续3');
  await repeated.host.onMessage(repeated.session,messageFor(repeated.session,selfScenario));
  assert.equal(repeated.session.previewPath.length,3);assert.ok(page(repeated.session.model,'@panel').elements.some(element=>element.text==='完成4'));
  assert.deepEqual(repeated.effects,[]);
  }finally{repeated.dispose();}
 }
 console.log('preview-script-gestures-provider.test.js: PASS '+scenarios.length+' external gestures, three-engine repeated/disappearing self-call and caller10/caller20 root branches through production reader/Provider, values/forgery/source guards and duplicate controls/inputs; VS Code stub');
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run,messageFor};
