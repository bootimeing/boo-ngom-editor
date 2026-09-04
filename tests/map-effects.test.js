const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const iconv = require('iconv-lite');

function writeScript(filePath, lines, encoding = 'gbk') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const text = Array.isArray(lines) ? lines.join('\r\n') : lines;
  fs.writeFileSync(filePath, encoding === 'gbk' ? iconv.encode(text, 'gbk') : text, encoding === 'gbk' ? undefined : 'utf8');
}

function diagnosticCodes(result) {
  return new Set(result.diagnostics.map(item => item.code));
}

function buildFixture(root) {
  const envir = path.join(root, 'Mir200', 'Envir');
  const qmanage = path.join(envir, 'MapQuest_Def', 'QManage.txt');
  const main = path.join(envir, 'QuestDiary', '效果', '主.txt');
  const child = path.join(envir, 'QuestDiary', '效果', '子.txt');
  const sibling = path.join(envir, 'QuestDiary', '效果', '同目录.txt');
  const local = path.join(envir, 'MapQuest_Def', '本地.txt');
  const shared = path.join(envir, '共享.txt');
  const conditional = path.join(envir, 'QuestDiary', '效果', '条件.txt');
  const outside = path.join(root, 'Mir200', '外部.txt');

  writeScript(qmanage, [
    '[@Startup]',
    '#IF',
    '#ACT',
    '#CALL [\\效果\\主.txt] @入口',
    '#CALL [.\\本地.txt] @本地',
    '#CALL [Envir\\共享.txt] @共享',
    '#IF',
    'CHECKLEVELEX > 0',
    '#ACT',
    '#CALL [\\效果\\条件.txt] @入口',
    '#IF',
    '#ACT',
    '#CALL [\\效果\\<$STR(S0)>.txt] @入口',
    '#CALL [..\\..\\外部.txt] @逃逸',
    '#CALLEX [\\效果\\条件.txt] @入口',
    '[@Login]',
    '#IF',
    '#ACT',
    '#CALL [\\效果\\条件.txt] @入口',
  ]);

  writeScript(main, [
    '[@入口]',
    '{',
    '#IF',
    '#ACT',
    'MAPEFFECT 静态地图 10 20 9 320 12 -1 150 0 0|0|1',
    'MAPEFFECT 有限地图 10 20 9 320 12 1 150 0 0|0|1',
    'MAPEFFECT 混合地图 10 20 9 320 12 -1 150 1 0|0|1',
    'MAPEFFECT 私人地图 10 20 9 320 12 -1 150 0 0|1|1',
    'MAPEFFECT 空格尾地图 10 20 9 320 12 -1 150 0 0 0 1',
    'MAPEFFECT <$MAP> 10 20 9 320 12 -1 150 0 0|0|1',
    'MAPEFFECT 变量素材 10 20 <$STR(N0)> 320 12 -1 150 0 0|0|1',
    'M.MAPEFFECT 前缀地图 10 20 9 320 12 -1 150 0 0|0|1',
    '; MAPEFFECT 注释地图 10 20 9 320 12 -1 150 0 0|0|1',
    '#IF',
    'EQUAL A1 开启',
    '#ACT',
    'MAPEFFECT 条件地图 10 20 9 320 12 -1 150 0 0|0|1',
    '#ELSEACT',
    'MAPEFFECT ELSE地图 10 20 9 320 12 -1 150 0 0|0|1',
    '#IF',
    '#ACT',
    '#CALL [子.txt] @子入口',
    '}',
    'MAPEFFECT 花括号外 10 20 9 320 12 -1 150 0 0|0|1',
    '[@其它]',
    '#IF',
    '#ACT',
    'MAPEFFECT 其它标签 10 20 9 320 12 -1 150 0 0|0|1',
  ]);

  writeScript(child, [
    '[@子入口]',
    '#IF',
    '#ACT',
    'MAPEFFECT 子调用地图 30 40 9 340 12 -1 150 0 0|0|2',
    '#CALL [同目录.txt] @同目录',
    '#CALL [\\效果\\主.txt] @入口',
  ]);
  writeScript(sibling, [
    '[@同目录]',
    '#IF',
    '#ACT',
    'MAPEFFECT 同目录地图 50 60 9 360 10 -1 150 0 0|0|3',
  ]);
  writeScript(local, [
    '[@本地]',
    '#IF',
    '#ACT',
    'MAPEFFECT 当前目录地图 1 2 9 620 8 -1 150 0 0|0|4',
  ]);
  writeScript(shared, [
    '[@共享]',
    '#IF',
    '#ACT',
    'MAPEFFECT Envir地图 3 4 9 620 8 -1 150 0 0|0|5',
  ]);
  writeScript(conditional, [
    '[@入口]',
    '#IF',
    '#ACT',
    'MAPEFFECT 不应到达 1 1 9 1 1 -1 150 0 0|0|1',
  ]);
  writeScript(outside, [
    '[@逃逸]',
    '#IF',
    '#ACT',
    'MAPEFFECT 越界地图 1 1 9 1 1 -1 150 0 0|0|1',
  ]);
  return envir;
}

