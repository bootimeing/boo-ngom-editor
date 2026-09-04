const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const staticLanguage = require('../data/static-language.json');
const {
  parseNpcDialogDocument,
} = require('../out/ui-dialog/source-parser');
const {
  parseNpcDialogDocumentWithCompanion,
} = require('../out/ui-dialog/adddlg-companion');
const {
  buildDialogCoordinateEdits,
  applyTextReplacements,
} = require('../out/ui-dialog/source-patcher');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

// Contract exercised by this red test:
//
// 1. AddDlg windowOrigin and contentOrigin are source-bound coordinate pairs.
//    A literal pair in the primary NPC document is editable even when the
//    window content comes from an external QFunction companion.
// 2. LFM ADDDLG inline child spans are rebased into the physical #ACT line.
//    Replacing the documented `\\` line separator must not shift a later span.
// 3. Explicit dialog-background offsetX/offsetY are a separate source-bound
//    pair instead of being mixed with the archive image's own pixel offsets.
// 4. A background parsed from an external companion retains that companion's
//    URI/path/version and is read-only. The patcher must reject it even if a
//    stale/corrupt model flips editable=true.

const MAIN_PATH = path.resolve('D:/MirServer/Mir200/Envir/QuestDiary/coordinate-bindings.txt');
const MAIN_URI = pathToFileURL(MAIN_PATH).toString();

