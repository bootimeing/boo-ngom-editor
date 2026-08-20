const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

const { DatabaseBrowserSession } = require('../out/utils/database-browser');
const { sanitizeBiff8WorkbookForWrite } = require('../out/utils/biff8-database');

const ITEM_FIELDS = [
  'Idx', 'Name', 'StdMode', 'Shape', 'Weight', 'Anicount', 'Source', 'Reserved',
  'Looks', 'DuraMax', 'Attribute', 'Need', 'NeedLevel', 'Price', 'Color', 'OverLap',
  'Suit', 'Article', 'Job', 'effectParam', 'Desc', 'Expand1', 'HairShow', 'auctionby',
  'Insurance',
];
const ITEM_LABELS = [
  '//;物品序号', '名称', '分类', '效果', '重量', '负重值\n(外观)', '暂留', '暂留',
  '背包显示', '持久度', '属性 (职业#属性ID#属性值|职业#属性ID#属性值)', '使用条件',
  '使用等级', '出售价格', '颜色', '叠加物品', '套装ID', '物品规则', '使用职业',
  '道具特殊效果参数(3种使用效果,针对Stdmode有不同功能)', '备注',
  '参数1：生肖盒首饰盒参数', '控制发型斗笠武器裸模是否显示', '拍卖行分类',
  '装备投保\n货币ID#投保金额',
];
const MONSTER_FIELDS = [
  'IDX', 'Name', 'Race', 'RaceImg', 'Appr', 'Lvl', 'Undead', 'CoolEye', 'Exp',
  'Attribute', 'SPEED', 'HIT', 'WALK_SPD', 'WALKSTEP', 'WALKWAIT', 'ATTACK_SPD',
  'ShapeAmplify', '', '', '', '', '', '', 'IsBoss',
];
const MONSTER_LABELS = [
  '//;怪物IDX', '怪物名称', '行为代码', '攻击代码', '怪物形象', '怪物等级',
  '是否为不死系', '是否主动攻击(百分比反隐形范围,并和等级有关)', '经验值',
  '属性 (参考装备表,或查看说明书)', '速度', '攻击命中率', '行走速度间隔',
  '行走步伐', '行走等待时间', '攻击速度间隔', '怪物体型倍数',
  '暂无', '暂无', '暂无', '暂无', '暂无', '暂无', '是否属于BOSS',
];
const MAGIC_FIELDS = [
  'MagID', 'MagName', 'EffectType', 'Effect', 'Spell', 'Power', 'Maxpower',
  'DefSpell', 'DefPower', 'DefMaxPower', 'Job', 'NeedL1', 'L1Train', 'NeedL2',
  'L2Train', 'NeedL3', 'L3Train', 'NeedL4', 'L4Train', 'NeedL5', 'L5Train',
  'NeedL6', 'L6Train', 'NeedL7', 'L7Train', 'NeedL8', 'L8Train', 'NeedL9',
  'L9Train', 'NeedL10', 'L10Train', 'Delay', 'SkillCD', 'QSkill', 'ActRange',
  'ActRate', 'Descr',
];
const MAGIC_LABELS = [
  '//;技能ID', '使用技能时角色的动作效果', '技能产生的动画效果', '技能效果',
  '等级影响的魔法值', '等级伤害下限', '等级伤害上限', '魔法值', '基础伤害下限',
  '伤害上限', '职业', '1升2需求等级', '1升2需求熟练度', '2升3需求等级',
  '2升3需求熟练度', '3升4需求等级', '3升4需求熟练度', '4升5需求等级',
  '4升5需求熟练度', '5升6需求等级', '5升6需求熟练度', '6升7需求等级',
  '6升7需求熟练度', '7升8需求等级', '7升8需求熟练度', '8升9需求等级',
  '8升9需求熟练度', '9升10需求等级', '9升10需求熟练度', '10升11需求等级',
  '10升11需求熟练度', '使用完当前技能后再次使用其他任意技能之间的延时（单位：毫秒）',
  '技能CD/毫秒', '强化技能', '技能范围（只针对群体法术，范围默认是1）',
  '技能伤害攻击力倍数', '是否英雄技能（0或为空=人物 1=英雄）',
];

function writeFixture(directory, fileName, rows) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet7');
  XLSX.writeFile(workbook, path.join(directory, fileName), { bookType: 'biff8' });
}

