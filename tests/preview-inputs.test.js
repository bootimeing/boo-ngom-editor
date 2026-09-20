const assert = require('node:assert/strict');
const path = require('node:path');
const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const runtimeRequire = file => require(path.join(runtimeRoot, file));
const { parseNpcDialogDocument } = runtimeRequire('out/ui-dialog/source-parser');
const { buildDialogStatementCatalog } = runtimeRequire('out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = runtimeRequire('out/ui-dialog/offsets');
const { discoverPreviewInputs, evaluatePreviewCondition, validPreviewValue } = runtimeRequire('out/ui-dialog/preview-inputs');
const language = runtimeRequire('data/static-language.json');
const source = `[@main]
#IF
NOT CHECK [101] 0
#SAY
<TEXT:标识已开:30:30>
#ELSESAY
<TEXT:标识已关:30:30>
#IF
CHECK [101] 1
#SAY
<TEXT:同一个开关:30:60>
#IF
LARGE U101 10
#SAY
<TEXT:数量足够 <$STR(U101)>:30:90>
#ELSESAY
<TEXT:数量不足 <$STR(u101)>:30:90>
#IF
EQUAL S$名字 勇士
#SAY
<TEXT:欢迎勇士:30:120>
#SAY
<TEXT:姓名 <$STR(S$名字)>:30:150>`;
function parse(text = source, previewValues = {}) {
  return parseNpcDialogDocument(text, {
    uri: 'file:///D:/preview.txt', fileName: 'preview.txt', filePath: 'D:/preview.txt',
    documentVersion: 1, engine: 'GOM', engineLabel: 'GOM', cursorOffset: 2,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(language, 'GOM'), previewValues,
  });
}
function run() {
  const initial = parse();
  assert.deepEqual(initial.previewInputs.map(x => x.name).sort(), ['[101]', 'S$名字', 'U101'].sort());
  assert.deepEqual(initial.conditionGroups.map(g => g.satisfied), [false, false, false, false]);
  const changed = parse(source, { '[101]': '1', U101: '11', 'S$名字': '勇士' });
  assert.deepEqual(changed.conditionGroups.map(g => g.satisfied), [true, true, true, true]);
  assert.ok(changed.pages[0].elements.some(e => e.text.includes('姓名 勇士')));
  assert.ok(changed.pages[0].elements.some(e => e.text.includes('数量足够 11')));
  const order = parse(`[@main]\n#IF\nEQUAL U101 0\n#ACT\nMOV U101 2\n#IF\nEQUAL U101 0\n#SAY\n错误\n#ELSESAY\n正确`);
  assert.deepEqual(order.conditionGroups.map(g => g.satisfied), [false],
    'an action-only condition may affect evaluation but must not become a visible branch control');
  const set = parse('[@main]\n#ACT\nSET [101] 1\n#IF\nCHECK [101] 1\n#SAY\n开');
  assert.equal(set.conditionGroups[0].satisfied, true);
  const or = parse('[@main]\n#IF\nCHECK [101] 1\n#OR\nLARGE U101 5\n#SAY\n开', { U101: '6' });
  assert.equal(or.conditionGroups[0].satisfied, true);
  assert.equal(evaluatePreviewCondition('NOT RANDOM 2', () => '0'), undefined);
  assert.equal(evaluatePreviewCondition('LARGE U101 9007199254740992', () => '9007199254740993'), true);
  assert.equal(evaluatePreviewCondition('LARGE U101 9007199254740992.01', () => '9007199254740992.02'), true);
  assert.equal(evaluatePreviewCondition('EQUAL U101 1', () => '1.000'), true);
  assert.equal(evaluatePreviewCondition('SMALL U101 0', () => '-0.01'), true);
  assert.equal(evaluatePreviewCondition('NOT CHECK [101] 0', () => '1'), true);
  const names = discoverPreviewInputs('[@main]\n#IF\nCHECK [101,102-103] 1\nEQUAL u101 1\nEQUAL U101 2\nEQUAL S$abc S$ABC\n#SAY\nU999 [104]\n; <$STR(U888)>').map(x => x.name);
  assert.equal(names.filter(n => n === 'U101').length, 1);
  assert.ok(names.includes('S$abc') && names.includes('S$ABC'));
  assert.ok(!names.includes('U999') && !names.includes('[104]') && !names.includes('U888'));
  assert.equal(validPreviewValue({ kind: 'number' }, 'Infinity'), false);
  assert.equal(validPreviewValue({ kind: 'text' }, ''), true);
  for (const value of ['A:B|C', '<IMG:1:1:1:1>', 'A/@test', '{FCOLOR=1}']) {
    const literal = parse('[@main]\n#SAY\n<TEXT:姓名 <$STR(S$名字)>:30:150>', { 'S$名字': value });
    assert.equal(literal.pages[0].elements.length, 1);
    assert.equal(literal.pages[0].elements[0].text, `姓名 ${value}`);
  }
  const item = parse('[@main]\n#SAY\n<ITEMSHOW:<$STR(U101)>:0:0>', { U101: '935' });
  assert.ok(item.scenes.every(s => s.resolvedVariables.every(v => v.staticValueSource !== 'database-item-index')));
  console.log('preview-inputs.test.js: PASS');
}
if (require.main === module) run();
module.exports = { source, parse };
