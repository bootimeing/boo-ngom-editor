#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const revision = '2026-07-19';

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(
    path.join(projectRoot, relativePath),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

function source(page, title) {
  return {
    revision,
    page,
    ...(title ? { title } : {}),
  };
}

function corpus(relativePath, line, text) {
  return [{
    kind: 'server-script',
    path: `Mir200/Envir/${relativePath}`,
    line,
    text,
  }];
}

function command({
  details,
  syntax,
  params = [],
  kind = 'action',
  minArgs = params.filter(param => !param.startsWith('[')).length,
  maxArgs = params.length,
  help,
  evidence,
  verified = Boolean(help),
}) {
  return {
    details,
    params: params.join(' '),
    syntax,
    paramList: params,
    kind,
    contexts: [kind === 'check' ? 'IF' : 'ACT'],
    minArgs,
    maxArgs,
    ...(help ? { source: help } : {}),
    completionVerified: verified,
    completionEnabled: verified,
    ...(evidence ? { corpusEvidence: evidence } : {}),
  };
}

function constant({
  name,
  description,
  scope,
  help,
  evidence,
  verified = Boolean(help),
}) {
  return {
    name,
    full: `<$${name}>`,
    description,
    scope,
    ...(help ? { source: help } : {}),
    aliases: [],
    completionVerified: verified,
    completionEnabled: verified,
    ...(!verified ? { diagnosticSupported: true } : {}),
    ...(evidence ? { corpusEvidence: evidence } : {}),
  };
}

function upsertCaseInsensitive(target, name, value) {
  const current = Object.keys(target).find(key => key.toUpperCase() === name.toUpperCase());
  if (current && current !== name) delete target[current];
  target[name] = value;
}

function sortedObject(value) {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right, 'en', { sensitivity: 'base' })
    )
  );
}

function upsertConstants(catalog, entries) {
  const byName = new Map(catalog.constants.map(entry => [entry.name.toUpperCase(), entry]));
  for (const entry of entries) byName.set(entry.name.toUpperCase(), entry);
  catalog.constants = [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
  );
  catalog.generated = '2026-07-23-real-server-compatibility';
}

const gomFunctions = readJson('data/functions.json');
const commands = readJson('data/commands.json');
const gomConstants = readJson('data/constants-gom.json');
const geeConstants = readJson('data/constants-gee.json');
const classificationReport = readJson('data/audit-report/engine-classification.json');

