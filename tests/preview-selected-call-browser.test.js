const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawnSync}=require('node:child_process');
const {parse}=require('./preview-inputs-integration.test');
const {source,selected}=require('./preview-selected-call.test');
const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const out=path.resolve(process.env.BOO_SELECTED_CALL_OUT||path.join(__dirname,'../artifacts/selected-call-r6/browser'));
fs.mkdirSync(out,{recursive:true});
const models=[parse(source),...Array.from({length:4},(_,i)=>parse(source,{},'GOM',{previewCall:selected(i)}))];
const encode=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const uri=file=>pathToFileURL(path.join(root,file)).href;
let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8')
  .replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
const renderer=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html=html.replace(renderer,()=>`<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
html=html.replace('</body>',()=>`<script>
const models=${encode(models)};let revision=0;
const wait=()=>new Promise(r=>setTimeout(r,80));
const canvas=()=>document.getElementById('dialogCanvas');
const deliver=(model,navigatePageId,preserveDrafts=true)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,navigatePageId,preserveDrafts,previewRevision:++revision}}));
const check=(condition,message)=>{if(!condition)throw Error(message);};
window.addEventListener('load',async()=>{try{
 await wait();deliver(models[0],null,false);await wait();
 const originalURL=location.href,originalHistory=history.length;
 let draftLeft;
 window.bridge=message=>{
  if(message.type==='previewNavigate'){
   const index=models[0].pages[0].elements.findIndex(e=>e.id===message.elementId);
   check(index>=0&&message.trigger==='click'&&message.previewRevision===revision,'invalid navigation message');
   check(!('parameters' in message)&&!('targetLabel' in message),'browser must send identity, not trusted parameters');
   deliver(models[index+1],models[index+1].pages[1].id);
  }else if(message.type==='resetPreview')deliver(models[0]);
 };
 for(const [index,expected] of [[0,'甲 / 7'],[1,'乙 / 8'],[2,'预览文字 / 预览文字'],[3,'预览文字 / 预览文字']]){
  if(index){deliver(models[0],models[0].pages[0].id);await wait();}
  const id=models[0].pages[0].elements[index].id;
  const wrapper=[...canvas().querySelectorAll('[data-element-id]')].find(e=>e.dataset.elementId===id);
  const action=wrapper?.querySelector('.runtime-action-hitarea');check(action&&!action.disabled,'missing clickable action');
  action.scrollIntoView({block:'center'});const rect=action.getBoundingClientRect();
  const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
  check(rect.width>0&&rect.height>0&&(hit===wrapper||wrapper.contains(hit)),'action is not visible/hittable');
  hit.click();await wait();check(canvas().textContent.includes(expected),'wrong clicked parameters: '+canvas().textContent);
  const target=canvas().querySelector('[data-element-id]');
  if(index===0){
   const previous=parseFloat(target.style.left);
   target.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:400,clientY:300}));
   window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:400,clientY:300}));
   document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
   await wait();draftLeft=parseFloat(canvas().querySelector('[data-element-id]').style.left);
   check(draftLeft===previous+1,'coordinate editing unavailable');
  }else check(parseFloat(target.style.left)===draftLeft,'navigation discarded coordinate draft');
 }
 document.getElementById('resetPreview').click();await wait();
 check(canvas().textContent.includes('预览文字 / 预览文字'),'reset retained old frame');
 check(parseFloat(canvas().querySelector('[data-element-id]').style.left)===draftLeft,'reset discarded coordinate draft');
 const before=canvas().textContent;
 window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:models[1],navigatePageId:models[1].pages[1].id,preserveDrafts:true,previewRevision:1}}));
 await wait();check(canvas().textContent===before,'stale response overwrote latest page');
 check(location.href===originalURL&&history.length===originalHistory,'external navigation side effect');
 check(!messages.some(m=>['apply','save','locate'].includes(m.type)),'source write or host navigation');
 check(messages.filter(m=>m.type==='previewNavigate').length===4,'missing click messages');
 // Leave a populated, readable state for the screenshot; reset is checked above.
 deliver(models[2],models[2].pages[1].id);await wait();
 check(canvas().textContent.includes('乙 / 8'),'populated screenshot state');
 document.body.dataset.selectedCall='PASS';
 const report=document.createElement('pre');report.id='selected-call-result';report.textContent=JSON.stringify({clicks:4,values:['甲 / 7','乙 / 8','预览文字 / 预览文字'],reset:true,coordinateDraftPreserved:true,staleResponseRejected:true,noSourceWrites:true});document.body.append(report);
}catch(e){document.body.dataset.selectedCall='ERROR '+e.stack;}});
</script></body>`);
const fixture=path.join(out,'fixture.html');fs.writeFileSync(fixture,html);
const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)))];
assert.ok(candidates.length,'Chromium is required');
const attempts=[];
for(const [index,executable] of candidates.entries()){
 const result=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files',
  '--window-size=1440,1000','--virtual-time-budget=5000','--dump-dom',`--user-data-dir=${path.join(out,'profile-'+index)}`,
  `--screenshot=${path.join(out,'preview.png')}`,pathToFileURL(fixture).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
 const dom=result.stdout||'';attempts.push({executable,status:result.status,error:String(result.error||''),diagnostic:dom.match(/data-selected-call="[^"]*"/)?.[0]});
 fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));
 if(result.status===0&&dom.includes('data-selected-call="PASS"')){
  fs.writeFileSync(path.join(out,'dom.html'),dom);
  console.log('preview-selected-call-browser.test.js: PASS '+executable);process.exit(0);
 }
}
throw Error(JSON.stringify(attempts));
