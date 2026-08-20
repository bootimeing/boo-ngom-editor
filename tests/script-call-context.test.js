const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function main() {
  const {
    clearScriptCallContextCache,
    findHostScriptLabelKeys,
  } = require('../out/utils/script-call-context');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-call-context-'));
  try {
    const envir = path.join(root, 'Mir200', 'Envir');
    const market = path.join(envir, 'Market_Def');
    const quest = path.join(envir, 'QuestDiary', '功能');
    fs.mkdirSync(market, { recursive: true });
    fs.mkdirSync(quest, { recursive: true });
    const target = path.join(quest, '子脚本.txt');
    const callExTarget = path.join(quest, '扩展子脚本.txt');
    fs.writeFileSync(target, '[@入口]\r\nGOTO @宿主返回\r\n', 'utf8');
    fs.writeFileSync(callExTarget, '[@入口]\r\nGOTO @宿主返回\r\n', 'utf8');
    fs.writeFileSync(
      path.join(market, 'QFunction-0.txt'),
      [
        '[@宿主返回]',
        '#IF',
        '#ACT',
        '#CALL [\\功能\\子脚本.txt] @入口',
        '#CALLEX [\\功能\\扩展子脚本.txt] @入口',
      ].join('\r\n'),
      'utf8'
    );

    clearScriptCallContextCache();
    assert.deepEqual(
      [...findHostScriptLabelKeys(root, callExTarget)],
      ['宿主返回'],
      'a #CALLEX child must use the same verified QuestDiary path rules'
    );
    assert.deepEqual(
      [...findHostScriptLabelKeys(root, target)],
      ['宿主返回'],
      'a #CALL child must be able to jump back to a label in its verified host script'
    );
    assert.deepEqual(
      [...findHostScriptLabelKeys(root, path.join(quest, '未调用.txt'))],
      [],
      'host labels must not leak into unrelated QuestDiary files'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('script-call-context.test.js: PASS');
}

main();
