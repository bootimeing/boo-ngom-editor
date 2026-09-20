const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname,'..'));
const {parse,visible} = require('./preview-inputs-integration.test');
const {ScriptDataResolver} = require(path.join(root,'out/utils/script-data-resolver'));
const {applyPreviewInputValue} = require(path.join(root,'out/ui-dialog/preview-inputs'));
const {removeTemporaryDirectory} = require('./helpers/temp-cleanup');
const names = ['金刚','泰阿','莫邪','干将','蚩尤'];
const source = ['[@main]','#if(1)',...names.map(n=>`checkitemw ${n}`),'#SAY','<TEXT:已穿戴:20:20>','#ELSESAY','<TEXT:未穿戴:20:20>',
  '#IF','CHECKITEMW 头盔','#SAY','<TEXT:头盔已戴:20:50>'].join('\n');
const slot = name => ({key: names.includes(name)?'GOM:71':'GOM:4',label:names.includes(name)?'自定义装备 1':'头盔'});
const dataOptions = {resolvePreviewEquipmentSlot:slot};
function equipmentModel(values={}) { return parse(source,values,'GOM',{dataOptions}); }
async function main() {
  const initial=equipmentModel();
  assert.equal(initial.previewInputs.filter(x=>x.scenario==='equipment').length,6);
  assert.equal(initial.conditionGroups[0].requiredCount,1);
  assert.ok(visible(initial).includes('未穿戴'));
  for(const name of names) assert.ok(visible(equipmentModel({[`WORN(${name})`]:'1'})).includes('已穿戴'));
  const controls=initial.previewInputs;
  assert.equal(controls.find(x=>x.name==='WORN(金刚)').equipmentSlot.key,'GOM:71');
  let values=applyPreviewInputValue(controls,{},controls.find(x=>x.name==='WORN(金刚)'),'1',slot);
  values=applyPreviewInputValue(controls,values,controls.find(x=>x.name==='WORN(泰阿)'),'1',slot);
  assert.equal(values['WORN(金刚)'],'0');assert.equal(values['WORN(泰阿)'],'1');
  values=applyPreviewInputValue(controls,values,controls.find(x=>x.name==='WORN(头盔)'),'1',slot);
  assert.equal(values['WORN(泰阿)'],'1');
  const conflict=equipmentModel({'WORN(金刚)':'1','WORN(泰阿)':'1'});
  assert.equal(conflict.previewInputs.find(x=>x.name==='WORN(金刚)').value,'0');
  const threshold=source.replace('#if(1)','#if(2)').replace('checkitemw 泰阿','CHECKITEMW 头盔');
  assert.equal(parse(threshold,{'WORN(金刚)':'1'},'GOM',{dataOptions}).conditionGroups[0].satisfied,false);
  assert.equal(parse(threshold,{'WORN(金刚)':'1','WORN(头盔)':'1'},'GOM',{dataOptions}).conditionGroups[0].satisfied,true);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'boo-equipment-'));
  const r=new ScriptDataResolver();
  try {
    const file=path.join(temp,'Mir200/Envir/Market_Def/test.txt'),db=path.join(temp,'MUD2/db/items.db'),setup=path.join(temp,'Mir200/!Setup.txt');
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.mkdirSync(path.dirname(db),{recursive:true});
    fs.writeFileSync(file,source);fs.writeFileSync(setup,'[CustUserItem]\nWhere0=323\nWhere1=324\nWhere2=324');
    const SQL=await require(require.resolve('sql.js',{paths:[root]}))(); const d=new SQL.Database();
    d.run('CREATE TABLE StdItems (Idx INTEGER,Name TEXT,StdMode INTEGER)');
    [...names.map(n=>[n,323]),['头盔',15],['双槽',324],['戒指',22],['武器甲',5],['武器乙',6]].forEach(([n,m],idx)=>d.run('INSERT INTO StdItems VALUES(?,?,?)',[idx,n,m]));
    fs.writeFileSync(db,Buffer.from(d.export()));d.close();
    const before=[file,db,setup].map(f=>fs.readFileSync(f));
    await r.prepareFor(file,'GOM');const options=r.optionsFor(file,'GOM');
    assert.deepEqual(options.resolvePreviewEquipmentSlot('金刚'),{key:'GOM:71',label:'自定义装备 1'});
    assert.equal(options.resolvePreviewEquipmentSlot('双槽'),undefined);
    assert.equal(options.resolvePreviewEquipmentSlot('戒指'),undefined);
    assert.equal(options.resolvePreviewEquipmentSlot('未知'),undefined);
    assert.equal(options.resolvePreviewEquipmentSlot('武器甲').key,options.resolvePreviewEquipmentSlot('武器乙').key);
    assert.ok(parse(source,{'WORN(金刚)':'1'},'GOM',{dataOptions:options}).previewInputs.some(x=>x.equipmentSlot?.key==='GOM:71'));
    const itemSource=act=>`[@main]\n#ACT\nGOTO @取数据\n#SAY\n<$STR(S$展示)>\n[@取数据]\n#ACT\n${act}\nGETDBITEMFIELDVALUE <$STR(S$名称)> IDX N$编号\nMOV S$展示 <&ITEMSHOW:<$STR(N$编号)>:0:30:30:48>`;
    const itemModel=(act,values={})=>parse(itemSource(act),values,'GOM',{dataOptions:options});
    assert.equal(itemModel('MOV S$名称 金刚').pages[0].elements[0].itemPreview.itemIndex,0,'source literal name -> real database IDX -> packed ITEMSHOW');
    assert.equal(itemModel('',{'S$名称':'金刚'}).pages[0].elements[0].itemPreview.itemIndex,undefined,'user text must not acquire database IDX provenance');
    assert.equal(itemModel('MOV S$名称 金刚\nMOVR S$名称 金刚').pages[0].elements[0].itemPreview.itemIndex,undefined,'runtime overwrite revokes literal proof');
    assert.equal(itemModel('MOV S$名称 金刚\nINC S$名称 后缀').pages[0].elements[0].itemPreview.itemIndex,undefined,'mutated literal is not the original item name proof');
    [file,db,setup].forEach((f,i)=>assert.deepEqual(fs.readFileSync(f),before[i]));
  } finally {r.dispose();removeTemporaryDirectory(temp);}
  console.log('preview-equipment.test.js: PASS');
}
module.exports={source,names,equipmentModel,slot};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
