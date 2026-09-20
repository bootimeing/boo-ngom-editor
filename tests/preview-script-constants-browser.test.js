const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const {createFixture,runtime}=require('./helpers/preview-constants-fixture');
const {buildDialogProgramCoordinateEdits}=require(path.join(runtime,'out/ui-dialog/preview-script-edits'));
const {applyTextReplacements}=require(path.join(runtime,'out/ui-dialog/source-patcher'));
const out=path.resolve(process.env.BOO_CONSTANTS_BROWSER_OUT||'artifacts/ctrl-f12-live-r25/constants-browser');
const encode=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function run(){
 const fixture=await createFixture();
 try{
  fs.mkdirSync(out,{recursive:true});
  const initial=fixture.session.model,updatedSource=fixture.source.replace(':50:50>',':62:58>'),applied=await fixture.reparse(updatedSource);
  const originalHashes={primary:hash(fixture.primaryPath),defines:hash(fixture.definesPath)};
  const uri=file=>pathToFileURL(path.join(runtime,file)).href;
  let html=fs.readFileSync(path.join(runtime,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
  const renderer=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  assert.ok(html.includes(renderer));
  html=html.replace(renderer,()=>`<script>window.messages=[];window.browserErrors=[];window.addEventListener('error',e=>browserErrors.push(String(e.error||e.message)));window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
  html=html.replace('</body>',()=>`<script>
const initial=${encode(initial)},applied=${encode(applied)};
const check=(v,m)=>{if(!v)throw Error(m);},wait=()=>new Promise(resolve=>setTimeout(resolve,90));
const canvas=()=>document.getElementById('dialogCanvas');
const find=text=>[...canvas().querySelectorAll('[data-element-id]')].find(node=>node.textContent.includes(text));
const point=node=>{check(node,'node exists');const box=node.getBoundingClientRect(),style=getComputedStyle(node),x=box.left+box.width/2,y=box.top+box.height/2,hit=document.elementFromPoint(x,y);
check(box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0,'positive visible geometry');check(node===hit||node.contains(hit),'real hittable surface');return{x,y,hit,box};};
const click=node=>{const p=point(node);p.hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));p.hit.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));p.hit.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));};
const drag=(node,dx,dy)=>{const p=point(node);p.hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:p.x+dx,clientY:p.y+dy}));window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:p.x+dx,clientY:p.y+dy}));};
let revision=0;const deliver=model=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:++revision,preserveDrafts:false,navigatePageId:model.pages.find(page=>page.sourceLabel==='@main').id}}));
window.addEventListener('load',async()=>{try{
await wait();deliver(initial);await wait();const originalUrl=location.href,originalHistory=history.length;
point(find('欢迎进入常量预览'));point(find('数量=40 合计=42'));point(find('输入=0'));
check(!canvas().textContent.includes('($'),'source macros are not canvas labels');
let fixed=find('常量坐标只读');point(fixed);click(fixed);await wait();
check(document.getElementById('elementX').disabled&&document.getElementById('elementY').disabled,'constant-derived coordinates are readonly in Inspector');
check(document.getElementById('rawStatement').textContent==='<TEXT:常量坐标只读:($横坐标):130>','readonly Inspector preserves the physical coordinate macro');
const fixedId=fixed.dataset.elementId;drag(fixed,20,20);await wait();fixed=find('常量坐标只读');
check(parseFloat(fixed.style.left)===86&&parseFloat(fixed.style.top)===126,'readonly macro position cannot be dragged');
check(document.querySelectorAll('#changeList .change-row').length===0,'readonly attempt makes no coordinate draft');
let title=find('欢迎进入常量预览');const titleId=title.dataset.elementId,box=point(title).box;
check(parseFloat(title.style.left)===46&&parseFloat(title.style.top)===46,'source50,50 retains text minus4 exactly once');
drag(title,12,8);await wait();title=find('欢迎进入常量预览');point(title);
check(parseFloat(title.style.left)===58&&parseFloat(title.style.top)===54,'macro caption still has direct numeric drag');
check(document.getElementById('sourceX').textContent==='62'&&document.getElementById('sourceY').textContent==='58','Inspector reversible source coordinate values');
check(document.getElementById('rawStatement').textContent==='<TEXT:($标题):50:50>','draft Inspector preserves physical caption macro and original source');
check(document.querySelectorAll('#changeList .change-row').length===1,'only direct-coordinate title owns a draft');
window.bridge=message=>{if(message.type==='apply')queueMicrotask(()=>deliver(applied));};
click(document.getElementById('applyButton'));await wait();
const writes=messages.filter(message=>message.type==='apply');
check(writes.length===1&&writes[0].changes.length===1,'one explicit Apply carries one change');
check(writes[0].previewRevision===1,'Apply uses published revision');
check(writes[0].changes[0].elementId===titleId&&writes[0].changes[0].x===58&&writes[0].changes[0].y===54,'only painted values and identity sent');
check(Object.keys(writes[0].changes[0]).sort().join(',')==='elementId,x,y','Webview does not nominate source path/spans');
check(!writes[0].changes.some(change=>change.elementId===fixedId),'macro coordinate never enters Apply');
title=find('欢迎进入常量预览');click(title);await wait();
check(parseFloat(title.style.left)===58&&parseFloat(title.style.top)===54,'post-Apply production model retains exact position');
check(document.getElementById('rawStatement').textContent==='<TEXT:($标题):62:58>','post-Apply Inspector shows reparsed physical macro source');
const changeSection=document.getElementById('changeSection');
check(document.querySelectorAll('#changeList .change-row').length===0
  && changeSection.classList.contains('hidden')
  && getComputedStyle(changeSection).display==='none'
  && document.getElementById('applyButton').textContent.trim()==='应用'
  && document.getElementById('undoButton').disabled
  && document.getElementById('redoButton').disabled,
  'post-Apply model clears draft and history');
check(!messages.some(m=>['save','previewNavigate','openPatchManager'].includes(m.type)),'constants trigger no server/window/navigation action');
check(location.href===originalUrl&&history.length===originalHistory,'no browser navigation or history change');
check(browserErrors.length===0,'no renderer exceptions: '+browserErrors.join(';'));
const result=document.createElement('pre');result.id='constants-browser-evidence';result.hidden=true;result.textContent=JSON.stringify({apply:writes[0],titleId,fixedId,titleBox:{width:box.width,height:box.height},messages:messages.map(m=>m.type)});document.body.append(result);
document.body.dataset.constantsBrowser='PASS';
}catch(error){document.body.dataset.constantsBrowser='FAIL';document.body.dataset.error=String(error.stack||error);}});
</script></body>`);
  const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);
  const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,...['PROGRAMFILES','PROGRAMFILES(X86)','LOCALAPPDATA'].flatMap(name=>process.env[name]?[path.join(process.env[name],'Google','Chrome','Application','chrome.exe'),path.join(process.env[name],'Microsoft','Edge','Application','msedge.exe')]:[])].filter(executable=>executable&&fs.existsSync(executable)).map(executable=>path.resolve(executable)))];
  assert.ok(candidates.length,'installed Chromium required');const attempts=[];let successes=0;
  for(const [index,executable]of candidates.entries()){
   const version=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-Item -LiteralPath $env:BOO_CONSTANTS_EXE).VersionInfo.ProductVersion'],{encoding:'utf8',timeout:5000,windowsHide:true,env:{...process.env,BOO_CONSTANTS_EXE:executable}}).stdout?.trim()||'<unknown>';
   const screenshot=path.join(out,`preview-${index}.png`);
   const result=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=4500','--dump-dom','--user-data-dir='+path.join(out,`profile-${index}`),'--screenshot='+screenshot,pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
   const dom=result.stdout||'',passed=result.status===0&&dom.includes('data-constants-browser="PASS"');
   attempts.push({executable,version,passed,status:result.status,signal:result.signal,error:String(result.error||''),hasBody:/<body\b/i.test(dom),diagnostic:dom.match(/data-error="[^"]*"/)?.[0],stderr:String(result.stderr||'').slice(-6000),screenshot});
   fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));fs.writeFileSync(path.join(out,`dom-${index}.html`),dom);
   if(!passed)continue;
   const captured=/<pre id="constants-browser-evidence"[^>]*>([^<]+)<\/pre>/.exec(dom);assert.ok(captured);
   const evidence=JSON.parse(captured[1].replaceAll('&quot;','"').replaceAll('&gt;','>').replaceAll('&lt;','<').replaceAll('&amp;','&'));
   const plans=buildDialogProgramCoordinateEdits(fixture.source,initial,evidence.apply.changes);assert.equal(plans.length,1);assert.equal(plans[0].source.uri,fixture.primary.uri.toString());
   const next=applyTextReplacements(fixture.source,plans[0].replacements);assert.equal(next,updatedSource);
   const reparsed=await fixture.reparse(next),title=reparsed.pages.find(page=>page.sourceLabel==='@main').elements.find(element=>element.text==='欢迎进入常量预览');
   assert.equal(title.x.displayValue,58);assert.equal(title.y.displayValue,54);assert.equal(title.sourceRange.original,'<TEXT:($标题):62:58>');
   assert.equal(hash(fixture.primaryPath),originalHashes.primary);assert.equal(hash(fixture.definesPath),originalHashes.defines);
   fs.writeFileSync(path.join(out,`apply-verification-${index}.json`),JSON.stringify({evidence,next,originalHashes,sourceUnchanged:true,definitionsUnchanged:true},null,2));
   successes++;console.log(`preview-script-constants-browser.test.js: PASS ${executable} version=${version} titleBox=${JSON.stringify(evidence.titleBox)} screenshot=${screenshot}`);
  }
  assert.ok(successes,'installed candidates exhausted: '+JSON.stringify(attempts));
 }finally{fixture.cleanup();}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});module.exports={run};
