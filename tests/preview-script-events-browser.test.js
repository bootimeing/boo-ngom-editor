const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse,page,buttons,callFor}=require('./preview-script-events.test');
const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const out=path.resolve(process.env.BOO_SCRIPT_EVENTS_OUT||'artifacts/ctrl-f12-r25-events/browser');fs.mkdirSync(out,{recursive:true});
const initial=parse(), actions=page(initial,'@panel').elements.filter(element=>element.localParameterTarget);
const replay=Object.fromEntries(actions.map(element=>[element.id,parse({},[callFor(initial,element)])]));
const vanished=parse({U101:'0'},[callFor(initial,buttons(initial)[1])]);
const encode=value=>JSON.stringify(value).replace(/</g,'\\u003c'),uri=file=>pathToFileURL(path.join(root,file)).href;
let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
const renderer=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html=html.replace(renderer,()=>`<script>window.messages=[];window.browserErrors=[];window.addEventListener('error',event=>browserErrors.push(String(event.error||event.message)));window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
html=html.replace('</body>',()=>`<script>
const initial=${encode(initial)},replay=${encode(replay)},vanished=${encode(vanished)},buttonIds=${encode(buttons(initial).map(element=>element.id))};
const plainId=${encode(page(initial,'@panel').elements.filter(element=>element.raw.includes('/@plain'))[1].id)};
const check=(value,message)=>{if(!value)throw Error(message);},wait=()=>new Promise(resolve=>setTimeout(resolve,90));
const canvas=()=>document.getElementById('dialogCanvas');
const find=id=>[...canvas().querySelectorAll('[data-element-id]')].find(node=>node.dataset.elementId===id);
const findPage=label=>[...document.querySelectorAll('#sceneList .scene-button')].find(node=>node.querySelector('strong')?.textContent===label);
const point=node=>{check(node,'expected DOM element');const box=node.getBoundingClientRect(),style=getComputedStyle(node),x=box.left+box.width/2,y=box.top+box.height/2,hit=document.elementFromPoint(x,y);
check(box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&(node===hit||node.contains(hit)),'visible hittable control');return{x,y,hit};};
const click=node=>{check(node,'click target exists');node.scrollIntoView({block:'center',inline:'nearest'});const p=point(node);p.hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));p.hit.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));p.hit.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));};
const drag=(node,dx,dy)=>{const p=point(node);p.hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:p.x+dx,clientY:p.y+dy}));window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:p.x+dx,clientY:p.y+dy}));};
let revision=0;
const deliver=(model,label=model.previewNavigation.activeLabel,preserveDrafts=true)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:++revision,preserveDrafts,navigatePageId:model.pages.find(page=>!page.executionPreview&&page.sourceLabel===label).id}}));
window.addEventListener('load',async()=>{try{
 await wait();deliver(initial,'@main',false);await wait();const originalUrl=location.href,originalHistory=history.length;
 const mainId=initial.pages.find(page=>!page.executionPreview&&page.sourceLabel==='@main').elements.find(element=>element.raw.startsWith('<TEXT:')).id;
 drag(find(mainId),10,10);await wait();check(parseFloat(find(mainId).style.left)===16,'coordinate draft starts before external navigation');
 window.bridge=message=>{
 if(message.type==='previewNavigate'){
  check(message.trigger==='click'&&message.previewRevision===revision,'gesture and published revision transported');
  check(!['targetLabel','sourceLabel','sourceUri','sourceRootLabel','sayOccurrence','parameters','arguments','lineNumber','column'].some(key=>key in message),'browser transports identity, not event authority');
  check(replay[message.elementId],'real clicked identity selects a host-created replay');queueMicrotask(()=>deliver(replay[message.elementId]));
 }else if(message.type==='previewBack')queueMicrotask(()=>deliver(initial));
 else if(message.type==='previewInput'){check(message.name==='U101'&&message.value==='0','typed condition update');queueMicrotask(()=>deliver(vanished));}
 };
 for(const index of [1,0,1]){
  click(findPage('@panel'));await wait();const before=messages.filter(message=>message.type==='previewNavigate').length;
  click(find(buttonIds[index]));await wait();check(messages.filter(message=>message.type==='previewNavigate').length===before+1,'one actual external hit dispatches one host event');
  check(canvas().textContent.includes('参数='+((index+1)*10)+'/调用者='+((index+1)*10)),'clicked external instance uses its own argument and caller state');
  click(document.getElementById('previewBackButton'));await wait();check(parseFloat(find(mainId).style.left)===16,'Back preserves independent source coordinate draft');
 }
 click(findPage('@panel'));await wait();const plainBefore=messages.filter(message=>message.type==='previewNavigate').length;
 click(find(plainId));await wait();check(messages.filter(message=>message.type==='previewNavigate').length===plainBefore+1,'bare text link must use host replay');
 check(canvas().textContent.includes('纯文字caller=20/空参=预览文字'),'bare link starts an empty parameter frame with selected caller');
 click(document.getElementById('previewBackButton'));await wait();click(findPage('@panel'));await wait();click(find(buttonIds[1]));await wait();
 const field=[...document.querySelectorAll('[data-preview-name]')].find(node=>node.dataset.previewName==='U101');check(field,'condition input exists');field.scrollIntoView({block:'nearest'});await wait();point(field);field.focus();field.value='0';field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));await wait();
 check(document.activeElement===field&&field.value==='0','condition input and focus survive invalidated history');
 check(document.getElementById('previewBackButton').disabled&&!canvas().textContent.includes('参数='),'removed instance invalidates history and stale target');
 check(parseFloat(find(mainId).style.left)===16,'input history reset preserves coordinate draft');
 click(findPage('@panel'));await wait();check(canvas().textContent.includes('打开10')&&!canvas().textContent.includes('打开20'),'only emitted external instance remains');
 for(const node of canvas().querySelectorAll('[data-element-id]'))point(node);
 check(location.href===originalUrl&&history.length===originalHistory&&!messages.some(message=>['apply','save','openPatchManager'].includes(message.type)),'no URL/history/source/runtime effects');
 check(browserErrors.length===0,'no uncaught renderer errors');document.body.dataset.scriptEvents='PASS';document.body.dataset.eventCount=String(messages.filter(message=>message.type==='previewNavigate').length);
 }catch(error){document.body.dataset.scriptEvents='FAIL';document.body.dataset.error=String(error.stack||error);}});
