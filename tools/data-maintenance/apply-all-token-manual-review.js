#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const review = require('./help-all-token-manual-review');

const root = path.resolve(__dirname, '..', '..');
const apply = process.argv.includes('--apply');
const reportPath = path.join(root, 'data', 'audit-report', 'all-help-english-tokens-final.json');
const outputPath = path.join(root, 'data', 'audit-report', 'help-all-token-manual-review-final.json');
const backupRoot = path.join(root, 'data', 'backups', 'language-before-full-token-review-20260726');

const ENGINE_FILES = {
  GOM: 'data/functions.json',
  GEE: 'data/functions-gee.json',
  '996PC': 'data/functions-996pc.json',
};

const CONSTANT_FILES = {
  GOM: 'data/constants-gom.json',
  GEE: 'data/constants-gee.json',
  '996PC': 'data/constants-996pc.json',
};

const ENGINE_ORDER = ['GOM', 'GEE', '996PC'];

const DISPLAY_NAMES = {
  ADDWARNATION: 'AddWarNation',
  ATTATCKMODECHANGE: 'AttatckModeChange',
  CACHEGETSTRINGPOSEX: 'CacheGetStringPosEx',
  CHANGESLAVELEVE: 'ChangeSlaveLeve',
  CLOSECLIENTBUFFN: 'CloseClientBuffX',
  CURAREATYPE: 'CurAreaType',
  GETHUMCUSTOMITEMVALUE: 'GetHumCustomItemValue',
  GETMAPTITLE: 'GetMapTitle(X)',
  GETTYPEBROW: 'GetTypeBRow(...)',
  HEROGROUPITEMONEX: 'HeroGroupItemOnEX',
  INPUTINTEGER: 'InputIntegerX',
  KILLMONEXPRATERECOVER: 'KillMonExpRateRecover',
  PASSWORDLCOKSYSTEM: 'PasswordLcokSystem',
  PICKDROPITEMNAM: 'PickDropItemNam',
  RECALCABILITYS: 'RecalcAbilitys',
  SENDREDVARTOCLIENT: 'SendRedVarToClient',
  SETHUMATTCAKMODE: 'SetHumAttcakMode',
  WEBBROSER: 'WebBroser',
};

const SYNTAX = {
  GOM: {
    ADDWARNATION: 'AddWarNation 国家名称',
    DARTTIME: 'DartTime 存活时间(秒) 下线是否消失(0/1,可空)',
    FIRSTPICKUPITEM: 'FIRSTPICKUPITEM 优先拾取地面物品(0/1)',
    GETHUMCUSTOMITEMVALUE: 'GetHumCustomItemValue 属性位置(-1或0~19) 绑定属性类型(0~17) 属性值变量 百分比变量',
    'M.CHANGEMODEEX': 'M.ChangeModeEx 模式(11禁锢) 时间(秒) 禁锢范围 免疫等级',
    MAILGIVE: 'MailGive 物品名称 禁止扔 禁止交易 禁止存 禁止修 禁止出售 禁止爆出 丢弃消失 数量 是否绑定(0/1)',
    SENDMAIL: 'SendMail 邮件标题 邮件内容 接收范围(0当前玩家,1在线玩家,2所有玩家,3指定玩家) 指定玩家名(可空)',
    SETITEMBAGBUTTONINFO: 'SETITEMBAGBUTTONINFO 按钮编号(1~5) 是否可见(0/1) 坐标X 坐标Y 提示信息',
    UPDATEBOXITEM: 'UpDateBoxItem OK框编号',
  },
  GEE: {
    'H.CHECKNEWFENGHAOVALUE': 'H.CheckNewFengHaoValue 称号名 属性(0~10) 比较符(>、<、=) 属性值(1~100)',
    'H.SETNEWFENGHAOVALUE': 'H.SetNewFengHaoValue 称号名 属性(0~10) 操作符(+/-/=) 属性值(1~100)',
  },
  '996PC': {
    ADDTOCASTLEWARLISTEX: 'AddToCastleWarListEx 城堡名称 行会名称或*',
    CAIJIBYPARAM: 'CAIJIBYPARAM 采集参数',
    CLEARGLOBALCUSTVAR: 'ClearGlobalCustVar 变量名(*表示全部，多个用|分隔)',
    CLEARHUMCUSTVAR: 'ClearHumCustVar 人物名 变量名(*表示全部，多个用|分隔)',
    CREATENATION: 'CreateNation 国家ID 国家名称',
    DARTTIME: 'DartTime 存活时间(秒) 下线是否消失(0/1,可空)',
    DELNATION: 'DelNation 国家ID',
    GETNEWCUSTOMITEMABIL: 'GetNewCustomItemAbil 装备位置 属性位置(1~30) 保存变量',
    GETSTRKEY: 'GetStrKey 键名 保存变量',
    GIVESTATEITEMEX: 'GiveStateItemEx 物品名称 数量 禁止扔 禁止交易 禁止存 禁止修 禁止出售 禁止爆出 丢弃消失 是否绑定',
    LOOPBAGITEMS: 'LoopBagItems 回调标签 唯一ID变量 物品名变量 数量变量',
    SENDMAIL: 'SendMail 自定义邮件ID 邮件标题 邮件内容 物品类型',
    SETITEMBAGBUTTONINFO: 'SetItemBagButtonInfo 按钮编号 是否可见(0/1) 坐标X 坐标Y 提示信息',
    SORTSTRING: 'SortString 原字符串 分隔符 保存变量',
    TRIM: 'Trim 字符串或变量 模式',
  },
};

