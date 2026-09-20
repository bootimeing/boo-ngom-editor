const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  // Reuse VS Code's own tokenizer libraries; no package installation is required.
  const modules = process.argv[2];
  if (!modules) throw new Error('Pass the installed VS Code resources/app/node_modules path');
  const textmate = require(path.resolve(modules, 'vscode-textmate'));
  const onig = require(path.resolve(modules, 'vscode-oniguruma'));
  const bytes = fs.readFileSync(path.resolve(modules, 'vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({ createOnigScanner: patterns => new onig.OnigScanner(patterns), createOnigString: value => new onig.OnigString(value) }),
    loadGrammar: async () => textmate.parseRawGrammar(fs.readFileSync('syntaxes/gom.tmLanguage.json', 'utf8'), 'gom.json'),
  });
  const grammar = await registry.loadGrammar('source.gomscript');
  const line = '#CHILD 1/1 RANDOM [U57>100;U57<200|OR,0] ; real comment';
  const tokens = grammar.tokenizeLine(line).tokens;
  const at = offset => tokens.find(t => t.startIndex <= offset && offset < t.endIndex);
  assert.ok(!at(line.indexOf(';')).scopes.some(s => s.startsWith('comment')));
  assert.ok(!at(line.indexOf('U57<')).scopes.some(s => s.startsWith('comment')));
  assert.ok(at(line.indexOf('; real')).scopes.some(s => s.startsWith('comment')));
  assert.ok(grammar.tokenizeLine('SENDMSG 6 hello ; comment').tokens.at(-1).scopes.some(s => s.startsWith('comment')));
  console.log('drop-grammar.test.js: PASS (VS Code TextMate + Oniguruma)');
  registry.dispose();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
