// Independent product-fidelity audit. Collection success is NOT feature success.
// node tests/preview-fidelity-audit.test.js --expect-perfect exits nonzero for gaps.
const fs = require('node:fs');
const path = require('node:path');
const { parse, visible } = require('./preview-inputs-integration.test');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const out = path.resolve(process.env.BOO_FIDELITY_AUDIT_OUT || 'artifacts/ctrl-f12-fidelity-audit-20260908');
const cases = [];
function add(id, title, source, expected, read = visible, engine = 'GOM', values = {}, category = 'implementation-bug') {
  const model = parse(source, values, engine);
  const actual = read(model);
  cases.push({ id, title, engine, source, values, expected, actual, matches: JSON.stringify(actual) === JSON.stringify(expected),
    category, warnings: model.warnings, model });
}
const scalar = (act, expression = '<$STR(N0)>') => `[@main]\n#ACT\n${act}\n#SAY\n<TEXT:结果=${expression}:30:30>`;
const first = m => m.pages.flatMap(p => p.elements)[0];
add('if-threshold', 'GOM #IF(1) 任一条件成立', '[@main]\n#ACT\nMOV N0 1\nMOV N1 0\n#IF(1)\nEQUAL N0 1\nEQUAL N1 1\n#SAY\n<TEXT:成功:30:30>\n#ELSESAY\n<TEXT:失败:30:30>', '成功');
add('while-false', '假条件 WHILE 不应执行循环体', scalar('MOV N0 0\nWHILE N0 > 5\nINC N0 1\nENDWHILE'), '结果=0');
add('while-count', '已知 WHILE 应循环到 3', scalar('MOV N0 0\nWHILE N0 < 3\nINC N0 1\nENDWHILE'), '结果=3');
add('string-dec-text', '字符串 DEC 删除子串', scalar('MOV S1 ABC\nDEC S1 B', '<$STR(S1)>'), '结果=AC');
add('string-dec-range', '字符串 DEC 按范围删除', scalar('MOV S1 ABCDE\nDEC S1 1 3', '<$STR(S1)>'), '结果=DE');
add('mul-three', '三参数 MUL', scalar('MOV N2 100\nMOV N3 10\nMUL N1 N2 N3', '<$STR(N1)>'), '结果=1000');
add('div-three', '三参数 DIV', scalar('MOV N2 100\nMOV N3 10\nDIV N1 N2 N3', '<$STR(N1)>'), '结果=10');
add('formula-round-even', 'GOM FORMULATION 银行家舍入 2.5', scalar('FORMULATION 5/2 N0'), '结果=2');
add('formula-round-odd', 'GOM FORMULATION 银行家舍入 3.5', scalar('FORMULATION 7/2 N0'), '结果=4');
add('scoped-alias', '已声明 HUMAN 变量裸名 INC', scalar('VAR Integer HUMAN QQQQ\nCALCVAR HUMAN QQQQ + 5\nINC QQQQ 1', '<$HUMAN(QQQQ)>'), '结果=6');
add('job-condition', '职业条件应可用本地输入控制', '[@main]\n#IF\nCHECKJOB warrior\n#SAY\n<TEXT:战士:30:30>\n#ELSESAY\n<TEXT:非战士:30:30>', '战士', visible, 'GOM', { JOB: 'warrior' }, 'missing-local-simulation');
add('namelist-control', '名单条件应有本地模拟入口', '[@main]\n#IF\nCHECKNAMELIST ..\\QuestDiary\\名单.txt\n#SAY\n<TEXT:在名单中:30:30>\n#ELSESAY\n<TEXT:不在名单:30:30>', true, m => m.previewInputs.length > 0, 'GOM', {}, 'missing-local-simulation');
add('literal-image', '对照：字面图片序号', '[@main]\n#SAY\n<IMG:1:0:30:30>', 1, m => first(m).assetRef?.imageIndex ?? null, 'GOM', {}, 'positive-control');
add('resolved-image', '已确定变量图片序号仍被恢复为未知', '[@main]\n#ACT\nMOV N0 1\n#SAY\n<IMG:<$STR(N0)>:0:30:30>', 1, m => first(m).assetRef?.imageIndex ?? null, 'GOM', {}, 'source-gate-limitation');
for (const dynamic of [false, true]) add(dynamic ? 'resolved-width' : 'literal-width', `996PC Input ${dynamic ? '已知变量' : '字面量'}宽度`, `[@main]\n#ACT\nMOV N0 240\n#SAY\n<Input|x=30|y=30|inputid=1|type=0|width=${dynamic ? '<$STR(N0)>' : '240'}|height=30>`, 240, m => first(m).width, '996PC', {}, dynamic ? 'source-gate-limitation' : 'positive-control');
add('formula-if', '对照：FORMULATION if 已支持', scalar('FORMULATION if(5>10,100,900) N0'), '结果=900', visible, 'GOM', {}, 'positive-control');
add('text-offset', '对照：已知动态 TEXT 坐标含减 4 偏移', '[@main]\n#ACT\nMOV N0 200\nMOV N1 150\n#SAY\n<TEXT:位置:<$STR(N0)>:<$STR(N1)>>', [196,146], m => [first(m).layoutX, first(m).layoutY], 'GOM', {}, 'positive-control');
add('number-fallback', '对照：未知数字为 0', scalar('', '<$STR(U101)>'), '结果=0', visible, 'GOM', {}, 'positive-control');
add('text-fallback', '对照：未知文字为预览文字', scalar('', '<$STR(S1)>'), '结果=预览文字', visible, 'GOM', {}, 'positive-control');
function run() {
  fs.mkdirSync(out, { recursive: true });
  const result = { date: new Date().toISOString(), runtimeRoot: root, total: cases.length,
    matching: cases.filter(c => c.matches).length, gaps: cases.filter(c => !c.matches).length,
    boundary: 'Parser/model tests; not game-client pixel acceptance or a coverage percentage.',
    cases: cases.map(({ model, ...c }) => c) };
  fs.writeFileSync(path.join(out, 'model-results.json'), JSON.stringify(result, null, 2));
  for (const c of cases) console.log(`${c.matches ? 'MATCH' : 'GAP'} ${c.id}: expected=${JSON.stringify(c.expected)} actual=${JSON.stringify(c.actual)}`);
  console.log(`AUDIT COLLECTED: ${result.total} cases, ${result.matching} matching, ${result.gaps} gaps. NOT A FEATURE PASS.`);
  if (process.argv.includes('--expect-perfect') && result.gaps) process.exitCode = 1;
}
if (require.main === module) run();
module.exports = { cases, root, out };
