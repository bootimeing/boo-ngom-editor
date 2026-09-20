const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { buildLanguageIndex } = require('../out/utils/command-index');
const semantic = require('../out/utils/semantic-commands');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const catalogs = { GOM: read('data/functions.json'), GEE: read('data/functions-gee.json'), '996PC': read('data/functions-996pc.json') };
const source = fs.readFileSync('src/assistant.ts', 'utf8');
const region = source.slice(source.indexOf('  const MOD_CHECK ='), source.indexOf('  context.subscriptions.push(semanticRefreshEmitter);'));
assert.ok(region.includes('provideDocumentSemanticTokens'));
const code = ts.transpileModule(region, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const results = {};
for (const engine of Object.keys(catalogs)) {
  const languageIndex = buildLanguageIndex(read('data/commands.json'), read('data/variables.json'), catalogs, engine);
  let provider;
  const sandbox = {
    ...semantic,
    ...require('../out/utils/map-code-context'),
    languageIndex, console,
    configuredMapCodesForDocument: () => new Set(),
    isScriptCommentLine: require('../out/utils/script-labels').isScriptCommentLine,
    buildSayMarkupIndex: () => ({}), activeSayMarkupEntries: () => [], findSayMarkupTokens: () => [],
    resolveIndexedCommandToken: name => languageIndex.commandByName.get(name.toUpperCase()),
    vscode: {
      SemanticTokensLegend: class {}, EventEmitter: class { fire() {} },
      SemanticTokensBuilder: class {
        constructor() { this.tokens = []; }
        push(line, start, length, type, mod) { this.tokens.push({ line, start, length, type, mod }); }
        build() { return this.tokens; }
      },
      languages: { registerDocumentSemanticTokensProvider(_selector, value) { provider = value; } },
    },
  };
  vm.runInNewContext(code, sandbox);
  const lines = ['#ACT', 'ACTREPAIRALL', 'H.O.GameGold + 10', 'S1.GameGold + 10', '#CHILD 1/5 RANDOM', '#CASE N10|1 RANDOM', 'CHECKMAINHITTARGET', '; ACTREPAIRALL', '#CHILD 1/1 RANDOM [U57>100;U57<200|OR,0]', '#DEFINE $测试 80', '#AutoRun NPC SEC 10 @test', '#CALLEX [\\test.txt] @main', 'PLAYMP3 test', 'M2ReturnRegion', 's1.GameGold + 10'];
  const tokens = provider.provideDocumentSemanticTokens({ lineCount: lines.length, fileName: 'D:/fixture/Mir200/Envir/QuestDiary/drop.txt', lineAt: n => ({ text: lines[n] }) });
  const has = (line, text, mod) => tokens.some(t => t.line === line && t.mod === mod && lines[line].slice(t.start, t.start + t.length) === text);
  assert.ok(has(1, 'ACTREPAIRALL', 2), `${engine} documented disabled completion must reach provider`);
  assert.ok(has(4, '#CHILD', 4));
  assert.ok(has(4, 'RANDOM', 4));
  assert.equal(has(5, '#CASE', 4), engine !== 'GEE');
  assert.equal(has(6, 'CHECKMAINHITTARGET', 1), engine === 'GOM');
  assert.ok(!tokens.some(t => t.line === 7));
  assert.ok(has(9, '#DEFINE', 4));
  assert.ok(has(10, '#AutoRun', 4));
  assert.equal(has(11, '#CALLEX', 4), engine !== '996PC');
  if (engine === 'GOM') {
    assert.ok(has(2, 'H.O.GameGold', 2));
    assert.ok(has(3, 'GameGold', 2));
    assert.ok(has(12, 'PLAYMP3', 2));
    assert.ok(has(13, 'M2ReturnRegion', 2));
    assert.ok(has(14, 'GameGold', 2));
  }
  if (engine === 'GEE') {
    assert.ok(has(8, 'OR', 4));
    assert.equal(tokens.filter(t => t.line === 8 && t.type === 1).length, 2);
  }
  const documentedNames = languageIndex.commands.filter(c => c.source || c.origin === 'custom').map(c => c.name);
  const allTokens = provider.provideDocumentSemanticTokens({ lineCount: documentedNames.length, fileName: 'D:/fixture/commands.txt', lineAt: n => ({ text: documentedNames[n] }) });
  const missing = documentedNames.filter((name, line) => !allTokens.some(t => t.line === line && t.type === 0 && (t.mod === 1 || t.mod === 2)));
  assert.deepEqual(missing, [], `${engine} every documented command must reach the real provider`);
  results[engine] = { lines, tokens: Array.from(tokens), documentedNamesTested: documentedNames.length };
}
fs.mkdirSync('artifacts/help-audit-20260905', { recursive: true });
fs.writeFileSync('artifacts/help-audit-20260905/provider-tokens.json', JSON.stringify(results, null, 2));
console.log('semantic-provider.test.js: PASS (actual registered provider, VS Code API mocked)');