const DESCRIPTION = {
  GOM: {
    CHECKGUILDMEMBER: '检测当前人物是否为指定行会成员',
    KILLERRACE: '检测击杀者是人物还是怪物',
    ADDWARNATION: '将国家加入国战',
    DARTTIME: '设置镖车存活时间及下线消失规则',
    FIRSTPICKUPITEM: '设置假人优先拾取地面物品',
    GETHUMCUSTOMITEMVALUE: '获取人物穿戴装备的自定义属性值',
    MAILGIVE: '向下一封邮件附加物品',
    SENDMAIL: '发送邮件',
    SETITEMBAGBUTTONINFO: '动态设置自定义背包按钮',
    UPDATEBOXITEM: '刷新指定自定义 OK 框物品',
    WEBBROSER: '使用客户端内置浏览器打开网址',
  },
  GEE: {
    CHECKGUILDMEMBER: '检测当前人物是否为指定行会成员',
    KILLERRACE: '检测击杀者是人物还是怪物',
    MAPTOGGLE: '切换地图显示状态',
    PLAYSOUNDEX: '按扩展模式播放声音',
    WEBBROSER: '使用客户端内置浏览器打开网址',
  },
  '996PC': {
    AUTOUSEMAGIC: '设置假人自动练功技能',
    CAIJIBYPARAM: '按指定参数执行自定义采集',
    CHECKONLINEPLAYCOUNT: '检测服务器在线人数',
    CREATENATION: '创建国家',
    DELNATION: '删除国家',
    GETNEWCUSTOMITEMABIL: '获取新版自定义装备属性',
    OPENSTORAGE: '打开可视化仓库',
    SORTSTRING: '对数值字符串进行排序',
    TRIM: '清理字符串中的空格',
  },
};

const CONSTANT_SHAPES = {
  ATTR: ['ATTR', '<$ATTR[X]>'],
  CUSTJOBABIL: ['CUSTJOBABIL', '<$CUSTJOBABIL[XXX]>'],
  GETMAPTITLE: ['GetMapTitle', '<$GetMapTitle(X)>'],
  GETTYPEBROW: ['GetTypeBRow', '<$GetTypeBRow(表名,列,关键字)>'],
  'H.ATTR': ['H.ATTR', '<$H.ATTR[X]>'],
  'H.SLAVE': ['H.SLAVE', '<$H.SLAVE(X).NAME>'],
  'H.USEITEMNAME': ['H.USEITEMNAME', '<$H.USEITEMNAME[X]>'],
  SLAVE: ['SLAVE', '<$SLAVE(X).NAME>'],
};

