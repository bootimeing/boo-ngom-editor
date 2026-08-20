const assert = require('node:assert/strict');
const fs = require('node:fs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hasCompletion(index, name) {
  return index.commandCompletions.some(command => (
    command.name.toUpperCase() === name.toUpperCase()
  ));
}

function hasNameCompletion(index, name) {
  return index.commandNameCompletions.some(command => (
    command.name.toUpperCase() === name.toUpperCase()
  ));
}

function command(index, name) {
  const value = index.commandByName.get(name.toUpperCase());
  assert.ok(value, `${index.engine} must contain ${name}`);
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function main() {
  const { buildLanguageIndex, commandToken } = require('../out/utils/command-index');
  const commands = readJson('data/commands.json');
  const variables = readJson('data/variables.json');
  const catalog = {
    GOM: readJson('data/functions.json'),
    GEE: readJson('data/functions-gee.json'),
    '996PC': readJson('data/functions-996pc.json'),
  };
  const constants = {
    GOM: readJson('data/constants-gom.json'),
    GEE: readJson('data/constants-gee.json'),
    '996PC': readJson('data/constants-996pc.json'),
  };
  const gom = buildLanguageIndex(commands, variables, catalog, 'GOM', constants);
  const gee = buildLanguageIndex(commands, variables, catalog, 'GEE', constants);
  const pc996 = buildLanguageIndex(commands, variables, catalog, '996PC', constants);

  assert.equal(commandToken('CHECK [N]'), 'CHECK');
  assert.equal(commandToken('SET [标识列表]'), 'SET');
  assert.equal(commandToken('GetDBItemFieldValue'), 'GetDBItemFieldValue');
  for (const index of [gom, gee, pc996]) {
    for (const name of ['CHECK', 'SET', 'GOTO', 'GetDBItemFieldValue']) {
      assert.ok(index.commandByName.has(name.toUpperCase()), `${index.engine} must index ${name}`);
      assert.ok(hasCompletion(index, name), `${index.engine} must complete ${name}`);
    }
    assert.ok(
      index.commandCompletions.every(entry => !/\s|\[/.test(entry.name)),
      `${index.engine} completion names must be executable command tokens`
    );
    assert.ok(
      index.commandNameCompletions.every(entry => !/\s|\[/.test(entry.name)),
      `${index.engine} name completion entries must be executable command tokens`
    );
  }

  assert.ok(gom.commandByName.has('FLYINGSWORDSET'));
  assert.ok(gom.commandByName.has('CHECKMATERIAL'));
  assert.equal(gee.commandByName.has('FLYINGSWORDSET'), false);
  assert.deepEqual(gee.unsupportedCommandByName.get('FLYINGSWORDSET').engines, ['GOM']);
  assert.deepEqual(gom.commandByName.get('FLYINGSWORDSET').engines, ['GOM']);

  assert.ok(gee.commandByName.has('GETMAPHUMANCOUNT'));
  assert.equal(gom.commandByName.has('GETMAPHUMANCOUNT'), false);
  assert.deepEqual(gee.commandByName.get('GETMAPHUMANCOUNT').engines, ['GEE']);

  assert.deepEqual(gom.commandByName.get('SENDMSG').engines, ['GOM']);
  assert.deepEqual(gee.commandByName.get('SENDMSG').engines, ['GEE']);
  assert.equal(gom.commandByName.has('CHECKUSEITEMTYPE'), false);
  assert.equal(gee.commandByName.has('CHECKUSEITEMTYPE'), false);
  assert.equal(hasCompletion(gom, 'CHECKUSEITEMTYPE'), false);
  assert.equal(hasCompletion(gee, 'CHECKUSEITEMTYPE'), false);
  assert.equal(gom.commandByName.has('BUFF'), false);
  assert.equal(gee.commandByName.has('BUFF'), false);

  assert.ok(gee.commandByName.has('M.CHECKMONADDBYTE'));
  assert.ok(gom.commandByName.has('M.CHECKMONADDBYTE'));
  assert.match(command(gom, 'M.CHECKMONADDBYTE').syntax, /标识号.*比较符.*值/);
  assert.deepEqual(command(gom, 'M.CHECKMONADDBYTE').engines, ['GOM']);

  const gomSetIcon = gom.commandByName.get('SETICON');
  const geeSetIcon = gee.commandByName.get('SETICON');
  assert.match(gomSetIcon.syntax, /0-19/);
  assert.match(geeSetIcon.syntax, /0-9/);
  assert.deepEqual(gomSetIcon.engines, ['GOM']);
  assert.deepEqual(geeSetIcon.engines, ['GEE']);

  for (const name of ['HOUR', 'MIN', 'MONITEMS']) {
    assert.ok(gom.commandByName.has(name), `GOM must contain ${name}`);
    assert.equal(gee.commandByName.has(name), false, `GEE must not contain ${name}`);
    assert.ok(gee.unsupportedCommandByName.get(name).engines.includes('GOM'));
  }

  assert.ok(gee.commandByName.has('NOT'), 'GEE must support documented NOT negation');
  assert.ok(gee.variableByName.has('SCREENWIDTH'));
  assert.ok(gee.variableByName.has('SCREENHEIGHT'));
  assert.ok(gee.variableByName.has('MP'));
  assert.ok(gee.constantByName.has('SCREENWIDTH'));
  assert.ok(gee.constantByName.has('SCREENHEIGHT'));
  assert.ok(gee.constantByName.has('MP'));

  assert.ok(pc996.commands.length >= 500, '996PC must expose its independent command catalog');
  assert.equal(pc996.commandCompletions.length, 493, '996PC must expose only verified completions');
  assert.ok(pc996.variables.length >= 300, '996PC must expose documented variables');
  assert.ok(pc996.constants.length >= 550, '996PC must expose documented constants');
  assert.ok(pc996.triggers.length >= 70, '996PC must expose documented system triggers');
  assert.deepEqual(command(pc996, 'SENDMSG').engines, ['996PC']);
  assert.match(command(pc996, 'SENDMSG').syntax, /字体颜色.*背景颜色.*信息/);
  assert.equal(command(pc996, 'PERCENT').params.length, 3);
  assert.deepEqual(
    command(pc996, 'PERCENT').params,
    ['结果变量', '被除数变量', '除数变量']
  );
  assert.ok(pc996.commandByName.has('NOT'));
  assert.equal(command(pc996, 'CHECKSKILL').kind, 'check');
  assert.deepEqual(command(pc996, 'CHECKSKILL').contexts, ['IF']);
  assert.equal(command(pc996, 'CheckItemBind').kind, 'check');
  assert.deepEqual(command(pc996, 'CheckItemBind').contexts, ['IF']);
  assert.ok(pc996.variableByName.has('SCREENWIDTH'));
  assert.ok(pc996.constantByName.has('SCREENWIDTH'));
  assert.ok(pc996.triggerByName.has('ATTACK'));
  assert.equal(pc996.variableByName.has('MAPNAME'), false);
  assert.equal(pc996.triggerByName.has('QUERYMYSHOPFAIL'), false);
  assert.equal(pc996.constantByName.has('CASTLEWARDATE'), false);
  assert.equal(pc996.constantByName.has('LISTOFWAR'), false);
  assert.equal(gee.commandByName.has('CHECKTITLE'), false);
  assert.equal(gee.commandByName.has('CHECKITEMBIND'), false);
  assert.equal(gee.commandByName.has('SETITEMBIND'), false);
  assert.ok(gee.unsupportedCommandByName.get('CHECKTITLE').engines.includes('GOM'));

  for (const name of ['EM029B', 'SHAPE', 'STDMODE', 'QQQQ', 'POST', 'TEST', 'NODRUG']) {
    assert.equal(gee.commandByName.has(name), false, `${name} is not a GEE script command`);
  }

  assert.match(command(gom, 'SENDMSG').syntax, /类型 \[字体颜色\].*消息/);
  assert.match(command(gee, 'SENDMSG').syntax, /类型 消息.*字体颜色/);
  assert.match(command(gom, 'GOHOME').syntax, /强制参数/);
  assert.match(command(gee, 'GOHOME').syntax, /随机范围/);
  assert.match(command(gom, 'MONGENEX').syntax, /国家名称/);
  assert.match(command(gee, 'MONGENEX').syntax, /体型/);
  assert.match(command(gom, 'CHECKJOB').syntax, /WARR\/WIZARD\/TAOS/);
  assert.match(command(gee, 'CHECKJOB').syntax, /WARRIOR\/WIZARD\/TAOIST/);
  assert.match(command(gom, 'CHANGEHUMABILITY').syntax, /1-20/);
  assert.match(command(gee, 'CHANGEHUMABILITY').syntax, /1-29/);
  assert.equal(command(gom, 'OPENBIGDIALOGBOX').params.length, 2);
  assert.equal(command(gee, 'OPENBIGDIALOGBOX').params.length, 9);
  assert.match(command(gom, 'SETSKILLPOWER').syntax, /技能范围/);
  assert.match(command(gee, 'SETSKILLPOWER').syntax, /保存/);
  assert.match(command(gom, 'SHOWCUSTOMITEM').syntax, /外显类型/);
  assert.match(command(gee, 'SHOWCUSTOMITEM').syntax, /装备框位置/);
  assert.match(command(gom, 'RELEASEMAGIC').syntax, /无动作/);
  assert.match(command(gee, 'RELEASEMAGIC').syntax, /忽略冷却/);
  assert.match(command(gom, 'CHECKCASTLEWAR').syntax, /城堡编号/);
  assert.match(command(gee, 'CHECKCASTLEWAR').syntax, /城堡名称/);
  assert.match(command(gom, 'ADDBUTTON').params[1], /1-100/);
  assert.match(command(gee, 'ADDBUTTON').params[1], /1-200/);
  assert.match(command(gom, 'ADDDLG').syntax, /1-100/);
  assert.match(command(gee, 'ADDDLG').syntax, /1-50/);
  assert.equal(command(gom, 'CHANGEEXP').params.length, 3);
  assert.equal(command(gee, 'CHANGEEXP').params.length, 4);
  assert.equal(command(gom, 'HTTPPOST').params.length, 3);
  assert.equal(command(gee, 'HTTPPOST').params.length, 5);
  assert.match(command(gom, 'KILLMONBURSTRATE').syntax, /20140220/);
  assert.doesNotMatch(command(gee, 'KILLMONBURSTRATE').syntax, /20140220/);
  assert.equal(command(gom, 'RANGEHARMEX').params.length, 10);
  assert.equal(command(gee, 'RANGEHARMEX').params.length, 16);
  assert.match(command(gom, 'SETCLIENTBUFF').syntax, /1-100/);
  assert.match(command(gee, 'SETCLIENTBUFF').syntax, /1-200/);
  assert.equal(command(gom, 'GIVESTATEITEM').params.length, 10);
  assert.equal(command(gee, 'GIVESTATEITEM').params.length, 7);
  assert.equal(command(gom, 'GROUPMOVE').params.length, 3);
  assert.equal(command(gee, 'GROUPMOVE').params.length, 4);
  assert.match(command(gom, 'PRINTUSETIME').params[0], /1毫秒开始/);
  assert.match(command(gee, 'PRINTUSETIME').params[0], /1开始/);
  assert.equal(command(gom, 'RANDOMEX').syntax, command(gee, 'RANDOMEX').syntax);
  assert.match(command(gom, 'MESSAGEBOX').syntax, /\[@确定标签\].*\[@取消标签\]/);
  assert.equal(command(gom, 'MESSAGEBOX').syntax, command(gee, 'MESSAGEBOX').syntax);
  assert.match(command(gom, 'CHANGEMODEEX').syntax, /1-30/);
  assert.match(command(gee, 'CHANGEMODEEX').syntax, /1-10/);
  assert.equal(command(gom, 'FILTERGLOBALMSG').params.length, 7);
  assert.equal(command(gee, 'FILTERGLOBALMSG').params.length, 2);
  assert.equal(command(gom, 'GIVE').params.length, 2);
  assert.equal(command(gee, 'GIVE').params.length, 15);
  assert.equal(command(gom, 'CLEARSCREENEFFECT').minArgs, 0);
  assert.equal(command(gee, 'CLEARSCREENEFFECT').minArgs, 1);
  assert.match(command(gom, 'GETUPGRADECOUNT').params[0], /生肖/);
  assert.match(command(gee, 'GETUPGRADECOUNT').params[0], /神佑/);
  assert.equal(command(gom, 'PERCENT').params.length, 3);
  assert.equal(command(gee, 'PERCENT').params.length, 2);
  assert.equal(hasCompletion(gom, 'PERCENT'), true);
  assert.equal(hasCompletion(gee, 'PERCENT'), false);
  assert.equal(command(gee, 'CHECKBAGITEMS').params.length, 3);
  assert.equal(command(gee, 'CHANGESTATE').params.length, 10);
  assert.equal(command(gee, 'SETTHROWITEMFROM').params.length, 6);

  assert.equal(gom.commandByName.get('CHECKSTATEVALUE').kind, 'check');
  assert.ok(gom.checkCompletions.some(command => command.name.toUpperCase() === 'CHECKSTATEVALUE'));
  assert.equal(
    gom.actionCompletions.some(command => command.name.toUpperCase() === 'CHECKSTATEVALUE'),
    false
  );

  const historical = gom.commandByName.get('ISSPANREGIONHUMAN');
  assert.equal(historical.name, 'IsSpanRegionHumam');
  const aliasCompletion = gom.commandCompletions.find(
    command => command.name.toUpperCase() === 'ISSPANREGIONHUMAN'
  );
  assert.equal(aliasCompletion.aliasOf, 'IsSpanRegionHumam');
  assert.equal(aliasCompletion.syntax, 'IsSpanRegionHuman');
  assert.equal(
    gee.commandCompletions.some(command => command.name.toUpperCase() === 'ISSPANREGIONHUMAN'),
    false,
    'GEE help does not document the GOM compatibility spelling'
  );

  assert.match(gom.commandByName.get('SENDSCROLLMSG').syntax, /文字颜色.*背景颜色.*显示秒数/);
  assert.equal(gom.commandByName.get('CSVGETCELLINFO').params.length, 3);
  assert.equal(gee.commandByName.get('CSVGETCELLINFO').params.length, 3);
  assert.equal(gom.commandByName.get('CSVFINDTEXTROW').params.length, 6);

  assert.ok(gom.variableByName.has('UTCNOW'));
  assert.ok(gom.variableByName.has('H.MAGICID'));
  assert.ok(gee.variableByName.has('UTCNOW'));
  assert.ok(gee.variableByName.has('H.MAGICID'));
  assert.ok(gom.triggerByName.has('BEGINMAGIC'));
  assert.ok(gom.triggerByName.has('H.BEGINMAGIC'));
  assert.ok(gee.triggerByName.has('BEGINMAGIC'));
  assert.ok(gee.triggerByName.has('H.BEGINMAGIC'));
  assert.ok(gom.variableByName.has('ALLOWGROUP'));
  assert.equal(gee.variableByName.has('ALLOWGROUP'), false);
  assert.equal(gee.unsupportedVariableByName.get('ALLOWGROUP').name, 'ALLOWGROUP');
  assert.ok(gee.variableByName.has('ATTACKMONSTER_HP'));
  assert.equal(gom.variableByName.has('ATTACKMONSTER_HP'), false);
  assert.equal(
    gom.unsupportedVariableByName.get('ATTACKMONSTER_HP').name,
    'ATTACKMONSTER_HP'
  );
  assert.ok(gom.triggerByName.has('CONFIRMDEARRECALL'));
  assert.equal(gee.triggerByName.has('CONFIRMDEARRECALL'), false);
  assert.equal(
    gee.unsupportedTriggerByName.get('CONFIRMDEARRECALL').name,
    'ConfirmDearRecall'
  );
  assert.equal(gom.variableByName.has('CURRITEMCOUNT'), false);
  assert.equal(gee.variableByName.has('CURRITEMCOUNT'), false);
  assert.equal(gom.triggerByName.has('CLIENTCHANGESCREEN'), false);
  assert.equal(gee.triggerByName.has('CLIENTCHANGESCREEN'), false);

  assert.ok(gom.constants.length > 0);
  assert.ok(gee.constants.length > 0);
  assert.ok(gom.constants.every(entry => entry.engines.length === 1 && entry.engines[0] === 'GOM'));
  assert.ok(gee.constants.every(entry => entry.engines.length === 1 && entry.engines[0] === 'GEE'));
  assert.ok(gee.constantByName.has('ANTIMAGIC'));
  assert.equal(gom.constantByName.has('ANTIMAGIC'), false);
  assert.equal(gom.unsupportedConstantByName.get('ANTIMAGIC').name, 'ANTIMAGIC');

  const isolatedCommands = clone(commands);
  const isolatedVariables = clone(variables);
  const isolatedSendMsg = [...isolatedCommands.commands, ...isolatedCommands.execCommands]
    .find(entry => entry.name.toUpperCase() === 'SENDMSG');
  isolatedSendMsg.syntax = 'POISONED SHARED COMMAND';
  isolatedSendMsg.description = 'POISONED SHARED DESCRIPTION';
  isolatedSendMsg.engineVariants.GOM.syntax = 'SENDMSG GOM_ISOLATION_TEST';

  const isolatedUtcNow = isolatedVariables.variables
    .find(entry => entry.name.toUpperCase() === 'UTCNOW');
  isolatedUtcNow.desc = 'POISONED SHARED VARIABLE';
  isolatedUtcNow.engineVariants.GOM.desc = 'GOM variable isolation test';

  const isolatedBeginMagic = isolatedCommands.triggers
    .find(entry => entry.name.toUpperCase() === 'BEGINMAGIC');
  isolatedBeginMagic.description = 'POISONED SHARED TRIGGER';
  isolatedBeginMagic.engineVariants.GOM.description = 'GOM trigger isolation test';

  const isolatedGom = buildLanguageIndex(
    isolatedCommands,
    isolatedVariables,
    catalog,
    'GOM',
    constants
  );
  const isolatedGee = buildLanguageIndex(
    isolatedCommands,
    isolatedVariables,
    catalog,
    'GEE',
    constants
  );
  assert.equal(command(isolatedGom, 'SENDMSG').syntax, 'SENDMSG GOM_ISOLATION_TEST');
  assert.equal(command(isolatedGee, 'SENDMSG').syntax, command(gee, 'SENDMSG').syntax);
  assert.equal(isolatedGom.variableByName.get('UTCNOW').desc, 'GOM variable isolation test');
  assert.equal(isolatedGee.variableByName.get('UTCNOW').desc, gee.variableByName.get('UTCNOW').desc);
  assert.equal(
    isolatedGom.triggerByName.get('BEGINMAGIC').description,
    'GOM trigger isolation test'
  );
  assert.equal(
    isolatedGee.triggerByName.get('BEGINMAGIC').description,
    gee.triggerByName.get('BEGINMAGIC').description
  );
  assert.doesNotMatch(command(isolatedGom, 'SENDMSG').description, /POISONED/);
  assert.doesNotMatch(isolatedGom.variableByName.get('UTCNOW').desc, /POISONED/);
  assert.doesNotMatch(isolatedGom.triggerByName.get('BEGINMAGIC').description, /POISONED/);

  for (const index of [gom, gee]) {
    const names = index.commandCompletions.map(command => command.name.toUpperCase());
    assert.equal(new Set(names).size, names.length, `${index.engine} completion names must be unique`);
    assert.ok(
      index.commandCompletions.every(entry => entry.source),
      `${index.engine} completions must all have a help source`
    );
    assert.ok(
      index.commandCompletions.every(entry => !entry.legacyShared),
      `${index.engine} compatibility entries must not enter completion`
    );
    assert.ok(
      index.commandCompletions.every(entry => entry.completionVerified),
      `${index.engine} completions must all be verified`
    );
    assert.ok(
      index.commands
        .filter(entry => entry.completionEnabled && entry.source)
        .every(entry => hasNameCompletion(index, entry.name)),
      `${index.engine} confirmed command names must all enter name completion`
    );
    assert.ok(
      index.commandCompletions.every(entry => hasNameCompletion(index, entry.name)),
      `${index.engine} verified completions must be included in name completion`
    );
    assert.ok(
      [...index.variables, ...index.triggers].every(entry => entry.source),
      `${index.engine} variables and triggers must all have a selected source`
    );
  }

  console.log('command-index.test.js: PASS');
}

main();