const gomMirrorHelp = source(
  '游戏引擎反外挂系统/游戏功能详解/副本地图使用说明.htm',
  '副本地图使用说明'
);
const gomHelpConfirmed = {
  DELCONFIGFILESECTION: command({
    details: '删除 INI 配置文件中的指定区段',
    syntax: 'DELCONFIGFILESECTION 文件名 区段',
    params: ['文件名', '区段'],
    help: source(
      '游戏引擎反外挂系统/功能操作命令/读写ini配置项.htm',
      '读写ini配置项'
    ),
    evidence: corpus(
      'Market_Def/1大陆/主城/34因果律阵-西岐.txt',
      128,
      'DELCONFIGFILESECTION ..\\QUESTDIARY\\04自定义变量\\因果\\因果之力.TXT <$USERNAME>'
    ),
  }),
  SETUPGRADEITEM: command({
    details: '把指定自定义 OK 框中的物品关联为当前升级物品',
    syntax: 'SETUPGRADEITEM OK框编号',
    params: ['OK框编号'],
    help: source(
      '游戏引擎反外挂系统/游戏功能详解/自定义OK框[!].htm',
      '自定义OK框'
    ),
    evidence: corpus(
      'Market_Def/2大陆/主城/33宝石附魔-武术馆.txt',
      126,
      'SETUPGRADEITEM 0'
    ),
  }),
  RETURNBOXITEM: command({
    details: '把指定自定义 OK 框中的物品退回包裹',
    syntax: 'RETURNBOXITEM OK框编号',
    params: ['OK框编号'],
    help: source(
      '游戏引擎反外挂系统/游戏功能详解/自定义OK框[!].htm',
      '自定义OK框'
    ),
    evidence: corpus(
      'Market_Def/2大陆/地图/55拘魂令-炼魂坛.txt',
      52,
      'RETURNBOXITEM 1'
    ),
  }),
  GETALLDBITEMFIELDVALUE: command({
    details: '获取全身装备指定数据库字段的合计值',
    syntax: 'GETALLDBITEMFIELDVALUE 字段名 结果变量 [排除称号]',
    params: ['字段名', '结果变量', '[排除称号:1排除]'],
    help: source(
      '游戏引擎反外挂系统/功能操作命令/获取全身装备的原始数据字段指定值总和.html',
      '获取全身装备的原始数据字段指定值总和'
    ),
    evidence: corpus(
      'QuestDiary/01属性加载/人物属性.txt',
      104,
      'GETALLDBITEMFIELDVALUE 攻击加成 N$数据库攻击加成'
    ),
  }),
  SETSKILLDECCD: command({
    details: '调整指定技能的冷却缩减时间',
    syntax: 'SETSKILLDECCD 技能名称 操作符(+/-/=) 时间秒',
    params: ['技能名称', '操作符(+/-/=)', '时间秒'],
    help: source(
      '游戏引擎反外挂系统/游戏功能详解/减少技能冷却时间.htm',
      '减少技能冷却时间'
    ),
    evidence: corpus(
      'QuestDiary/01属性加载/特殊属性.txt',
      1938,
      'SETSKILLDECCD 烈火剑法 = <$STR(N$烈火剑法冷却)>'
    ),
  }),
  DELLINKITEM: command({
    details: '删除 LinkBagItem 当前关联的背包物品或指定叠加数量',
    syntax: 'DELLINKITEM [物品数量]',
    params: ['[物品数量:0或省略时删除整个物品]'],
    help: source(
      '游戏引擎反外挂系统/DB数据库资料/31类物品扩展设置.htm',
      '31类物品扩展设置'
    ),
    evidence: corpus(
      'QuestDiary/02游戏触发/双击触发.txt',
      311,
      'DELLINKITEM 1'
    ),
  }),
  STOPCOLLECT: command({
    details: '强制停止当前采集过程',
    syntax: 'STOPCOLLECT',
    params: [],
    help: source(
      '游戏引擎反外挂系统/游戏功能详解/采集类怪物.htm',
      '采集类怪物'
    ),
    evidence: corpus(
      'QuestDiary/02游戏触发/采集触发.txt',
      76,
      'STOPCOLLECT'
    ),
  }),
};

