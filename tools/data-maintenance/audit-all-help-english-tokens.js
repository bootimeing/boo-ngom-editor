#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { buildHelpCorpus } = require('./audit-engine-language-accuracy');
const manualReview = require('./help-command-manual-review');
const fullTokenReview = require('./help-all-token-manual-review');

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
    path.join(projectRoot, 'data', 'audit-report', 'all-help-english-tokens.json')
  ),
};

const ENGINE_FILES = {
  GOM: 'data/functions.json',
  GEE: 'data/functions-gee.json',
  '996PC': 'data/functions-996pc.json',
};

const HELP_ROOTS = {
  GOM: () => options.gomHelp,
  GEE: () => options.geeHelp,
  '996PC': () => options.pc996Help,
};

const TOKEN_RE = /[A-Za-z_][A-Za-z0-9_.]*/g;
const UPDATE_PAGE_RE = /(?:^|\/)(?:update|.*更新(?:记录|日志)?)[^/]*\.html?$/i;
const CHANGE_CONTEXT_RE = /新增|新加|增加|添加|扩展|开放|加入|支持|修改|调整|修复|改进|完善|优化/gi;
const COMMAND_SECTION_RE = /(?:脚本检测命令|功能操作命令|英雄功能操作命令)/i;
const COMMAND_WORD_RE = /(?:脚本)?(?:检测|执行|操作|控制)?(?:命令|指令)/gi;
const FORMAT_PREFIX_RE = /(?:创建|删除|获取|检测|检查|修改|设置|增加|添加|清理|调用|执行|读取|保存|扩展|打开|关闭|中止|停止|开始|加入|退出|传送|重载|恢复|给予|调整|排序|随机|合并|分割|复制|查询|发放|扣除|改变|刷新|移除|返回|生成)?(?:命令)?(?:格式|用法|语法)\s*[:：]?\s*/gi;
const SCRIPT_DIRECTIVE_RE = /^\s*#(?:IF|ACT|ELSEACT)\s*/i;

const GENERAL_TERMS = new Set([
  'ACT', 'ALL', 'ALT', 'AND', 'ANSI', 'API', 'ASCII', 'AUTO', 'BOLD', 'BOSS',
  'BREAK', 'BUFF', 'BUG', 'BUTTON', 'CALL', 'CASE', 'CD', 'CHILD', 'CLIENT',
  'COLOR', 'CONST', 'COPY', 'COUNT', 'CPU', 'CTRL', 'DATA', 'DATE', 'DAY', 'DB',
  'DELAY', 'DEL', 'ELSE', 'ELSEACT', 'ELSESAY', 'END', 'ESC', 'FALSE', 'FILE',
  'FONT', 'FPS', 'FRI', 'GAMEOFMIR', 'GAMEOFMIRS', 'GET', 'GLOBAL', 'GM', 'GOM',
  'HTML', 'HTTP', 'HTTPS', 'HUMAN', 'ID', 'IDX', 'IF', 'INFO', 'INT', 'INTEGER',
  'ITEM', 'JSON', 'KEY', 'LIST', 'MAP', 'MAX', 'MIN', 'MON', 'MONSTER', 'NAME',
  'NEW', 'NONE', 'NPC', 'NULL', 'OK', 'OPEN', 'PARAM', 'PARAMS', 'PASSWORD',
  'PET', 'PK', 'POST', 'RANDOM', 'RECORD', 'RESET', 'RGB', 'ROW', 'SAFE', 'SAT',
  'SAY', 'SCRIPT', 'SEC', 'SELF', 'SERVER', 'SET', 'SHIFT', 'SIZE', 'SOURCE',
  'START', 'STOCK', 'STOP', 'STR', 'STRING', 'SUN', 'TABLE', 'TAOIST', 'TCP',
  'TEST', 'TEXT', 'THU', 'TIME', 'TIPS', 'TRUE', 'TUE', 'TYPE', 'UI', 'UNIT',
  'URL', 'UTC', 'VALUE', 'WARRIOR', 'WED', 'WEIGHT', 'WIZARD', 'WOMAN', 'WWW',
]);

const FILE_EXTENSION_RE = /\.(?:BMP|CHM|CSV|DAT|DB|DBC|DLL|EXE|GIF|HTM|HTML|IDX|INI|JPE?G|JPK|JSON|MAP|MP3|PAK|PNG|SQL|TXT|WAV|WIL|WIX|WZL|XLSX?)$/i;
const VARIABLE_PATTERN_RE = /^(?:[A-Z]{1,4}\d+|[A-Z]+\d+_[A-Z0-9_]+|[A-Z]+_[A-Z0-9_]*\d+|STR[A-Z]?\d+)$/;
const PLACEHOLDER_PATTERN_RE = /^(?:PARAM|VALUE|TYPE|COLOR|RATE|POS|GINDEX|GNAME|ITEM|DRILL|WEATHER|TAGMAPINFO|CREATEHERO)\w*\d+$/;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
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

