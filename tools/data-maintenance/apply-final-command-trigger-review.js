const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

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

const commandOverrides = {
  GOM: {
    ADD: {
      syntax: 'ADD 目标变量 值或变量',
      description: '将指定数值或变量累加到目标变量',
      params: ['目标变量', '值或变量'],
      minArgs: 2,
      maxArgs: 2,
    },
    ADDITEM: {
      syntax: 'ADDITEM',
      description: '添加物品；当前资料只有调用示例，未给出完整参数定义',
      params: [],
      verified: false,
    },
    DBGET: {
      syntax: 'DBGET',
      description: '读取数据库值；当前资料只有调用示例，未给出完整参数定义',
      params: [],
      verified: false,
    },
    DBSET: {
      syntax: 'DBSET',
      description: '写入数据库值；当前资料只有调用示例，未给出完整参数定义',
      params: [],
      verified: false,
    },
    'H.CHECKLEVELEX': {
      syntax: 'H.CHECKLEVELEX 检测符 英雄等级',
      description: '检测英雄等级',
      params: ['检测符', '英雄等级'],
      minArgs: 2,
      maxArgs: 2,
    },
    'H.CHECKNAMELIST': {
      syntax: 'H.CHECKNAMELIST 文件路径',
      description: '检测英雄名称是否存在于指定名单文件中',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/英雄功能操作/英雄上线触发.htm',
      sourceTitle: '英雄上线触发',
    },
    'H.DELSKILL': {
      syntax: 'H.DELSKILL 技能名称',
      description: '删除英雄的指定技能',
      params: ['技能名称'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/英雄功能操作/英雄上线触发.htm',
      sourceTitle: '英雄上线触发',
    },
    'H.GIVE': {
      syntax: 'H.GIVE 物品名称 数量',
      description: '给予英雄指定数量的物品',
      params: ['物品名称', '数量'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/英雄功能操作/英雄上线触发.htm',
      sourceTitle: '英雄上线触发',
    },
    'H.ISNEWHUMAN': {
      syntax: 'H.ISNEWHUMAN',
      description: '检测英雄是否首次上线',
      params: [],
      minArgs: 0,
      maxArgs: 0,
      sourcePage: '游戏引擎反外挂系统/英雄功能操作/英雄上线触发.htm',
      sourceTitle: '英雄上线触发',
    },
    'H.CHECKJOB': {
      syntax: 'H.CHECKJOB 职业(WARRIOR/WIZARD/TAOIST)',
      description: '检测英雄职业',
      params: ['职业(WARRIOR/WIZARD/TAOIST)'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/部分脚本实例/新转职业变性脚本.htm',
      sourceTitle: '新转职业变性脚本',
    },
    'H.CHECKONLINE': {
      syntax: 'H.CHECKONLINE',
      description: '检测英雄是否在线',
      params: [],
      minArgs: 0,
      maxArgs: 0,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检测人物是否在线.html',
      sourceTitle: '检测人物是否在线',
    },
    'H.ADDMPPER': {
      syntax: 'H.ADDMPPER 操作符(+/-/=) 比例值 [比例模式(0:百分比;1:千分比;2:万分比)]',
      description: '按英雄最大 MP 的百分比、千分比或万分比调整当前 MP',
      params: ['操作符(+/-/=)', '比例值', '[比例模式(0:百分比;1:千分比;2:万分比)]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/调整血量，魔法百分比.html',
      sourceTitle: '调整百分比血量、百分比魔法',
    },
    'H.CHECKHPPER': {
      syntax: 'H.CHECKHPPER 检测符(>/< /=) 比例值 [比例模式(0:百分比;1:千分比;2:万分比)]',
      description: '检测英雄当前 HP 占最大 HP 的百分比、千分比或万分比',
      params: ['检测符(>/< /=)', '比例值', '[比例模式(0:百分比;1:千分比;2:万分比)]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/调整血量，魔法百分比.html',
      sourceTitle: '调整百分比血量、百分比魔法',
    },
    CHANGECUSTOMITEMTEXT: {
      syntax: 'CHANGECUSTOMITEMTEXT 装备位置 文字内容',
      description: '修改指定装备的自定义文字内容',
      params: ['装备位置', '文字内容'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
    CHANGECUSTOMITEMTEXTCOLOR: {
      syntax: 'CHANGECUSTOMITEMTEXTCOLOR 装备位置 文字颜色(0-255)',
      description: '修改指定装备自定义文字的显示颜色',
      params: ['装备位置', '文字颜色(0-255)'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
    CHECKCUSTOMITEMVALUE: {
      syntax: 'CHECKCUSTOMITEMVALUE 装备位置 属性位置(0-19) 检测符(>/< /=) 值',
      description: '检测指定装备的自定义属性值',
      params: ['装备位置', '属性位置(0-19)', '检测符(>/< /=)', '值'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
    CHECKCUSTOMITEMVALUETYPE: {
      syntax: 'CHECKCUSTOMITEMVALUETYPE 装备位置 属性位置(0-19) 检测符(>/< /=) 绑定属性类型(0-17)',
      description: '检测指定装备自定义属性的绑定类型',
      params: ['装备位置', '属性位置(0-19)', '检测符(>/< /=)', '绑定属性类型(0-17)'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
    CHANGECUSTOMITEMVALUE: {
      syntax: 'CHANGECUSTOMITEMVALUE 装备位置 属性位置(0-19) 操作符(+/-/=) 值',
      description: '修改指定装备的自定义属性值',
      params: ['装备位置', '属性位置(0-19)', '操作符(+/-/=)', '值'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
    CHANGECUSTOMITEMABIL: {
      syntax: 'CHANGECUSTOMITEMABIL 装备位置 属性位置(0-19) 修改类型 参数值',
      description: '按修改类型调整指定装备的自定义属性',
      params: ['装备位置', '属性位置(0-19)', '修改类型', '参数值'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
    PICKUPITEM: {
      syntax: 'PICKUPITEM',
      description: '拾取当前目标物品',
      params: [],
      minArgs: 0,
      maxArgs: 0,
    },
    SETWEATHEREFFECT: {
      syntax: 'SETWEATHEREFFECT 地图号 天气效果(0-3) 有效时间(秒)',
      description: '设置指定地图的天气效果及有效时间，效果值 0 为关闭、1 为黄沙、2 为花瓣、3 为下雪',
      params: ['地图号', '天气效果(0-3)', '有效时间(秒)'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/天气效果[!].htm',
      sourceTitle: '天气效果',
    },
    INSERTTOLIST: {
      syntax: 'INSERTTOLIST 列表变量 值 插入下标',
      description: '在列表的指定下标对应元素之前插入一个值',
      params: ['列表变量', '值', '插入下标'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/多元数组、元素变量.htm',
      sourceTitle: '多元数组、元素变量',
    },
    IsSpanRegionHumam: {
      syntax: 'IsSpanRegionHumam',
      description: '检测当前角色是否为跨区跨服角色',
      params: [],
      aliases: ['IsSpanRegionHuman'],
      minArgs: 0,
      maxArgs: 0,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/角色跨区跨服功能.htm',
      sourceTitle: '角色跨区跨服功能',
    },
    REMOVELISTBYINDEX: {
      syntax: 'REMOVELISTBYINDEX 列表变量 下标',
      description: '按下标删除列表元素，负数下标从列表末尾向前计算',
      params: ['列表变量', '下标'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/多元数组、元素变量.htm',
      sourceTitle: '多元数组、元素变量',
    },
    REPLACELISTBYCONTENT: {
      syntax: 'REPLACELISTBYCONTENT 列表变量 被替换内容 新内容 替换次数',
      description: '按内容替换列表元素，并由第 4 参数指定替换次数',
      params: ['列表变量', '被替换内容', '新内容', '替换次数'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/多元数组、元素变量.htm',
      sourceTitle: '多元数组、元素变量',
    },
    REVERSELIST: {
      syntax: 'REVERSELIST 源列表 目标列表',
      description: '将源列表中的元素反向排列后写入目标列表',
      params: ['源列表', '目标列表'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/多元数组、元素变量.htm',
      sourceTitle: '多元数组、元素变量',
    },
    READEXCEL: {
      syntax: 'READEXCEL 表格路径 行号',
      description: '读取 XLS 表格的指定行，列值依次写入 EXCEL0、EXCEL1 等全局变量',
      params: ['表格路径', '行号'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/读取表格功能.htm',
      sourceTitle: '读取表格功能',
    },
    WITHIN: {
      syntax: 'WITHIN',
      description: '检测两个数值是否在指定范围内；当前资料只有调用示例，未给出完整参数定义',
      params: [],
      verified: false,
    },
  },
  GEE: {
    CHANGEBMZ: {
      syntax: 'ChangeBmz 新名字 [原有名字]',
      description: '修改宝宝名字；省略原有名字时修改所有宝宝',
      params: ['新名字', '[原有名字]'],
      minArgs: 1,
      maxArgs: 2,
    },
    SETDUMMYPICKITEM: {
      syntax: 'SetDummyPickItem 开关(0:关闭;1:开启)',
      description: '开启或关闭假人捡取物品',
      params: ['开关(0:关闭;1:开启)'],
      minArgs: 1,
      maxArgs: 1,
    },
    'H.CHECKLEVELEX': {
      syntax: 'H.CHECKLEVELEX 检测符 英雄等级',
      description: '检测英雄等级',
      params: ['检测符', '英雄等级'],
      minArgs: 2,
      maxArgs: 2,
    },
    'H.CHECKNAMELIST': {
      syntax: 'H.CHECKNAMELIST 文件路径',
      description: '检测英雄名称是否存在于指定名单文件中',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/特殊触发功能/英雄上线触发.htm',
      sourceTitle: '英雄上线触发',
    },
    'H.DELSKILL': {
      syntax: 'H.DELSKILL 技能名称',
      description: '删除英雄的指定技能',
      params: ['技能名称'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/兼容HeroM2/功能操作命令/清除英雄所有技能.htm',
      sourceTitle: '清除英雄所有技能',
    },
    'H.GIVE': {
      syntax: 'H.GIVE 物品名称 数量',
      description: '给予英雄指定数量的物品',
      params: ['物品名称', '数量'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/英雄相关操作命令增加与捡起触发示范.html',
      sourceTitle: '英雄相关操作命令增加与捡起触发示范',
    },
    'H.ISNEWHUMAN': {
      syntax: 'H.ISNEWHUMAN',
      description: '检测英雄是否首次上线',
      params: [],
      minArgs: 0,
      maxArgs: 0,
      sourcePage: '游戏引擎反外挂系统/特殊触发功能/英雄上线触发.htm',
      sourceTitle: '英雄上线触发',
    },
    'H.CHECKJOB': {
      syntax: 'H.CHECKJOB 职业(WARRIOR/WIZARD/TAOIST)',
      description: '检测英雄职业',
      params: ['职业(WARRIOR/WIZARD/TAOIST)'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/兼容HeroM2/脚本检测命令/检测英雄职业.htm',
      sourceTitle: '检测英雄职业',
    },
    'H.CHECKONLINE': {
      syntax: 'H.CHECKONLINE',
      description: '检测英雄是否在线',
      params: [],
      minArgs: 0,
      maxArgs: 0,
      sourcePage: '游戏引擎反外挂系统/部分脚本实例/新转职业变性脚本.htm',
      sourceTitle: '新转职业变性脚本',
    },
    'H.ADDMPPER': {
      syntax: 'H.ADDMPPER 操作符(+/-/=) 比例值 [比例模式(0:百分比;1:千分比;2:万分比)]',
      description: '按英雄最大 MP 的百分比、千分比或万分比调整当前 MP',
      params: ['操作符(+/-/=)', '比例值', '[比例模式(0:百分比;1:千分比;2:万分比)]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/部分脚本实例/百分比检测.htm',
    },
    'H.CHECKHPPER': {
      syntax: 'H.CHECKHPPER 检测符(>/< /=) 比例值 [比例模式(0:百分比;1:千分比;2:万分比)]',
      description: '检测英雄当前 HP 占最大 HP 的百分比、千分比或万分比',
      params: ['检测符(>/< /=)', '比例值', '[比例模式(0:百分比;1:千分比;2:万分比)]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/部分脚本实例/百分比检测.htm',
    },
    INSERTTOLIST: {
      syntax: 'INSERTTOLIST 数组变量 值 插入位置(-1为最后一位)',
      description: '在数组指定位置对应元素之前插入一个值，-1 表示最后一位',
      params: ['数组变量', '值', '插入位置(-1为最后一位)'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/元素变量.html',
      sourceTitle: '多元数组元素变量',
    },
    IsSpanRegionHumam: {
      syntax: 'IsSpanRegionHumam',
      description: '检测当前角色是否为跨区跨服角色',
      params: [],
      aliases: [],
      minArgs: 0,
      maxArgs: 0,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/跨区跨服设置.htm',
      sourceTitle: '跨区跨服功能设置',
    },
    REMOVELISTBYINDEX: {
      syntax: 'REMOVELISTBYINDEX 数组变量 数组下标',
      description: '按下标删除数组元素，负数下标从数组末尾向前计算',
      params: ['数组变量', '数组下标'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/元素变量.html',
      sourceTitle: '多元数组元素变量',
    },
    REPLACELISTBYCONTENT: {
      syntax: 'REPLACELISTBYCONTENT 数组变量 旧值 新值 区分大小写(0:不区分;1:区分)',
      description: '按内容替换数组元素，第 4 参数控制是否区分大小写',
      params: ['数组变量', '旧值', '新值', '区分大小写(0:不区分;1:区分)'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/元素变量.html',
      sourceTitle: '多元数组元素变量',
    },
    REVERSELIST: {
      syntax: 'REVERSELIST 待翻转数组 接收变量',
      description: '将数组元素反向排列后写入接收变量',
      params: ['待翻转数组', '接收变量'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/元素变量.html',
      sourceTitle: '多元数组元素变量',
    },
    MISSION: {
      syntax: 'MISSION 地图 X坐标或X坐标列表 Y坐标或Y坐标列表',
      description: '设置怪物攻城集中位置；坐标列表使用分号分隔且 X、Y 数量必须一致',
      params: ['地图', 'X坐标或X坐标列表', 'Y坐标或Y坐标列表'],
      minArgs: 3,
      maxArgs: 3,
    },
    MOVEMONTOPOS: {
      syntax: 'MoveMonToPos 怪物名称 地图编号 原坐标X 原坐标Y 新坐标X 新坐标Y',
      description: '将指定地图原坐标处的同名怪物移动到新坐标',
      params: ['怪物名称', '地图编号', '原坐标X', '原坐标Y', '新坐标X', '新坐标Y'],
      minArgs: 6,
      maxArgs: 6,
      sourcePage: '游戏引擎反外挂系统/兼容HeroM2/功能操作命令/移动怪物到新坐标.htm',
      sourceTitle: '移动怪物到新坐标',
    },
    UPDATEITEM: {
      syntax: 'updateitem 物品位置',
      description: '将绑定物品的属性更新到客户端，位置 -1 为普通 OK 框',
      params: ['物品位置'],
      minArgs: 1,
      maxArgs: 1,
    },
  },
  '996PC': {
    ADDACCOUNTLIST: {
      syntax: 'ADDACCOUNTLIST 文件路径',
      description: '将登录账号加入指定列表文件',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/创建文件.html',
      sourceTitle: '文本操作类',
    },
    ADDIPLIST: {
      syntax: 'ADDIPLIST 文件路径',
      description: '将人物登录 IP 加入指定列表文件',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/创建文件.html',
      sourceTitle: '文本操作类',
    },
    ADDNAMELIST: {
      syntax: 'ADDNAMELIST 文件路径',
      description: '将人物名称加入指定列表文件',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/创建文件.html',
      sourceTitle: '文本操作类',
    },
    DELACCOUNTLIST: {
      syntax: 'DELACCOUNTLIST 文件路径',
      description: '从指定列表文件中删除登录账号',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/创建文件.html',
      sourceTitle: '文本操作类',
    },
    DELIPLIST: {
      syntax: 'DELIPLIST 文件路径',
      description: '从指定列表文件中删除人物登录 IP',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/创建文件.html',
      sourceTitle: '文本操作类',
    },
    DELNAMELIST: {
      syntax: 'DELNAMELIST 文件路径',
      description: '从指定列表文件中删除人物名称',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/创建文件.html',
      sourceTitle: '文本操作类',
    },
    DELGUILDLIST: {
      syntax: 'DELGUILDLIST 文件路径',
      description: '从指定列表文件中删除人物所在行会名称',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/创建文件.html',
      sourceTitle: '文本操作类',
    },
    ADDHPPER: {
      syntax: 'ADDHPPER 操作符(+/-/=) 百分比(1-100) [比率模式(0:百分比;1:千分比)] [飘血ID]',
      description: '按百分比或千分比调整人物当前 HP，可选择自定义飘血动作',
      params: ['操作符(+/-/=)', '百分比(1-100)', '[比率模式(0:百分比;1:千分比)]', '[飘血ID]'],
      minArgs: 2,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/调整血量，魔法百分比.html',
      sourceTitle: '调整血量，魔法百分比',
    },
    ADDMPPER: {
      syntax: 'ADDMPPER 操作符(+/-/=) 百分比(1-100) [比率模式(0:百分比;1:千分比)] [飘血ID]',
      description: '按百分比或千分比调整人物当前 MP，可选择自定义飘血动作',
      params: ['操作符(+/-/=)', '百分比(1-100)', '[比率模式(0:百分比;1:千分比)]', '[飘血ID]'],
      minArgs: 2,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/调整血量，魔法百分比.html',
      sourceTitle: '调整血量，魔法百分比',
    },
    'H.ADDMPPER': {
      syntax: 'H.ADDMPPER 操作符(+/-/=) 百分比(1-100) [比率模式(0:百分比;1:千分比)]',
      description: '按英雄最大 MP 的百分比或千分比调整当前 MP',
      params: ['操作符(+/-/=)', '百分比(1-100)', '[比率模式(0:百分比;1:千分比)]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/调整血量，魔法百分比.html',
      sourceTitle: '调整血量，魔法百分比',
    },
    'H.CHECKHPPER': {
      syntax: 'H.CHECKHPPER 检测符(>/< /=) 百分比(1-100) [比率模式(0:百分比;1:千分比)]',
      description: '检测英雄当前 HP 占最大 HP 的百分比或千分比',
      params: ['检测符(>/< /=)', '百分比(1-100)', '[比率模式(0:百分比;1:千分比)]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/调整血量，魔法百分比.html',
      sourceTitle: '调整血量，魔法百分比',
    },
    ADDSKILL: {
      syntax: 'ADDSKILL 技能名称 [技能等级] [技能别名]',
      description: '为人物增加技能，省略等级时为 0 级，可选择设置技能别名',
      params: ['技能名称', '[技能等级]', '[技能别名]'],
      minArgs: 1,
      maxArgs: 3,
    },
    ADDSTARTPOINT: {
      syntax: 'ADDSTARTPOINT 地图编号 自定义安全区编号 光柱特效类型 安全区坐标及中心点',
      description: '临时增加安全区，M2 重启后消失且不写入配置',
      params: ['地图编号', '自定义安全区编号', '光柱特效类型', '安全区坐标及中心点'],
      minArgs: 4,
      maxArgs: 4,
    },
    ADDTOLIST: {
      syntax: 'ADDTOLIST 数组变量 值',
      description: '向指定 L$ 数组末尾追加一个值',
      params: ['数组变量', '值'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    ADDTEXTLIST: {
      syntax: 'AddTextList 文件路径 字符串',
      description: '向指定文本文件增加字符串，字符串可以包含空格',
      params: ['文件路径', '字符串'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/从指定文件中删除字符串[!].htm',
      sourceTitle: '从指定文件中删除字符串和增加字符串',
    },
    DELTEXTLIST: {
      syntax: 'DelTextList 文件路径 字符串',
      description: '从指定文本文件删除字符串，字符串可以包含空格',
      params: ['文件路径', '字符串'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/从指定文件中删除字符串[!].htm',
      sourceTitle: '从指定文件中删除字符串和增加字符串',
    },
    BMAKEPOSION: {
      syntax: 'BMAKEPOSION 状态类型 时间(秒) 威力',
      description: '为人物宝宝施加指定状态并设置持续时间和威力',
      params: ['状态类型', '时间(秒)', '威力'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/改变人物状态.html',
      sourceTitle: '改变人物状态',
    },
    CHANGESECRETMODE: {
      syntax: 'ChangeSecretMode 功能值 有效时间(秒) [统一名字] [衣服外观] [武器外观]',
      description: '修改浑水摸鱼模式，功能值由禁言、隐藏信息、统一名字和外观等标志值相加组成',
      params: ['功能值', '有效时间(秒)', '[统一名字]', '[衣服外观]', '[武器外观]'],
      minArgs: 2,
      maxArgs: 5,
    },
    CHANGEITEMDURA: {
      syntax: 'ChangeItemDura 装备位置(-1或0-47) 操作符(+/-/=) 持久值(0-65000) [同步当前持久(0/1)]',
      description: '修改指定位置装备的最大持久，可选择在当前持久超过新上限时同步调整当前持久',
      params: ['装备位置(-1或0-47)', '操作符(+/-/=)', '持久值(0-65000)', '[同步当前持久(0/1)]'],
      minArgs: 3,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/兼容HeroM2/功能操作命令/改变物品的持久.htm',
      sourceTitle: '改变物品的持久',
    },
    CHANGEITEMNAME: {
      syntax: 'ChangeItemName 物品位置(0-28或30-47) 新名称',
      description: '修改指定位置装备的名称',
      params: ['物品位置(0-28或30-47)', '新名称'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/新的装备改名[!].htm',
      sourceTitle: '新的装备改名',
    },
    CHANGETRANPOINT: {
      syntax: 'CHANGETRANPOINT 技能名称 操作符(+/-/=) 技能点数',
      description: '调整指定技能的技能点数',
      params: ['技能名称', '操作符(+/-/=)', '技能点数'],
      minArgs: 3,
      maxArgs: 3,
    },
    CHECKCONTAINSTEXT: {
      syntax: 'CheckContainsText 原字符串 待查找字符串',
      description: '检测原字符串是否包含指定字符串',
      params: ['原字符串', '待查找字符串'],
      minArgs: 2,
      maxArgs: 2,
    },
    CHECKCONTAINSTEXTLIST: {
      syntax: 'CHECKCONTAINSTEXTLIST 文件路径 检测字符串',
      description: '检测列表文件中是否有一行包含指定字符串',
      params: ['文件路径', '检测字符串'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检查字符串是否在指定文件中 包含检测 [!].html',
      sourceTitle: '检查字符串是否在指定文件中 包含检测',
    },
    CHECKCONTAINSTEXTLISTEX: {
      syntax: 'CHECKCONTAINSTEXTLISTEX 文件路径 检测字符串',
      description: '检测指定字符串是否包含列表文件中的某一行关键字',
      params: ['文件路径', '检测字符串'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检查字符串是否在指定文件中 包含检测 [!].html',
      sourceTitle: '检查字符串是否在指定文件中 包含检测',
    },
    CHECKHPPER: {
      syntax: 'CHECKHPPER 检测符(=/>/</?) 百分比(0-100) [比率模式(0:百分比;1:千分比)]',
      description: '检测人物当前 HP 所占百分比或千分比',
      params: ['检测符(=/>/</?)', '百分比(0-100)', '[比率模式(0:百分比;1:千分比)]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检测血量，魔法百分比.html',
      sourceTitle: '检测血量，魔法百分比',
    },
    CHECKMPPER: {
      syntax: 'CHECKMPPER 检测符(=/>/</?) 百分比(0-100) [比率模式(0:百分比;1:千分比)]',
      description: '检测人物当前 MP 所占百分比或千分比',
      params: ['检测符(=/>/</?)', '百分比(0-100)', '[比率模式(0:百分比;1:千分比)]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检测血量，魔法百分比.html',
      sourceTitle: '检测血量，魔法百分比',
    },
    CHECKTEXTLIST: {
      syntax: 'CHECKTEXTLIST 文件路径 字符串1 [字符串2]',
      description: '检测指定字符串是否存在于文本文件；提供第二个字符串时按同一行两列并区分大小写检测',
      params: ['文件路径', '字符串1', '[字符串2]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检查字符串是否在指定文件中[!].htm',
      sourceTitle: '检查字符串是否在指定文件中',
    },
    CHECKLISTALLDIGIT: {
      syntax: 'CHECKLISTALLDIGIT 数组变量',
      description: '检测指定 L$ 数组中的所有元素是否均为数字',
      params: ['数组变量'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    CHECKVARINLIST: {
      syntax: 'CHECKVARINLIST 数组变量 值',
      description: '检测指定值是否存在于 L$ 数组中',
      params: ['数组变量', '值'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    INSERTTOLIST: {
      syntax: 'INSERTTOLIST 数组变量 值 插入位置(-1为最后一位)',
      description: '在数组指定位置对应元素之前插入一个值，-1 表示最后一位',
      params: ['数组变量', '值', '插入位置(-1为最后一位)'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    REMOVELISTBYINDEX: {
      syntax: 'REMOVELISTBYINDEX 数组变量 数组下标',
      description: '按下标删除数组中的元素',
      params: ['数组变量', '数组下标'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    REPLACELISTBYCONTENT: {
      syntax: 'REPLACELISTBYCONTENT 数组变量 旧值 新值 区分大小写(0:不区分;1:区分)',
      description: '按内容替换数组元素，第 4 参数控制是否区分大小写',
      params: ['数组变量', '旧值', '新值', '区分大小写(0:不区分;1:区分)'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    REVERSELIST: {
      syntax: 'REVERSELIST 待翻转数组 接收变量',
      description: '将数组元素反向排列后写入接收变量',
      params: ['待翻转数组', '接收变量'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    READEXCEL: {
      syntax: 'READEXCEL 表格路径 行号',
      description: '读取 XLS 表格的指定行，列值依次写入 EXCEL0、EXCEL1 等全局变量',
      params: ['表格路径', '行号'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/新增功能/读取xls表格功能.htm',
      sourceTitle: '读取xls表格功能',
    },
    CHECKITEMADDVALUE: {
      syntax: 'CHECKITEMADDVALUE 装备位置 属性位置(0-14) 检测符(=/>/</?) 值 [保存变量]',
      description: '检测指定装备的附加属性值，并可将属性值写入变量',
      params: ['装备位置', '属性位置(0-14)', '检测符(=/>/</?)', '值', '[保存变量]'],
      minArgs: 4,
      maxArgs: 5,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检测物品的附加属性值[!].htm',
      sourceTitle: '检测物品的附加属性值',
    },
    CHECKGOLD: {
      syntax: 'CHECKGOLD 金币数量',
      description: '检测人物金币数量是否不小于指定数值',
      params: ['金币数量'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/其他相关资料/传奇基础脚本命令详解[!].htm',
      sourceTitle: '传奇基础脚本命令详解',
    },
    CHECKBONUSPOINT: {
      syntax: 'CHECKBONUSPOINT 检测符(=/>/</?) 点数',
      description: '检测人物剩余附加属性点数',
      params: ['检测符(=/>/</?)', '点数'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检查人物附加属性点数.htm',
      sourceTitle: '检查人物附加属性点数',
    },
    CHECKITEMSTATE: {
      syntax: 'CheckItemState 装备位置(-1或0-28或30-47) 状态项目(0-6)',
      description: '检测指定位置装备的禁止扔、交易、存放、修理、出售、爆出或丢弃消失状态',
      params: ['装备位置(-1或0-28或30-47)', '状态项目(0-6)'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检查装备绑定状态[!].htm',
      sourceTitle: '检查装备绑定状态',
    },
    CHECKITEMTYPE: {
      syntax: 'CHECKITEMTYPE 物品位置 物品类型',
      description: '检测人物指定装备位置所穿物品的类型',
      params: ['物品位置', '物品类型'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检查人物身上戴物品类型.htm',
      sourceTitle: '检查人物身上戴物品类型',
    },
    CHECKMONEY: {
      syntax: 'CHECKMONEY 货币名称 检测符(<,>,=,?) 数量',
      description: '检测人物指定货币的数量',
      params: ['货币名称', '检测符(<,>,=,?)', '数量'],
      minArgs: 3,
      maxArgs: 3,
    },
    CHECKSKILL: {
      syntax: 'CHECKSKILL 技能名称 检测符(<,>,=,?) 等级 [检测强化技能(0/1)]',
      description: '检测人物是否学习指定技能及其等级',
      params: ['技能名称', '检测符(<,>,=,?)', '等级', '[检测强化技能(0/1)]'],
      minArgs: 3,
      maxArgs: 4,
    },
    CLEARSKILL: {
      syntax: 'CLEARSKILL',
      description: '清除人物的所有技能',
      params: [],
      minArgs: 0,
      maxArgs: 0,
    },
    CLEARNAMELIST: {
      syntax: 'CLEARNAMELIST 文件路径',
      description: '清空指定名单文件中的全部内容',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/清除列表内容.htm',
      sourceTitle: '清除列表内容',
    },
    FILEEXISTS: {
      syntax: 'FileExists 文件路径',
      description: '检测指定文件是否存在',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检测文件是否存在.htm',
      sourceTitle: '检测文件是否存在',
    },
    DELNOJOBSKILL: {
      syntax: 'DELNOJOBSKILL',
      description: '清除人物不属于当前职业的技能',
      params: [],
      minArgs: 0,
      maxArgs: 0,
    },
    DELSKILL: {
      syntax: 'DELSKILL 技能名称',
      description: '删除人物的指定技能',
      params: ['技能名称'],
      minArgs: 1,
      maxArgs: 1,
    },
    DELSTARTPOINT: {
      syntax: 'DELSTARTPOINT 地图编号 自定义安全区编号',
      description: '删除由 ADDSTARTPOINT 临时增加的指定安全区',
      params: ['地图编号', '自定义安全区编号'],
      minArgs: 2,
      maxArgs: 2,
    },
    DAYOFMONTH: {
      syntax: 'DAYOFMONTH 起始日(1-31) [结束日(1-31)]',
      description: '检测当前是本月指定日期或日期范围',
      params: ['起始日(1-31)', '[结束日(1-31)]'],
      minArgs: 1,
      maxArgs: 2,
    },
    DAYSBETWEEN: {
      syntax: 'DAYSBETWEEN 日期1 日期2 接收变量',
      description: '计算两个日期之间相差的秒数并写入接收变量',
      params: ['日期1', '日期2', '接收变量'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/新增功能/取两个时间之间的相差秒数.htm',
      sourceTitle: '取两个时间之间的相差秒数',
    },
    FILTERGLOBALMSG: {
      syntax: 'FILTERGLOBALMSG 聊天框 [聊天框固顶] [SendMoveMsg] [SendCenterMsg] [SendVerticalMoveMsg] [掉落提示]',
      description: '按消息类型过滤全服提示，每个参数 0 表示不过滤，1 表示过滤；发送给个人的信息不受影响',
      params: ['聊天框(0/1)', '[聊天框固顶(0/1)]', '[SendMoveMsg(0/1)]', '[SendCenterMsg(0/1)]', '[SendVerticalMoveMsg(0/1)]', '[掉落提示(0/1)]'],
      minArgs: 1,
      maxArgs: 6,
    },
    DIV: {
      syntax: 'DIV 结果变量 被除数 除数',
      description: '计算被除数除以除数并将结果写入目标变量',
      params: ['结果变量', '被除数', '除数'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/除法.htm',
      sourceTitle: '除法',
    },
    DELETEFILE: {
      syntax: 'DeleteFile 文件路径',
      description: '删除指定文本文件',
      params: ['文件路径'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/创建文件.html',
      sourceTitle: '文本操作类',
    },
    DELTEXT: {
      syntax: 'DelText 文本路径 行号 删除模式(0:删除该行;1:保留空行)',
      description: '删除文本文件中的指定行，并可选择保留该行为空行',
      params: ['文本路径', '行号', '删除模式(0:删除该行;1:保留空行)'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/创建文件.html',
      sourceTitle: '文本操作类',
    },
    EXTRACTLIST: {
      syntax: 'EXTRACTLIST 数组变量 保存变量 起点索引 终点索引 [步长(默认1)]',
      description: '截取 L$ 数组的指定索引区间并写入保存变量',
      params: ['数组变量', '保存变量', '起点索引', '终点索引', '[步长(默认1)]'],
      minArgs: 4,
      maxArgs: 5,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    EQUAL: {
      syntax: 'EQUAL 值1 值2',
      description: '检测两个值是否相等',
      params: ['值1', '值2'],
      minArgs: 2,
      maxArgs: 2,
    },
    GETSKILLPOWER: {
      syntax: 'GetSkillPower 技能ID 人物伤害百分比变量 人物伤害值变量 怪物伤害百分比变量 怪物伤害值变量 防御百分比变量 防御值变量 时间变量',
      description: '取得指定技能的人物伤害、怪物伤害、防御和有效时间设置',
      params: ['技能ID', '人物伤害百分比变量', '人物伤害值变量', '怪物伤害百分比变量', '怪物伤害值变量', '防御百分比变量', '防御值变量', '时间变量'],
      minArgs: 8,
      maxArgs: 8,
    },
    'H.CHECKLEVELEX': {
      syntax: 'H.CHECKLEVELEX 检测符 英雄等级',
      description: '检测英雄等级',
      params: ['检测符', '英雄等级'],
      minArgs: 2,
      maxArgs: 2,
    },
    'H.CHECKJOB': {
      syntax: 'H.CHECKJOB 职业(WARRIOR/WIZARD/TAOIST)',
      description: '检测英雄职业',
      params: ['职业(WARRIOR/WIZARD/TAOIST)'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/英雄功能操作/检测英雄职业.htm',
      sourceTitle: '检测英雄职业',
    },
    'H.CHECKONLINE': {
      syntax: 'H.CHECKONLINE',
      description: '检测英雄是否在线',
      params: [],
      minArgs: 0,
      maxArgs: 0,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检测人物是否在线.html',
      sourceTitle: '检测人物是否在线',
    },
    CHECKHEROONLINE: {
      syntax: 'CHECKHEROONLINE',
      description: '检测英雄是否在线',
      params: [],
      minArgs: 0,
      maxArgs: 0,
      sourcePage: '游戏引擎反外挂系统/英雄功能操作/检测英雄是否在线.htm',
      sourceTitle: '检测英雄是否在线',
    },
    INSAFEZONE: {
      syntax: 'INSAFEZONE',
      description: '检测人物当前是否位于安全区',
      params: [],
      minArgs: 0,
      maxArgs: 0,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检测在安全区.htm',
      sourceTitle: '检测在安全区',
    },
    ISONMAP: {
      syntax: 'ISONMAP 地图编号',
      description: '检测人物当前是否位于指定地图',
      params: ['地图编号'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/脚本检测命令/检查是否在某地图.htm',
      sourceTitle: '检查是否在某地图',
    },
    GETLISTMINVAR: {
      syntax: 'GETLISTMINVAR 数组变量 接收变量',
      description: '取数组中的最小数字值并写入接收变量；数组元素必须全为数字',
      params: ['数组变量', '接收变量'],
      minArgs: 2,
      maxArgs: 2,
    },
    GETLISTMAXVAR: {
      syntax: 'GETLISTMAXVAR 数组变量 接收变量',
      description: '取得 L$ 数组中的最大数字值并写入接收变量',
      params: ['数组变量', '接收变量'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    GETLISTVARCOUNT: {
      syntax: 'GETLISTVARCOUNT 数组变量 接收变量',
      description: '取得 L$ 数组的元素数量并写入接收变量',
      params: ['数组变量', '接收变量'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    GETLISTVARINDEX: {
      syntax: 'GETLISTVARINDEX 数组变量 值 接收变量',
      description: '取得指定值在 L$ 数组中的索引并写入接收变量',
      params: ['数组变量', '值', '接收变量'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    GETLISTSTRING: {
      syntax: 'GetListString 文件路径 行号(从0开始) 变量1 [变量2]',
      description: '读取文本文件指定行到变量；提供变量2时按冒号分隔同一行的两个值',
      params: ['文件路径', '行号(从0开始)', '变量1', '[变量2]'],
      minArgs: 3,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/兼容HeroM2/功能操作命令/读取文本内容到变量.htm',
      sourceTitle: '读取文本内容到变量',
    },
    GETLISTSTRINGEX: {
      syntax: 'GetListStringEx 文本路径 行号 写入变量 [分隔符]',
      description: '读取文本指定行的多列内容，并按分隔符依次写入系列变量',
      params: ['文本路径', '行号', '写入变量', '[分隔符]'],
      minArgs: 3,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/创建文件.html',
      sourceTitle: '文本操作类',
    },
    GETRANDOMLINETEXT: {
      syntax: 'GETRANDOMLINETEXT 文件路径 接收字符串变量 [指定行(0或空:随机;大于0:指定行)]',
      description: '从指定文本文件随机读取一行，或读取指定行，并写入字符串变量',
      params: ['文件路径', '接收字符串变量', '[指定行(0或空:随机;大于0:指定行)]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/创建文件.html',
      sourceTitle: '文本操作类',
    },
    GETRANDOMTEXT: {
      syntax: 'GetRandomText 文件路径 接收变量(S0-S99) [指定行(0-10000)]',
      description: '从文本文件随机读取一行，或读取指定行，并写入字符串变量',
      params: ['文件路径', '接收变量(S0-S99)', '[指定行(0-10000)]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/兼容HeroM2/功能操作命令/取得随机字符串.htm',
      sourceTitle: '取得随机字符串',
    },
    GETITEMSTONECOUNT: {
      syntax: 'GetItemStoneCount 装备位置 宝石名称或* 接收变量',
      description: '取得指定位置装备上匹配名称的宝石数量并写入变量，星号表示不区分名称',
      params: ['装备位置', '宝石名称或*', '接收变量'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/镶嵌宝石.html',
      sourceTitle: '镶嵌宝石',
    },
    GETSTONECOUNT: {
      syntax: 'GetStoneCount 宝石名称或* 接收变量',
      description: '取得人物身上全部装备中匹配名称的宝石数量并写入变量，星号表示不区分名称',
      params: ['宝石名称或*', '接收变量'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/镶嵌宝石.html',
      sourceTitle: '镶嵌宝石',
    },
    GETUSERNAME: {
      syntax: 'GetUserName 保存变量(S0-S99)',
      description: '取得当前人物名称并写入指定 S 变量',
      params: ['保存变量(S0-S99)'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/兼容HeroM2/功能操作命令/获取玩家名字.htm',
      sourceTitle: '获取玩家名字',
    },
    GUILDNOTICEMSG: {
      syntax: 'GuildNoticeMsg 前景颜色 背景颜色 信息内容 [发送范围(Self/Group/National/Map)]',
      description: '指定前景色和背景色发送文字，可选择个人、队伍、国家或当前地图范围；省略范围时全服发送',
      params: ['前景颜色', '背景颜色', '信息内容', '[发送范围(Self/Group/National/Map)]'],
      minArgs: 3,
      maxArgs: 4,
    },
    GAMEGOLD: {
      syntax: 'GAMEGOLD 操作符(+/-/=) 数量',
      description: '增加、减少或设置人物游戏币数量',
      params: ['操作符(+/-/=)', '数量'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/调整游戏币.htm',
      sourceTitle: '调整游戏币',
    },
    KICKALLPLAY: {
      syntax: 'KICKALLPLAY',
      description: '踢除服务器所有在线人物',
      params: [],
      minArgs: 0,
      maxArgs: 0,
    },
    KICKOFFLINE: {
      syntax: 'KICKOFFLINE',
      description: '踢除挂机人物；也可使用“人物名.KICKOFFLINE”踢除指定人物',
      params: [],
      minArgs: 0,
      maxArgs: 0,
    },
    KILLCALLMOB: {
      syntax: 'KillCallMob 宝宝名字 [数量] [方式(0:触发脚本;1:直接消失)]',
      description: '杀死或直接移除自己的指定宝宝',
      params: ['宝宝名字', '[数量]', '[方式(0:触发脚本;1:直接消失)]'],
      minArgs: 1,
      maxArgs: 3,
    },
    KILLMONBURSTRATE: {
      syntax: 'KILLMONBURSTRATE 倍率 有效时间(秒)',
      description: '设置人物杀怪爆率倍率及有效时间，实际倍率为参数除以 100',
      params: ['倍率', '有效时间(秒)'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/人物杀怪暴率倍数.html',
      sourceTitle: '人物杀怪暴率倍数',
    },
    KILLMONEXPRATE: {
      syntax: 'KILLMONEXPRATE 倍率 有效时间(秒)',
      description: '设置人物杀怪经验倍率及有效时间，实际倍率为参数除以 100',
      params: ['倍率', '有效时间(秒)'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/设置杀怪经验倍数.htm',
      sourceTitle: '设置杀怪经验倍数',
    },
    MAKEPOSION: {
      syntax: 'MAKEPOSION 状态类型 时间(秒) [威力]',
      description: '为人物施加指定状态并设置持续时间；部分状态可以设置威力',
      params: ['状态类型', '时间(秒)', '[威力]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/改变人物状态.html',
      sourceTitle: '改变人物状态',
    },
    MAPKILLMONEXPRATE: {
      syntax: 'MAPKILLMONEXPRATE 地图文件名(*:所有地图) 倍率',
      description: '设置地图杀怪经验倍率，实际倍率为参数除以 100，0 表示关闭',
      params: ['地图文件名(*:所有地图)', '倍率'],
      minArgs: 2,
      maxArgs: 2,
    },
    MISSION: {
      syntax: 'MISSION 地图 坐标X 坐标Y',
      description: '设置怪物攻城的集中位置',
      params: ['地图', '坐标X', '坐标Y'],
      minArgs: 3,
      maxArgs: 3,
    },
    MONEY: {
      syntax: 'MONEY 货币名称 操作符(+/-/=) 数量',
      description: '调整人物的指定货币数量',
      params: ['货币名称', '操作符(+/-/=)', '数量'],
      minArgs: 3,
      maxArgs: 3,
    },
    MONGENEX: {
      syntax: 'MonGenEx 地图文件名 X Y 怪物名称 范围 数量 是否内功怪物(0/1) 名称颜色(0-255) [国家名称] [同国玩家可否攻击(0/1)]',
      description: '在指定地图坐标范围内刷新怪物；最后两个国家怪物参数可省略',
      params: ['地图文件名', 'X', 'Y', '怪物名称', '范围', '数量', '是否内功怪物(0/1)', '名称颜色(0-255)', '[国家名称]', '[同国玩家可否攻击(0/1)]'],
      minArgs: 8,
      maxArgs: 10,
    },
    MONTHOFYEAR: {
      syntax: 'MONTHOFYEAR 起始月(1-12) [结束月(1-12)]',
      description: '检测当前是指定月份或月份范围',
      params: ['起始月(1-12)', '[结束月(1-12)]'],
      minArgs: 1,
      maxArgs: 2,
    },
    MUL: {
      syntax: 'MUL 结果变量 乘数1 乘数2',
      description: '计算两个乘数的乘积并将结果写入目标变量',
      params: ['结果变量', '乘数1', '乘数2'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/乘法.htm',
      sourceTitle: '乘法',
    },
    NOT: {
      syntax: 'NOT 检测命令及参数',
      description: '对后续检测命令的结果取反',
      params: ['检测命令及参数'],
      minArgs: 1,
    },
    OPENBIGDIALOGBOX: {
      syntax: 'OpenBigDialogBox WIL文件编号 图片编号',
      description: '使用指定 WIL 文件和图片打开自定义 NPC 对话框',
      params: ['WIL文件编号', '图片编号'],
      minArgs: 2,
      maxArgs: 2,
    },
    PLAYMP3: {
      syntax: 'PlayMP3 MP3网址或本地文件名',
      description: '播放网络 MP3，或播放客户端 Music 目录中的同名本地 MP3',
      params: ['MP3网址或本地文件名'],
      minArgs: 1,
      maxArgs: 1,
    },
    PLAYEFFECT: {
      syntax: 'PLAYEFFECT WIL序号 开始图片 图片张数 播放次数 播放速度(毫秒) [绘制模式(0:特效;1:普通)] [X] [Y] [播放顺序(0:角色上层;1:角色下层)] [ID组]',
      description: '在人物或怪物位置播放补丁图片特效，可设置绘制方式、偏移、层级和 ID 组',
      params: ['WIL序号', '开始图片', '图片张数', '播放次数', '播放速度(毫秒)', '[绘制模式(0:特效;1:普通)]', '[X]', '[Y]', '[播放顺序(0:角色上层;1:角色下层)]', '[ID组]'],
      minArgs: 5,
      maxArgs: 10,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/播放人物效果PLAYEFFECT.htm',
      sourceTitle: '播放人物效果PLAYEFFECT',
    },
    POWERRATE: {
      syntax: 'POWERRATE 倍率 有效时间(秒)',
      description: '设置人物攻击力倍率及有效时间，实际倍率为参数除以 100',
      params: ['倍率', '有效时间(秒)'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/设置攻击力倍数[!].htm',
      sourceTitle: '设置攻击力倍数',
    },
    PRINTUSETIME: {
      syntax: 'PRINTUSETIME 模式(1:开始计时;2:结束并输出)',
      description: '统计并输出一段脚本的执行耗时，单位为微秒',
      params: ['模式(1:开始计时;2:结束并输出)'],
      minArgs: 1,
      maxArgs: 1,
    },
    RECALLMOB: {
      syntax: 'RECALLMOB 怪物名称 宝宝等级(0-7) 叛变时间(分钟) [自动变色(0/1)] [固定颜色(1-7)]',
      description: '召唤指定怪物为宝宝；设置固定颜色时自动变色必须为 0',
      params: ['怪物名称', '宝宝等级(0-7)', '叛变时间(分钟)', '[自动变色(0/1)]', '[固定颜色(1-7)]'],
      minArgs: 3,
      maxArgs: 5,
    },
    RELEASEMAGIC: {
      syntax: 'releasemagic 技能ID 强化标记(0/1) 技能等级 目标(1:攻击目标;2:自身;6:鼠标位置) [无技能动作(0/1)]',
      description: '无需蓝药、毒符或已学技能，直接释放技能',
      params: ['技能ID', '强化标记(0/1)', '技能等级', '目标(1:攻击目标;2:自身;6:鼠标位置)', '[无技能动作(0/1)]'],
      minArgs: 4,
      maxArgs: 5,
    },
    SCREENEFFECT: {
      syntax: 'SCREENEFFECT 屏幕X 屏幕Y WIL序号 开始图片 图片张数 播放次数 播放速度(毫秒) 播放效果(0:普通;1:魔法) [发送模式(0:自己;1:所有人)] [ID组]',
      description: '在屏幕指定坐标播放补丁图片效果，可选择发送范围和用于清除的 ID 组',
      params: ['屏幕X', '屏幕Y', 'WIL序号', '开始图片', '图片张数', '播放次数', '播放速度(毫秒)', '播放效果(0:普通;1:魔法)', '[发送模式(0:自己;1:所有人)]', '[ID组]'],
      minArgs: 8,
      maxArgs: 10,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/在屏幕上播放魔法效果[!].htm',
      sourceTitle: '在屏幕上播放魔法效果',
    },
    REMOVELISTBYCONTENT: {
      syntax: 'REMOVELISTBYCONTENT 数组变量 元素内容 区分大小写(0:不区分;1:区分)',
      description: '根据元素内容删除数组中的匹配项',
      params: ['数组变量', '元素内容', '区分大小写(0:不区分;1:区分)'],
      minArgs: 3,
      maxArgs: 3,
    },
    REPLACELISTBYINDEX: {
      syntax: 'REPLACELISTBYINDEX 数组变量 替换值 数组下标',
      description: '按数组下标替换指定 L$ 数组中的元素',
      params: ['数组变量', '替换值', '数组下标'],
      minArgs: 3,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/新增功能/L$数组变量系统功能.htm',
      sourceTitle: 'L$数组变量系统功能',
    },
    SENDMSG: {
      syntax: 'SENDMSG 信息类型代码 [字体颜色(0-255)] [背景颜色(0-255)] 信息内容',
      description: '通过 NPC 发送信息，信息内容支持 %s（人物名）、%d（NPC 名）和 %ServerName（区名）',
      params: ['信息类型代码', '[字体颜色(0-255)]', '[背景颜色(0-255)]', '信息内容'],
      minArgs: 2,
      maxArgs: 4,
    },
    SENDCENTERMSG: {
      syntax: 'SendCenterMsg 前景色 背景色 消息文字 模式(0-6) 显示时间 [倒计时标签]',
      description: '在屏幕中央发送大字体消息，可按个人、全服、行会、国家、地图、替换或跨服模式发送',
      params: ['前景色', '背景色', '消息文字', '模式(0-6)', '显示时间', '[倒计时标签]'],
      minArgs: 5,
      maxArgs: 6,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/发送屏幕中间大字体信息[!].htm',
      sourceTitle: '发送屏幕中间大字体信息',
    },
    SENDMOVEMSG: {
      syntax: 'SENDMOVEMSG 发送类型(0:全服;1:个人;2:跨服) 字体颜色(0-255) 背景颜色(0-255) Y坐标 滚动次数 信息内容 [滚动速度]',
      description: '发送横向屏幕滚动信息，消息内容中可以使用 %ServerName 显示区名称',
      params: ['发送类型(0:全服;1:个人;2:跨服)', '字体颜色(0-255)', '背景颜色(0-255)', 'Y坐标', '滚动次数', '信息内容', '[滚动速度]'],
      minArgs: 6,
      maxArgs: 7,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/发送屏幕滚动信息.html',
      sourceTitle: '发送屏幕滚动信息',
    },
    SENDVERTICALMOVEMSG: {
      syntax: 'SENDVERTICALMOVEMSG 文字信息 文字颜色 背景颜色 Y坐标 滚动次数 发送模式(0:全服;1:个人;2:跨服)',
      description: '发送向上滚动的多行屏幕信息，文字使用反斜杠换行并支持 %ServerName 区名占位符',
      params: ['文字信息', '文字颜色', '背景颜色', 'Y坐标', '滚动次数', '发送模式(0:全服;1:个人;2:跨服)'],
      minArgs: 6,
      maxArgs: 6,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/在屏幕上显示向上滚动信息.htm',
      sourceTitle: '在屏幕上显示向上滚动信息',
    },
    SETITEMSLIGHT: {
      syntax: 'SetItemsLight 位置(0-12) 发光值(0-2)',
      description: '设置指定装备位置的发光效果：0 不发光，1 使用效果 1，2 使用效果 2；衣服、武器和头盔不支持',
      params: ['位置(0-12)', '发光值(0-2)'],
      minArgs: 2,
      maxArgs: 2,
    },
    SETITEMSTATE: {
      syntax: 'SetItemState 装备位置(-1~18或30~41) 项目(0-7) 状态(0:正常;1:绑定)',
      description: '设置装备的丢弃、交易、存放、修理、出售、爆出、丢弃消失或死亡必爆状态；位置 -1 表示 OK 框中物品',
      params: ['装备位置(-1~18或30~41)', '项目(0-7)', '状态(0:正常;1:绑定)'],
      minArgs: 3,
      maxArgs: 3,
    },
    SETITEMFLAG: {
      syntax: 'SetItemFlag 装备位置 标识(1-32) [状态(0:清除;1:添加)]',
      description: '为指定位置物品添加或清除唯一标识，省略状态时清除标识',
      params: ['装备位置', '标识(1-32)', '[状态(0:清除;1:添加)]'],
      minArgs: 2,
      maxArgs: 3,
      sourcePage: '游戏引擎反外挂系统/新增功能/物品添加标记.htm',
      sourceTitle: '物品添加标记',
    },
    SETSUCKDAMAGE: {
      syntax: 'SetSuckDamage 操作符(+/-/=) 总吸收值(1-2000000000) 吸收比例(1-1000) 成功率(1-100)',
      description: '设置人物伤害吸收总值、每次吸收比例和触发成功率',
      params: ['操作符(+/-/=)', '总吸收值(1-2000000000)', '吸收比例(1-1000)', '成功率(1-100)'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/兼容HeroM2/功能操作命令/设置人物伤害吸收.htm',
      sourceTitle: '设置人物伤害吸收',
    },
    SETSKILLPOWER: {
      syntax: 'SetSkillPower 技能ID 操作符(+/-/=) 人物伤害百分比 人物伤害值 怪物伤害百分比 怪物伤害值 防御百分比 防御值 时间(秒;-1:一直有效)',
      description: '设置指定技能对人物、怪物的伤害和防御加成',
      params: ['技能ID', '操作符(+/-/=)', '人物伤害百分比', '人物伤害值', '怪物伤害百分比', '怪物伤害值', '防御百分比', '防御值', '时间(秒;-1:一直有效)'],
      minArgs: 9,
      maxArgs: 9,
    },
    SKILLLEVEL: {
      syntax: 'SKILLLEVEL 技能名称 操作符(+/-/=) 等级 [调整强化技能(0/1)]',
      description: '调整指定技能的普通或强化等级',
      params: ['技能名称', '操作符(+/-/=)', '等级', '[调整强化技能(0/1)]'],
      minArgs: 3,
      maxArgs: 4,
    },
    SETONTIMER: {
      syntax: 'SetOnTimer 定时器索引(0-255) 间隔秒数 [执行次数(0:无限)] [跨服继续执行(0/1)]',
      description: '启动个人定时器，到期触发 QManage.txt 中对应的 [@OnTimerX]',
      params: ['定时器索引(0-255)', '间隔秒数', '[执行次数(0:无限)]', '[跨服继续执行(0/1)]'],
      minArgs: 2,
      maxArgs: 4,
    },
    SORTLIST: {
      syntax: 'SORTLIST 待排序数组 接收变量 [排序方式(0:升序;1:降序)] [排序依据(0:数值;1:文本)]',
      description: '对数组排序并写入接收变量；数组元素必须全为数字或全为文本',
      params: ['待排序数组', '接收变量', '[排序方式(0:升序;1:降序)]', '[排序依据(0:数值;1:文本)]'],
      minArgs: 2,
      maxArgs: 4,
    },
    SORTVARTOLIST: {
      syntax: 'SortVarToList 自定义变量名 变量文件路径 排序结果路径 排序方式(0/1) 保存格式(0:仅人物名;1:人物名和变量值)',
      description: '按自定义变量值排序人物，并将排序结果保存到指定列表文件',
      params: ['自定义变量名', '变量文件路径', '排序结果路径', '排序方式(0/1)', '保存格式(0:仅人物名;1:人物名和变量值)'],
      minArgs: 5,
      maxArgs: 5,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/自定义变量按变量值大小排序[!].htm',
      sourceTitle: '自定义变量按变量值大小排序',
    },
    TAKEOFFITEM: {
      syntax: 'TakeOffItem 装备位置(0-16)',
      description: '自动脱下指定位置的装备',
      params: ['装备位置(0-16)'],
      minArgs: 1,
      maxArgs: 1,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/自动穿取装备.htm',
      sourceTitle: '自动穿取装备',
    },
    TAKEONITEM: {
      syntax: 'TakeOnItem 装备名称 装备位置(0-16)',
      description: '将包裹中的指定装备自动穿到对应位置',
      params: ['装备名称', '装备位置(0-16)'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/自动穿取装备.htm',
      sourceTitle: '自动穿取装备',
    },
    TEXTLENGTH: {
      syntax: 'TEXTLENGTH 字符串 保存变量',
      description: '取字符串长度并写入指定变量，一个汉字按两个字符计算',
      params: ['字符串', '保存变量'],
      minArgs: 2,
      maxArgs: 2,
    },
    THROUGHHUM: {
      syntax: 'THROUGHHUM 模式(-1:恢复;0:穿人穿怪;1:穿怪;2:穿人) 时间(秒)',
      description: '临时改变人物的穿人和穿怪模式',
      params: ['模式(-1:恢复;0:穿人穿怪;1:穿怪;2:穿人)', '时间(秒)'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/穿人模式[!].htm',
      sourceTitle: '穿人模式',
    },
    UPGRADEITEMEX: {
      syntax: 'UPGRADEITEMEX 物品位置(0-47) 属性位置(0-14) 成功机率(0-100) 点数机率(0-255) 是否破碎(0/1)',
      description: '按指定成功机率和点数机率升级身上装备属性，并设置失败时是否破碎',
      params: ['物品位置(0-47)', '属性位置(0-14)', '成功机率(0-100)', '点数机率(0-255)', '是否破碎(0/1)'],
      minArgs: 5,
      maxArgs: 5,
      sourcePage: '游戏引擎反外挂系统/功能操作命令/装备升级功能.htm',
      sourceTitle: '装备升级功能',
    },
    UPDATENGRESET: {
      syntax: 'UPDATENGRESET [控件ID]',
      description: '还原脚本上次修改前的内挂控件状态；省略控件 ID 时还原全部脚本修改',
      params: ['[控件ID]'],
      minArgs: 0,
      maxArgs: 1,
    },
    CHANGECUSTOMITEMTEXT: {
      syntax: 'CHANGECUSTOMITEMTEXT 装备位置 文字内容',
      description: '修改指定装备的自定义文字内容',
      params: ['装备位置', '文字内容'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
    CHANGECUSTOMITEMTEXTCOLOR: {
      syntax: 'CHANGECUSTOMITEMTEXTCOLOR 装备位置 文字颜色(0-255)',
      description: '修改指定装备自定义文字的显示颜色',
      params: ['装备位置', '文字颜色(0-255)'],
      minArgs: 2,
      maxArgs: 2,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
    CHECKCUSTOMITEMVALUE: {
      syntax: 'CHECKCUSTOMITEMVALUE 装备位置 属性位置(0-19) 检测符(>/< /=) 值',
      description: '检测指定装备的自定义属性值',
      params: ['装备位置', '属性位置(0-19)', '检测符(>/< /=)', '值'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
    CHECKCUSTOMITEMVALUETYPE: {
      syntax: 'CHECKCUSTOMITEMVALUETYPE 装备位置 属性位置(0-19) 检测符(>/< /=) 绑定属性类型(0-17)',
      description: '检测指定装备自定义属性的绑定类型',
      params: ['装备位置', '属性位置(0-19)', '检测符(>/< /=)', '绑定属性类型(0-17)'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
    CHANGECUSTOMITEMVALUE: {
      syntax: 'CHANGECUSTOMITEMVALUE 装备位置 属性位置(0-19) 操作符(+/-/=) 值',
      description: '修改指定装备的自定义属性值',
      params: ['装备位置', '属性位置(0-19)', '操作符(+/-/=)', '值'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
    CHANGECUSTOMITEMABIL: {
      syntax: 'CHANGECUSTOMITEMABIL 装备位置 属性位置(0-19) 修改类型 参数值',
      description: '按修改类型调整指定装备的自定义属性',
      params: ['装备位置', '属性位置(0-19)', '修改类型', '参数值'],
      minArgs: 4,
      maxArgs: 4,
      sourcePage: '游戏引擎反外挂系统/游戏功能详解/自定义装备属性 自定义装备文本.html',
      sourceTitle: '自定义装备属性 自定义装备文本',
    },
  },
};

const confirmedNoArgumentCommands = {
  GOM: new Set([
    'BREAK',
    'BREAKTIMERECALL',
    'CHECKAUTOPLAYGAME',
    'CHECKINWARAREA',
    'CHECKOFFLINE',
    'CHECKONHORSE',
    'CHECKREADSKILLNG',
    'CHECKSHOPSTALLSTATUS',
    'CLEARALLPULSE',
    'CLEARPASSWORD',
    'CLEARSKILL',
    'CLOSEBIGDIALOGBOX',
    'CLOSEMERCHANTBIGDLG',
    'CLOSEMSGWINDOWS',
    'DELNOJOBSKILL',
    'GETCHALLENGEBAKITEM',
    'ISGROUPMASTER',
    'KICK',
    'KICKALLPLAY',
    'KICKOFFLINE',
    'READSKILLNG',
    'REALIVE',
    'RECLAIMITEM',
    'REPAIRALL',
    'SETUPGRADEFAIL',
    'TAKEDLGITEM',
    'TAKEHERO',
  ]),
  GEE: new Set([
    'BREAK',
    'BREAKTIMERECALL',
    'CHECKHEROOPENOPULSE',
    'CHECKINWARAREA',
    'CHECKISMASTER',
    'CHECKISPRENTICE',
    'CHECKOFFLINE',
    'CHECKONHORSE',
    'CHECKPOSEISMASTER',
    'CHECKPOSEISPRENTICE',
    'CHECKREADSKILLNG',
    'CHECKSHOPSTALLSTATUS',
    'CLEARALLPULSE',
    'CLEARHUMGROUPITEMRATES',
    'CLEARPASSWORD',
    'CLEARSKILL',
    'CLOSEBIGDIALOGBOX',
    'CLOSEMERCHANTBIGDLG',
    'CLOSEMSGWINDOWS',
    'DELNOJOBSKILL',
    'GETCHALLENGEBAKITEM',
    'H.OPENPULSE',
    'H.RESTRENEWLEVEL',
    'HEROLOGINOUT',
    'ISGROUPMASTER',
    'POSEHAVEMASTER',
    'POSEHAVEPRENTICE',
    'READSKILLNG',
    'REALIVE',
    'RECLAIMITEM',
    'SETUPGRADEFAIL',
    'TAKEDLGITEM',
    'TAKEHERO',
  ]),
  '996PC': new Set([
    'BREAK',
    'BREAKTIMERECALL',
    'CHECKHEROONLINE',
    'CHECKINWARAREA',
    'CHECKOFFLINE',
    'CHECKONHORSE',
    'CHECKSHOPSTALLSTATUS',
    'CLOSEBIGDIALOGBOX',
    'CLOSEMSGWINDOWS',
    'GETCHALLENGEBAKITEM',
    'H.CHECKONLINE',
    'INSAFEZONE',
    'ISGROUPMASTER',
    'KICK',
    'KICKALLPLAY',
    'KICKOFFLINE',
    'REALIVE',
    'RECLAIMITEM',
    'REPAIRALL',
    'SETUPGRADEFAIL',
    'TAKEDLGITEM',
  ]),
};

const removedCatalogCommands = {
  GOM: new Set(),
  GEE: new Set(['CHECKITEMBIND', 'SETITEMBIND']),
  '996PC': new Set(['CLOSEMERCHANTBIGDLG']),
};

const removedEngineCommands = {
  GOM: new Set(),
  GEE: new Set(),
  '996PC': new Set(['CLOSEMERCHANTBIGDLG']),
};

const triggerDescriptions = {
  ATTACK: '人物进行普通攻击时触发',
  ATTACKDAMAGE: '人物被攻击并扣除伤害前触发',
  BEFOREROUTE: '人物进入地图连接点前触发',
  BEGINBUYUSERITEM: '人物购买个人商店物品前触发',
  BEGINTAKEOFF: '人物脱下装备前触发',
  BEGINTAKEON: '人物穿戴装备前触发',
  BEGINWEAPONUNLOCK: '人物武器被诅咒前触发',
  BLASTHIT: '人物造成暴击时触发',
  BUFF2CLOSE: '增益类药品状态消失时触发，Param1 表示状态类型',
  BUFF2OPEN: '增益类药品状态增加时触发，Param1 表示状态类型',
  BUFFCLOSE: '持续类技能状态消失时触发',
  BUYSHOPITEM: '人物购买商铺物品时触发',
  BUYUSERSHOPITEM: '人物购买个人商店物品后触发',
  CLOSEPROC: 'M2 确认关闭后、踢人和关闭网关前触发',
  CONFIRMAPPLYGUILD: '人物申请加入行会前触发',
  CONFIRMGUILDADDMEMBER: '行会确认添加成员前触发',
  CONFIRMMOVE: '人物使用传送命令前触发',
  CONFIRMSHOPITEMDOWN: '个人商店物品下架前触发，可允许或禁止下架',
  CONFIRMSHOPITEMUP: '个人商店物品上架前触发，可允许或禁止上架',
  CREATEMYSHOPFAIL: '创建个人商店失败时触发',
  CREATEMYSHOPOK: '创建个人商店成功时触发',
  CRITTRIGGER: '人物造成暴击时触发',
  DROPITEMEX: '人物扔掉任意物品后触发',
  DROPITEMFRONTEX: '人物扔掉任意物品前触发',
  DROPITEMFRONTXX: '人物扔掉指定 IDX 物品前触发',
  DROPITEMX: '人物扔掉指定 IDX 物品时触发，X 为物品 IDX',
  DROPITEMXX: '人物扔掉指定 IDX 物品后触发',
  ENTERMAP: '人物切换地图时触发',
  GETCASTLEX: '行会占领指定城堡时触发，X 为城堡编号',
  GETEXP: '人物获得经验时触发',
  GETUSERSHOPITEMMONEY: '个人商店卖家取款时触发',
  GROUPADDMEMBER: '队伍添加成员时触发',
  GROUPCREATE: '创建队伍时触发',
  GROUPDELMEMBER: '队伍删除成员时触发',
  GROUPITEMOFFX: '人物失去指定套装效果时触发',
  GROUPITEMONX: '人物激活指定套装效果时触发',
  GROUPKILLMON: '队伍成员杀死怪物时触发',
  GROUPMEMBERLEAVE: '队伍成员离开队伍时触发',
  GUILDADDMEMBER: '人物加入行会后触发',
  GUILDDELMEMBER: '人物离开行会后触发',
  HELP: '人物点击界面帮助按钮时触发',
  HEROBEGINTAKEOFF: '英雄脱下装备前触发',
  HEROBEGINTAKEON: '英雄穿戴装备前触发',
  HERODROPITEMEX: '英雄扔掉任意物品后触发',
  HERODROPITEMFRONTEX: '英雄扔掉任意物品前触发',
  HERODROPITEMFRONTXX: '英雄扔掉指定 IDX 物品前触发',
  HERODROPITEMXX: '英雄扔掉指定 IDX 物品后触发',
  HEROGROUPITEMOFFX: '英雄失去指定套装效果时触发',
  HEROGROUPITEMONX: '英雄激活指定套装效果时触发',
  HEROTAKEOFFEX: '英雄脱下装备时触发',
  HEROTAKEOFFEXCHANGE: '英雄脱下装备进入包裹前触发',
  HEROTAKEONEX: '英雄穿戴装备时触发',
  HUMDROPITEM: '人物掉落身上物品时触发',
  KILLMON: '人物杀死怪物时触发',
  KILLPLAY: '人物杀死其他人物时触发',
  KILLSLAVE: '人物杀死其他人物的宝宝时触发',
  LEAVEGROUP: '当前人物离开队伍时触发',
  LOADGUILD: '行会数据初始化时触发',
  LOGIN: '人物登录服务器时执行的脚本入口',
  MAGICATTACK: '人物使用魔法攻击时触发',
  MAGICSTRUCK: '人物受到魔法攻击时触发',
  MAGICX: '人物使用指定魔法时触发，X 为技能标识',
  MAGMONFUNCX: '技能命中怪物时调用的脚本触发',
  MAGSELFFUNCX: '技能对自身生效时调用的脚本触发',
  MAGTAGFUNCEXX: '扩展技能目标触发，X 为技能标识',
  MAGTAGFUNCX: '技能对目标生效时调用的脚本触发',
  MOBTREACHERY: '自己的宝宝叛变时触发',
  MONDROPITEMEX: '怪物掉落任意物品前触发',
  MONDROPITEMXX: '怪物掉落指定 IDX 物品前触发',
  ONKILLMOB: '人物杀死怪物时触发',
  PICKUPDROPITEMEX: '人物包裹物品掉落到地面前触发',
  PICKUPITEMEX: '人物捡取任意物品后触发',
  PICKUPITEMFRONTEX: '人物捡取任意物品前触发',
  PICKUPITEMFRONTXX: '人物捡取指定 IDX 物品前触发',
  PICKUPITEMX: '人物捡取指定 IDX 物品时触发，X 为物品 IDX',
  PICKUPITEMXX: '人物捡取指定 IDX 物品后触发',
  PLAYDIE: '人物死亡时触发',
  PLAYLEVELUP: '人物升级时触发',
  PLAYOFFLINE: '人物大退离线时触发',
  PLAYRECONNECTION: '人物小退重连时触发',
  QUERYMYSHOPFAIL: '查询个人商店失败时触发',
  QUERYUSERSTATE: '查看其他人物装备时触发',
  REVIVAL: '人物复活时触发',
  RUN: '人物跑步时触发',
  SAVESTORAGEITEM: '人物将物品存入仓库时触发',
  SCATTERBAGITEMS: '人物包裹物品被爆出时触发',
  SHOPSTALL: '人物进入摆摊状态时触发',
  SHOWGAMEVALIDATEDLG: '引擎弹出验证码窗口时触发',
  SLAVEATTACK: '宝宝进行普通攻击时触发',
  SLAVEDIE: '自己的宝宝死亡时触发',
  SLAVEMAGICATTACK: '宝宝使用魔法攻击时触发',
  SLAVEMAGICSTRUCK: '宝宝受到魔法攻击时触发',
  SLAVESTRUCK: '宝宝受到普通攻击时触发',
  SOFTCLOSE: '人物小退前触发',
  STARTGROUP: '人物开始组队时触发',
  STARTMYSHOP: '人物开始摆摊前触发',
  STARTUP: 'M2 启动完成后触发',
  STDMODEFUNCX: '使用指定 StdMode 物品时触发，X 为 StdMode',
  STRUCK: '人物受到普通攻击时触发',
  STRUCKDAMAGE: '人物被攻击并扣除伤害前触发',
  TAKEOFF0: '人物脱下指定位置装备后触发',
  TAKEOFFBEFOREEX: '人物脱下任意装备前触发',
  TAKEOFFBEFOREX: '人物脱下指定位置装备前触发',
  TAKEOFFEX: '人物脱下任意装备后触发',
  TAKEOFFEXCHANGE: '人物脱下装备进入包裹前触发',
  TAKEON0: '人物穿戴指定位置装备后触发',
  TAKEONBEFOREEX: '人物穿戴任意装备前触发',
  TAKEONBEFOREX: '人物穿戴指定位置装备前触发',
  TAKEONEX: '人物穿戴任意装备后触发',
  TAKESTORAGEITEM: '人物从仓库取出物品时触发',
  USEPLUGIN: '客户端外挂或插件相关事件触发',
  WALK: '人物走路时触发',
};

function findCaseInsensitive(object, name) {
  const key = Object.keys(object).find(candidate => (
    candidate.toUpperCase() === name.toUpperCase()
  ));
  return key ? [key, object[key]] : null;
}

function overrideSource(current, override) {
  if (!override.sourcePage) return current;
  return {
    ...(current || {}),
    revision: override.sourceRevision || '2026-07-26',
    page: override.sourcePage,
    ...(override.sourceTitle ? { title: override.sourceTitle } : {}),
  };
}

function applyCatalogOverride(catalog, name, override) {
  const found = findCaseInsensitive(catalog, name);
  if (!found) return false;
  const [key, entry] = found;
  const verified = override.verified !== false;
  catalog[key] = {
    ...entry,
    syntax: override.syntax,
    details: override.description,
    params: override.params.join(' '),
    paramList: [...override.params],
    completionVerified: verified,
    completionEnabled: verified,
    diagnosticSupported: true,
    completionReview: verified
      ? 'final-own-help-manual-exact'
      : 'final-own-help-name-only-disabled',
    source: overrideSource(entry.source, override),
  };
  if (override.minArgs === undefined) delete catalog[key].minArgs;
  else catalog[key].minArgs = override.minArgs;
  if (override.maxArgs === undefined) delete catalog[key].maxArgs;
  else catalog[key].maxArgs = override.maxArgs;
  if (Array.isArray(override.aliases)) catalog[key].aliases = [...override.aliases];
  return true;
}

function applySharedOverride(commands, engine, name, override) {
  const entry = [...commands.commands, ...commands.execCommands].find(candidate => (
    candidate.name.toUpperCase() === name.toUpperCase()
  ));
  const variant = entry?.engineVariants?.[engine];
  if (!variant) return false;
  const verified = override.verified !== false;
  Object.assign(variant, {
    syntax: override.syntax,
    description: override.description,
    params: [...override.params],
    completionVerified: verified,
    completionEnabled: verified,
    diagnosticSupported: true,
    completionReview: verified
      ? 'final-own-help-manual-exact'
      : 'final-own-help-name-only-disabled',
    source: overrideSource(variant.source, override),
  });
  if (override.minArgs === undefined) delete variant.minArgs;
  else variant.minArgs = override.minArgs;
  if (override.maxArgs === undefined) delete variant.maxArgs;
  else variant.maxArgs = override.maxArgs;
  if (Array.isArray(override.aliases)) variant.aliases = [...override.aliases];
  return true;
}

function normalizeCommandName(value) {
  return String(value || '').trim().toUpperCase();
}

function isNameOnlySyntax(name, syntax) {
  return normalizeCommandName(syntax || name) === normalizeCommandName(name);
}

function isExactNoArgumentOverride(engine, name) {
  const found = findCaseInsensitive(commandOverrides[engine] || {}, name);
  if (!found) return false;
  const override = found[1];
  return override.verified !== false && override.params.length === 0;
}

function applyNameOnlyState(entry, engine, name) {
  if (!isNameOnlySyntax(name, entry.syntax)) return null;
  const normalizedName = normalizeCommandName(name);
  const confirmed = confirmedNoArgumentCommands[engine]?.has(normalizedName)
    || isExactNoArgumentOverride(engine, normalizedName);
  if (confirmed) {
    entry.params = Array.isArray(entry.params) ? [] : '';
    if (Object.prototype.hasOwnProperty.call(entry, 'paramList')) entry.paramList = [];
    entry.minArgs = 0;
    entry.maxArgs = 0;
    entry.completionVerified = true;
    entry.completionEnabled = true;
    entry.diagnosticSupported = true;
    entry.completionReview = 'final-own-help-confirmed-no-arg';
    return 'confirmed';
  }

  entry.params = Array.isArray(entry.params) ? [] : '';
  if (Object.prototype.hasOwnProperty.call(entry, 'paramList')) entry.paramList = [];
  delete entry.minArgs;
  delete entry.maxArgs;
  entry.completionVerified = false;
  entry.completionEnabled = false;
  entry.diagnosticSupported = true;
  entry.completionReview = 'final-own-help-name-only-disabled';
  const neutralDescription = '当前引擎帮助文档收录了此命令名，但未提供可逐项核对的完整参数格式';
  if (Object.prototype.hasOwnProperty.call(entry, 'details')) entry.details = neutralDescription;
  else entry.description = neutralDescription;
  return 'disabled';
}

function applyNameOnlyPolicy(commands, catalogs) {
  const changed = { confirmed: 0, disabled: 0 };
  for (const entry of [...commands.commands, ...commands.execCommands]) {
    for (const engine of entry.engines || []) {
      const variant = entry.engineVariants?.[engine];
      if (!variant?.name) continue;
      const status = applyNameOnlyState(variant, engine, variant.name);
      if (status) changed[status]++;
    }
  }
  for (const [engine, catalog] of Object.entries(catalogs)) {
    for (const [name, entry] of Object.entries(catalog)) {
      const status = applyNameOnlyState(entry, engine, name);
      if (status) changed[status]++;
    }
  }
  return changed;
}

function removeUnsupportedCatalogCommands(catalogs) {
  let removed = 0;
  for (const [engine, names] of Object.entries(removedCatalogCommands)) {
    const catalog = catalogs[engine];
    for (const name of names) {
      const found = findCaseInsensitive(catalog, name);
      if (!found) continue;
      delete catalog[found[0]];
      removed++;
    }
  }
  return removed;
}

function removeUnsupportedEngineCommands(commands) {
  let removed = 0;
  for (const [engine, names] of Object.entries(removedEngineCommands)) {
    for (const entry of [...commands.commands, ...commands.execCommands]) {
      if (!names.has(normalizeCommandName(entry.name)) || !entry.engineVariants?.[engine]) continue;
      delete entry.engineVariants[engine];
      entry.engines = (entry.engines || []).filter(candidate => candidate !== engine);
      if (entry.engineSources) delete entry.engineSources[engine];
      removed++;
    }
  }
  return removed;
}

function main() {
  const commands = readJson('data/commands.json');
  const catalogs = {
    GOM: readJson('data/functions.json'),
    GEE: readJson('data/functions-gee.json'),
    '996PC': readJson('data/functions-996pc.json'),
  };
  const changed = {
    commands: 0,
    catalogs: 0,
    triggers: 0,
    removedUnsupported: 0,
    removedEngineVariants: 0,
    nameOnlyConfirmed: 0,
    nameOnlyDisabled: 0,
  };

  changed.removedUnsupported = removeUnsupportedCatalogCommands(catalogs);
  changed.removedEngineVariants = removeUnsupportedEngineCommands(commands);

  for (const [engine, overrides] of Object.entries(commandOverrides)) {
    for (const [name, override] of Object.entries(overrides)) {
      if (applySharedOverride(commands, engine, name, override)) changed.commands++;
      if (applyCatalogOverride(catalogs[engine], name, override)) changed.catalogs++;
    }
  }

  const nameOnly = applyNameOnlyPolicy(commands, catalogs);
  changed.nameOnlyConfirmed = nameOnly.confirmed;
  changed.nameOnlyDisabled = nameOnly.disabled;

  for (const trigger of commands.triggers || []) {
    const description = triggerDescriptions[trigger.name.toUpperCase()];
    if (!description) continue;
    for (const engine of trigger.engines || []) {
      const variant = trigger.engineVariants?.[engine];
      if (!variant) continue;
      if (variant.description && !/^(?:GOM|GEE|996PC)\s*文档[:：]/.test(variant.description)) {
        continue;
      }
      variant.description = description;
      variant.descriptionReview = 'final-own-help-manual';
      changed.triggers++;
    }
  }

  writeJson('data/commands.json', commands);
  writeJson('data/functions.json', catalogs.GOM);
  writeJson('data/functions-gee.json', catalogs.GEE);
  writeJson('data/functions-996pc.json', catalogs['996PC']);
  console.log(JSON.stringify(changed, null, 2));
}

if (require.main === module) main();

module.exports = {
  commandOverrides,
  confirmedNoArgumentCommands,
  removedCatalogCommands,
  removedEngineCommands,
  triggerDescriptions,
};
