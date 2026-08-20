#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const audit = require('./audit-engine-language-accuracy');
const {
  buildLanguageIndex,
  commandKey,
} = require('../../out/utils/command-index');

const projectRoot = path.resolve(__dirname, '..', '..');
const apply = process.argv.includes('--apply');
const revision = '2026-07-26';
const engines = [
  {
    id: 'GOM',
    functionFile: 'functions.json',
    constantsFile: 'constants-gom.json',
    helpRevision: '2026-07-19',
    defaultHelp: path.join(process.env.LOCALAPPDATA || '', 'Temp', 'boo-help-audit-gom-20260719'),
  },
  {
    id: 'GEE',
    functionFile: 'functions-gee.json',
    constantsFile: 'constants-gee.json',
    helpRevision: '2026-07-19',
    defaultHelp: path.join(process.env.LOCALAPPDATA || '', 'Temp', 'boo-help-audit-gee-20260719'),
  },
  {
    id: '996PC',
    functionFile: 'functions-996pc.json',
    constantsFile: 'constants-996pc.json',
    helpRevision: '2026-07-23',
    defaultHelp: path.join(
      process.env.LOCALAPPDATA || '',
      'Temp',
      'boo-help-audit-20260723',
      'pc996'
    ),
  },
];

const explicitExclusions = new Set([
  'GEE:CHECKITEMBIND',
  'GEE:SETITEMBIND',
  'GEE:HOUR',
  'GEE:MIN',
]);

const commandOverrides = {
  'GOM:CHANGEMONEY': {
    syntax: 'ChangeMoney 货币名称 操作符(=/+/-) 值',
    params: ['货币名称', '操作符(=/+/-)', '值'],
    details: '调整指定货币或其关联货币的数量',
    kind: 'action',
  },
  'GOM:SETNEXTDAMAGE': {
    syntax: 'SetNextDamage 伤害百分比 是否检测异常状态(0/1)',
    params: ['伤害百分比(必须大于0)', '是否检测麻痹/冰冻/中毒状态(0/1)'],
    details: '设置当前脚本对象下一次攻击的伤害百分比及异常状态检测方式',
    kind: 'action',
  },
  '996PC:ADDARRBUTTON': {
    syntax: 'AddArrButton 分组编号 触发序号 WIL补丁序号 默认图片 经过图片 按下图片 创建界面 标题 悬浮提示',
    params: [
      '分组编号(1-7)',
      'QF触发序号([@ArrButtonClickX])',
      'WIL补丁序号',
      '默认图片',
      '鼠标经过图片',
      '按钮按下图片',
      '创建界面(0-17)',
      '标题(-1不显示)',
      '悬浮提示',
    ],
    details: '在指定客户端界面中添加自动排列按钮',
    kind: 'action',
  },
  '996PC:CHECKITEMS': {
    syntax: 'CHECKITEMS 物品列表 绑定检测方式 名称类型',
    params: [
      '物品列表(物品#数量&物品#数量)',
      '绑定检测方式(0不检测/1非绑定/2绑定)',
      '名称类型(0道具名称/1道具ID)',
    ],
    details: '批量检测背包中指定物品及数量',
    kind: 'check',
  },
  '996PC:FINDNPCPOINT': {
    syntax: 'FindNpcPoint 地图名 NPC名称 X坐标变量 Y坐标变量',
    params: ['地图名', 'NPC名称', 'X坐标变量', 'Y坐标变量'],
    details: '检测指定地图中的NPC并将坐标写入变量',
    kind: 'check',
  },
  '996PC:GIVEONITEM': {
    syntax: 'GiveOnItem 位置 物品名称 [数量:默认1] [属性位置列表]',
    params: [
      '位置(-1当前OK框/0-55装备位置/boxitem0-boxitem17)',
      '物品名称',
      '[数量:默认1]',
      '[属性位置列表(1-24)]',
    ],
    details: '创建物品并直接放入指定装备位置或OK框位置',
    kind: 'action',
  },
};

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find(argument => argument.startsWith(prefix));
  return value ? path.resolve(value.slice(prefix.length)) : fallback;
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  const target = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSyntax(value) {
  return String(value || '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[，、；：]/g, character => ({
      '，': ',', '、': ',', '；': ';', '：': ':',
    })[character])
    .trim();
}