function staticTokens() {
  const data = readJson('data/static-language.json');
  const byEngine = Object.fromEntries(Object.keys(ENGINE_FILES).map(engine => [engine, new Set()]));
  for (const section of ['saySnippets', 'mapInfoParams']) {
    for (const entry of data[section] || []) {
      for (const engine of Object.keys(ENGINE_FILES)) {
        const variant = entry.engineVariants?.[engine];
        if (!variant) continue;
        for (const value of [
          entry.id,
          variant.name,
          variant.label,
          variant.snippet,
          variant.evidenceToken,
        ]) {
          if (!value) continue;
          for (const match of String(value).matchAll(TOKEN_RE)) {
            byEngine[engine].add(match[0].toUpperCase());
          }
        }
      }
    }
  }
  return byEngine;
}

function reviewedRejects(engine) {
  const result = new Map(Object.entries(manualReview.engines[engine]?.reject || {}).map(
    ([token, reason]) => [token.toUpperCase(), reason]
  ));
  for (const token of fullTokenReview.engines[engine]?.reject || []) {
    result.set(
      token.toUpperCase(),
      '全文嵌入式候选已逐条核对，确认不是独立语言目录项'
    );
  }
  return result;
}

function reviewedAcceptedTokens(engine) {
  const accepted = fullTokenReview.engines[engine]?.accept;
  if (!accepted) return new Set();
  return new Set([
    ...(accepted.commands?.check || []),
    ...(accepted.commands?.action || []),
    ...(accepted.triggers || []),
    ...(accepted.constants || []),
    ...(accepted.staticLanguage || []),
  ].map(token => token.toUpperCase()));
}

function tokenAtOrAfter(line, start, maximumDistance = 32) {
  TOKEN_RE.lastIndex = start;
  const match = TOKEN_RE.exec(line);
  TOKEN_RE.lastIndex = 0;
  return match && match.index - start <= maximumDistance ? match[0].toUpperCase() : '';
}

function explicitSignals(line) {
  const signals = new Map();
  const add = (token, kind) => {
    if (!token) return;
    const kinds = signals.get(token) || new Set();
    kinds.add(kind);
    signals.set(token, kinds);
  };

  COMMAND_WORD_RE.lastIndex = 0;
  for (const match of line.matchAll(COMMAND_WORD_RE)) {
    add(tokenAtOrAfter(line, match.index + match[0].length), 'after-command-word');
    const before = line.slice(Math.max(0, match.index - 36), match.index);
    const beforeTokens = [...before.matchAll(TOKEN_RE)];
    add(beforeTokens.at(-1)?.[0]?.toUpperCase(), 'before-command-word');
  }

  FORMAT_PREFIX_RE.lastIndex = 0;
  for (const match of line.matchAll(FORMAT_PREFIX_RE)) {
    add(tokenAtOrAfter(line, match.index + match[0].length), 'format-head');
  }

  if (SCRIPT_DIRECTIVE_RE.test(line)) {
    const body = line.replace(SCRIPT_DIRECTIVE_RE, '');
    add(body.match(TOKEN_RE)?.[0]?.toUpperCase(), 'inline-script-command');
  }
  return signals;
}

function updateChangeSignals(line) {
  const signals = new Map();
  const add = (token, kind) => {
    if (!token) return;
    const kinds = signals.get(token) || new Set();
    kinds.add(kind);
    signals.set(token, kinds);
  };
  CHANGE_CONTEXT_RE.lastIndex = 0;
  for (const match of line.matchAll(CHANGE_CONTEXT_RE)) {
    add(tokenAtOrAfter(line, match.index + match[0].length, 64), 'after-update-change-word');
    const before = line.slice(Math.max(0, match.index - 36), match.index);
    const beforeTokens = [...before.matchAll(TOKEN_RE)];
    add(beforeTokens.at(-1)?.[0]?.toUpperCase(), 'before-update-change-word');
  }
  return signals;
}

function knownDisposition(token, index, engineStaticTokens, rejects, reviewedAccepted) {
  if (index.commandByName.has(token)) return { kind: 'known-command' };
  if (index.variableByName.has(token)) return { kind: 'known-variable' };
  if (index.constantByName.has(token)) return { kind: 'known-constant' };
  if (index.triggerByName.has(token)) return { kind: 'known-trigger' };
  if (engineStaticTokens.has(token)) return { kind: 'known-static-language' };
  if (reviewedAccepted.has(token)) return { kind: 'reviewed-language-token' };
  if (rejects.has(token)) return { kind: 'reviewed-non-command', reason: rejects.get(token) };
  if (FILE_EXTENSION_RE.test(token)) return { kind: 'file-or-resource-name' };
  if (VARIABLE_PATTERN_RE.test(token) || PLACEHOLDER_PATTERN_RE.test(token)) {
    return { kind: 'variable-field-or-placeholder-pattern' };
  }
  if (GENERAL_TERMS.has(token)) return { kind: 'general-technical-term' };
  return { kind: 'not-in-language-catalog' };
}

function addOccurrence(record, occurrence, signalKinds) {
  record.occurrenceCount++;
  record.pages.add(occurrence.page);
  if (record.evidence.length < 8) record.evidence.push(occurrence);
  for (const signal of signalKinds || []) {
    record.signals.add(signal);
    const key = `${occurrence.page}:${occurrence.line}:${signal}`;
    if (!record.signalKeys.has(key) && record.signalEvidence.length < 20) {
      record.signalKeys.add(key);
      record.signalEvidence.push({ ...occurrence, signal });
    }
  }
}

