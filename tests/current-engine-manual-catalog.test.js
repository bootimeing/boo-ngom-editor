const assert = require('node:assert/strict');
const { loadAuditCatalog } = require('../tools/data-maintenance/runtime-audit-catalog');
const { commandParamsForArguments } = require('../out/utils/command-index');
const { activeStaticLanguageEntries } = require('../out/utils/static-language');
const { indexedTriggerEvidence, obviousQualityIssues } = require('../tools/data-maintenance/audit-engine-language-accuracy');

function checkCurrentManualCatalog() {
  const { commands, indexes, staticLanguage } = loadAuditCatalog();
  assert.equal(commands.totalTriggers, commands.triggers.length);
  const gom = indexes.GOM, gee = indexes.GEE, pc = indexes['996PC'];
  const get = (index, name) => {
    const command = index.commandByName.get(name);
    assert.ok(command, index.engine + ' ' + name);
    return command;
  };
  const parameter = (index, name, args, position) =>
    commandParamsForArguments(get(index, name), args.split(' ').map(text => ({ text })))[position - 1];
  assert.match(parameter(gom, 'CHECKRANGEHUMCOUNT', '3 330 330 3 > 2 1 1', 7), /1 排除，0 或省略包含/);
  assert.match(parameter(gom, 'CHECKRANGEHUMCOUNT', '3 330 330 3 > 2 1 1', 8), /排除管理员/);
  assert.match(parameter(gom, 'DELMAPEFFECT', '101 0 MAP 3', 3), /固定文字 MAP/);
  assert.match(parameter(gom, 'DELMAPEFFECT', '101 0 map 3', 4), /地图编号/);
  assert.match(parameter(gom, 'DELMAPEFFECT', '101 1', 2), /形象倒计时/);
  assert.equal(parameter(gom, 'DELMAPEFFECT', '3 330 331 0 0 10 1 50 0 0|0|1', 3), 'Y');
  assert.match(parameter(gom, 'SELECTBAGITEM', '@done ItemIdx 31|42 请选择', 3), /Idx列表/);
  assert.match(parameter(gom, 'SELECTBAGITEM', '@done ItemIdx=31|42 请选择', 3), /提示/);
  assert.match(parameter(gom, 'PLAYDICE', '1 @done 30 800 0', 4), /结果停留/);
  assert.match(parameter(gom, 'RECALLSELF', '30 1 100 0 0 0 0 0 2 200', 10), /人物攻击倍率/);
  assert.match(parameter(gom, 'DECODESECTIME', '125 S80 S81 1', 4), /HH:MM:SS/);
  assert.match(parameter(gom, 'SETITEMSTATE', '1 7 1', 2), /7死亡必爆/);
  assert.match(parameter(gee, 'SETITEMSTATE', '1 7 1', 2), /7禁止取下/);
  assert.equal(get(pc, 'MAKEPOSION').params.length, 3);
  assert.equal(get(gom, 'MAKEPOSION').params.length, 5);
  assert.match(parameter(gom, 'RANGEHARM', '0 0 3 0 0 0 0 0 0 0|0|0|0|0|2', 10), /飘血ID/);
  for (const name of ['CSVGETCELLTEXT', 'CHANGEHEARMSGCOLOR', 'DELMAPROUTE', 'CHECKMAPHUMANCOUNT']) {
    assert.equal(get(gom, name).fromCurrentManual, true);
    assert.ok(get(gom, name).source.evidenceLine > 0);
  }
  assert.equal(get(gom, 'DELGAMEPETMAGIC').kind, 'check');
  assert.equal(get(gom, 'CLEARGAMEPETMAGIC').kind, 'action');
  assert.equal(get(gom, 'M.PREVIEWMONDROPITEMREFRESH').params.length, 2);
  assert.equal(get(gee, 'HTTPGET').params.length, 3);
  assert.equal(get(gee, 'H.STOPITEMDROP').params.length, 0);
  assert.match(get(pc, 'SETSELLCHAR').params[0], /0或省略禁止/);
  assert.equal(get(pc, 'ADDBUTTONEX').completionVerified, false);
  assert.match(get(pc, 'ADDBUTTONEX').params[0], /触发序号.+X坐标.+Y坐标/);
  assert.match(get(pc, 'ADDBUTTONEX').params[8], /创建在哪个界面/);
  assert.match(get(pc, 'GIVE').params[1], /物品数量或金币数/);
  assert.match(get(pc, 'H.GIVE').params[0], /发给英雄的物品名称/);
  assert.equal(get(pc, 'GIVE').minArgs, 1);
  assert.equal(get(pc, 'CHECKINMAPRANGE').completionVerified, false);
  assert.equal(get(gom, 'DUMMYPLAYERDATA').completionEnabled, false);
  assert.match(parameter(gom, 'DUMMYPLAYERDATA', 'STATUS 假人 S1 N1 S2', 3), /接收状态/);
  assert.equal(get(pc, 'SETONTIMERMS').snippet, 'SetOnTimerMS ${1:0} ${2:300}');
  assert.match(get(pc, 'SETONTIMERMS').params[2], /执行次数/);
  assert.equal(get(gom, 'DELNAMEDATELIST').kind, 'action');
  assert.match(get(gom, 'CHECKHUMBAG').params[2], /0～2147483647/);
  assert.match(parameter(gom, 'ADDNEWCUSTOMITEMABIL', '1 N80', 2), /保存找到的属性位置/);
  assert.match(parameter(gom, 'ADDNEWCUSTOMITEMABIL', '1 35 N80', 2), /模板编号/);
  assert.match(gom.constantByName.get('JOB').description, /职业编号/);
  assert(gom.variableByName.has('U0-U599'));
  assert(!gom.variableByName.has('U0-U499'));
  assert(gee.variableByName.has('U0-U499'));
  assert(!gom.variableByName.has('GETNGEXP'));
  assert(!gom.constantByName.has('GETNGEXP'));
  assert.match(gom.variableByName.get('MOUSEX').desc, /技能前触发/);
  assert.match(gom.constantByName.get('JEWELRYITEM3').source.page, /DB数据库资料/);
  for (const [index, triggers, constants] of [
    [gom, ['FINDPATHBEGIN','HERONEXTDIE','BACKPACKRECOVERY'], ['FLAG','CUSTJOBABIL','DROPFINALNAME']],
    [gee, ['FJATTACK','HUMDROPBAGITEM','USERQUERYHEROSTATE'], []],
    [pc, ['ONTIMERMS9','HEROCHECKDROPUSEITEMS','BACKPACKRECOVERYEX'], ['GETSORTSTRRANK','SCRIPTPARAM5','STONEUPGRADE.NAME']],
  ]) {
    for (const key of triggers) assert.ok(index.triggerByName.get(key)?.source.page, key);
    for (const key of constants) assert.ok(index.constantByName.get(key)?.source.page, key);
  }
  assert(!gom.triggerByName.has('ONTIMERMS9'));
  assert(!gee.constantByName.has('CUSTJOBABIL'));
  const maps = activeStaticLanguageEntries(staticLanguage.mapInfoParams, 'GOM');
  for (const key of ['TIMEMAP','INCGOLD','DECGOLD','NOTSTONE']) assert(maps.some(row => row.label === key));
  assert.equal(maps.filter(row => row.label.startsWith('SECRET(')).length, 1);
  const pcMaps = activeStaticLanguageEntries(staticLanguage.mapInfoParams, '996PC');
  for (const key of ['CAMP','FIGHT5']) assert(pcMaps.some(row => row.label === key && row.snippet === key));
  const timerPage = { text: '@OnTimerMS索引号\nSETONTIMERMS 定时器索引(0-9)', lines: [] };
  assert(indexedTriggerEvidence('OnTimerMS9', timerPage));
  assert(!indexedTriggerEvidence('OnTimerMS10', timerPage));
  const give = get(pc, 'GIVE');
  assert(!obviousQualityIssues(give, '996PC').includes('argument-range-does-not-match-params'));
  assert(obviousQualityIssues({ ...give, maxArgs: 3 }, '996PC').includes('argument-range-does-not-match-params'));
}
module.exports = { checkCurrentManualCatalog };
if (require.main === module) checkCurrentManualCatalog();
