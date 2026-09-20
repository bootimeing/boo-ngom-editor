const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {fixture}=require('./preview-script-events-provider.test');
const {scenarios,selfScenario,elementFor,page}=require('./preview-script-gestures.test');
const repeatedSource=selfScenario.external.replace('SMALL N0 2','SMALL N0 4');
const browserScenarios=[...scenarios,selfScenario,
 {...selfScenario,kind:'self-call-second',external:repeatedSource,preClicks:1,expected:'继续3'},
 {...selfScenario,kind:'self-call-third',external:repeatedSource,preClicks:2,expected:'完成4'}];
const {messageFor}=require('./preview-script-gestures-provider.test');
const {hydrate}=require('./helpers/preview-image-hydration');
const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const out=path.resolve(process.env.BOO_SCRIPT_GESTURES_OUT||'artifacts/ctrl-f12-r25-events/gestures-browser');
async function run(){
 fs.mkdirSync(out,{recursive:true});const live=[],fixtures=[];
 try{
  for(const [index,config]of browserScenarios.entries()){
   const f=await fixture({...config,values:{}});live.push(f);
   for(let step=0;step<(config.preClicks||0);step++){
    await f.host.onMessage(f.session,messageFor(f.session,config));
    assert.equal(f.session.previewPath.length,step+1,config.kind+' initial prefix retains prior self-call');
   }
   const initialPath=f.session.previewPath.map(edge=>({...edge}));
   const initial=f.session.model,revision=index*10+1;await hydrate(initial,true);
   f.session.modelRevision=revision;await f.host.postModel(f.session);
   const element=elementFor(initial,config);assert.ok(element,config.kind+' source-backed external gesture');
   await f.host.onMessage(f.session,messageFor(f.session,config));
   assert.equal(f.session.previewPath.length,initialPath.length+1,config.kind+' expected production Provider result');
   fixtures.push({kind:config.kind,engine:config.engine,trigger:config.trigger,expected:config.expected,target:config.target,
    control:config.control,popupValue:config.popupValue,submittedInputs:config.submittedInputs,
    initial,initialPath,result:f.session.model,revision,elementId:element.id,preClicks:config.preClicks||0});
  }
  const encode=value=>JSON.stringify(value).replace(/</g,'\\u003c'),uri=file=>pathToFileURL(path.join(root,file)).href;
  let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
  const renderer=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  html=html.replace(renderer,()=>`<script>window.messages=[];window.browserErrors=[];window.addEventListener('error',event=>browserErrors.push(String(event.error||event.message)));window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
  html=html.replace('</body>',()=>`<script>
const fixtures=${encode(fixtures)},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms||90)),check=(value,message)=>{if(!value)throw Error(message);};
const canvas=()=>document.getElementById('dialogCanvas'),find=id=>[...canvas().querySelectorAll('[data-element-id]')].find(node=>node.dataset.elementId===id);
const point=(node,rx=.5,ry=.5)=>{check(node,'expected hit target');const r=node.getBoundingClientRect(),style=getComputedStyle(node),x=r.left+r.width*rx,y=r.top+r.height*ry,hit=document.elementFromPoint(x,y);check(r.width>0&&r.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&(hit===node||node.contains(hit)),'visible hittable '+node.className);return{r,x,y,hit};};
const click=node=>{node.scrollIntoView({block:'center',inline:'nearest'});point(node).hit.click();};
const deliver=(model,label,revision,preserve=false)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:revision,preserveDrafts:preserve,navigatePageId:model.pages.find(page=>!page.executionPreview&&page.sourceLabel===label).id}}));
const evidence=[];
window.addEventListener('load',async()=>{try{await wait();const originalUrl=location.href,originalHistory=history.length;
 for(const f of fixtures){
  let fired=0;window.bridge=message=>{if(message.type!=='previewNavigate')return;
   check(message.elementId===f.elementId&&message.previewRevision===f.revision&&message.trigger===f.trigger,f.kind+' exact source-owned identity/gesture/revision');
   check(!['targetLabel','sourceLabel','sourceUri','sourceRootLabel','sayOccurrence','submittedControl','parameters','arguments','lineNumber','column','variable'].some(key=>key in message),f.kind+' identity-only message');
   if(f.control)check(message.controlValue===f.control.value,f.kind+' submitted control value');
   if(f.popupValue!==undefined)check(message.popupValue===f.popupValue,f.kind+' submitted popup value');
   if(f.submittedInputs)check(JSON.stringify(message.submittedInputs)===JSON.stringify(f.submittedInputs),f.kind+' exact current-page inputs');
   fired++;evidence.push({kind:f.kind,message});queueMicrotask(()=>deliver(f.result,f.target,f.revision+1,true));
  };
  deliver(f.initial,'@panel',f.revision);await wait(80);
  const wrapper=find(f.elementId);point(wrapper);check(fired===0,f.kind+' not fired while merely displaying');
  if(['checkbox','slider','menu','loadingbar'].includes(f.kind))check([...wrapper.querySelectorAll('img')].some(img=>img.complete&&img.naturalWidth>0),f.kind+' actual loaded synthetic assets');
  if(f.kind.startsWith('self-call')){
   check(wrapper.textContent.includes('继续'+(f.preClicks+1)),'external self-call shows its current state');click(wrapper);
  }else if(f.kind==='checkbox'){
   const control=wrapper.querySelector('.toggle-hitarea');click(control);
  }else if(f.kind==='slider'){
   const control=wrapper.querySelector('.slider-hitarea'),p=point(control,.25,.75),r=wrapper.getBoundingClientRect();
   p.hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:r.x+r.width*.25,clientY:p.y}));
   window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:r.x+r.width*.75,clientY:p.y}));
   check(fired===0&&control.getAttribute('aria-valuenow')==='75','slider updates live without callback before release');
   window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:r.x+r.width*.75,clientY:p.y}));
   p.hit.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1,clientX:r.x+r.width*.75,clientY:p.y}));
  }else if(f.kind==='menu'){
   const control=wrapper.querySelector('.menu-toggle-hitarea');click(control);await wait();
   const option=[...canvas().querySelectorAll('.menu-option')].find(node=>node.textContent==='装备');click(option);
  }else if(f.trigger==='popup-submit'){
   click(wrapper);await wait();let dialog=document.querySelector('.local-input-dialog');check(dialog?.open,'external popup opens');point(dialog);
   check(document.activeElement===dialog.querySelector('input'),'popup autofocus');
   click(dialog.querySelector('[data-popup-cancel]'));check(fired===0&&!document.querySelector('.local-input-dialog'),'external popup cancel does not submit');
   click(find(f.elementId));await wait();dialog=document.querySelector('.local-input-dialog');const input=dialog.querySelector('input');
   if(f.kind==='popup-integer'){input.value='1.5';click(dialog.querySelector('button[type=submit]'));check(fired===0&&input.getAttribute('aria-invalid')==='true','external integer popup rejects decimal visibly');}
   input.value=f.popupValue;input.dispatchEvent(new Event('input',{bubbles:true}));click(dialog.querySelector('button[type=submit]'));
  }else if(f.trigger==='completion'){
   await wait(1400);
  }else if(f.kind==='equip-double'){
   const hit=point(wrapper).hit;hit.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:1}));hit.dispatchEvent(new MouseEvent('click',{bubbles:true,detail:2}));hit.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));await wait(450);
  }else if(f.kind==='gom-inputs'){
   const fields=[...canvas().querySelectorAll('input,textarea')];check(fields.length===2,'external GOM page has its own two input fields');
   for(const field of fields){point(field);check(!field.readOnly,'source-valid external input is editable');}
   fields[0].value='张三';fields[0].dispatchEvent(new Event('input',{bubbles:true}));fields[1].value='101';fields[1].dispatchEvent(new Event('input',{bubbles:true}));click(wrapper);await wait();
   check(fired===0&&fields[1].getAttribute('aria-invalid')==='true','out-of-range external input blocks actual hit');
   fields[1].value='28';fields[1].dispatchEvent(new Event('input',{bubbles:true}));click(find(f.elementId));
  }
  await wait(100);check(fired===1,f.kind+' one actual gesture emits one event');
  check(canvas().textContent.includes(f.expected),f.kind+' displays production-host result');
  if(f.trigger==='completion'){deliver(f.initial,'@panel',f.revision+2,true);await wait(350);check(fired===1,f.kind+' returning does not re-fire completed event');}
 }
 check(location.href===originalUrl&&history.length===originalHistory&&!messages.some(message=>['apply','save','openPatchManager'].includes(message.type)),'no browser/source/runtime effects');
 check(browserErrors.length===0,'no uncaught renderer errors');const record=document.createElement('script');record.id='gesture-evidence';record.type='application/json';record.textContent=JSON.stringify(evidence);document.body.append(record);
 document.body.dataset.scriptGestures='PASS';document.body.dataset.scenarios=String(evidence.length);
 }catch(error){document.body.dataset.scriptGestures='FAIL';document.body.dataset.error=String(error.stack||error);}});
