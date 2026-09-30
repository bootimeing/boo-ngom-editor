const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const runtime=path.resolve(process.env.BOO_SCRIPT_RUNTIME_ROOT||path.join(__dirname,'..'));
const {resolveMerchantScriptReference,resolveMerchantScriptTarget,isMerchantScriptTargetSafe}=require(path.join(runtime,'out/utils/merchant-script'));
const {removeTemporaryDirectory}=require('./helpers/temp-cleanup');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'boo-merchant-script-'));
try{
 const envir=path.join(root,'服二','Mir200','Envir'),source=path.join(envir,'MerChant.txt');fs.mkdirSync(envir,{recursive:true});fs.writeFileSync(source,'');
 const ref='攻沙传送\\特殊称号1',map='王师征伐地',target=path.join(envir,'Market_Def','攻沙传送','特殊称号1-王师征伐地.txt');
 const resolve=(r=ref,m=map,ws=root)=>resolveMerchantScriptReference(ws,source,r,m);
 assert.equal(resolve().createPath,target);assert.equal(resolve().existingPath,undefined);
 assert.equal(resolve().relativePath,path.join('攻沙传送','特殊称号1-王师征伐地.txt'));
 assert.equal(resolveMerchantScriptTarget(root,source,resolve().relativePath).createPath,target,'creation and link resolution agree');
 assert.equal(resolve(ref+'.txt','$'+map).createPath,target,'no doubled extension; dynamic map prefix stripped');
 assert.equal(resolve('攻沙传送/特殊称号1').createPath,target);
 assert.equal(resolve(ref,map,envir).createPath,target,'Envir can be the workspace root');
 assert.equal(fs.existsSync(path.dirname(target)),false,'resolution never creates folders');
 const other=path.join(root,'服一','Mir200','Envir','Market_Def','攻沙传送');fs.mkdirSync(other,{recursive:true});fs.writeFileSync(path.join(other,path.basename(target)),'other');
 assert.equal(resolve().existingPath,undefined,'another server cannot satisfy this reference');
 fs.mkdirSync(path.dirname(target),{recursive:true});const fallback=path.join(path.dirname(target),'特殊称号1.txt');fs.writeFileSync(fallback,'fallback');
 assert.equal(resolve().existingPath,fallback);fs.writeFileSync(target,'preferred');assert.equal(resolve().existingPath,target);
 for(const unsafe of ['../逃逸','攻沙/../../逃逸','C:\\逃逸','\\\\host\\share','/绝对','攻沙\\x:stream','攻沙\\<$STR(S1)>','攻沙\\末尾.'])assert.equal(resolve(unsafe).createPath,undefined,unsafe);
 for(const unsafe of ['../逃逸','a/b','C:map','<$STR(S1)>'])assert.equal(resolve(ref,unsafe).createPath,undefined,unsafe);
 assert.equal(resolveMerchantScriptTarget(root,source,'../../escape.txt').createPath,undefined);
 assert.equal(resolveMerchantScriptReference(root,path.join(root,'Merchant.txt'),ref,map).createPath,undefined,'no guessed server outside Envir');
 assert.equal(isMerchantScriptTargetSafe(root,source,path.join(root,'outside.txt')),false);
 const external=path.join(root,'outside-market');fs.mkdirSync(external);const link=path.join(envir,'Market_Def','跳出');
 if(process.platform==='win32'){fs.symlinkSync(external,link,'junction');
  assert.equal(resolve('跳出\\NPC').createPath,undefined,'junction escape is rejected');
  fs.rmdirSync(link);
 }
 console.log('merchant-script-reference: PASS (Chinese paths, extensions, map prefix, server isolation, fallback, traversal/junction guards, pure resolution)');
}finally{removeTemporaryDirectory(root);}
