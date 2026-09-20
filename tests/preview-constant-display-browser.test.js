const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
const { parse } = require('./preview-inputs-integration.test');
const { applyConstantDisplayFallback } = require('./preview-constant-display.test');
const { hydrate } = require('./preview-client-atlas.test');

async function run() {
  const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
  const out = path.resolve(process.env.BOO_CONSTANT_DISPLAY_OUT || 'artifacts/ctrl-f12-constant-display/browser');
  fs.mkdirSync(out, { recursive: true });
  const source = '[@main]\n#SAY\n<Text|text=标题$(Unknown)|x=40|y=40>\n<TextAtlas|text=$(Unknown)|wil=NewopUI|pcimg=$(Index)|iwidth=14|iheight=24|x=40|y=100>\n<COUNTDOWN:$(Seconds):1:250:40:160:0>\n<按钮$(Unknown)/@next>\n[@next]\n#SAY\n下一页';
  const model = parse(source, {}, '996PC');
  applyConstantDisplayFallback(model.scenes, '996PC');
  const requests = await hydrate(model);
  const imageCountdown = parse('[@main]\n#SAY\n<&IMGCOUNTDOWN:($Seconds):1:100:3:40:100:0/@next>', {}, 'GOM');
  applyConstantDisplayFallback(imageCountdown.scenes, 'GOM'); await hydrate(imageCountdown);
  const literalText = '$(Unknown)|<TEXT:伪造:1:2>/@nope';
  const literalMenu = parse('[@main]\n#SAY\n<MenuItem|itemname=<$STR(S0)>#固定|select=<$STR(S0)>|menuid=S1|x=40|y=100>', { S0: literalText }, '996PC');
  assert.ok(!requests.some(reference => reference.imageIndex === 0), 'numeric fallback zero grants no resource request');
  const before = JSON.stringify(model.pages[0].elements.map(element => ({ raw: element.raw, parameters: element.parameters, x: element.x, y: element.y })));
  const encode = value => JSON.stringify(value).replace(/</g, '\\u003c');
  const uri = file => pathToFileURL(path.join(root, file)).href;
  let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8').replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
  const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  html = html.replace(renderer, () => `<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:message=>messages.push(message)});</script>${renderer}`);
  html = html.replace('</body>', () => `<script>
const model=${encode(model)},imageCountdown=${encode(imageCountdown)},literalMenu=${encode(literalMenu)},literalText=${encode(literalText)},before=${encode(before)};
const wait=()=>new Promise(resolve=>setTimeout(resolve,80)),check=(ok,message)=>{if(!ok)throw Error(message);};
const canvas=()=>document.getElementById('dialogCanvas'),atlas=()=>canvas().querySelector('.image-text-preview');
let revision=0;
const deliver=(value=model)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:value,previewRevision:++revision,preserveDrafts:false}}));
window.addEventListener('load',async()=>{try{
 await wait();deliver();await wait();const url=location.href,historyLength=history.length;
 check(canvas().textContent.includes('标题预览文字'),'unknown source text macro becomes visible preview text');
 check(atlas().querySelector('.image-text-value-fallback')?.textContent==='0','unknown quantity macro is visibly zero even with blocked atlas resources');
 check(!atlas().querySelector('img'),'fallback zero draws no guessed glyph');
 check(atlas().getAttribute('aria-label').includes('0')&&!atlas().getAttribute('aria-label').includes('Unknown'),'accessible atlas text is fallback');
 const countdown=()=>[...canvas().querySelectorAll('.canvas-element')].find(node=>node.dataset.elementId===model.pages[0].elements.find(element=>element.countdownPreview).id);
 check(countdown().querySelector('.element-text')?.textContent==='0','unknown countdown source is visible zero');
 let rect=atlas().getBoundingClientRect(),hit=document.elementFromPoint(rect.left+3,rect.top+rect.height/2);
 check(rect.width>0&&rect.height>0&&atlas().contains(hit),'numeric fallback is visible and hittable');
 const x=parseFloat(atlas().style.left),y=parseFloat(atlas().style.top);
 hit.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:rect.left+3,clientY:rect.top+rect.height/2}));
 window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,buttons:1,clientX:rect.left+15,clientY:rect.top+rect.height/2+8}));
 window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:rect.left+15,clientY:rect.top+rect.height/2+8}));await wait();
 check(parseFloat(atlas().style.left)===x+12&&parseFloat(atlas().style.top)===y+8,'fallback remains coordinate draggable');
 const link=[...canvas().querySelectorAll('.canvas-element')].find(node=>node.textContent.includes('按钮预览文字'));
 check(!!link,'link caption fallback is drawn');
 const label=link.querySelector('.element-text'),style=getComputedStyle(label);check(style.color==='rgb(255, 255, 0)'&&style.textDecorationLine.includes('underline'),'traditional link remains yellow underlined');
 document.getElementById('canvasDiagnosticsToggle').click();await wait();check(atlas().querySelector('.image-text-field-boundary')?.textContent.length>0,'resource diagnostic retained');
 document.getElementById('canvasDiagnosticsToggle').click();deliver();await wait();
 for(let index=0;index<10;index++)document.getElementById('zoomIn').click();await wait();
 const width=parseFloat(atlas().style.width);deliver();await wait();deliver();await wait();
 check(parseFloat(atlas().style.width)===width,'repeated model does not accumulate fallback scale');
 document.getElementById('zoomReset').click();await wait();
 check(JSON.stringify(model.pages[0].elements.map(element=>({raw:element.raw,parameters:element.parameters,x:element.x,y:element.y})))===before,'render and drag do not rewrite source model');
 check(location.href===url&&history.length===historyLength&&!messages.some(message=>['apply','save','previewNavigate'].includes(message.type)),'no automatic host write or navigation');
 deliver(imageCountdown);await wait();
 check(atlas().querySelector('.image-text-value-fallback')?.textContent==='0'&&!atlas().querySelector('img'),'image countdown uses plain zero without guessed glyph or timer');
 check(!messages.some(message=>message.type==='previewNavigate'),'unknown countdown cannot complete a local event');
 deliver(literalMenu);await wait();
 check(canvas().querySelector('.menu-selected-value')?.textContent===literalText,'protected menu source has readable literal caption');
 check(canvas().querySelectorAll('.canvas-element').length===1,'menu user text cannot create markup');
 const menuIdentity=JSON.stringify(literalMenu.pages[0].elements[0].menuPreview.items);
 const openMenu=()=>{const toggle=canvas().querySelector('.menu-toggle-hitarea'),rect=toggle.getBoundingClientRect();const hit=document.elementFromPoint(rect.right-5,rect.top+rect.height/2);check(hit===toggle||toggle.contains(hit),'menu arrow is hittable');hit.click();};
 openMenu();await wait();check(canvas().querySelectorAll('.menu-option-label')[0].textContent===literalText,'expanded menu restores literal display too');
 canvas().querySelectorAll('.menu-option')[1].click();await wait();check(canvas().querySelector('.menu-selected-value').textContent==='固定','other source identity selects normally');
 openMenu();await wait();canvas().querySelectorAll('.menu-option')[0].click();await wait();
 check(canvas().querySelector('.menu-selected-value').textContent===literalText,'literal source option can be selected again');
 check(canvas().querySelector('.menu-runtime-value').textContent.includes(literalMenu.pages[0].elements[0].menuPreview.items[0]),'local selection keeps source-owned option identity');
 check(JSON.stringify(literalMenu.pages[0].elements[0].menuPreview.items)===menuIdentity,'menu captions never overwrite source options');
 deliver();await wait();check(canvas().querySelectorAll('.canvas-element').length===4,'final screenshot restores complete four-control fixture');
 document.body.dataset.constantDisplay='PASS';
}catch(error){document.body.dataset.constantDisplay='FAIL';document.body.dataset.error=String(error.stack||error);}});
</script></body>`);
  const file = path.join(out, 'fixture.html'); fs.writeFileSync(file, html);
  const attempts = [], candidates = [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(candidate => candidate && fs.existsSync(candidate)))];
  assert.ok(candidates.length, 'Chromium required');
  for (const [index, executable] of candidates.entries()) {
    const result = spawnSync(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
      '--window-size=1440,1000', '--virtual-time-budget=3500', '--dump-dom', '--user-data-dir=' + path.join(out, 'profile-' + index),
      '--screenshot=' + path.join(out, 'preview-' + index + '.png'), pathToFileURL(file).href], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    const dom = result.stdout || '', version = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${executable.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
    attempts.push({ executable, version, status: result.status, error: String(result.error || ''), diagnostic: dom.match(/data-error="[^"]*"/)?.[0] });
    fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2)); fs.writeFileSync(path.join(out, 'dom-' + index + '.html'), dom);
    if (result.status === 0 && dom.includes('data-constant-display="PASS"')) {
      console.log('preview-constant-display-browser.test.js: PASS ' + executable + ' version=' + version + ' elements=' + (dom.match(/class="canvas-element\b/g) || []).length); return;
    }
  }
  throw Error(JSON.stringify(attempts));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