function request(tableId, overrides = {}) {
  return {
    tableId,
    offset: 0,
    limit: 20,
    query: '',
    sortColumn: '',
    sortDirection: 'asc',
    ...overrides,
  };
}

async function main() {
  const vscodeIgnore = fs.readFileSync('.vscodeignore', 'utf8');
  assert.match(vscodeIgnore, /!node_modules\/xlsx\/xlsx\.js/);
  assert.match(vscodeIgnore, /!node_modules\/xlsx\/dist\/cpexcel\.js/);
  assert.doesNotMatch(
    vscodeIgnore,
    /!node_modules\/xlsx\/\*\*/,
    'the packaged extension should not include every xlsx distribution'
  );

  const metadataWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(metadataWorkbook, XLSX.utils.aoa_to_sheet([['字段'], ['数据']]), 'Sheet1');
  metadataWorkbook.Props = {
    Locale: 2052,
    FMTID: ['02d5cdd59c2e1b10939708002b2cf9ae'],
    undefined: 2052,
    Application: 'WPS 表格',
  };
  metadataWorkbook.Custprops = { ...metadataWorkbook.Props };
  assert.throws(
    () => XLSX.write(metadataWorkbook, { type: 'buffer', bookType: 'biff8', bookSST: true, cellStyles: true }),
    /TypedPropertyValue/,
    'the fixture should reproduce the unsupported WPS OLE property failure'
  );
  const sanitizedWorkbook = sanitizeBiff8WorkbookForWrite(metadataWorkbook);
  const sanitizedOutput = XLSX.write(sanitizedWorkbook, {
    type: 'buffer',
    bookType: 'biff8',
    bookSST: true,
    cellStyles: true,
  });
  const sanitizedReopened = XLSX.read(sanitizedOutput, { type: 'buffer' });
  assert.equal(sanitizedReopened.Sheets.Sheet1.A2.v, '数据');
  assert.equal(metadataWorkbook.Props.Locale, 2052, 'sanitizing must not mutate the active workbook');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-biff8-db-'));
  writeFixture(root, 'cfg_item.xls', [
    ['//;ver', ...ITEM_FIELDS.slice(1).map((_, index) => index + 1)],
    ITEM_LABELS,
    ITEM_FIELDS,
    [1, '金币', 41, 99, 0, 0, 0, 0, 115, 0, '', 0, 0, 0, 0],
    [2, '测试剑', 5, 1, 10, 0, 0, 0, 10001, 30000, '3#3#10|', 0, 1, 100, 249],
  ]);
  writeFixture(root, 'cfg_monster.xls', [
    ['//;ver', ...MONSTER_FIELDS.slice(1).map((_, index) => index + 1)],
    MONSTER_LABELS,
    MONSTER_FIELDS,
    [1000, '测试怪', 156, 156, 1, 10, 0, 100, 1000, '3#1#100|', 10, 200, 500, 1, 0, 800, 1, '', '', '', '', '', '', 1],
  ]);
  writeFixture(root, 'cfg_magic.xls', [
    ['//;ver', ...MAGIC_FIELDS.slice(1).map((_, index) => index + 1)],
    MAGIC_LABELS,
    MAGIC_FIELDS,
    [1, '火球术', 1, 1, 4, 8, 8, 1, 2, 2, 1, 7, 50, 11, 100, 16, 200, 17, 400, 18, 800, 19, 1600, 20, 3200, 22, 6400, 24, 12800, 26, 25600, 60, 1000, 0, 1, '0=100', 0],
  ]);

  const session = new DatabaseBrowserSession(root, '996pc');
  const catalog = await session.initialize();
  assert.deepEqual(
    catalog.tables.map(table => table.label),
    ['物品数据库', '怪物数据库', '技能数据库']
  );
  assert.deepEqual(catalog.tables.map(table => table.rowCount), [2, 1, 1]);
  assert.ok(catalog.tables.every(table => table.kind === 'biff8' && table.editable));
  assert.ok(catalog.tables.every(table => !table.schemaEditable));

  const item = catalog.tables[0];
  assert.deepEqual(item.columns, ITEM_FIELDS);
  assert.equal(item.columnLabels.StdMode, '分类');
  assert.match(item.columnDescriptions.Looks, /Items\.Jpk.*Items1\.Jpk.*Items2\.Jpk.*99999/);
  assert.equal(item.columnLabels.Anicount, '扩展参数');
  assert.match(item.columnDescriptions.Anicount, /含义随 StdMode 变化/);
  assert.match(item.columnDescriptions.effectParam, /道具特殊效果参数/);
  assert.match(item.columnDescriptions.Expand1, /生肖盒.*首饰盒/);
  const monster = catalog.tables[1];
  assert.deepEqual(monster.columns.slice(0, 17), MONSTER_FIELDS.slice(0, 17));
  assert.deepEqual(
    monster.columns.slice(17, 23),
    ['Reserved17', 'Reserved18', 'Reserved19', 'Reserved20', 'Reserved21', 'Reserved22']
  );
  assert.equal(monster.columns[23], 'IsBoss');
  assert.equal(monster.columnLabels.ShapeAmplify, '怪物体型倍数');
  const magic = catalog.tables[2];
  assert.deepEqual(magic.columns, MAGIC_FIELDS);
  assert.equal(magic.columnLabels.MagName, '技能名称');
  assert.equal(magic.columnLabels.EffectType, '角色动作效果');
  assert.equal(magic.columnLabels.Spell, '魔法消耗');
  assert.equal(magic.columnLabels.DefSpell, '每级魔法消耗');
  assert.equal(magic.columnLabels.NeedL10, '10升11需求等级');
  assert.match(magic.columnDescriptions.Descr, /英雄技能/);

  const page = await session.loadPage(request(item.id), () => false);
  assert.equal(page.rows[0].Name, '金币');
  const batchUpdate = await session.updateRows(item.id, [
    { rowId: page.rows[0].__booRowId, values: { Price: 101 } },
    { rowId: page.rows[1].__booRowId, values: { Price: 202 } },
  ]);
  assert.ok(fs.existsSync(batchUpdate.backupPath));
  const batchPage = await session.loadPage(request(item.id), () => false);
  assert.deepEqual(batchPage.rows.map(row => row.Price), [101, 202]);
  const undoBatch = await session.undoLastMutation();
  assert.equal(undoBatch.revertedOperation, 'update');
  const batchRestored = await session.loadPage(request(item.id), () => false);
  assert.notDeepEqual(batchRestored.rows.map(row => row.Price), [101, 202]);
  await assert.rejects(
    session.updateRows(item.id, [
      { rowId: page.rows[0].__booRowId, values: { Price: 303 } },
      { rowId: 999999, values: { Price: 404 } },
    ]),
    /不存在|修改/
  );
  const atomicBatchPage = await session.loadPage(request(item.id), () => false);
  assert.notEqual(atomicBatchPage.rows[0].Price, 303, 'invalid BIFF8 batches must not partially modify the workbook');
  const rowId = page.rows[0].__booRowId;
  const update = await session.updateRow(item.id, rowId, { Name: '金币_修改测试' });
  assert.ok(fs.existsSync(update.backupPath));
  const updatedPage = await session.loadPage(
    request(item.id, { query: '修改测试' }),
    () => false
  );
  assert.equal(updatedPage.total, 1);

  const beforeCreate = item.rowCount;
  const created = await session.createRow(item.id, {});
  assert.equal(created.rowCount, beforeCreate + 1);
  const deleted = await session.deleteRow(item.id, created.rowId);
  assert.equal(deleted.rowCount, beforeCreate);
  await assert.rejects(
    session.updateSchema(item.id, []),
    /前三行|引擎协议/
  );

  const undoDelete = await session.undoLastMutation();
  assert.equal(undoDelete.revertedOperation, 'delete');
  assert.equal(undoDelete.rowCount, beforeCreate + 1);
  const undoCreate = await session.undoLastMutation();
  assert.equal(undoCreate.revertedOperation, 'create');
  assert.equal(undoCreate.rowCount, beforeCreate);
  const undoUpdate = await session.undoLastMutation();
  assert.equal(undoUpdate.revertedOperation, 'update');
  const restoredPage = await session.loadPage(request(item.id), () => false);
  assert.equal(restoredPage.rows[0].Name, '金币', '996PC update undo must restore the original cell value');
  await assert.rejects(session.undoLastMutation(), /没有可撤回/);
  session.dispose();

  const reopened = new DatabaseBrowserSession(root, '996pc');
  const reopenedCatalog = await reopened.initialize();
  assert.equal(reopenedCatalog.tables[0].rowCount, beforeCreate);
  const reopenedPage = await reopened.loadPage(request(reopenedCatalog.tables[0].id), () => false);
  assert.equal(reopenedPage.rows[0].Name, '金币');
  reopened.dispose();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('database-biff8.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
