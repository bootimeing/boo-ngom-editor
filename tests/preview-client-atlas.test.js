const assert = require('node:assert/strict');
const path = require('node:path');
const { parse } = require('./preview-inputs-integration.test');
const { manager } = require('./helpers/preview-image-hydration');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { reflowNpcDialogLayout } = require(path.join(runtime, 'out/ui-dialog/source-parser'));

// 996PC client constants name a DB item, not a variable identifier. The own
// GIVE manual uses 布衣(男). Parentheses here are literal name characters,
// not general nested STM evaluation. This remains a local display convention.
const source = '[@main]\n#SAY\n<Text|text=衣服=$STM(ITEMCOUNT_布衣(男))|x=40|y=40>\n<TextAtlas|text=$STM(SLIDERV_N0)|wil=NewopUI|pcimg=2522|iwidth=14|iheight=24|x=40|y=90>\n<Slider|sliderid=N0|wil=NewopUI|pcbgimg=298|pcbarimg=299|pcballimg=297|maxvalue=1000|defvalue=25|x=40|y=150|width=300|height=24>';
const atlas = model => model.pages[0].elements.find(element => element.statementId === 'newui-textatlas-996pc');

async function hydrate(model) {
  const host = manager(), requests = [];
  host.scriptDataResolver = { resolveItemFieldByIndex: () => undefined, resolveItemFieldByName: () => undefined };
  host.resolveAsset = reference => {
    requests.push({ ...reference });
    const width = reference.imageIndex === 2522 ? 140 : 40, height = 24;
    const digits = Array.from({ length: 10 }, (_, digit) => `<text x="${digit * 14 + 7}" y="18" text-anchor="middle" fill="#ffe677" font-family="monospace" font-size="18">${digit}</text>`).join('');
    return { status: 'ready', width, height, offsetX: 0, offsetY: 0, archiveLabel: 'Synthetic digits; not game skin',
      url: 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#32485a"/>${reference.imageIndex === 2522 ? digits : ''}</svg>`).toString('base64') };
  };
  await host.hydrateAssets(model, {}, { fileName: 'client-atlas.txt' });
  reflowNpcDialogLayout(model);
  return requests;
}

async function run() {
  for (const name of ['布衣(男)', '布衣(男(绑定))', '布衣（男）']) {
    const model = parse(source.replace('布衣(男)', name), {}, '996PC');
    assert.equal(model.pages[0].elements[0].text, '衣服=0', 'literal paired parentheses name is discoverable');
    assert.equal(model.previewInputs.find(input => input.name === `STM(ITEMCOUNT_${name})`).kind, 'number');
    assert.equal(parse(source.replace('布衣(男)', name), { [`STM(ITEMCOUNT_${name})`]: '12' }, '996PC').pages[0].elements[0].text, '衣服=12');
  }
  for (const value of ['$STM(STR(N0))', '$STM(STR($STM(HP)))', '$STM(ITEMCOUNT_布衣(男)', '$STM(ITEMCOUNT_布衣（男))']) {
    const model = parse('[@main]\n#SAY\n<Text|text=' + value + '|x=40|y=40>', {}, '996PC');
    assert.equal(model.pages[0].elements[0].text, value, 'unsupported/unbalanced syntax is not partially evaluated');
    assert.ok(!model.previewInputs.some(input => input.channel === 'client-display'));
  }
  const initial = parse(source, {}, '996PC');
  assert.equal(atlas(initial).imageTextPreview.value, '25', 'client slider value enters atlas display only');
  assert.equal(atlas(initial).imageTextPreview.clientText[0].clientValue.origin, 'local-slider');
  assert.ok(atlas(initial).warning.includes('客户端显示值') && !atlas(initial).warning.includes('text 参数无效'), 'recognized display slot does not retain a false invalid-text warning');
  assert.equal(atlas(initial).parameters.find(parameter => parameter.key === 'text').value, '$STM(SLIDERV_N0)');
  const requests = await hydrate(initial);
  assert.ok(requests.some(reference => reference.imageIndex === 2522));
  assert.equal(atlas(initial).imageTextPreview.assetContract, 'matched');
  assert.deepEqual(atlas(initial).imageTextPreview.glyphs.map(glyph => [glyph.character, glyph.sourceX]), [['2', 28], ['5', 70]]);
  const set = parse(source, { 'STM(SLIDERV_N0)': '407' }, '996PC');
  await hydrate(set);
  assert.equal(atlas(set).imageTextPreview.value, '407');
  assert.equal(atlas(set).imageTextPreview.clientText[0].clientValue.sliderElementId, undefined);
  assert.equal(set.pages[0].elements.at(-1).sliderPreview.initialValue, 25, 'client input does not mutate slider state');
  for (const field of ['pcimg', 'iwidth', 'iheight']) {
    const bad = parse(source.replace(new RegExp(field + '=\\d+'), field + '=$STM(HP)'), { 'STM(HP)': '14' }, '996PC');
    const calls = await hydrate(bad);
    assert.ok(!calls.some(reference => reference.imageIndex === 2522), 'display value cannot authorize dynamic ' + field);
    assert.equal(atlas(bad).imageTextPreview.assetContract, 'blocked');
    assert.ok(atlas(bad).warning.includes('参数无效') && atlas(bad).warning.includes(field === 'pcimg' ? 'image' : field === 'iwidth' ? 'glyph-width' : 'glyph-height'), 'display warning does not suppress invalid resource fields');
  }
  const literal = parse(source.replace('$STM(SLIDERV_N0)', '<$STR(S0)>'), { S0: '$STM(HP)' }, '996PC');
  assert.ok(!literal.previewInputs.some(input => input.name === 'STM(HP)'), 'user literal is not reinterpreted');
  const built = parse('[@main]\n#ACT\nMOV S0 <TextAtlas|text=$STM(HP)|wil=NewopUI|pcimg=2522|iwidth=14|iheight=24|x=40|y=90>\n#SAY\n<$STR(S0)>', {}, '996PC');
  assert.equal(atlas(built).imageTextPreview.value, '0', 'source-built atlas markup still discovers its display slot');
  const unsafeName = parse(source.replace('布衣(男)', '布衣$STM(HP)'), {}, '996PC');
  assert.ok(!unsafeName.previewInputs.some(input => input.name === 'STM(HP)'), 'item names are not nested client expressions');
  const mixed = parse(source.replace('$STM(SLIDERV_N0)', '1$STM(HP)2'), { 'STM(HP)': '34' }, '996PC');
  assert.equal(atlas(mixed).imageTextPreview.value, '1342');
  const textSource = source.replace('$STM(SLIDERV_N0)', '$STM(USERNAME)');
  for (const value of ['', '<Img|pcimg=2522>/$STM(HP)']) {
    const model = parse(textSource, { 'STM(USERNAME)': value }, '996PC');
    assert.equal(atlas(model).imageTextPreview.value, value, 'client text literal is not coerced into a digit or parsed as markup');
    assert.equal(model.pages[0].elements.length, 3);
    assert.ok(!(await hydrate(model)).some(reference => reference.imageIndex === 2522));
  }
  const decimal = parse(source, { 'STM(SLIDERV_N0)': '-1.25' }, '996PC');
  const decimalCalls = await hydrate(decimal);
  assert.equal(atlas(decimal).imageTextPreview.value, '-1.25', 'non-digit numeric input remains visible as plain text, without guessed atlas characters');
  assert.ok(!decimalCalls.some(reference => reference.imageIndex === 2522));
  for (const engine of ['GOM', 'GEE']) assert.ok(!parse('[@main]\n#SAY\n<TEXT:$STM(ITEMCOUNT_布衣(男)):20:20>', {}, engine).previewInputs.some(input => input.channel === 'client-display'));
  console.log('preview-client-atlas.test.js: PASS');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { source, atlas, hydrate, run };
