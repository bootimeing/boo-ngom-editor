const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse}=require('./preview-inputs-integration.test'),{markups,makeSource,edge}=require('./preview-gee-submit.test');
const {hydrate}=require('./helpers/preview-image-hydration');
async function run(){
 const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
 const out=path.resolve(process.env.BOO_GEE_SUBMIT_OUT||'artifacts/gee-submit-r14/browser');fs.mkdirSync(out,{recursive:true});
 const fixtures=[];
 for(const original of markups)for(const all of [false,true]){
  const markup=all?original.replace(':1,2/@',':*|249#提交所有输入/@'):original,source=makeSource(markup);
  const initial=parse(source,{},'GEE',{previewPath:[]});await hydrate(initial,true);
  const result=parse(source,{},'GEE',{previewPath:[{...edge(source),submittedInputs:{'1':'张三','2':'28'}}]});
  fixtures.push({initial,result,markup,all});
 }
 const encode=x=>JSON.stringify(x).replace(/</g,'\\u003c'),uri=f=>pathToFileURL(path.join(root,f)).href;
 let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
 const renderer=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
 html=html.replace(renderer,()=>`<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
 html=html.replace('</body>',()=>`<script>
 const fixtures=${encode(fixtures)},wait=()=>new Promise(r=>setTimeout(r,80)),check=(v,m)=>{if(!v)throw Error(m);};let revision=0,completed=0;
 const canvas=()=>document.getElementById('dialogCanvas');
 const deliver=(model,label)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:++revision,preserveDrafts:true,navigatePageId:model.pages.find(p=>p.sourceLabel===label).id}}));
 window.addEventListener('load',async()=>{try{await wait();const url=location.href,historyLength=history.length;
 for(const f of fixtures){window.bridge=undefined;deliver(f.initial,'@main');await wait();
  const inputs=()=>[...canvas().querySelectorAll('input,textarea')];check(inputs().length===2,'two inputs');
  const set=(i,v)=>{const n=inputs()[i];check(!n.readOnly,'input editable');n.focus();n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));};
  const submit=()=>{const e=f.initial.pages[0].elements.find(e=>e.localParameterTarget);check(e,'action available '+f.markup);const n=[...canvas().querySelectorAll('[data-element-id]')].find(n=>n.dataset.elementId===e.id);n.scrollIntoView();const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);check(r.width>0&&r.height>0&&(hit===n||n.contains(hit)),'button hittable');
   if(!f.markup.startsWith('<TEXT'))check([...n.querySelectorAll('img')].some(img=>img.complete&&img.naturalWidth>0&&img.getBoundingClientRect().width>0),'loaded image pixels, not placeholder');hit.click();};
  const before=messages.filter(m=>m.type==='previewNavigate').length;set(0,'张三');set(1,'101');submit();await wait();
  check(messages.filter(m=>m.type==='previewNavigate').length===before,'invalid number blocks call');check(inputs()[1].getAttribute('aria-invalid')==='true','visible invalid state');
  window.bridge=m=>{if(m.type==='previewNavigate'){check(m.submittedInputs['1']==='张三'&&m.submittedInputs['2']==='28','actual submitted values');check(Object.keys(m.submittedInputs).length===2&&!('parameters'in m)&&!('targetLabel'in m),'bounded transport');queueMicrotask(()=>deliver(f.result,'@done'));}};
  set(1,'28');submit();await wait();check(canvas().textContent.includes('姓名=张三 年龄=28 参数=固定参数'),'visible submitted result '+f.markup);completed++;
 }
 check(location.href===url&&history.length===historyLength,'no browser navigation');check(!messages.some(m=>['apply','save'].includes(m.type)),'no source writes');
 document.body.dataset.geeSubmit='PASS';document.body.dataset.completed=String(completed);
 }catch(e){document.body.dataset.geeSubmit='FAIL';document.body.dataset.error=String(e.stack||e);}});
 </script></body>`);
 const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);const attempts=[];
 const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)))];assert.ok(candidates.length,'Chromium required');
 for(const [i,executable]of candidates.entries()){
  const r=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=10000','--dump-dom','--user-data-dir='+path.join(out,'profile-'+i),'--screenshot='+path.join(out,'preview.png'),pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
  const dom=r.stdout||'',version=spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-Item -LiteralPath '${executable.replace(/'/g,"''")}').VersionInfo.ProductVersion`],{encoding:'utf8',windowsHide:true}).stdout.trim(),elementCount=(dom.match(/class="canvas-element\b/g)||[]).length;
  attempts.push({executable,version,elementCount,status:r.status,error:String(r.error||''),diagnostic:dom.match(/data-error="[^"]*"/)?.[0]});fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));fs.writeFileSync(path.join(out,'dom-'+i+'.html'),dom);
  if(r.status===0&&dom.includes('data-gee-submit="PASS"')){assert.ok(dom.includes('data-completed="10"'));console.log('preview-gee-submit-browser.test.js: PASS '+executable+' version='+version+' scenarios=10 elements='+elementCount);return;}
 }throw Error(JSON.stringify(attempts));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
