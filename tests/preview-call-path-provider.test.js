const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {parse}=require('./preview-inputs-integration.test');
const {source,textAt}=require('./preview-call-path.test');
async function main(){
 const errors=[],original=Module._load;
 const stub={Uri:{parse:v=>({toString:()=>v,fsPath:v})},EventEmitter:class{},window:{showErrorMessage:m=>errors.push(m)},workspace:{applyEdit(){throw Error('No source writes');}}};
 let Manager;
 try{Module._load=function(r,p,m){return r==='vscode'?stub:original.call(this,r,p,m);};
  const file=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'),'out/providers/npc-dialog-visual.js');
  const loaded=new Module(file,module);loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));
  loaded._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.TestManager=NpcDialogVisualEditorManager;',file);Manager=loaded.exports.TestManager;
 }finally{Module._load=original;}
 const manager=Object.create(Manager.prototype),posted=[];let script=source;
 const session={key:'path',model:parse(source,{},'GOM',{previewPath:[]}),document:{version:1,getText:()=>script},dirty:true,conflict:false,modelRevision:1,previewConditions:{},previewValues:{},panel:{webview:{postMessage:m=>posted.push(m)}}};
 manager.sessions=new Map([[session.key,session]]);manager.hydrateAssets=async()=>{};
 const modelFor=(_d,_c,_l,_s,values,_call,previewPath)=>parse(script,values,'GOM',{previewPath});
 manager.createModel=async(...args)=>modelFor(...args);
 const revision=()=>session.publishedPreview?.revision||session.modelRevision;
 const click=(label,caption)=>{
  const element=session.model.pages.find(p=>p.sourceLabel===label).elements.find(e=>e.text===caption);
  assert.ok(element,'missing test button '+caption);
  return manager.onMessage(session,{type:'previewNavigate',elementId:element.id,trigger:'click',previewRevision:revision()});
 };
 const back=()=>manager.onMessage(session,{type:'previewBack',previewRevision:revision()});
 await click('@main','甲');await click('@page','进入');
 assert.ok(textAt(session.model,'@third').includes('三层=7/甲'));
 assert.equal(session.previewPath.length,2);assert.equal(posted.at(-1).navigatePageId,session.model.pages.find(p=>p.sourceLabel==='@third').id);
 await back();assert.ok(textAt(session.model,'@page').includes('二层=甲/7'));assert.equal(session.previewPath.length,1);
 await click('@page','进入');await click('@third','返回');
 assert.ok(textAt(session.model,'@page').includes('二层=预览文字/预览文字'),'source return is an empty new invocation');
 await back();assert.ok(textAt(session.model,'@third').includes('三层=7/甲'),'preview back restores prior frame');
 await back();await click('@page','回主');assert.equal(session.model.previewNavigation.activeLabel,'@main');
 await back();assert.ok(textAt(session.model,'@page').includes('二层=甲/7'));
 // Selecting a previous page and choosing another branch truncates descendants.
 await click('@main','乙');await click('@page','进入');assert.ok(textAt(session.model,'@third').includes('三层=8/乙'));
 const pending=[];manager.createModel=(...args)=>new Promise(resolve=>pending.push(()=>resolve(modelFor(...args))));
 const first=click('@third','重复'),second=back();pending[1]();await second;pending[0]();await first;
 assert.equal(session.previewPath.length,1,'newest back beats older nested navigation');
 assert.ok(textAt(session.model,'@page').includes('二层=乙/8'));
 manager.createModel=async(...args)=>modelFor(...args);
 await click('@page','进入');
 for(let index=2;index<32;index++)await click('@third','重复');
 assert.equal(session.previewPath.length,32);const before=session.modelRevision;
 await click('@third','重复');assert.equal(session.modelRevision,before,'over-limit call rejected before parse');
 assert.ok(errors.at(-1).includes('32'));
 await back();assert.equal(session.previewPath.length,31,'can recover from limit');
 await manager.onMessage(session,{type:'resetPreview'});assert.equal(session.previewPath.length,0);assert.equal(session.dirty,true);
 assert.ok(posted.filter(m=>m.type==='model').every(m=>m.preserveDrafts));
 script=source.replace('<进入/', '#IF\nCHECK [101] 1\n#SAY\n<进入/');
 session.previewValues={'[101]':'1'};session.previewPath=[];
 session.model=parse(script,session.previewValues,'GOM',{previewPath:[]});session.publishedPreview=undefined;
 await click('@main','甲');await click('@page','进入');assert.equal(session.previewPath.length,2);
 await manager.onMessage(session,{type:'previewInput',name:'[101]',value:'0'});
 assert.equal(session.previewPath.length,1,'changed condition removes stale suffix');
 assert.equal(posted.at(-1).navigatePageId,session.model.pages.find(p=>p.sourceLabel==='@page').id,'redirect to last valid frame');
 console.log('preview-call-path-provider.test.js: PASS');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
