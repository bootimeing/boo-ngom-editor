const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { resolveWorkspaceDatabaseSource } = require('../out/utils/database-source');
const { DatabaseBrowserSession } = require('../out/utils/database-browser');

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-db-source-'));
  const SQL = await require('sql.js')();
  let session;
  let count = 0;
  const samePath = (left, right) => assert.equal(path.resolve(left).toLowerCase(), path.resolve(right).toLowerCase());
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const fixture = name => {
    const root = path.join(temporary, name), mir = path.join(root, 'Mir200'), directory = path.join(root, 'MUD2', 'db');
    fs.mkdirSync(mir, { recursive: true }); fs.mkdirSync(directory, { recursive: true });
    const setup = path.join(mir, '!Setup.txt');
    return { root, mir, directory, setup, configure: text => fs.writeFileSync(setup, text) };
  };
  const writeDb = (file, item) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const database = new SQL.Database();
    database.run('CREATE TABLE StdItems (Idx INTEGER, Name TEXT)');
    database.run('CREATE TABLE Monster (Idx INTEGER, Name TEXT)');
    database.run('CREATE TABLE Magic (Idx INTEGER, MagName TEXT)');
    database.run('INSERT INTO StdItems VALUES (?, ?)', [1, item]);
    fs.writeFileSync(file, Buffer.from(database.export())); database.close();
  };
  try {
    const configured = fixture('configured');
    const active = path.join(configured.directory, 'HeroDB.DB'), backup = path.join(configured.directory, 'HeroDB2026-10-28.DB');
    writeDb(active, '当前正式物品'); writeDb(backup, '备份旧物品');
    configured.configure('[Server]\r\nDBName=HeroDB\r\nUseAccessDB=3\r\nAccessFileName=missing.mdb\r\nExcelFileName=stale-folder\r\nSqliteFileName="'+active+'" ; 真实配置优先\r\n');
    const before = [digest(active), digest(backup), digest(configured.setup)];
    const selected = resolveWorkspaceDatabaseSource(configured.root);
    samePath(selected.path, active); assert.equal(selected.configurationKey, 'SqliteFileName');
    session = new DatabaseBrowserSession(selected.path, selected.profile);
    const catalog = await session.initialize();
    assert.equal(catalog.tables.length, 3, 'a backup beside the active database must not duplicate all three table tabs');
    const item = catalog.tables.find(table => table.name === 'StdItems');
    const page = await session.loadPage({ tableId: item.id, offset: 0, limit: 20, query: '', sortColumn: '', sortDirection: 'asc' });
    assert.equal(page.rows[0].Name, '当前正式物品'); session.dispose(); session = undefined;
    assert.deepEqual([digest(active), digest(backup), digest(configured.setup)], before,
      'source discovery and opening must not change the real source, backup or configuration bytes'); count++;

    configured.configure('[Server]\nUseAccessDB=3\nSqliteFileName='+path.join(configured.directory, 'missing.db'));
    assert.throws(() => resolveWorkspaceDatabaseSource(configured.root), /指定的数据库不存在/,
      'a missing configured source must not silently select a valid backup');
    configured.configure('[Server]\nUseAccessDB=3\nAccessFileName='+backup);
    assert.throws(() => resolveWorkspaceDatabaseSource(configured.root), /未填写.*SqliteFileName/); count++;

    const relative = fixture('relative');
    const relativeDb = path.join(relative.directory, '中文数据库.DB'); writeDb(relativeDb, '中文路径物品');
    const relativeValue = path.join('..', 'MUD2', 'db', '中文数据库.DB');
    fs.writeFileSync(relative.setup, iconv.encode('[server]\r\nuseaccessdb=3\r\nsqlitefilename='+relativeValue+'\r\n[Other]\r\nSqliteFileName=ignore.db', 'gbk'));
    samePath(resolveWorkspaceDatabaseSource(relative.root).path, relativeDb); count++;

    const ambiguous = fixture('ambiguous');
    const fromMir = path.join(ambiguous.mir, 'db', 'main.db'), fromRoot = path.join(ambiguous.root, 'db', 'main.db');
    writeDb(fromMir, 'M2目录物品'); writeDb(fromRoot, '根目录物品');
    ambiguous.configure('[Server]\nUseAccessDB=3\nSqliteFileName='+path.join('db', 'main.db'));
    assert.throws(() => resolveWorkspaceDatabaseSource(ambiguous.root), /相对路径.*多个文件/); count++;

    const legacy = fixture('legacy');
    const legacyActive = path.join(legacy.directory, 'Chosen.db'), legacyBackup = path.join(legacy.directory, 'Chosen-backup.db');
    writeDb(legacyActive, '别名匹配'); writeDb(legacyBackup, '旧物品');
    legacy.configure('[Server]\nDBName=chosen');
    samePath(resolveWorkspaceDatabaseSource(legacy.root).path, legacyActive);
    fs.writeFileSync(path.join(legacy.directory, 'Chosen.mdb'), 'placeholder');
    assert.throws(() => resolveWorkspaceDatabaseSource(legacy.root), /DBName=chosen.*多个/); count++;

    const unique = fixture('unique');
    writeDb(path.join(unique.directory, 'only.db'), '唯一物品');
    assert.equal(resolveWorkspaceDatabaseSource(unique.root).source, 'unique-file');
    writeDb(path.join(unique.directory, 'anything.db'), '第二个库');
    assert.throws(() => resolveWorkspaceDatabaseSource(unique.root), /多个 DB\/MDB/,
      'unconfigured multiple databases must not be merged or chosen by filename order'); count++;

    const invalid = fixture('invalid');
    invalid.configure('[Server]\nUseAccessDB=999\nSqliteFileName='+active);
    assert.throws(() => resolveWorkspaceDatabaseSource(invalid.root), /UseAccessDB=999.*不能自动打开/);
    invalid.configure('[Server]\nUseAccessDB=0\nDBName=HeroDB');
    assert.throws(() => resolveWorkspaceDatabaseSource(invalid.root), /UseAccessDB=0.*不能自动打开/);
    invalid.configure('[Server]\nUseAccessDB=1\nAccessFileName=Data.mdb');
    assert.throws(() => resolveWorkspaceDatabaseSource(invalid.root), /UseAccessDB=1.*不能自动打开/);
    invalid.configure('[Server]\nUseAccessDB=3\nSqliteFileName='+active+'\nSqliteFileName='+backup);
    assert.throws(() => resolveWorkspaceDatabaseSource(invalid.root), /冲突配置/);
    invalid.configure('[Server]\nSqliteFileName='+active+'\nAccessFileName=other.mdb');
    assert.throws(() => resolveWorkspaceDatabaseSource(invalid.root), /多个数据库来源/); count++;

    const noMode = fixture('explicit-no-mode');
    noMode.configure('[Server]\nSqliteFileName='+active);
    samePath(resolveWorkspaceDatabaseSource(noMode.root).path, active);
    noMode.configure('[Server]\nUseAccessDB=3\nSqliteFileName='+active.replace(/\.DB$/, '.mdb'));
    assert.throws(() => resolveWorkspaceDatabaseSource(noMode.root), /SqliteFileName.*\.DB/); count++;

    // Manual file selection intentionally remains usable for reviewing backups.
    session = new DatabaseBrowserSession(backup);
    const manualCatalog = await session.initialize();
    assert.equal(manualCatalog.tables.length, 3);
    const manualItem = manualCatalog.tables.find(table => table.name === 'StdItems');
    const manualPage = await session.loadPage({ tableId: manualItem.id, offset: 0, limit: 20, query: '', sortColumn: '', sortDirection: 'asc' });
    assert.equal(manualPage.rows[0].Name, '备份旧物品'); session.dispose(); session = undefined; count++;

    const biff = fixture('996pc');
    biff.configure('[Server]\nUseAccessDB=999\nSqliteFileName=missing.db');
    const biffSource = resolveWorkspaceDatabaseSource(biff.root, '996pc');
    samePath(biffSource.path, path.join(biff.mir, 'Envir', 'Data'));
    assert.equal(biffSource.profile, '996pc'); assert.equal(biffSource.source, '996pc'); count++;

    console.log(`database-source.test.js: PASS (${count} source selection scenarios)`);
  } finally {
    session?.dispose(); removeTemporaryDirectory(temporary);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
