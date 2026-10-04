const assert = require('node:assert/strict');
const { parse } = require('./preview-inputs-integration.test');
const { hydrate } = require('./helpers/preview-image-hydration');

const source = (tag, assignments = '') => `[@main]\n${assignments ? `#ACT\n${assignments}\n` : ''}#SAY\n${tag}`;
const first = model => model.pages[0].elements[0];

async function run() {
  const failures = [];
  let checks = 0;
  const check = async (name, callback) => {
    checks++;
    try { await callback(); } catch (error) { failures.push(`${name}: ${error.message}`); }
  };
  for (const engine of ['GOM', 'GEE']) {
    for (const absolute of [false, true]) {
      const token = absolute ? '&IMG' : 'IMG';
      for (const [slot, assignment, operands] of [
        ['index', 'MOV N0 1060', '<$STR(N0)>:1'],
        ['archive', 'MOV N0 1', '1060:<$STR(N0)>'],
        ['both', 'MOV N0 1060\nMOV N1 1', '<$STR(N0)>:<$STR(N1)>'],
      ]) await check(`${engine} ${token} source-proved ${slot}`, async () => {
        const model = parse(source(`<${token}:${operands}:50:60>`, assignment), {}, engine);
        assert.equal(first(model).previewAssetOrigin, 'resolved-static');
        assert.deepEqual(await hydrate(model), [{ willIndex: 1, imageIndex: 1060 }]);
        assert.equal(first(model).asset.status, 'ready');
        assert.equal(first(model).coordinateMode, absolute ? 'absolute' : 'relative');
      });
      for (const [name, assignment, values, expression] of [
        ['unknown', '', {}, '<$STR(N0)>'],
        ['local input', '', { N0: '1060' }, '<$STR(N0)>'],
        ['derived local input', 'MOV N0 <$STR(N1)>', { N1: '1060' }, '<$STR(N0)>'],
        ['runtime overwrite', 'MOV N0 1060\nMOVR N0 1200', {}, '<$STR(N0)>'],
        ['runtime local fallback', 'MOV N0 1060\nMOVR N0 1200', { N0: '1060' }, '<$STR(N0)>'],
        ['transformed expression', 'MOV N0 1060', {}, '0<$STR(N0)>'],
        ['negative', 'MOV N0 -1', {}, '<$STR(N0)>'],
        ['fraction', 'MOV N0 1.5', {}, '<$STR(N0)>'],
        ['unsafe integer', 'MOV N0 9007199254740993', {}, '<$STR(N0)>'],
      ]) await check(`${engine} ${token} rejects ${name}`, async () => {
        const model = parse(source(`<${token}:${expression}:1:50:60>`, assignment), values, engine);
        assert.equal(first(model).previewAssetOrigin, undefined);
        assert.deepEqual(await hydrate(model), []);
      });
      await check(`${engine} ${token} does not let a proved index authorize a local archive`, async () => {
        const model = parse(source(`<${token}:<$STR(N0)>:<$STR(N1)>:50:60>`, 'MOV N0 1060'), { N1: '1' }, engine);
        assert.equal(first(model).previewAssetOrigin, undefined);
        assert.deepEqual(await hydrate(model), []);
      });
    }
    for (const token of ['PLAYIMG', '&PLAYIMG']) await check(`${engine} ${token} source-proved frame count`, async () => {
      const model = parse(source(`<${token}:1:1060:<$STR(N0)>:100:95:172>`, 'MOV N0 15'), {}, engine);
      const element = first(model);
      assert.equal(element.animationPreview.frameCount, 15);
      assert.equal(element.animationPreview.staticFirstFrameOnly, undefined);
      assert.ok(!element.animationPreview.dynamicFields?.includes('frame-count'));
      assert.doesNotMatch(element.warning || '', /动画的 frame-count 包含动态值/);
      const requests = await hydrate(model);
      assert.equal(element.animationPreview.frameCount, 15, 'hydration must not restore source fallback 1');
      assert.equal(element.animationFrames.length, 15);
      assert.deepEqual([...new Set(requests.map(request => request.imageIndex))], Array.from({ length: 15 }, (_, offset) => 1060 + offset));
      assert.ok(element.animationFrames.every(frame => frame.status === 'ready'));
      const literal = parse(source(`<${token}:1:1060:15:100:95:172>`), {}, engine);
      await hydrate(literal);
      assert.deepEqual(element.animationPreview, first(literal).animationPreview, 'proofed count should match literal animation semantics');
    });
    await check(`${engine} source-proved arithmetic count preserves source order`, async () => {
      const model = parse('[@main]\n#ACT\nMOV N0 1\nINC N0 2\n#SAY\n<PLAYIMG:1:1060:<$STR(N0)>:100:95:172>\n#ACT\nMOV N0 15\n#SAY\n<&PLAYIMG:1:1060:<$STR(N0)>:100:150:172>', {}, engine);
      const elements = model.pages[0].elements.filter(element => element.animationPreview);
      assert.deepEqual(elements.map(element => element.animationPreview.frameCount), [3, 15]);
      await hydrate(model);
      assert.deepEqual(elements.map(element => element.animationFrames.length), [3, 15]);
    });
    await check(`${engine} reached GOTO supplies a source-proved count`, async () => {
      const model = parse('[@main]\n#ACT\nGOTO @count\n#SAY\n<&PLAYIMG:1:1060:<$STR(N0)>:100:95:172>\n[@count]\n#ACT\nMOV N0 15', {}, engine);
      assert.equal(first(model).animationPreview.frameCount, 15);
      await hydrate(model);
      assert.equal(first(model).animationFrames.length, 15);
    });
    for (const [name, assignment, values, expression] of [
      ['unknown', '', {}, '<$STR(N0)>'],
      ['local input', '', { N0: '15' }, '<$STR(N0)>'],
      ['derived local input', 'MOV N0 <$STR(N1)>', { N1: '15' }, '<$STR(N0)>'],
      ['runtime overwrite', 'MOV N0 15\nMOVR N0 16', {}, '<$STR(N0)>'],
      ['runtime fallback', 'MOV N0 15\nMOVR N0 16', { N0: '15' }, '<$STR(N0)>'],
      ['transformed expression', 'MOV N0 15', {}, '0<$STR(N0)>'],
      ['zero', 'MOV N0 0', {}, '<$STR(N0)>'],
      ['negative', 'MOV N0 -1', {}, '<$STR(N0)>'],
      ['fraction', 'MOV N0 1.5', {}, '<$STR(N0)>'],
      ['unsafe integer', 'MOV N0 9007199254740993', {}, '<$STR(N0)>'],
    ]) await check(`${engine} PLAYIMG count rejects ${name}`, async () => {
      const model = parse(source(`<PLAYIMG:1:1060:${expression}:100:95:172>`, assignment), values, engine);
      const element = first(model);
      assert.equal(element.animationPreview.frameCount, 1);
      assert.equal(element.animationPreview.staticFirstFrameOnly, true);
      await hydrate(model);
      assert.equal(element.animationFrames.length, 1);
    });
    for (const [name, tag, field] of [
      ['resource', '<PLAYIMG:<$STR(N1)>:1060:<$STR(N0)>:100:95:172>', 'resource'],
      ['start', '<PLAYIMG:1:<$STR(N1)>:<$STR(N0)>:100:95:172>', 'start'],
      ['interval', '<PLAYIMG:1:1060:<$STR(N0)>:<$STR(N1)>:95:172>', 'interval'],
      ['draw-mode', '<PLAYIMG:1:1060:<$STR(N0)>:100:95:172:<$STR(N1)>>', 'draw-mode'],
      ['link', '<PLAYIMG:1:1060:<$STR(N0)>:100:95:172/@<$STR(S0)>>', 'link'],
      ...(engine === 'GOM' ? [['repeat', '<PLAYIMG:1:1060:<$STR(N0)>:100:95:172:0:<$STR(N1)>>', 'repeat']] : []),
    ]) await check(`${engine} proofed frame count does not authorize dynamic ${name}`, async () => {
      const model = parse(source(tag, 'MOV N0 15\nMOV N1 1\nMOV S0 done'), {}, engine);
      const element = first(model);
      assert.equal(element.animationPreview.frameCount, 15);
      assert.equal(element.animationPreview.staticFirstFrameOnly, true);
      assert.ok(element.animationPreview.dynamicFields.includes(field));
      const requests = await hydrate(model);
      if (field === 'resource' || field === 'start') assert.deepEqual(requests, []);
      if (field === 'link') {
        assert.notEqual(element.animationPreview.link, '@done');
        assert.match(element.animationPreview.link || '', /<\$STR\(S0\)/, 'action remains its original dynamic source, not the MOV-derived label');
      }
      assert.match(element.warning || '', new RegExp(`动画的 ${field} 包含动态值`));
    });
    await check(`${engine} FCOLOR resolved warning follows final field`, () => {
      const element = first(parse(source('<颜色/FCOLOR=<$STR(N0)>>', 'MOV N0 250'), {}, engine));
      assert.equal(element.textPreview.fieldSources.find(field => field.field === 'color').status, 'resolved-static');
      assert.equal(element.textPreview.color, '#00ff00');
      assert.doesNotMatch(element.warning || '', /文字颜色是动态表达式|不借用 MOV 当前值/);
      assert.match(element.warning, /传统流式文字没有独立 X\/Y/, 'unrelated layout evidence warning is retained');
    });
    await check(`${engine} FCOLOR unknown warning remains`, () => {
      const element = first(parse(source('<颜色/FCOLOR=<$STR(N0)>>'), {}, engine));
      assert.notEqual(element.textPreview.fieldSources.find(field => field.field === 'color').status, 'resolved-static');
      assert.match(element.warning || '', /文字颜色是动态表达式/);
    });
    await check(`${engine} FCOLOR invalid source warning remains`, () => {
      const element = first(parse(source('<颜色/FCOLOR=<$STR(S0)>>', 'MOV S0 不是颜色'), {}, engine));
      assert.equal(element.textPreview.fieldSources.find(field => field.field === 'color').status, 'invalid-static');
      assert.equal(element.textPreview.color, undefined);
      assert.match(element.warning || '', /文字颜色参数无效/);
      assert.doesNotMatch(element.warning || '', /文字颜色是动态表达式/, 'invalid-static uses its actual invalid warning');
    });
  }
  await check('996PC PLAYIMG does not borrow the legacy count projection', async () => {
    const model = parse(source('<PLAYIMG:1:1060:<$STR(N0)>:100:95:172>', 'MOV N0 15'), {}, '996PC');
    assert.equal(first(model).animationPreview.frameCount, 1);
    assert.equal(first(model).animationPreview.staticFirstFrameOnly, true);
    await hydrate(model);
    assert.equal(first(model).animationFrames.length, 1);
  });
  await check('GEE PLAYIMGEX count remains outside the requested PLAYIMG projection', async () => {
    const model = parse(source('<PLAYIMGEX:1:1060:<$STR(N0)>:100:0:95:172>', 'MOV N0 15'), {}, 'GEE');
    assert.equal(first(model).animationPreview.frameCount, 1);
    assert.equal(first(model).animationPreview.staticFirstFrameOnly, true);
    await hydrate(model);
    assert.equal(first(model).animationFrames.length, 1);
  });
  assert.deepEqual(failures, [], `${failures.length}/${checks} checks failed:\n${failures.join('\n')}`);
  console.log(`preview-proofed-visual-fields.test.js: PASS (${checks} checks)`);
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
