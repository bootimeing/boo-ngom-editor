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
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8'
  );
}

function commandKey(name) {
  return name.toUpperCase();
}

function replaceSyntaxName(syntax, name) {
  return syntax.replace(/^[A-Z][A-Z0-9_.]*(?=\s|$)/i, name);
}

function syntaxParams(syntax, name) {
  return syntax
    .replace(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')
    .trim();
}

function normalizedSyntax(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[，、；：]/g, match => (
      { '，': ',', '、': ',', '；': ';', '：': ':' }[match]
    ))
    .trim();
}

function safeExactSyntax(name, syntax) {
  const suffix = syntaxParams(syntax || name, name);
  if (!suffix) return true;
  if (/(?:\/\/|https?:|\.{1,2}\\|\.txt\b|<\$|区别|此命令|以下|说明|注意|功能|用于|里面|示例|更新日期|命令的)/i.test(suffix)) {
    return false;
  }
  const genericTokens = suffix
    .replace(/[（(][^）)]*[）)]/g, '')
    .split(/\s+/)
    .map(token => token.replace(/^[\[【]|[\]】,:：;；]$/g, ''))
    .filter(Boolean);
  if (
    genericTokens.length >= 2
    && genericTokens.every(token => /^参数(?:\d+|[一二三四五六七八九十]+)$/i.test(token))
  ) {
    return false;
  }
  return !/^(?:-?\d+|[^()\s]{1,8}\s+-?\d+(?:\s+-?\d+)*)$/i.test(suffix);
}

function hasExactSyntaxEvidence(name, syntax, record) {
  const expected = normalizedSyntax(syntax);
  return safeExactSyntax(name, syntax)
    && (record?.documentation?.syntaxEvidence || []).some(evidence => (
      normalizedSyntax(evidence.line) === expected
    ));
}

function source(page) {
  return { revision, page };
}

function noArgCorrection(name, details, kind = 'action') {
  return {
    details,
    syntax: name,
    params: '',
    paramList: [],
    kind,
    contexts: [kind === 'check' ? 'IF' : 'ACT'],
    minArgs: 0,
    maxArgs: 0,
  };
}

const falseGeeFunctions = new Set([
  'AUTOCOLOR',
  'CHECK',
  'COUNTERATTACKDELAY',
  'EM029B',
  'EM029C',
  'EM029E',
  'EM029F',
  'EM029H',
  'EM029I',
  'EM029K',
  'EM029L',
  'EM029N',
  'EM029O',
  'EM029Q',
  'EM029R',
  'EM029T',
  'EM029U',
  'EM029W',
  'EM029X',
  'EM029Z',
  'EXPEND2',
  'EXPEND3',
  'EXPEND4',
  'FBOLD',
  'FCOLOR',
  'FNAME',
  'ITEMADDVALUERATE',
  'LOGINSRV',
  'NODEARRECALL',
  'NODRUG',
  'NORANDOMMOVE',
  'NORECALL',
  'POST',
  'QQQQ',
  'RUNATTACKRATE',
  'SETUP',
  'SHAPE',
  'STDMODE',
  'TEST',
  'USEITEMS',
]);

const unsupportedGeeFunctions = new Set([
  'CHANGEGAMEPETABILITYEX',
  'CHECKHEROCOUNT',
  'CHECKNAMELIST',
  'DELETESKILLNG',
  'ISNEWSERVER',
  'OPENDLG',
  'STOPSOUND',
]);

const unsupportedGomFunctions = new Set([
  'CHECKCURRTEMNAME',
  'CHECKINRANGE',
]);