const documentedGomFunctions = {
  MOBFIREBURN: command({
    details: '在指定地图坐标创建光环伤害效果',
    syntax: 'MOBFIREBURN 地图号 坐标X 坐标Y 光环效果 持续时间秒 伤害值 [是否最大HP百分比]',
    params: [
      '地图号',
      '坐标X',
      '坐标Y',
      '光环效果',
      '持续时间秒',
      '伤害值',
      '[是否最大HP百分比:0/空为数值,1为MAXHP百分比]',
    ],
    minArgs: 6,
    maxArgs: 7,
    help: source(
      '游戏引擎反外挂系统/游戏功能详解/MobFireBurn地图光环效果.htm',
      'MobFireBurn地图光环效果'
    ),
  }),
  RENEWLEVEL: command({
    details: '增加人物转生次数，并设置转生后等级和分配点数',
    syntax: 'RENEWLEVEL 转生次数 转生后等级 分配点数',
    params: ['转生次数(1-255)', '转生后等级(0为不改变)', '分配点数(1-20000)'],
    help: source(
      '游戏引擎反外挂系统/部分脚本实例/人物转生[!].htm',
      '人物转生脚本'
    ),
  }),
  CHECKMIRRORMAP: command({
    details: '检测指定镜像地图是否已经创建',
    syntax: 'CHECKMIRRORMAP 镜像地图编号',
    params: ['镜像地图编号'],
    kind: 'check',
    help: gomMirrorHelp,
  }),
  DELMIRRORMAP: command({
    details: '删除动态创建的镜像地图',
    syntax: 'DELMIRRORMAP 镜像地图编号',
    params: ['镜像地图编号'],
    help: gomMirrorHelp,
  }),
  ADDMIRRORMAP: command({
    details: '动态创建临时镜像地图',
    syntax: 'ADDMIRRORMAP 原地图 新地图 新地图名 有效时间 返回地图 小地图',
    params: ['原地图编号', '新地图编号', '新地图显示名', '有效时间秒', '返回地图', '小地图编号'],
    help: gomMirrorHelp,
  }),
  GETRANDOMTEXT: command({
    details: '从文本文件随机读取一行到变量，可指定行',
    syntax: 'GETRANDOMTEXT 文件路径 变量 [指定行]',
    params: ['文件路径', '字符串变量', '[指定行]'],
    minArgs: 2,
    maxArgs: 3,
    help: source(
      '游戏引擎反外挂系统/部分脚本实例/假人自动摆摊.htm',
      '假人自动摆摊'
    ),
  }),
  PLAYDICE: command({
    details: '摇骰子并在结束后跳转到指定脚本标签',
    syntax: 'PLAYDICE 骰子数量 跳转标签',
    params: ['骰子数量', '跳转标签'],
    help: source(
      '游戏引擎反外挂系统/游戏功能详解/在线执行间隔控制.htm',
      '在线执行间隔控制'
    ),
  }),
  DELBOXITEM: command({
    details: '删除指定自定义 OK 框中的物品',
    syntax: 'DELBOXITEM OK框编号 [数量]',
    params: ['OK框编号', '[数量]'],
    minArgs: 1,
    maxArgs: 2,
    help: source(
      '游戏引擎反外挂系统/游戏功能详解/自定义OK框[!].htm',
      '自定义OK框'
    ),
  }),
  PARAM1: command({
    details: '设置后续命令使用的参数1',
    syntax: 'PARAM1 值',
    params: ['值'],
    help: source('游戏引擎反外挂系统/游戏功能详解/巡逻怪物.htm', '巡逻怪物'),
  }),
  PARAM2: command({
    details: '设置后续命令使用的参数2',
    syntax: 'PARAM2 值',
    params: ['值'],
    help: source('游戏引擎反外挂系统/游戏功能详解/巡逻怪物.htm', '巡逻怪物'),
  }),
  PARAM3: command({
    details: '设置后续命令使用的参数3',
    syntax: 'PARAM3 值',
    params: ['值'],
    help: source('游戏引擎反外挂系统/游戏功能详解/巡逻怪物.htm', '巡逻怪物'),
  }),
  PARAM4: command({
    details: '设置后续命令使用的参数4',
    syntax: 'PARAM4 值',
    params: ['值'],
    help: source('游戏引擎反外挂系统/游戏功能详解/巡逻怪物.htm', '巡逻怪物'),
  }),
  CHECKMYSHOP: command({
    details: '检测人物是否已经创建个人商店',
    syntax: 'CHECKMYSHOP',
    params: [],
    kind: 'check',
    help: source(
      '游戏引擎反外挂系统/部分脚本实例/假人自动摆摊.htm',
      '假人自动摆摊'
    ),
  }),
  HCALL: command({
    details: '指定人物触发 QM 脚本标签',
    syntax: 'HCALL 角色名称 触发标签',
    params: ['角色名称', '触发标签'],
    help: source('UpDate2012-2015.htm', '2010-2015年更新记录'),
    evidence: corpus(
      'QuestDiary/02游戏触发/死亡触发.txt',
      92,
      'HCALL <$LASTKILLER> @刷新属性'
    ),
  }),
  ADDATTACKSABUKALL: command({
    details: '设置所有行会在当晚同时攻城',
    syntax: 'ADDATTACKSABUKALL 城堡编号',
    params: ['城堡编号'],
    help: source('UpDate2012-2015.htm', '2010-2015年更新记录'),
    evidence: corpus(
      'Robot_def/RobotManage.txt',
      774,
      'ADDATTACKSABUKALL 0'
    ),
  }),
};

for (const [name, entry] of Object.entries({
  ...documentedGomFunctions,
  ...gomHelpConfirmed,
})) {
  upsertCaseInsensitive(gomFunctions, name, entry);
}

const checkTitle = [...commands.commands, ...commands.execCommands]
  .find(entry => entry.name.toUpperCase() === 'CHECKTITLE');
