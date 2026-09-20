const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test');
const source='[@main]\n#SAY\n<甲/@page(甲,7)> <乙/@page(乙,8)>\n[@page]\n#SAY\n<TEXT:二层=<$SCRIPTPARAM1>/<$SCRIPTPARAM2>:30:60>\n<进入/@third(<$SCRIPTPARAM2>,<$SCRIPTPARAM1>)> <回主/@main>\n[@third]\n#SAY\n<TEXT:三层=<$SCRIPTPARAM1>/<$SCRIPTPARAM2>:30:100>\n<返回/@page()> <重复/@third(<$SCRIPTPARAM2>,<$SCRIPTPARAM1>)>';
function call(text,label,caption){
 const lines=text.split(/\r\n|\r|\n/);let current='';
 for(let n=0;n<lines.length;n++){
  if(lines[n].startsWith('[@'))current=lines[n].slice(1,-1);
  const index=lines[n].indexOf('<'+caption+'/@');
  if(current===label&&index>=0){const column=index+caption.length+1;return {sourceLabel:label,targetLabel:/^\/(@[^()<>,\s]+)/.exec(lines[n].slice(column))[1],lineNumber:n,column};}
 }
 throw Error('missing call '+label+' '+caption);
}
const rootCall=call(source,'@main','甲'),nestedCall=call(source,'@page','进入');
const textAt=(m,label)=>m.pages.find(p=>p.sourceLabel.toLowerCase()===label.toLowerCase()).elements.map(e=>e.text).join('\n');
function run(){
 const path=[rootCall,nestedCall];
 const deep=parse(source,{},'GOM',{previewPath:path});
 assert.ok(textAt(deep,'@third').includes('三层=7/甲'),textAt(deep,'@third'));
 assert.equal(deep.previewNavigation.calls.length,2);
 assert.ok(deep.pages.find(p=>p.sourceLabel==='@page').elements.some(e=>e.localParameterTarget==='@third'));
 const back=parse(source,{},'GOM',{previewPath:path.slice(0,-1)});
 assert.ok(textAt(back,'@page').includes('二层=甲/7'));
 const empty=parse(source,{},'GOM',{previewPath:[...path,call(source,'@third','返回')]});
 assert.ok(textAt(empty,'@page').includes('二层=预览文字/预览文字'));
 const repeated=parse(source,{},'GOM',{previewPath:[...path,call(source,'@third','重复')]});
 assert.ok(textAt(repeated,'@third').includes('三层=甲/7'));
 const alternate=parse(source,{},'GOM',{previewPath:[call(source,'@main','乙'),nestedCall]});
 assert.ok(textAt(alternate,'@third').includes('三层=8/乙'));
 const invalid=parse(source,{},'GOM',{previewPath:[rootCall,{...nestedCall,column:0}]});
 assert.equal(invalid.previewNavigation.calls.length,1,'invalid suffix is not executed');
 assert.ok(invalid.warnings.some(w=>w.includes('点击路径')));
 const long=parse(source,{},'GOM',{previewPath:[...path,...Array(40).fill(call(source,'@third','重复'))]});
 assert.ok(long.previewNavigation.calls.length<=32,'bounded replay');
 assert.ok(long.warnings.some(w=>w.includes('32')));
 const conditional=source.replace('<进入/', '#IF\nCHECK [101] 1\n#SAY\n<进入/');
 const conditionalPath=[call(conditional,'@main','甲'),call(conditional,'@page','进入')];
 assert.equal(parse(conditional,{'[101]':'1'},'GOM',{previewPath:conditionalPath}).previewNavigation.calls.length,2);
 const hidden=parse(conditional,{'[101]':'0'},'GOM',{previewPath:conditionalPath});
 assert.equal(hidden.previewNavigation.calls.length,1,'a changed condition invalidates the suffix');
 assert.equal(hidden.previewNavigation.activeLabel,'@page');
 const injected=source.replace('甲,7','<$STR(S$名字)>,7');
 const hostile='<IMG:1:1:1:1>|/@hack';
 const protectedModel=parse(injected,{'S$名字':hostile},'GOM',{previewPath:[call(injected,'@main','甲'),call(injected,'@page','进入')]});
 assert.ok(textAt(protectedModel,'@third').includes('三层=7/'+hostile),'raw/display protection survives nested frames');
 assert.equal(protectedModel.pages.find(p=>p.sourceLabel==='@third').elements.length,3,'no injected control');
 for(const engine of ['GEE','996PC'])assert.ok(textAt(parse(source,{},engine,{previewPath:path}),'@third').includes('三层=7/甲'),'own-engine legacy click parameter frames');
 const {reflowNpcDialogLayout}=require(require('node:path').resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||require('node:path').join(__dirname,'..'),'out/ui-dialog/source-parser'));
 reflowNpcDialogLayout(deep);
 assert.ok(deep.pages.find(p=>p.sourceLabel==='@page').elements.some(e=>e.localParameterTarget==='@third'),'provider reflow retains navigation capability');
 console.log('preview-call-path.test.js: PASS');
}
if(require.main===module)run();module.exports={run,source,call,rootCall,nestedCall,textAt};
