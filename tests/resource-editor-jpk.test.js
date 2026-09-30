const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const iconv = require('iconv-lite');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const { JpkEditSession } = require(path.join(runtime, 'out/resource-editor/jpk-session'));
const codec = require(path.join(runtime, 'out/resource-editor/image-codec'));
const reader = require(path.join(runtime, 'out/utils/jpk-reader'));
const { encodePng, crc32 } = require(path.join(runtime, 'out/utils/pak-reader'));
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const password = 'synthetic-editor-测试';
const palette = require(path.join(runtime, 'media/geepak3_exact.js')).A8_PALETTE_BGRA;

// Fixture encoder uses its own RC4/KSA and explicit byte records; no production writer dependency.
function crypt(bytes) {
  const key = crypto.createHash('sha1').update(iconv.encode(password, 'cp936')).digest();
  const s = Array.from({ length: 256 }, (_, i) => i); let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; }
  let a = 0, b = 0;
  return Buffer.from(bytes, 0, bytes.length).map(byte => {
    a = (a + 1) & 255; b = (b + s[a]) & 255; [s[a], s[b]] = [s[b], s[a]];
    return byte ^ s[(s[a] + s[b]) & 255];
  });
}
function fixture(file, options = {}) {
  const defs = [8, 16, 24, 32].flatMap(bits => [false, true].map(alpha => ({ bits, alpha })));
  const index = Buffer.alloc(9 * 4), parts = [], header = Buffer.alloc(80);
  let cursor = 80;
  defs.forEach(({ bits, alpha }, ordinal) => {
    const id = ordinal ? ordinal + 1 : 0, stride = ((3 * bits + 31) >> 5) << 2;
    const raw = Buffer.alloc(stride * 3 + (alpha ? 12 : 0));
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      const at = y * stride + x * bits / 8;
      if (bits === 8) raw[at] = x + y * 3 + 1;
      else if (bits === 16) raw.writeUInt16LE([0xf800, 0x07e0, 0x001f][x], at);
      else { raw[at] = x * 15; raw[at + 1] = y * 40; raw[at + 2] = 120; }
      if (alpha) raw[stride * 3 + y * 4 + x] = x * 40 + y * 20;
    }
    const record = Buffer.alloc(20), payload = crypt(ordinal % 2 ? raw : zlib.deflateSync(raw));
    record[0] = bits; record[1] = ordinal % 2 ? 0 : 1;
    record.writeUInt16LE(3, 2); record.writeUInt16LE(3, 4);
    record.writeInt16LE(-ordinal - 1, 6); record.writeInt16LE(ordinal + 2, 8);
    record.writeUInt16LE(74, 10); record.writeUInt32LE(payload.length, 12); record[16] = alpha ? 1 : 0;
    record.set([47, 64, 0], 17);
    index.writeUInt32LE(cursor, id * 4); parts.push(record, payload); cursor += 20 + payload.length;
  });
  const title = options.variant === '996M2' ? '996M2 GameLib 2026/09/26' : 'GameLib';
  header[0] = title.length; header.write(title, 1); header.writeUInt32LE(80, 44);
  header.writeUInt32LE(9, 48); header.writeUInt32LE(cursor, 52); header.writeDoubleLE(1234.5, 56);
  header.set([29, 31, 37, 41], 70);
  fs.writeFileSync(file, Buffer.concat([crypt(header), ...parts, index])); return file;
}
function chunk(kind, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(kind, 4);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}
function png(type, pixels, options = {}) {
  const width = 3, height = options.height || 3, channels = ({0:1,2:3,3:1,4:2,6:4})[type];
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = options.depth || 8; header[9] = type; header[12] = options.interlace || 0;
  const raw = Buffer.alloc((width * channels + 1) * height), stride = width * channels;
  for (let y = 0; y < height; y++) {
    const filter = options.filters ? y % 5 : 0; raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y ? pixels[(y - 1) * stride + x] : 0, upperLeft = y && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = left + up - upperLeft, distances = [Math.abs(p-left),Math.abs(p-up),Math.abs(p-upperLeft)];
      const predictor = [left,up,upperLeft][distances.indexOf(Math.min(...distances))];
      const delta = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left+up)/2) : predictor;
      raw[y * (stride + 1) + 1 + x] = (pixels[y * stride + x] - delta) & 255;
    }
  }
  const chunks = [chunk('IHDR', header)];
  if (options.palette) chunks.push(chunk('PLTE', options.palette));
  if (options.transparency) chunks.push(chunk('tRNS', options.transparency));
  if (options.animated) chunks.push(chunk('acTL', Buffer.alloc(8)));
  chunks.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), ...chunks]);
}
function bmp(depth, topDown = false, alpha = 0) {
  const stride = ((3 * depth + 31) >> 5) * 4, result = Buffer.alloc(54 + stride * 3);
  result.write('BM'); result.writeUInt32LE(result.length, 2); result.writeUInt32LE(54, 10);
  result.writeUInt32LE(40, 14); result.writeInt32LE(3, 18); result.writeInt32LE(topDown ? -3 : 3, 22);
  result.writeUInt16LE(1, 26); result.writeUInt16LE(depth, 28);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    const p = 54 + y * stride + x * depth / 8; result[p] = 13; result[p+1] = 17; result[p+2] = 23;
    if (depth === 32) result[p+3] = alpha;
  }
  return result;
}
function errorCode(action, code) { assert.throws(action, error => error.code === code, code); }

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-jpk-edit-')); const sessions = [];
  const open = file => { const session = JpkEditSession.open({ extensionPath: runtime, sourcePath: file, password }); sessions.push(session); return session; };
  let groups = 0;
  try {
    const source = fixture(path.join(root, 'source.jpk')), original = fs.readFileSync(source), originalHash = sha(original);
    const session = open(source); assert.equal(session.info().slotCount, 9); assert.equal(session.info().imageCount, 8);
    assert.equal(session.info().dirty, false); assert.deepEqual(session.listSlots(0).map(s => s.index),[0,1,2,3,4,5,6,7,8]);
    const openedByState = JpkEditSession.open({ extensionPath: runtime, sourcePath: source, rc4State: reader.deriveJpkRc4State(password) });
    assert.equal(openedByState.info().sourceSha256, originalHash); openedByState.close();
    assert.throws(() => JpkEditSession.open({ extensionPath: runtime, sourcePath: source, password: 'wrong' }));
    errorCode(() => session.previewPng(1), 'EMPTY_SLOT'); errorCode(() => session.listSlots(0, 101),'INVALID_PAGE'); groups++;

    // Every source bit-depth/alpha combination round-trips an exact imported PNG.
    for (const row of session.listSlots(0).filter(row => row.status === 'decoded')) {
      const image = path.join(root, `exact-${row.index}.png`), expected = session.previewPng(row.index);
      fs.writeFileSync(image, expected); session.importImage({ mode: 'replace', index: row.index, imagePath: image });
      assert.deepEqual(codec.decodeResourcePng(session.previewPng(row.index)).rgba, codec.decodeResourcePng(expected).rgba);
    }
    const exactTarget = path.join(root, 'exact.jpk'); const exact = session.saveAs(exactTarget);
    assert.equal(exact.verification.verifiedImages, 8); assert.equal(exact.sourceSha256Before, exact.sourceSha256After);
    assert.equal(session.info().sourcePath, fs.realpathSync(exactTarget)); assert.equal(session.info().dirty, false);
    assert.equal(session.info().canUndo, false); assert.equal(session.info().canRedo, false);
    assert.equal(session.previewPng(0).length > 0, true, 'target ctime baseline must survive removal of staging hard link');
    const exactBytes = fs.readFileSync(exactTarget), exactParsed = reader.parseJpkFile(exactTarget,password);
    for (const block of exactParsed.blocks) {
      assert.equal(exactBytes.readUInt16LE(block.headerOffset+10),74);
      assert.equal(exactBytes.subarray(block.headerOffset+17,block.headerOffset+20).toString('hex'),'2f4000');
    }
    assert.equal(sha(fs.readFileSync(source)), originalHash); groups++;

    const image = path.join(root, 'new.png'), pixels = new Uint8ClampedArray(3*3*4).fill(127);
    fs.writeFileSync(image,encodePng(3,3,pixels));
    const edit = open(source), startRevision = edit.info().revision;
    edit.importImage({mode:'replace',index:8,imagePath:image});
    edit.importImage({mode:'fill',index:1,imagePath:image,x:-32768,y:32767});
    edit.importImage({mode:'append',imagePath:image,x:4,y:-7});
    edit.offsets([0,2,4],10,-20,true); edit.clear([3,6]);
    assert.equal(edit.info().slotCount,10); assert.equal(edit.info().imageCount,8); assert.equal(edit.info().revision,startRevision+5);
    const changed = edit.listSlots(0); assert.equal(changed[1].offsetX,-32768); assert.equal(changed[3].status,'empty');
    for(let i=0;i<5;i++)edit.undo(); assert.equal(edit.info().dirty,false);assert.equal(edit.info().slotCount,9);
    for(let i=0;i<5;i++)edit.redo(); assert.deepEqual(edit.listSlots(0),changed);
    edit.undo(); const revision=edit.info().revision;
    errorCode(()=>edit.offsets([1],1,1,true),'OFFSET_RANGE'); assert.equal(edit.info().revision,revision); assert.equal(edit.info().canRedo,true);
    edit.redo();
    errorCode(()=>edit.importImage({mode:'fill',index:0,imagePath:image}),'SLOT_MODE_MISMATCH');
    errorCode(()=>edit.importImage({mode:'replace',index:3,imagePath:image}),'SLOT_MODE_MISMATCH');
    errorCode(()=>edit.importImage({mode:'replace',index:0,imagePath:image}),'PIXEL_NOT_REPRESENTABLE');
    const target=path.join(root,'edited.jpk'), saved=edit.saveAs(target);
    assert.equal(saved.verification.slotCount,10);assert.equal(saved.verification.emptySlots,2);
    assert.equal(saved.verification.unchangedRecords,2); assert.equal(edit.info().dirty,false);
    const parsed=reader.parseJpkFile(target,password);assert.deepEqual(parsed.blocks.map(b=>b.logicalIndex),[0,1,2,4,5,7,8,9]);
    assert.equal(sha(fs.readFileSync(source)),originalHash);groups++;

    const alias=path.join(root,'existing-source-link.jpk');fs.linkSync(source,alias);
    const boundary = open(source), beforeInfo=boundary.info();
    errorCode(()=>boundary.saveAs(source),'SOURCE_OVERWRITE_DISABLED');
    errorCode(()=>boundary.saveAs(target),'TARGET_EXISTS');
    errorCode(()=>boundary.saveAs(alias),'TARGET_EXISTS');
    assert.equal(boundary.info().revision,beforeInfo.revision);
    const initialLink=fs.linkSync;
    try{
      fs.linkSync=()=>{throw Object.assign(new Error('unsupported'),{code:'ENOTSUP'});};
      errorCode(()=>boundary.saveAs(path.join(root,'no-hardlinks.jpk')),'ATOMIC_PUBLICATION_UNAVAILABLE');
      assert.equal(fs.existsSync(path.join(root,'no-hardlinks.jpk')),false);
    }finally{fs.linkSync=initialLink;}
    assert.equal(fs.readdirSync(root).some(n=>n.startsWith('.boo-jpk-')),false);groups++;

    for(const defect of ['trailer','alias','gap','erased','unknown-flags','bad-payload']){
      const file=fixture(path.join(root,defect+'.jpk')), bytes=fs.readFileSync(file);
      const normal=reader.parseJpkFile(file,password);
      if(defect==='trailer')fs.appendFileSync(file,Buffer.from([0]));
      else{
        if(defect==='alias')bytes.writeUInt32LE(normal.blocks[0].headerOffset,normal.indexOffset+8);
        if(defect==='gap')bytes.writeUInt32LE(0,normal.indexOffset);
        if(defect==='erased')bytes.fill(0,80,100);
        if(defect==='unknown-flags')bytes[81]=2;
        if(defect==='bad-payload')bytes[100]^=255;
        fs.writeFileSync(file,bytes);
      }
      assert.throws(()=>open(file),undefined,defect);
    }groups++;

    const ioFile=fixture(path.join(root,'io-source.jpk')), ioSession=open(ioFile), ioTarget=path.join(root,'io-target.jpk');
    const initialSync=fs.fsyncSync;
    try{fs.fsyncSync=()=>{throw Object.assign(new Error('disk full'),{code:'ENOSPC'});};assert.throws(()=>ioSession.saveAs(ioTarget));}
    finally{fs.fsyncSync=initialSync;}
    assert.equal(fs.existsSync(ioTarget),false);assert.equal(fs.readdirSync(root).some(n=>n.startsWith('.boo-jpk-')),false);
    try{
      fs.fsyncSync=fd=>{initialSync(fd);fs.writeSync(fd,Buffer.from([0]),0,1,80);};
      assert.throws(()=>ioSession.saveAs(ioTarget));
    }finally{fs.fsyncSync=initialSync;}
    assert.equal(fs.existsSync(ioTarget),false,'failed full reader verification must never publish');
    const initialParse=reader.parseJpkFileWithState;
    try{
      reader.parseJpkFileWithState=(file,state)=>{const result=initialParse(file,state);if(file.endsWith('.tmp'))fs.appendFileSync(ioFile,Buffer.from([1]));return result;};
      errorCode(()=>ioSession.saveAs(ioTarget),'SOURCE_CHANGED');
    }finally{reader.parseJpkFileWithState=initialParse;}
    assert.equal(fs.existsSync(ioTarget),false);groups++;

    const raceSource=fixture(path.join(root,'race-source.jpk')), race=open(raceSource), raceTarget=path.join(root,'race-target.jpk');
    try{
      fs.linkSync=(from,to)=>{fs.writeFileSync(to,'other-process',{flag:'wx'});return initialLink(from,to);};
      errorCode(()=>race.saveAs(raceTarget),'TARGET_EXISTS');
    }finally{fs.linkSync=initialLink;}
    assert.equal(fs.readFileSync(raceTarget,'utf8'),'other-process');
    const publishedTarget=path.join(root,'published.jpk');
    try{
      fs.linkSync=(from,to)=>{initialLink(from,to);fs.appendFileSync(raceSource,Buffer.from([1]));};
      assert.throws(()=>race.saveAs(publishedTarget),error=>error.code==='PUBLISHED_REVALIDATION_FAILED'&&error.published===true);
    }finally{fs.linkSync=initialLink;}
    assert.equal(fs.existsSync(publishedTarget),true,'published result must not be deleted to hide failed postpublication audit');groups++;

    for(const type of [0,2,3,4,6]){
      const channels=({0:1,2:3,3:1,4:2,6:4})[type],bytes=Buffer.alloc(9*channels,1);
      const options=type===3?{palette:Buffer.from([0,0,0,23,17,13]),transparency:Buffer.from([255,42])}:{};
      const result=codec.decodeResourcePng(png(type,bytes,options)); assert.equal(result.rgba.length,36);
      if(type===3)assert.deepEqual([...result.rgba.subarray(0,4)],[23,17,13,42]);
      else assert.equal(result.rgba[3],type===4||type===6?1:255);
    }
    const filterPixels=Buffer.from(Array.from({length:3*5*4},(_,i)=>(i*53)&255));
    assert.deepEqual(Buffer.from(codec.decodeResourcePng(png(6,filterPixels,{filters:true,height:5})).rgba),filterPixels);
    for(const options of [{depth:16},{interlace:1},{animated:true}])assert.throws(()=>codec.decodeResourcePng(png(6,Buffer.alloc(36),options)));
    const checksum=png(6,Buffer.alloc(36));checksum[40]^=1;assert.throws(()=>codec.decodeResourcePng(checksum));
    for(const depth of [24,32])for(const topDown of [true,false])assert.deepEqual([...codec.decodeResourceBmp(bmp(depth,topDown)).rgba.subarray(0,4)],[23,17,13,255]);
    errorCode(()=>codec.decodeResourceBmp(bmp(32,false,127)),'UNSUPPORTED_BMP_ALPHA');
    const bmpFile=path.join(root,'picture.bmp');fs.writeFileSync(bmpFile,bmp(24));
    const fromBmp=open(source);fromBmp.importImage({mode:'fill',index:1,imagePath:bmpFile});
    assert.deepEqual([...codec.decodeResourcePng(fromBmp.previewPng(1)).rgba.subarray(0,4)],[23,17,13,255]);groups++;

    const m2=fixture(path.join(root,'m2.jpk'),{variant:'996M2'}), m2Session=open(m2);
    assert.equal(m2Session.info().profileId,'jpk-996M2'); m2Session.offsets([0],7,-9);m2Session.saveAs(path.join(root,'m2-save.jpk'));
    assert.equal(reader.parseJpkFile(path.join(root,'m2-save.jpk'),password).variant,'996M2');
    for(let i=0;i<110;i++)m2Session.offsets([0],i,-i);let undone=0;
    while(m2Session.info().canUndo){m2Session.undo();undone++;}assert.equal(undone,100);
    m2Session.close();errorCode(()=>m2Session.info(),'SESSION_CLOSED');groups++;
    const memorySession=open(fixture(path.join(root,'memory.jpk'))), largeImage=path.join(root,'large.png');
    fs.writeFileSync(largeImage,encodePng(2048,2048,new Uint8ClampedArray(2048*2048*4).fill(55)));
    let accepted=0;
    while(accepted<10){
      try{memorySession.importImage({mode:'replace',index:8,imagePath:largeImage});accepted++;}
      catch(error){assert.equal(error.code,'EDIT_MEMORY_LIMIT');break;}
    }
    assert.equal(accepted,3,'four retained 16 MiB RGBA + 20 MiB raw BGRX/A8 payloads exceed the 128 MiB budget');
    assert.equal(memorySession.info().revision,accepted);assert.equal(memorySession.info().canUndo,true);
    for(let i=0;i<accepted;i++)memorySession.undo();assert.equal(memorySession.info().dirty,false);memorySession.close();groups++;
    console.log(`resource-editor-jpk.test.js: PASS (${groups} groups; 8 pixel layouts, strict PNG/BMP, CRUD/batch offsets, undo/redo, no-clobber save/reopen, source/unknown fields, failed publication)`);
  }finally{for(const session of sessions)session.close();removeTemporaryDirectory(root);}
}
module.exports = { fixture, password };
if (require.main === module) main().catch(error=>{console.error(error);process.exitCode=1;});
