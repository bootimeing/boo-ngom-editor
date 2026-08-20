const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  scanServerLanguage,
} = require('../tools/data-maintenance/audit-server-language-compatibility');

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-server-language-'));
  const envir = path.join(root, 'Mir200', 'Envir');
  fs.mkdirSync(envir, { recursive: true });
  const script = path.join(envir, 'QFunction-0.txt');
  fs.writeFileSync(script, [
    '[@ConfirmDearRecall]',
    '[@Login]',
    '[@QueryMyShopFail]',
    'AddMaxWeight + 100',
    'CLOSEMERCHANTBIGDLG',
    'SENDMSG 6 <$MAPNAME> <$CASTLEWARDATE>',
  ].join('\r\n'));

  const helpOnly = scanServerLanguage(root, '996PC');
  assert.equal(helpOnly.mismatchKinds, 3);
  assert.equal(helpOnly.engine, '996PC');
  assert.equal(helpOnly.triggerDefinitions, 3);
  assert.equal(helpOnly.triggerCompatibility, 'not-diagnosed-custom-label-ambiguous');
  assert.deepEqual(Object.keys(helpOnly.commandMismatches), ['CLOSEMERCHANTBIGDLG']);
  assert.deepEqual(Object.keys(helpOnly.symbolMismatches), ['MAPNAME', 'CASTLEWARDATE']);

  fs.appendFileSync(script, '\r\nFLYINGSWORDSET 1');
  const mismatch = scanServerLanguage(root, '996PC');
  assert.deepEqual(
    Object.keys(mismatch.commandMismatches),
    ['CLOSEMERCHANTBIGDLG', 'FLYINGSWORDSET']
  );
  assert.equal(mismatch.mismatchKinds, 4);

  const gomRoot = path.join(root, 'gom');
  const gomEnvir = path.join(gomRoot, 'Mir200', 'Envir');
  fs.mkdirSync(gomEnvir, { recursive: true });
  fs.writeFileSync(path.join(gomEnvir, 'QFunction-0.txt'), [
    '#IF',
    'CHECKMIRRORMAP test',
    'CHECKMYSHOP',
    '#ACT',
    'MOBFIREBURN 3 342 342 5 60 50 1',
    'RENEWLEVEL 1 0 0',
    'DELCONFIGFILESECTION ..\\data.txt section',
    'DELMIRRORMAP test',
    'ADDMIRRORMAP 0 test 测试 60 3 101',
    'GETRANDOMTEXT ..\\data.txt S$结果',
    'SETUPGRADEITEM 0',
    'PLAYDICE 1 @结果',
    'RETURNBOXITEM 1',
    'DELBOXITEM 1 1',
    'PARAM1 1',
    'PARAM2 2',
    'PARAM3 3',
    'PARAM4 4',
    'GETALLDBITEMFIELDVALUE 攻击 N$结果',
    'SETSKILLDECCD 烈火剑法 = 1',
    'DELLINKITEM 1',
    'HCALL 玩家 @刷新',
    'STOPCOLLECT',
    'ADDATTACKSABUKALL 0',
    'MOV S$装备 <$SRIGHTHAND><$SNECKLACE><$SHELMET><$SBELT><$SBOOTS><$SCHARM>',
    'MOV S$神佑 <$GODBLESSITEM2><$GODBLESSITEM12>',
    'MOV S$首饰 <$JEWELRYITEM2><$JEWELRYITEM6>',
    'MOV S$参数 <$SCRIPTPARAM1><$SCRIPTPARAM3>',
    'MOV S$商店 <$BUYITEMMONEYTYPENAME><$BUYITEPRICE>',
    'MOV S$其他 <$CURRRSLAVENAME><$USEITEMMAKEINDEX><$USEITEMNAME><$CURRTAKETEMPOS>',
  ].join('\r\n'));
  const gomCompatibility = scanServerLanguage(gomRoot, 'GOM');
  assert.equal(
    gomCompatibility.mismatchKinds,
    0,
    `GOM compatibility false positives: ${JSON.stringify(gomCompatibility)}`
  );

  const geeRoot = path.join(root, 'gee');
  const geeEnvir = path.join(geeRoot, 'Mir200', 'Envir');
  fs.mkdirSync(geeEnvir, { recursive: true });
  fs.writeFileSync(path.join(geeEnvir, 'QFunction-0.txt'), [
    '#IF',
    'CHECKTITLE 狂暴治理',
    '#ACT',
    'MOV S$参数 <$SCRIPTPARAM1><$SCRIPTPARAM3>',
    'MOV S$神佑 <$GODBLESSITEM2><$GODBLESSITEM12>',
    'MOV S$物品 <$USEITEMNAME><$USEITEMMAKEINDEX>',
    'MOV N$货币 <$OLDMONEY>',
    'MOV N$血量 <$ATTACKMONSTER_HPEX>',
  ].join('\r\n'));
  const geeCompatibility = scanServerLanguage(geeRoot, 'GEE');
  assert.deepEqual(Object.keys(geeCompatibility.commandMismatches), ['CHECKTITLE']);
  assert.equal(geeCompatibility.mismatchKinds, 1);

  fs.rmSync(root, { recursive: true, force: true });
  console.log('server-language-audit.test.js: PASS');
}

main();
