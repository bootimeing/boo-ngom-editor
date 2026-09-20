const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
const { parse } = require('./preview-inputs-integration.test');
const { source, hydrate } = require('./preview-client-atlas.test');

async function run() {
  const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
  const out = path.resolve(process.env.BOO_CLIENT_ATLAS_OUT || 'artifacts/ctrl-f12-stm-atlas/browser');
  fs.mkdirSync(out, { recursive: true });
  const initial = parse(source, {}, '996PC'), changed = parse(source, { 'STM(ITEMCOUNT_布衣(男))': '12' }, '996PC');
  const override = parse(source, { 'STM(SLIDERV_N0)': '407' }, '996PC');
  const decimal = parse(source, { 'STM(SLIDERV_N0)': '-1.25' }, '996PC');
  const textSource = source.replace('$STM(SLIDERV_N0)', '$STM(USERNAME)');
  const literal = parse(textSource, { 'STM(USERNAME)': '<Img|pcimg=2522>/$STM(HP)' }, '996PC');
  const empty = parse(textSource, { 'STM(USERNAME)': '' }, '996PC');
  for (const model of [initial, changed, override, decimal, literal, empty]) await hydrate(model);
  const encode = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const uri = file => pathToFileURL(path.join(root, file)).href;
  let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
    .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
  const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  html = html.replace(renderer, () => `<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:message=>{messages.push(message);window.bridge?.(message);}});</script>${renderer}`);
  html = html.replace('</body>', () => `<script>
const initial=${encode(initial)},changed=${encode(changed)},override=${encode(override)},decimal=${encode(decimal)},literal=${encode(literal)},empty=${encode(empty)};
const wait=()=>new Promise(resolve=>setTimeout(resolve,80)),check=(value,message)=>{if(!value)throw Error(message);};
const canvas=()=>document.getElementById('dialogCanvas'),atlas=()=>canvas().querySelector('[data-image-text-variant="newui-atlas"]');
const digits=()=>[...atlas().querySelectorAll('.image-text-atlas-cell')].map(node=>node.dataset.character).join('');let revision=0;
const deliver=(model,preserve=false)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:++revision,preserveDrafts:preserve}}));
window.addEventListener('load',async()=>{try{
 await wait();deliver(initial);await wait();const url=location.href,historyLength=history.length;
 check(digits()==='25','STM digits are actually cropped from the loaded atlas');
 check(atlas().querySelector('.image-text-field-boundary')?.textContent.includes('客户端显示值'),'atlas diagnostics explain its active client display channel');
 check([...atlas().querySelectorAll('img')].every(node=>node.complete&&node.naturalWidth===140),'atlas pixels loaded');
 check(canvas().textContent.includes('衣服=0'),'paired item name default drawn');
 let box=atlas().getBoundingClientRect(),hit=document.elementFromPoint(box.left+4,box.top+box.height/2);
 check(box.width>0&&box.height>0&&atlas().contains(hit),'atlas visible and hittable');
 const x=parseFloat(atlas().style.left),y=parseFloat(atlas().style.top);
 hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:box.left+4,clientY:box.top+box.height/2}));
 window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:box.left+16,clientY:box.top+box.height/2+8}));
 window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:box.left+16,clientY:box.top+box.height/2+8}));await wait();
 check(parseFloat(atlas().style.left)===x+12&&parseFloat(atlas().style.top)===y+8,'atlas remains draggable');
 let slider=canvas().querySelector('.slider-hitarea'),sr=slider.getBoundingClientRect();
 slider.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:sr.x+sr.width*.25,clientY:sr.y+sr.height/2}));
 window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:sr.x+sr.width*.75,clientY:sr.y+sr.height/2}));
 check(digits()==='750','atlas changes before slider release');
 window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:sr.x+sr.width*.75,clientY:sr.y+sr.height/2}));
 slider.focus();slider.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
 check(digits()==='1000','keyboard updates atlas digits');
 box=atlas().getBoundingClientRect();check(box.width>=56,'live four digit hit width grows');
 check(atlas().getAttribute('aria-label').includes('1000'),'accessible display follows live value');
 window.bridge=message=>{if(message.type==='previewInput'){check(message.name==='STM(ITEMCOUNT_布衣(男))'&&message.value==='12','paired item input identity');queueMicrotask(()=>deliver(changed,true));}};
 const input=[...document.querySelectorAll('[data-preview-name]')].find(node=>node.dataset.previewName==='STM(ITEMCOUNT_布衣(男))');
 input.focus();input.value='12';input.dispatchEvent(new Event('change',{bubbles:true}));await wait();
 check(document.activeElement===input,'typed input focus survives');check(canvas().textContent.includes('衣服=12'),'paired item input changes display');
 check(digits()==='1000','unrelated input retains live slider atlas');
 check(parseFloat(atlas().style.left)===x+12,'typed input preserves coordinate draft');
 deliver(override);await wait();slider=canvas().querySelector('.slider-hitarea');slider.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));check(digits()==='407','explicit client atlas input overrides slider');
 deliver(decimal);await wait();check(atlas().querySelector('.image-text-value-fallback')?.textContent==='-1.25','non-digit input is visible plain text');check(!atlas().querySelector('img'),'non-digit input does not invent atlas cells');
 deliver(literal);await wait();check(atlas().querySelector('.image-text-value-fallback')?.textContent==='<Img|pcimg=2522>/$STM(HP)','client markup-like input stays literal');check(!atlas().querySelector('img')&&canvas().querySelectorAll('[data-element-id]').length===3,'client text creates no image or element');
 deliver(empty);await wait();check(atlas().querySelector('.image-text-value-fallback')?.textContent==='','empty client input is not coerced into zero');check(!atlas().querySelector('img'),'empty client input creates no image');
 deliver(initial);await wait();check(digits()==='25','reset restores automatic atlas');
 document.getElementById('canvasDiagnosticsToggle').click();slider=canvas().querySelector('.slider-hitarea');slider.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
 check(parseFloat(atlas().style.width)===56&&parseFloat(atlas().style.height)===24,'diagnostic text does not enlarge atlas hit area');
 document.getElementById('canvasDiagnosticsToggle').click();deliver(initial);await wait();
 for(let index=0;index<10;index++)document.getElementById('zoomIn').click();await wait();
 check(document.getElementById('zoomValue').textContent==='200%','zoom reaches 200 percent');
 slider=canvas().querySelector('.slider-hitarea');slider.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));
 box=atlas().getBoundingClientRect();check(digits()==='1000'&&Math.abs(box.width-112)<3,'200 percent live width scales once');
 hit=document.elementFromPoint(box.left+box.width-4,box.top+box.height/2);check(atlas().contains(hit),'final digit stays hittable at 200 percent');
 const zoomWidth=parseFloat(atlas().style.width);deliver(initial,true);await wait();deliver(initial,true);await wait();
 check(digits()==='1000'&&parseFloat(atlas().style.width)===zoomWidth,'repeated model delivery does not accumulate atlas scale');
 document.getElementById('zoomReset').click();await wait();box=atlas().getBoundingClientRect();check(Math.abs(box.width-56)<3,'zoom reset retains unscaled four-digit size');
 deliver(initial);await wait();check(digits()==='25'&&parseFloat(atlas().style.width)===28,'model reset restores original atlas geometry');
 check(location.href===url&&history.length===historyLength&&!messages.some(message=>['apply','save','previewNavigate'].includes(message.type)),'display and draft gestures have no host write/navigation effects');
 document.body.dataset.clientAtlas='PASS';
}catch(error){document.body.dataset.clientAtlas='FAIL';document.body.dataset.error=String(error.stack||error);}});
</script></body>`);
  const file = path.join(out, 'fixture.html'); fs.writeFileSync(file, html);
  const attempts = [], candidates = [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(candidate => candidate && fs.existsSync(candidate)))];
  assert.ok(candidates.length, 'Chromium required');
  for (const [index, executable] of candidates.entries()) {
    const result = spawnSync(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
      '--window-size=1440,1000', '--virtual-time-budget=4000', '--dump-dom', '--user-data-dir=' + path.join(out, 'profile-' + index),
      '--screenshot=' + path.join(out, 'preview.png'), pathToFileURL(file).href], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    const dom = result.stdout || '', version = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${executable.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
    attempts.push({ executable, version, status: result.status, error: String(result.error || ''), diagnostic: dom.match(/data-error="[^"]*"/)?.[0] });
    fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2)); fs.writeFileSync(path.join(out, 'dom-' + index + '.html'), dom);
    if (result.status === 0 && dom.includes('data-client-atlas="PASS"')) {
      console.log('preview-client-atlas-browser.test.js: PASS ' + executable + ' version=' + version + ' elements=' + (dom.match(/class="canvas-element\b/g) || []).length); return;
    }
  }
  throw Error(JSON.stringify(attempts));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
