const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const file = path.join(root, 'out/ui-dialog/preview-constant-display.js');
// A pre-fix runtime exercises the actual unchanged display, not a missing-import error.
const applyConstantDisplayFallback = fs.existsSync(file) ? require(file).applyConstantDisplayFallback : () => {};
const { protectPreviewText, restorePreviewTextFields } = require(path.join(root, 'out/ui-dialog/preview-inputs'));
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(engine) {
  const macro = engine === '996PC' ? '$(Unknown)' : '($Unknown)';
  const opposite = engine === '996PC' ? '($Unknown)' : '$(Unknown)';
  const shared = { id: 'text', raw: `<TEXT:${macro}:40:80/@next(${macro})>`, text: `前${macro}后`,
    x: { value: 40, sourceValue: 40 }, y: { value: 80, sourceValue: 80 }, width: 100, height: 24,
    parameters: [{ value: macro, start: 6, end: 16 }], sourceRange: { start: 0, end: 60 },
    assetRef: { imageIndex: 9 }, asset: { status: 'ready', url: 'safe' },
    runtimeActionPreview: { link: '@next', parameters: [macro], localOnly: true },
    textPreview: { lines: [[{ text: `前${macro}`, color: '#ffff00' }, { text: `后${opposite}` }]],
      sourceText: `前${macro}后${opposite}`, color: '#ffff00', fontFamily: macro, scrollWidth: 100 },
    tooltipPreview: { raw: macro, kind: 'text', lines: [[{ text: `提示${macro}` }]], offsetX: 8, offsetY: 9, itemIndex: 4 },
    inputPreview: { mode: 'text', inputId: 2, placeholder: macro, errorTips: macro, maxLength: 40 },
    itemPreview: { itemName: macro, label: macro, quantity: 9, itemIndex: 935 },
    costItemPreview: { title: macro, quantityText: `2/${macro}`, itemScale: 1 },
    progressPreview: { text: `进度${macro} %p`, value: 4, ratio: 0.4, frameInterval: 50 },
    countdownPreview: { initialText: `剩余${macro}秒`, seconds: 10, repeatCount: 1, format: 'seconds', dynamic: false },
    imagePreview: { title: { raw: macro, text: macro, offsetX: 9, color: '#ffff00' } },
    animationPreview: { caption: macro, title: { raw: macro, text: macro }, frameCount: 4, intervalMs: 60 },
    menuPreview: { items: [`一${macro}`, `二${macro}`], selected: `一${macro}`, menuId: 'S0', link: '@next' } };
  const atlas = { id: 'atlas', text: macro, imageTextPreview: { mode: 'atlas', value: '?', glyphs: [{ character: '9', assetRef: { imageIndex: 9 } }],
    baseAssetRef: { imageIndex: 2522 }, glyphWidth: 14, glyphHeight: 24, assetContract: 'blocked', invalidFields: ['text'] } };
  const literal = { id: 'literal', text: protectPreviewText(macro), textPreview: { lines: [[{ text: protectPreviewText(macro) }]] } };
  const quantityNamedText = { id: 'qty-named-text', text: engine === '996PC' ? '$(COUNT)' : '($COUNT)' };
  return { scenes: [{ elements: [shared, atlas, literal, quantityNamedText] }, { elements: [shared] }], macro, opposite };
}

function authority(element) {
  const copy = clone(element);
  delete copy.text; delete copy.displayValueSources; delete copy.warning;
  if (copy.textPreview) delete copy.textPreview.lines;
  if (copy.tooltipPreview) delete copy.tooltipPreview.lines;
  if (copy.inputPreview) { delete copy.inputPreview.placeholder; delete copy.inputPreview.errorTips; }
  if (copy.itemPreview) delete copy.itemPreview.label;
  if (copy.costItemPreview) { delete copy.costItemPreview.title; delete copy.costItemPreview.quantityText; }
  if (copy.progressPreview) delete copy.progressPreview.text;
  if (copy.countdownPreview) delete copy.countdownPreview.initialText;
  if (copy.imagePreview?.title) delete copy.imagePreview.title.text;
  if (copy.animationPreview) { delete copy.animationPreview.caption; delete copy.animationPreview.title?.text; }
  if (copy.menuPreview) delete copy.menuPreview.clientDisplay;
  if (copy.imageTextPreview) { delete copy.imageTextPreview.value; delete copy.imageTextPreview.clientText; }
  return copy;
}

