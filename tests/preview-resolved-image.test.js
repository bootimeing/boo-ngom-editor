const assert = require('node:assert/strict');
const { parse } = require('./preview-inputs-integration.test');
const get = (act, values = {}) => parse(`[@main]\n#ACT\n${act}\n#SAY\n<IMG:<$STR(N0)>:0:30:30>`, values).pages[0].elements[0];
assert.deepEqual(get('MOV N0 1').assetRef, {willIndex:0,imageIndex:1});
assert.equal(get('MOV N0 1').previewAssetOrigin, 'resolved-static');
assert.equal(get('').assetRef, undefined);
assert.equal(get('',{N0:'1'}).assetRef, undefined, 'local input is not static resource evidence');
assert.equal(get('MOV N0 1\nMOVR N0 10').assetRef, undefined);
assert.equal(get('MOV N0 -1').assetRef, undefined);
assert.ok(get('MOV N0 1').raw.includes('<$STR(N0)>'));
async function run() {
  const {hydrate}=require('./helpers/preview-image-hydration');
  for(const [act,expected] of [['MOV N0 1',[{willIndex:0,imageIndex:1}]],['',[]],['MOV N0 1\nMOVR N0 10',[]]]){
    const model=parse(`[@main]\n#ACT\n${act}\n#SAY\n<IMG:<$STR(N0)>:0:30:30>`);
    assert.deepEqual(await hydrate(model),expected);
    if(expected.length) assert.equal(model.pages[0].elements[0].asset.status,'ready');
  }
  console.log('preview-resolved-image.test.js: PASS (model + production provider request, synthetic cache)');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
