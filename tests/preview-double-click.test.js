const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test'),{textAt}=require('./preview-call-path.test');
const source='[@main]\n#SAY\n<EquipShow|x=20|y=20|width=45|height=45|index=0|dblink=@double|link=@single>\n[@single]\n#SAY\n<Text|x=20|y=20|text=单击页面>\n[@double]\n#SAY\n<Text|x=20|y=20|text=双击页面>';
const edge={sourceLabel:'@main',targetLabel:'@double',lineNumber:2,column:source.split('\n')[2].indexOf('|dblink='),trigger:'double-click'};
function run(){
 const model=parse(source,{},'996PC',{previewPath:[]});
 assert.equal(model.pages[0].elements[0].localDoubleClickTarget,'@double');
 assert.equal(model.pages[0].elements[0].localParameterTarget,'@single');
 const clicked=parse(source,{},'996PC',{previewPath:[edge]});
 assert.equal(clicked.previewNavigation.activeLabel,'@double');
 assert.ok(textAt(clicked,'@double').includes('双击页面'));
 assert.equal(parse(source,{},'996PC',{previewPath:[{...edge,trigger:'click'}]}).previewNavigation.calls.length,0,'single click cannot replay double-click field');
 const hero=parse(source.replace('<EquipShow|','<HEROEquipShow|'),{},'996PC',{previewPath:[]});
 assert.equal(hero.pages[0].elements[0].localDoubleClickTarget,'@double');
 const only=parse(source.replace('|link=@single',''),{},'996PC',{previewPath:[]});
 assert.equal(only.pages[0].elements[0].localDoubleClickTarget,'@double');
 assert.equal(only.pages[0].elements[0].localParameterTarget,undefined);
 for(const replacement of ['|dblink=<$STR(S$DEST)>','|dblink=@double|dblink=@single','|dblink=@absent']) {
   const m=parse(source.replace('|dblink=@double',replacement),{},'996PC',{previewPath:[]});
   assert.equal(m.pages[0].elements[0].localDoubleClickTarget,undefined,replacement);
 }
 const item=parse(source.replace('<EquipShow|','<ItemShow|'),{},'996PC',{previewPath:[]});
 assert.equal(item.pages[0].elements[0].localDoubleClickTarget,undefined,'ItemShow does not borrow equipment dblink');
 console.log('preview-double-click.test.js: PASS');
}
if(require.main===module)run();module.exports={source,edge,run};
