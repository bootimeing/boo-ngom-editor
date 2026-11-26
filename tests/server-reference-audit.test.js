const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const { auditServerReferences } = require('../out/utils/server-reference-audit');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

async function run() {
  const root = mkdtempSync(path.join(os.tmpdir(),'boo-server-reference-'));
  try {
    const mir = path.join(root,'Mir200'), envir = path.join(mir,'Envir'), map = path.join(mir,'Map');
    for (const dir of [map, path.join(envir,'MonItems'), path.join(envir,'QuestDiary'), path.join(envir,'Data')]) mkdirSync(dir, { recursive:true });
    const sql = await require('sql.js')();
    function database(file, monster, item) {
      const db = new sql.Database();
      db.run('CREATE TABLE Monster (Name TEXT)'); db.run('INSERT INTO Monster VALUES (?)', [monster]);
      db.run('CREATE TABLE StdItems (Name TEXT)'); db.run('INSERT INTO StdItems VALUES (?)', [item]);
      writeFileSync(file, db.export()); db.close();
    }
    const active = path.join(mir, 'active.db');
    database(active, '白野猪', '木剑'); database(path.join(mir,'备份.db'), '仅备份怪', '仅备份物品');
    writeFileSync(path.join(mir,'!Setup.txt'), '[Server]\nUseAccessDB=3\nSqliteFileName=active.db');
    const tile = Buffer.alloc(52+20*10*14); tile.writeUInt16LE(20);tile.writeUInt16LE(10,2);
    writeFileSync(path.join(map, 'base.map'), tile);
    writeFileSync(path.join(map,'bad.map'), tile.subarray(0,52));
    writeFileSync(path.join(envir,'MapInfo.txt'), ['[A|base 别名]', '[M|missing 缺原图]', '[D|bad 损坏]',
      'A 19,9 1 -> A 20,0', 'A -1,0 -> M 0,0', 'A <$STR(N0)>,1 -> D 0,0'].join('\n'));
    writeFileSync(path.join(envir,'MerChant.txt'), '商人脚本 A 0 0 商人 0 1\n商人脚本 A 2 10 坐标越界NPC 0 1');
    writeFileSync(path.join(envir,'Npcs.txt'), '比奇国王 1 A 19 9 0 8\n比奇国王 1 A 20 5 0 8');
    writeFileSync(path.join(envir,'MonGen.txt'), 'A 2 3 白野猪 1 1 2\nA -1 3 仅备份怪 1 1 2\nA 0 <$STR(N0)> <$STR(S$怪)> 1 1 2');
    const shared = path.join(envir,'QuestDiary','共享.txt');
    writeFileSync(shared,'[@掉落]\n{\n1/2 仅备份物品\n}');
    const drop = path.join(envir,'MonItems','白野猪.txt');
    writeFileSync(drop,'1/2 木剑\n1/2 A0\n#CALL [\\共享.txt] @掉落\n#CALL [\\共享.txt] @掉落');
    const before = readFileSync(active);
    const r = await auditServerReferences(root,'GOM');
    assert.ok(before.equals(readFileSync(active)));
    assert.equal(r.database, active);
    assert.deepEqual(r.counts.monster, { valid:1, invalid:1, unverified:1 });
    assert.deepEqual(r.counts.item, { valid:1, invalid:2, unverified:1 });
    assert.deepEqual(r.counts.spawn, { valid:1, invalid:1, unverified:1 });
    assert.deepEqual(r.counts.connection, { valid:1, invalid:2, unverified:3 });
    assert.deepEqual(r.counts.npc, { valid:2, invalid:2, unverified:0 });
    assert.ok(r.findings.some(f=>f.file === shared && f.line === 3 && f.occurrences===2));
    writeFileSync(path.join(mir,'!Setup.txt'),'[Server]\nUseAccessDB=3\nSqliteFileName=missing.db');
    const missing = await auditServerReferences(root,'GEE');
    assert.equal(missing.counts.monster.invalid, 0);
    assert.equal(missing.counts.monster.unverified, 3);
    assert.equal(missing.counts.npc.invalid, 2);

    for (const [file, name] of [['cfg_item.xls','木剑'], ['cfg_monster.xls','白野猪']]) {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['//;ver',1],['序号','名称'],['Idx','Name'],[1,name]]), 'Sheet1');
      XLSX.writeFile(book, path.join(envir, 'Data', file), {bookType:'biff8'});
    }
    const excel = await auditServerReferences(root, '996PC');
    assert.equal(excel.database, path.join(envir,'Data'));
    assert.deepEqual(excel.counts.monster, r.counts.monster);
    assert.deepEqual(excel.counts.item, r.counts.item);
    assert.deepEqual(excel.counts.npc, r.counts.npc);
    console.log('server-reference-audit.test.js: PASS');
  } finally { removeTemporaryDirectory(root); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
