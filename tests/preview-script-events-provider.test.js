const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL,fileURLToPath}=require('node:url');
const {manager}=require('./helpers/preview-image-hydration');
const {source,external,page,buttons}=require('./preview-script-events.test');
const runtime=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const language=require(path.join(runtime,'data/static-language.json'));
const {workspaceNpcDialogOffsets}=require(path.join(runtime,'out/ui-dialog/offsets'));
const uri=file=>({fsPath:file,scheme:'file',toString:()=>pathToFileURL(file).href});
async function fixture(options={}){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'boo-external-events-'));
 const primaryPath=path.join(temp,'npc.txt'),externalPath=path.join(temp,'Envir','QuestDiary','events.txt');
 const sourceText=options.source||source, externalText=options.external||external, engine=options.engine||'GOM';
 fs.mkdirSync(path.dirname(externalPath),{recursive:true});fs.writeFileSync(primaryPath,sourceText);fs.writeFileSync(externalPath,externalText);
 const messages=[],effects=[];
 const document={fileName:primaryPath,uri:uri(primaryPath),version:1,getText:()=>sourceText,positionAt:offset=>offset};
 const workspace={textDocuments:[document],getWorkspaceFolder:()=>({uri:uri(temp)}),getConfiguration:()=>({get:()=>engine}),
   applyEdit:async()=>{effects.push('applyEdit');return true;}};
 const host=manager({workspace,Uri:{parse:value=>value.startsWith('file:')?uri(fileURLToPath(value)):{scheme:value.split(':')[0],toString:()=>value},file:uri},
   window:{showErrorMessage:message=>messages.push({type:'error',message})},commands:{executeCommand:command=>effects.push(command)}});
 host.staticLanguage=language;host.scriptDataResolver={prepareFor:async()=>{},optionsFor:()=>({})};
 host.dialogOffsets=()=>workspaceNpcDialogOffsets(0,0);host.resolveCompanion=()=>({status:'missing',candidateFilePaths:[]});host.hydrateAssets=async()=>{};
 const values=options.values||{U101:'1','S$label':'测试文字'};
 const model=await host.createModel(document,2,undefined,{},values);
 const session={key:'external-events',document,model,modelRevision:1,dirty:true,conflict:false,applying:false,
   previewValues:values,previewConditions:{},previewPath:[],panel:{webview:{postMessage:message=>messages.push(message)}}};
 host.sessions=new Map([[session.key,session]]);await host.postModel(session);
 return {temp,primaryPath,externalPath,document,workspace,host,session,messages,effects,
   revision:()=>session.publishedPreview.revision,
   dispose(){assert.ok(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('boo-external-events-'));fs.rmSync(temp,{recursive:true,force:true});}};
}
async function run(){
 const f=await fixture();
 try{
  const {host,session,messages,effects,revision}=f;
  for(const i of [1,0,1]){
   const element=buttons(session.model)[i], before=revision();
   await host.onMessage(session,{type:'previewNavigate',elementId:element.id,trigger:'click',previewRevision:before,
    sourceUri:'file:///C:/Windows/win.ini',sourceLabel:'@forged',targetLabel:'@empty',sourceRootLabel:'@forged',sayOccurrence:99999,
    parameters:['forged'],arguments:['forged'],lineNumber:999,column:0});
   assert.equal(session.previewPath.length,1,'production Provider accepts an actually called external element');
   assert.equal(session.previewPath[0].sourceLabel,'@panel');assert.equal(session.previewPath[0].sourceRootLabel,'@main');
   assert.equal(session.previewPath[0].targetLabel,'@target');assert.equal(session.previewPath[0].sayOccurrence,element.sayOccurrence);
   assert.ok(page(session.model,'@target').elements.some(item=>item.text===`参数=${(i+1)*10}/调用者=${(i+1)*10}`));
   assert.ok(page(session.model,'@target').elements.some(item=>item.text==='文字=测试文字'));
   assert.equal(session.dirty,true,'navigation preserves coordinate drafts');
   const current=revision();
   await host.onMessage(session,{type:'previewNavigate',elementId:element.id,trigger:'click',previewRevision:before});
   assert.equal(revision(),current,'stale displayed revision is rejected');
   await host.onMessage(session,{type:'previewBack',previewRevision:revision()});
   assert.equal(session.previewPath.length,0);assert.equal(session.model.previewNavigation.activeLabel,'@main');
  }
  const plain=page(session.model,'@panel').elements.filter(item=>item.raw.includes('/@plain'))[1];
  await host.onMessage(session,{type:'previewNavigate',elementId:plain.id,trigger:'click',previewRevision:revision()});
  assert.equal(session.previewPath[0].targetLabel,'@plain','plain text links go through production Provider');
  assert.ok(page(session.model,'@plain').elements.some(item=>item.text==='纯文字caller=20/空参=预览文字'));
  await host.onMessage(session,{type:'previewBack',previewRevision:revision()});
  // Even a mutable in-host/public model cannot change an already frozen action.
  const forged=buttons(session.model)[0];forged.localParameterTarget='@empty';forged.sayOccurrence=99999;forged.executionRootLabel='@empty';
  await host.onMessage(session,{type:'previewNavigate',elementId:forged.id,trigger:'click',previewRevision:revision()});
  assert.equal(session.previewPath[0].targetLabel,'@target');assert.equal(session.previewPath[0].sayOccurrence,0);
  assert.ok(page(session.model,'@target').elements.some(item=>item.text==='参数=10/调用者=10'));
  await host.onMessage(session,{type:'previewBack',previewRevision:revision()});
  const inaccessible=page(session.model,'@panel').elements.find(item=>item.raw.includes('/@sibling'));
  inaccessible.localParameterTarget='@target';inaccessible.executionRootLabel='@main';
  const invalidRevision=revision();
  await host.onMessage(session,{type:'previewNavigate',elementId:inaccessible.id,trigger:'click',previewRevision:revision()});
  assert.equal(revision(),invalidRevision,'forged public capability cannot authorize unloaded source');
  for(const composition of session.model.pages.filter(item=>item.executionPreview)){
   const element=composition.elements.find(item=>item.raw.includes('/@target'));
   if(!element)continue;
   element.localParameterTarget='@target';
   await host.onMessage(session,{type:'previewNavigate',elementId:element.id,trigger:'click',previewRevision:revision()});
   assert.equal(revision(),invalidRevision,'execution composition cannot dispatch source actions');
  }
  await host.onMessage(session,{type:'previewNavigate',elementId:buttons(session.model)[1].id,trigger:'click',previewRevision:revision()});
  await host.onMessage(session,{type:'previewInput',name:'U101',value:'0'});
  assert.equal(session.previewPath.length,0,'removing a CALL via input invalidates its history');
  assert.equal(session.model.previewNavigation.activeLabel,'@main');assert.equal(session.dirty,true);
  assert.deepEqual(buttons(session.model).map(item=>item.text),['打开10']);
  const versionBefore=revision();
  await host.onMessage(session,{type:'previewNavigate',elementId:buttons(session.model)[0].id,trigger:'double-click',previewRevision:revision()});
  assert.equal(revision(),versionBefore,'a wrong gesture cannot borrow a click capability');
  f.document.version++;
  await host.onMessage(session,{type:'previewNavigate',elementId:buttons(session.model)[0].id,trigger:'click',previewRevision:revision()});
  assert.equal(revision(),versionBefore,'primary version change invalidates imported events');f.document.version--;
  fs.writeFileSync(f.externalPath,external.replace('打开','已变化'));
  await host.onMessage(session,{type:'previewNavigate',elementId:buttons(session.model)[0].id,trigger:'click',previewRevision:revision()});
  assert.equal(revision(),versionBefore,'external bytes are revalidated before replay');assert.equal(session.conflict,true);
  assert.ok(messages.some(message=>message.type==='conflict'&&message.message.includes('外部 CALL')));
  assert.deepEqual(effects,[],'event replay never executes commands or writes script source');
  assert.equal(fs.readFileSync(f.primaryPath,'utf8'),source);
  console.log('preview-script-events-provider.test.js: PASS production reader/Provider, instance binding, metadata forgery, Back/input/stale guards; VS Code stub only');
 }finally{f.dispose();}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run,fixture};
