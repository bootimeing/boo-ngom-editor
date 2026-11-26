const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { VariableListScanner, analyzeVariableListFile } = require('../out/utils/variable-list');
const { loadCommandsData, loadEngineFunctionCatalog } = require('../out/data/loader');
const { buildLanguageIndex } = require('../out/utils/command-index');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-candidate-command-'));
  const directory = path.join(temporary, 'Envir/Market_Def');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'main.TXT');
  fs.writeFileSync(file, 'MOV U1<$STR(N$未知)> 0\nNOT CHECK [9] 1\nCHECK [<$STR(N$未知标识)>] 0');
  const source = fs.readFileSync(path.join(__dirname, '../src/assistant.ts'), 'utf8');
  const ast = ts.createSourceFile('assistant.ts', source, ts.ScriptTarget.Latest, true);
  const required = new Set([
    'variableScanOptions', 'scanCandidateUsage', 'invalidateCandidateUsage', 'pickUnusedScriptCandidate',
    'analyzeVariables', 'escapeHtml', 'reportVariableCategory', 'resolveNestedConfigValues', 'resolveNestedListData',
    'resolveNestedTableData', 'resolveNestedDataFile', 'statisticsFileInput', 'parseIniSections',
    'findAncestorDirectory', 'configuredMapCodesForFile', 'mapInfoPathForFile',
  ]);
  const events = [];
  const functions = [];
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name && required.has(node.name.text)) {
      required.delete(node.name.text); functions.push(node.getText(ast));
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const callback = node.arguments[0]?.getText(ast);
      if ((name === 'onDidChangeTextDocument' && callback === 'invalidateCandidateUsage') ||
          (name === 'onDidCloseTextDocument' && callback?.includes('invalidateCandidateUsage()'))) {
        events.push(node.getText(ast));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(required.size, 0);
  assert.equal(events.length, 2, 'actual document change and close hooks should invalidate candidate results');
  const repository = path.resolve(__dirname, '..');
  const language = buildLanguageIndex(loadCommandsData(repository, () => {}), null, loadEngineFunctionCatalog(repository, () => {}), 'GOM');
  const warnings = [], picks = [], logs = [], reports = [];
  let changeDocument, closeDocument;
  const uri = target => ({ scheme: 'file', fsPath: target, toString: () => target });
  const workspace = {
    workspaceFolders: [{ uri: uri(directory) }], textDocuments: [],
    onDidChangeTextDocument: callback => { changeDocument = callback; },
    onDidCloseTextDocument: callback => { closeDocument = callback; },
    getConfiguration: () => ({ get: () => 'GOM' }),
    findFiles: async pattern => { assert.ok(pattern.includes('[tT]')); return [uri(file)]; },
    fs: { readFile: target => fs.promises.readFile(target.fsPath) },
    asRelativePath: target => path.relative(temporary, target),
  };
  const scope = {
    ...require('../out/utils/variable-list'),
    ...require('../out/utils/variable-candidates'),
    ...require('../out/utils/variable-statistics'),
    ...require('../out/utils/text'),
    ...require('../out/utils/webview-security'),
    VariableListScanner, analyzeVariableListFile,
    normalizeEngineId: value => value,
    ...require('../out/utils/map-code-context'),
    isScriptCommentLine: require('../out/utils/script-labels').isScriptCommentLine,
    ...require('../out/utils/statistics-table-data'),
    fs, path, Buffer, languageIndex: language,
    nestedConfigCache: new Map(), nestedListCache: new Map(), nestedTableCache: new Map(), mapCodeCache: new Map(),
    resolveIndexedCommandToken: name => language.commandByName.get(name.toUpperCase()),
    diagnosticTimeouts: new Map(), diagnosticCollection: { delete() {} }, isWorkspaceScriptAuditPath: () => false,
    log: text => logs.push(text),
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
  const compiled = ts.transpileModule('let candidateUsageCache; let candidateUsageGeneration = 0;\n' + [...functions, ...events].join('\n;\n'), {
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
    fs.writeFileSync(file, 'MOV N$原变量 20\nMOV N$新变量 <$STR(N$原变量)>\nINC N$新变量 10\nEQUAL U<$STR(N$新变量)> 0');
    scope.invalidateCandidateUsage();
    await scope.analyzeVariables();
    const derivedHtml = reports[1].webview.html;
    assert.match(derivedHtml, /U30<\/td><td class="col-count">1/);
    assert.ok(!derivedHtml.includes('U20</td>'));
    assert.ok(derivedHtml.includes('确定推导 1处'));
    assert.ok(derivedHtml.includes('不是运行次数'));
    assert.ok(!derivedHtml.includes('id="totalTypes">-'));
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
    workspace.workspaceFolders = [{ uri: uri(directory) }];
    const envir = path.dirname(directory);
    const external = path.join(envir, 'data');
    fs.mkdirSync(external);
    const inputs = [
      { path: path.join(external, 'slots.ini'), disk: '[slots]\nid=101', draft: '[slots]\nid=201' },
      { path: path.join(external, 'names.txt'), disk: '102', draft: '202' },
      { path: path.join(external, 'cells.csv'), disk: 'id,103', draft: 'id,203' },
      { path: path.join(envir, 'MapInfo.txt'), disk: '[U105 磁盘地图]', draft: '[U205 草稿地图]' },
    ];
    for (const input of inputs) fs.writeFileSync(input.path, input.disk);
    fs.writeFileSync(file, [
      '[@main]', '#ACT', 'READCONFIGFILEITEM ../data/slots.ini slots id N$配置',
      'EQUAL U<$STR(N$配置)> 0', 'GETLISTSTRING ../data/names.txt 0 S$名单',
      'EQUAL U<$STR(S$名单)> 0', 'CSVGETCELLTEXT ../data/cells.csv 0 1 N$表格',
      'EQUAL U<$STR(N$表格)> 0', 'MAPMOVE U105 10 10', 'MAPMOVE U205 20 20',
    ].join('\n'));
    const diskSlots = ['U101', 'U102', 'U103', 'U205'];
    const draftSlots = ['U201', 'U202', 'U203', 'U105'];
    async function checkCommandViews(used, free) {
      const previousReports = reports.length;
      const previousPicks = picks.length;
      await scope.analyzeVariables();
      assert.equal(reports.length, previousReports + 1);
      const report = reports.at(-1).webview.html;
      await scope.pickUnusedScriptCandidate({ uri: file, kind: 'variable', family: 'U' });
      assert.equal(picks.length, previousPicks + 1);
      const candidates = new Set(picks.at(-1).items.map(item => item.label));
      for (const name of used) {
        assert.ok(report.includes('>' + name + '</td>'), 'report should include ' + name);
        assert.ok(!candidates.has(name), 'candidate list should exclude used ' + name);
      }
      for (const name of free) {
        assert.ok(!report.includes('>' + name + '</td>'), 'report should exclude ' + name);
        assert.ok(candidates.has(name), 'candidate list should include unused ' + name);
      }
    }
    scope.invalidateCandidateUsage();
    await checkCommandViews(diskSlots, draftSlots);
    workspace.textDocuments = inputs.map(input => ({
      fileName: input.path, uri: uri(input.path), isDirty: true, getText: () => input.draft,
    }));
    for (const document of workspace.textDocuments) changeDocument({ document });
    await checkCommandViews(draftSlots, diskSlots);
    const sidebar = await new VariableListScanner(scope.variableScanOptions()).scan([directory]);
    for (const name of diskSlots) assert.ok(sidebar.usages.has(name), 'sidebar should use saved ' + name);
    for (const name of draftSlots) assert.ok(!sidebar.usages.has(name), 'sidebar should ignore unsaved ' + name);
    const discarded = workspace.textDocuments;
    workspace.textDocuments = [];
    for (const document of discarded) closeDocument(document);
    await checkCommandViews(diskSlots, draftSlots);
    for (const input of inputs) assert.equal(fs.readFileSync(input.path, 'utf8'), input.disk);
    console.log('variable-candidate-command.test.js: PASS (command, draft dependencies, disk sidebar, close recovery, failure/empty guards)');
  } finally { removeTemporaryDirectory(temporary); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
