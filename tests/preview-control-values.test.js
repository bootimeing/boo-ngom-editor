const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test');
const {checkbox,slider,sourceFor}=require('./preview-control-submit.test');
const checked=checkbox.replace('default=0','default=<$STR(N66)>');
const ranged=slider.replace('maxvalue=100','maxvalue=<$STR(N$max)>').replace('defvalue=25','defvalue=<$STR(N$start)>');
function run(){
 const get=(markup,values,act='')=>parse(sourceFor(markup).replace('#SAY','#ACT\n'+act+'\n#SAY'),values,'996PC',{previewPath:[]}).pages[0].elements[0];
 for(const e of [get(checked,{},'MOV N66 1'),get(checked,{N66:'1'})]){
  assert.equal(e.localControlState?.value,1);assert.equal(e.localControlTarget,'@done');assert.equal(e.togglePreview.checked,undefined,'raw source checked remains unknown');assert.ok(e.togglePreview.dynamicFields.includes('checked'));
 }
 const range=get(ranged,{'N$max':'100','N$start':'25'});assert.deepEqual([range.localControlState.minimum,range.localControlState.maximum,range.localControlState.value],[0,100,25]);assert.equal(range.sliderPreview.maximum,undefined);assert.equal(range.localControlTarget,'@done');
 const edge=require('./preview-control-submit.test').edgeFor(ranged,3,'N$amount','75');
 const changedRange=parse(sourceFor(ranged),{'N$max':'50','N$start':'25'},'996PC',{previewPath:[edge]});
 assert.equal(changedRange.previewNavigation.calls.length,0,'range changes invalidate old out-of-range events');
 for(const e of [get(checked,{}),get(checked,{N66:'2'}),get(ranged,{'N$max':'0','N$start':'0'}),get(ranged,{'N$max':'10','N$start':'11'}),get(ranged,{'N$start':'0'})]){assert.equal(e.localControlState,undefined);assert.equal(e.localControlTarget,undefined);}
 console.log('preview-control-values.test.js: PASS');
}
if(require.main===module)run();module.exports={checked,ranged,run};
