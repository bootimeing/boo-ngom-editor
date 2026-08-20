const assert = require('node:assert/strict');

function main() {
  const { TABLE_CONFIGS } = require('../out/utils/table-configs');
  const columns = value => value.split('│').map(column => column.trim());

  assert.deepEqual(columns(TABLE_CONFIGS['merchant.txt']), [
    '脚本路径',
    '地图编号',
    'X',
    'Y',
    'NPC显示名字',
    'NPC朝向',
    'NPC外观编号',
    '是否属于城堡',
    '是否自动移动',
    '移动间隔',
  ]);

  assert.deepEqual(columns(TABLE_CONFIGS['mongen.txt']), [
    '地图',
    '坐标X',
    '坐标Y',
    '怪物名字',
    '范围',
    '数量(支持G变量)',
    '时间间隔',
    '集中刷新坐标机率',
    '名字颜色(0~255)',
    '刷出来时触发的QF脚本字段(*表示不触发QF)',
    '内功怪物(0,1)',
    '国家名',
    '怪物能否攻击同国家的人(0,1)',
    '不同国家的怪物能否相互攻击(0,1)',
    '怪物能否被同国家的人来攻击(0,1)',
    '刷新模式(0~1)',
    'BOSS怪(0~1 不被NOMANNOMON模式地图清理)',
    '是否在小地图显示刷新倒计时/刷怪预告(0、1或1@标签:秒数列表)',
  ]);

  console.log('table-configs.test.js: PASS');
}

main();
