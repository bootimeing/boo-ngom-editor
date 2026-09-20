const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { parseNpcDialogDocument } = require(path.join(runtime, 'out/ui-dialog/source-parser'));
const { buildDialogStatementCatalog } = require(path.join(runtime, 'out/ui-dialog/statement-catalog'));
const { workspaceNpcDialogOffsets } = require(path.join(runtime, 'out/ui-dialog/offsets'));
const language = require(path.join(runtime, 'data/static-language.json'));
function parse(text, previewValues = {}, engine = 'GOM', options = {}) {
  return parseNpcDialogDocument(text, { uri: 'file:///D:/preview-integration.txt', fileName: 'preview-integration.txt',
    filePath: 'D:/preview-integration.txt', documentVersion: 1, engine, engineLabel: engine, cursorOffset: 2,
    offsets: workspaceNpcDialogOffsets(0, 0), catalog: buildDialogStatementCatalog(language, engine), previewValues, ...options });
}
const visible = model => model.pages.flatMap(page => page.elements).map(element => element.text).join('\n');
function run() {
  for (const name of ['A0', 'S0', 'T0', 'Z0']) {
    const source = `[@main]\n#SAY\n<TEXT:${name}=<$STR(${name})>:30:30>`;
    assert.ok(visible(parse(source)).includes(`${name}=预览文字`), `${name} default text`);
    assert.ok(visible(parse(source, { [name]: '甲:乙|丙/@x' })).includes(`${name}=甲:乙|丙/@x`));
    assert.ok(visible(parse(`[@main]\n#ACT\nMOV ${name} 静态值\n#SAY\n<TEXT:<$STR(${name})>:30:30>`)).includes('静态值'));
  }
  const system = parse('[@main]\n#IF\nCHECKLEVEL 12\nCHECKGAMEGOLD > 100\n#SAY\n<TEXT:<$USERNAME> Lv<$LEVEL> 金<$GAMEGOLD> 对象<$C.GAMEGOLD> 英雄<$H.LEVEL>:30:30>',
    { USERNAME: '勇士', LEVEL: '15', GAMEGOLD: '101', 'C.GAMEGOLD': '40', 'H.LEVEL': '7' });
  assert.equal(system.conditionGroups[0].satisfied, true);
  assert.ok(visible(system).includes('勇士 Lv15 金101 对象40 英雄7'));
  const plugin = parse('[@main]\n#SAY\n<TEXT:<$PLUGINVALUE>:30:30>', { PLUGINVALUE: '插件本地预览' });
  assert.equal(plugin.previewInputs.find(input => input.name === 'PLUGINVALUE').typeUncertain, true);
  assert.ok(visible(plugin).includes('插件本地预览'));
  const nestedSource = '[@main]\n#IF\nCHECK [<$STR(N0)>] 1\n#SAY\n<TEXT:槽位 <$STR(U<$STR(N0)>)>:30:30>\n#ELSESAY\n<TEXT:关闭:30:30>';
  for (const index of [101, 102]) {
    const model = parse(nestedSource, { N0: String(index), [`[${index}]`]: '1', [`U${index}`]: '42' });
    assert.equal(model.conditionGroups[0].satisfied, true);
    assert.equal(model.previewInputs.filter(input => input.name === `[${index}]`).length, 1);
    assert.ok(model.previewInputs.some(input => input.name === `U${index}`));
    assert.ok(visible(model).includes('槽位 42'));
  }
  const staticNested = parse('[@main]\n#ACT\nMOV N0 101\nMOV U101 77\n#SAY\n<TEXT:<$STR(U<$STR(N0)>)>:30:30>');
  assert.ok(visible(staticNested).includes('77'));
  assert.ok(!staticNested.previewInputs.some(input => input.name === 'U101'),
    'a statically assigned visible value must render directly without an ineffective input');
  const reset = parse('[@main]\n#ACT\nSET [101-103] 1\nRESET [101] 0 2\n#IF\nCHECK [101,102] 0\nCHECK [103] 1\n#SAY\n正确');
  assert.equal(reset.conditionGroups[0].satisfied, true);
  const zero = parse('[@main]\n#ACT\nSET [0,999] 1\nRESET [0] 0 1\n#IF\nCHECK [0] 0\nCHECK [999] 1\n#SAY\n正确', {}, '996PC');
  assert.equal(zero.conditionGroups[0].satisfied, true);
  assert.ok(!zero.previewInputs.some(input => input.name === '[0]' || input.name === '[999]'),
    'source-determined flags must not remain as ineffective preview inputs');
  const unknownOutput = parse('[@main]\n#ACT\nMOVR U101 10\n#SAY\n<TEXT:<$STR(U101)>:30:30>', { U101: '6' });
  assert.ok(visible(unknownOutput).includes('6'));
  assert.ok(unknownOutput.previewInputs.some(input => input.name === 'U101'));
  const arithmetic = parse('[@main]\n#ACT\nINC U101 1\n#IF\nEQUAL U101 1\n#SAY\n<TEXT:<$STR(U101)>:30:30>');
  assert.equal(arithmetic.conditionGroups[0].satisfied, true, 'numeric Auto=0 participates in source-order evaluation');
  for (const [initial, command, operand, expected] of [
    ['9007199254740993', 'INC', '1', '9007199254740994'],
    ['9007199254740993.01', 'DEC', '0.02', '9007199254740992.99'],
    ['9007199254740993', 'MUL', '2', '18014398509481986'],
    ['9007199254740993', 'DIV', '2', '4503599627370496.5'],
    ['-0.1', 'INC', '0.2', '0.1'], ['0', 'DIV', '2', '0'],
  ]) {
    const model = parse(`[@main]\n#ACT\n${command} U101 ${operand}\n#IF\nEQUAL U101 ${expected}\n#SAY\n<TEXT:<$STR(U101)>:30:30>`, { U101: initial });
    assert.equal(model.conditionGroups[0].satisfied, true, `${command} must not round a large decimal`);
    assert.ok(visible(model).includes(expected));
  }
  const scoped = parse('[@main]\n#ACT\nVAR Integer HUMAN 积分\nCALCVAR HUMAN 积分 + 2\n#IF\nCHECKVAR HUMAN 积分 = 2\n#SAY\n<TEXT:<$HUMAN(积分)>:30:30>');
  assert.equal(scoped.conditionGroups[0].satisfied, true);
  assert.equal(scoped.previewInputs.find(input => input.name === 'HUMAN(积分)').kind, 'number');
  const scopedText = parse('[@main]\n#ACT\nVAR String GLOBAL 标题\nCALCVAR GLOBAL 标题 = "玩家称号"\n#SAY\n<TEXT:<$GLOBAL(标题)>:30:30>', {}, '996PC');
  assert.ok(visible(scopedText).includes('玩家称号'));
  const extracted = parse('[@main]\n#ACT\nEXTRACTSTRING , <$STR(S$来源)> S$目标\n#SAY\n<TEXT:<$STR(S$目标)>:30:30>', { 'S$来源': '<IMG:1:1:1:1>|/@x' });
  assert.equal(extracted.pages[0].elements.length, 1, 'extracting user text must retain literal-only origin');
  assert.equal(extracted.pages[0].elements[0].text, '<IMG:1:1:1:1>|/@x');
  const params = parse('[@main]\n#ACT\nGOTO @page(你好,12)\n[@page]\n#SAY\n<TEXT:<$SCRIPTPARAM1> / <$SCRIPTPARAM(2)>:30:30>');
  assert.ok(visible(params).includes('你好 / 12'));
  const paramNames = params.previewInputs.filter(input => input.name.startsWith('SCRIPTPARAM')).map(input => input.name);
  assert.deepEqual(paramNames, [], 'statically bound call parameters render directly and need no user input');
  const uiParams = parse('[@main]\n#SAY\n<点我/@page(按钮参数)>\n[@page]\n#SAY\n<TEXT:<$SCRIPTPARAM(1)>:30:30>');
  assert.ok(visible(uiParams).includes('按钮参数'));
  const ambiguous = parse('[@main]\n#SAY\n<甲/@page(甲)> <乙/@page(乙)>\n[@page]\n#SAY\n<TEXT:<$SCRIPTPARAM(1)>:30:30>');
  assert.ok(ambiguous.warnings.some(warning => warning.includes('多组点击参数')));
  const generated = parse('[@main]\n#ACT\nMOV S$UI <TEXT:源码构造控件:30:30>\n#SAY\n<$STR(S$UI)>');
  assert.ok(generated.pages.some(page => page.elements.some(element => element.text === '源码构造控件')));
  const item = parse('[@main]\n#SAY\n<ITEMSHOW:<$STR(U101)>:0:0>', { U101: '935' });
  assert.ok(item.pages.flatMap(page => page.elements).every(element => !element.itemPreview?.assetRef));
  console.log('preview-inputs-integration.test.js: PASS');
}
if (require.main === module) run();
module.exports = { parse, visible };
