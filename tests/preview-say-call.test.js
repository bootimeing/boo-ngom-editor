const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test');
const source='[@main]\n#ACT\nMOV N0 0\nWHILE N0 < 3\n#SAY\n<查看/@page(<$STR(N0)>)>\\\n#ACT\nINC N0 1\nENDWHILE\n[@page]\n#SAY\n<TEXT:参数=<$SCRIPTPARAM1>:30:30>';
function edge(index){return {sourceLabel:'@main',targetLabel:'@page',lineNumber:5,column:source.split('\n')[5].indexOf('/@'),sayOccurrence:index};}
function run(){
 const m=parse(source,{},'GOM',{previewPath:[]});
 assert.equal(m.pages[0].elements.filter(e=>e.localParameterTarget).length,3);
 for(let i=0;i<3;i++){
   assert.equal(m.pages[0].elements[i].sayOccurrence,i);
   const selected=parse(source,{},'GOM',{previewPath:[edge(i)]});
   assert.equal(selected.previewNavigation.calls.length,1);
   assert.ok(selected.pages.find(p=>p.sourceLabel==='@page').elements.some(e=>e.text==='参数='+i));
 }
 for(const index of [-1,3,.5])assert.equal(parse(source,{},'GOM',{previewPath:[edge(index)]}).previewNavigation.calls.length,0);
 const legacy={...edge(0)};delete legacy.sayOccurrence;
 assert.equal(parse(source,{},'GOM',{previewPath:[legacy]}).previewNavigation.calls.length,0,'ambiguous legacy loop call cannot borrow last environment');
 const {call,textAt}=require('./preview-call-path.test');
 const stateSource=source.replace('参数=<$SCRIPTPARAM1>','参数=<$SCRIPTPARAM1>/N0=<$STR(N0)>');
 for(const i of [0,1,2])assert.ok(textAt(parse(stateSource,{},'GOM',{previewPath:[edge(i)]}),'@page').includes('参数='+i+'/N0='+i),'whole caller environment belongs to the clicked iteration');
 const variableSource=source.replace('WHILE N0 < 3','WHILE N0 < U101');
 assert.equal(parse(variableSource,{U101:'3'},'GOM',{previewPath:[edge(2)]}).previewNavigation.calls.length,1);
 const vanished=parse(variableSource,{U101:'1'},'GOM',{previewPath:[edge(2)]});
 assert.equal(vanished.previewNavigation.calls.length,0,'input change removes selected occurrence');
 assert.equal(vanished.previewNavigation.activeLabel,'@main');
 const twin=source.replace('<查看/@page(<$STR(N0)>)>','<查看/@page(<$STR(N0)>)> <另一项/@page(另一项,<$STR(N0)>)>').replace('参数=<$SCRIPTPARAM1>','参数=<$SCRIPTPARAM1>/<$SCRIPTPARAM2>');
 const twinCall={...call(twin,'@main','另一项'),sayOccurrence:1};
 assert.ok(textAt(parse(twin,{},'GOM',{previewPath:[twinCall]}),'@page').includes('参数=另一项/1'),'columns distinguish links in the same occurrence');
 const conditional=source.replace('#SAY\n<查看','\n#IF\nCHECK [101] 1\n#SAY\n<别项/@page(另一项)>\\\n#SAY\n<查看');
 const shifted={...call(conditional,'@main','查看'),sayOccurrence:1};
 assert.equal(parse(conditional,{'[101]':'1'},'GOM',{previewPath:[shifted]}).previewNavigation.calls.length,1);
 assert.equal(parse(conditional,{'[101]':'0'},'GOM',{previewPath:[shifted]}).previewNavigation.calls.length,0,'changed event line cannot borrow another line environment');
 const injected=source.replace('/@page(<$STR(N0)>)','/@page(<$STR(S$名字)>,<$STR(N0)>)').replace('参数=<$SCRIPTPARAM1>','参数=<$SCRIPTPARAM1>/<$SCRIPTPARAM2>');
 const hostile='<IMG:1:1:1:1>|/@hack';
 const protectedModel=parse(injected,{'S$名字':hostile},'GOM',{previewPath:[edge(1)]});
 assert.ok(textAt(protectedModel,'@page').includes('参数='+hostile+'/1'));
 assert.equal(protectedModel.pages.find(p=>p.sourceLabel==='@page').elements.length,1,'iteration snapshots preserve literal protection');
 console.log('preview-say-call.test.js: PASS');
}
if(require.main===module)run();module.exports={source,edge,run};
