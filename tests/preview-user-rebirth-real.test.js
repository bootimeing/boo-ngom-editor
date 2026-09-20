// Explicit opt-in real user data. Read-only parser/data-resolution acceptance,
// not a hydrated PAK, VS Code native-keyboard or game-client pixel claim.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { parse } = require('./preview-inputs-integration.test');
const { expectedOne } = require('./helpers/rebirth-preview-fixture');
const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { ScriptDataResolver } = require(path.join(runtime, 'out/utils/script-data-resolver'));
const { decodeTextFile } = require(path.join(runtime, 'out/utils/text'));
const server = process.env.BOO_REAL_REBIRTH_SERVER;
assert.ok(server, 'BOO_REAL_REBIRTH_SERVER must explicitly select a real server');
const engine = JSON.parse(fs.readFileSync(path.join(server, '.vscode/settings.json'), 'utf8'))['boo.engine'];
assert.equal(engine, 'GOM', 'named fixture has a verified GOM contract');
const file = path.join(server, 'Mir200/Envir/Market_Def/1大陆/主城/07转生系统-西岐.txt');
const table = path.join(server, 'Mir200/Envir/QuestDiary/03游戏名单/表格数据/转生系统.csv');
const digest = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
const original = [file, table].map(digest), resolver = new ScriptDataResolver();
try {
  const source = decodeTextFile(fs.readFileSync(file)).text;
  const options = { filePath: file, fileName: path.basename(file), uri: pathToFileURL(file).href, dataOptions: resolver.optionsFor(file, engine) };
  const texts = values => parse(source, values, engine, options).pages.flatMap(page => page.elements).map(e => e.text).filter(Boolean);
  const initial = texts({}), one = texts({ RELEVEL: '1' }), two = texts({ RELEVEL: '2' }), max = texts({ RELEVEL: '3' });
  expectedOne.forEach(expected => assert.ok(one.includes(expected), `expected ${expected}, actual ${JSON.stringify(one)}`));
  assert.ok(two.includes('2转　→　3转')); assert.ok(two.includes('金币需求：金币*20万'));
  assert.ok(max.includes('3转')); assert.ok(max.includes('对怪切割+150')); assert.ok(max.includes('等级需求：无法提升'));
  assert.ok(!one.some(value => value.includes('预览文字') || value.includes('<$')));
  assert.deepEqual(texts({}), initial, 'reset must restore original displayed defaults');
  assert.deepEqual(parse(source, { RELEVEL: '1' }, engine, options).previewInputs.map(i => i.name), ['RELEVEL'], 'reward/reload internal state must remain private');
  console.log(JSON.stringify({ file, table, sha256: original, engine, level1: one,
    sourceUnchanged: [file, table].map(digest).every((value, index) => value === original[index]),
    layer: 'read-only real script/CSV + production resolver/parser, not hydrated pixels' }, null, 2));
  console.log('preview-user-rebirth-real: PASS 0/1/2/3/reset and concrete values');
} finally {
  resolver.dispose(); assert.deepEqual([file, table].map(digest), original, 'real script and CSV must not change');
}