const MAP_INFO_SYNTAX = {
  FIGHT6: 'FIGHT6(是否掉落0/1)',
  HITMON: 'HITMON(@触发标签)',
  NOAUCTION: 'NOAUCTION',
  NOEXPRATE: 'NOEXPRATE',
  PKLOSTEXPP: 'PKLOSTEXPP(死亡掉落经验)',
  PULSEEXPRATE: 'PULSEEXPRATE(英雄经络经验倍数)',
  REVIVALREVIVAL: 'REVIVALREVIVAL(X:N)',
  SECRET: 'SECRET(模式|固定名字|参数3|参数4)',
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function writeJsonAtomic(relativePath, value) {
  const target = path.join(root, relativePath);
  const temporary = `${target}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
}

function backup(relativePath) {
  const source = path.join(root, relativePath);
  const destination = path.join(backupRoot, path.basename(relativePath));
  fs.mkdirSync(backupRoot, { recursive: true });
  if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
}

function acceptedTokens(engineReview) {
  const accepted = engineReview.accept;
  return [
    ...accepted.commands.check,
    ...accepted.commands.action,
    ...accepted.triggers,
    ...accepted.constants,
    ...accepted.staticLanguage,
  ];
}

function candidateMap(engineReport) {
  return new Map([
    ...engineReport.commandReview,
    ...engineReport.updateContextReview,
  ].map(entry => [entry.token, entry]));
}

function validate(engine, engineReport, engineReview) {
  const candidates = candidateMap(engineReport);
  const reviewed = new Set([...acceptedTokens(engineReview), ...engineReview.reject]);
  const missing = [...candidates.keys()].filter(token => !reviewed.has(token));
  const extra = [...reviewed].filter(token => !candidates.has(token));
  const overlap = engineReview.reject.filter(token => acceptedTokens(engineReview).includes(token));
  if (missing.length || extra.length || overlap.length) {
    throw new Error(`${engine} 清单不完整 missing=[${missing}] extra=[${extra}] overlap=[${overlap}]`);
  }
  return candidates;
}

function preferredEvidence(candidate) {
  const evidence = [...candidate.evidence];
  evidence.sort((left, right) => {
    const leftUpdate = /(?:^|\/)(?:update|.*更新)/i.test(left.page) ? 1 : 0;
    const rightUpdate = /(?:^|\/)(?:update|.*更新)/i.test(right.page) ? 1 : 0;
    return leftUpdate - rightUpdate
      || Number(Boolean(right.title)) - Number(Boolean(left.title))
      || left.page.localeCompare(right.page)
      || left.line - right.line;
  });
  return evidence[0];
}

function sourceFor(candidate) {
  const evidence = preferredEvidence(candidate);
  if (!evidence) throw new Error(`${candidate.token} 缺少帮助证据`);
  return {
    revision: review.revision,
    page: evidence.page,
    ...(evidence.title ? { title: evidence.title } : {}),
    evidenceLine: evidence.line,
  };
}

function displayName(token) {
  return DISPLAY_NAMES[token] || token;
}

function descriptionFor(engine, token, candidate) {
  if (DESCRIPTION[engine]?.[token]) return DESCRIPTION[engine][token];
  const evidence = preferredEvidence(candidate);
  return evidence.title && !/(?:update|更新)/i.test(evidence.page)
    ? evidence.title
    : evidence.text.replace(/^\d+[.、，]\s*/, '').trim();
}

function splitTopLevel(value) {
  const result = [];
  let current = '';
  let depth = 0;
  for (const character of value) {
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
  return result;
}

function commandEntry(engine, token, kind, candidate) {
  const name = displayName(token);
  const syntax = SYNTAX[engine]?.[token] || name;
  const params = syntax === name ? [] : splitTopLevel(syntax.slice(name.length).trim());
  const exact = syntax !== name;
  return {
    name,
    syntax,
    details: descriptionFor(engine, token, candidate),
    params: params.join(' '),
    paramList: params,
    kind,
    contexts: kind === 'check' ? ['IF'] : ['ACT'],
    aliases: [],
    source: sourceFor(candidate),
    completionVerified: exact,
    completionEnabled: exact,
    diagnosticSupported: true,
    completionReview: exact
      ? 'manual-own-help-exact'
      : 'manual-own-help-name-only-disabled',
  };
}

function classificationFor(engines) {
  const legacy = engines.filter(engine => engine !== '996PC');
  let status = '996pc-only';
  if (legacy.includes('GOM') && legacy.includes('GEE')) status = 'shared';
  else if (legacy.includes('GOM')) status = 'gom-only';
  else if (legacy.includes('GEE')) status = 'gee-only';
  return {
    status,
    confidence: 'confirmed',
    method: 'manual',
    revision: review.revision,
  };
}

function addTrigger(commands, engine, token, candidate) {
  const name = displayName(token);
  const key = name.toUpperCase();
  let entry = commands.triggers.find(item => item.name.toUpperCase() === key);
  const source = sourceFor(candidate);
  const variant = {
    name,
    label: `[@${name}]`,
    description: descriptionFor(engine, token, candidate),
    aliases: [],
    source,
  };
  if (!entry) {
    entry = {
      name,
      label: variant.label,
      description: variant.description,
      engines: [],
      engineSources: {},
      engineVariants: {},
    };
    commands.triggers.push(entry);
  }
  entry.engines = ENGINE_ORDER.filter(item => new Set([...(entry.engines || []), engine]).has(item));
  entry.engineSources = { ...(entry.engineSources || {}), [engine]: source };
  entry.engineVariants = { ...(entry.engineVariants || {}), [engine]: variant };
  entry.source = entry.engineSources[entry.engines[0]];
  entry.engineClassification = classificationFor(entry.engines);
}

function addConstant(catalog, engine, token, candidate) {
  const [name, full] = CONSTANT_SHAPES[token] || [displayName(token), `<$${displayName(token)}>`];
  const key = name.toUpperCase();
  const existing = catalog.constants.find(entry => entry.name.toUpperCase() === key);
  const value = {
    name,
    full,
    description: descriptionFor(engine, token, candidate),
    scope: '系统常量',
    source: sourceFor(candidate),
    aliases: [],
    completionVerified: true,
    completionEnabled: true,
    diagnosticSupported: true,
  };
  if (existing) Object.assign(existing, value);
  else catalog.constants.push(value);
}

function addStaticVariant(staticData, engine, token, candidate) {
  if (token === 'AUTORUN' || token === 'RUNONHOUR') return 'robot-directive-audit-only';
  const source = sourceFor(candidate);
  const description = descriptionFor(engine, token, candidate);
  if (token === 'COUNTDOWN' || token === 'TIMETIPS') {
    const id = token === 'COUNTDOWN' ? 'countdown' : 'time-tips';
    let entry = staticData.saySnippets.find(item => item.id === id);
    if (!entry) {
      entry = { id, engineVariants: {} };
      staticData.saySnippets.push(entry);
    }
    entry.engineVariants[engine] = token === 'COUNTDOWN'
      ? {
        label: '<COUNTDOWN:秒数:次数:颜色:X:Y/@标签>',
        snippet: '<COUNTDOWN:${1:秒数}:${2:次数(0无限)}:${3:颜色}:${4:X}:${5:Y}/@${6:标签}>',
        description,
        source,
      }
      : {
        label: '<TIMETIPS:秒数:次数:颜色:X:Y/@标签>',
        snippet: '<TIMETIPS:${1:秒数}:${2:次数(0无限)}:${3:颜色}:${4:X}:${5:Y}/@${6:标签}>',
        description,
        source,
      };
    return 'say-snippet';
  }
  let entry = staticData.mapInfoParams.find(item => item.id === token);
  if (!entry) {
    entry = { id: token, engineVariants: {} };
    staticData.mapInfoParams.push(entry);
  }
  entry.engineVariants[engine] = {
    label: MAP_INFO_SYNTAX[token] || token,
    description,
    source,
  };
  return 'map-info';
}

function sortObject(object) {
  return Object.fromEntries(Object.entries(object).sort(([left], [right]) => (
    left.localeCompare(right, 'en', { sensitivity: 'base' })
  )));
}

function main() {
  const scan = readJson('data/audit-report/all-help-english-tokens-final.json');
  const commands = readJson('data/commands.json');
  const staticData = readJson('data/static-language.json');
  const functions = Object.fromEntries(Object.entries(ENGINE_FILES).map(
    ([engine, file]) => [engine, readJson(file)]
  ));
  const constants = Object.fromEntries(Object.entries(CONSTANT_FILES).map(
    ([engine, file]) => [engine, readJson(file)]
  ));
  const ledger = {
    schemaVersion: 1,
    revision: review.revision,
    policy: review.policy,
    engines: {},
  };

  for (const engine of ENGINE_ORDER) {
    const engineReview = review.engines[engine];
    const candidates = validate(engine, scan.engines[engine], engineReview);
    const records = [];
    for (const kind of ['check', 'action']) {
      for (const token of engineReview.accept.commands[kind]) {
        const entry = commandEntry(engine, token, kind, candidates.get(token));
        functions[engine][entry.name] = entry;
        records.push({ token, decision: 'accept', category: `${kind}-command`, entry });
      }
    }
    for (const token of engineReview.accept.triggers) {
      addTrigger(commands, engine, token, candidates.get(token));
      records.push({ token, decision: 'accept', category: 'trigger', source: sourceFor(candidates.get(token)) });
    }
    for (const token of engineReview.accept.constants) {
      addConstant(constants[engine], engine, token, candidates.get(token));
      records.push({ token, decision: 'accept', category: 'constant', source: sourceFor(candidates.get(token)) });
    }
    for (const token of engineReview.accept.staticLanguage) {
      const category = addStaticVariant(staticData, engine, token, candidates.get(token));
      records.push({ token, decision: 'accept', category, source: sourceFor(candidates.get(token)) });
    }
    for (const token of engineReview.reject) {
      records.push({
        token,
        decision: 'reject',
        reason: '逐条核对上下文后确认不是独立脚本命令、内置触发、系统常量或静态语法项',
        evidence: candidates.get(token).signalEvidence,
      });
    }
    records.sort((left, right) => left.token.localeCompare(right.token));
    ledger.engines[engine] = records;
  }

  commands.triggers.sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));
  commands.totalTriggers = commands.triggers.length;
  staticData.revision = review.revision;
  for (const engine of ENGINE_ORDER) {
    constants[engine].generated = review.revision;
    constants[engine].constants.sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));
  }

  ledger.summary = Object.fromEntries(ENGINE_ORDER.map(engine => {
    const rows = ledger.engines[engine];
    return [engine, {
      acceptedRecords: rows.filter(row => row.decision === 'accept').length,
      acceptedUniqueTokens: new Set(rows.filter(row => row.decision === 'accept').map(row => row.token)).size,
      rejected: rows.filter(row => row.decision === 'reject').length,
      exactCommandSyntax: rows.filter(row => row.entry?.completionVerified).length,
      nameOnlyCommands: rows.filter(row => row.entry && !row.entry.completionVerified).length,
    }];
  }));

  if (apply) {
    for (const file of [
      ...Object.values(ENGINE_FILES),
      ...Object.values(CONSTANT_FILES),
      'data/commands.json',
      'data/static-language.json',
    ]) backup(file);
    for (const [engine, file] of Object.entries(ENGINE_FILES)) {
      writeJsonAtomic(file, sortObject(functions[engine]));
    }
    for (const [engine, file] of Object.entries(CONSTANT_FILES)) {
      writeJsonAtomic(file, constants[engine]);
    }
    writeJsonAtomic('data/commands.json', commands);
    writeJsonAtomic('data/static-language.json', staticData);
    writeJsonAtomic(path.relative(root, outputPath), ledger);
  }

  console.log(JSON.stringify(ledger.summary, null, 2));
  console.log(apply ? `已应用并写入 ${outputPath}` : '清单验证通过；未写入（使用 --apply 应用）');
}

if (require.main === module) main();

module.exports = {
  commandEntry,
  preferredEvidence,
  splitTopLevel,
  validate,
};
