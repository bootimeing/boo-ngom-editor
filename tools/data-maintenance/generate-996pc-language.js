#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const audit = require('./audit-engine-language-accuracy');

const projectRoot = path.resolve(__dirname, '..', '..');
const revision = '2026-07-23';
const defaultHelpRoot = path.join(
  process.env.LOCALAPPDATA || '',
  'Temp',
  'boo-help-audit-20260723',
  'pc996'
);
const helpRoot = path.resolve(
  process.argv.find(argument => argument.startsWith('--help='))
    ?.slice('--help='.length) || defaultHelpRoot
);
const apply = process.argv.includes('--apply');

const COMMAND_PATH = /(?:脚本检测命令|功能操作命令|英雄功能操作命令)/;
const CHECK_PATH = /脚本检测命令/;
const TRIGGER_PATH = /特殊触发功能/;
const NOISE_PATH = /(?:^|\/)(?:UPDATE[^/]*|历史更新日志)\.HTML?$/i;
const INVALID_COMMAND_NAMES = new Set([
  'IF', 'ACT', 'SAY', 'ELSEACT', 'ELSESAY', 'BREAK', 'PARAM', 'INTEGER',
  'STRING', 'SELF', 'TRUE', 'FALSE', 'NULL', 'NPC', 'MAP', 'ITEM', 'MON',
  // Monster.xls field prose in the custom-collection page, not a script command.
  'RACE',
]);

