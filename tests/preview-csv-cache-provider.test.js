const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const Module = require('node:module'), { pathToFileURL } = require('node:url');
const { fixture, expectedOne } = require('./helpers/rebirth-preview-fixture');
const { parse } = require('./preview-inputs-integration.test');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { ScriptDataResolver } = require(path.join(root, 'out/utils/script-data-resolver'));

async function run() {
  const setup = fixture(), resolver = new ScriptDataResolver();
  try {
    const options = resolver.optionsFor(setup.file, 'GOM');
    assert.equal(typeof options.resolvePreviewCsvData, 'function', 'dedicated bounded CSV reader must exist');
    const read = value => options.resolvePreviewCsvData({ path: value, format: 'csv' });
    const relative = '..\\QuestDiary\\03游戏名单\\表格数据\\转生系统.csv';
    assert.equal(read(relative).rows[1][4], '100000', 'comment header excluded; 0-based rows and columns');
    assert.equal(read(relative).rows[1][5], '', 'empty columns must keep their position');
    assert.deepEqual(read(setup.table), read(relative));
    assert.deepEqual(read('..\\..\\..\\QuestDiary\\03游戏名单\\表格数据\\转生系统.csv'), read(relative), 'a normalized path still inside Envir is valid');
    const outside = path.join(setup.temp, 'outside.csv'); fs.writeFileSync(outside, 'secret');
    for (const denied of [outside, '..\\..\\..\\..\\QuestDiary\\03游戏名单\\表格数据\\转生系统.csv',
      '\\\\localhost\\share\\data.csv', '//localhost/share/data.csv', '\\\\?\\C:\\data.csv',
      'C:data.csv', 'file:///data.csv', 'https://example.invalid/data.csv', 'data.csv:secret.csv',
      '<$STR(S$Path)>.csv', 'missing.csv', 'bad\0.csv']) {
      assert.equal(read(denied), undefined, `denied ${JSON.stringify(denied)}`);
    }
    assert.equal(options.resolvePreviewCsvData({ path: setup.table, format: 'excel' }), undefined);
    assert.equal(resolver.optionsFor(setup.file).resolvePreviewCsvData({ path: setup.table, format: 'csv' }), undefined);
    for (const engine of ['GEE', '996PC']) assert.equal(resolver.optionsFor(setup.file, engine).resolvePreviewCsvData({ path: setup.table, format: 'csv' }), undefined, 'no borrowed CSV cache contract');
    const envir = path.resolve(setup.file, '../../../..');
    const link = path.join(envir, 'LinkedCsv'); fs.symlinkSync(path.dirname(setup.table), link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(read(path.join(link, '转生系统.csv')), undefined, 'in-root linked directory rejected');
    const large = path.join(envir, 'large.csv'); const fd = fs.openSync(large, 'w');
    fs.ftruncateSync(fd, 8 * 1024 * 1024 + 1); fs.closeSync(fd);
    assert.equal(read(large), undefined, 'oversize rejected before byte read');
    const mutable = path.join(envir, 'mutable.csv'); fs.writeFileSync(mutable, 'old,1'); const stat = fs.statSync(mutable);
    assert.equal(read(mutable).rows[0][0], 'old'); fs.writeFileSync(mutable, 'new,2'); fs.utimesSync(mutable, stat.atime, stat.mtime);
    assert.equal(read(mutable).rows[0][0], 'new', 'same-size/time replacement must not reuse old cells');
    const utf8 = path.join(envir, 'utf8.csv'); fs.writeFileSync(utf8, '\ufeff;注释\r\n" 左右空格 ","逗号,文本",\r\n');
    assert.deepEqual(read(utf8).rows, [[' 左右空格 ', '逗号,文本', '']], 'UTF8 BOM, quoted text and empty columns are preserved');
    const binary = path.join(envir, 'binary.csv'); fs.writeFileSync(binary, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    assert.equal(read(binary), undefined, 'renamed binary spreadsheets are not CSV');
    const damaged = path.join(envir, 'damaged.csv'); fs.writeFileSync(damaged, Buffer.from([0xef, 0xbb, 0xbf, 0xff]));
    assert.equal(read(damaged), undefined, 'lossy decoding must not become a confirmed cell');
    fs.writeFileSync(path.join(envir, 'ambiguous.csv'), 'root');
    fs.writeFileSync(path.join(path.dirname(setup.file), 'ambiguous.csv'), 'source');
    assert.equal(read('ambiguous.csv'), undefined, 'ambiguous existing candidates must not silently pick a file');
    options.resolveTableData = () => assert.fail('CSV alias must not bypass dedicated reader');
    const models = values => parse(setup.source, values, 'GOM', { filePath: setup.file,
      fileName: path.basename(setup.file), uri: pathToFileURL(setup.file).href, dataOptions: options });
    const text = model => model.pages.flatMap(p => p.elements).map(e => e.text).filter(Boolean);
    for (const expected of expectedOne) assert.ok(text(models({ RELEVEL: '1' })).includes(expected), `missing ${expected}`);
    const originalLoad = Module._load;
    const errors = [], posted = [];
    const vscode = { Uri: { parse: value => ({ toString: () => value, fsPath: value }), file: value => ({ fsPath: value }) },
      EventEmitter: class {}, window: { showErrorMessage: value => errors.push(value) },
      workspace: { applyEdit() { assert.fail('preview attempted to modify a source'); } } };
    let Manager;
    Module._load = function (request, parent, isMain) { return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain); };
    try {
      const file = path.join(root, 'out/providers/npc-dialog-visual.js'), loaded = new Module(file, module);
      loaded.filename = file; loaded.paths = Module._nodeModulePaths(path.dirname(file));
      loaded._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.TestManager=NpcDialogVisualEditorManager;', file);
      Manager = loaded.exports.TestManager;
    } finally { Module._load = originalLoad; }
    const manager = Object.create(Manager.prototype), session = { key: 'csv', model: models({}), document: { version: 1 },
      dirty: true, conflict: false, modelRevision: 1, previewConditions: {}, panel: { webview: { postMessage: message => posted.push(message) } } };
    manager.sessions = new Map([[session.key, session]]); manager.hydrateAssets = async () => {};
    manager.createModel = async (_document, _cursor, _label, _states, values) => models(values);
    assert.deepEqual(session.model.previewInputs.map(i => i.name), ['RELEVEL'], 'only the real selector, not CSV function names or derived variables');
    await manager.onMessage(session, { type: 'previewInput', name: 'RELEVEL', value: '1' });
    expectedOne.forEach(expected => assert.ok(text(session.model).includes(expected), expected));
    assert.equal(posted.at(-1).preserveDrafts, true);
    await manager.onMessage(session, { type: 'previewInput', name: 'RELEVEL', value: '3' });
    assert.ok(text(session.model).includes('3转')); assert.ok(text(session.model).includes('等级需求：无法提升'));
    assert.ok(!text(session.model).includes('1转　→　2转'));
    await manager.onMessage(session, { type: 'resetPreview' });
    assert.ok(text(session.model).includes('0转　→　1转')); assert.equal(session.dirty, true);
    assert.deepEqual(errors, []); setup.unchanged();
    console.log('preview-csv-cache-provider: PASS real GBK CSV, safe local reader, source order, input 0/1/3/reset, no source writes; mocked host transport');
  } finally { resolver.dispose(); setup.dispose(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
