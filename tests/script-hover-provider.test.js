const assert = require('node:assert/strict');
const path = require('node:path');
const { loadCommandsData, loadEngineFunctionCatalog, loadManualUpdate, loadStaticLanguageData } = require('../out/data/loader');
const { buildLanguageIndex } = require('../out/utils/command-index');
const { activateWithStub, makeDocument, TestPosition } = require('./helpers/assistant-host');

function verifyManualSources() {
  const root = path.join(__dirname, '..');
  const log = message => assert.doesNotMatch(message, /无法读取|加载失败/);
  const commands = loadCommandsData(root, log);
  const functions = loadEngineFunctionCatalog(root, log);
  const say = loadStaticLanguageData(root, log).saySnippets;
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const update = loadManualUpdate(root, engine, log);
    const index = buildLanguageIndex(commands, null, functions, engine);
    assert.match(update.sha256, /^[a-f0-9]{64}$/i);
    for (const [name, definition] of Object.entries(update.functions)) {
      const entry = index.commandByName.get(name.toUpperCase());
      assert.equal(entry?.fromCurrentManual, true, engine + ' ' + name);
      assert.equal(entry.kind, definition.kind, name);
      assert.deepEqual(entry.source, definition.source, name);
      assert.deepEqual(entry.params, definition.paramList, name);
      assert.equal(entry.completionVerified, definition.completionVerified, name);
    }
    for (const name of update.removedFunctions || []) assert(!index.commandByName.has(name.toUpperCase()), name);
    assert.equal(new Set(update.saySnippets.map(row => row.id)).size, update.saySnippets.length);
    for (const { id, ...variant } of update.saySnippets) {
      assert.deepEqual(say.find(row => row.id === id)?.engineVariants[engine], variant, engine + ' ' + id);
    }
    if (engine === '996PC') {
      assert(!index.commandCompletions.some(row => row.name.toUpperCase() === 'RECALLMOBEX'));
      assert.equal(index.commandByName.get('ADDBUTTON').snippet, 'ADDBUTTON ${1:主窗口ID} ${2:图标ID} ${3:图标路径}');
    }
    if (engine === 'GEE') {
      assert.doesNotMatch(index.commandByName.get('OPENSWORD').snippet, /65535/);
      assert(!index.commandCompletions.some(row => row.name.toUpperCase() === 'GENDERMAN'));
      assert.deepEqual(index.commandByName.get('MAP').contexts, ['ACT']);
      assert.deepEqual(index.commandByName.get('GENDER').contexts, ['IF']);
    }
  }
}

