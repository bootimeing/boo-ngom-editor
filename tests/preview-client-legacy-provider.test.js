const assert = require('node:assert/strict');
const { parse } = require('./preview-inputs-integration.test');
const { manager } = require('./helpers/preview-image-hydration');
const { legacySource, keyedSource, pureSource, texts } = require('./preview-client-legacy.test');

async function run() {
  for (const [source, name, value, expected] of [
    [legacySource, 'STM(HP)', '37', 'SAY数值=37'],
    [keyedSource, 'STM(ITEMCOUNT_屠龙·传说)', '12', '2=12'],
    [pureSource, 'STM(HP)', '37', '37'],
  ]) {
    if (process.env.BOO_CLIENT_LEGACY_FOCUS === 'names' && source !== keyedSource) continue;
    if (process.env.BOO_CLIENT_LEGACY_FOCUS === 'pure' && source !== pureSource) continue;
    const host = manager(), posted = [];
    const session = { key: 'legacy-client', document: { version: 1, getText: () => source }, dirty: true,
      conflict: false, modelRevision: 1, previewConditions: {}, previewValues: {}, model: parse(source, {}, '996PC'),
      panel: { webview: { postMessage: message => posted.push(message) } } };
    host.sessions = new Map([[session.key, session]]);
    host.createModel = async (_document, _conditions, _label, _state, values) => parse(source, values, '996PC');
    host.hydrateAssets = async () => {};
    await host.onMessage(session, { type: 'previewInput', name, value });
    assert.ok(texts(session.model).includes(expected), 'production Provider accepts discovered local display input');
    const revision = session.modelRevision;
    for (const invalid of [{ name: 'STM(ITEMCOUNT_unknown)', value: '1' }, { name, value: 'Infinity' }, { name, value: '<Img|pcimg=12>' }]) {
      await host.onMessage(session, { type: 'previewInput', ...invalid });
    }
    assert.equal(session.modelRevision, revision, 'unknown slots and invalid numeric values are rejected');
    if (source === legacySource) {
      const literal = '<TEXT:伪造:1:2>/@$STM(HP)';
      await host.onMessage(session, { type: 'previewInput', name: 'STM(USERNAME)', value: literal });
      assert.ok(texts(session.model).includes('SAY文字=' + literal));
      await host.onMessage(session, { type: 'previewInput', name: 'STM(USERNAME)', value: '' });
      assert.ok(texts(session.model).includes('SAY文字='));
    }
    await host.onMessage(session, { type: 'resetPreview' });
    assert.ok(texts(session.model).includes(source === legacySource ? 'SAY数值=0' : source === keyedSource ? '2=0' : '0'));
    assert.equal(session.document.getText(), source); assert.equal(session.dirty, true);
    assert.ok(posted.filter(message => message.type === 'model').every(message => message.preserveDrafts));
  }
  console.log('preview-client-legacy-provider.test.js: PASS');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
