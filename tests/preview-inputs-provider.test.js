const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { parse, source } = require('./preview-inputs.test');

async function main() {
  const errors = [];
  const original = Module._load;
  const stub = {
    Uri: { parse: value => ({ toString: () => value, fsPath: value }), file: value => ({ fsPath: value }) },
    EventEmitter: class {},
    window: { showErrorMessage: message => errors.push(message) },
    workspace: { applyEdit() { throw Error('Preview must not edit source'); } },
  };
  Module._load = function (request, parent, isMain) {
    return request === 'vscode' ? stub : original.call(this, request, parent, isMain);
  };
  let Manager;
  try {
    const file = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'), 'out/providers/npc-dialog-visual.js');
    const loaded = new Module(file, module);
    loaded.filename = file; loaded.paths = Module._nodeModulePaths(path.dirname(file));
    loaded._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.TestManager = NpcDialogVisualEditorManager;', file);
    Manager = loaded.exports.TestManager;
  } finally { Module._load = original; }
  const manager = Object.create(Manager.prototype);
  const posted = [];
  const session = {
    key: 'preview', model: parse(), document: { version: 1 }, dirty: true, conflict: false,
    modelRevision: 1, previewConditions: {},
    panel: { webview: { postMessage: message => posted.push(message) } },
  };
  manager.sessions = new Map([[session.key, session]]);
  manager.hydrateAssets = async () => {};
  manager.createModel = async (_document, _cursor, _label, _states, values) => parse(source, values);
  await manager.onMessage(session, { type: 'previewInput', name: '[101]', value: '1' });
  assert.equal(session.model.conditionGroups[0].satisfied, true);
  assert.equal(session.dirty, true);
  assert.equal(posted.at(-1).preserveDrafts, true);
  await manager.onMessage(session, { type: 'previewInput', name: 'U101', value: '11' });
  assert.equal(session.model.conditionGroups[2].satisfied, true);
  const revision = session.modelRevision;
  for (const message of [
    { name: 'U101', value: 'Infinity' }, { name: '__proto__', value: 'x' },
    { name: '[101]', value: true }, { name: 'S$名字', value: 'x\ny' },
  ]) await manager.onMessage(session, { type: 'previewInput', ...message });
  assert.equal(errors.length, 4);
  assert.equal(session.modelRevision, revision);
  await manager.onMessage(session, { type: 'previewInput', name: 'S$名字', value: '' });
  assert.equal(session.previewValues['S$名字'], '');
  await manager.onMessage(session, { type: 'previewInput', name: 'S$名字', value: null });
  assert.ok(!Object.hasOwn(session.previewValues, 'S$名字'));
  // A slow older parse must not replace the latest typed value or coordinate drafts.
  const pending = [];
  manager.createModel = async (_d, _c, _l, _s, values) => new Promise(resolve => pending.push(() => resolve(parse(source, values))));
  const first = manager.onMessage(session, { type: 'previewInput', name: 'U101', value: '2' });
  const second = manager.onMessage(session, { type: 'previewInput', name: 'U101', value: '12' });
  pending[1](); await second; pending[0](); await first;
  assert.equal(session.model.previewInputs.find(input => input.name === 'U101').value, '12');
  assert.equal(session.dirty, true);
  manager.createModel = async (_d, _c, _l, _s, values) => parse(source, values);
  await manager.onMessage(session, { type: 'resetPreview' });
  assert.deepEqual(session.previewValues, {});
  assert.equal(session.model.conditionGroups[0].satisfied, false);
  assert.equal(session.dirty, true);
  const {parse: parseScenario, visible}=require('./preview-inputs-integration.test');
  const scenarioSource='[@main]\n#IF\nCHECKJOB warrior\n#SAY\n<TEXT:战士:30:30>\n#ELSESAY\n<TEXT:其他:30:30>';
  session.model=parseScenario(scenarioSource);session.previewValues={};
  manager.createModel=async (_d,_c,_l,_s,values)=>parseScenario(scenarioSource,values);
  await manager.onMessage(session,{type:'previewInput',name:'JOB',value:'warrior'});
  assert.equal(visible(session.model),'战士');
  const scenarioRevision=session.modelRevision;
  await manager.onMessage(session,{type:'previewInput',name:'JOB',value:'<IMG:1:1:1:1>'});
  assert.equal(session.modelRevision,scenarioRevision,'invalid occupation must be rejected by production provider');
  const clientSource=require('./preview-client-text.test').source;
  session.model=parseScenario(clientSource,{},'996PC');session.previewValues={};
  manager.createModel=async (_d,_c,_l,_s,values)=>parseScenario(clientSource,values,'996PC');
  await manager.onMessage(session,{type:'previewInput',name:'STM(LEVEL)',value:'42'});
  assert.ok(visible(session.model).includes('等级=42'));
  assert.equal(session.dirty,true);
  const clientRevision=session.modelRevision;
  for(const message of [{name:'STM(LEVEL)',value:'Infinity'},{name:'STM(HP)',value:'42'},{name:'STM(USERNAME)',value:'x\ny'},{name:'STM(USERNAME)',value:'x'.repeat(4097)}]) {
    await manager.onMessage(session,{type:'previewInput',...message});
  }
  assert.equal(session.modelRevision,clientRevision,'client display input validates published identity and type');
  await manager.onMessage(session,{type:'previewInput',name:'STM(USERNAME)',value:'<Img|img=12>/$STM(HP)'});
  assert.ok(visible(session.model).includes('<Img|img=12>/$STM(HP)'));
  assert.equal(session.model.pages[0].elements.length,3);
  await manager.onMessage(session,{type:'previewInput',name:'STM(LEVEL)',value:null});
  assert.ok(visible(session.model).includes('等级=0'));
  const tooltipSource='[@main]\n#SAY\n<Text|text=提示入口|x=20|y=20|tips=$STM(HP) $STM(USERNAME)>';
  session.model=parseScenario(tooltipSource,{},'996PC');session.previewValues={};
  manager.createModel=async (_d,_c,_l,_s,values)=>parseScenario(tooltipSource,values,'996PC');
  const tooltipText=()=>session.model.pages[0].elements[0].tooltipPreview.lines.flat().map(r=>r.text).join('');
  assert.equal(tooltipText(),'0 预览文字');
  await manager.onMessage(session,{type:'previewInput',name:'STM(HP)',value:'123'});
  assert.equal(tooltipText(),'123 预览文字','tooltip-only field accepted by production provider');
  const tipRevision=session.modelRevision;
  await manager.onMessage(session,{type:'previewInput',name:'STM(HP)',value:'Infinity'});
  assert.equal(session.modelRevision,tipRevision);
  await manager.onMessage(session,{type:'previewInput',name:'STM(USERNAME)',value:'<Img|pcimg=12>/$STM(HP)'});
  assert.equal(tooltipText(),'123 <Img|pcimg=12>/$STM(HP)');
  assert.equal(session.model.pages[0].elements.length,1);
  await manager.onMessage(session,{type:'resetPreview'});
  assert.equal(tooltipText(),'0 预览文字');assert.equal(session.dirty,true);
  const { titleSource, titleNames } = require('./preview-condition-scenarios.test');
  session.model=parseScenario(titleSource);session.previewValues={};
  manager.createModel=async (_d,_c,_l,_s,values)=>parseScenario(titleSource,values);
  for (const [name,value,expected] of [
    [titleNames[0],'1','狂暴已拥有'],[titleNames[1],'1','武神已拥有'],
    [titleNames[0],'0','狂暴未拥有'],[titleNames[1],'0','两项未拥有'],
  ]) {
    await manager.onMessage(session,{type:'previewInput',name,value});
    assert.ok(visible(session.model).includes(expected));
    assert.equal(session.model.previewInputs.filter(input=>input.scenario!=='equipment-layout').length,2);
  }
  const titleRevision=session.modelRevision;
  for(const message of [{name:titleNames[0],value:'true'},{name:titleNames[0],value:true},
    {name:'TITLE(未出现的称号)',value:'1'}]) await manager.onMessage(session,{type:'previewInput',...message});
  assert.equal(session.modelRevision,titleRevision,'reject invalid or unpublished title input');
  await manager.onMessage(session,{type:'resetPreview'});
  assert.deepEqual(session.previewValues,{});
  assert.ok(visible(session.model).includes('两项未拥有'));
  assert.equal(session.dirty,true);
  const {equipmentModel}=require('./preview-equipment.test');
  session.model=equipmentModel();session.previewValues={};
  manager.createModel=async (_d,_c,_l,_s,values)=>equipmentModel(values);
  await manager.onMessage(session,{type:'previewInput',name:'WORN(金刚)',value:'1'});
  assert.equal(session.model.conditionGroups[0].satisfied,true);
  await manager.onMessage(session,{type:'previewInput',name:'WORN(泰阿)',value:'1'});
  assert.equal(session.previewValues['WORN(金刚)'],'0');
  assert.equal(session.previewValues['WORN(泰阿)'],'1');
  await manager.onMessage(session,{type:'previewInput',name:'WORN(头盔)',value:'1'});
  assert.equal(session.previewValues['WORN(泰阿)'],'1');
  await manager.onMessage(session,{type:'previewInput',name:'WORN(泰阿)',value:'0'});
  assert.equal(session.model.conditionGroups[0].satisfied,false);
  await manager.onMessage(session,{type:'resetPreview'});
  assert.deepEqual(session.previewValues,{});
  assert.equal(session.model.conditionGroups[0].satisfied,false);
  const gee = await require('./preview-gee-inputs.test').fixture();
  try {
    const before = [gee.file, gee.ini, gee.db].map(file => fs.readFileSync(file));
    session.model=gee.model();session.previewValues={};
    manager.createModel=async (_d,_c,_l,_s,values)=>gee.model(values);
    await manager.onMessage(session,{type:'previewInput',name:'G201',value:'100'});
    await manager.onMessage(session,{type:'previewInput',name:'A201',value:'翎风临时玩家'});
    assert.ok(visible(session.model).includes('数量=102'));
    assert.ok(visible(session.model).includes('玩家=翎风临时玩家'));
    await manager.onMessage(session,{type:'previewInput',name:'WORN(金刚)',value:'1'});
    await manager.onMessage(session,{type:'previewInput',name:'WORN(泰阿)',value:'1'});
    assert.equal(session.previewValues['WORN(金刚)'],'0');
    assert.equal(session.previewValues['WORN(泰阿)'],'1');
    assert.equal(session.model.conditionGroups[1].requiredCount,1);
    assert.equal(session.model.conditionGroups[1].satisfied,true);
    const geeRevision=session.modelRevision;
    await manager.onMessage(session,{type:'previewInput',name:'WORN(泰阿)',value:'2'});
    assert.equal(session.modelRevision,geeRevision,'flag input must remain boolean');
    await manager.onMessage(session,{type:'resetPreview'});
    assert.ok(visible(session.model).includes('数量=42')&&visible(session.model).includes('暂无玩家'));
    assert.equal(session.model.previewInputs.find(x=>x.name==='G201').value,'40');
    assert.equal(session.dirty,true,'preview reset must preserve coordinate drafts');
    const {quantitySource}=require('./preview-gee-inputs.test');
    session.model=gee.model({},quantitySource);session.previewValues={};
    manager.createModel=async (_d,_c,_l,_s,values)=>gee.model(values,quantitySource);
    await manager.onMessage(session,{type:'previewInput',name:'WORN(戒指甲)',value:'2'});
    assert.ok(visible(session.model).includes('双件达标'));
    assert.ok(visible(session.model).includes('至少一件'));
    const countRevision=session.modelRevision;
    for (const value of ['-1','1.5','2147483648','Infinity','1e2']) {
      await manager.onMessage(session,{type:'previewInput',name:'WORN(戒指甲)',value});
    }
    assert.equal(session.modelRevision,countRevision,'invalid counts must not trigger a rebuild');
    assert.equal(session.previewValues['WORN(戒指甲)'],'2');
    await manager.onMessage(session,{type:'previewInput',name:'WORN(戒指甲)',value:'0'});
    assert.ok(!visible(session.model).includes('确实穿戴'));
    await manager.onMessage(session,{type:'resetPreview'});
    assert.deepEqual(session.previewValues,{});
    assert.equal(session.model.previewInputs[0].value,undefined);
    assert.equal(session.dirty,true);
    const {caseSource,partialSource}=require('./preview-gee-inputs.test');
    session.model=gee.model({},caseSource);session.previewValues={'WORN(Blade)':'1'};
    manager.createModel=async (_d,_c,_l,_s,values)=>gee.model(values,caseSource);
    await manager.onMessage(session,{type:'previewInput',name:'WORN(BLADE)',value:'2'});
    assert.ok(visible(session.model).includes('大写双件')&&visible(session.model).includes('混写单件'));
    assert.equal(session.previewValues['WORN(Blade)'],undefined,'obsolete alias removed');
    const aliasRevision=session.modelRevision;
    await manager.onMessage(session,{type:'previewInput',name:'WORN(blade)',value:'0'});
    assert.equal(session.modelRevision,aliasRevision,'messages must use a published canonical identity');
    await manager.onMessage(session,{type:'previewInput',name:'WORN(BLADE)',value:null});
    assert.ok(!visible(session.model).includes('混写单件'));
    session.model=gee.model({},partialSource);session.previewValues={};
    manager.createModel=async (_d,_c,_l,_s,values)=>gee.model(values,partialSource);
    await manager.onMessage(session,{type:'previewInput',name:'WORN(戒指甲)',value:'1'});
    assert.ok(visible(session.model).includes('部分匹配不足'));
    await manager.onMessage(session,{type:'previewInput',name:'WORN(戒指乙)',value:'1'});
    assert.ok(visible(session.model).includes('部分匹配达标')&&visible(session.model).includes('甲已穿戴'));
    assert.ok(!visible(session.model).includes('反向成立'));
    assert.equal(session.model.previewInputs.filter(input=>input.scenario!=='equipment-layout').length,2);
    await manager.onMessage(session,{type:'resetPreview'});
    assert.ok(visible(session.model).includes('部分匹配不足')&&!visible(session.model).includes('甲已穿戴'));
    assert.equal(session.dirty,true);
    const {dynamicQuantitySource,heroSource}=require('./preview-gee-inputs.test');
    session.model=gee.model({},dynamicQuantitySource);session.previewValues={};
    manager.createModel=async (_d,_c,_l,_s,values)=>gee.model(values,dynamicQuantitySource);
    await manager.onMessage(session,{type:'previewInput',name:'WORN(戒指甲)',value:'2'});
    assert.ok(visible(session.model).includes('变量数量达标'));
    await manager.onMessage(session,{type:'previewInput',name:'U101',value:'2'});
    assert.ok(visible(session.model).includes('变量数量不足')&&visible(session.model).includes('变量反向成立'));
    session.model=gee.model({},heroSource);session.previewValues={};
    manager.createModel=async (_d,_c,_l,_s,values)=>gee.model(values,heroSource);
    await manager.onMessage(session,{type:'previewInput',name:'WORN(金刚)',value:'1'});
    await manager.onMessage(session,{type:'previewInput',name:'H.WORN(金刚)',value:'1'});
    assert.ok(visible(session.model).includes('玩家金刚')&&!visible(session.model).includes('英雄金刚'));
    await manager.onMessage(session,{type:'previewInput',name:'HERO(PRESENT)',value:'1'});
    assert.ok(visible(session.model).includes('英雄金刚'));
    await manager.onMessage(session,{type:'previewInput',name:'H.WORN(泰阿)',value:'1'});
    assert.ok(visible(session.model).includes('英雄泰阿')&&visible(session.model).includes('玩家金刚'));
    assert.equal(session.previewValues['H.WORN(金刚)'],'0');
    const heroRevision=session.modelRevision;
    for(const message of [{name:'HERO(PRESENT)',value:'2'},{name:'H.WORN(不存在)',value:'1'},{name:'H.WORN(泰阿)',value:'2'}]) {
      await manager.onMessage(session,{type:'previewInput',...message});
    }
    assert.equal(session.modelRevision,heroRevision);
    await manager.onMessage(session,{type:'previewInput',name:'HERO(PRESENT)',value:'0'});
    assert.ok(!visible(session.model).includes('英雄泰阿'));assert.equal(session.previewValues['H.WORN(泰阿)'],'1');
    await manager.onMessage(session,{type:'resetPreview'});
    assert.deepEqual(session.previewValues,{});assert.equal(session.dirty,true);
    const {bareMovSource}=require('./preview-gee-inputs.test');
    session.model=gee.model({},bareMovSource);session.previewValues={};
    manager.createModel=async (_d,_c,_l,_s,values)=>gee.model(values,bareMovSource);
    await manager.onMessage(session,{type:'previewInput',name:'U101',value:'42'});
    await manager.onMessage(session,{type:'previewInput',name:'A201',value:'甲:乙|丙/@x'});
    assert.ok(visible(session.model).includes('裸数量=42')&&visible(session.model).includes('裸文字=甲:乙|丙/@x'));
    assert.deepEqual(session.model.previewInputs.map(x=>x.name).sort(),['A201','U101']);
    const copyRevision=session.modelRevision;
    await manager.onMessage(session,{type:'previewInput',name:'N$副本',value:'99'});
    assert.equal(session.modelRevision,copyRevision,'derived copy cannot be forged as a published input');
    await manager.onMessage(session,{type:'resetPreview'});
    assert.ok(visible(session.model).includes('裸数量=0'));
    assert.deepEqual(session.previewValues,{});assert.equal(session.dirty,true);
    const {dynamicModeSource}=require('./preview-gee-inputs.test');
    session.model=gee.model({},dynamicModeSource);session.previewValues={};
    manager.createModel=async (_d,_c,_l,_s,values)=>gee.model(values,dynamicModeSource);
    const modeRevision=session.modelRevision;
    await manager.onMessage(session,{type:'previewInput',name:'WORN(戒指甲)',value:'2'});
    assert.equal(session.modelRevision,modeRevision,'inactive-mode item is not a published input');
    await manager.onMessage(session,{type:'previewInput',name:'U102',value:'1'});
    await manager.onMessage(session,{type:'previewInput',name:'WORN(戒指甲)',value:'2'});
    assert.ok(visible(session.model).includes('模式匹配成功'));
    await manager.onMessage(session,{type:'previewInput',name:'U102',value:'0'});
    assert.ok(visible(session.model).includes('模式匹配不足'));
    assert.equal(session.previewValues['WORN(戒指甲)'],'2','hidden mode values retained');
    await manager.onMessage(session,{type:'previewInput',name:'U102',value:'-1'});
    assert.ok(visible(session.model).includes('模式匹配成功'));
    await manager.onMessage(session,{type:'resetPreview'});
    assert.deepEqual(session.previewValues,{});assert.equal(session.dirty,true);
    assert.deepEqual(session.model.previewInputs.filter(input=>input.scenario!=='equipment-layout').map(x=>x.name).sort(),['U102','WORN(戒指)']);
    const { source: layoutSource, layout, item } = require('./preview-equipment-layout.test');
    session.previewValues = { 'WORN(金刚)': '1' }; session.model = gee.model(session.previewValues, layoutSource);
    manager.createModel = async (_d,_c,_l,_s,values) => gee.model(values, layoutSource);
    await manager.onMessage(session, { type:'previewInput', name:'EQUIPMENT(player)', value:layout(item('金刚','ordinary',1)) });
    assert.ok(visible(session.model).includes('名称成立') && visible(session.model).includes('武器部位'));
    assert.ok(!session.model.previewInputs.some(input=>input.name==='WORN(金刚)'));
    const layoutRevision = session.modelRevision;
    for (const message of [
      { name:'WORN(金刚)', value:'0' },
      { name:'EQUIPMENT(player)', value:layout(item('金刚','ordinary',1),item('泰阿','ordinary',1)) },
      { name:'EQUIPMENT(player)', value:'{"version":1,"items":[{"name":"金刚","container":"jewelry","slot":6}]}' },
      { name:'EQUIPMENT(player)', value:'{"version":1,"items":[],"execute":"give"}' },
    ]) await manager.onMessage(session, {type:'previewInput', ...message});
    assert.equal(session.modelRevision,layoutRevision,'hidden scalar and invalid layout writes must be rejected');
    await manager.onMessage(session, { type:'previewInput', name:'EQUIPMENT(player)', value:layout(item('金刚','jewelry',0)) });
    assert.ok(visible(session.model).includes('名称成立') && !visible(session.model).includes('武器部位'));
    await manager.onMessage(session, { type:'previewInput', name:'EQUIPMENT(player)', value:null });
    assert.ok(visible(session.model).includes('名称成立') && session.model.previewInputs.some(input=>input.name==='WORN(金刚)'));
    assert.equal(session.previewValues['WORN(金刚)'],'1','switching back restores prior simplified scenario');
    await manager.onMessage(session, { type:'resetPreview' });
    assert.deepEqual(session.previewValues,{}); assert.equal(session.dirty,true,'layout reset preserves coordinate drafts');
    [gee.file,gee.ini,gee.db].forEach((file,i)=>assert.deepEqual(fs.readFileSync(file),before[i]));
  } finally {gee.cleanup();}
  console.log('preview-inputs-provider.test.js: PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
