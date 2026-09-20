const assert = require('node:assert/strict');
const {parse} = require('./preview-inputs-integration.test');
const {call, textAt} = require('./preview-call-path.test');
const source = '[@main]\n#SAY\n<INPUTTEXT:1:20:20:120:20:0:249:255:0:20:姓名过长:输入姓名:160>\n<INPUTNUM:2:20:60:120:20:0:249:255:1:100:范围错误:年龄:160>\n<提交/@done(固定参数)>\n[@done]\n#SAY\n<TEXT:姓名=<$NPCINPUT(1)> 年龄=<$NPCINPUT(2)> 参数=<$SCRIPTPARAM1>:20:100>';
function run() {
 const edge = {...call(source, '@main', '提交'), submittedInputs: {'1':'张三', '2':'28'}};
 const model = parse(source, {}, 'GOM', {previewPath:[edge]});
 assert.ok(textAt(model, '@done').includes('姓名=张三 年龄=28 参数=固定参数'), textAt(model, '@done'));
 const input = model.previewInputs.find(i=>i.name==='NPCINPUT(1)');
 assert.equal(input?.kind, 'text');
 const hostile='<IMG:1:1:1:1>|/@hack';
 const attack=parse(source,{},'GOM',{previewPath:[{...edge,submittedInputs:{'1':hostile,'2':''}}]});
 assert.ok(textAt(attack,'@done').includes(hostile));
 assert.equal(attack.pages.find(p=>p.sourceLabel==='@done').elements.length,1);
 const plain=source.replace('提交/@done(固定参数)','提交/@done');
 assert.ok(parse(plain,{},'GOM',{previewPath:[]}).pages[0].elements.some(e=>e.localParameterTarget==='@done'));
 for (const markup of ['<TEXT:提交:20:100:1,2/@done>', '<IMG:130:1:20:100:1,2|提示/@done>', '<IMGEX:0:120:121:122:20:100:1,2|提示/@done>', '<PLAYIMG:1:610:2:100:20:100:0:0:1,2/@done>']) {
   const m=parse(source.replace('<提交/@done(固定参数)>',markup),{},'GOM',{previewPath:[]});
   const action=m.pages[0].elements.find(e=>e.raw===markup);
   assert.deepEqual(action.runtimeActionPreview.submitInputIds,[1,2],markup);
   assert.equal(action.localParameterTarget,'@done',markup);
 }
 for (const markup of ['<IMG:130:1:20:100:按钮,0,0,254#/@done>', '<PLAYIMG:1:610:2:100:20:100:0:0:按钮,0,0,254#/@done>']) {
   const m=parse(source.replace('<提交/@done(固定参数)>',markup),{},'GOM',{previewPath:[]});
   const action=m.pages[0].elements.find(e=>e.raw===markup);
   assert.equal(action.localParameterTarget,'@done','title is not invalid input IDs');
   assert.equal(action.runtimeActionPreview.submitInputIds,undefined,'title does not submit inputs');
 }
 console.log('preview-input-submit.test.js: PASS');
}
if(require.main===module)run();
module.exports={source,run};
