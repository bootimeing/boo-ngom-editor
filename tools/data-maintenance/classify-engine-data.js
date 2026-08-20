const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const iconv = require('iconv-lite');
const languageAudit = require('./audit-engine-language-accuracy');

const projectRoot = path.resolve(__dirname, '..', '..');
const defaults = {
  gomHelp: path.join(
    process.env.LOCALAPPDATA || '',
    'Temp',
    'boo-help-audit-gom-20260719'
  ),
  geeHelp: path.join(
    process.env.LOCALAPPDATA || '',
    'Temp',
    'boo-help-audit-gee-20260719'
  ),
  gomChm: 'D:\\0帮助\\GameOfMir引擎使用说明书.chm',
  geeChm: 'D:\\0帮助\\翎风引擎帮助文档.CHM',
};

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find(argument => argument.startsWith(prefix));
  return value ? path.resolve(value.slice(prefix.length)) : fallback;
}

const options = {
  apply: process.argv.includes('--apply'),
  verbose: process.argv.includes('--verbose'),
  gomHelp: option('gom-help', defaults.gomHelp),
  geeHelp: option('gee-help', defaults.geeHelp),
  gomChm: option('gom-chm', defaults.gomChm),
  geeChm: option('gee-chm', defaults.geeChm),
};

const classificationOverrides = {
  HOUR: { status: 'gom-only', engines: ['GOM'], confidence: 'confirmed' },
  MIN: { status: 'gom-only', engines: ['GOM'], confidence: 'confirmed' },
  MP: { status: 'shared', engines: ['GOM', 'GEE'], confidence: 'confirmed' },
  SCREENHEIGHT: { status: 'shared', engines: ['GOM', 'GEE'], confidence: 'confirmed' },
  SCREENWIDTH: { status: 'shared', engines: ['GOM', 'GEE'], confidence: 'confirmed' },
  // 翎风更新记录明确写明已去掉这两条旧绑定命令，需改用
  // CheckItemState / SetItemState。历史帮助中的旧语法不能代表当前支持。
  CHECKITEMBIND: { status: 'gom-only', engines: ['GOM'], confidence: 'confirmed' },
  SETITEMBIND: { status: 'gom-only', engines: ['GOM'], confidence: 'confirmed' },
};

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  const target = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(
    target,
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8'
  );
}

function walkHtmlFiles(root) {
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

function ensureHelpDirectory(root, chmPath) {
  if (fs.existsSync(root) && walkHtmlFiles(root).length > 0) return root;
  if (!fs.existsSync(chmPath)) {
    throw new Error(`Help directory is empty and CHM does not exist: ${chmPath}`);
  }
  fs.mkdirSync(root, { recursive: true });
  const windowsDirectory = process.env.WINDIR || 'C:\\Windows';
  const hhPath = path.join(windowsDirectory, 'hh.exe');
  const extraction = spawnSync(
    hhPath,
    ['-decompile', root, chmPath],
    { windowsHide: true, encoding: 'utf8' }
  );
  if (extraction.error) throw extraction.error;
  const htmlFiles = walkHtmlFiles(root);
  if (htmlFiles.length === 0) {
    throw new Error(
      `CHM extraction produced no HTML files (exit ${extraction.status}): ${chmPath}`
    );
  }
  console.log(`Extracted ${path.basename(chmPath)}: ${htmlFiles.length} HTML files`);
  return root;
}

function decodeHtml(file) {
  const buffer = fs.readFileSync(file);
  const header = buffer.subarray(0, 4096).toString('latin1');
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(header)?.[1]?.toLowerCase();
  if (charset === 'utf-8' || charset === 'utf8') return buffer.toString('utf8');
  return iconv.decode(buffer, 'gb18030');
}

function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:nbsp|lt|gt|amp|quot|#\d+|#x[\da-f]+);/gi, ' ');
}

function buildHelpIndex(root) {
  if (!fs.existsSync(root)) {
    throw new Error(`Help directory does not exist: ${root}`);
  }
  const files = walkHtmlFiles(root);
  const tokens = new Map();
  for (const file of files) {
    const relativePath = path.relative(root, file).replace(/\\/g, '/');
    const text = visibleText(decodeHtml(file));
    const pageCounts = new Map();
    for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_.]*/g)) {
      const token = match[0].toUpperCase();
      pageCounts.set(token, (pageCounts.get(token) || 0) + 1);
    }
    for (const [token, count] of pageCounts) {
      const current = tokens.get(token) || { occurrences: 0, pages: [] };
      current.occurrences += count;
      current.pages.push(relativePath);
      tokens.set(token, current);
    }
  }
  return { files: files.length, tokens };
}

