const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function main() {
  const {
    engineColor,
    mapEntityMatches,
    monGenColumns,
    parseCustomNpcAnimation,
    parseMerchantNameColor,
    parseMerchantLine,
    parseMerchantText,
    parseMonGenText,
    selectCustomNpcArchive,
    updateMerchantCoordinates,
    updateMonGenFields,
  } = require('../out/utils/map-entities');

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

  const npcLookDirectory = path.join(__dirname, '..', 'resources', 'npc-looks');
  const npcLooks = fs.readdirSync(npcLookDirectory).filter(name => name.endsWith('.webp'));
  assert.equal(npcLooks.length, 165);
  for (const required of ['0.webp', '272.webp', '273.webp']) {
    const data = fs.readFileSync(path.join(npcLookDirectory, required));
    assert.equal(data.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(data.subarray(8, 12).toString('ascii'), 'WEBP');
  }
  const npcAssetBytes = npcLooks.reduce(
    (total, name) => total + fs.statSync(path.join(npcLookDirectory, name)).size,
    0
  );
  assert.ok(npcAssetBytes < 1_200_000, `NPC appearance assets are unexpectedly large: ${npcAssetBytes}`);

  console.log('map-entities.test.js: PASS');
}

main();
