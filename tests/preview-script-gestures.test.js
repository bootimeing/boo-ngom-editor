const assert=require('node:assert/strict'),path=require('node:path');
const {parse:parseExternal,page}=require('./preview-script-events.test');
const runtime=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const {dialogProgramEventAuthority}=require(path.join(runtime,'out/ui-dialog/preview-script-model'));
const controls=require('./preview-control-submit.test'),menu=require('./preview-menu-submit.test');
const popup=require('./preview-popup-input.test'),completion=require('./preview-completion-call.test'),double=require('./preview-double-click.test'),inputs=require('./preview-input-submit.test');
function externalize(kind,original,config){
 const split=original.indexOf('\n[@',1);assert.ok(split>0);
 const body=original.slice(original.indexOf('\n')+1,split),targets=original.slice(split+1);
 const source='[@main]\n#ACT\nMOV N0 7\n#CALL [\\events.txt] @panel\nMOV N0 99\n#SAY\n'+
  (config.engine==='GOM'?'<TEXT:主末值=<$STR(N0)>:20:200>':'<Text|x=20|y=200|text=主末值=<$STR(N0)>>')+'\n'+targets;
 return {kind,source,external:'[@panel]\n{\n'+body+'\n}',...config};
}
const scenarios=[
 externalize('checkbox',controls.sourceFor(controls.checkbox),{engine:'996PC',trigger:'change',target:'@done',control:{type:2,variable:'N66',value:'1'},expected:'状态=1',invalid:['2','NaN','-1',null]}),
 externalize('slider',controls.sourceFor(controls.slider),{engine:'996PC',trigger:'change',target:'@done',control:{type:3,variable:'N$amount',value:'75'},expected:'数量=75',invalid:['101','NaN','-1',null]}),
 externalize('menu',menu.source,{engine:'996PC',trigger:'change',target:'@done',control:{type:4,variable:'S$choice',value:'装备'},expected:'选择=装备',invalid:['不存在','<Img|img=7>',null]}),
 externalize('popup-string',popup.source,{engine:'996PC',trigger:'popup-submit',target:'@InPutString22',popupValue:'勇士',expected:'结果=勇士 原变量=预览文字',invalid:['x\ny','x'.repeat(4097),null,42]}),
 externalize('popup-integer',popup.source.replaceAll('InPutString','InPutInteger').replaceAll('S22','N22'),{engine:'996PC',trigger:'popup-submit',target:'@InPutInteger22',popupValue:'9007199254740993',expected:'结果=9007199254740993 原变量=0',invalid:['1.5','-1','+1','',null]}),
 ...completion.markups.map((markup,index)=>externalize(['countdown','timetips','loadingbar'][index],completion.sourceFor(markup),{engine:'996PC',trigger:'completion',target:'@done',expected:'完成，保留调用环境=7'})),
 externalize('equip-double',double.source,{engine:'996PC',trigger:'double-click',target:'@double',expected:'双击页面'}),
 externalize('gom-inputs',inputs.source,{engine:'GOM',trigger:'click',target:'@done',submittedInputs:{'1':'张三','2':'28'},expected:'姓名=张三 年龄=28 参数=固定参数',invalid:[{'1':'张三','2':'101'},{'1':'张三'},[]]}),
];
const selfScenario={kind:'self-call',engine:'GOM',trigger:'click',target:'@panel',expected:'完成2',
 source:'[@main]\n#ACT\nMOV N0 0\n#CALL [\\events.txt] @panel',
 external:'[@panel]\n{\n#ACT\nINC N0 1\n#IF\nSMALL N0 2\n#SAY\n<继续<$STR(N0)>/@panel()>\n#ELSESAY\n<TEXT:完成<$STR(N0)>:20:20>\n}'};
const branchScenario={kind:'root-branch',engine:'GOM',trigger:'click',target:'@next',
 source:'[@main]\n#ACT\nMOV N0 10\n#CALL [\\events.txt] @panel\n#SAY\n<TEXT:根:0:0>\n[@next]\n#ACT\nMOV N0 20\n#CALL [\\events.txt] @panel\n#SAY\n<TEXT:下一页:0:0>\n[@done]\n#SAY\n<TEXT:结果=<$SCRIPTPARAM1>/当前=<$STR(N0)>:20:20>',
 external:'[@panel]\n{\n#SAY\n<继续<$STR(N0)>/@next()>\n<去目标<$STR(N0)>/@done(<$STR(N0)>)>\n}'};
