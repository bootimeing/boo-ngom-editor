const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const staticLanguage = require('../data/static-language.json');
const { ScriptDataResolver } = require('../out/utils/script-data-resolver');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

function loadProviderWithVscodeStub() {
  const originalLoad = Module._load;
  const uri = value => ({
    fsPath: value,
    path: value,
    toString() { return value; },
  });
  const vscode = {
    Uri: {
      parse: uri,
      file: uri,
      joinPath(base, ...parts) {
        return uri([base.fsPath || base.path, ...parts].join('/'));
      },
    },
    EventEmitter: class {
      constructor() { this.event = () => undefined; }
      fire() {}
      dispose() {}
    },
    Disposable: { from: () => ({ dispose() {} }) },
    workspace: {},
    window: {},
    commands: {},
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../out/providers/npc-dialog-visual');
  } finally {
    Module._load = originalLoad;
  }
}

function parseGom(text, sourceFile) {
  return parseNpcDialogDocument(text, {
    uri: `file:///${sourceFile.replaceAll('\\', '/')}`,
    fileName: path.basename(sourceFile),
    filePath: sourceFile,
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: 'GOM',
    cursorOffset: text.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });
}

function flattened(preview) {
  return (preview?.lines || []).map(line => line.map(run => run.text).join('')).join('\n');
}

async function main() {
  const { hydrateGomItemShowTooltip } = loadProviderWithVscodeStub();
  assert.equal(typeof hydrateGomItemShowTooltip, 'function',
    'the provider must expose its ItemShow tooltip hydration primitive for regression coverage');

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-itemshow-tooltip-provider-'));
  const resolver = new ScriptDataResolver();
  try {
    const sourceFile = path.join(
      temporary, 'MirServer', 'Mir200', 'Envir', 'Market_Def', 'tooltip-test.txt'
    );
    const databaseFile = path.join(temporary, 'MirServer', 'MUD2', 'db', 'herodb.DB');
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
    fs.writeFileSync(sourceFile, '[@main]\r\n#SAY\r\n', 'utf8');

    const SQL = await require('sql.js')();
    const database = new SQL.Database();
    database.run(
      'CREATE TABLE StdItems (Idx INTEGER, Name TEXT, StdMode INTEGER, Shape INTEGER, Weight INTEGER, Looks INTEGER, DuraMax INTEGER)'
    );
    database.run(
      'INSERT INTO StdItems VALUES (?, ?, ?, ?, ?, ?, ?)',
      [13, '青铜剑', 5, 7, 12, 20699, 30000]
    );
    fs.writeFileSync(databaseFile, Buffer.from(database.export()));
    database.close();
    await resolver.prepareFor(sourceFile);

    const text = [
      '[@main]',
      '#SAY',
      '<IMG:1600:0:40:50|ItemShow#13#0/@item>',
      '<IMGEX:0:1600:1601:1602:60:70|ItemShow#13#1/@title>',
      '<PLAYIMG:0:1610:10:100:80:90:0:0|ItemShow#13#0>',
    ].join('\r\n');
    const model = parseGom(text, sourceFile);
    const elements = model.pages[0].elements.filter(element => element.tooltipPreview?.kind === 'item');
    assert.equal(elements.length, 3, 'IMG, IMGEX and PLAYIMG ItemShow remarks must remain typed item tooltips');
    const originalRaw = elements.map(element => element.tooltipPreview.raw);

    const requests = [];
    const resolveField = (itemIndex, field) => {
      requests.push([itemIndex, field]);
      return resolver.resolveItemFieldByIndex(sourceFile, itemIndex, field);
    };
    hydrateGomItemShowTooltip(elements[0], resolveField);
    hydrateGomItemShowTooltip(elements[1], resolveField);
    hydrateGomItemShowTooltip(elements[2], resolveField);

    const expectedFields = ['Name', 'StdMode', 'Shape', 'Weight', 'Looks', 'DuraMax'];
    assert.deepEqual(requests, [
      ...expectedFields.map(field => [13, field]),
      ...expectedFields.map(field => [13, field]),
    ], 'only documented mode=0 item tooltips may query the StdItems row');

    for (const index of [0, 2]) {
      const element = elements[index];
      const tooltip = flattened(element.tooltipPreview);
      assert.match(tooltip, /数据库基础属性预览/);
      assert.match(tooltip, /名称 青铜剑/);
      assert.match(tooltip, /StdMode 5/);
      assert.match(tooltip, /Shape 7/);
      assert.match(tooltip, /重量 12/);
      assert.match(tooltip, /Looks 20699/);
      assert.match(tooltip, /持久上限 30000/);
      assert.match(tooltip, /运行时极品|鉴定|强化/,
        'static database fields must not claim runtime unique attributes');
      assert.equal(element.tooltipPreview.raw, originalRaw[index],
        'hydration must preserve the parser-owned raw tooltip');
      assert.equal(element.tooltipPreview.itemIndex, 13);
      assert.equal(element.tooltipPreview.itemMode, 0);
    }

    assert.equal(flattened(elements[1].tooltipPreview), '物品 IDX 13 · 模式 1',
      'mode=1 must retain the evidence-bounded placeholder instead of borrowing StdItems fields');
    assert.match(elements[1].warning || '', /Evidence-blocked.*称号.*未公开|未公开.*称号/i);

    const missing = parseGom([
      '[@main]', '#SAY', '<IMG:1600:0:0:0|ItemShow#9999#0>',
    ].join('\r\n'), sourceFile).pages[0].elements.find(element => element.tooltipPreview?.kind === 'item');
    hydrateGomItemShowTooltip(missing, resolveField);
    assert.match(missing.warning || '', /Environment-blocked.*9999.*数据库|数据库.*9999/i,
      'a missing workspace row is an environment boundary, not a successful full tooltip');
  } finally {
    resolver.dispose();
    removeTemporaryDirectory(temporary);
  }
  console.log('itemshow-tooltip-provider.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
