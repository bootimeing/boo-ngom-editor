const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse}=require('./preview-inputs-integration.test');
const {source,call,rootCall,nestedCall}=require('./preview-call-path.test');
const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const out=path.resolve(process.env.BOO_CALL_PATH_OUT||'artifacts/call-path-r7/browser');fs.mkdirSync(out,{recursive:true});
const a=rootCall,b=nestedCall,c=call(source,'@third','返回'),d=call(source,'@third','重复'),e=call(source,'@main','乙');
const paths=[[],[a],[a,b],[a,b,c],[a,b,d],[e],[e,b]];
const key=calls=>calls.map(c=>c.lineNumber+':'+c.column).join('|');
const records=Object.fromEntries(paths.map(calls=>[key(calls),parse(source,{},'GOM',{previewPath:calls})]));
const positions={};for(const model of Object.values(records))for(const page of model.pages)for(const element of page.elements){
 if(!element.localParameterTarget)continue;
 positions[element.id]={sourceLabel:page.sourceLabel,targetLabel:element.localParameterTarget,lineNumber:element.lineNumber-1,
 column:element.sourceRange.start-source.lastIndexOf('\n',element.sourceRange.start-1)-1+element.raw.indexOf('/@')};
}
const encode=x=>JSON.stringify(x).replace(/</g,'\\u003c'),uri=f=>pathToFileURL(path.join(root,f)).href;
let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
const renderer=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html=html.replace(renderer,()=>`<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
html=html.replace('</body>',()=>`<script>
const records=${encode(records)},positions=${encode(positions)};let current=records[''],revision=0;
const wait=()=>new Promise(r=>setTimeout(r,70)),check=(v,m)=>{if(!v)throw Error(m);};
const canvas=()=>document.getElementById('dialogCanvas'),back=()=>document.getElementById('previewBackButton');
const key=calls=>calls.map(c=>c.lineNumber+':'+c.column).join('|');
const deliver=(model,preserveDrafts=true)=>{
 current=model;const page=model.pages.find(p=>p.sourceLabel.toLowerCase()===model.previewNavigation.activeLabel.toLowerCase());
 window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:++revision,preserveDrafts,navigatePageId:page.id}}));
};
const click=async caption=>{
 const page=current.pages.find(p=>p.sourceLabel.toLowerCase()===current.previewNavigation.activeLabel.toLowerCase());
 const element=page.elements.find(e=>e.text===caption);check(element,'missing caption '+caption);
 const wrapper=[...canvas().querySelectorAll('[data-element-id]')].find(n=>n.dataset.elementId===element.id);
 check(wrapper,'missing visible wrapper');wrapper.scrollIntoView({block:'center'});const r=wrapper.getBoundingClientRect();
 const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);check(r.width>0&&r.height>0&&(hit===wrapper||wrapper.contains(hit)),'unhittable '+caption);
 hit.click();await wait();
};
window.addEventListener('load',async()=>{try{
 await wait();deliver(records[''],false);await wait();const initialURL=location.href,initialHistory=history.length;
 check(back()&&back().disabled,'initial back should be disabled');
 window.bridge=m=>{
  let calls=current.previewNavigation.calls;
  if(m.type==='previewNavigate'){
   check(m.previewRevision===revision&&m.trigger==='click','bad click revision/trigger');
   check(!('parameters'in m)&&!('targetLabel'in m),'untrusted browser parameters');
   const selected=positions[m.elementId];check(selected,'missing call identity');
   const labels=[current.functionLabel,...calls.map(c=>c.targetLabel)].map(x=>x.toLowerCase());
   const index=labels.lastIndexOf(selected.sourceLabel.toLowerCase());check(index>=0,'unvisited source');
   calls=[...calls.slice(0,index),selected];
  }else if(m.type==='previewBack'){check(m.previewRevision===revision,'bad back revision');calls=calls.slice(0,-1);}
  else if(m.type==='resetPreview')calls=[];else return;
  const next=records[key(calls)];check(next,'missing fixture path '+key(calls));queueMicrotask(()=>deliver(next));
 };
 await click('甲');check(canvas().textContent.includes('二层=甲/7'),'first call');check(!back().disabled,'back should be enabled');
 await click('进入');check(canvas().textContent.includes('三层=7/甲'),'nested parameters');
 check(!document.getElementById('emptyInspector').classList.contains('hidden'),'navigation must clear previous-page selection');
 const text=canvas().querySelector('[data-element-id]'),before=parseFloat(text.style.left);
 text.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:400,clientY:300}));
 window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:400,clientY:300}));
 document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await wait();
 const moved=parseFloat(canvas().querySelector('[data-element-id]').style.left);check(moved===before+1,'coordinate nudge');
 back().click();await wait();check(canvas().textContent.includes('二层=甲/7'),'back restores parent');
 await click('进入');check(parseFloat(canvas().querySelector('[data-element-id]').style.left)===moved,'draft after entering again');
 await click('返回');check(canvas().textContent.includes('二层=预览文字/预览文字'),'source return must use empty frame');
 back().click();await wait();check(canvas().textContent.includes('三层=7/甲'),'back differs from source return');
 await click('重复');check(canvas().textContent.includes('三层=甲/7'),'self invocation uses caller snapshot');
 back().click();await wait();check(canvas().textContent.includes('三层=7/甲'),'back from repeated label');
 back().click();await wait();back().click();await wait();check(back().disabled,'back at root');
 await click('乙');await click('进入');check(canvas().textContent.includes('三层=8/乙'),'different entry must not reuse first frame');
 check(parseFloat(canvas().querySelector('[data-element-id]').style.left)===moved,'draft survives branch change');
 const visible=canvas().textContent;
 window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:records[''],previewRevision:1,preserveDrafts:true}}));await wait();
 check(canvas().textContent===visible&&!back().disabled,'stale response changed current view');
 document.getElementById('resetPreview').click();await wait();check(back().disabled,'reset clears history');
 check(location.href===initialURL&&history.length===initialHistory,'URL/history side effect');
 check(!messages.some(m=>['apply','save','locate'].includes(m.type)),'source write or host navigation');
 await click('乙');await click('进入');
 document.body.dataset.callPath='PASS';const report=document.createElement('pre');report.id='call-path-result';report.hidden=true;
 report.textContent=JSON.stringify({nested:true,sourceReturnClears:true,backRestores:true,selfCall:true,alternateEntry:true,coordinateDraft:true,reset:true,staleResponse:true,noSourceWrites:true});document.body.append(report);
}catch(error){document.body.dataset.callPath='ERROR '+error.stack;}});
</script></body>`);
const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);
const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)))];
assert.ok(candidates.length,'Chromium required');const attempts=[];
for(const [index,executable]of candidates.entries()){
 const result=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=8000','--dump-dom',`--user-data-dir=${path.join(out,'profile-'+index)}`,`--screenshot=${path.join(out,'preview.png')}`,pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
 const dom=result.stdout||'';attempts.push({executable,status:result.status,error:String(result.error||''),diagnostic:dom.match(/data-call-path="[^"]*"/)?.[0]});fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));
 if(result.status===0&&dom.includes('data-call-path="PASS"')){fs.writeFileSync(path.join(out,'dom.html'),dom);console.log('preview-call-path-browser.test.js: PASS '+executable+'; DOM='+((dom.match(/data-element-id=/g)||[]).length));process.exit(0);}
}throw Error(JSON.stringify(attempts));
