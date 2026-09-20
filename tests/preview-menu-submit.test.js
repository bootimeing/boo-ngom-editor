const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test');
const markup='<MenuItem|menuid=S$choice|x=100|y=80|width=240|height=30|itemname=金币#装备#地图|select=金币|direction=0|itemhei=30|link=@done>';
const source='[@main]\n#SAY\n'+markup+'\n[@done]\n#SAY\n<Text|x=40|y=40|text=选择=<$NPCPARAMS(4,S$choice)>>';
const edge=value=>({sourceLabel:'@main',targetLabel:'@done',lineNumber:2,column:markup.indexOf('|link='),trigger:'change',submittedControl:{type:4,variable:'S$choice',value}});
function run(){
 const initial=parse(source,{},'996PC',{previewPath:[]});assert.equal(initial.pages[0].elements[0].localControlTarget,'@done');
 const result=parse(source,{},'996PC',{previewPath:[edge('装备')]});assert.equal(result.previewNavigation.activeLabel,'@done');assert.equal(result.pages[1].elements[0].text,'选择=装备');
 for(const value of ['不存在','<IMG:1:1:1:1>'])assert.equal(parse(source,{},'996PC',{previewPath:[edge(value)]}).previewNavigation.calls.length,0);
 const removed=source.replace('金币#装备#地图','金币#地图');assert.equal(parse(removed,{},'996PC',{previewPath:[edge('装备')]}).previewNavigation.calls.length,0,'removed choice invalidates history');
 const dup=source.replace(markup,markup+'\n'+markup.replace('itemname=金币#装备#地图','itemname=<$STR(S2)>'));assert.equal(parse(dup,{},'996PC',{previewPath:[]}).pages[0].elements[0].localControlTarget,undefined,'unusable peer occupies menu identity');
 const dynamic=parse(source.replace('金币#装备#地图','<$STR(S2)>'),{S2:'金币#装备'},'996PC',{previewPath:[]});assert.equal(dynamic.pages[0].elements[0].localControlTarget,undefined,'local text cannot manufacture options');
 const typed=parse('[@main]\n#SAY\n<Text|text=文字=<$NPCPARAMS(1,S22)> 数字=<$NPCPARAMS(1,N22)> 菜单=<$NPCPARAMS(4,S0)>|x=20|y=20>',{'NPCPARAMS(1,S22)':'测试','NPCPARAMS(1,N22)':'25','NPCPARAMS(4,S0)':'金币'},'996PC');
 assert.equal(typed.pages[0].elements[0].text,'文字=测试 数字=25 菜单=金币');
 assert.equal(typed.previewInputs.find(i=>i.name==='NPCPARAMS(1,N22)').kind,'number');
 console.log('preview-menu-submit.test.js: PASS');
}
if(require.main===module)run();module.exports={markup,source,edge,run};
