const assert = require('node:assert/strict');
const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');

function parseStatement(markup, engine) {
  const source = `[@main]\n#SAY\n${markup}\n`;
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/schema-probe.txt',
    fileName: 'schema-probe.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\schema-probe.txt',
    documentVersion: 1,
    engine,
    engineLabel: engine,
    cursorOffset: 0,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
  return model.pages[0].elements.find(element => element.statementId !== 'flow-text');
}

for (const engine of ['GOM', 'GEE']) {
  const plainImage = parseStatement('<IMG:1600:0:40:50>', engine);
  const titledImage = parseStatement('<IMG:1600:0:40:50|254#标题/@测试>', engine);
  assert.equal(plainImage.statementId, 'img-relative', `${engine} plain IMG chose the wrong schema`);
  assert.equal(titledImage.statementId, 'img-hover',
    `${engine} IMG with a top-level remark must select the remark-aware schema`);
  assert.equal(titledImage.tooltipPreview?.lines?.[0]?.[0]?.text, '标题');

  const plainText = parseStatement('<&TEXT:内容:30:40{FCOLOR=251}>', engine);
  const linkedText = parseStatement('<&TEXT:内容:30:40{FCOLOR=251}/@目标>', engine);
  assert.equal(plainText.statementId, 'text-absolute',
    `${engine} plain absolute TEXT chose the wrong schema`);
  assert.equal(linkedText.statementId, 'text-absolute-link',
    `${engine} linked absolute TEXT must select the link-aware schema`);
  assert.deepEqual(linkedText.parameters.at(-1), {
    index: 5,
    name: '标签',
    value: '目标',
  }, `${engine} linked TEXT must expose the click target with the documented meaning`);
}

console.log('statement-schema-disambiguation.test.js: PASS');
