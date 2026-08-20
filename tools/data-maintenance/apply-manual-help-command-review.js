#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const review = require('./help-command-manual-review');

const projectRoot = path.resolve(__dirname, '..', '..');
const apply = process.argv.includes('--apply');
const reportPath = path.join(
  projectRoot,
  'data',
  'audit-report',
  'help-command-coverage-final.json'
);
const expandedReportPath = path.join(
  projectRoot,
  'data',
  'audit-report',
  'help-command-manual-review-final.json'
);
const backupRoot = path.join(
  projectRoot,
  'data',
  'backups',
  'language-before-manual-help-review-20260726'
);

const ENGINE_FILES = {
  GOM: 'data/functions.json',
  GEE: 'data/functions-gee.json',
  '996PC': 'data/functions-996pc.json',
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function flattenKinds(groups = {}) {
  const result = [];
  for (const [kind, names] of Object.entries(groups)) {
    for (const name of names) result.push({ name, kind });
  }
  return result;
}

function discoveredEntries(engineReport) {
  return [
    ...engineReport.coveredExact,
    ...engineReport.coveredByTargetPrefix,
    ...engineReport.coveredByJoinedNumber,
    ...engineReport.highConfidence,
    ...engineReport.review,
    ...engineReport.titleOnly,
    ...engineReport.rejected,
  ];
}

function unresolvedEntries(engineReport) {
  return [
    ...engineReport.coveredByTargetPrefix,
    ...engineReport.coveredByJoinedNumber,
    ...engineReport.highConfidence,
    ...engineReport.review,
    ...engineReport.titleOnly,
    ...engineReport.rejected,
  ];
}

function uniqueMap(entries, label) {
  const result = new Map();
  for (const entry of entries) {
    if (result.has(entry.token)) throw new Error(`${label} 重复: ${entry.token}`);
    result.set(entry.token, entry);
  }
  return result;
}

function evidenceRank(evidence) {
  const kindScore = {
    'format-line': 100,
    'format-continuation': 95,
    'command-declaration': 90,
    'command-section-usage': 80,
    'command-section-first-token': 75,
    'script-block': 60,
    'inline-script-block': 55,
    'title-command-usage': 40,
    'command-page-title': 30,
  }[evidence.kind] || 0;
  const updatePenalty = /(?:^|\/)(?:UpDate|\d{4}年更新)/i.test(evidence.page) ? 20 : 0;
  return kindScore - updatePenalty;
}

function preferredEvidence(candidate) {
  return [...candidate.evidence].sort((left, right) => (
    evidenceRank(right) - evidenceRank(left)
    || left.page.localeCompare(right.page)
    || left.line - right.line
  ))[0];
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

function paramsFromSyntax(name, syntax) {
  if (syntax === name) return [];
  const remainder = syntax.slice(name.length).trim();
  return remainder ? splitTopLevel(remainder) : [];
}

function buildEntry(engine, decision, candidate, engineReview) {
  const evidence = preferredEvidence(candidate);
  if (!evidence) throw new Error(`${engine} ${decision.name} 缺少帮助证据`);
  const syntax = engineReview.syntax?.[decision.name] || decision.name;
  const paramList = paramsFromSyntax(decision.name, syntax);
  const reviewNote = engineReview.notes?.[decision.name];
  return {
    name: decision.name,
    syntax,
    details: evidence.title || path.basename(evidence.page, path.extname(evidence.page)),
    params: paramList.join(' '),
    paramList,
    kind: decision.kind,
    contexts: decision.kind === 'check'
      ? ['IF']
      : decision.kind === 'control'
        ? ['ANY']
        : ['ACT'],
    aliases: [],
    source: {
      revision: review.revision,
      page: evidence.page,
      ...(evidence.title ? { title: evidence.title } : {}),
      evidenceLine: evidence.line,
    },
    completionVerified: true,
    completionEnabled: true,
    diagnosticSupported: true,
    completionReview: syntax === decision.name
      ? 'manual-own-help-name-only'
      : 'manual-own-help-exact',
    ...(reviewNote ? { reviewNote } : {}),
  };
}

function validateAndBuild(engine, engineReport, engineReview) {
  const accepted = [
    ...flattenKinds(engineReview.accept),
    ...flattenKinds(engineReview.targetPrefix),
  ];
  const acceptedMap = uniqueMap(
    accepted.map(entry => ({ token: entry.name, ...entry })),
    `${engine} 接受清单`
  );
  const rejectedMap = uniqueMap(
    Object.entries(engineReview.reject).map(([token, reason]) => ({ token, reason })),
    `${engine} 拒绝清单`
  );
  for (const token of acceptedMap.keys()) {
    if (rejectedMap.has(token)) throw new Error(`${engine} ${token} 同时被接受和拒绝`);
  }

  const discovered = uniqueMap(discoveredEntries(engineReport), `${engine} 扫描结果`);
  const unresolved = new Set(unresolvedEntries(engineReport).map(entry => entry.token));
  const reviewed = new Set([...acceptedMap.keys(), ...rejectedMap.keys()]);
  const missing = [...unresolved].filter(token => !reviewed.has(token));
  const extra = [...reviewed].filter(token => !discovered.has(token));
  if (missing.length || extra.length) {
    throw new Error(
      `${engine} 审核清单不完整; 缺少=[${missing.join(', ')}]; 多余=[${extra.join(', ')}]`
    );
  }

  const entries = [];
  for (const decision of accepted) {
    const candidate = discovered.get(decision.name);
    entries.push({
      decision: 'accept',
      token: decision.name,
      kind: decision.kind,
      catalogEntry: buildEntry(engine, decision, candidate, engineReview),
      evidence: candidate.evidence,
    });
  }
  for (const [token, reason] of Object.entries(engineReview.reject)) {
    const candidate = discovered.get(token);
    entries.push({
      decision: 'reject',
      token,
      reason,
      evidence: candidate.evidence,
    });
  }
  entries.sort((left, right) => left.token.localeCompare(right.token));
  return entries;
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function backupCatalog(relativePath) {
  const source = path.join(projectRoot, relativePath);
  const destination = path.join(backupRoot, path.basename(relativePath));
  fs.mkdirSync(backupRoot, { recursive: true });
  if (!fs.existsSync(destination)) fs.copyFileSync(source, destination);
}

function main() {
  const coverage = readJson(reportPath);
  const expanded = {
    schemaVersion: 1,
    revision: review.revision,
    policy: review.policy,
    engines: {},
    summary: {},
  };

  for (const [engine, relativePath] of Object.entries(ENGINE_FILES)) {
    const decisions = validateAndBuild(
      engine,
      coverage.engines[engine],
      review.engines[engine]
    );
    const accepted = decisions.filter(entry => entry.decision === 'accept');
    const rejected = decisions.filter(entry => entry.decision === 'reject');
    expanded.engines[engine] = decisions;
    expanded.summary[engine] = {
      accepted: accepted.length,
      rejected: rejected.length,
      exactSyntax: accepted.filter(entry => (
        entry.catalogEntry.completionReview === 'manual-own-help-exact'
      )).length,
      nameOnlySyntax: accepted.filter(entry => (
        entry.catalogEntry.completionReview === 'manual-own-help-name-only'
      )).length,
    };

    if (apply) {
      backupCatalog(relativePath);
      const filePath = path.join(projectRoot, relativePath);
      const catalog = readJson(filePath);
      for (const entry of accepted) catalog[entry.token] = entry.catalogEntry;
      const sorted = Object.fromEntries(Object.entries(catalog).sort(([left], [right]) => (
        left.localeCompare(right, 'en', { sensitivity: 'base' })
      )));
      writeJsonAtomic(filePath, sorted);
    }
  }

  if (apply) writeJsonAtomic(expandedReportPath, expanded);
  console.log(JSON.stringify(expanded.summary, null, 2));
  console.log(apply
    ? `已应用逐条审核结果，完整记录: ${expandedReportPath}`
    : '已通过逐条审核清单校验；未修改语言库（使用 --apply 应用）。');
}

if (require.main === module) main();

module.exports = {
  buildEntry,
  paramsFromSyntax,
  preferredEvidence,
  validateAndBuild,
};