function auditEngine(engine, root, index, engineStaticTokens) {
  if (!root) throw new Error(`Missing --${engine === '996PC' ? '996pc' : engine.toLowerCase()}-help`);
  const corpus = buildHelpCorpus(root);
  const rejects = reviewedRejects(engine);
  const reviewedAccepted = reviewedAcceptedTokens(engine);
  const records = new Map();

  for (const page of corpus.pages) {
    const commandSection = COMMAND_SECTION_RE.test(page.relativePath);
    const updatePage = UPDATE_PAGE_RE.test(page.relativePath);
    let scriptContext = '';
    for (let lineIndex = 0; lineIndex < page.lines.length; lineIndex++) {
      const line = page.lines[lineIndex];
      if (/^#(?:IF|ACT|ELSEACT)$/i.test(line.trim())) scriptContext = line.trim().toUpperCase();
      else if (/^#(?:SAY|ELSESAY)$/i.test(line.trim()) || /^\[@/i.test(line.trim())) scriptContext = '';

      const directSignals = explicitSignals(line);
      const updateSignals = updatePage ? updateChangeSignals(line) : new Map();
      const tokens = [...line.matchAll(TOKEN_RE)];
      const lineCommandToken = line.trim()
        .match(/^(?:NOT\s+)?([A-Za-z_][A-Za-z0-9_.]*)/i)?.[1]?.toUpperCase() || '';
      for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex++) {
        const match = tokens[tokenIndex];
        const token = match[0].toUpperCase();
        const record = records.get(token) || {
          token,
          occurrenceCount: 0,
          pages: new Set(),
          evidence: [],
          signals: new Set(),
          signalEvidence: [],
          signalKeys: new Set(),
        };
        const signals = new Set(directSignals.get(token) || []);
        for (const signal of updateSignals.get(token) || []) signals.add(signal);
        if (commandSection && token === lineCommandToken) signals.add('command-section-first-token');
        if (scriptContext && token === lineCommandToken && !/^#/.test(line.trim())) {
          signals.add(scriptContext === '#IF' ? 'script-check-line' : 'script-action-line');
        }
        addOccurrence(record, {
          page: page.relativePath,
          title: page.title,
          line: lineIndex + 1,
          text: line,
        }, signals);
        records.set(token, record);
      }
    }
  }

  const tokens = [...records.values()]
    .map(record => {
      const disposition = knownDisposition(
        record.token,
        index,
        engineStaticTokens,
        rejects,
        reviewedAccepted
      );
      const signals = [...record.signals].sort();
      const explicitCommandSignal = signals.some(signal => [
        'after-command-word',
        'before-command-word',
        'format-head',
      ].includes(signal));
      const needsCommandReview = disposition.kind === 'not-in-language-catalog' && explicitCommandSignal;
      const needsUpdateContextReview = disposition.kind === 'not-in-language-catalog'
        && !needsCommandReview
        && signals.some(signal => [
          'after-update-change-word',
          'before-update-change-word',
        ].includes(signal));
      return {
        token: record.token,
        disposition,
        occurrenceCount: record.occurrenceCount,
        pageCount: record.pages.size,
        needsCommandReview,
        needsUpdateContextReview,
        signals,
        signalEvidence: record.signalEvidence,
        evidence: record.evidence,
      };
    })
    .sort((left, right) => left.token.localeCompare(right.token));

  const byDisposition = {};
  for (const token of tokens) {
    byDisposition[token.disposition.kind] = (byDisposition[token.disposition.kind] || 0) + 1;
  }
  return {
    helpPages: corpus.pages.length,
    tokenCount: tokens.length,
    summary: {
      byDisposition,
      commandReview: tokens.filter(token => token.needsCommandReview).length,
      updateContextReview: tokens.filter(token => token.needsUpdateContextReview).length,
    },
    commandReview: tokens.filter(token => token.needsCommandReview),
    updateContextReview: tokens.filter(token => token.needsUpdateContextReview),
    tokens,
  };
}

function main() {
  const indexes = buildIndexes();
  const allStaticTokens = staticTokens();
  const engines = Object.fromEntries(Object.keys(ENGINE_FILES).map(engine => [
    engine,
    auditEngine(engine, HELP_ROOTS[engine](), indexes[engine], allStaticTokens[engine]),
  ]));
  const report = {
    schemaVersion: 1,
    revision: '2026-07-26',
    method: 'exhaustive-case-insensitive-english-token-inventory-with-evidence-only-review-signals',
    policy: 'report-only-no-automatic-language-catalog-writes',
    engines,
    summary: Object.fromEntries(Object.entries(engines).map(([engine, result]) => [engine, {
      helpPages: result.helpPages,
      tokenCount: result.tokenCount,
      ...result.summary,
    }])),
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Report: ${options.output}`);
}

if (require.main === module) main();

module.exports = {
  auditEngine,
  explicitSignals,
  knownDisposition,
  updateChangeSignals,
};
