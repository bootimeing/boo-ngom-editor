// Execute the packaged production sender with a minimal Webview URI/IPC double.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const source = fs.readFileSync(path.join(root, 'out/extension.js'), 'utf8');
const sender = source.match(/function postLoadedPakAssets\(panel\) \{[\s\S]*?(?=\nfunction normalizePakPath\()/);
assert.ok(sender, 'production catalog sender exists');
const archiveId = 'a'.repeat(64), generation = 'b'.repeat(32), sent = [], uriCalls = [];
const result = { storageMode:'direct', format:'JPK', pakName:'native.jpk', pakPath:'fixture/native.jpk',
  willIdx:7, archiveId, indexGeneration:generation, slotCount:3, assets:[] };
result.assets = Array.from({length:3}, (_, id) => ({ name:String(id).padStart(6,'0'), path:'',
  source:'jpk', pakName:result.pakName, pakPath:result.pakPath, willIdx:7, archiveId,
  indexGeneration:generation, localIdx:id, imageIdx:id, width:id===1?1:4, height:id===1?1:5,
  offsetX:0, offsetY:0, isBlank:id===1, decodeStatus:id===1?'empty':'indexed-unverified' }));
const sandbox = {
  loadedPakResults:new Map([['fixture',result]]), loadedPakEngine:'996PC',
  archive_asset_catalog_1:require(path.join(root, 'out/utils/archive-asset-catalog')),
  archive_resource_provider_1:{ archiveResourceUri:(id,index)=>`boo-archive:/${id}/${String(index).padStart(6,'0')}.png`,
    archiveAssetUri:()=>{throw Error('direct transport must not derive one URI per slot');} },
  ui_archive_1:{ uiEditorArchiveLabel:()=> 'JPK' },
};
vm.createContext(sandbox);vm.runInContext(sender[0],sandbox);
sandbox.postLoadedPakAssets({webview:{asWebviewUri:uri=>{uriCalls.push(uri);return {toString:()=>String(uri)};},postMessage:message=>sent.push(message)}});
assert.equal(uriCalls.length,1);assert.equal(sent.length,1);
const message=JSON.parse(JSON.stringify(sent[0]));
assert.equal(message.type,'loadAssets');assert.equal(message.files,undefined);
assert.equal(message.assetCatalog.version,1);assert.equal(message.totalCount,3);
assert.equal(message.assetCatalog.segments[0].records.length,2);
assert.deepEqual(message.assetCatalog.segments[0].records.map(row=>row[0]),[0,2]);
assert.equal(message.assetCatalog.segments[0].slotCount,3);
assert.equal(message.assetCatalog.segments[0].urlTemplate,`boo-archive:/${archiveId}/{id}.png`);
assert.deepEqual(message.pakList,[{name:'native.jpk',willIdx:7}]);
assert.equal(message.sourceType,'jpk');assert.equal(message.pakMode,true);
sandbox.loadedPakResults.clear();sandbox.postLoadedPakAssets({webview:{postMessage:message=>sent.push(message)}});
assert.equal(sent[1].totalCount,0);assert.equal(sent[1].assetCatalog.segments.length,0);
console.log('archive-asset-transport: PASS production sender, compact slots, single package URI, logical IDs, empty package; mocked Webview transport');
