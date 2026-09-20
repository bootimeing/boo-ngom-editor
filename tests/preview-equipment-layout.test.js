const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./preview-gee-inputs.test');
const { visible } = require('./preview-inputs-integration.test');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { validPreviewValue, evaluatePreviewCondition, discoverPreviewInputs } = require(path.join(root, 'out/ui-dialog/preview-inputs'));
const source = ['[@main]', '#IF', 'CHECKITEMW 金刚', '#SAY', '<TEXT:名称成立:20:20>',
  '#IF', 'CHECKITEMW [WEAPON]', '#SAY', '<TEXT:武器部位:20:50>',
  '#IF', 'CHECKITEMW 戒指甲 2', '#SAY', '<TEXT:两件戒指:20:80>',
  '#IF', 'CHECKITEMW [RING]', '#SAY', '<TEXT:普通戒指:20:110>',
  '#IF', 'H.CHECKITEMW 金刚', '#SAY', '<TEXT:英雄金刚:20:140>',
  '#IF', 'H.CHECKITEMW [WEAPON]', '#SAY', '<TEXT:英雄武器:20:170>',
].join('\n');
const layout = (...items) => JSON.stringify({ version: 1, items });
const item = (name, container, slot) => ({ name, container, slot });
async function main() {
  const f = await fixture();
  try {
    const before = [f.file, f.ini, f.db].map(file => fs.readFileSync(file));
    const initial = f.model({}, source);
    const control = initial.previewInputs.find(input => input.name === 'EQUIPMENT(player)');
    assert.ok(control, 'GEE equipment conditions need a unified local layout input');
    assert.equal(control.scenario, 'equipment-layout');
    const values = { 'EQUIPMENT(player)': layout(item('金刚', 'ordinary', 1), item('戒指甲', 'jewelry', 0), item('戒指甲', 'godbless', 0)),
      'WORN(金刚)': '0', 'WORN([WEAPON])': '0', 'WORN([RING])': '1', 'HERO(PRESENT)': '1' };
    let model = f.model(values, source), text = visible(model);
    assert.ok(text.includes('名称成立') && text.includes('武器部位') && text.includes('两件戒指'));
    assert.ok(!text.includes('普通戒指') && !text.includes('英雄金刚'));
    assert.ok(!model.previewInputs.some(input => input.name.startsWith('WORN(')), 'layout replaces contradictory simple predicates');
    model = f.model({ ...values, 'EQUIPMENT(player)': layout(item('金刚', 'jewelry', 0)) }, source);
    assert.ok(visible(model).includes('名称成立') && !visible(model).includes('武器部位'), 'extended containers must not satisfy ordinary slots');
    model = f.model({ ...values, 'EQUIPMENT(hero)': layout(item('金刚', 'ordinary', 1)) }, source);
    assert.ok(visible(model).includes('英雄金刚') && visible(model).includes('英雄武器'));
    model = f.model({ ...values, 'HERO(PRESENT)': '0', 'EQUIPMENT(hero)': layout(item('金刚', 'ordinary', 1)) }, source);
    assert.ok(!visible(model).includes('英雄金刚') && !visible(model).includes('英雄武器'));
    model = f.model({ 'WORN(金刚)': '1' }, source);
    assert.ok(visible(model).includes('名称成立') && model.previewInputs.some(input => input.name === 'WORN(金刚)'), 'removing layout restores simple inputs');
    assert.ok(!visible(f.model({}, source)).includes('名称成立'), 'reset returns empty local scenario');
    for (const value of [layout(), layout(item('戒指甲', 'ordinary', 7), item('戒指甲', 'ordinary', 8)), layout(item('<name>', 'godbless', 11))]) assert.ok(validPreviewValue(control, value));
    for (const value of ['{}', '[]', 'null', '{"version":2,"items":[]}', layout(item('金刚', 'ordinary', 30)),
      layout(item('金刚', 'jewelry', 6)), layout(item('金刚', 'godbless', 12)), layout(item('金刚', 'unknown', 0)),
      layout(item('金刚', 'ordinary', -1)), layout(item('金刚', 'ordinary', 1.5)), layout(item('', 'ordinary', 1)),
      layout(item('金刚', 'ordinary', 1), item('泰阿', 'ordinary', 1))]) assert.equal(validPreviewValue(control, value), false, value);
    const state = layout(item('Blade', 'ordinary', 1), item('大戒指', 'jewelry', 0), item('大戒指', 'godbless', 0));
    const read = name => ({ 'EQUIPMENT(player)': state, 'S$名称': 'Blade', 'U101': '2' })[name];
    for (const condition of ['CHECKITEMW blade', 'CHECKITEMW <$STR(S$名称)>', 'CHECKITEMW 戒指 U101 1', 'CHECKITEMW [WEAPON] 99', 'CHECKITEMW [WEAPON] <$STR(U999)> <$STR(U998)>']) assert.equal(evaluatePreviewCondition(condition, read, 'GEE'), true, condition);
    const dynamicSource = '[@main]\n#IF\nCHECKITEMW <$STR(S$名称)> <$STR(U101)> <$STR(U102)>\n#SAY\n<TEXT:动态布局满足:20:20>\n#ELSESAY\n<TEXT:动态布局不足:20:20>';
    const dynamicState = { 'EQUIPMENT(player)': layout(item('大戒指','ordinary',7),item('大戒指','godbless',1)), 'S$名称':'戒指', 'U101':'2', 'U102':'1' };
    assert.ok(visible(f.model(dynamicState,dynamicSource)).includes('动态布局满足'));
    assert.ok(visible(f.model({...dynamicState,U102:'0'},dynamicSource)).includes('动态布局不足'));
    assert.deepEqual(f.model(dynamicState,dynamicSource).previewInputs.map(input=>input.name).sort(),['EQUIPMENT(player)','S$名称','U101','U102']);
    assert.equal(evaluatePreviewCondition('CHECKITEMW BLA 1 1', read, 'GEE'), false, 'partial matching remains case sensitive');
    assert.equal(evaluatePreviewCondition('CHECKITEMW [RING]', read, 'GEE'), false);
    assert.equal(evaluatePreviewCondition('NOT CHECKITEMW 金刚', read, 'GEE'), true);
    for (const engine of ['GOM', '996PC']) assert.ok(!discoverPreviewInputs(source, {}, engine).some(input => input.scenario === 'equipment-layout'));
    [f.file, f.ini, f.db].forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index]));
    console.log('preview-equipment-layout.test.js: PASS unified containers, slots, counts, actors, validation and source isolation');
  } finally { f.cleanup(); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { source, layout, item };
