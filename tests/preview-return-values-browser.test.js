const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
const { parse } = require('./preview-inputs-integration.test');
const { source } = require('./preview-return-values-provider.test');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const out = path.resolve(process.env.BOO_RETURN_VALUES_OUT || 'artifacts/ctrl-f12-live-r23/browser');
fs.mkdirSync(out, { recursive: true });
const engine = process.env.BOO_RETURN_VALUES_ENGINE || 'GOM';
assert.ok(['GOM', 'GEE'].includes(engine), 'RETURN browser fixture requires an evidenced engine');
const initial = parse(source, {}, engine), changed = parse(source, { 'N$base': '40', 'S$title': '本地返回文字' }, engine);
const encode = value => JSON.stringify(value).replace(/</g, '\\u003c');
const uri = file => pathToFileURL(path.join(root, file)).href;
let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
  .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html = html.replace(renderer, () => `<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
html = html.replace('</body>', () => `<script>
const initial=${encode(initial)},changed=${encode(changed)};
const wait=()=>new Promise(resolve=>setTimeout(resolve,80)),check=(value,message)=>{if(!value)throw Error(message);};
const canvas=()=>document.getElementById('dialogCanvas');let revision=0;
const deliver=(model,preserveDrafts=true)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:++revision,preserveDrafts,navigatePageId:model.pages.find(p=>p.sourceLabel==='@main').id}}));
const wrapper=()=>[...canvas().querySelectorAll('[data-element-id]')].find(node=>node.textContent.includes('数量='));
window.addEventListener('load',async()=>{try{
 await wait();deliver(initial,false);await wait();const url=location.href,historyLength=history.length;
 check(canvas().textContent.includes('数量=2')&&canvas().textContent.includes('标题=预览文字'),'returned defaults must actually reach canvas');
 let node=wrapper(),box=node.getBoundingClientRect(),hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
 check(box.width>0&&box.height>0&&getComputedStyle(node).visibility!=='hidden'&&node.contains(hit),'returned text is visible and hittable');
 const startX=parseFloat(node.style.left),startY=parseFloat(node.style.top);
 hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:box.left+box.width/2,clientY:box.top+box.height/2}));
 window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:box.left+box.width/2+12,clientY:box.top+box.height/2+8}));
 window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:box.left+box.width/2+12,clientY:box.top+box.height/2+8}));await wait();
 check(parseFloat(wrapper().style.left)===startX+12&&parseFloat(wrapper().style.top)===startY+8,'returned text retains coordinate drag');
 window.bridge=m=>{if(m.type==='previewInput'){check(m.name==='N$base'&&m.value==='40','typed call input');queueMicrotask(()=>deliver(changed));}else if(m.type==='resetPreview')queueMicrotask(()=>deliver(initial));};
 const input=[...document.querySelectorAll('[data-preview-name]')].find(n=>n.dataset.previewName==='N$base');
 check(input,'caller input discovered');input.focus();input.value='40';input.dispatchEvent(new Event('change',{bubbles:true}));await wait();
 check(document.activeElement===input,'caller input focus retained');
 check(canvas().textContent.includes('数量=42')&&canvas().textContent.includes('标题=本地返回文字'),'typed values propagate through RETURN');
 check(parseFloat(wrapper().style.left)===startX+12,'input update preserves coordinate draft');
 document.getElementById('undoButton').click();await wait();check(parseFloat(wrapper().style.left)===startX,'local draft undo');
 document.getElementById('redoButton').click();await wait();check(parseFloat(wrapper().style.left)===startX+12,'local draft redo');
 document.getElementById('applyButton').click();await wait();
 const apply=messages.filter(m=>m.type==='apply');check(apply.length===1&&apply[0].changes.length===1,'one coordinate write requested');
 const result=document.createElement('pre');result.id='return-apply';result.hidden=true;result.textContent=JSON.stringify(apply[0].changes);document.body.append(result);
 document.getElementById('resetPreview').click();await wait();check(canvas().textContent.includes('数量=2'),'reset recomputes return');
 check(parseFloat(wrapper().style.left)===startX+12,'reset keeps coordinate draft');
 check(location.href===url&&history.length===historyLength&&!messages.some(m=>['save','locate','previewNavigate'].includes(m.type)),'no server or navigation effect');
 deliver(changed);await wait();document.body.dataset.returnValues='PASS';
}catch(error){document.body.dataset.returnValues='FAIL';document.body.dataset.error=String(error.stack||error);}});
</script></body>`);
const file = path.join(out, 'fixture.html'); fs.writeFileSync(file, html);
const candidates = [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(file => file && fs.existsSync(file)))];
assert.ok(candidates.length, 'Chromium required'); const attempts = [];
for (const [index, executable] of candidates.entries()) {
  const result = spawnSync(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
    '--window-size=1440,1000', '--virtual-time-budget=5000', '--dump-dom', '--user-data-dir=' + path.join(out, 'profile-' + index),
    '--screenshot=' + path.join(out, 'preview.png'), pathToFileURL(file).href], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const dom = result.stdout || '';
  const version = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${executable.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  attempts.push({ executable, version, status: result.status, error: String(result.error || ''), diagnostic: dom.match(/data-error="[^"]*"/)?.[0] });
  fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2)); fs.writeFileSync(path.join(out, 'dom-' + index + '.html'), dom);
  if (result.status === 0 && dom.includes('data-return-values="PASS"')) {
    const changes = JSON.parse(/<pre id="return-apply"[^>]*>([^<]+)<\/pre>/.exec(dom)[1].replaceAll('&quot;', '"'));
    const { buildDialogCoordinateEdits, applyTextReplacements } = require(path.join(root, 'out/ui-dialog/source-patcher'));
    const edits = buildDialogCoordinateEdits(source, changed, changes);
    const updated = applyTextReplacements(source, edits.replacements);
    assert.equal(updated, source.replace(':40:40>', ':52:48>'), 'only coordinate literals change; caller and RETURN stay intact');
    const reparsed = parse(updated, { 'N$base': '40', 'S$title': '本地返回文字' }, engine);
    const element = reparsed.pages[0].elements.find(element => element.text === '数量=42');
    assert.equal(element.x.displayValue, 48); assert.equal(element.y.displayValue, 44);
    fs.writeFileSync(path.join(out, 'apply-verification.json'), JSON.stringify({ changes, updated, x: element.x, y: element.y }, null, 2));
    console.log('preview-return-values-browser.test.js: PASS engine=' + engine + ' ' + executable + ' version=' + version + ' elements=' + (dom.match(/class="canvas-element\b/g) || []).length); process.exit(0);
  }
}
throw Error(JSON.stringify(attempts));
