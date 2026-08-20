const assert = require('node:assert/strict');

function main() {
  const {
    buildChineseCommandFilterText,
    buildCommandSearchText,
    findChineseCommandSearch,
    scoreChineseCommandSearch,
  } = require('../out/utils/completion-search');

  assert.deepEqual(findChineseCommandSearch('检测'), { query: '检测', start: 0 });
  assert.deepEqual(findChineseCommandSearch('  检测'), { query: '检测', start: 2 });
  assert.deepEqual(findChineseCommandSearch('#IF 检测'), { query: '检测', start: 4 });
  assert.deepEqual(findChineseCommandSearch('#ELSEACT 地图'), { query: '地图', start: 9 });
  assert.equal(findChineseCommandSearch('SENDMSG 5 检测'), null);
  assert.equal(findChineseCommandSearch('SENDMSG 5 名称包含检测'), null);
  assert.equal(findChineseCommandSearch('CHECKMAP'), null);

  const checkMap = {
    name: 'CHECKMAP',
    syntax: 'CHECKMAP 地图编号',
    description: '检测人物当前所在地图',
    params: ['地图编号'],
    aliases: ['ISMAP'],
  };
  const action = {
    name: 'SENDMSG',
    syntax: 'SENDMSG 类型 消息',
    description: '向人物发送文字消息',
    params: ['类型', '消息'],
    aliases: [],
  };

  assert.equal(scoreChineseCommandSearch(checkMap, '[检测]', '检测'), 0);
  assert.equal(scoreChineseCommandSearch(checkMap, '[检测]', '地图'), 0);
  assert.equal(scoreChineseCommandSearch(checkMap, '[检测]', '检图'), 1);
  assert.equal(scoreChineseCommandSearch(checkMap, '[检测]', '执行'), null);
  assert.equal(scoreChineseCommandSearch(action, '[执行]', '执行'), null);
  assert.equal(scoreChineseCommandSearch(checkMap, '[检测]', 'CHECKMAP'), null);
  assert.equal(scoreChineseCommandSearch(checkMap, '[检测]', '地图编号'), null);
  assert.equal(scoreChineseCommandSearch(action, '[执行]', '怪物'), null);

  const searchText = buildCommandSearchText(checkMap, '[检测]');
  assert.equal(searchText, '检测人物当前所在地图');

  const filterText = buildChineseCommandFilterText(checkMap, '[检测]', '检图');
  assert.ok(filterText.startsWith('检图 '));
  assert.match(filterText, /检测人物当前所在地图/);
  assert.doesNotMatch(filterText, /CHECKMAP|地图编号|\[检测\]/);

  console.log('completion-search.test.js: PASS');
}

main();
