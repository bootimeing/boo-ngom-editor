#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  buildHelpCorpus,
  commandUsageLines,
  normalizeText,
} = require('./audit-engine-language-accuracy');

const projectRoot = path.resolve(__dirname, '..', '..');
const defaultHelpBase = path.join(
  process.env.LOCALAPPDATA || '',
  'Temp',
  'boo-final-help-20260726'
);

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find(argument => argument.startsWith(prefix));
  return value ? path.resolve(value.slice(prefix.length)) : fallback;
}

const options = {
  gomHelp: option('gom-help', path.join(defaultHelpBase, 'gom')),
  geeHelp: option('gee-help', path.join(defaultHelpBase, 'gee')),
  pc996Help: option('996pc-help', path.join(defaultHelpBase, 'pc996')),
  accuracy: option(
    'accuracy',
    path.join(projectRoot, 'data', 'audit-report', 'language-accuracy-final.json')
  ),
  output: option(
    'output',
    path.join(projectRoot, 'data', 'audit-report', 'final-engine-language-entry-ledger.json')
  ),
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function dataFile(name) {
  return readJson(path.join(projectRoot, 'data', name));
}

function normalizeName(value) {
  let result = String(value || '').trim();
  if (/^<\$.*>$/.test(result)) result = result.slice(2, -1);
  if (/^\[@.*\]$/.test(result)) result = result.slice(2, -1);
  return result.toUpperCase();
}

function normalizePage(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function findSourcePage(corpus, source) {
  const requested = normalizePage(source?.page);
  if (!requested) return undefined;
  return corpus.pages.find(page => {
    const candidate = normalizePage(page.relativePath);
    return candidate === requested || candidate.endsWith(`/${requested}`);
  });
}

function evidenceTokens(entry) {
  const values = [entry.name, entry.label, entry.full, ...(entry.aliases || [])]
    .filter(Boolean)
    .map(normalizeName);
  const expanded = [];
  for (const value of values) {
    expanded.push(value);
    for (const match of value.matchAll(/[A-Z_][A-Z0-9_.]*/g)) expanded.push(match[0]);
  }
  return [...new Set(expanded.filter(Boolean))];
}

function pageHasEvidence(page, entry) {
  if (!page) return false;
  const normalized = normalizeText(page.text);
  return evidenceTokens(entry).some(token => {
    if (page.tokenCounts.get(token) > 0 || normalized.includes(token)) return true;
    const template = /^(.*?)(X+|N)$/.exec(token);
    if (template) {
      const prefix = template[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`^${prefix}(?:N|X+|\\d+)$`);
      if ([...page.tokenCounts.keys()].some(candidate => pattern.test(candidate))) return true;
    }
    const numbered = /^(.*?)(\d+)$/.exec(token);
    if (!numbered) return false;
    const prefix = numbered[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const ranges = new RegExp(
      `${prefix}(\\d+)[^A-Z0-9]{1,24}(?:<\\$)?${prefix}(\\d+)`,
      'g'
    );
    for (const match of normalized.matchAll(ranges)) {
      const value = Number(numbered[2]);
      const left = Number(match[1]);
      const right = Number(match[2]);
      if (value >= Math.min(left, right) && value <= Math.max(left, right)) return true;
    }
    return false;
  });
}

function sourceEvidence(corpus, entry, includeSyntax) {
  const page = findSourcePage(corpus, entry.source);
  const tokens = evidenceTokens(entry);
  const syntax = includeSyntax && page
    ? commandUsageLines(page, tokens).slice(0, 4).map(item => item.line)
    : [];
  return {
    sourceStatus: page ? 'matched' : entry.source ? 'missing' : 'none',
    tokenMatched: pageHasEvidence(page, entry),
    pageHash: page?.hash || '',
    syntax,
  };
}

function commandReview(commands, functionCatalog, engine, command) {
  const key = normalizeName(command.name);
  if (command.origin === 'shared') {
    for (const entry of [...commands.commands, ...commands.execCommands]) {
      const variant = entry.engineVariants?.[engine];
      if (!variant) continue;
      const names = [variant.name, ...(variant.aliases || [])].map(normalizeName);
      if (!names.includes(key)) continue;
      return variant.completionReview || entry.engineClassification?.method || 'engine-variant';
    }
  }
  for (const [name, entry] of Object.entries(functionCatalog)) {
    const names = [name, ...(entry.aliases || [])].map(normalizeName);
    if (names.includes(key)) return entry.completionReview || 'engine-catalog';
  }
  return 'runtime-merged';
}

function commandIssues(command, completionNames, accuracyRecord, evidence) {
  const issues = [...(accuracyRecord?.qualityIssues || [])];
  const completionIncluded = completionNames.has(normalizeName(command.name));
  if (!command.name.trim()) issues.push('empty-name');
  if (!command.syntax.trim()) issues.push('empty-syntax');
  if (!command.description.trim()) issues.push('empty-description');
  if (!Array.isArray(command.params)) issues.push('params-not-array');
  if (command.minArgs !== undefined && command.maxArgs !== undefined && command.minArgs > command.maxArgs) {
    issues.push('invalid-argument-range');
  }
  if (evidence.sourceStatus !== 'matched') issues.push('source-page-missing');
  if (!evidence.tokenMatched) issues.push('source-token-missing');
  if (completionIncluded && !accuracyRecord?.documented) issues.push('completion-not-definition-backed');
  if (completionIncluded && accuracyRecord?.documentation?.sourceStatus === 'absent') {
    issues.push('completion-source-absent');
  }
  if (completionIncluded && (!command.completionVerified || !command.completionEnabled)) {
    issues.push('completion-state-inconsistent');
  }
  return [...new Set(issues)];
}

function triggerIssues(entry, evidenceState, evidence) {
  const issues = [];
  if (!/^\[@.+\]$/.test(entry.label || '')) issues.push('invalid-trigger-label');
  if (!String(entry.description || '').trim()) issues.push('empty-description');
  if (evidence.sourceStatus !== 'matched') issues.push('source-page-missing');
  if (!evidence.tokenMatched || evidenceState?.evidenceMatched === false) issues.push('source-token-missing');
  if (evidenceState?.sourceStatus && evidenceState.sourceStatus !== 'matched') issues.push('source-status-mismatch');
  return [...new Set(issues)];
}

function constantIssues(entry, evidence) {
  const issues = [];
  if (!String(entry.name || '').trim()) issues.push('empty-name');
  if (!String(entry.full || '').trim()) issues.push('empty-full-form');
  if (!String(entry.description || '').trim()) issues.push('empty-description');
  if (evidence.sourceStatus !== 'matched') issues.push('source-page-missing');
  if (!evidence.tokenMatched) issues.push('source-token-missing');
  if (entry.completionEnabled && !entry.completionVerified) issues.push('unverified-enabled-completion');
  return [...new Set(issues)];
}

function completionStatus(enabled, verified, included) {
  if (included && enabled && verified) return 'verified-completion';
  if (enabled || verified) return 'diagnostic-only';
  return 'disabled';
}

function corpusDigest(corpus) {
  const hash = crypto.createHash('sha256');
  for (const page of [...corpus.pages].sort((left, right) => (
    left.relativePath.localeCompare(right.relativePath, 'en')
  ))) {
    hash.update(page.relativePath.replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(page.hash);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function main() {
  const { ENGINE_DEFINITIONS } = require(path.join(projectRoot, 'out', 'utils', 'engine-registry'));
  const { buildLanguageIndex } = require(path.join(projectRoot, 'out', 'utils', 'command-index'));
  const commands = dataFile('commands.json');
  const variables = dataFile('variables.json');
  const accuracy = readJson(options.accuracy);
  const helpRoots = {
    GOM: options.gomHelp,
    GEE: options.geeHelp,
    '996PC': options.pc996Help,
  };
  const corpora = Object.fromEntries(
    Object.entries(helpRoots).map(([engine, root]) => [engine, buildHelpCorpus(root)])
  );
  const functionCatalog = {};
  const constantCatalog = {};
  for (const definition of ENGINE_DEFINITIONS) {
    functionCatalog[definition.id] = dataFile(definition.functionFile);
    constantCatalog[definition.id] = dataFile(definition.constantsFile);
  }

  const report = {
    schemaVersion: 1,
    revision: '2026-07-26',
    method: 'runtime-index-plus-own-help-entry-ledger',
    helpInventory: {},
    summary: {},
    engines: {},
  };
  let totalIssues = 0;

  for (const definition of ENGINE_DEFINITIONS) {
    const engine = definition.id;
    const corpus = corpora[engine];
    const index = buildLanguageIndex(
      commands,
      variables,
      functionCatalog,
      engine,
      constantCatalog
    );
    const completionNames = new Set(index.commandCompletions.map(entry => normalizeName(entry.aliasOf || entry.name)));
    const checkNames = new Set(index.checks.map(entry => normalizeName(entry.name)));
    const detectionCommands = [];
    const executionCommands = [];
    for (const command of index.commands) {
      const key = normalizeName(command.name);
      const accuracyRecord = accuracy.resolvedLanguage?.engines?.[engine]?.[key];
      const evidence = sourceEvidence(corpus, command, true);
      const issues = commandIssues(command, completionNames, accuracyRecord, evidence);
      const included = completionNames.has(key);
      const record = {
        name: command.name,
        syntax: command.syntax,
        description: command.description,
        params: command.params,
        minArgs: command.minArgs ?? null,
        maxArgs: command.maxArgs ?? null,
        contexts: command.contexts,
        source: command.source || null,
        evidence,
        status: completionStatus(command.completionEnabled, command.completionVerified, included),
        reviewMode: commandReview(commands, functionCatalog[engine], engine, command),
        origin: command.origin,
        issues,
      };
      if (checkNames.has(key)) detectionCommands.push(record);
      else executionCommands.push(record);
      totalIssues += issues.length;
    }

    const engineFunctions = index.triggers.map(entry => {
      const key = normalizeName(entry.name);
      const evidenceState = accuracy.resolvedSymbols?.triggers?.[key]?.engineEvidence?.[engine];
      const evidence = sourceEvidence(corpus, entry, false);
      const issues = triggerIssues(entry, evidenceState, evidence);
      totalIssues += issues.length;
      return {
        name: entry.name,
        label: entry.label,
        description: entry.description,
        params: entry.params || [],
        source: entry.source || null,
        evidence,
        status: 'verified-engine-function',
        reviewMode: entry.descriptionReview || 'engine-trigger-variant',
        issues,
      };
    });

    const systemConstants = index.constants.map(entry => {
      const evidence = sourceEvidence(corpus, entry, false);
      const issues = constantIssues(entry, evidence);
      totalIssues += issues.length;
      return {
        name: entry.name,
        full: entry.full,
        description: entry.description,
        scope: entry.scope,
        source: entry.source || null,
        evidence,
        status: completionStatus(
          entry.completionEnabled === true,
          entry.completionVerified === true,
          entry.completionEnabled === true && entry.completionVerified === true
        ),
        reviewMode: entry.descriptionReview || 'merged-system-constant',
        issues,
      };
    });

    for (const records of [detectionCommands, executionCommands, engineFunctions, systemConstants]) {
      records.sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }));
    }
    const categorySummary = Object.fromEntries([
      ['detectionCommands', detectionCommands],
      ['executionCommands', executionCommands],
      ['engineFunctions', engineFunctions],
      ['systemConstants', systemConstants],
    ].map(([name, records]) => [name, {
      entries: records.length,
      issues: records.reduce((total, entry) => total + entry.issues.length, 0),
      verified: records.filter(entry => /^verified/.test(entry.status)).length,
    }]));
    report.helpInventory[engine] = {
      pages: corpus.pages.length,
      digest: corpusDigest(corpus),
    };
    report.summary[engine] = categorySummary;
    report.engines[engine] = {
      detectionCommands,
      executionCommands,
      engineFunctions,
      systemConstants,
    };
  }

  report.totalIssues = totalIssues;
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ summary: report.summary, totalIssues, output: options.output }, null, 2));
  if (totalIssues > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  completionStatus,
  evidenceTokens,
  normalizeName,
  options,
  pageHasEvidence,
};
