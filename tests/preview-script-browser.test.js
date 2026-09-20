const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { parse, source, external } = require('./preview-script-model.test');

const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const out = path.resolve(process.env.BOO_SCRIPT_BROWSER_OUT || 'artifacts/ctrl-f12-live-r24/browser-edit-final');
fs.mkdirSync(out, { recursive: true });
const initial = parse().model;
const changed = parse(source, { 'N$base': '40' }).model;
const updatedSource = source.replace(':40:40>', ':52:48>');
const updatedExternal = external.replace(':100:120>', ':111:133>');
const applied = parse(updatedSource, { 'N$base': '40' }, {}, updatedExternal).model;
const encode = value => JSON.stringify(value).replace(/</g, '\\u003c');
const uri = file => pathToFileURL(path.join(root, file)).href;
let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
  .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css'))
  .replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
assert.ok(html.includes(renderer), 'production renderer tag must be present');
html = html.replace(renderer, () => `<script>window.messages=[];window.browserErrors=[];window.addEventListener('error',event=>browserErrors.push(String(event.error||event.message)));window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
html = html.replace('</body>', () => `<script>
const initial=${encode(initial)},changed=${encode(changed)},applied=${encode(applied)};
const check=(value,message)=>{if(!value)throw Error(message);};
const wait=()=>new Promise(resolve=>setTimeout(resolve,90));
const canvas=()=>document.getElementById('dialogCanvas');
const find=text=>[...canvas().querySelectorAll('[data-element-id]')].find(node=>node.textContent.includes(text));
const findPage=label=>[...document.querySelectorAll('#sceneList .scene-button')].find(node=>node.querySelector('strong')?.textContent===label);
const point=node=>{check(node,'expected DOM element');const box=node.getBoundingClientRect(),style=getComputedStyle(node);
 const x=box.left+box.width/2,y=box.top+box.height/2,hit=document.elementFromPoint(x,y);
 check(box.width>0&&box.height>0&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0,'positive visible geometry');
 check(node===hit||node.contains(hit),'element must be a real hit target');return {box,x,y,hit};};
const click=node=>{const p=point(node);p.hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));
 p.hit.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));
 p.hit.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));};
const drag=(node,dx,dy)=>{const p=point(node);p.hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:p.x,clientY:p.y}));
 window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:p.x+dx,clientY:p.y+dy}));
 window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:p.x+dx,clientY:p.y+dy}));};
let revision=0;
const deliver=(model,preserveDrafts=true)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,
 previewRevision:++revision,preserveDrafts,navigatePageId:model.pages.find(page=>page.sourceLabel==='@main').id}}));
