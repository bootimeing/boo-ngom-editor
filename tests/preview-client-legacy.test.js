const assert = require('node:assert/strict');
const { parse } = require('./preview-inputs-integration.test');
const { hydrate } = require('./helpers/preview-image-hydration');

const legacySource = '[@main]\n#SAY\nSAY数值=$STM(HP)\\\nSAY文字=$STM(USERNAME)\\\n<链接数值=$STM(HP)/@next>\n<TEXT:坐标数值=$STM(HP):100:130>\n<TEXT:坐标文字=$STM(USERNAME):100:180>\n<颜色=$STM(HP)/FCOLOR=250>\n[@next]\n#SAY\nnext';
const names = ['布衣-男', '屠龙·传说', '物品.1', 'item name', '布衣[男]'];
const keyedSource = '[@main]\n#SAY\n' + names.map((name, index) => `<Text|text=${index + 1}=$STM(ITEMCOUNT_${name})|x=40|y=${40 + index * 40}>`).join('\n');
const pureSource = '[@main]\n#SAY\n<$STM(HP)/@next>\n<$STM(HP)/FCOLOR=250>\n[@next]\n#SAY\nnext';
const active = model => model.pages[0].elements;
const texts = model => active(model).map(element => element.text);
const parseLegacy = values => parse(legacySource, values, '996PC');

