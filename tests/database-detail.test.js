const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');

function main() {
  const {
    buildMonsterIconPreviews,
    classifyDatabaseDetail,
    describeMonsterBodyAppearance,
    loadMonsterDatabaseDetail,
    parseMonsterIconText,
    saveMonsterDatabaseDetailText,
  } = require('../out/utils/database-detail');
  const { decodeTextFile } = require('../out/utils/text');

  assert.equal(classifyDatabaseDetail('StdItems'), 'item');
  assert.equal(classifyDatabaseDetail('Monster'), 'monster');
  assert.equal(classifyDatabaseDetail('Magic'), 'skill');
  assert.equal(classifyDatabaseDetail('CustomSkillTable'), 'skill');
  assert.equal(classifyDatabaseDetail('未知表', '怪物数据库'), 'monster');
  assert.equal(classifyDatabaseDetail('Account'), 'other');

  assert.deepEqual(parseMonsterIconText([
    '; WIL 图片 帧数 X Y 效果 速度 次数 层级',
    '7 110 16 73 90 0 100',
    '3 1 5 0 -30',
    '4 20 8 -2 5 1 0 3|1',
    'bad line',
  ].join('\r\n')), [
    {
      lineNumber: 2,
      raw: '7 110 16 73 90 0 100',
      wilIndex: 7,
      imageIndex: 110,
      frameCount: 16,
      x: 73,
      y: 90,
      effect: 0,
      speedMs: 100,
      playCount: 0,
      layer: 0,
    },
    {
      lineNumber: 3,
      raw: '3 1 5 0 -30',
      wilIndex: 3,
      imageIndex: 1,
      frameCount: 5,
      x: 0,
      y: -30,
      effect: 0,
      speedMs: 300,
      playCount: 0,
      layer: 0,
    },
    {
      lineNumber: 4,
      raw: '4 20 8 -2 5 1 0 3|1',
      wilIndex: 4,
      imageIndex: 20,
      frameCount: 8,
      x: -2,
      y: 5,
      effect: 1,
      speedMs: 300,
      playCount: 3,
      layer: 1,
    },
  ]);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-database-detail-'));
  try {
    const envir = path.join(root, 'Mir200', 'Envir');
    const monItems = path.join(envir, 'MonItems');
    const monIcons = path.join(envir, 'MonIcons');
    fs.mkdirSync(monItems, { recursive: true });
    fs.mkdirSync(monIcons, { recursive: true });
    fs.writeFileSync(
      path.join(monItems, '白野猪.txt'),
      iconv.encode('#CALL [\\爆率系统\\公共.txt] @白野猪\r\n1/10 裁决之杖', 'gbk')
    );
    fs.writeFileSync(path.join(monIcons, '白野猪.txt'), '7 110 16 73 90 0 100\r\n', 'utf8');

    const detail = loadMonsterDatabaseDetail(envir, '白野猪');
    assert.equal(detail.dropRateText, '#CALL [\\爆率系统\\公共.txt] @白野猪\r\n1/10 裁决之杖');
    assert.equal(detail.dropRateFileName, 'MonItems\\白野猪.txt');
    assert.equal(detail.iconFileName, 'MonIcons\\白野猪.txt');
    assert.equal(detail.iconText, '7 110 16 73 90 0 100\r\n');
    assert.equal(detail.icons.length, 1);
    assert.equal(detail.icons[0].frameCount, 16);

    saveMonsterDatabaseDetailText(envir, '白野猪', 'dropRateText', '#CALL [\\爆率系统\\新版.txt] @白野猪\n1/5 屠龙');
    const savedDropRate = decodeTextFile(fs.readFileSync(path.join(monItems, '白野猪.txt')));
    assert.equal(savedDropRate.encoding, 'gbk');
    assert.equal(savedDropRate.text, '#CALL [\\爆率系统\\新版.txt] @白野猪\r\n1/5 屠龙');

    saveMonsterDatabaseDetailText(envir, '白野猪', 'iconText', '7 120 8 0 -20 1 80\n3 1 5 0 -30');
    const savedIcons = decodeTextFile(fs.readFileSync(path.join(monIcons, '白野猪.txt')));
    assert.equal(savedIcons.encoding, 'utf8');
    assert.equal(savedIcons.text, '7 120 8 0 -20 1 80\r\n3 1 5 0 -30');
    assert.equal(loadMonsterDatabaseDetail(envir, '白野猪').icons.length, 2);

    const missingEnvir = path.join(root, 'missing', 'Mir200', 'Envir');
    const created = saveMonsterDatabaseDetailText(missingEnvir, '新怪物', 'dropRateText', '1/1 测试物品');
    assert.equal(created.fileName, 'MonItems\\新怪物.txt');
    assert.equal(decodeTextFile(fs.readFileSync(path.join(missingEnvir, 'MonItems', '新怪物.txt'))).encoding, 'gbk');
    assert.throws(
      () => saveMonsterDatabaseDetailText(envir, '..\\白野猪', 'iconText', '7 1'),
      /怪物名称无效/
    );

    const manyIcons = Array.from({ length: 10 }, (_, index) => ({
      lineNumber: index + 1,
      raw: `7 ${index * 20} 16 0 0 0 100`,
      wilIndex: 7,
      imageIndex: index * 20,
      frameCount: 16,
      x: 0,
      y: 0,
      effect: 0,
      speedMs: 100,
      playCount: 0,
      layer: 0,
    }));
    const previews = buildMonsterIconPreviews(manyIcons, (wil, image) => `${wil}/${image}`);
    assert.equal(previews.icons.length, 10);
    assert.equal(previews.icons.reduce((sum, icon) => sum + icon.frames.length, 0), 90);
    assert.equal(previews.icons.every(icon => icon.frames.length === 9 && icon.previewTruncated), true);
    assert.deepEqual(previews.icons[0].frameAssets[0], { url: '7/0' });

    const offsetPreview = buildMonsterIconPreviews(manyIcons.slice(0, 1), (wil, image) => ({
      url: `${wil}/${image}`,
      width: 200,
      height: 100,
      offsetX: -100,
      offsetY: -160,
    }));
    assert.deepEqual(offsetPreview.icons[0].frameAssets[0], {
      url: '7/0',
      width: 200,
      height: 100,
      offsetX: -100,
      offsetY: -160,
    });

    assert.deepEqual(
      describeMonsterBodyAppearance(envir, '白野猪', { Race: 81, Appr: 1120 }, 'GOM'),
      {
        source: 'archive',
        pakName: 'Mon113',
        imageIndex: 40,
        label: 'Mon113.pak / 000040',
        configFileName: '',
        warning: '',
      }
    );
    assert.equal(
      describeMonsterBodyAppearance(envir, '白野猪', { race: 81, appr: 1121 }, 'GOM').imageIndex,
      400
    );
    assert.equal(
      describeMonsterBodyAppearance(envir, '白野猪', { race: 81, appr: 1130 }, '996PC').label,
      'Mon114.jpk / 000040'
    );
    assert.deepEqual(
      describeMonsterBodyAppearance(
        envir,
        '测试怪物',
        { Race: 81, RaceImg: 19, Appr: 2251 },
        'GOM'
      ),
      {
        source: 'archive',
        pakName: 'Mon226',
        imageIndex: 400,
        label: 'Mon226.pak / 000400',
        configFileName: '',
        warning: '',
      },
      'Appr must take precedence over the unrelated RaceImg field'
    );

    const smartMonster = path.join(envir, 'SmartMonster');
    fs.mkdirSync(smartMonster, { recursive: true });
    fs.writeFileSync(path.join(smartMonster, '云霄残影.ini'), [
      '[CLIENT]',
      'FILEINDEX=23',
      '[ACTSTAND]',
      'START=360',
      'FRAME=4',
      'SKIP=6',
      'CHECKDIR=1',
    ].join('\r\n'));
    const gomCustom = describeMonsterBodyAppearance(
      envir,
      '云霄残影',
      { Race: 156, Appr: 0 },
      'GOM'
    );
    assert.equal(gomCustom.source, 'will');
    assert.equal(gomCustom.willIndex, 23);
    assert.equal(gomCustom.imageIndex, 400);

    fs.writeFileSync(path.join(smartMonster, '七十二洞妖王.ini'), [
      '[ActStand]',
      'ActionFile=26',
      'StartIndex=2260',
      'PlayCount=4',
      'EmptyCount=6',
      'CalcDir=1',
    ].join('\r\n'));
    const geeCustom = describeMonsterBodyAppearance(
      envir,
      '七十二洞妖王',
      { race: 156 },
      'GEE'
    );
    assert.equal(geeCustom.willIndex, 26);
    assert.equal(geeCustom.imageIndex, 2300);

    const missing = loadMonsterDatabaseDetail(envir, '..\\白野猪');
    assert.equal(missing.dropRateText, '');
    assert.equal(missing.dropRateFileName, '');
    assert.equal(missing.iconText, '');
    assert.equal(missing.icons.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('database-detail.test.js: PASS');
}

main();
