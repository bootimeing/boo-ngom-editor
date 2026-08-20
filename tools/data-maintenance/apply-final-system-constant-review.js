const fs = require('node:fs');
const path = require('node:path');
const cheerio = require('cheerio');
const {
  decodeHtml,
} = require('./audit-engine-language-accuracy');

const projectRoot = path.resolve(__dirname, '..', '..');

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find(argument => argument.startsWith(prefix));
  return value ? path.resolve(value.slice(prefix.length)) : fallback;
}

const helpBase = path.join(
  process.env.LOCALAPPDATA || '',
  'Temp',
  'boo-help-audit-20260726-final'
);

const helpRoots = {
  GOM: option('gom-help', path.join(helpBase, 'gom')),
  GEE: option('gee-help', path.join(helpBase, 'gee')),
  '996PC': option('996pc-help', path.join(helpBase, '996pc')),
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(
    path.join(projectRoot, relativePath),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8'
  );
}

function normalizedPage(source) {
  return String(source?.page || '').replace(/\\/g, '/');
}

function marker(entry) {
  return String(entry.full || `<$${entry.name}>`).trim().toUpperCase();
}

function isGenericDescription(value) {
  return /^(?:GOM|GEE|996PC)\s*文档[:：]/.test(String(value || '').trim())
    || /^(?:脚本变量大全\[!\]|系统常量|系统变量)$/.test(String(value || '').trim())
    || !String(value || '').trim();
}

const pageCache = new Map();

function loadPage(engine, source) {
  const relativePath = normalizedPage(source);
  const key = `${engine}:${relativePath.toLowerCase()}`;
  if (pageCache.has(key)) return pageCache.get(key);
  const file = path.join(helpRoots[engine], ...relativePath.split('/'));
  if (!fs.existsSync(file)) throw new Error(`${engine} 帮助页不存在: ${relativePath}`);
  const $ = cheerio.load(decodeHtml(file), { decodeEntities: false });
  const value = { $, relativePath };
  pageCache.set(key, value);
  return value;
}

function cellText($, cell) {
  return $(cell).text().replace(/\s+/g, ' ').trim();
}

function tableDescription(engine, entry) {
  const { $, relativePath } = loadPage(engine, entry.source);
  const wanted = marker(entry);
  let result = '';
  $('tr').each((_, row) => {
    if (result) return;
    const cells = $(row).find('th,td').toArray().map(cell => cellText($, cell));
    const index = cells.findIndex(value => value.toUpperCase().includes(wanted));
    if (index < 0) return;
    if (cells.length === 2) {
      result = cells[index === 0 ? 1 : 0];
      return;
    }
    if (/装备位置\.htm$/i.test(relativePath) && cells.length === 5) {
      const [itemType, , position] = cells;
      if (index === 3) result = `${itemType}名称（穿戴位置 ${position}）`;
      if (index === 4) result = `${itemType}唯一 ID（穿戴位置 ${position}，取下后保留）`;
    }
  });
  return result;
}

const constantDescriptions996 = {};
const describe = (name, description) => {
  constantDescriptions996[name.toUpperCase()] = description;
};

const manualDescriptionsByEngine = {
  GOM: {
    CURREATEITEM: '本次批量使用的叠加消耗物品 IDX',
  },
  GEE: {},
  '996PC': constantDescriptions996,
};

for (let index = 1; index <= 6; index++) {
  describe(`TAGMAPNAME${index}`, `记忆石第 ${index} 组记录的地图名称`);
  describe(`TAGX${index}`, `记忆石第 ${index} 组记录的 X 坐标`);
  describe(`TAGY${index}`, `记忆石第 ${index} 组记录的 Y 坐标`);
}

for (const [legacy, modern, label] of [
  ['ARMRING_L', 'ARMRINGL', '左手镯'],
  ['ARMRING_R', 'ARMRINGR', '右手镯'],
  ['RING_L', 'RINGL', '左戒指'],
  ['RING_R', 'RINGR', '右戒指'],
  ['SARMRING_L', 'SARMRINGL', '时装左手镯'],
  ['SARMRING_R', 'SARMRINGR', '时装右手镯'],
  ['SRING_L', 'SRINGL', '时装左戒指'],
  ['SRING_R', 'SRINGR', '时装右戒指'],
]) {
  describe(legacy, `${label}名称（客户端面板中应使用 <$${modern}>）`);
  describe(modern, `${label}名称（客户端面板常量写法）`);
}