const geeCorrections = {
  NOT: {
    details: '对紧随其后的检测命令取反',
    syntax: 'NOT 检测命令',
    paramList: ['检测命令'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 1,
    source: source('游戏引擎反外挂系统/脚本检测命令/脚本检测命令取反NOT[!].htm'),
  },
  BATCHDELAY: {
    details: '设置按地图列表移动时每一步的暂停时间',
    syntax: 'batchDelay 暂停时间',
    paramList: ['暂停时间'],
    minArgs: 1,
    maxArgs: 1,
  },
  BATCHMOVE: noArgCorrection(
    'batchmove',
    '从地图列表的第一张地图开始依次移动'
  ),
  BAGITEMTOSTORAGEMAKEINDEX: {
    details: '按物品唯一序列号把背包物品放入指定仓库，并返回实际存放数量',
    syntax: 'BagItemToStorageMakeIndex 物品唯一序列号 仓库类型 返回变量',
    paramList: [
      '物品唯一序列号',
      '仓库类型(0普通仓/1无限仓)',
      '返回变量:实际存放数量',
    ],
    minArgs: 3,
    maxArgs: 3,
  },
  BREAKADDSELLPLAYER: noArgCorrection(
    'BreakAddSellPlayer',
    '中止添加角色出售'
  ),
  BREAKGAMEPETTRAININGMAGIC: noArgCorrection(
    'BreakGamePetTrainingMagic',
    '中断当前宠物技能学习'
  ),
  CHANGEHUMGROUPITEMRATE: {
    details: '调整人物套装百分比属性，并与套装百分比叠加计算',
    syntax: 'ChangeHumGroupItemRate 属性索引(0-25) 操作符(+,-,=) 值',
    paramList: ['属性索引(0-25)', '操作符(+,-,=)', '值'],
    minArgs: 3,
    maxArgs: 3,
  },
  CHECKCALLGAMEPET: noArgCorrection(
    'CheckCallGamePet',
    '检测宠物是否已召唤',
    'check'
  ),
  CHECKBAGITEMS: {
    details: '检测背包是否包含文件列出的物品，并保存匹配物品名和数量',
    syntax: 'CheckBagItems 文件名 物品名变量 数量变量',
    paramList: ['文件名', '物品名变量', '数量变量'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 3,
    maxArgs: 3,
  },
  CHECKHEROONLINE: noArgCorrection(
    'CheckHeroOnline',
    '检测英雄是否出战',
    'check'
  ),
  CHECKISSELLPLAYDELEGATOR: noArgCorrection(
    'CheckIsSellPlayDelegator',
    '检测自己是否为角色出售委托人',
    'check'
  ),
  CHECKISSELLPLAYER: noArgCorrection(
    'CheckIsSellPlayer',
    '检测自己是否正在出售角色',
    'check'
  ),
  CHECKKILLBYHUM: noArgCorrection(
    'CheckKillByHum',
    '检测当前死亡是否由人物造成',
    'check'
  ),
  CHECKMARRY: noArgCorrection(
    'CheckMarry',
    '检测人物是否已经结婚',
    'check'
  ),
  CHECKMASTER: noArgCorrection(
    'CheckMaster',
    '检测人物是否已经拜师',
    'check'
  ),
  CHECKMYSHOP: noArgCorrection(
    'CheckMyShop',
    '检测人物是否已开设个人商店',
    'check'
  ),
  CHECKOPENLASTSKILL: noArgCorrection(
    'CheckOpenLastSkill',
    '检测第四个连击技能是否开启',
    'check'
  ),
  CHECKPOSEMARRY: noArgCorrection(
    'CheckPoseMarry',
    '检测对面人物是否已经结婚',
    'check'
  ),
  CHECKPOSEMASTER: noArgCorrection(
    'CheckPoseMaster',
    '检测对面人物是否为别人的徒弟',
    'check'
  ),
  CHECKSHOWFASHION: noArgCorrection(
    'CheckShowFashion',
    '检测时装外显是否开启',
    'check'
  ),
  CHECKOPENGODBLESS: {
    details: '检测指定神佑格是否已经开启',
    syntax: 'CheckOpenGodBless 格子位置(0-11) [时装神佑]',
    paramList: ['格子位置(0-11)', '[时装神佑:0普通/1时装]'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 1,
    maxArgs: 2,
  },
  CHECKSHOWGODBLESS: {
    details: '检测普通或时装神佑图标是否显示',
    syntax: 'CheckShowGodBless 时装神佑',
    paramList: ['时装神佑(0普通/1时装)'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 1,
    maxArgs: 1,
  },
  CHECKSTOPM2MAKEMON: noArgCorrection(
    'CheckStopM2MakeMon',
    '检测是否已经暂停刷怪',
    'check'
  ),
  CLEARHEROALLSKILL: noArgCorrection(
    'ClearHeroAllSkill',
    '清除英雄所有技能'
  ),
  CLOSEARRBUFF: noArgCorrection(
    'CloseArrBuff',
    '关闭自动排列 BUFF'
  ),
  CLOSEAUTOPICKITEM: noArgCorrection(
    'CloseAutoPickItem',
    '关闭自动捡物'
  ),
  EXITGROUP: noArgCorrection(
    'ExitGroup',
    '使人物自动退出当前队伍'
  ),
  EXITNATION: noArgCorrection(
    'ExitNation',
    '使人物退出当前国家'
  ),
  CACHECHECKBAGITEMS: {
    details: '使用缓存检测背包是否包含文件列出的物品，并返回物品名和数量',
    syntax: 'CacheCheckBagItems 文件名 物品名变量 数量变量',
    paramList: ['文件名', '物品名变量', '数量变量'],
    minArgs: 3,
    maxArgs: 3,
  },
  CHANGESLAVEBODYSIZE: {
    details: '修改指定宝宝或全部宝宝的体型大小',
    syntax: 'ChangeSlaveBodySize 体型大小 宝宝名称 [有效时间]',
    paramList: ['体型大小', '宝宝名称(*为全部)', '[有效时间秒:空或0不限时]'],
    minArgs: 2,
    maxArgs: 3,
  },
  CHANGESTATE: {
    details: '按效果类型改变人物状态，并可配置几率、伤害、间隔和播放素材',
    syntax: 'ChangeState 效果 时间 [参数3] [参数4] [WIL] [开始图片] [播放张数] [播放速度] [透明绘制] [聊天提示]',
    paramList: [
      '效果',
      '时间',
      '[参数3:按效果表示几率或伤害值]',
      '[参数4:按效果表示间隔或百分比]',
      '[WIL序号]',
      '[开始图片]',
      '[播放张数]',
      '[播放速度]',
      '[透明绘制:0或空/1]',
      '[聊天提示:0或空/1]',
    ],
    minArgs: 2,
    maxArgs: 10,
  },
  GETCUSTOMITEMTEXTCOLOR: {
    details: '获取指定装备位置的自定义文字颜色',
    syntax: 'GetCustomItemTextColor 装备位置 返回变量',
    paramList: ['装备位置', '返回变量'],
    minArgs: 2,
    maxArgs: 2,
  },
  GETBAGITEMCOUNT: {
    details: '获取背包中指定物品的数量',
    syntax: 'GetBagItemCount 物品名称 保存变量 [排除OK框] [判断满持久]',
    paramList: [
      '物品名称',
      '保存变量',
      '[排除OK框:0或空计算/1排除]',
      '[判断满持久:0或空不判断/1判断]',
    ],
    minArgs: 2,
    maxArgs: 4,
  },
  GETHERO: noArgCorrection(
    'GetHero',
    '领回人物的英雄'
  ),
  GIVEBOXITEM: {
    details: '将背包中的指定物品放入指定自定义 OK 框',
    syntax: 'GiveBoxItem OK框编号(0-31) 物品名称 [数量]',
    paramList: ['OK框编号(0-31)', '物品名称', '[数量:仅叠加物品有效]'],
    minArgs: 2,
    maxArgs: 3,
  },
  GIVEGAMEPET: {
    details: '给予宠物蛋，可返回宠物蛋的 MakeIndex',
    syntax: 'GiveGamePet 怪物名 [MakeIndex变量]',
    paramList: ['怪物名', '[MakeIndex变量]'],
    minArgs: 1,
    maxArgs: 2,
  },
  GIVEFENGHAO: {
    details: '给予玩家称号，并可立即激活为当前称号',
    syntax: 'GiveFengHao 称号名称 [立即激活]',
    paramList: ['称号名称', '[立即激活:1激活，空为不激活]'],
    minArgs: 1,
    maxArgs: 2,
  },
  LOADDUMMYCONFIGFILE: noArgCorrection(
    'LoadDummyConfigFile',
    '重新加载假人配置文件'
  ),
  LOCKUPDATEABIL: noArgCorrection(
    'LockUpdateAbil',
    '锁定人物属性刷新，用于批量修改属性前'
  ),
  OFFLINE: {
    details: '设置离线挂机的经验发放间隔和每次经验',
    syntax: 'OFFLINE 间隔秒 每次经验',
    paramList: ['获得经验的间隔秒', '每次获得经验值'],
    minArgs: 2,
    maxArgs: 2,
  },
  OPENGAMEPETDLG: noArgCorrection(
    'OpenGamePetDlg',
    '打开宠物界面'
  ),
  OPENGAMESHOP: noArgCorrection(
    'OpenGameShop',
    '打开游戏商铺窗口'
  ),
  OPENGAMESHOPDLG: noArgCorrection(
    'OpenGameShopDlg',
    '打开个人店铺摆摊界面'
  ),
  OPENGODBLESS: {
    details: '开启普通或时装神佑格',
    syntax: 'OpenGodBless 格子位置(0-11或ALL) [时装神佑]',
    paramList: ['格子位置(0-11或ALL)', '[时装神佑:0普通/1时装]'],
    minArgs: 1,
    maxArgs: 2,
  },
  OPENLASTSKILL: noArgCorrection(
    'OpenLastSkill',
    '开启第四个连击技能'
  ),
  RESETALLMONITEMS: noArgCorrection(
    'ResetAllMonItems',
    '恢复所有怪物的默认爆率配置'
  ),
  RESETMONITEMS: {
    details: '恢复指定怪物的默认爆率配置',
    syntax: 'ResetMonItems 怪物名称',
    paramList: ['怪物名称'],
    minArgs: 1,
    maxArgs: 1,
  },
  RESTRENEWLEVEL: noArgCorrection(
    'RestRenewLevel',
    '清除人物转生数据'
  ),
  SETCUSTOMITEMTEXTCOLOR: {
    details: '设置指定装备位置的自定义文字颜色',
    syntax: 'SetCustomItemTextColor 装备位置 文字颜色(0-255)',
    paramList: ['装备位置', '文字颜色(0-255)'],
    minArgs: 2,
    maxArgs: 2,
  },
  SETSENDMSGFLAG: noArgCorrection(
    'SetSendMsgFlag',
    '设置祝福语脚本的发送消息标志'
  ),
  SHOWARRBUFF: noArgCorrection(
    'ShowArrBuff',
    '显示自动排列 BUFF'
  ),
  SHOWFOUNDRYITEM: noArgCorrection(
    'ShowFoundryItem',
    '显示当前物品合成所需材料'
  ),
  SHOWGODBLESS: {
    details: '显示或隐藏普通、时装神佑图标',
    syntax: 'ShowGodBless 显示开关 [时装神佑]',
    paramList: ['显示开关(0隐藏/1显示)', '[时装神佑:0普通/1时装]'],
    minArgs: 1,
    maxArgs: 2,
  },
  STARTAUTOPLAYGAME: noArgCorrection(
    'StartAutoPlayGame',
    '开始内挂挂机'
  ),
  STOPAUTOPLAYGAME: noArgCorrection(
    'StopAutoPlayGame',
    '停止内挂挂机'
  ),
  UPDATEABIL: noArgCorrection(
    'UpdateAbil',
    '解除属性刷新锁定并立即更新人物属性'
  ),
  ACTREPAIRALL: noArgCorrection(
    'ActRepairAll',
    '执行人物全身装备特修'
  ),
  CHANGEMONEY: {
    details: '调整指定货币或其关联货币的数量',
    syntax: 'ChangeMoney 货币名称 操作符(=,+,-) 值',
    paramList: ['货币名称', '操作符(=,+,-)', '值'],
    minArgs: 3,
    maxArgs: 3,
  },
  CHANGEHUMCREDITEX: {
    details: '调整人物声望值',
    syntax: 'ChangeHumCreditEx 操作符(+,-,=) 值',
    paramList: ['操作符(+,-,=)', '值'],
    minArgs: 2,
    maxArgs: 2,
  },
  CHECKHEROLEVEL: {
    details: '检测英雄等级',
    syntax: 'CheckHeroLevel 操作符(>,=,<) 等级',
    paramList: ['操作符(>,=,<)', '等级'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 2,
  },
  CHECKHUMCREDITEX: {
    details: '检测人物声望值',
    syntax: 'CheckHumCreditEx 操作符(>,=,<) 值',
    paramList: ['操作符(>,=,<)', '值'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 2,
  },
  CHECKCLIENTHEIGHT: {
    details: '检测当前客户端窗口的分辨率高度',
    syntax: 'CheckClientHeight 操作符(>,=,<) 数值',
    paramList: ['操作符(>,=,<)', '数值'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 2,
  },
  CHECKCLIENTWIDTH: {
    details: '检测当前客户端窗口的分辨率宽度',
    syntax: 'CheckClientWidth 操作符(>,=,<) 数值',
    paramList: ['操作符(>,=,<)', '数值'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 2,
  },
  CHECKJSONNODEEXISTS: {
    details: '检测 JSON 中是否存在指定节点',
    syntax: 'CheckJsonNodeExists JSON内容 节点路径',
    paramList: ['JSON内容', '节点路径'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 2,
  },
  CHECKJSONNODEISARRAY: {
    details: '检测 JSON 指定节点是否为数组',
    syntax: 'CheckJsonNodeIsArray JSON内容 节点路径',
    paramList: ['JSON内容', '节点路径'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 2,
  },
  CHECKJSONNODEISNULL: {
    details: '检测 JSON 指定节点是否为空值',
    syntax: 'CheckJsonNodeIsNull JSON内容 节点路径',
    paramList: ['JSON内容', '节点路径'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 2,
  },
  CHECKJSONNODEISOBJECT: {
    details: '检测 JSON 指定节点是否为对象',
    syntax: 'CheckJsonNodeIsObject JSON内容 节点路径',
    paramList: ['JSON内容', '节点路径'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 2,
  },
  CLEARLINKITEM: noArgCorrection(
    'ClearLinkItem',
    '解除当前物品绑定并立即刷新背包物品属性'
  ),
  CLOSEAUTODROPITEMTOBAG: noArgCorrection(
    'CloseAutoDropItemToBag',
    '关闭怪物爆出物品自动进入背包'
  ),
  CREATGROUP: {
    details: '强制创建队伍并邀请指定人物',
    syntax: 'CreatGroup 人物名称',
    paramList: ['人物名称'],
    minArgs: 1,
    maxArgs: 1,
  },
  EXITGAME: noArgCorrection(
    'ExitGame',
    '使客户端大退游戏'
  ),
  GETDUMMYNAME: {
    details: '从假人名称列表中获取人物或英雄名称',
    syntax: 'GetDummyName 返回变量 列表类型 获取类型',
    paramList: [
      '返回变量',
      '列表类型(0人物/1英雄)',
      '获取类型(0顺序/1随机)',
    ],
    minArgs: 3,
    maxArgs: 3,
  },
  GETMAPROUTEINFO: {
    details: '获取动态地图链接的地图编号和坐标',
    syntax: 'GetMapRouteInfo 链接标识 查看方式 地图变量 X变量 Y变量',
    paramList: [
      '链接标识',
      '查看方式(0连接地图/1待连接地图)',
      '地图变量',
      'X变量',
      'Y变量',
    ],
    minArgs: 5,
    maxArgs: 5,
  },
  GIVEFOUNDRYITEM: {
    details: '检测合成材料并给予指定合成物品',
    syntax: 'GiveFoundryItem 合成物品名称',
    paramList: ['合成物品名称'],
    minArgs: 1,
    maxArgs: 1,
  },
  GIVEONGROUND: {
    details: '将指定数量的物品放到当前地面',
    syntax: 'GiveOnGround 物品名称 数量',
    paramList: ['物品名称', '数量'],
    minArgs: 2,
    maxArgs: 2,
  },
  OPENAUTODROPITEMTOBAG: {
    details: '开启怪物爆出物品自动进入背包',
    syntax: 'OpenAutoDropItemToBag 对象 [时间] [进入主人背包]',
    paramList: [
      '对象(1自己/2宝宝/3自己和宝宝)',
      '[时间秒:0或空为在线有效]',
      '[进入主人背包:仅H.命令有效，0或空进英雄背包/1进主人背包]',
    ],
    minArgs: 1,
    maxArgs: 3,
  },
  OPENPLAYDRINK: {
    details: '打开斗酒界面；当前帮助只给出二至三个参数的示例，未解释完整参数含义',
    syntax: 'OpenPlayDrink',
    params: '',
    paramList: [],
    minArgs: 0,
    maxArgs: 0,
    completionVerified: false,
  },
  PLAYMP3: {
    details: '播放网络 MP3 或客户端 Music 目录中的本地 MP3',
    syntax: 'PlayMP3 MP3文件或网址',
    paramList: ['MP3文件或网址'],
    minArgs: 1,
    maxArgs: 1,
  },
  QUERYYBDEAL: noArgCorrection(
    'QueryYBDeal',
    '查询可购买的元宝寄售物品'
  ),
  QUERYYBSELL: noArgCorrection(
    'QueryYBSell',
    '查询人物正在寄售的元宝物品'
  ),
  RANDOM: {
    details: '按 1/N 概率进行随机检测',
    syntax: 'RANDOM 随机数',
    paramList: ['随机数'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 1,
    maxArgs: 1,
    source: source('游戏引擎反外挂系统/其他相关资料/传奇基础脚本命令详解[!].htm'),
  },
  RECALLMOBEX2: {
    details: '按指定坐标和规则召唤宝宝',
    syntax: 'RecallMobEx2 宝宝名称 X Y 视角范围 隐藏主人名 宝宝不升级',
    paramList: [
      '宝宝名称',
      'X坐标',
      'Y坐标',
      '视角范围',
      '隐藏主人名(0否/1是)',
      '宝宝不升级(0升级/1不升级)',
    ],
    minArgs: 6,
    maxArgs: 6,
  },
  SETDUMMYHERONAME: {
    details: '设置假人的英雄名称',
    syntax: 'SetDummyHeroName 英雄名称',
    paramList: ['英雄名称'],
    minArgs: 1,
    maxArgs: 1,
  },
  SETITEMFIELDVALUE: {
    details: '设置关联物品指定字段的值',
    syntax: 'SetItemFieldValue 物品位置 属性名称 值或变量',
    paramList: ['物品位置', '属性名称', '值或变量'],
    minArgs: 3,
    maxArgs: 3,
  },
  SETINSURANCECOUNTXX: {
    details: '调整指定装备位置的保险次数',
    syntax: 'SetInsuranceCountXX 位置 操作符 数值',
    paramList: ['位置', '操作符(+,-,=)', '数值'],
    minArgs: 3,
    maxArgs: 3,
  },
  SETMAGICEFFECT: {
    details: '修改指定技能的客户端特效，编号为 0 时恢复默认',
    syntax: 'SetMagicEffect 技能名称 特效编号',
    paramList: ['技能名称', '特效编号(0恢复默认)'],
    minArgs: 2,
    maxArgs: 2,
  },
  SETNODROPITEMCOUNT: {
    details: '设置人物不爆物品次数，并可指定下线保存和保护范围',
    syntax: 'SetNoDropItemCount 操作符 次数 下线保存 [爆出选项]',
    paramList: [
      '操作符(+,-,=)',
      '次数',
      '下线保存(0或空不保存/1保存)',
      '[爆出选项:0身上及背包/1仅身上装备]',
    ],
    minArgs: 3,
    maxArgs: 4,
  },
  SETTHROWITEMFROM: {
    details: '在执行 ThrowItem 前设置地面物品的来源信息',
    syntax: 'SetThrowItemFrom 来源类型 地图号 怪物名 杀人者 日期 时间',
    paramList: [
      '来源类型(0-9)',
      '地图号',
      '怪物名',
      '杀人者',
      '日期(YYYY-MM-DD)',
      '时间(HH:NN:SS)',
    ],
    minArgs: 6,
    maxArgs: 6,
  },
  STARTESCORT: {
    details: '开始押镖任务，未指定时间时默认 45 分钟',
    syntax: 'StartEscort 镖车数据库名称 [时间分钟]',
    paramList: ['镖车数据库名称(Race=128)', '[时间分钟:默认45]'],
    minArgs: 1,
    maxArgs: 2,
  },
  STOPTAKEOFF: noArgCorrection(
    'StopTakeOff',
    '在取下装备前触发中止本次取下'
  ),
  STOPTAKEON: noArgCorrection(
    'StopTakeOn',
    '在穿戴装备前触发中止本次穿戴'
  ),
  TEXTCOPY: {
    details: '按 ANSI 字符位置复制字符串片段',
    syntax: 'TextCopy 字符串 起始位置 长度 返回变量',
    paramList: ['字符串', '起始位置(从1开始)', '长度', '返回变量'],
    minArgs: 4,
    maxArgs: 4,
  },
  TEXTCOPYW: {
    details: '按 Unicode 字符位置复制字符串片段',
    syntax: 'TextCopyW 字符串 起始位置 长度 返回变量',
    paramList: ['字符串', '起始位置(从1开始)', '长度', '返回变量'],
    minArgs: 4,
    maxArgs: 4,
  },
  TEXTLENGTHW: {
    details: '获取 Unicode 字符串长度',
    syntax: 'TextLengthW 字符串 返回变量',
    paramList: ['字符串', '返回变量'],
    minArgs: 2,
    maxArgs: 2,
  },
  TEXTPOS: {
    details: '按 ANSI 字符位置查找字符串',
    syntax: 'TextPos 待查找内容 源字符串 返回变量',
    paramList: ['待查找内容', '源字符串', '返回变量'],
    minArgs: 3,
    maxArgs: 3,
  },
  TEXTPOSW: {
    details: '按 Unicode 字符位置查找字符串',
    syntax: 'TextPosW 待查找内容 源字符串 返回变量',
    paramList: ['待查找内容', '源字符串', '返回变量'],
    minArgs: 3,
    maxArgs: 3,
  },
  VERIFYCODE: {
    details: '调用验证码界面，验证成功后跳转到指定标签',
    syntax: 'VerifyCode @成功标签',
    paramList: ['@成功标签'],
    minArgs: 1,
    maxArgs: 1,
  },
  MESSAGEBOX: {
    details: '弹出消息框，确定或取消后跳转到对应标签',
    syntax: 'MessageBox 文字信息 [@确定标签] [@取消标签]',
    paramList: ['文字信息', '[@确定标签]', '[@取消标签]'],
    minArgs: 1,
    maxArgs: 3,
  },
  RANDOMEX: {
    details: '按分子/分母概率进行随机检测',
    syntax: 'RandomEx 分子 分母',
    paramList: ['分子', '分母'],
    kind: 'check',
    minArgs: 2,
    maxArgs: 2,
  },
  ADDHPPEREX: {
    details: '按当前HP值的比例调整HP；2023-03-18更新说明支持自定义飘血',
    syntax: 'AddHpPerEx 操作符 比例值 [比例类型] [飘血图片序号]',
    paramList: [
      '操作符(+,-,=)',
      '比例值',
      '[比例类型:0百分比/1千分比/2万分比]',
      '[飘血图片序号:格式同HUMANHP]',
    ],
    aliases: ['H.AddHpPerEx', 'FS.AddHpPerEx'],
    minArgs: 2,
    maxArgs: 4,
  },
  ADDMPPEREX: {
    details: '按当前MP值的比例调整MP，可指定自定义飘血图片',
    syntax: 'AddMpPerEx 操作符 比例值 [比例类型] [飘血图片序号]',
    paramList: [
      '操作符(+,-,=)',
      '比例值',
      '[比例类型:0百分比/1千分比/2万分比]',
      '[飘血图片序号:格式同HUMANHP]',
    ],
    aliases: ['H.AddMpPerEx', 'FS.AddMpPerEx'],
    minArgs: 2,
    maxArgs: 4,
  },
  ADDARRBUTTON: {
    details: '在引擎配置的分组中添加自动排列按钮',
    syntax: 'AddArrButton 分组编号 触发序号 WIL 默认图 经过图 按下图 创建位置 标题 提示',
    paramList: [
      '分组编号(1-7)',
      'QF触发序号:触发@ArrButtonClickX',
      'WIL补丁序号',
      '默认图片',
      '鼠标经过图片',
      '鼠标按下图片',
      '创建位置或移动模式',
      '标题(-1不显示)',
      '悬浮提示',
    ],
    minArgs: 9,
    maxArgs: 9,
  },
  ADDMIRRORMAP: {
    details: '动态创建镜像地图，可返回创建结果并设置倒计时和退出坐标',
    syntax: 'AddMirrorMap 原地图 新地图 新地图名 有效时间 返回地图 小地图 [结果变量] [倒计时显示] [返回坐标]',
    paramList: [
      '原地图编号',
      '新地图编号',
      '新地图显示名',
      '有效时间秒',
      '退出返回地图',
      '小地图编号',
      '[结果变量:成功1/失败0]',
      '[倒计时显示:0剩3分钟显示/1一直显示]',
      '[返回坐标:空或0,0随机]',
    ],
    minArgs: 6,
    maxArgs: 9,
  },
  ADDMAPGATE: {
    details: '增加动态地图连接，可设置有效时间和传送门样式',
    syntax: 'AddMapGate 连接名称 地图 X Y 范围 目标地图 目标X 目标Y [有效时间] [传送门样式]',
    paramList: [
      '连接名称',
      '入口地图',
      '入口X(小于0随机)',
      '入口Y(小于0随机)',
      '入口范围',
      '目标地图',
      '目标X(小于0随机)',
      '目标Y(小于0随机)',
      '[有效时间秒:空为不限时]',
      '[传送门样式:1-5，0或空不显示]',
    ],
    minArgs: 8,
    maxArgs: 10,
  },
  CANMOVEECTYPE: {
    details: '检测指定名称的副本是否已经创建',
    syntax: 'CanMoveEctype 副本名称',
    paramList: ['副本名称'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 1,
    maxArgs: 1,
  },
  CHANGEGAMEPETABILITY: {
    details: '修改当前召唤宠物的临时属性；属性30设置有效时间，单位为秒',
    syntax: 'ChangeGamePetAbility 属性类型 数值',
    paramList: [
      '属性类型(0 HP/1 MaxHP/2 MP/3 MaxMP/4-15战斗属性/30有效时间)',
      '数值:属性30时为有效时间秒，空或0不检测时间',
    ],
    minArgs: 2,
    maxArgs: 2,
  },
  CHANGEMONABILITY: {
    details: '修改地图内指定怪物的属性；省略坐标范围时作用于整张地图，消耗较高',
    syntax: 'ChangeMonAbility 地图 怪物名 属性类型 操作符 参数值 [值类型] [X] [Y] [范围]',
    paramList: [
      '地图(SELF为当前地图)',
      '怪物名(*为全部)',
      '属性类型(0-15；30为属性有效时间)',
      '操作符(+,-,=)',
      '参数值:属性30时单位为秒',
      '[值类型:0点数/1百分比]',
      '[X]',
      '[Y]',
      '[范围:0或空为指定坐标；坐标范围全空为整图]',
    ],
    minArgs: 5,
    maxArgs: 9,
  },
  CHECKINDICT: {
    details: '检测字典中是否存在指定键或值',
    syntax: 'CheckInDict 字典变量 待检查值 [检查类型]',
    paramList: [
      '字典变量',
      '待检查值',
      '[检查类型:0或空检查key/1检查value]',
    ],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 3,
  },
  CHECKDEARONLINE: {
    details: '检测自己或指定人物的配偶是否在线',
    syntax: 'CheckDearOnline [人物名称]',
    paramList: ['[人物名称:空为检查自己的配偶]'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 0,
    maxArgs: 1,
  },
  CHECKDEARONMAP: {
    details: '检测自己或指定人物的配偶是否在当前或指定地图',
    syntax: 'CheckDearOnMap [地图] [人物名称]',
    paramList: [
      '[地图:self或空为当前地图]',
      '[人物名称:空为检查自己的配偶]',
    ],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 0,
    maxArgs: 2,
  },
  CHECKITEMS: {
    details: '检测背包以及可选的已穿戴位置中指定物品的总数量',
    syntax: 'CheckItems 物品名称 数量 [检测身上同名装备]',
    paramList: [
      '物品名称',
      '数量',
      '[检测身上同名装备:包含装备、首饰和神佑]',
    ],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 3,
  },
  CREATEECTYPE: {
    details: '创建指定名称并带有效时间的副本',
    syntax: 'CreateEctype 副本名称 有效时间',
    paramList: ['副本名称', '有效时间'],
    minArgs: 2,
    maxArgs: 2,
  },
  CLEARHUMGROUPITEMRATES: {
    details: '清除ChangeHumGroupItemRate调整的人物套装百分比；调用后需另行触发属性重算',
    syntax: 'ClearHumGroupItemRates',
    params: '',
    paramList: [],
    minArgs: 0,
    maxArgs: 0,
  },
  DELMASTER: {
    details: '清除拜师关系；徒弟执行时清除师傅，师傅可指定徒弟序号',
    syntax: 'DelMaster [徒弟序号]',
    paramList: ['[徒弟序号:空为大徒弟]'],
    minArgs: 0,
    maxArgs: 1,
  },
  GETBAGINFO: {
    details: '获取背包物品数量、MakeIndex、数据库Idx或名称列表',
    syntax: 'GetBagInfo 信息类型 保存变量 [StdMode列表]',
    paramList: [
      '信息类型(ItemCount/ItemMakeIndex/ItemIdx/ItemName)',
      '保存变量:列表信息需元素变量',
      '[StdMode列表:例如5或5|6|10|11]',
    ],
    minArgs: 2,
    maxArgs: 3,
  },
  GETBAGITEMFIELDVALUE: {
    details: '按背包序号或MakeIndex获取物品数据库字段值',
    syntax: 'GetBagItemFieldValue 取值方式 物品标识 字段名 保存变量',
    paramList: [
      '取值方式(0背包序号/1 MakeIndex)',
      '物品序号或MakeIndex',
      '字段名',
      '保存变量',
    ],
    minArgs: 4,
    maxArgs: 4,
  },
  GETGAMEPETABILITY: {
    details: '获取ChangeGamePetAbility设置的当前宠物临时属性值',
    syntax: 'GetGamePetAbility 属性类型 保存变量',
    paramList: [
      '属性类型(0-15；30为剩余有效时间秒)',
      '保存变量',
    ],
    minArgs: 2,
    maxArgs: 2,
  },
  GETGAMEPETEGGABIL: {
    details: '获取升级框或OK框中宠物蛋的指定属性',
    syntax: 'GetGamePetEggAbil 物品位置 属性类型 保存变量',
    paramList: [
      '物品位置(-1升级框/boxitem0-boxitem7)',
      '属性类型(1等级/2 HP/3 MP/4 EXP/5-17上限与战斗属性)',
      '保存变量',
    ],
    minArgs: 3,
    maxArgs: 3,
  },
  GETGUILDMEMBERCOUNT: {
    details: '获取指定行会的总人数或当前在线人数并保存到变量',
    syntax: 'GetGuildMemberCount 行会名称 保存变量 [人数类型]',
    paramList: [
      '行会名称',
      '保存变量:行会不存在返回0',
      '[人数类型:0或空总人数/1在线人数]',
    ],
    kind: 'action',
    contexts: ['ACT'],
    minArgs: 2,
    maxArgs: 3,
  },
  GIVEONITEM: {
    details: '创建新物品并直接放入指定装备、首饰盒、神佑袋或OK框位置',
    syntax: 'GiveOnItem 装备位置 物品名称 [数量] [属性4] [属性5] [属性6] [属性7] [属性8] [属性9] [刺术] [箭术] [武力]',
    paramList: [
      '装备位置(-1升级框/0-29装备与时装/30-35首饰盒/40-51神佑袋/boxitem0-boxitem7)',
      '物品名称',
      '[数量:默认1；大于1仅对OK框叠加物品有效]',
      '[极品属性参数4]',
      '[极品属性参数5]',
      '[极品属性参数6]',
      '[极品属性参数7]',
      '[极品属性参数8]',
      '[极品属性参数9]',
      '[刺术]',
      '[箭术]',
      '[武力]',
    ],
    minArgs: 2,
    maxArgs: 12,
    source: source('游戏引擎反外挂系统/其他相关资料/扩展GIVE命令.htm'),
  },
  HEROM2ADDUSERITEM: {
    details: '从假人背包找到指定物品并上架到摊位',
    syntax: 'HeroM2AddUserItem 物品名称 单价 货币类型',
    paramList: [
      '物品名称',
      '单件价格:叠加物品按总数量计算',
      '货币类型(0元宝/1游戏点/2金币/3金刚石/4灵符)',
    ],
    minArgs: 3,
    maxArgs: 3,
  },
  HEROM2STARTSHOPSTALL: {
    details: '让假人开始摆摊并显示指定广告文字',
    syntax: 'HeroM2StartShopStall 显示文字',
    paramList: ['显示文字'],
    minArgs: 1,
  },
  INPUTNUM: {
    details: '在NPC对话框中创建数字输入框；前加&时使用绝对坐标',
    syntax: 'INPUTNUM:输入框ID:X:Y:宽度:高度:背景色:边框色:文字颜色:最小值:最大值:无效提示:提示文字:提示文字颜色',
    paramList: [
      '输入框ID(1-40，与INPUTTEXT共用)',
      'X',
      'Y',
      '宽度',
      '高度',
      '背景色(-1透明/0-255)',
      '边框色(-1无边框/0-255)',
      '文字颜色',
      '最小值',
      '最大值',
      '数据无效提示',
      '提示文字',
      '提示文字颜色',
    ],
    kind: 'say',
    contexts: ['SAY'],
    snippet: '<&INPUTNUM:${1:ID}:${2:X}:${3:Y}:${4:宽度}:${5:高度}:${6:背景色}:${7:边框色}:${8:文字颜色}:${9:最小值}:${10:最大值}:${11:无效提示}:${12:提示文字}:${13:提示文字颜色}>',
  },
  LISTVIEW: {
    details: '在#SAY中创建可滚动列表容器；ListView容器不能嵌套',
    syntax: 'ListView:控件ID:X:Y:宽度:高度:子控件间隔[:跳转下标:方向:预留3:预留4:预留5:滚动素材WZL:滚动条背景:上箭头默认:上箭头经过:上箭头按下:滑块默认:滑块经过:滑块按下:下箭头默认:下箭头经过:下箭头按下]',
    paramList: [
      '控件ID',
      'X',
      'Y',
      '宽度',
      '高度',
      '子控件间隔',
      '[跳到第几个容器:从0开始]',
      '[方向:0竖向/1横向]',
      '[预留3]',
      '[预留4]',
      '[预留5]',
      '[滚动素材WZL]',
      '[滚动条背景]',
      '[向上箭头默认图]',
      '[向上箭头经过图]',
      '[向上箭头按下图]',
      '[滑块默认图]',
      '[滑块经过图]',
      '[滑块按下图]',
      '[向下箭头默认图]',
      '[向下箭头经过图]',
      '[向下箭头按下图]',
    ],
    kind: 'say',
    contexts: ['SAY'],
    snippet: '<ListView:${1:控件ID}:${2:X}:${3:Y}:${4:宽度}:${5:高度}:${6:子控件间隔}>',
  },
  NOAUTODROPITEMTOBAG: {
    details: 'MapInfo地图参数：禁止OpenAutoDropItemToBag自动入包',
    syntax: 'NoAutoDropItemToBag',
    params: '',
    paramList: [],
    kind: 'control',
    contexts: ['ANY'],
    minArgs: 0,
    maxArgs: 0,
  },
  NOAUTORANGEPICKITEM: {
    details: 'MapInfo地图参数：禁止OpenAutoPickItem范围拾取',
    syntax: 'NoAutoRangePickItem',
    params: '',
    paramList: [],
    kind: 'control',
    contexts: ['ANY'],
    minArgs: 0,
    maxArgs: 0,
  },
  OFFLINEPLAY: {
    details: '设置离线挂机的经验间隔、每次经验和最长挂机时间',
    syntax: 'OfflinePlay 间隔秒 每次经验 挂机分钟',
    paramList: ['获得经验的间隔秒', '每次获得经验', '最长挂机分钟'],
    minArgs: 3,
    maxArgs: 3,
  },
  OPENAUTOUSEPICKITEM: {
    details: '开启人物或英雄背包物品自动替换装备',
    syntax: 'OpenAutoUsePickItem [提示模式] [有效时间] [倒计时] [到期操作]',
    paramList: [
      '[提示模式:0或空静默/1显示替换提示]',
      '[有效时间分钟:0或空不限时/1-65535]',
      '[替换对话框倒计时秒]',
      '[到期操作:0或空自动替换/1不替换并关闭]',
    ],
    aliases: ['H.OpenAutoUsePickItem'],
    minArgs: 0,
    maxArgs: 4,
  },
  OPENHUMDLG: {
    details: '打开人物装备、属性、技能、时装、称号、包裹、首饰盒或神佑页面',
    syntax: 'OpenHumDlg 页面 [X] [Y]',
    paramList: [
      '页面(0装备/1状态/2属性/3技能/4时装/5称号/6出战/7包裹/8首饰盒/9神佑/10时装首饰盒/11时装神佑)',
      '[X]',
      '[Y]',
    ],
    minArgs: 1,
    maxArgs: 3,
  },
  OPENHERODLG: {
    details: '打开英雄装备、属性、技能、时装、称号、包裹、首饰盒或神佑页面',
    syntax: 'OpenHeroDlg 页面 [X] [Y]',
    paramList: [
      '页面(0装备/1状态/2属性/3技能/4时装/5称号/6英雄包裹/8首饰盒/9神佑/10时装首饰盒/11时装神佑)',
      '[X]',
      '[Y]',
    ],
    minArgs: 1,
    maxArgs: 3,
  },
  PLAYMAGICBALLEFFECT: {
    details: '在HP或MP魔法球界面播放持续特效',
    syntax: 'PlayMagicBallEffect WIL 开始图片 张数 速度 有效时间 类型 绘制高度 绘制模式 X Y 渲染方式',
    paramList: [
      'WIL文件序号',
      '开始图片序号',
      '播放张数',
      '播放速度毫秒',
      '有效时间秒(-1永久)',
      '类型(0 HP/1 MP)',
      '绘制高度(0完整/1按HP或MP高度)',
      '绘制模式(0完整/1切割)',
      'X微调',
      'Y微调',
      '渲染方式(1普通/0或空特效绘制)',
    ],
    minArgs: 11,
    maxArgs: 11,
  },
  SETARRBUFF: {
    details: '为自动排列按钮设置按钮或倒计时，可在结束后切换图片',
    syntax: 'SetArrBuff 分组 按钮序号 WIL 图片 倒计时 闪烁起始时间 闪烁图片 闪烁数量 文字 [X] [Y] [结束切图开关] [结束图片]',
    paramList: [
      '分组编号(1-7)',
      '按钮序号(1-200，对应@ArrBuffClickX)',
      'WIL文件序号',
      '图片序号',
      '倒计时(-1按钮/>0倒计时)',
      '剩余多少时间开始闪烁',
      '闪烁图片开始序号',
      '闪烁图片数量',
      '文字备注',
      '[倒计时X]',
      '[倒计时Y]',
      '[结束切图开关:大于0时参数13生效]',
      '[倒计时结束图片序号]',
    ],
    minArgs: 9,
    maxArgs: 13,
  },
  SETCUSTOMITEMPROGRESSBAR: {
    details: '设置指定自定义装备位置的进度条属性',
    syntax: 'SetCustomItemProgressbar 装备位置 进度条序号 属性类型 值',
    paramList: [
      '装备位置',
      '进度条序号(0或1)',
      '属性类型(0开关/1名称/2名称颜色/3图片数量/4显示方式)',
      '属性值',
    ],
    minArgs: 4,
    maxArgs: 4,
  },
  SETITEMFROM: {
    details: '修改指定装备的来源、地图、怪物、经手人或时间信息',
    syntax: 'SetItemFrom 装备位置 类型 值1 [值2]',
    paramList: [
      '装备位置',
      '类型(0来源/1地图/2怪物/3经手人/4时间)',
      '值1:类型4时为日期',
      '[值2:类型4时为时间，其他类型留空]',
    ],
    minArgs: 3,
    maxArgs: 4,
  },
  SETGUILDMASTER: {
    details: '把当前人物设置为所在行会的正会长或副会长；已是会长时调用无效',
    syntax: 'SetGuildMaster 会长类型',
    paramList: ['会长类型(1正会长/2副会长)'],
    minArgs: 1,
    maxArgs: 1,
  },
  SETNEWITEMVALUEEX: {
    details: '临时调整指定装备的新增属性',
    syntax: 'SetNewItemValueEx 位置 属性 操作符 值 有效时间',
    paramList: [
      '装备位置(0-12)',
      '属性(0-26)',
      '操作符(+,-,=)',
      '属性值:范围按属性类型',
      '有效时间秒(1-65535)',
    ],
    minArgs: 5,
    maxArgs: 5,
  },
  SETNEXTDAMAGE: {
    details: '把当前脚本对象的下一次攻击伤害调整为指定百分比',
    syntax: 'SetNextDamage 下次伤害百分比',
    paramList: ['下次伤害百分比(必须大于0；低于100为减伤)'],
    minArgs: 1,
    maxArgs: 1,
  },
  SETREBORN: {
    details: '给予角色在指定有效期内可使用的复活次数',
    syntax: 'SetReborn 复活次数 有效时间',
    paramList: ['复活次数', '有效时间秒'],
    minArgs: 2,
    maxArgs: 2,
  },
  STOPSCREENEFFECT: {
    details: '按与ScreenEffect一致的特效参数停止匹配的屏幕特效',
    syntax: 'StopScreenEffect X Y WIL 开始图片 张数 次数 速度 播放效果 [模式] [播放位置]',
    paramList: [
      '屏幕X',
      '屏幕Y',
      'WIL文件序号',
      '开始图片序号',
      '播放张数',
      '播放次数(-1或0不限)',
      '播放速度毫秒',
      '播放效果(0普通/1魔法)',
      '[模式:0自己/1所有人]',
      '[播放位置:0或空对话框下层/1上层]',
    ],
    minArgs: 8,
    maxArgs: 10,
  },
  SELFMAPEFFECT: {
    details: '在指定地图坐标播放仅自己可见的地图魔法特效',
    syntax: 'SelfMapEffect 地图 X Y WIL 开始图片 张数 次数 速度 播放效果 亮度 ID',
    paramList: [
      '地图',
      'X',
      'Y',
      'WIL文件序号',
      '开始图片',
      '播放张数',
      '播放次数(-1无限)',
      '播放速度毫秒',
      '播放效果(0普通/1特效)',
      '亮度(0-5)',
      '特效ID',
    ],
    minArgs: 11,
    maxArgs: 11,
  },
  TEXTCONCAT: {
    details: '把后续字符串片段依次拼接并写入结果变量',
    syntax: 'TextConcat 结果变量 字符串片段...',
    paramList: ['结果变量', '一个或多个待拼接字符串片段...'],
    minArgs: 2,
  },
  SCENESHAKE: {
    details: '发送屏幕震动效果',
    syntax: 'SceneShake 模式 [次数或地图ID] [受内挂控制]',
    paramList: [
      '模式(0自己/1所有地图/2同屏/3当前地图/4指定地图)',
      '[次数；模式4时为地图ID]',
      '[受内挂屏幕震动选项控制(1是)]',
    ],
    minArgs: 1,
    maxArgs: 3,
  },
  CHANGEPULSELEVEL: {
    details: '调整指定经络的等级',
    syntax: 'ChangePulseLevel 经络 操作符 等级',
    paramList: ['经络(0-3)', '操作符(+,-,=)', '等级(1-5)'],
    minArgs: 3,
    maxArgs: 3,
  },
  CHANGENGPOINT: {
    details: '按点数或百分比调整人物内功点',
    syntax: 'ChangeNGPoint 操作符 值 [百分比标记]',
    paramList: [
      '操作符(+,-,=)',
      '值',
      '[百分比标记:%表示百分比，省略表示点数]',
    ],
    minArgs: 2,
    maxArgs: 3,
  },
  CHECKLUCKPOINT: {
    details: '检测人物幸运值',
    syntax: 'CheckLuckPoint 操作符 数量',
    paramList: ['操作符(=,>,<)', '数量'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 2,
  },
  CHECKLUCKPOINTY: {
    details: '使用兼容命令检测人物幸运值',
    syntax: 'CheckLuckPointY 操作符 数量',
    paramList: ['操作符(=,>,<)', '数量'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 2,
    maxArgs: 2,
  },
  CHECKITEMWLOOKS: {
    details: '检测是否穿戴指定装备，并可返回该装备的Looks值',
    syntax: 'CheckItemWLooks 装备名称 [Looks变量]',
    paramList: ['装备名称', '[Looks变量]'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 1,
    maxArgs: 2,
  },
  CHECKMAPMONCOUNT: {
    details: '检测指定地图中的怪物数量',
    syntax: 'CheckMapMonCount 地图号 操作符 数量 [不统计宝宝]',
    paramList: [
      '地图号',
      '操作符(<,=,>)',
      '数量',
      '[不统计宝宝:0或空统计/1不统计]',
    ],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 3,
    maxArgs: 4,
  },
  CHECKPULSELEVEL: {
    details: '检测指定经络的等级',
    syntax: 'CheckPulseLevel 经络 操作符 等级',
    paramList: ['经络(0-3)', '操作符(>,<,=)', '等级(1-5)'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 3,
    maxArgs: 3,
  },
  CHECKSTATEVALUE: {
    details: '检测当前脚本对象是否具有指定状态',
    syntax: 'CheckStateValue 状态值',
    paramList: ['状态值'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 1,
    maxArgs: 1,
  },
  GETSELLPLAYERCOUNT: {
    details: '获取委托当前人物出售的角色数量',
    syntax: 'GetSellPlayerCount 返回变量',
    paramList: ['返回变量'],
    minArgs: 1,
    maxArgs: 1,
  },
  GETPOSENAME: {
    details: '取得对面人物名称并写入变量',
    syntax: 'GetPoseName 返回变量',
    paramList: ['返回变量'],
    minArgs: 1,
    maxArgs: 1,
  },
  RECALLHUMAN: {
    details: '把指定在线人物召唤到当前人物身旁',
    syntax: 'RecallHuman 人物名称',
    paramList: ['人物名称'],
    minArgs: 1,
    maxArgs: 1,
  },
  RENEWLEVEL: {
    details: '增加人物转生次数，并设置转生后等级和分配点数',
    syntax: 'RenewLevel 转生次数 转后等级 分配点数',
    paramList: [
      '转生次数(1-255)',
      '转后等级(0表示不改变)',
      '分配点数(1-20000)',
    ],
    minArgs: 3,
    maxArgs: 3,
  },
  SETHEROSUCKDAMAGE: {
    details: '设置英雄可吸收的伤害总值、每次吸收比例和成功率',
    syntax: 'SetHeroSuckDamage 操作符 总吸收值 吸收比例 成功率',
    paramList: [
      '操作符(+,-,=)',
      '总吸收值(1-2000000，使用= -1表示无限)',
      '吸收比例(1-1000，1表示0.1%)',
      '成功率(1-100)',
    ],
    minArgs: 4,
    maxArgs: 4,
  },
  SETCUSTOMITEMVALUEEX: {
    details: '设置指定装备的一组三值自定义属性',
    syntax: 'SetCustomItemValueEx 装备位置 属性位置 操作符 属性值1 属性值2 属性值3',
    paramList: [
      '装备位置',
      '属性位置(0-19)',
      '操作符(+,-,=)',
      '属性值1',
      '属性值2',
      '属性值3',
    ],
    minArgs: 6,
    maxArgs: 6,
  },
  SETITEMSHAPE: {
    details: '修改武器或衣服的外观Shape，仅改变视觉效果',
    syntax: 'SetItemShape 装备位置 操作符 数值',
    paramList: ['装备位置', '操作符(+,-,=)', 'Shape数值'],
    minArgs: 3,
    maxArgs: 3,
  },
  SETDUMMYPICKITEMFILE: {
    details: '设置假人捡取列表文件和列表匹配模式',
    syntax: 'SetDummyPickItemFile 捡取列表文件名 [模式]',
    paramList: ['捡取列表文件名', '[模式:0或空优先/1允许]'],
    minArgs: 1,
    maxArgs: 2,
  },
  SETNPCIMAGE: {
    details: '设置NPC图像的编号、彩色模式和原始大小模式',
    syntax: 'SetNpcImage 编号 [彩色模式] [原始大小模式]',
    paramList: [
      '编号(-1表示雕像破碎)',
      '[彩色模式:0或空黑白/非0彩色]',
      '[原始大小模式:0放大/1原始大小]',
    ],
    minArgs: 1,
    maxArgs: 3,
  },
  SETRANDOMNO: {
    details: '设置随机验证码使用的字符类型',
    syntax: 'SetRandomNo [字符类型]',
    paramList: [
      '[字符类型:0或空数字/1数字加小写/2数字加大写/3数字加大小写]',
    ],
    minArgs: 0,
    maxArgs: 1,
  },
  SETSCRIPTFLAG: {
    details: '帮助仅给出装备改名场景中的1 1示例，未说明参数定义',
    syntax: 'SetScriptFlag',
    paramList: [],
    minArgs: 0,
    maxArgs: 0,
    completionVerified: false,
  },
  STOPHUMANJOINGUILD: noArgCorrection(
    'StopHumanJoinGuild',
    '在@BeforeJoinGuild触发中中止人物加入行会'
  ),
  TAKEITMECOUNTDURA: {
    details: '按名称、数量和持久条件收回物品',
    syntax: 'TakeItmeCountDura 物品名称 数量 操作符 持久',
    paramList: [
      '物品名称',
      '数量',
      '操作符(<,=,>)',
      '持久(MAXDURA表示持久上限)',
    ],
    minArgs: 4,
    maxArgs: 4,
  },
  TEXTREPLACE: {
    details: '替换字符串中的指定内容并保存结果',
    syntax: 'TextReplace 源字符串 旧内容 新内容 返回变量 [区分大小写] [仅替换一次]',
    paramList: [
      '源字符串',
      '旧内容',
      '新内容',
      '返回变量',
      '[区分大小写:0或空否/1是]',
      '[仅替换一次:0或空全部/1一次]',
    ],
    minArgs: 4,
    maxArgs: 6,
  },
  WHILE: {
    details: '循环执行脚本命令开始，需与EndWhile配对',
    syntax: 'WHILE 左值 操作符 右值',
    paramList: ['左值(变量或数值)', '操作符(>,<,=)', '右值(变量或数值)'],
    minArgs: 3,
    maxArgs: 3,
  },
  CHANGEDAMAGEVALUE: {
    details: '按固定值或百分比调整掉血值',
    syntax: 'ChangeDamageValue 类型 操作符 值',
    paramList: ['类型(0固定值/1百分比)', '操作符(+/-/=)', '值'],
    minArgs: 3,
    maxArgs: 3,
  },
  CHANGEACCOUNTINFO: {
    details: '修改指定账号的注册信息',
    syntax: 'ChangeAccountInfo 账号 密码 用户名 生日 提问1 回答1 提问2 回答2 [邮箱] [手机] [二级密码]',
    paramList: [
      '账号', '密码', '用户名', '生日', '提问1', '回答1',
      '提问2', '回答2', '[邮箱]', '[手机]', '[二级密码]',
    ],
    minArgs: 8,
    maxArgs: 11,
  },
  CHANGEITEMTRAININGCOUNT: {
    details: '修改指定装备的修炼次数',
    syntax: 'ChangeItemTrainingCount 装备位置 操作符 修炼次数',
    paramList: ['装备位置', '操作符(+/-/=)', '修炼次数'],
    minArgs: 3,
    maxArgs: 3,
  },
  CHECKMASTERONMAP: {
    details: '检测师傅或指定徒弟是否在目标地图，SELF表示与自己同图',
    syntax: 'CheckMasterOnMap 地图号或SELF [徒弟序号]',
    paramList: ['地图号或SELF', '[徒弟序号:空为大徒弟]'],
    kind: 'check',
    minArgs: 1,
    maxArgs: 2,
  },
  CHANGEMAPMONBODYSIZE: {
    details: '修改指定范围内怪物的体型',
    syntax: 'ChangeMapMonBodySize 地图 X Y 范围 怪物名 体型大小 [有效时间]',
    paramList: [
      '地图', 'X', 'Y', '范围', '怪物名(*不判断)',
      '体型大小(100原大小)', '[有效时间秒:空为不限时]',
    ],
    minArgs: 6,
    maxArgs: 7,
  },
  CHECKCUSTOMITEMOPEN: {
    details: '检测指定自定义装备框是否开启',
    syntax: 'CheckCustomItemOpen 装备框位置',
    paramList: ['装备框位置(0-49)'],
    minArgs: 1,
    maxArgs: 1,
  },
  CHECKITEMTRAININGCOUNT: {
    details: '检测指定物品的修炼次数',
    syntax: 'CheckItemTrainingCount 物品位置 检测符 修炼次数',
    paramList: ['物品位置', '检测符(>/< /=)', '修炼次数'],
    minArgs: 3,
    maxArgs: 3,
  },
  CHECKHAVEHERO: {
    details: '检测当前人物是否拥有英雄',
    syntax: 'CheckHaveHero',
    paramList: [],
    minArgs: 0,
    maxArgs: 0,
  },
  CHECKSCRIPTPARAM: {
    details: '检测当前带参数脚本标签是否包含指定参数',
    syntax: 'CheckScriptParam 参数',
    paramList: ['参数'],
    minArgs: 1,
    maxArgs: 1,
  },
  CLOSECUSTOMITEM: {
    details: '关闭指定自定义装备框',
    syntax: 'CloseCustomItem 装备框位置 是否删除按钮',
    paramList: ['装备框位置(0-49)', '是否删除按钮(0不删除/1删除)'],
    minArgs: 2,
    maxArgs: 2,
  },
  CLOSEGODBLESS: {
    details: '关闭普通或时装神佑格',
    syntax: 'CloseGodBless 格子位置(0-11或ALL) [时装神佑]',
    paramList: ['格子位置(0-11或ALL)', '[时装神佑:0普通/1时装]'],
    minArgs: 1,
    maxArgs: 2,
  },
  M2RETURNREGION: {
    details: '把跨服人物遣返回原服务器',
    syntax: 'M2ReturnRegion 保存模式 地图 X Y [范围]',
    paramList: ['保存模式(0/1/2)', '地图', 'X', 'Y', '[随机坐标范围]'],
    minArgs: 4,
    maxArgs: 5,
  },
  M2SPANREGION: {
    details: '把人物传送到跨服中央服务器',
    syntax: 'M2SpanRegion 保存模式 地图 X Y',
    paramList: ['保存模式(0/1/2)', '地图', 'X', 'Y'],
    minArgs: 4,
    maxArgs: 4,
  },
  OPENCUSTOMITEM: {
    details: '开启指定自定义装备框并限制允许放入的物品类型',
    syntax: 'OpenCustomItem 装备框位置 StdMode列表',
    paramList: ['装备框位置(0-49)', 'StdMode列表(逗号分隔,最多10个)'],
    minArgs: 2,
    maxArgs: 2,
  },
  OPENYBDEAL: {
    details: '开通元宝寄售交易功能',
    syntax: 'OpenYBDeal 所需元宝',
    paramList: ['所需元宝数量'],
    minArgs: 1,
    maxArgs: 1,
  },
  PARAM1: {
    details: '设置后续 MOBPLACE 等命令使用的参数1',
    syntax: 'PARAM1 值',
    paramList: ['值'],
    minArgs: 1,
    maxArgs: 1,
  },
  PARAM2: {
    details: '设置后续 MOBPLACE 等命令使用的参数2',
    syntax: 'PARAM2 值',
    paramList: ['值'],
    minArgs: 1,
    maxArgs: 1,
  },
  PARAM3: {
    details: '设置后续 MOBPLACE 等命令使用的参数3',
    syntax: 'PARAM3 值',
    paramList: ['值'],
    minArgs: 1,
    maxArgs: 1,
  },
  PARAM4: {
    details: '设置后续 MOBPLACE 等命令使用的参数4',
    syntax: 'PARAM4 值',
    paramList: ['值'],
    minArgs: 1,
    maxArgs: 1,
  },
  PARAM5: {
    details: '设置后续 MOBPLACE 等命令使用的参数5',
    syntax: 'PARAM5 值',
    paramList: ['值'],
    minArgs: 1,
    maxArgs: 1,
  },
  PARAM6: {
    details: '设置后续 MOBPLACE 等命令使用的参数6',
    syntax: 'PARAM6 值',
    paramList: ['值'],
    minArgs: 1,
    maxArgs: 1,
  },
  PARAM7: {
    details: '设置后续 MOBPLACE 等命令使用的参数7',
    syntax: 'PARAM7 值',
    paramList: ['值'],
    minArgs: 1,
    maxArgs: 1,
  },
  PARAM8: {
    details: '设置后续 MOBPLACE 等命令使用的参数8',
    syntax: 'PARAM8 值',
    paramList: ['值'],
    minArgs: 1,
    maxArgs: 1,
  },
  PARAM9: {
    details: '设置后续 MOBPLACE 等命令使用的参数9',
    syntax: 'PARAM9 值',
    paramList: ['值'],
    minArgs: 1,
    maxArgs: 1,
  },
  GUILDAURAEPOINT: {
    details: '修改行会人气度',
    syntax: 'GuildAuraePoint 操作符 数值',
    paramList: ['操作符(+/-)', '数值'],
    minArgs: 2,
    maxArgs: 2,
  },
  GUILDFLOURISHPOINT: {
    details: '修改行会繁荣度',
    syntax: 'GuildFlourishPoint 操作符 数值',
    paramList: ['操作符(+/-)', '数值'],
    minArgs: 2,
    maxArgs: 2,
  },
  GUILDSTABILITYPOINT: {
    details: '修改行会安定度',
    syntax: 'GuildStabilityPoint 操作符 数值',
    paramList: ['操作符(+/-)', '数值'],
    minArgs: 2,
    maxArgs: 2,
  },
  PLAYMUSICEX: {
    details: '播放不受游戏声音总开关影响的MP3，可控制播放对象及是否中止前一段',
    syntax: 'PlayMusicEx 文件 循环次数 模式 [中止前一段]',
    paramList: [
      'MP3文件',
      '循环次数',
      '模式(0自己/1所有人/2当前地图/3队友/4自己周边)',
      '[中止前一段(0或空叠加/1中止后播放)]',
    ],
    minArgs: 3,
    maxArgs: 4,
  },
  SETCURRTARGET: {
    details: '设置当前对象；名称为空时清空，对方需同地图且在20格内',
    syntax: 'SetCurrTarget [人物名称]',
    paramList: ['[人物名称:空为清空当前对象]'],
    minArgs: 0,
    maxArgs: 1,
  },
  SETUPGRADEITEM: {
    details: '把指定自定义 OK 框中的物品关联为当前升级物品',
    syntax: 'SetUpgradeItem OK框编号',
    paramList: ['OK框编号(0-31)'],
    minArgs: 1,
    maxArgs: 1,
  },
  PLAYDRINKMSG: {
    details: '在斗酒界面显示人物或 NPC 的消息',
    syntax: 'PlayDrinkMsg 说话方 消息内容',
    paramList: ['说话方(1/2)', '消息内容'],
    minArgs: 2,
    maxArgs: 2,
  },
  QUERYUSERSTATE: {
    details: '查看在线人物或英雄的装备状态',
    syntax: 'QueryUserState 用户名或英雄名',
    paramList: ['用户名或英雄名'],
    minArgs: 1,
    maxArgs: 1,
  },
  QUERYUSERSTATEEX: {
    details: '查看人物或英雄装备，目标可离线',
    syntax: 'QueryUserStateEx 用户名或英雄名',
    paramList: ['用户名或英雄名'],
    minArgs: 1,
    maxArgs: 1,
  },
  RANDOMSPLIT: {
    details: '按权重从分隔字符串中随机返回一项，并可返回剩余项',
    syntax: 'RandomSplit 字符串列表 返回模式 结果变量 [剩余返回模式] [剩余变量]',
    paramList: [
      '字符串列表(字符串#概率|字符串#概率)',
      '返回模式(0字符串/1概率/2字符串#概率)',
      '结果变量',
      '[剩余返回模式(0/1/2)]',
      '[剩余变量]',
    ],
    minArgs: 3,
    maxArgs: 5,
  },
  SENDNEWLINEMSG: {
    details: '发送屏幕中间大字体信息',
    syntax: 'SendNewLineMsg 类型 字体色 背景色 字号 Y 显示时间 绘制方式 内容 [范围] [X]',
    paramList: [
      '信息类型(0-7)', '字体颜色(0-255)', '背景颜色(0-255)', '字体大小',
      'Y坐标', '显示时间', '绘制方式(0透明框/1淡入淡出/2无透明框)',
      '信息内容(||换行)', '[范围]', '[X坐标]',
    ],
    minArgs: 8,
    maxArgs: 10,
  },
  SETGUARDIANLEVELBATCHINFO: {
    details: '设置天关某一波的怪物和奖励物品数量',
    syntax: 'SetGuardianLevelBatchInfo 波数 怪物列表 奖励1数量 奖励2数量 奖励3数量 奖励4数量',
    paramList: [
      '波数', '怪物名:数量|怪物名:数量',
      '奖励1数量', '奖励2数量', '奖励3数量', '奖励4数量',
    ],
    minArgs: 6,
    maxArgs: 6,
  },
  SETGUARDIANLEVELINFO: {
    details: '初始化天关关卡、守护雕像、刷怪点和奖励物品',
    syntax: 'SetGuardianLevelInfo 关卡号 总波数 雕像名 雕像X 雕像Y 刷怪X 刷怪Y 奖励1 奖励2 奖励3 奖励4',
    paramList: [
      '关卡号', '总波数', '守护雕像名称', '雕像X', '雕像Y',
      '刷怪X', '刷怪Y', '奖励物品1', '奖励物品2', '奖励物品3', '奖励物品4',
    ],
    minArgs: 11,
    maxArgs: 11,
  },
  SETICON: {
    details: '设置人物或怪物顶戴花翎图标，翎风位置范围为0-9',
    syntax: 'SetIcon 位置(0-9) WIL 图片 [X] [Y] [张数] [效果] [顺序] [速度] [仅自己]',
    paramList: [
      '位置(0-9)', 'WIL文件序号', '图片序号', '[X]', '[Y]', '[播放张数]',
      '[播放效果(0普通/1特效)]', '[播放顺序(0前/非0后)]',
      '[播放速度]', '[仅自己可见(0否/1是)]',
    ],
    minArgs: 3,
    maxArgs: 10,
  },
  SETRANKLEVELNAME: {
    details: '设置人物排名称号',
    syntax: 'SetRankLevelName %s称号',
    paramList: ['%s称号'],
    minArgs: 1,
    maxArgs: 1,
  },
  SETSPACEMOTAEBO: {
    details: '设置隔位野蛮冲撞的有效时间',
    syntax: 'SetSpaceMotaebo 时间',
    paramList: ['时间(-1关闭/0在线一直有效/>0秒)'],
    minArgs: 1,
    maxArgs: 1,
  },
  SETTEMPDBMODE: {
    details: '开启或关闭人物或英雄临时数据模式',
    syntax: 'SetTempDBMode 开关 [保存标记]',
    paramList: ['开关(0关闭/非0开启)', '[保存标记]'],
    minArgs: 1,
    maxArgs: 2,
  },
  SETWEATHEREFFECT: {
    details: '设置地图天气、持续时间、黑暗效果和背景音乐',
    syntax: 'SetWeatherEffect 地图 天气 有效时间 [黑暗] [音乐]',
    paramList: [
      '地图', '天气(0关闭/1黄沙/2花瓣/3下雪/4-21扩展)',
      '有效时间秒', '[黑暗(0正常/1黑暗)]', '[WAV音乐文件]',
    ],
    minArgs: 3,
    maxArgs: 5,
  },
  SHOWCUSTOMBUTTON: {
    details: '显示或隐藏自定义 UI 按钮',
    syntax: 'ShowCustomButton 编号 显示状态',
    paramList: ['编号', '显示状态(0隐藏/1显示)'],
    minArgs: 2,
    maxArgs: 2,
  },
  SUPERMOVEMSG: {
    details: '发送屏幕中间滚动大字体信息',
    syntax: 'SuperMoveMsg 类型 字体色 背景色 字号 Y 滚动次数 内容 [范围] [X]',
    paramList: [
      '信息类型(0-7)', '字体颜色(0-255)', '背景颜色(0-255)', '字体大小',
      'Y坐标', '滚动次数', '信息内容(||换行)', '[范围]', '[X坐标]',
    ],
    minArgs: 7,
    maxArgs: 9,
  },
  TAGMAPINFO: {
    details: '把当前位置记录到指定的记忆石槽位',
    syntax: 'TagMapInfo 槽位',
    paramList: ['槽位'],
    minArgs: 1,
    maxArgs: 1,
  },
  TAGMAPMOVE: {
    details: '移动到指定记忆石槽位记录的地图坐标',
    syntax: 'TagMapMove 槽位',
    paramList: ['槽位'],
    minArgs: 1,
    maxArgs: 1,
  },
};

const gomCorrections = {
  ADDSCREENMAGICBUTTON: {
    details: '把已学习且已设置快捷键的技能图标固定到屏幕坐标',
    syntax: 'AddScreenMagicButton 技能ID或技能名称 X Y',
    paramList: ['技能ID或技能名称', 'X坐标', 'Y坐标'],
    minArgs: 3,
    maxArgs: 3,
  },
  ADDTOMAGICBAR: {
    details: '把已设置快捷键的技能加入技能提示栏',
    syntax: 'AddToMagicBar 技能ID或技能名称',
    paramList: ['技能ID或技能名称'],
    minArgs: 1,
    maxArgs: 1,
  },
  CHANGEMAPMONNAME: {
    details: '修改范围内怪物名称，并按新名称读取爆率',
    syntax: 'ChangeMapMonName 地图 [X] [Y] [范围] 原怪物名 新怪物名',
    paramList: ['地图', '[X]', '[Y]', '[范围]', '原怪物名', '新怪物名'],
    minArgs: 3,
    maxArgs: 6,
  },
  CHANGEMAPMONNAMEEX: {
    details: '修改范围内怪物显示名称，仍按原名称读取爆率',
    syntax: 'ChangeMapMonNameEx 地图 [X] [Y] [范围] 原怪物名 新怪物名',
    paramList: ['地图', '[X]', '[Y]', '[范围]', '原怪物名', '新怪物名'],
    minArgs: 3,
    maxArgs: 6,
  },
  CHECKANGRYVALUE: {
    details: '检测当前在线英雄的合击怒气点数或百分比',
    syntax: 'CheckAngryValue 操作符 值 值类型',
    paramList: [
      '操作符(>,<,=)',
      '值',
      '值类型(0怒气点数/1百分比)',
    ],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 3,
    maxArgs: 3,
  },
  ENDLOOP: {
    details: '结束 LOOPGOTO 循环块',
    syntax: 'ENDLOOP',
    params: '',
    paramList: [],
    minArgs: 0,
    maxArgs: 0,
  },
  ENDWHILE: noArgCorrection(
    'ENDWHILE',
    '结束 WHILE 循环块'
  ),
  DELFROMMAGICBAR: {
    details: '从技能提示栏移除指定技能',
    syntax: 'DelFromMagicBar 技能ID或技能名称',
    paramList: ['技能ID或技能名称'],
    minArgs: 1,
    maxArgs: 1,
  },
  DELSCREENMAGICBUTTON: {
    details: '从屏幕删除指定技能的固定图标',
    syntax: 'DelScreenMagicButton 技能ID或技能名称',
    paramList: ['技能ID或技能名称'],
    minArgs: 1,
    maxArgs: 1,
  },
  GOTOLABELEX: {
    details: '触发指定范围内队伍或行会成员的脚本标签',
    syntax: 'GotoLabelEx 模式 X Y 范围 脚本来源 @标签',
    paramList: [
      '模式(0组队/1行会)',
      'X',
      'Y',
      '范围',
      '脚本来源(0 QFunction/1当前NPC)',
      '@触发标签',
    ],
    minArgs: 6,
    maxArgs: 6,
  },
  RANDOM: {
    details: '按 1/N 概率进行随机检测',
    syntax: 'RANDOM 随机数',
    paramList: ['随机数'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 1,
    maxArgs: 1,
    source: source('游戏引擎反外挂系统/其他相关资料/传奇基础脚本命令详解[!].htm'),
  },
  RANDOMSPLIT: {
    details: '按字符串#概率列表随机取出一项，并可返回剩余内容',
    syntax: 'RandomSplit 字符串列表 返回模式 结果变量 [剩余返回模式] [剩余变量]',
    paramList: [
      '字符串列表(字符串#概率|字符串#概率)',
      '返回模式(0字符串/1概率/2字符串#概率)',
      '结果变量',
      '[剩余返回模式(0/1/2)]',
      '[剩余变量]',
    ],
    minArgs: 3,
    maxArgs: 5,
  },
  SETDUMMYPICKITEM: {
    details: '开启或关闭假人捡物品',
    syntax: 'SetDummyPickItem 开关',
    paramList: ['开关(1开启/0关闭)'],
    minArgs: 1,
    maxArgs: 1,
  },
  SETDUMMYPICKITEMFILE: {
    details: '设置假人捡取列表文件和优先模式',
    syntax: 'SetDummyPickItemFile 捡取列表文件名 [模式]',
    paramList: ['捡取列表文件名', '[模式:0或空优先/1允许]'],
    minArgs: 1,
    maxArgs: 2,
  },
  MESSAGEBOX: {
    details: '弹出消息框，确定或取消后跳转到对应标签',
    syntax: 'MessageBox 文字信息 [@确定标签] [@取消标签]',
    paramList: ['文字信息', '[@确定标签]', '[@取消标签]'],
    minArgs: 1,
    maxArgs: 3,
  },
  NOT: {
    details: '对紧随其后的检测命令取反',
    syntax: 'NOT 检测命令',
    paramList: ['检测命令'],
    kind: 'check',
    contexts: ['IF'],
    minArgs: 1,
  },
  SETICON: {
    details: '设置人物或怪物顶戴花翎图标，GOM位置已扩展为0-19',
    syntax: 'SetIcon 位置(0-19) WIL文件序号 图片序号 [X] [Y] [播放张数] [播放效果] [播放速度] [仅自己可见] [播放次数|播放顺序]',
    paramList: [
      '位置(0-19)', 'WIL文件序号', '图片序号', '[X]', '[Y]', '[播放张数]',
      '[播放效果(0普通/1特效)]', '[播放速度]', '[仅自己可见(0否/1是)]',
      '[播放次数|播放顺序]',
    ],
    minArgs: 3,
    maxArgs: 10,
    source: source('UpDate.htm'),
  },
  STARTAUTOPLAYGAME: {
    details: '开始内挂挂机并按参数生成挂机点',
    syntax: 'StartAutoPlayGame 挂机范围 挂机点间距 模式',
    paramList: [
      '挂机范围',
      '挂机点间距',
      '模式(0必须已有挂机点/1没有时自动生成/2清空后重新生成)',
    ],
    minArgs: 3,
    maxArgs: 3,
  },
  STOPAUTOPLAYGAME: {
    details: '停止内挂自动挂机',
    syntax: 'StopAutoPlayGame',
    params: '',
    paramList: [],
    minArgs: 0,
    maxArgs: 0,
  },
};

function applyFormalSyntax(name, info, record) {
  const evidence = record?.documentation?.syntaxEvidence?.find(item => item.score >= 14);
  if (!evidence || evidence.line.length > 600) return info;
  const syntax = replaceSyntaxName(evidence.line, name);
  const params = syntaxParams(syntax, name);
  return {
    ...info,
    syntax,
    params,
  };
}

function normalizeCatalog(engine, catalog, records, removals, corrections) {
  const result = {};
  let removed = 0;
  let sourced = 0;
  let formalized = 0;
  let corrected = 0;
  for (const [name, currentInfo] of Object.entries(catalog)) {
    const key = commandKey(name);
    if (removals.has(key)) {
      removed++;
      continue;
    }
    const record = records[key];
    let info = { ...currentInfo };
    const formal = record?.documentation?.syntaxEvidence?.some(item => item.score >= 14);
    if (formal) {
      info = applyFormalSyntax(name, info, record);
      formalized++;
    }
    info.completionVerified = false;
    if (record?.documented && record.documentation.bestPage?.path) {
      info.source = source(record.documentation.bestPage.path);
      sourced++;
    }
    if (corrections[key]) {
      info = {
        ...info,
        ...corrections[key],
      };
      info.params = syntaxParams(info.syntax || name, name);
      info.completionVerified = corrections[key].completionVerified ?? true;
      corrected++;
    } else if (
      (
        formal
        && safeExactSyntax(name, info.syntax || '')
        && !/(?:\/\/|此命令|以下是|更新日期|仅用于|命令的|里面的|区别|[;；]\s*(?:仅|只|注意|说明|用于)|[,，]仅限)/i.test(info.syntax || '')
      )
      || hasExactSyntaxEvidence(name, info.syntax || (
        info.params ? `${name} ${info.params}` : name
      ), record)
    ) {
      info.completionVerified = true;
    }
    result[name] = info;
  }
  const sorted = Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => (
      left.localeCompare(right, 'en', { sensitivity: 'base' })
    ))
  );
  console.log(
    `${engine}: ${Object.keys(catalog).length} -> ${Object.keys(sorted).length}; `
    + `removed ${removed}, sourced ${sourced}, formalized ${formalized}, corrected ${corrected}`
  );
  return sorted;
}

function main() {
  const report = readJson('data/audit-report/language-accuracy.json');
  if (!report.resolvedLanguage?.engines) {
    throw new Error('Run npm run audit:engine-language before normalizing function catalogs.');
  }
  const gom = normalizeCatalog(
    'GOM',
    readJson('data/functions.json'),
    report.resolvedLanguage.engines.GOM,
    unsupportedGomFunctions,
    gomCorrections
  );
  const gee = normalizeCatalog(
    'GEE',
    readJson('data/functions-gee.json'),
    report.resolvedLanguage.engines.GEE,
    new Set([...falseGeeFunctions, ...unsupportedGeeFunctions]),
    geeCorrections
  );
  writeJson('data/functions.json', gom);
  writeJson('data/functions-gee.json', gee);
}

main();
