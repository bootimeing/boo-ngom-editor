const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test');
const markup='<Text|text=输入姓名|x=40|y=50|link=@@InPutString22(请输入姓名：)>';
const source='[@main]\n#SAY\n'+markup+'\n[@InPutString22]\n#SAY\n<Text|text=结果=<$NPCPARAMS(1,S22)> 原变量=<$STR(S22)>|x=40|y=50>';
const edge=value=>({sourceLabel:'@main',targetLabel:'@InPutString22',lineNumber:2,column:markup.indexOf('|link='),trigger:'popup-submit',submittedPopup:value});
function run(){
 const m=parse(source,{},'996PC',{previewPath:[]});assert.equal(m.pages.length,2);assert.equal(m.pages[0].elements[0].localPopupInput.variable,'S22');
 const done=parse(source,{},'996PC',{previewPath:[edge('勇士')]});assert.equal(done.previewNavigation.activeLabel,'@InPutString22');assert.equal(done.pages[1].elements[0].text,'结果=勇士 原变量=预览文字');
 for(const value of ['', '<Img|img=12>/$STM(HP)', '甲:乙|丙/@x'])assert.ok(parse(source,{},'996PC',{previewPath:[edge(value)]}).pages[1].elements[0].text.startsWith('结果='+value+' 原变量='));
 for(const value of ['x\ny','x'.repeat(4097),null,42])assert.equal(parse(source,{},'996PC',{previewPath:[edge(value)]}).previewNavigation.calls.length,0);
 const integer=source.replaceAll('InPutString','InPutInteger').replaceAll('S22','N22'),intEdge=value=>({...edge(value),targetLabel:'@InPutInteger22'});
 assert.ok(parse(integer,{},'996PC',{previewPath:[intEdge('9007199254740993')]}).pages[1].elements[0].text.includes('9007199254740993'));
 for(const value of ['1.5','1e3','Infinity','', '-2', '+2'])assert.equal(parse(integer,{},'996PC',{previewPath:[intEdge(value)]}).previewNavigation.calls.length,0);
 for(const engine of ['GOM','GEE'])assert.equal(parse(source,{},engine).pages[0].elements[0].localPopupInput,undefined);
 const duplicate=source+'\n[@InPutString22]\n#SAY\n冲突';assert.equal(parse(duplicate,{},'996PC').pages[0].elements[0].localPopupInput,undefined);
 const forged={...edge('x'),trigger:'click'};assert.equal(parse(source,{},'996PC',{previewPath:[forged]}).previewNavigation.calls.length,0);
 assert.equal(parse(duplicate,{},'996PC',{previewPath:[edge('x')]}).previewNavigation.calls.length,0,'ambiguous callback invalidates replay');
 const plain='<输入姓名/@@InPutString22(请输入姓名：)>',plainSource=source.replace(markup,plain);
 assert.equal(parse(plainSource,{},'996PC',{previewPath:[{...edge('普通链接'),column:plain.indexOf('/@@')}]}).previewNavigation.calls.length,1);
 const conditional=source.replace('#SAY\n'+markup,'#IF\nCHECK [101] 1\n#SAY\n'+markup),condEdge={...edge('x'),lineNumber:4};
 assert.equal(parse(conditional,{'[101]':'1'},'996PC',{previewPath:[condEdge]}).previewNavigation.calls.length,1);
 assert.equal(parse(conditional,{'[101]':'0'},'996PC',{previewPath:[condEdge]}).previewNavigation.calls.length,0,'hidden caller cannot replay');
 const changed=source.replaceAll('String22','String23');assert.equal(parse(changed,{},'996PC',{previewPath:[edge('x')]}).previewNavigation.calls.length,0);
 assert.equal(parse(source.replace('请输入姓名：','提示/@不是链接'),{},'996PC',{previewPath:[edge('x')]}).previewNavigation.calls.length,1);
 console.log('preview-popup-input.test.js: PASS');
}
if(require.main===module)run();module.exports={source,markup,edge,run};