Object.entries({
  BACKRECOVERYJB: '当前装备回收获得的金币',
  BACKRECOVERYJGS: '当前装备回收获得的金刚石',
  BACKRECOVERYJYZ: '当前装备回收获得的经验',
  BACKRECOVERYLF: '当前装备回收获得的灵符',
  BACKRECOVERYNAME: '当前回收的装备名称',
  BACKRECOVERYNUM: '当前回收的装备数量',
  BACKRECOVERYPD: '当前装备回收获得的泡点',
  BACKRECOVERYRYZ: '当前装备回收获得的荣誉值',
  BACKRECOVERYYB: '当前装备回收获得的元宝',
  BACKRECOVERYYXD: '当前装备回收获得的游戏点',
  BAGITEMMAKEINDEX: '准星选中的包裹物品唯一 ID',
  BAGITEMNAME: '准星选中的包裹物品名称',
  BAGITEMSTIDX: '准星选中的包裹物品 IDX',
  G_BAGITEMNAME: '准星选中的包裹物品改名后名称',
  G_USEITEMNAME: '当前使用物品改名后名称',
  USEITEMMAKEIDX: '当前使用物品的 IDX',
  USEITEMMAKEINDEX: '当前使用物品的唯一 ID',
  USEITEMNAME: '当前使用物品的名称',
  'C.GAMEGOLD': '当前对象的游戏币数量',
  'C.GOLDCOUNT': '当前对象的金币数量',
  'C.HP': '当前对象的生命值',
  'C.LEVEL': '当前对象的等级',
  'C.PKPOINT': '当前对象的 PK 值',
  'C.USERNAME': '当前对象的人物名称',
  CURRRUSEMAGICID: '当前使用的魔法或技能 ID',
  ARCHERFEE: '城堡雇用每个弓箭手所需金币',
  CASTLEDOORSTATE: '城门当前状态',
  CASTLEGOLD: '城堡金库当前金币数量',
  REPAIRDOORGOLD: '修理城门所需金币',
  REPAIRWALLGOLD: '修理城墙所需金币',
  TODAYINCOME: '城堡当日收入',
  BUYITEMMONEYTYPE: '个人商店当前购买或出售物品的货币类型值',
  BUYITEMMONEYTYPENAME: '个人商店当前购买或出售物品的货币名称',
  BUYITEPRICE: '个人商店当前购买或出售物品的价格',
  CURRTEMMAKEINDEX: '当前物品的唯一 ID',
  USERSHOPBUYER: '个人商店当前买家的人物名称',
  USERSHOPSELLER: '个人商店当前卖家的人物名称',
  GENMONALLNAME: '当前刷新怪物的完整名称（包含数字后缀）',
  GENMONMAP: '当前刷新怪物所在地图',
  GENMONNAME: '当前刷新怪物的名称',
  GENMONX: '当前刷新怪物的 X 坐标',
  GENMONY: '当前刷新怪物的 Y 坐标',
  BUYSHOPEITEMCNT: '当前商铺购买的物品数量',
  BUYSHOPEITEMID: '当前商铺购买使用的货币 ID',
  BUYSHOPEITEMMONEY: '当前商铺购买的金额',
  BUYSHOPEITEMNAME: '当前商铺购买的物品名称',
  BUYSHOPEITEMPRICE: '当前商铺购买的物品单价',
  'DLGITEM.DURA': 'OK 对话框中当前物品的持久值',
  'DLGITEM.DURAMAX': 'OK 对话框中当前物品的最大持久值',
  'DLGITEM.NAME': 'OK 对话框中当前物品的名称',
  'DLGITEM.STDMODE': 'OK 对话框中当前物品的 StdMode',
  GUILDAURAEPOINT: '当前行会人气度',
  GUILDBUILDPOINT: '当前行会建设度',
  GUILDFLOURISHPOINT: '当前行会繁荣度',
  GUILDSTABILITYPOINT: '当前行会安定度',
  NATIONID: '当前人物所属国家 ID',
  NATIONJOB1: '当前国家第 1 个官职的人物名称',
  NATIONJOB10: '当前国家第 10 个官职的人物名称',
  NATIONJOBID: '当前人物的国家官职 ID',
  LASTHPBBX: '宝宝下线保护记录的生命值',
  LASTLEVELBBX: '宝宝下线保护记录的等级',
  LASTNAMEBBX: '宝宝下线保护记录的名称',
  LASTTIMEBBX: '宝宝下线保护记录的时间',
  INSURANCECOUNT: '当前投保装备的剩余投保次数',
  INSURANCECURRENCY: '当前装备投保使用的货币类型',
  INSURANCEGOLD: '当前装备投保所需货币数量',
  INSURANCEITEMNAME: '当前投保装备的名称',
  GUILDWARFEE: '行会宣战所需费用',
  UPGRADEWEAPONFEE: '升级武器所需费用',
  USERWEAPON: '当前人物所使用的武器名称',
  CURRTAKETEMPOS: '人物当前穿脱装备的位置',
  'H.CURRTAKETEMPOS': '英雄当前穿脱装备的位置',
  'H.CURRTEMMAKEINDEX': '英雄当前穿脱装备的唯一 ID',
  SCATTERITEMNAME: '地图事件中当前散落物品的名称',
  SCATTERITEMX: '地图事件中当前散落物品的 X 坐标',
  SCATTERITEMY: '地图事件中当前散落物品的 Y 坐标',
  KILLSLAVEMASTERNAME: '被杀宝宝的主人名称',
  SLAVEBBNAME: '当前宝宝名称',
  SLAVEUPGRADENAME: '当前升级宝宝的名称',
  'H.CURRRTARGETNAME': '英雄当前攻击目标的名称',
  'H.CURRRUSEMAGICID': '英雄当前使用的魔法或技能 ID',
  HUMCLONECOUNT: '当前人物的分身数量',
  DRESSID: '当前身上衣服的唯一 ID',
  USEITEM0: '当前身上 0 号装备位的物品名称',
  WEAPONID: '当前身上武器的唯一 ID',
  SCRIPTPARAM1: 'NPC 脚本点击触发传入的第 1 个参数',
  SCRIPTPARAM2: 'NPC 脚本点击触发传入的第 2 个参数',
  SCRIPTPARAM3: 'NPC 脚本点击触发传入的第 3 个参数',
  CURRMONEY: '货币改变后的数量',
  OLDMONEY: '货币改变前的数量',
  CHAT: '当前聊天消息的频道类型',
  CHATMSG: '当前聊天消息的文本内容',
  MOUSEX: '使用技能前鼠标指向的 X 坐标',
  MOUSEY: '使用技能前鼠标指向的 Y 坐标',
  NEWBAGITEM: '刚进入包裹的物品 IDX',
  NEWBAGITEMNAME: '刚进入包裹的物品名称',
  EXPIREDITEMNAME: '人物当前到期的限时物品名称',
  'H.EXPIREDITEMNAME': '英雄当前到期的限时物品名称',
  GUILDMEMBERCNT: '当前行会成员数量',
  GUILDNAMENOTICE: '行会触发中的当前行会名称',
  BAGCOUNT: '当前包裹中的物品数量（包含 OK 框和摆摊物品）',
  BAGMAXCOUNT: '当前包裹允许存放的最大物品数量',
  ADDVALUE0: '当前物品 0 号附加属性点数',
  ADDVALUEX: '当前物品指定附加属性 ID 的点数，X 为属性 ID',
  MACHINEID: '当前客户端机器码',
  USERMACHINEID: '当前人物绑定或记录的机器码',
  'MOVE.DEST.NAME': '极品属性转移的目标物品名称',
  'MOVE.SOURCE.NAME': '极品属性转移的来源物品名称',
  CURRTASKID: '当前客户端点击任务的 ID',
  REALUSERNAME: '浑水摸鱼模式下的真实人物名称',
  MONKILLER: '杀死当前怪物的对象名称',
  STALLNAME: '当前摆摊或个人商店名称',
  PARAM1: '当前暴击触发传入的第 1 个参数',
  PARAM2: '扔物品前触发来源：0 为主动扔掉，1 为人物掉落',
  PARAM3: '杀死人物触发传入的第 3 个参数',
  PARAM4: '杀死人物触发传入的第 4 个参数',
  DAMAGEVALUE: '当前被攻击掉血前计算的伤害值',
  USERID: '查看对方装备时对方的用户 ID',
  CURRRTARGETFULLNAME: '当前攻击目标的完整名称（不去除数字后缀）',
  OLDMAP: '切换地图前所在的地图编号',
  DARLINGPET: '被杀宝宝的主人名称',
  CURREATEITEMCOUNT: '200 类叠加物品使用时的消耗数量',
  ADDMAXBW: '脚本额外增加的背包最大负重',
  DEALPLAYNNAME: '当前交易对象的人物名称',
  TIMERESULT: '两个时间之间的相差秒数',
  GAMEID: '数据消息上报使用的游戏 ID',
  NEWBAGITEMID: '刚进入包裹的物品唯一 ID',
  LASTMAILOPTYPEID: '最近一次邮件操作的类型 ID',
  LOOKHUMNAME: '自定义装备位操作中当前查看的人物名称',
  JOB: 'IF(2) 多条件判断中当前人物的职业',
  'H.DAMAGEVALUE': '英雄宝宝攻击前计算的伤害值',
  'H.CURRTEMNAME': '英雄当前穿戴或脱下的物品名称',
  'H.CURRRTARGETFULLNAME': '英雄当前攻击目标的完整名称',
  'H.USERNEWNAME': '英雄在线改名后的新名称',
  AUTOPLAYGAMEERR: '前端请求挂机但引擎未执行挂机的累计次数',
  USERNEWNAME: '人物在线改名后的新名称',
  SHOWITEM: '物品合成界面中当前展示的物品',
  USERSTATENAME: '自定义人物装备框中当前查看的人物名称',
  HEROUSEITEM: '聚灵珠触发中的使用位置：0 为人物背包，1 为英雄背包',
  MP: '当前魔法值',
}).forEach(([name, description]) => describe(name, description));

