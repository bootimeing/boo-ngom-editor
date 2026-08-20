#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  buildHelpCorpus,
  commandUsageLines,
  inspectEngine,
  normalizeText,
} = require('./audit-engine-language-accuracy');
const {
  collectCandidates,
  coveredByKnownCommand,
  DOCUMENTED_NON_COMMANDS,
} = require('./audit-help-command-coverage');

const projectRoot = path.resolve(__dirname, '..', '..');
const revision = '2026-07-26';

function option(name, fallback = '') {
  const prefix = `--${name}=`;
  const value = process.argv.find(argument => argument.startsWith(prefix));
  return value ? path.resolve(value.slice(prefix.length)) : fallback;
}

const options = {
  apply: process.argv.includes('--apply'),
  removeGenerated: process.argv.includes('--remove-generated'),
  gomHelp: option('gom-help'),
  geeHelp: option('gee-help'),
  pc996Help: option('996pc-help'),
};

const ENGINE_FILES = {
  GOM: 'data/functions.json',
  GEE: 'data/functions-gee.json',
  '996PC': 'data/functions-996pc.json',
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function stripSyntaxPrefix(value) {
  return String(value || '')
    .replace(/^(?:(?:新增|增加|扩展|支持)?\s*)?(?:脚本)?(?:检测|执行|操作|控制)?命令(?:格式|用法|语法|名称|名)?(?:[一二三四五六七八九十\d]+)?\s*[:：]\s*/i, '')
    .replace(/^(?:命令)?(?:格式|用法|语法)(?:[一二三四五六七八九十\d]+)?\s*[:：]\s*/i, '')
    .replace(/^#(?:IF|ACT|ELSEACT)\s+/i, '')
    .replace(/^NOT\s+/i, '')
    .trim();
}

function normalizeSyntax(value, token) {
  let syntax = stripSyntaxPrefix(value)
    .replace(/\s+;.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const position = syntax.toUpperCase().indexOf(token);
  if (position > 0) syntax = syntax.slice(position);
  if (!syntax.toUpperCase().startsWith(token)) return token;
  syntax = `${token}${syntax.slice(token.length)}`.trim();
  if (syntax.length > 260 || /#(?:IF|ACT|ELSEACT|SAY)\b/i.test(syntax)) return token;
  return syntax
    .replace(/。.*$/, '')
    .replace(/[。；;]+$/, '')
    .trim();
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
      continue;
    }
    current += character;
  }
  if (current) result.push(current);
  return result;
}

function snippetParams(syntax, token, exactFormat) {
  if (!exactFormat || syntax === token) return [];
  const rest = syntax.slice(token.length).trim();
  if (!rest) return [];
  const params = splitTopLevel(rest);
  if (params.length > 20) return [];
  if (params.some(param => (
    /^[-+]?\d+(?:\.\d+)?$/.test(param)
    || /^(?:HTTPS?:|\.\.?[\\/])/.test(param)
    || /^[@#]/.test(param)
  ))) return [];
  return params;
}

function pageDescription(page, candidate, token) {
  const declaration = candidate.evidence.find(evidence => (
    evidence.page === page.relativePath
    && evidence.kind === 'command-declaration'
  ));
  if (declaration) {
    const syntax = stripSyntaxPrefix(declaration.text);
    const detail = syntax.slice(token.length).trim();
    if (detail && !/^参数\d/i.test(detail) && /[\u3400-\u9fff]/.test(detail)) {
      return detail.replace(/[。；;]+$/, '').trim();
    }
  }
  for (const line of page.lines.slice(0, 50)) {
    const match = line.match(/^(?:功能|作用|说明)\s*[:：]\s*(.+)$/i);
    if (match?.[1] && match[1].length <= 220) return match[1].replace(/[。.]$/, '').trim();
  }
  return page.title || path.basename(page.relativePath, path.extname(page.relativePath));
}

function commandContext(page, token) {
  let context = '';
  let checks = 0;
  let actions = 0;
  const matcher = new RegExp(`^(?:NOT\\s+)?${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i');
  for (const rawLine of page.lines) {
    const line = normalizeText(rawLine);
    const directive = /^#?(IF|OR|ACT|ELSEACT)\b/i.exec(line);
    if (directive) {
      context = /^(?:IF|OR)$/i.test(directive[1]) ? 'IF' : 'ACT';
      const inline = line.replace(/^#?(?:IF|OR|ACT|ELSEACT)\s*/i, '');
      if (matcher.test(inline)) {
        if (context === 'IF') checks++;
        else actions++;
      }
      continue;
    }
    if (!matcher.test(line)) continue;
    if (context === 'IF') checks++;
    if (context === 'ACT') actions++;
  }
  if (token === 'RETURN') return 'control';
  if (/^(?:CHECK|IS|HAV|POSE|GENDER|RANDOMNUMBER|WITHIN)/i.test(token)
    || /CONTAINSKEY$/i.test(token)) return 'check';
  if (/^(?:ADD|DEL|SET|GET|CHANGE|CLEAR|OPEN|CLOSE|START|STOP|TAKE|GIVE|UPDATE)/i.test(token)) {
    return 'action';
  }
  if (checks > actions) return 'check';
  if (actions > checks) return 'action';
  if (/脚本检测命令/i.test(page.relativePath)) return 'check';
  return 'action';
}

function evidenceScore(evidence, token) {
  let score = 0;
  if (evidence.kind === 'format-line' || evidence.kind === 'format-continuation') score += 100;
  else if (evidence.kind === 'command-declaration') score += 80;
  else if (evidence.kind === 'command-section-usage') score += 60;
  else if (evidence.kind === 'script-block' || evidence.kind === 'inline-script-block') score += 45;
  else score += 20;
  if (/^(?:UPDATE|历史更新)/i.test(evidence.page)) score -= 80;
  if (/功能操作命令|英雄功能操作命令|新增功能/i.test(evidence.page)) score += 35;
  if (/游戏功能详解|跨服功能|特殊触发功能/i.test(evidence.page)) score += 20;
  if (/脚本检测命令/i.test(evidence.page)) {
    score += /^(?:CHECK|IS|HAV|POSE|GENDER|RANDOMNUMBER|WITHIN)/i.test(token) ? 35 : -10;
  }
  const normalized = normalizeSyntax(evidence.text, token);
  if (normalized !== token) score += Math.min(20, normalized.length / 10);
  return score;
}

function preferredEvidence(candidate, token, kinds) {
  return candidate.evidence
    .filter(evidence => !kinds || kinds.includes(evidence.kind))
    .sort((left, right) => (
      evidenceScore(right, token) - evidenceScore(left, token)
      || normalizeSyntax(right.text, token).length - normalizeSyntax(left.text, token).length
    ))[0];
}

function syntaxForCandidate(candidate, token) {
  const exactEvidence = preferredEvidence(candidate, token, [
    'format-line',
    'format-continuation',
    'command-declaration',
  ]);
  if (exactEvidence) {
    if (exactEvidence.kind === 'command-declaration') {
      const remainder = normalizeSyntax(exactEvidence.text, token).slice(token.length).trim();
      const isSignature = /^(?:参数\d|\[|【|\(|（)/i.test(remainder)
        || /(?:参数\d|\[[^\]]+\]|【[^】]+】|\([^)]*\d[^)]*\))/.test(remainder);
      if (!isSignature) {
        return { syntax: token, exactFormat: false, evidence: exactEvidence };
      }
    }
    return {
      syntax: normalizeSyntax(exactEvidence.text, token),
      exactFormat: exactEvidence.kind !== 'command-declaration'
        || /参数|\(|（|\[|【|\s[^\u3400-\u9fff]*\d/.test(exactEvidence.text),
      evidence: exactEvidence,
    };
  }
  const evidence = preferredEvidence(candidate, token);
  if (!evidence) return { syntax: token, exactFormat: false, evidence: null };
  const documentedParameter = /参数1为([^，。；;]+)/i.exec(evidence.text)?.[1]?.trim();
  if (documentedParameter) {
    return { syntax: `${token} ${documentedParameter}`, exactFormat: true, evidence };
  }
  return {
    syntax: normalizeSyntax(evidence.text, token),
    exactFormat: evidence.kind === 'command-section-usage'
      && !/<\$/.test(evidence.text)
      && /(?:参数\d|保存|变量|路径|名称|名字|坐标|时间|数量|位置|模式|范围|操作符|检测符|是否|\bX\b|\bY\b|\bID\b)/i.test(evidence.text),
    evidence,
  };
}

function buildEntry(candidate, corpus, token) {
  const resolvedSyntax = syntaxForCandidate(candidate, token);
  const preferredPath = resolvedSyntax.evidence?.page
    || inspectEngine({ name: token, aliases: [] }, corpus, new Map()).bestPage?.path
    || candidate.evidence.find(evidence => evidence.page)?.page;
  const page = corpus.pages.find(item => item.relativePath === preferredPath);
  if (!page) throw new Error(`Help source page not found for ${token}`);
  const { syntax, exactFormat } = resolvedSyntax;
  const paramList = snippetParams(syntax, token, exactFormat);
  const kind = commandContext(page, token);
  return {
    details: pageDescription(page, candidate, token),
    params: paramList.join(' '),
    syntax,
    paramList,
    kind,
    contexts: kind === 'check' ? ['IF'] : kind === 'control' ? ['ANY'] : ['ACT'],
    source: {
      revision,
      page: page.relativePath,
      ...(page.title ? { title: page.title } : {}),
    },
    completionVerified: true,
    completionEnabled: true,
    completionReview: exactFormat
      ? 'own-help-exact-format'
      : 'own-help-script-example',
  };
}

function buildLanguageIndex(engine, catalog) {
  const commandIndex = require(path.join(projectRoot, 'out', 'utils', 'command-index'));
  const allCatalogs = {
    GOM: readJson(ENGINE_FILES.GOM),
    GEE: readJson(ENGINE_FILES.GEE),
    '996PC': readJson(ENGINE_FILES['996PC']),
    [engine]: catalog,
  };
  const constants = {
    GOM: readJson('data/constants-gom.json'),
    GEE: readJson('data/constants-gee.json'),
    '996PC': readJson('data/constants-996pc.json'),
  };
  return commandIndex.buildLanguageIndex(
    readJson('data/commands.json'),
    readJson('data/variables.json'),
    allCatalogs,
    engine,
    constants
  );
}

function applyEngine(engine, helpRoot) {
  if (!helpRoot) throw new Error(`Missing help path for ${engine}`);
  const file = ENGINE_FILES[engine];
  const catalog = readJson(file);
  const index = buildLanguageIndex(engine, catalog);
  const corpus = buildHelpCorpus(helpRoot);
  const candidates = [...collectCandidates(corpus).values()]
    .filter(candidate => candidate.score >= 55)
    .filter(candidate => {
      const current = catalog[candidate.token];
      return current?.completionReview?.startsWith('own-help')
        || !coveredByKnownCommand(candidate.token, index);
    })
    .filter(candidate => !DOCUMENTED_NON_COMMANDS[engine]?.[candidate.token]);
  const acceptedNames = new Set(candidates.map(candidate => candidate.token));
  const additions = [];
  for (const candidate of candidates) {
    const actor = /^(?:H|M|P|CO|FS|PET|L|GOM|GAMEOFMIR|S\d+)\.(.+)$/.exec(candidate.token);
    if (actor && (index.commandByName.has(actor[1]) || acceptedNames.has(actor[1]))) continue;
    const entry = buildEntry(candidate, corpus, candidate.token);
    catalog[candidate.token] = entry;
    additions.push({ name: candidate.token, ...entry });
  }
  if (options.apply) {
    const sorted = Object.fromEntries(Object.entries(catalog).sort(([left], [right]) => (
      left.localeCompare(right, 'en', { sensitivity: 'base' })
    )));
    fs.writeFileSync(path.join(projectRoot, file), `${JSON.stringify(sorted, null, 2)}\n`, 'utf8');
  }
  return additions;
}

function main() {
  if (options.removeGenerated) {
    for (const [engine, file] of Object.entries(ENGINE_FILES)) {
      const catalog = readJson(file);
      const removed = Object.entries(catalog)
        .filter(([, info]) => info.completionReview?.startsWith('own-help'))
        .map(([name]) => name);
      for (const name of removed) delete catalog[name];
      if (options.apply) {
        fs.writeFileSync(
          path.join(projectRoot, file),
          `${JSON.stringify(catalog, null, 2)}\n`,
          'utf8'
        );
      }
      console.log(`${engine}: removed ${removed.length} generated entries`);
    }
    console.log(options.apply ? 'Generated entries removed.' : 'Dry run only; pass --apply to remove entries.');
    return;
  }
  if (options.apply) {
    throw new Error(
      '已禁用未经逐条复核的自动批量录入；请使用 apply-manual-help-command-review.js --apply。'
    );
  }
  const additions = {
    GOM: applyEngine('GOM', options.gomHelp),
    GEE: applyEngine('GEE', options.geeHelp),
    '996PC': applyEngine('996PC', options.pc996Help),
  };
  for (const [engine, entries] of Object.entries(additions)) {
    console.log(`${engine}: ${entries.length} additions`);
    console.log(entries.map(entry => entry.name).join(', '));
  }
  console.log(options.apply ? 'Catalogs updated.' : 'Dry run only; pass --apply to update catalogs.');
}

if (require.main === module) main();

module.exports = {
  buildEntry,
  commandContext,
  normalizeSyntax,
  snippetParams,
};
