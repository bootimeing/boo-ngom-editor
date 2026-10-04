const assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {pathToFileURL,fileURLToPath}=require('node:url');
const {manager}=require('./helpers/preview-image-hydration');
const {source,external}=require('./preview-script-model.test');
const runtime=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const language=require(path.join(runtime,'data/static-language.json'));
const {workspaceNpcDialogOffsets}=require(path.join(runtime,'out/ui-dialog/offsets'));
const uri=file=>({fsPath:file,scheme:'file',toString:()=>pathToFileURL(file).href});
class Range {constructor(start,end){this.start=start;this.end=end;}}
async function run(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'boo-call-provider-'));
 try{
  const primaryPath=path.join(temp,'npc.txt'), externalPath=path.join(temp,'Envir','QuestDiary','nested','calculate.txt');
  fs.mkdirSync(path.dirname(externalPath),{recursive:true});fs.writeFileSync(externalPath,external);fs.writeFileSync(primaryPath,source);
  let text=source,opened,shown,edits=[],saves=0,events=[];
  const primary={fileName:primaryPath,uri:uri(primaryPath),version:1,getText:()=>text,positionAt:offset=>offset,save:async()=>{saves++;return true;}};
  const workspace={textDocuments:[primary],getWorkspaceFolder:()=>({uri:uri(temp)}),getConfiguration:()=>({get:()=> 'GOM'}),
   openTextDocument:async target=>{const file=target.fsPath||fileURLToPath(target.toString());
    const existing=workspace.textDocuments.find(doc=>doc.fileName===file);if(existing)return existing;
    opened={fileName:file,uri:uri(file),version:1,_text:fs.readFileSync(file,'utf8'),saved:0,
    getText(){return this._text;},positionAt:offset=>offset,async save(){this.saved++;return true;}};
    workspace.textDocuments.push(opened);return opened;},
   applyEdit:async edit=>{edits.push(edit);const touched=new Set();for(const change of [...edit.changes].sort((a,b)=>b.range.start-a.range.start)){
     const doc=workspace.textDocuments.find(item=>item.uri.toString()===change.target.toString());assert.ok(doc,'only opened verified documents can be edited');
     if(doc===primary)text=text.slice(0,change.range.start)+change.text+text.slice(change.range.end);
     else doc._text=doc._text.slice(0,change.range.start)+change.text+doc._text.slice(change.range.end);
     touched.add(doc);
   }for(const doc of touched){doc.version++;host.onDocumentChanged({document:doc});}return true;}};
  const host=manager({workspace,Uri:{parse:value=>value.startsWith('file:')?uri(fileURLToPath(value)):{scheme:value.split(':')[0],toString:()=>value},file:uri},Range,ViewColumn:{One:1},TextEditorRevealType:{InCenterIfOutsideViewport:1},
   WorkspaceEdit:class{constructor(){this.changes=[];}replace(target,range,text){this.changes.push({target,range,text});}},
   window:{showErrorMessage:message=>events.push(message),showTextDocument:async(doc,options)=>{shown={doc,options};return{revealRange(){}};}}});
  host.staticLanguage=language;host.scriptDataResolver={prepareFor:async()=>{},optionsFor:()=>({})};
  host.dialogOffsets=()=>workspaceNpcDialogOffsets(0,0);host.resolveCompanion=()=>({status:'missing',candidateFilePaths:[]});host.hydrateAssets=async()=>{};
  const model=await host.createModel(primary,2,undefined,{}, {'N$base':'40'});
  const session={key:'crossfile-provider',document:primary,dirty:false,conflict:false,applying:false,modelRevision:1,model,
   previewValues:{'N$base':'40'},previewConditions:{},previewPath:[],panel:{webview:{postMessage:message=>events.push(message)}}};
  host.sessions=new Map([[session.key,session]]);await host.postModel(session);
  const main=()=>session.model.pages.find(page=>page.sourceLabel==='@main');
  const button=main().elements.find(element=>element.raw.includes('/@next'));
  assert.ok(main().elements.some(element=>element.text==='主结果=42'));
  await host.onMessage(session,{type:'previewNavigate',elementId:button.id,trigger:'click',previewRevision:1});
  assert.equal(session.previewPath.length,1);
  assert.ok(session.model.pages.find(page=>page.sourceLabel==='@next').elements.some(element=>element.text==='参数=42'));
  const ext=session.model.pages.find(page=>page.sourceLabel==='@calculate').elements.find(element=>element.text==='外部=42');
  await host.locateElement(session,ext.id);
  assert.equal(opened.fileName,externalPath);assert.equal(shown.options.selection.start,external.indexOf('<TEXT:外部'));
  // Opening an unchanged dependency is not a source conflict.
  assert.equal(host.programSourcesCurrent(session),true);
  const element=main().elements.find(element=>element.text==='主结果=42');
  await host.onMessage(session,{type:'apply',previewRevision:0,changes:[{elementId:element.id,x:48,y:44}]});
  assert.equal(edits.length,0,'stale Apply revision rejected');
  await host.onMessage(session,{type:'apply',previewRevision:session.publishedPreview.revision,changes:[{elementId:element.id,x:48,y:44}]});
  assert.equal(edits.length,1);assert.equal(text,source.replace(':40:40>',':52:48>'));assert.equal(saves,0);
  assert.equal(fs.readFileSync(externalPath,'utf8'),external,'external source not mutated by primary Apply');
  const externalElement=session.model.pages.find(page=>page.sourceLabel==='@calculate').elements.find(element=>element.text==='外部=42');
  assert.equal(externalElement.editable,true,'mapped direct external coordinate is editable only after source-group routing exists');
  session.dirty=true;
  const messageStart=events.length;
  await host.onMessage(session,{type:'apply',previewRevision:session.publishedPreview.revision,changes:[
    {elementId:main().elements.find(element=>element.text==='主结果=42').id,x:49,y:44},
    {elementId:externalElement.id,x:106,y:126}]});
  assert.equal(edits.length,2,'two documents submitted through one additional WorkspaceEdit');
  assert.equal(new Set(edits[1].changes.map(change=>change.target.toString())).size,2);
  assert.equal(text,source.replace(':40:40>',':53:48>'));
  assert.equal(opened.getText(),external.replace(':100:120>',':110:130>'));
  assert.ok(!events.slice(messageStart).some(event=>event.type==='conflict'),'own multi-document Apply does not look like an external edit');
  assert.equal(saves,0);assert.equal(opened.saved,0,'Apply leaves both documents unsaved');
  await host.onMessage(session,{type:'save',previewRevision:session.publishedPreview.revision,changes:[]});
  assert.equal(saves,1);assert.equal(opened.saved,1,'Save also covers external buffers touched by preceding Apply');
  assert.equal(session.pendingSaveDocuments.size,0);
  const completeCount=events.filter(event=>event.type==='operationComplete').length;
  const originalSave=primary.save;primary.save=async()=>false;
  await host.onMessage(session,{type:'save',previewRevision:session.publishedPreview.revision,changes:[
    {elementId:session.model.pages.find(page=>page.sourceLabel==='@calculate').elements[0].id,x:107,y:126},
    {elementId:main().elements[0].id,x:50,y:44}]});
  assert.equal(session.conflict,true,'partial multi-file save must not report complete');
  assert.equal(events.filter(event=>event.type==='operationComplete').length,completeCount);
  assert.equal(opened.saved,2);assert.ok(events.some(event=>event.type==='operationError'&&event.message.includes('已保存')&&event.message.includes(externalPath)));
  assert.equal(session.pendingSaveDocuments.size,1,'failed save remains pending');
  primary.save=originalSave;await host.reloadSession(session,false,false);
  // A second Apply cannot overlap the first while the VS Code edit is pending.
  const originalApply=workspace.applyEdit;let release;
  workspace.applyEdit=async edit=>{await new Promise(resolve=>{release=resolve;});return originalApply(edit);};
  const beforeOverlap=edits.length, overlapMessage={type:'apply',previewRevision:session.publishedPreview.revision,
    changes:[{elementId:main().elements[0].id,x:51,y:44}]};
  const pendingApply=host.onMessage(session,overlapMessage);
  for(let i=0;i<20&&!release;i++)await Promise.resolve();
  assert.ok(release,'first edit reached asynchronous VS Code interface');
  await host.onMessage(session,overlapMessage);release();await pendingApply;workspace.applyEdit=originalApply;
  assert.equal(edits.length,beforeOverlap+1,'overlapping Apply was rejected before dispatch');
  session.dirty=true;
  const externalDoc=workspace.textDocuments.find(doc=>doc!==primary);
  externalDoc.version=2;externalDoc.getText=()=>external.replace('2','9');
  const count=edits.length;
  await host.onMessage(session,{type:'apply',previewRevision:session.publishedPreview.revision,changes:[]});
  assert.equal(edits.length,count);assert.equal(session.conflict,true);
  assert.ok(events.some(event=>event.type==='conflict'&&event.message.includes('外部 CALL')));
  session.conflict=false;host.onDocumentChanged({document:externalDoc});assert.equal(session.conflict,true,'dirty external buffer event conflicts');
  const conflictedModel=session.model, conflictedValues={...session.previewValues};
  await host.onMessage(session,{type:'previewInput',name:'N$base',value:'50'});
  assert.equal(session.conflict,true,'preview input cannot clear an external-source conflict');
  assert.equal(session.model,conflictedModel);assert.deepEqual(session.previewValues,conflictedValues);
  await host.onMessage(session,{type:'resetPreview'});
  assert.equal(session.conflict,true,'reset cannot carry old drafts into changed source');
  assert.equal(session.model,conflictedModel);
  session.conflict=false;host.onCompanionFileChanged(uri(externalPath));assert.equal(session.conflict,true,'dirty filesystem event conflicts');
  session.dirty=false;session.conflict=false;let reloads=0,resolveReload;
  const refreshed=new Promise(resolve=>{resolveReload=resolve;});
  host.reloadSession=async()=>{reloads++;resolveReload();};
  host.onCompanionFileChanged(uri(externalPath));assert.equal(reloads,0,'dependency refresh is coalesced, not dispatched per event');
  host.onCompanionFileChanged(uri(path.join(temp,'unrelated.txt')));assert.equal(reloads,0);
  let reloadTimeout;
  try{await Promise.race([refreshed,new Promise((_,reject)=>{reloadTimeout=setTimeout(()=>reject(Error('dependency refresh did not arrive')),2000);})]);}
  finally{clearTimeout(reloadTimeout);}
  assert.equal(reloads,1,'the relevant companion still refreshes after debounce');
  assert.equal(fs.readFileSync(primaryPath,'utf8'),source,'Apply fixture models an unsaved editor, not writing user files');
  console.log('preview-script-provider.test.js: PASS production createModel/read/locate/click/apply/conflict with VS Code stub');
 }finally{assert.ok(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('boo-call-provider-'));fs.rmSync(temp,{recursive:true,force:true});}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
