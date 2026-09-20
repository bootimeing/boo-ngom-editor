const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const {parse,visible}=require('./preview-inputs-integration.test');
const {source}=require('./preview-selected-call.test');
async function main(){
  const errors=[],original=Module._load;
  const stub={Uri:{parse:value=>({toString:()=>value,fsPath:value})},EventEmitter:class{},
    window:{showErrorMessage:m=>errors.push(m)},workspace:{applyEdit(){throw Error('source write forbidden');}}};
  let Manager;
  try{
    Module._load=function(request,parent,isMain){return request==='vscode'?stub:original.call(this,request,parent,isMain);};
    const file=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'),'out/providers/npc-dialog-visual.js');
    const loaded=new Module(file,module);loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));
    loaded._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.TestManager=NpcDialogVisualEditorManager;',file);Manager=loaded.exports.TestManager;
  }finally{Module._load=original;}
  const manager=Object.create(Manager.prototype),posted=[];
  const session={key:'selected',model:parse(source),document:{version:1,getText:()=>source},dirty:true,conflict:false,
    modelRevision:1,previewConditions:{},previewValues:{},panel:{webview:{postMessage:m=>posted.push(m)}}};
  manager.sessions=new Map([[session.key,session]]);manager.hydrateAssets=async()=>{};
  const modelFor=(_d,_c,_l,_s,values,call,previewPath)=>parse(source,values,'GOM',{previewCall:call,previewPath});
  manager.createModel=async(...args)=>modelFor(...args);
  const click=index=>manager.onMessage(session,{type:'previewNavigate',elementId:session.model.pages[0].elements[index].id,
    trigger:'click',previewRevision:session.publishedPreview?.revision||session.modelRevision});
  await click(0);assert.ok(visible(session.model).includes('甲 / 7'));assert.equal(session.dirty,true);
  assert.equal(posted.at(-1).navigatePageId,session.model.pages[1].id);assert.equal(posted.at(-1).preserveDrafts,true);
  await click(1);assert.ok(visible(session.model).includes('乙 / 8'));
  await click(2);assert.ok(visible(session.model).includes('预览文字 / 预览文字'));
  await click(0);await click(3);assert.ok(visible(session.model).includes('预览文字 / 预览文字'),'bare no-arg link clears previous frame');
  const pending=[];manager.createModel=(...args)=>new Promise(resolve=>pending.push(()=>resolve(modelFor(...args))));
  const first=click(0),second=click(1);assert.equal(pending.length,2,'both clicks from the displayed revision are accepted');
  pending[1]();await second;pending[0]();await first;assert.ok(visible(session.model).includes('乙 / 8'),'newest click wins');
  manager.createModel=async(...args)=>modelFor(...args);
  await manager.onMessage(session,{type:'resetPreview'});assert.equal(session.previewCall,undefined);
  assert.ok(!visible(session.model).includes('乙 / 8'));assert.equal(session.dirty,true);
  const revision=session.modelRevision;
  await manager.onMessage(session,{type:'previewNavigate',elementId:session.model.pages[0].elements[0].id,trigger:'click',previewRevision:1});
  assert.equal(session.modelRevision,revision,'stale revision rejected');
  await manager.onMessage(session,{type:'previewNavigate',elementId:'forged',trigger:'click',previewRevision:revision});
  assert.equal(session.modelRevision,revision);assert.equal(errors.length,1);
  session.document.version=2;await click(0);assert.equal(session.modelRevision,revision,'edited source rejected');
  console.log('preview-selected-call-provider.test.js: PASS');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
