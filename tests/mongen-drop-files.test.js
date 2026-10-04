const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { decodeTextFile } = require('../out/utils/text');
const {
  isMonGenDocumentPath, safeMonsterDropFileName, resolveMonsterDropFileTarget,
  isMonsterDropFileTargetSafe, createMonsterDropFileResolver,
  buildMonGenDropFilePlan, createMissingMonGenDropFiles,
} = require('../out/utils/mongen-drop-files');

const row = name => `3 100 200 ${name} 10 G1 60 0 255 *`;
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-mongen-drop-files-'));
const server = (name, text = '') => {
  const envir = path.join(fixtureRoot, name, 'Mir200', 'Envir');
  fs.mkdirSync(envir, { recursive: true });
  const file = path.join(envir, 'MonGen.txt');
  fs.writeFileSync(file, iconv.encode(text, 'gbk'));
  return { envir, file, monItems: path.join(envir, 'MonItems') };
};

try {
  assert.equal(isMonGenDocumentPath('D:/MirServer/Mir200/Envir/MONGEN.TXT'), true);
  assert.equal(isMonGenDocumentPath('D:/MirServer/Mir200/Envir/myMonGen.txt'), false);
  for (const name of ['白野猪', 'Boss_01', '祖玛教主[BOSS]', '金币怪(大)', 'abc.txt']) {
    assert.equal(safeMonsterDropFileName(name), name);
  }
  for (const name of ['', '.', '..', '../怪物', '..\\怪物', 'A/B', 'A:B', 'A*B', 'A?B', 'A"B',
    'A<B', 'A>B', 'A|B', 'A\0B', 'A\nB', '怪物.', ' 怪物', '怪物 ', 'CON', 'con.txt', 'PRN',
    'AUX', 'NUL', 'COM1', 'LPT9', 'COM¹', 'CLOCK$', '<$STR(S0)>', 'S$动态怪物', '$MONNAME', 'a'.repeat(252)]) {
    assert.equal(safeMonsterDropFileName(name), undefined, `unsafe/nonliteral ${JSON.stringify(name)}`);
  }

  const text = [
    '\uFEFF;地图 X Y 怪物 范围 数量 时间', '//注释', '',
    row('白野猪'), row('白野猪'), row('Boss'), row('bOSS'), row('黑野猪'),
    '3 坏坐标 200 畸形 10 1', '3 100 200 缺字段 10',
    row('../逃逸'), row('CON'), row('<$STR(S0)>'), row('S$怪物'),
  ].join('\r\n');
  const a = server('server-A', text), b = server('server-B', row('另一服怪物'));
  fs.mkdirSync(a.monItems);
  const existingBytes = iconv.encode(';保留原爆率\r\n1/100 元宝 1\r\n', 'gbk');
  const existing = path.join(a.monItems, 'bOSS.TXT');
  fs.writeFileSync(existing, existingBytes);
  const sourceBytes = fs.readFileSync(a.file);
  const plan = buildMonGenDropFilePlan(a.file, decodeTextFile(sourceBytes).text);
  assert.deepEqual(plan.targets.map(target => target.monsterName), ['白野猪', 'Boss', '黑野猪']);
  assert.equal(plan.duplicateCount, 2);
  assert.equal(plan.ignored.length, 4);
  assert.equal(plan.targets[1].existingPath, existing, 'existing file matching is case-insensitive');
  assert.equal(fs.readdirSync(a.monItems).length, 1, 'planning has no creation side effects');
  assert.equal(fs.existsSync(b.monItems), false, 'other server remains untouched');
  const result = createMissingMonGenDropFiles(plan);
  assert.deepEqual(result.created.map(file => path.basename(file)), ['白野猪.txt', '黑野猪.txt']);
  assert.deepEqual(result.existing, [existing]);
  assert.deepEqual(result.failed, []);
  for (const file of result.created) {
    const bytes = fs.readFileSync(file);
    assert.equal(bytes.length, 0, 'empty file has no BOM or invented drop template');
    assert.equal(iconv.decode(bytes, 'gbk'), '', 'new empty bytes are GBK-compatible');
  }
  assert.deepEqual(fs.readFileSync(existing), existingBytes);
  assert.deepEqual(fs.readFileSync(a.file), sourceBytes, 'MonGen source is never written');
  assert.equal(fs.existsSync(b.monItems), false);
  const again = createMissingMonGenDropFiles(plan);
  assert.deepEqual(again.created, []);
  assert.equal(again.existing.length, 3);
  assert.deepEqual(again.failed, []);
  assert.equal(resolveMonsterDropFileTarget(b.file, '白野猪').directoryPath, b.monItems);
  assert.equal(isMonsterDropFileTargetSafe(a.file, '白野猪', path.join(b.monItems, '白野猪.txt')), false);
  assert.equal(isMonsterDropFileTargetSafe(a.file, '白野猪', path.join(a.monItems, '白野猪.txt')), true);

  const nested = path.join(a.envir, 'QuestDiary', 'MonGen.txt');
  fs.mkdirSync(path.dirname(nested)); fs.writeFileSync(nested, row('不能创建'));
  assert.equal(resolveMonsterDropFileTarget(nested, '不能创建'), undefined, 'only the direct Envir configuration is eligible');
  assert.throws(() => buildMonGenDropFilePlan(nested, row('不能创建')), /只能/);
  assert.equal(resolveMonsterDropFileTarget(path.join(fixtureRoot, 'MonGen.txt'), '不能创建'), undefined);
  assert.equal(resolveMonsterDropFileTarget(a.file, '../逃逸'), undefined);
  assert.equal(resolveMonsterDropFileTarget(a.file, 'CON'), undefined);

  const empty = server('empty', ';没有有效行\n3 x 1 畸形 1 1');
  const emptyPlan = buildMonGenDropFilePlan(empty.file, ';没有有效行\n3 x 1 畸形 1 1');
  assert.equal(emptyPlan.targets.length, 0);
  assert.deepEqual(createMissingMonGenDropFiles(emptyPlan), { created: [], existing: [], failed: [] });
  assert.equal(fs.existsSync(empty.monItems), false, 'an empty plan must not create a directory');

  const many = server('enumeration', Array.from({ length: 500 }, (_, index) => row(`怪物${index}`)).join('\n'));
  fs.mkdirSync(many.monItems);
  const originalReadDirectory = fs.readdirSync;
  let enumerationCount = 0;
  fs.readdirSync = function (...args) { enumerationCount++; return originalReadDirectory.apply(this, args); };
  try {
    const resolver = createMonsterDropFileResolver(many.file);
    assert.equal(typeof resolver, 'function');
    for (let index = 0; index < 5387; index++) {
      assert.ok(resolver(`怪物${index % 500}`));
      assert.equal(resolver('../逃逸'), undefined);
    }
    assert.equal(enumerationCount, 2, '5387 link lookups take one Envir and one MonItems directory snapshot');
    enumerationCount = 0;
    const manyPlan = buildMonGenDropFilePlan(many.file, decodeTextFile(fs.readFileSync(many.file)).text);
    assert.equal(enumerationCount, 2);
    enumerationCount = 0;
    const manyResult = createMissingMonGenDropFiles(manyPlan);
    assert.equal(manyResult.created.length, 500);
    assert.equal(manyResult.failed.length, 0);
    assert.equal(enumerationCount, 2, 'batch creation does not enumerate the growing directory per target');
  } finally { fs.readdirSync = originalReadDirectory; }

  const race = server('exclusive', row('竞争怪物'));
  const racePlan = buildMonGenDropFilePlan(race.file, row('竞争怪物'));
  const originalWrite = fs.writeFileSync;
  let exclusiveAttempted = false;
  fs.writeFileSync = function (file, data, options) {
    if (path.basename(String(file)) === '竞争怪物.txt' && options?.flag === 'wx') {
      exclusiveAttempted = true;
      originalWrite(file, existingBytes);
    }
    return originalWrite.call(this, file, data, options);
  };
  try {
    const raceResult = createMissingMonGenDropFiles(racePlan);
    assert.equal(exclusiveAttempted, true);
    assert.deepEqual(raceResult.created, []);
    assert.equal(raceResult.existing.length, 1);
    assert.deepEqual(raceResult.failed, []);
    assert.deepEqual(fs.readFileSync(path.join(race.monItems, '竞争怪物.txt')), existingBytes, 'wx preserves a racing creator byte-for-byte');
  } finally { fs.writeFileSync = originalWrite; }

  const directoryRace = server('directory-race', row('目录竞争'));
  const directoryRacePlan = buildMonGenDropFilePlan(directoryRace.file, row('目录竞争'));
  fs.writeFileSync = function (file, data, options) {
    if (path.basename(String(file)) === '目录竞争.txt' && options?.flag === 'wx') fs.mkdirSync(file);
    return originalWrite.call(this, file, data, options);
  };
  try {
    const directoryRaceResult = createMissingMonGenDropFiles(directoryRacePlan);
    assert.deepEqual(directoryRaceResult.created, []);
    assert.deepEqual(directoryRaceResult.existing, [], 'an EEXIST directory is not a successfully skipped drop-rate file');
    assert.equal(directoryRaceResult.failed.length, 1);
    assert.match(directoryRaceResult.failed[0].message, /不是安全普通文件/);
  } finally { fs.writeFileSync = originalWrite; }

  const partial = server('partial', `${row('失败怪物')}\n${row('成功怪物')}`);
  const partialPlan = buildMonGenDropFilePlan(partial.file, `${row('失败怪物')}\n${row('成功怪物')}`);
  fs.writeFileSync = function (file, data, options) {
    if (path.basename(String(file)) === '失败怪物.txt') throw Object.assign(new Error('test permission denied'), { code: 'EACCES' });
    return originalWrite.call(this, file, data, options);
  };
  try {
    const partialResult = createMissingMonGenDropFiles(partialPlan);
    assert.equal(partialResult.failed.length, 1);
    assert.equal(partialResult.failed[0].monsterName, '失败怪物');
    assert.match(partialResult.failed[0].message, /permission denied/);
    assert.deepEqual(partialResult.created.map(file => path.basename(file)), ['成功怪物.txt']);
  } finally { fs.writeFileSync = originalWrite; }

  const linked = server('junction');
  const outside = path.join(fixtureRoot, 'outside-monitems'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, linked.monItems, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(resolveMonsterDropFileTarget(linked.file, '拒绝怪物'), undefined);
  assert.throws(() => buildMonGenDropFilePlan(linked.file, row('拒绝怪物')), /安全/);
  assert.deepEqual(fs.readdirSync(outside), [], 'a MonItems junction outside Envir never grants a creation target');

  const switched = server('confirmation-switch');
  const switchedPlan = buildMonGenDropFilePlan(switched.file, row('拒绝怪物'));
  fs.symlinkSync(outside, switched.monItems, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => createMissingMonGenDropFiles(switchedPlan), /已变化/);
  assert.deepEqual(fs.readdirSync(outside), [], 'post-confirmation target discovery must be revalidated');

  const manifest = require('../package.json');
  assert.equal(manifest.contributes.commands.filter(command => command.command === 'boo.createMonGenDropFiles').length, 1);
  const key = manifest.contributes.keybindings.find(binding => binding.command === 'boo.createMonGenDropFiles');
  assert.equal(key.key, 'alt+r');
  assert.equal(key.when, 'editorTextFocus && resourceScheme == file && resourceFilename =~ /^mongen\\.txt$/i');
  console.log('mongen-drop-files.test.js: PASS parser/GBK/case dedup/current-Envir/non-mutating plan/empty/unsafe names/junction/exclusive race/partial errors/5387 lookup+500 create O(1) enumeration/Alt+R scope');
} finally { removeTemporaryDirectory(fixtureRoot); }
