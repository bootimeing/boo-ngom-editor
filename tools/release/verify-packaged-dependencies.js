const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');

const sourceRoot = path.resolve(__dirname, '..', '..');
const packagedRoot = process.argv[2] ? path.resolve(process.argv[2]) : '';

const REQUIRED_NPC_DIALOG_RUNTIME_FILES = Object.freeze([
  'data/static-language.json',
  'media/npc-dialog-visual.css',
  'media/npc-dialog-visual.html',
  'media/npc-dialog-visual.js',
  'out/providers/npc-dialog-visual.js',
  'out/ui-dialog/adddlg-companion.js',
  'out/ui-dialog/item-preview.js',
  'out/ui-dialog/item-tooltip.js',
  'out/ui-dialog/model.js',
  'out/ui-dialog/offsets.js',
  'out/ui-dialog/progress-preview.js',
  'out/ui-dialog/source-parser.js',
  'out/ui-dialog/source-patcher.js',
  'out/ui-dialog/statement-catalog.js',
  'out/ui-dialog/variable-resolver.js',
]);
const REQUIRED_NPC_DIALOG_DYNAMIC_ENTRY_FILES = Object.freeze([
  'out/utils/archive-image-worker.js',
]);

function verifyRequiredPackagedFiles(root, relativePaths, label) {
  const missing = relativePaths.filter(relative => !fs.existsSync(path.join(root, relative)));
  assert.deepEqual(missing, [], `${label} packaged runtime files are missing:\n${missing.join('\n')}`);
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..'
    && !relative.startsWith(`..${path.sep}`));
}

function packagedRelative(root, absolute) {
  return path.relative(root, absolute).replaceAll('\\', '/');
}

