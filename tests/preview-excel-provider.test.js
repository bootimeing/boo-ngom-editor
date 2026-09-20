const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { ScriptDataResolver } = require(path.join(runtimeRoot, 'out/utils/script-data-resolver'));
const XLSX = require(require.resolve('xlsx', { paths: [runtimeRoot] }));

function book(value, options = {}) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, options.offset ? { B2: { t: 's', v: value }, '!ref': 'B2:B2' } : XLSX.utils.aoa_to_sheet([[value]]), 'Data');
  if (options.extraSheet) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['other']]), 'Other');
  return XLSX.write(workbook, { type: 'buffer', bookType: options.type || 'biff8' });
}

function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-preview-excel-provider-'));
  const envir = path.join(temp, 'Mir200', 'Envir');
  const market = path.join(envir, 'Market_Def');
  const diary = path.join(envir, 'QuestDiary');
  fs.mkdirSync(market, { recursive: true }); fs.mkdirSync(diary, { recursive: true });
  const source = path.join(market, 'NPC.txt');
  const original = Buffer.from('[@Main]\r\n#ACT\r\nREADEXCEL ..\\QuestDiary\\配置.xls 1\r\n#SAY\r\n<$GLOBAL(Excel0)>\r\n');
  fs.writeFileSync(source, original);
  const target = path.join(diary, '配置.xls');
  const targetBytes = book('首行不可压缩', { offset: true });
  fs.writeFileSync(target, targetBytes);
  const outside = path.join(temp, 'outside.xls'); fs.writeFileSync(outside, book('outside'));
  const resolver = new ScriptDataResolver();
  try {
    for (const engine of ['GOM', '996PC']) {
      const options = resolver.optionsFor(source, engine);
      assert.equal(typeof options.resolvePreviewExcelData, 'function', 'dedicated safe XLS reader must be exposed');
      const read = (requestPath, format = 'excel') => options.resolvePreviewExcelData({ path: requestPath, format });
      assert.deepEqual(read('..\\QuestDiary\\配置.xls'), { rows: [['', ''], ['', '首行不可压缩']], complete: true });
      assert.deepEqual(read('"..\\QuestDiary\\配置.xls"').rows, [['', ''], ['', '首行不可压缩']]);
      assert.deepEqual(read('QuestDiary/配置.xls').rows, [['', ''], ['', '首行不可压缩']]);
      assert.deepEqual(read(target).rows, [['', ''], ['', '首行不可压缩']], 'in-Envir absolute local path remains bounded');
      for (const denied of [outside, '..\\..\\..\\outside.xls', '..\\..\\..\\QuestDiary\\配置.xls', '\\\\localhost\\share\\配置.xls', '//localhost/share/配置.xls', '\\\\?\\C:\\配置.xls', 'C:配置.xls', 'file:///配置.xls', 'https://example.invalid/配置.xls', '配置.xls:secret.xls', '<$STR(S$Path)>.xls', 'bad\0.xls']) {
        assert.equal(read(denied), undefined, `${engine}: denied ${JSON.stringify(denied)}`);
      }
      assert.equal(read(target, 'csv'), undefined, 'dedicated callback cannot be used as generic CSV reader');
      assert.equal(read('missing.xls'), undefined);
      const nonXls = path.join(diary, 'data.xlsx'); fs.writeFileSync(nonXls, book('xlsx', { type: 'xlsx' }));
      assert.equal(read(nonXls), undefined);
      const disguised = path.join(diary, 'renamed.xls'); fs.writeFileSync(disguised, book('xlsx', { type: 'xlsx' }));
      assert.equal(read(disguised), undefined);
      const tabFile = path.join(diary, 'tab.xls'); fs.writeFileSync(tabFile, 'A\tB\nC\tD');
      assert.equal(read(tabFile), undefined);
      const multi = path.join(diary, 'multi.xls'); fs.writeFileSync(multi, book('first', { extraSheet: true }));
      assert.equal(read(multi), undefined);
    }
    assert.equal(resolver.optionsFor(source, 'GEE').resolvePreviewExcelData({ path: target, format: 'excel' }), undefined);
    assert.equal(resolver.optionsFor(source).resolvePreviewExcelData({ path: target, format: 'excel' }), undefined, 'missing engine does not get borrowed semantics');
    assert.equal(resolver.optionsFor(path.join(temp, 'NPC.txt'), 'GOM').resolvePreviewExcelData({ path: target, format: 'excel' }), undefined, 'a source outside Envir grants no read scope');
    assert.equal(resolver.optionsFor('\\\\localhost\\share\\Envir\\Market_Def\\NPC.txt', 'GOM').resolvePreviewExcelData({ path: 'data.xls', format: 'excel' }), undefined, 'a network source cannot grant a local read scope');

    const read = requestPath => resolver.optionsFor(source, 'GOM').resolvePreviewExcelData({ path: requestPath, format: 'excel' });
    // Directories which are links are rejected even when their targets stay in
    // Envir, not merely when realpath escapes outside it.
    const junctionOutside = path.join(envir, 'OutsideLink');
    const junctionInside = path.join(envir, 'InsideLink');
    fs.symlinkSync(temp, junctionOutside, process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(diary, junctionInside, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(read('OutsideLink/outside.xls'), undefined);
    assert.equal(read('InsideLink/配置.xls'), undefined);
    const alias = path.join(temp, 'MirAlias');
    fs.symlinkSync(path.join(temp, 'Mir200'), alias, process.platform === 'win32' ? 'junction' : 'dir');
    const aliasSource = path.join(alias, 'Envir', 'Market_Def', 'NPC.txt');
    assert.equal(resolver.optionsFor(aliasSource, 'GOM').resolvePreviewExcelData({ path: '..\\QuestDiary\\配置.xls', format: 'excel' }), undefined, 'an ancestor junction cannot establish a trusted source root');

    const ambiguousName = 'ambiguous.xls';
    fs.writeFileSync(path.join(market, ambiguousName), book('market'));
    fs.writeFileSync(path.join(envir, ambiguousName), book('envir'));
    assert.equal(read(ambiguousName), undefined, 'different eligible paths must not silently choose the first file');

    const changed = path.join(diary, 'changed.xls');
    const first = book('old'), second = book('new');
    assert.equal(first.length, second.length);
    fs.writeFileSync(changed, first);
    const stableStat = fs.statSync(changed);
    assert.equal(read(changed).rows[0][0], 'old');
    fs.writeFileSync(changed, second); fs.utimesSync(changed, stableStat.atime, stableStat.mtime);
    assert.equal(read(changed).rows[0][0], 'new', 'same size and restored mtime cannot retain old workbook bytes');

    const large = path.join(diary, 'large.xls');
    const largeHandle = fs.openSync(large, 'w'); fs.ftruncateSync(largeHandle, 16 * 1024 * 1024 + 1); fs.closeSync(largeHandle);
    const originalRead = fs.readSync;
    let dataReads = 0;
    fs.readSync = function (...args) { dataReads++; return originalRead.apply(this, args); };
    try { assert.equal(read(large), undefined); } finally { fs.readSync = originalRead; }
    assert.equal(dataReads, 0, 'oversized workbooks rejected before any byte read');

    assert.deepEqual(fs.readFileSync(source), original, 'NPC source remains byte-identical');
    assert.ok(fs.readFileSync(target).equals(targetBytes), 'workbook remains byte-identical');
    console.log('preview-excel-provider: real BIFF8 origin, engine boundary, local Envir scope, UNC/traversal/junction rejection, no stale cache and bounded read passed');
  } finally {
    resolver.dispose();
    // Remove only this test-owned, exact mkdtemp directory, never a workspace.
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('boo-preview-excel-provider-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
run();
