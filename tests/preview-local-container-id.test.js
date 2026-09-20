const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test');
const source='[@main]\n#SAY\n<&Layout:~#BOX<$STR(U102)>:100:80:300:120>\n<Text:#BOX<$STR(U102)>~:输入编号容器:20:30>';
function run(){
 for(const value of ['0','7','12']){
  const m=parse(source,{U102:value}),[parent,child]=m.pages[0].elements;
  assert.equal(parent.containerElementId,'BOX'+value,'explicit local number must bind parent');
  assert.equal(child.containerParentId,'BOX'+value);assert.equal(child.parentElementId,parent.id);
  assert.deepEqual([child.layoutX,child.layoutY],[116,106]);
  assert.ok(parent.warning.includes('本地输入'));
 }
 const unknown=parse(source).pages[0].elements;
 assert.ok(unknown.every(e=>!e.containerElementId&&!e.containerParentId),'automatic placeholder zero grants no identity');
 const strings=source.replaceAll('U102','S1');
 for(const value of ['A','row_2'])assert.equal(parse(strings,{S1:value}).pages[0].elements[0].containerElementId,('BOX'+value).toUpperCase());
 for(const value of ['x~#injected','x:40:40','x/@evil','<IMG:1:1:1:1>','x|y']){
  const m=parse(strings,{S1:value});assert.equal(m.pages[0].elements.length,2);
  assert.ok(m.pages[0].elements.every(e=>!e.containerElementId&&!e.containerParentId&&!e.assetRef&&!e.localParameterTarget),'markup input must not form structure: '+value);
 }
 for(const engine of ['GEE','996PC'])assert.ok(parse(source,{U102:'7'},engine).pages.every(p=>p.elements.every(e=>!e.containerElementId?.includes('7'))),'engine isolation');
 console.log('preview-local-container-id.test.js: PASS');
}
if(require.main===module)run();module.exports={source,run};
