const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {createFixture,runtime}=require('./helpers/preview-constants-fixture');
const {dialogProgramSource}=require(path.join(runtime,'out/ui-dialog/preview-script-model'));
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function run(){
 const fixture=await createFixture();
 try{
  const {host,session,primary,definesPath,primaryPath,edits,events}=fixture;
  const originals={primary:hash(primaryPath),definitions:hash(definesPath)};
  assert.ok(fixture.source.startsWith('#INCLUDE 预览常量.ini\r\n[@main]\r\n'),'fixture explicitly covers a CRLF header INCLUDE before the function label');
  const elements=()=>session.model.pages.find(page=>page.sourceLabel==='@main').elements;
  const title=()=>elements().find(element=>element.text==='欢迎进入常量预览');
  assert.ok(title()?.editable);assert.equal(title().x.displayValue,46);assert.equal(title().y.displayValue,46);
  assert.ok(elements().some(element=>element.text==='数量=40 合计=42'));
  assert.ok(elements().some(element=>element.text==='输入=0'));
  const loaded=dialogProgramSource(session.model,fixture.uri(definesPath).toString());
  assert.ok(loaded&&loaded.encoding==='gbk'&&loaded.sha256===originals.definitions,'production reader must decode/hash the real Defines file');
  assert.ok(session.model.scriptSourceCandidateFilePaths.includes(definesPath));
  const fixed=elements().find(element=>element.text==='常量坐标只读');
  assert.equal(fixed.x.displayValue,86);assert.equal(fixed.editable,false);
  fixed.editable=true;
  await host.onMessage(session,{type:'apply',previewRevision:session.publishedPreview.revision,changes:[{elementId:fixed.id,x:1,y:2}]});
  assert.equal(edits.length,0,'forged public editability cannot authorize constant-coordinate writes');
  assert.equal(fixture.text(),fixture.source);
  await host.reloadSession(session,false,false);
  await host.onMessage(session,{type:'apply',previewRevision:session.publishedPreview.revision,changes:[{elementId:title().id,x:58,y:54}]});
  assert.equal(edits.length,1);assert.equal(fixture.text(),fixture.source.replace(':50:50>',':62:58>'));
  assert.equal(title().x.displayValue,58);assert.equal(title().y.displayValue,54,'production reparse preserves paint bias once');
  assert.equal(session.model.functionLabel,'@main','Apply reparse must keep the function after a CRLF INCLUDE header');
  assert.equal(title().sourceRange.original,'<TEXT:($标题):62:58>','Apply must keep the original caption macro in physical source mapping');
  assert.equal(fixture.saves(),0);assert.equal(hash(primaryPath),originals.primary);assert.equal(hash(definesPath),originals.definitions);
  assert.equal(host.programSourcesCurrent(session),true);
  fs.appendFileSync(definesPath,Buffer.from('; fixture dependency changed\r\n'));
  const changedHash=hash(definesPath);assert.notEqual(changedHash,originals.definitions);
  assert.equal(host.programSourcesCurrent(session),false,'exact dependency content invalidates the published source');
  session.dirty=true;host.onCompanionFileChanged(fixture.uri(definesPath));
  assert.equal(session.conflict,true,'Defines file changes trigger the actual Provider conflict path');
  const previous=session.model,values={...session.previewValues},editCount=edits.length;
  await host.onMessage(session,{type:'previewInput',name:'U101',value:'27'});
  assert.equal(session.conflict,true);assert.equal(session.model,previous);assert.deepEqual(session.previewValues,values);
  await host.onMessage(session,{type:'resetPreview'});assert.equal(session.conflict,true);assert.equal(session.model,previous);
  await host.onMessage(session,{type:'apply',previewRevision:session.publishedPreview.revision,changes:[{elementId:title().id,x:70,y:70}]});
  assert.equal(edits.length,editCount);assert.equal(hash(primaryPath),originals.primary);assert.equal(hash(definesPath),changedHash);
  assert.ok(events.some(message=>message.type==='conflict'));
  console.log('preview-script-constants-provider.test.js: PASS real GBK Defines reader, literal display, source-only Apply/reparse, immutable coordinate boundary, dependency conflicts');
 }finally{fixture.cleanup();}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});module.exports={run};