if (!checkTitle) throw new Error('CHECKTITLE command entry is missing');
checkTitle.engines = (checkTitle.engines || []).filter(engine => engine !== 'GEE');
if (checkTitle.engineVariants) delete checkTitle.engineVariants.GEE;
checkTitle.engineClassification = {
  status: 'gom-only',
  confidence: 'confirmed',
  method: 'latest-help-index',
  revision,
};

const checkTitleReport = classificationReport.commands?.CHECKTITLE;
if (checkTitleReport) {
  if (checkTitleReport.classification !== 'gom-only') {
    const oldClassification = checkTitleReport.classification;
    if (classificationReport.summary[oldClassification] > 0) {
      classificationReport.summary[oldClassification]--;
    }
    classificationReport.summary['gom-only']++;
  }
  checkTitleReport.classification = 'gom-only';
  checkTitleReport.confidence = 'confirmed';
  checkTitleReport.engines = ['GOM'];
  if (checkTitleReport.evidence) delete checkTitleReport.evidence.GEE;
}
classificationReport.generated = '2026-07-26-help-only';

const gomPositionHelp = source(
  '游戏引擎反外挂系统/其他相关资料/物品位置[!].htm',
  '物品位置、自定义装备'
);
const gomConstantEntries = [
  constant({ name: 'SRIGHTHAND', description: '人物时装勋章位物品名称', scope: '时装装备', help: gomPositionHelp }),
  constant({ name: 'SNECKLACE', description: '人物时装项链位物品名称', scope: '时装装备', help: gomPositionHelp }),
  constant({ name: 'SHELMET', description: '人物时装头盔位物品名称', scope: '时装装备', help: gomPositionHelp }),
  constant({ name: 'SBELT', description: '人物时装腰带位物品名称', scope: '时装装备', help: gomPositionHelp }),
  constant({ name: 'SBOOTS', description: '人物时装鞋子位物品名称', scope: '时装装备', help: gomPositionHelp }),
  constant({ name: 'SCHARM', description: '人物时装宝石位物品名称', scope: '时装装备', help: gomPositionHelp }),
  ...Array.from({ length: 11 }, (_, offset) => {
    const position = offset + 2;
    return constant({
      name: `GODBLESSITEM${position}`,
      description: `人物十二生肖/神佑装备位${position}物品名称`,
      scope: '神佑装备',
      help: gomPositionHelp,
    });
  }),
  ...Array.from({ length: 5 }, (_, offset) => {
    const position = offset + 2;
    return constant({
      name: `JEWELRYITEM${position}`,
      description: `人物首饰盒装备位${position}物品名称`,
      scope: '首饰盒',
      help: gomPositionHelp,
    });
  }),
  ...[1, 2, 3].map(position => constant({
    name: `SCRIPTPARAM${position}`,
    description: `NPC 点击标签传入的第${position}个参数`,
    scope: 'NPC脚本参数',
    help: source(
      '游戏引擎反外挂系统/游戏功能详解/扩展NPC脚本点击触发带参数.htm',
      'NPC脚本点击触发带参数'
    ),
  })),
  constant({
    name: 'BUYITEMMONEYTYPENAME',
    description: '个人商店当前交易使用的货币类型名称',
    scope: '个人商店触发',
    help: source(
      '游戏引擎反外挂系统/特殊触发功能/个人商店购买物品触发.htm',
      '个人商店、摆摊购买物品触发'
    ),
  }),
  constant({
    name: 'BUYITEPRICE',
    description: '个人商店当前交易物品的价格',
    scope: '个人商店触发',
    help: source(
      '游戏引擎反外挂系统/特殊触发功能/个人商店购买物品触发.htm',
      '个人商店、摆摊购买物品触发'
    ),
  }),
  constant({
    name: 'CURRRSLAVENAME',
    description: '当前宝宝名称，在宝宝攻击或死亡触发中有效',
    scope: '宝宝触发',
    help: source(
      '游戏引擎反外挂系统/其他相关资料/脚本变量大全[!].htm',
      '脚本变量'
    ),
  }),
  constant({
    name: 'USEITEMMAKEINDEX',
    description: '当前使用物品的唯一 ID',
    scope: '物品触发',
    help: source(
      '游戏引擎反外挂系统/其他相关资料/脚本变量大全[!].htm',
      '脚本变量'
    ),
  }),
  constant({
    name: 'CURRTAKETEMPOS',
    description: '当前穿戴或脱下物品的装备位置',
    scope: '装备触发',
    help: source(
      '游戏引擎反外挂系统/特殊触发功能/人物穿戴装备前触发.htm',
      '人物穿戴装备前触发'
    ),
  }),
  constant({
    name: 'USEITEMNAME',
    description: '双击物品触发中的当前使用物品名称',
    scope: '物品触发',
    help: source(
      '游戏引擎反外挂系统/DB数据库资料/31类物品扩展设置.htm',
      '31类物品扩展设置'
    ),
    evidence: corpus(
      'QuestDiary/02游戏触发/双击触发.txt',
      570,
      'EQUAL <$USEITEMNAME> 最强散人称号卷'
    ),
  }),
];