const COMMAND_OVERRIDES = {
  ADDBUTTON: {
    syntax: 'ADDBUTTON 补丁序号 点击触发序号 默认图片 经过图片 按下图片 坐标X 坐标Y 是否可移动(0/1) 标题(-1为空) 悬浮备注',
    params: ['补丁序号', '点击触发序号', '默认图片', '经过图片', '按下图片', '坐标X', '坐标Y', '是否可移动(0/1)', '标题(-1为空)', '悬浮备注'],
  },
  ADDMAPROUTE: {
    syntax: 'AddMapRoute 动态链接标识(1-65535) 连接地图 坐标X 坐标Y',
    params: ['动态链接标识(1-65535)', '连接地图', '坐标X', '坐标Y'],
  },
  ALLOWDROP: {
    syntax: 'ALLOWDROP 是否允许掉落(0/1)',
    params: ['是否允许掉落(0/1)'],
  },
  CHANGEEXP: {
    syntax: 'CHANGEEXP 操作符(=,+,-) 经验值 [是否增加聚灵珠经验(0/1)]',
    params: ['操作符(=,+,-)', '经验值', '[是否增加聚灵珠经验(0/1)]'],
  },
  CHANGEITEMADDVALUE: {
    syntax: 'CHANGEITEMADDVALUE 装备位置 属性位置 操作符(+,-,=) 数值',
    params: ['装备位置', '属性位置', '操作符(+,-,=)', '数值'],
  },
  CHANGEITEMUPGRADECOUNT: {
    syntax: 'ChangeItemUpgradeCount 物品位置 操作符(+,-,=) 次数(0-255)',
    params: ['物品位置', '操作符(+,-,=)', '次数(0-255)'],
  },
  CHANGEMAKEITEMINFO: {
    syntax: 'CHANGEMAKEITEMINFO 物品位置 [来源类型] [地图名称] [人物名称] [怪物名称] [是否更新为当前时间(0/1)]',
    params: ['物品位置', '[来源类型]', '[地图名称]', '[人物名称]', '[怪物名称]', '[是否更新为当前时间(0/1)]'],
  },
  'CHECK [N]': {
    syntax: 'CHECK [N] 期望值(0/1)',
    params: ['个人标识(N)', '期望值(0/1)'],
  },
  CHECKBAGITEM: {
    syntax: 'CHECKBAGITEM 物品ID列表 保存变量 [模式(0唯一ID/1物品IDX)]',
    params: ['物品ID列表', '保存变量', '[模式(0唯一ID/1物品IDX)]'],
  },
  CHECKGROUPMEMBERCOUNT: {
    syntax: 'CHECKGROUPMEMBERCOUNT 操作符(<,>,=,?) 数量',
    params: ['操作符(<,>,=,?)', '数量'],
  },
  CHECKGAMEDIAMOND: {
    syntax: 'CHECKGAMEDIAMOND 操作符(<,>,=,?) 点数',
    params: ['操作符(<,>,=,?)', '点数'],
  },
  CHECKGAMEGIRD: {
    syntax: 'CHECKGAMEGIRD 操作符(<,>,=,?) 点数',
    params: ['操作符(<,>,=,?)', '点数'],
  },
  CHECKGAMEGLORY: {
    syntax: 'CHECKGAMEGLORY 操作符(<,>,=,?) 点数',
    params: ['操作符(<,>,=,?)', '点数'],
  },
  GAMEDIAMOND: {
    syntax: 'GAMEDIAMOND 操作符(+,-,=) 点数',
    params: ['操作符(+,-,=)', '点数'],
  },
  GAMEGIRD: {
    syntax: 'GAMEGIRD 操作符(+,-,=) 点数',
    params: ['操作符(+,-,=)', '点数'],
  },
  CHECKITEMADDVALUE: {
    syntax: 'CHECKITEMADDVALUE 装备位置 属性位置 操作符(<,>,=,?) 数值 [保存变量]',
    params: ['装备位置', '属性位置', '操作符(<,>,=,?)', '数值', '[保存变量]'],
  },
  CHECKITEMBIND: {
    syntax: 'CheckItemBind 装备位置',
    params: ['装备位置'],
  },
  CHECKITEMFLAG: {
    syntax: 'CheckItemFlag 装备位置 标识(1-32)',
    params: ['装备位置', '标识(1-32)'],
    kind: 'check',
  },
  CHECKNEWITEMVALUE: {
    syntax: 'CHECKNEWITEMVALUE 装备位置 元素属性(0-16) 操作符(<,>,=,?) 数值',
    params: ['装备位置', '元素属性(0-16)', '操作符(<,>,=,?)', '数值'],
  },
  CHECKMAKEINDEXBYBODY: {
    syntax: 'CHECKMAKEINDEXBYBODY 物品唯一ID',
    params: ['物品唯一ID'],
  },
  CHECKMAPHUMANCOUNT: {
    syntax: 'CheckMapHumanCount 地图号 操作符(<,>,=,?) 数量',
    params: ['地图号', '操作符(<,>,=,?)', '数量'],
  },
  CHECKMAPMONCOUNT: {
    syntax: 'CheckMapMonCount 地图号 操作符(<,>,=,?) 数量 [是否排除宝宝(0/1)]',
    params: ['地图号', '操作符(<,>,=,?)', '数量', '[是否排除宝宝(0/1)]'],
    kind: 'check',
  },
  CHECKMONMAP: {
    syntax: 'CheckMonMap 地图号 数量',
    params: ['地图号', '数量'],
    kind: 'check',
  },
  CHECKNAMELISTPOSITION: {
    syntax: 'CHECKNAMELISTPOSITION 列表文件 操作符(<,>,=) 名次 保存变量',
    params: ['列表文件', '操作符(<,>,=)', '名次', '保存变量'],
  },
  CHECKNATIONAL: {
    syntax: 'CheckNational 国家编号(0-100)',
    params: ['国家编号(0-100)'],
  },
  CLOSEMSGWINDOWS: {
    syntax: 'CLOSEMSGWINDOWS',
    params: [],
  },
  CLEARITEMMAP: {
    syntax: 'CLEARITEMMAP 地图 坐标X 坐标Y 范围 [物品名称]',
    params: ['地图', '坐标X', '坐标Y', '范围', '[物品名称]'],
  },
  CREATENPC: {
    syntax: 'CreateNPC NPC名字 地图 坐标X 坐标Y 外观 脚本文件 是否自动加地图后缀(0/1)',
    params: ['NPC名字', '地图', '坐标X', '坐标Y', '外观', '脚本文件', '是否自动加地图后缀(0/1)'],
  },
  DELBUTTON: {
    syntax: 'DELBUTTON 按钮序号(1-100) [删除范围(0自己/1全服)]',
    params: ['按钮序号(1-100)', '[删除范围(0自己/1全服)]'],
  },
  DELGUILDMEMBER: {
    syntax: 'DelGuildMember 行会名称 人物名称',
    params: ['行会名称', '人物名称'],
  },
  EATITEM: {
    syntax: 'EATITEM 道具名称 [使用次数(0批量/1单次)]',
    params: ['道具名称', '[使用次数(0批量/1单次)]'],
  },
  GAMEGLORY: {
    syntax: 'GAMEGLORY 操作符(+,-,=) 数值',
    params: ['操作符(+,-,=)', '数值'],
  },
  GETCALLMOB: {
    syntax: 'GetCallMob [宝宝名字] [数量] [是否保留分身(0/1)]',
    params: ['[宝宝名字]', '[数量]', '[是否保留分身(0/1)]'],
  },
  GUILDBUILDPOINT: {
    syntax: 'GUILDBUILDPOINT 操作符(+,-) 数值',
    params: ['操作符(+,-)', '数值'],
  },
  GUILDAURAEPOINT: {
    syntax: 'GUILDAURAEPOINT 操作符(+,-) 数值',
    params: ['操作符(+,-)', '数值'],
  },
  GUILDSTABILITYPOINT: {
    syntax: 'GUILDSTABILITYPOINT 操作符(+,-) 数值',
    params: ['操作符(+,-)', '数值'],
  },
  GUILDFLOURISHPOINT: {
    syntax: 'GUILDFLOURISHPOINT 操作符(+,-) 数值',
    params: ['操作符(+,-)', '数值'],
  },
  CHECKGUILDBUILDPOINT: {
    syntax: 'CHECKGUILDBUILDPOINT 操作符(<,>,=) 数值',
    params: ['操作符(<,>,=)', '数值'],
    kind: 'check',
  },
  CHECKGUILDAURAEPOINT: {
    syntax: 'CHECKGUILDAURAEPOINT 操作符(<,>,=) 数值',
    params: ['操作符(<,>,=)', '数值'],
    kind: 'check',
  },
  CHECKGUILDSTABILITYPOINT: {
    syntax: 'CHECKGUILDSTABILITYPOINT 操作符(<,>,=) 数值',
    params: ['操作符(<,>,=)', '数值'],
    kind: 'check',
  },
  CHECKGUILDFLOURISHPOINT: {
    syntax: 'CHECKGUILDFLOURISHPOINT 操作符(<,>,=) 数值',
    params: ['操作符(<,>,=)', '数值'],
    kind: 'check',
  },
  HUMANHP: {
    syntax: 'HUMANHP 操作符(+,-,=) 数值 [飘血ID]',
    params: ['操作符(+,-,=)', '数值', '[飘血ID]'],
  },
  LOOPGOTO: {
    syntax: 'Loopgoto @脚本段 [运行次数]',
    params: ['@脚本段', '[运行次数]'],
  },
  MAPEFFECT: {
    syntax: 'MAPEFFECT 地图 坐标X 坐标Y 补丁序号 开始图片 播放张数 播放次数 播放速度 绘制效果 [亮度|可见范围|ID组]',
    params: ['地图', '坐标X', '坐标Y', '补丁序号', '开始图片', '播放张数', '播放次数', '播放速度', '绘制效果', '[亮度|可见范围|ID组]'],
  },
  NEWCHANGEITEMADDVALUE: {
    syntax: 'NEWCHANGEITEMADDVALUE 装备位置 属性位置(44) 操作符(+,-,=) 数值',
    params: ['装备位置', '属性位置(44)', '操作符(+,-,=)', '数值'],
  },
  ONLINELONGMIN: {
    syntax: 'ONLINELONGMIN 操作符(<,>,=,?) 在线分钟数',
    params: ['操作符(<,>,=,?)', '在线分钟数'],
  },
  OPENMERCHANTBIGDLG: {
    syntax: 'OPENMERCHANTBIGDLG 补丁序号 图片序号 是否可移动(0/1) 显示位置(0-4) 微调X 微调Y [显示关闭按钮(0/1)] [关闭按钮X] [关闭按钮Y] [独立窗口(0/1)]',
    params: ['补丁序号', '图片序号', '是否可移动(0/1)', '显示位置(0-4)', '微调X', '微调Y', '[显示关闭按钮(0/1)]', '[关闭按钮X]', '[关闭按钮Y]', '[独立窗口(0/1)]'],
  },
  OPENURL: {
    syntax: 'OpenUrl 地址 [打开模式(0外部/1游戏内)]',
    params: ['地址', '[打开模式(0外部/1游戏内)]'],
  },
  PERCENT: {
    syntax: 'PERCENT 结果变量 被除数变量 除数变量',
    params: ['结果变量', '被除数变量', '除数变量'],
  },
  REPAIRALL: {
    syntax: 'RepairAll',
    params: [],
    kind: 'check',
  },
  'SET [N]': {
    syntax: 'SET [N] 值(0/1)',
    params: ['个人标识(N)', '值(0/1)'],
  },
  SETSHADOWSHOW: {
    syntax: 'SETSHADOWSHOW 残影开关(0/1) [持续秒数] [残影颜色(0-255)]',
    params: ['残影开关(0/1)', '[持续秒数]', '[残影颜色(0-255)]'],
  },
  SETHUMVAR: {
    syntax: 'SetHumVar 角色名称 对方保存变量 传递值或变量',
    params: ['角色名称', '对方保存变量', '传递值或变量'],
  },
  GETHUMVAR: {
    syntax: 'GetHumVar 角色名称 获取值或变量 本地保存变量',
    params: ['角色名称', '获取值或变量', '本地保存变量'],
  },
  SORTHUMVARTOLISL: {
    name: 'SortHumVarToList',
    syntax: 'SortHumVarToList 变量名 保存路径 排序模式(0升/1降) [人物名保存路径]',
    params: ['变量名', '保存路径', '排序模式(0升/1降)', '[人物名保存路径]'],
  },
  SORTHUMVARTOLIST: {
    name: 'SortHumVarToList',
    syntax: 'SortHumVarToList 变量名 保存路径 排序模式(0升/1降) [人物名保存路径]',
    params: ['变量名', '保存路径', '排序模式(0升/1降)', '[人物名保存路径]'],
  },
  SORTHUMVARTOLISTEX: {
    syntax: 'SortHumVarToListEx 变量名 变量路径 排序模式(0升/1降) 保存路径 [保存模式(0/1)]',
    params: ['变量名', '变量路径', '排序模式(0升/1降)', '保存路径', '[保存模式(0/1)]'],
  },
  STARTAUTOPLAYGAME: {
    syntax: 'STARTAUTOPLAYGAME 挂机范围 挂机点间距 模式(0-2)',
    params: ['挂机范围', '挂机点间距', '模式(0-2)'],
  },
  TAKEEX: {
    syntax: 'TakeEx 装备位置(0-16)',
    params: ['装备位置(0-16)'],
  },
  WRITECONFIGFILEITEM: {
    syntax: 'WriteConfigFileItem 路径 配置项区 配置项节 配置项值',
    params: ['路径', '配置项区', '配置项节', '配置项值'],
  },
  READCONFIGFILEITEM: {
    syntax: 'ReadConfigFileItem 路径 配置项区 配置项节 保存变量',
    params: ['路径', '配置项区', '配置项节', '保存变量'],
  },
  DELCONFIGFILESECTION: {
    syntax: 'DelConfigFileSection 路径 配置项区',
    params: ['路径', '配置项区'],
  },
  DELCONFIGFILEITEM: {
    syntax: 'DelConfigFileItem 路径 配置项区 配置项节',
    params: ['路径', '配置项区', '配置项节'],
  },
  WRITECACHECONFIGFILEITEM: {
    syntax: 'WriteCacheConfigFileItem 路径 配置项区 配置项节 配置项值',
    params: ['路径', '配置项区', '配置项节', '配置项值'],
  },
  READCACHECONFIGFILEITEM: {
    syntax: 'ReadCacheConfigFileItem 路径 配置项区 配置项节 保存变量',
    params: ['路径', '配置项区', '配置项节', '保存变量'],
  },
  DELCACHECONFIGFILESECTION: {
    syntax: 'DelCacheConfigFileSection 路径 配置项区',
    params: ['路径', '配置项区'],
  },
  DELCACHECONFIGFILEITEM: {
    syntax: 'DelCacheConfigFileItem 路径 配置项区 配置项节',
    params: ['路径', '配置项区', '配置项节'],
  },
};

