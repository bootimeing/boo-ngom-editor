const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const initSqlJs = require('sql.js');
  const { DatabaseBrowserSession } = require('../out/utils/database-browser');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-db-browser-'));
  const dbPath = path.join(tempDir, 'fixture.db');
  let session;

  try {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE Magic (Idx INTEGER, MagName TEXT)');
    db.run('CREATE TABLE Monster (Idx INTEGER, Name TEXT)');
    db.run('CREATE TABLE StdItems (Idx INTEGER, Name TEXT, StdMode INTEGER, Price INTEGER, Color INTEGER, OverLap INTEGER, Expand1 INTEGER)');
    db.run('BEGIN TRANSACTION');
    const insertItem = db.prepare('INSERT INTO StdItems VALUES (?, ?, ?, ?, ?, ?, ?)');
    const stdModes = [5, 6, 10, 19, 24, 22];
    const overlaps = [0, 2, 3, 4, 5, 6, 7];
    for (let index = 0; index < 5000; index++) {
      insertItem.run([
        index,
        `Item${String(index).padStart(5, '0')}`,
        stdModes[index % stdModes.length],
        index * 10,
        249,
        overlaps[index % overlaps.length],
        index % 14,
      ]);
    }
    insertItem.free();
    db.run("INSERT INTO Monster VALUES (1, '稻草人')");
    db.run("INSERT INTO Magic VALUES (1, '火球术')");
    db.run('COMMIT');
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
    db.close();

    session = new DatabaseBrowserSession(tempDir);
    const catalog = await session.initialize();
    assert.deepEqual(
      catalog.tables.map(table => table.label),
      ['物品数据库', '怪物数据库', '技能数据库'],
      'database tabs must use the expected item, monster, skill order'
    );
    const itemsTable = catalog.tables.find(table => table.name === 'StdItems');
    assert.ok(itemsTable, 'StdItems metadata should be available');
    assert.equal(itemsTable.rowCount, 5000);
    assert.deepEqual(itemsTable.columns, ['Idx', 'Name', 'StdMode', 'Price', 'Color', 'OverLap', 'Expand1']);
    assert.equal(itemsTable.editable, true, 'ordinary SQLite tables should be editable');
    assert.equal(itemsTable.columnTypes.Price, 'INTEGER');

    const firstPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 100,
      query: '',
      sortColumn: '',
      sortDirection: 'asc',
    });
    assert.equal(firstPage.rows.length, 100, 'only one page may be returned');
    assert.equal(firstPage.total, 5000);
    assert.ok(Number(firstPage.rows[0].__booRowId) > 0, 'editable rows need a stable internal row id');
    assert.ok(Buffer.byteLength(JSON.stringify(firstPage)) < 200000, 'page payload must stay bounded');

    const batchUpdate = await session.updateRows(itemsTable.id, [
      { rowId: firstPage.rows[0].__booRowId, values: { Price: 1111, Color: 250 } },
      { rowId: firstPage.rows[1].__booRowId, values: { Price: 2222, Color: 251 } },
    ]);
    assert.equal(batchUpdate.operation, 'update');
    assert.ok(fs.existsSync(batchUpdate.backupPath), 'a rectangular edit must create one database backup');
    const batchPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 20,
      query: 'Item0000',
      searchColumn: 'Name',
      matchMode: 'contains',
      sortColumn: 'Idx',
      sortDirection: 'asc',
    });
    assert.deepEqual(batchPage.rows.slice(0, 2).map(row => row.Price), [1111, 2222]);
    const undoBatch = await session.undoLastMutation();
    assert.equal(undoBatch.revertedOperation, 'update', 'the whole rectangular edit must be one undo entry');
    const restoredBatchPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 20,
      query: 'Item0000',
      searchColumn: 'Name',
      matchMode: 'contains',
      sortColumn: 'Idx',
      sortDirection: 'asc',
    });
    assert.deepEqual(restoredBatchPage.rows.slice(0, 2).map(row => row.Price), [0, 10]);
    await assert.rejects(
      session.updateRows(itemsTable.id, [
        { rowId: firstPage.rows[0].__booRowId, values: { Price: 9999 } },
        { rowId: 999999999, values: { Price: 8888 } },
      ]),
      /不存在|修改/
    );
    const atomicBatchPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 20,
      query: 'Item00000',
      searchColumn: 'Name',
      matchMode: 'exact',
      sortColumn: '',
      sortDirection: 'asc',
    });
    assert.equal(atomicBatchPage.rows[0].Price, 0, 'a failed rectangular edit must roll back every row');

    const searchPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 100,
      query: 'Item04999',
      sortColumn: '',
      sortDirection: 'asc',
    });
    assert.equal(searchPage.total, 1);
    assert.equal(searchPage.rows[0].Name, 'Item04999');

    const exactPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 100,
      query: '100',
      searchColumn: 'Price',
      matchMode: 'exact',
      sortColumn: '',
      sortDirection: 'asc',
    });
    assert.equal(exactPage.total, 1);
    assert.equal(exactPage.rows[0].Name, 'Item00010');

    const sortedPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 50,
      query: '',
      sortColumn: 'Name',
      sortDirection: 'desc',
    });
    assert.equal(sortedPage.rows[0].Name, 'Item04999');
    assert.equal(sortedPage.rows.length, 50);

    const weaponPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 100,
      query: '',
      filterColumn: 'StdMode',
      filterValues: [5, 6],
      sortColumn: 'Idx',
      sortDirection: 'asc',
    });
    assert.equal(weaponPage.total, 1668, 'multi-value StdMode filters must apply to the full table');
    assert.ok(weaponPage.rows.every(row => row.StdMode === 5 || row.StdMode === 6));

    const namedWeaponPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 100,
      query: 'Item0000',
      searchColumn: 'Name',
      matchMode: 'contains',
      filterColumn: 'StdMode',
      filterValues: [5, 6],
      sortColumn: 'Idx',
      sortDirection: 'asc',
    });
    assert.equal(namedWeaponPage.total, 4, 'StdMode and keyword filters must combine with AND');
    assert.ok(namedWeaponPage.rows.every(row => row.StdMode === 5 || row.StdMode === 6));

    const jewelryBoxPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 100,
      query: '',
      filters: [
        { column: 'StdMode', values: [15, 19, 20, 21, 22, 23, 24, 26] },
        { column: 'OverLap', values: [2, 3, 6, 7] },
        { column: 'Expand1', values: [1, 2, 3, 4, 5, 6, 13] },
      ],
      sortColumn: 'Idx',
      sortDirection: 'asc',
    });
    assert.ok(jewelryBoxPage.total > 0, 'jewelry box filters should find eligible equipment');
    assert.ok(jewelryBoxPage.rows.every(row =>
      [15, 19, 20, 21, 22, 23, 24, 26].includes(row.StdMode) &&
      [2, 3, 6, 7].includes(row.OverLap) &&
      [1, 2, 3, 4, 5, 6, 13].includes(row.Expand1)
    ), 'multiple filter groups must combine with AND');

    const godBlessPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 100,
      query: '',
      filters: [
        { column: 'StdMode', values: [15, 19, 20, 21, 22, 23, 24, 26] },
        { column: 'OverLap', values: [4, 5, 6, 7] },
        { column: 'Expand1', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
      ],
      sortColumn: 'Idx',
      sortDirection: 'asc',
    });
    assert.ok(godBlessPage.total > 0, 'god bless box filters should find eligible equipment');
    assert.ok(godBlessPage.rows.every(row =>
      [15, 19, 20, 21, 22, 23, 24, 26].includes(row.StdMode) &&
      [4, 5, 6, 7].includes(row.OverLap) &&
      row.Expand1 >= 1 && row.Expand1 <= 13
    ), 'god bless box eligibility must use StdMode, OverLap, and Expand1 together');

    const created = await session.createRow(itemsTable.id, {
      Idx: 5000,
      Name: '新增物品',
      StdMode: 5,
      Price: 77,
      Color: 250,
    });
    assert.equal(created.operation, 'create');
    assert.ok(fs.existsSync(created.backupPath), 'create must back up the database before writing');
    assert.ok(Number(created.rowId) > 0);

    let editedPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 100,
      query: '新增物品',
      searchColumn: 'Name',
      matchMode: 'exact',
      sortColumn: '',
      sortDirection: 'asc',
    });
    assert.equal(editedPage.total, 1);
    assert.equal(editedPage.rows[0].Price, 77);

    const updated = await session.updateRow(itemsTable.id, created.rowId, {
      Idx: 5000,
      Name: '已修改物品',
      StdMode: 6,
      Price: 88,
      Color: 251,
    });
    assert.equal(updated.operation, 'update');
    assert.ok(fs.existsSync(updated.backupPath), 'update must back up the database before writing');

    editedPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 100,
      query: '已修改物品',
      searchColumn: 'Name',
      matchMode: 'exact',
      sortColumn: '',
      sortDirection: 'asc',
    });
    assert.equal(editedPage.total, 1);
    assert.equal(editedPage.rows[0].Price, 88);

    const deleted = await session.deleteRow(itemsTable.id, created.rowId);
    assert.equal(deleted.operation, 'delete');
    assert.ok(fs.existsSync(deleted.backupPath), 'delete must back up the database before writing');
    assert.equal(deleted.rowCount, 5000);

    const schemaResult = await session.updateSchema(itemsTable.id, [
      { sourceName: 'Name', name: 'DisplayName', type: 'TEXT' },
      { sourceName: 'Idx', name: 'Idx', type: 'INTEGER' },
      { sourceName: 'Color', name: 'Color', type: 'INTEGER' },
      { sourceName: '', name: 'Memo', type: 'TEXT' },
    ]);
    assert.equal(schemaResult.operation, 'schema');
    assert.ok(fs.existsSync(schemaResult.backupPath), 'schema changes must back up the database before writing');

    const schemaPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 20,
      query: 'Item00010',
      searchColumn: 'DisplayName',
      matchMode: 'exact',
      sortColumn: '',
      sortDirection: 'asc',
    });
    assert.deepEqual(schemaPage.columns, ['DisplayName', 'Idx', 'Color', 'Memo']);
    assert.equal(schemaPage.rows[0].DisplayName, 'Item00010', 'renamed columns must retain their data');
    assert.equal(schemaPage.rows[0].Idx, 10, 'reordered columns must retain their data');
    assert.equal(schemaPage.rows[0].Memo, null, 'new fields should default to null');
    assert.equal(Object.hasOwn(schemaPage.rows[0], 'Price'), false, 'deleted fields must be removed');

    const undoSchema = await session.undoLastMutation();
    assert.equal(undoSchema.revertedOperation, 'schema');
    assert.ok(fs.existsSync(undoSchema.backupPath), 'undo must preserve a safety backup of the current state');
    let undoPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 20,
      query: 'Item00010',
      searchColumn: 'Name',
      matchMode: 'exact',
      sortColumn: '',
      sortDirection: 'asc',
    });
    assert.deepEqual(undoPage.columns, ['Idx', 'Name', 'StdMode', 'Price', 'Color', 'OverLap', 'Expand1']);
    assert.equal(undoPage.rows[0].Price, 100, 'schema undo must restore deleted fields and their values');

    const undoDelete = await session.undoLastMutation();
    assert.equal(undoDelete.revertedOperation, 'delete');
    assert.equal(undoDelete.rowCount, 5001);
    undoPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 20,
      query: '已修改物品',
      searchColumn: 'Name',
      matchMode: 'exact',
      sortColumn: '',
      sortDirection: 'asc',
    });
    assert.equal(undoPage.total, 1, 'delete undo must restore the deleted row');
    assert.equal(undoPage.rows[0].Price, 88);

    const undoUpdate = await session.undoLastMutation();
    assert.equal(undoUpdate.revertedOperation, 'update');
    undoPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 20,
      query: '新增物品',
      searchColumn: 'Name',
      matchMode: 'exact',
      sortColumn: '',
      sortDirection: 'asc',
    });
    assert.equal(undoPage.total, 1, 'update undo must restore the previous cell values');
    assert.equal(undoPage.rows[0].Price, 77);

    const undoCreate = await session.undoLastMutation();
    assert.equal(undoCreate.revertedOperation, 'create');
    assert.equal(undoCreate.rowCount, 5000);
    undoPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 20,
      query: '新增物品',
      searchColumn: 'Name',
      matchMode: 'exact',
      sortColumn: '',
      sortDirection: 'asc',
    });
    assert.equal(undoPage.total, 0, 'create undo must remove the newly inserted row');
    await assert.rejects(session.undoLastMutation(), /没有可撤回/);

    const protectedRowPage = await session.loadPage({
      tableId: itemsTable.id,
      offset: 0,
      limit: 20,
      query: 'Item00010',
      searchColumn: 'Name',
      matchMode: 'exact',
      sortColumn: '',
      sortDirection: 'asc',
    });
    const protectedRowId = protectedRowPage.rows[0].__booRowId;
    await session.updateRow(itemsTable.id, protectedRowId, { Price: 123 });

    const externalDb = new SQL.Database(fs.readFileSync(dbPath));
    externalDb.run("UPDATE StdItems SET Price = 321 WHERE Name = 'Item00010'");
    fs.writeFileSync(dbPath, Buffer.from(externalDb.export()));
    externalDb.close();

    await assert.rejects(
      session.undoLastMutation(),
      /其他程序修改/,
      'undo must not overwrite a database changed by M2 or another external program'
    );
    const externallyEditedDb = new SQL.Database(fs.readFileSync(dbPath));
    const externalResult = externallyEditedDb.exec("SELECT Price FROM StdItems WHERE Name = 'Item00010'");
    externallyEditedDb.close();
    assert.equal(externalResult[0].values[0][0], 321, 'refused undo must preserve the external change');

    const backupDir = path.join(tempDir, 'boo-database-backups');
    assert.ok(fs.readdirSync(backupDir).length >= 11, 'writes and undo operations must keep independent restore points');
  } finally {
    session?.dispose();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().then(() => console.log('database-browser.test.js: PASS')).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
