const fs = require('node:fs');
const path = require('node:path');
const languageAudit = require('./audit-engine-language-accuracy');

const projectRoot = path.resolve(__dirname, '..', '..');
const revision = '2026-07-23';
const helpRoots = {
  GOM: path.join(
    process.env.LOCALAPPDATA || '',
    'Temp',
    'boo-help-audit-gom-20260719'
  ),
  GEE: path.join(
    process.env.LOCALAPPDATA || '',
    'Temp',
    'boo-help-audit-gee-20260719'
  ),
  '996PC': path.join(
    process.env.LOCALAPPDATA || '',
    'Temp',
    'boo-help-audit-20260723',
    'pc996'
  ),
};
const mapInfoPage = '游戏引擎反外挂系统/游戏功能详解/地图参数详解[!].htm';

function source(page) {
  return { revision, page };
}

function variant(label, snippet, description, page, evidenceToken) {
  return {
    label,
    snippet,
    description,
    source: source(page),
    ...(evidenceToken ? { evidenceToken } : {}),
  };
}

function sharedSnippet(id, definition) {
  return {
    id,
    engineVariants: {
      GOM: variant(
        definition.label,
        definition.snippet,
        definition.description,
        definition.gomPage
      ),
      GEE: variant(
        definition.geeLabel || definition.label,
        definition.geeSnippet || definition.snippet,
        definition.geeDescription || definition.description,
        definition.geePage
      ),
    },
  };
}

