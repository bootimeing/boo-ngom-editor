const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {pathToFileURL,fileURLToPath}=require('node:url');
const {manager}=require('./preview-image-hydration');
const runtime=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'../..'));
const {workspaceNpcDialogOffsets}=require(path.join(runtime,'out/ui-dialog/offsets'));
const language=require(path.join(runtime,'data/static-language.json'));
const iconv=require(path.join(runtime,'node_modules/iconv-lite'));
const source='#INCLUDE 预览常量.ini\r\n[@main]\r\n#ACT\r\nMOV N0 ($数量)\r\nINC N0 2\r\n#SAY\r\n<TEXT:($标题):50:50>\r\n<TEXT:数量=($数量) 合计=<$STR(N0)>:50:90>\r\n<TEXT:常量坐标只读:($横坐标):130>\r\n<TEXT:输入=<$STR(U101)>:50:170>\r\n';
const definitions='#DEFINE $标题 欢迎进入常量预览\r\n#DEFINE $数量 40\r\n#DEFINE $横坐标 90\r\n';
const uri=file=>({fsPath:file,scheme:'file',toString:()=>pathToFileURL(file).href});
class Range{constructor(start,end){this.start=start;this.end=end;}}
async function createFixture(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'boo-constants-gate-'));
 const primaryPath=path.join(temp,'npc.txt'),definesPath=path.join(temp,'Envir','Defines','预览常量.ini');
 fs.mkdirSync(path.dirname(definesPath),{recursive:true});fs.writeFileSync(primaryPath,source);fs.writeFileSync(definesPath,iconv.encode(definitions,'gbk'));
 let text=source,saves=0;const events=[],edits=[];
 const primary={fileName:primaryPath,uri:uri(primaryPath),version:1,getText:()=>text,positionAt:offset=>offset,save:async()=>{saves++;return true;}};
 const workspace={textDocuments:[primary],getWorkspaceFolder:()=>({uri:uri(temp)}),getConfiguration:()=>({get:()=> 'GOM'}),
  openTextDocument:async target=>{const file=target.fsPath||fileURLToPath(target.toString());
   const existing=workspace.textDocuments.find(doc=>doc.fileName===file);if(existing)return existing;
   const document={fileName:file,uri:uri(file),version:1,_text:iconv.decode(fs.readFileSync(file),'gbk'),getText(){return this._text;},positionAt:offset=>offset,save:async()=>true};
   workspace.textDocuments.push(document);return document;},
  applyEdit:async edit=>{edits.push(edit);assert.ok(edit.changes.every(change=>change.target.toString()===primary.uri.toString()),'constants must never become coordinate edit destinations');
   for(const change of [...edit.changes].sort((a,b)=>b.range.start-a.range.start))text=text.slice(0,change.range.start)+change.text+text.slice(change.range.end);
   primary.version++;host.onDocumentChanged({document:primary});return true;}};
 const host=manager({workspace,Uri:{parse:value=>value.startsWith('file:')?uri(fileURLToPath(value)):{scheme:value.split(':')[0],toString:()=>value},file:uri},Range,
  ViewColumn:{One:1},TextEditorRevealType:{InCenterIfOutsideViewport:1},WorkspaceEdit:class{constructor(){this.changes=[];}replace(target,range,text){this.changes.push({target,range,text});}},
  window:{showErrorMessage:message=>events.push(message),showTextDocument:async()=>({revealRange(){}})}});
 host.staticLanguage=language;host.scriptDataResolver={prepareFor:async()=>{},optionsFor:()=>({})};
 host.dialogOffsets=()=>workspaceNpcDialogOffsets(0,0);host.resolveCompanion=()=>({status:'missing',candidateFilePaths:[]});host.hydrateAssets=async()=>{};
 const model=await host.createModel(primary,source.indexOf('[@main]'),undefined,{},{});
 const session={key:'constants-provider',document:primary,dirty:false,conflict:false,applying:false,modelRevision:1,model,previewValues:{},previewConditions:{},previewPath:[],
  panel:{webview:{postMessage:message=>events.push(message)}}};
 host.sessions=new Map([[session.key,session]]);await host.postModel(session);
 return{temp,primaryPath,definesPath,primary,host,session,workspace,events,edits,text:()=>text,saves:()=>saves,
  source,definitions,uri,async reparse(next){const document={...primary,getText:()=>next};return host.createModel(document,next.indexOf('[@main]'),undefined,{},{});},
  cleanup(){assert.ok(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('boo-constants-gate-'));fs.rmSync(temp,{recursive:true,force:true});}};
}
module.exports={createFixture,runtime,source,definitions};
