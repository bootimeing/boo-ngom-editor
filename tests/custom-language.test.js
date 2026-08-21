const assert = require('node:assert/strict');
const fs = require('node:fs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function main() {
  const {
    createEmptyCustomLanguageData,
    replaceCustomLanguageEntries,
    sanitizeCustomLanguageData,
  } = require('../out/utils/custom-language');
  const { buildLanguageIndex } = require('../out/utils/command-index');
  const {
    buildSemanticCommandIndex,
    classifySemanticCommand,
  } = require('../out/utils/semantic-commands');

  let custom = createEmptyCustomLanguageData();
  custom = replaceCustomLanguageEntries(custom, 'GOM', 'check', [{
    id: 'gom-check-1',
    name: 'CHECKBOOCUSTOM',
    syntax: 'CHECKBOOCUSTOM 变量 数量',
    description: '检测自定义数值',
    params: ['变量', '数量'],
  }]);
  custom = replaceCustomLanguageEntries(custom, 'GOM', 'action', [{
    id: 'gom-action-1',
    name: 'SETBOOCUSTOM',
    syntax: 'SETBOOCUSTOM 变量 数量',
    description: '设置自定义数值',
    params: ['变量', '数量'],
  }]);
  custom = replaceCustomLanguageEntries(custom, 'GOM', 'function', [{
    id: 'gom-function-1',
    name: '[@BOOCUSTOM]',
    syntax: 'BOOCUSTOM',
    description: '自定义引擎入口',
    params: [],
  }]);
  custom = replaceCustomLanguageEntries(custom, 'GOM', 'constant', [{
    id: 'gom-constant-1',
    name: '<$BOOCUSTOM>',
    syntax: 'BOOCUSTOM',
    description: '自定义系统常量',
    params: ['人物'],
  }]);

  const commands = readJson('data/commands.json');
  const variables = readJson('data/variables.json');
  const functions = {
    GOM: readJson('data/functions.json'),
    GEE: readJson('data/functions-gee.json'),
    '996PC': readJson('data/functions-996pc.json'),
  };
  const constants = {
    GOM: readJson('data/constants-gom.json'),
    GEE: readJson('data/constants-gee.json'),
    '996PC': readJson('data/constants-996pc.json'),
  };

  const gom = buildLanguageIndex(commands, variables, functions, 'GOM', constants, custom);
  const gee = buildLanguageIndex(commands, variables, functions, 'GEE', constants, custom);
  assert.ok(gom.checkCompletions.some(entry => entry.name === 'CHECKBOOCUSTOM'));
  assert.ok(gom.actionCompletions.some(entry => entry.name === 'SETBOOCUSTOM'));
  assert.equal(gom.commandByName.get('CHECKBOOCUSTOM').origin, 'custom');
  assert.equal(gom.commandByName.get('CHECKBOOCUSTOM').description, '检测自定义数值');
  assert.deepEqual(gom.commandByName.get('CHECKBOOCUSTOM').params, ['变量', '数量']);
  assert.ok(gom.triggerByName.has('BOOCUSTOM'));
  assert.ok(gom.constantByName.has('BOOCUSTOM'));
  assert.equal(gee.commandByName.has('CHECKBOOCUSTOM'), false);
  assert.equal(gee.triggerByName.has('BOOCUSTOM'), false);
  assert.equal(gee.constantByName.has('BOOCUSTOM'), false);

  const semantic = buildSemanticCommandIndex(gom);
  assert.equal(classifySemanticCommand(semantic, 'CHECKBOOCUSTOM'), 'check');
  assert.equal(classifySemanticCommand(semantic, 'SETBOOCUSTOM'), 'action');

  custom = replaceCustomLanguageEntries(custom, 'GOM', 'check', [{
    id: 'gom-check-1',
    name: 'CHECKBOOCUSTOM2',
    syntax: 'CHECKBOOCUSTOM2 参数',
    description: '修改后的检测命令',
    params: ['参数'],
  }]);
  assert.equal(custom.engines.GOM.checks.length, 1, 'same custom id must update instead of duplicate');
  assert.equal(custom.engines.GOM.checks[0].name, 'CHECKBOOCUSTOM2');

  assert.throws(
    () => replaceCustomLanguageEntries(custom, 'GOM', 'action', [
      {
        id: 'duplicate-1',
        name: 'SAMECUSTOM',
        syntax: 'SAMECUSTOM',
        description: '',
        params: [],
      },
      {
        id: 'duplicate-2',
        name: 'samecustom',
        syntax: 'samecustom',
        description: '',
        params: [],
      },
    ]),
    /重复/
  );

  const recovered = sanitizeCustomLanguageData({
    schemaVersion: 1,
    engines: {
      GOM: { checks: custom.engines.GOM.checks },
    },
  });
  assert.equal(recovered.engines.GOM.checks.length, 1);
  assert.deepEqual(recovered.engines.GEE.actions, []);
  assert.deepEqual(recovered.engines['996PC'].constants, []);

  console.log('custom-language.test.js: PASS');
}

main();
