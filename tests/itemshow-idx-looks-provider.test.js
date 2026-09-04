const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

const staticLanguage = require('../data/static-language.json');
const { ScriptDataResolver } = require('../out/utils/script-data-resolver');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

function loadProviderInternals() {
  const fileName = require.resolve('../out/providers/npc-dialog-visual');
  const source = fs.readFileSync(fileName, 'utf8')
    + '\nmodule.exports.__NpcDialogVisualEditorManager = NpcDialogVisualEditorManager;\n';
  const uri = value => ({
    fsPath: value,
    path: value,
    scheme: 'file',
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
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const testModule = new Module(fileName, module);
    testModule.filename = fileName;
    testModule.paths = Module._nodeModulePaths(path.dirname(fileName));
    testModule._compile(source, fileName);
    return testModule.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function parseEngine(engine, text, sourceFile, dataOptions) {
  return parseNpcDialogDocument(text, {
    uri: `file:///${sourceFile.replaceAll('\\', '/')}`,
    fileName: path.basename(sourceFile),
    filePath: sourceFile,
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: text.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
    dataOptions,
  });
}

function parseGom(text, sourceFile, dataOptions) {
  return parseEngine('GOM', text, sourceFile, dataOptions);
}

function itemElement(model) {
  const item = model.pages[0].elements.find(element => element.statementId === 'item-show');
  assert.ok(item, 'the GOM ITEMSHOW fixture must produce a typed item element');
  return item;
}

function itemLayer(element) {
  return (element.assetLayers || []).find(layer => layer.role === 'item');
}

async function hydrateWithFakeCache(
  model,
  sourceFile,
  resolver,
  cacheReady,
  expectedItem = { archiveName: 'Items2', imageIndex: 34 }
) {
  const { __NpcDialogVisualEditorManager: Manager } = loadProviderInternals();
  assert.equal(typeof Manager, 'function');
  const manager = Object.create(Manager.prototype);
  const databaseRequests = [];
  const assetRequests = [];
  manager.scriptDataResolver = {
    resolveItemFieldByIndex(fileName, itemIndex, field, engine) {
      databaseRequests.push({ fileName, itemIndex, field, engine });
      return resolver.resolveItemFieldByIndex(fileName, itemIndex, field, engine);
    },
    resolveItemFieldByName() { return undefined; },
  };
  manager.resolveAsset = reference => {
    assetRequests.push({ ...reference });
    const isExpectedItem = reference.archiveName === expectedItem.archiveName
      && reference.imageIndex === expectedItem.imageIndex;
    return isExpectedItem && cacheReady
      ? {
        status: 'ready',
        url: 'vscode-resource:/Items2/000034.png',
        archiveLabel: 'Items2/000034',
        width: 35,
        height: 35,
        offsetX: 0,
        offsetY: 0,
      }
      : {
        status: 'missing',
        archiveLabel: `${reference.archiveName || 'frame'}/${reference.imageIndex}`,
        message: 'fixture cache miss',
      };
  };
  await manager.hydrateAssets(model, {}, { fileName: sourceFile });
  return { databaseRequests, assetRequests };
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-itemshow-idx-looks-'));
  const resolver = new ScriptDataResolver();
  try {
    const sourceFile = path.join(
      temporary, 'MirServer', 'Mir200', 'Envir', 'Market_Def', 'itemshow-idx.txt'
    );
    const databaseFile = path.join(temporary, 'MirServer', 'MUD2', 'db', 'herodb.DB');
    const cfgItemFile = path.join(
      temporary, 'MirServer', 'Mir200', 'Envir', 'Data', 'cfg_item.xls'
    );
    const ignoredCfgItemXlsxFile = path.join(
      temporary, 'MirServer', 'Mir200', 'Envir', 'Data', 'cfg_item.xlsx'
    );
    fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
    fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
    fs.writeFileSync(sourceFile, '[@main]\r\n#SAY\r\n', 'utf8');

    const SQL = await require('sql.js')();
    const duplicateResolver = new ScriptDataResolver();
    try {
      const duplicateGomSource = path.join(
        temporary, 'DuplicateGom', 'Mir200', 'Envir', 'Market_Def', 'duplicate.txt'
      );
      const duplicateGomDatabase = path.join(
        temporary, 'DuplicateGom', 'MUD2', 'db', 'herodb.DB'
      );
      fs.mkdirSync(path.dirname(duplicateGomSource), { recursive: true });
      fs.mkdirSync(path.dirname(duplicateGomDatabase), { recursive: true });
      fs.writeFileSync(duplicateGomSource, '[@main]\r\n#SAY\r\n', 'utf8');
      const duplicateSqlite = new SQL.Database();
      duplicateSqlite.run('CREATE TABLE StdItems (Idx INTEGER, Name TEXT, Looks INTEGER)');
      duplicateSqlite.run('INSERT INTO StdItems VALUES (935, \'重复索引一\', 20034)');
      duplicateSqlite.run('INSERT INTO StdItems VALUES (935, \'重复索引二\', 30034)');
      duplicateSqlite.run('INSERT INTO StdItems VALUES (936, \'重复名称\', 20035)');
      duplicateSqlite.run('INSERT INTO StdItems VALUES (937, \'重复名称\', 30035)');
      fs.writeFileSync(duplicateGomDatabase, Buffer.from(duplicateSqlite.export()));
      duplicateSqlite.close();
      await duplicateResolver.prepareFor(duplicateGomSource, 'GOM');
      assert.equal(
        duplicateResolver.resolveItemFieldByIndex(duplicateGomSource, 935, 'Looks', 'GOM'),
        undefined,
        'a duplicate SQLite StdItems IDX must be rejected instead of selecting its first row'
      );
      assert.equal(
        duplicateResolver.resolveItemFieldByName(duplicateGomSource, '重复名称', 'IDX', 'GOM'),
        undefined,
        'a duplicate SQLite item name must not grant an arbitrary database IDX capability'
      );

      const duplicatePcSource = path.join(
        temporary, 'Duplicate996', 'Mir200', 'Envir', 'Market_Def', 'duplicate.txt'
      );
      const duplicatePcDatabase = path.join(
        temporary, 'Duplicate996', 'Mir200', 'Envir', 'Data', 'cfg_item.xls'
      );
      fs.mkdirSync(path.dirname(duplicatePcSource), { recursive: true });
      fs.mkdirSync(path.dirname(duplicatePcDatabase), { recursive: true });
      fs.writeFileSync(duplicatePcSource, '[@main]\r\n#SAY\r\n', 'utf8');
      const duplicateWorkbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(duplicateWorkbook, XLSX.utils.aoa_to_sheet([
        ['//;version=1'],
        [],
        ['Idx', 'Name', 'Looks'],
        [935, '重复索引一', 20034],
        [935, '重复索引二', 30034],
      ]), 'cfg_item');
      XLSX.writeFile(duplicateWorkbook, duplicatePcDatabase, { bookType: 'biff8' });
      await duplicateResolver.prepareFor(duplicatePcSource, '996PC');
      assert.equal(
        duplicateResolver.resolveItemFieldByIndex(duplicatePcSource, 935, 'Looks', '996PC'),
        undefined,
        'a duplicate cfg_item IDX must be rejected instead of selecting its first row'
      );

      const xlsxOnlySource = path.join(
        temporary, 'XlsxOnly996', 'Mir200', 'Envir', 'Market_Def', 'xlsx-only.txt'
      );
      const xlsxOnlyDatabase = path.join(
        temporary, 'XlsxOnly996', 'Mir200', 'Envir', 'Data', 'cfg_item.xlsx'
      );
      fs.mkdirSync(path.dirname(xlsxOnlySource), { recursive: true });
      fs.mkdirSync(path.dirname(xlsxOnlyDatabase), { recursive: true });
      fs.writeFileSync(xlsxOnlySource, '[@main]\r\n#SAY\r\n', 'utf8');
      const xlsxOnlyWorkbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(xlsxOnlyWorkbook, XLSX.utils.aoa_to_sheet([
        ['//;version=1'],
        [],
        ['Idx', 'Name', 'Looks'],
        [935, '传送戒指', 40031],
      ]), 'cfg_item');
      XLSX.writeFile(xlsxOnlyWorkbook, xlsxOnlyDatabase, { bookType: 'xlsx' });
      await duplicateResolver.prepareFor(xlsxOnlySource, '996PC');
      assert.equal(
        duplicateResolver.resolveItemFieldByIndex(xlsxOnlySource, 935, 'Looks', '996PC'),
        undefined,
        '996PC must not treat an xlsx conversion as its authoritative cfg_item.xls'
      );
    } finally {
      duplicateResolver.dispose();
    }

    const database = new SQL.Database();
    database.run('CREATE TABLE StdItems (Idx INTEGER, Name TEXT, Looks INTEGER)');
    database.run('INSERT INTO StdItems VALUES (?, ?, ?)', [935, '传送戒指', 20034]);
    database.run('INSERT INTO StdItems VALUES (?, ?, ?)', [9, '索引九', 9]);
    database.run('INSERT INTO StdItems VALUES (?, ?, ?)', [35, '索引三十五', 35]);
    database.run('INSERT INTO StdItems VALUES (?, ?, ?)', [1, '槽位一', 1]);
    database.run('INSERT INTO StdItems VALUES (?, ?, ?)', [936, '经典边界', 65534]);
    database.run('INSERT INTO StdItems VALUES (?, ?, ?)', [937, '经典越界', 65535]);
    database.run('INSERT INTO StdItems VALUES (?, ?, ?)', [938, '跨包越界', 70000]);
    database.run('INSERT INTO StdItems VALUES (?, ?, ?)', [939, '九包边界', 99999]);
    fs.writeFileSync(databaseFile, Buffer.from(database.export()));
    database.close();
    fs.mkdirSync(path.dirname(cfgItemFile), { recursive: true });
    const cfgWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(cfgWorkbook, XLSX.utils.aoa_to_sheet([
      ['//;version=1'],
      [],
      ['Idx', 'Name', 'Looks'],
      [935, '传送戒指', 30031],
      [939, '九包边界', 99999],
    ]), 'cfg_item');
    XLSX.writeFile(cfgWorkbook, cfgItemFile, { bookType: 'biff8' });
    const ignoredXlsxWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(ignoredXlsxWorkbook, XLSX.utils.aoa_to_sheet([
      ['//;version=1'],
      [],
      ['Idx', 'Name', 'Looks'],
      [935, '传送戒指', 40031],
    ]), 'cfg_item');
    XLSX.writeFile(ignoredXlsxWorkbook, ignoredCfgItemXlsxFile, { bookType: 'xlsx' });
    const stableDatabaseTime = new Date(1_700_000_000_000);
    fs.utimesSync(databaseFile, stableDatabaseTime, stableDatabaseTime);

    await resolver.prepareFor(sourceFile, 'GOM');
    assert.equal(resolver.resolveItemFieldByIndex(sourceFile, 935, 'Looks', 'GOM'), '20034',
      'GOM must select HeroDB rather than a residual 996PC cfg_item.xls');
    await resolver.prepareFor(sourceFile, '996PC');
    assert.equal(resolver.resolveItemFieldByIndex(sourceFile, 935, 'Looks', '996PC'), '30031',
      '996PC must select cfg_item.xls rather than a residual GOM/GEE HeroDB');

    const originalDatabaseBytes = fs.readFileSync(databaseFile);
    const originalDatabaseStat = fs.statSync(databaseFile);
    const replacementDatabase = new SQL.Database(Uint8Array.from(originalDatabaseBytes));
    replacementDatabase.run('UPDATE StdItems SET Looks = 30034 WHERE Idx = 935');
    const replacementDatabaseBytes = Buffer.from(replacementDatabase.export());
    replacementDatabase.close();
    assert.equal(replacementDatabaseBytes.length, originalDatabaseBytes.length,
      'same-stat database fixture must preserve file size');
    fs.writeFileSync(databaseFile, replacementDatabaseBytes);
    fs.utimesSync(databaseFile, originalDatabaseStat.atime, originalDatabaseStat.mtime);
    const replacementDatabaseStat = fs.statSync(databaseFile);
    assert.equal(replacementDatabaseStat.size, originalDatabaseStat.size);
    assert.equal(replacementDatabaseStat.mtimeMs, originalDatabaseStat.mtimeMs,
      'same-stat database fixture must restore the original mtime exactly');
    await resolver.prepareFor(sourceFile, 'GOM');
    assert.equal(resolver.resolveItemFieldByIndex(sourceFile, 935, 'Looks', 'GOM'), '30034',
      'same-size/same-mtime HeroDB replacement must invalidate the cached Looks value');
    fs.writeFileSync(databaseFile, originalDatabaseBytes);
    fs.utimesSync(databaseFile, originalDatabaseStat.atime, originalDatabaseStat.mtime);
    await resolver.prepareFor(sourceFile, 'GOM');
    assert.equal(resolver.resolveItemFieldByIndex(sourceFile, 935, 'Looks', 'GOM'), '20034',
      'restoring the original HeroDB bytes must invalidate the replacement cache');

    const conflictingLegacyFile = path.join(
      temporary, 'MirServer', 'MUD2', 'db', 'a-stale-item-backup.db'
    );
    const conflictingDatabase = new SQL.Database();
    conflictingDatabase.run('CREATE TABLE StdItems (Idx INTEGER, Name TEXT, Looks INTEGER)');
    conflictingDatabase.run(
      'INSERT INTO StdItems VALUES (?, ?, ?)',
      [935, '冲突索引记录', 40031]
    );
    conflictingDatabase.run(
      'INSERT INTO StdItems VALUES (?, ?, ?)',
      [934, '传送戒指', 40030]
    );
    fs.writeFileSync(conflictingLegacyFile, Buffer.from(conflictingDatabase.export()));
    conflictingDatabase.close();
    await resolver.prepareFor(sourceFile, 'GOM');
    assert.equal(resolver.resolveItemFieldByIndex(sourceFile, 935, 'Looks', 'GOM'), undefined,
      'conflicting GOM databases must not select a Looks value by filename order');
    assert.equal(resolver.resolveItemFieldByName(sourceFile, '传送戒指', 'IDX', 'GOM'), undefined,
      'conflicting GOM databases must not grant an IDX capability by filename order');
    fs.unlinkSync(conflictingLegacyFile);
    await resolver.prepareFor(sourceFile, 'GOM');
    assert.equal(resolver.resolveItemFieldByIndex(sourceFile, 935, 'Looks', 'GOM'), '20034',
      'removing the conflicting database must restore the single proven GOM Looks value');
    await resolver.prepareFor(sourceFile, 'GEE');
    const databaseDerivedSource = [
      '[@main]',
      '#ACT',
      'GETDBITEMFIELDVALUE 传送戒指 IDX N$展示IDX1',
      '#SAY',
      '<&ITEMSHOW:<$STR(N$展示IDX1)>:20:320:116:48>',
    ].join('\r\n');
    const readyModel = parseGom(
      databaseDerivedSource,
      sourceFile,
      resolver.optionsFor(sourceFile, 'GOM')
    );
    const readyItem = itemElement(readyModel);
    assert.equal(readyItem.itemPreview.itemIndex, 935,
      'a complete GETDBITEMFIELDVALUE IDX result must remain a deterministic database index');
    assert.equal(readyItem.itemPreview.dynamicFields?.includes('itemid') || false, false,
      'a database-proven IDX must not be downgraded to a generic runtime itemid');
    assert.equal(
      readyModel.pages[0].resolvedVariables.find(variable => variable.name === 'N$展示IDX1')?.staticValueSource,
      'database-item-index',
      'the resolved IDX needs exact database-item-index provenance instead of a generic database field'
    );

    const ready = await hydrateWithFakeCache(readyModel, sourceFile, resolver, true);
    assert.deepEqual(
      ready.databaseRequests.filter(request => request.field === 'Looks'),
      [{ fileName: sourceFile, itemIndex: 935, field: 'Looks', engine: 'GOM' }],
      'Provider must query Looks by the resolved StdItems IDX before requesting pixels'
    );
    assert.deepEqual(itemLayer(readyItem)?.assetRef, { archiveName: 'Items2', imageIndex: 34 },
      'Looks 20034 must map to Items2 image 34');
    assert.equal(itemLayer(readyItem)?.asset?.status, 'ready',
      'a cached Items2/000034 image must be attached to the item layer');
    assert.equal(
      ready.assetRequests.some(reference => reference.archiveName === 'Items' && reference.imageIndex === 935),
      false,
      'the database IDX must never be used directly as an Items image index'
    );

    const missingModel = parseGom(
      databaseDerivedSource,
      sourceFile,
      resolver.optionsFor(sourceFile, 'GOM')
    );
    const missingItem = itemElement(missingModel);
    const missing = await hydrateWithFakeCache(missingModel, sourceFile, resolver, false);
    assert.deepEqual(itemLayer(missingItem)?.assetRef, { archiveName: 'Items2', imageIndex: 34 });
    assert.equal(itemLayer(missingItem)?.asset?.status, 'missing',
      'a cache miss must preserve the correct Looks-derived request and report missing pixels');
    assert.equal(
      missing.assetRequests.some(reference => reference.archiveName === 'Items' && reference.imageIndex === 935),
      false,
      'a cache miss must not fall back to treating IDX as the image index'
    );

    const literalSource = [
      '[@main]',
      '#SAY',
      '<&ITEMSHOW:935:1:320:116:48>',
    ].join('\r\n');
    const literalModel = parseGom(literalSource, sourceFile, resolver.optionsFor(sourceFile, 'GOM'));
    const literalItem = itemElement(literalModel);
    const literal = await hydrateWithFakeCache(literalModel, sourceFile, resolver, true);
    assert.equal(literalItem.itemPreview.itemIndex, 935,
      'a direct literal ITEMSHOW IDX must remain eligible for the database lookup');
    assert.deepEqual(
      literal.databaseRequests.filter(request => request.field === 'Looks'),
      [{ fileName: sourceFile, itemIndex: 935, field: 'Looks', engine: 'GOM' }],
      'a direct literal IDX must use the same IDX -> Looks Provider path'
    );
    assert.deepEqual(itemLayer(literalItem)?.assetRef, { archiveName: 'Items2', imageIndex: 34 });

    const compositeCases = [
      {
        name: 'two database IDX values concatenated together',
        actions: [
          'GETDBITEMFIELDVALUE 索引九 IDX N$索引九',
          'GETDBITEMFIELDVALUE 索引三十五 IDX N$索引三十五',
        ],
        expression: '<$STR(N$索引九)><$STR(N$索引三十五)>',
      },
      {
        name: 'a literal prefix plus one database IDX value',
        actions: ['GETDBITEMFIELDVALUE 索引三十五 IDX N$索引三十五'],
        expression: '9<$STR(N$索引三十五)>',
      },
      {
        name: 'a nested variable slot selected by a database IDX value',
        actions: [
          'GETDBITEMFIELDVALUE 槽位一 IDX N$槽位',
          'MOV N1 935',
        ],
        expression: '<$STR(N<$STR(N$槽位)>)>',
      },
    ];
    for (const compositeCase of compositeCases) {
      const source = [
        '[@main]',
        '#ACT',
        ...compositeCase.actions,
        '#SAY',
        `<&ITEMSHOW:${compositeCase.expression}:1:320:116:48>`,
      ].join('\r\n');
      const model = parseGom(source, sourceFile, resolver.optionsFor(sourceFile, 'GOM'));
      const item = itemElement(model);
      assert.equal(item.itemPreview.itemIndex, undefined,
        `${compositeCase.name} must not synthesize a privileged database IDX`);
      assert.equal(item.itemPreview.dynamicFields?.includes('itemid'), true,
        `${compositeCase.name} must retain the source-side dynamic itemid gate`);
      const hydrated = await hydrateWithFakeCache(model, sourceFile, resolver, true);
      assert.equal(hydrated.databaseRequests.length, 0,
        `${compositeCase.name} must not start an IDX -> Looks Provider lookup`);
      assert.equal(itemLayer(item), undefined,
        `${compositeCase.name} must not create a Looks-derived item layer`);
    }

    const ordinaryMovSource = [
      '[@main]',
      '#ACT',
      'MOV N$展示IDX1 935',
      '#SAY',
      '<&ITEMSHOW:<$STR(N$展示IDX1)>:20:320:116:48>',
    ].join('\r\n');
    const movModel = parseGom(
      ordinaryMovSource,
      sourceFile,
      resolver.optionsFor(sourceFile, 'GOM')
    );
    const movItem = itemElement(movModel);
    assert.equal(movItem.itemPreview.itemIndex, undefined,
      'an ordinary MOV snapshot must remain unavailable to the resource channel');
    assert.equal(movItem.itemPreview.dynamicFields?.includes('itemid'), true);
    const mov = await hydrateWithFakeCache(movModel, sourceFile, resolver, true);
    assert.equal(mov.databaseRequests.length, 0,
      'Provider must not query the database for an unqualified MOV snapshot');
    assert.equal(itemLayer(movItem), undefined,
      'an unqualified MOV snapshot must not create an item image layer');

    const looksFieldSource = [
      '[@main]',
      '#ACT',
      'GETDBITEMFIELDVALUE 传送戒指 Looks N$展示IDX1',
      '#SAY',
      '<&ITEMSHOW:<$STR(N$展示IDX1)>:20:320:116:48>',
    ].join('\r\n');
    const looksFieldModel = parseGom(
      looksFieldSource,
      sourceFile,
      resolver.optionsFor(sourceFile, 'GOM')
    );
    const looksFieldItem = itemElement(looksFieldModel);
    assert.equal(
      looksFieldModel.pages[0].resolvedVariables.find(variable => variable.name === 'N$展示IDX1')?.staticValueSource,
      undefined,
      'GETDBITEMFIELDVALUE Looks must not carry database-item-index provenance'
    );
    assert.equal(looksFieldItem.itemPreview.itemIndex, undefined,
      'a database Looks value must never be reinterpreted as an ITEMSHOW IDX');
    assert.equal(looksFieldItem.itemPreview.dynamicFields?.includes('itemid'), true);
    const looksField = await hydrateWithFakeCache(looksFieldModel, sourceFile, resolver, true);
    assert.equal(looksField.databaseRequests.length, 0,
      'a Looks-field value in the itemid slot must not start another IDX -> Looks lookup');
    assert.equal(itemLayer(looksFieldItem), undefined,
      'a Looks-field value in the itemid slot must not create an item image layer');

    const copiedIndexSource = [
      '[@main]',
      '#ACT',
      'GETDBITEMFIELDVALUE 传送戒指 IDX N$数据库IDX',
      'MOV N$展示IDX1 <$STR(N$数据库IDX)>',
      '#SAY',
      '<&ITEMSHOW:<$STR(N$展示IDX1)>:20:320:116:48>',
    ].join('\r\n');
    const copiedIndexModel = parseGom(
      copiedIndexSource,
      sourceFile,
      resolver.optionsFor(sourceFile, 'GOM')
    );
    const copiedIndexItem = itemElement(copiedIndexModel);
    assert.equal(
      copiedIndexModel.pages[0].resolvedVariables.find(variable => variable.name === 'N$展示IDX1')?.staticValueSource,
      undefined,
      'MOV copy must clear the database-item-index provenance marker'
    );
    assert.equal(copiedIndexItem.itemPreview.itemIndex, undefined,
      'MOV copy must not propagate the database-item-index resource capability');
    assert.equal(copiedIndexItem.itemPreview.dynamicFields?.includes('itemid'), true);

    for (const mutation of [
      'INC N$展示IDX1 0',
      'DEC N$展示IDX1 0',
      'MUL N$展示IDX1 1',
      'DIV N$展示IDX1 935 1',
    ]) {
      const mutatedIndexSource = [
        '[@main]',
        '#ACT',
        'GETDBITEMFIELDVALUE 传送戒指 IDX N$展示IDX1',
        mutation,
        '#SAY',
        '<&ITEMSHOW:<$STR(N$展示IDX1)>:20:320:116:48>',
      ].join('\r\n');
      const mutatedIndexModel = parseGom(
        mutatedIndexSource,
        sourceFile,
        resolver.optionsFor(sourceFile, 'GOM')
      );
      const mutatedIndexItem = itemElement(mutatedIndexModel);
      assert.equal(
        mutatedIndexModel.pages[0].resolvedVariables.find(
          variable => variable.name === 'N$展示IDX1'
        )?.staticValueSource,
        undefined,
        `${mutation.split(' ')[0]} must clear the database-item-index provenance marker`
      );
      assert.equal(mutatedIndexItem.itemPreview.itemIndex, undefined,
        `${mutation.split(' ')[0]} must block the database item resource channel`);
      assert.equal(mutatedIndexItem.itemPreview.dynamicFields?.includes('itemid'), true);
    }

    const overwrittenIndexSource = [
      '[@main]',
      '#ACT',
      'GETDBITEMFIELDVALUE 传送戒指 IDX N$展示IDX1',
      'MOV N$展示IDX1 935',
      '#SAY',
      '<&ITEMSHOW:<$STR(N$展示IDX1)>:20:320:116:48>',
    ].join('\r\n');
    const overwrittenIndexModel = parseGom(
      overwrittenIndexSource,
      sourceFile,
      resolver.optionsFor(sourceFile, 'GOM')
    );
    const overwrittenIndexItem = itemElement(overwrittenIndexModel);
    assert.equal(
      overwrittenIndexModel.pages[0].resolvedVariables.find(variable => variable.name === 'N$展示IDX1')?.staticValueSource,
      undefined,
      'a later MOV must clear an earlier database-item-index provenance marker'
    );
    assert.equal(overwrittenIndexItem.itemPreview.itemIndex, undefined,
      'a later MOV value must not retain an earlier GETDBITEMFIELDVALUE IDX capability');
    assert.equal(overwrittenIndexItem.itemPreview.dynamicFields?.includes('itemid'), true);

    const dynamicSource = [
      '[@main]',
      '#ACT',
      'GETDBITEMFIELDVALUE 传送戒指 IDX N$展示IDX1',
      'MOV N$素材来源 0',
      '#SAY',
      '<&ITEMSHOW:<$STR(N$展示IDX1)>:1:320:116:48:0:0:40:0:<$STR(N$素材来源)>:0>',
    ].join('\r\n');
    const dynamicSourceModel = parseGom(
      dynamicSource,
      sourceFile,
      resolver.optionsFor(sourceFile, 'GOM')
    );
    const dynamicSourceItem = itemElement(dynamicSourceModel);
    assert.equal(dynamicSourceItem.itemPreview.itemIndex, 935,
      'the independently proven IDX should remain available when only source is dynamic');
    assert.equal(dynamicSourceItem.itemPreview.dynamicFields?.includes('source'), true);
    const dynamicSourceHydration = await hydrateWithFakeCache(
      dynamicSourceModel,
      sourceFile,
      resolver,
      true
    );
    assert.ok(dynamicSourceHydration.databaseRequests.some(request => (
      request.itemIndex === 935 && request.field === 'Looks'
    )), 'the proven IDX may still resolve Looks before the independent source gate');
    assert.equal(itemLayer(dynamicSourceItem), undefined,
      'a dynamic Items/StdItem source switch must block the item image layer');
    assert.equal(dynamicSourceHydration.assetRequests.some(reference => (
      /^Items2$|^StdItem2$/i.test(reference.archiveName || '') && reference.imageIndex === 34
    )), false, 'a dynamic source switch must not request either possible item archive');

    const gomBoundarySource = ['[@main]', '#SAY', '<&ITEMSHOW:936:1:10:20:48>'].join('\r\n');
    const gomBoundaryModel = parseGom(
      gomBoundarySource,
      sourceFile,
      resolver.optionsFor(sourceFile, 'GOM')
    );
    const gomBoundaryItem = itemElement(gomBoundaryModel);
    await hydrateWithFakeCache(
      gomBoundaryModel,
      sourceFile,
      resolver,
      true,
      { archiveName: 'Items6', imageIndex: 5534 }
    );
    assert.deepEqual(itemLayer(gomBoundaryItem)?.assetRef, {
      archiveName: 'Items6',
      imageIndex: 5534,
    }, 'GOM Looks 65534 must remain the inclusive Items6 boundary');

    for (const [itemIndex, forbiddenArchive, forbiddenImage] of [
      [937, 'Items6', 5535],
      [938, 'Items7', 0],
    ]) {
      const source = ['[@main]', '#SAY', `<&ITEMSHOW:${itemIndex}:1:10:20:48>`].join('\r\n');
      const model = parseGom(source, sourceFile, resolver.optionsFor(sourceFile, 'GOM'));
      const item = itemElement(model);
      const hydrated = await hydrateWithFakeCache(
        model,
        sourceFile,
        resolver,
        true,
        { archiveName: forbiddenArchive, imageIndex: forbiddenImage }
      );
      assert.equal(itemLayer(item), undefined,
        `GOM IDX ${itemIndex} has an out-of-profile Looks value and must not create an item layer`);
      assert.equal(hydrated.assetRequests.some(reference => (
        reference.archiveName === forbiddenArchive && reference.imageIndex === forbiddenImage
      )), false, `GOM must not request unsupported ${forbiddenArchive}/${forbiddenImage}`);
      assert.match(item.itemPreview.message || '', /0-65534/,
        'the GOM boundary diagnostic must name the evidenced Looks range');
    }

    const geeOutOfRangeSource = [
      '[@main]',
      '#SAY',
      '<&ITEMSHOW:938:1:10:20:48:0:0:0/@查看>',
    ].join('\r\n');
    const geeOutOfRangeModel = parseEngine(
      'GEE',
      geeOutOfRangeSource,
      sourceFile,
      resolver.optionsFor(sourceFile, 'GEE')
    );
    const geeOutOfRangeItem = itemElement(geeOutOfRangeModel);
    const geeOutOfRange = await hydrateWithFakeCache(
      geeOutOfRangeModel,
      sourceFile,
      resolver,
      true,
      { archiveName: 'Items7', imageIndex: 0 }
    );
    assert.equal(itemLayer(geeOutOfRangeItem), undefined,
      'GEE/LFM Looks 70000 must not borrow the 996PC Items7 range');
    assert.equal(geeOutOfRange.assetRequests.some(reference => (
      reference.archiveName === 'Items7' && reference.imageIndex === 0
    )), false, 'GEE/LFM must not request Items7');
    assert.equal(geeOutOfRange.databaseRequests.some(request => request.engine === 'GEE'), true,
      'Provider must carry the active GEE engine into its database lookup');
    assert.match(geeOutOfRangeItem.itemPreview.message || '', /0-65534/);

    const pcBoundarySource = [
      '[@main]',
      '#SAY',
      '<ItemShow|id=4|x=10|y=20|itemid=939|itemcount=1|bgtype=1>',
    ].join('\r\n');
    const pcBoundaryModel = parseEngine(
      '996PC',
      pcBoundarySource,
      sourceFile,
      resolver.optionsFor(sourceFile, '996PC')
    );
    const pcBoundaryItem = pcBoundaryModel.pages[0].elements.find(element => (
      element.statementId === 'newui-itemshow-996pc'
    ));
    assert.ok(pcBoundaryItem, '996PC ItemShow boundary fixture must parse');
    const pcBoundaryHydration = await hydrateWithFakeCache(
      pcBoundaryModel,
      sourceFile,
      resolver,
      true,
      { archiveName: 'Items9', imageIndex: 9999 }
    );
    assert.equal(pcBoundaryHydration.databaseRequests.some(request => request.engine === '996PC'), true,
      'Provider must carry the active 996PC engine into its cfg_item lookup');
    assert.deepEqual(itemLayer(pcBoundaryItem)?.assetRef, {
      archiveName: 'Items9',
      imageIndex: 9999,
    }, '996PC Looks 99999 must retain its documented Items9 extension');
  } finally {
    resolver.dispose();
    removeTemporaryDirectory(temporary);
  }
  console.log('itemshow-idx-looks-provider.test.js: PASS');
}

main().catch(error => {
  console.error('itemshow-idx-looks-provider.test.js: RED FAILURE');
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
