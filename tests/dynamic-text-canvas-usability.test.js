const assert = require('node:assert/strict');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');

/**
 * Red-test contract for the Ctrl+F12 canvas shown by a typical ten-row rank UI.
 *
 * A source expression and a statically provable source value are different
 * facts. The canvas should use the proved value when the local #ACT path is
 * deterministic, while Inspector keeps the original expression auditable.
 * An unresolved string needs a useful client-like placeholder; an unresolved
 * number/quantity needs the neutral numeric placeholder 0. Diagnostics must
 * be de-duplicated before they are presented to the user.
 */

function rankSource() {
  const rankRows = Array.from({ length: 10 }, (_, index) => (
    `<&TEXT:<$STR(N$RANK_${index + 1})>:458:${147 + index * 24}{FCOLOR=251}>`
  ));
  return [
    '[@rank]',
    '#ACT',
    'MOV S$KNOWN_TITLE 已确定榜首',
    '#SAY',
    '<&TEXT:<$STR(S$KNOWN_TITLE)>:120:60{FCOLOR=251}/@openRank>',
    '<&TEXT:<$STR(S$UNKNOWN_TITLE)>:120:88{FCOLOR=251}>',
    '<&TEXT:<$STR(N$UNKNOWN_COUNT)>:120:116{FCOLOR=251}>',
    ...rankRows,
    '',
  ].join('\n');
}

function parseFixture() {
  const source = rankSource();
  const model = parseSource(source);
  assert.ok(model.pages[0], 'rank fixture must create a visible page');
  return { source, model, elements: model.pages[0].elements };
}

function parseSource(source, overrides = {}) {
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/dynamic-text-usability.txt',
    fileName: 'dynamic-text-usability.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\dynamic-text-usability.txt',
    documentVersion: 1,
    engine: 'GOM',
    engineLabel: 'GOM',
    cursorOffset: source.indexOf('[@rank]') + '[@rank]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
    ...overrides,
  });
}

function byRaw(elements, marker) {
  const element = elements.find(candidate => String(candidate.raw || '').includes(marker));
  assert.ok(element, `missing fixture element containing ${marker}`);
  return element;
}

function visibleText(element) {
  const runs = (element.textPreview?.lines || [])
    .flatMap(line => (line || []).map(run => String(run.text || '')))
    .join('');
  return runs || String(element.text ?? '');
}

function warningClauses(element) {
  return String(element.warning || '')
    .split('；')
    .map(value => value.trim())
    .filter(Boolean);
}

const checks = [];
function check(name, callback) {
  checks.push({ name, callback });
}

const fixture = parseFixture();

check('a deterministically assigned string is drawn while its source expression remains auditable', () => {
  const element = byRaw(fixture.elements, 'S$KNOWN_TITLE');
  assert.equal(visibleText(element), '已确定榜首',
    'a deterministic MOV must produce useful visible text instead of the raw <$STR(...)> expression');
  assert.match(element.raw, /<\$STR\(S\$KNOWN_TITLE\)>/i,
    'Inspector/source routing still needs the original expression');
  assert.equal(element.textPreview?.lines?.[0]?.[0]?.color, '#ffff00',
    'FCOLOR=251 must keep the documented yellow run');
  assert.equal(element.runtimeActionPreview?.link, '@openRank');
  assert.equal(element.runtimeActionPreview?.localOnly, true,
    'the @ label remains a local-only preview action');
});

check('unresolved string and numeric expressions use useful neutral placeholders', () => {
  const stringElement = byRaw(fixture.elements, 'S$UNKNOWN_TITLE');
  const numericElement = byRaw(fixture.elements, 'N$UNKNOWN_COUNT');
  assert.equal(visibleText(stringElement), '预览文字',
    'an unresolved S$/string expression should remain readable on the canvas');
  assert.equal(visibleText(numericElement), '0',
    'an unresolved N$/quantity expression should use the neutral numeric placeholder 0');
  assert.match(stringElement.raw, /<\$STR\(S\$UNKNOWN_TITLE\)>/i);
  assert.match(numericElement.raw, /<\$STR\(N\$UNKNOWN_COUNT\)>/i);
});

check('all ten rank rows stay visibly useful without borrowing an unproved value', () => {
  const rows = Array.from({ length: 10 }, (_, index) => (
    byRaw(fixture.elements, `N$RANK_${index + 1}`)
  ));
  assert.equal(rows.length, 10);
  for (const [index, element] of rows.entries()) {
    assert.equal(visibleText(element), '0', `rank row ${index + 1} needs a numeric placeholder`);
    assert.equal(element.editable, true, `rank row ${index + 1} has static X/Y and must remain editable`);
    assert.ok(element.x && element.y, `rank row ${index + 1} lost its source coordinate spans`);
    assert.equal(element.x.sourceValue, 458,
      `rank row ${index + 1} must retain the exact source X coordinate`);
    assert.equal(element.y.sourceValue, 147 + index * 24,
      `rank row ${index + 1} must retain the exact source Y coordinate`);
    assert.equal(element.layoutX, 454,
      `rank row ${index + 1} must apply the original UI editor 4px absolute-text paint bias exactly once`);
    assert.equal(element.layoutY, 143 + index * 24,
      `rank row ${index + 1} must apply the original UI editor 4px absolute-text paint bias exactly once`);
  }
});

