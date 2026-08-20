const assert = require('node:assert/strict');
const fs = require('node:fs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertUniqueNames(entries, label) {
  const names = entries.map(entry => entry.name.toUpperCase());
  assert.equal(new Set(names).size, names.length, `${label} contains duplicate names`);
}

function findFunction(catalog, name) {
  const key = Object.keys(catalog).find(candidate => (
    candidate.toUpperCase() === name.toUpperCase()
  ));
  return key ? catalog[key] : undefined;
}

function main() {
  const commands = readJson('data/commands.json');
  const variables = readJson('data/variables.json');
  const gomFunctions = readJson('data/functions.json');
  const geeFunctions = readJson('data/functions-gee.json');
  const pc996Functions = readJson('data/functions-996pc.json');
  const constantCatalogs = {
    GOM: readJson('data/constants-gom.json'),
    GEE: readJson('data/constants-gee.json'),
    '996PC': readJson('data/constants-996pc.json'),
  };
  const staticLanguage = readJson('data/static-language.json');
  const classificationReport = readJson('data/audit-report/engine-classification.json');
  const accuracyReport = readJson('data/audit-report/language-accuracy-final.json');
  const packageJson = readJson('package.json');
  const allCommands = [...commands.commands, ...commands.execCommands];
  const validEngines = new Set(['GOM', 'GEE', '996PC']);
  const validContexts = new Set(['IF', 'ACT', 'SAY', 'ANY']);
  const validClassifications = new Set([
    'shared', 'gom-only', 'gee-only', '996pc-only', 'compatibility',
  ]);

  assert.equal(commands.totalCheckCommands, commands.commands.length);
  assert.equal(commands.totalActionCommands, commands.execCommands.length);
  assert.equal(commands.totalVariables, variables.variables.length);
  assert.equal(commands.totalTriggers, commands.triggers.length);
  assertUniqueNames(commands.commands, 'checks');
  assertUniqueNames(commands.execCommands, 'actions');
  assertUniqueNames(commands.triggers, 'triggers');
  assertUniqueNames(variables.variables, 'variables');

  for (const entry of allCommands) {
    for (const engine of entry.engines || []) assert.ok(validEngines.has(engine));
    for (const context of entry.contexts || []) assert.ok(validContexts.has(context));
    if (entry.minArgs !== undefined && entry.maxArgs !== undefined) {
      assert.ok(entry.minArgs <= entry.maxArgs, `${entry.name} has an invalid argument range`);
    }
    if (entry.engines?.length) assert.ok(entry.source, `${entry.name} engine classification needs a source`);
    assert.ok(entry.engineClassification, `${entry.name} needs an engine classification`);
    assert.ok(
      validClassifications.has(entry.engineClassification.status),
      `${entry.name} has an invalid engine classification`
    );
    if (entry.engineClassification.method === 'latest-help-index') {
      assert.equal(entry.engineClassification.revision, '2026-07-19');
    } else {
      assert.equal(entry.engineClassification.method, 'manual');
      assert.equal(entry.engineClassification.revision, '2026-07-23');
    }
    const legacyEngines = (entry.engines || []).filter(engine => engine !== '996PC');
    switch (entry.engineClassification.status) {
      case 'shared':
        assert.deepEqual(legacyEngines, ['GOM', 'GEE'], `${entry.name} must be shared`);
        if (entry.engineClassification.confidence === 'confirmed') {
          assert.ok(entry.engineVariants?.GOM?.source, `${entry.name} needs a GOM source`);
          assert.ok(entry.engineVariants?.GEE?.source, `${entry.name} needs a GEE source`);
        } else {
          for (const engine of ['GOM', 'GEE']) {
            const variant = entry.engineVariants?.[engine];
            assert.ok(
              variant?.source,
              `${entry.name} needs ${engine} help evidence`
            );
          }
        }
        break;
      case 'gom-only':
        assert.deepEqual(legacyEngines, ['GOM'], `${entry.name} must be GOM-only`);
        assert.equal(entry.engineClassification.confidence, 'confirmed');
        break;
      case 'gee-only':
        assert.deepEqual(legacyEngines, ['GEE'], `${entry.name} must be GEE-only`);
        assert.equal(entry.engineClassification.confidence, 'confirmed');
        break;
      case 'compatibility':
        assert.deepEqual(legacyEngines, [], `${entry.name} must retain dual-engine fallback`);
        assert.equal(entry.engineClassification.confidence, 'unverified');
        break;
    }
  }

  assert.deepEqual(classificationReport.summary, {
    shared: 483,
    'gom-only': 176,
    'gee-only': 1,
    compatibility: 56,
  });
  assert.equal(Object.keys(classificationReport.commands).length, 716);
  assert.equal(classificationReport.sources.GOM.files, 844);
  assert.equal(classificationReport.sources.GEE.files, 849);
  assert.equal(classificationReport.sources.GOM.root, undefined);
  assert.equal(classificationReport.sources.GEE.root, undefined);
  assert.equal(classificationReport.commands.SENDMSG.classification, 'shared');
  assert.equal(classificationReport.commands.FLYINGSWORDSET.classification, 'gom-only');
  assert.equal(classificationReport.commands.GETMAPHUMANCOUNT.classification, 'gee-only');
  assert.equal(classificationReport.commands.CHECKUSEITEMTYPE.classification, 'compatibility');
  assert.equal(classificationReport.commands.HOUR.classification, 'gom-only');
  assert.equal(classificationReport.commands.MIN.classification, 'gom-only');
  assert.equal(classificationReport.commands.MONITEMS.classification, 'gom-only');
  assert.equal(classificationReport.commands.BUFF, undefined);
  assert.equal(allCommands.some(entry => entry.name.toUpperCase() === 'BUFF'), false);

  for (const entry of [...commands.triggers, ...variables.variables]) {
    for (const engine of entry.engines || []) assert.ok(validEngines.has(engine));
    assert.ok(entry.engineClassification, `${entry.name} needs an engine classification`);
    assert.ok(
      validClassifications.has(entry.engineClassification.status),
      `${entry.name} has an invalid engine classification`
    );
    const expectedLegacyEngines = entry.engineClassification.status === 'shared'
      ? ['GOM', 'GEE']
      : entry.engineClassification.status === 'gom-only'
        ? ['GOM']
        : entry.engineClassification.status === 'gee-only'
          ? ['GEE']
          : [];
    const actualLegacyEngines = (entry.engines || []).filter(engine => engine !== '996PC');
    assert.deepEqual(actualLegacyEngines, expectedLegacyEngines, `${entry.name} has stale legacy engine support`);
    for (const engine of entry.engines || []) {
      assert.ok(
        entry.engineSources?.[engine],
        `${entry.name} needs a ${engine} help source`
      );
    }
    if (!entry.engines || entry.engines.length === 0) {
      assert.equal(entry.source, undefined, `${entry.name} compatibility source must stay hidden`);
    }
  }
  assert.deepEqual(classificationReport.symbols.variables.summary, {
    shared: 248,
    'gom-only': 167,
    'gee-only': 5,
    compatibility: 29,
  });
  assert.deepEqual(classificationReport.symbols.triggers.summary, {
    shared: 60,
    'gom-only': 29,
    'gee-only': 0,
    compatibility: 22,
  });
  assert.equal(Object.keys(classificationReport.symbols.variables.records).length, 449);
  assert.equal(Object.keys(classificationReport.symbols.triggers.records).length, 111);
  assert.equal(classificationReport.symbols.variables.records.UTCNOW.classification, 'shared');
  assert.equal(classificationReport.symbols.variables.records.ATTACKMONSTER_HP.classification, 'gee-only');
  assert.equal(classificationReport.symbols.variables.records.ALLOWGROUP.classification, 'gom-only');
  assert.equal(classificationReport.symbols.triggers.records.BEGINMAGIC.classification, 'shared');
  assert.equal(classificationReport.symbols.triggers.records.CONFIRMDEARRECALL.classification, 'gom-only');
  const loginTrigger = commands.triggers.find(entry => entry.name.toUpperCase() === 'LOGIN');
  const queryMyShopFailTrigger = commands.triggers.find(
    entry => entry.name.toUpperCase() === 'QUERYMYSHOPFAIL'
  );
  assert.ok(loginTrigger.engineVariants['996PC'].source, '996PC Login needs documented help evidence');
  assert.equal(
    queryMyShopFailTrigger.engines.includes('996PC'),
    false,
    '996PC QueryMyShopFail must stay unsupported when its help does not contain the trigger'
  );

  for (const name of [
    'SetDummyPickItemFile',
    'CheckAngryValue',
    'M2SpanRegion',
    'SetIcon',
    'ChangeHumAbilityEX',
    'RandomSplit',
    'UnixToStr',
    'AddHumNewValue',
  ]) {
    assert.ok(findFunction(gomFunctions, name), `${name} must be available to GOM`);
  }
  assert.equal(findFunction(gomFunctions, 'CheckAngryValue').kind, 'check');
  assert.equal(findFunction(gomFunctions, 'CheckStateValue').kind, 'check');
  assert.equal(findFunction(geeFunctions, 'M.CheckMonAddByte').kind, 'check');
  assert.equal(findFunction(geeFunctions, 'POSEHAVEPRENTICE').kind, 'check');
  assert.match(findFunction(gomFunctions, 'SetIcon').syntax, /0-19/);
  assert.match(findFunction(geeFunctions, 'SetIcon').syntax, /0-9/);

  for (const catalog of [gomFunctions, geeFunctions, pc996Functions]) {
    for (const [name, entry] of Object.entries(catalog)) {
      assert.ok(
        entry.source,
        `${name} engine function needs help evidence`
      );
      if (entry.source) {
        assert.ok(
          ['2026-07-19', '2026-07-23', '2026-07-26'].includes(entry.source.revision),
          `${name} has an unexpected help revision`
        );
      }
    }
  }
  for (const [engine, catalog] of Object.entries(constantCatalogs)) {
    for (const entry of catalog.constants) {
      if (!entry.completionEnabled && !entry.diagnosticSupported) continue;
      assert.ok(entry.source, `${entry.name} ${engine} constant needs help evidence`);
    }
  }
  assert.ok(Object.keys(pc996Functions).length >= 500);
  assert.equal(
    Object.values(pc996Functions).filter(entry => entry.completionVerified).length,
    493
  );
  assert.equal(findFunction(pc996Functions, 'CLEARPASSWORD').completionVerified, false);
  assert.match(findFunction(pc996Functions, 'SENDMSG').syntax, /字体颜色.*背景颜色.*信息/);
  assert.equal(findFunction(pc996Functions, 'Race'), undefined, 'Monster.xls Race prose is not a script command');
  assert.equal(findFunction(pc996Functions, 'SortHumVarToLisL'), undefined, 'the documented command typo must not become a completion');
  assert.match(findFunction(pc996Functions, 'SortHumVarToList').syntax, /人物名保存路径/);
  assert.match(findFunction(pc996Functions, 'CheckMapMonCount').syntax, /是否排除宝宝/);
  assert.match(findFunction(pc996Functions, 'OPENMERCHANTBIGDLG').syntax, /独立窗口/);
  assert.deepEqual(findFunction(pc996Functions, 'PERCENT').paramList, ['结果变量', '被除数变量', '除数变量']);
  for (const name of ['EM029B', 'SHAPE', 'STDMODE', 'QQQQ', 'POST', 'TEST', 'NODRUG', 'CHECK']) {
    assert.equal(findFunction(geeFunctions, name), undefined, `${name} is not a GEE function`);
  }

  assert.equal(packageJson.contributes.snippets, undefined);
  assert.equal(packageJson.version, '4.3.2');
  assert.equal(accuracyReport.schemaVersion, 4);
  assert.equal(accuracyReport.method, 'strict-definition-and-final-visible-language');
  assert.deepEqual(accuracyReport.summary, {
    commands: 716,
    classificationMatches: 716,
    classificationDiffers: 0,
    documented: {
      shared: 483,
      'gom-only': 176,
      'gee-only': 1,
      unverified: 56,
    },
    sharedVariants: {
      same: 256,
      insufficient: 0,
      'resolved-difference': 227,
      'unresolved-difference': 0,
    },
  });
  assert.deepEqual(accuracyReport.resolvedLanguage.summary, {
    GOM: {
      commands: 977,
      completions: 440,
      documented: 975,
      undocumented: 2,
      sourceMatched: 977,
      sourceMissing: 0,
      sourceAbsent: 0,
      compatibility: 0,
      completionVerified: 439,
      completionUnverified: 538,
      completionDisabled: 225,
      qualityIssues: 0,
    },
    GEE: {
      commands: 1138,
      completions: 576,
      documented: 1131,
      undocumented: 7,
      sourceMatched: 1138,
      sourceMissing: 0,
      sourceAbsent: 0,
      compatibility: 0,
      completionVerified: 572,
      completionUnverified: 566,
      completionDisabled: 419,
      qualityIssues: 0,
    },
    '996PC': {
      commands: 867,
      completions: 493,
      documented: 856,
      undocumented: 11,
      sourceMatched: 867,
      sourceMissing: 0,
      sourceAbsent: 0,
      compatibility: 0,
      completionVerified: 493,
      completionUnverified: 374,
      completionDisabled: 374,
      qualityIssues: 0,
    },
  });
  assert.deepEqual(
    {
      current: accuracyReport.commands.CHECKTITLE.currentClassification,
      documented: accuracyReport.commands.CHECKTITLE.documentedClassification,
      matches: accuracyReport.commands.CHECKTITLE.classificationMatches,
    },
    {
      current: 'gom-only',
      documented: 'gom-only',
      matches: true,
    },
    'CHECKTITLE must be unsupported by GEE when its help does not contain the command'
  );
  for (const engine of ['GOM', 'GEE', '996PC']) {
    const records = Object.values(accuracyReport.resolvedLanguage.engines[engine]);
    const completions = records.filter(entry => entry.completionIncluded);
    const compatibility = records.filter(entry => entry.compatibility);
    assert.ok(completions.every(entry => entry.documented), `${engine} completions must be documented`);
    assert.ok(completions.every(entry => entry.sourceStatus === 'matched'), `${engine} sources must resolve`);
    assert.ok(completions.every(entry => entry.completionVerified), `${engine} completions must be verified`);
    assert.ok(completions.every(entry => entry.qualityIssues.length === 0), `${engine} hover data must be clean`);
    assert.ok(compatibility.every(entry => !entry.completionIncluded), `${engine} compatibility must stay hover-only`);
  }
  for (const record of Object.values(accuracyReport.commands)) {
    if (record.documentedClassification !== 'shared') continue;
    if (record.variant.status !== 'insufficient') continue;
    for (const engine of ['GOM', 'GEE']) {
      assert.equal(
        accuracyReport.resolvedLanguage.engines[engine][record.name.toUpperCase()].completionIncluded,
        false,
        `${record.name} must stay out of ${engine} completion until its syntax is verified`
      );
    }
  }
  for (const engine of ['GOM', 'GEE']) {
    for (const entry of allCommands) {
      const record = accuracyReport.resolvedLanguage.engines[engine][entry.name.toUpperCase()];
      if (!record?.completionIncluded || record.origin !== 'shared') continue;
      assert.ok(
        [
          'curated-help-variant',
          'exact-help-syntax',
          'final-own-help-confirmed-no-arg',
          'final-own-help-manual-exact',
        ].includes(
          entry.engineVariants?.[engine]?.completionReview
        ),
        `${entry.name} ${engine} completion needs an approved review`
      );
    }
  }
  assert.deepEqual(accuracyReport.resolvedSymbols.summary.variables, {
    total: 449,
    shared: 251,
    'gom-only': 164,
    'gee-only': 5,
    '996pc-only': 0,
    compatibility: 29,
    active: { GOM: 415, GEE: 256, '996PC': 343 },
    sourceMatched: { GOM: 415, GEE: 256, '996PC': 343 },
    evidenceMatched: { GOM: 415, GEE: 256, '996PC': 343 },
    issues: 0,
  });
  assert.equal(
    accuracyReport.resolvedSymbols.variables.MP.engineEvidence.GEE.sourceStatus,
    'matched',
    'GEE MP support must resolve to its own help document'
  );
  assert.deepEqual(accuracyReport.resolvedSymbols.summary.triggers, {
    total: 195,
    shared: 70,
    'gom-only': 34,
    'gee-only': 15,
    '996pc-only': 54,
    compatibility: 22,
    active: { GOM: 104, GEE: 85, '996PC': 124 },
    sourceMatched: { GOM: 104, GEE: 85, '996PC': 124 },
    evidenceMatched: { GOM: 104, GEE: 85, '996PC': 124 },
    issues: 0,
  });
  assert.deepEqual(accuracyReport.resolvedStaticLanguage.summary.saySnippets, {
    total: 24,
    active: { GOM: 20, GEE: 21, '996PC': 13 },
    sourceMatched: { GOM: 20, GEE: 21, '996PC': 13 },
    evidenceMatched: { GOM: 20, GEE: 21, '996PC': 13 },
    issues: 0,
  });
  assert.deepEqual(accuracyReport.resolvedStaticLanguage.summary.mapInfoParams, {
    total: 106,
    active: { GOM: 77, GEE: 85, '996PC': 75 },
    sourceMatched: { GOM: 77, GEE: 85, '996PC': 75 },
    evidenceMatched: { GOM: 77, GEE: 85, '996PC': 75 },
    issues: 0,
  });
  assert.equal(staticLanguage.schemaVersion, 1);
  assert.equal(staticLanguage.revision, '2026-07-26');

  console.log('engine-help-data.test.js: PASS');
}

main();
