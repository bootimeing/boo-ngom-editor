const assert=require('node:assert/strict');
const {parse,visible}=require('./preview-inputs-integration.test');
const source='[@main]\n#IF\nCHECKJOB warrior\n#SAY\n<TEXT:战士:30:30>\n#ELSESAY\n<TEXT:其他:30:30>';
assert.equal(visible(parse(source,{JOB:'warrior'})),'战士');
assert.equal(visible(parse(source,{JOB:'wizard'})),'其他');
assert.equal(parse(source).previewInputs.find(x=>x.name==='JOB').kind,'text');
const list='[@main]\n#IF\nNOT CHECKNAMELIST ..\\QuestDiary\\名单.txt\n#SAY\n<TEXT:外:30:30>\n#ELSESAY\n<TEXT:内:30:30>\n#IF\nCHECKNAMELIST ..\\QuestDiary\\名单.txt\n#SAY\n<TEXT:命中:30:60>';
const model=parse(list), input=model.previewInputs.find(x=>x.name.startsWith('NAMELIST('));
assert.ok(input);assert.equal(input.kind,'flag');
assert.equal(model.previewInputs.filter(x=>x.name.startsWith('NAMELIST(')).length,1);
assert.ok(visible(parse(list,{[input.name]:'1'})).includes('内'));
assert.ok(visible(parse(list,{[input.name]:'0'})).includes('外'));
assert.equal(parse(source,{},'GEE').previewInputs.some(x=>x.name==='JOB'),false,'GOM evidence must not grant another engine semantics');
console.log('preview-condition-scenarios.test.js: PASS');

const titleSource = `[@main]
#IF
not checktitle 狂暴之力
NOT CHECKTITLE 武神之力
#SAY
<TEXT:两项未拥有:30:30>
#ELSESAY
<TEXT:至少拥有一项:30:30>
#IF
CHECKTITLE "狂暴之力"
#SAY
<TEXT:狂暴已拥有:30:60>
#ELSESAY
<TEXT:狂暴未拥有:30:60>
#IF
CHECKTITLE 武神之力
#SAY
<TEXT:武神已拥有:30:90>
#ELSESAY
<TEXT:武神未拥有:30:90>`;
const titleNames = ['TITLE(狂暴之力)', 'TITLE(武神之力)'];
for (const engine of ['GOM', '996PC']) {
  const initial = parse(titleSource, {}, engine);
  assert.deepEqual(initial.previewInputs.map(x => x.name).sort(), [...titleNames].sort());
  assert.ok(initial.previewInputs.every(x => x.kind === 'flag' && x.scenario === 'title'));
  for (const a of ['0', '1']) for (const b of ['0', '1']) {
    const model = parse(titleSource, { [titleNames[0]]: a, [titleNames[1]]: b }, engine);
    const text = visible(model);
    assert.ok(text.includes(a === '0' && b === '0' ? '两项未拥有' : '至少拥有一项'));
    assert.ok(text.includes(a === '1' ? '狂暴已拥有' : '狂暴未拥有'));
    assert.ok(text.includes(b === '1' ? '武神已拥有' : '武神未拥有'));
    assert.equal(model.previewInputs.length, 2, 'both controls survive branch changes');
  }
  assert.ok(visible(initial).includes('两项未拥有'));
}
assert.equal(parse(titleSource, {}, 'GEE').previewInputs.some(x => x.scenario === 'title'), false);
const { evaluatePreviewCondition, discoverPreviewInputs } = require(require('node:path').join(
  process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || require('node:path').join(__dirname, '..'), 'out/ui-dialog/preview-inputs'));
assert.equal(evaluatePreviewCondition('NOT NOT CHECKTITLE 狂暴之力', () => '1'), true);
assert.equal(evaluatePreviewCondition('NOT CHECKTITLE <$STR(S1)>', () => '1'), undefined);
assert.equal(evaluatePreviewCondition('NOT CHECKTITLE 狂暴之力', () => '1', 'GEE'), undefined);
assert.equal(discoverPreviewInputs('#SAY\nCHECKTITLE 普通说明').length, 0);
assert.equal(discoverPreviewInputs('#ACT\nCHECKTITLE 业务文字').length, 0);
const titleImages = `[@狂暴之力]
#IF
NOT CHECKTITLE 狂暴之力
#SAY
<&imgex:1:80:80:81:470:85/@开通狂暴之力>
#ELSESAY
<&img:14:1:475:90>
#IF
NOT CHECKTITLE 武神之力
#SAY
<&imgex:1:80:80:81:470:165/@开通武神之力>
#ELSESAY
<&img:14:1:475:170>`;
for (const a of ['0','1']) for (const b of ['0','1']) {
  const model = parse(titleImages,{[titleNames[0]]:a,[titleNames[1]]:b});
  assert.equal(model.previewInputs.length,2,'negative-only title checks retain inputs');
  const elements = model.pages.flatMap(p=>p.elements);
  assert.deepEqual(elements.map(e=>[e.kind,e.assetRef?.imageIndex]),
    [a,b].map(v=>v==='1'?['image',14]:['button',80]),'switch source-authored image/button branches');
}
const titleHelper='[@main]\n#ACT\nGOTO @取称号展示\n#SAY\n<TEXT:<$STR(S$结果)>:20:20>\n[@取称号展示]\n#IF\nCHECKTITLE 狂暴之力\n#ACT\nMOV S$结果 已拥有\n#ELSEACT\nMOV S$结果 未拥有';
assert.equal(visible(parse(titleHelper,{[titleNames[0]]:'1'})),'已拥有');
assert.equal(visible(parse(titleHelper,{[titleNames[0]]:'0'})),'未拥有');
assert.equal(parse(titleHelper).previewInputs.filter(x=>x.scenario==='title').length,1);
const titleOr='[@main]\n#IF\nCHECKTITLE 狂暴之力\n#OR\nCHECKTITLE 武神之力\n#SAY\n任一拥有\n#ELSESAY\n都未拥有';
assert.equal(visible(parse(titleOr,{[titleNames[1]]:'1'})),'任一拥有');
assert.equal(visible(parse(titleOr)),'都未拥有');
module.exports = { titleSource, titleNames };
console.log('preview-condition-scenarios.test.js: title cases PASS');
