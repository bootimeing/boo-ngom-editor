#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const {
  buildHelpCorpus,
  normalizeText,
} = require('./audit-engine-language-accuracy');

const projectRoot = path.resolve(__dirname, '..', '..');

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  const value = process.argv.find(item => item.startsWith(prefix));
  return value ? path.resolve(value.slice(prefix.length)) : fallback;
}

const options = {
  gomHelp: argument('gom-help'),
  geeHelp: argument('gee-help'),
  pc996Help: argument('996pc-help'),
  output: argument(
    'output',
    path.join(projectRoot, 'data', 'audit-report', 'help-command-coverage.json')
  ),
};

const ENGINE_FILES = {
  GOM: 'data/functions.json',
  GEE: 'data/functions-gee.json',
  '996PC': 'data/functions-996pc.json',
};

const GENERIC_TOKENS = new Set([
  'ACT', 'ALL', 'AND', 'ATT', 'AUTO', 'BREAK', 'BUTTON', 'CALL', 'CHECK',
  'CLIENT', 'COLOR', 'COUNT', 'DATA', 'DATE', 'DAY', 'DB', 'DELAY', 'DEL',
  'ELSE', 'ELSEACT', 'ELSESAY', 'END', 'EXE', 'FALSE', 'FILE', 'FRAME',
  'GOTO', 'HTML', 'HTTP', 'HTTPS', 'ID', 'IF', 'IMG', 'INI', 'IP', 'ITEM',
  'JSON', 'KEY', 'LIST', 'MAP', 'MAX', 'MIN', 'MON', 'NAME', 'NONE', 'NOT', 'NPC',
  'NULL', 'OK', 'OR', 'PAK', 'PARAM', 'PATH', 'PK', 'POST', 'RANDOM', 'RESET',
  'RGB', 'SAY', 'SCRIPT', 'SERVER', 'SET', 'SQL', 'START', 'STOP', 'STR',
  'STRING', 'TABLE', 'TEXT', 'TIME', 'TRUE', 'TXT', 'UI', 'URL', 'UTC',
  'VALUE', 'WARRIOR', 'WIL', 'WIX', 'WWW', 'XLS', 'XLSX', 'YES',
  'GAMEOFMIR', 'GAMEOFMIRS', 'GOMM2ENGINE', 'M2ENGINE', 'QQQQ',
]);

