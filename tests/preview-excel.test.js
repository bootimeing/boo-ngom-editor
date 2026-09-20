const assert = require('node:assert/strict');
const path = require('node:path');
const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { applyPreviewExcelCommand: apply, previewExcelRegisterName: registerName, readPreviewExcelTable: readBuffer } = require(path.join(runtimeRoot, 'out/ui-dialog/preview-excel'));

function scenario(engine = 'GOM', table = { rows: [['第一行', '9007199254740993', ''], ['第二行']], complete: true }) {
  const values = new Map([['EXCEL0', 'old'], ['GLOBAL(Excel9)', 'stale']]);
  const reads = [], writes = [], warnings = [];
  const resolved = new Map();
  return { values, reads, writes, warnings, resolved,
    run(parts, command = 'READEXCEL') {
      return apply(command, parts, {
        resolve(raw) { return resolved.get(raw) || { value: raw, complete: !raw.includes('<$') }; },
        readTable(request) { reads.push(request); return typeof table === 'function' ? table(request) : table; },
        knownRegisters: values.keys(),
        write(name, value, dependencies, localPreview) { values.set(name, value); writes.push({ name, value, dependencies, localPreview }); },
        warn: message => warnings.push(message),
      }, engine);
    } };
}

function run() {
  assert.equal(registerName('GLOBAL(Excel02)', 'GOM'), 'EXCEL2');
  assert.equal(registerName('<$GLOBAL(excel0)>', '996PC'), 'EXCEL0');
  assert.equal(registerName('<$STR(EXCEL01)>', 'GOM'), 'EXCEL1');
  assert.equal(registerName('EXCEL0', 'GEE'), undefined);
  assert.equal(registerName('GLOBAL(Custom)', 'GOM'), undefined);
  assert.equal(registerName('EXCEL9007199254740993', 'GOM'), undefined);

  for (const engine of ['GOM', '996PC']) {
    const s = scenario(engine);
    assert.equal(s.run(['..\\QuestDiary\\配置.xls', '1']), true);
    assert.deepEqual(s.reads, [{ path: '..\\QuestDiary\\配置.xls', format: 'excel' }]);
    assert.equal(s.values.get('EXCEL0'), '第一行');
    assert.equal(s.values.get('EXCEL1'), '9007199254740993');
    assert.equal(s.values.get('EXCEL2'), '');
    assert.equal(s.values.get('EXCEL9'), undefined, 'previous stale higher columns must be invalidated');
    assert.equal(s.writes.at(-1).localPreview, false);
    s.run(['..\\QuestDiary\\配置.xls', '2']);
    assert.equal(s.values.get('EXCEL0'), '第二行', 'each call selects its current source-order row');
    assert.equal(s.values.get('EXCEL1'), undefined, 'shorter row cannot inherit prior column values');
    s.run(['..\\QuestDiary\\配置.xls', '0']);
    assert.equal(s.values.get('EXCEL0'), undefined, 'invalid row must invalidate instead of keeping second row');
    assert.equal(s.reads.length, 2, 'invalid rows perform no read');
  }

  const other = scenario('GEE');
  assert.equal(other.run(['data.xls', '1']), false);
  assert.equal(other.reads.length, 0);
  assert.equal(other.values.get('EXCEL0'), 'old');
  assert.equal(other.run(['data.xls', '1'], 'WRITEEXCEL'), false);

  for (const parts of [['data.xls'], ['data.xls', '1', 'N0'], ['data.xls', '-1'], ['data.xls', '1.5'], ['data.xls', 'NaN'], ['data.xls', '9007199254740993'], ['data.xlsx', '1'], ['data.csv', '1'], ['https://example.invalid/data.xls', '1'], ['data.xls\0bad', '1']]) {
    const s = scenario();
    assert.equal(s.run(parts), true);
    assert.equal(s.reads.length, 0, JSON.stringify(parts));
    assert.equal(s.values.get('EXCEL0'), undefined);
    assert.ok(s.warnings.length > 0);
  }
  const quoted = scenario();
  quoted.run(['"..\\QuestDiary\\游戏 配置.xls"', '01']);
  assert.equal(quoted.reads[0].path, '..\\QuestDiary\\游戏 配置.xls');

  const inputPath = scenario();
  inputPath.resolved.set('<$STR(S$Path)>', { value: 'data.xls', complete: true, localPreview: true, dependencies: ['S$Path'] });
  inputPath.run(['<$STR(S$Path)>', '1']);
  assert.equal(inputPath.reads.length, 0, 'a user input cannot choose filesystem data');

  const sourcePath = scenario();
  sourcePath.resolved.set('<$STR(S$Path)>', { value: 'data.xls', complete: true, dependencies: ['S$Path'] });
  sourcePath.run(['<$STR(S$Path)>', '1']);
  assert.equal(sourcePath.reads.length, 1, 'determined source-owned path can reach the caller security boundary');

  const selector = scenario();
  selector.resolved.set('<$STR(N0)>', { value: '2', complete: true, localPreview: true, dependencies: ['N0'] });
  selector.run(['data.xls', '<$STR(N0)>']);
  assert.equal(selector.values.get('EXCEL0'), '第二行');
  assert.deepEqual(selector.writes.at(-1).dependencies, ['N0']);
  assert.equal(selector.writes.at(-1).localPreview, true);

  const selfSelector = new Map([['EXCEL0', '2']]);
  apply('READEXCEL', ['data.xls', '<$GLOBAL(Excel0)>'], {
    resolve(raw, role) { return { value: role === 'row' ? selfSelector.get('EXCEL0') : raw, complete: true }; },
    readTable() { return { rows: [['first'], ['selected from previous row']], complete: true }; },
    knownRegisters: selfSelector.keys(),
    write(name, value) { selfSelector.set(name, value); },
  }, 'GOM');
  assert.equal(selfSelector.get('EXCEL0'), 'selected from previous row', 'read operands are captured before output invalidation');

  for (const table of [undefined, { rows: [['partial']], complete: false }, () => { throw new Error('read denied'); }]) {
    const s = scenario('GOM', table === undefined ? () => undefined : table);
    s.run(['data.xls', '1']);
    assert.equal(s.values.get('EXCEL0'), undefined);
    assert.ok(s.warnings.length > 0);
  }
  const absentRow = scenario();
  absentRow.run(['data.xls', '99']);
  assert.equal(absentRow.values.get('EXCEL0'), undefined);
  const longCell = scenario('GOM', { rows: [['safe', 'x'.repeat(4097)]], complete: true });
  longCell.run(['data.xls', '1']);
  assert.equal(longCell.values.get('EXCEL0'), 'safe');
  assert.equal(longCell.values.get('EXCEL1'), undefined);
  assert.ok(longCell.warnings.length > 0);
  const wide = scenario('GOM', { rows: [Array(513).fill('a')], complete: true });
  wide.run(['data.xls', '1']);
  assert.equal(wide.values.get('EXCEL511'), 'a');
  assert.equal(wide.values.get('EXCEL512'), undefined);
  assert.ok(wide.warnings.length > 0);

  // The actual delivered XLSX runtime constructs genuine BIFF8 bytes. No test
  // fixture touches the user's workbook or server; all buffers stay in memory.
  const XLSX = require(require.resolve('xlsx', { paths: [runtimeRoot] }));
  function workbook(sheet, options = {}) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Data');
    if (options.extraSheet) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['other']]), 'Other');
    return XLSX.write(book, { type: 'buffer', bookType: options.bookType || 'biff8' });
  }
  const offsetBuffer = workbook({ B2: { t: 's', v: 'B2' }, C2: { t: 's', v: '9007199254740993' }, '!ref': 'B2:C2' });
  assert.deepEqual(readBuffer(offsetBuffer), { rows: [['', '', ''], ['', 'B2', '9007199254740993']], complete: true }, 'B2 must never be silently rebased to A1');
  const rawValues = workbook(XLSX.utils.aoa_to_sheet([['text', 12, '', '0012'], ['', 'next']]));
  assert.deepEqual(readBuffer(rawValues).rows, [['text', '12', '', '0012'], ['', 'next', '', '']]);
  assert.equal(readBuffer(workbook(XLSX.utils.aoa_to_sheet([['a']]), { extraSheet: true })), undefined, 'unknown sheet selection is not guessed');
  assert.equal(readBuffer(workbook(XLSX.utils.aoa_to_sheet([['a']]), { bookType: 'xlsx' })), undefined, 'XLSX renamed to XLS is not accepted');
  assert.equal(readBuffer(workbook(XLSX.utils.aoa_to_sheet([['a']]), { bookType: 'biff5' })), undefined, 'unevidenced legacy BIFF5 is not accepted');
  assert.equal(readBuffer(Buffer.from('a\tb\nc\td')), undefined, 'tab-separated text renamed to XLS is not accepted');
  assert.equal(readBuffer(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), undefined, 'a header is not a complete workbook');
  assert.equal(readBuffer(Buffer.alloc(16 * 1024 * 1024 + 1)), undefined);
  // SheetJS's BIFF8 writer drops an .f property and emits a NUMBER record.
  // Replace that record in memory with an actual BIFF8 FORMULA (PtgInt 1,
  // PtgInt 1, PtgAdd); this verifies the reader against genuine formula bytes.
  const formulaContainer = XLSX.CFB.read(workbook({ A1: { t: 'n', v: 42 }, '!ref': 'A1:A1' }), { type: 'buffer' });
  const workbookEntry = formulaContainer.FileIndex.find(entry => entry.name === 'Workbook');
  const stream = Buffer.from(workbookEntry.content);
  let replaced = false;
  for (let cursor = 0; cursor + 4 <= stream.length;) {
    const record = stream.readUInt16LE(cursor), length = stream.readUInt16LE(cursor + 2);
    if (record === 0x0203) {
      const formula = Buffer.alloc(33);
      formula.writeUInt16LE(0x0006, 0); formula.writeUInt16LE(29, 2);
      stream.copy(formula, 4, cursor + 4, cursor + 18);
      formula.writeUInt16LE(7, 24);
      Buffer.from([0x1e, 1, 0, 0x1e, 1, 0, 0x03]).copy(formula, 26);
      workbookEntry.content = Buffer.concat([stream.subarray(0, cursor), formula, stream.subarray(cursor + 4 + length)]);
      workbookEntry.size = workbookEntry.content.length;
      replaced = true; break;
    }
    cursor += 4 + length;
  }
  assert.ok(replaced, 'fixture must contain a NUMBER record to replace');
  const formulaBook = XLSX.CFB.write(formulaContainer, { type: 'buffer' });
  assert.equal(XLSX.read(formulaBook, { type: 'buffer', cellFormula: true }).Sheets.Data.A1.f, '1+1', 'fixture actually contains a formula');
  assert.equal(readBuffer(formulaBook), undefined, 'formula cached result is not authoritative');
  const errorBook = workbook({ A1: { t: 'e', v: 7 }, '!ref': 'A1:A1' });
  assert.equal(readBuffer(errorBook), undefined, 'spreadsheet errors are not normal strings');
  console.log('preview-excel: engine-isolated source-order row reads, aliases, invalidation, limits and input path safety passed');
}
run();