window.addEventListener('load',async()=>{try{
 await wait();deliver(initial,false);await wait();
 const originalUrl=location.href,originalHistory=history.length;
 check(canvas().textContent.includes('主结果=2'),'unknown numeric input defaults to zero before CALL adds two');
 check(!canvas().textContent.includes('<$'),'source expressions are not visible labels');
 point(find('主结果=2'));
 window.bridge=message=>{if(message.type==='previewInput'){
   check(message.name==='N$base'&&message.value==='40','typed input identity and scalar value');
   queueMicrotask(()=>deliver(changed));
 }else if(message.type==='apply'&&message.changes.length){queueMicrotask(()=>deliver(applied,false));}};
 const input=[...document.querySelectorAll('[data-preview-name]')].find(node=>node.dataset.previewName==='N$base');
 point(input);input.focus();input.value='40';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await wait();
 check(document.activeElement===input&&input.value==='40','typed input focus and value survive model update');
 let main=find('主结果=42');point(main);
 check(parseFloat(main.style.left)===36&&parseFloat(main.style.top)===36,'legacy source 40,40 paints at 36,36 exactly once');
 const mainId=main.dataset.elementId;
 drag(main,12,8);await wait();main=find('主结果=42');
 check(parseFloat(main.style.left)===48&&parseFloat(main.style.top)===44,'primary text retains coordinate dragging after cross-file display');
 check(document.getElementById('sourceX').textContent.includes('52')&&document.getElementById('sourceY').textContent.includes('48'),'Inspector shows reversible source coordinate bias');
 click(findPage('@calculate'));await wait();
 let ext=find('外部=42');const extHit=point(ext),extId=ext.dataset.elementId;
 const externalModel=changed.pages.find(page=>page.sourceLabel==='@calculate').elements.find(element=>element.text==='外部=42');
 check(extId===externalModel.id&&externalModel.editable,'direct external source coordinate owns a granted editable source model');
 check(!externalModel.localParameterTarget&&!externalModel.localControlTarget&&!externalModel.localPopupInput,'coordinate editing does not grant external local navigation');
 const before={x:parseFloat(ext.style.left),y:parseFloat(ext.style.top)};
 check(before.x===96&&before.y===116,'external source 100,120 retains legacy paint bias');
 const messageStart=messages.length;
 drag(ext,10,10);await wait();ext=find('外部=42');point(ext);
 check(parseFloat(ext.style.left)===106&&parseFloat(ext.style.top)===126,'external source supports a hittable coordinate drag');
 check(!document.getElementById('elementX').disabled&&!document.getElementById('elementY').disabled,'external Inspector direct coordinate editing is enabled');
 document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await wait();
 check(parseFloat(find('外部=42').style.left)===107&&parseFloat(find('外部=42').style.top)===126,'external keyboard micro-adjustment moves the selected source instance');
 const inspectorY=document.getElementById('elementY');point(inspectorY);inspectorY.focus();inspectorY.value='129';inspectorY.dispatchEvent(new Event('change',{bubbles:true}));await wait();
 check(parseFloat(find('外部=42').style.left)===107&&parseFloat(find('外部=42').style.top)===129,'external Inspector modifies the same coordinate draft');
 check(document.getElementById('sourceX').textContent==='111'&&document.getElementById('sourceY').textContent==='133','external Inspector preserves source versus paint separation');
 click(document.getElementById('undoButton'));await wait();check(parseFloat(find('外部=42').style.top)===126,'external draft Inspector change can be undone');
 click(document.getElementById('redoButton'));await wait();check(parseFloat(find('外部=42').style.top)===129,'external draft Inspector change can be redone');
 check(document.querySelectorAll('#changeList .change-row').length===2,'primary and external coordinate drafts are retained together across pages');
 check(document.getElementById('elementSourcePath').textContent===externalModel.sourceFilePath,'Inspector identifies the actual external file');
 check(document.getElementById('changeList').textContent.includes('main.txt')&&document.getElementById('changeList').textContent.includes('calculate.txt'),'change list names both target documents');
 check(!messages.slice(messageStart).some(message=>message.type==='apply'||message.type==='save'),'external gestures remain drafts until explicit Apply');
 click(document.getElementById('locateButton'));await wait();
 const located=messages.filter(message=>message.type==='locate');
 check(located.length===1&&located[0].elementId===extId,'locate uses the selected external node real ID');
 click(document.getElementById('applyButton'));await wait();
 const writes=messages.filter(message=>message.type==='apply'&&message.changes.length);
 check(writes.length===1&&writes[0].changes.length===2,'one Apply carries both source drafts: '+JSON.stringify({writes,browserErrors}));
 const primaryChange=writes[0].changes.find(change=>change.elementId===mainId),externalChange=writes[0].changes.find(change=>change.elementId===extId);
 check(primaryChange?.x===48&&primaryChange?.y===44&&externalChange?.x===107&&externalChange?.y===129,'Apply contains source-owned IDs and painted coordinate values only');
 check(writes[0].previewRevision===2,'Apply is bound to the last published model revision');
 check(writes[0].changes.every(change=>Object.keys(change).sort().join(',')==='elementId,x,y'),'the Webview does not nominate a target path or source span');
 main=find('主结果=42');check(parseFloat(main.style.left)===48&&parseFloat(main.style.top)===44,'primary post-Apply model preserves its own paint bias');
 const changeSection=document.getElementById('changeSection'),changeList=document.getElementById('changeList');
 check(changeList.querySelectorAll('.change-row').length===0&&changeList.textContent.trim()==='',
   'one committed model removes every retained document draft row');
 check(changeSection.classList.contains('hidden')&&getComputedStyle(changeSection).display==='none',
   'an empty committed draft set hides the change section');
 check(document.getElementById('applyButton').textContent==='应用'&&document.getElementById('saveButton').textContent==='保存',
   'committed drafts no longer appear in Apply or Save counts');
 check(document.getElementById('undoButton').disabled&&document.getElementById('redoButton').disabled,
   'committed drafts also clear cross-document coordinate history');
 click(findPage('@calculate'));await wait();ext=find('外部=42');point(ext);
 check(parseFloat(ext.style.left)===107&&parseFloat(ext.style.top)===129,'external post-Apply model preserves its own paint bias');
 click(ext);await wait();
 check(!messages.some(message=>['save','previewNavigate','openPatchManager'].includes(message.type)),'page switching and locate cannot execute scripts or open asset tools');
 check(location.href===originalUrl&&history.length===originalHistory,'no browser navigation or history changes');
 check(browserErrors.length===0,'production renderer has no uncaught browser errors: '+browserErrors.join('; '));
 const result=document.createElement('pre');result.id='script-browser-evidence';result.hidden=true;
 result.textContent=JSON.stringify({changes:writes[0].changes,mainId,externalId:extId,externalPosition:before,
 externalBox:{width:extHit.box.width,height:extHit.box.height},located:located[0],messages:messages.map(message=>message.type)});
 document.body.append(result);
 if(new URL(location.href).searchParams.get('view')==='main'){click(findPage('@main'));await wait();click(find('主结果=42'));await wait();}
 document.body.dataset.scriptBrowser='PASS';
}catch(error){document.body.dataset.scriptBrowser='FAIL';document.body.dataset.error=String(error.stack||error);}});
</script></body>`);

const file = path.join(out, 'fixture.html');
fs.writeFileSync(file, html);
const candidates = [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
  ...['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].flatMap(name => process.env[name] ? [
    path.join(process.env[name], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env[name], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ] : []),
].filter(executable => executable && fs.existsSync(executable)).map(executable => path.resolve(executable)))];
assert.ok(candidates.length, 'At least one installed Chromium is required; an empty DOM is not a skip');
const attempts = [];
let successCount = 0;
const successfulViews = new Set();
for (const [index, executable] of candidates.entries()) {
  const version = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(Get-Item -LiteralPath $env:BOO_SCRIPT_BROWSER_EXE).VersionInfo.ProductVersion'],
  { encoding: 'utf8', timeout: 5000, windowsHide: true, env: { ...process.env, BOO_SCRIPT_BROWSER_EXE: executable } }).stdout?.trim() || '<unknown>';
  for (const view of ['external', 'main']) {
    const result = spawnSync(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
      '--window-size=1440,1000', '--virtual-time-budget=6000', '--dump-dom', '--user-data-dir=' + path.join(out, `profile-${index}-${view}`),
      '--screenshot=' + path.join(out, `preview-${index}-${view}.png`), pathToFileURL(file).href + '?view=' + view],
    { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    const dom = result.stdout || '';
    const passed = result.status === 0 && dom.includes('data-script-browser="PASS"');
    attempts.push({ executable, version, view, passed, status: result.status, signal: result.signal,
      error: String(result.error || ''), hasBody: /<body\b/i.test(dom), diagnostic: dom.match(/data-error="[^"]*"/)?.[0],
      stderr: String(result.stderr || '').slice(-6000) });
    fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2));
    fs.writeFileSync(path.join(out, `dom-${index}-${view}.html`), dom);
    if (!passed) continue;
    const captured = /<pre id="script-browser-evidence"[^>]*>([^<]+)<\/pre>/.exec(dom);
    assert.ok(captured, 'passing browser must expose auditable Apply/locate evidence');
    const evidence = JSON.parse(captured[1].replaceAll('&quot;', '"').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&'));
    const { buildDialogCoordinateEdits, applyTextReplacements } = require(path.join(root, 'out/ui-dialog/source-patcher'));
    const { buildDialogProgramCoordinateEdits } = require(path.join(root, 'out/ui-dialog/preview-script-edits'));
    const plans = buildDialogProgramCoordinateEdits(source, changed, evidence.changes);
    assert.equal(plans.length, 2, 'the host capability maps the two coordinate drafts to two distinct physical documents');
    const mainPlan = plans.find(plan => plan.source.uri === changed.uri);
    const externalPlan = plans.find(plan => plan.source.uri !== changed.uri);
    assert.ok(mainPlan && externalPlan);
    assert.equal(mainPlan.source.text, source);
    assert.equal(externalPlan.source.text, external);
    const updated = applyTextReplacements(mainPlan.source.text, mainPlan.replacements);
    const updatedCallee = applyTextReplacements(externalPlan.source.text, externalPlan.replacements);
    assert.equal(updated, updatedSource, 'production patcher changes only physical primary coordinate literals');
    assert.equal(updatedCallee, updatedExternal, 'production plan applies only the external coordinate literals to the external source');
    const reparsed = parse(updated, { 'N$base': '40' }, {}, updatedCallee);
    const element = reparsed.model.pages.find(page => page.sourceLabel === '@main').elements.find(item => item.text === '主结果=42');
    assert.equal(element.x.displayValue, 48); assert.equal(element.y.displayValue, 44);
    const located = reparsed.model.scenes.flatMap(scene => scene.elements).find(item => item.id === evidence.located.elementId);
    assert.ok(located, 'locate identity is present in the post-Apply production model');
    assert.equal(located.sourceUri, reparsed.loaded.uri);
    assert.equal(updatedCallee.slice(located.sourceRange.start, located.sourceRange.end), located.sourceRange.original);
    assert.equal(located.x.sourceValue, 111); assert.equal(located.y.sourceValue, 133);
    assert.equal(located.x.displayValue, 107); assert.equal(located.y.displayValue, 129);
    const externalElement = changed.scenes.flatMap(scene => scene.elements).find(item => item.id === evidence.externalId);
    assert.equal(externalElement.editable, true);
    assert.throws(() => buildDialogCoordinateEdits(source, changed, [{ elementId: evidence.externalId, x: 120, y: 130 }]), /外部/,
      'the old primary-only patcher still independently rejects an editable external element');
    fs.writeFileSync(path.join(out, `apply-verification-${index}-${view}.json`), JSON.stringify({ evidence, updated,
      updatedExternal: updatedCallee, plans, physicalX: element.x, physicalY: element.y,
      externalPhysicalX: located.x, externalPhysicalY: located.y, locatedUri: located.sourceUri }, null, 2));
    successCount++;
    successfulViews.add(view);
    console.log(`preview-script-browser.test.js: PASS ${executable} version=${version} view=${view} elements=${(dom.match(/class="canvas-element\b/g) || []).length}`);
  }
}
assert.ok(successCount, 'Installed Chromium candidates exhausted without a passing DOM: ' + JSON.stringify(attempts));
assert.deepEqual([...successfulViews].sort(), ['external', 'main'], 'both the external and primary screenshot views must have a passing Chromium run');
