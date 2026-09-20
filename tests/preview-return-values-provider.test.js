const assert = require('node:assert/strict');
const { parse } = require('./preview-inputs-integration.test');
const { manager } = require('./helpers/preview-image-hydration');

const source = '[@main]\n#ACT\nGOTO @calculate(<$STR(N$base)>,<$STR(S$title)>|N$result,S$result)\n#SAY\n<TEXT:数量=<$STR(N$result)>:40:40>\n<TEXT:标题=<$STR(S$result)>:40:80>\n[@calculate]\n#ACT\nMOV N$tmp <$SCRIPTPARAM1>\nINC N$tmp 2\nRETURN <$STR(N$tmp)> <$SCRIPTPARAM2>\nMOV N$result 999';
const text = model => model.pages.find(page => page.sourceLabel === '@main').elements.map(element => element.text).join('\n');

async function run() {
  for (const engine of ['GOM', 'GEE']) {
    const host = manager(), posted = [];
    const session = { key: 'return-values', document: { version: 1, getText: () => source }, dirty: true,
      conflict: false, modelRevision: 1, previewConditions: {}, previewValues: {},
      model: parse(source, {}, engine), panel: { webview: { postMessage: message => posted.push(message) } } };
    host.sessions = new Map([[session.key, session]]);
    host.hydrateAssets = async () => {};
    host.createModel = async (_d, _c, _l, _s, values) => parse(source, values, engine);
    assert.equal(text(session.model), '数量=2\n标题=预览文字');
    await host.onMessage(session, { type: 'previewInput', name: 'N$base', value: '40' });
    assert.equal(text(session.model), '数量=42\n标题=预览文字');
    const literal = '<IMG:1:1:1:1>|/@not-an-action $STM(HP)';
    await host.onMessage(session, { type: 'previewInput', name: 'S$title', value: literal });
    assert.equal(text(session.model), '数量=42\n标题=' + literal);
    assert.equal(session.model.pages[0].elements.length, 2, 'returned user text remains literal');
    const revision = session.modelRevision;
    await host.onMessage(session, { type: 'previewInput', name: 'N$base', value: 'Infinity' });
    assert.equal(session.modelRevision, revision, 'invalid input rejected');
    await host.onMessage(session, { type: 'previewInput', name: 'S$title', value: '' });
    assert.equal(text(session.model), '数量=42\n标题=');
    await host.onMessage(session, { type: 'resetPreview' });
    assert.equal(text(session.model), '数量=2\n标题=预览文字');
    assert.equal(session.dirty, true);
    assert.ok(posted.filter(message => message.type === 'model').every(message => message.preserveDrafts));
    assert.equal(session.document.getText(), source);
  }
  console.log('preview-return-values-provider.test.js: PASS');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { source, text, run };
