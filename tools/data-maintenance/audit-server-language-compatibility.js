#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function option(name, fallback = '') {
  const prefix = `--${name}=`;
  const value = process.argv.find(argument => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function listScriptFiles(root) {
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/\.txt$/i.test(entry.name)) files.push(fullPath);
    }
  };
  visit(root);
  return files;
}

function recordFinding(target, key, root, file, lineNumber, text) {
  const findings = target.get(key) || [];
  if (findings.length < 5) {
    findings.push({
      file: path.relative(root, file).replace(/\\/g, '/'),
      line: lineNumber,
      text: text.slice(0, 200),
    });
  }
  target.set(key, findings);
}

function buildIndex(engine) {
  const { buildLanguageIndex } = require(path.join(
    projectRoot,
    'out',
    'utils',
    'command-index'
  ));
  return buildLanguageIndex(
    readJson('data/commands.json'),
    readJson('data/variables.json'),
    {
      GOM: readJson('data/functions.json'),
      GEE: readJson('data/functions-gee.json'),
      '996PC': readJson('data/functions-996pc.json'),
    },
    engine,
    {
      GOM: readJson('data/constants-gom.json'),
      GEE: readJson('data/constants-gee.json'),
      '996PC': readJson('data/constants-996pc.json'),
    }
  );
}

function scanServerLanguage(serverRoot, requestedEngine) {
  const { decodeTextFile } = require(path.join(projectRoot, 'out', 'utils', 'text'));
  const {
    detectEngineDetails,
    resolveEngineRoot,
  } = require(path.join(projectRoot, 'out', 'utils', 'engine-detect'));
  const { normalizeEngineId } = require(path.join(
    projectRoot,
    'out',
    'utils',
    'engine-registry'
  ));

  const engineRoot = resolveEngineRoot(serverRoot);
  const detection = detectEngineDetails(serverRoot);
  const engine = requestedEngine && requestedEngine.toLowerCase() !== 'auto'
    ? normalizeEngineId(requestedEngine)
    : detection.engine;
  const envirRoot = path.join(engineRoot, 'Mir200', 'Envir');
  if (!fs.existsSync(envirRoot)) {
    throw new Error(`未找到脚本目录: ${envirRoot}`);
  }

  const index = buildIndex(engine);
  const commandMismatches = new Map();
  const symbolMismatches = new Map();
  const files = listScriptFiles(envirRoot);
  let lineCount = 0;
  let triggerDefinitions = 0;

  for (const file of files) {
    let lines;
    try {
      lines = decodeTextFile(fs.readFileSync(file)).text.split(/\r?\n/);
    } catch (error) {
      throw new Error(`读取脚本失败 ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    lineCount += lines.length;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const original = lines[lineIndex];
      let text = original.trim();
      if (!text || /^(?:;|\/\/)/.test(text)) continue;

      for (const match of text.matchAll(/\[@([^\]\r\n]+)\]/g)) {
        if (match[1].trim()) triggerDefinitions++;
      }

      if (/^(?:\[|#|<)/.test(text)) continue;
      text = text.replace(/^NOT\s+/i, '');
      const commandMatch = /^([A-Za-z][A-Za-z0-9_.]*(?:\s+\[N\])?)(?=\s|$)/i.exec(text);
      if (commandMatch) {
        const name = commandMatch[1].toUpperCase();
        if (
          !index.commandByName.has(name)
          && index.unsupportedCommandByName.has(name)
        ) {
          recordFinding(commandMismatches, name, envirRoot, file, lineIndex + 1, original);
        }
      }

      for (const match of text.matchAll(/<\$([A-Za-z_][A-Za-z0-9_.]*)(?=[(>])/g)) {
        const name = match[1].toUpperCase();
        const active = index.variableByName.has(name) || index.constantByName.has(name);
        const belongsToOtherEngine = (
          index.unsupportedVariableByName.has(name)
          || index.unsupportedConstantByName.has(name)
        );
        if (!active && belongsToOtherEngine) {
          recordFinding(symbolMismatches, name, envirRoot, file, lineIndex + 1, original);
        }
      }
    }
  }

  const mapToObject = source => Object.fromEntries(source);
  return {
    engine,
    detectedEngine: detection.engine,
    detectionConfidence: detection.confidence,
    engineRoot,
    envirRoot,
    files: files.length,
    lines: lineCount,
    triggerDefinitions,
    triggerCompatibility: 'not-diagnosed-custom-label-ambiguous',
    commandMismatches: mapToObject(commandMismatches),
    symbolMismatches: mapToObject(symbolMismatches),
    mismatchKinds: (
      commandMismatches.size
      + symbolMismatches.size
    ),
  };
}

function main() {
  const root = option('root');
  if (!root) {
    throw new Error(
      '请指定服务端目录，例如 --root=D:\\996PC\\Mirserver [--engine=auto|GOM|GEE|996PC]'
    );
  }
  const report = scanServerLanguage(path.resolve(root), option('engine', 'auto'));
  console.log(JSON.stringify(report, null, 2));
  if (report.mismatchKinds > 0) process.exitCode = 2;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  scanServerLanguage,
};
