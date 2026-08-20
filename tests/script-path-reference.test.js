const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function main() {
  const {
    findScriptCommandPathReferences,
    findScriptPathReferenceAt,
    findScriptPathReferences,
    isPathInside,
    resolveScriptPathReference,
  } = require('../out/utils/path');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-script-path-'));
  try {
    const envir = path.join(root, 'Mir200', 'Envir');
    const source = path.join(envir, 'QuestDiary', '入口.txt');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, '', 'utf8');

    const callTarget = path.join(envir, 'QuestDiary', '01属性加载', '人物属性1.txt');
    fs.mkdirSync(path.dirname(callTarget), { recursive: true });
    fs.writeFileSync(callTarget, '[@人物属性]\r\n', 'utf8');
    const callLine = '#CALL [\\01属性加载\\人物属性1.txt] @人物属性';
    const callReference = findScriptCommandPathReferences(callLine)[0];
    assert.equal(callReference.kind, 'scriptCall');
    assert.equal(callReference.directive, '#CALL');
    assert.equal(callReference.path, '\\01属性加载\\人物属性1.txt');
    assert.equal(callLine.slice(callReference.start, callReference.end), callReference.path);
    assert.equal(callReference.label, '人物属性');
    assert.equal(
      resolveScriptPathReference(root, source, callReference.path, 'questDiary').existingPath,
      callTarget
    );

    const callExLine = '#CALLEX [01属性加载\\人物属性1.txt] @人物属性';
    const callExReference = findScriptCommandPathReferences(callExLine)[0];
    assert.equal(callExReference.kind, 'scriptCall');
    assert.equal(callExReference.directive, '#CALLEX');
    assert.equal(
      resolveScriptPathReference(root, source, callExReference.path, 'questDiary').existingPath,
      callTarget
    );

    const sharedTarget = path.join(root, 'Shared', '跨目录脚本.txt');
    fs.mkdirSync(path.dirname(sharedTarget), { recursive: true });
    fs.writeFileSync(sharedTarget, '[@入口]\r\n', 'utf8');
    const traversingCall = '..\\..\\..\\Shared\\跨目录脚本.txt';
    const traversingResolution = resolveScriptPathReference(root, source, traversingCall, 'questDiary');
    assert.equal(traversingResolution.existingPath, sharedTarget);
    assert.equal(
      resolveScriptPathReference(root, source, '..\\..\\..\\Shared\\不存在.txt', 'questDiary').createPath,
      undefined,
      'traversing script calls may open existing files but must never create through traversal'
    );

    const defines = path.join(envir, 'Defines');
    const includeTarget = path.join(defines, '全局常量配置.ini');
    fs.mkdirSync(defines, { recursive: true });
    fs.writeFileSync(includeTarget, '#DEFINE $测试 1\r\n', 'utf8');
    const includeLine = '#INCLUDE 全局常量配置.ini';
    const includeReference = findScriptCommandPathReferences(includeLine)[0];
    assert.equal(includeReference.kind, 'include');
    assert.equal(includeReference.directive, '#INCLUDE');
    assert.equal(includeReference.path, '全局常量配置.ini');
    assert.equal(
      resolveScriptPathReference(root, source, includeReference.path, 'defines').existingPath,
      includeTarget
    );

    const line = 'CHECKTEXTLIST ..\\QuestDiary\\03游戏触发\\奖励.txt';
    const expectedReference = '..\\QuestDiary\\03游戏触发\\奖励.txt';
    const reference = findScriptPathReferenceAt(line, line.indexOf('游戏触发'));
    assert.deepEqual(reference, {
      path: expectedReference,
      start: line.indexOf(expectedReference),
      end: line.indexOf(expectedReference) + expectedReference.length,
    });

    const expectedTarget = path.join(envir, 'QuestDiary', '03游戏触发', '奖励.txt');
    let resolution = resolveScriptPathReference(root, source, reference.path);
    assert.equal(resolution.existingPath, undefined);
    assert.equal(resolution.createPath, expectedTarget);
    assert.ok(resolution.candidates.includes(expectedTarget));

    fs.mkdirSync(path.dirname(expectedTarget), { recursive: true });
    fs.writeFileSync(expectedTarget, '[@MAIN]\r\n', 'utf8');
    resolution = resolveScriptPathReference(root, source, reference.path);
    assert.equal(resolution.existingPath, expectedTarget);

    const localReference = '.\\配置\\选项.ini';
    assert.equal(
      resolveScriptPathReference(root, source, localReference).createPath,
      path.join(path.dirname(source), '配置', '选项.ini')
    );
    assert.equal(findScriptPathReferenceAt('; CHECKTEXTLIST ..\\QuestDiary\\隐藏.txt', 25), undefined);
    assert.equal(findScriptPathReferenceAt('CHECKTEXTLIST 单文件.txt', 18), undefined);
    assert.deepEqual(
      findScriptPathReferences('CHECKTEXTLIST ..\\QuestDiary\\甲.txt .\\配置\\乙.ini ; ..\\隐藏.txt')
        .map(item => item.path),
      ['..\\QuestDiary\\甲.txt', '.\\配置\\乙.ini']
    );
    assert.deepEqual(resolveScriptPathReference(root, source, '..\\..\\外部.txt').candidates, []);
    assert.equal(isPathInside(root, expectedTarget), true);
    assert.equal(isPathInside(root, path.join(root, '..', '外部.txt')), false);

    const assistant = fs.readFileSync(path.join(__dirname, '..', 'src', 'assistant.ts'), 'utf8');
    assert.match(assistant, /findScriptPathReferenceAt\(line, charPos\)/);
    const definitionStart = assistant.indexOf('// 4. 路径引用跳转');
    const definitionEnd = assistant.indexOf('// 5. merchant.txt', definitionStart);
    assert.ok(definitionStart >= 0 && definitionEnd > definitionStart);
    const pathDefinitionBlock = assistant.slice(definitionStart, definitionEnd);
    assert.doesNotMatch(pathDefinitionBlock, /executeCommand|boo\.createMissingFile|showWarningMessage/);
    assert.match(
      assistant,
      /registerDocumentLinkProvider[\s\S]*findScriptCommandPathReferences[\s\S]*command:boo\.createMissingFile/
    );
    assert.doesNotMatch(assistant, /if \(\/\^\\s\*#CALL\\b\/i\.test\(line\)\) continue/);
    assert.match(assistant, /referenceKind:\s*'pathReference'\s*\|\s*'scriptCall'\s*\|\s*'include'/);
    assert.match(assistant, /#\(\?:CALL\|CALLEX\)引用的文件可能不存在/);
    assert.match(assistant, /Ctrl\+左键：文件不存在，可选择创建文本/);
    assert.match(assistant, /引用文件不存在：[\s\S]*是否自动创建空白文本文件/);
    assert.match(assistant, /\{ modal: true \}[\s\S]*'创建文本'/);
    assert.match(assistant, /isPathInside\(wsRoot, finalPath\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('script-path-reference.test.js: PASS');
}

main();