function catalogIndex(catalog) {
  return languageAudit.catalogIndex(catalog);
}

function commandEvidenceNames(entry) {
  const names = [entry.name, ...(entry.aliases || [])];
  if (entry.name === 'CHECK [N]') names.push('CHECK');
  if (entry.name === 'SET [N]') names.push('SET');
  return [...new Set(names.map(name => name.toUpperCase()))];
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

function collectEvidence(entry, helpCorpus, functionNames, engine) {
  const inspected = languageAudit.inspectEngine(
    entryForEngine(entry, engine),
    helpCorpus,
    functionNames
  );
  const hasDocumentPage = inspected.supported
    && inspected.supportMethod !== 'function-catalog';
  return {
    documented: hasDocumentPage,
    functionLibrary: Boolean(inspected.function),
    occurrences: hasDocumentPage ? inspected.bestPage?.occurrences || 0 : 0,
    pages: hasDocumentPage && inspected.bestPage ? [inspected.bestPage.path] : [],
    functionSources: inspected.function?.source ? [inspected.function.source] : [],
  };
}

function classifyEntry(entry, gomEvidence, geeEvidence) {
  const override = classificationOverrides[entry.name.toUpperCase()];
  if (override) return override;
  const previousWasAutomatic = entry.engineClassification?.method === 'latest-help-index';
  const manualEngines = previousWasAutomatic ? [] : (entry.engines || []);
  const supportsGom = gomEvidence.documented
    || gomEvidence.functionLibrary
    || manualEngines.includes('GOM');
  const supportsGee = geeEvidence.documented
    || geeEvidence.functionLibrary
    || manualEngines.includes('GEE');
  if (supportsGom && supportsGee) {
    return { status: 'shared', engines: ['GOM', 'GEE'], confidence: 'confirmed' };
  }
  if (supportsGom) {
    return { status: 'gom-only', engines: ['GOM'], confidence: 'confirmed' };
  }
  if (supportsGee) {
    return { status: 'gee-only', engines: ['GEE'], confidence: 'confirmed' };
  }
  return { status: 'compatibility', engines: null, confidence: 'unverified' };
}

function classificationSource(classification, gomEvidence, geeEvidence) {
  const preferred = classification.status === 'gee-only' ? geeEvidence : gomEvidence;
  const fallback = classification.status === 'gom-only' ? geeEvidence : gomEvidence;
  const page = preferred.pages[0]
    || preferred.functionSources[0]?.page
    || fallback.pages[0]
    || fallback.functionSources[0]?.page;
  if (!page) return null;
  return {
    revision: '2026-07-19',
    page,
  };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isUpdatePage(relativePath) {
  return /(?:^|\/)UPDATE(?:\d{4}(?:-\d{4})?)?\.HTML?$/i.test(relativePath);
}

function variableEvidencePatterns(entry) {
  const patterns = [];
  const addLiteral = value => {
    if (!value) return;
    patterns.push(new RegExp(escapeRegex(value), 'i'));
  };
  const addMarker = marker => {
    if (!marker) return;
    let pattern = escapeRegex(marker);
    pattern = pattern.replace(escapeRegex('变量名'), '[^)>\\s]+');
    patterns.push(new RegExp(pattern, 'i'));
  };

  for (const marker of String(entry.full || '').match(/<\$[^>]+>/g) || []) {
    addMarker(marker);
  }
  if (/^[A-Za-z_][A-Za-z0-9_.$]*$/.test(entry.name)) {
    addLiteral(`<$${entry.name}>`);
  }
  for (const alias of entry.aliases || []) {
    if (/^[A-Za-z_][A-Za-z0-9_.$]*$/.test(alias)) addLiteral(`<$${alias}>`);
  }

  const range = /^([A-Za-z])(\d+)-\1(\d+)$/i.exec(entry.name);
  if (range) {
    patterns.push(new RegExp(
      `\\b${escapeRegex(`${range[1]}${range[2]}`)}\\s*(?:-|~|—|至)\\s*${escapeRegex(`${range[1]}${range[3]}`)}\\b`,
      'i'
    ));
  }
  if (entry.name === 'STR(T0)') {
    patterns.push(/\bT0\s*(?:-|~|—|至)\s*T499\b/i);
  }
  if (entry.name === 'STR(U0)') {
    patterns.push(/\bU0\s*(?:-|~|—|至)\s*U499\b/i);
  }
  return patterns;
}

function triggerEvidencePatterns(entry) {
  const labels = [entry.label, ...(entry.aliases || []).map(alias => (
    alias.startsWith('[@') ? alias : `[@${alias}]`
  ))];
  return labels.filter(Boolean).map(label => {
    const escaped = escapeRegex(label);
    return new RegExp(
      escaped.replace(/X(?=\\\]$)/i, '(?:X|\\d+)'),
      'i'
    );
  });
}

function collectSymbolEvidence(entry, corpus, type) {
  const patterns = type === 'variable'
    ? variableEvidencePatterns(entry)
    : triggerEvidencePatterns(entry);
  const candidates = [];
  for (const page of corpus.pages) {
    if (isUpdatePage(page.relativePath)) continue;
    let occurrences = 0;
    for (const pattern of patterns) {
      const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
      occurrences += [...page.text.matchAll(new RegExp(pattern.source, flags))].length;
    }
    if (occurrences === 0) continue;
    const definitionPage = /(?:脚本变量|程序变量|触发|变量说明|变量大全)/i.test(
      `${page.relativePath} ${page.title}`
    );
    candidates.push({
      path: page.relativePath,
      title: page.title,
      occurrences,
      score: occurrences + (definitionPage ? 20 : 0),
    });
  }
  candidates.sort((left, right) => (
    right.score - left.score
    || right.occurrences - left.occurrences
    || left.path.localeCompare(right.path, 'zh-CN')
  ));
  return {
    documented: candidates.length > 0,
    bestPage: candidates[0] || null,
    alternatives: candidates.slice(1, 6),
  };
}

function classifySymbols(entries, type, gomHelp, geeHelp) {
  const records = {};
  const summary = {
    shared: 0,
    'gom-only': 0,
    'gee-only': 0,
    compatibility: 0,
  };
  for (const entry of entries) {
    const gomEvidence = collectSymbolEvidence(entry, gomHelp, type);
    const geeEvidence = collectSymbolEvidence(entry, geeHelp, type);
    const override = classificationOverrides[entry.name.toUpperCase()];
    const supportsGom = gomEvidence.documented || Boolean(override?.engines?.includes('GOM'));
    const supportsGee = geeEvidence.documented || Boolean(override?.engines?.includes('GEE'));
    const classification = override || (supportsGom && supportsGee
      ? { status: 'shared', engines: ['GOM', 'GEE'], confidence: 'confirmed' }
      : supportsGom
        ? { status: 'gom-only', engines: ['GOM'], confidence: 'confirmed' }
        : supportsGee
          ? { status: 'gee-only', engines: ['GEE'], confidence: 'confirmed' }
          : { status: 'compatibility', engines: null, confidence: 'unverified' });
    summary[classification.status]++;

    if (classification.engines) entry.engines = classification.engines;
    else delete entry.engines;
    entry.engineSources = {};
    if (gomEvidence.bestPage) {
      entry.engineSources.GOM = {
        revision: '2026-07-19',
        page: gomEvidence.bestPage.path,
      };
    }
    if (geeEvidence.bestPage) {
      entry.engineSources.GEE = {
        revision: '2026-07-19',
        page: geeEvidence.bestPage.path,
      };
    } else if (override?.engines?.includes('GEE') && /^(?:SCREENWIDTH|SCREENHEIGHT)$/i.test(entry.name)) {
      entry.engineSources.GEE = {
        revision: '2026-07-23',
        page: 'UpDate.htm',
      };
    } else if (override?.engines?.includes('GEE') && /^MP$/i.test(entry.name)) {
      entry.engineSources.GEE = {
        revision: '2026-07-23',
        page: '游戏引擎反外挂系统/其他相关资料/脚本变量大全[!].htm',
      };
    }
    if (Object.keys(entry.engineSources).length === 0) {
      delete entry.engineSources;
      delete entry.source;
    } else {
      entry.source = entry.engineSources.GOM || entry.engineSources.GEE;
    }
    entry.engineClassification = {
      status: classification.status,
      confidence: classification.confidence,
      method: 'latest-help-index',
      revision: '2026-07-19',
    };
    records[entry.name.toUpperCase()] = {
      name: entry.name,
      classification: classification.status,
      confidence: classification.confidence,
      engines: classification.engines,
      evidence: {
        GOM: gomEvidence,
        GEE: geeEvidence,
      },
    };
  }
  return { summary, records };
}

function classifyCommands(commands, gomHelp, geeHelp, gomFunctions, geeFunctions) {
  const gomFunctionNames = catalogIndex(gomFunctions);
  const geeFunctionNames = catalogIndex(geeFunctions);
  const records = {};
  const summary = {
    shared: 0,
    'gom-only': 0,
    'gee-only': 0,
    compatibility: 0,
  };
  for (const [kind, entries] of [
    ['check', commands.commands],
    ['action', commands.execCommands],
  ]) {
    for (const entry of entries) {
      const gomEvidence = collectEvidence(entry, gomHelp, gomFunctionNames, 'GOM');
      const geeEvidence = collectEvidence(entry, geeHelp, geeFunctionNames, 'GEE');
      const classification = classifyEntry(entry, gomEvidence, geeEvidence);
      summary[classification.status]++;
      records[entry.name.toUpperCase()] = {
        name: entry.name,
        kind,
        classification: classification.status,
        confidence: classification.confidence,
        engines: classification.engines,
        evidence: {
          GOM: gomEvidence,
          GEE: geeEvidence,
        },
      };
      if (classification.engines) entry.engines = classification.engines;
      else delete entry.engines;
      if (entry.engineVariants) {
        for (const engine of ['GOM', 'GEE']) {
          if (!classification.engines?.includes(engine)) delete entry.engineVariants[engine];
        }
        if (Object.keys(entry.engineVariants).length === 0) delete entry.engineVariants;
      }
      if (classification.engines && !entry.source) {
        entry.source = classificationSource(classification, gomEvidence, geeEvidence);
      }
      entry.engineClassification = {
        status: classification.status,
        confidence: classification.confidence,
        method: 'latest-help-index',
        revision: '2026-07-19',
      };
    }
  }
  return { summary, records };
}

function main() {
  const commands = readJson('data/commands.json');
  const variables = readJson('data/variables.json');
  const gomFunctions = readJson('data/functions.json');
  const geeFunctions = readJson('data/functions-gee.json');
  const gomHelpRoot = ensureHelpDirectory(options.gomHelp, options.gomChm);
  const geeHelpRoot = ensureHelpDirectory(options.geeHelp, options.geeChm);
  const gomHelp = languageAudit.buildHelpCorpus(gomHelpRoot);
  const geeHelp = languageAudit.buildHelpCorpus(geeHelpRoot);
  const result = classifyCommands(
    commands,
    gomHelp,
    geeHelp,
    gomFunctions,
    geeFunctions
  );
  const variableResult = classifySymbols(
    variables.variables,
    'variable',
    gomHelp,
    geeHelp
  );
  const triggerResult = classifySymbols(
    commands.triggers || [],
    'trigger',
    gomHelp,
    geeHelp
  );
  const report = {
    schemaVersion: 1,
    generated: '2026-07-19',
    revision: '2026-07-19',
    sources: {
      GOM: { name: 'GameOfMir latest help', files: gomHelp.pages.length },
      GEE: { name: 'Lingfeng latest help', files: geeHelp.pages.length },
    },
    summary: result.summary,
    commands: result.records,
    symbols: {
      variables: {
        summary: variableResult.summary,
        records: variableResult.records,
      },
      triggers: {
        summary: triggerResult.summary,
        records: triggerResult.records,
      },
    },
  };

  console.log(JSON.stringify({
    files: { GOM: gomHelp.pages.length, GEE: geeHelp.pages.length },
    commands: result.summary,
    variables: variableResult.summary,
    triggers: triggerResult.summary,
  }, null, 2));

  const unresolved = Object.values(result.records)
    .filter(record => record.classification === 'compatibility')
    .map(record => record.name);
  console.log(`Unverified (${unresolved.length}): ${unresolved.join(', ') || 'none'}`);
  if (options.verbose) {
    for (const status of ['shared', 'gom-only', 'gee-only']) {
      const names = Object.values(result.records)
        .filter(record => record.classification === status)
        .map(record => record.name);
      console.log(`${status} (${names.length}): ${names.join(', ')}`);
    }
  }

  if (options.apply) {
    writeJson('data/commands.json', commands);
    writeJson('data/variables.json', variables);
    writeJson('data/audit-report/engine-classification.json', report);
    console.log('Classification written to commands, variables, and the engine audit report');
  }
}

main();
