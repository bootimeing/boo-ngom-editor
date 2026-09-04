const revision = '2026-08-24';

function parameter(key, description, aliases) {
  return {
    ...(key ? { key } : {}),
    description,
    ...(aliases?.length ? { aliases } : {}),
  };
}

function source(page) {
  return { revision, page };
}

function variant(label, snippet, description, page, parameters) {
  return { label, snippet, description, source: source(page), parameters };
}

function positional(label, snippet, description, page, meanings) {
  return variant(
    label,
    snippet,
    description,
    page,
    meanings.map(meaning => parameter(undefined, meaning))
  );
}

const common996Parameters = [
  parameter('id', '元素ID；同一界面不可重复'),
  parameter('children', '子节点ID列表，格式为 {1,2,3}'),
  parameter('link', '单击响应的脚本标签；帮助要求触发字段放在最后'),
  parameter('a', '显示位置：0左上、1右上、2左下、3右下、4居中、7上下居中、8左右居中'),
  parameter('ax', '锚点X'),
  parameter('ay', '锚点Y'),
  parameter('x', '坐标X'),
  parameter('y', '坐标Y'),
  parameter('percentx', '百分比坐标X'),
  parameter('percenty', '百分比坐标Y', ['pencenty']),
  parameter('width', '宽度'),
  parameter('height', '高度'),
  parameter('percentwidth', '百分比宽度'),
  parameter('percentheight', '百分比高度'),
  parameter('color', '颜色值；支持 0-255 及逗号分隔的闪烁颜色'),
  parameter('size', '字体大小'),
];

function withCommon(parameters) {
  const result = [...parameters];
  const keys = new Set(result.map(value => value.key?.toUpperCase()).filter(Boolean));
  for (const value of common996Parameters) {
    if (!keys.has(value.key.toUpperCase())) result.push(value);
  }
  return result;
}

function keyed(label, snippet, description, page, parameters) {
  return variant(label, snippet, description, page, withCommon(parameters));
}