</script></body>`);
const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);const attempts=[];
const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(file=>file&&fs.existsSync(file)))];
assert.ok(candidates.length,'installed Chromium required for the external event gate');
for(const [index,executable]of candidates.entries()){
 const result=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1050','--virtual-time-budget=10000','--dump-dom',`--user-data-dir=${path.join(out,'profile-'+index)}`,`--screenshot=${path.join(out,'preview-'+index+'.png')}`,pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
 const version=spawnSync('powershell.exe',['-NoProfile','-Command',`(Get-Item -LiteralPath '${executable.replace(/'/g,"''")}').VersionInfo.ProductVersion`],{encoding:'utf8',windowsHide:true}).stdout.trim();
 const dom=result.stdout||'',elementCount=(dom.match(/class="canvas-element\b/g)||[]).length;
 attempts.push({executable,version,elementCount,status:result.status,passed:result.status===0&&dom.includes('data-script-events="PASS"'),error:String(result.error||''),diagnostic:dom.match(/data-error="[^"]*"/)?.[0],stderr:(result.stderr||'').slice(-2500)});
 fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));fs.writeFileSync(path.join(out,'dom-'+index+'.html'),dom);
}
assert.ok(attempts.some(attempt=>attempt.passed),JSON.stringify(attempts,null,2));
for(const attempt of attempts)console.log('preview-script-events-browser.test.js: '+(attempt.passed?'PASS':'FAILED CANDIDATE')+' '+attempt.executable+' version='+attempt.version+' elements='+attempt.elementCount);
