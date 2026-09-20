const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Execute the actual diagnostic rule, including the engine gate, without VS Code.
const source = fs.readFileSync('src/assistant.ts', 'utf8');
const rule = source.slice(source.indexOf('    // 4. 检查 #IF/#OR'), source.indexOf('    // 5. 检查 #CALL/#CALLEX'));
function diagnose(text, engine = '996PC') {
  const diagnostics = [];
  vm.runInNewContext(rule, {
    lines: text.split('\n'), diagnostics, languageIndex: { engine },
    isComment: line => /^\s*(;|\/\/)/.test(line),
    vscode: { Range: class {}, DiagnosticSeverity: { Warning: 1 },
      Diagnostic: class { constructor(range, message) { this.message = message; } } },
  });
  return diagnostics.length;
}
const screenshot = `[@蛮荒精英材料]
{
#IF [u57 > 100,u57 < 200]
(
1/1 2颗元宝
)
#IF [u49 > 200]
(
1/1 5颗元宝
)
#CHILD 1/5 RANDOM
(
1/1 圣战铭文石
1/1 法神铭文石
1/1 天尊铭文石
)
}`;
assert.equal(diagnose(screenshot), 0, '996PC screenshot must not require NPC action blocks');
assert.equal(diagnose(screenshot, 'GOM'), 0, 'new GOM manual documents the same conditional drops');
assert.equal(diagnose(screenshot, 'GEE'), 2, 'LFM documents CHILD conditions, not IF drop blocks');
for (const engine of ['GOM', '996PC']) {
  assert.equal(diagnose('#IF [N20 > 100, N20 < 110|1] RANDOM\n(\n1/1 井中月\n)', engine), 0);
  assert.equal(diagnose('#IF\nCHECK [1] 1', engine), 1);
}
assert.equal(diagnose('#CHILD 1/1 [U57>100;U57<200,0]\n(\n1/1 2颗元宝\n)', 'GEE'), 0);
assert.equal(diagnose('#if [N20 > 100,N20 < 110|1] RANDOM ; note\n; comment\n\n(\n1/1 木剑\n)'), 0);
assert.equal(diagnose('#IF [N21 >= 100]\n(\n1/1 木剑\n)\n[@NPC]\n#IF\nCHECK [1] 1'), 1);
assert.equal(diagnose('#IF\nCHECK [1] 1\n#ACT\nGIVE 木剑 1'), 0);
assert.equal(diagnose('#IF [1] 1\n(\n1/1 木剑\n)'), 1);
assert.equal(diagnose('#IF [N21 >= 100]\nGIVE 木剑 1'), 1);
assert.equal(diagnose('#OR\nCHECK [1] 1'), 1);
console.log('conditional-drop-diagnostics.test.js: PASS');
