const assert = require('node:assert/strict');
const path = require('node:path');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { parseNpcDialogDocument } = require(path.join(runtime, 'out/ui-dialog/source-parser'));
const { buildDialogStatementCatalog } = require(path.join(runtime, 'out/ui-dialog/statement-catalog'));
const { workspaceNpcDialogOffsets } = require(path.join(runtime, 'out/ui-dialog/offsets'));
const { discoverPreviewInputs } = require(path.join(runtime, 'out/ui-dialog/preview-inputs'));
const language = require(path.join(runtime, 'data/static-language.json'));

function scenario(actions, values = {}, engine = 'GOM', table = { rows: [['第一行', '9007199254740993'], ['第二行']], complete: true }) {
  const reads = [];
  const source = `[@main]\n#ACT\n${actions}\n#SAY\n<TEXT:列0=<$GLOBAL(Excel0)>:30:30>\n<TEXT:别名=<$STR(EXCEL00)>:30:60>\n<TEXT:列1=<$GLOBAL(Excel1)>:30:90>\n<$GLOBAL(Excel0)>\n#IF\nEQUAL EXCEL0 第二行\n#SAY\n<TEXT:第二行分支:30:120>`;
  const model = parseNpcDialogDocument(source, { uri: 'file:///D:/Envir/Npc_Def/excel.txt', fileName: 'excel.txt',
    filePath: 'D:/Envir/Npc_Def/excel.txt', documentVersion: 1, engine, engineLabel: engine, cursorOffset: 2,
    offsets: workspaceNpcDialogOffsets(0, 0), catalog: buildDialogStatementCatalog(language, engine), previewValues: values,
    dataOptions: {
      resolvePreviewExcelData(request) { reads.push(request); return typeof table === 'function' ? table(request) : table; },
      resolveTableData() { assert.fail('typed READEXCEL must never bypass its dedicated safe provider'); },
    } });
  return { model, reads, text: model.pages.flatMap(page => page.elements).map(element => element.text).join('\n') };
}

function run() {
  const inputs = discoverPreviewInputs('[@main]\n#SAY\n<$GLOBAL(Excel0)> <$EXCEL00> <$STR(EXCEL0)>', { EXCEL0: '手填' });
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].name, 'EXCEL0');
  assert.equal(inputs[0].kind, 'text');
  for (const engine of ['GOM', '996PC']) {
    const first = scenario('READEXCEL ..\\QuestDiary\\配置.xls 1', {}, engine);
    assert.equal(first.reads.length, 1);
    assert.ok(first.text.includes('列0=第一行'));
    assert.ok(first.text.includes('别名=第一行'));
    assert.ok(first.text.includes('列1=9007199254740993'));
    assert.equal(first.model.previewInputs.filter(input => input.name === 'EXCEL0').length, 0,
      'a table cell resolved from a static row renders directly without an ineffective input');
    const second = scenario('READEXCEL 配置.xls 1\nREADEXCEL 配置.xls 2', { EXCEL1: '短行预览' }, engine);
    assert.ok(second.text.includes('列0=第二行'));
    assert.ok(second.text.includes('列1=短行预览'));
    assert.equal(second.model.conditionGroups[0].satisfied, true);
    const selected = scenario('READEXCEL 配置.xls <$STR(N0)>', { N0: '2' }, engine);
    assert.ok(selected.text.includes('列0=第二行'));
    assert.equal(selected.model.conditionGroups[0].satisfied, true);
    const snapshots = scenario('READEXCEL 配置.xls 1\nREADEXCEL 配置.xls <$GLOBAL(Excel0)>', {}, engine,
      { rows: [['2'], ['第二行']], complete: true });
    assert.ok(snapshots.text.includes('列0=第二行'), 'read previous registers before invalidating the next frame');
    const markup = scenario('READEXCEL 配置.xls <$STR(N0)>', { N0: '1' }, engine,
      { rows: [['<TEXT:表格源码控件:150:150>', '列一']], complete: true });
    assert.ok(markup.text.includes('表格源码控件'), 'local row selector must not turn table-authored markup into user text');
    assert.ok(markup.model.pages.flatMap(page => page.elements).some(element => element.text === '表格源码控件'),
      'standalone source-table markup must create its own control');
    for (const failure of ['READEXCEL missing.xls 1', 'READEXCEL 配置.xls 0', 'READEXCEL 配置.xls', 'READEXCEL 配置.xls 1 N0']) {
      const result = scenario(`READEXCEL 配置.xls 1\n${failure}`, { EXCEL0: '<$STR(U101)>', U101: '42' }, engine,
        request => request.path === 'missing.xls' ? undefined : { rows: [['旧值', '旧列']], complete: true });
      assert.ok(result.text.includes('列0=<$STR(U101)>'), failure);
      assert.ok(!result.text.includes('旧值'), failure);
      assert.ok(!result.text.includes('旧列'), failure);
    }
    for (const value of ['配置.xls', '..\\QuestDiary\\配置.xls']) {
      const result = scenario('READEXCEL <$STR(S$path)> 1', { 'S$path': value }, engine);
      assert.equal(result.reads.length, 0, 'user input cannot select a file to read');
    }
    assert.equal(scenario('READEXCEL 配置.xls <$STR(N0)>', {}, engine).reads.length, 0, 'Auto zero is not a valid row');
    const idx = scenario('READEXCEL 配置.xls 1', {}, engine, { rows: [['935']], complete: true });
    assert.ok(idx.model.pages.flatMap(page => page.resolvedVariables || []).every(value => value.staticValueSource !== 'database-item-index'));
  }
  assert.equal(scenario('READEXCEL 配置.xls 1', {}, 'GEE').reads.length, 0, 'GEE cannot borrow the GOM/996PC read contract');
  console.log('preview-excel-integration.test.js: PASS');
}
if (require.main === module) run();
module.exports = { run, scenario };