function testConservativeGbkScan(scanStartupPermanentMapEffects) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-effects-'));
  try {
    const envir = buildFixture(root);
    const result = scanStartupPermanentMapEffects(envir);
    assert.deepEqual(
      result.definitions.map(item => item.mapName),
      ['静态地图', '子调用地图', '同目录地图', '当前目录地图', 'Envir地图']
    );
    assert.deepEqual(
      result.definitions[0],
      {
        mapName: '静态地图',
        x: 10,
        y: 20,
        wilIndex: 9,
        startImage: 320,
        frameCount: 12,
        playCount: -1,
        speedMs: 150,
        drawMode: 0,
        brightness: 0,
        visibility: 0,
        effectId: 1,
        sourceFile: fs.realpathSync(path.join(envir, 'QuestDiary', '效果', '主.txt')),
        lineNumber: 5,
      }
    );
    assert.equal(result.scannedFiles.length, 6, 'conditional, dynamic and escaping calls must not read targets');
    assert.ok(result.totalBytes > 0);
    assert.equal(result.skippedDefinitionCount, 10);
    assert.equal(result.truncated, false);

    const codes = diagnosticCodes(result);
    for (const code of [
      'conditional-block',
      'conditional-call',
      'dynamic-call',
      'call-outside-envir',
      'unsupported-call',
      'finite-play-count',
      'unsupported-draw-mode',
      'non-global-visibility',
      'noncanonical-tail',
      'dynamic-map-name',
      'nonliteral-core',
      'prefixed-mapeffect',
      'commented-mapeffect',
      'conditional-mapeffect',
      'else-block',
      'call-cycle',
    ]) {
      assert.ok(codes.has(code), `missing diagnostic ${code}`);
      assert.ok(result.diagnosticCounts[code] >= 1, `missing diagnostic count ${code}`);
    }
    assert.ok(!result.definitions.some(item => item.mapName === '花括号外'));
    assert.ok(!result.definitions.some(item => item.mapName === '其它标签'));
    assert.ok(!result.definitions.some(item => item.mapName === '不应到达'));
    assert.ok(!result.definitions.some(item => item.mapName === '越界地图'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testEncodingContainmentSectionsAndDelete(scanStartupPermanentMapEffects) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-effects-safety-'));
  try {
    const envir = path.join(root, 'Mir200', 'Envir');
    const questDiary = path.join(envir, 'QuestDiary');
    const qmanage = path.join(envir, 'MapQuest_Def', 'QManage.txt');
    const sequence = path.join(questDiary, '效果', '顺序.txt');
    const sections = path.join(questDiary, '效果', '分节.txt');
    const utf16 = path.join(questDiary, '效果', 'UTF16.txt');
    const envirRelative = path.join(envir, 'Envir相对.txt');
    const rootedEscape = path.join(envir, 'MapQuest_Def', '根逃逸.txt');
    const outsideDirectory = path.join(root, '外部QuestDiary');
    const junction = path.join(questDiary, '效果', '联接');

    writeScript(sequence, [
      '[@入口]',
      '{',
      '#IF',
      '#ACT',
      'MAPEFFECT 随后删除 1 1 9 1 1 -1 150 0 0|0|1',
      'DELMAPEFFECT 0 0 0 0 0 0 0 0 0 0|0|1',
      'MAPEFFECT 删除后保留 2 2 9 2 1 -1 150 0 0|0|2',
      '#CALL [..\\..\\MapQuest_Def\\根逃逸.txt] @入口',
      '#CALL [联接\\外部.txt] @入口',
      '}',
      'MAPEFFECT 花括号外 3 3 9 3 1 -1 150 0 0|0|3',
    ]);
    writeScript(sections, [
      '[@入口]',
      '#IF',
      '#ACT',
      'MAPEFFECT 分节前 4 4 9 4 1 -1 150 0 0|0|4',
      '[UNKNOWN_SECTION]',
      '#IF',
      '#ACT',
      'MAPEFFECT 分节后 5 5 9 5 1 -1 150 0 0|0|5',
    ]);
    writeScript(envirRelative, [
      '[@入口]',
      '#IF',
      '#ACT',
      'MAPEFFECT Envir显式路径 6 6 9 6 1 -1 150 0 0|0|6',
    ]);
    writeScript(rootedEscape, [
      '[@入口]',
      '#IF',
      '#ACT',
      'MAPEFFECT 根路径逃逸 7 7 9 7 1 -1 150 0 0|0|7',
    ]);

    fs.mkdirSync(path.dirname(utf16), { recursive: true });
    fs.writeFileSync(
      utf16,
      Buffer.from('\uFEFF[@入口]\r\n#IF\r\n#ACT\r\nMAPEFFECT UTF16地图 8 8 9 8 1 -1 150 0 0|0|8', 'utf16le')
    );

    fs.mkdirSync(outsideDirectory, { recursive: true });
    writeScript(path.join(outsideDirectory, '外部.txt'), [
      '[@入口]',
      '#IF',
      '#ACT',
      'MAPEFFECT 真实路径逃逸 9 9 9 9 1 -1 150 0 0|0|9',
    ]);
    fs.mkdirSync(path.dirname(junction), { recursive: true });
    fs.symlinkSync(outsideDirectory, junction, process.platform === 'win32' ? 'junction' : 'dir');

    const qmanageText = [
      '[@Startup]',
      '#IF',
      '#ACT',
      '#CALL [\\效果\\顺序.txt] @入口',
      '#CALL [\\效果\\分节.txt] @入口',
      '#CALL [Envir\\Envir相对.txt] @入口',
      '#CALL [\\..\\MapQuest_Def\\根逃逸.txt] @入口',
      '#CALL [\\效果\\UTF16.txt] @入口',
      '#CALL [\\效果\\联接\\外部.txt] @入口',
    ].join('\r\n');
    fs.mkdirSync(path.dirname(qmanage), { recursive: true });
    fs.writeFileSync(
      qmanage,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(qmanageText, 'utf8')])
    );

    const result = scanStartupPermanentMapEffects(envir);
    assert.deepEqual(
      result.definitions.map(item => item.mapName),
      ['删除后保留', '分节前', 'Envir显式路径']
    );
    assert.equal(result.skippedDefinitionCount, 1, '被无条件删除的定义应转为 skipped');
    assert.equal(result.diagnosticCounts['delete-after-create-unsupported'], 1);
    assert.equal(result.diagnosticCounts['unsupported-encoding'], 1);
    assert.ok(result.diagnosticCounts['call-outside-envir'] >= 2);
    assert.equal(result.truncated, false);
    assert.ok(!result.definitions.some(item => item.mapName === '花括号外'));
    assert.ok(!result.definitions.some(item => item.mapName === '分节后'));
    assert.ok(!result.definitions.some(item => item.mapName === '根路径逃逸'));
    assert.ok(!result.definitions.some(item => item.mapName === '真实路径逃逸'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testRenderingSafetyBounds(scanStartupPermanentMapEffects) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-effects-ranges-'));
  try {
    const envir = path.join(root, 'Mir200', 'Envir');
    writeScript(path.join(envir, 'MapQuest_Def', 'QManage.txt'), [
      '[@Startup]',
      '#IF',
      '#ACT',
      'MAPEFFECT 边界可用 65535 65535 65535 10000000 1024 -1 16 0 0|0|1',
      'MAPEFFECT 亮度未验证 1 1 9 1 1 -1 150 0 1|0|1',
      'MAPEFFECT 帧数过大 1 1 9 1 1025 -1 150 0 0|0|1',
      'MAPEFFECT 速度过快 1 1 9 1 1 -1 15 0 0|0|1',
      'MAPEFFECT 速度过慢 1 1 9 1 1 -1 60001 0 0|0|1',
      'MAPEFFECT WIL过大 1 1 65536 1 1 -1 150 0 0|0|1',
      'MAPEFFECT 起始帧过大 1 1 9 10000001 1 -1 150 0 0|0|1',
      'MAPEFFECT 坐标过大 65536 1 9 1 1 -1 150 0 0|0|1',
    ]);
    fs.mkdirSync(path.join(envir, 'QuestDiary'), { recursive: true });

    const result = scanStartupPermanentMapEffects(envir);
    assert.deepEqual(result.definitions.map(item => item.mapName), ['边界可用']);
    assert.equal(result.skippedDefinitionCount, 7);
    assert.equal(result.diagnosticCounts['unsupported-brightness'], 1);
    assert.equal(result.diagnosticCounts['invalid-core-range'], 6);
    assert.equal(result.truncated, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testBudgetsAndMalformedBlocks(scanStartupPermanentMapEffects) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-effects-budget-'));
  try {
    const envir = buildFixture(root);
    const depthLimited = scanStartupPermanentMapEffects(envir, { maxDepth: 0 });
    assert.equal(depthLimited.definitions.length, 0);
    assert.ok(depthLimited.diagnosticCounts['depth-budget-exceeded'] >= 1);
    assert.equal(depthLimited.truncated, true);

    const partialDepthLimited = scanStartupPermanentMapEffects(envir, { maxDepth: 1 });
    assert.equal(
      partialDepthLimited.definitions.length,
      0,
      '触发预算后不得暴露可能被未扫描 DELMAPEFFECT 撤销的部分集合'
    );
    assert.equal(partialDepthLimited.truncated, true);

    const effectLimited = scanStartupPermanentMapEffects(envir, { maxEffects: 1 });
    assert.equal(effectLimited.definitions.length, 0);
    assert.equal(effectLimited.diagnosticCounts['effect-budget-exceeded'], 1);
    assert.equal(effectLimited.truncated, true);

    const fileLimited = scanStartupPermanentMapEffects(envir, { maxFiles: 1 });
    assert.equal(fileLimited.definitions.length, 0);
    assert.ok(fileLimited.diagnosticCounts['file-budget-exceeded'] >= 1);
    assert.equal(fileLimited.truncated, true);

    const byteLimited = scanStartupPermanentMapEffects(envir, { maxTotalBytes: 1 });
    assert.equal(byteLimited.definitions.length, 0);
    assert.equal(byteLimited.diagnosticCounts['byte-budget-exceeded'], 1);
    assert.equal(byteLimited.truncated, true);

    const malformed = path.join(envir, 'QuestDiary', '效果', '未闭合.txt');
    writeScript(malformed, [
      '[@入口]',
      '{',
      '#IF',
      '#ACT',
      'MAPEFFECT 不可信地图 1 1 9 1 1 -1 150 0 0|0|1',
    ]);
    writeScript(path.join(envir, 'MapQuest_Def', 'QManage.txt'), [
      '[@Startup]',
      '#IF',
      '#ACT',
      '#CALL [\\效果\\未闭合.txt] @入口',
    ]);
    const malformedResult = scanStartupPermanentMapEffects(envir);
    assert.equal(malformedResult.definitions.length, 0);
    assert.equal(malformedResult.diagnosticCounts['malformed-label-block'], 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testSameFileCallWidthBudget(scanStartupPermanentMapEffects) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-effects-call-width-'));
  try {
    const envir = path.join(root, 'Mir200', 'Envir');
    const callCount = 257;
    const qmanageLines = ['[@Startup]', '#IF', '#ACT'];
    const sharedLines = [];
    for (let index = 0; index < callCount; index++) {
      qmanageLines.push(`#CALL [\\效果\\同文件.txt] @入口${index}`);
      sharedLines.push(
        `[@入口${index}]`,
        '#IF',
        '#ACT',
        `MAPEFFECT 宽度地图${index} ${index} ${index} 9 ${index} 1 -1 150 0 0|0|${index + 1}`
      );
    }
    writeScript(path.join(envir, 'MapQuest_Def', 'QManage.txt'), qmanageLines);
    writeScript(path.join(envir, 'QuestDiary', '效果', '同文件.txt'), sharedLines);

    const originalIndexOf = String.prototype.indexOf;
    let inlineCommentLookups = 0;
    let limited;
    String.prototype.indexOf = function trackedIndexOf(searchValue, ...args) {
      if (searchValue === ';') inlineCommentLookups++;
      return originalIndexOf.call(this, searchValue, ...args);
    };
    try {
      limited = scanStartupPermanentMapEffects(envir, {
        maxCalls: 256,
        maxEffects: 1024,
      });
    } finally {
      String.prototype.indexOf = originalIndexOf;
    }
    assert.equal(limited.definitions.length, 0, '静态 #CALL 宽度预算触发后必须清空部分结果');
    assert.equal(limited.diagnosticCounts['call-budget-exceeded'], 1);
    assert.equal(limited.truncated, true);
    assert.equal(limited.scannedFiles.length, 2, '同文件不同标签应只解码一次目标脚本');
    assert.equal(limited.skippedDefinitionCount, 256);
    assert.ok(
      inlineCommentLookups < 10_000,
      `同文件标签查找疑似逐次全文件重扫：stripInlineComment 调用 ${inlineCommentLookups} 次`
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const {
    DEFAULT_MAP_EFFECT_SCAN_LIMITS,
    scanStartupPermanentMapEffects,
  } = require('../out/utils/map-effects');
  assert.deepEqual(DEFAULT_MAP_EFFECT_SCAN_LIMITS, {
    maxDepth: 8,
    maxFiles: 64,
    maxTotalBytes: 2 * 1024 * 1024,
    maxEffects: 4096,
    maxCalls: 4096,
  });
  testConservativeGbkScan(scanStartupPermanentMapEffects);
  testEncodingContainmentSectionsAndDelete(scanStartupPermanentMapEffects);
  testRenderingSafetyBounds(scanStartupPermanentMapEffects);
  testBudgetsAndMalformedBlocks(scanStartupPermanentMapEffects);
  testSameFileCallWidthBudget(scanStartupPermanentMapEffects);
  console.log('map-effects.test.js: PASS');
}

main();
