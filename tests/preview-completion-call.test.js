const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test');
const markups=['<COUNTDOWN|x=30|y=50|time=1|count=1|link=@done>','<TIMETIPS|x=30|y=50|time=1|count=1|link=@done>','<LoadingBar|x=30|y=50|width=240|height=24|wil=NewopUI|pcloadingbg=102|pcloadingbar=103|startper=0|interval=0.05|loadvalue=25|endper=100|maxper=100|link=@done>'];
const sourceFor=markup=>'[@main]\n#ACT\nMOV N0 7\n#SAY\n'+markup+'\n[@done]\n#SAY\n<Text|x=30|y=50|text=完成，保留调用环境=<$STR(N0)>>';
const edgeFor=markup=>({sourceLabel:'@main',targetLabel:'@done',lineNumber:4,column:markup.indexOf('|link='),trigger:'completion'});
function run(){
 for(const markup of markups){const initial=parse(sourceFor(markup),{},'996PC',{previewPath:[]});assert.equal(initial.pages[0].elements[0].localCompletionTarget,'@done');const result=parse(sourceFor(markup),{},'996PC',{previewPath:[edgeFor(markup)]});assert.equal(result.previewNavigation.activeLabel,'@done');assert.ok(result.pages[1].elements[0].text.includes('环境=7'));}
 for(const markup of [markups[0].replace('time=1','time=<$STR(U101)>'),markups[0].replace('count=1','count=0'),markups[2].replace('startper=0','startper=<$STR(U101)>'),markups[2].replace('interval=0.05','interval=0'),markups[0].replace('|link=@done','|link=@done|link=@done')])assert.equal(parse(sourceFor(markup),{},'996PC',{previewPath:[]}).pages[0].elements[0].localCompletionTarget,undefined);
 console.log('preview-completion-call.test.js: PASS');
}
if(require.main===module)run();module.exports={markups,sourceFor,edgeFor,run};
