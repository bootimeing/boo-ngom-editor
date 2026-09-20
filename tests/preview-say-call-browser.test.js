const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse}=require('./preview-inputs-integration.test'),{source,edge}=require('./preview-say-call.test');
const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const out=path.resolve(process.env.BOO_SAY_CALL_OUT||'artifacts/say-call-r11/browser');fs.mkdirSync(out,{recursive:true});
const scenario=source.replace('WHILE N0 < 3','WHILE N0 < U101');
const initial=parse(scenario,{U101:'3'},'GOM',{previewPath:[]}),results=[0,1,2].map(i=>parse(scenario,{U101:'3'},'GOM',{previewPath:[edge(i)]}));
const vanished=parse(scenario,{U101:'1'},'GOM',{previewPath:[edge(2)]});
const uri=f=>pathToFileURL(path.join(root,f)).href,encode=x=>JSON.stringify(x).replace(/</g,'\\u003c');
let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
const script=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html=html.replace(script,()=>`<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${script}`);
html=html.replace('</body>',()=>`<script>
const initial=${encode(initial)},results=${encode(results)},vanished=${encode(vanished)},wait=()=>new Promise(r=>setTimeout(r,80)),check=(v,m)=>{if(!v)throw Error(m);};let revision=0;
const deliver=m=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:m,previewRevision:++revision,preserveDrafts:true,navigatePageId:m.pages.find(p=>p.sourceLabel===m.previewNavigation.activeLabel).id}}));
window.addEventListener('load',async()=>{try{await wait();deliver(initial);await wait();const url=location.href;
window.bridge=m=>{if(m.type==='previewNavigate'){check(!('sayOccurrence'in m),'browser sends identity, not chosen occurrence');const i=initial.pages[0].elements.findIndex(e=>e.id===m.elementId);check(i>=0,'known instance');queueMicrotask(()=>deliver(results[i]));}else if(m.type==='previewBack')queueMicrotask(()=>deliver(initial));else if(m.type==='previewInput'){check(m.name==='U101'&&m.value==='1','typed iteration input');queueMicrotask(()=>deliver(vanished));}};
for(const i of [0,2,1]){
 const n=[...document.querySelectorAll('#dialogCanvas [data-element-id]')].find(n=>n.dataset.elementId===initial.pages[0].elements[i].id);const r=n.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);check(r.width>0&&r.height>0&&(hit===n||n.contains(hit)),'hittable button '+i);hit.click();await wait();
 check(document.getElementById('dialogCanvas').textContent.includes('参数='+i),'correct clicked iteration '+i);
 document.getElementById('previewBackButton').click();await wait();check(document.querySelectorAll('#dialogCanvas [data-element-id]').length===3,'back restores all instances');
}
deliver(results[2]);await wait();
const field=[...document.querySelectorAll('[data-preview-name]')].find(n=>n.dataset.previewName==='U101');check(field,'iteration count control');field.focus();field.value='1';field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));await wait();
check(document.querySelectorAll('#dialogCanvas [data-element-id]').length===1,'input change returns to one remaining main instance');
check(!document.getElementById('dialogCanvas').textContent.includes('参数='),'stale target no longer visible');check(document.getElementById('previewBackButton').disabled,'invalid history removed');check(field.value==='1'&&document.activeElement===field,'input value and focus retained');
check(location.href===url&&!messages.some(m=>['apply','save'].includes(m.type)),'no URL or source writes');document.body.dataset.sayCall='PASS';
}catch(e){document.body.dataset.sayCall='FAIL';document.body.dataset.error=String(e.stack||e);}});
</script></body>`);
const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);const attempts=[];
const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)))];assert.ok(candidates.length,'Chromium required');
for(const [index,executable]of candidates.entries()){
const result=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=6000','--dump-dom',`--user-data-dir=${path.join(out,'profile-'+index)}`,`--screenshot=${path.join(out,'preview.png')}`,pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
const version=spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-Item -LiteralPath '${executable.replace(/'/g,"''")}').VersionInfo.ProductVersion`],{encoding:'utf8',windowsHide:true}).stdout.trim();
const dom=result.stdout||'',elementCount=(dom.match(/class="canvas-element\b/g)||[]).length;attempts.push({executable,version,elementCount,status:result.status,error:String(result.error||''),diagnostic:dom.match(/data-error="[^"]*"/)?.[0]});fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));fs.writeFileSync(path.join(out,'dom-'+index+'.html'),dom);
if(result.status===0&&dom.includes('data-say-call="PASS"')){console.log('preview-say-call-browser.test.js: PASS '+executable+' version='+version+' elements='+elementCount);process.exit(0);}
}throw Error(JSON.stringify(attempts));