function run() {
  for (const engine of ['GOM', 'GEE', '996PC']) {
    for (const includeOptional of [false, true]) {
      const unchanged = [{ elements: [{ id: 'no-macro',
        ...(includeOptional ? { text: undefined } : {}),
        inputPreview: { mode: 'memo', errorTips: '请输入正确内容', ...(includeOptional ? { placeholder: undefined } : {}) },
        progressPreview: { value: 4, ...(includeOptional ? { text: undefined } : {}) },
        animationPreview: { frameCount: 3, ...(includeOptional ? { caption: undefined } : {}) },
        textPreview: { lines: [[{ text: '确定文字', color: '#ffff00' }]] },
        tooltipPreview: { kind: 'text', lines: [[{ text: '确定提示' }]] },
        menuPreview: { items: ['固定'], selected: '固定' }
      }] }];
      const before = structuredClone(unchanged), element = unchanged[0].elements[0];
      const bodyLines = element.textPreview.lines, tooltipLines = element.tooltipPreview.lines;
      applyConstantDisplayFallback(unchanged, engine);
      assert.deepEqual(unchanged, before, 'no macro preserves optional property absence versus explicit undefined');
      assert.equal(element.textPreview.lines, bodyLines, 'unmodified text runs preserve identity');
      assert.equal(element.tooltipPreview.lines, tooltipLines, 'unmodified tooltip runs preserve identity');
    }
  }
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const { scenes, macro, opposite } = fixture(engine), [body, atlas, literal, quantityNamedText] = scenes[0].elements;
    const before = scenes[0].elements.map(authority);
    applyConstantDisplayFallback(scenes, engine);
    assert.equal(body.text, '前预览文字后', engine + ': visible mixed text fallback');
    assert.deepEqual(body.textPreview.lines.map(line => line.map(run => run.text)), [['前预览文字', '后' + opposite]]);
    assert.equal(body.tooltipPreview.lines[0][0].text, '提示预览文字');
    assert.equal(body.inputPreview.placeholder, '预览文字'); assert.equal(body.inputPreview.errorTips, '预览文字');
    assert.equal(body.itemPreview.label, '预览文字'); assert.equal(body.itemPreview.itemName, macro);
    assert.equal(body.costItemPreview.title, '预览文字'); assert.equal(body.costItemPreview.quantityText, '2/0');
    assert.equal(body.progressPreview.text, '进度预览文字 %p'); assert.equal(body.countdownPreview.initialText, '剩余0秒');
    assert.equal(body.imagePreview.title.text, '预览文字'); assert.equal(body.animationPreview.caption, '预览文字');
    assert.equal(body.animationPreview.title.text, '预览文字');
    assert.deepEqual(body.menuPreview.items, ['一' + macro, '二' + macro]);
    assert.deepEqual(body.menuPreview.clientDisplay.items.map(runs => runs.map(run => run.text).join('')), ['一预览文字', '二预览文字']);
    assert.equal(atlas.imageTextPreview.value, '0'); assert.equal(atlas.text, '0');
    assert.equal(quantityNamedText.text, '预览文字', 'macro spelling does not imply numeric type');
    assert.ok(atlas.displayValueSources.some(source => source.field === 'constant.imageText.value' && source.kind === 'number' && source.expression === macro && source.status === 'runtime-placeholder'));
    assert.deepEqual(scenes[0].elements.map(authority), before, 'source, resource, dimensions and event authorities are immutable');
    const once = clone(scenes); applyConstantDisplayFallback(scenes, engine); assert.deepEqual(scenes, once, 'idempotent and duplicate scene safe');
    restorePreviewTextFields(scenes); assert.equal(literal.text, macro, 'protected user macro remains literal');
    assert.equal(literal.warning, undefined);
  }
  const plain = [{ elements: [{ text: '($has space) ($bad$nested) $(wrong) 已知42' }] }];
  applyConstantDisplayFallback(plain, 'GOM'); assert.equal(plain[0].elements[0].text, '($has space) ($bad$nested) $(wrong) 已知42');
  const { parse } = require('./preview-inputs-integration.test');
  const menuLiteral = '$(Unknown)|<TEXT:伪造:1:2>/@nope';
  const menuModel = parse('[@main]\n#SAY\n<MenuItem|itemname=<$STR(S0)>#固定|select=<$STR(S0)>|menuid=S1|x=40|y=100>', { S0: menuLiteral }, '996PC');
  const menu = menuModel.pages[0].elements[0].menuPreview;
  assert.equal(menu.clientDisplay?.selected.map(run => run.text).join(''), menuLiteral, 'protected user menu literal has restored display mirror');
  assert.equal(menu.clientDisplay?.items[0].map(run => run.text).join(''), menuLiteral);
  assert.equal(menu.items[0], protectPreviewText(menuLiteral), 'menu source identity is not replaced by restored caption');
  assert.equal(menu.selected, menu.items[0]);
  assert.ok(!menuModel.pages[0].elements[0].displayValueSources?.some(source => source.field.startsWith('constant.')));
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const macro = engine === '996PC' ? '$(Unknown)' : '($Unknown)';
    for (const token of engine === '996PC' ? ['COUNTDOWN'] : ['COUNTDOWN', '&IMGCOUNTDOWN']) {
      const model = parse('[@main]\n#SAY\n<' + token + ':' + macro + ':1:250:40:100:0:0>', {}, engine);
      const element = model.scenes[0].elements[0], before = authority(element);
      assert.ok(element.countdownPreview, token + ' parsed');
      applyConstantDisplayFallback(model.scenes, engine);
      assert.equal(element.countdownPreview.initialText, '0'); assert.equal(element.text, '0');
      assert.equal(element.countdownPreview.seconds, undefined); assert.equal(element.countdownPreview.dynamic, true);
      assert.deepEqual(authority(element), before, 'countdown display grants no timer or glyph authority');
      const once = clone(model.scenes); applyConstantDisplayFallback(model.scenes, engine); assert.deepEqual(clone(model.scenes), once);
    }
  }
  console.log('preview-constant-display.test.js: PASS');
}
if (require.main === module) run();
module.exports = { applyConstantDisplayFallback, fixture, authority, run };
