const assert = require('node:assert/strict');
const { parse } = require('./preview-inputs-integration.test');
const { applyConstantDisplayFallback, authority } = require('./preview-constant-display.test');
const { manager } = require('./helpers/preview-image-hydration');

async function hydrate(model) {
  const host = manager(), requests = [], database = [];
  host.scriptDataResolver = {
    resolveItemFieldByIndex: (...args) => { database.push(args); return 8; },
    resolveItemFieldByName: (...args) => { database.push(args); return 8; }
  };
  host.resolveAsset = reference => {
    requests.push({ ...reference });
    return { status: 'missing', archiveLabel: 'test missing asset' };
  };
  await host.hydrateAssets(model, {}, { fileName: 'constant-display.txt' });
  return { requests, database };
}

async function run() {
  const fixtures = [
    ['996PC', '<TextAtlas|text=$(Text)|wil=NewopUI|pcimg=$(Index)|iwidth=$(Width)|iheight=$(Height)|x=40|y=100>'],
    ['996PC', '<TextAtlas|text=$(Text)|wil=NewopUI|pcimg=2522|iwidth=14|iheight=24|x=40|y=100>'],
    ['GOM', '<&IMGCOUNTDOWN:($Seconds):1:100:3:20:30:0/@next>'],
    ['GEE', '<&IMGCOUNTDOWN:($Seconds):1:100:3:20:30:0/@next>'],
    ['GOM', '<ITEMSHOW:($Index):0:40:40>'],
    ['GEE', '<ITEMSHOW:($Index):0:40:40>']
  ];
  for (const [engine, markup] of fixtures) {
    const original = parse('[@main]\n#SAY\n' + markup, {}, engine);
    const fallback = parse('[@main]\n#SAY\n' + markup, {}, engine);
    const initialAuthority = fallback.pages[0].elements.map(authority);
    applyConstantDisplayFallback(fallback.scenes, engine);
    assert.deepEqual(fallback.pages[0].elements.map(authority), initialAuthority, 'postprocessor leaves provider authority untouched');
    const old = await hydrate(original), current = await hydrate(fallback);
    assert.deepEqual(current, old, 'fallback creates no additional or different resource/database requests: ' + markup);
    assert.equal(current.database.length, 0, 'unresolved index cannot query database zero');
    if (markup.includes('TextAtlas')) assert.equal(fallback.pages[0].elements[0].imageTextPreview.value, '0');
    if (markup.includes('IMGCOUNTDOWN')) {
      assert.equal(fallback.pages[0].elements[0].countdownPreview.seconds, undefined);
      assert.equal(fallback.pages[0].elements[0].imageTextPreview.value, '0');
    }
  }
  console.log('preview-constant-display-provider.test.js: PASS');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
