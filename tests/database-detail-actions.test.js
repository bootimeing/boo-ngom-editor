const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { handleDatabaseDetailMutation } = require('../out/utils/database-detail-actions');
const { decodeTextFile, encodeTextFile } = require('../out/utils/text');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-detail-actions-'));
  try {
    const envir = path.join(temporary, 'Envir');
    fs.mkdirSync(envir);
    const messages = [], resolutions = [];
    const options = {
      envirDirectory: envir,
      engine: 'GOM',
      postMessage: message => messages.push(message),
      resolveImage: (wil, idx) => {
        resolutions.push([wil, idx]);
        return { url: `image:${wil}/${idx}`, width: 20, height: 30, offsetX: -2, offsetY: 3 };
      },
      resolveArchiveImage: (pak, idx) => ({ url: `archive:${pak}/${idx}`, width: 50, height: 70 }),
    };
    const send = message => { messages.length = 0; return handleDatabaseDetailMutation(message, options); };
    for (const unknown of [null, [], {}, { type: 'sidebarReady' }, { type: 'deleteDatabaseRow' }]) {
      assert.equal(send(unknown), false);
      assert.equal(messages.length, 0);
    }
    for (const type of ['saveMonsterDetail', 'saveItemDesc']) {
      assert.equal(handleDatabaseDetailMutation({ type, name: '测试', key: 'itemDesc', text: '' }, {
        ...options, envirDirectory: undefined,
      }), true);
      assert.equal(messages.at(-1).ok, false);
      assert.match(messages.at(-1).message, /工作区/);
    }

    const topPath = path.join(envir, 'ItemDescTopList.txt');
    const itemPath = path.join(envir, 'ItemDescList.txt');
    for (const encoding of ['gbk', 'utf8', 'utf8-bom']) {
      const original = ';描述注释\r\n木剑=旧备注\r\n其他物品=保留文字\n';
      fs.writeFileSync(topPath, encodeTextFile(original, encoding));
      fs.writeFileSync(itemPath, encodeTextFile('木剑=物品说明\n其他物品=不变\n', encoding));
      const untouched = fs.readFileSync(itemPath);
      const text = '新备注 <IMG:12:7:0:0> <PLAYIMG:7:20:3:80>\\第二显示行';
      assert.equal(send({ type: 'saveItemDesc', name: '木剑', key: 'topDesc', text }), true);
      const saved = decodeTextFile(fs.readFileSync(topPath));
      assert.equal(saved.encoding, encoding);
      assert.equal(saved.text, original.replace('木剑=旧备注', `木剑=${text}`));
      assert.deepEqual(fs.readFileSync(itemPath), untouched);
      const detail = messages.find(message => message.type === 'showDatabaseDetail');
      assert.equal(detail.name, '木剑');
      assert.equal(detail.topDesc, text);
      assert.equal(detail.itemDesc, '物品说明');
      assert.equal(detail.preserveSelectionVisuals, true);
      assert.deepEqual(detail.fields, {});
      assert.equal(detail.images['<IMG:12:7:0:0>'], 'image:7/12');
      assert.deepEqual(detail.animatedImages['<PLAYIMG:7:20:3:80>'], {
        frames: ['image:7/20', 'image:7/21', 'image:7/22'], speedMs: 80,
      });
      assert.equal(messages.at(-1).type, 'itemDescSaveResult');
      assert.equal(messages.at(-1).ok, true);
    }
    assert.ok(resolutions.some(([wil, idx]) => wil === 7 && idx === 12));

    fs.writeFileSync(itemPath, encodeTextFile('其他=保留\n', 'utf8-bom'));
    send({ type: 'saveItemDesc', name: '木剑', key: 'itemDesc', text: '' });
    assert.equal(decodeTextFile(fs.readFileSync(itemPath)).text, '其他=保留\n木剑=\n');
    fs.unlinkSync(itemPath);
    send({ type: 'saveItemDesc', name: '木剑', key: 'itemDesc', text: '新建备注' });
    assert.equal(decodeTextFile(fs.readFileSync(itemPath)).encoding, 'gbk');

    const beforeInvalid = fs.readFileSync(itemPath);
    for (const bad of [
      { key: 'unexpected' }, { name: '' }, { name: '木剑\n其他' }, { name: '木剑=其他' },
      { name: {} }, { text: undefined }, { text: {} }, { text: '第一行\n其他=注入' }, { text: '\0' },
      { text: 'GBK不支持的字符😀' },
    ]) {
      assert.equal(send({ type: 'saveItemDesc', name: '木剑', key: 'itemDesc', text: '正常', ...bad }), true);
      assert.equal(messages.at(-1).type, 'itemDescSaveResult');
      assert.equal(messages.at(-1).ok, false);
      assert.deepEqual(fs.readFileSync(itemPath), beforeInvalid);
    }

    const fields = { Name: '白野猪', Appr: 14, HP: 1234, Race: 81 };
    send({ type: 'saveMonsterDetail', name: '白野猪', key: 'dropRateText', text: '1/2 木剑\n',
      fields, columnLabels: { HP: '生命值' }, columnDescriptions: { HP: '怪物生命值' } });
    const dropPath = path.join(envir, 'MonItems', '白野猪.txt');
    assert.equal(decodeTextFile(fs.readFileSync(dropPath)).text, '1/2 木剑\r\n');
    let detail = messages.at(-1);
    assert.equal(detail.type, 'showDatabaseDetail');
    assert.equal(detail.detailKind, 'monster');
    assert.deepEqual(detail.fields, fields);
    assert.deepEqual(detail.columnLabels, { HP: '生命值' });
    assert.ok(detail.monsterBody.url.startsWith('archive:'));
    assert.equal(detail.saveResult.ok, true);
    send({ type: 'saveMonsterDetail', name: '白野猪', key: 'iconText', text: '7 20 2 0 0 0 100', fields });
    detail = messages.at(-1);
    assert.deepEqual(detail.monsterIcons[0].frames, ['image:7/20', 'image:7/21']);
    const iconPath = path.join(envir, 'MonIcons', '白野猪.txt');
    const iconBefore = fs.readFileSync(iconPath);
    for (const bad of [
      { name: '../outside' }, { name: '白野猪:stream' }, { name: '..' }, { key: 'other' },
      { text: {} }, { text: 'invalid icon syntax' },
    ]) {
      send({ type: 'saveMonsterDetail', name: '白野猪', key: 'iconText', text: '7 21', ...bad });
      assert.equal(messages.at(-1).type, 'monsterDetailSaveResult');
      assert.equal(messages.at(-1).ok, false);
      assert.deepEqual(fs.readFileSync(iconPath), iconBefore);
    }
    assert.equal(fs.existsSync(path.join(temporary, 'outside.txt')), false);
    messages.length = 0;
    handleDatabaseDetailMutation({ type: 'saveItemDesc', name: '木剑', key: 'itemDesc', text: '<IMG:5:7:0:0>' }, {
      ...options, resolveImage: () => { throw Error('preview unavailable'); },
    });
    assert.equal(messages.at(-1).ok, true, 'a committed save must not be reported as a failed write');
    assert.match(messages.at(-1).message, /已保存.*详情刷新失败/);
    assert.match(decodeTextFile(fs.readFileSync(itemPath)).text, /木剑=<IMG:5:7:0:0>/);
    console.log('database-detail-actions.test.js: PASS (shared dispatch, safe names/text, preserved encodings/EOL, ancillary-file isolation, IMG/PLAYIMG, monster previews and explicit results)');
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

main();
