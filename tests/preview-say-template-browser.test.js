const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
const { parse } = require('./preview-inputs-integration.test'), { source, templates } = require('./preview-say-template.test');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const out = path.resolve(process.env.BOO_SAY_TEMPLATE_OUT || 'artifacts/say-template-r12/browser');
fs.mkdirSync(out, { recursive: true });
const model = parse(source, { U101: '3' }), fewer = parse(source, { U101: '2' });
const applied = parse(source.replace(':40:50>', ':94:104>'), { U101: '2' });
const empty = parse(source.replace(':40:50>', ':94:104>'), { U101: '0' });
const uri = f => pathToFileURL(path.join(root, f)).href, encode = x => JSON.stringify(x).replace(/</g, '\\u003c');
let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8').replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
const script = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html = html.replace(script, () => `<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${script}`);
html = html.replace('</body>', () => `<script>
const initial=${encode(model)},fewer=${encode(fewer)},applied=${encode(applied)},empty=${encode(empty)};
let current=initial,revision=0;const wait=()=>new Promise(r=>setTimeout(r,60)),check=(v,m)=>{if(!v)throw Error(m);};
const copies=()=>current.pages[0].elements.filter(e=>e.text.startsWith('实例'));
const node=e=>[...document.querySelectorAll('#dialogCanvas [data-element-id]')].find(n=>n.dataset.elementId===e.id);
const deliver=(m,preserveDrafts=true)=>{current=m;window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:m,previewRevision:++revision,preserveDrafts}}));};
const positions=(x,y)=>{for(const e of copies()){const n=node(e);check(n&&parseFloat(n.style.left)===x&&parseFloat(n.style.top)===y,'all copies share draft '+e.text+' expected '+x+','+y+' got '+n?.style.left+','+n?.style.top);}check(parseFloat(node(current.pages[0].elements.at(-1)).style.left)===236,'independent template stays still');};
window.addEventListener('load',async()=>{try{
await wait();deliver(initial,false);await wait();positions(36,46);const url=location.href;
const last=node(copies().at(-1));const rect=last.getBoundingClientRect();const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);check(last===hit||last.contains(hit),'editable last instance hittable');
hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:rect.x+5,clientY:rect.y+5}));
window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:rect.x+25,clientY:rect.y+15}));
positions(56,56);check(document.querySelectorAll('.change-row').length===1,'one change during drag');
window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
document.getElementById('undoButton').click();positions(36,46);document.getElementById('redoButton').click();positions(56,56);
document.getElementById('elementX').value='90';document.getElementById('elementY').value='100';document.getElementById('elementX').dispatchEvent(new Event('change',{bubbles:true}));positions(90,100);
check(document.getElementById('sourceX').textContent==='94'&&document.getElementById('sourceY').textContent==='104','Inspector keeps paint bias');
document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));positions(91,100);document.getElementById('undoButton').click();positions(90,100);
const normalWidth=node(copies().at(-1)).getBoundingClientRect().width;
for(let i=0;i<5;i++)document.getElementById('zoomIn').click();positions(90,100);check(Math.abs(node(copies().at(-1)).getBoundingClientRect().width-normalWidth*1.5)<.01,'real DOM zoom geometry');document.getElementById('zoomReset').click();deliver(initial);await wait();positions(90,100);
window.bridge=m=>{if(m.type==='previewInput'){check(m.name==='U101'&&m.value==='2','typed count change');queueMicrotask(()=>deliver(fewer));}else if(m.type==='apply'){check(m.changes.length===1&&m.changes[0].elementId===copies().at(-1).id,'single current template owner submitted');const result=document.createElement('pre');result.id='template-apply';result.hidden=true;result.textContent=JSON.stringify(m.changes);document.body.append(result);queueMicrotask(()=>deliver(applied,false));}};
const input=[...document.querySelectorAll('[data-preview-name]')].find(n=>n.dataset.previewName==='U101');input.focus();input.value='2';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));await wait();positions(90,100);check(copies().length===2&&document.querySelectorAll('.change-row').length===1,'owner replacement preserves one draft');
document.getElementById('undoButton').click();positions(56,56);document.getElementById('redoButton').click();positions(90,100);
document.getElementById('applyButton').click();await wait();positions(90,100);check(document.querySelectorAll('.change-row').length===0,'Apply clears draft without jumping');
node(copies().at(-1)).dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:450,clientY:350}));window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));document.getElementById('canvasViewport').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));positions(91,100);
deliver(empty);await wait();check(copies().length===0&&document.querySelectorAll('.change-row').length===0&&document.getElementById('undoButton').disabled,'vanished template drops orphan drafts and history');deliver(applied);await wait();positions(90,100);
check(location.href===url&&!messages.some(m=>['save','previewNavigate','locate'].includes(m.type)),'no unintended action');document.body.dataset.sayTemplate='PASS';
}catch(e){document.body.dataset.sayTemplate='FAIL';document.body.dataset.error=String(e.stack||e);}});
</script></body>`);
const file = path.join(out, 'fixture.html'); fs.writeFileSync(file, html);
const attempts = [], candidates = [...new Set([process.env.BOO_BROWSER_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p => p && fs.existsSync(p)))];
assert.ok(candidates.length, 'Chromium required');
for (const [i, executable] of candidates.entries()) {
  const r = spawnSync(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', '--window-size=1440,1000', '--virtual-time-budget=6500', '--dump-dom', '--user-data-dir=' + path.join(out, 'profile-' + i), '--screenshot=' + path.join(out, 'preview.png'), pathToFileURL(file).href], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const dom = r.stdout || '';
  const version = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${executable.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  const elementCount = (dom.match(/class="canvas-element\b/g) || []).length;
  attempts.push({ executable, version, elementCount, status: r.status, error: String(r.error || ''), diagnostic: dom.match(/data-error="[^"]*"/)?.[0] });
  fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2)); fs.writeFileSync(path.join(out, 'dom-' + i + '.html'), dom);
  if (r.status === 0 && dom.includes('data-say-template="PASS"')) {
    const changes = JSON.parse(/<pre id="template-apply"[^>]*>([^<]+)<\/pre>/.exec(dom)[1].replaceAll('&quot;', '"'));
    const { buildDialogCoordinateEdits, applyTextReplacements } = require(path.join(root, 'out/ui-dialog/source-patcher'));
    const edits = buildDialogCoordinateEdits(source, fewer, changes);
    assert.equal(edits.changedElements, 1); assert.equal(edits.replacements.length, 2);
    assert.ok(templates(parse(applyTextReplacements(source, edits.replacements), { U101: '2' })).every(e => e.layoutX === 90 && e.layoutY === 100));
    console.log('preview-say-template-browser.test.js: PASS ' + executable + ' version=' + version + ' elements=' + elementCount); process.exit(0);
  }
}
throw Error(JSON.stringify(attempts));
