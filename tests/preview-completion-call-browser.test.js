const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse}=require('./preview-inputs-integration.test'),{markups,sourceFor,edgeFor}=require('./preview-completion-call.test');
const {hydrate}=require('./helpers/preview-image-hydration');
async function run(){
 const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..')),out=path.resolve(process.env.BOO_COMPLETION_CALL_OUT||'artifacts/completion-call-r16/browser');fs.mkdirSync(out,{recursive:true});
 const fixtures=[];
 for(const markup of markups){const source=sourceFor(markup),initial=parse(source,{},'996PC',{previewPath:[]});await hydrate(initial);const result=parse(source,{},'996PC',{previewPath:[edgeFor(markup)]});fixtures.push({initial,result});}
 const encode=x=>JSON.stringify(x).replace(/</g,'\\u003c'),uri=f=>pathToFileURL(path.join(root,f)).href;
 let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
 const renderer=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
 html=html.replace(renderer,()=>`<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
 html=html.replace('</body>',()=>`<script>
 const fixtures=${encode(fixtures)},wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(v,m)=>{if(!v)throw Error(m);};let revision=0,completed=0;
 const canvas=()=>document.getElementById('dialogCanvas'),deliver=(model,label,preserve=false)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:++revision,preserveDrafts:preserve,navigatePageId:model.pages.find(p=>p.sourceLabel===label).id}}));
 window.addEventListener('load',async()=>{try{await wait(80);const url=location.href;
 for(const f of fixtures){let fired=0;window.bridge=m=>{if(m.type==='previewNavigate'){check(m.trigger==='completion','real timer event');check(!('targetLabel'in m)&&!('parameters'in m),'source-bound event');fired++;queueMicrotask(()=>deliver(f.result,'@done',true));}};
  deliver(f.initial,'@main');await wait(80);const n=canvas().querySelector('[data-element-id]'),r=n.getBoundingClientRect();check(r.width>0&&r.height>0,'timer visible');check(fired===0,'no premature completion');
  if(f.initial.pages[0].elements[0].progressPreview)check([...n.querySelectorAll('img')].some(n=>n.complete&&n.naturalWidth>0),'loading bar assets loaded');
  await wait(1350);check(fired===1,'one completed event');check(canvas().textContent.includes('完成，保留调用环境=7'),'target execution snapshot');
  deliver(f.initial,'@main',true);await wait(350);check(fired===1,'back does not immediately repeat completed event');completed++;
 }
 check(location.href===url&&!messages.some(m=>['apply','save'].includes(m.type)),'no external actions');document.body.dataset.completionCall='PASS';document.body.dataset.completed=String(completed);
 }catch(e){document.body.dataset.completionCall='FAIL';document.body.dataset.error=String(e.stack||e);}});
 </script></body>`);
 const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);const attempts=[];
 const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)))];assert.ok(candidates.length,'Chromium required');
 for(const [i,executable]of candidates.entries()){
  const r=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=10000','--dump-dom','--user-data-dir='+path.join(out,'profile-'+i),'--screenshot='+path.join(out,'preview.png'),pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
  const dom=r.stdout||'',version=spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-Item -LiteralPath '${executable.replace(/'/g,"''")}').VersionInfo.ProductVersion`],{encoding:'utf8',windowsHide:true}).stdout.trim(),elementCount=(dom.match(/class="canvas-element\b/g)||[]).length;
  attempts.push({executable,version,elementCount,status:r.status,error:String(r.error||''),diagnostic:dom.match(/data-error="[^"]*"/)?.[0]});fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));fs.writeFileSync(path.join(out,'dom-'+i+'.html'),dom);
  if(r.status===0&&dom.includes('data-completion-call="PASS"')){assert.ok(dom.includes('data-completed="3"'));console.log('preview-completion-call-browser.test.js: PASS '+executable+' version='+version+' scenarios=3 elements='+elementCount);return;}
 }throw Error(JSON.stringify(attempts));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