async function run() {
  if (process.env.BOO_CLIENT_LEGACY_FOCUS === 'pure') {
    assert.deepEqual(texts(parse(pureSource, {}, '996PC')), ['0', '0'], 'pure STM link/color captions are not server templates');
    console.log('preview-client-legacy.test.js: PASS pure captions'); return;
  }
  if (process.env.BOO_CLIENT_LEGACY_FOCUS === 'names') {
    assert.deepEqual(texts(parse(keyedSource, {}, '996PC')), names.map((_name, index) => `${index + 1}=0`), 'bounded literal punctuation names are discoverable');
    console.log('preview-client-legacy.test.js: PASS names focus'); return;
  }
  const initial = parseLegacy({});
  assert.deepEqual(texts(initial), ['SAY数值=0', 'SAY文字=预览文字', '链接数值=0', '坐标数值=0', '坐标文字=预览文字', '颜色=0'], 'legacy display surfaces resolve STM defaults');
  assert.equal(initial.previewInputs.filter(input => input.name === 'STM(HP)').length, 1, 'all three surfaces share a typed identity');
  assert.equal(initial.previewInputs.find(input => input.name === 'STM(USERNAME)').kind, 'text');
  const set = parseLegacy({ 'STM(HP)': '37', 'STM(USERNAME)': '勇士' });
  assert.deepEqual(texts(set), ['SAY数值=37', 'SAY文字=勇士', '链接数值=37', '坐标数值=37', '坐标文字=勇士', '颜色=37']);
  assert.equal(active(set)[5].textPreview.lines[0][0].color, '#00ff00');
  const coordinate = active(set)[3];
  assert.equal(coordinate.x.sourceValue, 100); assert.equal(coordinate.x.displayValue, 96);
  assert.equal(coordinate.y.sourceValue, 130); assert.equal(coordinate.y.displayValue, 126);
  assert.equal(active(set)[0].editable, false, 'flow text acquires no coordinate source');
  assert.equal(active(set)[2].runtimeActionPreview.link, '@next');
  assert.ok(active(set).every(element => element.warning?.includes('本地显示约定')), 'legacy extension explains its local-only display convention');
  for (let index = 0; index < active(set).length; index++) {
    assert.deepEqual(active(set)[index].sourceRange, active(initial)[index].sourceRange);
    assert.deepEqual(active(set)[index].parameters, active(initial)[index].parameters);
    assert.equal(active(set)[index].raw, active(initial)[index].raw);
  }
  assert.equal(texts(parseLegacy({ 'STM(USERNAME)': '' }))[1], 'SAY文字=');
  const injected = '<TEXT:伪造:1:2>/@$STM(HP)';
  assert.equal(texts(parseLegacy({ 'STM(USERNAME)': injected }))[1], 'SAY文字=' + injected);
  assert.equal(active(parseLegacy({ 'STM(USERNAME)': injected })).length, 6);
  assert.deepEqual(texts(parse(pureSource, {}, '996PC')), ['0', '0']);
  assert.equal(active(parse(pureSource, { 'STM(HP)': '37' }, '996PC'))[0].runtimeActionPreview.link, '@next');
  for (const text of ['<$STR(S0)>', '<TEXT:<$STR(S0)>:20:40>', '<<$STR(S0)>/@next>']) {
    for (const value of ['$STM(HP)', '<$STM(HP)/@next>']) {
      const literal = parse('[@main]\n#SAY\n' + text, { S0: value }, '996PC');
      assert.ok(!literal.previewInputs.some(input => input.name === 'STM(HP)'), 'user literal is never rediscovered as STM');
    }
  }
  for (const text of ['$STM(HP)', '<TEXT:$STM(HP):20:40>', '<值=$STM(HP)/@next>', '<$STM(HP)/@next>']) {
    const authored = parse('[@main]\n#ACT\nMOV S0 ' + text + '\n#SAY\n<$STR(S0)>', {}, '996PC');
    assert.equal(texts(authored)[0], text.startsWith('<值=') ? '值=0' : '0', 'source-authored MOV output remains discoverable');
  }
  const keyed = parse(keyedSource, {}, '996PC');
  assert.deepEqual(texts(keyed), names.map((_name, index) => `${index + 1}=0`), 'bounded literal punctuation names are discoverable');
  for (const name of names.concat(['布衣[男(绑定)]', '布衣（男）', 'iTem.Name'])) {
    const slot = `STM(ITEMCOUNT_${name})`, source = '[@main]\n#SAY\n<Text|text=$sTm(itemcount_' + name + ')|x=20|y=40>';
    const model = parse(source, { [slot]: '12' }, '996PC');
    assert.equal(texts(model)[0], '12');
    assert.ok(model.previewInputs.some(input => input.name === slot));
  }
  for (const name of ['布衣[男)', '布衣[男', '布衣(男]', 'item  ', ' item', '布衣$STM(HP)', '物品\t名', 'A'.repeat(257)]) {
    const invalid = parse('[@main]\n#SAY\n<Text|text=$STM(ITEMCOUNT_' + name + ')|x=20|y=40>', {}, '996PC');
    assert.ok(!invalid.previewInputs.some(input => input.channel === 'client-display'), 'malformed name is not partially evaluated: ' + name);
  }
  for (const text of ['$STM(STR($STM(HP)))', '$STM(H.HP)', '$STM(ITEMCOUNT_布衣[男)']) {
    const unknown = parse('[@main]\n#SAY\n' + text, {}, '996PC');
    assert.ok(!unknown.previewInputs.some(input => input.channel === 'client-display'));
  }
  const isolated = parse('[@main]\n#IF\nEQUAL N0 37\n#SAY\nwrong\n#ELSESAY\n$STM(HP)', { 'STM(HP)': '37' }, '996PC');
  assert.equal(isolated.conditionGroups[0].satisfied, false);
  const resource = parse('[@main]\n#SAY\n<Text|text=$STM(ITEMCOUNT_屠龙·传说)|x=40|y=40>\n<Img|wil=NewopUI|pcimg=$STM(ITEMCOUNT_屠龙·传说)|x=$STM(HP)|y=20>', { 'STM(ITEMCOUNT_屠龙·传说)': '12', 'STM(HP)': '40' }, '996PC');
  const calls = await hydrate(resource);
  assert.ok(!calls.some(reference => reference.imageIndex === 12), 'client quantity cannot authorize an image request');
  assert.equal(active(resource)[1].assetRef?.imageIndex, undefined);
  for (const engine of ['GOM', 'GEE']) assert.equal(texts(parse('[@main]\n#SAY\n<TEXT:$STM(HP):20:40>', {}, engine))[0], '$STM(HP)');
  console.log('preview-client-legacy.test.js: PASS');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run, legacySource, keyedSource, pureSource, names, active, texts, parseLegacy };
