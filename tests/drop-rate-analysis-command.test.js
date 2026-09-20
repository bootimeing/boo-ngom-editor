const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const manifest = require(path.join(runtime, 'package.json'));
let handler, engine = 'GEE', report, shown, message;
const uri = { scheme: 'file', fsPath: 'D:/fixture/MonItems/鸡.txt' };
let source = '#CHILD 1/2 RANDOM\n(\n1/4 木剑\n1/1 铁剑\n)';
const editor = { document: { uri, fileName: uri.fsPath, getText: () => source } };
const api = {
  commands: { registerCommand: (id, callback) => {
    assert.equal(id, 'boo.analyzeDropRates'); handler = callback;
    return { dispose() {} };
  } },
  ViewColumn: { Beside: 2 },
  window: {
    activeTextEditor: editor,
    showInformationMessage: text => { message = text; },
    showWarningMessage: text => { message = text; },
    showErrorMessage: text => { message = text; },
    showTextDocument: (doc, options) => { shown = { doc, options }; },
  },
  workspace: {
    getConfiguration: (section, scope) => {
      assert.equal(section, 'boo'); assert.equal(scope, uri);
      return { get: key => { assert.equal(key, 'engine'); return engine; } };
    },
    openTextDocument: options => { report = options; return options; },
  },
};
const originalLoad = Module._load;
Module._load = function (id, ...args) { return id === 'vscode' ? api : originalLoad.call(this, id, ...args); };
const { registerDropRateAnalysisCommand } = require(path.join(runtime, 'out/commands/drop-rate-analysis'));
Module._load = originalLoad;
(async () => {
  registerDropRateAnalysisCommand();
  assert.ok(manifest.activationEvents.includes('onCommand:boo.analyzeDropRates'));
  assert.ok(manifest.contributes.commands.some(c => c.command === 'boo.analyzeDropRates'));
  for (engine of ['GEE', 'GOM', '996PC']) {
    await handler();
    assert.equal(report.language, 'markdown');
    assert.ok(report.content.includes(engine === 'GEE' ? '1/16' : '1/4'));
    assert.equal(shown.doc, report);
    assert.equal(shown.options.viewColumn, 2);
  }
  source = '1/7 未保存的木剑';
  await handler();
  assert.ok(report.content.includes('未保存的木剑'), 'use buffer, not stale disk bytes');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-drop-command-'));
  try {
    const envir = path.join(temporary, 'Mir200', 'Envir');
    const diary = path.join(envir, 'QuestDiary');
    const monster = path.join(envir, 'MonItems', '白野猪.txt');
    const external = path.join(diary, '共用.txt');
    fs.mkdirSync(diary, { recursive: true });
    fs.mkdirSync(path.dirname(monster), { recursive: true });
    fs.writeFileSync(monster, '1/1 磁盘旧数据');
    fs.writeFileSync(external, '[@药水]\n{\n1/4 金创药\n1/8 魔法药\n}');
    const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const before = [digest(monster), digest(external)];
    editor.document.fileName = monster;
    uri.fsPath = monster;
    source = '#CHILD 1/2 RANDOM\n(\n1/1 木剑\n#CALL [\\共用.txt] @药水\n)';
    for (engine of ['GOM', 'GEE', '996PC']) {
      report = undefined;
      await handler();
      assert.ok(report.content.includes('金创药'));
      assert.ok(report.content.includes('魔法药'));
      assert.ok(report.content.includes(engine === 'GEE' ? '1/24' : '1/6'));
      assert.ok(report.content.includes('共用'));
      assert.ok(report.content.includes('调用链：'));
      assert.ok(!report.content.includes('磁盘旧数据'));
      assert.deepEqual([digest(monster), digest(external)], before);
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  for (engine of ['unknown', undefined]) {
    report = undefined; await handler();
    assert.equal(report, undefined); assert.match(message, /引擎/);
  }
  engine = 'GEE'; source = 'x'.repeat(1_000_001);
  await handler(); assert.match(message, /上限/);
  api.window.activeTextEditor = undefined;
  await handler(); assert.match(message, /先打开/);
  // No edit/save/applyEdit/writeFile APIs are exposed: an accidental write fails.
  console.log('drop-rate-analysis-command.test.js: PASS buffer, three-engine real-file CALL/report, guards and source hashes (host API substitute)');
})().catch(error => { console.error(error); process.exitCode = 1; });