</script></body>`);
  const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);const attempts=[];
  const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(file=>file&&fs.existsSync(file)))];assert.ok(candidates.length,'installed Chromium required');
  for(const [index,executable]of candidates.entries()){
   const r=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1050','--virtual-time-budget=16000','--dump-dom','--user-data-dir='+path.join(out,'profile-'+index),'--screenshot='+path.join(out,'preview-'+index+'.png'),pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:32*1024*1024});
   const dom=r.stdout||'',version=spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-Item -LiteralPath '${executable.replace(/'/g,"''")}').VersionInfo.ProductVersion`],{encoding:'utf8',windowsHide:true}).stdout.trim();
   const attempt={executable,version,status:r.status,passed:r.status===0&&dom.includes('data-script-gestures="PASS"'),error:String(r.error||''),stderr:r.stderr||'',stdoutLength:dom.length,diagnostic:dom.match(/data-error="[^"]*"/)?.[0],elementCount:(dom.match(/class="canvas-element\b/g)||[]).length};
   fs.writeFileSync(path.join(out,'dom-'+index+'.html'),dom);
   if(attempt.passed){
    const match=dom.match(/<script id="gesture-evidence" type="application\/json">([\s\S]*?)<\/script>/);assert.ok(match,'successful browser must retain actual messages');
    const evidence=JSON.parse(match[1]);assert.equal(evidence.length,browserScenarios.length);fs.writeFileSync(path.join(out,'messages-'+index+'.json'),JSON.stringify(evidence,null,2));
    for(const [position,item]of evidence.entries()){
     const config=browserScenarios[position],f=live[position],initial=fixtures[position].initial,revision=fixtures[position].revision;
     assert.equal(item.kind,config.kind);assert.equal(item.message.previewRevision,revision,'exact real browser revision matches fixture publication');
     f.session.model=initial;f.session.modelRevision=revision;f.session.publishedPreview={model:initial,revision};f.session.previewPath=fixtures[position].initialPath.map(edge=>({...edge}));
     await f.host.onMessage(f.session,item.message);
     assert.equal(f.session.previewPath.length,fixtures[position].initialPath.length+1,config.kind+' captured Chromium event passes production Provider');
     assert.ok(page(f.session.model,config.target).elements.some(element=>element.text?.includes(config.expected)),config.kind+' captured event yields exact host result');
    }
    attempt.hostReplayed=evidence.length;
   }
   attempts.push(attempt);fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));
  }
  assert.ok(attempts.some(attempt=>attempt.passed),JSON.stringify(attempts,null,2));
  for(const attempt of attempts)console.log('preview-script-gestures-browser.test.js: '+(attempt.passed?'PASS':'FAILED CANDIDATE')+' '+attempt.executable+' version='+attempt.version+' external gestures='+attempt.hostReplayed+' elements='+attempt.elementCount);
 }finally{for(const f of live)f.dispose();}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
