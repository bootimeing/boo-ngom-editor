const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const XLSX = require('xlsx');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { analyzeVariableListFile } = require('../out/utils/variable-list');
const { unusedVariableCandidates } = require('../out/utils/variable-candidates');

function actualResolver() {
  const source = fs.readFileSync(path.join(__dirname, '../src/assistant.ts'), 'utf8');
  const ast = ts.createSourceFile('assistant.ts', source, ts.ScriptTarget.Latest, true);
  const required = new Set(['resolveNestedTableData', 'statisticsFileInput', 'resolveNestedDataFile', 'findAncestorDirectory']);
  const functions = [];
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name && required.has(node.name.text)) {
      required.delete(node.name.text); functions.push(node.getText(ast));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(required.size, 0, 'test must exercise the actual assistant resolver and path policy');
  const reader = fs.existsSync(path.join(__dirname, '../out/utils/statistics-table-data.js'))
    ? require('../out/utils/statistics-table-data') : {};
  const warnings = [];
  const scope = { fs, path, Buffer, variableListPathKey: require('../out/utils/variable-list').variableListPathKey, nestedTableCache: new Map(), ...reader,
    ...require('../out/utils/table-data'), ...require('../out/utils/text'), log: text => warnings.push(text) };
  vm.createContext(scope);
  vm.runInContext(ts.transpileModule(functions.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, scope);
  return { resolve: scope.resolveNestedTableData, warnings };
}

function workbookBuffer(bookType, sheet = { B3: { t: 'n', v: 30 }, '!ref': 'B3:B3' }, secondSheet) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '配置');
  if (secondSheet) XLSX.utils.book_append_sheet(workbook, { A1: { t: 'n', v: 99 }, '!ref': 'A1' }, '其他');
  return XLSX.write(workbook, { type: 'buffer', bookType, compression: bookType === 'xlsx' });
}

function formulaBuffer(bookType) {
  if (bookType === 'xlsx') return workbookBuffer(bookType, { A1: { t: 'n', v: 77, f: 'UNSUPPORTED(1)' }, '!ref': 'A1' });
  // The BIFF8 writer drops .f, so insert a real FORMULA record instead of
  // mistaking a cached-only NUMBER fixture for a formula-bearing workbook.
  const container = XLSX.CFB.read(workbookBuffer('xls', { A1: { t: 'n', v: 77 }, '!ref': 'A1' }), { type: 'buffer' });
  const entry = container.FileIndex.find(item => item.name === 'Workbook');
  const stream = Buffer.from(entry.content);
  let replaced = false;
  for (let cursor = 0; cursor + 4 <= stream.length;) {
    const record = stream.readUInt16LE(cursor), length = stream.readUInt16LE(cursor + 2);
    if (record === 0x0203) {
      const formula = Buffer.alloc(33);
      formula.writeUInt16LE(0x0006, 0); formula.writeUInt16LE(29, 2);
      stream.copy(formula, 4, cursor + 4, cursor + 18);
      formula.writeUInt16LE(7, 24);
      Buffer.from([0x1e, 1, 0, 0x1e, 1, 0, 0x03]).copy(formula, 26);
      entry.content = Buffer.concat([stream.subarray(0, cursor), formula, stream.subarray(cursor + 4 + length)]);
      entry.size = entry.content.length;
      replaced = true; break;
    }
    cursor += 4 + length;
  }
  assert.ok(replaced);
  const buffer = XLSX.CFB.write(container, { type: 'buffer' });
  assert.equal(XLSX.read(buffer, { type: 'buffer', cellFormula: true }).Sheets['配置'].A1.f, '1+1', 'BIFF8 fixture actually contains a formula and a stale cache');
  return buffer;
}