function parsePrimary(source, engine = 'GEE') {
  const marker = source.indexOf('#SAY') >= 0 ? '#SAY' : '#ACT';
  return parseNpcDialogDocument(source, {
    uri: MAIN_URI,
    fileName: path.basename(MAIN_PATH),
    filePath: MAIN_PATH,
    documentVersion: 7,
    engine,
    engineLabel: engine === 'GEE' ? '翎风引擎' : engine,
    cursorOffset: source.indexOf(marker) + marker.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function spanAt(source, original, start) {
  return { start, end: start + original.length, original };
}

function assertCoordinate(coordinate, source, expectedStart, expectedValue, label) {
  assert.ok(coordinate, `${label} coordinate missing`);
  assert.equal(coordinate.sourceValue, expectedValue, `${label} source value`);
  assert.equal(coordinate.displayValue, expectedValue, `${label} display value`);
  assert.deepEqual(coordinate.span, spanAt(source, String(expectedValue), expectedStart), `${label} span`);
  assert.equal(source.slice(coordinate.span.start, coordinate.span.end), String(expectedValue),
    `${label} span does not address the physical source`);
}

function assertBinding(binding, expected) {
  assert.ok(binding, `${expected.targetKind} binding missing`);
  assert.equal(binding.targetKind, expected.targetKind);
  assert.equal(binding.editable, expected.editable);
  assert.equal(binding.sourceUri, expected.sourceUri);
  assert.equal(path.resolve(binding.sourceFilePath), path.resolve(expected.sourceFilePath));
  assert.equal(binding.sourceDocumentVersion, expected.sourceDocumentVersion);
  assert.ok(binding.id && typeof binding.id === 'string', `${expected.targetKind} needs a stable id`);
  assertCoordinate(binding.x, expected.source, expected.xStart, expected.x, `${expected.targetKind}.x`);
  assertCoordinate(binding.y, expected.source, expected.yStart, expected.y, `${expected.targetKind}.y`);
}

function primaryFixture() {
  // Two real backslashes are intentional. LFM uses them as an inline visual
  // line separator; converting them to one synthetic newline changes offsets.
  const inline = '<&TEXT:一:11:22{FCOLOR=250}>\\\\<&TEXT:二:33:44{FCOLOR=251}>';
  const source = [
    '[@main]',
    '#ACT',
    'OPENMERCHANTBIGDLG 5 3 1 0 10 20 1 190 8 0',
    `ADDDLG 11 1 440 1 100:120 30:40 22 ${inline}`,
    '#SAY',
    '主文本',
  ].join('\n');
  return { source, inline, model: parsePrimary(source, 'GEE') };
}

function companionFixture() {
  const mainPath = path.resolve('D:/workspace/Mir200/Envir/QuestDiary/main.txt');
  const qfPath = path.resolve('D:/workspace/Mir200/Envir/Market_Def/QFunction-0.txt');
  const mainSource = [
    '[@main]',
    '#ACT',
    'ADDDLG 1 1 440 0 10:20 30:40 9 @QF界面 0:0 0:0:0:0:300',
  ].join('\n');
  const companionSource = [
    '[@QF界面]',
    '#ACT',
    'OPENMERCHANTBIGDLG 5 3 1 0 70 80 1 190 8 0',
    '#SAY',
    '<&TEXT:外部:11:22{FCOLOR=250}>',
  ].join('\n');
  const model = parseNpcDialogDocumentWithCompanion(mainSource, {
    uri: pathToFileURL(mainPath).toString(),
    fileName: path.basename(mainPath),
    filePath: mainPath,
    documentVersion: 9,
    engine: 'GOM',
    engineLabel: 'GOM',
    cursorOffset: mainSource.indexOf('#ACT') + 4,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  }, {
    status: 'found',
    candidateFilePaths: [qfPath],
    source: {
      uri: pathToFileURL(qfPath).toString(),
      fileName: path.basename(qfPath),
      filePath: qfPath,
      documentVersion: 12,
      text: companionSource,
    },
  });
  return { mainPath, qfPath, mainSource, companionSource, model };
}

function collectFailures() {
  const failures = [];
  const check = (name, callback) => {
    try {
      callback();
    } catch (error) {
      failures.push(`${name}: ${error && error.message ? error.message : String(error)}`);
    }
  };

  let primary;
  let companion;
  try {
    primary = primaryFixture();
  } catch (error) {
    failures.push(`primary fixture parse: ${error && error.stack ? error.stack : String(error)}`);
  }
  try {
    companion = companionFixture();
  } catch (error) {
    failures.push(`companion fixture parse: ${error && error.stack ? error.stack : String(error)}`);
  }

  check('primary AddDlg windowOrigin and contentOrigin expose exact editable bindings', () => {
    assert.ok(primary, 'primary fixture unavailable');
    const { source, model } = primary;
    const window = model.addDlgWindows.find(candidate => candidate.dialogId === 11);
    assert.ok(window, 'LFM ADDDLG #11 missing');
    const windowPair = source.indexOf('100:120');
    const contentPair = source.indexOf('30:40', windowPair);
    assertBinding(window.windowOriginBinding, {
      targetKind: 'adddlg-window-origin', editable: true,
      sourceUri: MAIN_URI, sourceFilePath: MAIN_PATH, sourceDocumentVersion: 7,
      source, xStart: windowPair, x: 100, yStart: windowPair + 4, y: 120,
    });
    assertBinding(window.contentOriginBinding, {
      targetKind: 'adddlg-content-origin', editable: true,
      sourceUri: MAIN_URI, sourceFilePath: MAIN_PATH, sourceDocumentVersion: 7,
      source, xStart: contentPair, x: 30, yStart: contentPair + 3, y: 40,
    });

    const result = buildDialogCoordinateEdits(source, model, [
      { elementId: window.windowOriginBinding.id, x: 105, y: 126 },
      { elementId: window.contentOriginBinding.id, x: 35, y: 46 },
    ]);
    const patched = applyTextReplacements(source, result.replacements);
    assert.equal(result.changedElements, 2);
    assert.match(patched, /ADDDLG 11 1 440 1 105:126 35:46 22/);
    assert.equal(
      patched,
      source.replace('100:120 30:40', '105:126 35:46'),
      'window/content edit changed anything outside the four coordinate fields'
    );
  });

  check('LFM inline child ranges rebase through the physical escaped separator', () => {
    assert.ok(primary, 'primary fixture unavailable');
    const { source, model } = primary;
    const window = model.addDlgWindows.find(candidate => candidate.dialogId === 11);
    const scene = model.scenes.find(candidate => candidate.addDlgWindow?.id === window?.id);
    const first = scene?.elements.find(element => element.text === '一');
    const second = scene?.elements.find(element => element.text === '二');
    assert.ok(first && second, 'both LFM inline children must be parsed');
    for (const element of [first, second]) {
      const physicalStart = source.indexOf(element.raw);
      assert.notEqual(physicalStart, -1, `physical inline source missing for ${element.text}`);
      assert.deepEqual(element.sourceRange, spanAt(source, element.raw, physicalStart),
        `${element.text} sourceRange was not rebased to its own physical markup`);
      assert.equal(source.slice(element.sourceRange.start, element.sourceRange.end), element.raw);
      assert.equal(element.editable, true,
        `${element.text} has direct literal X/Y in the primary source and must remain editable`);
      const coordinatePair = element.text === '一' ? ':11:22' : ':33:44';
      const pairStart = source.indexOf(coordinatePair, physicalStart) + 1;
      const expectedX = element.text === '一' ? 11 : 33;
      const expectedY = element.text === '一' ? 22 : 44;
      assertCoordinate(element.x, source, pairStart, expectedX, `${element.text}.x`);
      assertCoordinate(element.y, source, pairStart + 3, expectedY, `${element.text}.y`);
    }
    assert.ok(first.sourceRange.end < second.sourceRange.start,
      'the two physical inline ranges overlap or still cover the complete ADDDLG command');

    const result = buildDialogCoordinateEdits(source, model, [
      { elementId: first.id, x: first.layoutX + 5, y: first.layoutY + 6 },
      { elementId: second.id, x: second.layoutX + 7, y: second.layoutY + 8 },
    ]);
    const patched = applyTextReplacements(source, result.replacements);
    assert.match(patched, /<&TEXT:一:16:28\{FCOLOR=250\}>\\\\<&TEXT:二:40:52\{FCOLOR=251\}>/,
      'rebased edits did not update the two intended inline coordinate pairs');
    assert.match(patched, /ADDDLG 11 1 440 1 100:120 30:40 22/,
      'inline edits corrupted the AddDlg window/content coordinates');
  });

  check('primary explicit background offset has an independent editable binding', () => {
    assert.ok(primary, 'primary fixture unavailable');
    const { source, model } = primary;
    const background = model.scenes.find(scene => scene.background)?.background;
    assert.ok(background, 'primary dialog background missing');
    const commandStart = source.indexOf('OPENMERCHANTBIGDLG');
    const offsetPairStart = source.indexOf('10 20', commandStart);
    assertBinding(background.offsetBinding, {
      targetKind: 'dialog-background-offset', editable: true,
      sourceUri: MAIN_URI, sourceFilePath: MAIN_PATH, sourceDocumentVersion: 7,
      source, xStart: offsetPairStart, x: 10, yStart: offsetPairStart + 3, y: 20,
    });
    assert.notEqual(background.offsetBinding.id, model.addDlgWindows[0].windowOriginBinding.id,
      'background offset and AddDlg window origin must not share one draft/source target');

    const result = buildDialogCoordinateEdits(source, model, [{
      elementId: background.offsetBinding.id,
      x: 15,
      y: 26,
    }]);
    const patched = applyTextReplacements(source, result.replacements);
    assert.equal(
      patched,
      source.replace(
        'OPENMERCHANTBIGDLG 5 3 1 0 10 20 1 190 8 0',
        'OPENMERCHANTBIGDLG 5 3 1 0 15 26 1 190 8 0'
      ),
      'background offset edit changed an archive offset or unrelated command field'
    );
  });

  check('external companion background retains provenance and is defensively read-only', () => {
    assert.ok(companion, 'companion fixture unavailable');
    const { model, qfPath, companionSource, mainSource } = companion;
    const scene = model.scenes.find(candidate => candidate.background);
    const background = scene?.background;
    assert.ok(background, 'companion background missing');
    assert.equal(background.sourceUri, pathToFileURL(qfPath).toString());
    assert.equal(path.resolve(background.sourceFilePath), path.resolve(qfPath));
    assert.equal(background.sourceDocumentVersion, 12);
    const rangeStart = companionSource.indexOf('OPENMERCHANTBIGDLG');
    assert.deepEqual(background.sourceRange, spanAt(
      companionSource,
      'OPENMERCHANTBIGDLG 5 3 1 0 70 80 1 190 8 0',
      rangeStart
    ));
    const offsetStart = companionSource.indexOf('70 80', rangeStart);
    assertBinding(background.offsetBinding, {
      targetKind: 'dialog-background-offset', editable: false,
      sourceUri: pathToFileURL(qfPath).toString(), sourceFilePath: qfPath,
      sourceDocumentVersion: 12, source: companionSource,
      xStart: offsetStart, x: 70, yStart: offsetStart + 3, y: 80,
    });

    background.offsetBinding.editable = true;
    assert.throws(() => buildDialogCoordinateEdits(mainSource, model, [{
      elementId: background.offsetBinding.id,
      x: 71,
      y: 81,
    }]), /external|companion|外部|QFunction|只读/i,
    'patcher trusted a corrupt editable flag and tried to write companion spans into the main file');
  });

  check('main AddDlg origins remain editable when children and background are external', () => {
    assert.ok(companion, 'companion fixture unavailable');
    const { model, mainPath, mainSource, qfPath } = companion;
    const window = model.addDlgWindows[0];
    assertBinding(window.windowOriginBinding, {
      targetKind: 'adddlg-window-origin', editable: true,
      sourceUri: pathToFileURL(mainPath).toString(), sourceFilePath: mainPath,
      sourceDocumentVersion: 9, source: mainSource,
      xStart: mainSource.indexOf('10:20'), x: 10,
      yStart: mainSource.indexOf('10:20') + 3, y: 20,
    });
    assertBinding(window.contentOriginBinding, {
      targetKind: 'adddlg-content-origin', editable: true,
      sourceUri: pathToFileURL(mainPath).toString(), sourceFilePath: mainPath,
      sourceDocumentVersion: 9, source: mainSource,
      xStart: mainSource.indexOf('30:40'), x: 30,
      yStart: mainSource.indexOf('30:40') + 3, y: 40,
    });
    const externalElements = model.scenes.flatMap(scene => scene.elements || [])
      .filter(element => path.resolve(element.sourceFilePath || mainPath) === path.resolve(qfPath));
    assert.ok(externalElements.length > 0, 'fixture did not produce external companion children');
    assert.ok(externalElements.every(element => element.editable === false),
      'external companion children must stay read-only while the primary window remains editable');

    const result = buildDialogCoordinateEdits(mainSource, model, [{
      elementId: window.windowOriginBinding.id,
      x: 12,
      y: 23,
    }]);
    const patched = applyTextReplacements(mainSource, result.replacements);
    assert.equal(patched, mainSource.replace('10:20', '12:23'));
    assert.doesNotMatch(patched, /70:80|70 80/,
      'main-window edit leaked a companion background coordinate into the primary document');
  });

  return failures;
}

const failures = collectFailures();
if (failures.length > 0) {
  console.error('window-background-coordinate-bindings.test.js: RED FAILURE MATRIX');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('window-background-coordinate-bindings.test.js: PASS');
}
