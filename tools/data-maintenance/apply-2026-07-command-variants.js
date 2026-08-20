const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const commandsPath = path.join(root, 'data', 'commands.json');
const auditPath = path.join(root, 'data', 'audit-report', 'language-accuracy.json');
const commands = JSON.parse(fs.readFileSync(commandsPath, 'utf8'));
const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
const invalidCommands = new Set([
  // 两套帮助中的 AutoPickUpItem 都是假人配置项，不是脚本动作。
  'AUTOPICKUPITEM',
  'BUFF',
  // 两套帮助中的 Gender 都是人形怪配置键；脚本性别检测为
  // GenderMan / GenderWoman 等命令。
  'GENDER',
  // 两套帮助中的 KillMon 都是 [@KillMon] 触发标签，不是动作命令。
  'KILLMON',
]);
const removed = [];
for (const list of [commands.commands, commands.execCommands]) {
  for (let index = list.length - 1; index >= 0; index--) {
    if (!invalidCommands.has(list[index].name.toUpperCase())) continue;
    removed.push(list[index].name);
    list.splice(index, 1);
  }
}
const allCommands = [...commands.commands, ...commands.execCommands];

function definition(syntax, params, description) {
  return {
    syntax,
    params,
    ...(description ? { description } : {}),
  };
}

function sharedDefinition(syntax, params, description) {
  return {
    GOM: definition(syntax, params, description),
    GEE: definition(syntax, params, description),
  };
}

const sourceOverrides = {
  CHECKUSEITEM: {
    GOM: '游戏引擎反外挂系统/脚本检测命令/检查人物身上指定位置是否戴物品.htm',
  },
  CHECKGOLD: {
    GOM: '游戏引擎反外挂系统/其他相关资料/传奇基础脚本命令详解[!].htm',
    GEE: '游戏引擎反外挂系统/其他相关资料/传奇基础脚本命令详解[!].htm',
  },
  CHECKPKPOINT: {
    GOM: '游戏引擎反外挂系统/脚本检测命令/检测人物PK值.htm',
    GEE: '游戏引擎反外挂系统/脚本检测命令/检测人物PK值.htm',
  },
  DIV: {
    GEE: '游戏引擎反外挂系统/其他相关资料/传奇基础脚本命令详解[!].htm',
  },
  MOV: {
    GOM: '游戏引擎反外挂系统/其他相关资料/MOV INC DEC变量操作命令.htm',
    GEE: '游戏引擎反外挂系统/其他相关资料/传奇基础脚本命令详解[!].htm',
  },
  MUL: {
    GEE: '游戏引擎反外挂系统/其他相关资料/传奇基础脚本命令详解[!].htm',
  },
  THROWITEM: {
    GEE: '游戏引擎反外挂系统/功能操作命令/在地图上放物品[!].htm',
  },
  READCONFIGFILEITEM: {
    GOM: '游戏引擎反外挂系统/功能操作命令/读写ini配置项.htm',
  },
  SUM: {
    GOM: '游戏引擎反外挂系统/其他相关资料/传奇基础脚本命令详解[!].htm',
    GEE: '游戏引擎反外挂系统/其他相关资料/传奇基础脚本命令详解[!].htm',
  },
  ENDWHILE: {
    GOM: '游戏引擎反外挂系统/功能操作命令/循环执行脚本.htm',
    GEE: '游戏引擎反外挂系统/部分脚本实例/循环脚本.htm',
  },
  WHILE: {
    GOM: '游戏引擎反外挂系统/功能操作命令/循环执行脚本.htm',
    GEE: '游戏引擎反外挂系统/部分脚本实例/循环脚本.htm',
  },
};

function sourceFor(name, engine) {
  const overridePage = sourceOverrides[name.toUpperCase()]?.[engine];
  if (overridePage) {
    return {
      revision: '2026-07-19',
      page: overridePage,
    };
  }
  const record = audit.commands[name.toUpperCase()];
  const page = record?.[engine]?.bestPage?.path;
  if (!page) return undefined;
  return {
    revision: '2026-07-19',
    page,
  };
}

