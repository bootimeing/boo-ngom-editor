const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {parse}=require('./preview-inputs-integration.test');
const {source}=require('./preview-input-submit.test');
const {textAt}=require('./preview-call-path.test');
async function run(){
 const errors=[],original=Module._load;let Manager;
 try {Module._load=function(r,p,m){return r==='vscode'?{Uri:{parse:v=>({toString:()=>v,fsPath:v})},EventEmitter:class{},window:{showErrorMessage:m=>errors.push(m)},workspace:{applyEdit(){throw Error('source write');}}}:original.call(this,r,p,m);};
 const file=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'),'out/providers/npc-dialog-visual.js');
 const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));
 mod._compile(fs.readFileSync(file,'utf8')+'\nmodule.exports.TestManager=NpcDialogVisualEditorManager;',file);Manager=mod.exports.TestManager;
 }finally{Module._load=original;}
 const manager=Object.create(Manager.prototype);let script=source,engine='GOM';
 const session={key:'submit',model:parse(script,{},'GOM',{previewPath:[]}),document:{version:1,getText:()=>script},dirty:true,conflict:false,modelRevision:1,previewConditions:{},previewValues:{},panel:{webview:{postMessage(){}}}};
 manager.sessions=new Map([[session.key,session]]);manager.hydrateAssets=async()=>{};
 manager.createModel=async(_d,_c,_l,_s,values,_call,previewPath)=>parse(script,values,engine,{previewPath});
 const click=values=>manager.onMessage(session,{type:'previewNavigate',elementId:session.model.pages[0].elements.find(e=>e.localParameterTarget).id,trigger:'click',previewRevision:session.publishedPreview?.revision||session.modelRevision,submittedInputs:values});
 await click({'1':'张三','2':'28','40':'伪造'});
 assert.ok(textAt(session.model,'@done').includes('姓名=张三 年龄=28 参数=固定参数'));
 assert.deepEqual(session.previewPath[0].submittedInputs,{'1':'张三','2':'28'});
 const before=session.modelRevision;
 await click({'1':'张三','2':'101'});assert.equal(session.modelRevision,before);assert.ok(errors.at(-1).includes('范围错误'));
 await click({'1':'张三'});assert.equal(session.modelRevision,before,'missing field rejected');
 await click([]);assert.equal(session.modelRevision,before,'array rejected');
 script=source.replace('<提交/@done(固定参数)>','<TEXT:提交:20:100:1/@done(固定参数)>');
 session.model=parse(script,{},'GOM',{previewPath:[]});session.publishedPreview=undefined;
 await click({'1':'仅姓名','2':'999'});
 assert.deepEqual(session.previewPath[0].submittedInputs,{'1':'仅姓名'},'only selected input validated/submitted');
 assert.ok(textAt(session.model,'@done').includes('姓名=仅姓名'));
 script=source.replace('<提交/', '<INPUTTEXT:1:20:150:100:20>\n<提交/');session.model=parse(script,{},'GOM',{previewPath:[]});session.publishedPreview=undefined;
 const count=session.modelRevision;await click({'1':'重复','2':'28'});assert.equal(session.modelRevision,count);assert.ok(errors.at(-1).includes('不唯一'));
 assert.equal(session.dirty,true);
 for (const markup of ['<PLAYIMG:1:610:2:100:20:100:0:0:1,2/@done(固定参数)>', '<IMG:130:1:20:100:按钮,0,0,254#/@done(固定参数)>']) {
   script=source.replace('<提交/@done(固定参数)>',markup);
   session.model=parse(script,{},engine,{previewPath:[]});session.publishedPreview=undefined;
   await click({'1':'动画提交','2':'28'});
   assert.equal(session.model.previewNavigation.activeLabel,'@done');
   if(markup.startsWith('<PLAYIMG')) assert.ok(textAt(session.model,'@done').includes('姓名=动画提交 年龄=28'));
   else assert.equal(session.previewPath[0].submittedInputs,undefined,'title does not submit IDs');
 }
 engine='996PC';script=require('./preview-engine-click.test').source;
 session.model=parse(script,{},engine,{previewPath:[]});session.publishedPreview=undefined;
 await click({'1':'996文字'});assert.ok(textAt(session.model,'@done').includes('输入=996文字'));
 assert.deepEqual(session.previewPath[0].submittedInputs,{'1':'996文字'});
 script=require('./preview-engine-click.test').named;session.model=parse(script,{},engine,{previewPath:[]});session.publishedPreview=undefined;
 await click({});assert.ok(textAt(session.model,'@done').includes('布衣(男) 数量=300'));
 console.log('preview-input-submit-provider.test.js: PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