const geeGodBlessHelp = source(
  '游戏引擎反外挂系统/部分脚本实例/神佑袋.htm',
  '神佑袋（十二生肖）介绍'
);
const geeConstantEntries = [
  ...Array.from({ length: 11 }, (_, offset) => {
    const position = offset + 2;
    return constant({
      name: `GODBLESSITEM${position}`,
      description: `人物普通神佑装备位${position}物品名称`,
      scope: '神佑装备',
      help: geeGodBlessHelp,
      evidence: corpus(
        'Market_Def/3大陆/主城/20生肖强化-西牛贺洲.txt',
        34 + offset * 4,
        `mov s$生肖名字 <$GODBLESSITEM${position}>`
      ),
    });
  }),
  ...[1, 2, 3].map(position => constant({
    name: `SCRIPTPARAM${position}`,
    description: `NPC 点击标签传入的第${position}个参数`,
    scope: 'NPC脚本参数',
    help: source(
      '游戏引擎反外挂系统/游戏功能详解/扩展NPC脚本点击触发带参数.html',
      '扩展NPC脚本点击触发带参数'
    ),
  })),
  constant({
    name: 'USEITEMNAME',
    description: '当前使用物品名称',
    scope: '物品触发',
    help: source(
      '游戏引擎反外挂系统/DB数据库资料/31类物品扩展设置.htm',
      '31类物品扩展设置'
    ),
    evidence: corpus(
      'Market_Def/QFunction-0.txt',
      1855,
      'sendmsg 6 【使用成功】：当前[<$UseItemName>]使用次数'
    ),
  }),
  constant({
    name: 'USEITEMMAKEINDEX',
    description: '当前使用物品唯一 ID',
    scope: '物品触发',
    help: source(
      '游戏引擎反外挂系统/DB数据库资料/31类物品扩展设置.htm',
      '31类物品扩展设置'
    ),
    evidence: corpus(
      'Market_Def/QFunction-0.txt',
      1867,
      'LinkBagItem <$UseItemMakeIndex>'
    ),
  }),
  constant({
    name: 'OLDMONEY',
    description: '货币变化前的旧值',
    scope: '货币触发',
    help: source(
      '游戏引擎反外挂系统/特殊触发功能/货币改变触发.htm',
      '货币改变触发'
    ),
    evidence: corpus(
      'Market_Def/QFunction-0.txt',
      3147,
      'large <$NewMoney> <$OldMoney>'
    ),
  }),
  constant({
    name: 'ATTACKMONSTER_HPEX',
    description: '当前锁定攻击主目标的剩余 HP',
    scope: '攻击目标',
    help: source(
      '游戏引擎反外挂系统/其他相关资料/脚本变量大全[!].htm',
      '脚本变量大全'
    ),
  }),
];

upsertConstants(gomConstants, gomConstantEntries);
upsertConstants(geeConstants, geeConstantEntries);

writeJson('data/functions.json', sortedObject(gomFunctions));
writeJson('data/commands.json', commands);
writeJson('data/constants-gom.json', gomConstants);
writeJson('data/constants-gee.json', geeConstants);
writeJson('data/audit-report/engine-classification.json', classificationReport);

console.log(JSON.stringify({
  gomFunctions: Object.keys(gomFunctions).length,
  gomConstants: gomConstants.constants.length,
  geeConstants: geeConstants.constants.length,
  geeCheckTitle: false,
}, null, 2));