function withSource(name, engine, variant) {
  const source = sourceFor(name, engine);
  return source ? { ...variant, source } : variant;
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
  const suffix = String(syntax || '')
    .replace(new RegExp(`^#?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')
    .trim();
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

function hasExactSyntaxEvidence(record, name, syntax) {
  if (!record?.documented || record.sourceStatus !== 'matched') return false;
  const expected = normalizedSyntax(syntax);
  return safeExactSyntax(name, syntax)
    && (record.documentation?.syntaxEvidence || []).some(evidence => (
      normalizedSyntax(evidence.line) === expected
    ));
}

const variants = {
  'CHECK [N]': {
    GOM: definition(
      'CHECK [标识列表] 期望值',
      ['标识列表:支持单个、逗号列表和范围', '期望值'],
      '批量检测个人标识'
    ),
    GEE: definition(
      'CHECK [标识列表] 期望值',
      ['标识列表:支持单个、逗号列表和范围', '期望值'],
      '批量检测个人标识'
    ),
  },
  CHECKFENGHAOCOUNT: {
    GOM: definition(
      'CHECKFENGHAOCOUNT 操作符(<,>,=) 数量(0-30)',
      ['操作符(<,>,=)', '数量(0-30)'],
      '检测人物称号数量'
    ),
    GEE: definition(
      'CHECKFENGHAOCOUNT 操作符(<,>,=) 数量(0-255)',
      ['操作符(<,>,=)', '数量(0-255)'],
      '检测人物称号数量'
    ),
  },
  CHECKHPPER: {
    GOM: definition(
      'CheckHpPer 操作符 比例值 [比例类型]',
      ['操作符(=,>,<)', '比例值', '[比例类型:0百分比/1千分比/2万分比]'],
      '检测当前HP占最大HP的比例'
    ),
    GEE: definition(
      'CheckHpPer 操作符 比例值 [比例类型]',
      ['操作符(=,>,<)', '比例值', '[比例类型:0百分比/1千分比/2万分比]'],
      '检测当前HP占最大HP的比例'
    ),
  },
  CHECKMPPER: {
    GOM: definition(
      'CheckMpPer 操作符 比例值 [比例类型]',
      ['操作符(=,>,<)', '比例值', '[比例类型:0百分比/1千分比/2万分比]'],
      '检测当前MP占最大MP的比例'
    ),
    GEE: definition(
      'CheckMpPer 操作符 比例值 [比例类型]',
      ['操作符(=,>,<)', '比例值', '[比例类型:0百分比/1千分比/2万分比]'],
      '检测当前MP占最大MP的比例'
    ),
  },
  CHECKITEM: {
    GOM: definition(
      'CHECKITEM 物品名称 数量 [部分匹配] [检测改名]',
      ['物品名称', '数量', '[部分匹配:0完全/1部分]', '[检测改名:0否/1是]'],
      '检测背包中的指定物品'
    ),
    GEE: definition(
      'CHECKITEM 物品名称 数量 [部分匹配] [检测改名]',
      ['物品名称', '数量', '[部分匹配:0完全/非0部分]', '[检测改名:0否/1是]'],
      '检测背包中的指定物品'
    ),
  },
  CHECKITEMADDVALUE: {
    GOM: definition(
      'CHECKITEMADDVALUE 装备位置(-1/0-28/30-47) 属性位置(0-14) 操作符 值 保存变量',
      ['装备位置(-1/0-28/30-47)', '属性位置(0-14)', '操作符(<,>,=)', '值', '保存变量'],
      '检测装备附加属性值'
    ),
    GEE: definition(
      'CHECKITEMADDVALUE 装备位置(-1/0-51/BOXITEM0-7) 属性位置(0-18) 操作符 值 保存变量',
      ['装备位置(-1/0-51/BOXITEM0-7)', '属性位置(0-18)', '操作符(<,>,=)', '值', '保存变量'],
      '检测装备附加属性值'
    ),
  },
  CHECKITEMADDVALUEEX: {
    GOM: definition(
      'CheckItemAddValueEx 装备位置(-1-47) 操作符 附加值 属性类型 [返回变量]',
      ['装备位置(-1-47)', '操作符(<,>,=)', '附加值(0-922京)', '属性类型(0-3)', '[返回变量]'],
      '检测装备附加极品或元素属性总和'
    ),
    GEE: definition(
      'CheckItemAddValueEx 装备位置(-1/0-51/BOXITEM0-7) 操作符 附加值 [新属性]',
      ['装备位置(-1/0-51/BOXITEM0-7)', '操作符(<,>,=)', '附加值(0-65000)', '[新属性:0/1]'],
      '检测装备附加属性总和'
    ),
  },
  CHECKITEMBIND: {
    GOM: definition(
      'CheckItemBind 装备位置(-1/0-28/30-47)',
      ['装备位置(-1/0-28/30-47)'],
      '检测物品是否绑定'
    ),
  },
  CHECKITEMSTATE: {
    GOM: definition(
      'CheckItemState 装备位置(-1/0-28/30-47) 项目(0-6)',
      ['装备位置(-1/0-28/30-47)', '项目(0-6)'],
      '检测装备绑定状态'
    ),
    GEE: definition(
      'CheckItemState 装备位置(-1-13) 项目(0-5)',
      ['装备位置(-1-13)', '项目(0-5)'],
      '检测装备绑定状态'
    ),
  },
  CHECKITEMW: {
    GOM: definition(
      'CHECKITEMW 物品名 数量',
      ['物品名', '数量'],
      '检测身上穿戴的指定物品'
    ),
    GEE: definition(
      'CHECKITEMW 物品名 数量 [部分匹配]',
      ['物品名', '数量', '[部分匹配:0完全/非0部分]'],
      '检测身上穿戴的指定物品'
    ),
  },
  CHECKJOB: {
    GOM: definition(
      'CHECKJOB WARR/WIZARD/TAOS',
      ['职业:WARR/WIZARD/TAOS'],
      '检测人物职业'
    ),
    GEE: definition(
      'CHECKJOB WARRIOR/WIZARD/TAOIST',
      ['职业:WARRIOR/WIZARD/TAOIST'],
      '检测人物职业'
    ),
  },
  CHECKLISTALLDIGIT: {
    GOM: definition(
      'CheckListAllDigit 列表变量',
      ['列表变量'],
      '检测列表中的元素是否全部为数字'
    ),
    GEE: definition(
      'CheckListAllDigit 列表变量',
      ['列表变量'],
      '检测列表中的元素是否全部为数字'
    ),
  },
  CHECKMAPMOVE: {
    GOM: definition(
      'CHECKMAPMOVE 地图名 X坐标 Y坐标 [模式]',
      ['地图名', 'X坐标', 'Y坐标', '[模式]'],
      '检测地图坐标是否可到达'
    ),
    GEE: definition(
      'CHECKMAPMOVE 地图名 X坐标 Y坐标',
      ['地图名', 'X坐标', 'Y坐标'],
      '检测地图坐标是否可到达'
    ),
  },
  CHECKMINE: {
    GOM: definition(
      'CheckMine 物品名称 数量(1-45) 纯度(1-65)',
      ['物品名称', '数量(1-45)', '纯度(1-65)'],
      '检测背包矿石数量和纯度'
    ),
    GEE: definition(
      'CheckMine 物品名称 数量(1-45) 操作符 纯度(1-65)',
      ['物品名称', '数量(1-45)', '操作符(<,>,=)', '纯度(1-65)'],
      '检测背包矿石数量和纯度'
    ),
  },
  CHECKNEWITEMVALUE: {
    GOM: definition(
      'CHECKNEWITEMVALUE 装备位置(-1/0-28/30-47) 属性(0-16) 操作符 值 [包含数据库元素]',
      ['装备位置(-1/0-28/30-47)', '属性(0-16)', '操作符(<,>,=)', '值', '[包含数据库元素]'],
      '检测装备元素属性'
    ),
    GEE: definition(
      'CHECKNEWITEMVALUE 装备位置(-1/0-18/BOXITEM0-7) 属性(0-26) 操作符 值',
      ['装备位置(-1/0-18/BOXITEM0-7)', '属性(0-26)', '操作符(<,>,=)', '值'],
      '检测装备新增属性'
    ),
  },
  CHECKRANGEMONCOUNTEX: {
    GOM: definition(
      'CHECKRANGEMONCOUNTEX 地图 怪物名 X Y 范围 操作符 数量 [包含指定Race]',
      ['地图', '怪物名', 'X', 'Y', '范围', '操作符(<,>,=)', '数量', '[包含指定Race]'],
      '检测地图范围内怪物数量'
    ),
    GEE: definition(
      'CHECKRANGEMONCOUNTEX 地图 怪物名 X Y 范围 操作符 数量 [宝宝计入]',
      ['地图', '怪物名', 'X', 'Y', '范围', '操作符(<,>,=)', '数量', '[宝宝计入]'],
      '检测地图范围内怪物数量'
    ),
  },
  CHECKSKILL: {
    GOM: definition(
      'CHECKSKILL 技能名称 操作符 等级 [强化技能] [等级变量] [强化等级变量]',
      ['技能名称', '操作符(<,>,=)', '等级', '[强化技能:0普通/1强化]', '[等级变量]', '[强化等级变量]'],
      '检测人物技能等级并可返回普通及强化等级'
    ),
    GEE: definition(
      'CHECKSKILL 技能名称 操作符 等级 [强化技能]',
      ['技能名称', '操作符(<,>,=)', '等级', '[强化技能:0普通/1强化]'],
      '检测人物普通或强化技能等级'
    ),
  },
  CHECKTEXTLIST: {
    GOM: definition(
      'CHECKTEXTLIST 文件路径 检测字符串',
      ['文件路径', '检测字符串'],
      '检测文本文件中是否包含字符串'
    ),
    GEE: definition(
      'CHECKTEXTLIST 文件路径 字符串1 [字符串2] [绝对路径] [区分大小写]',
      ['文件路径', '字符串1', '[字符串2]', '[绝对路径:0否/1是]', '[区分大小写:0否/1是]'],
      '检测文本文件中是否包含字符串'
    ),
  },
  CHECKVARINLIST: {
    GOM: definition(
      'CheckVarInList 列表变量 值',
      ['列表变量', '值'],
      '检测列表中是否包含指定元素'
    ),
    GEE: definition(
      'CheckVarInList 列表变量 值',
      ['列表变量', '值'],
      '检测列表中是否包含指定元素'
    ),
  },
  FINDMONPOINT: {
    GOM: definition(
      'FindMonPoint 地图名 怪物名 X变量 Y变量 [总数变量]',
      ['地图名', '怪物名', 'X变量', 'Y变量', '[总数变量]'],
      '查找地图怪物坐标'
    ),
    GEE: definition(
      'FindMonPoint 地图名 怪物名 X变量 Y变量',
      ['地图名', '怪物名', 'X变量', 'Y变量'],
      '查找地图怪物坐标'
    ),
  },
  ADDHPPER: {
    GOM: definition(
      'AddHpPer 操作符 比例值 [比例类型]',
      ['操作符(+,-,=)', '比例值', '[比例类型:0百分比/1千分比/2万分比]'],
      '按最大HP比例调整HP'
    ),
    GEE: definition(
      'AddHpPer 操作符 比例值 [比例类型] [飘血图片序号]',
      ['操作符(+,-,=)', '比例值', '[比例类型:0百分比/1千分比/2万分比]', '[飘血图片序号]'],
      '按最大HP比例调整HP'
    ),
  },
  ADDMPPER: {
    GOM: definition(
      'AddMpPer 操作符 比例值 [比例类型]',
      ['操作符(+,-,=)', '比例值', '[比例类型:0百分比/1千分比/2万分比]'],
      '按最大MP比例调整MP'
    ),
    GEE: definition(
      'AddMpPer 操作符 比例值 [比例类型]',
      ['操作符(+,-,=)', '比例值', '[比例类型:0百分比/1千分比/2万分比]'],
      '按最大MP比例调整MP'
    ),
  },
  ADDTEXTLIST: {
    GOM: definition(
      'AddTextList 文件位置 字符串',
      ['文件位置', '字符串'],
      '向文本文件追加字符串'
    ),
    GEE: definition(
      'AddTextList 文件位置 字符串 [绝对路径]',
      ['文件位置', '字符串', '[绝对路径:0否/1是]'],
      '向文本文件追加字符串'
    ),
  },
  ADDTEXTLISTEX: {
    GOM: definition(
      'AddTextListEx 路径 字符串 行号(0-65535)',
      ['路径', '字符串', '行号(0-65535)'],
      '向文本文件指定行写入字符串'
    ),
    GEE: definition(
      'AddTextListEx 路径 字符串 行号(0-65535) [绝对路径]',
      ['路径', '字符串', '行号(0-65535)', '[绝对路径:0否/1是]'],
      '向文本文件指定行写入字符串'
    ),
  },
  ADDTOCASTLEWARLIST: {
    GOM: definition(
      'AddToCastleWarList 城堡名称 行会名称或* [天数]',
      ['城堡名称', '行会名称或*:全部行会', '[天数]'],
      '把行会加入攻城列表'
    ),
    GEE: definition(
      'AddToCastleWarList 城堡名称 [行会名称] [天数]',
      ['城堡名称', '[行会名称:留空为全部行会]', '[天数]'],
      '把行会加入攻城列表'
    ),
  },
  AUTOUSEMAGIC: {
    GOM: definition(
      'AutoUseMagic 技能ID 间隔秒',
      ['技能ID', '间隔秒'],
      '让假人自动使用已学习技能'
    ),
    GEE: definition(
      'AutoUseMagic 技能名称 间隔秒',
      ['技能名称', '间隔秒'],
      '让假人自动使用已学习技能'
    ),
  },
  BAGITEMTOSTORAGE: {
    GOM: definition(
      'BagItemToStorage 物品名称 仓库类型 结果变量 [匹配模式]',
      ['物品名称', '仓库类型:0普通/1大仓库', '结果变量', '[匹配模式:0名称]'],
      '把背包物品存入仓库'
    ),
    GEE: definition(
      'BagItemToStorage 物品名称 仓库类型 结果变量',
      ['物品名称', '仓库类型:0普通/1无限仓', '结果变量'],
      '把背包物品存入仓库'
    ),
  },
  CHANGEHUMABILITY: {
    GOM: definition(
      'ChangeHumAbility 属性(1-20) 操作符 效果值 [时间秒]',
      ['属性(1-20)', '操作符(+,-,=)', '效果值', '[时间秒:0或留空为在线有效]'],
      '临时调整人物固定属性值'
    ),
    GEE: definition(
      'ChangeHumAbility 属性(1-29) 操作符 效果值 时间秒 [百分比模式]',
      ['属性(1-29)', '操作符(+,-,=)', '效果值', '时间秒(1-65535)', '[百分比模式:0固定值/1百分比]'],
      '临时调整人物固定值或百分比属性'
    ),
  },
  CHANGEHUMGROUPITEMRATE: {
    GOM: definition(
      'ChangeHumGroupItemRate 属性(1-19) 操作符 效果值 时间秒',
      ['属性(1-19)', '操作符(+,-,=)', '效果值', '时间秒'],
      '调整人物套装百分比属性'
    ),
    GEE: definition(
      'ChangeHumGroupItemRate 属性索引(0-25) 操作符 值',
      ['属性索引(0-25)', '操作符(+,-,=)', '值'],
      '调整人物套装百分比属性，索引0用于设置有效时间'
    ),
  },
  CHANGEITEMADDVALUE: {
    GOM: definition(
      'CHANGEITEMADDVALUE 装备位置(-1/0-28/30-47/71-90) 属性位置 操作符 值',
      ['装备位置(-1/0-28/30-47/71-90)', '属性位置(0-14及扩展)', '操作符(+,-,=)', '值'],
      '修改装备附加属性值'
    ),
    GEE: definition(
      'CHANGEITEMADDVALUE 装备位置(-1/0-51/BOXITEM0-7) 属性位置(0-18) 操作符 值',
      ['装备位置(-1/0-51/BOXITEM0-7)', '属性位置(0-18)', '操作符(+,-,=)', '值'],
      '修改装备附加属性值'
    ),
  },
  CHANGEITEMDURA: {
    GOM: definition(
      'ChangeItemDura 装备位置(0-12) 操作符 持久 [同步当前持久]',
      ['装备位置(0-12)', '操作符(+,-,=)', '持久(0-65000)', '[最大持久变小后同步当前持久:0/1]'],
      '修改装备最大持久'
    ),
    GEE: definition(
      'ChangeItemDura 装备位置(0-12) 操作符 持久 [修改最大持久]',
      ['装备位置(0-12)', '操作符(+,-,=)', '持久(0-65000)', '[修改最大持久:0当前/1最大]'],
      '修改装备当前持久或最大持久'
    ),
  },
  CHANGEITEMNAMECOLOR: {
    GOM: definition(
      'ChangeItemNameColor 装备位置(-1/0-28/30-47) 颜色',
      ['装备位置(-1/0-28/30-47)', '颜色'],
      '修改装备名称颜色'
    ),
    GEE: definition(
      'ChangeItemNameColor 装备位置(0-13) 颜色',
      ['装备位置(0-13)', '颜色'],
      '修改装备名称颜色'
    ),
  },
  CHANGEITEMUPGRADECOUNT: {
    GOM: definition(
      'ChangeItemUpgradeCount 装备位置(-1/0-18/30-41) 操作符 次数(0-255)',
      ['装备位置(-1/0-18/30-41)', '操作符(+,-,=)', '次数(0-255)'],
      '调整装备升级次数'
    ),
    GEE: definition(
      'ChangeItemUpgradeCount 装备位置(-1/0-37) 操作符 次数(0-255)',
      ['装备位置(-1/0-37)', '操作符(+,-,=)', '次数(0-255)'],
      '调整装备升级次数'
    ),
  },
  CHANGEMODEEX: {
    GOM: {
      ...definition(
        'ChangeModeEx 模式(1-30) 时间 [附加值1] [附加值2]',
        [
          '模式(1-30；31为帮助中标注的预留模式)',
          '时间(1-65535)',
          '[附加值1:含范围/几率/次数/万分比等，按模式解释]',
          '[附加值2:含持续时间/比例/药品类型/免疫等级等，按模式解释]',
        ],
        '按GOM模式改变人物特殊状态；模式11-30使用扩展参数'
      ),
      minArgs: 2,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'ChangeModeEx 模式(1-10) 时间 [附加值]',
        ['模式(1-10)', '时间(1-65535)', '[附加值(1-21亿):按模式使用]'],
        '按翎风兼容格式改变人物特殊状态'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  CLEARMAPMON: {
    GOM: definition(
      'CLEARMAPMON 地图号 [刷怪模式]',
      ['地图号:-1为全部地图', '[刷怪模式:0清怪/1暂停/2恢复]'],
      '清除地图怪物或切换地图刷怪状态'
    ),
    GEE: definition(
      'CLEARMAPMON 地图号',
      ['地图号'],
      '清除指定地图怪物'
    ),
  },
  DELNPC: {
    GOM: definition(
      'DELNPC NPC名字 [地图文件名称]',
      ['NPC名字', '[地图文件名称:留空为所有地图]'],
      '删除动态NPC'
    ),
    GEE: definition(
      'DELNPC NPC名字 地图代码',
      ['NPC名字', '地图代码'],
      '删除动态NPC'
    ),
  },
  DUMMYLOGON: {
    GOM: definition(
      'DUMMYLOGON 地图 X Y 数量 [乱序登录]',
      ['地图', 'X', 'Y', '数量', '[乱序登录:0顺序/1乱序]'],
      '批量登录假人'
    ),
    GEE: definition(
      'DUMMYLOGON 地图 X Y 数量',
      ['地图', 'X', 'Y', '数量'],
      '批量登录假人'
    ),
  },
  FILTERGLOBALMSG: {
    GOM: {
      ...definition(
        'FilterGlobalMsg 聊天框 [固顶消息] [滚动消息] [中央消息] [竖向消息] [爆物信息] [新中央消息]',
        ['聊天框过滤', '[聊天框固顶过滤]', '[SENDMOVEMSG过滤]', '[SENDCENTERMSG过滤]', '[SENDVERTICALMOVEMSG过滤]', '[爆物信息过滤]', '[SENDNEWCENTERMSG过滤]'],
        '依次控制GOM七类全局信息过滤，尾部参数可省略'
      ),
      minArgs: 1,
      maxArgs: 7,
    },
    GEE: {
      ...definition(
        'FilterGlobalMsg 过滤类型 是否过滤',
        ['过滤类型', '是否过滤(0否/1是)'],
        '按翎风信息类型控制全局信息过滤'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  GETHUMGROUPITEMRATE: {
    GOM: definition(
      'GetHumGroupItemRate 属性(1-19) 百分比变量 剩余时间变量 模式',
      ['属性(1-19)', '百分比变量', '剩余时间变量', '模式:0命令/1套装'],
      '获取人物套装百分比属性'
    ),
    GEE: definition(
      'GetHumGroupItemRate 模式 属性索引(0-25) 返回变量',
      ['模式:0命令/1套装', '属性索引(0-25)', '返回变量'],
      '获取人物套装百分比属性'
    ),
  },
  GETLISTSTRING: {
    GOM: definition(
      'GetListString 文件路径 行号 变量1 变量2',
      ['文件路径', '行号:从0开始', '变量1', '变量2'],
      '读取文本指定行到变量'
    ),
    GEE: definition(
      'GetListString 文件路径 行号 变量1 变量2 [绝对路径]',
      ['文件路径', '行号:从0开始', '变量1', '变量2', '[绝对路径:0否/1是]'],
      '读取文本指定行到变量'
    ),
  },
  GETRANDOMLINETEXT: {
    GOM: definition(
      'GetRandomLineText 文件 字符串变量 [随机模式] [OLDMODE]',
      ['文件', '字符串变量', '[随机模式:0随机]', '[OLDMODE:单区高速读写]'],
      '从文件中等概率随机读取一行'
    ),
    GEE: definition(
      'GetRandomLineText 文件 字符串变量 [指定行] [绝对路径]',
      ['文件', '字符串变量', '[指定行:0随机/正数正序/负数倒序]', '[绝对路径:0否/1是]'],
      '随机或按行号读取文本'
    ),
  },
  GETSTRINGPOS: {
    GOM: definition(
      'GetStringPos 路径 字符串',
      ['路径', '字符串'],
      '获取字符串在列表中的位置'
    ),
    GEE: definition(
      'GetStringPos 路径 字符串 [绝对路径]',
      ['路径', '字符串', '[绝对路径:0否/1是]'],
      '获取字符串在列表中的位置'
    ),
  },
  GETTEXTLINECOUNT: {
    GOM: definition(
      'GetTextLineCount 路径 保存变量 [OLDMODE]',
      ['路径', '保存变量', '[OLDMODE:单区高速读写]'],
      '获取文本文件行数'
    ),
    GEE: definition(
      'GetTextLineCount 路径 保存变量',
      ['路径', '保存变量'],
      '获取文本文件行数'
    ),
  },
  GOHOME: {
    GOM: definition(
      'GoHome [强制参数]',
      ['[强制参数:0普通/1强制]'],
      '移动到回城点，参数1可忽略部分状态限制'
    ),
    GEE: definition(
      'GoHome [随机范围]',
      ['[随机范围:以回城点为中心]'],
      '移动到回城点，可在指定范围内随机落点'
    ),
  },
  HUMANHP: {
    GOM: definition(
      'HUMANHP 操作符 数值 [执行次数] [间隔毫秒] [WIL序号] [图片索引]',
      ['操作符(+,-,=)', '数值', '[执行次数]', '[间隔毫秒]', '[WIL序号]', '[图片索引]'],
      '调整人物HP并可播放自定义飘血'
    ),
    GEE: definition(
      'HUMANHP 操作符 数值 [延时毫秒] [执行次数] [禁止飘血] [飘血图片] [比例类型] [护身生效]',
      ['操作符(+,-,=)', '数值', '[延时毫秒]', '[执行次数]', '[禁止飘血:0否/1是]', '[飘血图片]', '[比例类型:0固定/1百分比/2千分比/3万分比]', '[护身生效:0否/1是]'],
      '调整人物HP并控制飘血、比例和护身'
    ),
  },
  KICKOFFLINE: {
    GOM: definition(
      'KICKOFFLINE',
      [],
      '踢除当前脚本对象，可用人物名多级脚本指定对象'
    ),
    GEE: definition(
      'KICKOFFLINE',
      [],
      '踢除服务器中的所有挂机人物'
    ),
  },
  KILLMONEXPRATE: {
    GOM: definition(
      'KILLMONEXPRATE 倍率 有效时间',
      ['倍率', '有效时间'],
      '设置杀怪经验倍率'
    ),
    GEE: definition(
      'KILLMONEXPRATE 倍率 有效时间 [保存] [隐藏提示]',
      ['倍率', '有效时间', '[保存:0否/1是]', '[隐藏提示:0否/1是]'],
      '设置杀怪经验倍率'
    ),
  },
  MAKEPOSION: {
    GOM: definition(
      'MAKEPOSION 状态类型 时间秒 威力',
      ['状态类型:0/1毒,5麻痹,12冰冻,13蛛网', '时间秒', '威力'],
      '给人物附加状态'
    ),
    GEE: definition(
      'MAKEPOSION 状态类型 时间秒 威力 [计算防御] [千分比威力]',
      ['状态类型:0/1毒,5麻痹', '时间秒', '威力', '[计算防御:0/1]', '[千分比威力:0/1]'],
      '给人物附加状态'
    ),
  },
  MAPEFFECT: {
    GOM: definition(
      'MAPEFFECT 地图 X Y WIL 开始图片 张数 次数 速度 绘制效果 亮度|可见范围|特效ID',
      ['地图', 'X', 'Y', 'WIL', '开始图片', '张数', '次数:-1无限', '速度毫秒', '绘制效果:0普通/1特效', '亮度|可见范围|特效ID'],
      '在地图坐标播放特效'
    ),
    GEE: definition(
      'MAPEFFECT 地图 X Y WIL 开始图片 张数 次数 速度 绘制效果 亮度 ID [播放顺序]',
      ['地图', 'X', 'Y', 'WIL', '开始图片', '张数', '次数:-1无限', '速度毫秒', '绘制效果:0普通/1特效', '亮度(0-5)', 'ID', '[播放顺序:0底层/1上层/2所有对象上层]'],
      '在地图坐标播放特效'
    ),
  },
  MONGENEX: {
    GOM: {
      ...definition(
        'MonGenEx 地图 X Y 怪物 范围 数量 内功怪 名称颜色 [国家名称] [同国玩家可攻击]',
        ['地图', 'X', 'Y', '怪物', '范围', '数量', '内功怪(0/1)', '名称颜色(0-255)', '[国家名称]', '[同国玩家可攻击(0/1)]'],
        '按GOM格式刷怪，支持国家怪物设置'
      ),
      minArgs: 8,
      maxArgs: 10,
    },
    GEE: {
      ...definition(
        'MonGenEx 地图 X Y 怪物 范围 数量 [名称颜色] [内功怪] [国家ID] [同国怪可攻击玩家] [异国怪可PK] [同国玩家可攻击怪] [体型]',
        ['地图', 'X', 'Y', '怪物', '范围', '数量', '[名称颜色(0-255)]', '[内功怪(0/1)]', '[国家ID]', '[同国怪可攻击玩家(0/1)]', '[异国怪可PK(0/1)]', '[同国玩家可攻击怪(0/1)]', '[体型:空或100为默认]'],
        '按翎风格式刷怪，后续参数依次扩展名称颜色、国家和体型'
      ),
      minArgs: 6,
      maxArgs: 13,
    },
  },
  OPENBIGDIALOGBOX: {
    GOM: definition(
      'OpenBigDialogBox WIL文件编号 图片编号',
      ['WIL文件编号', '图片编号'],
      '打开自定义NPC对话框'
    ),
    GEE: definition(
      'OpenBigDialogBox WIL 图片 可移动 位置 偏移X 偏移Y 显示关闭 关闭X 关闭Y',
      ['WIL', '图片', '可移动(0/1)', '位置(0-4)', '偏移X', '偏移Y', '显示关闭(0/1)', '关闭X', '关闭Y'],
      '打开自定义NPC对话框'
    ),
  },
  OPENMERCHANTBIGDLG: {
    GOM: {
      ...definition(
        'OPENMERCHANTBIGDLG WIL 图片 [可移动] [位置] [偏移X] [偏移Y] [显示关闭] [关闭X] [关闭Y] [独立窗口]',
        ['WIL', '图片', '[可移动(0/1)]', '[位置(0-4)]', '[偏移X]', '[偏移Y]', '[显示关闭(0/1)]', '[关闭X]', '[关闭Y]', '[独立窗口:0否/1是]'],
        '打开GOM NPC大对话框，参数10控制是否与普通对话框共存'
      ),
      minArgs: 2,
      maxArgs: 10,
    },
    GEE: {
      ...definition(
        'OPENMERCHANTBIGDLG WIL 图片 [可移动] [位置] [偏移X] [偏移Y] [显示关闭] [关闭X] [关闭Y] [延续使用]',
        ['WIL', '图片', '[可移动(0/1)]', '[位置(0-4)]', '[偏移X]', '[偏移Y]', '[显示关闭(0/1)]', '[关闭X]', '[关闭Y]', '[延续使用:0否/1是]'],
        '打开翎风NPC大对话框，参数10控制当前NPC后续对话是否沿用'
      ),
      minArgs: 2,
      maxArgs: 10,
    },
  },
  PLAYEFFECT: {
    GOM: definition(
      'PLAYEFFECT WIL 开始图片 张数 次数 速度 绘制模式 [X] [Y] [播放顺序]',
      ['WIL', '开始图片', '张数', '次数', '速度毫秒', '绘制模式:0特效/1普通', '[X]', '[Y]', '[播放顺序:0上层/1下层]'],
      '在人物位置播放特效'
    ),
    GEE: definition(
      'PLAYEFFECT WIL 开始图片 张数 次数 速度 播放顺序 [X] [Y] [绘制模式]',
      ['WIL', '开始图片', '张数', '次数:<=0永久', '速度毫秒', '播放顺序:0上层/1底层/2所有对象上层', '[X]', '[Y]', '[绘制模式:0特效/非0普通]'],
      '在人物位置播放特效'
    ),
  },
  POWERRATE: {
    GOM: definition(
      'POWERRATE 倍率 有效时间',
      ['倍率', '有效时间'],
      '设置攻击力倍率'
    ),
    GEE: definition(
      'POWERRATE 倍率 有效时间 [保存] [隐藏提示] [目标类型]',
      ['倍率', '有效时间:0永久', '[保存:0否/1是]', '[隐藏提示:0否/1是]', '[目标类型:0全部/1人物/2怪物]'],
      '设置攻击力倍率'
    ),
  },
  RANGEHARM: {
    GOM: definition(
      'RangeHarm X Y 范围 伤害 附加效果 附加值 攻击归属 目标类型 物理攻击 WIL特效串',
      ['X', 'Y', '范围', '伤害', '附加效果', '附加值', '攻击归属(0/1)', '目标类型(0全部/1人物/2怪物)', '物理攻击(0/1)', 'WIL特效串'],
      '对坐标范围内目标造成伤害或状态'
    ),
    GEE: definition(
      'RangeHarm X Y 范围 伤害 附加效果 附加值 检查抗性 目标类型 WIL 开始图片 张数 速度 透明绘制 物理攻击',
      ['X', 'Y', '范围', '伤害', '附加效果', '附加值', '检查抗性(0/1)', '目标类型(0全部/1人物/2怪物)', 'WIL', '开始图片', '张数', '速度', '透明绘制(0/1)', '物理攻击(0/1)'],
      '对坐标范围内目标造成伤害或状态'
    ),
  },
  RECALLMOB: {
    GOM: definition(
      'RECALLMOB 怪物名称 等级 [叛变时间] [自动变色] [颜色] [攻击人物]',
      ['怪物名称', '等级(最高7)', '[叛变时间]', '[自动变色(0/1)]', '[颜色]', '[攻击人物(0/1)]'],
      '召唤指定怪物为宝宝'
    ),
    GEE: definition(
      'RECALLMOB 怪物名称 等级 叛变时间分钟',
      ['怪物名称', '等级(最高7)', '叛变时间分钟'],
      '召唤指定怪物为宝宝'
    ),
  },
  RECALLSELF: {
    GOM: {
      ...definition(
        'RecallSelf 有效时间 数量 继承属性百分比 颜色 [衣服外观] [武器外观] [X] [Y]',
        ['有效时间', '数量', '继承属性百分比', '颜色(0-255)', '[衣服外观:0或空不改变]', '[武器外观:0或空不改变]', '[X]', '[Y]'],
        '按GOM格式召唤人物分身'
      ),
      minArgs: 4,
      maxArgs: 8,
    },
    GEE: {
      ...definition(
        'RecallSelf 有效时间 数量 继承属性百分比 颜色 [衣服外观] [武器外观] [X] [Y]',
        ['有效时间', '数量', '继承属性百分比', '颜色(0-255)', '[衣服外观:0或空不改变]', '[武器外观:0或空不改变]', '[X]', '[Y]'],
        '按翎风格式召唤人物分身'
      ),
      minArgs: 4,
      maxArgs: 8,
    },
  },
  RELEASEMAGIC: {
    GOM: definition(
      'ReleaseMagic 技能ID 强化标记 技能等级 目标 [无动作] [无视当前动作]',
      ['技能ID', '强化标记(0/1)', '技能等级', '目标:1攻击目标/2自身', '[无动作:0否/1是]', '[无视当前动作:0否/1是]'],
      '脚本直接释放技能'
    ),
    GEE: definition(
      'ReleaseMagic 技能ID 强化标记 技能等级 目标 [忽略冷却] [允许伤害触发]',
      ['技能ID', '强化标记(0/1)', '技能等级', '目标:1攻击目标/2自身', '[忽略冷却:0否/1是]', '[允许伤害触发:0否/1是]'],
      '脚本直接释放带动作的技能'
    ),
  },
  REPLACELISTBYCONTENT: {
    GOM: definition(
      'ReplaceListByContent 列表 旧内容 新内容 替换次数',
      ['列表', '旧内容', '新内容', '替换次数'],
      '按内容替换列表元素'
    ),
    GEE: definition(
      'ReplaceListByContent 列表 旧内容 新内容 [区分大小写]',
      ['列表', '旧内容', '新内容', '[区分大小写:0否/1是]'],
      '按内容替换列表元素'
    ),
  },
  SCREENEFFECT: {
    GOM: definition(
      'SCREENEFFECT X Y WIL 开始图片 张数 次数 速度 绘制效果 发送模式',
      ['X', 'Y', 'WIL', '开始图片', '张数', '次数', '速度毫秒', '绘制效果:0普通/1特效', '发送模式:0自己/1所有人'],
      '在屏幕坐标播放特效'
    ),
    GEE: definition(
      'SCREENEFFECT X Y WIL 开始图片 张数 次数 速度 绘制效果 发送模式 [对话框层级]',
      ['X', 'Y', 'WIL', '开始图片', '张数', '次数', '速度毫秒', '绘制效果:0普通/1特效', '发送模式:0自己/1所有人', '[对话框层级:0下层/1上层]'],
      '在屏幕坐标播放特效'
    ),
  },
  SENDCENTERMSG: {
    GOM: definition(
      'SendCenterMsg 前景色 背景色 消息 模式 时间 倒计时标签 显示位置 Y [绘制背景]',
      ['前景色', '背景色', '消息', '模式', '时间', '倒计时标签', '显示位置:0中/1左/2右', 'Y', '[绘制背景]'],
      '发送屏幕中央文字'
    ),
    GEE: definition(
      'SendCenterMsg 前景色 背景色 消息 模式 时间 倒计时标签 替换模式 X',
      ['前景色', '背景色', '消息', '模式:0自己/1全服/2行会/3国家/4地图', '时间', '倒计时标签', '替换模式', 'X'],
      '发送屏幕中央文字'
    ),
  },
  SENDDELAYMSG: {
    GOM: definition(
      'SENDDELAYMSG 消息 时间秒 字体颜色 换图删除 跳转标签',
      ['消息', '时间秒', '字体颜色', '换图删除', '跳转标签'],
      '显示倒计时提示'
    ),
    GEE: definition(
      'SENDDELAYMSG 消息 时间秒 字体颜色 换图删除 跳转标签 X坐标',
      ['消息', '时间秒', '字体颜色', '换图删除', '跳转标签', 'X坐标'],
      '显示倒计时提示'
    ),
  },
  SENDMOVEHINTMSG: {
    GOM: definition(
      'SENDMOVEHINTMSG 消息 前景色 背景色 X Y [屏幕坐标模式]',
      ['消息', '前景色', '背景色', 'X', 'Y', '[屏幕坐标模式:1]'],
      '在鼠标或屏幕位置显示向上滚动提示'
    ),
    GEE: definition(
      'SENDMOVEHINTMSG 消息 前景色 背景色 X Y [停留秒数]',
      ['消息', '前景色', '背景色', 'X', 'Y', '[停留秒数:默认3]'],
      '在指定位置显示向上滚动提示'
    ),
  },
  SENDMOVEMSG: {
    GOM: definition(
      'SENDMOVEMSG 类型 前景色 背景色 Y 滚动次数 消息 [滚动速度]',
      ['类型:0全局/1自己/2跨服', '前景色', '背景色', 'Y', '滚动次数', '消息', '[滚动速度]'],
      '发送屏幕滚动信息'
    ),
    GEE: definition(
      'SENDMOVEMSG 类型 前景色 背景色 Y 滚动次数 消息 字体大小 滚动速度 范围',
      ['类型(0-7)', '前景色', '背景色', 'Y', '滚动次数', '消息', '字体大小', '滚动速度', '范围'],
      '发送屏幕滚动信息'
    ),
  },
  SENDMSG: {
    GOM: definition(
      'SENDMSG 类型 [字体颜色] [背景颜色] 消息',
      ['类型', '[字体颜色(0-255)]', '[背景颜色(0-255)]', '消息'],
      '发送聊天框或头顶文字，颜色参数位于消息之前'
    ),
    GEE: definition(
      'SENDMSG 类型 消息 [字体颜色] [背景颜色]',
      ['类型', '消息', '[字体颜色(0-255)]', '[背景颜色(0-255)]'],
      '发送聊天框或头顶文字，颜色参数位于消息之后'
    ),
  },
  SETITEMBIND: {
    GOM: definition(
      'SetItemBind 装备位置(-1/0-28/30-47) 绑定状态',
      ['装备位置(-1/0-28/30-47)', '绑定状态(0/1)'],
      '设置物品绑定状态'
    ),
  },
  SETITEMEFFECT: {
    GOM: {
      ...definition(
        'SETITEMEFFECT 装备位置 特效编号1 [地面光效模式] [特效编号2]',
        ['装备位置(-1/0-28/30-47)', '特效编号1(0清除/-1不改变)', '[地面光效模式:1时编号1修改地面光效]', '[特效编号2(0清除/-1不改变)]'],
        '按GOM双层格式设置装备发光、地面光效或第二层特效'
      ),
      minArgs: 2,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'SETITEMEFFECT 装备位置(-1/0-51/BOXITEM0-7) 特效编号(0-50000) [特效位置]',
        ['装备位置(-1/0-51/BOXITEM0-7)', '特效编号(0-50000)', '[特效位置:0-2，默认0]'],
        '按翎风三位置格式设置装备发光特效'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  SETITEMSTATE: {
    GOM: definition(
      'SetItemState 装备位置(-1/0-18/30-41) 项目(0-7) 状态',
      ['装备位置(-1/0-18/30-41)', '项目(0-7)', '状态(0/1)'],
      '设置装备绑定状态'
    ),
    GEE: definition(
      'SetItemState 装备位置(-1-13) 项目(0-5) 状态',
      ['装备位置(-1-13)', '项目(0-5)', '状态(0/1)'],
      '设置装备绑定状态'
    ),
  },
  SETNEWITEMVALUE: {
    GOM: definition(
      'SETNEWITEMVALUE 装备位置(-1/0-28/30-47) 属性(20-27) 操作符 值',
      ['装备位置(-1/0-28/30-47)', '属性(20-27)', '操作符(+,-,=)', '值'],
      '调整物品元素属性'
    ),
    GEE: definition(
      'SETNEWITEMVALUE 装备位置(-1/0-12) 属性(0-25) 操作符 值',
      ['装备位置(-1/0-12)', '属性(0-25)', '操作符(+,-,=)', '值'],
      '调整物品新增属性'
    ),
  },
  SETONTIMER: {
    GOM: definition(
      'SETONTIMER 定时器索引(0-255) 间隔秒',
      ['定时器索引(0-255)', '间隔秒'],
      '开启个人定时器'
    ),
    GEE: definition(
      'SETONTIMER 定时器索引(0-255) 间隔秒 [执行次数]',
      ['定时器索引(0-255)', '间隔秒', '[执行次数:留空为无限]'],
      '开启个人定时器'
    ),
  },
  SETSKILLPOWER: {
    GOM: definition(
      'SetSkillPower 技能ID 操作符 人物伤害% 人物伤害值 怪物伤害% 怪物伤害值 防御% 防御值 时间 技能范围',
      ['技能ID', '操作符(+,-,=)', '人物伤害%', '人物伤害值', '怪物伤害%', '怪物伤害值', '防御%', '防御值', '时间:-1永久', '技能范围'],
      '调整技能伤害、防御和范围'
    ),
    GEE: definition(
      'SetSkillPower 技能ID 操作符 人物伤害% 人物伤害值 怪物伤害% 怪物伤害值 防御% 防御值 时间 保存',
      ['技能ID', '操作符(+,-,=)', '人物伤害%', '人物伤害值', '怪物伤害%', '怪物伤害值', '防御%', '防御值', '时间:0永久', '保存(0/1)'],
      '调整技能伤害和防御'
    ),
  },
  SETSUCKDAMAGE: {
    GOM: {
      ...definition(
        'SetSuckDamage 操作符 总吸收值 吸收比例 成功率',
        ['操作符(+,-,=)', '总吸收值(1-2000000000)', '吸收比例(1-1000，1为0.1%)', '成功率(1-100)'],
        '按GOM格式设置人物伤害吸收总值、比例和成功率'
      ),
      minArgs: 4,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'SetSuckDamage 操作符 总吸收值 吸收比例 成功率',
        ['操作符(+,-,=)', '总吸收值(1-2000000000；-1为无限)', '吸收比例(1-1000，1为0.1%)', '成功率(1-100)'],
        '按翎风格式设置人物伤害吸收总值、比例和成功率'
      ),
      minArgs: 4,
      maxArgs: 4,
    },
  },
  SETWEATHEREFFECT: {
    GOM: definition(
      'SETWEATHEREFFECT',
      [],
      'GOM帮助仅保留命令名，未给出可核验参数格式'
    ),
    GEE: definition(
      'SETWEATHEREFFECT 地图 天气效果 有效时间 是否黑暗 [音乐文件]',
      ['地图', '天气效果(0-21)', '有效时间秒', '是否黑暗(0/1)', '[WAV音乐文件]'],
      '设置地图天气、明暗和背景音乐'
    ),
  },
  SHOWCUSTOMITEM: {
    GOM: definition(
      'ShowCustomItem 是否外显 外显类型 自定义编号',
      ['是否外显(0/1)', '外显类型', '自定义编号'],
      '控制自定义装备外显'
    ),
    GEE: definition(
      'ShowCustomItem 装备框位置 界面位置 图片文件 图片序号 X Y 使用内观图 提示文字',
      ['装备框位置(0-49)', '界面位置', '图片文件', '图片序号', 'X', 'Y', '使用内观图(0/1)', '提示文字'],
      '在自定义装备框显示素材'
    ),
  },
  SORTLIST: {
    GOM: definition(
      'SortList 源列表 目标列表 排序方式 排序依据 [分段分隔符] [取第几段]',
      ['源列表', '目标列表', '排序方式', '排序依据', '[分段分隔符]', '[取第几段]'],
      '排序列表元素'
    ),
    GEE: definition(
      'SortList 源列表 目标列表 排序方式 排序依据',
      ['源列表', '目标列表', '排序方式', '排序依据'],
      '排序列表元素'
    ),
  },
  SORTVARTOLIST: {
    GOM: definition(
      'SortVarToList 变量名 变量文件 输出文件 排序方式 保存格式',
      ['变量名', '变量文件', '输出文件', '排序方式', '保存格式'],
      '按变量值排序并输出名单'
    ),
    GEE: definition(
      'SortVarToList 变量名 变量文件 输出文件 排序方式 保存格式 变量绝对路径 输出绝对路径',
      ['变量名', '变量文件', '输出文件', '排序方式', '保存格式', '变量绝对路径(0/1)', '输出绝对路径(0/1)'],
      '按变量值排序并输出名单'
    ),
  },
  STARTAUTOPLAYGAME: {
    GOM: definition(
      'STARTAUTOPLAYGAME 挂机范围 挂机点间距 模式',
      ['挂机范围', '挂机点间距', '模式(0-2)'],
      '开始内挂挂机并按参数生成挂机点'
    ),
    GEE: definition(
      'STARTAUTOPLAYGAME',
      [],
      '开始内挂挂机'
    ),
  },
  STRUCKDAMAGEABSORB: {
    GOM: definition(
      'STRUCKDAMAGEABSORB 怪物名 吸收百分比 有效时间',
      ['怪物名:*为全部', '吸收百分比(1-100)', '有效时间秒'],
      '按怪物名称设置伤害吸收比例'
    ),
    GEE: definition(
      'STRUCKDAMAGEABSORB 怪物名 吸收几率 吸收比例 有效时间',
      ['怪物名:*为全部', '吸收几率(1-100)', '吸收比例(1-100)', '有效时间秒'],
      '按怪物名称设置伤害吸收几率和比例'
    ),
  },
  TAKE: {
    GOM: definition(
      'TAKE 物品名 数量 [部分匹配] [检测改名]',
      ['物品名', '数量', '[部分匹配:0完全/1部分]', '[检测改名:0否/1是]'],
      '回收背包物品'
    ),
    GEE: definition(
      'TAKE 物品名 数量 [检测改名] [部分匹配] [跳过自定义OK框] [持久筛选]',
      ['物品名', '数量', '[检测改名:0否/1是]', '[部分匹配:0完全/1部分]', '[跳过自定义OK框:0否/1是]', '[持久筛选:0全部/-1满/-2非满]'],
      '回收背包物品'
    ),
  },
  TAKEBAGITEM: {
    GOM: definition(
      'TakeBagItem 物品名 数量 元宝 金币 泡点 泡点经验 结果变量 聚灵珠 物品标识 物品颜色',
      ['物品名列表', '数量', '元宝', '金币', '泡点', '泡点经验', '结果变量', '聚灵珠(0/1)', '物品标识', '物品颜色'],
      '按名称批量回收背包物品'
    ),
    GEE: definition(
      'TakeBagItem 物品名 数量 元宝 金币 泡点 经验 结果变量 聚灵珠 显示提示 颜色 回收极品 回收改名 最高等级',
      ['物品名列表', '数量', '元宝', '金币', '泡点', '经验', '结果变量', '聚灵珠(0/1)', '显示提示(0/1)', '颜色', '回收极品(0/1)', '回收改名(0/1)', '最高等级'],
      '按名称批量回收背包物品'
    ),
  },
  TAKEBAGITEMEX: {
    GOM: definition(
      'TakeBagItemEX 物品IDX 数量 元宝 金币 泡点 泡点经验 结果变量 聚灵珠 物品标识 物品颜色',
      ['物品IDX列表', '数量', '元宝', '金币', '泡点', '泡点经验', '结果变量', '聚灵珠(0/1)', '物品标识', '物品颜色'],
      '按数据库IDX批量回收背包物品'
    ),
    GEE: definition(
      'TakeBagItemEX 物品IDX 数量 元宝 金币 泡点 经验 结果变量 聚灵珠 显示提示 颜色 回收极品',
      ['物品IDX列表', '数量', '元宝', '金币', '泡点', '经验', '结果变量', '聚灵珠(0/1)', '显示提示(0/1)', '颜色', '回收极品(0/1)'],
      '按数据库IDX批量回收背包物品'
    ),
  },
  TAKEBAGITEMCOLOR: {
    GOM: definition(
      'TakeBagItemColor 颜色 数量 元宝 金币 泡点 泡点经验 结果变量 聚灵珠 物品标识 [颜色筛选]',
      ['颜色列表或范围', '数量', '元宝', '金币', '泡点', '泡点经验', '结果变量', '聚灵珠(0/1)', '物品标识', '[颜色筛选]'],
      '按颜色批量回收背包物品'
    ),
    GEE: definition(
      'TakeBagItemColor 颜色 数量 元宝 金币 泡点 经验 结果变量 聚灵珠 显示提示 回收极品',
      ['颜色列表或范围', '数量', '元宝', '金币', '泡点', '经验', '结果变量', '聚灵珠(0/1)', '显示提示(0/1)', '回收极品(0/1)'],
      '按颜色批量回收背包物品'
    ),
  },
  TAKEEX: {
    GOM: definition(
      'TakeEx 装备位置(0-16)',
      ['装备位置(0-16)'],
      '取下人物身上装备'
    ),
    GEE: definition(
      'TakeEx 装备位置(0-51)',
      ['装备位置(0-51)'],
      '取下人物身上装备'
    ),
  },
  TAKEONITEM: {
    GOM: definition(
      'TakeOnItem 装备名称 位置(0-28/30-52/71-120)',
      ['装备名称', '位置(0-28/30-52/71-120)'],
      '自动穿戴指定装备'
    ),
    GEE: definition(
      'TakeOnItem 装备名称 位置(0-12)',
      ['装备名称', '位置(0-12)'],
      '自动穿戴指定装备'
    ),
  },
  TEXTSPLIT: {
    GOM: definition(
      'TextSplit 分隔符 源字符串 首变量 递增数量 返回数量变量',
      ['分隔符', '源字符串', '首变量', '递增数量', '返回数量变量'],
      '分割字符串并依次写入变量'
    ),
    GEE: definition(
      'TextSplit 分隔符 源字符串 首变量 返回数量变量',
      ['分隔符', '源字符串', '首变量', '返回数量变量'],
      '分割字符串并依次写入变量'
    ),
  },
  UPGRADEITEMEX: {
    GOM: definition(
      'UPGRADEITEMEX 位置(0-47) 属性(0-14) 成功率 点数率 破碎',
      ['位置(0-47)', '属性(0-14)', '成功率(0-100)', '点数率(0-255)', '破碎(0/1)'],
      '升级装备附加属性'
    ),
    GEE: definition(
      'UPGRADEITEMEX 位置(0-12) 属性(0-17) 成功率 点数率 破碎 [显示文字]',
      ['位置(0-12)', '属性(0-17)', '成功率(0-100)', '点数率(0-255)', '破碎(0/1)', '[显示文字(0/1)]'],
      '升级装备附加属性'
    ),
  },
  USEBONUSPOINT: {
    GOM: definition(
      'USEBONUSPOINT 属性位置(1-14) 操作符 点数',
      ['属性位置(1-14)', '操作符(+,-,=)', '点数'],
      '永久调整人物属性点'
    ),
    GEE: definition(
      'USEBONUSPOINT 属性位置(1-9) 操作符 点数',
      ['属性位置(1-9)', '操作符(+,-,=)', '点数'],
      '永久调整人物属性点'
    ),
  },
};

Object.assign(variants, {
  CALLEX: {
    GOM: {
      ...definition(
        '#CALLEX [\\脚本文件] @标签',
        ['[\\脚本文件]', '@标签'],
        '按准确脚本路径调用指定标签'
      ),
      kind: 'control',
      contexts: ['ANY'],
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        '#CALLEX [\\脚本文件] @标签',
        ['[\\脚本文件]', '@标签'],
        '按准确脚本路径调用指定标签，可调用多个同名标签'
      ),
      kind: 'control',
      contexts: ['ANY'],
      minArgs: 2,
      maxArgs: 2,
    },
  },
  LINKGIVEITEM: {
    GOM: {
      ...definition(
        'LINKGIVEITEM',
        [],
        '绑定最近由 GIVE 命令给予的物品，供后续命令操作'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'LINKGIVEITEM',
        [],
        '绑定脚本给予的当前物品，供后续命令操作'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
  },
  TAKEDLGITEM: {
    GOM: {
      ...definition(
        'TAKEDLGITEM',
        [],
        '收回当前自定义 OK 框中的物品'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'TAKEDLGITEM',
        [],
        '收回当前自定义 OK 框中的物品'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
  },
  CLEARLINKITEM: {
    GOM: {
      ...definition(
        'ClearLinkItem',
        [],
        '解除当前物品绑定并立即刷新背包物品属性'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'ClearLinkItem',
        [],
        '解除当前物品绑定并立即刷新背包物品属性'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
  },
  CHANGEDAMAGE: {
    GOM: {
      ...definition(
        'ChangeDamage 目标类型 威力值 持续时间',
        [
          '目标类型(0全部/1对人物/2对怪物)',
          '威力值:最终倍率=1+威力值/100；帮助页参数表称最小0，同页也用-50表示0.5倍',
          '持续时间秒(-1在线一直有效/0不生效/>0倒计时)',
        ],
        '临时调整人物对人物或怪物造成的最终伤害倍率'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
  },
  CHANGESLAVELEVEL: {
    GOM: {
      ...definition(
        'ChangeSlaveLevel 宝宝名称 操作符 等级 [调整范围]',
        [
          '宝宝名称(*为所有宝宝)',
          '操作符(+,-,=)',
          '等级(1-7)',
          '[调整范围:0单个/1全部同名宝宝]',
        ],
        '调整单个、全部同名或所有宝宝的等级'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'ChangeSlaveLevel 宝宝名称 操作符 等级 [调整范围]',
        [
          '宝宝名称(*为所有宝宝)',
          '操作符(+,-,=)',
          '等级(1-7)',
          '[调整范围:0单个/1全部同名宝宝]',
        ],
        '调整单个、全部同名或所有宝宝的等级'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
  },
  CHANGESLAVEABILITY: {
    GOM: {
      ...definition(
        'ChangeSlaveAbility 属性类型 属性值 [宝宝名称]',
        [
          '属性类型(1-15基础/16-20元素/21-39特殊/40返回距离/41混乱移动/42禁止移动)',
          '属性值',
          '[宝宝名称:空为全部宝宝]',
        ],
        '按GOM属性编号修改单个或全部宝宝属性'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'ChangeSlaveAbility 属性类型 属性值 [宝宝名称]',
        [
          '属性类型(0 HP/1 MaxHP/2 MP/3 MaxMP/4-15战斗属性/30有效时间)',
          '属性值:类型30时为有效时间秒',
          '[宝宝名称:空为全部宝宝]',
        ],
        '按翎风属性编号修改宝宝临时属性，之后需调用RecalcSlaveAbility重算'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  CLEARSKILLWAITTIME: {
    GOM: {
      ...definition(
        'ClearSkillWaitTime 技能ID [立即施放模式]',
        [
          '技能ID',
          '[立即施放模式:0默认/1指定技能可按键立即施放/2同时立即执行勾选的内挂自动技能]',
        ],
        '清空指定技能的冷却时间'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
  },
  CHANGESPEED: {
    GOM: {
      ...definition(
        'ChangeSpeed 速度类型 速度值 [有效时间]',
        [
          '速度类型(1移动/2攻击/3魔法)',
          '速度值(-10至10；负数减速/0不变/正数加速)',
          '[有效时间秒:空为不限时]',
        ],
        '按GOM范围临时调整移动、攻击或魔法速度'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'ChangeSpeed 速度类型 速度值 [有效时间]',
        [
          '速度类型(1移动/2攻击/3魔法)',
          '速度值(-100至100；实际间隔由M2速度控制设置)',
          '[有效时间秒:空为不限时，小退失效]',
        ],
        '按翎风范围临时调整移动、攻击或魔法速度'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  CHECKCASTLEWAR: {
    GOM: definition(
      'CheckCastleWar 城堡编号',
      ['城堡编号'],
      '检测指定编号的城堡是否正在攻城'
    ),
    GEE: definition(
      'CheckCastleWar 城堡名称',
      ['城堡名称'],
      '检测指定名称的城堡是否正在攻城'
    ),
  },
  CHECKMAPSAMEMONCOUNT: {
    GOM: {
      ...definition(
        'CheckMapSameMonCount 地图 怪物名 操作符 数量 [忽略数字后缀]',
        [
          '地图',
          '怪物名',
          '操作符(<,>,=)',
          '数量',
          '[忽略数字后缀:0或空检测数字/1忽略数字]',
        ],
        '检测地图内指定名称的怪物数量'
      ),
      minArgs: 4,
      maxArgs: 5,
    },
    GEE: {
      ...definition(
        'CheckMapSameMonCount 地图 怪物名 操作符 数量 [忽略数字后缀]',
        [
          '地图',
          '怪物名',
          '操作符(<,>,=)',
          '数量',
          '[忽略数字后缀:0或空检测数字/1忽略数字]',
        ],
        '检测地图内指定名称的怪物数量'
      ),
      minArgs: 4,
      maxArgs: 5,
    },
  },
  CHECKCURRTARGETRACE: sharedDefinition(
    'CHECKCURRTARGETRACE 操作符 Race值',
    ['操作符(=,>,<)', '怪物数据库Race值'],
    '检测当前目标的Race类型'
  ),
  CHECKHUMBAG: sharedDefinition(
    'CheckHumBag 人物名称 操作符 背包空格数',
    ['人物名称', '操作符(=,>,<)', '背包空格数'],
    '检测指定人物的背包空格数量'
  ),
  CHECKNATIONHUMCOUNT: sharedDefinition(
    'CheckNationHumCount 操作符 人数',
    ['操作符(=,>,<)', '人数'],
    '检测当前国家的人物数量'
  ),
  CHECKSLAVECOUNT: {
    GOM: definition(
      'CHECKSLAVECOUNT 操作符 数量',
      ['操作符(=,>,<)', '宝宝数量'],
      '检测人物携带的宝宝数量'
    ),
    GEE: definition(
      'CHECKSLAVECOUNT 操作符 数量 [宝宝名称] [名称数字模式]',
      [
        '操作符(=,>,<)', '宝宝数量', '[宝宝名称:留空为全部]',
        '[名称数字模式:0忽略末尾数字/1计入数字]',
      ],
      '检测全部或指定名称的宝宝数量'
    ),
  },
  CHECKTRANPOINT: sharedDefinition(
    'CHECKTRANPOINT 技能名称 操作符 点数',
    ['技能名称', '操作符(=,>,<)', '技能修炼点数'],
    '检测技能修炼点数'
  ),
  GETSTRINGPOSEX: {
    GOM: definition(
      'GetStringPosEx 文件路径 搜索内容 行号变量 文本变量 [OLDMODE]',
      ['文件路径', '搜索内容', '行号变量', '完整行文本变量', '[OLDMODE]'],
      '检测文本中包含指定字符串的行并返回行号和完整文本'
    ),
    GEE: definition(
      'GetStringPosEx 文件路径 搜索内容 行号变量 文本变量 [绝对路径] [匹配模式]',
      [
        '文件路径', '搜索内容', '行号变量', '完整行文本变量',
        '[绝对路径:0相对/1绝对]', '[匹配模式:0包含/1完全匹配]',
      ],
      '检测文本中的字符串并返回行号和完整文本'
    ),
  },
  OR: {
    GOM: {
      ...definition('#OR', [], '连接下一组并列条件'),
      kind: 'control',
      contexts: ['ANY'],
    },
    GEE: {
      ...definition('#OR', [], '连接下一组并列条件'),
      kind: 'control',
      contexts: ['ANY'],
    },
  },
  ADDBUTTON: {
    GOM: definition(
      'ADDBUTTON WIL 触发序号 默认图 经过图 按下图 X Y 移动|分组 标题 提示',
      [
        'WIL补丁序号或补丁名', 'QF触发序号(1-100)', '默认图片', '鼠标经过图片',
        '鼠标按下图片', 'X坐标', 'Y坐标', '是否可移动|按钮分组',
        '按钮标题(-1不显示)', '悬浮提示',
      ],
      '在指定界面创建GOM自定义按钮'
    ),
    GEE: definition(
      'ADDBUTTON WIL 触发序号 默认图 经过图 按下图 X Y 创建位置 标题 提示',
      [
        'WIL补丁序号', 'QF触发序号(1-200)', '默认图片', '鼠标经过图片',
        '鼠标按下图片', 'X坐标', 'Y坐标', '创建位置',
        '按钮标题(-1不显示)', '悬浮提示',
      ],
      '在指定界面创建翎风自定义按钮'
    ),
  },
  ADDDLG: {
    GOM: definition(
      'AddDlg 编号(1-100) WIL 图片 可移动 界面坐标 文字偏移 创建位置 QF字段 上级参数 分组参数',
      [
        '对话框编号(1-100)', 'WIL序号或补丁名', '图片编号', '可移动(0/1)',
        '界面X:界面Y', '文字偏移X:文字偏移Y', '创建位置', 'QF触发字段',
        '上级移动:刷新坐标', '分组ID:显示模式:方向:离开关闭:延时',
      ],
      '创建GOM附加NPC对话框'
    ),
    GEE: definition(
      'AddDlg 编号(1-50) WIL 图片 可移动 界面坐标 文字偏移 创建位置 内容',
      [
        '对话框编号(1-50)', '图片文件序号', '图片编号', '可移动(0/1)',
        '界面X:界面Y', '文字偏移X:文字偏移Y', '创建位置', '对话内容',
      ],
      '创建翎风附加对话框'
    ),
  },
  AUTOTAKEOFFITEM: {
    GOM: definition(
      'AutoTakeOffItem 装备位置',
      ['装备位置:支持普通装备及首饰盒30-41'],
      '自动取下指定位置的装备'
    ),
    GEE: definition(
      'AutoTakeOffItem [装备名称] 装备位置(0-12)',
      ['[装备名称:无法取下时省略]', '装备位置(0-12)'],
      '自动取下指定名称或位置的装备'
    ),
  },
  CHANGEEXP: {
    GOM: definition(
      'CHANGEEXP 操作符 经验值 [聚灵珠经验]',
      ['操作符(=,+,-)', '经验值', '[聚灵珠经验:0否/1同时增加]'],
      '调整人物经验，可选择同时增加聚灵珠经验'
    ),
    GEE: definition(
      'CHANGEEXP 操作符 经验值 [英雄分配] [聚灵珠经验]',
      [
        '操作符(=,+,-)', '经验值', '[英雄分配:0否/1按引擎比例分配]',
        '[聚灵珠经验:0否/1允许]',
      ],
      '调整人物经验，可控制英雄分配和聚灵珠经验'
    ),
  },
  CHANGEHUMNAMEFILE: {
    GOM: definition(
      'CHANGEHUMNAMEFILE 文件路径',
      ['文件路径'],
      '人物改名成功后同步修改指定文本文件'
    ),
    GEE: definition(
      'CHANGEHUMNAMEFILE 文件路径 [绝对路径] [前缀] [后缀]',
      ['文件路径', '[绝对路径:0相对/1绝对]', '[前缀]', '[后缀]'],
      '人物改名成功后同步修改文本或变量文件'
    ),
  },
  CLEARSCREENEFFECT: {
    GOM: {
      ...definition(
        'CLEARSCREENEFFECT [模式]',
        ['[模式:0自己/1屏幕上所有人]'],
        '清空SCREENEFFECT播放的屏幕特效'
      ),
      minArgs: 0,
      maxArgs: 1,
    },
    GEE: {
      ...definition(
        'CLEARSCREENEFFECT 模式',
        ['模式(0自己/1屏幕上所有人)'],
        '按指定范围清空SCREENEFFECT播放的屏幕特效'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  CLOSECLIENTBUFF: {
    GOM: definition(
      'CloseClientBuff 槽位(1-100)',
      ['BUFF槽位(1-100)'],
      '关闭指定GOM客户端BUFF图标'
    ),
    GEE: definition(
      'CloseClientBuff 槽位(1-200)',
      ['BUFF槽位(1-200)'],
      '关闭指定翎风客户端BUFF图标'
    ),
  },
  COPYFILE: {
    GOM: definition(
      'CopyFile 源文件 目标文件',
      ['源文件', '目标文件'],
      '复制文件'
    ),
    GEE: definition(
      'CopyFile 源文件 目标文件 [覆盖模式]',
      ['源文件', '目标文件', '[覆盖模式:0强制覆盖/1已存在不覆盖]'],
      '复制文件并可控制目标文件覆盖方式'
    ),
  },
  DELBUTTON: {
    GOM: definition(
      'DELBUTTON 按钮序号(1-100) [删除范围]',
      ['按钮序号(1-100)', '[删除范围:0自己/1全服]'],
      '删除GOM自定义按钮'
    ),
    GEE: definition(
      'DELBUTTON 按钮序号(1-200) [删除范围]',
      ['按钮序号(1-200)', '[删除范围:0自己/1全服]'],
      '删除翎风自定义按钮'
    ),
  },
  DELDLG: {
    GOM: definition(
      'DelDlg 对话框编号(1-100)',
      ['对话框编号(1-100)'],
      '删除自己的GOM附加对话框'
    ),
    GEE: definition(
      'DelDlg 对话框编号(1-50) [删除范围]',
      ['对话框编号(1-50)', '[删除范围:0自己/1全服]'],
      '删除翎风附加对话框'
    ),
  },
  DELMAPEFFECT: {
    GOM: {
      ...definition(
        'DELMAPEFFECT 地图 X Y WIL 开始图片 张数 次数 速度 播放效果 删除控制',
        [
          '地图', 'X', 'Y', 'WIL文件序号', '开始图片', '播放张数',
          '播放次数', '播放速度', '播放效果',
          '删除控制(调试数量|删除全部|特效ID)',
        ],
        '按地图特效参数删除GOM特效，最后一项使用三段删除控制'
      ),
      minArgs: 10,
      maxArgs: 10,
    },
    GEE: {
      ...definition(
        'DELMAPEFFECT 地图 X Y WIL 开始图片 张数 次数 速度 播放效果 亮度 [ID] [播放顺序]',
        [
          '地图', 'X', 'Y', 'WIL文件序号', '开始图片', '播放张数',
          '播放次数', '播放速度', '播放效果', '亮度(0-5)',
          '[特效ID]', '[播放顺序:0对象底层/1对象前层/2全部图层上方]',
        ],
        '按与MapEffect一致的参数删除翎风地图特效'
      ),
      minArgs: 10,
      maxArgs: 12,
    },
  },
  DETOXIFCATION: {
    GOM: {
      ...definition(
        'Detoxifcation [毒来源] [毒类型]',
        [
          '[毒来源:0普通红绿紫毒/1仅MAKEPOSION毒/2全部]',
          '[毒类型:0全部/1红毒/2绿毒/3紫毒]',
        ],
        '按毒来源和毒类型解毒；帮助页紫毒行将参数2误写为“参数3=3”'
      ),
      minArgs: 0,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'Detoxifcation',
        [],
        '清除人物的红毒和绿毒'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
  },
  DOTAUNT: {
    GOM: definition(
      'DoTaunt 范围 等级范围 [包含人物] [移动模式] [已有目标检测] [分散范围]',
      [
        '范围', '怪物最低等级或最低|最高等级', '[包含人物:0否/1是]',
        '[移动模式:0走动/1到人物/2人物周围/3人物面前]',
        '[已有攻击目标检测:0否/1是]', '[瞬移分散范围]',
      ],
      '按GOM规则吸引范围内目标'
    ),
    GEE: definition(
      'DoTaunt 范围 最低等级 [瞬移] [已有目标检测] [鼠标坐标] [分散范围]',
      [
        '范围', '怪物最低等级', '[瞬移:0走动/1瞬移]', '[已有攻击目标检测:0否/1是]',
        '[@BeginMagic中使用鼠标坐标:0否/1是]', '[分散范围]',
      ],
      '按翎风规则吸引范围内怪物'
    ),
  },
  EXTRACTLIST: sharedDefinition(
    'EXTRACTLIST 源列表 目标变量 起始下标 结束下标 [步长]',
    ['源列表', '目标变量', '起始下标', '结束下标', '[步长:默认1]'],
    '截取列表指定下标范围'
  ),
  EXTRACTSTRING: sharedDefinition(
    'EXTRACTSTRING 分隔符 源字符串 结果变量...',
    ['分隔符', '源字符串', '依次保存分段的结果变量...'],
    '按分隔符拆分字符串并依次写入变量'
  ),
  GETCALLMOB: {
    GOM: definition(
      'GetCallMob 宝宝名称',
      ['宝宝名称'],
      '让指定宝宝立即叛变'
    ),
    GEE: definition(
      'GetCallMob [宝宝名称] [数量] [保留分身]',
      [
        '[宝宝名称:留空为全部]', '[数量:0全部/1一个/其他为指定数]',
        '[保留分身:0收回/1叛变]',
      ],
      '让全部或指定数量的宝宝立即叛变'
    ),
  },
  GETINTERVAL: sharedDefinition(
    'GETINTERVAL 时间1 时间2 单位 保存变量',
    ['时间1', '时间2', '单位(0年/1月/2星期/3天/4时/5分/6秒)', '保存变量'],
    '计算两个时间之间的间隔'
  ),
  GETUPGRADECOUNT: {
    GOM: {
      ...definition(
        'GetUpgradeCount 位置 保存变量',
        ['位置(支持OK框/装备/首饰/生肖/ALL或*)', '保存变量'],
        '获取GOM指定位置或全身装备的星星数量'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'GetUpgradeCount 位置 保存变量',
        ['位置(支持OK框/装备/首饰/神佑/ALL或*)', '保存变量'],
        '获取翎风指定位置或全身装备的星星数量'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  GETMAPMONCOUNT: {
    GOM: {
      ...definition(
        'GetMapMonCount 地图 是否排除宝宝 保存变量',
        [
          '地图',
          '是否排除宝宝(0不排除；GOM帮助页也将1写为“不排除”，未给出可区分定义)',
          '保存变量',
        ],
        '获取GOM地图怪物数量；排除宝宝参数的1值在当前帮助页存在原文歧义'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'GetMapMonCount 地图 是否排除宝宝 保存变量',
        ['地图', '是否排除宝宝(0不排除/1排除)', '保存变量'],
        '获取翎风地图怪物数量'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
  },
  GETITEMCOUNT: {
    GOM: definition(
      'GetItemCount 位置(0-8) 物品名称 保存变量',
      [
        '位置(0背包/1装备/2生肖/3首饰盒/4普通仓/5商店出售/6商店仓库/7摆摊/8大仓库)',
        '物品名称', '保存变量',
      ],
      '获取GOM指定位置的物品数量'
    ),
    GEE: definition(
      'GetItemCount 位置(0-6) 物品名称 保存变量',
      [
        '位置(0背包/1装备/2首饰/3神佑/4普通仓/5无限仓/6摆摊)',
        '物品名称', '保存变量',
      ],
      '获取翎风指定位置的物品数量'
    ),
  },
  GETSKILLPOWER: {
    GOM: definition(
      'GetSkillPower 技能ID 人伤%变量 人伤值变量 怪伤%变量 怪伤值变量 防御%变量 防御值变量 时间变量',
      [
        '技能ID', '人物伤害百分比变量', '人物伤害固定值变量', '怪物伤害百分比变量',
        '怪物伤害固定值变量', '防御百分比变量', '防御固定值变量', '剩余时间变量',
      ],
      '获取GOM技能私人伤害、防御和时间设置'
    ),
    GEE: definition(
      'GetSkillPower 技能ID 人伤%变量 人伤值变量 怪伤%变量 怪伤值变量 防御%变量 防御值变量 时间变量 保存变量',
      [
        '技能ID', '人物伤害百分比变量', '人物伤害固定值变量', '怪物伤害百分比变量',
        '怪物伤害固定值变量', '防御百分比变量', '防御固定值变量',
        '剩余时间变量', '是否保存数据库变量',
      ],
      '获取翎风技能私人伤害、防御、时间和保存状态'
    ),
  },
  GIVE: {
    GOM: {
      ...definition(
        'GIVE 物品名称 [数量]',
        ['物品名称', '[数量:默认1]'],
        '按GOM格式给予指定物品'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'GIVE 物品名称 数量 [参数0] [参数1] [参数2] [参数3] [参数4] [参数5] [参数6] [参数7] [参数8] [参数9] [参数10] [参数11] [参数12]',
        [
          '物品名称', '数量', '[参数0]', '[参数1]', '[参数2]',
          '[参数3:极品属性0]', '[参数4:极品属性1]', '[参数5:极品属性2]',
          '[参数6:极品属性3]', '[参数7:极品属性4]', '[参数8:极品属性5]',
          '[参数9:持久，-1为满持久]', '[参数10:刺术]', '[参数11:箭术]',
          '[参数12:武力]',
        ],
        '按翎风扩展格式给予物品，并可依次设置参数0-12'
      ),
      minArgs: 2,
      maxArgs: 15,
      snippet: 'GIVE ${1:物品名称} ${2:数量}',
    },
  },
  GIVESTATEITEM: {
    GOM: definition(
      'GiveStateItem 物品名称 状态1 状态2 状态3 状态4 状态5 状态6 状态7 数量 [改名]',
      [
        '物品名称', '禁止扔', '禁止交易', '禁止存', '禁止修', '禁止出售',
        '禁止爆出', '丢弃消失', '数量', '[改名名称]',
      ],
      '给予带七项绑定状态的GOM物品'
    ),
    GEE: definition(
      'GiveStateItem 物品名称 状态1 状态2 状态3 状态4 状态5 状态6',
      ['物品名称', '禁止扔', '禁止交易', '禁止存', '禁止修', '禁止出售', '禁止爆出'],
      '给予带六项绑定状态的翎风物品'
    ),
  },
  GROUPMAPMOVE: {
    GOM: definition(
      'GROUPMAPMOVE 地图 X Y [最低等级] [触发字段]',
      ['地图', 'X', 'Y', '[最低等级]', '[触发字段]'],
      '把队伍传送到指定坐标'
    ),
    GEE: definition(
      'GROUPMAPMOVE 地图 X Y [最低等级] [触发字段] [范围]',
      ['地图', 'X', 'Y', '[最低等级]', '[触发字段]', '[队长中心范围:0为不限]'],
      '把指定范围内的队友传送到指定坐标'
    ),
  },
  GROUPMOVE: {
    GOM: definition(
      'GROUPMOVE 地图 [最低等级] [触发字段]',
      ['地图', '[最低等级]', '[触发字段]'],
      '把队伍随机传送到指定地图'
    ),
    GEE: definition(
      'GROUPMOVE 地图 [最低等级] [触发字段] [范围]',
      ['地图', '[最低等级]', '[触发字段]', '[队长中心范围:0为不限]'],
      '把指定范围内的队友随机传送到指定地图'
    ),
  },
  GOTOLABEL: {
    GOM: {
      ...definition(
        'GOTOLABEL 模式(0-8) @标签 [X] [Y] [范围] 是否排除自己 [传递变量1] [传递变量2] [传递变量3] [传递变量4]',
        [
          '模式(0组队/1行会/2地图人物/3范围人物/4当前地图/5范围内不同攻击模式/6范围组队/7范围行会/8范围地图人物)',
          '@触发标签',
          '[X:模式3、5-8使用]',
          '[Y:模式3、5-8使用]',
          '[范围:模式3、5-8使用]',
          '是否排除自己(0包含/1排除)',
          '[传递变量1]',
          '[传递变量2]',
          '[传递变量3]',
          '[传递变量4]',
        ],
        '按GOM模式向组队、行会、地图或指定范围人物触发标签并可传递变量'
      ),
      minArgs: 3,
      maxArgs: 10,
    },
    GEE: {
      ...definition(
        'GOTOLABEL 模式(0-9) @标签 [范围或X] [Y] [范围] [是否排除自己] [传递变量] [接收变量]',
        [
          '模式(0组队/1行会/2地图人物/3自身范围/4-7对应排除自己/8指定坐标范围/9国家成员)',
          '@触发标签',
          '[范围或X:模式8时为X，其他支持范围的模式为范围]',
          '[Y:模式8]',
          '[范围:模式8]',
          '[是否排除自己:模式8，0包含/1排除]',
          '[传递变量:模式8]',
          '[接收变量:模式8]',
        ],
        '按翎风模式向组队、行会、地图、国家或指定范围人物触发标签'
      ),
      minArgs: 2,
      maxArgs: 8,
    },
  },
  HTTPPOST: {
    GOM: definition(
      'HTTPPOST URL 数据格式 内容',
      ['URL', '数据格式(0文本/1JSON)', '提交内容'],
      '以GOM同步上报格式提交HTTP数据'
    ),
    GEE: definition(
      'HTTPPOST URL 请求体 请求类型 回调标签 保存变量',
      ['URL', '请求体', '请求类型(form/json/text)', 'NPC回调标签', '返回内容保存变量'],
      '异步提交HTTP数据并在回调中返回内容'
    ),
  },
  HUMANMP: {
    GOM: definition(
      'HUMANMP 操作符 数值',
      ['操作符(+,-,=)', 'MP数值'],
      '调整人物当前MP'
    ),
    GEE: definition(
      'HUMANMP 操作符 数值 [延时毫秒] [执行次数] [比例类型]',
      [
        '操作符(+,-,=)', '数值', '[延时毫秒]', '[执行次数]',
        '[比例类型:0固定值/1百分比/2千分比/3万分比]',
      ],
      '按翎风扩展模式调整人物MP'
    ),
  },
  INSERTTOLIST: sharedDefinition(
    'INSERTTOLIST 列表变量 值 插入位置',
    ['列表变量', '值', '插入位置(-1为末尾)'],
    '向列表指定位置插入元素'
  ),
  ISDUPMODE: {
    GOM: {
      ...definition(
        'IsDupMode 模式',
        ['模式(0检测人物、怪物和NPC/1只检测人物)'],
        '检测当前位置是否有对象重叠'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
    GEE: {
      ...definition(
        'IsDupMode [模式]',
        ['[模式:0或空检测全部对象/1只检测人物]'],
        '检测当前位置是否有对象重叠'
      ),
      minArgs: 0,
      maxArgs: 1,
    },
  },
  JSONGETNODEARRLEN: sharedDefinition(
    'JSONGETNODEARRLEN JSON内容 节点路径 输出变量 [默认值]',
    ['JSON内容', '节点路径', '输出变量', '[默认值]'],
    '获取JSON数组节点长度'
  ),
  JSONGETNODEVALUE: sharedDefinition(
    'JSONGETNODEVALUE JSON内容 节点路径 输出变量 [默认值]',
    ['JSON内容', '节点路径', '输出变量', '[默认值]'],
    '获取JSON节点值'
  ),
  KILL: {
    GOM: definition(
      'KILL 模式(0-3)',
      ['模式(0正常/1不掉物且不显示凶手/2凶手显示NPC/3不掉物且凶手显示NPC)'],
      '按GOM模式杀死人物'
    ),
    GEE: definition(
      'KILL 类型 [清理尸体]',
      [
        '类型:正式格式记为1-4，同页旧示例仍使用0-3',
        '[清理尸体:0否/1是；人物和英雄无效]',
      ],
      '按翎风模式杀死目标；帮助页同时保留新旧类型编号说明'
    ),
  },
  KILLMONBURSTRATE: {
    GOM: {
      ...definition(
        'KILLMONBURSTRATE 20140220 20140221 倍率 20140223 20140224 20140225 20140226 时长 20140227 20140228',
        [
          '固定参数20140220', '固定参数20140221', '倍率(除以100)',
          '固定参数20140223', '固定参数20140224', '固定参数20140225',
          '固定参数20140226', '时长秒', '固定参数20140227', '固定参数20140228',
        ],
        '按GOM固定标记格式设置人物杀怪爆率倍数'
      ),
      minArgs: 10,
      maxArgs: 10,
      snippet: 'KILLMONBURSTRATE 20140220 20140221 ${1:倍率} 20140223 20140224 20140225 20140226 ${2:时长秒} 20140227 20140228',
    },
    GEE: {
      ...definition(
        'KILLMONBURSTRATE 倍率 [有效时间] [保存] [静默]',
        ['倍率(除以100)', '[有效时间秒:0为在线有效]', '[下线保存:0否/1是]', '[静默:0提示/1不提示]'],
        '按翎风格式设置人物杀怪爆率倍数'
      ),
      minArgs: 1,
      maxArgs: 4,
    },
  },
  KICK: {
    GOM: {
      ...definition('KICK', [], '让当前脚本对象直接下线'),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'KICK [退出模式]',
        ['[退出模式:0或空踢下线/1小退]'],
        '让当前脚本对象下线或小退'
      ),
      minArgs: 0,
      maxArgs: 1,
    },
  },
  KILLSLAVE: {
    GOM: definition(
      'KILLSLAVE',
      [],
      '杀死自己的全部宝宝'
    ),
    GEE: definition(
      'KILLSLAVE [清理尸体] [宝宝名称]',
      ['[清理尸体:0否/1是]', '[宝宝名称:空或*为全部]'],
      '杀死全部或指定名称的宝宝'
    ),
  },
  LINKBAGITEM: sharedDefinition(
    'LINKBAGITEM 物品MakeIndex',
    ['背包物品唯一ID(MakeIndex)'],
    '按唯一ID关联背包物品供后续命令操作'
  ),
  MESSAGEBOX: sharedDefinition(
    'MESSAGEBOX 文字信息 [@确定标签] [@取消标签]',
    ['文字信息', '[@确定跳转标签]', '[@取消跳转标签]'],
    '弹出带可选确定和取消回调的消息框'
  ),
  MOBPLACE: {
    GOM: definition(
      'MOBPLACE 怪物名称',
      ['怪物名称'],
      '按MISSION/PARAM设置刷新怪物'
    ),
    GEE: definition(
      'MOBPLACE 怪物名称 [攻击目标名称]',
      ['怪物名称', '[只攻击的目标名称]'],
      '按MISSION/PARAM设置刷新怪物并可限制攻击目标'
    ),
  },
  MONITEMS: {
    GOM: definition(
      'MonItems [保留临时爆率]',
      ['[保留SetMonBurstItems爆率:1是]'],
      '在杀怪触发中让怪物再次爆出物品'
    ),
  },
  OFFLINE: sharedDefinition(
    'OFFLINE 间隔秒 每次经验',
    ['获得经验的间隔秒', '每次获得经验值'],
    '开启离线挂机经验'
  ),
  OPENDRAGONBOX: {
    GOM: definition(
      'OpenDragonBox 宝箱编号(15-24)',
      ['宝箱编号(15-24)'],
      '打开GOM宝箱配置'
    ),
    GEE: definition(
      'OpenDragonBox 宝箱Source值(0-255)',
      ['Boxs目录配置Source值(0-255)'],
      '打开翎风Boxs配置宝箱'
    ),
  },
  OPENSTORAGEVIEW: {
    GOM: definition(
      'OpenStorageView 预留参数 [X] [Y]',
      ['预留参数', '[窗口X坐标]', '[窗口Y坐标]'],
      '按GOM帮助文档参数打开可视化仓库'
    ),
    GEE: definition(
      'OpenStorageView 仓库类型 [X] [Y]',
      ['仓库类型(0普通仓/1无限仓)', '[窗口X坐标]', '[窗口Y坐标]'],
      '打开普通或无限可视化仓库'
    ),
  },
  PERCENT: {
    GOM: {
      ...definition(
        'PERCENT 结果变量 被除数变量 除数变量',
        ['结果变量', '被除数变量', '除数变量(不可为0)'],
        '计算被除数占除数的整数百分比'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'PERCENT 变量1 变量2',
        ['变量1', '变量2'],
        '翎风最新帮助仅确认两参数格式，未说明完整参数语义'
      ),
      minArgs: 2,
      maxArgs: 2,
      completionVerified: false,
    },
  },
  PLAYMUSIC: {
    GOM: definition(
      'PlayMusic 文件 [循环次数] [播放模式]',
      ['文件路径', '[循环次数]', '[播放模式:0自己/1全服/2当前地图/4同屏]'],
      '播放本地音乐并清除上一段音乐'
    ),
    GEE: definition(
      'PlayMusic 文件',
      ['文件路径'],
      '播放本地音乐；循环和范围控制请使用PlayMusicEx'
    ),
  },
  PLAYSOUND: {
    GOM: definition(
      'PlaySound 文件 循环次数 播放模式 [停止上一段]',
      ['文件路径', '循环次数', '播放模式(0自己/1全服/2当前地图/4同屏)', '[停止上一段:0否/1是]'],
      '播放声音并可停止此前声音'
    ),
    GEE: definition(
      'PlaySound 文件 循环次数 播放模式',
      ['文件路径', '循环次数(0无限)', '播放模式(0自己/1全服/2当前地图/4同屏)'],
      '播放声音'
    ),
  },
  PRINTUSETIME: {
    GOM: definition(
      'PrintUseTime 模式 [返回变量]',
      ['模式(1毫秒开始/2毫秒结束/3微秒开始/4微秒结束)', '[模式4返回变量]'],
      '测量脚本耗时；模式4可返回微秒值'
    ),
    GEE: definition(
      'PrintUseTime 模式 [数字变量] [文本变量]',
      ['模式(1开始/2结束)', '[耗时数字变量:模式2必填]', '[自动单位文本变量]'],
      '测量脚本耗时并返回微秒数和可选单位'
    ),
  },
  RANDOMEX: sharedDefinition(
    'RANDOMEX 分子 分母',
    ['分子', '分母'],
    '按分子/分母概率进行随机检测'
  ),
  RANGEHARMEX: {
    GOM: definition(
      'RangeHarmEx X Y 范围 伤害 效果 效果值 攻击归属 目标类型 触发串 特效串',
      [
        'X', 'Y', '范围', '基础伤害', '附加效果', '附加效果值', '攻击归属标记',
        '目标类型', '触发选项|触发几率|物理攻击', 'WIL|图片|张数|速度|绘制模式',
      ],
      '按GOM十参数扩展格式造成范围伤害并控制触发'
    ),
    GEE: definition(
      'RangeHarmEx X Y 范围 伤害 效果 效果值 状态抗性 目标类型 触发选项 触发几率 WIL 图片 张数 速度 绘制模式 物理攻击',
      [
        'X', 'Y', '范围', '基础伤害', '附加效果', '附加效果值', '状态抗性检测',
        '目标类型', '触发选项', '触发几率', 'WIL', '开始图片', '播放张数',
        '播放速度', '透明绘制', '物理属性攻击',
      ],
      '按翎风十六参数扩展格式造成范围伤害并控制触发'
    ),
  },
  REMOVELISTBYCONTENT: {
    GOM: definition(
      'RemoveListByContent 列表变量 元素内容',
      ['列表变量', '元素内容'],
      '按内容删除列表元素'
    ),
    GEE: definition(
      'RemoveListByContent 列表变量 元素内容 [区分大小写]',
      ['列表变量', '元素内容', '[区分大小写:0否/1是]'],
      '按内容和大小写模式删除列表元素'
    ),
  },
  REPLACELISTBYINDEX: sharedDefinition(
    'ReplaceListByIndex 列表变量 新值 下标',
    ['列表变量', '替换值', '数组下标'],
    '替换列表指定下标的元素'
  ),
  SETBODYCOLOR: {
    GOM: definition(
      'SetBodyColor 颜色 [时间秒]',
      ['颜色(0-255；255清除)', '[持续时间秒]'],
      '设置GOM人物身体颜色'
    ),
    GEE: definition(
      'SetBodyColor 颜色 [时间秒] [颜色类型]',
      ['颜色(1-255)', '[持续时间秒:0为在线有效]', '[颜色类型:0指定颜色/1转生变色]'],
      '设置翎风人物身体颜色或转生变色'
    ),
  },
  SETCLIENTBUFF: {
    GOM: definition(
      'SetClientBuff WIL 槽位(1-100) 图片 倒计时 文字 X Y [特效] [位置] [重排序]',
      [
        'WIL序号', '槽位(1-100)', '图片序号', '倒计时(>0计时/-1按钮/-2永久)',
        '文字备注', 'X偏移', 'Y偏移', '[附加特效]', '[位置模式]', '[重排序]',
      ],
      '设置GOM客户端BUFF图标'
    ),
    GEE: definition(
      'SetClientBuff WIL 槽位(1-200) 图片 倒计时 X Y 文字',
      [
        'WIL序号', '槽位(1-200)', '图片序号', '倒计时(-1按钮/>0计时)',
        'X坐标', 'Y坐标', '文字备注',
      ],
      '设置翎风客户端BUFF图标'
    ),
  },
  SETOFFTIMEREX: sharedDefinition(
    'SETOFFTIMEREX 索引(0-9)',
    ['定时器索引(0-9)'],
    '停止毫秒级个人定时器'
  ),
  SETONTIMEREX: sharedDefinition(
    'SETONTIMEREX 索引(0-9) 间隔毫秒 [执行次数]',
    ['定时器索引(0-9)', '间隔毫秒', '[执行次数:0或留空为无限]'],
    '启动毫秒级个人定时器'
  ),
  SETRANGEMONADDBYTE: sharedDefinition(
    'SetRangeMonAddByte 地图 X Y 范围 怪物名 标识号 值 [有效时间]',
    ['地图', 'X', 'Y', '范围', '怪物名(*为全部)', '标识号(0-9)', '值(0-255)', '[有效时间秒]'],
    '批量设置范围内怪物的临时字节标识'
  ),
  SETSHADOWSHOW: {
    GOM: {
      ...definition(
        'SetShadowShow 开关 有效时间',
        ['开关(1开启/0关闭)', '有效时间秒(0在线一直生效)'],
        '开启或关闭人物跑步幻影效果'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'SetShadowShow 开关 有效时间',
        ['开关(1开启/0关闭)', '有效时间秒(0在线一直生效)'],
        '开启或关闭人物或英雄的跑步幻影效果'
      ),
      aliases: ['H.SetShadowShow'],
      minArgs: 2,
      maxArgs: 2,
    },
  },
  SHOWPHANTOM: {
    GOM: {
      ...definition(
        'SHOWPHANTOM 占位1 占位2 占位3 占位4 占位5 透明度 占位7 占位8 时间 占位10',
        [
          '占位1(任意非空字符)', '占位2(任意非空字符)', '占位3(任意非空字符)',
          '占位4(任意非空字符)', '占位5(任意非空字符)', '透明度(0-255)',
          '占位7(任意非空字符)', '占位8(任意非空字符)', '显示时间秒',
          '占位10(任意非空字符)',
        ],
        '按GOM十参数格式显示人物放大虚影'
      ),
      minArgs: 10,
      maxArgs: 10,
    },
    GEE: {
      ...definition(
        'SHOWPHANTOM 透明度 显示时间',
        ['透明度(0-255)', '显示时间秒'],
        '按翎风两参数格式显示人物放大虚影'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  SHOWPROGRESSBARDLG: {
    GOM: {
      ...definition(
        'SHOWPROGRESSBARDLG 时间 完成标签 提示 中断模式 中断标签',
        ['时间秒', '完成触发标签', '提示信息', '动作中断(0否/1是)', '中断触发标签'],
        '显示GOM默认采集进度条'
      ),
      minArgs: 5,
      maxArgs: 5,
    },
    GEE: {
      ...definition(
        'SHOWPROGRESSBARDLG 时间 完成标签 提示 中断模式 中断标签 [开启自定义素材] [背景WZL] [背景图] [进度WZL] [进度图] [文字偏移] [进度条偏移]',
        [
          '时间秒', '完成触发标签', '提示信息', '动作中断(0否/1是)', '中断触发标签',
          '[开启自定义素材]', '[背景WZL]', '[背景图]', '[进度WZL]', '[进度图]',
          '[文字偏移]', '[进度条偏移]',
        ],
        '显示翎风采集进度条并可使用自定义素材'
      ),
      minArgs: 5,
      maxArgs: 12,
    },
  },
  SORTHUMVARTOLIST: {
    GOM: definition(
      'SortHumVarToList 变量名 保存路径 排序模式 [名字路径]',
      ['变量名', '保存路径', '排序模式(0升/1降)', '[只保存人物名的路径]'],
      '排序在线人物自定义变量'
    ),
    GEE: definition(
      'SortHumVarToList 变量类型 变量名 保存路径 排序模式 [名字路径]',
      ['变量类型(HUMAN/GUILD/GLOBAL)', '变量名', '保存路径', '排序模式(0升/1降)', '[只保存人物名的路径]'],
      '按变量类型排序在线人物自定义变量'
    ),
  },
  STOPTAKEOFF: {
    GOM: definition(
      'StopTakeOff 1',
      ['固定参数1'],
      '在取下装备前触发中中止取下'
    ),
    GEE: definition(
      'StopTakeOff',
      [],
      '在取下装备前触发中中止取下'
    ),
  },
  STOPTAKEON: {
    GOM: definition(
      'StopTakeOn 1',
      ['固定参数1'],
      '在穿戴装备前触发中中止穿戴'
    ),
    GEE: definition(
      'StopTakeOn',
      [],
      '在穿戴装备前触发中中止穿戴'
    ),
  },
  TAKEW: {
    GOM: {
      ...definition(
        'TakeW 物品名称 数量 | TakeW 装备位置',
        ['物品名称或装备位置', '[数量:按物品名称回收时使用]'],
        'GOM支持按名称和数量回收，也支持仅按装备位置回收'
      ),
      minArgs: 1,
      maxArgs: 2,
      snippet: 'TakeW ${1:物品名称} ${2:数量}',
    },
    GEE: {
      ...definition(
        'TakeW 物品名称 [数量]',
        ['物品名称', '[数量]'],
        '从翎风人物身上回收指定物品'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
  },
  TAKEOFFITEM: {
    GOM: {
      ...definition(
        'TakeOffItem 位置',
        ['装备位置(0-28/30-52/71-120)'],
        '取下GOM人物指定位置的装备'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
    GEE: {
      ...definition(
        'TakeOffItem 位置',
        ['装备位置(0-12)'],
        '取下翎风人物指定位置的装备'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  TESTSTATUS: {
    GOM: definition(
      'TestStatus 状态类型 时间 [提示]',
      ['状态类型', '时间(-1清空全部颜色)', '[提示:0否/1是]'],
      '改变或清除GOM人物状态颜色'
    ),
    GEE: definition(
      'TestStatus 状态类型 时间',
      ['状态类型', '时间(0清空全部颜色)'],
      '改变或清除翎风人物状态颜色'
    ),
  },
  TEXTCONCAT: sharedDefinition(
    'TEXTCONCAT 结果变量 字符串片段...',
    ['结果变量', '一个或多个待拼接字符串片段...'],
    '把后续字符串片段依次拼接并写入结果变量'
  ),
  CHECKBAGGAGE: {
    GOM: {
      ...definition('CHECKBAGGAGE', [], '检测背包是否已经装满'),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition('CHECKBAGGAGE', [], '检测背包是否已经装满'),
      minArgs: 0,
      maxArgs: 0,
    },
  },
  CHECKCONTAINSTEXT: sharedDefinition(
    'CheckContainsText 原字符串 待包含字符串',
    ['原字符串', '待包含字符串'],
    '检测第一个字符串是否包含第二个字符串'
  ),
  CHECKDC: sharedDefinition(
    'CHECKDC 下限操作符 下限值 上限操作符 上限值',
    ['下限操作符(<,>,=)', '攻击下限值', '上限操作符(<,>,=)', '攻击上限值'],
    '同时检测人物攻击力下限和上限'
  ),
  CHECKFOUNDRYITEM: sharedDefinition(
    'CheckFoundryItem 合成物品名称',
    ['合成物品名称'],
    '检测背包中的材料是否满足该铸造物品配方'
  ),
  CHECKHITMONNAME: {
    GOM: definition(
      'CHECKHITMONNAME 怪物名称',
      ['当前攻击目标的怪物名称'],
      '检测当前攻击目标名称，可与CheckFirstBlood组合使用'
    ),
    GEE: definition(
      'CHECKHITMONNAME 怪物名称',
      ['当前攻击目标的怪物名称'],
      '检测当前正在攻击的怪物名称'
    ),
  },
  CHECKHP: sharedDefinition(
    'CHECKHP 下限操作符 下限值 上限操作符 上限值',
    ['下限操作符(<,>,=)', 'HP下限值', '上限操作符(<,>,=)', 'HP上限值'],
    '同时检测人物HP下限和上限'
  ),
  CHECKITEMNAMECOLOR: sharedDefinition(
    'CheckItemNameColor 装备位置 颜色',
    ['装备位置(0-13)', '名称颜色(0-255)'],
    '检测指定位置装备的名称颜色'
  ),
  CHECKITEMTYPE: {
    GOM: definition(
      'CHECKITEMTYPE 物品位置 物品类型',
      ['物品位置(0-18/30-41)', '物品类型(StdMode)'],
      '检测GOM人物指定穿戴位置的物品类型'
    ),
    GEE: definition(
      'CHECKITEMTYPE 物品位置 物品类型',
      ['物品位置(-1/0-25/30-35/40-51/BOXITEM0-7)', '物品类型(StdMode)'],
      '检测翎风人物、升级框或OK框指定位置的物品类型'
    ),
  },
  CHECKMC: sharedDefinition(
    'CHECKMC 下限操作符 下限值 上限操作符 上限值',
    ['下限操作符(<,>,=)', '魔法下限值', '上限操作符(<,>,=)', '魔法上限值'],
    '同时检测人物魔法下限和上限'
  ),
  CHECKMONMAP: {
    GOM: {
      ...definition(
        'CheckMonMap 地图号 数量',
        ['地图号', '怪物数量'],
        '检测GOM指定地图的怪物数量'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'CheckMonMap 地图号 数量 [排除宝宝]',
        ['地图号', '怪物数量', '[排除宝宝:0/空包含，1排除]'],
        '检测翎风指定地图的怪物数量，可选择排除宝宝'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  CHECKMP: sharedDefinition(
    'CHECKMP 下限操作符 下限值 上限操作符 上限值',
    ['下限操作符(<,>,=)', 'MP下限值', '上限操作符(<,>,=)', 'MP上限值'],
    '同时检测人物MP下限和上限'
  ),
  CHECKONLINE: {
    GOM: {
      ...definition(
        'CheckOnline',
        [],
        '检测当前脚本对象是否在线；可使用H.、角色名.或字符串变量.前缀指定对象'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'CheckOnline 人物名称',
        ['人物名称'],
        '检测指定翎风人物是否在线'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  CHECKSC: sharedDefinition(
    'CHECKSC 下限操作符 下限值 上限操作符 上限值',
    ['下限操作符(<,>,=)', '道术下限值', '上限操作符(<,>,=)', '道术上限值'],
    '同时检测人物道术下限和上限'
  ),
  CHECKSLAVENAME: {
    GOM: {
      ...definition(
        'CHECKSLAVENAME 宝宝名称 [数量变量]',
        ['宝宝名称', '[数量变量]'],
        '检测指定名字的宝宝；可把同名宝宝数量写入变量'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'CHECKSLAVENAME 宝宝名称',
        ['宝宝名称'],
        '检测是否存在指定名字的宝宝'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  AUTOTAKEONITEM: {
    GOM: {
      ...definition(
        'AutoTakeOnItem 装备名称 装备位置',
        ['装备名称', '装备位置'],
        '把GOM背包中的指定装备自动穿到目标位置'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'AutoTakeOnItem 装备名称 装备位置',
        ['装备名称', '装备位置(0-12)'],
        '把翎风背包中的指定装备自动穿到目标位置'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  CHANGEBODYSIZE: {
    GOM: {
      ...definition(
        'ChangeBodySize 体型百分比 有效时间 宝宝名称',
        ['体型百分比(1-255，100恢复默认)', '有效时间', '宝宝名称(*为全部)'],
        '修改GOM宝宝体型大小'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'ChangeBodySize 体型百分比 [有效时间]',
        ['体型百分比(1-255，100恢复默认)', '[有效时间秒:0/空不限时]'],
        '修改翎风人物或英雄体型；宝宝应使用ChangeSlaveBodySize'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
  },
  DEC: {
    GOM: {
      ...definition(
        'DEC 变量 值 [字符串位置参数]',
        ['变量', '减数/待删除内容/起始位置', '[字符串位置参数]'],
        '变量自减或删除字符串内容；GOM帮助的DEC S2 1 3示例结果为“引擎M2”'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'DEC 变量 值 [字符串位置参数]',
        ['变量', '减数/待删除内容/起始位置', '[字符串位置参数]'],
        '变量自减或删除字符串内容；翎风帮助的DEC S2 1 3示例结果为“引擎”'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  KILLCALLMOB: {
    GOM: {
      ...definition(
        'KillCallMob 宝宝名称 [数量] [处理方式]',
        ['宝宝名称', '[数量]', '[处理方式:0杀死并触发脚本/1直接消失]'],
        '杀死或直接清除GOM人物的指定宝宝'
      ),
      minArgs: 1,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'KillCallMob 宝宝名称 [数量] [清尸体]',
        ['宝宝名称', '[数量]', '[清尸体:0/空不清，1清除]'],
        '杀死翎风人物的指定宝宝并可控制是否清除尸体'
      ),
      minArgs: 1,
      maxArgs: 3,
    },
  },
  LINKPICKUPITEM: {
    GOM: {
      ...definition(
        'LINKPICKUPITEM',
        [],
        '关联当前掉落、拾取或取下的物品；一键或站位拾取后引擎会自动刷新'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'LINKPICKUPITEM',
        [],
        '关联当前拾取物品；修改属性后需使用UpdateItem -1刷新'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
  },
  OPENWEBSITE: {
    GOM: {
      ...definition(
        'OpenWebSite 网站 [窗口宽度] [窗口高度]',
        ['网站地址', '[窗口宽度]', '[窗口高度]'],
        '在GOM客户端内打开网页，可指定窗口大小'
      ),
      minArgs: 1,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'OpenWebSite 网站',
        ['网站地址'],
        '在翎风客户端内打开网页'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  READCONFIGFILEITEM: {
    GOM: {
      ...definition(
        'ReadConfigFileItem 文件 区段 配置名 结果变量 [FAST]',
        ['文件路径', '区段', '配置名', '结果变量', '[FAST高速实时模式]'],
        '读取GOM INI配置项，支持完整绝对路径和FAST模式'
      ),
      minArgs: 4,
      maxArgs: 5,
    },
    GEE: {
      ...definition(
        'ReadConfigFileItem 文件 区段 配置名 结果变量 [绝对路径]',
        ['文件路径', '区段', '配置名', '结果变量', '[绝对路径:0/空相对，1绝对]'],
        '读取翎风INI配置项，可用末尾参数选择绝对路径'
      ),
      minArgs: 4,
      maxArgs: 5,
    },
  },
  REPAIRWALL: {
    GOM: {
      ...definition(
        'RepairWall 城墙位置',
        ['城墙位置(1左/2中/3右)'],
        '修理GOM沙巴克城墙，仅攻城结束后可用'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
    GEE: {
      ...definition(
        'RepairWall 城墙位置',
        ['城墙位置(1/2/3)'],
        '修理翎风沙巴克城墙，帮助说明可在任意时间使用'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  SENDTOPCHATBOARDMSG: {
    GOM: {
      ...definition(
        'SENDTOPCHATBOARDMSG 模式 字体颜色 背景颜色 时间 消息 [隐藏人物名]',
        [
          '模式(0全服/1自己/2跨服)', '字体颜色', '背景颜色', '时间秒',
          '消息', '[隐藏人物名:0显示/1隐藏]',
        ],
        '发送GOM聊天框固顶消息，支持自己、全服和跨服模式'
      ),
      minArgs: 5,
      maxArgs: 6,
    },
    GEE: {
      ...definition(
        'SENDTOPCHATBOARDMSG 模式 字体颜色 背景颜色 时间 消息',
        ['模式(帮助示例为0)', '字体颜色', '背景颜色', '时间秒', '消息'],
        '发送翎风聊天框固顶消息，消息内容支持点击脚本链接'
      ),
      minArgs: 5,
      maxArgs: 5,
    },
  },
  SETHUMATTACKMODE: {
    GOM: {
      ...definition(
        'SetHumAttackMode 攻击模式 时间',
        ['攻击模式(0-7)', '时间秒'],
        '在指定时间内强制GOM人物的攻击模式'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'SetHumAttackMode 攻击模式 时间 [地图号]',
        ['攻击模式(0-7)', '时间秒', '[地图号:*为任意地图]'],
        '在指定地图和时间内强制翎风人物的攻击模式'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  SUM: {
    GOM: {
      ...definition(
        'SUM 变量A [变量B]',
        ['变量A', '[变量B]'],
        '连续求和：双参数计算A+B，后续单参数继续把该变量加入当前X结果'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'SUM 变量A [变量B]',
        ['变量A', '[变量B]'],
        '连续求和：双参数计算A+B，后续单参数继续把该变量加入当前X结果'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
  },
  UNALLOWITEMINTOBOX: {
    GOM: {
      ...definition(
        'UNALLOWITEMINTOBOX',
        [],
        '在GOM的@ItemIntoBoxX触发中阻止物品放入OK框'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'UNALLOWITEMINTOBOX',
        [],
        '在翎风的@ItemIntoBoxX触发中阻止物品放入OK框'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
  },
  WRITECONFIGFILEITEM: {
    GOM: {
      ...definition(
        'WriteConfigFileItem 文件 区段 配置名 值 [FAST]',
        ['文件路径', '区段', '配置名', '值', '[FAST高速实时模式]'],
        '写入GOM INI配置项，支持完整绝对路径和FAST模式'
      ),
      minArgs: 4,
      maxArgs: 5,
    },
    GEE: {
      ...definition(
        'WriteConfigFileItem 文件 区段 配置名 值 [绝对路径]',
        ['文件路径', '区段', '配置名', '值', '[绝对路径:0/空相对，1绝对]'],
        '写入翎风INI配置项，可用末尾参数选择绝对路径'
      ),
      minArgs: 4,
      maxArgs: 5,
    },
  },
  CHECKUSEITEM: {
    GOM: {
      ...definition(
        'CHECKUSEITEM 物品位置(0-28或30-47)',
        ['物品位置(0-28或30-47)'],
        '检测GOM人物指定装备位置是否穿戴物品'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
    GEE: {
      ...definition(
        'CHECKUSEITEM 物品位置(0-29、30-35或40-51)',
        ['物品位置(0-29、30-35或40-51)'],
        '检测翎风人物指定装备位置是否穿戴物品'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  COMPARETEXT: {
    GOM: {
      ...definition(
        'CompareText 字符串1 字符串2',
        ['字符串1', '字符串2'],
        '比较两个字符串是否相同，不区分大小写'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'CompareText 字符串1 字符串2',
        ['字符串1', '字符串2'],
        '比较两个字符串是否相同；翎风帮助未说明大小写规则'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  CHECKMAPDUMMYCOUNT: sharedDefinition(
    'CHECKMAPDUMMYCOUNT 地图 操作符 数量',
    ['地图', '操作符(>,<,=)', '数量'],
    '检测指定地图的假人数量'
  ),
  CHECKRANGEHUMCOUNT: {
    GOM: {
      ...definition(
        'CHECKRANGEHUMCOUNT 地图 X Y 范围 操作符 数量 [包含假人] [包含管理员]',
        ['地图(SELF为当前地图)', 'X(0为当前坐标)', 'Y(0为当前坐标)', '范围', '操作符(>,<,=)', '数量', '[包含假人]', '[包含管理员]'],
        '检测GOM指定范围内的人物数量，可选择是否计入假人和管理员'
      ),
      minArgs: 6,
      maxArgs: 8,
    },
    GEE: {
      ...definition(
        'CHECKRANGEHUMCOUNT 地图 X Y 范围 操作符 数量',
        ['地图(SELF为当前地图)', 'X(0为当前坐标)', 'Y(0为当前坐标)', '范围', '操作符(>,<,=)', '数量'],
        '检测翎风指定范围内的人物数量'
      ),
      minArgs: 6,
      maxArgs: 6,
    },
  },
  DIV: {
    GOM: {
      ...definition(
        'DIV 结果变量 被除数 除数',
        ['结果变量', '被除数', '除数'],
        '除法计算：结果变量=被除数/除数'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'DIV 目标变量 数值 [除数]',
        ['目标变量', '数值', '[除数]'],
        '两参数时目标变量自身除以数值；三参数时目标变量=数值/除数，不支持字符串变量'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  MUL: {
    GOM: {
      ...definition(
        'MUL 结果变量 乘数1 乘数2',
        ['结果变量', '乘数1', '乘数2'],
        '乘法计算：结果变量=乘数1*乘数2'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'MUL 目标变量 数值 [乘数]',
        ['目标变量', '数值', '[乘数]'],
        '两参数时目标变量自身乘以数值；三参数时目标变量=数值*乘数，不支持字符串变量'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  CHECKNATIONCREDIT: {
    GOM: {
      ...definition(
        'CheckNationCredit 操作符 值',
        ['操作符', '值'],
        '检测人物国家荣誉值'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'CheckNationCredit',
        [],
        '翎风帮助确认存在该指令，但未公开完整参数格式'
      ),
      completionVerified: false,
    },
  },
  SENDTOPMSG: {
    GOM: {
      ...definition(
        'SENDTOPMSG',
        [],
        'GOM帮助确认存在该顶部消息指令，但未公开完整参数格式'
      ),
      completionVerified: false,
    },
    GEE: {
      ...definition(
        'SENDTOPMSG',
        [],
        '翎风帮助确认存在该顶部消息指令，但未公开完整参数格式'
      ),
      completionVerified: false,
    },
  },
  CHECKPKFLAG: {
    GOM: {
      ...definition(
        'CheckPKFlag',
        [],
        '检测人物是否处于主动PK的灰名状态；帮助未公开参数格式'
      ),
      completionVerified: false,
    },
  },
  MEBABYHP: {
    GOM: {
      ...definition(
        'MEBabyHP',
        [],
        '恢复宝宝血量；当前帮助中的详情链接缺失，未能核实参数格式'
      ),
      completionVerified: false,
    },
  },
  MOBDOTAUNT: {
    GOM: {
      ...definition(
        'MOBDOTAUNT',
        [],
        '让宝宝执行嘲讽；当前帮助中的详情链接缺失，未能核实参数格式'
      ),
      completionVerified: false,
    },
  },
  CHECKITEMDURA: {
    GOM: {
      ...definition(
        'CheckItemDura 位置(0-12) 操作符 持久 [模式]',
        ['位置(0-12)', '操作符(>,=,<)', '持久(1-65000)', '[模式:0下限/1上限，默认0]'],
        '检测GOM人物指定位置物品的持久'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'CheckItemDura 装备位置 操作符 持久 [模式]',
        ['装备位置', '操作符(>,=,<)', '持久(1-65000)', '[模式:0下限/1上限，默认0]'],
        '检测翎风人物指定位置物品的持久；当前更新记录说明支持全部装备位置'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
  },
  CHECKKILLMONNAME: {
    ...sharedDefinition(
      'CheckKillMonName 怪物名字 [检测后清除]',
      ['怪物名字', '[检测后清除:0不清除/1清除，默认0]'],
      '检测人物最近杀死的怪物名字'
    ),
    GOM: {
      ...sharedDefinition(
        'CheckKillMonName 怪物名字 [检测后清除]',
        ['怪物名字', '[检测后清除:0不清除/1清除，默认0]'],
        '检测人物最近杀死的怪物名字'
      ).GOM,
      minArgs: 1,
      maxArgs: 2,
    },
    GEE: {
      ...sharedDefinition(
        'CheckKillMonName 怪物名字 [检测后清除]',
        ['怪物名字', '[检测后清除:0不清除/1清除，默认0]'],
        '检测人物最近杀死的怪物名字'
      ).GEE,
      minArgs: 1,
      maxArgs: 2,
    },
  },
  DAYOFMONTH: {
    GOM: {
      ...definition(
        'DAYOFMONTH 起始日 [结束日]',
        ['起始日(1-31)', '[结束日(1-31)]'],
        '检测当前日期是否为指定日或位于指定日期区间'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'DAYOFMONTH 起始日 [结束日]',
        ['起始日(1-31)', '[结束日(1-31)]'],
        '检测当前日期是否为指定日或位于指定日期区间'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
  },
  MONTHOFYEAR: {
    GOM: {
      ...definition(
        'MONTHOFYEAR 起始月 [结束月]',
        ['起始月(1-12)', '[结束月(1-12)]'],
        '检测当前月份是否为指定月或位于指定月份区间'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'MONTHOFYEAR 起始月 [结束月]',
        ['起始月(1-12)', '[结束月(1-12)]'],
        '检测当前月份是否为指定月或位于指定月份区间'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
  },
  ADDFUNITEMDURA: {
    GOM: {
      ...definition(
        'AddFunItemDura [持久值]',
        ['[持久值:省略时增加1]'],
        '增加当前限次使用物品的剩余持久或次数'
      ),
      minArgs: 0,
      maxArgs: 1,
    },
    GEE: {
      ...definition(
        'AddFunItemDura [持久值]',
        ['[持久值:省略时增加1]'],
        '增加当前限次使用物品的剩余持久或次数'
      ),
      minArgs: 0,
      maxArgs: 1,
    },
  },
  ADDSKILL: {
    GOM: {
      ...definition(
        'ADDSKILL 技能名称',
        ['技能名称'],
        '为GOM人物增加指定技能'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
    GEE: {
      ...definition(
        'ADDSKILL 技能名称',
        ['技能名称'],
        '为翎风人物增加指定技能'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  ADDMAPROUTE: {
    GOM: {
      ...definition(
        'AddMapRoute 动态链接标识 连接地图 X Y',
        ['动态链接标识(1-65535)', '连接地图', 'X', 'Y'],
        '增加GOM地图动态链接点，需配合SetMapRoute'
      ),
      minArgs: 4,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'AddMapRoute',
        [],
        '翎风帮助只确认DelMapRoute可删除由AddMapRoute建立的链接，未提供AddMapRoute参数格式'
      ),
      completionVerified: false,
    },
  },
  CALCVAR: {
    GOM: {
      ...definition(
        'CALCVAR HUMAN 变量 操作符 值',
        ['HUMAN', '变量', '操作符', '值'],
        '计算GOM人物自定义变量'
      ),
      minArgs: 4,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'CALCVAR 作用域 变量 操作符 值',
        ['作用域(HUMAN/GUILD)', '变量', '操作符', '值'],
        '计算翎风人物或行会自定义变量'
      ),
      minArgs: 4,
      maxArgs: 4,
    },
  },
  CHANGEDRESSEFFECT: {
    GOM: {
      ...definition(
        'ChangeDressEffect 特效编号 [绘制方式]',
        ['特效编号', '[绘制方式:0特效绘制/1普通绘制，默认0]'],
        '改变GOM人物衣服翅膀效果'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'ChangeDressEffect 特效编号 [绘制方式]',
        ['特效编号', '[绘制方式:0特效绘制/1普通绘制，默认0]'],
        '改变并保存翎风人物衣服翅膀效果'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
  },
  CHANGEITEMNAME: {
    GOM: {
      ...definition(
        'ChangeItemName 物品位置(0-28或30-47) 名字',
        ['物品位置(0-28或30-47)', '名字'],
        '修改GOM指定装备位置的物品名字'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'ChangeItemName 物品位置(0-51) 名字',
        ['物品位置(0-51)', '名字'],
        '修改翎风指定装备位置的物品名字'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  CHANGEMODE: {
    GOM: {
      ...definition(
        'CHANGEMODE 模式类型(1-4) 开关',
        ['模式类型(1管理/2无敌/3隐身/4记者)', '开关(0关/1开)'],
        '设置GOM人物当前模式'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'CHANGEMODE 模式类型(1-3) 开关',
        ['模式类型(1管理/2无敌/3隐身)', '开关(0关/1开)'],
        '设置翎风人物当前模式'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  CLEARDELAYGOTO: {
    GOM: {
      ...definition(
        'CLEARDELAYGOTO [类型]',
        ['[类型:省略时清除DelayGoto，1清除SendCenterMsg倒计时]'],
        '清除延迟跳转或公告倒计时'
      ),
      minArgs: 0,
      maxArgs: 1,
    },
    GEE: {
      ...definition(
        'CLEARDELAYGOTO [类型]',
        ['[类型:省略时清除DelayGoto，1清除SendCenterMsg倒计时]'],
        '清除延迟跳转或公告倒计时'
      ),
      minArgs: 0,
      maxArgs: 1,
    },
  },
  CLEARITEMMAP: {
    GOM: {
      ...definition(
        'CLEARITEMMAP 地图 X Y 范围 [物品名称]',
        ['地图', 'X', 'Y', '范围', '[物品名称:*或省略表示全部]'],
        '清理GOM地图指定范围内的物品'
      ),
      minArgs: 4,
      maxArgs: 5,
    },
    GEE: {
      ...definition(
        'CLEARITEMMAP 地图 [X] [Y] [范围] [物品名称]',
        ['地图', '[X:0或空表示全图]', '[Y:0或空表示全图]', '[范围:0或空表示全图]', '[物品名称:*或省略表示全部]'],
        '清理翎风地图指定范围或整张地图的物品'
      ),
      minArgs: 1,
      maxArgs: 5,
    },
  },
  CREATEHERO: {
    GOM: {
      ...definition(
        'CREATEHERO 职业 性别',
        ['职业(0战士/1法师/2道士)', '性别(0男/1女)'],
        '创建GOM主将英雄'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'CREATEHERO 职业 性别',
        ['职业(0战士/1法师/2道士)', '性别(0男/1女)'],
        '创建翎风主将英雄'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  DELAYGOTO: {
    GOM: {
      ...definition(
        'DELAYGOTO 时间毫秒 @标签',
        ['时间毫秒', '@标签'],
        '延时跳转到GOM当前脚本标签'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'DELAYGOTO 时间毫秒 @标签 [换地图删除]',
        ['时间毫秒', '@标签', '[换地图删除:0/空不删除，1删除]'],
        '延时跳转到翎风当前脚本标签'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  DELCONFIGFILEITEM: {
    GOM: {
      ...definition(
        'DelConfigFileItem 文件 区段 配置名 [FAST]',
        ['文件', '区段', '配置名', '[FAST高速实时模式]'],
        '删除GOM INI配置项'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'DelConfigFileItem 文件 区段 配置名',
        ['文件', '区段', '配置名'],
        '删除翎风INI配置项'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
  },
  DELTEXTLIST: {
    GOM: {
      ...definition(
        'DelTextList 文件位置 字符串 [附加匹配字符串]',
        ['文件位置', '字符串', '[附加匹配字符串]'],
        '从GOM文本文件删除匹配字符串'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'DelTextList 文件位置 字符串 [附加匹配字符串] [绝对路径]',
        ['文件位置', '字符串', '[附加匹配字符串]', '[绝对路径:0否/1是]'],
        '从翎风文本文件删除匹配字符串，可指定绝对路径'
      ),
      minArgs: 2,
      maxArgs: 4,
    },
  },
  GETMAGICINFO: {
    GOM: {
      ...definition(
        'GetMagicInfo 技能名称 值类型(0-3) 变量',
        ['技能名称', '值类型(0等级/1强化等级/2技能点/3技能顺序)', '变量'],
        '获取GOM人物技能信息'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'GetMagicInfo 技能名称 值类型(0-2) 变量',
        ['技能名称', '值类型(0等级/1强化等级/2技能点)', '变量'],
        '获取翎风人物技能信息'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
  },
  GETUSERITEMNAME: {
    GOM: {
      ...definition(
        'GetUserItemName 位置 S变量索引',
        ['位置(0-12)', 'S变量索引(0-99)'],
        '获取GOM人物指定位置的装备名字'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'GetUserItemName 位置 S变量索引 [仅数据库名称]',
        ['位置(0-12)', 'S变量索引(0-99)', '[仅数据库名称:0以改名为准/1只取DB名称]'],
        '获取翎风人物指定位置的装备名字'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  GMEXECUTE: {
    GOM: {
      ...definition(
        'GMEXECUTE GM命令 [参数1] [参数2] [参数3] [参数4] [参数5] [参数6] [参数7]',
        ['GM命令', '[参数1]', '[参数2]', '[参数3]', '[参数4]', '[参数5]', '[参数6]', '[参数7]'],
        '在GOM脚本中执行GM命令'
      ),
      minArgs: 1,
      maxArgs: 8,
    },
    GEE: {
      ...definition(
        'GMEXECUTE GM命令 [参数1] [参数2] [参数3] [参数4] [参数5] [参数6] [参数7]',
        ['GM命令', '[参数1]', '[参数2]', '[参数3]', '[参数4]', '[参数5]', '[参数6]', '[参数7]'],
        '在翎风脚本中执行GM命令'
      ),
      minArgs: 1,
      maxArgs: 8,
    },
  },
  GUILDNOTICEMSG: {
    GOM: {
      ...definition(
        'GuildNoticeMsg 前景色 背景色 消息 [范围]',
        ['前景色', '背景色', '消息', '[范围:SELF/GROUP/NATIONAL/MAP，省略为全服]'],
        '发送GOM自定义颜色文字消息'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'GuildNoticeMsg 前景色 背景色 消息 [范围]',
        ['前景色', '背景色', '消息', '[范围:SELF/GROUP/GUILD/NATIONAL/MAP，省略为全服]'],
        '发送翎风自定义颜色文字消息'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
  },
  HIGHLEVELKILLMONFIXEXP: {
    GOM: {
      ...definition(
        'HighLevelKillMonFixExp 时间秒 [保存]',
        ['时间秒', '[保存:0/空不保存，1保存]'],
        '设置GOM高等级杀怪经验不衰减的时间'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'HighLevelKillMonFixExp 时间秒 [保存]',
        ['时间秒', '[保存:0/空不保存，1保存]'],
        '设置翎风高等级杀怪经验不衰减的时间'
      ),
      minArgs: 1,
      maxArgs: 2,
    },
  },
  INPUTINTEGER: {
    GOM: {
      ...definition(
        '@@INPUTINTEGER编号(提示文字)',
        ['编号', '[提示文字]'],
        'SAY对话中的整数输入链接，结果进入对应N变量并触发@INPUTINTEGER编号'
      ),
      kind: 'say',
      contexts: ['SAY'],
      completionEnabled: false,
    },
    GEE: {
      ...definition(
        '@@INPUTINTEGER编号(提示文字)',
        ['编号', '[提示文字]'],
        'SAY对话中的整数输入链接，结果进入对应N变量并触发@INPUTINTEGER编号'
      ),
      kind: 'say',
      contexts: ['SAY'],
      completionEnabled: false,
    },
  },
  INPUTSTRING: {
    GOM: {
      ...definition(
        '@@INPUTSTRING编号(提示文字)',
        ['编号', '[提示文字]'],
        'SAY对话中的字符串输入链接，结果进入对应S变量并触发@INPUTSTRING编号'
      ),
      kind: 'say',
      contexts: ['SAY'],
      completionEnabled: false,
    },
    GEE: {
      ...definition(
        '@@INPUTSTRING编号(提示文字)',
        ['编号', '[提示文字]'],
        'SAY对话中的字符串输入链接，结果进入对应S变量并触发@INPUTSTRING编号'
      ),
      kind: 'say',
      contexts: ['SAY'],
      completionEnabled: false,
    },
  },
  MAPMOVE: {
    GOM: {
      ...definition(
        'MAPMOVE 地图 X Y [范围]',
        ['地图', 'X', 'Y', '[范围:省略或0使用中心坐标]'],
        '将GOM人物传送到目标坐标或其随机范围'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'MAPMOVE 地图 X Y [范围]',
        ['地图', 'X', 'Y', '[范围:省略时使用指定坐标]'],
        '将翎风人物传送到目标坐标或其随机范围'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
  },
  OPENCLIENTDLG: {
    GOM: {
      ...definition(
        'OpenClientDlg 界面编号 坐标模式 X Y [地图编号] [地图显示名]',
        ['界面编号', '坐标模式(0不设置/1设置/2关闭)', 'X', 'Y', '[地图编号]', '[地图显示名]'],
        '打开GOM客户端界面；地图界面可指定地图编号和显示名'
      ),
      minArgs: 4,
      maxArgs: 6,
    },
    GEE: {
      ...definition(
        'OpenClientDlg 界面编号 坐标模式 X Y',
        ['界面编号', '坐标模式(0不设置/1设置)', 'X', 'Y'],
        '打开翎风客户端界面'
      ),
      minArgs: 4,
      maxArgs: 4,
    },
  },
  OPENUPGRADEDIALOG: {
    GOM: {
      ...definition(
        'OpenUpgradeDialog',
        [],
        '打开GOM宝石升级界面'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'OpenUpgradeDialog',
        [],
        '打开翎风宝石升级界面'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
  },
  RANDOMKILLMON: {
    GOM: {
      ...definition(
        'RandomKillMon 地图 怪物名字 数量 [不掉落物品]',
        ['地图(SELF为当前地图)', '怪物名字', '数量(1-255)', '[不掉落物品:0/空掉落，1不掉落]'],
        '随机杀死GOM地图中的指定怪物'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'RandomKillMon 地图 怪物名字 数量 [不掉落物品]',
        ['地图(SELF为当前地图)', '怪物名字', '数量(1-255)', '[不掉落物品:0/空掉落，1不掉落]'],
        '随机杀死翎风地图中的指定怪物'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
  },
  RECALCSLAVEABILITY: {
    GOM: {
      ...definition(
        'RecalcSlaveAbility [宝宝名]',
        ['[宝宝名:省略表示全部宝宝]'],
        '重新计算GOM指定或全部宝宝属性'
      ),
      minArgs: 0,
      maxArgs: 1,
    },
    GEE: {
      ...definition(
        'RecalcSlaveAbility [宝宝名]',
        ['[宝宝名:省略表示全部宝宝]'],
        '重新计算翎风指定或全部宝宝属性'
      ),
      minArgs: 0,
      maxArgs: 1,
    },
  },
  REPAIRALL: {
    GOM: {
      ...definition(
        'RepairAll',
        [],
        '检测并特修GOM人物全身装备，会自动扣除金币'
      ),
      kind: 'check',
      contexts: ['IF'],
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'RepairAll',
        [],
        '特修翎风人物全身装备；作为操作命令使用'
      ),
      kind: 'action',
      contexts: ['ACT'],
      minArgs: 0,
      maxArgs: 0,
    },
  },
  SAVEVAR: {
    GOM: {
      ...definition(
        'SAVEVAR HUMAN 变量 文件',
        ['HUMAN', '变量', '文件'],
        '保存GOM人物自定义变量到文件'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'SAVEVAR 作用域 变量 文件',
        ['作用域(HUMAN/GUILD)', '变量', '文件'],
        '保存翎风人物或行会自定义变量到文件'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
  },
  'SET [N]': {
    GOM: {
      ...definition(
        'SET [标识列表] 值',
        ['标识列表(1-1024，支持逗号与范围)', '值(0关闭/1开启/-1取反)'],
        '设置或取反一个或多个GOM个人标识'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'SET [标识列表] 值',
        ['标识列表(支持逗号与范围)', '值(0关闭/1开启/-1取反)'],
        '设置或取反一个或多个翎风个人标识'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  SETITEMSLIGHT: {
    GOM: {
      ...definition(
        'SetItemsLight 位置(0-12) 效果',
        ['位置(0-12)', '效果(0关闭/1效果1/2效果2)'],
        '设置GOM首饰发光效果'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'SetItemsLight 位置(0-12) 效果',
        ['位置(0-12)', '效果(0关闭、1-14或100-299发光效果)'],
        '设置翎风首饰发光效果'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  SKILLLEVEL: {
    GOM: {
      ...definition(
        'SKILLLEVEL 技能名称 调整符 等级 [强化技能]',
        ['技能名称', '调整符(+,-,=)', '等级', '[强化技能:0/空普通等级，1强化等级]'],
        '调整GOM人物技能等级'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
    GEE: {
      ...definition(
        'SKILLLEVEL 技能名称 调整符 等级 [强化技能]',
        ['技能名称', '调整符(+,-,=)', '等级', '[强化技能:0/空普通等级，1强化等级]'],
        '调整翎风人物技能等级'
      ),
      minArgs: 3,
      maxArgs: 4,
    },
  },
  THROWITEM: {
    GOM: {
      ...definition(
        'THROWITEM 地图 X Y 范围 物品 数量|时间 [掉落提示] [立即捡取] [仅自己或队伍] [叠加]',
        ['地图', 'X', 'Y', '范围', '物品', '数量|时间秒', '[掉落提示:0否/1是]', '[立即捡取:0否/1是]', '[仅自己或队伍:0所有人/1自己或队伍]', '[叠加:0/空不叠加，1叠加]'],
        '在GOM地图上放置物品'
      ),
      minArgs: 6,
      maxArgs: 10,
    },
    GEE: {
      ...definition(
        'THROWITEM 地图 X Y 范围 物品 数量|时间 [捡取条件] [不叠加]',
        ['地图', 'X', 'Y', '范围', '物品', '数量|时间秒', '[捡取条件:0/空等待，1所有人立即，2自己和队伍立即，3仅自己立即]', '[不叠加:0/空叠加，1不叠加]'],
        '在翎风地图上放置物品'
      ),
      minArgs: 6,
      maxArgs: 8,
    },
  },
  VAR: {
    GOM: {
      ...definition(
        'VAR Integer HUMAN 变量名',
        ['Integer', 'HUMAN', '变量名'],
        '声明GOM人物整数自定义变量'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'VAR Integer 作用域 变量名',
        ['Integer', '作用域(HUMAN/GUILD)', '变量名'],
        '声明翎风人物或行会整数自定义变量'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
  },
  TIMERECALL: {
    GOM: definition(
      'TIMERECALL 时间分钟 [换地图停止]',
      ['时间分钟', '[换地图停止:0否/1是]'],
      '设置GOM延时返回并可控制换图后停止'
    ),
    GEE: definition(
      'TIMERECALL 时间分钟',
      ['时间分钟'],
      '设置翎风延时返回'
    ),
  },
  WHILE: {
    GOM: definition(
      'WHILE 左值 操作符 右值',
      ['左值', '操作符(>,<,=,?)', '右值'],
      '开始GOM循环，需与ENDWHILE配对'
    ),
    GEE: definition(
      'WHILE 左值 操作符 右值',
      ['左值', '操作符(>,<,=)', '右值'],
      '开始翎风循环，需与ENDWHILE配对'
    ),
  },
});

Object.assign(variants, {
  CHECKHEROONLINE: {
    GOM: {
      ...definition(
        'CheckHeroOnline',
        [],
        '检测英雄是否已经出战'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'CheckHeroOnline',
        [],
        '检测英雄是否已经出战'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
  },
  CHECKUNDERWAR: {
    GOM: {
      ...definition(
        'CHECKUNDERWAR 城堡名称',
        ['城堡名称'],
        '检测指定城堡是否正在攻城'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
    GEE: {
      ...definition(
        'CHECKUNDERWAR 城堡名称',
        ['城堡名称'],
        '检测指定城堡是否正在攻城'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  CLEARHEROALLSKILL: {
    GOM: {
      ...definition(
        'ClearHeroAllSkill',
        [],
        '清除英雄的全部技能'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'ClearHeroAllSkill',
        [],
        '清除英雄的全部技能'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
  },
  ENDWHILE: {
    GOM: {
      ...definition(
        'EndWhile',
        [],
        '结束与WHILE配对的循环块'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
    GEE: {
      ...definition(
        'EndWhile',
        [],
        '结束与WHILE配对的循环块'
      ),
      minArgs: 0,
      maxArgs: 0,
    },
  },
  CHANGEBAGCOUNT: {
    GOM: {
      ...definition(
        'CHANGEBAGCOUNT 操作符 数量',
        ['操作符(+,-,=)', '数量(46-206)'],
        '调整GOM人物可用的包裹格子总数'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  CHANGECUSTOMITEMPROGRESSBARVALUE: {
    GOM: {
      ...definition(
        'ChangeCustomItemProgressBarValue 装备位置 进度条序号 值类型 操作符 值',
        [
          '装备位置(-1/0-28/30-47)',
          '进度条序号(0-1)',
          '值类型(0当前进度/1最大值/2等级)',
          '操作符(+,-,=)',
          '值',
        ],
        '修改GOM自定义装备进度条的数值'
      ),
      minArgs: 5,
      maxArgs: 5,
    },
  },
  CHANGESLAVENAMECOLOR: {
    GOM: {
      ...definition(
        'ChangeSlaveNameColor 宝宝名字 颜色',
        ['宝宝名字', '颜色(0-255)'],
        '修改人物宝宝的名字颜色'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'ChangeSlaveNameColor 宝宝名字 颜色',
        ['宝宝名字', '颜色(0-255)'],
        '修改人物宝宝的名字颜色'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  CHARPUSHED: {
    GOM: {
      ...definition(
        'CharPushed 方向 格数',
        ['方向(0-7)', '格数(1-20)'],
        '把GOM当前人物或英雄向指定方向击退'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  CHECKITEMBIND: {
    GOM: {
      ...definition(
        'CheckItemBind 装备位置',
        ['装备位置(-1/0-28/30-47)'],
        '检测GOM指定位置的物品是否已经绑定'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  CLEARVAR: {
    GOM: {
      ...definition(
        'CLEARVAR 起始变量 数量',
        ['起始变量', '连续清空数量'],
        '从指定变量开始连续清空变量'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
    GEE: {
      ...definition(
        'CLEARVAR 起始变量 数量',
        ['起始变量', '连续清空数量'],
        '从指定变量开始连续清空变量'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  CONFERTITLE: {
    GOM: {
      ...definition(
        'CONFERTITLE 称号名称',
        ['称号名称'],
        '授予GOM人物指定称号'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  DECODESECTIME: {
    GOM: {
      ...definition(
        'DecodeSecTime 秒数 完整结果变量 [省略结果变量]',
        ['秒数', '完整结果变量', '[省略结果变量]'],
        '把秒数转换为完整时间字符串，并可同时返回省略高位零单位的字符串'
      ),
      minArgs: 2,
      maxArgs: 3,
    },
  },
  DELGUILDMASTER: {
    GOM: {
      ...definition(
        'DelGuildMaster 行会名称 掌门人名称',
        ['行会名称', '掌门人名称'],
        '删除GOM行会的指定掌门人'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  DEPRIVETITLE: {
    GOM: {
      ...definition(
        'DEPRIVETITLE 称号名称',
        ['称号名称(ALL表示全部)'],
        '删除GOM人物的指定称号或全部称号'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  GETMAPHUMCOUNT: {
    GOM: {
      ...definition(
        'GetMapHumCount 地图编号 是否包含假人 返回变量',
        ['地图编号', '是否包含假人(0否/1是)', '返回变量'],
        '获取指定地图的人物数量'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'GetMapHumCount 地图编号 是否包含假人 返回变量',
        ['地图编号', '是否包含假人(0否/1是)', '返回变量'],
        '获取指定地图的人物数量'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
  },
  GETMAPROUTEINFO: {
    GOM: {
      ...definition(
        'GetMapRouteInfo 链接标识 查看方式 地图变量 X变量 Y变量',
        [
          '链接标识',
          '查看方式(0连接地图/1待连接地图)',
          '地图变量',
          'X变量',
          'Y变量',
        ],
        '获取动态地图链接一端的地图编号和坐标'
      ),
      minArgs: 5,
      maxArgs: 5,
    },
    GEE: {
      ...definition(
        'GetMapRouteInfo 链接标识 查看方式 地图变量 X变量 Y变量',
        [
          '链接标识',
          '查看方式(0连接地图/1待连接地图)',
          '地图变量',
          'X变量',
          'Y变量',
        ],
        '获取动态地图链接一端的地图编号和坐标'
      ),
      minArgs: 5,
      maxArgs: 5,
    },
  },
  GETNOTDROPITEMCOUNT: {
    GOM: {
      ...definition(
        'GetNotDropItemCount 计数器 返回变量',
        ['计数器(0全部/1背包/2身上)', '返回变量'],
        '获取GOM人物死亡不掉装备的剩余次数'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  MONCLEAR: {
    GOM: {
      ...definition(
        'MONCLEAR 地图',
        ['地图'],
        '清除指定地图中的怪物'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
    GEE: {
      ...definition(
        'MONCLEAR 地图',
        ['地图'],
        '清除指定地图中的怪物'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
  MONGEN: {
    GOM: {
      ...definition(
        'MONGEN 怪物名称 数量 时间',
        ['怪物名称', '数量', '刷新时间'],
        '按刷怪脚本参数生成怪物'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
    GEE: {
      ...definition(
        'MONGEN 怪物名称 数量 时间',
        ['怪物名称', '数量', '刷新时间'],
        '按刷怪脚本参数生成怪物'
      ),
      minArgs: 3,
      maxArgs: 3,
    },
  },
  RECALLPICKUPITEMSPIRIT: {
    GOM: {
      ...definition(
        'RecallPickUpItemSpirit 怪物名称 捡取速度 守护范围 有效时间',
        [
          '怪物名称',
          '捡取速度(100-1000)',
          '守护范围(最小20)',
          '有效时间分钟',
        ],
        '召唤GOM捡取精灵'
      ),
      minArgs: 4,
      maxArgs: 4,
    },
  },
  REDENVELOPESAVETOLIST: {
    GOM: {
      ...definition(
        'RedEnvelopeSaveToList 导出路径 总金额 模式 数量 最小金额 最大金额',
        [
          '导出文本路径',
          '红包总金额',
          '模式(0平均/1随机)',
          '红包数量',
          '最小红包(随机模式)',
          '最大红包(随机模式，0为自动)',
        ],
        '生成GOM红包金额列表并保存到文本'
      ),
      minArgs: 6,
      maxArgs: 6,
    },
  },
  SENDMOVECENTERMSG: {
    GOM: {
      ...definition(
        'SendMoveCenterMsg 前景色 背景色 消息 模式 时间 位置 Y 背景参数 素材参数 消息ID',
        [
          '前景色',
          '背景色',
          '消息',
          '模式',
          '显示时间秒',
          '显示位置(0-4)',
          'Y坐标',
          '背景参数',
          '素材参数',
          '消息ID',
        ],
        '发送GOM屏幕横向滚动特效消息'
      ),
      minArgs: 10,
      maxArgs: 10,
    },
  },
  SENDMULTILINEMSG: {
    GOM: {
      ...definition(
        'SendMultiLineMsg 前景色 背景色 消息 模式 时间 位置 Y 绘制背景 背景透明度 消息ID',
        [
          '前景色',
          '背景色',
          '消息',
          '模式',
          '显示时间秒',
          '显示位置(0-4)',
          'Y坐标',
          '绘制背景(0否/1是)',
          '背景透明度(0-255)',
          '消息ID',
        ],
        '发送GOM屏幕多行文字消息'
      ),
      minArgs: 10,
      maxArgs: 10,
    },
  },
  SETITEMBIND: {
    GOM: {
      ...definition(
        'SetItemBind 装备位置 绑定状态',
        ['装备位置(-1/0-28/30-47)', '绑定状态(0否/1是)'],
        '设置GOM指定位置物品的绑定状态'
      ),
      minArgs: 2,
      maxArgs: 2,
    },
  },
  SETSHOPNAME: {
    GOM: {
      ...definition(
        'SETSHOPNAME 商店名称',
        ['商店名称'],
        '修改GOM人物当前摆摊的商店名称'
      ),
      minArgs: 1,
      maxArgs: 1,
    },
  },
});

for (const entry of allCommands) {
  if (entry.engines?.includes('GOM') && entry.engines?.includes('GEE')) {
    entry.engineVariants ||= {};
    for (const engine of ['GOM', 'GEE']) {
      const source = sourceFor(entry.name, engine);
      if (!source) continue;
      entry.engineVariants[engine] = {
        ...(entry.engineVariants[engine] || {}),
        source,
      };
    }
  }
}

const applied = [];
const missing = [];
for (const [name, engineVariants] of Object.entries(variants)) {
  const entry = allCommands.find(command => command.name.toUpperCase() === name);
  if (!entry) {
    missing.push(name);
    continue;
  }
  entry.engineVariants ||= {};
  for (const [engine, variant] of Object.entries(engineVariants)) {
    const sourcedVariant = withSource(entry.name, engine, variant);
    entry.engineVariants[engine] = {
      ...(entry.engineVariants[engine] || {}),
      ...sourcedVariant,
      completionVerified: sourcedVariant.completionVerified
        ?? Boolean(sourcedVariant.source && sourcedVariant.syntax),
      completionReview: 'curated-help-variant',
    };
  }
  applied.push(entry.name);
}

let evidenceVerified = 0;
for (const entry of allCommands) {
  for (const engine of ['GOM', 'GEE']) {
    if (entry.engines?.length && !entry.engines.includes(engine)) continue;
    const currentVariant = entry.engineVariants?.[engine];
    if (
      currentVariant?.completionReview === 'curated-help-variant'
      || currentVariant?.completionReview === 'exact-help-syntax'
    ) {
      continue;
    }
    const record = audit.resolvedLanguage?.engines?.[engine]?.[entry.name.toUpperCase()];
    if (!record || record.origin !== 'shared') continue;
    const syntax = currentVariant?.syntax || entry.syntax || entry.name;
    if (!hasExactSyntaxEvidence(record, entry.name, syntax)) continue;
    entry.engineVariants ||= {};
    entry.engineVariants[engine] = {
      ...(currentVariant || {}),
      completionVerified: true,
      completionReview: 'exact-help-syntax',
    };
    evidenceVerified++;
  }
}

let safetySuppressed = 0;
for (const entry of allCommands) {
  const key = entry.name.toUpperCase();
  const auditRecord = audit.commands?.[key];
  if (auditRecord?.documentedClassification !== 'shared') continue;

  const reviewedVariants = Boolean(variants[key]?.GOM && variants[key]?.GEE);
  const exactSyntax = {};
  for (const engine of ['GOM', 'GEE']) {
    const currentVariant = entry.engineVariants?.[engine];
    const record = audit.resolvedLanguage?.engines?.[engine]?.[key];
    const syntax = currentVariant?.syntax || entry.syntax || entry.name;
    exactSyntax[engine] = hasExactSyntaxEvidence(record, entry.name, syntax)
      ? normalizedSyntax(syntax)
      : '';
  }
  const sameExactSyntax = Boolean(
    exactSyntax.GOM
    && exactSyntax.GEE
    && exactSyntax.GOM === exactSyntax.GEE
  );
  if (reviewedVariants || sameExactSyntax) continue;

  entry.engineVariants ||= {};
  for (const engine of ['GOM', 'GEE']) {
    entry.engineVariants[engine] = {
      ...(entry.engineVariants[engine] || {}),
      completionVerified: false,
      completionReview: 'cross-engine-syntax-unverified',
    };
  }
  safetySuppressed++;
}

commands.generated = new Date().toISOString();
commands.totalCheckCommands = commands.commands.length;
commands.totalActionCommands = commands.execCommands.length;
fs.writeFileSync(commandsPath, `${JSON.stringify(commands, null, 2)}\n`, 'utf8');

console.log(`Applied engine variants: ${applied.length}`);
console.log(`Verified from exact help syntax: ${evidenceVerified}`);
console.log(`Suppressed ambiguous shared completions: ${safetySuppressed}`);
console.log(`Removed invalid commands: ${removed.join(', ') || 'none'}`);
console.log(`Missing commands: ${missing.join(', ') || 'none'}`);