const FILE_EXTENSION_RE = /\.(?:EXE|DLL|INI|TXT|CSV|XLSX?|PAK|JPK|WIL|WIX|MAP|JSON|HTML?|PNG|JPE?G|BMP|GIF)$/i;
const TOKEN_RE = /^([A-Za-z][A-Za-z0-9_.]{2,})(?=$|\s|[（(])/;
const SCRIPT_SECTION_RE = /(?:脚本检测命令|功能操作命令|英雄功能操作命令)/i;
const SCRIPT_DIRECTIVE_RE = /^#(?:IF|ACT|ELSEACT)\b/i;
const DECLARATION_RE = /^(?:(?:新增|增加|扩展|支持)?\s*)?(?:脚本)?(?:检测|执行|操作|控制)?命令(?:格式|用法|语法|名称|名)?(?:[一二三四五六七八九十\d]+)?\s*[:：]\s*(.*)$/i;
const FORMAT_RE = /^(?:命令)?(?:格式|用法|语法)(?:[一二三四五六七八九十\d]+)?\s*[:：]\s*(.*)$/i;

const DOCUMENTED_NON_COMMANDS = {
  GOM: {
    CSV: '文件格式名称',
    FCOLOR: '滚动公告的颜色参数名',
    FORMAT: '帮助正文中的格式化函数说明',
    GIVEXP: 'FORMULATION 示例中的 GIVEEXP 拼写错误',
    IDX: '物品数据库字段或检测模式说明',
    N111: '脚本变量',
    OLDMODE: '参数模式名称',
    PLAY: '声音播放语句中的普通英文词',
    SENDVERTICALMOVEMSGG: 'SENDVERTICALMOVEMSG 的拼写错误',
    SENGMSG: 'SENDMSG 的拼写错误',
    'WWW.GAMEOFMIR.COM': '网址',
  },
  GEE: {
    CHECKITEMBIND: '最新版更新记录已移除此旧绑定检测命令，请使用 CheckItemState',
    'HEADGEAREFFECT3.WZL': '补丁文件名',
    HUMAN: 'SortHumVarToList 的换行参数',
    SENDMG: 'SENDMSG 的拼写错误',
    SETITEMBIND: '最新版更新记录已移除此旧绑定设置命令，请使用 SetItemState',
    TIMEMAP: 'MapInfo 地图参数',
  },
  '996PC': {
    BUFF: '帮助页标题，页面实际命令为 SETCLIENTBUFF/CLOSECLIENTBUFF',
    EUQAL: 'EQUAL 的拼写错误',
    HTTPPSOT: 'HTTPPOST 的拼写错误，页面示例使用 HTTPPOST',
    IDX: '物品数据库字段或检测模式说明',
    S10: '脚本变量',
    SENDMOVEMSG1253255: 'HTML 标签丢失空格后粘连的 SENDMOVEMSG 参数',
    SENDMSG6: 'HTML 换行丢失空格后粘连的 SENDMSG 6',
    SETMPAMODE: 'SETMAPMODE 的拼写错误',
    SHOWFASHION0: 'HTML 换行丢失空格后粘连的 SHOWFASHION 0',
    TIMEMAP: 'MapInfo 地图参数',
  },
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function stripDirective(value) {
  return value
    .replace(/^#(?:IF|ACT|ELSEACT)\s+/i, '')
    .replace(/^NOT\s+/i, '')
    .trim();
}

function commandToken(value) {
  const match = TOKEN_RE.exec(stripDirective(value));
  if (!match) return '';
  const token = match[1].toUpperCase();
  if (token.includes('..') || FILE_EXTENSION_RE.test(token)) return '';
  if (GENERIC_TOKENS.has(token)) return '';
  return token;
}

function addEvidence(target, token, page, lineIndex, kind, score) {
  if (!token) return;
  const record = target.get(token) || {
    token,
    score: 0,
    kinds: new Set(),
    evidence: [],
  };
  record.score = Math.max(record.score, score);
  record.kinds.add(kind);
  if (record.evidence.length < 12) {
    record.evidence.push({
      page: page.relativePath,
      title: page.title,
      line: lineIndex + 1,
      text: page.lines[lineIndex],
      kind,
    });
  }
  target.set(token, record);
}

function titleCandidate(page) {
  if (!SCRIPT_SECTION_RE.test(page.relativePath)) return '';
  const title = page.title || path.basename(page.relativePath, path.extname(page.relativePath));
  return commandToken(title);
}

function collectCandidates(corpus) {
  const result = new Map();
  for (const page of corpus.pages) {
    const commandSection = SCRIPT_SECTION_RE.test(page.relativePath);
    const titleToken = titleCandidate(page);
    if (titleToken) addEvidence(result, titleToken, page, 0, 'command-page-title', 45);

    for (let index = 0; index < page.lines.length; index++) {
      const rawLine = page.lines[index].trim();
      const normalizedLine = normalizeText(rawLine);
      const declaration = DECLARATION_RE.exec(rawLine);
      const format = FORMAT_RE.exec(rawLine);
      if (declaration) {
        addEvidence(result, commandToken(declaration[1]), page, index, 'command-declaration', 100);
      }
      if (format) {
        addEvidence(result, commandToken(format[1]), page, index, 'format-line', 100);
      }

      if (SCRIPT_DIRECTIVE_RE.test(normalizedLine)) {
        const inline = normalizedLine.replace(SCRIPT_DIRECTIVE_RE, '').trim();
        if (inline) {
          addEvidence(result, commandToken(inline), page, index, 'inline-script-block', 95);
        }
        continue;
      }

      const previous = normalizeText(page.lines[index - 1] || '');
      if (/^#(?:IF|ACT|ELSEACT)$/.test(previous)) {
        addEvidence(result, commandToken(rawLine), page, index, 'script-block', 95);
        continue;
      }

      if (!commandSection) continue;
      const token = commandToken(rawLine);
      if (!token) continue;
      const suffix = stripDirective(rawLine).slice(token.length);
      if (/^\s*=/.test(suffix) || (!/^\s/.test(suffix) && suffix !== '')) continue;
      if (titleToken === token) {
        addEvidence(result, token, page, index, 'title-command-usage', 85);
      } else if (/^(?:命令)?(?:格式|用法|语法)\s*[:：]?$/i.test(page.lines[index - 1] || '')) {
        addEvidence(result, token, page, index, 'format-continuation', 100);
      } else if (suffix.trim() && /[\d<$@\[\](){}+\-*/=]|\s[A-Za-z]/.test(suffix)) {
        addEvidence(result, token, page, index, 'command-section-usage', 60);
      } else if (suffix.trim()) {
        addEvidence(result, token, page, index, 'command-section-first-token', 55);
      }
    }
  }
  return result;
}

function buildIndexes() {
  const { buildLanguageIndex } = require(path.join(projectRoot, 'out', 'utils', 'command-index'));
  const commands = readJson('data/commands.json');
  const variables = readJson('data/variables.json');
  const catalogs = Object.fromEntries(
    Object.entries(ENGINE_FILES).map(([engine, file]) => [engine, readJson(file)])
  );
  const constants = {
    GOM: readJson('data/constants-gom.json'),
    GEE: readJson('data/constants-gee.json'),
    '996PC': readJson('data/constants-996pc.json'),
  };
  return Object.fromEntries(
    Object.keys(ENGINE_FILES).map(engine => [
      engine,
      buildLanguageIndex(commands, variables, catalogs, engine, constants),
    ])
  );
}

function serializeCandidate(candidate) {
  return {
    token: candidate.token,
    score: candidate.score,
    kinds: [...candidate.kinds].sort(),
    evidence: candidate.evidence,
  };
}

function coveredByKnownCommand(token, index) {
  return coverageDisposition(token, index).kind !== 'missing';
}

function coverageDisposition(token, index) {
  if (index.commandByName.has(token)) {
    return { kind: 'exact', command: token };
  }
  const actorPrefix = /^(?:H|M|P|CO|FS|PET|L|GOM|GAMEOFMIR|S\d+)\.(.+)$/.exec(token);
  if (actorPrefix && index.commandByName.has(actorPrefix[1])) {
    return { kind: 'target-prefix', command: actorPrefix[1] };
  }
  const joinedNumber = /^(.+?)(\d+)$/.exec(token);
  if (joinedNumber && index.commandByName.has(joinedNumber[1])) {
    return { kind: 'joined-number', command: joinedNumber[1] };
  }
  return { kind: 'missing' };
}

function auditEngine(engine, root, index) {
  if (!root) throw new Error(`Missing --${engine === '996PC' ? '996pc' : engine.toLowerCase()}-help`);
  const corpus = buildHelpCorpus(root);
  const discovered = [...collectCandidates(corpus).values()]
    .map(candidate => ({
      ...serializeCandidate(candidate),
      coverage: coverageDisposition(candidate.token, index),
    }));
  const explicitlyRejected = discovered.filter(candidate => (
    DOCUMENTED_NON_COMMANDS[engine]?.[candidate.token]
  ));
  const isRejected = candidate => explicitlyRejected.includes(candidate);
  const coveredExact = discovered
    .filter(candidate => !isRejected(candidate) && candidate.coverage.kind === 'exact')
    .sort((left, right) => left.token.localeCompare(right.token));
  const coveredByTargetPrefix = discovered
    .filter(candidate => !isRejected(candidate) && candidate.coverage.kind === 'target-prefix')
    .sort((left, right) => left.token.localeCompare(right.token));
  const coveredByJoinedNumber = discovered
    .filter(candidate => !isRejected(candidate) && candidate.coverage.kind === 'joined-number')
    .sort((left, right) => left.token.localeCompare(right.token));
  const unknown = discovered.filter(candidate => (
    !isRejected(candidate) && candidate.coverage.kind === 'missing'
  ));
  const rejected = explicitlyRejected
    .map(candidate => ({
      ...candidate,
      reason: DOCUMENTED_NON_COMMANDS[engine][candidate.token],
    }))
    .sort((left, right) => left.token.localeCompare(right.token));
  const candidates = unknown
    .filter(candidate => !DOCUMENTED_NON_COMMANDS[engine]?.[candidate.token])
    .sort((left, right) => right.score - left.score || left.token.localeCompare(right.token));
  return {
    helpPages: corpus.pages.length,
    knownCommands: index.commandByName.size,
    discoveredTokens: discovered.length,
    coveredExact,
    coveredByTargetPrefix,
    coveredByJoinedNumber,
    highConfidence: candidates.filter(candidate => candidate.score >= 85),
    review: candidates.filter(candidate => candidate.score >= 55 && candidate.score < 85),
    titleOnly: candidates.filter(candidate => candidate.score < 55),
    rejected,
  };
}

function main() {
  const indexes = buildIndexes();
  const engines = {
    GOM: auditEngine('GOM', options.gomHelp, indexes.GOM),
    GEE: auditEngine('GEE', options.geeHelp, indexes.GEE),
    '996PC': auditEngine('996PC', options.pc996Help, indexes['996PC']),
  };
  const report = {
    schemaVersion: 1,
    revision: '2026-07-26',
    method: 'case-insensitive-first-token-with-script-syntax-evidence',
    engines,
    summary: Object.fromEntries(Object.entries(engines).map(([engine, value]) => [engine, {
      helpPages: value.helpPages,
      knownCommands: value.knownCommands,
      discoveredTokens: value.discoveredTokens,
      coveredExact: value.coveredExact.length,
      coveredByTargetPrefix: value.coveredByTargetPrefix.length,
      coveredByJoinedNumber: value.coveredByJoinedNumber.length,
      highConfidenceMissing: value.highConfidence.length,
      reviewMissing: value.review.length,
      titleOnlyMissing: value.titleOnly.length,
      rejectedNonCommands: value.rejected.length,
    }])),
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  for (const [engine, value] of Object.entries(engines)) {
    console.log(`${engine} high confidence: ${value.highConfidence.map(item => item.token).join(', ')}`);
    console.log(`${engine} review: ${value.review.map(item => item.token).join(', ')}`);
  }
  console.log(`Report: ${options.output}`);
}

if (require.main === module) main();

module.exports = {
  collectCandidates,
  commandToken,
  coverageDisposition,
  coveredByKnownCommand,
  DOCUMENTED_NON_COMMANDS,
};
