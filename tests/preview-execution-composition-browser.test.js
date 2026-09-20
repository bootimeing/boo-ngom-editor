const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse}=require('./preview-inputs-integration.test');
const runtime=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const out=path.resolve(process.env.BOO_EXECUTION_BROWSER_OUT||'artifacts/ctrl-f12-r25-execution/browser');fs.mkdirSync(out,{recursive:true});
const source='[@main]\n#ACT\nMOV N0 10\n#SAY\nA<$STR(N0)>\\\n#ACT\nGOTO @child\nMOV N0 20\nGOTO @child\n#SAY\nC<$STR(N0)>\\\n[@child]\n#SAY\nB<$STR(N0)>\\\n<点击<$STR(N0)>/@next(<$STR(N0)>)>\\\n[@next]\n#SAY\nNext<$SCRIPTPARAM1>';
const model=parse(source),uri=file=>pathToFileURL(path.join(runtime,file)).href;
let html=fs.readFileSync(path.join(runtime,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
const script=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html=html.replace(script,()=>`<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m)});</script>${script}`);
html=html.replace('</body>',()=>`<script>
const fixture=${JSON.stringify(model).replaceAll('<','\\u003c')},wait=()=>new Promise(r=>setTimeout(r,65)),check=(v,m)=>{if(!v)throw Error(m);};
window.addEventListener('load',async()=>{try{
await wait();const originalUrl=location.href,deliver=()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:fixture,previewRevision:1,preserveDrafts:false}}));deliver();await wait();
const select=()=>{const b=[...document.querySelectorAll('.scene-button')].find(b=>b.textContent.includes('执行顺序'));check(b,'execution view is discoverable');b.click();};select();await wait();
check(document.getElementById('sceneTitle').textContent.includes('本地执行顺序')&&document.getElementById('sceneTitle').textContent.includes('只读'),'visible nonexecution boundary');
const nodes=()=>[...document.querySelectorAll('#dialogCanvas [data-element-id]')],texts=['A10','B10','点击10','B20','点击20','C20'];
check(nodes().length===6,'all cross-label outputs rendered');let last=-Infinity;
for(const [i,node]of nodes().entries()){const box=node.getBoundingClientRect();check(node.textContent.includes(texts[i]),'event text '+i);check(box.width>0&&box.height>0&&box.top>last,'ordered visible geometry '+i);last=box.top;const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);check(hit===node||node.contains(hit),'event hit surface '+i);}
const before=nodes().map(n=>n.getBoundingClientRect().top);const link=nodes()[2],label=link.querySelector('.element-text');check(label&&getComputedStyle(label).color==='rgb(255, 255, 0)'&&getComputedStyle(label).textDecorationLine.includes('underline'),'readonly link retains yellow underline appearance');link.click();link.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));await wait();
check(document.getElementById('sceneTitle').textContent.includes('只读')&&!messages.some(m=>['previewNavigate','apply','save'].includes(m.type))&&location.href===originalUrl,'composition has no source/navigation action');
deliver();await wait();select();await wait();check(JSON.stringify(before)===JSON.stringify(nodes().map(n=>n.getBoundingClientRect().top)),'repeat delivery stable');
const sourceButton=[...document.querySelectorAll('.scene-button')].find(b=>b.querySelector('strong')?.textContent==='@child');sourceButton.click();await wait();check(nodes().some(n=>n.textContent.includes('B10'))&&nodes().some(n=>n.textContent.includes('B20')),'source layout retains repeated call instances');
select();await wait();document.body.dataset.executionComposition='PASS';
}catch(e){document.body.dataset.executionComposition='FAIL';document.body.dataset.error=String(e.stack||e);}});
</script></body>`);
const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);const attempts=[];
const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)).map(p=>path.resolve(p)))];assert.ok(candidates.length,'installed Chromium required');
for(const [index,executable]of candidates.entries()){
 const version=spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-Item -LiteralPath '${executable.replaceAll("'","''")}').VersionInfo.ProductVersion`],{encoding:'utf8',windowsHide:true,timeout:10000}).stdout?.trim();
 const result=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=5000','--dump-dom',`--user-data-dir=${path.join(out,'profile-'+index)}`,`--screenshot=${path.join(out,'preview-'+index+'.png')}`,pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
 const dom=result.stdout||'';attempts.push({executable,version,status:result.status,error:String(result.error||''),hasBody:dom.includes('<body'),passed:result.status===0&&dom.includes('data-execution-composition="PASS"'),diagnostic:dom.match(/data-error="[^"]*"/)?.[0]});fs.writeFileSync(path.join(out,'dom-'+index+'.html'),dom);
}
fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));
// The strict suite requires one functioning installed Chromium. Preserve failed
// candidates without calling them PASS, and never mask a real rendered failure.
assert.ok(attempts.some(a=>a.passed)&&attempts.filter(a=>a.hasBody).every(a=>a.passed),JSON.stringify(attempts));
console.log('preview-execution-composition-browser.test.js: PASS required Chromium; candidates='+JSON.stringify(attempts));
