const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const RUNTIME_ROOT = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || REPOSITORY_ROOT);
const runtimeRequire = relativePath => require(path.join(RUNTIME_ROOT, ...relativePath.split('/')));

const staticLanguage = runtimeRequire('data/static-language.json');
const { buildDialogStatementCatalog } = runtimeRequire('out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = runtimeRequire('out/ui-dialog/offsets');
const { parseNpcDialogDocument } = runtimeRequire('out/ui-dialog/source-parser');
const { ScriptDataResolver } = runtimeRequire('out/utils/script-data-resolver');
const { decodeTextFile, encodeTextFile } = runtimeRequire('out/utils/text');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const REAL_SCRIPT_PATH = process.env.BOO_REAL_RANK_SCRIPT
  || 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\02功能脚本\\战力排行.txt';
const REAL_LIST_PATH = process.env.BOO_REAL_RANK_LIST
  || 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\04自定义变量\\战斗力\\战斗力排行.txt';

// This fallback keeps the regression gate runnable on a clean checkout. On the
// user's MirServer machine the probe always snapshots the real GBK files first.
function fallbackRankSource() {
  const nameRows = Array.from({ length: 10 }, (_, offset) => {
    const index = offset + 1;
    const tooltip = index <= 3 ? `|${[249, 243, 151][offset]}#点击查看装备` : '';
    const action = index <= 3 ? `/@查看装备(<$str(s$战力排行名${index})>)` : '';
    const color = [249, 243, 151, 254, 250, 255, 255, 160, 160, 160][offset];
    return `<&text:<$str(s$战力排行名${index})>${tooltip}:302:${119 + offset * 28}{fcolor=${color}}${action}>`;
  });
  const valueRows = Array.from({ length: 10 }, (_, offset) => {
    const index = offset + 1;
    const color = [249, 243, 151, 254, 250, 255, 255, 160, 160, 160][offset];
    return `<&text:<$str(n$战力排行${index})>:458:${119 + offset * 28}{fcolor=${color}}>`;
  });
  const resetRows = Array.from({ length: 10 }, (_, offset) => {
    const index = offset + 1;
    return `mov s$战力排行名${index}\nmov n$战力排行${index} 0`;
  });
  const reads = Array.from({ length: 10 }, (_, offset) => {
    const index = offset + 1;
    return `GetListString ..\\QuestDiary\\04自定义变量\\战斗力\\战斗力排行.txt ${offset} s$战力排行名${index} n$战力排行${index}`;
  });
  const emptyNames = Array.from({ length: 10 }, (_, offset) => {
    const index = offset + 1;
    return [
      '#if',
      `equal n$战力排行${index} 0`,
      '#act',
      `mov s$战力排行名${index} 暂无`,
    ].join('\n');
  });
  return [
    '[@战力排行]',
    '#if',
    '#act',
    'goto @获取战力排行',
    '#if',
    '#act',
    'openmerchantbigdlg 1 290 1 4 0 -50 1 513 40',
    '#say',
    ...nameRows,
    '',
    ...valueRows,
    '',
    '<&text:<$str(n$战斗力)>:372:403{fcolor=251}>',
    '',
    '[@查看装备]',
    '#if',
    '#act',
    'messagebox 本地预览不应执行该动作',
    '',
    '[@获取战力排行]',
    '#if',
    '#act',
    ...resetRows,
    '#if',
    'small G701 <$timeunixs>',
    '#act',
    'FORMULATION <$TIMEUNIXS>+60 G701',
    'SortHumVarToListEx 战斗力 ..\\QuestDiary\\04自定义变量\\战斗力\\战斗力.txt 1 ..\\QuestDiary\\04自定义变量\\战斗力\\战斗力排行.txt 1',
    '#if',
    '#act',
    ...reads,
    ...emptyNames,
    '',
  ].join('\r\n');
}

function loadRankBytes() {
  if (fs.existsSync(REAL_SCRIPT_PATH) && fs.existsSync(REAL_LIST_PATH)) {
    const scriptBytes = fs.readFileSync(REAL_SCRIPT_PATH);
    const listBytes = fs.readFileSync(REAL_LIST_PATH);
    const script = decodeTextFile(scriptBytes);
    const list = decodeTextFile(listBytes);
    assert.equal(script.encoding, 'gbk', `real rank script must remain GBK: ${REAL_SCRIPT_PATH}`);
    assert.equal(list.encoding, 'gbk', `real rank list must remain GBK: ${REAL_LIST_PATH}`);
    assert.match(script.text, /\[@战力排行\]/);
    assert.match(script.text, /GetListString\s+\.\.\\QuestDiary\\04自定义变量\\战斗力\\战斗力排行\.txt\s+0\s+s\$战力排行名1\s+n\$战力排行1/i);
    return {
      provenance: 'real-gbk-snapshot',
      scriptBytes,
      listBytes,
      listText: list.text,
      sourcePaths: { script: REAL_SCRIPT_PATH, list: REAL_LIST_PATH },
      encodings: { script: script.encoding, list: list.encoding },
    };
  }

  return {
    provenance: 'embedded-gbk-fallback',
    scriptBytes: encodeTextFile(fallbackRankSource(), 'gbk'),
    listBytes: encodeTextFile('啊实打实的:1', 'gbk'),
    listText: '啊实打实的:1',
    sourcePaths: { script: REAL_SCRIPT_PATH, list: REAL_LIST_PATH },
    encodings: { script: 'gbk', list: 'gbk' },
  };
}

function deriveExpectedRows(listText) {
  const lines = String(listText || '').split(/\r\n|\n|\r/);
  return Array.from({ length: 10 }, (_, offset) => {
    const line = lines[offset];
    if (line === undefined) {
      return {
        name: '预览文字', value: '0', nameKnown: false, valueKnown: false,
      };
    }
    const separator = line.indexOf(':');
    const fields = separator >= 0
      ? [line.slice(0, separator), line.slice(separator + 1)]
      : line.split(':');
    return {
      name: fields[0] === undefined ? '预览文字' : fields[0].trim(),
      value: fields[1] === undefined ? '0' : fields[1].trim(),
      nameKnown: fields[0] !== undefined,
      valueKnown: fields[1] !== undefined,
    };
  });
}

function createRankWorkspaceSnapshot() {
  const input = loadRankBytes();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-real-rank-model-'));
  const scriptPath = path.join(
    temporary, 'MirServer', 'Mir200', 'Envir', 'QuestDiary', '02功能脚本', '战力排行.txt'
  );
  const listPath = path.join(
    temporary, 'MirServer', 'Mir200', 'Envir', 'QuestDiary',
    '04自定义变量', '战斗力', '战斗力排行.txt'
  );
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.mkdirSync(path.dirname(listPath), { recursive: true });
  fs.writeFileSync(scriptPath, input.scriptBytes);
  fs.writeFileSync(listPath, input.listBytes);
  return {
    ...input,
    temporary,
    scriptPath,
    listPath,
    cleanup() {
      removeTemporaryDirectory(temporary);
    },
  };
}

function rankSlot(element) {
  const raw = String(element?.raw || '');
  const name = /\(\s*s\$战力排行名(10|[1-9])\s*\)/i.exec(raw);
  if (name) return { column: 'name', index: Number(name[1]) };
  const value = /\(\s*n\$战力排行(10|[1-9])\s*\)/i.exec(raw);
  if (value) return { column: 'value', index: Number(value[1]) };
  return undefined;
}

function visibleText(element) {
  const runs = (element?.textPreview?.lines || [])
    .flatMap(line => (line || []).map(run => String(run?.text || '')))
    .join('');
  return runs || String(element?.text || '');
}

function buildRealRankModel() {
  const snapshot = createRankWorkspaceSnapshot();
  const resolver = new ScriptDataResolver();
  try {
    const decoded = decodeTextFile(fs.readFileSync(snapshot.scriptPath));
    assert.equal(decoded.encoding, 'gbk', 'the isolated real-world script snapshot lost its GBK encoding');
    const cursorOffset = decoded.text.indexOf('[@战力排行]');
    assert.ok(cursorOffset >= 0, 'the rank entry label is absent from the source snapshot');
    const model = parseNpcDialogDocument(decoded.text, {
      uri: pathToFileURL(snapshot.scriptPath).href,
      fileName: path.basename(snapshot.scriptPath),
      filePath: snapshot.scriptPath,
      documentVersion: 1,
      engine: 'GOM',
      engineLabel: 'GOM',
      cursorOffset: cursorOffset + '[@战力排行]'.length,
      offsets: workspaceNpcDialogOffsets(0, 0),
      catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
      dataOptions: resolver.optionsFor(snapshot.scriptPath),
    });
    return {
      model,
      source: decoded.text,
      provenance: snapshot.provenance,
      sourcePaths: snapshot.sourcePaths,
      encodings: snapshot.encodings,
      expectedRows: deriveExpectedRows(snapshot.listText),
      listBaseline: String(snapshot.listText || '').trim(),
      byteLengths: {
        script: snapshot.scriptBytes.length,
        list: snapshot.listBytes.length,
      },
    };
  } finally {
    resolver.dispose();
    snapshot.cleanup();
  }
}

function verifyRealRankModel(result) {
  const { model, source, expectedRows } = result;
  const page = model.pages.find(candidate => candidate.sourceLabel === '@战力排行');
  assert.ok(page, 'the production parser did not create the @战力排行 page');
  const rankElements = page.elements.filter(rankSlot);
  assert.equal(rankElements.length, 20, 'the ten-row, two-column rank body is incomplete');

  const slots = new Map(rankElements.map(element => {
    const slot = rankSlot(element);
    return [`${slot.column}:${slot.index}`, element];
  }));
  assert.equal(slots.size, 20, 'rank fields collapsed onto duplicate model slots');

  for (let index = 1; index <= 10; index++) {
    const name = slots.get(`name:${index}`);
    const value = slots.get(`value:${index}`);
    assert.ok(name && value, `rank row ${index} lost one of its two columns`);
    const expected = expectedRows[index - 1];
    assert.equal(visibleText(name), expected.name,
      `rank row ${index} name does not follow the determined/placeholder contract`);
    assert.equal(visibleText(value), expected.value,
      `rank row ${index} value does not follow the determined/zero contract`);
    assert.equal(name.textPreview?.textValueStatus,
      expected.nameKnown ? 'resolved-static' : 'runtime-placeholder');
    assert.equal(value.textPreview?.textValueStatus,
      expected.valueKnown ? 'resolved-static' : 'runtime-placeholder');
    for (const element of [name, value]) {
      assert.ok(element.width > 0 && element.height > 0,
        `rank row ${index} has no positive model geometry`);
      assert.equal(element.editable, true,
        `rank row ${index} has literal coordinates and must remain editable`);
      assert.ok(element.x && element.y,
        `rank row ${index} lost its exact coordinate source spans`);
      assert.equal(source.slice(element.sourceRange.start, element.sourceRange.end), element.raw,
        `rank row ${index} lost its auditable original source range`);
      assert.match(element.raw, /<\$str\(/i,
        `rank row ${index} no longer retains the original expression in Inspector provenance`);
      assert.doesNotMatch(visibleText(element), /<\$str\(/i,
        `rank row ${index} leaked source syntax into the visible preview`);
    }
  }

  for (let index = 1; index <= 3; index++) {
    const linked = slots.get(`name:${index}`);
    assert.equal(linked.runtimeActionPreview?.link, '@查看装备');
    assert.equal(linked.runtimeActionPreview?.localOnly, true,
      `rank link ${index} is not explicitly confined to local preview`);
  }
  for (let index = 1; index <= 3; index++) {
    const action = slots.get(`name:${index}`).runtimeActionPreview;
    const expected = expectedRows[index - 1];
    if (expected.nameKnown) {
      assert.deepEqual(action?.parameters, [expected.name],
        `rank link ${index} lost its determined local-preview parameter`);
      assert.ok(!action?.dynamicFields?.includes('link-parameters'),
        `rank link ${index} incorrectly blocks a determined parameter`);
    } else {
      assert.ok(action?.dynamicFields?.includes('link-parameters'),
        `rank link ${index} should remain action-blocked while its visible label stays useful`);
    }
  }

  assert.equal(model.conditionGroups.find(group => (
    group.conditions?.some(line => /small\s+G701\s+<\$timeunixs>/i.test(line))
  ))?.satisfied, false, 'the default probe path must not simulate the runtime writer');
}

function main() {
  const result = buildRealRankModel();
  verifyRealRankModel(result);
  console.log(`real-rank-canvas-usability.test.js: fixture=${result.provenance}`);
  console.log(`real-rank-canvas-usability.test.js: encoding=${result.encodings.script}/${result.encodings.list}`);
  console.log(`real-rank-canvas-usability.test.js: bytes=${result.byteLengths.script}/${result.byteLengths.list}`);
  console.log(`real-rank-canvas-usability.test.js: list-baseline=${JSON.stringify(result.listBaseline)}`);
  console.log(`real-rank-canvas-usability.test.js: runtime-root=${RUNTIME_ROOT}`);
  console.log('real-rank-canvas-usability.test.js: PASS (10 rows x 2 columns)');
}

if (require.main === module) main();

module.exports = {
  REAL_SCRIPT_PATH,
  REAL_LIST_PATH,
  REPOSITORY_ROOT,
  RUNTIME_ROOT,
  buildRealRankModel,
  rankSlot,
  verifyRealRankModel,
  visibleText,
};
