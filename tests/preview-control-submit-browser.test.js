const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse}=require('./preview-inputs-integration.test'),{checkbox,slider,sourceFor,edgeFor}=require('./preview-control-submit.test');
const {hydrate}=require('./helpers/preview-image-hydration');
const {checked,ranged}=require('./preview-control-values.test');
async function run(){
 const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..')),out=path.resolve(process.env.BOO_CONTROL_SUBMIT_OUT||'artifacts/control-submit-r15/browser');fs.mkdirSync(out,{recursive:true});
 const fixtures=[];
 for(const [markup,type,variable,value,mode,values={}] of [[checkbox,2,'N66','1','toggle'],[checkbox.replace('default=0','default=1'),2,'N66','0','toggle'],[slider,3,'N$amount','75','drag'],[slider,3,'N$amount','26','key'],[slider,3,'N$amount','25','enter'],[checked,2,'N66','0','toggle',{N66:'1'}],[ranged,3,'N$amount','75','drag',{'N$max':'100','N$start':'25'}],[ranged,3,'N$amount','46','input-key',{'N$max':'100','N$start':'25'}],[slider.replace('maxvalue=100','maxvalue=2.6').replace('defvalue=25','defvalue=1'),3,'N$amount','2.6','end']]){
  const source=sourceFor(markup),initial=parse(source,values,'996PC',{previewPath:[]});await hydrate(initial,true);
  const actualValues=mode==='input-key'?{...values,'N$start':'45'}:values;
  const result=parse(source,actualValues,'996PC',{previewPath:[edgeFor(markup,type,variable,value)]});
  const updated=mode==='input-key'?parse(source,actualValues,'996PC',{previewPath:[]}):undefined;if(updated)await hydrate(updated,true);
  fixtures.push({initial,result,updated,value,type,mode});
 }
 const menu=require('./preview-menu-submit.test');
 for(const mode of ['menu-click','menu-key']){
  const initial=parse(menu.source,{},'996PC',{previewPath:[]});await hydrate(initial,true);
  const result=parse(menu.source,{},'996PC',{previewPath:[menu.edge('装备')]});fixtures.push({initial,result,value:'装备',type:4,mode});
 }
 const encode=x=>JSON.stringify(x).replace(/</g,'\\u003c'),uri=f=>pathToFileURL(path.join(root,f)).href;
 let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
 const renderer=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
 html=html.replace(renderer,()=>`<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
 html=html.replace('</body>',()=>`<script>
 const fixtures=${encode(fixtures)},wait=()=>new Promise(r=>setTimeout(r,80)),check=(v,m)=>{if(!v)throw Error(m);};let revision=0,completed=0;
 const canvas=()=>document.getElementById('dialogCanvas'),deliver=(model,label,preserve=false)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:++revision,preserveDrafts:preserve,navigatePageId:model.pages.find(p=>p.sourceLabel===label).id}}));
 window.addEventListener('load',async()=>{try{await wait();const url=location.href;
 for(const f of fixtures){deliver(f.initial,'@main');await wait();
 if(f.updated){window.bridge=m=>{if(m.type==='previewInput'){check(m.name==='N$start'&&m.value==='45','typed default update');queueMicrotask(()=>deliver(f.updated,'@main',true));}};const input=[...document.querySelectorAll('[data-preview-name]')].find(n=>n.dataset.previewName==='N$start');input.focus();input.value='45';input.dispatchEvent(new Event('change',{bubbles:true}));await wait();check(document.activeElement===input,'typed input focus preserved');check(canvas().querySelector('.slider-hitarea').getAttribute('aria-valuenow')==='45','changed default replaces stale local state');}
 const wrapper=canvas().querySelector('[data-element-id]'),control=wrapper.querySelector(f.type===4?'.menu-toggle-hitarea':f.type===2?'.toggle-hitarea':'.slider-hitarea'),r=wrapper.getBoundingClientRect();
 check(r.width>0&&r.height>0,'positive control');check([...wrapper.querySelectorAll('img')].some(n=>n.complete&&n.naturalWidth>0),'loaded control asset');
 const hit=document.elementFromPoint(f.type===4?r.right-16:r.x+r.width*(f.type===2?.25:.75),r.y+r.height*.75);check(hit===control||control.contains(hit),'control hit surface');
 const before=messages.filter(m=>m.type==='previewNavigate').length;
 window.bridge=m=>{if(m.type==='previewNavigate'){check(m.trigger==='change'&&m.controlValue===f.value,'typed event '+JSON.stringify(m));check(!('submittedControl'in m)&&!('variable'in m)&&!('targetLabel'in m),'identity-only event');queueMicrotask(()=>deliver(f.result,'@done'));}};
 if(f.type===4){hit.click();await wait();const option=[...canvas().querySelectorAll('.menu-option')].find(n=>n.textContent.includes('装备'));check(option,'menu option exists');const box=option.getBoundingClientRect(),h=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);check(h===option||option.contains(h),'option hit');if(f.mode==='menu-key'){option.focus();option.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}else h.click();}
 else if(f.mode==='toggle')hit.click();
 else if(f.mode==='drag'){
  hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.x+r.width*.25,clientY:r.y+r.height/2,button:0}));
  window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.x+r.width*.75,clientY:r.y+r.height/2}));
  check(messages.filter(m=>m.type==='previewNavigate').length===before,'no jump mid-drag');check(control.getAttribute('aria-valuenow')==='75','live dragging value');
  window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:r.x+r.width*.75,clientY:r.y+r.height/2}));hit.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+r.width*.75,detail:1}));
 }else if(['key','input-key','end'].includes(f.mode)){control.focus();control.dispatchEvent(new KeyboardEvent('keydown',{key:f.mode==='end'?'End':'ArrowRight',bubbles:true}));}else{control.focus();control.click();}
 await wait();check(messages.filter(m=>m.type==='previewNavigate').length===before+1,'one event per action');check(canvas().textContent.includes((f.type===4?'选择=':f.type===2?'状态=':'数量=')+f.value),'visible NPCPARAMS result');completed++;
 }
 check(location.href===url&&!messages.some(m=>['apply','save'].includes(m.type)),'no external/source writes');document.body.dataset.controlSubmit='PASS';document.body.dataset.completed=String(completed);
 }catch(e){document.body.dataset.controlSubmit='FAIL';document.body.dataset.error=String(e.stack||e);}});
 </script></body>`);
 const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);const attempts=[];
 const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)))];assert.ok(candidates.length,'Chromium required');
 for(const [i,executable]of candidates.entries()){
  const r=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=7000','--dump-dom','--user-data-dir='+path.join(out,'profile-'+i),'--screenshot='+path.join(out,'preview.png'),pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
  const dom=r.stdout||'',version=spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-Item -LiteralPath '${executable.replace(/'/g,"''")}').VersionInfo.ProductVersion`],{encoding:'utf8',windowsHide:true}).stdout.trim(),elementCount=(dom.match(/class="canvas-element\b/g)||[]).length;
  attempts.push({executable,version,elementCount,status:r.status,error:String(r.error||''),diagnostic:dom.match(/data-error="[^"]*"/)?.[0]});fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));fs.writeFileSync(path.join(out,'dom-'+i+'.html'),dom);
  if(r.status===0&&dom.includes('data-control-submit="PASS"')){assert.ok(dom.includes('data-completed="11"'));console.log('preview-control-submit-browser.test.js: PASS '+executable+' version='+version+' scenarios=11 elements='+elementCount);return;}
 }throw Error(JSON.stringify(attempts));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
