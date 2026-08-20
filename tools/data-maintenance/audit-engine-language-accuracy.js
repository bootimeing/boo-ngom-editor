const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');

const projectRoot = path.resolve(__dirname, '..', '..');
const defaultHelpRoot = name => path.join(
  process.env.LOCALAPPDATA || '',
  'Temp',
  name
);

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find(argument => argument.startsWith(prefix));
  return value ? path.resolve(value.slice(prefix.length)) : fallback;
}

const options = {
  gomHelp: option('gom-help', defaultHelpRoot('boo-help-audit-gom-20260719')),
  geeHelp: option('gee-help', defaultHelpRoot('boo-help-audit-gee-20260719')),
  pc996Help: option(
    '996pc-help',
    path.join(defaultHelpRoot('boo-help-audit-20260723'), 'pc996')
  ),
  output: option(
    'output',
    path.join(projectRoot, 'data', 'audit-report', 'language-accuracy.json')
  ),
};

const documentedClassificationOverrides = {
  HOUR: 'gom-only',
  MIN: 'gom-only',
  CHECKITEMBIND: 'gom-only',
  SETITEMBIND: 'gom-only',
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function walkHtmlFiles(root) {
  if (!fs.existsSync(root)) throw new Error(`Help directory does not exist: ${root}`);
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/\.html?$/i.test(entry.name)) files.push(fullPath);
    }
  };
  visit(root);
  return files;
}

function decodeHtml(file) {
  const buffer = fs.readFileSync(file);
  const header = buffer.subarray(0, 4096).toString('latin1');
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(header)?.[1]?.toLowerCase();
  if (charset === 'utf-8' || charset === 'utf8') return buffer.toString('utf8');
  return iconv.decode(buffer, 'gb18030');
}

function protectLegacyText(html) {
  // Some legacy CHM pages use a literal "<" for operators or placeholders.
  // Protect those characters before feeding the document to an HTML parser.
  return html.replace(
    /<(?=[\s\d$#@[\](),=><+\-*\\\u3400-\u9fff])/g,
    '&lt;'
  );
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([\da-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)));
}

function htmlToLines(html) {
  const $ = cheerio.load(protectLegacyText(html), { decodeEntities: false });
  $('script, style, noscript').remove();
  const content = $('#winchm_template_content').length > 0
    ? $('#winchm_template_content')
    : $('body');
  content.find('br').replaceWith('\n');
  content.find('p, div, tr, li, h1, h2, h3, h4, h5, h6, pre, blockquote')
    .each((_, element) => {
      $(element).prepend('\n');
      $(element).append('\n');
    });
  return decodeEntities(content.text())
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function normalizeText(text) {
  return text
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[，、；：]/g, match => ({ '，': ',', '、': ',', '；': ';', '：': ':' })[match])
    .trim();
}

function buildHelpCorpus(root) {
  const pages = [];
  const byToken = new Map();
  for (const file of walkHtmlFiles(root)) {
    const html = decodeHtml(file);
    const lines = htmlToLines(html);
    const text = lines.join('\n');
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const tokenCounts = new Map();
    for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_.]*/g)) {
      const token = match[0].toUpperCase();
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
    }
    const page = {
      relativePath,
      title,
      lines,
      text,
      normalizedText: normalizeText(text),
      hash: crypto.createHash('sha256').update(normalizeText(text)).digest('hex'),
      tokenCounts,
    };
    const pageIndex = pages.push(page) - 1;
    for (const token of tokenCounts.keys()) {
      const indices = byToken.get(token) || [];
      indices.push(pageIndex);
      byToken.set(token, indices);
    }
  }
  return { pages, byToken };
}

function catalogIndex(catalog) {
  const result = new Map();
  for (const [name, info] of Object.entries(catalog)) {
    result.set(name.toUpperCase(), { name, info });
    for (const alias of info.aliases || []) {
      result.set(alias.toUpperCase(), { name, info });
    }
  }
  return result;
}

function evidenceNames(entry) {
  const names = [entry.name, ...(entry.aliases || [])];
  if (entry.name === 'CHECK [N]') names.push('CHECK');
  if (entry.name === 'SET [N]') names.push('SET');
  return [...new Set(names.map(name => name.toUpperCase()))];
}

function isNoisePage(relativePath) {
  const name = path.posix.basename(relativePath);
  return /^update/i.test(name)
    || /更新记录/i.test(relativePath);
}

function isAggregatePage(relativePath) {
  return /命令汇总|命令大全|完整.*命令|基础脚本命令详解/i.test(relativePath);
}

