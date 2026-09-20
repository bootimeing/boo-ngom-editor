const assert=require('node:assert/strict');
const {parse}=require('./preview-inputs-integration.test'),{hydrate}=require('./helpers/preview-image-hydration');
async function run(){
 for(const engine of ['GOM','GEE']) {
   const relative=parse('[@main]\n#SAY\n<IMGEX:0:1:2:3:30:30>',{},engine),absolute=parse('[@main]\n#SAY\n<&IMGEX:0:1:2:3:30:30>',{},engine);
   const a=relative.pages[0].elements[0],b=absolute.pages[0].elements[0];
   assert.deepEqual(a.assetStateDiagnostics,b.assetStateDiagnostics,engine+' relative alias must retain all states');
   assert.equal(a.assetStateDiagnostics.length,3);
   assert.deepEqual(await hydrate(relative),await hydrate(absolute));
   assert.equal(a.assetLayers.length,2);
 }
 const determined=parse('[@main]\n#ACT\nMOV N0 1\nMOV N1 2\n#SAY\n<IMGEX:0:<$STR(N0)>:<$STR(N1)>:3:30:30>');
 assert.deepEqual(await hydrate(determined),[{willIndex:0,imageIndex:1},{willIndex:0,imageIndex:2},{willIndex:0,imageIndex:3}]);
 const unknown=parse('[@main]\n#SAY\n<IMGEX:0:<$STR(N0)>:2:3:30:30>',{N0:'1'});
 assert.deepEqual(await hydrate(unknown),[{willIndex:0,imageIndex:2},{willIndex:0,imageIndex:3}],'local number is not static image evidence');
 console.log('preview-imgex-compat.test.js: PASS');
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});module.exports={run};
