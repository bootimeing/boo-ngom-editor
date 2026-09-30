const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const crypto = require('node:crypto'), zlib = require('node:zlib'), iconv = require('iconv-lite');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const { GomEditSession } = require(path.join(runtime, 'out/resource-editor/gom-session'));
const { decodeResourcePng } = require(path.join(runtime, 'out/resource-editor/image-codec'));
const { encodePng, loadParser, applyGomColorKeyTransparency } = require(path.join(runtime, 'out/utils/pak-reader'));
const { parseGomFile } = require(path.join(runtime, 'out/utils/gom-reader'));
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const password = 'synthetic-editor-测试';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
// Independent format fixture encoder. No production writer or external executable is used.
function des(key, bytes) {
  const cipher = crypto.createCipheriv('des-ede3', Buffer.concat([key,key,key]), null);
  cipher.setAutoPadding(false); return Buffer.concat([cipher.update(bytes),cipher.final()]);
}
function seed(key) { return Buffer.concat([des(key,Buffer.alloc(8,143)),Buffer.alloc(12,143)]); }
function encrypt(plain,key) {
  let feedback=seed(key); const out=Buffer.alloc(plain.length); let cursor=0;
  for(;cursor+20<=plain.length;cursor+=20) {
    const x=Buffer.from(plain.subarray(cursor,cursor+20)).map((v,i)=>v^feedback[i]);
    feedback=Buffer.concat([des(key,x.subarray(0,8)),x.subarray(8)]); feedback.copy(out,cursor);
  }
  const stream=Buffer.concat([des(key,feedback.subarray(0,8)),feedback.subarray(8)]);
  for(let i=cursor;i<plain.length;i++)out[i]=plain[i]^stream[i-cursor]; return out;
}
function fixture(file,options={}) {
  const variant=options.variant||2, signature=variant===2?Buffer.from([10,...Buffer.from('GAMEOFMIR2'),0,0]):Buffer.from([9,...Buffer.from('GAMEOFMIR')]);
  const fixed=Buffer.from(variant===2?'d0740a42ee869c94':'507892b60c6ed00c','hex');
  const key=crypto.createHash('sha1').update(iconv.encode(password,'cp936')).digest().subarray(0,8);
  const s=seed(key), mask=Buffer.concat([des(key,s.subarray(0,8)),s.subarray(8,16)]);
  const header=Buffer.alloc(256), title='www.gameofmir.com';header[1]=title.length;header.write(title,2);
  const count=options.count??14, headerSize=signature.length+256;
  header.writeUInt32LE(headerSize,42);header.writeUInt32LE(count,46);header.writeUInt32LE(2,50);header.writeUInt32LE(headerSize,54);
  header.set([23,43,211,99],210);
  const index=Buffer.alloc(count*4), records=[], defs=[[3,0],[5,0],[6,0],[6,1],[7,0],[7,1]];
  let cursor=headerSize+index.length+(options.gap?1:0), ordinal=0;
  const parser=loadParser(runtime);
  for(const [type,flags] of defs)for(const compressed of [false,true]) {
    const id=ordinal<6?ordinal:ordinal+1, width=3,height=3;
    if(id>=count)break;
    const raw=Buffer.alloc(parser.rawImageSize(type,flags,width,height));
    const stride=type===3?4:type===5?8:12;
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const at=y*stride+x*(type===3?1:type===5?2:type===6?3:4);
      if(type===3)raw[at]=x+y*3;
      else if(type===5)raw.writeUInt16LE([0,0xf800,0x07e0][x],at);
      else {raw[at]=x?17:0;raw[at+1]=x?y*25:0;raw[at+2]=x?143:0;}
      if(type===6&&flags)raw[36+y*4+x]=x*60+y*20;
      if(type===7)raw[at+3]=flags?x*70+y*15:203;
    }
    const payload=compressed?zlib.deflateSync(raw):raw, record=Buffer.alloc(16);
    record[0]=type;record[1]=74;record[2]=61;record[3]=flags;
    record.writeUInt16LE(width,4);record.writeUInt16LE(height,6);
    record.writeInt16LE(-ordinal-1,8);record.writeInt16LE(ordinal+2,10);record.writeUInt32LE(compressed?payload.length:0,12);
    if(options.unknown&&ordinal===0)record[3]=4;
    if(options.retired&&ordinal===5){records.push(Buffer.from(records[0]),Buffer.from(records[1]));cursor+=records[0].length+records[1].length;}
    index.writeUInt32LE(cursor,id*4);records.push(Buffer.from(record).map((v,i)=>v^mask[i]),payload);cursor+=16+payload.length;ordinal++;
  }
  if(options.retired)records.push(Buffer.from(records[0]),Buffer.from(records[1]));
  if(options.alias)index.writeUInt32LE(index.readUInt32LE(0),4);
  fs.writeFileSync(file,Buffer.concat([signature,encrypt(header,fixed),encrypt(index,key),...(options.gap?[Buffer.alloc(1)]:[]),...records,...(options.tail?[Buffer.from([19])]:[])]));
  return file;
}
function code(fn,expected) { assert.throws(fn,e=>e.code===expected,expected); }
async function main() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'boo-gom-edit-')),sessions=[];
  const open=file=>{const s=GomEditSession.open({extensionPath:runtime,sourcePath:file,password});sessions.push(s);return s;};
  let groups=0;
  try {
    const source=fixture(path.join(root,'source.pak')),original=fs.readFileSync(source),originalHash=hash(original);
    const session=open(source);assert.equal(session.info().profileId,'gom-gameofmir2-v2');
    assert.equal(session.info().slotCount,14);assert.equal(session.info().imageCount,12);assert.equal(session.info().dirty,false);
    assert.equal(session.listSlots(0)[6].status,'empty');code(()=>session.previewPng(6),'EMPTY_SLOT');
    code(()=>session.listSlots(0,101),'INVALID_PAGE');assert.throws(()=>GomEditSession.open({extensionPath:runtime,sourcePath:source,password:'wrong'}));groups++;
    // Import each production-reader PNG into the same pixel layout, including odd row padding and black key.
    for(const row of session.listSlots(0).filter(v=>v.status==='decoded')) {
      const image=path.join(root,`exact-${row.index}.png`),expected=session.previewPng(row.index);fs.writeFileSync(image,expected);
      session.importImage({mode:'replace',index:row.index,imagePath:image});
      assert.deepEqual(decodeResourcePng(session.previewPng(row.index)).rgba,decodeResourcePng(expected).rgba);
    }
    const exact=path.join(root,'exact.pak'), saved=session.saveAs(exact);
    assert.equal(saved.verification.verifiedImages,12);assert.equal(saved.sourceSha256Before,saved.sourceSha256After);
    assert.equal(session.info().dirty,false);assert.equal(session.info().canUndo,false);assert.ok(session.previewPng(0).length);
    assert.equal(hash(fs.readFileSync(source)),originalHash);groups++;
    const edit=open(source),rgba=new Uint8ClampedArray(36).fill(127),image=path.join(root,'new.png');fs.writeFileSync(image,encodePng(3,3,rgba));
    const rev=edit.info().revision;
    code(()=>edit.importImage({mode:'replace',index:4,imagePath:image}),'PIXEL_NOT_REPRESENTABLE');assert.equal(edit.info().revision,rev);
    edit.importImage({mode:'replace',index:12,imagePath:image});edit.importImage({mode:'fill',index:6,imagePath:image,x:-32768,y:32767});
    edit.importImage({mode:'append',imagePath:image,x:0,y:-1});edit.offsets([0,2,4],10,-20,true);edit.clear([3,7]);
    const changed=edit.listSlots(0);assert.equal(edit.info().slotCount,15);assert.equal(changed[3].status,'empty');
    for(let i=0;i<5;i++)edit.undo();assert.equal(edit.info().dirty,false);assert.equal(edit.info().slotCount,14);
    for(let i=0;i<5;i++)edit.redo();assert.deepEqual(edit.listSlots(0),changed);
    code(()=>edit.offsets([6],1,1,true),'OFFSET_RANGE');assert.deepEqual(edit.listSlots(0),changed);
    const target=path.join(root,'edited.pak'),result=edit.saveAs(target);assert.equal(result.verification.verifiedImages,12);
    assert.equal(result.verification.unchangedRecords,6);assert.equal(result.verification.emptySlots,3);
    const parsed=parseGomFile(target,password,loadParser(runtime));assert.deepEqual(parsed.blocks.map(b=>b.logicalIndex),[0,1,2,4,5,6,8,9,10,11,12,14]);
    assert.equal(hash(fs.readFileSync(source)),originalHash);groups++;
    const empty=open(source);empty.clear(empty.listSlots(0).filter(s=>s.status==='decoded').map(s=>s.index));
    assert.equal(empty.saveAs(path.join(root,'empty.pak')).verification.verifiedImages,0);assert.equal(empty.info().slotCount,14);groups++;
    for(const [name,opts] of Object.entries({tail:{tail:true},gap:{gap:true},alias:{alias:true},unknown:{unknown:true},old:{variant:1}})) {
      assert.throws(()=>open(fixture(path.join(root,`${name}.pak`),opts)),`${name} must be read-only`);
    }
    const pristine=open(source),nochange=path.join(root,'nochange.pak');pristine.saveAs(nochange);
    assert.deepEqual(fs.readFileSync(nochange),original,'canonical no-op must preserve every byte');groups++;
    const retiredSource=fixture(path.join(root,'retired.pak'),{retired:true}),retiredBytes=fs.readFileSync(retiredSource);
    const retired=open(retiredSource),retiredNoop=path.join(root,'retired-noop.pak');
    const noopResult=retired.saveAs(retiredNoop);
    assert.deepEqual(fs.readFileSync(retiredNoop),retiredBytes,'unindexed valid records survive no-op byte for byte');
    assert.equal(noopResult.verification.preservedUnindexedRecords,2);
    retired.offsets([0],-23,19);retired.clear([4]);
    retired.importImage({mode:'replace',index:12,imagePath:image});
    retired.importImage({mode:'fill',index:6,imagePath:image});retired.importImage({mode:'append',imagePath:image});
    const retiredTarget=path.join(root,'retired-edited.pak'),retiredResult=retired.saveAs(retiredTarget);
    assert.equal(retiredResult.verification.preservedUnindexedRecords,2);
    assert.equal(retiredResult.verification.preservedUnindexedBytes,noopResult.verification.preservedUnindexedBytes);
    assert.equal(retired.listSlots(0)[0].offsetX,-23);assert.equal(retired.listSlots(0)[4].status,'empty');
    assert.equal(retired.info().slotCount,15);assert.equal(retired.listSlots(0)[6].status,'decoded');
    assert.deepEqual(fs.readFileSync(retiredSource),retiredBytes);groups++;
    const corruptRetired=fixture(path.join(root,'retired-truncated.pak'),{retired:true});
    fs.truncateSync(corruptRetired,fs.statSync(corruptRetired).size-1);
    assert.throws(()=>open(corruptRetired),'an intact live index does not permit a truncated unindexed record');
    const protectedRetired=open(retiredSource),retiredTamper=path.join(root,'retired-tamper.pak'),flush=fs.fsyncSync;
    try{
      fs.fsyncSync=fd=>{flush(fd);const end=fs.fstatSync(fd).size;fs.writeSync(fd,Buffer.from([retiredBytes.at(-1)^255]),0,1,end-1);};
      assert.throws(()=>protectedRetired.saveAs(retiredTamper),'unindexed bytes are verified before publication');
    }finally{fs.fsyncSync=flush;}
    assert.equal(fs.existsSync(retiredTamper),false);groups++;
    const alias=path.join(root,'link.pak');fs.linkSync(source,alias);
    const safe=open(source);safe.offsets([0],-23,0);
    code(()=>safe.saveAs(source),'SOURCE_OVERWRITE_DISABLED');code(()=>safe.saveAs(target),'TARGET_EXISTS');
    code(()=>safe.saveAs(alias),'TARGET_EXISTS');
    const race=path.join(root,'race.pak'),link=fs.linkSync;
    try { fs.linkSync=(tmp,dst)=>{fs.writeFileSync(dst,'competing file');return link(tmp,dst);};code(()=>safe.saveAs(race),'TARGET_EXISTS'); }
    finally {fs.linkSync=link;}
    assert.equal(fs.readFileSync(race,'utf8'),'competing file');assert.equal(safe.info().dirty,true);
    const refused=path.join(root,'refused.pak');
    try {fs.linkSync=()=>{throw Object.assign(new Error('unsupported'),{code:'ENOTSUP'});};code(()=>safe.saveAs(refused),'ATOMIC_PUBLICATION_UNAVAILABLE');}
    finally {fs.linkSync=link;}
    assert.equal(fs.existsSync(refused),false);groups++;
    const failed=path.join(root,'failed.pak'),fsync=fs.fsyncSync;
    try {fs.fsyncSync=()=>{throw Object.assign(new Error('disk full'),{code:'ENOSPC'});};assert.throws(()=>safe.saveAs(failed));}
    finally {fs.fsyncSync=fsync;}
    assert.equal(fs.existsSync(failed),false);assert.equal(hash(fs.readFileSync(source)),originalHash);
    assert.deepEqual(fs.readdirSync(root).filter(f=>f.startsWith('.boo-gom-')),[]);groups++;
    const verifySource=fixture(path.join(root,'verify-source.pak')),verifySession=open(verifySource),verifyTarget=path.join(root,'verify-target.pak');
    try {fs.fsyncSync=fd=>{fsync(fd);fs.writeSync(fd,Buffer.from([0]),0,1,269+14*4);};assert.throws(()=>verifySession.saveAs(verifyTarget));}
    finally {fs.fsyncSync=fsync;}
    assert.equal(fs.existsSync(verifyTarget),false,'candidate verification failure never publishes');
    const published=path.join(root,'published.pak');
    try {fs.linkSync=(from,to)=>{link(from,to);fs.appendFileSync(verifySource,Buffer.from([42]));};
      assert.throws(()=>verifySession.saveAs(published),e=>e.code==='PUBLISHED_REVALIDATION_FAILED'&&e.published);}
    finally {fs.linkSync=link;}
    assert.equal(fs.existsSync(published),true,'published file must remain visible when postpublication verification fails');groups++;
    // Read-only admission must fully decode all images, not just accept an intact index/zlib prefix.
    const badPayload=fixture(path.join(root,'bad-payload.pak'));
    const badBytes=fs.readFileSync(badPayload),compressedBlock=parseGomFile(badPayload,password,loadParser(runtime)).blocks.find(b=>b.compressedSize);
    badBytes[compressedBlock.payloadOffset+compressedBlock.payloadSize-1]^=255;fs.writeFileSync(badPayload,badBytes);assert.throws(()=>open(badPayload));groups++;
    const changedSource=fixture(path.join(root,'external.pak')),external=open(changedSource);
    fs.appendFileSync(changedSource,Buffer.from([42]));code(()=>external.offsets([0],0,0),'SOURCE_CHANGED');code(()=>external.saveAs(path.join(root,'external-save.pak')),'SOURCE_CHANGED');
    external.close();code(()=>external.info(),'SESSION_CLOSED');groups++;
    console.log(`Resource editor GOM core: ${groups} groups PASS (synthetic fixtures; no client compatibility claim)`);
  } finally {for(const s of sessions)s.close();removeTemporaryDirectory(root,'boo-gom-edit-');}
}
module.exports={fixture,password};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
