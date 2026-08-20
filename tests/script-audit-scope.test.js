const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function main() {
  const {
    isWorkspaceScriptAuditPath,
    workspaceScriptAuditGlobs,
  } = require('../out/utils/script-audit-scope');

  for (const directory of ['MapQuest_Def', 'Market_Def', 'QuestDiary', 'Robot_def']) {
    assert.equal(
      isWorkspaceScriptAuditPath(`D:\\MirServer\\Mir200\\Envir\\${directory}\\子目录\\脚本.txt`),
      true
    );
    assert.equal(
      isWorkspaceScriptAuditPath(`D:/MirServer/Mir200/ENVIR/${directory.toLowerCase()}/脚本.TXT`),
      true
    );
  }
  assert.equal(isWorkspaceScriptAuditPath('D:\\MirServer\\Mir200\\Envir\\Npc_Def\\脚本.txt'), false);
  assert.equal(isWorkspaceScriptAuditPath('D:\\MirServer\\Mir200\\EnvirBackup\\Market_Def\\脚本.txt'), false);
  assert.equal(isWorkspaceScriptAuditPath('D:\\MirServer\\Mir200\\Envir\\Market_Def\\脚本.lua'), false);
  assert.deepEqual(workspaceScriptAuditGlobs(), [
    '**/Envir/MapQuest_Def/**/*.txt',
    '**/Envir/Market_Def/**/*.txt',
    '**/Envir/QuestDiary/**/*.txt',
    '**/Envir/Robot_def/**/*.txt',
  ]);

  const assistant = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'assistant.ts'),
    'utf8'
  );
  assert.match(assistant, /scanHumanGuildDecls\(\)[\s\S]*diagnoseWorkspaceScriptFiles\(false\)/);
  assert.match(assistant, /onDidSaveTextDocument\(doc =>[\s\S]*diagnoseDocumentNow\(doc\)/);
  assert.match(assistant, /onDidCloseTextDocument\(doc =>[\s\S]*isWorkspaceScriptAuditPath\(doc\.fileName\)[\s\S]*diagnoseFileFromDisk\(doc\.uri\)/);

  console.log('script-audit-scope.test.js: PASS');
}

main();
