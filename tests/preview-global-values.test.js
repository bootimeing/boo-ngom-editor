const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const iconv = require('iconv-lite');
const { parse, inputNames, visibleText } = require('./preview-input-surface-scope.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { ScriptDataResolver } = require(path.join(runtimeRoot, 'out/utils/script-data-resolver'));

const globalSource = [
  '[@main]', '#ACT', 'GOTO @获取数据', '#SAY',
  '<TEXT:数量=<$STR(N$结果)>:20:50>',
  '#IF', 'EQUAL A201 ', '#SAY', '<TEXT:暂无:20:20>',
  '#ELSESAY', '<TEXT:获取玩家=<$STR(A201)>:20:20>',
  '<TEXT:[查看获取玩家]|<$STR(A201)>:20:80>',
  '[@获取数据]', '#ACT', 'MOV N$结果 <$STR(G201)>', 'INC N$结果 2',
  '[@无关业务]', '#ACT', 'INC G202 1',
].join('\n');
const globalModel = (values = {}) => parse(globalSource, values, 'GOM', {
  resolvePreviewGlobalValues: () => ({ A201: '', G201: '40', G202: '999' }),
});

function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-global-values-'));
  const resolver = new ScriptDataResolver();
  try {
    const source = path.join(temp, 'Mir200', 'Envir', 'Market_Def', '神器.txt');
    const ini = path.join(temp, 'Mir200', 'GlobalVal.ini');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, iconv.encode(globalSource, 'gbk'));
    const content = '[Setup]\r\nGlobalVal201=40\r\nGlobalStrVal201=\r\nGlobalVal202=999\r\n';
    fs.writeFileSync(ini, iconv.encode(content, 'gbk'));
    const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const before = [hash(source), hash(ini)];
    const options = resolver.optionsFor(source, 'GOM');
    const model = parse(globalSource, {}, 'GOM', options);
    assert.ok(visibleText(model).includes('暂无'));
    assert.ok(visibleText(model).includes('数量=42'), 'GOTO must consume saved G201 before arithmetic');
    assert.deepEqual(inputNames(model), ['A201', 'G201']);
    assert.equal(model.previewInputs.find(i => i.name === 'A201').value, '');
    assert.equal(model.previewInputs.find(i => i.name === 'G201').value, '40');
    const changed = parse(globalSource, { A201: '临时玩家', G201: '100' }, 'GOM', options);
    assert.ok(visibleText(changed).includes('获取玩家=临时玩家'));
    assert.ok(visibleText(changed).includes('数量=102'));
    const zero = parse(globalSource, { A201: '', G201: '0' }, 'GOM', options);
    assert.ok(visibleText(zero).includes('数量=2'));
    const reset = parse(globalSource, {}, 'GOM', options);
    assert.ok(visibleText(reset).includes('数量=42') && visibleText(reset).includes('暂无'));
    assert.deepEqual([hash(source), hash(ini)], before, 'preview/edit/reset must not write script or INI');
    const assigned = parse(globalSource.replace('INC N$结果 2', 'INC N$结果 2\nMOV A201 源码值'),
      { A201: '临时玩家' }, 'GOM', options);
    assert.ok(visibleText(assigned).includes('获取玩家=源码值'), 'later script assignments still take precedence');
    assert.deepEqual(resolver.optionsFor(source, '996PC').resolvePreviewGlobalValues(), {});
    assert.deepEqual(resolver.optionsFor(source, 'GEE').resolvePreviewGlobalValues(), { G201: '40', A201: '', G202: '999' });
    fs.writeFileSync(ini, iconv.encode(content.replace('GlobalStrVal201=', 'GlobalStrVal201=持久玩家'), 'gbk'));
    assert.ok(visibleText(parse(globalSource, {}, 'GOM', options)).includes('获取玩家=持久玩家'));
    fs.writeFileSync(ini, '[Setup]\nGlobalVal201=7\nGlobalVal201=8\nGlobalStrVal201=\n');
    assert.equal(options.resolvePreviewGlobalValues().G201, undefined, 'duplicate keys are not authoritative');
    fs.writeFileSync(ini, '[Setup]\nGlobalVal201=invalid\nGlobalStrVal201=\n');
    assert.equal(options.resolvePreviewGlobalValues().G201, undefined);
    fs.unlinkSync(ini);
    assert.deepEqual(options.resolvePreviewGlobalValues(), {}, 'missing file must not retain stale data');
    console.log('preview-global-values.test.js: PASS reader, GOTO, empty strings, override/reset, source order and no writes');
  } finally { resolver.dispose(); removeTemporaryDirectory(temp); }
}
if (require.main === module) run();
module.exports = { globalSource, globalModel };
