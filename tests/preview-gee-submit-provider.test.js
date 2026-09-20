const assert = require('node:assert/strict');
const {parse} = require('./preview-inputs-integration.test');
const {manager} = require('./helpers/preview-image-hydration');
const {markups, makeSource} = require('./preview-gee-submit.test');

async function run() {
  const host = manager(), posted = [];
  let source;
  const session = {key:'gee-submit', document:{version:1,getText:()=>source}, dirty:true,
    conflict:false, modelRevision:1, previewConditions:{}, previewValues:{},
    panel:{webview:{postMessage:m=>posted.push(m)}}};
  host.sessions = new Map([[session.key, session]]);
  host.hydrateAssets = async()=>{};
  host.createModel = async(_d,_c,_l,_s,values,_call,previewPath)=>parse(source,values,'GEE',{previewPath});
  const reset = text=>{source=text; session.model=parse(source,{},'GEE',{previewPath:[]}); session.publishedPreview=undefined; session.previewPath=[];};
  const click = (values, extra={})=>host.onMessage(session, {type:'previewNavigate',
    elementId:session.model.pages[0].elements.find(e=>e.localParameterTarget)?.id,
    trigger:'click',previewRevision:session.publishedPreview?.revision||session.modelRevision,
    submittedInputs:values,...extra});
  for (const markup of markups) {
    reset(makeSource(markup));
    await click({'1':'张三','2':'28','40':'伪造'}, {submitAllInputs:true,submitInputIds:[40],targetLabel:'@hack',parameters:['伪造']});
    assert.deepEqual(session.previewPath[0].submittedInputs, {'1':'张三','2':'28'});
    assert.ok(session.model.pages.find(p=>p.sourceLabel==='@done').elements[0].text.includes('姓名=张三 年龄=28 参数=固定参数'));
    assert.equal(session.dirty,true);
    for (const bad of [{'1':'张三','2':'101'},{'1':'张三'},[],{'1':3,'2':'28'}]) {
      const revision=session.modelRevision; await click(bad); assert.equal(session.modelRevision,revision,'invalid submit rejected');
    }
    reset(makeSource(markup.replace(':1,2/@',':*/@')).replace('<INPUTNUM:2:', '<INPUTTEXT:40:20:150:120:20>\n<INPUTNUM:2:'));
    await click({'1':'全提交','2':'28','40':'上限','41':'越界'});
    assert.deepEqual(session.previewPath[0].submittedInputs,{'1':'全提交','2':'28','40':'上限'});
    reset(makeSource(markup.replace(':1,2/@',':1/@')));
    await click({'1':'部分','2':'999'},{submitAllInputs:true,submitInputIds:[1,2]});
    assert.deepEqual(session.previewPath[0].submittedInputs,{'1':'部分'},'frontend cannot expand list');
    reset(makeSource(markup.replace(':1,2/@',':/@')));
    await click({'1':'不提交','2':'28'},{submitAllInputs:true});
    assert.equal(session.previewPath[0].submittedInputs,undefined,'no GOM implicit-all in GEE');
  }
  for (const text of [
    makeSource(markups[4]).replace('<INPUTNUM:2:', '<INPUTTEXT:1:20:150:120:20>\n<INPUTNUM:2:'),
    makeSource(markups[4]).replace('<INPUTNUM:2:20:60:120:20:0:249:255:1:100:范围错误:年龄:160>','').replace('[@done]','[@done]\n#SAY\n<INPUTNUM:2:20:60:120:20>'),
  ]) {
    reset(text); const revision=session.modelRevision; await click({'1':'重复或异页','2':'28'});
    assert.equal(session.modelRevision,revision,'duplicate or other-page inputs cannot authorize submit');
  }
  reset(makeSource(markups[4]));
  for (const extra of [{previewRevision:0},{elementId:'forged'},{trigger:'double-click'}]) {
    const revision=session.modelRevision; await click({'1':'张三','2':'28'},extra); assert.equal(session.modelRevision,revision);
  }
  session.document.version=2; const revision=session.modelRevision;
  await click({'1':'张三','2':'28'}); assert.equal(session.modelRevision,revision,'stale source rejected');
  session.document.version=1;
  const hostile='<IMG:1>|/@hack'; await click({'1':hostile,'2':'28'});
  const target=session.model.pages.find(p=>p.sourceLabel==='@done');
  assert.equal(target.elements.length,1); assert.ok(target.elements[0].text.includes(hostile));
  assert.ok(posted.every(m=>m.type!=='model'||m.preserveDrafts===true));
  console.log('preview-gee-submit-provider.test.js: PASS');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