function verifyLocalModuleClosure(root, entryPaths, dynamicEntryPaths = [], label = 'Runtime') {
  const resolvedRoot = path.resolve(root);
  const pending = [...entryPaths, ...dynamicEntryPaths].map(relative => ({
    absolute: path.resolve(resolvedRoot, ...relative.split('/')),
    requestedBy: '<entry>',
    specifier: relative,
  }));
  const visited = new Set();
  const problems = [];

  while (pending.length) {
    const request = pending.shift();
    if (!isPathInside(resolvedRoot, request.absolute)) {
      problems.push(`${request.requestedBy}: ${request.specifier} resolves outside packaged root`);
      continue;
    }
    const relative = packagedRelative(resolvedRoot, request.absolute);
    if (visited.has(relative)) continue;
    if (!fs.existsSync(request.absolute) || !fs.statSync(request.absolute).isFile()) {
      problems.push(`${request.requestedBy}: cannot resolve ${request.specifier}`);
      continue;
    }
    visited.add(relative);

    if (!/\.(?:c?js|mjs)$/i.test(request.absolute)) continue;
    const source = fs.readFileSync(request.absolute, 'utf8');
    const sourceFile = ts.createSourceFile(
      request.absolute,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const localRequire = createRequire(request.absolute);
    const visit = node => {
      if (ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'require'
        && node.arguments.length === 1
        && ts.isStringLiteralLike(node.arguments[0])) {
        const specifier = node.arguments[0].text;
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
          let resolved;
          try {
            resolved = localRequire.resolve(specifier);
          } catch {
            problems.push(`${relative}: cannot resolve ${specifier}`);
          }
          if (resolved) {
            const absolute = path.resolve(resolved);
            if (!isPathInside(resolvedRoot, absolute)) {
              problems.push(`${relative}: ${specifier} resolves outside packaged root`);
            } else {
              pending.push({ absolute, requestedBy: relative, specifier });
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  assert.deepEqual(
    problems,
    [],
    `${label} packaged local module closure is incomplete:\n${problems.join('\n')}`
  );
  return [...visited].sort();
}

function resolvePackageManifest(fromManifest, packageName) {
  let searchDirectory = path.dirname(fromManifest);
  while (searchDirectory.startsWith(sourceRoot)) {
    const candidate = path.join(
      searchDirectory,
      'node_modules',
      ...packageName.split('/'),
      'package.json',
    );
    if (fs.existsSync(candidate)) {
      const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (manifest.name === packageName) return candidate;
    }
    const parent = path.dirname(searchDirectory);
    if (parent === searchDirectory) break;
    searchDirectory = parent;
  }

  const localRequire = createRequire(fromManifest);
  try {
    const direct = localRequire.resolve(`${packageName}/package.json`);
    if (path.isAbsolute(direct)) return direct;
  } catch {
    // Packages with an exports map may hide package.json.
  }

  const entry = localRequire.resolve(packageName);
  assert.ok(path.isAbsolute(entry), `${packageName} resolved to a built-in module`);
  let directory = fs.statSync(entry).isDirectory() ? entry : path.dirname(entry);
  while (directory.startsWith(sourceRoot)) {
    const candidate = path.join(directory, 'package.json');
    if (fs.existsSync(candidate)) {
      const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (manifest.name === packageName) return candidate;
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Cannot locate ${packageName} from ${fromManifest}`);
}

function relativeFiles(directory) {
  const result = [];
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) result.push(path.relative(directory, absolute).replaceAll('\\', '/'));
    }
  }
  return result.sort();
}

function verifyDependencyClosure(sourceManifest, packagedManifest) {
  const rootManifest = JSON.parse(fs.readFileSync(sourceManifest, 'utf8'));
  const pending = Object.keys(rootManifest.dependencies || {})
    .map(name => ({ from: sourceManifest, name }));
  const seen = new Set();
  const missing = [];

  while (pending.length) {
    const { from, name } = pending.shift();
    const dependencyManifest = resolvePackageManifest(from, name);
    const relative = path.relative(sourceRoot, dependencyManifest);
    if (seen.has(relative)) continue;
    seen.add(relative);
    if (!fs.existsSync(path.join(packagedRoot, relative))) {
      missing.push(relative);
      continue;
    }
    const dependency = JSON.parse(fs.readFileSync(dependencyManifest, 'utf8'));
    pending.push(...Object.keys(dependency.dependencies || {})
      .map(child => ({ from: dependencyManifest, name: child })));
  }

  assert.deepEqual(missing, [], `Packaged production dependencies are missing:\n${missing.join('\n')}`);
  assert.ok(fs.existsSync(packagedManifest));
  return seen.size;
}

async function main() {
  assert.ok(packagedRoot, 'Usage: node tools/release/verify-packaged-dependencies.js <extracted-extension-root>');
  const sourceManifest = path.join(sourceRoot, 'package.json');
  const packagedManifest = path.join(packagedRoot, 'package.json');
  assert.ok(fs.existsSync(packagedManifest), `Missing packaged manifest: ${packagedManifest}`);

  const sourcePackage = JSON.parse(fs.readFileSync(sourceManifest, 'utf8'));
  const packagedPackage = JSON.parse(fs.readFileSync(packagedManifest, 'utf8'));
  assert.equal(packagedPackage.version, sourcePackage.version);
  verifyRequiredPackagedFiles(
    packagedRoot,
    ['readme.md', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.md'],
    'Project notice'
  );
  verifyRequiredPackagedFiles(packagedRoot, REQUIRED_NPC_DIALOG_RUNTIME_FILES, 'Ctrl+F12');
  const npcDialogModuleFiles = verifyLocalModuleClosure(
    packagedRoot,
    ['out/providers/npc-dialog-visual.js'],
    REQUIRED_NPC_DIALOG_DYNAMIC_ENTRY_FILES,
    'Ctrl+F12'
  );
  const packageCount = verifyDependencyClosure(sourceManifest, packagedManifest);

  const packagedRequire = createRequire(packagedManifest);
  for (const name of Object.keys(sourcePackage.dependencies || {})) {
    assert.ok(packagedRequire(name), `Cannot load packaged dependency ${name}`);
  }
  for (const name of ['browserify-aes', 'create-hash', 'fast-xml-parser']) {
    assert.ok(packagedRequire(name), `Cannot load packaged transitive dependency ${name}`);
  }

  const aes = packagedRequire('browserify-aes');
  const cipher = aes.createCipheriv('aes-128-ecb', Buffer.alloc(16), null);
  cipher.setAutoPadding(false);
  assert.equal(Buffer.concat([cipher.update(Buffer.alloc(16)), cipher.final()]).length, 16);
  assert.equal(packagedRequire('create-hash')('sha256').update('boo-release').digest('hex').length, 64);

  const initSqlJs = packagedRequire('sql.js');
  const SQL = await initSqlJs({
    locateFile: () => path.join(packagedRoot, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  });
  const database = new SQL.Database();
  database.run('CREATE TABLE release_test (value TEXT)');
  database.run('INSERT INTO release_test VALUES (?)', [sourcePackage.version]);
  assert.equal(database.exec('SELECT value FROM release_test')[0].values[0][0], sourcePackage.version);
  database.close();

  const XLSX = packagedRequire('xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['version'], [sourcePackage.version]]), 'test');
  const xls = XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' });
  assert.equal(XLSX.read(xls, { type: 'buffer' }).Sheets.test.A2.v, sourcePackage.version);

  assert.deepEqual(
    relativeFiles(path.join(packagedRoot, 'node_modules', 'xlsx')),
    ['LICENSE', 'dist/cpexcel.js', 'package.json', 'xlsx.js']
  );
  assert.deepEqual(
    relativeFiles(path.join(packagedRoot, 'tools', 'M2Reloader')),
    ['runtime/native-win-x64/M2Reloader.exe']
  );
  assert.deepEqual(
    relativeFiles(path.join(packagedRoot, 'media', 'vendor', 'tabulator')),
    ['LICENSE', 'VERSION', 'tabulator.min.js', 'tabulator_midnight.min.css']
  );
  for (const relative of [
    'media/csv-editor.html',
    'media/database-viewer.html',
    'media/table-editor.css',
    'media/table-editor-core.js',
    'media/table-editor.js',
    'out/utils/database-viewer-webview.js',
  ]) {
    assert.ok(fs.existsSync(path.join(packagedRoot, relative)), `Missing table grid runtime: ${relative}`);
  }
  for (const relative of [
    'out/utils/db-cache.js',
    'snippets/gom-snippets.code-snippets',
    'data/const.json',
    'tools/M2Reloader/runtime/net7.0-win-x64',
    'tools/M2Reloader/runtime/net8.0-win-x64',
    'tools/M2Reloader/M2Reloader.csproj',
    'tools/M2Reloader/Program.cs',
  ]) {
    assert.equal(fs.existsSync(path.join(packagedRoot, relative)), false, `${relative} must not be packaged`);
  }

  console.log(`Packaged runtime verification passed: ${packageCount} production packages, `
    + `Ctrl+F12 ${npcDialogModuleFiles.length}-file local closure, SQL.js, XLS, Tabulator, native M2.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  REQUIRED_NPC_DIALOG_DYNAMIC_ENTRY_FILES,
  REQUIRED_NPC_DIALOG_RUNTIME_FILES,
  verifyLocalModuleClosure,
  verifyRequiredPackagedFiles,
};
