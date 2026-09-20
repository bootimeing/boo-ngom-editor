const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const {parse, source, external} = require('./preview-script-model.test');
const {buildDialogProgramCoordinateEdits} = require(path.join(runtime, 'out/ui-dialog/preview-script-edits'));
const {buildDialogCoordinateEdits, applyTextReplacements} = require(path.join(runtime, 'out/ui-dialog/source-patcher'));
const {parseNpcDialogScriptProgram, dialogProgramCoordinateAuthority, refreshDialogProgramCoordinateLayout} = require(path.join(runtime, 'out/ui-dialog/preview-script-model'));
const {reflowNpcDialogLayout} = require(path.join(runtime, 'out/ui-dialog/source-parser'));
const {buildDialogStatementCatalog} = require(path.join(runtime, 'out/ui-dialog/statement-catalog'));
const {workspaceNpcDialogOffsets} = require(path.join(runtime, 'out/ui-dialog/offsets'));
const language = require(path.join(runtime, 'data/static-language.json'));

function elements(model) { return [...new Map(model.scenes.flatMap(scene => scene.elements).map(element => [element.id, element])).values()]; }
function select(model) {
  return {main: elements(model).find(element => element.raw.startsWith('<TEXT:主结果')),
    ext: elements(model).find(element => element.raw.startsWith('<TEXT:外部'))};
}
function snapshot(name, text) { return {uri:'file:///D:/safe-edits/' + name, filePath:'D:/safe-edits/' + name, fileName:name, documentVersion:1, text}; }
function custom(primaryText, files, companion = {status:'missing',candidateFilePaths:[]}, engine = 'GOM') {
  const primary = snapshot('npc.txt',primaryText);
  const model = parseNpcDialogScriptProgram(primary,{...primary,engine,engineLabel:engine,cursorOffset:2,
    offsets:workspaceNpcDialogOffsets(0,0),catalog:buildDialogStatementCatalog(language,engine),previewValues:{}},companion,
    raw=>files[raw]?{status:'found',source:snapshot(raw.replace(/^\\/,''),files[raw]),candidateFilePaths:[]}
      :{status:'missing',message:'missing',candidateFilePaths:[]});
  return {model,primary};
}
function run() {
  const fixture = parse(source, {'N$base':'40'}), {model,primary,loaded} = fixture;
  const {main,ext} = select(model);
  assert.ok(main?.editable && ext?.editable,'mapped CALL coordinates must be editable');
  const changes = [{elementId:main.id,x:48,y:44},{elementId:ext.id,x:110,y:126}];
  const plans = buildDialogProgramCoordinateEdits(source,model,changes);
  assert.equal(plans.length,2);
  const mainPlan = plans.find(plan=>plan.source.uri===primary.uri), externalPlan=plans.find(plan=>plan.source.uri===loaded.uri);
  assert.ok(mainPlan && externalPlan); assert.equal(mainPlan.changedElements,1); assert.equal(externalPlan.changedElements,1);
  const nextPrimary=applyTextReplacements(mainPlan.source.text,mainPlan.replacements);
  const nextExternal=applyTextReplacements(externalPlan.source.text,externalPlan.replacements);
  assert.equal(nextPrimary,source.replace(':40:40>',':52:48>'));
  assert.equal(nextExternal,external.replace(':100:120>',':114:130>'));
  assert.equal(fixture.primary.text,source); assert.equal(fixture.loaded.text,external,'planning never writes source');
  const reparsed=parse(nextPrimary,{'N$base':'40'},{},nextExternal), after=select(reparsed.model);
  assert.equal(after.main.x.displayValue,48); assert.equal(after.main.y.displayValue,44);
  assert.equal(after.ext.x.displayValue,110); assert.equal(after.ext.y.displayValue,126);
  assert.deepEqual(buildDialogProgramCoordinateEdits(nextPrimary,reparsed.model,[
    {elementId:after.main.id,x:48,y:44},{elementId:after.ext.id,x:110,y:126}]),[],'repeated Apply at actual coordinates is a no-op');
  assert.throws(()=>buildDialogCoordinateEdits(source,model,[changes[1]]),/外部/,'old patcher must independently reject external writes to primary');
  assert.throws(()=>buildDialogProgramCoordinateEdits(source+'\n',model,changes),/主源码.*修改/);
  assert.throws(()=>buildDialogProgramCoordinateEdits(source,JSON.parse(JSON.stringify(model)),changes),/能力/,'serialized model cannot manufacture authority');
  assert.throws(()=>buildDialogProgramCoordinateEdits(source,model,[{elementId:'__proto__',x:1,y:2}]),/能力/);
  assert.throws(()=>buildDialogProgramCoordinateEdits(source,model,[{...changes[1],x:NaN}]),/有效数字/);
  assert.throws(()=>buildDialogProgramCoordinateEdits(source,model,[changes[1],{...changes[1],x:100}]),/不同/);
  const duplicateIdentical=buildDialogProgramCoordinateEdits(source,model,[changes[1],changes[1]]);
  assert.equal(duplicateIdentical.length,1); assert.equal(duplicateIdentical[0].changedElements,1);
  const authority=dialogProgramCoordinateAuthority(model);
  assert.ok(Object.isFrozen(authority) && Object.isFrozen(authority.targets) && Object.isFrozen(authority.model.scenes[0].elements));
  ext.sourceUri=primary.uri; ext.sourceFilePath=primary.filePath; ext.sourceDocumentVersion=900;
  ext.sourceRange={...main.sourceRange}; ext.x.span={...main.x.span}; ext.y.span={...main.y.span};
  ext.sourceCoordinateBiasX=999; ext.coordinateMode='none'; ext.editable=false;
  fixture.loaded.text='FORGED'; model.offsets.memoX=999;
  const protectedPlan=buildDialogProgramCoordinateEdits(source,model,[changes[1]])[0];
  assert.equal(protectedPlan.source.uri,loaded.uri); assert.equal(protectedPlan.source.text,external);
  assert.equal(applyTextReplacements(protectedPlan.source.text,protectedPlan.replacements),nextExternal,'mutable element/source fields never redirect the original capability');
  const dynamic=parse(source,{}, {},external.replace(':100:120>',':<$STR(N0)>:120>'));
  const dynamicExt=select(dynamic.model).ext; assert.ok(dynamicExt); dynamicExt.editable=true;
  dynamicExt.x={...main.x,span:{...main.x.span}};
  assert.throws(()=>buildDialogProgramCoordinateEdits(source,dynamic.model,[{elementId:dynamicExt.id,x:1,y:2}]),/能力/);
  const common='[@shared]\n{\n#SAY\n<TEXT:共享:10:20>\n}';
  const repeated=custom('[@main]\n#ACT\n#CALLEX [\\same.txt] @shared\n#CALLEX [\\same.txt] @shared',{'\\same.txt':common});
  const copies=elements(repeated.model).filter(element=>element.text==='共享'&&!element.executionPreview);
  const overview=elements(repeated.model).filter(element=>element.text==='共享'&&element.executionPreview);
  assert.equal(overview.length,2); assert.ok(overview.every(element=>!element.editable));
  assert.throws(()=>buildDialogProgramCoordinateEdits(repeated.primary.text,repeated.model,[{elementId:overview[0].id,x:16,y:26}]),/能力/,'execution comparison copies never acquire coordinate-write authority');
  assert.equal(copies.length,2); assert.ok(copies.every(element=>element.editable));
  const same=buildDialogProgramCoordinateEdits(repeated.primary.text,repeated.model,copies.map(element=>({elementId:element.id,x:16,y:26})));
  assert.equal(same.length,1); assert.equal(same[0].replacements.length,2);
  assert.equal(applyTextReplacements(common,same[0].replacements),common.replace(':10:20>',':20:30>'));
  assert.throws(()=>buildDialogProgramCoordinateEdits(repeated.primary.text,repeated.model,[
    {elementId:copies[0].id,x:16,y:26},{elementId:copies[1].id,x:17,y:26}]),/共享|不一致/);
  assert.throws(()=>buildDialogProgramCoordinateEdits(repeated.primary.text,repeated.model,[
    {elementId:copies[0].id,x:6,y:16},{elementId:copies[1].id,x:16,y:26}]),/共享|不一致/,'a conflicting no-op must not disappear before shared-span validation');
  const qf=snapshot('Envir/Market_Def/QFunction-0.txt','[@qf]\n#SAY\n<TEXT:真实QF:10:20>');
  const companion=custom('[@main]\n#ACT\nAddDlg 4 1 440 0 10:20 30:40 9 @qf 0:0 0:0:0:0:300\n',{},
    {status:'found',source:qf,candidateFilePaths:[qf.filePath]});
  const qfElement=elements(companion.model).find(element=>element.text==='真实QF'); assert.ok(qfElement);
  qfElement.editable=true; qfElement.sourceUri=companion.primary.uri; qfElement.sourceFilePath=companion.primary.filePath;
  assert.throws(()=>buildDialogProgramCoordinateEdits(companion.primary.text,companion.model,[{elementId:qfElement.id,x:20,y:30}]),/能力/);
  const originBinding=companion.model.addDlgWindows[0].windowOriginBinding;
  const originPlan=buildDialogProgramCoordinateEdits(companion.primary.text,companion.model,[{elementId:originBinding.id,x:20,y:30}]);
  assert.equal(originPlan.length,1); assert.ok(applyTextReplacements(originPlan[0].source.text,originPlan[0].replacements).includes('0 20:30 30:40'));
  const anchoredText=['[@main]','#SAY',
    '<Layout|id=L1|children={B1}|x=100|y=100|width=50|height=50>',
    '<Button|id=B1|children={T1}|a=4|percentx=50|percenty=50|wil=NewopUI|pcnimg=113>',
    '<Text|id=T1|x=5|y=6|text=子节点|color=250>'].join('\n');
  const anchored=custom(anchoredText,{},undefined,'996PC');
  const parent=elements(anchored.model).find(element=>element.containerElementId==='B1');
  const child=elements(anchored.model).find(element=>element.containerElementId==='T1');
  assert.ok(child.editable && !parent.editable,'primary direct child remains writable under an anchored parent');
  assert.equal(parent.localLayoutX,-23);
  parent.asset={status:'ready',url:'data:image/png;base64,fixture',width:20,height:10,offsetX:0,offsetY:0};
  reflowNpcDialogLayout(anchored.model);
  assert.equal(parent.localLayoutX,15); assert.equal(parent.localLayoutY,20); assert.equal(child.layoutX,120); assert.equal(child.layoutY,126);
  const move={elementId:child.id,x:child.layoutX+10,y:child.layoutY+20};
  const stale=buildDialogProgramCoordinateEdits(anchoredText,anchored.model,[move])[0];
  assert.ok(applyTextReplacements(anchoredText,stale.replacements).includes('|x=53|y=36|'), 'fixture exposes stale pre-hydration parent snapshot');
  refreshDialogProgramCoordinateLayout(anchored.model);
  const refreshed=buildDialogProgramCoordinateEdits(anchoredText,anchored.model,[move])[0];
  assert.equal(applyTextReplacements(anchoredText,refreshed.replacements),anchoredText.replace('|x=5|y=6|','|x=15|y=26|'));
  const originalCapability=dialogProgramCoordinateAuthority(anchored.model).targets[child.id];
  child.sourceUri='file:///D:/forged.txt'; child.sourceFilePath='D:/forged.txt'; child.x.span={...parent.sourceRange}; child.sourceCoordinateBiasX=800;
  parent.editable=true;
  refreshDialogProgramCoordinateLayout(anchored.model);
  assert.equal(dialogProgramCoordinateAuthority(anchored.model).targets[child.id],originalCapability,'layout refresh cannot reassign source authority');
  assert.equal(applyTextReplacements(anchoredText,buildDialogProgramCoordinateEdits(anchoredText,anchored.model,[move])[0].replacements),anchoredText.replace('|x=5|y=6|','|x=15|y=26|'));
  assert.throws(()=>buildDialogProgramCoordinateEdits(anchoredText,anchored.model,[{elementId:parent.id,x:0,y:0}]),/能力/,'layout refresh cannot grant editable to an anchored parent');
  const serialized=JSON.stringify(repeated.model);
  assert.ok(!serialized.includes('targets') && !serialized.includes('textSha256') && !serialized.includes('sourceSnapshots'));
  console.log('preview-script-edits.test.js: PASS per-source plans, immutable capabilities, shared-span safety');
}
if(require.main===module)run();
module.exports={run,custom,elements};
