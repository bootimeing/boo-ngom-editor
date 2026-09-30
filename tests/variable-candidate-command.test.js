const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { VariableListScanner, analyzeVariableListFile } = require('../out/utils/variable-list');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-candidate-command-'));
  const directory = path.join(temporary, 'Envir/Market_Def');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'main.TXT');
  fs.writeFileSync(file, 'MOV U1<$STR(N$未知)> 0\nNOT CHECK [9] 1\nCHECK [<$STR(N$未知标识)>] 0');
  const source = fs.readFileSync(path.join(__dirname, '../src/assistant.ts'), 'utf8');
  const ast = ts.createSourceFile('assistant.ts', source, ts.ScriptTarget.Latest, true);
  const required = new Set(['scanCandidateUsage', 'invalidateCandidateUsage', 'pickUnusedScriptCandidate', 'analyzeVariables', 'escapeHtml', 'reportVariableCategory']);
  const functions = [];
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name && required.has(node.name.text)) {
      required.delete(node.name.text); functions.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(required.size, 0);
  const warnings = [], picks = [], logs = [], reports = [];
  const uri = target => ({ scheme: 'file', fsPath: target, toString: () => target });
  const workspace = {
    workspaceFolders: [{ uri: uri(directory) }], textDocuments: [],
    getConfiguration: () => ({ get: () => 'GOM' }),
    findFiles: async pattern => { assert.ok(pattern.includes('[tT]')); return [uri(file)]; },
    fs: { readFile: target => fs.promises.readFile(target.fsPath) },
    asRelativePath: target => path.relative(temporary, target),
  };
  const scope = {
    ...require('../out/utils/variable-candidates'),
    ...require('../out/utils/variable-statistics'),
    ...require('../out/utils/text'),
    ...require('../out/utils/webview-security'),
    VariableListScanner, analyzeVariableListFile,
    normalizeEngineId: value => value,
    resolveNestedConfigValues: () => undefined, resolveNestedTableData: () => undefined, resolveNestedListData: () => undefined,
    configuredMapCodesForFile: () => new Set(), resolveIndexedCommandToken: () => undefined,
    findMapCodeRangesInText: () => [], log: text => logs.push(text),
    vscode: {
      workspace, ProgressLocation: { Notification: 15 }, ViewColumn: { Active: -1 },
      window: {
        activeTextEditor: { document: { uri: uri(file) } },
        withProgress: async (options, task) => task({ report() {} }, { isCancellationRequested: false }),
        showWarningMessage: message => warnings.push(message), showInformationMessage: message => warnings.push(message),
        showQuickPick: async (items, options) => { picks.push({ items, options }); return undefined; },
        createWebviewPanel: () => { const panel = { webview: { cspSource: 'vscode-webview://test' } }; reports.push(panel); return panel; },
      },
    },
  };
  vm.createContext(scope);
  const compiled = ts.transpileModule('let candidateUsageCache; let candidateUsageGeneration = 0;\n' + functions.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInContext(compiled, scope);
  try {
    await scope.pickUnusedScriptCandidate({ uri: file, kind: 'variable', family: 'U' });
    assert.ok(picks[0].options.title.includes('待核实'));
    assert.ok(picks[0].items.every(item => item.description.includes('动态引用')));
    assert.ok(picks[0].items.some(item => item.label === 'U1'), 'dynamic base must not occupy U1');
    await scope.pickUnusedScriptCandidate({ uri: file, kind: 'personalFlag' });
    assert.equal(picks[1].items.some(item => item.label === '[9]'), false);
    assert.ok(picks[1].options.placeHolder.includes('不能保证未使用'));
    fs.writeFileSync(file, 'MOV A999 1\nMOV G999 1\nNOT CHECK [1] 1');
    scope.invalidateCandidateUsage();
    await scope.pickUnusedScriptCandidate({ uri: file, kind: 'variable', family: 'A' });
    assert.equal(picks[2].items.some(item => item.label === 'A999'), false);
    assert.ok(picks[2].items.some(item => item.label === 'A998'));
    assert.equal(picks[2].options.title.includes('待核实'), false);
    await scope.analyzeVariables();
    const html = reports[0].webview.html;
    assert.match(html, /A999<\/td><td class="col-count">1/);
    assert.match(html, /G999<\/td><td class="col-count">1/);
    assert.match(html, /\[1\]<\/td><td class="col-count">1/);
    assert.ok(html.includes('main.TXT'));
    const originalRead = fs.promises.readFile;
    try {
      fs.promises.readFile = async function(target, ...args) {
        if (target === file) throw new Error('fixture denied');
        return originalRead.call(this, target, ...args);
      };
      scope.invalidateCandidateUsage();
      await scope.pickUnusedScriptCandidate({ uri: file, kind: 'variable', family: 'U' });
      assert.equal(picks.length, 3, 'failed scan must not offer falsely unused slots');
      assert.ok(warnings.at(-1).includes('读取失败'));
    } finally { fs.promises.readFile = originalRead; }
    workspace.workspaceFolders = [{ uri: uri(path.join(temporary, 'Unrelated')) }];
    scope.invalidateCandidateUsage();
    await scope.pickUnusedScriptCandidate({ uri: file, kind: 'variable', family: 'U' });
    assert.equal(picks.length, 3);
    assert.ok(warnings.at(-1).includes('未扫描到脚本'));
    console.log('variable-candidate-command.test.js: PASS (actual command + scanner; uncertainty labels, NOT CHECK, A999, failure/empty guards)');
  } finally { removeTemporaryDirectory(temporary); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
