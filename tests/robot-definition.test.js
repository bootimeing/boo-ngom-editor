const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function main() {
  const {
    findAutoRunRobotLabelAt,
    findScriptLabelPosition,
    isAutoRunRobotFile,
    resolveRobotManageFile,
  } = require('../out/utils/robot-definition');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-robot-definition-'));
  try {
    const robotDir = path.join(root, 'Mir200', 'Envir', 'Robot_def');
    fs.mkdirSync(robotDir, { recursive: true });
    const autoRunPath = path.join(robotDir, 'AutoRunRobot.txt');
    const managePath = path.join(robotDir, 'RobotManage.txt');
    fs.writeFileSync(autoRunPath, '', 'utf8');
    fs.writeFileSync(managePath, '\ufeff\r\n[@每秒执行]\r\n#ACT\r\n', 'utf8');

    assert.equal(isAutoRunRobotFile(autoRunPath), true);
    assert.equal(isAutoRunRobotFile(path.join(robotDir, 'Other.txt')), false);
    assert.equal(isAutoRunRobotFile(path.join(root, 'AutoRunRobot.txt')), false);

    const line = '#AutoRun NPC SEC 1 @每秒执行';
    const at = line.indexOf('@');
    assert.equal(findAutoRunRobotLabelAt(autoRunPath, line, at), '每秒执行');
    assert.equal(findAutoRunRobotLabelAt(autoRunPath, line, at + 3), '每秒执行');
    assert.equal(findAutoRunRobotLabelAt(autoRunPath, line, at - 1), undefined);
    assert.equal(findAutoRunRobotLabelAt(autoRunPath, `; ${line}`, at + 2), undefined);
    assert.equal(findAutoRunRobotLabelAt(path.join(robotDir, 'Other.txt'), line, at), undefined);

    const protectedLine = '#AutoRun NPC SEC 1 @_@神秘代码#';
    assert.equal(
      findAutoRunRobotLabelAt(autoRunPath, protectedLine, protectedLine.indexOf('神')),
      '_@神秘代码#'
    );
    const symbolLine = '#AutoRun NPC SEC 1 @sfjdkjhs*';
    assert.equal(
      findAutoRunRobotLabelAt(autoRunPath, symbolLine, symbolLine.indexOf('*')),
      'sfjdkjhs*'
    );

    assert.equal(resolveRobotManageFile(autoRunPath), managePath);
    assert.deepEqual(findScriptLabelPosition('\r\n[@每秒执行]\r\n#ACT', '每秒执行'), {
      line: 1,
      character: 0,
    });
    assert.deepEqual(findScriptLabelPosition('  [@MAIN]\n', 'main'), {
      line: 0,
      character: 2,
    });
    assert.equal(findScriptLabelPosition('文字 [@每秒执行]\n', '每秒执行'), undefined);
    assert.equal(findScriptLabelPosition('[@其他函数]\n', '每秒执行'), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log('robot-definition.test.js: PASS');
}

main();
