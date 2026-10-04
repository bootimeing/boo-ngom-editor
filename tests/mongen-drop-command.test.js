const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { pathToFileURL } = require('node:url');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const runtime = path.resolve(process.env.BOO_SCRIPT_RUNTIME_ROOT || path.join(__dirname, '..'));
let cases = 0;
async function test(name, body) { await body(); cases++; console.log(`mongen-drop-command: PASS - ${name}`); }
function uri(file) { return { scheme: 'file', fsPath: path.resolve(file), toString() { return pathToFileURL(this.fsPath).href; } }; }
function document(file, initialText) {
  let text = initialText;
  return { uri: uri(file), version: 1, fileName: file, getText() { return text; },
    replace(value) { text = value; this.version++; } };
}
function extractMissingFileCallback(vscode) {
  // Evaluate the exact compiled registration callback, rather than duplicating
  // its create/confirm control flow or activating every unrelated assistant API.
  const compiledPath = path.join(runtime, 'out/assistant.js');
  const source = ts.createSourceFile(compiledPath, fs.readFileSync(compiledPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'registerCommand'
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'boo.createMissingFile') callback = node.arguments[1];
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(callback, 'production createMissingFile registration not found');
  const globals = { path, fs, vscode, pendingMissingFileCreations: new Map() };
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      let specifier;
      function findRequire(node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'
          && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
        ts.forEachChild(node, findRequire);
      }
      findRequire(declaration.initializer);
      if (['./utils/path', './utils/map-entities', './utils/mongen-drop-files', './utils/merchant-script'].includes(specifier)) {
        globals[declaration.name.text] = require(path.join(runtime, 'out', specifier));
      }
    }
  }
  return vm.runInNewContext(`(${callback.getText(source)})`, globals, { filename: compiledPath });
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-mongen-command-'));
  const warnings = [], errors = [], infos = [], status = [], opened = [], commands = new Map();
  let confirm = async () => undefined;
  const vscode = {
    Uri: { file: uri },
    commands: { registerCommand(name, callback) { commands.set(name, callback); return { dispose() {} }; } },
    workspace: {
      textDocuments: [], workspaceFolders: [{ uri: uri(temporary) }],
      getWorkspaceFolder() { return { uri: uri(temporary) }; },
      async openTextDocument(target) {
        const openedDoc = document(target.fsPath, fs.readFileSync(target.fsPath, 'utf8'));
        this.textDocuments.push(openedDoc); opened.push(target.fsPath); return openedDoc;
      },
    },
    window: {
      activeTextEditor: undefined,
      showWarningMessage(...args) { warnings.push(args); return confirm(...args); },
      showErrorMessage(value) { errors.push(value); },
      showInformationMessage(value) { infos.push(value); },
      async showTextDocument() {},
      setStatusBarMessage(value) { status.push(value); },
    },
  };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { registerMonGenDropFileCommand } = require(path.join(runtime, 'out/commands/mongen-drop-files'));
    registerMonGenDropFileCommand({ subscriptions: [] });
    const bulk = commands.get('boo.createMonGenDropFiles');
    const single = extractMissingFileCallback(vscode);
    function fixture(name, monsters) {
      const envir = path.join(temporary, name, 'Mir200', 'Envir'); fs.mkdirSync(envir, { recursive: true });
      const file = path.join(envir, 'MonGen.txt');
      const text = monsters.map(monster => `0 10 20 ${monster} 0 1 60`).join('\r\n');
      fs.writeFileSync(file, 'disk contents remain unchanged');
      const doc = document(file, text); vscode.workspace.textDocuments.push(doc);
      vscode.window.activeTextEditor = { document: doc };
      return { doc, envir, drops: path.join(envir, 'MonItems'), bytes: fs.readFileSync(file) };
    }
    await test('Alt+R only plans and cancellation creates no folders or files', async () => {
      const current = fixture('cancel', ['白野猪', '白野猪', '黑野猪']); confirm = async () => undefined;
      await bulk();
      assert.match(warnings.at(-1)[0], /缺少 2 个/);
      assert.equal(fs.existsSync(current.drops), false);
      assert.deepEqual(fs.readFileSync(current.doc.fileName), current.bytes);
    });
    await test('confirmed Alt+R uses dirty text, deduplicates, preserves existing files and source bytes', async () => {
      const current = fixture('confirm', ['白野猪', '白野猪', '保留怪']);
      fs.mkdirSync(current.drops); const preserved = path.join(current.drops, '保留怪.txt');
      fs.writeFileSync(preserved, '1/100 原爆率'); confirm = async () => '创建文本';
      await bulk();
      assert.equal(fs.statSync(path.join(current.drops, '白野猪.txt')).size, 0);
      assert.equal(fs.readFileSync(preserved, 'utf8'), '1/100 原爆率');
      assert.deepEqual(fs.readFileSync(current.doc.fileName), current.bytes);
      assert.match(status.at(-1), /创建 1 个，保留 1 个/);
    });
    await test('bulk confirmation rejects edited or switched source and does not reuse stale plans', async () => {
      const current = fixture('modified', ['旧怪物']);
      confirm = async () => { current.doc.replace('0 10 20 新怪物 0 1 60'); return '创建文本'; };
      await bulk(); assert.equal(fs.existsSync(current.drops), false);
      assert.match(warnings.at(-1)[0], /已变化/);
      const switched = fixture('switched', ['切换前']);
      confirm = async () => { vscode.window.activeTextEditor = { document: current.doc }; return '创建文本'; };
      await bulk(); assert.equal(fs.existsSync(switched.drops), false);
    });
    await test('repeated Alt+R while a modal is pending is coalesced', async () => {
      const current = fixture('pending', ['唯一怪']);
      let release, modalCount = 0;
      confirm = () => { modalCount++; return new Promise(resolve => { release = resolve; }); };
      const pending = bulk(); await bulk(); assert.equal(modalCount, 1);
      release(undefined); await pending; assert.equal(fs.existsSync(current.drops), false);
    });
    await test('all-existing or invalid source shortcuts do not offer a creation modal', async () => {
      const before = warnings.length;
      const current = fixture('already', ['已有怪']); fs.mkdirSync(current.drops);
      fs.writeFileSync(path.join(current.drops, '已有怪.txt'), 'preserve');
      await bulk(); assert.equal(warnings.length, before); assert.match(infos.at(-1), /已齐全/);
      const foreign = fixture('nested-source', ['无效怪']);
      foreign.doc.uri = uri(path.join(foreign.envir, 'QuestDiary', 'MonGen.txt'));
      await bulk(); assert.equal(fs.existsSync(foreign.drops), false); assert.match(errors.at(-1), /安全 Envir/);
    });
    await test('single missing-file click prompts once and creates exactly the selected monster file', async () => {
      const current = fixture('single', ['只建此怪', '不建此怪']); confirm = async () => '创建文本';
      const result = await single(current.doc.uri, '只建此怪', 'monGen', 1);
      assert.equal(result.fsPath, path.join(current.drops, '只建此怪.txt'));
      assert.equal(fs.statSync(result.fsPath).size, 0);
      assert.equal(fs.existsSync(path.join(current.drops, '不建此怪.txt')), false);
      assert.deepEqual(fs.readFileSync(current.doc.fileName), current.bytes);
    });
    await test('single stale line, changed dirty version and cancellation never create a target', async () => {
      const current = fixture('single-stale', ['原怪物']);
      const before = warnings.length;
      await single(current.doc.uri, '其他怪物', 'monGen', 1);
      assert.equal(warnings.length, before); assert.equal(fs.existsSync(current.drops), false);
      confirm = async () => { current.doc.replace('0 10 20 新怪物 0 1 60'); return '创建文本'; };
      await single(current.doc.uri, '原怪物', 'monGen', 1); assert.equal(fs.existsSync(current.drops), false);
      confirm = async () => undefined;
      await single(current.doc.uri, '新怪物', 'monGen', 1); assert.equal(fs.existsSync(current.drops), false);
    });
    await test('single EEXIST race preserves the winning file and refuses directory or escaped targets', async () => {
      const current = fixture('single-race', ['并发怪']); confirm = async () => '创建文本';
      const write = fs.writeFileSync;
      fs.writeFileSync = function(file, content, options) {
        if (path.basename(file) === '并发怪.txt' && options?.flag === 'wx') {
          write.call(this, file, '并发原内容'); const error = new Error('exists'); error.code = 'EEXIST'; throw error;
        }
        return write.call(this, file, content, options);
      };
      try { await single(current.doc.uri, '并发怪', 'monGen', 1); }
      finally { fs.writeFileSync = write; }
      assert.equal(fs.readFileSync(path.join(current.drops, '并发怪.txt'), 'utf8'), '并发原内容');
      const dir = fixture('single-directory-race', ['目录怪']); const openedBefore = opened.length;
      fs.writeFileSync = function(file, content, options) {
        if (path.basename(file) === '目录怪.txt' && options?.flag === 'wx') {
          fs.mkdirSync(file); const error = new Error('exists'); error.code = 'EEXIST'; throw error;
        }
        return write.call(this, file, content, options);
      };
      try { await single(dir.doc.uri, '目录怪', 'monGen', 1); }
      finally { fs.writeFileSync = write; }
      assert.equal(opened.length, openedBefore); assert.match(errors.at(-1), /路径已变化/);
    });
    console.log(`mongen-drop-command.test.js: PASS (${cases} command behavior cases)`);
  } finally {
    Module._load = originalLoad; removeTemporaryDirectory(temporary);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
