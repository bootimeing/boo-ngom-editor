const assert = require('node:assert/strict');
const { parse, visible } = require('./preview-inputs-integration.test');
function run() {
  const ordered = parse('[@main]\n#ACT\nMOV S$值 生成按钮时\n#SAY\n<进入/@page(<$STR(S$值)>)>\n#ACT\nMOV S$值 后来的值\n[@page]\n#SAY\n<TEXT:参数=<$SCRIPTPARAM(1)>:30:30>');
  assert.ok(visible(ordered).includes('参数=生成按钮时'), 'UI parameters use their SAY snapshot, not final ACT state');
  const branches = '[@main]\n#IF\nCHECK [101] 1\n#SAY\n<甲/@page(开启)>\n#ELSESAY\n<乙/@page(关闭)>\n[@page]\n#SAY\n<TEXT:参数=<$SCRIPTPARAM(1)>:30:30>';
  for (const [flag, expected] of [['1', '开启'], ['0', '关闭']]) {
    const model = parse(branches, { '[101]': flag });
    assert.ok(visible(model).includes(`参数=${expected}`), 'inactive link must not create parameter ambiguity');
    assert.ok(!model.warnings.some(warning => warning.includes('多组点击参数')));
  }
  const different = parse('[@main]\n#ACT\nMOV S$值 甲\n#SAY\n<甲/@page(<$STR(S$值)>)>\n#ACT\nMOV S$值 乙\n#SAY\n<乙/@page(<$STR(S$值)>)>\n[@page]\n#SAY\n<TEXT:<$SCRIPTPARAM(1)>:30:30>');
  assert.ok(different.warnings.some(warning => warning.includes('多组点击参数')), 'identical source expressions at distinct snapshots can be ambiguous');
  const shadowing = parse('[@main]\n#ACT\nGOTO @outer(甲,乙)\n[@outer]\n#ACT\nGOTO @inner(<$SCRIPTPARAM(2)>,<$SCRIPTPARAM(1)>)\n#SAY\n<TEXT:外=<$SCRIPTPARAM(1)>/<$SCRIPTPARAM(2)>:30:30>\n[@inner]\n#SAY\n<TEXT:内=<$SCRIPTPARAM(1)>/<$SCRIPTPARAM(2)>:30:60>');
  assert.ok(visible(shadowing).includes('内=乙/甲'), 'evaluate all arguments before overwriting the callee parameter frame');
  assert.ok(visible(shadowing).includes('外=甲/乙'), 'restore caller parameters after GOTO');
  const noArgs = parse('[@main]\n#ACT\nGOTO @outer(甲,乙)\n[@outer]\n#ACT\nGOTO @inner()\n[@inner]\n#SAY\n<TEXT:无参=<$SCRIPTPARAM(1)>/<$SCRIPTPARAM(2)>:30:30>');
  assert.ok(visible(noArgs).includes('无参=预览文字/预览文字'), 'a new empty parameter frame must not inherit the caller arguments');
  const explicit = parse(branches, { '[101]': '1', 'SCRIPTPARAM(1)': '用户:输入|/@x' });
  assert.ok(visible(explicit).includes('参数=开启'), 'a unique static button argument overrides stale manual preview state');
  assert.ok(!explicit.previewInputs.some(input => input.name === 'SCRIPTPARAM(1)'));
  console.log('preview-parameter-snapshots.test.js: PASS');
}
if (require.main === module) run();
module.exports = { run };