const MISSED_DOCUMENTED_COMMANDS = [
  {
    name: 'AddMaxWeight',
    syntax: 'AddMaxWeight 操作符(+,-,=) 数值',
    params: ['操作符(+,-,=)', '数值'],
    kind: 'action',
    page: '游戏引擎反外挂系统/新增功能/调整背包负重.htm',
  },
  {
    name: 'RANDOM',
    syntax: 'RANDOM 随机范围',
    params: ['随机范围'],
    kind: 'check',
    page: '游戏引擎反外挂系统/其他相关资料/传奇基础脚本命令详解[!].htm',
  },
  {
    name: 'StopAutoPlayGame',
    syntax: 'StopAutoPlayGame',
    params: [],
    kind: 'action',
    page: '游戏引擎反外挂系统/游戏功能详解/内挂自动挂机[!].htm',
  },
  {
    name: 'RENEWLEVEL',
    syntax: 'RENEWLEVEL 转生次数 转生后等级',
    params: ['转生次数', '转生后等级'],
    kind: 'action',
    page: '游戏引擎反外挂系统/部分脚本实例/人物转生[!].htm',
  },
  {
    name: 'CHECKCUSTOMITEMVALUE',
    syntax: 'CHECKCUSTOMITEMVALUE 装备位置 属性位置(0-19) 操作符(<,>,=) 数值',
    params: ['装备位置', '属性位置(0-19)', '操作符(<,>,=)', '数值'],
    kind: 'check',
    page: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
  },
  {
    name: 'SETICON',
    syntax: 'SETICON 位置(0-9) 补丁序号 图片序号 [微调X] [微调Y] [播放张数] [绘制效果(0/1)] [播放速度] [仅自己可见(0/1)] [播放次数|绘制层级]',
    params: ['位置(0-9)', '补丁序号', '图片序号', '[微调X]', '[微调Y]', '[播放张数]', '[绘制效果(0/1)]', '[播放速度]', '[仅自己可见(0/1)]', '[播放次数|绘制层级]'],
    kind: 'action',
    page: '游戏引擎反外挂系统/游戏功能详解/顶戴花翎功能[!].htm',
  },
  {
    name: 'ReturnBoxItem',
    syntax: 'ReturnBoxItem OK框编号(0-17)',
    params: ['OK框编号(0-17)'],
    kind: 'action',
    page: '游戏引擎反外挂系统/游戏功能详解/自定义OK框[!].htm',
  },
  {
    name: 'SetUpgradeItem',
    syntax: 'SetUpgradeItem OK框编号(0-17)',
    params: ['OK框编号(0-17)'],
    kind: 'action',
    page: '游戏引擎反外挂系统/游戏功能详解/自定义OK框[!].htm',
  },
  {
    name: 'DELBOXITEM',
    syntax: 'DELBOXITEM OK框编号(0-17) [删除数量]',
    params: ['OK框编号(0-17)', '[删除数量]'],
    kind: 'action',
    page: '游戏引擎反外挂系统/游戏功能详解/自定义OK框[!].htm',
  },
  {
    name: 'CheckBoxItemCount',
    syntax: 'CheckBoxItemCount OK框编号(0-17) 物品数量',
    params: ['OK框编号(0-17)', '物品数量'],
    kind: 'check',
    page: '游戏引擎反外挂系统/游戏功能详解/自定义OK框[!].htm',
  },
  {
    name: 'CHECKCUSTOMITEMPROGRESSBARVALUE',
    syntax: 'CHECKCUSTOMITEMPROGRESSBARVALUE 装备位置 进度条序号 检测类型(0-2) 操作符(<,>,=) 检测值',
    params: ['装备位置', '进度条序号', '检测类型(0-2)', '操作符(<,>,=)', '检测值'],
    kind: 'check',
    page: '游戏引擎反外挂系统/游戏功能详解/自定义装备进度条 类似刀魂功能.html',
  },
  {
    name: 'CHECKCUSTOMITEMPROGRESSBAR',
    syntax: 'CHECKCUSTOMITEMPROGRESSBAR 装备位置 进度条序号',
    params: ['装备位置', '进度条序号'],
    kind: 'check',
    page: '游戏引擎反外挂系统/游戏功能详解/自定义装备进度条 类似刀魂功能.html',
  },
  {
    name: 'CHECKISMASTER',
    syntax: 'CHECKISMASTER',
    params: [],
    kind: 'check',
    page: '游戏引擎反外挂系统/部分脚本实例/收徒脚本.htm',
  },
  {
    name: 'CHECKMASTER',
    syntax: 'CHECKMASTER',
    params: [],
    kind: 'check',
    page: '游戏引擎反外挂系统/部分脚本实例/收徒脚本.htm',
  },
  {
    name: 'CHECKPOSEMASTER',
    syntax: 'CHECKPOSEMASTER',
    params: [],
    kind: 'check',
    page: '游戏引擎反外挂系统/部分脚本实例/收徒脚本.htm',
  },
  {
    name: 'CHECKDUMMYCOUNT',
    syntax: 'CHECKDUMMYCOUNT 操作符(<,>,=) 数量',
    params: ['操作符(<,>,=)', '数量'],
    kind: 'check',
    page: '游戏引擎反外挂系统/其他相关资料/假人系统支持.htm',
  },
  {
    name: 'SETDUMMYCONFIGFILENAME',
    syntax: 'SETDUMMYCONFIGFILENAME 配置文件路径',
    params: ['配置文件路径'],
    kind: 'action',
    page: '游戏引擎反外挂系统/其他相关资料/假人系统支持.htm',
  },
  {
    name: 'LOADDUMMYCONFIGFILE',
    syntax: 'LOADDUMMYCONFIGFILE',
    params: [],
    kind: 'action',
    page: '游戏引擎反外挂系统/其他相关资料/假人系统支持.htm',
  },
  {
    name: 'ACTREPAIRALL',
    syntax: 'ACTREPAIRALL',
    params: [],
    kind: 'action',
    page: '游戏引擎反外挂系统/功能操作命令/特修装备[!].htm',
  },
  {
    name: 'CHECKVAR',
    syntax: 'CHECKVAR 变量范围(HUMAN/GLOBAL) 变量名 操作符(<,>,=,?) 数值',
    params: ['变量范围(HUMAN/GLOBAL)', '变量名', '操作符(<,>,=,?)', '数值'],
    kind: 'check',
    page: '游戏引擎反外挂系统/新增功能/新自定义变量.htm',
  },
  {
    name: 'AddAttackSabukAll',
    syntax: 'AddAttackSabukAll 城堡编号',
    params: ['城堡编号'],
    kind: 'action',
    page: '游戏引擎反外挂系统/功能操作命令/所有行会同时攻城.htm',
  },
];