check('element warnings are de-duplicated by user-visible clause', () => {
  for (const marker of ['S$UNKNOWN_TITLE', 'N$UNKNOWN_COUNT', 'N$RANK_1']) {
    const element = byRaw(fixture.elements, marker);
    const clauses = warningClauses(element);
    assert.ok(clauses.some(value => /动态|MOV|Ctrl\+F12/i.test(value)),
      `${marker} lost its source-safety explanation`);
    assert.equal(new Set(clauses).size, clauses.length,
      `${marker} repeats the same warning clause: ${clauses.join(' | ')}`);
  }
});

check('an incomplete list read overwrites earlier MOV values with typed placeholders', () => {
  const source = [
    '[@rank]',
    '#ACT',
    'MOV S$NAME 旧名字',
    'MOV N$VALUE 77',
    'GETLISTSTRING ..\\rank.txt 0 S$NAME N$VALUE',
    '#SAY',
    '<&TEXT:<$STR(S$NAME)>:20:30>',
    '<&TEXT:<$STR(N$VALUE)>:20:54>',
  ].join('\n');
  const model = parseSource(source, {
    dataOptions: {
      resolveListData: () => ({ lines: ['磁盘旧名:99'], complete: false }),
    },
  });
  const elements = model.pages[0].elements;
  const name = byRaw(elements, 'S$NAME');
  const value = byRaw(elements, 'N$VALUE');
  assert.equal(visibleText(name), '预览文字');
  assert.equal(visibleText(value), '0');
  assert.equal(name.textPreview?.textValueStatus, 'runtime-placeholder');
  assert.equal(value.textPreview?.textValueStatus, 'runtime-placeholder');
  const variables = new Map(model.pages[0].resolvedVariables.map(variable => [variable.name, variable]));
  assert.equal(variables.get('S$NAME')?.status, 'default');
  assert.equal(variables.get('N$VALUE')?.status, 'default');
});

check('a complete read-only list remains a statically proven visible value', () => {
  const source = [
    '[@rank]',
    '#ACT',
    'GETLISTSTRING ..\\rank.txt 0 S$NAME N$VALUE',
    '#SAY',
    '<&TEXT:<$STR(S$NAME)>:20:30>',
    '<&TEXT:<$STR(N$VALUE)>:20:54>',
  ].join('\n');
  const model = parseSource(source, {
    dataOptions: {
      resolveListData: () => ({ lines: ['啊实打实的:1'], complete: true }),
    },
  });
  const elements = model.pages[0].elements;
  const name = byRaw(elements, 'S$NAME');
  const value = byRaw(elements, 'N$VALUE');
  assert.equal(visibleText(name), '啊实打实的');
  assert.equal(visibleText(value), '1');
  assert.equal(name.textPreview?.textValueStatus, 'resolved-static');
  assert.equal(value.textPreview?.textValueStatus, 'resolved-static');
});

check('a runtime list writer invalidates a same-path disk snapshot before GETLISTSTRING', () => {
  const source = [
    '[@rank]',
    '#ACT',
    'SortHumVarToListEx POWER ..\\rank-values.txt 1 ..\\rank.txt 1',
    'GETLISTSTRING ..\\rank.txt 0 S$NAME N$VALUE',
    '#SAY',
    '<&TEXT:<$STR(S$NAME)>:20:30>',
    '<&TEXT:<$STR(N$VALUE)>:20:54>',
  ].join('\n');
  let reads = 0;
  const model = parseSource(source, {
    dataOptions: {
      resolveListData: () => {
        reads++;
        return { lines: ['不得借用的旧排行:999'], complete: true };
      },
    },
  });
  const elements = model.pages[0].elements;
  assert.equal(visibleText(byRaw(elements, 'S$NAME')), '预览文字');
  assert.equal(visibleText(byRaw(elements, 'N$VALUE')), '0');
  assert.equal(reads, 0,
    'a known stale same-path disk snapshot should not even be offered as static evidence');
});

check('a runtime writer for another path does not invalidate an independent complete list', () => {
  const source = [
    '[@rank]',
    '#ACT',
    'SortHumVarToListEx POWER ..\\rank-values.txt 1 ..\\other-rank.txt 1',
    'GETLISTSTRING ..\\rank.txt 0 S$NAME N$VALUE',
    '#SAY',
    '<&TEXT:<$STR(S$NAME)>:20:30>',
    '<&TEXT:<$STR(N$VALUE)>:20:54>',
  ].join('\n');
  const model = parseSource(source, {
    dataOptions: {
      resolveListData: () => ({ lines: ['独立排行:12'], complete: true }),
    },
  });
  const elements = model.pages[0].elements;
  assert.equal(visibleText(byRaw(elements, 'S$NAME')), '独立排行');
  assert.equal(visibleText(byRaw(elements, 'N$VALUE')), '12');
});