function saySnippets() {
  const gomIcons = '游戏引擎反外挂系统/游戏功能详解/脚本中使用图标功能[!].htm';
  const geeIcons = '游戏引擎反外挂系统/游戏功能详解/脚本中使用图标功能[!].htm';
  const gomAbsolute = '游戏引擎反外挂系统/游戏功能详解/NPC对话框绝对坐标.htm';
  const geeAbsolute = '游戏引擎反外挂系统/部分脚本实例/Npc对话框绝对坐标.htm';
  const gomInput = '游戏引擎反外挂系统/游戏功能详解/NPC对话框内创建输入框.htm';
  const geeInput = '游戏引擎反外挂系统/其他相关资料/NPC对话框内默认输入框.htm';
  const gomCountdown = '游戏引擎反外挂系统/游戏功能详解/NPC对话框内倒计时.htm';
  const geeCountdown = '游戏引擎反外挂系统/部分脚本实例/NPC对话框内倒计时.html';
  const gomText = '游戏引擎反外挂系统/游戏功能详解/设置NPC文字坐标.htm';
  const geeText = '游戏引擎反外挂系统/部分脚本实例/Npc文字Text使用.htm';
  const gomParamLink = '游戏引擎反外挂系统/游戏功能详解/扩展NPC脚本点击触发带参数.htm';
  const geeParamLink = '游戏引擎反外挂系统/游戏功能详解/扩展NPC脚本点击触发带参数.html';

  const entries = [
    sharedSnippet('img-absolute', {
      label: '<&IMG:N:F:X:Y>',
      snippet: '<&IMG:${1:图片序号}:${2:WIL序号}:${3:X}:${4:Y}>',
      description: '使用绝对坐标显示静态图片',
      gomPage: gomAbsolute,
      geePage: geeAbsolute,
    }),
    sharedSnippet('img-relative', {
      label: '<IMG:N:F:X:Y>',
      snippet: '<IMG:${1:图片序号}:${2:WIL序号}:${3:X}:${4:Y}>',
      description: '显示静态图片',
      gomPage: gomIcons,
      geePage: geeIcons,
    }),
    sharedSnippet('img-hover', {
      label: '<IMG:N:F:X:Y|备注>',
      snippet: '<IMG:${1:图片序号}:${2:WIL序号}:${3:X}:${4:Y}|${5:悬停备注}>',
      description: '显示带鼠标悬停备注的静态图片',
      gomPage: gomIcons,
      geePage: '游戏引擎反外挂系统/部分脚本实例/npc标签功能.htm',
    }),
    sharedSnippet('imgex-absolute', {
      label: '<&IMGEX:F:U:H:D:X:Y>',
      snippet: '<&IMGEX:${1:WIL序号}:${2:默认图片}:${3:移入图片}:${4:按下图片}:${5:X}:${6:Y}>',
      description: '使用绝对坐标显示三态按钮图片',
      gomPage: gomAbsolute,
      geePage: geeAbsolute,
    }),
    sharedSnippet('playimg-absolute', {
      label: '<&PLAYIMG:F:N:C:T:X:Y>',
      snippet: '<&PLAYIMG:${1:WIL序号}:${2:开始图片}:${3:播放张数}:${4:间隔毫秒}:${5:X}:${6:Y}>',
      description: '使用绝对坐标播放动态图片',
      gomPage: gomAbsolute,
      geePage: geeAbsolute,
    }),
    sharedSnippet('playimgex-absolute', {
      label: '<&PLAYIMGEX:F:N:C:T:H:X:Y>',
      snippet: '<&PLAYIMGEX:${1:WIL序号}:${2:开始图片}:${3:播放张数}:${4:间隔毫秒}:${5:播放次数}:${6:X}:${7:Y}>',
      description: '使用绝对坐标按指定次数播放动态图片',
      gomPage: '游戏引擎反外挂系统/游戏功能详解/NPC对话框容器.htm',
      geePage: geeIcons,
    }),
    sharedSnippet('text-absolute', {
      label: '<&TEXT:内容:X:Y{FCOLOR=颜色}>',
      snippet: '<&TEXT:${1:内容}:${2:X}:${3:Y}{FCOLOR=${4:251}}>',
      description: '使用绝对坐标显示文字',
      gomPage: gomText,
      geePage: geeText,
    }),
    sharedSnippet('text-absolute-link', {
      label: '<&TEXT:内容:X:Y{FCOLOR=颜色}/@标签>',
      snippet: '<&TEXT:${1:内容}:${2:X}:${3:Y}{FCOLOR=${4:251}}/@${5:标签}>',
      description: '使用绝对坐标显示可点击文字',
      gomPage: gomText,
      geePage: geeText,
    }),
    sharedSnippet('text-link', {
      label: '<文字/@标签>',
      snippet: '<${1:文字}/@${2:标签}>',
      description: '显示可点击的相对坐标文字',
      gomPage: gomParamLink,
      geePage: geeParamLink,
    }),
    sharedSnippet('text-link-params', {
      label: '<文字/@标签(参数)>',
      snippet: '<${1:文字}/@${2:标签}(${3:参数})>',
      description: '显示带脚本参数的可点击文字',
      gomPage: gomParamLink,
      geePage: geeParamLink,
    }),
    sharedSnippet('text-color', {
      label: '<文字/FCOLOR=颜色>',
      snippet: '<${1:文字}/FCOLOR=${2:251}>',
      description: '显示指定颜色的相对坐标文字',
      gomPage: gomText,
      geePage: geeText,
    }),
    sharedSnippet('item-show', {
      label: '<&ITEMSHOW:D:F:X:Y:B>',
      snippet: '<&ITEMSHOW:${1:物品ID}:${2:数量}:${3:X}:${4:Y}:${5:边框}>',
      description: '使用绝对坐标显示物品图片和属性',
      gomPage: '游戏引擎反外挂系统/游戏功能详解/NPC对话框显示物品图片 显示物品属性.htm',
      geePage: '游戏引擎反外挂系统/其他相关资料/货币实时刷新常量.htm',
    }),
    sharedSnippet('input-text', {
      label: '<&INPUTTEXT:ID:X:Y:W:H:BG:BORDER:COLOR:MIN:MAX:ERROR:HINT:HINTCOLOR>',
      snippet: '<&INPUTTEXT:${1:ID}:${2:X}:${3:Y}:${4:宽度}:${5:高度}:${6:背景色}:${7:边框色}:${8:文字颜色}:${9:最小长度}:${10:最大长度}:${11:错误提示}:${12:提示文字}:${13:提示颜色}>',
      description: '创建文本输入框',
      gomPage: gomInput,
      geePage: geeInput,
    }),
    sharedSnippet('input-number', {
      label: '<&INPUTNUM:ID:X:Y:W:H:BG:BORDER:COLOR:MIN:MAX:ERROR:HINT:HINTCOLOR>',
      snippet: '<&INPUTNUM:${1:ID}:${2:X}:${3:Y}:${4:宽度}:${5:高度}:${6:背景色}:${7:边框色}:${8:文字颜色}:${9:最小值}:${10:最大值}:${11:错误提示}:${12:提示文字}:${13:提示颜色}>',
      description: '创建数字输入框',
      gomPage: gomInput,
      geePage: geeInput,
    }),
    sharedSnippet('countdown', {
      label: '<&COUNTDOWN:S:C:COLOR:X:Y:M/@LABEL>',
      snippet: '<&COUNTDOWN:${1:秒数}:${2:次数}:${3:颜色}:${4:X}:${5:Y}:${6:显示格式}/@${7:触发标签}>',
      description: '显示文字倒计时并在结束时触发脚本',
      gomPage: gomCountdown,
      geePage: geeCountdown,
    }),
    sharedSnippet('image-countdown', {
      label: '<&IMGCOUNTDOWN:S:C:N:GAP:X:Y:M/@LABEL>',
      snippet: '<&IMGCOUNTDOWN:${1:秒数}:${2:次数}:${3:开始图片}:${4:图片间隔}:${5:X}:${6:Y}:${7:显示格式}/@${8:触发标签}>',
      description: '使用图片数字显示倒计时',
      gomPage: gomCountdown,
      geePage: geeCountdown,
    }),
    sharedSnippet('image-number', {
      label: '<&IMGNUM:N:VALUE:GAP:X:Y:D>',
      snippet: '<&IMGNUM:${1:开始图片}:${2:数字值}:${3:字符间隔}:${4:X}:${5:Y}:${6:方向}>',
      description: '将数字转换为连续图片显示',
      gomPage: '游戏引擎反外挂系统/游戏功能详解/NPC对话框数字转图片.htm',
      geePage: '游戏引擎反外挂系统/游戏功能详解/数字转换为图片显示标签.htm',
    }),
    sharedSnippet('progress-bar', {
      label: '<&PROGRESSBAR:X:Y:F:B:P:C:T:X2:Y2:N:X:V:D:L:X3:Y3:TEXT:TIP>',
      snippet: '<&PROGRESSBAR:${1:X}:${2:Y}:${3:WIL序号}:${4:背景图片}:${5:进度图片}:${6:数量}:${7:间隔}:${8:X2}:${9:Y2}:${10:模式}:${11:最大值}:${12:当前值}:${13:方向}:${14:文字颜色}:${15:X3}:${16:Y3}:${17:显示文字}:${18:备注}>',
      description: '显示动态进度条',
      gomPage: '游戏引擎反外挂系统/游戏功能详解/Npc对话框动态进度条功能.htm',
      geePage: '游戏引擎反外挂系统/游戏功能详解/Npc对话框动态进度条功能.htm',
    }),
    sharedSnippet('item-box', {
      label: '<ITEMBOX:N:F:M:X:Y:W:H:S:T>',
      snippet: '<ITEMBOX:${1:编号}:${2:WIL序号}:${3:背景图片}:${4:X}:${5:Y}:${6:宽度}:${7:高度}:${8:允许类型}:${9:提示文字}>',
      description: '创建自定义物品 OK 框',
      gomPage: '游戏引擎反外挂系统/游戏功能详解/自定义OK框[!].htm',
      geePage: '游戏引擎反外挂系统/功能操作命令/自定义OK框.htm',
    }),
    sharedSnippet('human-variable', {
      label: '<$HUMAN(变量名)>',
      snippet: '<$HUMAN(${1:变量名})>',
      description: '读取已声明的人物自定义变量',
      gomPage: '游戏引擎反外挂系统/功能操作命令/自定义变量功能.htm',
      geePage: '游戏引擎反外挂系统/功能操作命令/自定义变量功能.htm',
    }),
    {
      id: 'guild-variable',
      engineVariants: {
        GEE: variant(
          '<$GUILD(变量名)>',
          '<$GUILD(${1:变量名})>',
          '读取已声明的行会自定义变量',
          '游戏引擎反外挂系统/功能操作命令/自定义变量功能.htm'
        ),
      },
    },
  ];

  const pcIcons = '游戏引擎反外挂系统/游戏功能详解/脚本中使用图标功能[!].htm';
  const pcInput = '游戏引擎反外挂系统/游戏功能详解/NPC对话框内创建输入框.htm';
  const pcItemShow = '游戏引擎反外挂系统/游戏功能详解/NPC对话框显示物品图片 显示物品属性.htm';
  const pcText = '游戏引擎反外挂系统/游戏功能详解/设置NPC文字坐标.htm';
  const pcParams = '游戏引擎反外挂系统/游戏功能详解/扩展NPC脚本点击触发带参数.htm';
  const pcVariables = '游戏引擎反外挂系统/功能操作命令/自定义变量功能.htm';
  const set996 = (id, value) => {
    const entry = entries.find(candidate => candidate.id === id);
    if (!entry) throw new Error(`Missing SAY snippet for 996PC variant: ${id}`);
    entry.engineVariants['996PC'] = value;
  };

  set996('img-relative', variant(
    '<IMG:N:F:X:Y/@Label>',
    '<IMG:${1:图片序号}:${2:资源序号}:${3:X}:${4:Y}/@${5:标签}>',
    '显示可点击的静态图片',
    pcIcons
  ));
  set996('text-absolute', variant(
    '<TEXT:内容:X:Y{FCOLOR=颜色}/@标签>',
    '<TEXT:${1:内容}:${2:X}:${3:Y}{FCOLOR=${4:250}}/@${5:标签}>',
    '使用坐标显示可点击文字',
    pcText
  ));
  set996('text-link', variant(
    '<文字/@标签>',
    '<${1:文字}/@${2:标签}>',
    '显示可点击文字',
    pcParams,
    'SCRIPTPARAM1'
  ));
  set996('text-link-params', variant(
    '<文字/@标签(参数)>',
    '<${1:文字}/@${2:标签}(${3:参数})>',
    '显示带脚本参数的可点击文字',
    pcParams,
    'SCRIPTPARAM1'
  ));
  set996('text-color', variant(
    '<文字/FCOLOR=颜色>',
    '<${1:文字}/FCOLOR=${2:250}>',
    '显示指定颜色的文字',
    pcIcons
  ));
  set996('item-show', variant(
    '<ITEMSHOW:D:F:X:Y:B>',
    '<ITEMSHOW:${1:物品ID}:${2:数量}:${3:X}:${4:Y}:${5:显示背景(0/1)}>',
    '显示物品图片并在悬停时显示属性',
    pcItemShow
  ));
  set996('input-text', variant(
    '<INPUTTEXT:ID:X:Y:W:H:BG:BORDER:COLOR:MIN:MAX:ERROR:HINT:HINTCOLOR>',
    '<INPUTTEXT:${1:ID}:${2:X}:${3:Y}:${4:宽度}:${5:高度}:${6:背景色}:${7:边框色}:${8:文字颜色}:${9:最小长度}:${10:最大长度}:${11:错误提示}:${12:提示文字}:${13:提示颜色}>',
    '创建文本输入框',
    pcInput
  ));
  set996('input-number', variant(
    '<INPUTNUM:ID:X:Y:W:H:BG:BORDER:COLOR:MIN:MAX:ERROR:HINT:HINTCOLOR>',
    '<INPUTNUM:${1:ID}:${2:X}:${3:Y}:${4:宽度}:${5:高度}:${6:背景色}:${7:边框色}:${8:文字颜色}:${9:最小值}:${10:最大值}:${11:错误提示}:${12:提示文字}:${13:提示颜色}>',
    '创建数字输入框',
    pcInput
  ));
  set996('human-variable', variant(
    '<$HUMAN(变量名)>',
    '<$HUMAN(${1:变量名})>',
    '读取已声明的人物自定义变量',
    pcVariables
  ));
  entries.push(
    {
      id: 'imgex-relative-996pc',
      engineVariants: {
        '996PC': variant(
          '<IMGEX:F:U:H:D:X:Y/@Label>',
          '<IMGEX:${1:资源序号}:${2:默认图片}:${3:移入图片}:${4:按下图片}:${5:X}:${6:Y}/@${7:标签}>',
          '显示可点击的三态按钮图片',
          pcIcons,
          'IMGEX'
        ),
      },
    },
    {
      id: 'playimg-relative-996pc',
      engineVariants: {
        '996PC': variant(
          '<PLAYIMG:F:N:C:T:X:Y:M:L:R/@Label>',
          '<PLAYIMG:${1:资源序号}:${2:开始图片}:${3:播放张数}:${4:间隔毫秒}:${5:X}:${6:Y}:${7:绘制模式(0/1)}:${8:播放次数}:${9:修复模式(0/1)}/@${10:标签}>',
          '播放动态图片，可设置绘制模式、次数和坐标修复模式',
          pcIcons,
          'PLAYIMG'
        ),
      },
    }
  );
  return entries;
}

