const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test'),{textAt,call}=require('./preview-call-path.test');
const source='[@main]\n#SAY\n<Input|x=20|y=20|width=140|height=25|inputid=1|type=0|color=<$STR(N99)>|errortips=太长|maxcount=20>\n<Button|x=20|y=60|width=100|height=30|text=提交|submitInput=1|link=@done>\n[@done]\n#SAY\n<Text|x=20|y=20|text=输入=<$NPCINPUT(1)>>';
const lines=source.split('\n');
const edge={sourceLabel:'@main',targetLabel:'@done',lineNumber:3,column:lines[3].indexOf('|link='),submittedInputs:{'1':'996文字'}};
const named='[@main]\n#SAY\n<传参/@done#装备名=布衣(男)#数量=300>\n[@done]\n#SAY\n<Text|x=20|y=20|text=<$STR(S$装备名)> 数量=<$STR(S$数量)>>';
const selected={sourceLabel:'@main',targetLabel:'@done',lineNumber:2,column:named.split('\n')[2].indexOf('/@')};
function run(){
 const initial=parse(source,{},'996PC',{previewPath:[]});
 assert.equal(initial.pages[0].elements.find(e=>e.raw.startsWith('<Button|'))?.localParameterTarget,'@done');
 const result=parse(source,{},'996PC',{previewPath:[edge]});
 assert.ok(textAt(result,'@done').includes('输入=996文字'),textAt(result,'@done'));
 assert.equal(result.previewNavigation.calls.length,1);
 const invalid=parse(source,{},'996PC',{previewPath:[{...edge,column:0}]});assert.equal(invalid.previewNavigation.calls.length,0);
 const gee='[@main]\n#SAY\n<进入/@page(原值)>\n[@page]\n#ACT\nGOTO @inner\n#SAY\n<TEXT:回来=<$SCRIPTPARAM1>:20:20>\n[@inner]\n#SAY\n<TEXT:内部=<$SCRIPTPARAM1>:20:20>';
 const frame=call(gee,'@main','进入');
 assert.ok(textAt(parse(gee,{},'GEE',{previewPath:[frame]}),'@page').includes('回来=预览文字'),'GEE does not restore caller parameters after GOTO');
 assert.ok(textAt(parse(gee,{},'GOM',{previewPath:[frame]}),'@page').includes('回来=原值'),'GOM frame semantics remain separate');
 const namedModel=parse(named,{},'996PC',{previewPath:[selected]});
 assert.equal(namedModel.pages[0].elements[0].localParameterTarget,'@done');
 assert.ok(textAt(namedModel,'@done').includes('布衣(男) 数量=300'));
 const hostile='<IMG:1:1:1:1>|/@hack#数量=999';
 const dynamic=named.replace('布衣(男)','<$STR(S$输入)>');
 const attack=parse(dynamic,{'S$输入':hostile},'996PC',{previewPath:[selected]});
 assert.ok(textAt(attack,'@done').includes(hostile));
 assert.equal(attack.pages.find(p=>p.sourceLabel==='@done').elements.length,1);
 for(const suffix of ['#装备名=a#装备名=b','#装备名=a#非法-名字=b','(1)#装备名=a']) {
   const bad=named.replace('#装备名=布衣(男)#数量=300',suffix);
   assert.equal(parse(bad,{},'996PC',{previewPath:[]}).pages[0].elements[0].localParameterTarget,undefined);
 }
 console.log('preview-engine-click.test.js: PASS');
}
if(require.main===module)run();module.exports={source,edge,named,selected,run};
