const assert = require('node:assert/strict');
const { parse } = require('./preview-inputs-integration.test');
const markup = '<&ProgressBar:10:20:1:620:630:1:100:0:0:0:100:<$STR(N$VALUE)>:0:250:0:0:%p/%m:preview>';
const source = `[@main]\n#ACT\nMOV N$VALUE 25\n#SAY\n${markup}`;
const progress = model => model.pages[0].elements.find(e => e.progressPreview).progressPreview;
function run() {
  const p = progress(parse(source));
  assert.equal(p.localDisplayRange?.ratio, .25, 'proved value must draw a quarter fill');
  assert.equal(p.ratio, undefined, 'display range does not acquire runtime authority');
  assert.ok(p.dynamicFields.includes('value'), 'source diagnostic retained');
  assert.equal(p.localDisplayRange.value, 25);
  assert.equal(progress(parse(source.replace('MOV N$VALUE 25\n', ''))).localDisplayRange, undefined, 'placeholder is not proof');
  assert.equal(progress(parse(source.replace('MOV N$VALUE 25', 'MOV N$VALUE 125'))).localDisplayRange, undefined, 'out of range is not clamped');
  assert.equal(progress(parse(source.replace('MOV N$VALUE 25', 'MOV N$VALUE 25\nMOVR N$VALUE 100'))).localDisplayRange, undefined, 'unknown overwrite revokes proof');
  assert.equal(progress(parse(source, {}, 'GEE')).localDisplayRange.ratio, .25, 'own LFM N/X/V contract');
  const inputSource = source.replace('MOV N$VALUE 25\n', '');
  const inputRange = progress(parse(inputSource, {'N$VALUE':'60'})).localDisplayRange;
  assert.equal(inputRange.ratio, .6);
  assert.equal(inputRange.valueOrigin, 'preview-input');
  assert.equal(progress(parse(inputSource, {'N$VALUE':'0'})).localDisplayRange.ratio, 0, 'explicit zero is not placeholder zero');
  console.log('preview-progress-range.test.js: PASS');
}
if (require.main === module) run();
module.exports = { source, run };
