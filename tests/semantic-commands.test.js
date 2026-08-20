const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildIndexes() {
  const { buildLanguageIndex } = require('../out/utils/command-index');
  const commands = readJson('data/commands.json');
  const variables = readJson('data/variables.json');
  const catalogs = {
    GOM: readJson('data/functions.json'),
    GEE: readJson('data/functions-gee.json'),
    '996PC': readJson('data/functions-996pc.json'),
  };
  const constants = {
    GOM: readJson('data/constants-gom.json'),
    GEE: readJson('data/constants-gee.json'),
    '996PC': readJson('data/constants-996pc.json'),
  };
  return Object.fromEntries(Object.keys(catalogs).map(engine => [
    engine,
    buildLanguageIndex(commands, variables, catalogs, engine, constants),
  ]));
}

function main() {
  const {
    buildSemanticCommandIndex,
    classifySemanticCommand,
    findCommandCandidates,
  } = require('../out/utils/semantic-commands');
  const indexes = buildIndexes();

  for (const [engine, index] of Object.entries(indexes)) {
    const semantic = buildSemanticCommandIndex(index);
    const names = index.commandNameCompletions.map(command => command.name.toUpperCase());
    assert.equal(new Set(names).size, names.length, `${engine} name completions must be unique`);
    assert.ok(
      index.commandCompletions.every(command => names.includes(command.name.toUpperCase())),
      `${engine} verified completions must be a subset of name completions`
    );

    for (const command of index.commands) {
      const included = names.includes(command.name.toUpperCase());
      assert.equal(
        included,
        command.completionEnabled && Boolean(command.source),
        `${engine}.${command.name} name completion eligibility must match the catalog`
      );
    }

    for (const command of index.commandNameCompletions) {
      const line = `  ${command.name} 参数`;
      const candidate = findCommandCandidates(line)
        .find(item => item.name.toUpperCase() === command.name.toUpperCase());
      assert.ok(candidate, `${engine}.${command.name} must survive semantic token scanning`);
      const kind = classifySemanticCommand(semantic, candidate.name);
      assert.ok(kind, `${engine}.${command.name} must have a semantic highlight category`);
      const isCheck = index.checkNameCompletions.some(item => (
        item.name.toUpperCase() === command.name.toUpperCase()
      ));
      assert.equal(kind, isCheck ? 'check' : 'action', `${engine}.${command.name} category mismatch`);
    }
  }

  assert.ok(indexes.GOM.commandNameCompletions.length > indexes.GOM.commandCompletions.length);
  assert.ok(indexes.GEE.commandNameCompletions.length > indexes.GEE.commandCompletions.length);
  assert.equal(indexes['996PC'].commandNameCompletions.length, indexes['996PC'].commandCompletions.length);

  for (const [engine, name, expected] of [
    ['GOM', 'CHECK', 'check'],
    ['GOM', 'SET', 'action'],
    ['GOM', 'GetDBItemFieldValue', 'action'],
    ['GEE', 'CHECK', 'check'],
    ['GEE', 'GOTO', 'action'],
    ['996PC', 'CHECKSKILL', 'check'],
    ['996PC', 'CheckItemBind', 'check'],
    ['996PC', 'SetItemBind', 'action'],
  ]) {
    const semantic = buildSemanticCommandIndex(indexes[engine]);
    assert.equal(classifySemanticCommand(semantic, name), expected, `${engine}.${name}`);
  }

  assert.equal(indexes.GEE.commandByName.has('CHECKITEMBIND'), false);
  assert.equal(indexes.GEE.commandByName.has('SETITEMBIND'), false);
  assert.deepEqual(findCommandCandidates('M.ADDHPPER 10')[0], {
    name: 'M.ADDHPPER', start: 0, end: 10,
  });

  const grammar = readJson('syntaxes/gom.tmLanguage.json');
  assert.equal(
    grammar.patterns.some(pattern => pattern.name === 'support.function.tag.gomscript'),
    false,
    'static grammar must not keep an engine-agnostic command list'
  );
  assert.equal(
    grammar.patterns.some(pattern => pattern.name === 'variable.language.gomscript'),
    false,
    'numbered variables need semantic context so configured map codes are not colored as variables'
  );

  for (const file of fs.readdirSync('themes').filter(file => file.endsWith('.json'))) {
    const theme = readJson(path.join('themes', file));
    assert.ok(theme.semanticTokenColors['keyword.cmd'], `${file} needs a check-command color`);
    assert.ok(theme.semanticTokenColors['keyword.action'], `${file} needs an action-command color`);
    assert.ok(theme.semanticTokenColors['keyword.say'], `${file} needs a SAY-markup color`);
    assert.notEqual(
      theme.semanticTokenColors['keyword.cmd'],
      theme.semanticTokenColors['keyword.action'],
      `${file} check and action colors must be distinguishable`
    );
    assert.notEqual(
      theme.semanticTokenColors['keyword.say'],
      theme.semanticTokenColors['keyword.action'],
      `${file} SAY markup and action colors must be independently visible`
    );
  }

  const colorPicker = fs.readFileSync('media/color-picker.html', 'utf8');
  assert.match(colorPicker, /keyword\.cmd['"],name:'检测命令'/);
  assert.match(colorPicker, /keyword\.action['"],name:'执行命令'/);
  assert.match(colorPicker, /keyword\.say['"],name:'界面指令'/);
  const assistantSource = fs.readFileSync('src/assistant.ts', 'utf8');
  assert.match(assistantSource, /const MOD_SAY = 32/);
  assert.match(assistantSource, /\['cmd','action','flow','label','path','say'\]/);
  assert.match(assistantSource, /buildSayMarkupHover/);
  assert.match(assistantSource, /buildSayMarkupParameterHover/);
  const manifest = readJson('package.json');
  assert.equal(
    manifest.configurationDefaults['[gomscript]']['editor.semanticHighlighting.enabled'],
    true
  );

  console.log('semantic-commands.test.js: PASS');
}

main();