for (let index = 1; index <= 6; index++) {
  describe(`G_JEWELRYITEM${index}`, `人物首饰盒第 ${index} 格物品的改名名称`);
  describe(`H.G_JEWELRYITEM${index}`, `英雄首饰盒第 ${index} 格物品的改名名称`);
  describe(`H.JEWELRYITEM${index}`, `英雄首饰盒第 ${index} 格物品名称`);
}
describe('H.JEWELRYITEM1ID', '英雄首饰盒第 1 格物品唯一 ID');
describe('H.JEWELRYITEM6UD', '英雄首饰盒第 6 格物品唯一 ID（引擎常量拼写为 UD）');

for (let index = 1; index <= 12; index++) {
  describe(`G_GODBLESSITEM${index}`, `人物神佑盒第 ${index} 格物品的改名名称`);
  describe(`H.G_GODBLESSITEM${index}`, `英雄神佑盒第 ${index} 格物品的改名名称`);
  describe(`H.GODBLESSITEM${index}`, `英雄神佑盒第 ${index} 格物品名称`);
}

for (const prefix of ['LINKITEM', 'H.LINKITEM']) {
  const owner = prefix.startsWith('H.') ? '英雄' : '人物';
  describe(`${prefix}.COUNT`, `${owner}当前关联背包物品的数量`);
  describe(`${prefix}.INDEX`, `${owner}当前关联背包物品的 IDX`);
  describe(`${prefix}.NAME`, `${owner}当前关联背包物品的名称`);
}