function exactNameRegex(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Z0-9_.])${escaped}(?=$|[^A-Z0-9_.])`, 'i');
}

function isFormatHeading(line) {
  return /^(?:命令)?(?:格式|用法|语法)\s*[:：]?\s*$/i.test(line.trim());
}

function isSyntaxBoundary(line) {
  return /^(?:例|示例|脚本示例|说明|功能|注意|备注|相关命令|参数说明)\s*[:：]?/i.test(line)
    || /^(?:\[@|#(?:IF|ACT|SAY|ELSEACT|ELSESAY)\b|;)/i.test(line);
}

function joinWrappedUsageLine(page, index, commandText, name) {
  let result = commandText;
  let appended = 0;
  for (let next = index + 1; next < Math.min(page.lines.length, index + 8); next++) {
    const nextLine = page.lines[next];
    if (isSyntaxBoundary(nextLine)) break;
    const normalizedNext = normalizeText(nextLine);
    if (exactNameRegex(name).test(normalizedNext)) break;
    const isNumberedParameter = /^参数\s*\d+\s*[=:：]/i.test(nextLine);
    const isLikelyContinuation = /^(?:检测符|控制符|操作符|比较符|返回|保存|是否|参数\s*\d+)/i.test(nextLine);
    if (!isLikelyContinuation) break;
    if (isNumberedParameter) break;
    if (nextLine.length > 240 || appended >= 3) break;
    result += ` ${normalizedNext}`;
    appended++;
  }
  return result
    .replace(/\s*(?:={6,}|-{6,})\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function commandUsageLines(page, names) {
  const results = [];
  for (let index = 0; index < page.lines.length; index++) {
    const line = page.lines[index];
    const normalized = normalizeText(line);
    let name = '';
    let matchedName = null;
    for (const candidate of names) {
      const match = exactNameRegex(candidate).exec(normalized);
      if (match) {
        name = candidate;
        matchedName = match;
        break;
      }
    }
    if (!matchedName) continue;
    const position = matchedName.index + (matchedName[1]?.length || 0);
    const prefix = position > 0 ? normalized.slice(0, position) : '';
    const suffix = normalized.slice(position + name.length);
    // A label such as [@KillMon] is a trigger, not a command invocation.
    if (/\[@\s*$/i.test(prefix) || /^\s*\]/.test(suffix)) continue;
    // A line such as Gender=0 or AutoPickUpItem=1 is a configuration key.
    if (/^=/.test(suffix)) continue;
    const hasScriptPrefix = /^#(?:IF|ACT|ELSEACT)\s+$/i.test(prefix);
    const hasCombinedCommandPrefix = /^[A-Z][A-Z0-9_.]*\s*\/\s*$/i.test(prefix);
    const hasNegationPrefix = /^NOT\s+$/i.test(prefix);
    const hasCommandDeclarationPrefix = /(?:脚本|NPC)?命令\s*$/i.test(prefix);
    const hasDefinitionPrefix = /[:：]\s*$/.test(prefix)
      && !/[A-Z0-9_.]/i.test(prefix);
    const startsLikeCommand = position === 0
      || hasScriptPrefix
      || hasCombinedCommandPrefix
      || hasNegationPrefix
      || hasCommandDeclarationPrefix
      || hasDefinitionPrefix
      || (position <= 12 && !/[A-Z0-9_.]/i.test(prefix))
      || /(?:格式|用法|命令|#IF|#ACT|#ELSEACT)\s*[:：]?\s*$/i.test(
        normalizeText(page.lines[index - 1] || '')
      );
    const containsFormat = /(?:格式|用法|语法|命令)\s*[:：]/i.test(line);
    if (!startsLikeCommand && !containsFormat && !hasScriptPrefix) continue;
    let score = startsLikeCommand ? 6 : 0;
    if (containsFormat) score += 8;
    if (isFormatHeading(page.lines[index - 1] || '')) score += 8;
    if (hasScriptPrefix) score += 2;
    const initialCommandText = normalized.slice(position).trim();
    const commandText = joinWrappedUsageLine(
      page,
      index,
      initialCommandText,
      name
    );
    const parameterLines = [];
    for (let next = index + 1; next < Math.min(page.lines.length, index + 14); next++) {
      const nextLine = page.lines[next];
      if (/^(?:参数\s*\d+|参数说明|参数[:：])/i.test(nextLine)) {
        parameterLines.push(normalizeText(nextLine));
        continue;
      }
      if (parameterLines.length > 0) break;
    }
    results.push({
      line: commandText,
      parameterLines,
      score,
      index,
    });
  }
  return results.sort((left, right) => (
    right.score - left.score
    || right.parameterLines.length - left.parameterLines.length
    || right.line.length - left.line.length
  ));
}

function explicitCommandStatement(page, names) {
  return page.lines.find(line => {
    const normalized = normalizeText(line);
    if (!names.some(name => exactNameRegex(name).test(normalized))) return false;
    return /(?:脚本命令|命令)/i.test(normalized)
      && /(?:增加|新增|扩展|支持|使用|调用|打开)/i.test(normalized);
  }) || '';
}

function pageScore(page, names, entry) {
  const counts = names.map(name => page.tokenCounts.get(name) || 0);
  const occurrences = counts.reduce((total, count) => total + count, 0);
  if (occurrences === 0) return -Infinity;
  let score = Math.min(occurrences, 5);
  if (isNoisePage(page.relativePath)) score -= 18;
  if (isAggregatePage(page.relativePath)) score -= 3;
  if (/脚本检测命令|功能操作命令|英雄功能操作|特殊触发功能|游戏功能详解/i.test(page.relativePath)) {
    score += 5;
  }
  if (names.some(name => normalizeText(page.title).includes(name))) score += 12;
  const firstLines = normalizeText(page.lines.slice(0, 20).join(' '));
  if (names.some(name => firstLines.includes(name))) score += 4;
  if (/(命令格式|命令用法|格式[:：]|参数[:：]|功能[:：]|脚本命令)/i.test(page.text)) score += 4;
  const usage = commandUsageLines(page, names)[0];
  if (usage) score += 6 + Math.min(usage.score, 16);
  const sourcePage = entry.source?.page?.replace(/\\/g, '/').toLowerCase();
  if (sourcePage && page.relativePath.toLowerCase().endsWith(sourcePage) && !isNoisePage(page.relativePath)) {
    score += 8;
  }
  return score;
}

function candidatePages(corpus, entry) {
  const names = evidenceNames(entry);
  const indices = new Set();
  for (const name of names) {
    for (const index of corpus.byToken.get(name) || []) indices.add(index);
  }
  return [...indices]
    .map(index => {
      const page = corpus.pages[index];
      return {
        page,
        score: pageScore(page, names, entry),
        occurrences: names.reduce(
          (total, name) => total + (page.tokenCounts.get(name) || 0),
          0
        ),
      };
    })
    .sort((left, right) => right.score - left.score || right.occurrences - left.occurrences);
}

function functionEvidence(catalog, entry) {
  for (const name of evidenceNames(entry)) {
    const match = catalog.get(name);
    if (match) return match;
  }
  return null;
}

function evidenceWindow(page, names) {
  if (!page) return '';
  const matched = [];
  for (let index = 0; index < page.lines.length; index++) {
    const normalized = normalizeText(page.lines[index]);
    if (!names.some(name => normalized.includes(name))) continue;
    const start = Math.max(0, index - 3);
    const end = Math.min(page.lines.length, index + 8);
    matched.push(...page.lines.slice(start, end));
    if (matched.length >= 30) break;
  }
  return normalizeText([...new Set(matched)].join(' '));
}

function syntaxEvidence(page, names) {
  if (!page) return [];
  return commandUsageLines(page, names).slice(0, 8);
}

function functionSignature(match) {
  if (!match) return '';
  const info = match.info;
  const syntaxParams = String(info.syntax || '')
    .replace(/^[A-Z][A-Z0-9_.]*(?=\s|$)\s*/i, '');
  const params = Array.isArray(info.paramList) && info.paramList.length > 0
    ? info.paramList.join(' ')
    : (info.params || syntaxParams);
  return normalizeText(params);
}

function inspectEngine(entry, corpus, catalog) {
  const pages = candidatePages(corpus, entry);
  const best = pages[0];
  const fn = functionEvidence(catalog, entry);
  const sourcePath = entry.source?.page?.replace(/\\/g, '/').toLowerCase();
  const sourcePage = sourcePath
    ? pages.find(candidate => {
      const candidatePath = candidate.page.relativePath.toLowerCase();
      return candidatePath === sourcePath || candidatePath.endsWith(`/${sourcePath}`);
    })
    : null;
  const names = evidenceNames(entry);
  const definitionPage = pages.find(candidate => (
    (candidate.score >= 6 && commandUsageLines(candidate.page, names).length > 0)
    || Boolean(explicitCommandStatement(candidate.page, names))
  )) || (
    sourcePage && (
      commandUsageLines(sourcePage.page, names).length > 0
      || explicitCommandStatement(sourcePage.page, names)
    )
      ? sourcePage
      : null
  );
  const displayedPage = definitionPage || best;
  return {
    supported: Boolean(definitionPage || fn),
    supportMethod: definitionPage
      ? definitionPage === sourcePage && definitionPage.score < 6
        ? 'curated-source-page'
        : 'definition-page'
      : fn ? 'function-catalog' : 'none',
    bestPage: displayedPage ? {
      path: displayedPage.page.relativePath,
      title: displayedPage.page.title,
      score: displayedPage.score,
      occurrences: displayedPage.occurrences,
      noise: isNoisePage(displayedPage.page.relativePath),
      hash: displayedPage.page.hash,
    } : null,
    evidenceWindow: evidenceWindow(definitionPage?.page, evidenceNames(entry)),
    syntaxEvidence: syntaxEvidence(definitionPage?.page, evidenceNames(entry)),
    function: fn ? {
      name: fn.name,
      signature: functionSignature(fn),
      details: fn.info.details || '',
      source: fn.info.source || null,
    } : null,
    alternatives: pages.slice(1, 5).map(candidate => ({
      path: candidate.page.relativePath,
      score: candidate.score,
      occurrences: candidate.occurrences,
      noise: isNoisePage(candidate.page.relativePath),
    })),
  };
}

function entryForEngine(entry, engine) {
  const variant = entry.engineVariants?.[engine] || {};
  return {
    ...entry,
    ...variant,
    name: entry.name,
    aliases: [...new Set([...(entry.aliases || []), ...(variant.aliases || [])])],
    source: variant.source || entry.source,
  };
}

function documentedClassification(entry, gom, gee) {
  const override = documentedClassificationOverrides[entry.name.toUpperCase()];
  if (override) return override;
  if (gom.supported && gee.supported) return 'shared';
  if (gom.supported) return 'gom-only';
  if (gee.supported) return 'gee-only';
  return 'unverified';
}

function currentClassification(entry) {
  if (entry.engines?.includes('GOM') && entry.engines?.includes('GEE')) return 'shared';
  if (entry.engines?.includes('GOM')) return 'gom-only';
  if (entry.engines?.includes('GEE')) return 'gee-only';
  return 'compatibility';
}

function visibleLanguageShape(record) {
  if (!record) return '';
  if (!record.completionVerified) return normalizeText(record.name || '');
  return normalizeText([
    record.syntax || '',
    ...(record.params || []),
    record.kind || '',
    record.minArgs ?? '',
    record.maxArgs ?? '',
  ].join(' | '));
}

function explicitVariantShape(variant) {
  if (!variant) return '';
  return normalizeText([
    variant.syntax || '',
    variant.description || '',
    ...(variant.params || []),
    variant.kind || '',
    variant.minArgs ?? '',
    variant.maxArgs ?? '',
  ].join(' | '));
}

function variantAssessment(entry, gom, gee, resolvedGom, resolvedGee) {
  if (!gom.supported || !gee.supported) return { status: 'not-shared', reasons: [] };
  const reasons = [];
  const gomShape = visibleLanguageShape(resolvedGom);
  const geeShape = visibleLanguageShape(resolvedGee);
  const finalOutputDiffers = Boolean(gomShape && geeShape && gomShape !== geeShape);
  if (gom.function && gee.function && gom.function.signature !== gee.function.signature) {
    reasons.push('function-signature-differs');
  }
  const variantFields = variant => variant && [
    'syntax',
    'description',
    'params',
    'kind',
    'contexts',
    'aliases',
    'minArgs',
    'maxArgs',
    'snippet',
  ].some(key => variant[key] !== undefined);
  const hasResolvedVariants = variantFields(entry.engineVariants?.GOM)
    && variantFields(entry.engineVariants?.GEE);
  if (hasResolvedVariants) reasons.push('explicit-engine-variants');
  const explicitVariantsDiffer = hasResolvedVariants
    && explicitVariantShape(entry.engineVariants.GOM)
      !== explicitVariantShape(entry.engineVariants.GEE);
  if (explicitVariantsDiffer) reasons.push('explicit-variant-differs');
  if (finalOutputDiffers) reasons.push('final-output-differs');
  if (hasResolvedVariants && (
    explicitVariantsDiffer
    || finalOutputDiffers
    || reasons.includes('function-signature-differs')
  )) {
    return { status: 'resolved-difference', reasons };
  }
  if (finalOutputDiffers || reasons.includes('function-signature-differs')) {
    return { status: 'unresolved-difference', reasons };
  }
  if (hasResolvedVariants) {
    return { status: 'same', reasons };
  }
  if (gom.bestPage && gee.bestPage
    && gom.bestPage.path === gee.bestPage.path
    && gom.bestPage.hash === gee.bestPage.hash) {
    reasons.push('identical-definition-page');
    return { status: 'same', reasons };
  }
  if (resolvedGom?.completionVerified && resolvedGee?.completionVerified) {
    reasons.push('verified-final-signature');
    return { status: 'same', reasons };
  }
  return {
    status: 'insufficient',
    reasons,
  };
}

function sourcePageStatus(source, corpus) {
  if (!source?.page) return 'none';
  const normalized = source.page.replace(/\\/g, '/').toLowerCase();
  return corpus.pages.some(page => {
    const candidate = page.relativePath.toLowerCase();
    return candidate === normalized || candidate.endsWith(`/${normalized}`);
  }) ? 'matched' : 'missing';
}

function sourcePage(source, corpus) {
  if (!source?.page) return null;
  const normalized = source.page.replace(/\\/g, '/').toLowerCase();
  return corpus.pages.find(page => {
    const candidate = page.relativePath.toLowerCase();
    return candidate === normalized || candidate.endsWith(`/${normalized}`);
  }) || null;
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function variableEvidencePatterns(entry) {
  const patterns = [];
  const addMarker = marker => {
    let value = escapePattern(marker);
    value = value.replace(escapePattern('变量名'), '[^)>\\s]+');
    patterns.push(new RegExp(value, 'i'));
  };
  for (const marker of String(entry.full || '').match(/<\$[^>]+>/g) || []) {
    addMarker(marker);
  }
  for (const name of [entry.name, ...(entry.aliases || [])]) {
    if (/^[A-Za-z_][A-Za-z0-9_.$]*$/.test(name)) addMarker(`<$${name}>`);
  }
  const range = /^([A-Za-z])(\d+)-\1(\d+)$/i.exec(entry.name);
  if (range) {
    patterns.push(new RegExp(
      `\\b${escapePattern(`${range[1]}${range[2]}`)}\\s*(?:-|~|—|至)\\s*`
      + `${escapePattern(`${range[1]}${range[3]}`)}\\b`,
      'i'
    ));
  }
  if (entry.name === 'STR(T0)') patterns.push(/\bT0\s*(?:-|~|—|至)\s*T499\b/i);
  if (entry.name === 'STR(U0)') patterns.push(/\bU0\s*(?:-|~|—|至)\s*U499\b/i);
  return patterns;
}

function triggerEvidencePatterns(entry) {
  const names = new Set([
    entry.name,
    String(entry.label || '').replace(/^\[@?/, '').replace(/\]$/, ''),
    ...(entry.aliases || []).map(alias => String(alias).replace(/^\[@?/, '').replace(/\]$/, '')),
  ].filter(Boolean));
  return [...names].map(name => {
    const suffix = /X+$/i.exec(name)?.[0] || '';
    const stem = suffix ? name.slice(0, -suffix.length) : name;
    const dynamicSuffix = suffix
      ? `(?:${escapePattern(suffix)}|\\d+)`
      : '';
    return new RegExp(
      `(?:\\[\\s*)?@${escapePattern(stem)}${dynamicSuffix}(?:\\s*\\])?`,
      'i'
    );
  });
}

function symbolEvidenceMatches(entry, type, page) {
  if (!page) return false;
  const patterns = type === 'variable'
    ? variableEvidencePatterns(entry)
    : triggerEvidencePatterns(entry);
  return patterns.some(pattern => pattern.test(page.text));
}

function symbolCorpusEvidenceMatches(entry, engine, type) {
  const evidence = entry.engineVariants?.[engine]?.corpusEvidence || [];
  if (!Array.isArray(evidence) || evidence.length === 0) return false;
  const patterns = type === 'variable'
    ? variableEvidencePatterns(entry)
    : triggerEvidencePatterns(entry);
  return evidence.some(item => (
    item
    && item.kind === 'server-script'
    && typeof item.path === 'string'
    && item.path.length > 0
    && Number.isInteger(item.line)
    && item.line > 0
    && typeof item.text === 'string'
    && patterns.some(pattern => pattern.test(item.text))
  ));
}

function expectedEnginesForClassification(classification) {
  switch (classification?.status) {
    case 'shared': return ['GOM', 'GEE'];
    case 'gom-only': return ['GOM'];
    case 'gee-only': return ['GEE'];
    default: return [];
  }
}

function resolvedSymbolAudit(commands, variables, corpora) {
  const result = {
    summary: {},
    variables: {},
    triggers: {},
  };
  for (const [type, entries] of [
    ['variable', variables.variables || []],
    ['trigger', commands.triggers || []],
  ]) {
    const records = {};
    const summary = {
      total: entries.length,
      shared: 0,
      'gom-only': 0,
      'gee-only': 0,
      '996pc-only': 0,
      compatibility: 0,
      active: { GOM: 0, GEE: 0, '996PC': 0 },
      sourceMatched: { GOM: 0, GEE: 0, '996PC': 0 },
      evidenceMatched: { GOM: 0, GEE: 0, '996PC': 0 },
      issues: 0,
    };
    for (const entry of entries) {
      const classification = entry.engineClassification?.status || 'compatibility';
      if (Object.prototype.hasOwnProperty.call(summary, classification)) {
        summary[classification]++;
      } else {
        summary.compatibility++;
      }
      const expectedEngines = expectedEnginesForClassification(entry.engineClassification);
      const actualEngines = entry.engines || [];
      const issues = [];
      const actualLegacyEngines = actualEngines.filter(engine => engine === 'GOM' || engine === 'GEE');
      if (JSON.stringify(actualLegacyEngines) !== JSON.stringify(expectedEngines)) {
        issues.push('classification-engine-mismatch');
      }
      const engines = {};
      for (const engine of ['GOM', 'GEE', '996PC']) {
        const active = actualEngines.includes(engine);
        const selectedSource = entry.engineSources?.[engine];
        const selectedPage = sourcePage(selectedSource, corpora[engine]);
        const helpSourceStatus = sourcePageStatus(selectedSource, corpora[engine]);
        const corpusEvidenceMatched = active
          ? symbolCorpusEvidenceMatches(entry, engine, type)
          : false;
        const sourceStatus = corpusEvidenceMatched && helpSourceStatus !== 'matched'
          ? 'corpus'
          : helpSourceStatus;
        const evidenceMatched = active
          ? symbolEvidenceMatches(entry, type, selectedPage) || corpusEvidenceMatched
          : false;
        if (active) {
          summary.active[engine]++;
          if (sourceStatus === 'matched' || sourceStatus === 'corpus') {
            summary.sourceMatched[engine]++;
          }
          if (evidenceMatched) summary.evidenceMatched[engine]++;
          if (!selectedSource && !corpusEvidenceMatched) {
            issues.push(`${engine}:missing-engine-source`);
          } else if (sourceStatus !== 'matched' && sourceStatus !== 'corpus') {
            issues.push(`${engine}:source-${sourceStatus}`);
          }
          else if (!evidenceMatched) issues.push(`${engine}:source-evidence-missing`);
        } else if (selectedSource) {
          issues.push(`${engine}:orphan-engine-source`);
        }
        engines[engine] = {
          active,
          source: selectedSource || null,
          sourceStatus,
          evidenceMatched,
          corpusEvidenceMatched,
        };
      }
      if (issues.length > 0) summary.issues++;
      records[entry.name.toUpperCase()] = {
        name: entry.name,
        classification,
        engines: actualEngines,
        engineEvidence: engines,
        issues,
      };
    }
    result.summary[type === 'variable' ? 'variables' : 'triggers'] = summary;
    result[type === 'variable' ? 'variables' : 'triggers'] = records;
  }
  return result;
}

const staticEvidenceToken = {
  'img-absolute': 'IMG',
  'img-relative': 'IMG',
  'img-hover': 'IMG',
  'imgex-absolute': 'IMGEX',
  'playimg-absolute': 'PLAYIMG',
  'playimgex-absolute': 'PLAYIMGEX',
  'text-absolute': 'TEXT',
  'text-absolute-link': 'TEXT',
  'text-link': 'CHECKSCRIPTPARAM',
  'text-link-params': 'CHECKSCRIPTPARAM',
  'text-color': 'FCOLOR',
  'item-show': 'ITEMSHOW',
  'input-text': 'INPUTTEXT',
  'input-number': 'INPUTNUM',
  countdown: 'COUNTDOWN',
  'image-countdown': 'IMGCOUNTDOWN',
  'image-number': 'IMGNUM',
  'progress-bar': 'PROGRESSBAR',
  'time-tips': 'TIMETIPS',
  'item-box': 'ITEMBOX',
  'human-variable': 'HUMAN',
  'guild-variable': 'GUILD',
};

function resolvedStaticLanguageAudit(data, corpora) {
  const result = { summary: {}, saySnippets: {}, mapInfoParams: {} };
  for (const [section, entries] of [
    ['saySnippets', data.saySnippets || []],
    ['mapInfoParams', data.mapInfoParams || []],
  ]) {
    const records = {};
    const summary = {
      total: entries.length,
      active: { GOM: 0, GEE: 0, '996PC': 0 },
      sourceMatched: { GOM: 0, GEE: 0, '996PC': 0 },
      evidenceMatched: { GOM: 0, GEE: 0, '996PC': 0 },
      issues: 0,
    };
    for (const entry of entries) {
      const engines = {};
      const issues = [];
      for (const engine of ['GOM', 'GEE', '996PC']) {
        const variant = entry.engineVariants?.[engine];
        if (!variant) {
          engines[engine] = { active: false };
          continue;
        }
        const page = sourcePage(variant.source, corpora[engine]);
        const sourceStatus = sourcePageStatus(variant.source, corpora[engine]);
        const token = section === 'mapInfoParams'
          ? entry.id
          : variant.evidenceToken || staticEvidenceToken[entry.id];
        const evidenceMatched = Boolean(
          page
          && token
          && exactNameRegex(token).test(page.normalizedText)
        );
        summary.active[engine]++;
        if (sourceStatus === 'matched') summary.sourceMatched[engine]++;
        if (evidenceMatched) summary.evidenceMatched[engine]++;
        if (!variant.label || !variant.description) issues.push(`${engine}:empty-visible-data`);
        if (!variant.source?.page) issues.push(`${engine}:missing-source`);
        else if (sourceStatus !== 'matched') issues.push(`${engine}:source-${sourceStatus}`);
        else if (!evidenceMatched) issues.push(`${engine}:source-evidence-missing`);
        if (section === 'saySnippets' && !variant.snippet) {
          issues.push(`${engine}:missing-snippet`);
        }
        engines[engine] = {
          active: true,
          label: variant.label,
          source: variant.source,
          sourceStatus,
          evidenceMatched,
        };
      }
      if (issues.length > 0) summary.issues++;
      records[entry.id] = { id: entry.id, engines, issues };
    }
    result.summary[section] = summary;
    result[section] = records;
  }
  return result;
}

function topLevelSyntaxTokens(syntax) {
  const tokens = [];
  let current = '';
  let depth = 0;
  let quote = '';
  const push = () => {
    const value = current.trim();
    if (/^[（(]/.test(value) && tokens.length > 0) {
      tokens[tokens.length - 1] += ` ${value}`;
    } else if (value) {
      tokens.push(value);
    }
    current = '';
  };
  for (const character of String(syntax || '')) {
    if (quote) {
      current += character;
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if ('(（[【{'.includes(character)) depth++;
    if (')）]】}'.includes(character) && depth > 0) depth--;
    if (/\s/.test(character) && depth === 0) {
      push();
      continue;
    }
    current += character;
  }
  push();
  return tokens;
}

function stripBracketedText(value) {
  let result = '';
  let depth = 0;
  for (const character of String(value || '')) {
    if ('(（[【{'.includes(character)) {
      depth++;
      continue;
    }
    if (')）]】}'.includes(character)) {
      if (depth > 0) depth--;
      continue;
    }
    if (depth === 0) result += character;
  }
  return result;
}

function confirmedNoArgument(engine, name) {
  const review = require('./apply-final-command-trigger-review');
  if (review.confirmedNoArgumentCommands[engine]?.has(name.toUpperCase())) return true;
  const override = Object.entries(review.commandOverrides[engine] || {}).find(
    ([candidate]) => candidate.toUpperCase() === name.toUpperCase()
  )?.[1];
  return Boolean(override && override.verified !== false && override.params.length === 0);
}

function obviousQualityIssues(command, engine) {
  const issues = [];
  if (!command.completionVerified) return issues;
  const description = (command.description || '').trim();
  const params = command.params.join(' ').trim();
  if (!description) issues.push('empty-description');
  if (/^\\+$/.test(description)) issues.push('broken-description');
  if (/^(?:D{3,}|X{3,}|测试)$/i.test(params)) issues.push('placeholder-params');
  if (/\bX{3,}\b/i.test(description) || /\bX{3,}\b/i.test(params)) {
    issues.push('placeholder-text');
  }
  if (/\\$/.test(description) || /\\$/.test(params)) issues.push('truncated-backslash');
  if (/[（(][^）)]*$/.test(params)) issues.push('unclosed-parameter-text');
  if (/^[A-Z][A-Z0-9_.]*(?:格式|设置|控制符)/i.test(command.syntax)) {
    issues.push('command-name-glued-to-prose');
  }
  if (/(?:此命令为|以下是示例脚本|格式[:：])/.test(command.syntax)) {
    issues.push('embedded-document-prose');
  }
  if (/(?:等同于|装备位置代码|物品位置代码|相关命令|支持怪物|WIL文件序号是在|文字换行[:：]|%ServerName\s+区名称)/i.test(command.syntax)) {
    issues.push('embedded-help-table-or-note');
  }
  const bareSyntax = stripBracketedText(command.syntax);
  if (/(?:模式|项目|速度类型)\s*[:：]\s*(?:-?\d|恢复)/i.test(bareSyntax)) {
    issues.push('embedded-enumeration-table');
  }
  if (/(?:真正的倍率|支持变量操作|\bN\d+即N\d*\s*=)/i.test(bareSyntax)) {
    issues.push('embedded-explanation-text');
  }
  if (/参数(?:1|一)\s+参数(?:1|一)(?:\s|$)/i.test(command.syntax)) {
    issues.push('duplicated-parameter-marker');
  }
  if (/[。]/.test(command.syntax)) {
    issues.push('sentence-used-as-syntax');
  }
  if (/\s[;；]\s*(?:仅|只|注意|说明|示例|范例|用于)/i.test(command.syntax)) {
    issues.push('prose-comment-used-as-syntax');
  }
  if (/(?:以下是示例|仅限于@|只能改|请勿关闭)/i.test(command.syntax)) {
    issues.push('embedded-usage-note');
  }
  const normalizedBrackets = command.syntax
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[【]/g, '[')
    .replace(/[】]/g, ']');
  const bracketBalance = (open, close) => {
    let depth = 0;
    for (const character of normalizedBrackets) {
      if (character === open) depth++;
      if (character === close) depth--;
      if (depth < 0) return false;
    }
    return depth === 0;
  };
  if (!bracketBalance('(', ')') || !bracketBalance('[', ']')) {
    issues.push('unbalanced-syntax-brackets');
  }
  if (command.kind !== 'say' && command.syntax.length > 180) {
    issues.push('excessive-syntax-text');
  }
  if (
    command.kind !== 'say'
    && !/\s\|\s|\.{3}|…/.test(command.syntax)
  ) {
    const syntaxParamCount = Math.max(0, topLevelSyntaxTokens(command.syntax).length - 1);
    if (syntaxParamCount !== command.params.length) {
      issues.push('syntax-parameter-count-mismatch');
    }
  }
  if (command.params.length >= 2 && command.params.every(param => (
    /^\[?参数(?:\d+|[一二三四五六七八九十])(?:\]?|[:：\s(]|$)/i.test(param)
  ))) {
    issues.push('generic-parameter-names');
  }
  if (command.params.length >= 2 && command.params.every(param => (
    /^[\s[\]\d,./+\-=]+$/.test(param)
  ))) {
    issues.push('example-used-as-params');
  }
  if (command.params.some(param => (
    /^(?:装备位置代码|物品位置代码|相关命令|支持怪物|WIL文件序号是在|文字换行[:：]?|%ServerName|区名称)$/i.test(param.trim())
  ))) {
    issues.push('help-note-used-as-parameter');
  }
  if (
    command.params.length === 0
    && command.syntax.trim().toUpperCase() === command.name.trim().toUpperCase()
    && !confirmedNoArgument(engine, command.name)
  ) {
    issues.push('unproved-no-argument-command');
  }
  if (command.minArgs !== undefined && command.maxArgs !== undefined) {
    const requiredParams = command.params.filter(param => (
      !/^\s*\[(?!\\)/.test(param)
    )).length;
    if (
      command.minArgs > command.maxArgs
      || command.minArgs !== requiredParams
      || command.maxArgs !== command.params.length
    ) {
      issues.push('argument-range-does-not-match-params');
    }
  }
  return issues;
}

function commandCorpusEvidenceMatches(command) {
  const evidence = command.corpusEvidence || [];
  if (!Array.isArray(evidence) || evidence.length === 0) return false;
  const commandPattern = new RegExp(
    `^\\s*(?:NOT\\s+)?${escapePattern(command.name)}(?=\\s|$)`,
    'i'
  );
  return evidence.some(item => (
    item
    && item.kind === 'server-script'
    && typeof item.path === 'string'
    && item.path.length > 0
    && Number.isInteger(item.line)
    && item.line > 0
    && typeof item.text === 'string'
    && commandPattern.test(item.text)
  ));
}

function resolvedLanguageAudit(commands, variables, catalogs, corpora) {
  const { buildLanguageIndex } = require(path.join(
    projectRoot,
    'out',
    'utils',
    'command-index'
  ));
  const result = {
    summary: {},
    engines: {},
  };
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const index = buildLanguageIndex(commands, variables, catalogs, engine);
    const completionNames = new Set(index.commandCompletions.map(command => (
      command.name.toUpperCase()
    )));
    const records = {};
    const summary = {
      commands: index.commands.length,
      completions: index.commandCompletions.length,
      documented: 0,
      undocumented: 0,
      sourceMatched: 0,
      sourceMissing: 0,
      sourceAbsent: 0,
      compatibility: 0,
      completionVerified: 0,
      completionUnverified: 0,
      completionDisabled: 0,
      qualityIssues: 0,
    };
    for (const command of index.commands) {
      const documentation = inspectEngine(
        {
          name: command.name,
          aliases: command.aliases,
          source: command.source,
        },
        corpora[engine],
        new Map()
      );
      const corpusEvidenceMatched = commandCorpusEvidenceMatches(command);
      const helpSourceStatus = sourcePageStatus(command.source, corpora[engine]);
      const sourceStatus = corpusEvidenceMatched && helpSourceStatus !== 'matched'
        ? 'corpus'
        : helpSourceStatus;
      const issues = obviousQualityIssues(command, engine);
      if (documentation.supported || corpusEvidenceMatched) summary.documented++;
      else summary.undocumented++;
      if (sourceStatus === 'matched' || sourceStatus === 'corpus') summary.sourceMatched++;
      else if (sourceStatus === 'missing') summary.sourceMissing++;
      else summary.sourceAbsent++;
      if (command.legacyShared) summary.compatibility++;
      if (command.completionVerified) summary.completionVerified++;
      else summary.completionUnverified++;
      if (!command.completionEnabled) summary.completionDisabled++;
      if (issues.length > 0) summary.qualityIssues++;
      records[command.name.toUpperCase()] = {
        name: command.name,
        origin: command.origin,
        kind: command.kind,
        contexts: command.contexts,
        syntax: command.syntax,
        description: command.description,
        params: command.params,
        minArgs: command.minArgs ?? null,
        maxArgs: command.maxArgs ?? null,
        engines: command.engines,
        source: command.source || null,
        snippet: command.snippet || null,
        sourceStatus,
        documented: documentation.supported || corpusEvidenceMatched,
        documentation: {
          supportMethod: documentation.supportMethod,
          bestPage: documentation.bestPage,
          syntaxEvidence: documentation.syntaxEvidence,
          corpusEvidenceMatched,
        },
        completionIncluded: completionNames.has(command.name.toUpperCase()),
        completionVerified: command.completionVerified,
        completionEnabled: command.completionEnabled,
        compatibility: command.legacyShared,
        qualityIssues: issues,
      };
    }
    result.summary[engine] = summary;
    result.engines[engine] = records;
  }
  return result;
}

function main() {
  const commands = readJson('data/commands.json');
  const variables = readJson('data/variables.json');
  const staticLanguage = readJson('data/static-language.json');
  const catalogs = {
    GOM: readJson('data/functions.json'),
    GEE: readJson('data/functions-gee.json'),
    '996PC': readJson('data/functions-996pc.json'),
  };
  const gomFunctions = catalogIndex(catalogs.GOM);
  const geeFunctions = catalogIndex(catalogs.GEE);
  const gomCorpus = buildHelpCorpus(options.gomHelp);
  const geeCorpus = buildHelpCorpus(options.geeHelp);
  const pc996Corpus = buildHelpCorpus(options.pc996Help);
  const resolvedLanguage = resolvedLanguageAudit(
    commands,
    variables,
    catalogs,
    {
      GOM: gomCorpus,
      GEE: geeCorpus,
      '996PC': pc996Corpus,
    }
  );
  const resolvedSymbols = resolvedSymbolAudit(
    commands,
    variables,
    {
      GOM: gomCorpus,
      GEE: geeCorpus,
      '996PC': pc996Corpus,
    }
  );
  const resolvedStaticLanguage = resolvedStaticLanguageAudit(
    staticLanguage,
    {
      GOM: gomCorpus,
      GEE: geeCorpus,
      '996PC': pc996Corpus,
    }
  );
  const records = {};
  const summary = {
    commands: 0,
    classificationMatches: 0,
    classificationDiffers: 0,
    documented: {
      shared: 0,
      'gom-only': 0,
      'gee-only': 0,
      unverified: 0,
    },
    sharedVariants: {
      same: 0,
      insufficient: 0,
      'resolved-difference': 0,
      'unresolved-difference': 0,
    },
  };

  for (const [kind, entries] of [
    ['check', commands.commands],
    ['action', commands.execCommands],
  ]) {
    for (const entry of entries) {
      const gom = inspectEngine(entryForEngine(entry, 'GOM'), gomCorpus, gomFunctions);
      const gee = inspectEngine(entryForEngine(entry, 'GEE'), geeCorpus, geeFunctions);
      const documented = documentedClassification(entry, gom, gee);
      const current = currentClassification(entry);
      const key = entry.name.toUpperCase();
      const variant = variantAssessment(
        entry,
        gom,
        gee,
        resolvedLanguage.engines.GOM[key],
        resolvedLanguage.engines.GEE[key]
      );
      summary.commands++;
      summary.documented[documented]++;
      if (documented === current || (documented === 'unverified' && current === 'compatibility')) {
        summary.classificationMatches++;
      } else {
        summary.classificationDiffers++;
      }
      if (documented === 'shared') summary.sharedVariants[variant.status]++;
      records[entry.name.toUpperCase()] = {
        name: entry.name,
        kind,
        currentClassification: current,
        documentedClassification: documented,
        classificationMatches: documented === current
          || (documented === 'unverified' && current === 'compatibility'),
        variant,
        GOM: gom,
        GEE: gee,
      };
    }
  }

  const report = {
    schemaVersion: 4,
    revision: '2026-07-23',
    method: 'strict-definition-and-final-visible-language',
    helpFiles: {
      GOM: gomCorpus.pages.length,
      GEE: geeCorpus.pages.length,
      '996PC': pc996Corpus.pages.length,
    },
    summary,
    commands: records,
    resolvedLanguage,
    resolvedSymbols,
    resolvedStaticLanguage,
  };
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const classificationDiffs = Object.values(records)
    .filter(record => !record.classificationMatches)
    .map(record => `${record.name}:${record.currentClassification}->${record.documentedClassification}`);
  const variantReviews = Object.values(records)
    .filter(record => (
      record.documentedClassification === 'shared'
      && record.variant.status === 'unresolved-difference'
    ))
    .map(record => record.name);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Classification differences (${classificationDiffs.length}): ${classificationDiffs.join(', ')}`);
  console.log(`Unresolved shared variants (${variantReviews.length}): ${variantReviews.join(', ')}`);
  console.log(`Resolved language: ${JSON.stringify(report.resolvedLanguage.summary, null, 2)}`);
  console.log(`Resolved symbols: ${JSON.stringify(report.resolvedSymbols.summary, null, 2)}`);
  console.log(`Resolved static language: ${JSON.stringify(report.resolvedStaticLanguage.summary, null, 2)}`);
  console.log(`Report: ${options.output}`);
}

if (require.main === module) main();

module.exports = {
  buildHelpCorpus,
  catalogIndex,
  candidatePages,
  commandUsageLines,
  decodeHtml,
  evidenceWindow,
  explicitCommandStatement,
  htmlToLines,
  inspectEngine,
  normalizeText,
  options,
  sourcePageStatus,
  syntaxEvidence,
};
