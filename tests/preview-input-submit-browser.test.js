const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse}=require('./preview-inputs-integration.test'),{call}=require('./preview-call-path.test');
const keyed=process.env.BOO_SUBMIT_ENGINE==='996PC',engine=keyed?'996PC':'GOM';
const source=keyed?require('./preview-engine-click.test').source:process.env.BOO_SUBMIT_PLAYIMG==='1'
 ?require('./preview-input-submit.test').source.replace('<提交/@done(固定参数)>','<PLAYIMG:1:610:2:100:20:100:0:0:1,2/@done(固定参数)>')
 :require('./preview-input-submit.test').source;
const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const out=path.resolve(process.env.BOO_INPUT_SUBMIT_OUT||`artifacts/input-submit-r8/browser-${engine}`);fs.mkdirSync(out,{recursive:true});
const initial=parse(source,{},engine,{previewPath:[]});
const playLine=source.split('\n').findIndex(line=>line.startsWith('<PLAYIMG:'));
const selected=keyed?require('./preview-engine-click.test').edge:process.env.BOO_SUBMIT_PLAYIMG==='1'
 ?{sourceLabel:'@main',targetLabel:'@done',lineNumber:playLine,column:source.split('\n')[playLine].indexOf('/@')}
 :call(source,'@main','提交');
const result=parse(source,{},engine,{previewPath:[{...selected,submittedInputs:{'1':'张三','2':'28'}}]});
const namedFixture=require('./preview-engine-click.test');
const namedInitial=parse(namedFixture.named,{},'996PC',{previewPath:[]}),namedResult=parse(namedFixture.named,{},'996PC',{previewPath:[namedFixture.selected]});
const encode=x=>JSON.stringify(x).replace(/</g,'\\u003c'),uri=f=>pathToFileURL(path.join(root,f)).href;
let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
const renderer=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html=html.replace(renderer,()=>`<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
html=html.replace('</body>',()=>`<script>
let initial=${encode(initial)};const result=${encode(result)},keyed=${keyed},namedInitial=${encode(namedInitial)},namedResult=${encode(namedResult)};
const wait=()=>new Promise(r=>setTimeout(r,70)),check=(v,m)=>{if(!v)throw Error(m);};
const canvas=()=>document.getElementById('dialogCanvas');
const deliver=(model,revision,label)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:revision,preserveDrafts:true,navigatePageId:model.pages.find(p=>p.sourceLabel===label).id}}));
window.addEventListener('load',async()=>{try{
 await wait();deliver(initial,1,'@main');await wait();
 const initialURL=location.href,initialHistory=history.length;
 const inputs=()=>[...canvas().querySelectorAll('input,textarea')];check(inputs().length===(keyed?1:2),'visible input controls');
 check(inputs().every(input=>!input.readOnly&&input.tabIndex>=0),'unknown decorative color must not lock input');
 const set=(index,value)=>{const node=inputs()[index];node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));};
 const submit=()=>{const button=initial.pages[0].elements.find(e=>e.localParameterTarget);const wrapper=[...canvas().querySelectorAll('[data-element-id]')].find(n=>n.dataset.elementId===button.id);wrapper.scrollIntoView();const r=wrapper.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);check(r.width>0&&r.height>0&&(wrapper===hit||wrapper.contains(hit)),'hittable submit');hit.click();};
 if(keyed)set(0,'过长'.repeat(20));else{set(0,'张三');set(1,'101');}submit();await wait();check(!messages.some(m=>m.type==='previewNavigate'),'invalid input must block navigation');check(inputs()[keyed?0:1].getAttribute('aria-invalid')==='true','visible error');
 window.bridge=m=>{if(m.type!=='previewNavigate')return;check(m.submittedInputs['1']==='张三'&&(keyed||m.submittedInputs['2']==='28'),'submitted real input values');check(!('targetLabel'in m)&&!('parameters'in m),'identity-only action');queueMicrotask(()=>deliver(result,2,'@done'));};
 if(keyed)set(0,'张三');else set(1,'28');submit();await wait();check(canvas().textContent.includes(keyed?'输入=张三':'姓名=张三 年龄=28 参数=固定参数'),'visible target text');
 if(keyed){initial=namedInitial;deliver(initial,3,'@main');await wait();window.bridge=m=>{if(m.type==='previewNavigate')queueMicrotask(()=>deliver(namedResult,4,'@done'));};submit();await wait();check(canvas().textContent.includes('布衣(男) 数量=300'),'named parameter visible result');}
 check(location.href===initialURL&&history.length===initialHistory,'no browser navigation');check(!messages.some(m=>['apply','save'].includes(m.type)),'no source writes');
 document.body.dataset.inputSubmit='PASS';
}catch(e){document.body.dataset.inputSubmit='FAIL';document.body.dataset.error=String(e.stack||e);}});
</script></body>`);
const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);
const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)))];
assert.ok(candidates.length,'Chromium required');const attempts=[];
for(const [index,executable]of candidates.entries()){
 const run=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=5000','--dump-dom',`--user-data-dir=${path.join(out,'profile-'+index)}`,`--screenshot=${path.join(out,'preview.png')}`,pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
 const dom=run.stdout||'';attempts.push({executable,status:run.status,error:String(run.error||''),diagnostic:dom.match(/data-error="[^"]*"/)?.[0]});fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));fs.writeFileSync(path.join(out,'dom-'+index+'.html'),dom);
 if(run.status===0&&dom.includes('data-input-submit="PASS"')){console.log('preview-input-submit-browser.test.js: PASS '+executable);process.exit(0);}
}throw Error(JSON.stringify(attempts));