function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-statistics-excel-'));
  const directory = path.join(temporary, 'Envir', 'Market_Def');
  fs.mkdirSync(directory, { recursive: true });
  const sourceFile = path.join(directory, 'script.txt');
  const resolver = actualResolver();
  try {
    for (const format of ['xls', 'xlsx']) {
      const file = path.join(directory, `配置.${format}`);
      const raw = workbookBuffer(format);
      fs.writeFileSync(file, raw);
      const before = fs.readFileSync(file);
      const table = resolver.resolve(sourceFile, { path: `配置.${format}`, format: 'excel' });
      assert.ok(table?.complete, `${format} actual binary workbook must reach statistics resolver`);
      assert.deepEqual(JSON.parse(JSON.stringify(table.rows)), [['', ''], ['', ''], ['', '30']], `${format} absolute A1 origin must not compact B3 to A1`);
      const text = `READEXCEL 配置.${format} 3\nMOV N$编号 <$GLOBAL(Excel1)>\nEQUAL U<$STR(N$编号)> 0`;
      const result = analyzeVariableListFile(text, sourceFile, {
        engine: () => 'GOM', nestedOptions: file => ({ resolveTableData: request => resolver.resolve(file, request) }),
      });
      assert.ok(result.variables.some(variable => variable.name === 'U30'), `${format} actual table-derived U30 in production aggregation`);
      assert.equal(unusedVariableCandidates('U', result.candidates).includes(30), false);
      assert.equal(result.candidates.uncertainVariableFamilies.has('U'), false);
      assert.deepEqual(fs.readFileSync(file), before, 'read-only statistics must not rewrite workbook');
    }

    const { readStatisticsTableData: read, MAX_STATISTICS_TABLE_BYTES } = require('../out/utils/statistics-table-data');
    for (const format of ['xls', 'xlsx']) {
      assert.equal(read(workbookBuffer(format, undefined, true), 'excel'), undefined, 'unknown multiple-sheet selection must not guess first');
      const formula = formulaBuffer(format);
      assert.equal(read(formula, 'excel'), undefined, `${format} unknown formula cache is not a known value`);
      const file = path.join(directory, `公式.${format}`);
      fs.writeFileSync(file, formula);
      const result = analyzeVariableListFile(`READEXCEL 公式.${format} 1\nMOV N$编号 <$GLOBAL(Excel0)>\nEQUAL U<$STR(N$编号)> 0`, sourceFile, {
        engine: () => 'GOM', nestedOptions: file => ({ resolveTableData: request => resolver.resolve(file, request) }),
      });
      assert.equal(result.variables.some(variable => variable.name === 'U77'), false);
      assert.equal(result.candidates.uncertainVariableFamilies.has('U'), true, 'failed formula read must retain candidate uncertainty');
      assert.equal(read(workbookBuffer(format, { A1: { t: 'e', v: 7 }, '!ref': 'A1' }), 'excel'), undefined, 'Excel errors must not become static values');
      assert.equal(read(workbookBuffer(format, { A65536: { t: 'n', v: 30 }, Z65536: { t: 'n', v: 31 }, '!ref': 'A1:Z65536' }), 'excel'), undefined, 'sparse data must not force an unbounded rectangular allocation');
    }
    assert.equal(read(Buffer.alloc(MAX_STATISTICS_TABLE_BYTES + 1), 'excel'), undefined);
    assert.equal(read(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'excel'), undefined, 'damaged binary workbook rejected');
    const oversizedZip = Buffer.from(workbookBuffer('xlsx'));
    const directoryEntry = oversizedZip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    assert.ok(directoryEntry > 0);
    oversizedZip.writeUInt32LE(33 * 1024 * 1024, directoryEntry + 24);
    assert.equal(read(oversizedZip, 'excel'), undefined, 'ZIP expansion is bounded before XLSX decompression');
    assert.equal(read(workbookBuffer('xlsx'), 'csv'), undefined, 'binary workbook must not silently masquerade as CSV');
    assert.deepEqual(read(Buffer.from('21\t名称\n30\t中文'), 'excel'), { rows: [['21', '名称'], ['30', '中文']], complete: true }, 'legacy text XLS compatibility');
    assert.deepEqual(read(Buffer.from('21,"名称,说明"\n30,中文'), 'csv'), { rows: [['21', '名称,说明'], ['30', '中文']], complete: true });
    const textFile = path.join(directory, '文本.xls');
    fs.writeFileSync(textFile, '21\t名称\n30\t中文');
    assert.equal(resolver.resolve(sourceFile, { path: '文本.xls', format: 'excel' }).rows[1][0], '30');
    fs.writeFileSync(textFile, '99\t名称\n100\t中文');
    assert.equal(resolver.resolve(sourceFile, { path: '文本.xls', format: 'excel' }).rows[1][0], '100', 'size/mtime dependency cache must refresh');
    assert.equal(resolver.resolve(sourceFile, { path: '<$STR(S$输入)>', format: 'excel' }), undefined, 'dynamic path still rejected by existing policy');
    assert.equal(resolver.resolve(path.join(temporary, 'elsewhere.txt'), { path: '文本.xls', format: 'excel' }), undefined, 'outside-Envir source still rejected');
    console.log('statistics-table-data.test.js: PASS (real BIFF8/XLSX -> actual assistant resolver -> aggregation/candidates; A1 origin, formula/error/size rejection, text compatibility, cache and read-only checks)');
  } finally { removeTemporaryDirectory(temporary); }
}
main();
