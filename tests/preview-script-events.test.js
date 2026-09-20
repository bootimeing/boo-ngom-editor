const assert = require('node:assert/strict'), path = require('node:path');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const {parseNpcDialogScriptProgram, dialogProgramEventAuthority} = require(path.join(runtime, 'out/ui-dialog/preview-script-model'));
const {buildDialogStatementCatalog} = require(path.join(runtime, 'out/ui-dialog/statement-catalog'));
const {workspaceNpcDialogOffsets} = require(path.join(runtime, 'out/ui-dialog/offsets'));
const language = require(path.join(runtime, 'data/static-language.json'));
const source = ['[@main]', '#ACT', 'MOV N$pick 10', '#CALL [\\events.txt] @panel',
  '#IF', 'EQUAL U101 1', '#ACT', 'MOV N$pick 20', '#CALL [\\events.txt] @panel',
  '#IF', 'EQUAL 1 1', '#ACT', 'MOV N$pick 99', '#SAY', '<TEXT:主末值=<$STR(N$pick)>:10:10>',
  '[@target]', '#SAY', '<TEXT:参数=<$SCRIPTPARAM1>/调用者=<$STR(N$pick)>:50:50>',
  '<TEXT:文字=<$SCRIPTPARAM2>:50:80>', '<返回/@main()>',
  '[@empty]', '#SAY', '<TEXT:空参=<$SCRIPTPARAM1>:50:50>',
  '[@plain]', '#SAY', '<TEXT:纯文字caller=<$STR(N$pick)>/空参=<$SCRIPTPARAM1>:50:50>'].join('\n');
const external = ['[@panel]', '{', '#SAY',
  '<打开<$STR(N$pick)>/@target(<$STR(N$pick)>,<$STR(S$label)>)> <空参/@empty()>',
  '<纯文字/@plain>', '<越界兄弟/@sibling()>', '}', '[@sibling]', '{', '#SAY', '不得自动读取的兄弟入口', '}'].join('\n');
const snapshot = (text, name, version = 1) => ({uri:'file:///D:/event-test/'+name,
  filePath:'D:/event-test/'+name,fileName:name,documentVersion:version,text});