function parse(f,previewPath=[],changes={}){return parseExternal(changes.values||{},previewPath,changes.source||f.source,changes.external||f.external,f.engine);}
function elementFor(model,f){return page(model,'@panel').elements.find(element=>f.trigger==='change'?element.localControlTarget===f.target:f.trigger==='popup-submit'?element.localPopupInput?.target===f.target:f.trigger==='completion'?element.localCompletionTarget===f.target:f.trigger==='double-click'?element.localDoubleClickTarget===f.target:element.localParameterTarget===f.target);}
function edgeFor(model,f,overrides={}){
 const element=elementFor(model,f);assert.ok(element,f.kind+' has source-owned external capability');
 const authority=dialogProgramEventAuthority(model,element.id);assert.ok(authority,f.kind+' has host-only authority');
 const {execution}=authority,range=execution.sourceRange;
 const lineStart=Math.max(execution.text.lastIndexOf('\n',range.start-1),execution.text.lastIndexOf('\r',range.start-1))+1;
 const raw=authority.element.raw,marker=f.trigger==='double-click'?'|dblink=':raw.includes('|link=')?'|link=':'/@';
 return {sourceLabel:authority.sourceLabel,sourceRootLabel:authority.sourceRootLabel,targetLabel:f.target,
  sayOccurrence:authority.element.sayOccurrence,lineNumber:execution.lineNumber-1,column:range.start-lineStart+raw.indexOf(marker),trigger:f.trigger,
  ...(f.control?{submittedControl:{...f.control}}:{}),...(f.popupValue!==undefined?{submittedPopup:f.popupValue}:{}),
  ...(f.submittedInputs?{submittedInputs:f.submittedInputs}:{}),...overrides};
}
function run(){
 for(const f of scenarios){
  const initial=parse(f),element=elementFor(initial,f),edge=edgeFor(initial,f);
  assert.equal(element.sourceUri,'file:///D:/event-test/Envir/QuestDiary/events.txt');
  assert.equal(element.executionRootLabel,'@main');
  assert.ok(page(initial,'@main').elements.some(element=>element.text==='主末值=99'));
  const result=parse(f,[edge]);assert.equal(result.previewNavigation.calls.length,1,f.kind+' rooted external event accepted');
  assert.ok(page(result,f.target).elements.some(element=>element.text?.includes(f.expected)),f.kind+' visible target result');
  assert.equal(parse(f,[{...edge,sourceRootLabel:'@forged'}]).previewNavigation.calls.length,0,f.kind+' wrong root');
  assert.equal(parse(f,[{...edge,sayOccurrence:9999}]).previewNavigation.calls.length,0,f.kind+' wrong occurrence');
  assert.equal(parse(f,[{...edge,lineNumber:edge.lineNumber+1}]).previewNavigation.calls.length,0,f.kind+' wrong source line');
  for(const invalid of f.invalid||[]){
   if(f.submittedInputs)continue; // source field/range validation is the Provider admission contract
   const altered=f.control?{submittedControl:{...f.control,value:invalid}}:{submittedPopup:invalid};
   assert.equal(parse(f,[{...edge,...altered}]).previewNavigation.calls.length,0,f.kind+' invalid submitted scalar');
  }
  if(f.control){
   assert.equal(parse(f,[{...edge,submittedControl:{...f.control,variable:'N99'}}]).previewNavigation.calls.length,0,f.kind+' forged variable');
   const duplicate=parse(f,[],{external:f.external.replace('\n}', '\n'+element.raw+'\n}')});
   assert.equal(elementFor(duplicate,f),undefined,f.kind+' duplicate external control identity denied');
  }
  const wrongTrigger=f.trigger==='click'?'completion':'click';
  assert.equal(parse(f,[{...edge,trigger:wrongTrigger}]).previewNavigation.calls.length,0,f.kind+' history gesture must match source-owned capability');
  const staleExternal=f.kind==='countdown'||f.kind==='timetips'?f.external.replace('count=1','count=0'):
    f.kind==='loadingbar'?f.external.replace('interval=0.05','interval=0.00'):
    f.kind==='equip-double'?f.external.replace('<EquipShow|','<ItemShows|'):undefined;
  if(staleExternal)assert.equal(parse(f,[edge],{external:staleExternal}).previewNavigation.calls.length,0,f.kind+' removed source gesture invalidates old history');
 }
 const selfInitial=parse(selfScenario),selfEdge=edgeFor(selfInitial,selfScenario),selfResult=parse(selfScenario,[selfEdge]);
 assert.equal(elementFor(selfInitial,selfScenario).text,'继续1');
 assert.equal(selfResult.previewNavigation.calls.length,1,'valid self-call retains the edge whose button disappears after execution');
 assert.ok(page(selfResult,'@panel').elements.some(element=>element.text===selfScenario.expected),'self-call uses its original caller then renders completed state');
 assert.ok(!elementFor(selfResult,selfScenario),'completed self-call has no surviving old button');
 assert.equal(parse(selfScenario,[selfEdge],{external:selfScenario.external.replace('/@panel()','/@missing()')}).previewNavigation.calls.length,0,'a removed physical self-call target still invalidates history');
 for(const engine of ['GOM','GEE','996PC']){
  const repeated={...selfScenario,engine,external:selfScenario.external.replace('SMALL N0 2','SMALL N0 4')};
  let repeatedModel=parse(repeated),repeatedPath=[];
  for(let count=1;count<=3;count++){
   const current=elementFor(repeatedModel,repeated);assert.ok(current,engine+' external self-call '+count+' retains emitted event authority');
   assert.equal(current.text,'继续'+count);repeatedPath.push(edgeFor(repeatedModel,repeated));repeatedModel=parse(repeated,repeatedPath);
   assert.equal(repeatedModel.previewNavigation.calls.length,count,engine+' every self-call edge is validated in its own original prefix');
  }
  assert.ok(page(repeatedModel,'@panel').elements.some(element=>element.text==='完成4'));
 }
 console.log('preview-script-gestures.test.js: PASS '+scenarios.length+' genuinely external gesture models plus three-engine repeated/disappearing self-call, root/instance/source/scalar/duplicate gates');
}
if(require.main===module)run();module.exports={run,scenarios,selfScenario,branchScenario,parse,elementFor,edgeFor,page};
