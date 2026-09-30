const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const runtime=path.resolve(process.env.BOO_PAK_RUNTIME_ROOT||path.join(__dirname,'..'));
const {prepareResourceBatch,applyResourceBatch,copyResourceFrames}=require(path.join(runtime,'out/resource-editor/batch'));
const {transformResourceImage}=require(path.join(runtime,'out/resource-editor/image-transform'));
const {decodeResourcePng}=require(path.join(runtime,'out/resource-editor/image-codec'));
const {encodePng}=require(path.join(runtime,'out/utils/pak-reader'));
const {removeTemporaryDirectory}=require('./helpers/temp-cleanup');
const jpk=require('./resource-editor-jpk.test'),gom=require('./resource-editor-gom.test'),pair=require('./resource-editor-pair.test');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'boo-batch-')),sessions=[];
const snapshot=s=>({info:s.info(),slots:s.listSlots(0,100)});
try {
 for(const [ext,fixture,ctor,password]of[
  ['jpk',jpk.fixture,'JpkEditSession',jpk.password],['pak',gom.fixture,'GomEditSession',gom.password],
  ['wil',pair.fixture,'PairEditSession',''],['wzl',pair.fixture,'PairEditSession','']]){
  const module=ext==='jpk'?'jpk-session':ext==='pak'?'gom-session':'pair-session';
  const source=fixture(path.join(root,'source.'+ext)),s=require(path.join(runtime,'out/resource-editor/'+module))[ctor].open({extensionPath:runtime,sourcePath:source,password});sessions.push(s);
  const before=snapshot(s),png=s.previewPng(0),original=decodeResourcePng(png);
  const files=[1,0].map(id=>{const f=path.join(root,'Image_'+String(id).padStart(6,'0')+'.png');fs.writeFileSync(f,png);return f;});
  const plan=prepareResourceBatch(s,{kind:'import',paths:files,mapping:'filename',start:0});
  assert.deepEqual(plan.rows.map(r=>r.index),[0,1]);assert.deepEqual(snapshot(s),before,'preview leaves state/history unchanged');
  applyResourceBatch(s,plan);assert.equal(s.info().revision,before.info.revision+1);assert.deepEqual(decodeResourcePng(s.previewPng(1)).rgba,original.rgba);
  assert.throws(()=>applyResourceBatch(s,plan),/STALE_REVISION/);s.undo();assert.deepEqual(s.listSlots(0),before.slots);
  const undone=snapshot(s);prepareResourceBatch(s,{kind:'offsets',ids:[0],x:1,y:-2,relative:true});assert.deepEqual(snapshot(s),undone,'preview preserves redo');
  s.redo();assert.deepEqual(decodeResourcePng(s.previewPng(1)).rgba,original.rgba);
  const dirty=snapshot(s);assert.throws(()=>s.atomic(()=>{s.clear([0]);s.offsets([9999999],0,0);}));assert.deepEqual(snapshot(s),dirty,'partial batch rolls back');
  const cancelled=prepareResourceBatch(s,{kind:'import',paths:files,mapping:'filename',start:0});
  let checks=0;assert.throws(()=>applyResourceBatch(s,cancelled,false,()=>{if(++checks===2)throw Error('CANCELLED');}),/CANCELLED/);
  assert.deepEqual(snapshot(s),dirty,'cancel after first encoded action restores whole batch');
  const overflow=snapshot(s);assert.throws(()=>prepareResourceBatch(s,{kind:'offsets',ids:[0,1],x:-32768,y:0,relative:true}));assert.deepEqual(snapshot(s),overflow);
  assert.throws(()=>prepareResourceBatch(s,{kind:'import',paths:[files[0],files[0]],mapping:'filename',start:0}),/DUPLICATE_ID/);
  const copy=copyResourceFrames(s,[0,1]),paste=prepareResourceBatch(s,{kind:'paste',frames:copy,start:0,append:true});applyResourceBatch(s,paste);
  assert.equal(s.info().slotCount,dirty.info.slotCount+2);s.undo();assert.equal(s.info().slotCount,dirty.info.slotCount);s.redo();
  const preMirror=decodeResourcePng(s.previewPng(0)),mirror=prepareResourceBatch(s,{kind:'transform',ids:[0],transform:{kind:'mirrorX'}});applyResourceBatch(s,mirror);
  const flipped=decodeResourcePng(s.previewPng(0));
  for(let y=0;y<3;y++)for(let x=0;x<3;x++)assert.deepEqual(flipped.rgba.slice((y*3+x)*4,(y*3+x+1)*4),preMirror.rgba.slice((y*3+2-x)*4,(y*3+3-x)*4));
  const output=path.join(root,'saved-'+ext+(ext==='wil'||ext==='wzl'?'':'.'+ext));const result=s.saveAs(output);assert.equal(result.verification.reopened,true);
 }
 const data=new Uint8ClampedArray(7*7*4);for(let y=2;y<5;y++)for(let x=1;x<4;x++)data.set([x*30,y*20,9,255],(y*7+x)*4);
 const image={width:7,height:7,rgba:data},trim=transformResourceImage(image,{kind:'trim'});assert.deepEqual([trim.image.width,trim.image.height,trim.dx,trim.dy],[3,3,1,2]);
 const j=sessions[0],id=j.info().slotCount;j.importImage({mode:'append',image,x:-15,y:0});
 applyResourceBatch(j,prepareResourceBatch(j,{kind:'transform',ids:[id],transform:{kind:'trim'}}));
 assert.deepEqual([j.listSlots(id,1)[0].offsetX,j.listSlots(id,1)[0].offsetY],[-14,2]);
 const opaque=transformResourceImage({width:3,height:3,rgba:new Uint8ClampedArray(36)},{kind:'trim'});assert.equal(opaque.image.width,3);
 const scaled=transformResourceImage(trim.image,{kind:'scale',percent:200});assert.deepEqual([scaled.image.width,scaled.image.height],[6,6]);
 assert.throws(()=>transformResourceImage(image,{kind:'scale',percent:0}),/INVALID_SCALE/);
 const clipboard=copyResourceFrames(j,[id]),wzl=sessions[3],wil=sessions[2];
 applyResourceBatch(wzl,prepareResourceBatch(wzl,{kind:'paste',frames:clipboard,start:0,append:true}));
 assert.throws(()=>prepareResourceBatch(wil,{kind:'paste',frames:clipboard,start:0,append:true}),e=>e.code==='PIXEL_NOT_REPRESENTABLE');
 console.log('Resource batch PASS: 4 profiles; actual encoders, atomic history/rollback, preflight, clipboard, transformations and save/reopen');
}finally{for(const s of sessions)s.close();removeTemporaryDirectory(root,'boo-batch-');}
