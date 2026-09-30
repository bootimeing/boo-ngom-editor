const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const runtime=path.resolve(process.env.BOO_PAK_RUNTIME_ROOT||path.join(__dirname,'..'));
const {PairEditSession}=require(path.join(runtime,'out/resource-editor/pair-session'));
const {encodePng}=require(path.join(runtime,'out/utils/pak-reader'));
const {decodeResourcePng}=require(path.join(runtime,'out/resource-editor/image-codec'));
const {parseWilWzlArchive}=require(path.join(runtime,'out/utils/wil-wzl-reader'));
const {removeTemporaryDirectory}=require('./helpers/temp-cleanup');
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function fixture(file,options={}) {
 const wil=path.extname(file)==='.wil',color=options.color||65536,prefix=Buffer.alloc(wil?56+(color===256||options.palettePrefix?1024:0):64);
 const defs=wil?[[color===256?3:color===65536?5:6,0,false],[color===256?3:color===65536?5:6,0,false]]:
  [[3,0,false],[3,1,true],[5,0,false],[5,1,true],[5,9,true],[6,0,false],[6,1,true],[8,0,false]];
 const count=defs.length+1,index=Buffer.alloc(48+count*4),records=[];prefix[0]=21;prefix[30]=73;index[0]=17;index[31]=119;
 prefix.writeUInt32LE(count,44);index.writeUInt32LE(count,44);
 if(wil){prefix.writeUInt32LE(color,48);prefix.writeUInt32LE(prefix.length-56,52);if(color===256){prefix.set([0,0,255,0],60);prefix.set([0,255,0,0],64);}}
 let cursor=prefix.length;
 defs.forEach(([type,flags,compressed],i)=>{
  const id=i?i+1:0,width=3,height=3,bpp=type===3?1:type===5?2:3,stride=options.tight?width*bpp:(width*bpp+3)&~3;
  const raw=Buffer.alloc(stride*height+(flags===9?Math.ceil(width/2)*height:0));
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const at=y*stride+x*bpp;if(type===3)raw[at]=x;
   else if(type===5)raw.writeUInt16LE([0,0xf800,0x07e0][x],at);
   else raw.set([x?15:0,x?y*35:0,x?255:0],at);
   if(flags===9){const a=[0,8,15][x],pos=stride*height+y*2+Math.floor(x/2);raw[pos]|=x%2?a:a<<4;}
  }
  const rgba=new Uint8ClampedArray(36).fill(127),payload=type===8?encodePng(3,3,rgba):compressed?zlib.deflateSync(raw):raw;
  const h=Buffer.alloc(wil?8:16),at=wil?0:4;
  if(!wil){h[0]=type;h[1]=flags;h.writeUInt16LE(317,2);h.writeUInt32LE(compressed||type===8?payload.length:0,12);}
  h.writeUInt16LE(width,at);h.writeUInt16LE(height,at+2);h.writeInt16LE(-3-i,at+4);h.writeInt16LE(4+i,at+6);
  index.writeUInt32LE(cursor,48+id*4);records.push(h,payload);cursor+=h.length+payload.length;
 });
 const companion=file.slice(0,-4)+(wil?'.wix':'.wzx');fs.writeFileSync(file,Buffer.concat([prefix,...records]));fs.writeFileSync(companion,index);return file;
}
function code(fn,expected){assert.throws(fn,e=>e.code===expected,expected);}
async function main(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'boo-pair-edit-')),sessions=[];
 const open=file=>{const s=PairEditSession.open({extensionPath:runtime,sourcePath:file});sessions.push(s);return s;};let groups=0;
 try{
  for(const [name,opts]of [['palette.wil',{color:256}],['rgb16.wil',{palettePrefix:true}],['rgb24.wil',{color:16777216,tight:true}],['mixed.wzl',{}],['tight.wzl',{tight:true}]]){
   const source=fixture(path.join(root,name),opts),pair=parseWilWzlArchive(source),before=[hash(source),hash(pair.companionPath)],s=open(source);
   assert.equal(s.info().dirty,false);assert.equal(s.info().saveMode,'directory');assert.equal(s.listSlots(0)[1].status,'empty');
   const noOp=path.join(root,name+'-noop'),r=s.saveAs(noOp);
   assert.equal(hash(r.session.sourcePath),before[0]);assert.equal(hash(parseWilWzlArchive(r.session.sourcePath).companionPath),before[1]);
   const edit=open(source),rows=edit.listSlots(0);
   for(const row of rows.filter(r=>r.status==='decoded')){const image=path.join(root,name+'-'+row.index+'.png'),png=edit.previewPng(row.index);fs.writeFileSync(image,png);
    edit.importImage({mode:'replace',index:row.index,imagePath:image});assert.deepEqual(decodeResourcePng(edit.previewPng(row.index)).rgba,decodeResourcePng(png).rgba);}
   const image=path.join(root,name+'-0.png');edit.importImage({mode:'fill',index:1,imagePath:image,x:-32768,y:32767});edit.importImage({mode:'append',imagePath:image});
   edit.offsets([0],17,-20);edit.clear([0]);edit.undo();assert.equal(edit.listSlots(0)[0].offsetX,17);edit.redo();assert.equal(edit.listSlots(0)[0].status,'empty');edit.undo();
   const target=path.join(root,name+'-edited'),result=edit.saveAs(target);assert.equal(result.verification.verifiedImages,pair.blocks.length+2);
   assert.equal(result.verification.emptySlots,0);assert.equal(edit.info().dirty,false);assert.equal(edit.info().canUndo,false);
   assert.equal(hash(source),before[0]);assert.equal(hash(pair.companionPath),before[1]);groups++;
  }
  const source=fixture(path.join(root,'safe.wzl')),pair=parseWilWzlArchive(source),s=open(source),before=[hash(source),hash(pair.companionPath)];s.offsets([0],-23,0);
  const existing=path.join(root,'existing');fs.mkdirSync(existing);code(()=>s.saveAs(existing),'TARGET_EXISTS');assert.deepEqual(fs.readdirSync(existing),[]);
  const rename=fs.renameSync,race=path.join(root,'race');
  try{fs.renameSync=(from,to)=>{fs.mkdirSync(to);return rename(from,to);};code(()=>s.saveAs(race),'TARGET_EXISTS');}finally{fs.renameSync=rename;}
  assert.deepEqual(fs.readdirSync(race),[]);assert.equal(s.info().dirty,true);groups++;
  const sync=fs.fsyncSync,failed=path.join(root,'failed');let syncCalls=0;
  try{fs.fsyncSync=fd=>{if(++syncCalls===2)throw Object.assign(Error('full'),{code:'ENOSPC'});sync(fd);};assert.throws(()=>s.saveAs(failed));}finally{fs.fsyncSync=sync;}
  assert.equal(fs.existsSync(failed),false);assert.deepEqual([hash(source),hash(pair.companionPath)],before);
  assert.equal(fs.readdirSync(root).filter(n=>n.startsWith('.boo-pair-')).length,0);groups++;
  const wrong=path.join(root,'bad-target');
  try{fs.fsyncSync=fd=>{sync(fd);if(fs.fstatSync(fd).size>100)fs.writeSync(fd,Buffer.from([255]),0,1,44);};assert.throws(()=>s.saveAs(wrong));}finally{fs.fsyncSync=sync;}
  assert.equal(fs.existsSync(wrong),false);groups++;
  for(const defect of ['tail','index-tail','alias','count','flags','blank-sentinel']){
   const file=fixture(path.join(root,defect+'.wzl')),a=parseWilWzlArchive(file),data=fs.readFileSync(file),ix=fs.readFileSync(a.companionPath);
   if(defect==='tail')fs.appendFileSync(file,Buffer.from([42]));
   else if(defect==='index-tail')fs.appendFileSync(a.companionPath,Buffer.alloc(4));
   else if(defect==='alias'){ix.writeUInt32LE(ix.readUInt32LE(48),56);fs.writeFileSync(a.companionPath,ix);}
   else {if(defect==='count')data.writeUInt32LE(100,44);if(defect==='flags')data[a.blocks[0].payloadOffset-15]=5;if(defect==='blank-sentinel')data.fill(0,64,80);fs.writeFileSync(file,data);}
   assert.throws(()=>open(file),undefined,defect);
  }groups++;
  const changed=fixture(path.join(root,'changed.wil')),changedPair=parseWilWzlArchive(changed),external=open(changed);fs.appendFileSync(changedPair.companionPath,Buffer.from([1]));
  code(()=>external.saveAs(path.join(root,'external')),'SOURCE_CHANGED');code(()=>external.offsets([0],0,0),'SOURCE_CHANGED');groups++;
  console.log(`Resource pair editor: ${groups} groups PASS; Windows atomic new-directory save; no overwrite support`);
 }finally{for(const s of sessions)s.close();removeTemporaryDirectory(root,'boo-pair-edit-');}
}
module.exports={fixture};if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
