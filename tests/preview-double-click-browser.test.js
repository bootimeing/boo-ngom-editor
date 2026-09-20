const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse}=require('./preview-inputs-integration.test'),{source,edge}=require('./preview-double-click.test');
const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..')),out=path.resolve(process.env.BOO_DOUBLE_CLICK_OUT||'artifacts/preview-events-r9/browser');fs.mkdirSync(out,{recursive:true});
const initial=parse(source,{},'996PC',{previewPath:[]}),double=parse(source,{},'996PC',{previewPath:[edge]}),single=parse(source,{},'996PC',{previewPath:[{...edge,targetLabel:'@single',trigger:'click',column:source.split('\n')[2].indexOf('|link=')} ]});
const uri=f=>pathToFileURL(path.join(root,f)).href,encode=x=>JSON.stringify(x).replace(/</g,'\\u003c');
let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
const script=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html=html.replace(script,()=>`<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${script}`);
html=html.replace('</body>',()=>`<script>
const initial=${encode(initial)},double=${encode(double)},single=${encode(single)},wait=ms=>new Promise(r=>setTimeout(r,ms||80)),check=(v,m)=>{if(!v)throw Error(m);};let revision=0;
const canvas=()=>document.getElementById('dialogCanvas'),deliver=model=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:++revision,preserveDrafts:true,navigatePageId:model.pages.find(p=>p.sourceLabel===model.previewNavigation.activeLabel).id}}));
const hit=()=>{const node=canvas().querySelector('[data-element-id]');node.scrollIntoView();const r=node.getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);check(r.width>0&&r.height>0&&(node===target||node.contains(target)),'hittable equip');return target;};
window.addEventListener('load',async()=>{try{await wait();deliver(initial);await wait();const initialURL=location.href;
 window.bridge=m=>{if(m.type==='previewNavigate')queueMicrotask(()=>deliver(m.trigger==='double-click'?double:single));};
 let target=hit();target.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));target.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));target.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));await wait(500);
 check(canvas().textContent.includes('双击页面'),'double target');check(messages.filter(m=>m.type==='previewNavigate').length===1&&messages.find(m=>m.type==='previewNavigate').trigger==='double-click','no premature single call');
 deliver(initial);await wait();hit().click();await wait(500);check(canvas().textContent.includes('单击页面'),'single target');
 deliver(initial);await wait();hit().click();deliver(initial);await wait(500);check(canvas().querySelector('[data-element-id]').dataset.elementId===initial.pages[0].elements[0].id,'detached timer cancelled');
 check(location.href===initialURL,'no browser navigation');check(!messages.some(m=>['apply','save'].includes(m.type)),'no source writes');document.body.dataset.doubleClick='PASS';
}catch(e){document.body.dataset.doubleClick='FAIL';document.body.dataset.error=String(e.stack||e);}});
</script></body>`);
const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);const attempts=[];
const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)))];assert.ok(candidates.length,'Chromium required');
for(const [index,executable]of candidates.entries()){
 const result=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=6000','--dump-dom',`--user-data-dir=${path.join(out,'profile-'+index)}`,`--screenshot=${path.join(out,'preview.png')}`,pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
 const dom=result.stdout||'';attempts.push({executable,status:result.status,error:String(result.error||''),diagnostic:dom.match(/data-error="[^"]*"/)?.[0]});fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));fs.writeFileSync(path.join(out,'dom-'+index+'.html'),dom);
 if(result.status===0&&dom.includes('data-double-click="PASS"')){console.log('preview-double-click-browser.test.js: PASS '+executable);process.exit(0);}
}throw Error(JSON.stringify(attempts));
