const assert = require('node:assert/strict');

// Independent, reviewed test oracle; do not import the catalog-writing script here.
// Source: D:\0帮助\新GameOfMir引擎使用说明书.chm
// SHA-256: A31BB73228D738D0B06A914697C3CD4BFECDE32DDA9214CA95F92FE62BF2501B
// Rechecked 2026-09-08 against the 12 cited body lines in the extracted GOM corpus.
// The revision is a local review date, not an engine release date. The source CHM
// is partially extractable; these readable pages do not establish whole-CHM coverage.
const revision = '2026-09-05';
const reviewed = new Map([
  ['CHECKMAINHITTARGET', ['check', [], '脚本检测命令/范围物理攻击主目标检测.htm', 6]],
  ['CHECKCHANGEMODEEX', ['check', ['模式编号'], '脚本检测命令/检测对象状态.html', 45]],
  ['CHECKGAMEVALIDATE', ['check', [], '功能操作命令/显示验证码窗口.html', 33]],
  ['GETGAMEVALIDATEINFO', ['action', ['状态变量', '剩余秒变量', '错误变量', '换题变量', '原因变量', '[来源变量]', '[优先级变量]'], '功能操作命令/显示验证码窗口.html', 61, 5]],
  ['SETIGNORETARGETDEFENSE', ['action', ['值类型(0百分比/1固定值)', '值', '时间(秒/0在线有效)'], '功能操作命令/忽视目标防御.htm', 4]],
  ['SETPICKITEMRULEBINDIGNORE', ['action', ['开关(0关闭/1开启)'], '功能操作命令/无视拾取绑定规则.htm', 4]],
  ['PLAYEFFECTEX', ['action', ['WIL文件序号', '开始图片数', '播放图片张数', '播放次数(<=0永久)', '播放速度(毫秒)', '播放顺序(0前面/1后面/2所有图层上方)', '[X偏移]', '[Y偏移]', '[普通播放或特效播放]'], '功能操作命令/播放人物效果PLAYEFFECT.htm', 9, 6]],
  ['STOPPLAYEFFECT', ['action', ['WIL文件序号', '开始图片数', '播放图片张数', '播放次数', '播放速度(毫秒)', '[播放顺序(0前面/1后面/2所有图层上方)]'], '功能操作命令/播放人物效果PLAYEFFECT.htm', 20, 5]],
  ['CLEARGUILD', ['action', ['模式(0指定行会/1按人数)', '行会名称或人数'], '功能操作命令/行会清理命令.html', 13]],
  ['SETITEMHINTIMAGE', ['action', ['装备位置', '图片索引(0-65535)'], '功能操作命令/物品悬浮框背景图命令.html', 5]],
  ['CHECKGROUPITEM', ['check', null, '功能操作命令/锁定属性刷新.htm', 163]],
  ['GIVEONITEM', ['action', null, '功能操作命令/锁定属性刷新.htm', 250]],
]);

function assertReviewedEntry(engine, name, entry, indexed = false) {
  const key = name.toUpperCase();
  const expected = reviewed.get(key);
  const label = `${engine}.${name} reviewed help`;
  assert.equal(engine, 'GOM', `${label} must not borrow GOM evidence`);
  assert.ok(expected, `${label} is not in the reviewed delta`);
  const [kind, params, page, evidenceLine, minArgs] = expected;
  assert.equal(entry.name.toUpperCase(), key, `${label} name`);
  assert.deepEqual(entry.source, {
    revision,
    page: `游戏引擎反外挂系统/${page}`,
    evidenceLine,
    title: page.split('/').pop().replace(/\.html?$/, ''),
  }, `${label} source`);
  assert.equal(entry.kind, kind, `${label} kind`);
  assert.deepEqual(entry.contexts, [kind === 'check' ? 'IF' : 'ACT'], `${label} context`);
  assert.deepEqual(entry.aliases, [], `${label} aliases must be separately reviewed`);
  assert.equal(entry.syntax, [key, ...(params || [])].join(' '), `${label} syntax`);
  assert.deepEqual(indexed ? entry.params : entry.paramList, params || [], `${label} parameters`);
  assert.equal(entry.minArgs, params === null ? undefined : (minArgs ?? params.length), `${label} minArgs`);
  assert.equal(entry.maxArgs, params === null ? undefined : params.length, `${label} maxArgs`);
  assert.equal(entry.completionEnabled, params !== null, `${label} completionEnabled`);
  assert.equal(entry.completionVerified, params !== null, `${label} completionVerified`);
  if (indexed) {
    assert.deepEqual(entry.engines, ['GOM'], `${label} engine isolation`);
    assert.equal(entry.origin, 'engine', `${label} origin`);
    assert.ok(entry.description, `${label} description`);
  } else {
    assert.equal(entry.params, (params || []).join(' '), `${label} parameter text`);
    assert.equal(entry.diagnosticSupported, true, `${label} diagnosticSupported`);
    assert.equal(entry.completionReview, params === null
      ? '20260905-own-help-name-only' : '20260905-own-help-manual-exact', `${label} review method`);
    assert.ok(entry.details, `${label} details`);
  }
}

function assertCatalogRevision(engine, name, entry) {
  assert.ok(entry.source, `${engine}.${name} engine function needs help evidence`);
  if (entry.source.revision === revision || (engine === 'GOM' && reviewed.has(name.toUpperCase()))) {
    assertReviewedEntry(engine, name, entry);
    return;
  }
  assert.ok(['2026-07-19', '2026-07-23', '2026-07-26'].includes(entry.source.revision),
    `${engine}.${name} has an unexpected help revision`);
}

function assertReviewedCatalog(engine, catalog) {
  for (const [name, entry] of Object.entries(catalog)) assertCatalogRevision(engine, name, entry);
  if (engine === 'GOM') {
    const currentNames = Object.keys(catalog).filter(name => catalog[name].source?.revision === revision);
    assert.deepEqual(currentNames.map(name => name.toUpperCase()).sort(), [...reviewed.keys()].sort(),
      'GOM reviewed delta must contain exactly the 12 approved additions');
  }
}

function baselineRuntimeEntries(engine, category, runtimeEntries) {
  // Keep the immutable July evidence ledger honest, and validate September's
  // precise additions independently before removing them for baseline comparison.
  if (engine !== 'GOM' || !['detectionCommands', 'executionCommands'].includes(category)) return runtimeEntries;
  const deltaKind = category === 'detectionCommands' ? 'check' : 'action';
  const expectedNames = [...reviewed].filter(([, [kind]]) => kind === deltaKind).map(([name]) => name).sort();
  const delta = runtimeEntries.filter(entry => reviewed.has(entry.name.toUpperCase()));
  assert.deepEqual(delta.map(entry => entry.name.toUpperCase()).sort(), expectedNames,
    `${engine}.${category} must contain its exact reviewed delta`);
  for (const entry of delta) assertReviewedEntry(engine, entry.name, entry, true);
  return runtimeEntries.filter(entry => !reviewed.has(entry.name.toUpperCase()));
}

module.exports = { revision, reviewed, assertCatalogRevision, assertReviewedCatalog, baselineRuntimeEntries };
