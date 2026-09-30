const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const index = require(path.join(runtime, 'out/utils/archive-index'));
const status = require(path.join(runtime, 'out/utils/archive-status'));
const { describeArchiveImage } = require(path.join(runtime, 'out/utils/archive-image-metadata'));
const { hxmFixture } = require('./pak-hxm-pack4.test');
const { fixture } = require('./pak-hxm-layouts.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-inspection-'));
  try {
    const options = { extensionPath: runtime, indexRoot: path.join(temporary,'index'), password: 'fixture', willIdx: 1 };
    const file = path.join(temporary,'normal.pak');fs.writeFileSync(file,hxmFixture(options.password));
    const result = await index.openArchiveIndexed({...options,pakPath:file});
    assert.match(result.indexGeneration,/^[a-f0-9]{32}$/);assert.equal(result.assets[0].indexGeneration,result.indexGeneration);
    const read = ids => index.inspectArchiveSlots(options.indexRoot,result.archiveId,result.indexGeneration,ids);
    let slots = read([0,1,4]);assert.deepEqual(slots.map(s=>s.status),['indexed-unverified','empty','indexed-unverified']);
    assert.equal(slots[0].metadata.profileId,'hxm2-lz-v1');assert.equal(slots[0].metadata.compression,'zlib');
    assert.ok(slots[0].metadata.payloadOffset>262);assert.equal(slots[1].metadata,undefined);
    const summary = index.loadArchiveSummary(options.indexRoot,result.archiveId);
    await index.readArchiveImagePng({...options,archiveId:result.archiveId,imageIndex:0});
    assert.equal(read([0])[0].status,'decoded');
    status.writeArchiveStatus(options.indexRoot,summary,4,4);
    assert.deepEqual(read([4]).map(s=>[s.status,s.reasonCode]),[['unsupported','unsupported-pixel-layout']]);
    const forbidden = ['password','key','jpkRc4State','pakPath','sourceSha256'];
    for(const key of forbidden) assert.equal(JSON.stringify(read([0,4])).includes('"'+key+'"'),false);
    for(const ids of [[-1],[6],[1.5],Array(401).fill(0)]) assert.throws(()=>read(ids));
    assert.throws(()=>index.inspectArchiveSlots(options.indexRoot,'../anything',result.indexGeneration,[0]));
    const readSync=fs.readSync, lengths=[];
    try { fs.readSync=(fd,buffer,offset,length,position)=>{lengths.push(length);return readSync(fd,buffer,offset,length,position);}; read([0,1,4]); }
    finally {fs.readSync=readSync;}
    assert.equal(lengths.filter(n=>n===1).length,3,'window reads one status byte per requested ID');
    await index.openArchiveIndexed({...options,pakPath:file,forceRefresh:true});
    assert.throws(()=>read([0]),/变化/);
    const v0 = path.join(temporary,'v0.pak');fs.writeFileSync(v0,fixture(options.password,32,[{id:0,w:1,h:1,mode:1,data:Buffer.from([128,0,0,255,0])}]));
    const r0=await index.openArchiveIndexed({...options,pakPath:v0});
    const md=index.inspectArchiveSlots(options.indexRoot,r0.archiveId,r0.indexGeneration,[0])[0].metadata;
    assert.equal(md.compression,'RLE');assert.equal(md.alpha,'无独立 alpha（解码器色键）');
    const mock={format:'JPK'},block={imageType:32,flags:1,width:1,height:1};
    assert.equal(describeArchiveImage(mock,block).alpha,'独立 A8');
    fs.appendFileSync(v0,Buffer.from([0]));
    assert.throws(()=>index.inspectArchiveSlots(options.indexRoot,r0.archiveId,r0.indexGeneration,[0]),e=>e.diagnostic?.reasonCode==='source-changed');
    console.log('archive-inspection.test.js: PASS (bounded status window, live ledger, generation/source guard, metadata, redaction)');
  } finally {removeTemporaryDirectory(temporary);}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
