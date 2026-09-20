const assert = require('node:assert/strict');
const path = require('node:path');
const { parse, visible } = require('./preview-inputs-integration.test');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { resolveDialogVariables } = require(path.join(runtime, 'out/ui-dialog/variable-resolver'));
function run() {
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const command = engine === 'GEE' ? 'CALCPERCENT' : 'CALCPER';
    const source = `[@main]\n#ACT\n${command} N1 N2 N3\n#IF\nEQUAL N3 45\n#SAY\n<TEXT:结果<$STR(N3)>:30:30>`;
    const result = parse(source, { N1: '300', N2: '15', N3: '6' }, engine);
    assert.ok(visible(result).includes('结果45'));
    assert.equal(result.conditionGroups[0].satisfied, true);
    const direct = parse(`[@main]\n#ACT\n${command} 200 5 N3\n#SAY\n<TEXT:<$STR(N3)>:30:30>`, {}, engine);
    assert.ok(visible(direct).includes('10'));
    const large = parse(`[@main]\n#ACT\n${command} 9007199254740993 100 N3\n#SAY\n<TEXT:<$STR(N3)>:30:30>`, {}, engine);
    assert.ok(visible(large).includes('9007199254740993'), 'BigInt prevents Number precision loss');
    const fraction = parse(`[@main]\n#ACT\nMOV N3 99\n${command} 1 15 N3\n#SAY\n<TEXT:<$STR(N3)>:30:30>`, { N3: '6' }, engine);
    assert.equal(visible(fraction), '6', 'undocumented fractional rounding remains a local fallback, not old value');
    if (engine === 'GEE') continue;
    const ratio = parse('[@main]\n#ACT\nMOV N1 15\nMOV N2 300\nPERCENT N3 N1 N2\n#IF\nEQUAL N3 5\n#SAY\n<TEXT:<$STR(N3)>:30:30>', {}, engine);
    assert.equal(ratio.conditionGroups[0].satisfied, true);
    assert.equal(visible(ratio), '5');
    for (const divisor of ['0', '3', 'bad']) {
      const unknown = parse(`[@main]\n#ACT\nMOV N3 99\nPERCENT N3 1 ${divisor}\n#SAY\n<TEXT:<$STR(N3)>:30:30>`, { N3: '6' }, engine);
      assert.equal(visible(unknown), '6');
    }
  }
  const probe = command => {
    const lines = ['[@main]', '#ACT', 'GETDBITEMFIELDVALUE 戒指 IDX N3', ...(command ? [command] : []), '#SAY', '<$STR(N3)>'];
    const result = resolveDialogVariables(lines.join('\n'), { rootLabel: '@main', targetLabels: ['@main'], engine: 'GOM', previewValues: {},
      dataOptions: { resolveDatabaseField: () => ({ value: '935', complete: true }) } });
    return result.byLabel.get('@MAIN').lines.get(lines.length - 1).variables.find(value => value.name === 'N3');
  };
  assert.equal(probe().staticValueSource, 'database-item-index', 'positive fixture proves direct IDX capability');
  for (const command of ['CALCPER N3 100 N3', 'PERCENT N3 935 100']) {
    const value = probe(command);
    assert.equal(value.value, '935');
    assert.equal(value.staticValueSource, undefined, 'even numerically identical arithmetic cannot retain resource capability');
  }
  console.log('preview-percent.test.js: PASS');
}
if (require.main === module) run();
module.exports = { run };
