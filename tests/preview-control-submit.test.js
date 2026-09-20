const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test');
const checkbox='<CheckBox|x=30|y=50|checkboxid=n66|wil=NewopUI|pcnimg=192|pcpimg=193|default=0|delay=1|count=1|link=@done>';
const slider='<Slider|wil=NewopUI|sliderid=N$amount|x=50|y=100|width=300|height=24|maxvalue=100|defvalue=25|pcbgimg=298|pcbarimg=299|pcballimg=297|link=@done>';
const sourceFor=markup=>'[@main]\n#SAY\n'+markup+'\n[@done]\n#SAY\n<Text|x=30|y=50|text=状态=<$NPCPARAMS(2,N66)> 数量=<$NPCPARAMS(3,N$amount)>>';
const edgeFor=(markup,type,variable,value)=>({sourceLabel:'@main',targetLabel:'@done',lineNumber:2,column:markup.indexOf('|link='),trigger:'change',submittedControl:{type,variable,value}});
function run(){
 for(const [markup,type,variable,value] of [[checkbox,2,'N66','1'],[slider,3,'N$amount','75']]){
  const source=sourceFor(markup),initial=parse(source,{},'996PC',{previewPath:[]});
  assert.equal(initial.pages[0].elements[0].localControlTarget,'@done');
  const result=parse(source,{},'996PC',{previewPath:[edgeFor(markup,type,variable,value)]});
  assert.ok(result.pages[1].elements[0].text.includes(type===2?'状态=1':'数量=75'));
  assert.equal(result.previewInputs.find(i=>i.name===`NPCPARAMS(${type},${variable})`).kind,'number');
  assert.equal(initial.pages[0].elements[0].localParameterTarget,undefined,'click path cannot bypass typed state validation');
 }
 for(const markup of [checkbox.replace('default=0','default=<$STR(U101)>'),slider.replace('maxvalue=100','maxvalue=<$STR(U101)>'),checkbox.replace('checkboxid=n66','checkboxid=S0'),slider.replace('sliderid=N$amount','sliderid=U101'),checkbox.replace('|link=@done','|link=@done|link=@done')]){
  assert.equal(parse(sourceFor(markup),{},'996PC',{previewPath:[]}).pages[0].elements[0].localControlTarget,undefined,'uncertain/invalid state is not submitted');
 }
 const typed=parse(sourceFor(checkbox),{'NPCPARAMS(2,N66)':'1','NPCPARAMS(3,N$amount)':'88'},'996PC',{previewPath:[]});
 const duplicateInvalid=parse(sourceFor(checkbox+'\n'+checkbox.replace('default=0','default=2')),{},'996PC',{previewPath:[]});
 assert.equal(duplicateInvalid.pages[0].elements[0].localControlTarget,undefined,'invalid peer still occupies the same variable identity');
 assert.ok(typed.pages[1].elements[0].text.includes('状态=1 数量=88'));
 for(const engine of ['GOM','GEE'])assert.ok(!parse('[@main]\n#SAY\n<$NPCPARAMS(2,N66)>',{},engine).previewInputs.some(i=>i.name==='NPCPARAMS(2,N66)'));
 console.log('preview-control-submit.test.js: PASS');
}
if(require.main===module)run();module.exports={checkbox,slider,sourceFor,edgeFor,run};
