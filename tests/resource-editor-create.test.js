const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const runtime=path.resolve(process.env.BOO_PAK_RUNTIME_ROOT||path.join(__dirname,'..'));
const {createEmptyJpk}=require(path.join(runtime,'out/resource-editor/create-jpk'));
const {JpkEditSession}=require(path.join(runtime,'out/resource-editor/jpk-session'));
const {removeTemporaryDirectory}=require('./helpers/temp-cleanup');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'boo-create-jpk-'));
try{
 for(const count of [0,1,101,999999]){
  const file=path.join(root,'new-'+count+'.jpk'),password='synthetic-create-test';
  createEmptyJpk(file,password,count);
  const s=JpkEditSession.open({extensionPath:runtime,sourcePath:file,password});
  try{
   assert.equal(s.info().slotCount,count);assert.equal(s.info().imageCount,0);
   s.importImage({mode:count?'fill':'append',...(count?{index:count-1}:{}),image:{width:3,height:3,rgba:new Uint8ClampedArray(36).fill(111)}});
   const result=s.saveAs(path.join(root,'saved-'+count+'.jpk'));assert.equal(result.verification.verifiedImages,1);
  }finally{s.close();}
  assert.throws(()=>createEmptyJpk(file,password,count),/TARGET_EXISTS/);
 }
 const link=fs.linkSync,failed=path.join(root,'raced.jpk');
 try{fs.linkSync=(a,b)=>{fs.writeFileSync(b,'external',{flag:'wx'});return link(a,b);};assert.throws(()=>createEmptyJpk(failed,'',0));}finally{fs.linkSync=link;}
 assert.equal(fs.readFileSync(failed,'utf8'),'external');assert.ok(!fs.readdirSync(root).some(n=>n.startsWith('.boo-new')));
 console.log('Resource create PASS: empty/1/101/999999 slots, fill/append/save/reopen, no-clobber target race');
}finally{removeTemporaryDirectory(root,'boo-create-jpk-');}
