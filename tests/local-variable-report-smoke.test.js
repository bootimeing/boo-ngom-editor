/* Optional, disk-only integration check of the real assistant report command.
 * Usage: $env:BOO_LOCAL_REPORT_ROOT='D:\MirServer\Mir200\Envir'; node tests/local-variable-report-smoke.test.js
 * No VS Code/server process is launched, and no server file is modified.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const selectedRoot = process.env.BOO_LOCAL_REPORT_ROOT;
if (!selectedRoot) {
  console.log('SKIP local-variable-report-smoke: set BOO_LOCAL_REPORT_ROOT to an explicit local Envir directory');
  process.exit(0);
}

const repository = path.resolve(__dirname, '..');
const root = fs.realpathSync(path.resolve(selectedRoot));
assert.equal(path.basename(root).toLowerCase(), 'envir', 'select the Envir directory explicitly, not a broad drive/server root');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const pathKey = value => path.resolve(value).toLowerCase();
const inside = value => {
  const relative = path.relative(root, path.resolve(value));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};
const enumerated = [];
const skippedLinks = [];
function enumerate(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { skippedLinks.push(target); continue; }
    if (entry.isDirectory()) {
      if (entry.name.toLowerCase() !== 'node_modules') enumerate(target);
    } else if (entry.isFile() && /\.(txt|ini)$/i.test(entry.name)) enumerated.push(target);
  }
}
enumerate(root);
const { variableListScanRoots } = require('../out/utils/variable-list');
const roots = variableListScanRoots([root]);
const reportFiles = enumerated.filter(file => roots.some(selected => {
  const relative = path.relative(selected, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
})).sort();
assert.ok(reportFiles.length, 'no real TXT files found in selected Envir');

const before = new Map(reportFiles.map(file => [pathKey(file), { file, hash: sha256(fs.readFileSync(file)) }]));
const readPaths = new Set();
const blockedDependencies = new Set();
function checkedPath(target) {
  const candidate = path.resolve(target);
  if (!inside(candidate)) {
    blockedDependencies.add(candidate);
    throw new Error('local smoke test refuses dependencies outside selected Envir');
  }
  // Resolve reparse aliases too, without giving production resolvers a different
  // implementation. Their actual read receives an error if it leaves this scope.
  const real = fs.realpathSync(candidate);
  if (!inside(real)) {
    blockedDependencies.add(real);
    throw new Error('local smoke test refuses reparse dependencies outside selected Envir');
  }
  return candidate;
}
function readFile(target) {
  const candidate = checkedPath(target);
  const raw = fs.readFileSync(candidate);
  const key = pathKey(candidate);
  if (!before.has(key)) before.set(key, { file: candidate, hash: sha256(raw) });
  readPaths.add(candidate);
  return raw;
}

async function main() {
  const assistantPath = path.join(repository, 'src/assistant.ts');
  const assistantSource = fs.readFileSync(assistantPath, 'utf8');
  const assistantHash = sha256(assistantSource);
  const required = new Set([
    'variableScanOptions', 'analyzeVariables', 'escapeHtml', 'reportVariableCategory',
    'resolveNestedConfigValues', 'resolveNestedTableData', 'resolveNestedListData',
    'resolveNestedDataFile', 'statisticsFileInput', 'findAncestorDirectory', 'parseIniSections',
    'commandLookupKeys', 'resolveIndexedCommandToken', 'mapInfoPathForFile', 'configuredMapCodesForFile',
  ]);
  const extracted = [];
  const ast = ts.createSourceFile(assistantPath, assistantSource, ts.ScriptTarget.Latest, true);
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name && required.has(node.name.text)) {
      required.delete(node.name.text);
      extracted.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(required.size, 0, `missing production functions: ${[...required].join(',')}`);
  const variableList = require('../out/utils/variable-list');
  const loader = require('../out/data/loader');
  const commandIndex = require('../out/utils/command-index');
  const engineDetails = require('../out/utils/engine-detect').detectEngineDetails(root);
  assert.ok(engineDetails.engine, 'engine must be supported by actual local detection evidence');
  const engine = engineDetails.engine;
  const logs = [];
  const languageIndex = commandIndex.buildLanguageIndex(
    loader.loadCommandsData(repository, () => {}), loader.loadVariablesData(repository, () => {}),
    loader.loadEngineFunctionCatalog(repository, () => {}), engine,
    loader.loadEngineConstantCatalog(repository, () => {}),
  );
  const panels = [];
  const warnings = [];
  const consoleWarnings = [];
  const sourceCounts = { direct: 0, inferred: 0, possible: 0, unknown: 0 };

  const uri = target => ({ scheme: 'file', fsPath: target, toString: () => target });
  const context = {
    ...variableList,
    ...require('../out/utils/variable-candidates'),
    ...require('../out/utils/text'),
    ...require('../out/utils/webview-security'),
    ...require('../out/utils/script-labels'),
    ...require('../out/utils/statistics-table-data'),
    ...require('../out/utils/map-code-context'),
    ...commandIndex,
    fs: { statSync: fs.statSync, existsSync: fs.existsSync, readFileSync: readFile }, path, Buffer,
    languageIndex,
    nestedConfigCache: new Map(), nestedTableCache: new Map(), nestedListCache: new Map(), mapCodeCache: new Map(),
    console: { warn: (...items) => consoleWarnings.push(items.map(String).join(' ')) },
    log: message => logs.push(message),
    VariableListScanner: class extends variableList.VariableListScanner {
      async scan(...args) {
        const result = await super.scan(...args);
        assert.ok(result && !result.errors.length);
        for (const occurrences of result.occurrences.values()) {
          for (const item of occurrences) sourceCounts[item.source?.kind || 'direct']++;
        }
        return result;
      }
    },
    vscode: {
      ProgressLocation: { Notification: 15 }, ViewColumn: { Active: -1 },
      workspace: {
        workspaceFolders: [{ uri: uri(root) }], textDocuments: [],
        getConfiguration: () => ({ get: () => engine }),
        findFiles: async (pattern, exclude) => {
          assert.equal(pattern, '**/*.[tT][xX][tT]');
          assert.equal(exclude, '**/node_modules/**');
          return reportFiles.map(uri);
        },
        fs: { readFile: async target => readFile(target.fsPath) },
        asRelativePath: target => path.relative(root, target),
      },
      window: {
        withProgress: async (_options, task) => task({ report() {} }, { isCancellationRequested: false }),
        showWarningMessage: message => warnings.push(message),
        createWebviewPanel: (kind, title, _column, options) => {
          assert.equal(kind, 'booVarStats');
          assert.equal(title, 'BOO 变量统计');
          assert.equal(options.enableScripts, false);
          const panel = { webview: { cspSource: 'vscode-webview://local-variable-report' } };
          panels.push(panel); return panel;
        },
      },
    },
  };
  vm.createContext(context);
  const compiled = ts.transpileModule(extracted.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInContext(compiled, context, { filename: assistantPath + ':actual-report-functions' });
  const resolverCounts = {};
  for (const name of ['resolveNestedConfigValues', 'resolveNestedTableData', 'resolveNestedListData']) {
    const original = context[name];
    const counts = resolverCounts[name] = { requested: 0, resolved: 0, complete: 0 };
    context[name] = (...args) => {
      counts.requested++;
      const result = original(...args);
      if (result) counts.resolved++;
      if (result?.complete) counts.complete++;
      return result;
    };
  }
  const productionFiles = [
    'src/assistant.ts', 'src/utils/nested-variable-analysis.ts', 'src/utils/script-static-arithmetic.ts',
    'src/utils/variable-list.ts', 'src/utils/variable-statistics.ts', 'src/utils/statistics-table-data.ts',
    'src/utils/map-code-context.ts', 'src/utils/command-index.ts',
    'out/utils/nested-variable-analysis.js', 'out/utils/variable-list.js',
    'out/utils/statistics-table-data.js',
  ];
  const productionHashes = Object.fromEntries(productionFiles.map(file => [file, sha256(fs.readFileSync(path.join(repository, file)))]));
  const started = Date.now();
  await context.analyzeVariables();
  assert.equal(panels.length, 1, 'actual report command must produce one report panel');
  const html = panels[0].webview.html;
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /script-src 'none'/);
  assert.match(html, /不是运行次数/);
  assert.match(html, /打开文件取当前草稿，其余读取磁盘/);
  assert.ok(!html.includes('id="totalTypes">-'));
  const summary = /扫描文件: (\d+) 个[^|]*\|&nbsp; 读取失败: (\d+) 个/.exec(html);
  assert.ok(summary, 'actual report summary missing');
  assert.equal(Number(summary[1]), reportFiles.length);
  assert.equal(Number(summary[2]), 0, 'actual report must not swallow an integration exception');

  assert.equal(consoleWarnings.length, 0);
  assert.equal(warnings.length, 0);

  const renderedSourceCounts = { direct: 0, inferred: 0, possible: 0, unknown: 0 };
  const sourceKey = { '直接引用': 'direct', '确定推导': 'inferred', '可能引用': 'possible', '未解动态': 'unknown' };
  const categories = [];
  let rowCount = 0;
  let referenceCount = 0;
  for (const match of html.matchAll(/<h2>([\s\S]*?) \((\d+) 个\)<\/h2><table>([\s\S]*?)<\/table>/g)) {
    const rows = [...match[3].matchAll(/<tr><td class="col-name">([\s\S]*?)<\/td><td class="col-count">(\d+)<\/td><td>([\s\S]*?)<\/td><td class="col-files">([\s\S]*?)<\/td><\/tr>/g)];
    assert.equal(rows.length, Number(match[2]), `rendered category row count mismatch: ${match[1]}`);
    let categoryReferences = 0;
    for (const row of rows) {
      const count = Number(row[2]);
      const origins = [...row[3].matchAll(/(直接引用|确定推导|可能引用|未解动态) (\d+)处/g)];
      assert.equal(origins.reduce((sum, origin) => sum + Number(origin[2]), 0), count,
        'source classifications must sum to the actual rendered count');
      for (const origin of origins) renderedSourceCounts[sourceKey[origin[1]]] += Number(origin[2]);
      assert.ok(row[4], 'actual report variable must retain a source file');
      categoryReferences += count;
    }
    categories.push({ name: match[1], distinctRows: rows.length, sourceReferences: categoryReferences });
    rowCount += rows.length; referenceCount += categoryReferences;
  }
  assert.ok(categories.length && rowCount && referenceCount, 'real server report unexpectedly empty');
  assert.deepEqual(renderedSourceCounts, sourceCounts, 'actual analysis results must all survive report categorization/rendering');
  for (const file of reportFiles) readPaths.add(file);
  const sidebarFiles = enumerated.filter(file => roots.some(scriptRoot => {
    const relative = path.relative(scriptRoot, file);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  }));
  const sidebarPaths = new Set(sidebarFiles.map(pathKey));
  const reportOnly = reportFiles.filter(file => !sidebarPaths.has(pathKey(file)));
  const directoryCounts = {};
  for (const file of reportFiles) {
    const relative = path.relative(root, file);
    const bucket = relative.includes(path.sep) ? relative.split(path.sep)[0] : '(Envir root)';
    directoryCounts[bucket] = (directoryCounts[bucket] || 0) + 1;
  }
  for (const { file, hash } of before.values()) assert.equal(sha256(fs.readFileSync(file)), hash, `real source changed: ${file}`);
  assert.equal(sha256(fs.readFileSync(assistantPath, 'utf8')), assistantHash, 'assistant changed while actual functions were being tested');
  for (const [file, hash] of Object.entries(productionHashes)) {
    assert.equal(sha256(fs.readFileSync(path.join(repository, file))), hash, `tested production source/output changed during run: ${file}`);
  }
  const serverFingerprint = sha256([...before.values()].sort((a, b) => a.file.localeCompare(b.file))
    .map(item => path.relative(root, item.file) + '\0' + item.hash).join('\n'));
  const scannedPaths = new Set(reportFiles.map(pathKey));
  const extraDependencies = new Set([...readPaths].map(pathKey).filter(file => !scannedPaths.has(file)));
  console.log(JSON.stringify({
    result: 'passed', boundary: 'actual assistant analyzeVariables + real disk IO + actual resolvers; minimal VS Code UI adapter, not native host/server execution',
    root, engine, engineConfidence: engineDetails.confidence, diskOnly: true,
    reportFiles: reportFiles.length, analyzedFiles: Number(summary[1]), failedFiles: 0,
    sidebarScopeFiles: sidebarFiles.length, sidebarIniFiles: sidebarFiles.filter(file => /\.ini$/i.test(file)).length,
    reportOnlyFiles: reportOnly.length, directoryCounts,
    categories, distinctReportRows: rowCount, sourceReferences: referenceCount, sourceCounts,
    resolverCounts,
    readFilesTotal: scannedPaths.size + extraDependencies.size, extraDependencyFiles: extraDependencies.size,
    blockedOutsideDependencies: blockedDependencies.size,
    skippedLinks: skippedLinks.length, tableDiagnosticCount: logs.length,
    verifiedServerFilesUnchanged: before.size, serverFingerprintSha256: serverFingerprint,
    assistantSourceSha256: assistantHash, productionHashes, elapsedMs: Date.now() - started,
  }, null, 2));
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