const SERVER_CORPUS_COMMANDS = [
  {
    name: 'CLOSEMERCHANTBIGDLG',
    syntax: 'CLOSEMERCHANTBIGDLG',
    params: [],
    kind: 'action',
    page: '游戏引擎反外挂系统/功能操作命令/打开NPC大对话框[!].htm',
    corpusEvidence: [{
      kind: 'server-script',
      path: 'Mir200/Envir/Market_Def/QFunction-0.txt',
      line: 180,
      text: 'CLOSEMERCHANTBIGDLG',
    }],
  },
];

const SERVER_CORPUS_VARIABLES = [];

const SERVER_CORPUS_CONSTANTS = [];

const CURATED_TRIGGERS = [
  {
    name: 'LOGIN',
    label: '[@Login]',
    description: '玩家进入游戏时执行的登录脚本触发',
    page: '游戏引擎反外挂系统/服务端文本结构/QManage.txt(登录脚本).htm',
  },
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  const target = path.join(projectRoot, relativePath);
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function source(page) {
  return {
    revision,
    page: page.relativePath,
    ...(page.title ? { title: page.title } : {}),
  };
}

function applyCommandOverride(info) {
  const override = COMMAND_OVERRIDES[info.name.toUpperCase()];
  if (!override) return info;
  const name = override.name || info.name;
  const kind = override.kind || info.kind;
  return {
    ...info,
    name,
    syntax: override.syntax,
    params: override.params.join(' '),
    paramList: [...override.params],
    kind,
    contexts: contexts(kind),
    completionVerified: true,
    completionEnabled: true,
    completionReview: '996pc-help-curated-format',
  };
}

function commandKind(page, fallback) {
  if (CHECK_PATH.test(page.relativePath)) return 'check';
  return fallback || 'action';
}

function contexts(kind) {
  return kind === 'check' ? ['IF'] : kind === 'say' ? ['SAY'] : ['ACT'];
}

function cleanSyntax(value, name) {
  let syntax = String(value || '')
    .replace(/\s+\/\/.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const position = syntax.toUpperCase().indexOf(name.toUpperCase());
  if (position > 0) syntax = syntax.slice(position);
  syntax = syntax.replace(
    new RegExp(`^${escapeRegex(name)}(?=\\S)`, 'i'),
    `${name} `
  );
  return syntax.replace(/[。；;]+$/, '').trim();
}

function hasUnclosedDelimiter(value) {
  const pairs = new Map([
    [')', '('],
    [']', '['],
    ['}', '{'],
    ['）', '（'],
    ['】', '【'],
  ]);
  const stack = [];
  for (const character of String(value || '')) {
    if ('([{（【'.includes(character)) {
      stack.push(character);
      continue;
    }
    const expected = pairs.get(character);
    if (!expected) continue;
    if (stack[stack.length - 1] === expected) stack.pop();
  }
  return stack.length > 0;
}

function splitParams(syntax, name) {
  const rest = syntax.replace(
    new RegExp(`^${escapeRegex(name)}(?=\\s|$)\\s*`, 'i'),
    ''
  ).trim();
  if (!rest) return [];
  const result = [];
  let current = '';
  let depth = 0;
  for (const character of rest) {
    if ('([{（【'.includes(character)) depth++;
    if (')]}）】'.includes(character) && depth > 0) depth--;
    if (/\s/.test(character) && depth === 0) {
      if (current) result.push(current);
      current = '';
    } else {
      current += character;
    }
  }
  if (current) result.push(current);
  return result.slice(0, 32);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function descriptionFromPage(page) {
  for (let index = 0; index < Math.min(page.lines.length, 45); index++) {
    const line = page.lines[index];
    const match = line.match(/^(?:功能|作用|说明)\s*[:：]\s*(.+)$/i);
    if (match?.[1] && match[1].length <= 240) return match[1].trim();
    if (/^(?:功能|作用)\s*[:：]\s*$/i.test(line)) {
      const next = page.lines[index + 1]?.trim();
      if (next && next.length <= 240) return next.replace(/[。.]$/, '');
    }
  }
  return page.title || '996PC 帮助文档命令';
}

function appendWrappedParameters(page, lineIndex, syntax, name) {
  let result = syntax;
  for (let next = lineIndex + 1; next < Math.min(page.lines.length, lineIndex + 5); next++) {
    const line = page.lines[next].trim();
    if (
      !line
      || /^(?:功能|作用|说明|例|示例|示范|注意|备注|注|命令\s*[:：]|(?:命令)?(?:格式|用法|语法)\s*[:：]|参数\d+\s*[:：]|#|\[@|;|[-=]{5,})/i.test(line)
      || /^(?:该命令|此命令|支持使用|只能由|需要配合)/i.test(line)
    ) break;
    if (new RegExp(`^${escapeRegex(name)}(?:\\s|$)`, 'i').test(line)) break;
    const continuesDelimiter = hasUnclosedDelimiter(result);
    if (!continuesDelimiter && /[。！；;]$/.test(line)) break;
    result = `${result} ${line}`.replace(/\s+/g, ' ').trim();
    if (continuesDelimiter && !hasUnclosedDelimiter(result)) break;
  }
  return result;
}

function completeUsageLine(page, usage, name) {
  let syntax = cleanSyntax(usage.line, name);
  return appendWrappedParameters(page, usage.index, syntax, name);
}

function entryFor996(entry) {
  return {
    ...entry,
    ...(entry.engineVariants?.['996PC'] || {}),
    name: entry.name,
    aliases: unique([
      ...(entry.aliases || []),
      ...(entry.engineVariants?.['996PC']?.aliases || []),
    ]),
  };
}

function inspectKnownCommand(entry, fallbackKind, corpus) {
  const inspected = audit.inspectEngine(entryFor996(entry), corpus, new Map());
  if (!inspected.supported || !inspected.bestPage) return null;
  const page = corpus.pages.find(candidate =>
    candidate.relativePath === inspected.bestPage.path
  );
  if (!page || NOISE_PATH.test(page.relativePath)) return null;
  const strongUsage = (inspected.syntaxEvidence || []).find(candidate => candidate.score >= 14);
  const documentedName = strongUsage
    ? strongUsage.line.match(/^(?:NOT\s+)?([A-Za-z_][A-Za-z0-9_.]*)\b/i)?.[1]
    : entry.name;
  const name = documentedName || entry.name;
  const syntax = strongUsage
    ? completeUsageLine(page, strongUsage, name)
    : name;
  const kind = commandKind(page, fallbackKind);
  const definitionVerified = inspected.supportMethod === 'definition-page'
    && !NOISE_PATH.test(page.relativePath);
  return {
    name,
    syntax,
    details: descriptionFromPage(page),
    params: splitParams(syntax, name).join(' '),
    paramList: splitParams(syntax, name),
    kind,
    contexts: contexts(kind),
    source: source(page),
    completionVerified: Boolean(strongUsage || definitionVerified),
    completionEnabled: Boolean(strongUsage || definitionVerified),
    ...(!strongUsage && definitionVerified
      ? { completionReview: '996pc-help-example-command-name-only' }
      : {}),
  };
}

function explicitSyntaxCandidates(corpus) {
  const candidates = new Map();
  for (const page of corpus.pages) {
    if (!COMMAND_PATH.test(page.relativePath) || NOISE_PATH.test(page.relativePath)) continue;
    for (let index = 0; index < page.lines.length; index++) {
      const format = page.lines[index].match(
        /^(?:命令)?(?:格式|用法|语法)\s*[:：]?\s*(.*)$/i
      );
      if (!format) continue;
      let syntax = format[1].trim();
      let syntaxLineIndex = index;
      if (!syntax) {
        for (
          let next = index + 1;
          next < Math.min(page.lines.length, index + 5);
          next++
        ) {
          const line = page.lines[next].trim();
          if (!line || /^(?:功能|作用|说明|例|示例|注意|备注|#|\[@)/i.test(line)) break;
          syntax = line;
          syntaxLineIndex = next;
          break;
        }
      }
      let genericParams = '';
      let match = syntax.match(/^(?:NOT\s+)?([A-Za-z_][A-Za-z0-9_.]*)\b/);
      if (!match && /^命令(?:\s|$)/.test(syntax)) {
        genericParams = syntax.replace(/^命令\s*/, '').trim();
        for (let next = syntaxLineIndex + 1; next < Math.min(page.lines.length, syntaxLineIndex + 6); next++) {
          if (/^参数\d+(?:\s+参数\d+)*$/i.test(page.lines[next].trim())) {
            genericParams = `${genericParams} ${page.lines[next].trim()}`.trim();
            continue;
          }
          const commandLine = page.lines[next].match(/^命令\s*[:：]\s*([A-Za-z_][A-Za-z0-9_.]*)/i);
          if (!commandLine) continue;
          match = commandLine;
          syntax = `${commandLine[1]} ${genericParams}`.trim();
          syntaxLineIndex = next;
          break;
        }
      }
      if (!match) continue;
      const name = match[1];
      if (INVALID_COMMAND_NAMES.has(name.toUpperCase())) continue;
      const cleaned = appendWrappedParameters(
        page,
        syntaxLineIndex,
        cleanSyntax(syntax, name),
        name
      );
      const kind = commandKind(page, 'action');
      const occurrences = page.tokenCounts.get(name.toUpperCase()) || 0;
      const hasDominantOtherCommand = [...page.tokenCounts.entries()].some(
        ([token, count]) => token !== name.toUpperCase()
          && count >= 3
          && /^[A-Z][A-Z0-9_.]{2,}$/.test(token)
          && !INVALID_COMMAND_NAMES.has(token)
      );
      const hasConflict = occurrences <= 1
        && splitParams(cleaned, name).length === 0
        && !page.title.toUpperCase().includes(name.toUpperCase())
        && hasDominantOtherCommand;
      const candidate = applyCommandOverride({
        name,
        syntax: cleaned,
        details: descriptionFromPage(page),
        params: splitParams(cleaned, name).join(' '),
        paramList: splitParams(cleaned, name),
        kind,
        contexts: contexts(kind),
        source: source(page),
        completionVerified: !hasConflict,
        completionEnabled: !hasConflict,
        ...(hasConflict ? { completionReview: '996pc-help-format-conflict' } : {}),
      });
      const key = candidate.name.toUpperCase();
      const current = candidates.get(key);
      if (!current || candidate.syntax.length > current.syntax.length) {
        candidates.set(key, candidate);
      }
    }
  }
  return candidates;
}

function toVariant(info) {
  return {
    name: info.name,
    syntax: info.syntax,
    description: info.details,
    params: info.paramList,
    kind: info.kind,
    contexts: info.contexts,
    aliases: [],
    source: info.source,
    completionVerified: info.completionVerified,
    completionEnabled: info.completionEnabled,
    ...(info.corpusEvidence ? { corpusEvidence: info.corpusEvidence } : {}),
    ...(info.completionReview
      ? { completionReview: info.completionReview }
      : info.completionVerified
        ? {}
        : { completionReview: '996pc-help-definition-without-exact-format' }),
  };
}

function addEngineVariant(entry, variant) {
  entry.engines = unique([...(entry.engines || []), '996PC']);
  entry.engineVariants = { ...(entry.engineVariants || {}), '996PC': variant };
}

function remove996Variant(entry) {
  entry.engines = (entry.engines || []).filter(engine => engine !== '996PC');
  if (entry.engines.length === 0) delete entry.engines;
  if (entry.engineVariants) {
    delete entry.engineVariants['996PC'];
    if (Object.keys(entry.engineVariants).length === 0) delete entry.engineVariants;
  }
  if (entry.engineSources) {
    delete entry.engineSources['996PC'];
    if (Object.keys(entry.engineSources).length === 0) delete entry.engineSources;
  }
}

function generateCommands(commands, corpus) {
  const functions = {};
  const explicit = explicitSyntaxCandidates(corpus);
  const knownByName = new Map();
  for (const [fallbackKind, entries] of [
    ['check', commands.commands || []],
    ['action', commands.execCommands || []],
  ]) {
    for (const entry of entries) {
      remove996Variant(entry);
      knownByName.set(entry.name.toUpperCase(), entry);
      const info = inspectKnownCommand(entry, fallbackKind, corpus);
      if (!info) continue;
      const exact = explicit.get(info.name.toUpperCase())
        || explicit.get(entry.name.toUpperCase());
      const resolved = applyCommandOverride(exact || info);
      addEngineVariant(entry, toVariant(resolved));
      functions[resolved.name] = resolved;
    }
  }
  for (const [key, info] of explicit) {
    const resolved = applyCommandOverride(info);
    if (knownByName.has(key) || knownByName.has(resolved.name.toUpperCase())) continue;
    functions[resolved.name] = resolved;
  }
  for (const spec of MISSED_DOCUMENTED_COMMANDS) {
    const page = corpus.pages.find(candidate => candidate.relativePath === spec.page);
    if (!page) throw new Error(`996PC curated command source is missing: ${spec.page}`);
    const info = {
      name: spec.name,
      syntax: spec.syntax,
      details: descriptionFromPage(page),
      params: spec.params.join(' '),
      paramList: [...spec.params],
      kind: spec.kind,
      contexts: contexts(spec.kind),
      source: source(page),
      completionVerified: true,
      completionEnabled: true,
      completionReview: '996pc-help-curated-format',
    };
    const known = knownByName.get(spec.name.toUpperCase());
    if (known) addEngineVariant(known, toVariant(info));
    functions[info.name] = info;
  }
  for (const spec of SERVER_CORPUS_COMMANDS) {
    const page = corpus.pages.find(candidate => candidate.relativePath === spec.page);
    if (!page) throw new Error(`996PC corpus command context page is missing: ${spec.page}`);
    const info = {
      name: spec.name,
      syntax: spec.syntax,
      details: '996PC 示例服务端正在使用；帮助未单独列出',
      params: spec.params.join(' '),
      paramList: [...spec.params],
      kind: spec.kind,
      contexts: contexts(spec.kind),
      source: source(page),
      corpusEvidence: spec.corpusEvidence,
      completionVerified: false,
      completionEnabled: false,
      completionReview: '996pc-server-corpus-only',
    };
    const known = knownByName.get(spec.name.toUpperCase());
    if (known) addEngineVariant(known, toVariant(info));
    functions[info.name] = info;
  }
  return Object.fromEntries(Object.entries(functions).sort(([left], [right]) =>
    left.localeCompare(right, 'en', { sensitivity: 'base' })
  ));
}

function markerPatterns(variable) {
  const patterns = [];
  for (const marker of String(variable.full || '').match(/<\$[^>]+>/g) || []) {
    let pattern = escapeRegex(marker);
    pattern = pattern.replace(escapeRegex('变量名'), '[^)>\\s]+');
    patterns.push(new RegExp(pattern, 'i'));
  }
  if (/^[A-Za-z_][A-Za-z0-9_.$]*$/.test(variable.name)) {
    patterns.push(new RegExp(escapeRegex(`<$${variable.name}>`), 'i'));
  }
  for (const alias of variable.aliases || []) {
    if (/^[A-Za-z_][A-Za-z0-9_.$]*$/.test(alias)) {
      patterns.push(new RegExp(escapeRegex(`<$${alias}>`), 'i'));
    }
  }
  return patterns;
}

function bestSymbolPage(corpus, patterns, preferredPath) {
  const matches = [];
  for (const page of corpus.pages) {
    if (NOISE_PATH.test(page.relativePath)) continue;
    let occurrences = 0;
    for (const pattern of patterns) {
      const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
      occurrences += [...page.text.matchAll(new RegExp(pattern.source, flags))].length;
    }
    if (occurrences === 0) continue;
    let score = occurrences;
    if (preferredPath.test(page.relativePath)) score += 30;
    if (/变量|常量|触发/.test(`${page.relativePath} ${page.title}`)) score += 15;
    matches.push({ page, score, occurrences });
  }
  matches.sort((left, right) =>
    right.score - left.score
    || right.occurrences - left.occurrences
    || left.page.relativePath.localeCompare(right.page.relativePath, 'zh-CN')
  );
  return matches[0]?.page || null;
}

function generateVariables(variables, corpus) {
  let matched = 0;
  for (const variable of variables.variables || []) {
    remove996Variant(variable);
    const page = bestSymbolPage(
      corpus,
      markerPatterns(variable),
      /(?:脚本变量|程序变量|其他相关资料|特殊触发功能)/
    );
    if (!page) continue;
    const ownSource = source(page);
    variable.engines = unique([...(variable.engines || []), '996PC']);
    variable.engineSources = {
      ...(variable.engineSources || {}),
      '996PC': ownSource,
    };
    variable.engineVariants = {
      ...(variable.engineVariants || {}),
      '996PC': {
        name: variable.name,
        full: variable.full,
        scope: variable.scope || '996PC',
        desc: `996PC 文档：${page.title || variable.name}`,
        aliases: [...(variable.aliases || [])],
        source: ownSource,
      },
    };
    matched++;
  }
  for (const spec of SERVER_CORPUS_VARIABLES) {
    const variable = (variables.variables || []).find(entry => (
      entry.name.toUpperCase() === spec.name.toUpperCase()
    ));
    if (!variable) throw new Error(`996PC corpus variable is missing from base data: ${spec.name}`);
    variable.engines = unique([...(variable.engines || []), '996PC']);
    variable.engineVariants = {
      ...(variable.engineVariants || {}),
      '996PC': {
        name: variable.name,
        full: spec.full,
        scope: spec.scope,
        desc: spec.desc,
        aliases: [...(variable.aliases || [])],
        corpusEvidence: spec.corpusEvidence,
      },
    };
    matched++;
  }
  return matched;
}

function generateConstants(variables, corpus) {
  const variableByName = new Map();
  for (const variable of variables.variables || []) {
    if (!variable.engineVariants?.['996PC']) continue;
    variableByName.set(variable.name.toUpperCase(), variable.engineVariants['996PC']);
  }
  const candidates = new Map();
  for (const page of corpus.pages) {
    if (NOISE_PATH.test(page.relativePath)) continue;
    for (const match of page.text.matchAll(/<\$([A-Za-z_][A-Za-z0-9_.]*)>/g)) {
      const name = match[1].toUpperCase();
      const current = candidates.get(name);
      let score = 1;
      if (/(?:脚本变量|程序变量|其他相关资料|特殊触发功能)/.test(page.relativePath)) score += 30;
      if (/变量|常量/.test(`${page.relativePath} ${page.title}`)) score += 15;
      if (!current || score > current.score) candidates.set(name, { page, score });
    }
  }
  const constants = [];
  for (const [name, candidate] of candidates) {
    const variable = variableByName.get(name);
    constants.push({
      name,
      full: variable?.full && /^<\$[^>]+>$/.test(variable.full)
        ? variable.full
        : `<$${name}>`,
      description: variable?.desc || `996PC 文档：${candidate.page.title || name}`,
      scope: variable?.scope || '996PC 系统常量',
      source: source(candidate.page),
      aliases: variable?.aliases || [],
      completionVerified: true,
      completionEnabled: true,
    });
  }
  for (const constant of SERVER_CORPUS_CONSTANTS) {
    if (!constants.some(candidate => candidate.name.toUpperCase() === constant.name.toUpperCase())) {
      constants.push({ ...constant });
    }
  }
  return constants.sort((left, right) => left.name.localeCompare(right.name, 'en'));
}

function triggerCandidates(corpus) {
  const candidates = new Map();
  for (const page of corpus.pages) {
    if (!TRIGGER_PATH.test(page.relativePath) || NOISE_PATH.test(page.relativePath)) continue;
    for (const match of page.text.matchAll(/\[@([^\]\r\n]+)\]/g)) {
      const name = match[1].trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) continue;
      if (name.toUpperCase() === 'MAIN') continue;
      const key = name.toUpperCase();
      if (!candidates.has(key)) candidates.set(key, { name, page });
    }
  }
  return candidates;
}

function generateTriggers(commands, corpus) {
  const candidates = triggerCandidates(corpus);
  const known = new Map();
  for (const trigger of commands.triggers || []) {
    remove996Variant(trigger);
    known.set(trigger.name.toUpperCase(), trigger);
    const candidate = candidates.get(trigger.name.toUpperCase())
      || candidates.get(String(trigger.label || '').replace(/^\[@|\]$/g, '').toUpperCase());
    if (!candidate) continue;
    const ownSource = source(candidate.page);
    trigger.engines = unique([...(trigger.engines || []), '996PC']);
    trigger.engineSources = {
      ...(trigger.engineSources || {}),
      '996PC': ownSource,
    };
    trigger.engineVariants = {
      ...(trigger.engineVariants || {}),
      '996PC': {
        name: trigger.name,
        label: trigger.label || `[@${trigger.name}]`,
        description: `996PC 文档：${candidate.page.title || trigger.name}`,
        aliases: [...(trigger.aliases || [])],
        source: ownSource,
      },
    };
  }

  for (const [key, candidate] of candidates) {
    if (known.has(key) || /\d+$/.test(candidate.name)) continue;
    const ownSource = source(candidate.page);
    commands.triggers.push({
      name: candidate.name,
      label: `[@${candidate.name}]`,
      description: `996PC 文档：${candidate.page.title || candidate.name}`,
      engines: ['996PC'],
      engineSources: { '996PC': ownSource },
      source: ownSource,
      engineClassification: {
        status: '996pc-only',
        confidence: 'confirmed',
        method: '996pc-help-trigger-page',
        revision,
      },
      engineVariants: {
        '996PC': {
          name: candidate.name,
          label: `[@${candidate.name}]`,
          description: `996PC 文档：${candidate.page.title || candidate.name}`,
          aliases: [],
          source: ownSource,
        },
      },
    });
  }

  for (const spec of CURATED_TRIGGERS) {
    const key = spec.name.toUpperCase();
    let trigger = known.get(key);
    if (!trigger) {
      trigger = {
        name: spec.name,
        label: spec.label || `[@${spec.name}]`,
        description: spec.description,
        engines: [],
        engineSources: {},
        engineVariants: {},
      };
      commands.triggers.push(trigger);
      known.set(key, trigger);
    }
    const page = spec.page
      ? corpus.pages.find(candidate => candidate.relativePath === spec.page)
      : undefined;
    if (spec.page && !page) {
      throw new Error(`996PC curated trigger page is missing: ${spec.page}`);
    }
    const ownSource = page ? source(page) : undefined;
    trigger.engines = unique([...(trigger.engines || []), '996PC']);
    if (ownSource) {
      trigger.engineSources = {
        ...(trigger.engineSources || {}),
        '996PC': ownSource,
      };
    }
    trigger.engineVariants = {
      ...(trigger.engineVariants || {}),
      '996PC': {
        name: trigger.name,
        label: trigger.label || spec.label || `[@${trigger.name}]`,
        description: spec.description,
        aliases: [...(trigger.aliases || [])],
        ...(ownSource ? { source: ownSource } : {}),
        ...(spec.corpusEvidence ? { corpusEvidence: spec.corpusEvidence } : {}),
      },
    };
  }

  commands.triggers.sort((left, right) =>
    left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
  );
  return (commands.triggers || []).filter(trigger =>
    trigger.engineVariants?.['996PC']
  ).length;
}

function validate(commands, variables, functions, constants) {
  const errors = [];
  const verifyVariant = (entry, type) => {
    const variant = entry.engineVariants?.['996PC'];
    if (!entry.engines?.includes('996PC')) return;
    if (!variant) errors.push(`${type} ${entry.name} 缺少 996PC variant`);
    if (!variant?.source?.page && !variant?.corpusEvidence?.length) {
      errors.push(`${type} ${entry.name} 缺少 996PC source`);
    }
  };
  for (const entry of [...(commands.commands || []), ...(commands.execCommands || [])]) {
    verifyVariant(entry, 'command');
  }
  for (const entry of commands.triggers || []) verifyVariant(entry, 'trigger');
  for (const entry of variables.variables || []) verifyVariant(entry, 'variable');
  for (const [name, info] of Object.entries(functions)) {
    if (!info.source?.page && !info.corpusEvidence?.length) errors.push(`function ${name} 缺少 source`);
    if (info.completionVerified && !info.syntax) errors.push(`function ${name} 缺少 syntax`);
  }
  for (const constant of constants) {
    if (!constant.source?.page && !constant.corpusEvidence?.length) {
      errors.push(`constant ${constant.name} 缺少 source`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`996PC catalog validation failed:\n${errors.slice(0, 50).join('\n')}`);
  }
}

function main() {
  if (!fs.existsSync(helpRoot)) throw new Error(`996PC help root does not exist: ${helpRoot}`);
  const commands = readJson('data/commands.json');
  const variables = readJson('data/variables.json');
  const corpus = audit.buildHelpCorpus(helpRoot);
  const functions = generateCommands(commands, corpus);
  const variableCount = generateVariables(variables, corpus);
  const constants = generateConstants(variables, corpus);
  const triggerCount = generateTriggers(commands, corpus);
  commands.totalTriggers = commands.triggers.length;
  validate(commands, variables, functions, constants);

  const verifiedFunctions = Object.values(functions)
    .filter(info => info.completionVerified && info.completionEnabled).length;
  const summary = {
    helpPages: corpus.pages.length,
    functions: Object.keys(functions).length,
    verifiedFunctionCompletions: verifiedFunctions,
    variables: variableCount,
    constants: constants.length,
    triggers: triggerCount,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!apply) {
    console.log('Dry run only. Pass --apply to update data files.');
    return;
  }
  writeJson('data/commands.json', commands);
  writeJson('data/variables.json', variables);
  writeJson('data/functions-996pc.json', functions);
  writeJson('data/constants-996pc.json', {
    schemaVersion: 1,
    engine: '996PC',
    generated: revision,
    constants,
  });
}

main();
