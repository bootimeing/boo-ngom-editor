const assert = require('node:assert/strict');
const fs = require('node:fs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function requireText(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.trim(), `${label} must not be empty`);
}

function requireEvidence(entry, label) {
  if (entry?.source?.page) {
    requireText(entry.source.page, `${label}.source.page`);
    return;
  }
  assert.ok(
    Array.isArray(entry?.corpusEvidence) && entry.corpusEvidence.length > 0,
    `${label} must have help-page or server-corpus evidence`
  );
  for (const evidence of entry.corpusEvidence) {
    requireText(evidence.kind, `${label}.corpusEvidence.kind`);
    requireText(evidence.path, `${label}.corpusEvidence.path`);
    assert.ok(Number.isInteger(evidence.line) && evidence.line > 0);
    requireText(evidence.text, `${label}.corpusEvidence.text`);
  }
}

function main() {
  const { ENGINE_DEFINITIONS, ENGINE_IDS } = require('../out/utils/engine-registry');
  const commands = readJson('data/commands.json');
  const variables = readJson('data/variables.json');
  const assistant = fs.readFileSync('src/assistant.ts', 'utf8');
  const allCommands = [...commands.commands, ...commands.execCommands];

  assert.deepEqual(
    ENGINE_IDS,
    ENGINE_DEFINITIONS.map(definition => definition.id),
    'the registry must be the single engine iteration order'
  );
  assert.equal(new Set(ENGINE_IDS).size, ENGINE_IDS.length, 'engine ids must be unique');
  assert.equal(
    new Set(ENGINE_DEFINITIONS.map(definition => definition.functionFile)).size,
    ENGINE_DEFINITIONS.length,
    'every engine needs its own function catalog'
  );
  assert.equal(
    new Set(ENGINE_DEFINITIONS.map(definition => definition.constantsFile)).size,
    ENGINE_DEFINITIONS.length,
    'every engine needs its own constant catalog'
  );

  for (const entry of allCommands) {
    for (const engine of entry.engines || []) {
      const variant = entry.engineVariants?.[engine];
      assert.ok(variant, `${entry.name} needs a complete ${engine} command variant`);
      requireText(variant.name, `${entry.name}.${engine}.name`);
      requireText(variant.syntax, `${entry.name}.${engine}.syntax`);
      requireText(variant.description, `${entry.name}.${engine}.description`);
      assert.ok(Array.isArray(variant.params), `${entry.name}.${engine}.params must be an array`);
      requireEvidence(variant, `${entry.name}.${engine}`);
    }
  }

  for (const entry of variables.variables) {
    for (const engine of entry.engines || []) {
      const variant = entry.engineVariants?.[engine];
      assert.ok(variant, `${entry.name} needs a complete ${engine} variable variant`);
      requireText(variant.name, `${entry.name}.${engine}.name`);
      requireEvidence(variant, `${entry.name}.${engine}`);
    }
  }

  for (const entry of commands.triggers) {
    for (const engine of entry.engines || []) {
      const variant = entry.engineVariants?.[engine];
      assert.ok(variant, `${entry.name} needs a complete ${engine} trigger variant`);
      requireText(variant.name, `${entry.name}.${engine}.name`);
      requireText(variant.label, `${entry.name}.${engine}.label`);
      requireEvidence(variant, `${entry.name}.${engine}`);
    }
  }

  for (const definition of ENGINE_DEFINITIONS) {
    const functions = readJson(`data/${definition.functionFile}`);
    for (const [name, entry] of Object.entries(functions)) {
      requireEvidence(entry, `${definition.id}.${name}`);
      if (entry.completionEnabled) {
        assert.equal(entry.completionVerified, true, `${definition.id}.${name} completion must be verified`);
        requireText(entry.syntax || name, `${definition.id}.${name}.syntax`);
      }
    }
    const constants = readJson(`data/${definition.constantsFile}`);
    assert.equal(constants.engine, definition.id);
    for (const entry of constants.constants.filter(candidate => candidate.completionEnabled)) {
      requireText(entry.name, `${definition.id} constant name`);
      requireText(entry.full, `${definition.id}.${entry.name}.full`);
      requireText(entry.description, `${definition.id}.${entry.name}.description`);
      requireEvidence(entry, `${definition.id}.${entry.name}`);
      assert.equal(entry.completionVerified, true);
    }
  }
  const pc996Definition = ENGINE_DEFINITIONS.find(definition => definition.id === '996PC');
  const pc996Functions = readJson(`data/${pc996Definition.functionFile}`);
  const pc996Constants = readJson(`data/${pc996Definition.constantsFile}`);
  assert.ok(Object.keys(pc996Functions).length >= 500);
  assert.ok(pc996Constants.constants.length >= 550);

  const gomDefinition = ENGINE_DEFINITIONS.find(definition => definition.id === 'GOM');
  const gomFunctions = readJson(`data/${gomDefinition.functionFile}`);
  const gomConstants = readJson(`data/${gomDefinition.constantsFile}`);
  const findFunction = (catalog, name) => Object.entries(catalog)
    .find(([candidate]) => candidate.toUpperCase() === name.toUpperCase())?.[1];
  assert.ok(findFunction(gomFunctions, 'RESTRENEWLEVEL'), 'GOM help documents RESTRENEWLEVEL');
  assert.ok(findFunction(gomFunctions, 'CHANGEMONEY'), 'GOM help documents CHANGEMONEY');
  assert.ok(findFunction(pc996Functions, 'RESTRENEWLEVEL'), '996PC help documents RESTRENEWLEVEL');
  assert.ok(
    gomConstants.constants.some(entry => entry.name === 'REALUSERNAME'),
    'GOM help documents <$REALUSERNAME>'
  );

  assert.match(
    assistant,
    /ENGINE_DEFINITIONS\.map\(definition => \[[\s\S]*definition\.functionFile/,
    'completion editor function catalogs must be registry-driven'
  );
  assert.match(
    assistant,
    /ENGINE_DEFINITIONS\.map\(definition => \[[\s\S]*definition\.constantsFile/,
    'completion editor constant catalogs must be registry-driven'
  );
  assert.doesNotMatch(assistant, /funcsGOM|funcsGEE|constantsGOM|constantsGEE/);
  assert.match(
    assistant,
    /createEmptyEngineFunctionCatalog[\s\S]*for \(const definition of ENGINE_DEFINITIONS\)/
  );
  assert.match(
    assistant,
    /createEmptyEngineConstantCatalog[\s\S]*for \(const definition of ENGINE_DEFINITIONS\)/
  );

  console.log('engine-language-isolation.test.js: PASS');
}

main();