async function main() {
  verifyManualSources();
  const host = activateWithStub();
  let checks = 0;
  let engine = 'GOM';
  async function useEngine(value) {
    engine = value;
    host.setEngine(engine);
    for (const callback of host.events.onDidChangeConfiguration) {
      await callback({ affectsConfiguration: key => key === 'boo.engine' });
    }
  }
  function check(script, fragment, expected, rangeText) {
    const doc = makeDocument(script);
    const start = script.lastIndexOf(fragment);
    assert.notEqual(start, -1, fragment);
    for (const offset of new Set([start, start + fragment.length - 1])) {
      const position = doc.positionAt(offset);
      const hover = host.providers.Hover.provideHover(doc, new TestPosition(position.line, position.character));
      const message = engine + ' ' + script + ' at ' + fragment;
      if (expected === null) assert.equal(hover, null, message);
      else {
        assert.match(hover?.contents.value || '', expected, message);
        if (rangeText !== undefined) assert.equal(doc.getText(hover.range), rangeText, message);
      }
      checks++;
    }
  }
  function checkObjectAndConditionHovers() {
    // Compare the actual Markdown, including the signature and parameters.
    // A legacy qualified entry may have the same name but different details.
    function sameCommand(bare, invocation, name) {
      const doc = makeDocument(bare);
      const original = host.providers.Hover.provideHover(doc, doc.positionAt(bare.indexOf(name)));
      assert.ok(original?.contents.value.startsWith('###'), bare);
      const called = makeDocument(invocation);
      const cursor = invocation.toUpperCase().lastIndexOf(name.toUpperCase());
      assert.notEqual(cursor, -1, name);
      for (const offset of [cursor, cursor + name.length - 1]) {
        const hover = host.providers.Hover.provideHover(called, called.positionAt(offset));
        assert.equal(hover?.contents.value, original.contents.value, invocation);
        checks++;
      }
    }
    if (engine !== 'GEE') {
      const drop = 'SETMONBURSTITEMS 骨玉权杖 5';
      for (const object of ['M', 'l', 'FL', 'BB', 'H.M', '<$CURRRTARGETNAME>', '<$STR(S$对象)>', '996引擎']) {
        const line = '#ACT\n' + object + '.' + drop.toLowerCase();
        sameCommand(drop, line, 'SETMONBURSTITEMS');
        check(line, '骨玉权杖', /物品名称|物品名/, '骨玉权杖');
        check(line, '5', /数量/, '5');
      }
    } else {
      check('#ACT\nM.SETMONBURSTITEMS 骨玉权杖 5', 'SETMONBURSTITEMS', /兼容提示/);
    }
    const simple = '#IF\nNOT CHECKGAMEGOLD > 50';
    check(simple, 'NOT', /### `NOT`/i, 'NOT');
    sameCommand('CHECKGAMEGOLD > 50', simple, 'CHECKGAMEGOLD');
    check(simple, '>', /控制符|比较符/, '>');
    check(simple, '50', /点数|数量/, '50');
    sameCommand('CHECKGAMEGOLD > 50', '#IF\nM.NOT CHECKGAMEGOLD > 50', 'CHECKGAMEGOLD');
    for (const object of ['H', 'fl', 'BB', 'H.M', '<$CURRRTARGETNAME>', '<$STR(S$对象)>.H', '996引擎']) {
      const line = '#IF(nOt ' + object + '.checklevelex > 80)';
      sameCommand('CHECKLEVELEX > 80', line, 'CHECKLEVELEX');
      check(line, '80', /等级/, '80');
    }
    if (engine === 'GOM') {
      sameCommand('CHANGEMODEEX 11 5', 'M.CHANGEMODEEX 11 5', 'CHANGEMODEEX');
      check('M.GETMONADDBYTE 1 N0', 'GETMONADDBYTE', /GETMONADDBYTE.*标识号/is);
    }
  }
  try {
    checkObjectAndConditionHovers();
    check('#SAY\n<$ATTR[238]>', '238', /暴击伤害抗性/, '<$ATTR[238]>');
    check('#SAY\n<$ATTR[239]>', '239', /神力抗性/, '<$ATTR[239]>');
    check('#SAY\n<$ATTR[240]>', '240', null);
    check('#SAY\n<$H.HP>', 'H.HP', /H\.HP/, '<$H.HP>');
    assert(host.selectors.Hover.some(s => s.language === 'gomscript' && s.scheme === 'untitled'));
    const image = '#ACT\nMOV S$组件 <Img:#L1~#L2:1294:<$STR(N$资源编号)>:40:20>';
    check(image, 'Img', /显示静态图片/, '<Img');
    check(image, '#L1~#L2', /容器/, '#L1~#L2');
    check(image, '1294', /图片索引/, '1294');
    check(image, '资源编号', /WIL 资源序号/, '<$STR(N$资源编号)>');
    check(image, '40', /横向坐标/, '40');
    check('<&ITEMSHOW:123:1:20:30>', '123', /物品数据库原始 Idx/i, '123');
    check('<&ITEMSHOW:123:1:20:30', '30', /纵向坐标/, '30');
    const text = '#SAY\n<Text:#B1:装备培养说明|点击查看培养步骤:10:20{FCOLOR=251;FSIZE=17}/@查看>';
    check(text, '装备培养说明', /显示的文字/, '装备培养说明');
    check(text, '点击查看培养步骤', /悬停备注/, '点击查看培养步骤');
    check(text, '10', /横向坐标/, '10');
    check(text, 'FSIZE', /字号/, 'FSIZE');
    check(text, '17', /字号/, '17');
    check(text, '>', null);
    check(text, '@查看', /点击.*脚本标签/, '@查看');
    const inline = '<Text:#L10~:{动态文字/AUTOCOLOR=254,251}{固色|158}:80:23>';
    check(inline, 'AUTOCOLOR', /自动变色/, 'AUTOCOLOR');
    check(inline, '254,251', /自动变色/, '254,251');
    check(inline, '158', /文字前景色/, '158');
    check(inline, '80', /横向坐标/, '80');
    check('<Looks:<$STR(N$外观)>:10:20>', '外观', /Looks|外观/i, '<$STR(N$外观)>');
    check('<DnItems:174:0:60:70>', 'DnItems', /DnItems/i);
    check('<DnItems:174:0:60:70>', '174', null);
    check('#IF\nCHECKGETARGET 2', '2', /队友/, '2');
    check('; <&ITEMSHOW:123:1:20:30>', 'ITEMSHOW', null);
    check('// <Text:装备:10:20>', '10', null);
    check('<UnknownPanel|x=12345>', '12345', null);
    check('<EquipShow|effectshow=3>', 'effectshow', null);

    await useEngine('GEE');
    checkObjectAndConditionHovers();
    check('#ACT\nSendCenterMsg 250 0 公告 1 5 @结束 0 80 91', '91', /公告 Y 坐标/, '91');
    check('#IF\nCheckSwordCount < 2', '2', /飞剑数量/, '2');
    check('#ACT\nOpenSword 30', 'OpenSword', /开启或关闭人物飞剑/);
    check('#ACT\nMap G012', 'G012', /目标地图编号/, 'G012');
    check('#ACT\nHairColor 64 128 255', '128', /绿色分量/, '128');
    check('#ACT\nReset [100] 7', '7', /连续清除的标志数量/, '7');
    check('#IF\nGender MAN', 'MAN', /检测男性/, 'MAN');
    const submit = '<Text:只提交姓名年龄:10:6:1,2/@提交部分>';
    check(submit, '1,2', /提交的输入框/, '1,2');
    check(submit, '@提交部分', /点击后执行/, '@提交部分');
    check('<UserItem:0:占位:12:13:1:0:1>', '占位', /手册.*未说明/, '占位');
    check('<UserItem:0:占位:12:13:1:0:1>', '13', /纵向坐标/, '13');
    check('<UserItem:0:12:13:1>', '12', /横向坐标/, '12');
    check('<HeroUserItem:0:占位:12:13:1:0:1>', '占位', /手册.*未说明/, '占位');
    check('<HeroUserItem:0:占位:12:13:1:0:1>', '1', /查看对象/, '1');
    check('<HeroUserItem:0:12:13:1>', '12', /横向坐标/, '12');
    check('<Text:装备|提示:10:20{FNAME=宋体}/@查看>', '宋体', /字体名称/, '宋体');

    await useEngine('996PC');
    checkObjectAndConditionHovers();
    const button = '#ACT\nMOV S$图标 <Button|wil=Main2|text=领奖|pcnimg=135|link=@领奖>';
    check(button, 'Button', /按钮/, '<Button');
    check(button, 'pcnimg', /正常图片序号/, 'pcnimg=135');
    check(button, '135', /正常图片序号/, 'pcnimg=135');
    check('<Text|text=<$NPCNAME>|x=30|y=20|size=18>', 'NPCNAME', /文字|文本/, 'text=<$NPCNAME>');
    check('<EquipShow|index=0|effectshow=3|showtips=1>', 'effectshow', /内观特效/, 'effectshow=3');
    check('<EquipShow|index=0|effectshow=3|showtips=1>', '3', /内观特效/, 'effectshow=3');
    check('<EquipShow:7:20:40:1:0/@查看>', '7', /装备位置/, '7');
    check('<EquipShow:7:20:40:1:0/@查看>', '40', /纵向坐标/, '40');
    check('<EquipShow:7:20:40:1:0/@查看>', '@查看', /触发标签/, '@查看');
    check('<RText|text=<彩色文字/FCOLOR=250>|x=40>', 'FCOLOR=250', /文字颜色/, 'FCOLOR=250');
    check('<领取/@奖励(20)>', '@奖励', /标签/, '@奖励');
    check('<领取/@奖励(20)>', '20', /参数/, '20');
    const ranking = '#IF\nCheckSelfRankNo < 1 4';
    check(ranking, 'CheckSelfRankNo', /检测人物.*名次/);
    check(ranking, '<', /比较符/, '<');
    check(ranking, '1', /排行榜/, '1');
    check(ranking, '4', /名次/, '4');
    const partial = '#ACT\nAddAttList 分组 + 属性串 42';
    check(partial, '属性串', /属性字符串/, '属性串');
    check(partial, '42', /手册未说明/, '42');
    check('<EquipShow|unknownKey=9876>', '9876', null);
    await useEngine('GOM');
    check('<EquipShow|effectshow=3>', 'effectshow', null);
    console.log('script-hover-provider: PASS (' + checks + ' cursor checks across GOM, GEE and 996PC)');
  } finally { host.dispose(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
