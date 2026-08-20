const fs = require('node:fs');
const path = require('node:path');
const {
  analyzeNestedVariables,
  normalizeNestedVariableReference,
  normalizePersonalFlagReference,
} = require('../../out/utils/nested-variable-analysis');
const { decodeTextFile } = require('../../out/utils/text');
const { isBinarySpreadsheet, parseScriptTableData } = require('../../out/utils/table-data');

const root = path.resolve(process.argv[2] || '.');
const sampleLimit = Number(process.argv[3] || 8);
const files = [];
const iniCache = new Map();
const tableCache = new Map();
const listCache = new Map();
collectFiles(root, files);

const records = [];
const personalFlagRecords = [];
let analysisMs = 0;
for (const filePath of files) {
  let source;
  try {
    source = decodeTextFile(fs.readFileSync(filePath)).text;
  } catch {
    continue;
  }
  if (!/<\$STR\s*\(/i.test(source) && !/(?:CHECK|SET|RESET)\s*\[/i.test(source)) continue;
  const started = performance.now();
  const analysis = analyzeNestedVariables(source, {
    resolveConfigValues: request => resolveConfigValues(filePath, request),
    resolveTableData: request => resolveTableData(filePath, request),
    resolveListData: request => resolveListData(filePath, request),
  });
  analysisMs += performance.now() - started;
  for (const reference of analysis.references) {
    records.push({
      filePath,
      line: reference.line + 1,
      form: normalizeNestedVariableReference(reference),
      base: reference.base,
      depth: reference.depth,
      status: reference.status,
      variables: reference.variables,
      evidence: reference.evidence,
    });
  }
  for (const reference of analysis.personalFlags) {
    personalFlagRecords.push({
      filePath,
      line: reference.line + 1,
      form: normalizePersonalFlagReference(reference),
      command: reference.command,
      status: reference.status,
      flags: reference.flags,
    });
  }
}

const status = groupCount(records, record => record.status);
const concrete = records.filter(record => record.variables.length > 0).length;
const uniqueForms = new Set(records.map(record => record.form)).size;
const actualVariables = new Set(records.flatMap(record => record.variables));
const unresolved = records.filter(record => record.variables.length === 0);
const personalFlagStatus = groupCount(personalFlagRecords, record => record.status);
const personalFlagConcrete = new Set(personalFlagRecords.flatMap(record => record.flags));
const personalFlagUnresolved = personalFlagRecords.filter(record => record.status === 'unresolved');
const samples = {};
for (const state of ['resolved', 'partial', 'unresolved']) {
  samples[state] = records
    .filter(record => record.status === state)
    .slice(0, sampleLimit)
    .map(record => ({
      file: path.relative(root, record.filePath),
      line: record.line,
      form: record.form,
      variables: record.variables.slice(0, 20),
      evidence: record.evidence,
    }));
}

process.stdout.write(JSON.stringify({
  root,
  files: files.length,
  occurrences: records.length,
  uniqueForms,
  status,
  concretized: concrete,
  concretizedCoverage: records.length === 0 ? '100.00%' : `${(concrete / records.length * 100).toFixed(2)}%`,
  uniqueActualVariables: actualVariables.size,
  analysisMs: Math.round(analysisMs),
  byDepth: groupCount(records, record => String(record.depth)),
  unresolved: unresolved.map(record => ({
    file: path.relative(root, record.filePath),
    line: record.line,
    form: record.form,
  })),
  personalFlags: {
    occurrences: personalFlagRecords.length,
    uniqueForms: new Set(personalFlagRecords.map(record => record.form)).size,
    uniqueConcreteFlags: personalFlagConcrete.size,
    status: personalFlagStatus,
    unresolved: personalFlagUnresolved.map(record => ({
      file: path.relative(root, record.filePath),
      line: record.line,
      form: record.form,
      command: record.command,
    })),
    samples: personalFlagRecords.slice(0, sampleLimit).map(record => ({
      file: path.relative(root, record.filePath),
      line: record.line,
      form: record.form,
      command: record.command,
      status: record.status,
      flags: record.flags.slice(0, 30),
    })),
  },
  samples,
}, null, 2));

function resolveConfigValues(sourceFile, request) {
  if (!request.path || /<\$/i.test(request.path)) return undefined;
  const relativePath = request.path.replace(/^['"]|['"]$/g, '');
  const withoutParentPrefix = relativePath.replace(/^(?:\.\.[\\/])+/, '');
  const candidates = [
    path.resolve(path.dirname(sourceFile), relativePath),
    path.resolve(root, 'Market_Def', relativePath),
    path.resolve(root, relativePath),
    path.resolve(root, withoutParentPrefix),
  ];
  const configPath = candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  if (!configPath) return undefined;

  const stat = fs.statSync(configPath);
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  let cached = iniCache.get(configPath);
  if (!cached || cached.stamp !== stamp) {
    cached = {
      stamp,
      sections: parseIniSections(decodeTextFile(fs.readFileSync(configPath)).text),
    };
    iniCache.set(configPath, cached);
  }

  const dynamicSection = /<\$/i.test(request.section);
  const dynamicKey = /<\$/i.test(request.key);
  const sections = dynamicSection
    ? [...cached.sections.values()]
    : [cached.sections.get(
      request.section.replace(/^['"]|['"]$/g, '').trim().toUpperCase(),
    )].filter(Boolean);
  if (sections.length === 0) return undefined;
  if (dynamicKey) {
    const values = sections.flatMap(section => [...section.values()].flat());
    return values.length > 0 ? { values, complete: true } : undefined;
  }
  const key = request.key.replace(/^['"]|['"]$/g, '').trim().toUpperCase();
  const values = sections.flatMap(section => section.get(key) || []);
  return values && values.length > 0 ? { values, complete: true } : undefined;
}

function resolveTableData(sourceFile, request) {
  if (!request.path || /<\$/i.test(request.path)) return undefined;
  const tablePath = resolveDataFile(sourceFile, request.path);
  if (!tablePath) return undefined;
  const stat = fs.statSync(tablePath);
  const key = `${request.format}:${tablePath}`;
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  const cached = tableCache.get(key);
  if (cached?.stamp === stamp) return cached.result;

  let result;
  try {
    const raw = fs.readFileSync(tablePath);
    if (!isBinarySpreadsheet(raw)) {
      result = {
        rows: parseScriptTableData(decodeTextFile(raw).text, request.format),
        complete: true,
      };
    }
  } catch {
    result = undefined;
  }
  tableCache.set(key, { stamp, result });
  return result;
}

function resolveListData(sourceFile, request) {
  if (!request.path || /<\$/i.test(request.path)) return undefined;
  const listPath = resolveDataFile(sourceFile, request.path);
  if (!listPath) return undefined;
  const stat = fs.statSync(listPath);
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  const cached = listCache.get(listPath);
  if (cached?.stamp === stamp) return cached.result;

  let result;
  try {
    result = {
      lines: decodeTextFile(fs.readFileSync(listPath)).text.split(/\r\n|\n|\r/),
      complete: true,
    };
  } catch {
    result = undefined;
  }
  listCache.set(listPath, { stamp, result });
  return result;
}

function resolveDataFile(sourceFile, rawPath) {
  const relativePath = rawPath.replace(/^['"]|['"]$/g, '');
  const withoutParentPrefix = relativePath.replace(/^(?:\.\.[\\/])+/, '');
  const candidates = [
    path.resolve(path.dirname(sourceFile), relativePath),
    path.resolve(root, 'Market_Def', relativePath),
    path.resolve(root, relativePath),
    path.resolve(root, withoutParentPrefix),
  ];
  return candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  });
}

function parseIniSections(text) {
  const sections = new Map();
  let current;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const section = /^\[([^\]]+)\]$/.exec(line);
    if (section) {
      const name = section[1].trim().toUpperCase();
      current = sections.get(name) || new Map();
      sections.set(name, current);
      continue;
    }
    if (!current) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toUpperCase();
    const values = current.get(key) || [];
    values.push(line.slice(separator + 1).trim());
    current.set(key, values);
  }
  return sections;
}

function collectFiles(directory, output) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(fullPath, output);
    else if (entry.isFile() && /\.(?:txt|ini)$/i.test(entry.name)) output.push(fullPath);
  }
}

function groupCount(values, keyOf) {
  const counts = {};
  for (const value of values) {
    const key = keyOf(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}