function supplementalSayInterfaceEntries() {
  const gomContainer = '游戏引擎反外挂系统/游戏功能详解/NPC对话框容器.htm';
  const geeContainer = '游戏引擎反外挂系统/游戏功能详解/容器.htm';
  const newNpc = page => `游戏引擎反外挂系统/新NPC界面写法/${page}`;
  const entries = [
    {
      id: 'container-layout',
      engineVariants: {
        GOM: {
          ...positional(
          '<Layout:父子容器:X:Y:宽度:高度:边框颜色>',
          '<Layout:${1:父子容器}:${2:X}:${3:Y}:${4:宽度}:${5:高度}:${6:边框颜色}>',
          '创建可嵌套的 NPC 布局容器',
          gomContainer,
          ['父子容器编号', 'X', 'Y', '宽度', '高度', '边框颜色']
          ),
          markupAliases: ['<&Layout'],
        },
        GEE: {
          ...positional(
          '<Layout:父子容器:X:Y:宽度:高度:边框颜色>',
          '<Layout:${1:父子容器}:${2:X}:${3:Y}:${4:宽度}:${5:高度}:${6:边框颜色}>',
          '创建可嵌套的 NPC 布局容器',
          geeContainer,
          ['父子容器编号', 'X', 'Y', '宽度', '高度', '边框颜色']
          ),
          markupAliases: ['<&Layout'],
        },
      },
    },
    {
      id: 'container-mtext',
      engineVariants: {
        GOM: positional(
          '<MText:父子容器:X:Y:颜色:多行文字>',
          '<MText:${1:父子容器}:${2:X}:${3:Y}:${4:颜色}:${5:第一行|第二行|第三行}>',
          '在 NPC 容器中显示多行文字',
          gomContainer,
          ['父子容器编号', 'X', 'Y', '颜色', '以竖线分隔的多行文字']
        ),
        GEE: positional(
          '<MText:父子容器:X:Y:颜色:多行文字>',
          '<MText:${1:父子容器}:${2:X}:${3:Y}:${4:颜色}:${5:第一行|第二行|第三行}>',
          '在 NPC 容器中显示多行文字',
          geeContainer,
          ['父子容器编号', 'X', 'Y', '颜色', '以竖线分隔的多行文字']
        ),
      },
    },
    {
      id: 'big-number-text',
      engineVariants: {
        GEE: positional(
          '<BigNum:数值:X:Y:{FColor=颜色;FSize=字号;FName=字体}>',
          '<BigNum:${1:数值}:${2:X}:${3:Y}:{FColor=${4:249};FSize=${5:9};FName=${6:微软雅黑}}>',
          '在 NPC 对话框按客户端大数单位规则显示数值',
          '游戏引擎反外挂系统/部分脚本实例/变量显示数字单位.htm',
          ['数值或变量', 'X', 'Y', '文字颜色', '字号', '字体名']
        ),
      },
    },
    {
      id: 'container-newline',
      engineVariants: {
        GOM: positional(
          '<NewLine:父容器>',
          '<NewLine:${1:#L01~}>',
          '在 NPC 容器中强制换行',
          gomContainer,
          ['父容器编号']
        ),
        GEE: positional(
          '<NewLine:父容器>',
          '<NewLine:${1:#L01~}>',
          '在 NPC 容器中强制换行',
          geeContainer,
          ['父容器编号']
        ),
      },
    },
    {
      id: 'container-listview',
      engineVariants: {
        GOM: {
          ...positional(
          '<ListView:父子容器:X:Y:宽度:高度:间隔:默认索引:方向:记录位置:预留4:预留5:WZL:滚动条素材...>',
          '<ListView:${1:父子容器}:${2:X}:${3:Y}:${4:宽度}:${5:高度}:${6:子控件间隔}:${7:默认索引}:${8:方向(0竖向/1横向)}:${9:记录滚动位置}:${10:预留4}:${11:预留5}:${12:滚动条WZL序号}:${13:滚动条背景}:${14:上箭头默认}:${15:上箭头移入}:${16:上箭头按下}:${17:滑块默认}:${18:滑块移入}:${19:滑块按下}:${20:下箭头默认}:${21:下箭头移入}:${22:下箭头按下}>',
          '创建可横向或竖向滚动的 NPC 列表容器；ListView 不可嵌套',
          gomContainer,
          ['父子容器编号', 'X', 'Y', '容器宽度', '容器高度', '子控件间隔', '跳转索引(从0开始)', '方向(0竖向/1横向)', '记录滚动位置(0/1)', '预留4', '预留5', '滚动条WZL序号', '滚动条背景序号', '上箭头默认图片', '上箭头移入图片', '上箭头按下图片', '滑块默认图片', '滑块移入图片', '滑块按下图片', '下箭头默认图片', '下箭头移入图片', '下箭头按下图片']
          ),
          markupAliases: ['<&ListView'],
        },
        GEE: {
          ...positional(
          '<ListView:父子容器:X:Y:宽度:高度:间隔:默认索引:方向:预留3:预留4:预留5:WZL:滚动条素材...>',
          '<ListView:${1:父子容器}:${2:X}:${3:Y}:${4:宽度}:${5:高度}:${6:子控件间隔}:${7:默认索引}:${8:方向(0竖向/1横向)}:${9:预留3}:${10:预留4}:${11:预留5}:${12:滚动条WZL序号}:${13:滚动条背景}:${14:上箭头默认}:${15:上箭头移入}:${16:上箭头按下}:${17:滑块默认}:${18:滑块移入}:${19:滑块按下}:${20:下箭头默认}:${21:下箭头移入}:${22:下箭头按下}>',
          '创建可横向或竖向滚动的 NPC 列表容器；ListView 不可嵌套',
          geeContainer,
          ['父子容器编号', 'X', 'Y', '容器宽度', '容器高度', '子控件间隔', '跳转索引(从0开始)', '方向(0竖向/1横向)', '预留3', '预留4', '预留5', '滚动条WZL序号', '滚动条背景序号', '上箭头默认图片', '上箭头移入图片', '上箭头按下图片', '滑块默认图片', '滑块移入图片', '滑块按下图片', '下箭头默认图片', '下箭头移入图片', '下箭头按下图片']
          ),
          markupAliases: ['<&ListView'],
        },
      },
    },
    {
      id: 'monster-preview',
      engineVariants: {
        GOM: positional(
          '<MONSTER:APPR:RACE:动作:方向:X:Y>',
          '<MONSTER:${1:APPR}:${2:RACE}:${3:动作(0站立/1走/2跑/3攻击/4受击/5死亡/6尸体)}:${4:方向(0-7)}:${5:X}:${6:Y}>',
          '在 NPC 界面显示怪物外观',
          '游戏引擎反外挂系统/游戏功能详解/怪物外形调用到NPC界面.htm',
          ['APPR', 'RACE', '动作', '方向(0-7)', 'X', 'Y']
        ),
        GEE: positional(
          '<MONSTER:RaceImg:Appr:显示方式:方向:X:Y>',
          '<MONSTER:${1:RaceImg}:${2:Appr}:${3:显示方式(0站立首帧/1站立动画/10走路首帧/11走路动画)}:${4:方向(0-7)}:${5:X}:${6:Y}>',
          '在 NPC 界面显示怪物外观',
          '游戏引擎反外挂系统/游戏功能详解/NPC界面调用怪物外观.htm',
          ['RaceImg', 'Appr', '显示方式', '方向(0-7)', 'X', 'Y']
        ),
      },
    },
    {
      id: 'user-item-preview',
      engineVariants: {
        GOM: positional(
          '<UserItem:D:X:Y:Z:W:G:R:H:S:W/@Label>',
          '<UserItem:${1:装备位置}:${2:X}:${3:Y}:${4:背景框}:${5:显示对象}:${6:灰化}:${7:对齐方式}:${8:自定义宽度}:${9:内观素材(0Items/1StdItem)}:${10:绘制特效(0/1)}/@${11:标签}>',
          '在 NPC 对话框显示人物身上装备',
          '游戏引擎反外挂系统/游戏功能详解/NPC对话框调用身上装备信息.htm',
          ['装备位置', 'X', 'Y', '背景框', '显示对象(0自己/1查看目标)', '灰化(0/1)', '对齐方式', '自定义宽度', '内观素材(0 Items/1 StdItem)', '绘制物品特效(0/1)', '触发标签']
        ),
        GEE: positional(
          '<UserItem:D:X:Y:Z:W/@Label>',
          '<UserItem:${1:装备位置}:${2:X}:${3:Y}:${4:背景框}:${5:发光代码}/@${6:标签}>',
          '在 NPC 对话框显示人物身上装备',
          '游戏引擎反外挂系统/部分脚本实例/NPC对话框调用身上装备信息.htm',
          ['装备位置', 'X', 'Y', '背景框', '发光代码', '触发标签']
        ),
      },
    },
    {
      id: 'hero-user-item-preview',
      engineVariants: {
        GEE: positional(
          '<HeroUserItem:D:X:Y:Z:W/@Label>',
          '<HeroUserItem:${1:装备位置}:${2:X}:${3:Y}:${4:背景框}:${5:发光代码}/@${6:标签}>',
          '在 NPC 对话框显示英雄身上装备',
          '游戏引擎反外挂系统/部分脚本实例/NPC对话框调用身上装备信息.htm',
          ['装备位置', 'X', 'Y', '背景框', '发光代码', '触发标签']
        ),
      },
    },
    {
      id: 'makeindex-item-preview',
      engineVariants: {
        GEE: positional(
          '<MakeIndexItem:D:F:X:Y:Z:W:G:U/@Label>',
          '<MakeIndexItem:${1:物品唯一序号}:${2:数量}:${3:X}:${4:Y}:${5:背景框}:${6:发光代码}:${7:灰化}:${8:数量单位}/@${9:标签}>',
          '按物品唯一序号在 NPC 对话框显示背包物品',
          '游戏引擎反外挂系统/部分脚本实例/物品唯一序号调用人物背包物品显示到NPC对话框.htm',
          ['物品唯一序号', '数量', 'X', 'Y', '背景框', '发光代码', '灰化(0/1)', '数量单位(0/1)', '触发标签']
        ),
      },
    },
    {
      id: 'custom-item-preview',
      engineVariants: {
        GEE: positional(
          '<CustomItem:I:F:D:X:Y:S:H>',
          '<CustomItem:${1:装备框编号}:${2:WIL序号}:${3:图片序号}:${4:X}:${5:Y}:${6:内观显示}:${7:提示信息}>',
          '在 NPC 对话框显示人物自定义装备框',
          '游戏引擎反外挂系统/其他相关资料/自定义装备框.html',
          ['自定义装备框编号(0-49)', 'WIL序号', '图片序号', 'X', 'Y', '内观显示', '提示信息']
        ),
      },
    },
    {
      id: 'hero-custom-item-preview',
      engineVariants: {
        GEE: positional(
          '<HeroCustomItem:I:F:D:X:Y:S:H>',
          '<HeroCustomItem:${1:装备框编号}:${2:WIL序号}:${3:图片序号}:${4:X}:${5:Y}:${6:内观显示}:${7:提示信息}>',
          '在 NPC 对话框显示英雄自定义装备框',
          '游戏引擎反外挂系统/其他相关资料/自定义装备框.html',
          ['自定义装备框编号(0-49)', 'WIL序号', '图片序号', 'X', 'Y', '内观显示', '提示信息']
        ),
      },
    },
    {
      id: 'input-memo',
      engineVariants: {
        GOM: positional(
          '<&INPUTMEMO:ID:X:Y:宽度:高度:背景色:边框色:文字颜色:最小长度:最大长度:行高:自动换行:提示>',
          '<&INPUTMEMO:${1:输入框ID}:${2:X}:${3:Y}:${4:宽度}:${5:高度}:${6:背景色}:${7:边框色}:${8:文字颜色}:${9:最小长度}:${10:最大长度}:${11:行高}:${12:自动换行(0/1)}:${13:提示信息}>',
          '在 NPC 对话框以绝对坐标创建多行输入框；不带 & 的旧写法按相对坐标兼容',
          '游戏引擎反外挂系统/游戏功能详解/NPC对话框内创建输入框.htm',
          ['输入框ID(1-40)', 'X', 'Y', '宽度', '高度', '背景色', '边框色', '文字颜色', '最小长度', '最大长度', '行高', '自动换行(0/1)', '数据无效提示']
        ),
      },
    },
    {
      id: 'looks-preview',
      engineVariants: {
        GOM: positional(
          '<Looks:父子容器:Looks:X:Y>',
          '<Looks:${1:父子容器}:${2:Looks}:${3:X}:${4:Y}>',
          '在 NPC 容器中显示物品外观',
          gomContainer,
          ['父子容器编号', '物品Looks', 'X', 'Y']
        ),
        GEE: positional(
          '<Looks:N:X:Y:Z>',
          '<Looks:${1:图片位置}:${2:X}:${3:Y}:${4:背景框(0/1)}>',
          '显示 Items 系列资源中的物品外观',
          '游戏引擎反外挂系统/部分脚本实例/悬浮式提示框支持图片.HTML',
          ['图片位置', 'X', 'Y', '背景框(0/1)']
        ),
      },
    },
    {
      id: 'state-item-preview',
      engineVariants: {
        GEE: positional(
          '<StateItem:Looks:X:Y:边框|提示/@Label>',
          '<StateItem:${1:Looks}:${2:X}:${3:Y}:${4:边框}|${5:提示}/@${6:标签}>',
          '显示 StateItem 物品外观，可用于附加对话框和提示内容',
          '游戏引擎反外挂系统/游戏功能详解/添加对话框AddDlg (可用于主界面任务引导).html',
          ['物品Looks', 'X', 'Y', '边框', '悬停提示', '触发标签']
        ),
      },
    },
    {
      id: 'dnitems-preview',
      engineVariants: {
        GEE: positional(
          '<DnItems:Looks:X:Y:边框|提示/@Label>',
          '<DnItems:${1:Looks}:${2:X}:${3:Y}:${4:边框}|${5:提示}/@${6:标签}>',
          '显示 DnItems 物品外观，可用于附加对话框',
          '游戏引擎反外挂系统/游戏功能详解/添加对话框AddDlg (可用于主界面任务引导).html',
          ['物品Looks', 'X', 'Y', '边框', '悬停提示', '触发标签']
        ),
      },
    },
    {
      id: 'newopui-preview',
      engineVariants: {
        GEE: positional(
          '<NewopUI:N:X:Y>',
          '<NewopUI:${1:图片序号}:${2:X}:${3:Y}>',
          '显示 NewopUI.pak 中的图片',
          '游戏引擎反外挂系统/部分脚本实例/悬浮式提示框支持图片.HTML',
          ['图片序号', 'X', 'Y']
        ),
      },
    },
  ];

  const add996 = (id, page, label, snippet, description, parameters) => {
    entries.push({
      id,
      engineVariants: {
        '996PC': keyed(label, snippet, description, newNpc(page), parameters),
      },
    });
  };

  add996('newui-img-996pc', '新界面写法.htm',
    '<Img|wil=资源|pcimg=图片|x=X|y=Y>',
    '<Img|wil=${1:资源文件名}|pcimg=${2:图片序号}|x=${3:X}|y=${4:Y}|bg=${5:背景图(0/1)}|link=@${6:触发标签}>',
    '996PC 新 NPC 面板图片组件', [
      parameter('wil', '图片资源文件名'), parameter('pcimg', '图片序号'),
      parameter('img', '直接 PNG 路径；客户端素材根目录未公开'),
      parameter('x', '坐标X'), parameter('y', '坐标Y'), parameter('bg', '是否为背景图'),
      parameter('link', '单击触发标签；必须放在最后'),
      parameter('esc', '按 ESC 关闭(0/1)'), parameter('move', '界面可移动(0/1)'),
      parameter('reset', '重置界面坐标(0/1)'), parameter('show', '显示位置'),
      parameter('layerid', 'NPC 面板窗口ID'), parameter('loadDelay', '延迟加载剩余界面(0/1)'),
      parameter('hideMain', '隐藏主UI界面(0/1)'), parameter('forbidBagEquip', '禁止打开背包装备栏(0/1)'),
      parameter('scale9l', '九宫拉伸左边距'), parameter('scale9r', '九宫拉伸右边距'),
      parameter('scale9t', '九宫拉伸上边距'), parameter('scale9b', '九宫拉伸下边距'),
      parameter('grey', '灰化显示(0/1)'), parameter('bagPos', '背包位置(1左/0右)'),
      parameter('opacity', '透明度(0-255)'), parameter('reload', '刷新面板(0/1)'),
    ]);
  add996('newui-button-996pc', '按钮.htm',
    '<Button|wil=资源|pcnimg=默认|pcmimg=悬停|pcpimg=按下|text=文字|link=@标签>',
    '<Button|wil=${1:资源文件名}|pcnimg=${2:默认图片}|pcmimg=${3:悬停图片}|pcpimg=${4:按下图片}|text=${5:按钮文字}|color=${6:文字颜色}|size=${7:字号}|link=@${8:触发标签}>',
    '996PC 新 NPC 面板文字按钮组件', [
      parameter('wil', '图片资源文件名'), parameter('pcnimg', '正常图片序号'),
      parameter('pcmimg', '悬停图片序号'), parameter('pcpimg', '按下图片序号'),
      parameter('text', '按钮文字'), parameter('color', '文字颜色'), parameter('size', '文字大小'),
      parameter('link', '单击触发标签；必须放在最后'), parameter('outline', '文字描边宽度'),
      parameter('outlinecolor', '文字描边颜色'), parameter('grey', '灰化显示(0/1)'),
      parameter('tips', '鼠标悬停提示'), parameter('tipsx', '提示文字X偏移'),
      parameter('tipsy', '提示文字Y偏移'),
    ]);
  add996('newui-text-996pc', '文字.htm',
    '<Text|id=ID|x=X|y=Y|width=宽度|height=高度|text=文字|color=颜色|size=字号|outline=描边|outlinecolor=描边颜色|simplenum=0/1|scrollWidth=滚动宽度|scrollHeight=滚动高度|scrollWay=方向|scrollTime=秒|link=@标签>',
    '<Text|id=${1:ID}|x=${2:X}|y=${3:Y}|width=${4:宽度}|height=${5:高度}|text=${6:显示文字}|color=${7:颜色}|size=${8:字号}|outline=${9:描边宽度}|outlinecolor=${10:描边颜色}|tips=${11:悬停提示}|tipsx=${12:提示X偏移}|tipsy=${13:提示Y偏移}|simplenum=${14:0}|scrollWidth=${15:滚动区域宽度}|scrollHeight=${16:滚动区域高度}|scrollWay=${17:0}|scrollTime=${18:秒}|link=@${19:触发标签}>',
    '996PC 新 NPC 面板文字组件', [
      parameter('text', '显示文字'), parameter('x', '坐标X'), parameter('y', '坐标Y'),
      parameter('color', '文字颜色；逗号分隔可闪烁'), parameter('size', '字号(14/16/18/20)'),
      parameter('link', '单击触发标签；必须放在最后'), parameter('outline', '描边宽度'),
      parameter('outlinecolor', '描边颜色'), parameter('tips', '鼠标悬停提示'),
      parameter('tipsx', '提示文字X偏移'), parameter('tipsy', '提示文字Y偏移'),
      parameter('simplenum', '简化大数值显示(0/1)'), parameter('scrollWidth', '滚动区域宽度'),
      parameter('scrollWay', '滚动方式(0从右到左/1从下到上)'), parameter('scrollTime', '滚动时间(秒)'),
      parameter('scrollHeight', '滚动区域高度'),
    ]);
  add996('newui-rtext-996pc', '文字.htm',
    '<RText|text=富文本|x=X|y=Y|color=颜色|size=字号>',
    '<RText|text=${1:富文本内容}|x=${2:X}|y=${3:Y}|color=${4:颜色}|size=${5:字号}>',
    '996PC 新 NPC 面板富文本组件', [
      parameter('text', '富文本内容'), parameter('x', '坐标X'), parameter('y', '坐标Y'),
      parameter('color', '文字颜色'), parameter('size', '字号'), parameter('scrollWidth', '滚动区域宽度'),
      parameter('scrollWay', '滚动方式(0从右到左/1从下到上)'), parameter('scrollTime', '滚动时间(秒)'),
      parameter('scrollHeight', '滚动区域高度'), parameter('tips', '鼠标悬停提示'),
      parameter('tipsx', '提示文字X偏移'), parameter('tipsy', '提示文字Y偏移'),
    ]);
  add996('newui-layout-996pc', '基础容器Layout.htm',
    '<Layout|width=宽度|height=高度|color=颜色|link=@标签>',
    '<Layout|width=${1:宽度}|height=${2:高度}|color=${3:颜色}|link=@${4:触发标签}>',
    '996PC 新 NPC 面板点击区域容器', [
      parameter('width', '容器宽度'), parameter('height', '容器高度'),
      parameter('color', '容器颜色；不写为透明'), parameter('link', '单击触发标签；必须放在最后'),
    ]);
  add996('newui-listview-996pc', '列表容器ListView.htm',
    '<ListView|children={子节点}|direction=方向|bounce=回弹|margin=间隔>',
    '<ListView|children={${1:子节点ID}}|direction=${2:方向(1竖向/2横向)}|bounce=${3:回弹}|margin=${4:子控件间隔}|cantouch=${5:可滑动(0/1)}|Slider=${6:启用滑块(0/1)}|Sdbg=${7:滑块底图}|Sdupnimg=${8:上或左箭头正常图}|Sdupmimg=${9:上或左箭头悬停图}|Sduppimg=${10:上或左箭头按下图}|Sdnimg=${11:滑块正常图}|Sdmimg=${12:滑块悬停图}|Sdpimg=${13:滑块按下图}|Sddwnimg=${14:下或右箭头正常图}|Sddwmimg=${15:下或右箭头悬停图}|Sddwpimg=${16:下或右箭头按下图}>',
    '996PC 新 NPC 面板滚动列表容器；ListView 不可嵌套', [
      parameter('children', '子节点ID列表'), parameter('direction', '方向(1竖向/2横向)'),
      parameter('bounce', '回弹设置'), parameter('margin', '子控件间隔'),
      parameter('cantouch', '是否可滑动(1默认/0不可)'), parameter('reload', '刷新面板(0/1)'),
      parameter('default', '跳转到 children 中的索引'), parameter('Slider', '启用滑块(0/1)'),
      parameter('Sdbg', '滑块底图'), parameter('Sdupnimg', '向上或向左箭头正常图片'),
      parameter('Sdupmimg', '向上或向左箭头悬停图片'), parameter('Sduppimg', '向上或向左箭头按下图片'),
      parameter('Sdnimg', '滑块正常图片'), parameter('Sdmimg', '滑块悬停图片'),
      parameter('Sdpimg', '滑块按下图片'), parameter('Sddwnimg', '向下或向右箭头正常图片'),
      parameter('Sddwmimg', '向下或向右箭头悬停图片'), parameter('Sddwpimg', '向下或向右箭头按下图片'),
    ]);
  add996('newui-checkbox-996pc', '复选框CheckBox.htm',
    '<CheckBox|checkboxid=变量|wil=资源|pcnimg=未选|pcpimg=选中|default=状态|submit=提交|link=@标签>',
    '<CheckBox|checkboxid=${1:数字变量}|wil=${2:资源文件名}|pcnimg=${3:未选图片}|pcpimg=${4:选中图片}|default=${5:默认状态(0/1)}|submit=${6:提交参数}|link=@${7:触发标签}>',
    '996PC 新 NPC 面板复选框组件', [
      parameter('checkboxid', '提交状态的数字变量名'), parameter('wil', '图片资源文件名'),
      parameter('pcnimg', '未选中图片'), parameter('pcpimg', '选中图片'),
      parameter('default', '默认选中状态(0/1)'),
      parameter('submit', '提交参数（手册列出，取值语义未公开）'),
      parameter('link', '提交触发标签'),
      parameter('delay', '自动提交间隔'), parameter('count', '自动提交次数'),
    ]);
  add996('newui-slider-996pc', '滑动拉杆_Slider_.htm',
    '<Slider|sliderid=变量|wil=资源|pcbgimg=背景|pcbarimg=进度|pcballimg=滑块|link=@标签>',
    '<Slider|sliderid=${1:变量}|wil=${2:资源文件名}|pcbgimg=${3:背景图片}|pcbarimg=${4:进度图片}|pcballimg=${5:滑块图片}|maxvalue=${6:最大值}|defvalue=${7:默认值}|link=@${8:触发标签}>',
    '996PC 新 NPC 面板滑动拉杆组件', [
      parameter('sliderid', '提交滑动值的 N 或 N$ 变量'), parameter('wil', '图片资源文件名'),
      parameter('pcbgimg', '拖动背景图片'), parameter('pcbarimg', '拖动条图片'),
      parameter('pcballimg', '拖动球图片'), parameter('maxvalue', '最大值；默认100'),
      parameter('defvalue', '默认值；默认0'), parameter('link', '跳转触发标签'),
      parameter('width', '宽度'), parameter('height', '高度'),
    ]);
  add996('newui-menuitem-996pc', '菜单选项_menuid_.htm',
    '<MenuItem|menuid=变量|itemname=选项#选项|select=默认项|link=@标签>',
    '<MenuItem|menuid=${1:S变量}|itemname=${2:选项1#选项2}|select=${3:默认选项}|direction=${4:方向(0下拉/1上拉)}|link=@${5:触发标签}>',
    '996PC 新 NPC 面板下拉菜单组件', [
      parameter('menuid', '提交选择结果的 S 或 S$ 变量'), parameter('itemname', '以 # 分隔的菜单项'),
      parameter('select', '默认选择文本'), parameter('direction', '方向(0下拉/1上拉)'),
      parameter('link', '跳转触发标签'), parameter('img', '展示底图资源'),
      parameter('arrowimg', '箭头图片资源'), parameter('selectimg', '选中图片资源'),
      parameter('listimg', '菜单列表底图资源'), parameter('width', '宽度'), parameter('height', '高度'),
      parameter('itemhei', '单个菜单项高度'), parameter('fontcolor', '字体颜色'),
      parameter('selectcolor', '选中项字体颜色'), parameter('maxhei', '超过此高度后允许滚动'),
    ]);
  add996('newui-frames-996pc', '序列帧_Frames_.htm',
    '<Frames|wil=资源|start=开始|count=数量|speed=速度|loop=次数>',
    '<Frames|wil=${1:资源文件名}|start=${2:开始图片}|count=${3:图片数量}|speed=${4:播放间隔毫秒}|loop=${5:播放次数}>',
    '996PC 新 NPC 面板序列帧组件', [
      parameter('wil', '图片资源文件名'), parameter('start', '开始图片序号'),
      parameter('count', '图片数量'), parameter('speed', '播放间隔毫秒'),
      parameter('loop', '循环或播放次数'), parameter('DMode', '绘制模式(0普通/1特效)'),
      parameter('finishframe', '播放完成停留帧'), parameter('finishhide', '完成后隐藏(0/1)'),
      parameter('slowcount', '放缓数量；默认0'),
    ]);
  add996('newui-effect-996pc', '特效Effect.htm',
    '<Effect|wil=资源|start=开始|num=数量|DMode=模式|gap=间隔|count=次数|link=@标签>',
    '<Effect|wil=${1:资源文件名}|start=${2:开始图片}|num=${3:播放数量}|DMode=${4:绘制模式(0普通/1特效)}|gap=${5:帧间隔毫秒}|count=${6:播放次数}|link=@${7:触发标签}>',
    '996PC 新 NPC 面板特效组件', [
      parameter('wil', '图片资源文件名'), parameter('start', '开始图片序号'),
      parameter('num', '播放图片数量'), parameter('DMode', '绘制模式(0普通/1特效)'),
      parameter('gap', '帧间隔毫秒'), parameter('count', '播放次数'),
      parameter('link', '单击触发标签；必须放在最后'), parameter('scale', '缩放比例；1为正常大小'),
    ]);
  add996('newui-input-996pc', '自定义输入框Input.htm',
    '<Input|inputid=ID|type=类型|width=宽度|height=高度|mincount=最小|maxcount=最大>',
    '<Input|inputid=${1:输入框ID(1-9)}|type=${2:类型(0文本/1数字/2密码/3绝对值数字)}|width=${3:宽度}|height=${4:高度}|color=${5:输入文字颜色}|size=${6:字号}|mincount=${7:最小长度}|maxcount=${8:最大长度}|errortips=${9:错误提示}|place=${10:空值提示}|placecolor=${11:提示颜色}|onlyCh=${12:仅中文(0/1)}|bgtype=${13:背景框(0/1)}>',
    '996PC 新 NPC 面板输入框组件', [
      parameter('inputid', '输入框ID(1-9)'), parameter('type', '输入类型(0文本/1数字/2密码/3绝对值数字)'),
      parameter('width', '宽度'), parameter('height', '高度'), parameter('mincount', '最小字符数'),
      parameter('maxcount', '最大字符数'), parameter('errortips', '输入类型不符提示'),
      parameter('place', '空值提示文字'), parameter('placecolor', '空值提示文字颜色'),
      parameter('color', '输入文字颜色'), parameter('size', '输入文字大小'),
      parameter('onlyCh', '仅允许中文(0/1)'), parameter('submitInput', '提交的输入框ID列表'),
      parameter('bgtype', '显示背景框(0/1)'),
    ]);
  add996('newui-countdown-996pc', '倒计时COUNTDOWN.htm',
    '<COUNTDOWN|time=时间|count=次数|size=字号|color=颜色|link=@标签>',
    '<COUNTDOWN|time=${1:倒计时时间}|count=${2:循环次数}|size=${3:字号}|color=${4:颜色}|link=@${5:结束标签}>',
    '996PC 新 NPC 面板秒级倒计时组件', [
      parameter('time', '倒计时时间'), parameter('count', '循环次数'), parameter('size', '文字大小'),
      parameter('color', '文字颜色'), parameter('link', '结束触发标签；必须放在最后'),
      parameter('outline', '描边宽度'), parameter('outlinecolor', '描边颜色'),
      parameter('showWay', '显示方式(0显示秒/1显示天时分秒)'),
    ]);
  add996('newui-timetips-996pc', '倒计时COUNTDOWN.htm',
    '<TIMETIPS|time=时间|count=次数|size=字号|color=颜色|link=@标签>',
    '<TIMETIPS|time=${1:倒计时时间}|count=${2:循环次数}|size=${3:字号}|color=${4:颜色}|link=@${5:结束标签}>',
    '996PC 新 NPC 面板天、时、分、秒倒计时组件', [
      parameter('time', '倒计时时间'), parameter('count', '循环次数'), parameter('size', '文字大小'),
      parameter('color', '文字颜色'), parameter('link', '结束触发标签；必须放在最后'),
      parameter('outline', '描边宽度'), parameter('outlinecolor', '描边颜色'),
    ]);
  add996('newui-itemshow-996pc', '物品框ItemShow.htm',
    '<ItemShow|itemid=IDX|itemcount=数量|showtips=提示|bgtype=背景|link=@标签>',
    '<ItemShow|itemid=${1:数据库物品IDX}|itemcount=${2:数量}|showtips=${3:显示属性(0/1)}|bgtype=${4:背景图(0/1)}|link=@${5:触发标签}>',
    '996PC 新 NPC 面板数据库物品 IDX 展示组件', [
      parameter('itemid', '数据库物品 IDX'), parameter('itemname', '物品名称'), parameter('itemcount', '物品数量'),
      parameter('showtips', '显示物品属性(0/1)'), parameter('bgtype', '显示背景图(0/1)'),
      parameter('link', '单击触发标签'), parameter('color', '数量颜色'), parameter('grey', '灰化显示(0/1)'),
      parameter('lock', '显示锁图标(0/1)'), parameter('scale', '缩放比例'),
    ]);
  for (const [id, tag, description] of [
    ['newui-equipshow-996pc', 'EquipShow', '人物装备位置展示'],
    ['newui-heroequipshow-996pc', 'HEROEquipShow', '英雄装备位置展示'],
  ]) {
    add996(id, '物品框ItemShow.htm',
      `<${tag}|index=位置|showtips=提示|showstar=星级|bgtype=背景|link=@标签>`,
      `<${tag}|index=\${1:装备位置}|showtips=\${2:显示属性(0/1)}|showstar=\${3:显示星级(0/1)}|bgtype=\${4:背景图(0/1)}|link=@\${5:触发标签}>`,
      `996PC 新 NPC 面板${description}组件`, [
        parameter('index', '装备位置(0-55)'), parameter('showtips', '显示物品属性(0/1)'),
        parameter('showstar', '显示星级(0/1)'),
        parameter('bgtype', '显示背景图(0/1)'), parameter('link', '单击触发标签'),
        parameter('scale', '缩放比例'), parameter('dblink', '双击触发标签'),
        parameter('reload', '刷新面板(0/1)'), parameter('effectshow', '特效显示方式(0不显示/1背包/2内观)'),
      ]);
  }
  for (const [id, tag, description] of [
    ['newui-dbitemshow-996pc', 'DBItemShow', '人物唯一物品'],
    ['newui-herodbitemshow-996pc', 'HERODBItemShow', '英雄唯一物品'],
  ]) {
    add996(id, '物品框ItemShow.htm',
      `<${tag}|makeindex=唯一ID|showtips=提示|bgtype=背景|link=@标签>`,
      `<${tag}|makeindex=\${1:物品唯一ID}|showtips=\${2:显示属性(0/1)}|bgtype=\${3:背景图(0/1)}|link=@\${4:触发标签}>`,
      `996PC 新 NPC 面板${description}展示组件`, [
        parameter('makeindex', '物品唯一ID'), parameter('showtips', '显示物品属性(0/1)'),
        parameter('bgtype', '显示背景图(0/1)'), parameter('link', '单击触发标签'),
        parameter('grey', '灰化显示(0/1)'), parameter('showstar', '显示星级(0/1)'),
      ]);
  }
  for (const [id, tag, description] of [
    ['newui-bagitems-996pc', 'BAGITEMS', '人物背包物品选择'],
    ['newui-herobagitems-996pc', 'HEROBAGITEMS', '英雄背包物品选择'],
  ]) {
    add996(id, '取背包物品显示到格子.htm',
      `<${tag}|condition=条件|select=已选ID|count=格子数|row=行数|link=@标签>`,
      `<${tag}|condition=\${1:StdMode#Shape条件}|select=\${2:已选唯一ID}|count=\${3:格子数量}|row=\${4:行数}|link=@\${5:触发标签}>`,
      `996PC 新 NPC 面板${description}组件`, [
        parameter('condition', '过滤条件，格式 StdMode#Shape'), parameter('select', '已选择的物品唯一ID'),
        parameter('count', '格子数量'), parameter('row', '显示行数'), parameter('link', '单击触发标签；必须放在最后'),
        parameter('iwidth', '格子宽度'), parameter('iheight', '格子高度'),
        parameter('selecttype', '选择类型(0多选/1单选)'), parameter('showstar', '显示星级(0/1)'),
        parameter('conditionEx', '是否过滤星级(0/1)'), parameter('conditionParam', '星级过滤等级'),
        parameter('conditionOnOff', '星级显示条件方向'), parameter('exclude', '已选后从同组件排除的唯一ID'),
        parameter('filter1', '排除物品ID列表'), parameter('filter2', '排除物品名列表'),
        parameter('filter3', '仅显示的物品ID或名称列表'), parameter('exbind', '过滤绑定物品(0/1)'),
        parameter('showtips', '显示物品属性(0/1)'),
      ]);
  }
  for (const [id, tag, description] of [
    ['newui-equipitems-996pc', 'EQUIPITEMS', '人物身上装备选择'],
    ['newui-heroequipitems-996pc', 'HEROEQUIPITEMS', '英雄身上装备选择'],
  ]) {
    add996(id, '获取身上装备显示到格子.htm',
      `<${tag}|positions=位置|select=已选ID|count=格子数|row=行数|link=@标签>`,
      `<${tag}|positions=\${1:装备位置}|select=\${2:已选唯一ID}|count=\${3:格子数量}|row=\${4:行数}|link=@\${5:触发标签}>`,
      `996PC 新 NPC 面板${description}组件`, [
        parameter('positions', '装备位置'), parameter('select', '已选择的物品唯一ID'),
        parameter('count', '格子数量'), parameter('row', '显示行数'), parameter('link', '单击触发标签；必须放在最后'),
        parameter('selecttype', '选择类型(0多选/1单选)'), parameter('showstar', '显示星级(0/1)'),
        parameter('iwidth', '格子宽度'), parameter('iheight', '格子高度'),
        parameter('showtips', '显示物品属性(0/1)'),
      ]);
  }
  add996('newui-percentimg-996pc', '百分比图片_PercentImg_.htm',
    '<PercentImg|direction=方向|wil=资源|pcimg=图片|minValue=当前|maxValue=最大>',
    '<PercentImg|direction=${1:方向(0左到右/1右到左/2上到下/3下到上)}|wil=${2:资源文件名}|pcimg=${3:图片序号}|minValue=${4:当前值}|maxValue=${5:最大值}>',
    '996PC 新 NPC 面板百分比图片组件', [
      parameter('direction', '方向(0左到右/1右到左/2上到下/3下到上)'),
      parameter('wil', '图片资源文件名'), parameter('pcimg', '图片序号'),
      parameter('minValue', '当前显示进度值'), parameter('maxValue', '最大值'),
    ]);
  add996('newui-itembox-996pc', '自定义OK框.htm',
    '<ITEMBOX|boxindex=编号|stdmode=类型|wil=资源|pcimg=背景|tips=提示>',
    '<ITEMBOX|boxindex=${1:OK框编号}|stdmode=${2:允许StdMode}|wil=${3:资源文件名}|pcimg=${4:背景图片}|tips=${5:提示文字}>',
    '996PC 新 NPC 面板自定义 OK 框组件', [
      parameter('boxindex', 'OK框编号'), parameter('stdmode', '允许放入的物品 StdMode 列表'),
      parameter('wil', '背景图片资源文件名'), parameter('pcimg', '背景图片序号'),
      parameter('tips', '鼠标悬停提示'), parameter('tipsx', '提示文字X偏移'),
      parameter('tipsy', '提示文字Y偏移'),
    ]);
  entries.push({
    id: 'textatlas-996pc',
    engineVariants: {
      '996PC': positional(
        '<TextAtlas:F:N:X:Y:L>',
        '<TextAtlas:${1:WIL序号}:${2:起始图片}:${3:X}:${4:Y}:${5:数字或变量}>',
        '996PC 传统 NPC 面板连续数字图片艺术字',
        '游戏引擎反外挂系统/新增功能/艺术字效果.htm',
        ['WIL序号', '起始图片', 'X', 'Y', '数字或变量']
      ),
    },
  });
  add996('newui-textatlas-996pc', '艺术字TextAtlas.htm',
    '<TextAtlas|wil=资源|pcimg=图片|iwidth=字宽|iheight=字高|text=数字>',
    '<TextAtlas|wil=${1:资源文件名}|pcimg=${2:图片序号}|iwidth=${3:单字宽度}|iheight=${4:素材高度}|text=${5:数字或变量}>',
    '996PC 新 NPC 面板艺术字数字组件', [
      parameter('wil', '图片资源文件名'), parameter('pcimg', '包含0-9的整图序号'),
      parameter('iwidth', '单字宽度'), parameter('iheight', '素材高度'),
      parameter('text', '需要转换的数字或变量'),
    ]);
  add996('newui-uimodel-996pc', '角色内观部件_UIModel_.htm',
    '<UIModel|sex=性别|clothID=衣服|weaponID=武器|headID=头盔|scale=缩放>',
    '<UIModel|sex=${1:性别(0男/1女)}|clothID=${2:衣服Looks}|weaponID=${3:武器Looks}|headID=${4:头盔Looks}|scale=${5:缩放比例}>',
    '996PC 新 NPC 面板角色内观组件', [
      parameter('sex', '性别(0男/1女)'), parameter('clothID', '衣服内观Looks'),
      parameter('weaponID', '武器内观Looks'), parameter('headID', '头盔内观Looks'),
      parameter('scale', '缩放比例；1为默认'), parameter('clothEffectID', '衣服特效ID及模式坐标'),
      parameter('weaponEffectID', '武器特效ID及模式坐标'), parameter('headEffectID', '头盔特效ID'),
      parameter('capID', '斗笠内观Looks'), parameter('capEffectID', '斗笠特效ID'),
      parameter('shieldID', '盾牌内观Looks'), parameter('shieldEffectID', '盾牌特效ID'),
      parameter('veilID', '面巾内观Looks'), parameter('veilEffectID', '面巾特效ID'),
      parameter('hairID', '发型ID'), parameter('notShowMold', '不显示裸模(true/false)'),
      parameter('notShowHair', '不显示头发(true/false)'),
    ]);
  add996('newui-costitem-996pc', '货币需求展示_CostItem_.htm',
    '<CostItem|itemid=IDX|itemcount=数量|title=标题|titlecolor=标题颜色|color=数量颜色|fontsize=字号|itemscale=缩放>',
    '<CostItem|itemid=${1:物品IDX}|itemcount=${2:数量}|title=${3:标题}|titlecolor=${4:标题颜色}|color=${5:数量颜色}|fontsize=${6:字号}|itemscale=${7:缩放}>',
    '996PC 新 NPC 面板货币需求展示组件', [
      parameter('itemid', '物品IDX'), parameter('itemcount', '物品数量'),
      parameter('title', '标题文本；不配置使用默认标题'), parameter('titlecolor', '标题文本颜色'),
      parameter('color', '斜杠后文字颜色'),
      parameter('itemscale', '物品图片缩放'), parameter('fontsize', '字号'),
    ]);
  add996('newui-loadingbar-996pc', '进度条LoadingBar.htm',
    '<LoadingBar|wil=资源|pcloadingbg=底图|pcloadingbar=进度图|startper=起始|endper=结束|link=@标签>',
    '<LoadingBar|id=${1:ID}|x=${2:X}|y=${3:Y}|width=${4:宽度}|height=${5:高度}|wil=${6:资源文件名}|pcloadingbg=${7:进度条底图}|pcloadingbar=${8:进度条图片}|startper=${9:起始进度}|endper=${10:结束进度}|maxper=${11:最大进度}|interval=${12:0.05}|loadvalue=${13:10}|direction=${14:0}|offsetX=${15:0}|offsetY=${16:0}|size=${17:字号}|color=${18:文字颜色}|outline=${19:描边宽度}|outlinecolor=${20:描边颜色}|HideText=${21:0}|link=@${22:完成标签}>',
    '996PC 新 NPC 面板动态进度条组件', [
      parameter('wil', '图片资源文件名'), parameter('pcloadingbg', '进度条底图'),
      parameter('pcloadingbar', '进度条滚动图片'), parameter('startper', '起始进度'),
      parameter('endper', '结束进度；默认100'), parameter('link', '完成触发标签；必须放在最后'),
      parameter('size', '文字大小'), parameter('color', '文字颜色'),
      parameter('outline', '描边宽度'), parameter('outlinecolor', '描边颜色'),
      parameter('direction', '方向(0左到右/1右到左)'), parameter('interval', '滚动间隔；默认0.05'),
      parameter('loadvalue', '每次间隔增加的进度；默认10'), parameter('offsetX', '进度图中心X偏移'),
      parameter('offsetY', '进度图中心Y偏移'), parameter('maxper', '最大进度；默认100'),
      parameter('HideText', '隐藏进度文字'),
    ]);
  entries.push({
    id: 'time-tips',
    engineVariants: {
      '996PC': positional(
        '<TIMETIPS:秒数:次数:颜色:X:Y/@标签>',
        '<TIMETIPS:${1:秒数}:${2:次数(0无限)}:${3:颜色}:${4:X}:${5:Y}/@${6:标签}>',
        'NPC 面板倒计时',
        '游戏引擎反外挂系统/新增功能/NPC面板倒计时.htm',
        ['秒数', '次数(0无限)', '颜色', 'X', 'Y', '触发标签']
      ),
    },
  });

  return entries;
}

module.exports = { supplementalSayInterfaceEntries };
