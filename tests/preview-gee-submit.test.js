const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test');
const base=require('./preview-input-submit.test').source;
const markups=['<TEXT:提交:20:100:1,2/@done(固定参数)>','<IMG:130:1:20:100:1,2/@done(固定参数)>','<IMGEX:1:130:131:132:20:100:1,2/@done(固定参数)>','<PLAYIMG:1:610:2:100:20:100:0:备注:1,2/@done(固定参数)>','<PLAYIMGEX:1:610:2:100:2:20:100:0:备注:1,2/@done(固定参数)>'];
const makeSource=markup=>base.replace('<提交/@done(固定参数)>',markup);
function edge(source){const lines=source.split('\n'),lineNumber=lines.findIndex(l=>l.includes('/@done'));return{sourceLabel:'@main',targetLabel:'@done',lineNumber,column:lines[lineNumber].indexOf('/@')};}
function run(){
 for(const markup of markups){const source=makeSource(markup),model=parse(source,{},'GEE',{previewPath:[]}),element=model.pages[0].elements.find(e=>e.raw===markup);
  assert.equal(element.localParameterTarget,'@done',markup);assert.deepEqual(element.runtimeActionPreview.submitInputIds,[1,2]);
  const called=parse(source,{},'GEE',{previewPath:[{...edge(source),submittedInputs:{'1':'张三','2':'28'}}]});
  assert.ok(called.pages.find(p=>p.sourceLabel==='@done').elements[0].text.includes('姓名=张三 年龄=28 参数=固定参数'));
  const star=markup.replace(':1,2/@',':*/@'),all=parse(makeSource(star),{},'GEE',{previewPath:[]}).pages[0].elements.find(e=>e.raw===star);
  assert.equal(all.runtimeActionPreview.submitAllInputs,true,'explicit star submits all on current page');
  const bad=markup.replace(':1,2/@',':41/@');assert.ok(!parse(makeSource(bad),{},'GEE',{previewPath:[]}).pages[0].elements.find(e=>e.raw===bad).localParameterTarget);
 }
 const hostile='<IMG:1:1:1:1>|/@hack',source=makeSource(markups[4]);
 const attack=parse(source,{},'GEE',{previewPath:[{...edge(source),submittedInputs:{'1':hostile,'2':'28'}}]});
 assert.ok(attack.pages.find(p=>p.sourceLabel==='@done').elements[0].text.includes(hostile));assert.equal(attack.pages.find(p=>p.sourceLabel==='@done').elements.length,1);
 const noIds=markups[4].replace(':1,2/@',':/@');const noSubmit=parse(makeSource(noIds),{},'GEE',{previewPath:[]}).pages[0].elements.find(e=>e.raw===noIds);
 assert.equal(noSubmit.runtimeActionPreview.submitAllInputs,undefined);assert.equal(noSubmit.runtimeActionPreview.submitInputIds,undefined);
 console.log('preview-gee-submit.test.js: PASS');
}
if(require.main===module)run();module.exports={markups,makeSource,edge,run};
