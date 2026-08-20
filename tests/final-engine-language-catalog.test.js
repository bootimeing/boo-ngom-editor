const assert = require('node:assert/strict');
const fs = require('node:fs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeName(value) {
  return String(value || '').trim().toUpperCase();
}

function entryByName(entries, name) {
  return entries.find(entry => normalizeName(entry.name) === normalizeName(name));
}

function commandByName(engine, name) {
  const entry = entryByName([
    ...engine.detectionCommands,
    ...engine.executionCommands,
  ], name);
  assert.ok(entry, `missing command ${name}`);
  return entry;
}

function assertUnique(entries, label) {
  const names = entries.map(entry => normalizeName(entry.name));
  assert.equal(new Set(names).size, names.length, `${label} contains duplicate names`);
}

function assertRuntimeMatchesLedger(engine, index, ledger) {
  const checks = new Set(index.checks.map(entry => normalizeName(entry.name)));
  const runtimeCategories = {
    detectionCommands: index.commands.filter(entry => checks.has(normalizeName(entry.name))),
    executionCommands: index.commands.filter(entry => !checks.has(normalizeName(entry.name))),
    engineFunctions: index.triggers,
    systemConstants: index.constants,
  };

  for (const [category, runtimeEntries] of Object.entries(runtimeCategories)) {
    const ledgerEntries = ledger[category];
    assert.equal(ledgerEntries.length, runtimeEntries.length, `${engine}.${category} is stale`);
    assert.deepEqual(
      ledgerEntries.map(entry => normalizeName(entry.name)).sort(),
      runtimeEntries.map(entry => normalizeName(entry.name)).sort(),
      `${engine}.${category} names do not match the runtime index`
    );

    for (const runtimeEntry of runtimeEntries) {
      const recorded = entryByName(ledgerEntries, runtimeEntry.name);
      assert.ok(recorded, `${engine}.${category}.${runtimeEntry.name} is missing`);
      if (category === 'detectionCommands' || category === 'executionCommands') {
        assert.equal(recorded.syntax, runtimeEntry.syntax);
        assert.equal(recorded.description, runtimeEntry.description);
        assert.deepEqual(recorded.params, runtimeEntry.params);
      } else if (category === 'engineFunctions') {
        assert.equal(recorded.label, runtimeEntry.label);
        assert.equal(recorded.description, runtimeEntry.description);
        assert.deepEqual(recorded.params, runtimeEntry.params || []);
      } else {
        assert.equal(recorded.full, runtimeEntry.full);
        assert.equal(recorded.description, runtimeEntry.description);
        assert.equal(recorded.scope, runtimeEntry.scope);
      }
    }
  }
}

function main() {
  const { buildLanguageIndex } = require('../out/utils/command-index');
  const { ENGINE_DEFINITIONS } = require('../out/utils/engine-registry');
  const report = readJson('data/audit-report/final-engine-language-entry-ledger.json');
  const commands = readJson('data/commands.json');
  const variables = readJson('data/variables.json');
  const functionCatalogs = {};
  const constantCatalogs = {};

  for (const definition of ENGINE_DEFINITIONS) {
    functionCatalogs[definition.id] = readJson(`data/${definition.functionFile}`);
    constantCatalogs[definition.id] = readJson(`data/${definition.constantsFile}`);
  }

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.revision, '2026-07-26');
  assert.equal(report.method, 'runtime-index-plus-own-help-entry-ledger');
  assert.equal(report.totalIssues, 0);
  assert.deepEqual(
    Object.fromEntries(Object.entries(report.helpInventory).map(([engine, inventory]) => [
      engine,
      { pages: inventory.pages, digestLength: inventory.digest.length },
    ])),
    {
      GOM: { pages: 844, digestLength: 64 },
      GEE: { pages: 849, digestLength: 64 },
      '996PC': { pages: 825, digestLength: 64 },
    }
  );

  for (const definition of ENGINE_DEFINITIONS) {
    const engine = definition.id;
    const ledger = report.engines[engine];
    assert.ok(ledger, `${engine} ledger is missing`);
    const index = buildLanguageIndex(
      commands,
      variables,
      functionCatalogs,
      engine,
      constantCatalogs
    );
    assertRuntimeMatchesLedger(engine, index, ledger);

    for (const [category, entries] of Object.entries(ledger)) {
      assertUnique(entries, `${engine}.${category}`);
      assert.equal(report.summary[engine][category].entries, entries.length);
      assert.equal(report.summary[engine][category].issues, 0);
      for (const entry of entries) {
        assert.deepEqual(entry.issues, [], `${engine}.${category}.${entry.name} has audit issues`);
        assert.equal(entry.evidence.sourceStatus, 'matched');
        assert.equal(entry.evidence.tokenMatched, true);
        assert.ok(entry.source, `${engine}.${category}.${entry.name} needs its own help source`);
      }
    }
    assert.ok(
      ledger.engineFunctions.every(entry => /^\[@.+\]$/.test(entry.label)),
      `${engine} engine functions must use [@label] form`
    );
    for (const name of ['SCREENWIDTH', 'SCREENHEIGHT']) {
      assert.ok(entryByName(ledger.systemConstants, name), `${engine} needs ${name}`);
    }
  }

  const gom = report.engines.GOM;
  const gee = report.engines.GEE;
  const pc996 = report.engines['996PC'];
  assert.match(commandByName(gom, 'REPLACELISTBYCONTENT').params[3], /替换次数/);
  assert.match(commandByName(gee, 'REPLACELISTBYCONTENT').params[3], /区分大小写/);
  assert.match(commandByName(pc996, 'REPLACELISTBYCONTENT').params[3], /区分大小写/);
  assert.match(commandByName(gom, 'H.ADDMPPER').params[2], /万分比/);
  assert.match(commandByName(gee, 'H.CHECKHPPER').params[2], /万分比/);
  assert.doesNotMatch(commandByName(pc996, 'H.ADDMPPER').params[2], /万分比/);
  assert.deepEqual(commandByName(pc996, 'READEXCEL').params, ['表格路径', '行号']);
  assert.equal(entryByName(pc996.executionCommands, 'CLOSEMERCHANTBIGDLG'), undefined);
  assert.ok(entryByName(pc996.executionCommands, 'CloseBigDialogBox'));

  assert.ok(entryByName(gom.systemConstants, 'REALUSERNAME'));
  assert.ok(commandByName(gom, 'RESTRENEWLEVEL'));
  assert.ok(commandByName(gom, 'CHANGEMONEY'));

  console.log('final-engine-language-catalog.test.js: PASS');
}

main();
