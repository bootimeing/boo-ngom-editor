const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { VariableListScanner } = require('../out/utils/variable-list');
const { collectCandidateUsage, unusedVariableCandidates, unusedPersonalFlagCandidates } = require('../out/utils/variable-candidates');
const { analyzeNestedVariables } = require('../out/utils/nested-variable-analysis');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-utag-exhaustive-'));
  const directory = path.join(temporary, 'Envir/Market_Def');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'all.TXT');
  try {
    const expected = new Map();
    const lines = [];
    const maxima = { U: 499, T: 499, A: 999, G: 999 };
    for (const [family, max] of Object.entries(maxima)) {
      for (let index = 0; index <= max; index++) {
        const name = family + index;
        const start = lines.length;
        lines.push(`MOV ${name.toLowerCase()} 1`, `#SAY <$${name}>`);
        expected.set(name, [start, start + 1]);
      }
    }
    for (let index = 1; index <= 1024; index++) {
      const start = lines.length;
      lines.push(`CHECK [${index}] 0`, `NOT CHECK [${index}] 1`, `SET [${index}] 1`);
      expected.set(`[${index}]`, [start, start + 1, start + 2]);
    }
    const resetLine = lines.length;
    lines.push('RESET [100] 3', '// MOV U1<$STR(N$注释)> 1', '; NOT CHECK [1] 0', 'LABEL_U1 U2suffix');
    for (let index = 100; index <= 102; index++) expected.get(`[${index}]`).push(resetLine);
    fs.writeFileSync(file, lines.join('\r\n'), 'utf8');
    for (const engine of ['GOM', 'GEE']) {
      const result = await new VariableListScanner({ engine: () => engine }).scan([temporary]);
      assert.equal(result.errors.length, 0);
      assert.equal(result.scannedFiles, 1);
      assert.equal(result.usages.size, 4024);
      for (const [name, positions] of expected) {
        assert.equal(result.usages.get(name)?.count, positions.length, engine + ' ' + name);
        assert.deepEqual(result.occurrences.get(name).map(item => item.line), positions, engine + ' ' + name);
        assert.deepEqual([...result.usages.get(name).files], [file]);
      }
      for (const family of Object.keys(maxima)) assert.deepEqual(unusedVariableCandidates(family, result.candidates), []);
      assert.deepEqual(unusedPersonalFlagCandidates(result.candidates), []);
      assert.equal(result.candidates.personalFlagsUncertain, false);
      assert.equal(result.candidates.uncertainVariableFamilies.size, 0);
    }
    const dynamicText = [
      'MOV N$编号 2', 'MOV U1<$STR(N$编号)> 1', 'MOV T<$STR(N$编号)> abc',
      'MOV A<$STR(N$编号)> abc', 'MOV G<$STR(N$编号)> 1',
      'NOT CHECK [<$STR(N$编号)>] 0', 'MOV U3<$STR(N$未知)> 1',
      'CHECK [<$STR(N$标识未知)>] 0', 'RESET [1024] 2',
    ].join('\n');
    fs.writeFileSync(file, dynamicText);
    const dynamic = await new VariableListScanner().scan([temporary]);
    for (const name of ['U12', 'T2', 'A2', 'G2', '[2]', '[1024]']) assert.ok(dynamic.usages.has(name), name);
    assert.equal(dynamic.usages.has('U1'), false, 'dynamic base is not a concrete variable');
    assert.equal(dynamic.usages.has('U3'), false, 'unknown dynamic base is not a concrete variable');
    assert.equal(dynamic.candidates.variables.U.has(1), false);
    assert.equal(dynamic.candidates.variables.U.has(12), true);
    assert.equal(dynamic.candidates.uncertainVariableFamilies.has('U'), true);
    assert.equal(dynamic.candidates.personalFlagsUncertain, true);
    assert.equal(unusedVariableCandidates('U', dynamic.candidates).includes(12), false);
    fs.writeFileSync(file, 'MOV U003 1\nINC u3 1\nNOT CHECK [001] 0\nCHECK [1] 1');
    const aliases = await new VariableListScanner().scan([temporary]);
    assert.equal(aliases.usages.get('U3').count, 2);
    assert.equal(aliases.usages.get('[1]').count, 2);
    assert.equal(aliases.usages.size, 2);

    const invalid = analyzeNestedVariables('CHECK [0] 0\nCHECK [1025] 0\nRESET [1024] 2');
    assert.equal(invalid.personalFlags[0].status, 'unresolved');
    assert.equal(invalid.personalFlags[1].status, 'unresolved');
    assert.equal(invalid.personalFlags[2].status, 'partial');
    const cr = analyzeNestedVariables('MOV N$编号 3\rNOT CHECK [<$STR(N$编号)>] 0\rRESET [4] 2');
    assert.deepEqual(cr.personalFlags.map(item => ({ line: item.line, flags: item.flags })), [
      { line: 1, flags: ['[3]'] }, { line: 2, flags: ['[4]', '[5]'] },
    ]);
    const boundary996 = collectCandidateUsage('NOT CHECK [0] 0\nCHECK [999] 1\nMOV U254 1\nMOV A499 a', { engine: '996PC' });
    assert.deepEqual([...boundary996.personalFlags], [0, 999]);
    assert.equal(unusedPersonalFlagCandidates(boundary996).includes(0), false);
    assert.equal(unusedPersonalFlagCandidates(boundary996).at(-1), 998);
    assert.equal(unusedVariableCandidates('T', boundary996).at(-1), 254);
    assert.equal(unusedVariableCandidates('G', boundary996).at(-1), 499);
    assert.deepEqual([...collectCandidateUsage('// MOV U<$STR(N$注释)> 1\n// NOT CHECK [1] 0').uncertainVariableFamilies], []);
    console.log('variable-utag-flags.test.js: PASS (GOM/GEE each 3000 UTAG + 1024 flags; every count, file and line; dynamic/996PC boundaries)');
  } finally { removeTemporaryDirectory(temporary); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