check('a conditional rank writer invalidates disk data only on the selected active path', () => {
  const source = [
    '[@rank]',
    '#IF',
    'SMALL G701 <$TIMEUNIXS>',
    '#ACT',
    'SortHumVarToListEx POWER ..\\rank-values.txt 1 ..\\rank.txt 1',
    '#IF',
    '#ACT',
    'GETLISTSTRING ..\\rank.txt 0 S$NAME N$VALUE',
    '#SAY',
    '<&TEXT:<$STR(S$NAME)>:20:30>',
    '<&TEXT:<$STR(N$VALUE)>:20:54>',
  ].join('\n');
  const dataOptions = {
    resolveListData: () => ({ lines: ['磁盘快照:1'], complete: true }),
  };
  const writerSkipped = parseSource(source, { dataOptions });
  const conditionId = writerSkipped.conditionGroups[0]?.id;
  assert.ok(conditionId);
  assert.equal(visibleText(byRaw(writerSkipped.pages[0].elements, 'S$NAME')), '磁盘快照');
  assert.equal(visibleText(byRaw(writerSkipped.pages[0].elements, 'N$VALUE')), '1');

  const writerActive = parseSource(source, {
    dataOptions,
    conditionStates: { [conditionId]: true },
  });
  assert.equal(visibleText(byRaw(writerActive.pages[0].elements, 'S$NAME')), '预览文字');
  assert.equal(visibleText(byRaw(writerActive.pages[0].elements, 'N$VALUE')), '0');
  assert.ok(writerActive.warnings.some(warning => /改写|旧快照/.test(warning)));
});

check('condition simulation replaces the visible value instead of restoring the expression', () => {
  const source = [
    '[@rank]',
    '#ACT',
    'MOV N$VALUE 0',
    'MOV S$NAME 旧名字',
    '#IF',
    'EQUAL N$VALUE 0',
    '#ACT',
    'MOV S$NAME 暂无',
    '#SAY',
    '<&TEXT:<$STR(S$NAME)>:20:30>',
  ].join('\n');
  const initial = parseSource(source);
  const conditionId = initial.conditionGroups[0]?.id;
  assert.ok(conditionId, 'fixture must expose a preview condition');
  const satisfied = parseSource(source, { conditionStates: { [conditionId]: true } });
  const element = byRaw(satisfied.pages[0].elements, 'S$NAME');
  assert.equal(visibleText(element), '暂无');
  assert.equal(element.textPreview?.textValueStatus, 'resolved-static');
  assert.match(element.raw, /<\$STR\(S\$NAME\)>/i);
});

check('text style and scroll fields resolve independently on the selected static path', () => {
  const source = [
    '[@rank]',
    '#ACT',
    'MOV N$SIZE 18',
    'MOV N$WIDTH 180',
    '#SAY',
    '<RText|id=MIXED|x=20|y=30|text=<$STR(S$UNKNOWN)>|size=<$STR(N$SIZE)>|scrollWidth=<$STR(N$WIDTH)>|scrollHeight=<$STR(N$HEIGHT)>|scrollWay=<$STR(N$WAY)>|scrollTime=<$STR(N$TIME)>>',
  ].join('\n');
  const model = parseSource(source, {
    engine: '996PC',
    engineLabel: '996PC',
    catalog: buildDialogStatementCatalog(staticLanguage, '996PC'),
  });
  const element = model.pages[0].elements.find(candidate => candidate.containerElementId === 'MIXED');
  assert.ok(element, 'mixed RText fixture must be recognized');
  assert.equal(visibleText(element), '预览文字');
  assert.equal(element.textPreview?.fontSize, 18);
  assert.equal(element.textPreview?.scrollWidth, 180);
  assert.deepEqual(element.textPreview?.resolvedFields?.sort(), ['font-size', 'scroll-width']);
  for (const field of ['text', 'scroll-height', 'scroll-direction', 'scroll-duration']) {
    assert.ok(element.textPreview?.dynamicFields?.includes(field), `${field} must remain a runtime placeholder`);
    assert.equal(Boolean(element.textPreview?.invalidFields?.includes(field)), false,
      `${field} placeholder 0 must not be mislabeled as invalid source`);
  }
  assert.equal(element.width, 180, 'the resolved scroll width must control geometry');
  assert.notEqual(element.height, 0, 'an unknown scroll height needs safe usable geometry');
});

const failures = [];
for (const entry of checks) {
  try {
    entry.callback();
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failures.push({ name: entry.name, error });
    console.error(`FAIL ${entry.name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

if (failures.length > 0) {
  console.error(`dynamic-text-canvas-usability.test.js: RED (${failures.length}/${checks.length} contracts failing)`);
  process.exitCode = 1;
} else {
  console.log(`dynamic-text-canvas-usability.test.js: PASS (${checks.length}/${checks.length})`);
}