function isMapHeading(line) {
  return /^[A-Za-z][A-Za-z0-9_]*(?:\([^）)]*\))?$/.test(line.trim());
}

function mapKey(label) {
  return label.replace(/\(.*/, '').trim().toUpperCase();
}

function syntaxLabel(heading, description) {
  if (heading.includes('(')) return heading;
  const name = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${name}\\([^\\r\\n)]*\\)`, 'i').exec(description);
  return match?.[0] || heading;
}

function parseMapInfoPage(corpus, engine) {
  const page = corpus.pages.find(candidate => candidate.relativePath === mapInfoPage);
  if (!page) throw new Error(`${engine} MapInfo help page is missing: ${mapInfoPage}`);
  const headings = [];
  for (let index = 0; index < page.lines.length; index++) {
    if (isMapHeading(page.lines[index])) headings.push(index);
  }
  const result = new Map();
  for (let position = 0; position < headings.length; position++) {
    const index = headings[position];
    const heading = page.lines[index].trim();
    const end = headings[position + 1] ?? page.lines.length;
    const description = page.lines
      .slice(index + 1, end)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const key = mapKey(heading);
    if (!description) continue;
    if (engine === 'GOM' && key === 'FLAME') continue;
    if (engine === 'GEE' && key === 'KILLMON') continue;
    result.set(key, {
      label: syntaxLabel(heading, description),
      description,
      source: source(mapInfoPage),
    });
  }

  if (engine === 'GOM') {
    result.set('SAYLEVEL', {
      label: 'SAYLEVEL(等级)',
      description: '限制当前地图人物说话等级。',
      source: source(mapInfoPage),
    });
    result.set('FB', {
      label: 'FB(数量,副本名称,模式,延时进入分钟,空图回收秒)',
      description: '配置副本模板；脚本再使用 CREATEECTYPE、MOVEECTYPE 等命令创建和进入副本。',
      source: source('游戏引擎反外挂系统/游戏功能详解/副本地图使用说明.htm'),
    });
  } else if (engine === 'GEE') {
    result.set('ONKILLMON', {
      label: 'ONKILLMON',
      description: '杀死怪物时启用对应的 QFunction 触发。',
      source: source(mapInfoPage),
    });
  }
  return result;
}

function mapInfoParams(corpora) {
  const parsed = {
    GOM: parseMapInfoPage(corpora.GOM, 'GOM'),
    GEE: parseMapInfoPage(corpora.GEE, 'GEE'),
    '996PC': parseMapInfoPage(corpora['996PC'], '996PC'),
  };
  const keys = [...new Set([
    ...parsed.GOM.keys(),
    ...parsed.GEE.keys(),
    ...parsed['996PC'].keys(),
  ])]
    .sort((left, right) => left.localeCompare(right, 'en'));
  return keys.map(id => {
    const engineVariants = {};
    for (const engine of ['GOM', 'GEE', '996PC']) {
      const value = parsed[engine].get(id);
      if (value) engineVariants[engine] = value;
    }
    return { id, engineVariants };
  });
}

function verifySources(data, corpora) {
  const failures = [];
  for (const section of ['saySnippets', 'mapInfoParams']) {
    for (const entry of data[section]) {
      for (const engine of ['GOM', 'GEE', '996PC']) {
        const value = entry.engineVariants?.[engine];
        if (!value) continue;
        const status = languageAudit.sourcePageStatus(value.source, corpora[engine]);
        if (status !== 'matched') failures.push(`${section}:${entry.id}:${engine}:${status}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Static language source verification failed:\n${failures.join('\n')}`);
  }
}

function main() {
  const corpora = {
    GOM: languageAudit.buildHelpCorpus(helpRoots.GOM),
    GEE: languageAudit.buildHelpCorpus(helpRoots.GEE),
    '996PC': languageAudit.buildHelpCorpus(helpRoots['996PC']),
  };
  const data = {
    schemaVersion: 1,
    revision,
    saySnippets: saySnippets(),
    mapInfoParams: mapInfoParams(corpora),
  };
  verifySources(data, corpora);
  const output = path.join(projectRoot, 'data', 'static-language.json');
  fs.writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  const countFor = (entries, engine) => entries.filter(entry => (
    Boolean(entry.engineVariants?.[engine])
  )).length;
  console.log(JSON.stringify({
    saySnippets: {
      total: data.saySnippets.length,
      GOM: countFor(data.saySnippets, 'GOM'),
      GEE: countFor(data.saySnippets, 'GEE'),
      '996PC': countFor(data.saySnippets, '996PC'),
    },
    mapInfoParams: {
      total: data.mapInfoParams.length,
      GOM: countFor(data.mapInfoParams, 'GOM'),
      GEE: countFor(data.mapInfoParams, 'GEE'),
      '996PC': countFor(data.mapInfoParams, '996PC'),
    },
    output,
  }, null, 2));
}

main();
