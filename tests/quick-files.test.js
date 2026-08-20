const assert = require('node:assert/strict');
const path = require('node:path');

function main() {
  const {
    buildQuickFileCandidates,
    createCustomQuickFileDefinition,
    customQuickFilePathError,
    normalizeCustomQuickFilePaths,
    normalizeMir200RelativePath,
    QUICK_FILE_DEFINITIONS,
    quickFileDisplayPath,
  } = require('../out/utils/quick-files');

  assert.deepEqual(
    QUICK_FILE_DEFINITIONS.map(item => item.fileName),
    [
      'QManage.txt',
      'QFunction-0.txt',
      'MerChant.txt',
      'MapInfo.txt',
      'MonGen.txt',
      'MapEvent.txt',
      'AutoRunRobot.txt',
      'RobotManage.txt',
    ]
  );
  assert.ok(
    QUICK_FILE_DEFINITIONS.every(item => item.description.trim().length > 0),
    'every quick file must explain its purpose'
  );

  const qManage = QUICK_FILE_DEFINITIONS[0];
  assert.equal(
    quickFileDisplayPath(qManage),
    path.join('Mir200', 'Envir', 'MapQuest_Def', 'QManage.txt')
  );
  const fromActiveDocument = buildQuickFileCandidates(
    'D:\\MirServer',
    'D:\\MirServer',
    'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\test.txt',
    qManage
  );
  assert.equal(
    fromActiveDocument[0],
    path.resolve('D:\\MirServer\\Mir200\\Envir\\MapQuest_Def\\QManage.txt')
  );

  const robotManage = QUICK_FILE_DEFINITIONS.at(-1);
  const nestedServer = buildQuickFileCandidates(
    'D:\\996PC',
    'D:\\996PC\\Mirserver',
    undefined,
    robotManage
  );
  assert.ok(nestedServer.some(candidate => candidate === path.resolve(
    'D:\\996PC\\Mirserver\\Mir200\\Envir\\Robot_def\\RobotManage.txt'
  )));

  assert.equal(
    normalizeMir200RelativePath('Envir\\QuestDiary\\功能脚本\\测试.txt'),
    'Envir/QuestDiary/功能脚本/测试.txt'
  );
  assert.equal(
    normalizeMir200RelativePath('"Mir200\\Envir\\QuestDiary\\测试.txt"'),
    'Envir/QuestDiary/测试.txt'
  );
  assert.match(customQuickFilePathError('D:\\MirServer\\Mir200\\Envir\\测试.txt'), /相对于 Mir200/);
  assert.match(customQuickFilePathError('Envir\\..\\..\\测试.txt'), /不能使用 \.\./);
  assert.equal(normalizeMir200RelativePath('Envir\\QuestDiary\\'), undefined);
  assert.deepEqual(
    normalizeCustomQuickFilePaths([
      'Envir\\QuestDiary\\测试.txt',
      'envir/questdiary/测试.txt',
      123,
      '..\\越界.txt',
    ]),
    ['Envir/QuestDiary/测试.txt']
  );

  const custom = createCustomQuickFileDefinition('Envir/QuestDiary/功能脚本/测试.txt');
  assert.equal(custom.fileName, '测试.txt');
  assert.equal(
    quickFileDisplayPath(custom),
    path.join('Mir200', 'Envir', 'QuestDiary', '功能脚本', '测试.txt')
  );
  const customCandidates = buildQuickFileCandidates(
    'D:\\MirServer',
    'D:\\MirServer',
    'D:\\MirServer\\Mir200\\Envir\\Market_Def\\当前.txt',
    custom
  );
  assert.equal(
    customCandidates[0],
    path.resolve('D:\\MirServer\\Mir200\\Envir\\QuestDiary\\功能脚本\\测试.txt')
  );

  const manifest = require('../package.json');
  const commands = new Map(manifest.contributes.commands.map(item => [item.command, item]));
  assert.equal(commands.get('boo.openQuickFiles').title, '快捷文件');
  assert.equal(commands.get('boo.saveAll').title, '全部保存');
  const editorTitle = manifest.contributes.menus['editor/title'];
  assert.deepEqual(
    editorTitle.map(item => item.command),
    ['boo.openQuickFiles', 'boo.saveAll']
  );
  assert.ok(editorTitle[0].group < editorTitle[1].group, '快捷文件必须位于全部保存左侧');

  const commandSource = require('node:fs').readFileSync('src/commands/quick-files.ts', 'utf8');
  assert.match(commandSource, /workspaceState\.get/);
  assert.match(commandSource, /添加自定义文件/);
  assert.match(commandSource, /移除自定义文件/);

  console.log('quick-files.test.js: PASS');
}

main();
