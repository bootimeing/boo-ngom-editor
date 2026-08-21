const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function main() {
  const {
    engineColor,
    formatNpcDisplayName,
    mapEntityMatches,
    monGenColumns,
    parseCustomNpcAnimation,
    parseMerchantNameColor,
    parseMerchantLine,
    parseMerchantText,
    parseMonGenText,
    selectCustomNpcArchive,
    updateMerchantCoordinates,
    updateMerchantNpc,
    updateMonGenFields,
  } = require('../out/utils/map-entities');
  const {
    loadNpcIconDetail,
    npcIconRelativeFileName,
    parseNpcIconText,
    saveNpcIconText,
    validateNpcIconText,
  } = require('../out/utils/npc-icons');

  const merchantText = [
    '; comment',
    '传送\\土城 3 330 331 盟重老兵 0 8 0 0 0',
    '自定义 0103 12 18 动画NPC 0 10001 0 0 0',
  ].join('\r\n');
  const merchants = parseMerchantText(merchantText);
  assert.equal(merchants.length, 2);
  assert.equal(merchants[0].lineNumber, 2);
  assert.equal(merchants[1].appearance, 10001);
  const linkedMerchant = parseMerchantLine('  01大陆\\主城\\充值 荒土城 138 190 充值使者 0 10054', 7);
  assert.equal(linkedMerchant.npc.lineNumber, 7);
  assert.equal(linkedMerchant.npc.displayName, '充值使者');
  assert.equal(linkedMerchant.columns[0].start, 2);
  assert.equal(
    '  01大陆\\主城\\充值 荒土城 138 190 充值使者 0 10054'.slice(
      linkedMerchant.columns[4].start,
      linkedMerchant.columns[4].end
    ),
    '充值使者'
  );
  assert.equal(mapEntityMatches('$0103', {
    mapId: '0103', originalMapId: '0103', name: '测试地图', key: '1:0103', parameters: '', lineNumber: 1,
  }), true);

  const moved = updateMerchantCoordinates(merchantText, 2, 400, 401);
  assert.equal(moved.npc.x, 400);
  assert.equal(moved.npc.y, 401);
  assert.match(moved.text, /传送\\土城 3 400 401 盟重老兵/);
  const changedAppearance = updateMerchantNpc(merchantText, 2, 402, 403, 10054);
  assert.equal(changedAppearance.npc.appearance, 10054);
  assert.match(changedAppearance.text, /传送\\土城 3 402 403 盟重老兵 0 10054/);
  assert.equal(
    formatNpcDisplayName('零六名人堂\\\\[道祖天尊]\\王迪'),
    '王迪\n[道祖天尊]\n零六名人堂'
  );

  const monGenText = '3 100 101 白野猪 12 2 30 100 249\r\n';
  const spawn = parseMonGenText(monGenText)[0];
  assert.equal(spawn.monsterName, '白野猪');
  assert.equal(spawn.range, 12);
  const changed = updateMonGenFields(monGenText, 1, [
    '3', '110', '111', '白野猪', '20', '2', '30', '100', '249',
  ]);
  assert.equal(changed.spawn.x, 110);
  assert.equal(changed.spawn.range, 20);
  assert.match(changed.text, /^3 110 111 白野猪 20/);

  const gomNpc = parseCustomNpcAnimation([
    '[Setup]',
    'FileIndex=11',
    'Dir4=1',
    '[Stand]',
    'Start4=0',
    'Frame4=4',
    'Time4=150',
  ].join('\n'), 'GOM');
  assert.deepEqual(gomNpc, {
    fileIndex: 11, direction: 4, startIndex: 0, frameCount: 4, interval: 150,
  });

  const selectedNpcArchive = selectCustomNpcArchive(
    11,
    [{ name: 'NPC10', willIdx: 11 }],
    [
      { pakName: 'WrongArchive', storedWillIdx: 11, cachedAt: 200 },
      { pakName: 'NPC10', storedWillIdx: 3, cachedAt: 100 },
    ]
  );
  assert.equal(
    selectedNpcArchive.archive?.pakName,
    'NPC10',
    'EffectImageList line mapping must override the stale scan-order index stored by old caches'
  );
  assert.equal(selectedNpcArchive.expectedPakName, 'NPC10');

  const selectedExactArchive = selectCustomNpcArchive(
    11,
    [{ name: 'NPC10', willIdx: 11, extension: 'pak' }],
    [
      {
        pakName: 'NPC10',
        pakPath: 'D:\\客户端\\自定义补丁\\data\\NPC10.pak',
        storedWillIdx: 99,
        cachedAt: 100,
      },
      {
        pakName: 'NPC10',
        pakPath: 'D:\\客户端\\data\\NPC10.wzl',
        storedWillIdx: 11,
        cachedAt: 300,
      },
      {
        pakName: 'NPC10',
        pakPath: 'D:\\客户端\\data\\NPC10.pak',
        storedWillIdx: 11,
        cachedAt: 200,
      },
    ]
  );
  assert.equal(
    selectedExactArchive.archive?.pakPath,
    'D:\\客户端\\自定义补丁\\data\\NPC10.pak',
    'EffectImageList extension and custom-patch order must beat a newer same-name client cache'
  );

  const geeNpc = parseCustomNpcAnimation([
    '[Dir1]',
    'Enabled=1',
    'StdFile=26',
    'StdIndex=2260',
    'StdCount=13',
    'StdTime=100',
  ].join('\n'), 'GEE');
  assert.deepEqual(geeNpc, {
    fileIndex: 26, direction: 1, startIndex: 2260, frameCount: 13, interval: 100,
  });

  assert.equal(parseMerchantNameColor('MerchantNameColor=125'), 125);
  assert.equal(engineColor(125), '#DEA500');
  assert.match(monGenColumns('GOM')[9], /QF/);
  assert.match(monGenColumns('GEE')[14], /QF/);
  assert.match(monGenColumns('996PC')[7], /刷新模式/);

  const gomIcon = parseNpcIconText('7 110 16 -12 -40 1 100 3|1', 'GOM')[0];
  assert.deepEqual(
    { speedMs: gomIcon.speedMs, playCount: gomIcon.playCount, layer: gomIcon.layer },
    { speedMs: 100, playCount: 3, layer: 1 }
  );
  const pcIcon = parseNpcIconText('7 110 16 -12 -40 1 100 2 1', '996PC')[0];
  assert.deepEqual(
    { speedMs: pcIcon.speedMs, playCount: pcIcon.playCount, layer: pcIcon.layer },
    { speedMs: 100, playCount: 2, layer: 1 }
  );
  const geeIcon = parseNpcIconText('3 1 5 0 -30 0 1 150', 'GEE')[0];
  assert.deepEqual(
    { speedMs: geeIcon.speedMs, playCount: geeIcon.playCount, layer: geeIcon.layer },
    { speedMs: 150, playCount: 0, layer: 1 },
    'GEE stores layer before speed and does not use the GOM play-count column'
  );
  assert.throws(() => validateNpcIconText('invalid', 'GOM'), /第 1 行/);

  const npc = { scriptRef: '996m2\\装备回收', mapName: '$3' };
  assert.equal(npcIconRelativeFileName(npc), 'NpcIcons\\996m2\\装备回收-3.txt');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-npc-icons-'));
  try {
    const envir = path.join(tempRoot, 'Mir200', 'Envir');
    const saved = saveNpcIconText(envir, npc, '996PC', '7 110 16 -12 -40 0 100');
    assert.equal(saved.fileName, 'NpcIcons\\996m2\\装备回收-3.txt');
    assert.equal(saved.icons.length, 1);
    const loaded = loadNpcIconDetail(envir, npc, '996PC');
    assert.equal(loaded.exists, true);
    assert.equal(loaded.icons[0].x, -12);
    assert.equal(loaded.icons[0].y, -40);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log('map-entities.test.js: PASS');
}

main();
