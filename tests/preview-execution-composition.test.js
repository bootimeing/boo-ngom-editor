const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test');
const path=require('node:path');
const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const {buildDialogCoordinateEdits}=require(path.join(root,'out/ui-dialog/source-patcher'));
const source='[@main]\n#ACT\nMOV N0 10\n#SAY\nA<$STR(N0)>\\\n#ACT\nGOTO @child\nMOV N0 20\nGOTO @child\n#SAY\nC<$STR(N0)>\\\n[@child]\n#SAY\nB<$STR(N0)>\\\n<TEXT:位置<$STR(N0)>:60:80/@next(<$STR(N0)>)>\\\n[@next]\n#SAY\nNext<$SCRIPTPARAM1>';
function run(){
 const m=parse(source);
 const page=m.pages.find(p=>p.executionPreview);
 assert.ok(page,'cross-label SAY needs an explicit execution composition');
 assert.deepEqual(page.elements.map(e=>e.text),['A10','B10','位置10','B20','位置20','C20']);
 assert.deepEqual(page.elements.map(e=>e.executionSourceLabel),['@main','@child','@child','@child','@child','@main']);
 assert.equal(new Set(page.elements.map(e=>e.id)).size,6);
 assert.ok(page.elements.every(e=>e.executionPreview&&!e.editable&&!e.localParameterTarget));
 const coordinate=page.elements.find(e=>e.x&&e.y);
 assert.throws(()=>buildDialogCoordinateEdits(source,m,[{elementId:coordinate.id,x:100,y:100}]),/直接数值/);
 assert.ok(page.conditionSummary.includes('本地')&&page.conditionSummary.includes('只读'));
 const child=m.pages.find(p=>p.sourceLabel==='@child');
 assert.deepEqual(child.elements.filter(e=>e.text.startsWith('B')).map(e=>e.text),['B10','B20'],'repeated non-loop CALL outputs preserve each instance');
 assert.ok(child.elements.every(e=>Number.isInteger(e.sayOccurrence)&&e.executionRootLabel==='@main'));
 const noCall=parse('[@main]\n#SAY\nA\n<页面/@other>\n[@other]\n#SAY\nB');
 assert.ok(!noCall.pages.some(p=>p.executionPreview),'reachability exploration is not actual execution');
 const conditional=parse(source.replace('GOTO @child\nMOV','#IF\nEQUAL N0 99\n#ACT\nGOTO @child\n#IF\n#ACT\nMOV'));
 assert.ok(!conditional.pages.find(p=>p.executionPreview).elements.some(e=>e.text==='B10'),'inactive calls are excluded');
 const injection=parse(source.replace('A<$STR(N0)>','<$STR(S0)>'),{S0:'<IMG:1:2:3:4>/@hack'});
 assert.equal(injection.pages.find(p=>p.executionPreview).elements[0].text,'<IMG:1:2:3:4>/@hack');
 assert.ok(injection.pages.find(p=>p.executionPreview).elements.every(e=>!e.assetRef));
 for(const engine of ['GEE','996PC']) assert.ok(parse(source,{},engine).pages.some(p=>p.executionPreview),'own supported GOTO execution can show '+engine+' timeline');
 for(const [engine,macro]of [['GOM','($Missing)'],['GEE','($Missing)'],['996PC','$(Missing)']]){
  const missing=parse('[@main]\n#ACT\nMOV N0 '+macro+'\nMOV S0 prefix'+macro+'\n#SAY\n<TEXT:数量=<$STR(N0)> 文字=<$STR(S0)>:10:20>',{},engine);
  assert.equal(missing.pages[0].elements[0].text,'数量=0 文字=prefix预览文字');
  assert.ok(missing.pages[0].resolvedVariables.filter(v=>['N0','S0'].includes(v.name)).every(v=>v.status!=='resolved'),'unexpanded source constant never gets static proof');
  const literal=parse('[@main]\n#ACT\nMOV S1 <$STR(S0)>\n#SAY\n<TEXT:<$STR(S1)>:10:20>',{S0:macro},engine);
  assert.equal(literal.pages[0].elements[0].text,macro,'user macro-looking text remains literal');
 }
 console.log('preview-execution-composition.test.js: PASS');
}
if(require.main===module)run();module.exports={source,run};