const variableDescriptions = {
  'L$': 'L$ 数组或列表变量，通过 <$STR(L$变量名)> 取值',
  PARAM0: '自定义命令或触发传入的第 0 个参数',
  'STR(A0)': 'A0-A999 全局字符串变量，保存到 GlobalVal.ini',
  'STR(G0)': 'G0-G999 全局数值变量，保存到 GlobalVal.ini',
  'STR(M0)': 'M0-M999 人物私有数值变量，换地图保留，离线清除',
  'STR(N$': 'N$ 自定义人物私有数值变量',
  'STR(N0)': 'N0-N999 人物私有数值变量，小退清除',
  'STR(P0)': 'P0-P999 当前 NPC 对话临时数值变量，对话关闭后清除',
  'STR(S$': 'S$ 自定义人物私有字符串变量',
  'STR(S0)': 'S0-S999 人物私有字符串变量，离线清除',
};

function main() {
  const variables = readJson('data/variables.json');
  const catalogs = {
    GOM: readJson('data/constants-gom.json'),
    GEE: readJson('data/constants-gee.json'),
    '996PC': readJson('data/constants-996pc.json'),
  };
  const changed = { table: 0, manual996: 0, variables: 0 };

  for (const [engine, catalog] of Object.entries(catalogs)) {
    for (const entry of catalog.constants || []) {
      if (!entry.completionEnabled && !entry.diagnosticSupported) continue;
      const exactDescription = tableDescription(engine, entry);
      if (exactDescription && exactDescription !== entry.description) {
        entry.description = exactDescription;
        entry.descriptionReview = 'final-own-help-table-exact';
        changed.table++;
      }
      if (isGenericDescription(entry.description)) {
        const description = manualDescriptionsByEngine[engine]?.[entry.name.toUpperCase()];
        if (!description) continue;
        entry.description = description;
        entry.descriptionReview = 'final-own-help-manual';
        if (engine === '996PC') changed.manual996++;
      }
    }
  }

  const constantsByEngine = Object.fromEntries(Object.entries(catalogs).map(([engine, catalog]) => {
    const byName = new Map();
    const byFull = new Map();
    for (const entry of catalog.constants || []) {
      byName.set(entry.name.toUpperCase(), entry);
      if (entry.full) byFull.set(entry.full.toUpperCase(), entry);
    }
    return [engine, { byName, byFull }];
  }));

  for (const variable of variables.variables || []) {
    for (const engine of variable.engines || []) {
      const variant = variable.engineVariants?.[engine];
      if (!variant) continue;
      const lookup = constantsByEngine[engine];
      const constant = lookup?.byName.get(variant.name.toUpperCase())
        || lookup?.byFull.get(String(variant.full || '').toUpperCase());
      const manual = engine === '996PC'
        ? variableDescriptions[variant.name.toUpperCase()]
        : '';
      const description = manual || constant?.description;
      if (!description || description === variant.desc) continue;
      variant.desc = description;
      variant.descriptionReview = manual
        ? 'final-own-help-manual'
        : constant.descriptionReview || 'final-own-help-matched-constant';
      changed.variables++;
    }
  }

  const unresolvedConstants = Object.entries(catalogs).flatMap(([engine, catalog]) => (
    catalog.constants
      .filter(entry => (
        (entry.completionEnabled || entry.diagnosticSupported)
        && isGenericDescription(entry.description)
      ))
      .map(entry => `${engine}:${entry.name}`)
  ));
  const unresolvedVariables = (variables.variables || []).filter(variable => {
    const variant = variable.engineVariants?.['996PC'];
    return variable.engines?.includes('996PC')
      && variant
      && isGenericDescription(variant.desc);
  });
  if (unresolvedConstants.length || unresolvedVariables.length) {
    throw new Error([
      `未处理常量: ${unresolvedConstants.join(', ')}`,
      `996PC 未处理变量: ${unresolvedVariables.map(entry => entry.name).join(', ')}`,
    ].join('\n'));
  }

  writeJson('data/variables.json', variables);
  writeJson('data/constants-gom.json', catalogs.GOM);
  writeJson('data/constants-gee.json', catalogs.GEE);
  writeJson('data/constants-996pc.json', catalogs['996PC']);
  console.log(JSON.stringify(changed, null, 2));
}

if (require.main === module) main();

module.exports = {
  constantDescriptions996,
  isGenericDescription,
  tableDescription,
  variableDescriptions,
};
