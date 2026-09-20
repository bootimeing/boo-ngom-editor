const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse}=require('./preview-inputs-integration.test'),{source,repeated,dynamicRows}=require('./preview-say-container.test');
const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const out=path.resolve(process.env.BOO_SAY_CONTAINER_OUT||'artifacts/say-container-r13/browser');fs.mkdirSync(out,{recursive:true});
const localSource=require('./preview-local-container-id.test').source;
const models=[parse(source,{U101:'3'}),parse(source,{U101:'1'}),parse(repeated,{U101:'3'}),parse(dynamicRows,{U101:'3'}),parse(localSource,{U102:'7'}),parse(localSource,{U102:'12'})];
const uri=f=>pathToFileURL(path.join(root,f)).href,encode=v=>JSON.stringify(v).replace(/</g,'\\u003c');
let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
const script=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html=html.replace(script,()=>`<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m)});</script>${script}`);
html=html.replace('</body>',()=>`<script>
const models=${encode(models)},wait=()=>new Promise(r=>setTimeout(r,70)),check=(v,m)=>{if(!v)throw Error(m);};let revision=0;
const nodes=()=>[...document.querySelectorAll('#dialogCanvas [data-element-id]')];
const byId=id=>nodes().find(n=>n.dataset.elementId===id);
const deliver=(m,preserve=false)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:m,previewRevision:++revision,preserveDrafts:preserve}}));
window.addEventListener('load',async()=>{try{await wait();deliver(models[0]);await wait();const url=location.href;
const entries=models[0].pages[0].elements.filter(e=>e.text.startsWith('第'));check(entries.length===3,'all loop children must reach canvas');let lastY=-Infinity;
for(const e of entries){const n=byId(e.id),r=n.getBoundingClientRect();check(r.width>0&&r.height>0&&r.y>lastY,'visible separate rows');lastY=r.y;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);check(n===hit||n.contains(hit),'child hittable '+e.text);}
const before=entries.map(e=>byId(e.id).getBoundingClientRect());const parent=models[0].pages[0].elements.find(e=>e.containerElementId==='ROOT');const n=byId(parent.id),r=n.getBoundingClientRect();const x=r.right-8,y=r.bottom-8,hit=document.elementFromPoint(x,y);check(n===hit||n.contains(hit),'parent empty area hittable');hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:x,clientY:y}));window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:x+20,clientY:y+30}));window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
for(const [i,e]of entries.entries()){const p=byId(e.id).getBoundingClientRect();check(Math.abs(p.x-before[i].x-20)<.1&&Math.abs(p.y-before[i].y-30)<.1,'moving root moves every child');}check(document.querySelectorAll('.change-row').length===1,'one parent source change');
document.getElementById('undoButton').click();for(const [i,e]of entries.entries())check(Math.abs(byId(e.id).getBoundingClientRect().y-before[i].y)<.1,'undo restores nested positions');
deliver(models[1]);await wait();check(nodes().filter(n=>n.textContent.includes('第0行')).length>=1,'fewer iterations redraw');deliver(models[2]);await wait();for(const text of ['外部0','外部1','外部2'])check(document.getElementById('dialogCanvas').textContent.includes(text),'ambiguous container does not erase '+text);
check(location.href===url&&!messages.some(m=>['apply','save','previewNavigate'].includes(m.type)),'no unrequested actions');deliver(models[3]);await wait();
let rowY=-Infinity;for(const e of models[3].pages[0].elements.filter(e=>e.text.startsWith('第'))){const n=byId(e.id),r=n.getBoundingClientRect();check(r.y>rowY&&r.width>0&&r.height>0,'distinct resolved-ID rows');rowY=r.y;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);check(hit===n||n.contains(hit),'resolved-ID row hittable');}
for(const m of models.slice(4)){deliver(m,true);await wait();const [parent,child]=m.pages[0].elements,pr=byId(parent.id).getBoundingClientRect(),cr=byId(child.id).getBoundingClientRect();check(cr.width>0&&cr.height>0&&Math.abs(cr.x-pr.x-16)<.1&&Math.abs(cr.y-pr.y-26)<.1,'explicit input parent relationship and text bias');const hit=document.elementFromPoint(cr.x+cr.width/2,cr.y+cr.height/2);check(hit===byId(child.id)||byId(child.id).contains(hit),'local ID child hittable after input update');}
document.body.dataset.sayContainer='PASS';
}catch(e){document.body.dataset.sayContainer='FAIL';document.body.dataset.error=String(e.stack||e);}});
</script></body>`);
const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);const attempts=[];
const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)))];assert.ok(candidates.length,'Chromium required');
for(const [i,executable]of candidates.entries()){
 const r=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=6500','--dump-dom','--user-data-dir='+path.join(out,'profile-'+i),'--screenshot='+path.join(out,'preview.png'),pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
 const dom=r.stdout||'',version=spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-Item -LiteralPath '${executable.replace(/'/g,"''")}').VersionInfo.ProductVersion`],{encoding:'utf8',windowsHide:true}).stdout.trim(),elementCount=(dom.match(/class="canvas-element\b/g)||[]).length;
 attempts.push({executable,version,elementCount,status:r.status,error:String(r.error||''),diagnostic:dom.match(/data-error="[^"]*"/)?.[0]});fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));fs.writeFileSync(path.join(out,'dom-'+i+'.html'),dom);
 if(r.status===0&&dom.includes('data-say-container="PASS"')){console.log('preview-say-container-browser.test.js: PASS '+executable+' version='+version+' elements='+elementCount);process.exit(0);}
}throw Error(JSON.stringify(attempts));
