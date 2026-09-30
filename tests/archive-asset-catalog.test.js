const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const { buildArchiveAssetCatalog, archiveAssetUrlTemplate } = require(path.join(runtime, 'out/utils/archive-asset-catalog'));
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { pack4Fixture } = require('./pak-hxm-pack4.test');

let directCalls = 0, fileCalls = 0;
const urls = {
  directTemplate: id => { directCalls++; return archiveAssetUrlTemplate(`https://boo-archive.test/${id}/000000.png`); },
  fileUrl: asset => { fileCalls++; return 'file-preview:' + asset.path; },
};
function direct(count, willIdx = 1, id = 'a') {
  const result = { format:'PACK4', pakName:`pack${willIdx}`, pakPath:`D:/fixtures/pack${willIdx}.pak`, willIdx,
    slotCount:count, storageMode:'direct', archiveId:id.repeat(64), indexGeneration:'b'.repeat(32), profileId:'pack4-plain-bgra',
    cacheDir:'private-cache', fromCache:false, password:'NEVER-TRANSPORT-THIS', rc4State:'NEVER-TRANSPORT-THIS' };
  result.assets = Array.from({ length:count }, (_, imageIdx) => ({ name:String(imageIdx).padStart(6,'0'), path:'',
    pakName:result.pakName, pakPath:result.pakPath, willIdx, localIdx:imageIdx, imageIdx,
    width:1,height:1,offsetX:0,offsetY:0,isBlank:true,decodeStatus:'empty',source:'pak',
    archiveId:result.archiveId,indexGeneration:result.indexGeneration }));
  return result;
}
function image(result, id, extra={}) {
  Object.assign(result.assets[id],{width:32,height:16,offsetX:-23,offsetY:17,isBlank:false,decodeStatus:'indexed-unverified'},extra);
}
async function main() {
  assert.equal(archiveAssetUrlTemplate('https://host/abc/000000.png?token=value'), 'https://host/abc/{id}.png?token=value');
  for (const value of ['https://host/123.png', 'https://host/000000.png/else', 'https://{id}/000000.png', 'https://host/000000.png?x=/000000.png']) {
    assert.throws(()=>archiveAssetUrlTemplate(value), /模板/);
  }

  // The full one-million-element host array is deliberately real, not a sparse JS
  // array or a mocked iterator. Only its three valid slots may cross the UI bridge.
  let million = direct(1000000);
  image(million,0,{decodeStatus:undefined});
  image(million,500000,{decodeStatus:'recovered',failureCode:'checksum-recovered',password:'NEVER-TRANSPORT-THIS'});
  image(million,999999,{decodeStatus:'decoded',offsetX:-2147483648,offsetY:2147483647});
  const catalog = buildArchiveAssetCatalog([million], urls), segment = catalog.segments[0];
  const json = JSON.stringify(catalog), bytes = Buffer.byteLength(json);
  assert.ok(bytes<10*1024, `million sparse descriptor too large: ${bytes}`);
  assert.equal(catalog.version,1);assert.equal(segment.slotCount,1000000);assert.equal(segment.records.length,3);
  assert.deepEqual(segment.records.map(row=>row[0]),[0,500000,999999]);
  assert.deepEqual(segment.records[0],[0,32,16,-23,17,'indexed-unverified']);
  assert.deepEqual(segment.records[1],[500000,32,16,-23,17,'recovered','checksum-recovered']);
  assert.deepEqual(segment.records[2],[999999,32,16,-2147483648,2147483647,'decoded']);
  assert.equal(directCalls,1);assert.equal(fileCalls,0,'no per-slot Webview URL construction');
  assert.equal(json.includes('NEVER-TRANSPORT-THIS'),false);assert.equal(json.includes('cacheDir'),false);
  assert.equal(segment.indexGeneration,million.indexGeneration);assert.equal(segment.source,'pak');
  assert.equal(million.assets[0].decodeStatus,undefined,'builder never mutates host assets');million=null;

  const first = direct(3,2,'a'), last = direct(3,7,'c');
  image(first,0);image(last,0,{decodeStatus:'unsupported',failureCode:'unsupported-pixel-layout'});
  first.profileId='unpublished-profile'; // Transport must preserve an unknown profile, not guess one.
  const legacyAsset = { name:'custom sprite',path:'D:/legacy/custom.png',pakName:'legacy',pakPath:'D:/legacy.pak',willIdx:5,
    localIdx:8,imageIdx:42,width:12,height:24,offsetX:-13,offsetY:7,isBlank:false,decodeStatus:'recovered',
    failureCode:'checksum-recovered',source:'pak',archiveId:undefined,indexGeneration:undefined,
    password:'NEVER-TRANSPORT-THIS',privateKey:'NEVER-TRANSPORT-THIS' };
  const legacy = { format:'GOM',pakName:'legacy',pakPath:'D:/legacy.pak',willIdx:5,slotCount:1,
    assets:[legacyAsset],storageMode:'legacy',profileId:'gom-gameofmir2-v2' };
  const input=[last,legacy,first];const mixed=buildArchiveAssetCatalog(input,urls);
  assert.equal(input[0],last,'will sorting does not mutate caller');
  assert.deepEqual(mixed.segments.map(s=>s.kind),['direct','files','direct']);
  assert.equal(mixed.segments[0].willIdx,2);assert.equal(mixed.segments[2].willIdx,7);
  assert.equal(mixed.segments[0].records[0][0],0);assert.equal(mixed.segments[2].records[0][0],0);
  assert.notEqual(mixed.segments[0].archiveId,mixed.segments[2].archiveId);
  assert.equal(mixed.segments[0].profileId,'unpublished-profile');
  const received=mixed.segments[1].files[0];
  for(const key of ['name','path','pakName','pakPath','willIdx','localIdx','imageIdx','width','height','offsetX','offsetY',
    'isBlank','decodeStatus','failureCode','source','archiveId','indexGeneration'])assert.equal(received[key],legacyAsset[key],key);
  assert.equal(received.profileId,legacy.profileId);assert.equal(received.url,'file-preview:'+legacyAsset.path);
  assert.equal(JSON.stringify(mixed).includes('NEVER-TRANSPORT-THIS'),false);
  const unavailable={...legacy,assets:[{...legacyAsset,decodeStatus:'corrupt'}]};
  assert.equal(buildArchiveAssetCatalog([unavailable],urls).segments[0].files[0].url,'');
  for(const decodeStatus of ['empty','indexed-unverified']) {
    assert.throws(()=>buildArchiveAssetCatalog([{...legacy,assets:[{...legacyAsset,decodeStatus}]}],urls),/状态与失败原因/);
  }

  // All source families and unknown state versus unknown profile are distinct.
  for(const [format,source] of [['JPK','jpk'],['WIL','wil'],['WZL','wzl'],['HXM','pak']]) {
    const value=direct(1);value.format=format;value.assets[0].source=source;
    assert.equal(buildArchiveAssetCatalog([value],urls).segments[0].source,source);
  }
  const empty=buildArchiveAssetCatalog([direct(0)],urls).segments[0];assert.equal(empty.slotCount,0);assert.deepEqual(empty.records,[]);
  for(const mutate of [
    v=>{v.assets[0].imageIdx=2;},v=>{v.assets[0].localIdx=2;},v=>{v.assets[0].name='other';},
    v=>{v.assets[0].archiveId='c'.repeat(64);},v=>{v.assets[0].indexGeneration='c'.repeat(32);},
    v=>{v.assets[0].source='jpk';},v=>{v.assets[0].willIdx=2;},v=>{v.assets[0].pakPath='D:/other.pak';},
    v=>{v.assets[0].path='secret-source.png';},v=>{v.assets[0].width=2;},v=>{v.assets[0].offsetX=-1;},
    v=>{v.assets[0].decodeStatus='unknown';},v=>{v.assets.length=0;},v=>{v.indexGeneration=undefined;},
  ]) { const value=direct(1);mutate(value);assert.throws(()=>buildArchiveAssetCatalog([value],urls),/素材/); }
  for(const changes of [{offsetX:NaN},{width:0},{height:Infinity},{isBlank:true},{failureCode:''},
    {decodeStatus:'indexed-unverified',failureCode:'worker-error'},
    {decodeStatus:'empty',isBlank:true,failureCode:'worker-error'}]){
    const value=direct(1);image(value,0,changes);assert.throws(()=>buildArchiveAssetCatalog([value],urls),/素材/);
  }
  assert.throws(()=>buildArchiveAssetCatalog([direct(0)],{...urls,directTemplate:()=>'/no-placeholder.png'}),/模板/);
  assert.throws(()=>buildArchiveAssetCatalog([direct(0)],{...urls,directTemplate:()=>'{id}/{id}'}),/模板/);

  // Production reader integration: real canonical fields are representable exactly.
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'boo-catalog-'));
  try {
    const file=path.join(temporary,'fixture.pak');fs.writeFileSync(file,pack4Fixture('synthetic',false));
    const index=require(path.join(runtime,'out/utils/archive-index'));
    const opened=await index.openArchiveIndexed({extensionPath:runtime,indexRoot:path.join(temporary,'index'),pakPath:file,password:'',willIdx:3});
    const actual=buildArchiveAssetCatalog([opened],urls).segments[0];assert.equal(actual.slotCount,6);
    assert.deepEqual(actual.records.map(row=>row[0]),[0,4]);assert.equal(actual.records[1][3],-23);
    index.forgetArchiveIndex(path.join(temporary,'index'));
  } finally {removeTemporaryDirectory(temporary);}
  const extension=fs.readFileSync(path.join(runtime,'out/extension.js'),'utf8');
  const publish=extension.slice(extension.indexOf('function postLoadedPakAssets('),extension.indexOf('function normalizePakPath('));
  assert.match(publish,/buildArchiveAssetCatalog/);assert.match(publish,/assetCatalog/);
  assert.doesNotMatch(publish,/\.flatMap\(/,'no direct full-array flatten in UI publish');
  console.log(`archive-asset-catalog.test.js: PASS (1000000 slots/3 records/${bytes} bytes; identity, generations, mixed legacy, no secrets, production reader)`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
