const assert = require('node:assert/strict');
const { parse } = require('./preview-inputs-integration.test');
const { manager } = require('./helpers/preview-image-hydration');
const { source, atlas, hydrate } = require('./preview-client-atlas.test');

async function run() {
  const host = manager(), posted = [];
  const session = { key: 'client-atlas', document: { version: 1, getText: () => source }, dirty: true,
    conflict: false, modelRevision: 1, previewConditions: {}, previewValues: {},
    model: parse(source, {}, '996PC'), panel: { webview: { postMessage: message => posted.push(message) } } };
  host.sessions = new Map([[session.key, session]]);
  host.createModel = async (_document, _conditions, _label, _state, values) => parse(source, values, '996PC');
  host.hydrateAssets = hydrate;
  await host.onMessage(session, { type: 'previewInput', name: 'STM(ITEMCOUNT_布衣(男))', value: '12' });
  assert.equal(session.model.pages[0].elements[0].text, '衣服=12');
  await host.onMessage(session, { type: 'previewInput', name: 'STM(SLIDERV_N0)', value: '407' });
  assert.equal(atlas(session.model).imageTextPreview.value, '407');
  assert.equal(atlas(session.model).imageTextPreview.assetContract, 'matched');
  const revision = session.modelRevision;
  for (const message of [
    { name: 'STM(ITEMCOUNT_布衣(女))', value: '1' },
    { name: 'STM(ITEMCOUNT_布衣(男))', value: 'Infinity' },
    { name: 'STM(SLIDERV_N0)', value: '<Img|pcimg=2522>' },
  ]) await host.onMessage(session, { type: 'previewInput', ...message });
  assert.equal(session.modelRevision, revision, 'unknown client slots and non-finite/non-numeric data are rejected');
  await host.onMessage(session, { type: 'resetPreview' });
  assert.equal(session.model.pages[0].elements[0].text, '衣服=0');
  assert.equal(atlas(session.model).imageTextPreview.value, '25');
  assert.equal(session.dirty, true);
  assert.ok(posted.filter(message => message.type === 'model').every(message => message.preserveDrafts));
  assert.equal(session.document.getText(), source);
  console.log('preview-client-atlas-provider.test.js: PASS');
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