function isNoisePage(value) {
  return /(?:^|\/)(?:UPDATE[^/]*|\d{4}年更新记录|历史更新日志)\.HTML?$/i.test(value);
}

function sourceFor(engine, page) {
  return {
    revision: engine.helpRevision,
    page: page.relativePath,
    ...(page.title ? { title: page.title } : {}),
  };
}

function cleanDescription(value, fallback) {
  const cleaned = String(value || '')
    .replace(/^(?:GOM|GEE|翎风|996PC)\s*(?:引擎)?\s*(?:文档|帮助|帮助文档)\s*[:：]\s*/i, '')
    .trim();
  return cleaned || fallback;
}

function splitTopLevelParams(syntax, name) {
  const rest = String(syntax || '').replace(
    new RegExp(`^${escapeRegex(name)}(?=\\s|$)\\s*`, 'i'),
    ''
  ).trim();
  if (!rest) return [];
  const result = [];
  let current = '';
  let depth = 0;
  for (const character of rest) {
    if ('([（【{'.includes(character)) depth++;
    if (')]）】}'.includes(character) && depth > 0) depth--;
    if (/\s/.test(character) && depth === 0) {
      if (current.trim()) result.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

function safeDocumentedSyntax(name, evidence, pagePath) {
  const syntax = String(evidence?.line || '').trim();
  if (!syntax || syntax.length > 400 || Number(evidence?.score || 0) < 14) return false;
  if (!/(?:脚本检测命令|功能操作命令|英雄功能操作命令|新增功能|游戏功能详解)/i.test(pagePath)) {
    return false;
  }
  if (!new RegExp(`^${escapeRegex(name)}(?=\\s|$)`, 'i').test(syntax)) return false;
  if (/(?:<\$|\[@|\\|\/\/|[;；]|说明|注意|示例|功能[:：]|支持了|区别|以下)/i.test(syntax)) {
    return false;
  }
  const normalized = syntax
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[【]/g, '[')
    .replace(/[】]/g, ']');
  let round = 0;
  let square = 0;
  for (const character of normalized) {
    if (character === '(') round++;
    if (character === ')') round--;
    if (character === '[') square++;
    if (character === ']') square--;
    if (round < 0 || square < 0) return false;
  }
  return round === 0 && square === 0;
}

function defaultContexts(kind) {
  return kind === 'check' ? ['IF'] : kind === 'say' ? ['SAY'] : ['ACT'];
}

function requiredParamCount(params) {
  return params.filter(param => !/^\s*\[/.test(param)).length;
}

function applyCommandOverrides(catalogs) {
  for (const [qualifiedName, override] of Object.entries(commandOverrides)) {
    const separator = qualifiedName.indexOf(':');
    const engine = qualifiedName.slice(0, separator);
    const wantedName = qualifiedName.slice(separator + 1);
    const catalog = catalogs[engine];
    if (!catalog) continue;
    const key = Object.keys(catalog).find(name => commandKey(name) === wantedName);
    if (!key) continue;
    const params = [...override.params];
    catalog[key] = {
      ...catalog[key],
      details: override.details,
      syntax: override.syntax,
      params: params.join(' '),
      paramList: params,
      kind: override.kind,
      contexts: defaultContexts(override.kind),
      minArgs: requiredParamCount(params),
      maxArgs: params.length,
      completionVerified: true,
      completionEnabled: true,
      diagnosticSupported: true,
      completionReview: 'cross-engine-help-exact',
    };
  }
}

function findPage(corpus, relativePath) {
  return corpus.pages.find(page => page.relativePath === relativePath);
}

function reconcileCommands(commands, variables, catalogs, constants, corpora) {
  const indexes = Object.fromEntries(engines.map(engine => [
    engine.id,
    buildLanguageIndex(commands, variables, catalogs, engine.id, constants),
  ]));
  const additions = [];

  for (const targetEngine of engines) {
    const targetIndex = indexes[targetEngine.id];
    const candidates = new Map();
    for (const sourceEngine of engines) {
      if (sourceEngine.id === targetEngine.id) continue;
      for (const command of indexes[sourceEngine.id].commands) {
        const key = commandKey(command.name);
        if (targetIndex.commandByName.has(key)) continue;
        const current = candidates.get(key);
        if (!current || (!current.command.completionVerified && command.completionVerified)) {
          candidates.set(key, { command, sourceEngine });
        }
      }
    }

    for (const [key, candidate] of candidates) {
      if (explicitExclusions.has(`${targetEngine.id}:${key}`)) continue;
      const inspected = audit.inspectEngine(
        { name: candidate.command.name, aliases: candidate.command.aliases || [] },
        corpora[targetEngine.id],
        new Map()
      );
      if (
        !inspected.supported
        || inspected.supportMethod !== 'definition-page'
        || !inspected.bestPage
        || isNoisePage(inspected.bestPage.path)
      ) continue;

      const page = findPage(corpora[targetEngine.id], inspected.bestPage.path);
      if (!page) continue;
      const override = commandOverrides[`${targetEngine.id}:${key}`];
      const exactEvidence = (inspected.syntaxEvidence || []).find(evidence => (
        normalizeSyntax(evidence.line) === normalizeSyntax(candidate.command.syntax)
      ));
      const sourceInspection = audit.inspectEngine(
        {
          name: candidate.command.name,
          aliases: candidate.command.aliases || [],
          source: candidate.command.source,
        },
        corpora[candidate.sourceEngine.id],
        new Map()
      );
      const samePage = Boolean(
        inspected.bestPage.hash
        && sourceInspection.bestPage?.hash === inspected.bestPage.hash
      );
      const strongEvidence = (inspected.syntaxEvidence || []).find(evidence => (
        safeDocumentedSyntax(candidate.command.name, evidence, inspected.bestPage.path)
      ));
      const verified = Boolean(
        override
        || (candidate.command.completionVerified && exactEvidence)
        || (candidate.command.completionVerified && samePage)
        || strongEvidence
      );
      const syntax = override?.syntax
        || (candidate.command.completionVerified && (exactEvidence || samePage)
          ? candidate.command.syntax
          : strongEvidence?.line || candidate.command.name);
      const params = override?.params
        || (candidate.command.completionVerified && (exactEvidence || samePage)
          ? [...candidate.command.params]
          : verified ? splitTopLevelParams(syntax, candidate.command.name) : []);
      const kind = override?.kind
        || (/脚本检测命令/i.test(page.relativePath) ? 'check' : candidate.command.kind);
      const entry = {
        details: cleanDescription(
          override?.details || candidate.command.description,
          page.title || `${candidate.command.name} 指令`
        ),
        syntax,
        params: params.join(' '),
        paramList: params,
        kind,
        contexts: defaultContexts(kind),
        aliases: [...(candidate.command.aliases || [])],
        minArgs: verified ? requiredParamCount(params) : undefined,
        maxArgs: verified ? params.length : undefined,
        source: sourceFor(targetEngine, page),
        completionVerified: verified,
        completionEnabled: verified,
        diagnosticSupported: true,
        completionReview: verified ? 'cross-engine-help-exact' : 'cross-engine-help-name-only',
      };
      for (const property of ['minArgs', 'maxArgs']) {
        if (entry[property] === undefined) delete entry[property];
      }
      catalogs[targetEngine.id][candidate.command.name] = entry;
      additions.push({
        engine: targetEngine.id,
        kind: 'command',
        name: candidate.command.name,
        sourceEngine: candidate.sourceEngine.id,
        page: page.relativePath,
        completionVerified: verified,
      });
    }
  }
  return additions;
}

function countMatches(page, pattern) {
  return [...page.text.matchAll(new RegExp(pattern.source, `${pattern.flags.replace(/g/g, '')}g`))].length;
}

function bestSymbolPage(corpus, pattern, preferredPattern) {
  const candidates = [];
  for (const page of corpus.pages) {
    if (isNoisePage(page.relativePath)) continue;
    const occurrences = countMatches(page, pattern);
    if (occurrences === 0) continue;
    const preferred = preferredPattern.test(`${page.relativePath} ${page.title}`);
    candidates.push({ page, score: occurrences + (preferred ? 20 : 0) });
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.page;
}

function classifyEntry(entry) {
  const supported = new Set(entry.engines || []);
  let status = 'compatibility';
  if (supported.has('GOM') && supported.has('GEE')) status = 'shared';
  else if (supported.has('GOM')) status = 'gom-only';
  else if (supported.has('GEE')) status = 'gee-only';
  else if (supported.has('996PC')) status = '996pc-only';
  entry.engineClassification = {
    status,
    confidence: status === 'compatibility' ? 'unverified' : 'confirmed',
    method: status === '996pc-only' ? 'manual' : 'latest-help-index',
    revision: status === '996pc-only' ? '2026-07-23' : '2026-07-19',
  };
}

function reconcileVariables(variables, corpora) {
  const additions = [];
  for (const entry of variables.variables || []) {
    for (const engine of engines) {
      if (entry.engines?.includes(engine.id) && entry.engineVariants?.[engine.id]) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.name)) continue;
      const pattern = new RegExp(`<\\$${escapeRegex(entry.name)}>`, 'i');
      const page = bestSymbolPage(
        corpora[engine.id],
        pattern,
        /脚本变量|程序变量|变量说明|变量大全/i
      );
      if (!page) continue;
      const template = entry.engineVariants?.GOM
        || entry.engineVariants?.GEE
        || entry.engineVariants?.['996PC']
        || entry;
      const ownSource = sourceFor(engine, page);
      entry.engines = unique([...(entry.engines || []), engine.id])
        .sort((left, right) => engines.findIndex(value => value.id === left)
          - engines.findIndex(value => value.id === right));
      entry.engineSources = { ...(entry.engineSources || {}), [engine.id]: ownSource };
      entry.engineVariants = {
        ...(entry.engineVariants || {}),
        [engine.id]: {
          name: entry.name,
          full: entry.full || template.full || `<$${entry.name}>`,
          scope: entry.scope || template.scope || '系统',
          desc: cleanDescription(
            entry.desc || entry.description || template.desc || template.description,
            page.title || entry.name
          ),
          aliases: unique([...(entry.aliases || []), ...(template.aliases || [])]),
          source: ownSource,
        },
      };
      entry.source = entry.engineSources.GOM
        || entry.engineSources.GEE
        || entry.engineSources['996PC'];
      additions.push({
        engine: engine.id,
        kind: 'variable',
        name: entry.name,
        page: page.relativePath,
        completionVerified: true,
      });
    }
    classifyEntry(entry);
  }
  return additions;
}

function reconcileTriggers(commands, corpora) {
  const additions = [];
  for (const entry of commands.triggers || []) {
    for (const engine of engines) {
      if (entry.engines?.includes(engine.id) && entry.engineVariants?.[engine.id]) continue;
      const label = entry.label || `[@${entry.name}]`;
      let source = escapeRegex(label);
      source = source.replace(/X(?=\\\]$)/i, '(?:X|\\d+)');
      const page = bestSymbolPage(
        corpora[engine.id],
        new RegExp(source, 'i'),
        /特殊触发|触发|QFunction|QManage/i
      );
      if (!page) continue;
      const template = entry.engineVariants?.GOM
        || entry.engineVariants?.GEE
        || entry.engineVariants?.['996PC']
        || entry;
      const ownSource = sourceFor(engine, page);
      entry.engines = unique([...(entry.engines || []), engine.id])
        .sort((left, right) => engines.findIndex(value => value.id === left)
          - engines.findIndex(value => value.id === right));
      entry.engineSources = { ...(entry.engineSources || {}), [engine.id]: ownSource };
      entry.engineVariants = {
        ...(entry.engineVariants || {}),
        [engine.id]: {
          name: entry.name,
          label,
          description: cleanDescription(
            entry.description || template.description,
            page.title || `${entry.name} 触发`
          ),
          aliases: unique([...(entry.aliases || []), ...(template.aliases || [])]),
          source: ownSource,
        },
      };
      entry.source = entry.engineSources.GOM
        || entry.engineSources.GEE
        || entry.engineSources['996PC'];
      additions.push({
        engine: engine.id,
        kind: 'trigger',
        name: entry.name,
        page: page.relativePath,
        completionVerified: true,
      });
    }
    classifyEntry(entry);
  }
  commands.totalTriggers = (commands.triggers || []).length;
  return additions;
}

function reconcileConstants(variables, constants, corpora) {
  const additions = [];
  for (const targetEngine of engines) {
    const ownNames = new Set(constants[targetEngine.id].constants.map(entry => entry.name.toUpperCase()));
    const variableNames = new Set((variables.variables || [])
      .filter(entry => entry.engines?.includes(targetEngine.id))
      .map(entry => entry.name.toUpperCase()));
    for (const sourceEngine of engines) {
      if (sourceEngine.id === targetEngine.id) continue;
      for (const constant of constants[sourceEngine.id].constants) {
        const name = constant.name.toUpperCase();
        if (ownNames.has(name) || variableNames.has(name) || !/^[A-Z_][A-Z0-9_]*$/.test(name)) {
          continue;
        }
        const page = bestSymbolPage(
          corpora[targetEngine.id],
          new RegExp(`<\\$${escapeRegex(name)}>`, 'i'),
          /脚本变量|程序变量|变量说明|变量大全|功能操作命令/i
        );
        if (!page) continue;
        constants[targetEngine.id].constants.push({
          name,
          full: constant.full || `<$${name}>`,
          description: cleanDescription(constant.description, page.title || name),
          scope: '系统常量',
          source: sourceFor(targetEngine, page),
          aliases: [...(constant.aliases || [])],
          completionVerified: true,
          completionEnabled: true,
          diagnosticSupported: true,
        });
        ownNames.add(name);
        additions.push({
          engine: targetEngine.id,
          kind: 'constant',
          name,
          sourceEngine: sourceEngine.id,
          page: page.relativePath,
          completionVerified: true,
        });
      }
    }
    constants[targetEngine.id].constants.sort((left, right) => (
      left.name.localeCompare(right.name, 'en', { sensitivity: 'base' })
    ));
    constants[targetEngine.id].generated = revision;
  }
  return additions;
}

function main() {
  const commands = readJson('data/commands.json');
  const variables = readJson('data/variables.json');
  const catalogs = Object.fromEntries(engines.map(engine => [
    engine.id,
    readJson(`data/${engine.functionFile}`),
  ]));
  const constants = Object.fromEntries(engines.map(engine => [
    engine.id,
    readJson(`data/${engine.constantsFile}`),
  ]));
  applyCommandOverrides(catalogs);
  const corpora = Object.fromEntries(engines.map(engine => {
    const helpRoot = option(`${engine.id.toLowerCase()}-help`, engine.defaultHelp);
    if (!fs.existsSync(helpRoot)) throw new Error(`Help directory does not exist: ${helpRoot}`);
    return [engine.id, audit.buildHelpCorpus(helpRoot)];
  }));

  const additions = [
    ...reconcileCommands(commands, variables, catalogs, constants, corpora),
    ...reconcileVariables(variables, corpora),
    ...reconcileTriggers(commands, corpora),
    ...reconcileConstants(variables, constants, corpora),
  ];
  const summary = Object.fromEntries(engines.map(engine => {
    const index = buildLanguageIndex(commands, variables, catalogs, engine.id, constants);
    return [engine.id, {
      commands: index.commands.length,
      commandCompletions: index.commandCompletions.length,
      variables: index.variables.length,
      engineFunctions: index.triggers.length,
      constants: index.constants.length,
      reconciled: additions.filter(entry => entry.engine === engine.id).length,
    }];
  }));
  const report = {
    schemaVersion: 1,
    revision,
    method: 'cross-engine-name-discovery-with-target-help-confirmation',
    summary,
    additions,
    explicitExclusions: [...explicitExclusions].sort(),
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Reconciled entries: ${additions.length}`);
  if (!apply) {
    console.log('Dry run only. Pass --apply to update language catalogs.');
    return;
  }

  writeJson('data/commands.json', commands);
  writeJson('data/variables.json', variables);
  for (const engine of engines) {
    const sortedCatalog = Object.fromEntries(Object.entries(catalogs[engine.id]).sort(
      ([left], [right]) => left.localeCompare(right, 'en', { sensitivity: 'base' })
    ));
    writeJson(`data/${engine.functionFile}`, sortedCatalog);
    writeJson(`data/${engine.constantsFile}`, constants[engine.id]);
  }
  writeJson('data/audit-report/cross-engine-omissions.json', report);
}

main();
