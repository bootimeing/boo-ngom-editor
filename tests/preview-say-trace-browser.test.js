const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse}=require('./preview-inputs-integration.test'),{source}=require('./preview-say-trace.test');
const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const out=path.resolve(process.env.BOO_SAY_TRACE_OUT||'artifacts/say-trace-r10/browser');fs.mkdirSync(out,{recursive:true});
const model=parse(source),uri=f=>pathToFileURL(path.join(root,f)).href;
let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
const script=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html=html.replace(script,()=>`<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m)});</script>${script}`);
html=html.replace('</body>',()=>`<script>
const model=${JSON.stringify(model).replace(/</g,'\\u003c')},wait=()=>new Promise(r=>setTimeout(r,80)),check=(v,m)=>{if(!v)throw Error(m);};
window.addEventListener('load',async()=>{try{
await wait();const url=location.href;const deliver=()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:1,preserveDrafts:false}}));deliver();await wait();
const nodes=()=>[...document.querySelectorAll('#dialogCanvas [data-element-id]')];
check(nodes().length===7,'all seven output instances visible');
const labels=['A0','B0','A1','B1','A2','B2','结束'];let previous=-Infinity;
for(const [i,n]of nodes().entries()){check(n.textContent.includes(labels[i]),'correct event text '+i);const r=n.getBoundingClientRect();check(r.width>0&&r.height>0&&r.y>previous,'nonoverlapping ordered flow '+i);previous=r.y;const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);check(hit===n||n.contains(hit),'hittable event '+i);}
const before=nodes().map(n=>n.getBoundingClientRect().y);deliver();await wait();check(JSON.stringify(nodes().map(n=>n.getBoundingClientRect().y))===JSON.stringify(before),'repeated model does not accumulate offsets');
nodes()[2].click();await wait();check(!messages.some(m=>['previewNavigate','apply','save'].includes(m.type))&&location.href===url,'no call or source write');
document.body.dataset.sayTrace='PASS';
}catch(e){document.body.dataset.sayTrace='FAIL';document.body.dataset.error=String(e.stack||e);}});
</script></body>`);
const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);const attempts=[];
const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)))];assert.ok(candidates.length,'Chromium required');
for(const [index,executable]of candidates.entries()){
const result=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=5000','--dump-dom',`--user-data-dir=${path.join(out,'profile-'+index)}`,`--screenshot=${path.join(out,'preview.png')}`,pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
const dom=result.stdout||'';attempts.push({executable,status:result.status,error:String(result.error||''),diagnostic:dom.match(/data-error="[^"]*"/)?.[0]});fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));fs.writeFileSync(path.join(out,'dom-'+index+'.html'),dom);
if(result.status===0&&dom.includes('data-say-trace="PASS"')){console.log('preview-say-trace-browser.test.js: PASS '+executable);process.exit(0);}
}throw Error(JSON.stringify(attempts));
