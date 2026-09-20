const assert = require('node:assert/strict');
const {parse, visible} = require('./preview-inputs-integration.test');
const source = '[@main]\n#ACT\nMOV N0 7\n#SAY\n<甲/@page(甲,<$STR(N0)>)> <乙/@page(乙,8)> <空/@page()> <无参/@page>\n#ACT\nMOV N0 99\n[@page]\n#SAY\n<TEXT:<$SCRIPTPARAM1> / <$SCRIPTPARAM(2)>:30:100>';
function selected(index) {
  const base = parse(source);
  const element = base.pages[0].elements[index];
  return {sourceLabel:'@main', targetLabel:'@page', lineNumber:element.lineNumber - 1,
    column:element.sourceRange.start - source.lastIndexOf('\n', element.sourceRange.start - 1) - 1 + element.raw.indexOf('/@')};
}
function run() {
  for (const [index, expected] of [[0,'甲 / 7'],[1,'乙 / 8'],[2,'预览文字 / 预览文字'],[3,'预览文字 / 预览文字']]) {
    const model = parse(source, {}, 'GOM', {previewCall:selected(index)});
    assert.ok(visible(model).includes(expected), `selected button ${index}: ${visible(model)}`);
    assert.ok(!model.warnings.some(w=>w.includes('多组点击参数')));
  }
  assert.ok(parse(source).warnings.some(w=>w.includes('多组点击参数')), 'automatic preview stays ambiguous');
  assert.ok(!visible(parse(source, {}, 'GOM', {previewCall:{...selected(0),column:0}})).includes('甲 / 7'), 'invalid call site cannot select a frame');
  assert.ok(parse(source).pages[0].elements.every(e=>e.localParameterTarget==='@page'));
  for(const engine of ['GEE','996PC']) assert.ok(parse(source,{},engine).pages[0].elements.every(e=>e.localParameterTarget==='@page'), 'own-engine documented text parameter navigation');
  const nested=source+'\n<下一页/@third(内层)>\n[@third]\n#SAY\n<TEXT:第三页:30:30>';
  assert.ok(parse(nested).pages[1].elements.every(e=>!e.localParameterTarget),'nested calls remain outside this stage');
  const attack='A:<IMG:1:1:1:1>|/@hack';
  const userSource=source.replace('甲,<$STR(N0)>','<$STR(S$名字)>,<$STR(N0)>');
  const userModel=parse(userSource,{'S$名字':attack},'GOM',{previewCall:selected(0)});
  assert.equal(userModel.pages[1].elements.length,1,'parameter text cannot inject elements');
  assert.equal(userModel.pages[1].elements[0].text,attack+' / 7');
  const crlf=source.replaceAll('\n','\r\n');
  assert.ok(visible(parse(crlf,{},'GOM',{previewCall:selected(0)})).includes('甲 / 7'),'line/column identity survives CRLF');
  console.log('preview-selected-call.test.js: PASS');
}
if(require.main===module)run();
module.exports={run,source,selected};
