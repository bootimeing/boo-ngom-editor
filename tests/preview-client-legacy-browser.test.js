const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
const { parse } = require('./preview-inputs-integration.test');
const { legacySource, keyedSource, pureSource, active } = require('./preview-client-legacy.test');

async function run() {
  const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
  const out = path.resolve(process.env.BOO_CLIENT_LEGACY_OUT || 'artifacts/ctrl-f12-r25-stm/browser');
  fs.mkdirSync(out, { recursive: true });
  const initial = parse(legacySource, {}, '996PC'), number = parse(legacySource, { 'STM(HP)': '37' }, '996PC');
  const attack = '<TEXT:伪造:1:2>/@$STM(HP)';
  const text = parse(legacySource, { 'STM(HP)': '37', 'STM(USERNAME)': attack }, '996PC');
  const empty = parse(legacySource, { 'STM(HP)': '37', 'STM(USERNAME)': '' }, '996PC');
  const long = parse(legacySource, { 'STM(USERNAME)': '长文字'.repeat(45) }, '996PC');
  const keyed = parse(keyedSource, {}, '996PC'), keyedSet = parse(keyedSource, { 'STM(ITEMCOUNT_屠龙·传说)': '12' }, '996PC');
  const pure = parse(pureSource, {}, '996PC');
  const pureLiteral = parse(legacySource, { 'STM(USERNAME)': '<$STM(HP)/@next>' }, '996PC');
  const encode = value => JSON.stringify(value).replace(/</g, '\\u003c'), uri = file => pathToFileURL(path.join(root, file)).href;
  let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
    .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
  const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  html = html.replace(renderer, () => `<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:message=>{messages.push(message);window.bridge?.(message);}});</script>${renderer}`);
  html = html.replace('</body>', () => `<script>
const initial=${encode(initial)},number=${encode(number)},text=${encode(text)},empty=${encode(empty)},long=${encode(long)},keyed=${encode(keyed)},keyedSet=${encode(keyedSet)},attack=${encode(attack)};
const pure=${encode(pure)},pureLiteral=${encode(pureLiteral)};
const ids=${encode(active(initial).map(element => element.id))};let revision=0;
const wait=()=>new Promise(resolve=>setTimeout(resolve,60)),check=(value,message)=>{if(!value)throw Error(message);};
const canvas=()=>document.getElementById('dialogCanvas'),node=id=>[...canvas().querySelectorAll('[data-element-id]')].find(element=>element.dataset.elementId===id),label=index=>node(ids[index])?.querySelector('.element-text');
const deliver=(model,preserve=false)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:++revision,preserveDrafts:preserve}}));
const input=name=>[...document.querySelectorAll('[data-preview-name]')].find(element=>element.dataset.previewName===name);
window.addEventListener('load',async()=>{try{
 if(${process.env.BOO_CLIENT_LEGACY_FOCUS === 'pure'}){await wait();deliver(pure);await wait();check([...canvas().querySelectorAll('.element-text')].map(element=>element.textContent).join('|')==='0|0','pure STM link and color captions paint');document.body.dataset.clientLegacy='PASS';return;}
 if(${process.env.BOO_CLIENT_LEGACY_FOCUS === 'names'}){await wait();deliver(keyed);await wait();check([...canvas().querySelectorAll('.element-text')].map(element=>element.textContent).join('|')==='1=0|2=0|3=0|4=0|5=0','all five punctuation name quantities paint');document.body.dataset.clientLegacy='PASS';return;}
 await wait();deliver(initial);await wait();const url=location.href,historyLength=history.length;
 check(label(0)?.textContent==='SAY数值=0','plain SAY paints the STM quantity default');
 check(label(1)?.textContent==='SAY文字=预览文字','plain SAY paints the STM text default');
 check(label(2)?.textContent==='链接数值=0'&&label(3)?.textContent==='坐标数值=0','link and positional TEXT paint resolved defaults');
 check(getComputedStyle(label(2)).color==='rgb(255, 255, 0)'&&getComputedStyle(label(2)).textDecorationLine.includes('underline'),'traditional link stays yellow and underlined');
 check(getComputedStyle(label(5).querySelector('.styled-text-line > span')).color==='rgb(0, 255, 0)','ordinary colored SAY retains its source color');
 for(const id of ids){const element=node(id),box=element.getBoundingClientRect();check(box.width>0&&box.height>0&&element.contains(document.elementFromPoint(box.left+4,box.top+box.height/2)),'all actual display nodes are visible and hittable');}
 const positioned=node(ids[3]);check(parseFloat(positioned.style.left)===96&&parseFloat(positioned.style.top)===126,'traditional TEXT paint bias applies once');
 let box=positioned.getBoundingClientRect(),hit=document.elementFromPoint(box.left+4,box.top+box.height/2);
 hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:box.left+4,clientY:box.top+box.height/2}));
 window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:box.left+16,clientY:box.top+box.height/2+8}));
 window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:box.left+16,clientY:box.top+box.height/2+8}));await wait();
 check(parseFloat(node(ids[3]).style.left)===108&&parseFloat(node(ids[3]).style.top)===134,'positional TEXT still drags normally');
 window.bridge=message=>{if(message.type==='previewInput')queueMicrotask(()=>deliver(message.name==='STM(HP)'?number:message.value===''?empty:text,true));};
 let field=input('STM(HP)');check(field,'one numeric input is discoverable');field.focus();field.value='37';field.dispatchEvent(new Event('change',{bubbles:true}));await wait();
 check(document.activeElement===field&&label(0).textContent==='SAY数值=37'&&label(2).textContent==='链接数值=37'&&label(3).textContent==='坐标数值=37','one input updates all three surfaces and retains focus');
 check(parseFloat(node(ids[3]).style.left)===108,'typed input preserves coordinate draft');
 field=input('STM(USERNAME)');field.focus();field.value=attack;field.dispatchEvent(new Event('change',{bubbles:true}));await wait();
 check(label(1).textContent==='SAY文字='+attack&&label(4).textContent==='坐标文字='+attack&&canvas().querySelectorAll('[data-element-id]').length===6,'user markup and STM stay literal on all surfaces');
 field.value='';field.dispatchEvent(new Event('change',{bubbles:true}));await wait();check(label(1).textContent==='SAY文字='&&field.value==='','explicit empty text remains empty');
 deliver(pureLiteral);await wait();check(label(1).textContent==='SAY文字=<$STM(HP)/@next>'&&canvas().querySelectorAll('[data-element-id]').length===6,'a user literal pure-STM link is not reinterpreted');
 deliver(long);await wait();for(let index=0;index<10;index++)document.getElementById('zoomIn').click();await wait();
 const longLabel=label(1),longNode=node(ids[1]);box=longLabel.getBoundingClientRect();check(longNode.getBoundingClientRect().width>=box.width-2,'long flow text gets a complete hit area at 200 percent');
 check(parseFloat(canvas().style.width)>=parseFloat(longNode.style.left)+parseFloat(longNode.style.width),'long flow text expands the clipping canvas');
 const width=parseFloat(longNode.style.width);deliver(long,true);await wait();deliver(long,true);await wait();check(parseFloat(node(ids[1]).style.width)===width,'repeated rendering does not accumulate 200 percent scale');
 document.getElementById('zoomReset').click();deliver(initial);await wait();check(label(0).textContent==='SAY数值=0'&&parseFloat(node(ids[3]).style.left)===96,'reset restores display and source geometry');
 deliver(keyed);await wait();check([...canvas().querySelectorAll('.element-text')].map(element=>element.textContent).join('|')==='1=0|2=0|3=0|4=0|5=0','all five punctuation name quantities paint');
 window.bridge=message=>{if(message.type==='previewInput'){check(message.name==='STM(ITEMCOUNT_屠龙·传说)','punctuation input identity is preserved');queueMicrotask(()=>deliver(keyedSet,true));}};
 field=input('STM(ITEMCOUNT_屠龙·传说)');field.focus();field.value='12';field.dispatchEvent(new Event('change',{bubbles:true}));await wait();
 check(document.activeElement===field&&canvas().textContent.includes('2=12'),'punctuation quantity updates and retains focus');
 deliver(pure);await wait();check([...canvas().querySelectorAll('.element-text')].map(element=>element.textContent).join('|')==='0|0','pure STM link and color captions paint');
 check(location.href===url&&history.length===historyLength&&!messages.some(message=>['apply','save','previewNavigate','previewControlChange','previewControlSubmit'].includes(message.type)),'display changes create no host write or navigation effects');
 deliver(number);await wait();check(label(0).textContent==='SAY数值=37','final screenshot shows the populated numeric value');document.body.dataset.clientLegacy='PASS';
}catch(error){document.body.dataset.clientLegacy='FAIL';document.body.dataset.error=String(error.stack||error);}});
</script></body>`);
  const file = path.join(out, 'fixture.html'); fs.writeFileSync(file, html);
  const candidates = [...new Set([process.env.BOO_BROWSER_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(candidate => candidate && fs.existsSync(candidate)))];
  assert.ok(candidates.length, 'Chromium required'); const attempts = [];
  for (const [index, executable] of candidates.entries()) {
    const result = spawnSync(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', '--window-size=1440,1000', '--virtual-time-budget=5000', '--dump-dom', '--user-data-dir=' + path.join(out, 'profile-' + index), '--screenshot=' + path.join(out, 'preview-' + index + '.png'), pathToFileURL(file).href], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    const dom = result.stdout || '', version = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${executable.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
    attempts.push({ executable, version, status: result.status, error: String(result.error || ''), diagnostic: dom.match(/data-error="[^"]*"/)?.[0], pass: result.status === 0 && dom.includes('data-client-legacy="PASS"') });
    fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2)); fs.writeFileSync(path.join(out, 'dom-' + index + '.html'), dom);
    if (attempts.at(-1).pass) { console.log('preview-client-legacy-browser.test.js: PASS ' + executable + ' version=' + version + ' elements=' + (dom.match(/class="canvas-element\b/g) || []).length); return; }
  }
  throw Error(JSON.stringify(attempts));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