function parse(values = {}, previewPath = [], text = source, externalText = external, engine = 'GOM') {
  const primary = snapshot(text, 'main.txt'), loaded = snapshot(externalText, 'Envir/QuestDiary/events.txt');
  return parseNpcDialogScriptProgram(primary, {...primary, engine,engineLabel:engine,cursorOffset:2,
    offsets:workspaceNpcDialogOffsets(0,0),catalog:buildDialogStatementCatalog(language,engine),
    previewValues:{U101:'1','S$label':'预览文字',...values},previewPath},
  {status:'missing',candidateFilePaths:[]}, () => ({status:'found',source:loaded,candidateFilePaths:[loaded.filePath]}));
}
const page = (model, label) => model.pages.find(page => !page.executionPreview && page.sourceLabel === label);
const buttons = model => page(model, '@panel').elements.filter(element => element.raw.includes('/@target'));
function callFor(model, element) {
  const authority = dialogProgramEventAuthority(model, element.id);
  assert.ok(authority, 'original host model must retain event authority');
  const {execution} = authority, {sourceRange} = execution;
  const start = Math.max(execution.text.lastIndexOf('\n',sourceRange.start-1),execution.text.lastIndexOf('\r',sourceRange.start-1))+1;
  return {sourceLabel:authority.sourceLabel,sourceRootLabel:authority.sourceRootLabel,targetLabel:authority.element.localParameterTarget,
    sayOccurrence:authority.element.sayOccurrence,lineNumber:execution.lineNumber-1,column:sourceRange.start-start+authority.element.raw.indexOf('/@')};
}
function run() {
  const model = parse(), emitted = buttons(model);
  assert.deepEqual(emitted.map(element => element.text), ['打开10','打开20']);
  assert.equal(new Set(emitted.map(element => element.id)).size, 2);
  assert.equal(new Set(emitted.map(element => element.sayOccurrence)).size, 2);
  for (const [index, element] of emitted.entries()) {
    assert.equal(element.localParameterTarget, '@target');
    assert.equal(element.executionRootLabel, '@main');
    const authority = dialogProgramEventAuthority(model, element.id);
    assert.equal(authority.source.uri, snapshot('', 'Envir/QuestDiary/events.txt').uri);
    assert.equal(authority.source.text.slice(element.sourceRange.start,element.sourceRange.end),element.raw);
    assert.ok(Object.isFrozen(authority) && Object.isFrozen(authority.element) && Object.isFrozen(authority.pageElements));
    const replay = parse({}, [callFor(model, element)]);
    assert.equal(replay.previewNavigation.calls.length,1);
    assert.ok(page(replay,'@target').elements.some(item=>item.text===`参数=${(index+1)*10}/调用者=${(index+1)*10}`));
  }
  for (const engine of ['GEE','996PC']) {
    const own=parse({},[],source,external,engine);
    assert.deepEqual(buttons(own).map(item=>item.text),['打开10','打开20'],engine+' emitted CALL instances');
    const ownReplay=parse({},[callFor(own,buttons(own)[1])],source,external,engine);
    assert.equal(ownReplay.previewNavigation.calls.length,1,engine+' source-owned external event replay');
    assert.ok(page(ownReplay,'@target').elements.some(item=>item.text==='参数=20/调用者=20'),engine+' selected caller frame');
  }
  const selected = callFor(model, emitted[1]);
  const removed = parse({U101:'0'},[selected]);
  assert.equal(removed.previewNavigation.calls.length,0,'input removing the selected CALL invalidates history');
  const wrongAnchor = parse({},[{...selected,sourceRootLabel:'@empty'}]);
  assert.equal(wrongAnchor.previewNavigation.calls.length,0);
  const wrongOccurrence = parse({},[{...selected,sayOccurrence:99999}]);
  assert.equal(wrongOccurrence.previewNavigation.calls.length,0);
  const wrongLine = parse({},[{...selected,lineNumber:selected.lineNumber+1}]);
  assert.equal(wrongLine.previewNavigation.calls.length,0);
  const legacy = {...selected}; delete legacy.sayOccurrence;
  assert.equal(parse({},[legacy]).previewNavigation.calls.length,0,'repeated lines cannot fall back to last snapshot');
  const empty = page(model,'@panel').elements.find(item=>item.raw.includes('/@empty'));
  assert.ok(page(parse({},[callFor(model,empty)]),'@empty').elements.some(item=>item.text==='空参=预览文字'),'empty link creates a fresh parameter frame');
  const plain = page(model,'@panel').elements.filter(item=>item.raw.includes('/@plain'))[1];
  assert.equal(plain.localParameterTarget,'@plain','bare text links need host replay, not static target-page switching');
  assert.ok(page(parse({},[callFor(model,plain)]),'@plain').elements.some(item=>item.text==='纯文字caller=20/空参=预览文字'));
  const literal = '<TEXT:攻击:1:2>/@bad | <$STR(U101)> $STM(HP)';
  const injected = parse({'S$label':literal});
  const literalReplay = parse({'S$label':literal},[callFor(injected,buttons(injected)[0])]);
  assert.ok(page(literalReplay,'@target').elements.some(item=>item.text==='文字='+literal),'user text stays literal through external caller frame');
  assert.ok(!page(model,'@sibling'),'event links cannot import unloaded sibling labels');
  assert.ok(!page(model,'@panel').elements.find(item=>item.raw.includes('/@sibling')).localParameterTarget);
  assert.equal(dialogProgramEventAuthority(JSON.parse(JSON.stringify(model)),emitted[0].id),undefined,'serialized model cannot manufacture authority');
  const constantPrimary=snapshot('#INCLUDE c.ini\n[@main]\n#ACT\n#CALL [\\events.txt] @panel\n[@target]\n#SAY\n<TEXT:宏回调=<$SCRIPTPARAM1>:20:30>','constant-main.txt');
  const constantExternal=snapshot('[@panel]\n{\n#SAY\n<($caption)/@target(7)>\n<禁止参数/@target(($number))>\n<禁止目标/@($caption)>\n}', 'Envir/QuestDiary/events.txt');
  const definition=snapshot('#DEFINE $caption 宏标题\n#DEFINE $number 8','Envir/Defines/c.ini');
  const constantModel=parseNpcDialogScriptProgram(constantPrimary,{...constantPrimary,engine:'GOM',engineLabel:'GOM',cursorOffset:constantPrimary.text.indexOf('[@main]'),
    offsets:workspaceNpcDialogOffsets(0,0),catalog:buildDialogStatementCatalog(language,'GOM'),previewValues:{}},
  {status:'missing',candidateFilePaths:[]},(_raw,purpose)=>({status:'found',source:purpose==='defines-ini'?definition:constantExternal,candidateFilePaths:[]}));
  const macroElements=page(constantModel,'@panel').elements;
  const caption=macroElements.find(item=>item.text==='宏标题');
  assert.equal(caption.localParameterTarget,'@target','caption-only macro preserves a source-literal action');
  assert.ok(dialogProgramEventAuthority(constantModel,caption.id));
  assert.equal(macroElements.find(item=>item.text==='禁止参数').localParameterTarget,undefined,'unknown action macro is not a literal argument capability');
  assert.ok(!macroElements.some(item=>item.text==='禁止目标'&&item.localParameterTarget),'macro-generated target remains disabled');
  const frozenTarget = dialogProgramEventAuthority(model,emitted[0].id).element.localParameterTarget;
  emitted[0].localParameterTarget='@empty'; emitted[0].sayOccurrence=9999; emitted[0].executionRootLabel='@empty';
  assert.equal(dialogProgramEventAuthority(model,emitted[0].id).element.localParameterTarget,frozenTarget,'published metadata mutation cannot alter frozen event contract');
  for (const composition of model.pages.filter(item=>item.executionPreview)) {
    for (const element of composition.elements) {
      assert.equal(dialogProgramEventAuthority(model,element.id),undefined,'composition has no event authority');
      assert.ok(!element.localParameterTarget && !element.localControlTarget && !element.localPopupInput);
    }
  }
  console.log('preview-script-events.test.js: PASS external instance authority, rooted replay, empty/literal frames, invalidation and isolation');
}
if(require.main===module) run();
module.exports={run,parse,source,external,page,buttons,callFor};
