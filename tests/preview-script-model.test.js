const assert = require('node:assert/strict'), path = require('node:path');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { parseNpcDialogScriptProgram, dialogProgramExecutionLocation, dialogProgramSourcesCurrent } = require(path.join(root, 'out/ui-dialog/preview-script-model'));
const { buildDialogStatementCatalog } = require(path.join(root, 'out/ui-dialog/statement-catalog'));
const { workspaceNpcDialogOffsets } = require(path.join(root, 'out/ui-dialog/offsets'));
const { buildDialogCoordinateEdits, applyTextReplacements } = require(path.join(root, 'out/ui-dialog/source-patcher'));
const { dialogCompanionSourceChangeAction } = require(path.join(root, 'out/ui-dialog/adddlg-companion'));
const language = require(path.join(root, 'data/static-language.json'));
const source = '[@main]\r\n#ACT\r\n#CALL [\\nested\\calculate.txt] @calculate\r\n#SAY\r\n<TEXT:主结果=<$STR(N$result)>:40:40>\r\n<下一页/@next(<$STR(N$result)>)>\r\n[@next]\r\n#SAY\r\n<TEXT:参数=<$SCRIPTPARAM1>:60:80>\r\n';
const external = '[@calculate]\r\n{\r\n#ACT\r\nMOV N$result <$STR(N$base)>\r\nINC N$result 2\r\n#SAY\r\n<TEXT:外部=<$STR(N$result)>:100:120>\r\n}\r\n[@unloaded]\r\n{\r\n#SAY\r\n不得整文件载入\r\n}\r\n';
function snapshot(text, name = 'main.txt', version = 1) {
  const filePath = `D:/program-test/${name}`;
  return {uri: `file:///${filePath}`, filePath, fileName: name, documentVersion: version, text};
}
function parse(text = source, values = {}, extra = {}, externalText = external) {
  const primary = snapshot(text), loaded = snapshot(externalText, 'Envir/QuestDiary/nested/calculate.txt', 0);
  const resolution = {status: 'found', source: loaded, candidateFilePaths: [loaded.filePath]};
  const resolve = () => resolution;
  const options = {...primary, engine: 'GOM', engineLabel: 'GOM', cursorOffset: 2,
    offsets: workspaceNpcDialogOffsets(0,0), catalog: buildDialogStatementCatalog(language,'GOM'),
    previewValues: values, previewPath: [], ...extra};
  const model = parseNpcDialogScriptProgram(primary, options, {status:'missing',candidateFilePaths:[]}, resolve);
  return {model, primary, loaded, resolution, resolve};
}
function run() {
  const longCall='[@main]\n#ACT\n#CALL [\\'+ 'long'.repeat(40)+'.txt] @calculate\n[@next]\n#SAY\n<TEXT:next:60:80>\n';
  assert.equal(parse(longCall,{}, {cursorOffset:longCall.indexOf('.txt')+4}).model.functionLabel,'@main','cursor within rewritten long CALL remains in its physical function');
  const eof='[@main]\n#ACT\n#CALL [\\calculate.txt] @calculate\n#SAY\n<TEXT:main:10:20>';
  assert.equal(parse(eof,{}, {cursorOffset:eof.length}).model.functionLabel,'@main','physical EOF cannot select appended external label');
  const qfPrimary=snapshot('[@main]\n#ACT\n#CALL [\\nested\\calculate.txt] @calculate\nAddDlg 4 1 440 0 10:20 30:40 9 @calculate 0:0 0:0:0:0:300\n');
  const qf=snapshot('[@calculate]\n#SAY\n<TEXT:真实QF:10:20>','Envir/Market_Def/QFunction-0.txt');
  const collision=parseNpcDialogScriptProgram(qfPrimary,{...qfPrimary,engine:'GOM',engineLabel:'GOM',cursorOffset:2,
    offsets:workspaceNpcDialogOffsets(0,0),catalog:buildDialogStatementCatalog(language,'GOM'),previewValues:{}},
    {status:'found',source:qf,candidateFilePaths:[qf.filePath]},parse().resolve);
  assert.ok(collision.pages.some(page=>page.addDlgWindow&&page.elements.some(item=>item.text==='真实QF')),'CALL-loaded label cannot intercept QFunction companion target');
  const fixture = parse(source, {'N$base':'40'}), {model, primary, loaded} = fixture;
  const main = model.pages.find(page => page.sourceLabel === '@main');
  const element = main.elements.find(item => item.text === '主结果=42');
  assert.ok(element, 'CALL loads assignments and resumes caller SAY');
  assert.equal(element.sourceUri, primary.uri);
  assert.equal(element.sourceRange.start, source.indexOf('<TEXT:主结果'));
  assert.equal(element.sourceRange.original, source.slice(element.sourceRange.start,element.sourceRange.end));
  assert.equal(element.x.span.start, source.indexOf(':40:40>')+1);
  assert.equal(element.lineNumber, 5);
  assert.equal(element.x.displayValue, 36); assert.equal(element.y.displayValue,36);
  const updated = applyTextReplacements(source,buildDialogCoordinateEdits(source,model,[{elementId:element.id,x:48,y:44}]).replacements);
  assert.equal(updated,source.replace(':40:40>',':52:48>'), 'only physical primary numeric spans change');
  assert.equal(parse(updated,{'N$base':'40'}).model.pages[0].elements[0].x.displayValue,48);
  const ext = model.pages.find(page => page.sourceLabel === '@calculate').elements.find(item => item.text === '外部=42');
  assert.ok(ext,'external SAY actually parsed with caller environment');
  assert.equal(ext.sourceUri,loaded.uri); assert.equal(ext.lineNumber,7);
  assert.equal(ext.sourceRange.start,external.indexOf('<TEXT:外部'));
  assert.equal(ext.sourceRange.original,external.slice(ext.sourceRange.start,ext.sourceRange.end));
  assert.equal(ext.x.span.start,external.indexOf(':100:120>')+1);
  assert.equal(ext.editable,true,'direct mapped external coordinates are admitted by the host-only source-group planner');
  assert.throws(()=>buildDialogCoordinateEdits(source,model,[{elementId:ext.id,x:101,y:102}]),/外部/);
  assert.ok(!model.pages.some(page=>page.sourceLabel==='@unloaded'));
  assert.ok(!model.pages.flatMap(page=>page.elements).some(item=>item.text==='}'));
  const button = main.elements.find(item=>item.raw.includes('/@next'));
  const location = dialogProgramExecutionLocation(model,button);
  assert.ok(location && location.text.slice(location.sourceRange.start,location.sourceRange.end)===button.sourceRange.original);
  assert.notEqual(location.sourceRange.start,button.sourceRange.start,'execution and physical offsets remain independent');
  const lineStart=location.text.lastIndexOf('\n',location.sourceRange.start-1)+1;
  const call={sourceLabel:'@main',targetLabel:'@next',lineNumber:location.lineNumber-1,
    column:location.sourceRange.start-lineStart+button.raw.indexOf('/@')};
  assert.ok(parse(source,{'N$base':'40'},{previewPath:[call]}).model.pages.find(page=>page.sourceLabel==='@next').elements.some(item=>item.text==='参数=42'));
  assert.equal(dialogProgramSourcesCurrent(model,fixture.resolve),true);
  assert.equal(dialogProgramSourcesCurrent(model,()=>({...fixture.resolution,source:{...loaded,text:external.replace('2','9')}})),false);
  assert.equal(dialogProgramSourcesCurrent(model,()=>({status:'missing',candidateFilePaths:[loaded.filePath],message:'deleted'})),false);
  assert.equal(dialogCompanionSourceChangeAction(model,loaded.filePath,false),'reload');
  assert.equal(dialogCompanionSourceChangeAction(model,loaded.filePath,true),'conflict');
  const serialized=JSON.stringify(model);
  assert.ok(!serialized.includes('segments')&&!serialized.includes('textSha256')&&!serialized.includes('sourceEnd":'+external.length),'internal program is not Webview transport');
  console.log('preview-script-model.test.js: PASS physical spans, execution offsets, independent source isolation, revalidation');
}
if(require.main===module)run();
module.exports={parse,source,external,run};
