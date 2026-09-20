const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
const { parse } = require('./preview-inputs-integration.test');
const { source } = require('./preview-progress-range.test');
const { hydrate } = require('./helpers/preview-image-hydration');
async function run() {
  const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
  const out = path.resolve(process.env.BOO_PROGRESS_RANGE_OUT || 'artifacts/preview-events-r9/progress-browser');
  fs.mkdirSync(out, { recursive: true });
  const model = parse(source);
  const inputSource = source.replace('MOV N$VALUE 25\n', '');
  const inputModel = parse(inputSource, {'N$VALUE':'60'});
  const unknownModel = parse(inputSource);
  await hydrate(inputModel, true); await hydrate(unknownModel, true);
  const requests = await hydrate(model, true);
  assert.ok(requests.some(r => r.willIndex === 1 && r.imageIndex === 630), 'production Provider requests static fill');
  assert.equal(model.pages[0].elements[0].progressPreview.localDisplayRange.ratio, .25, 'hydration retains range');
  const uri = f => pathToFileURL(path.join(root, f)).href;
  let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
    .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
  const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  html = html.replace(renderer, () => `<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);window.bridge?.(m);}});</script>${renderer}`);
  html = html.replace('</body>', () => `<script>
  const model=${JSON.stringify(model).replace(/</g, '\\u003c')},wait=()=>new Promise(r=>setTimeout(r,100));
  const check=(v,m)=>{if(!v)throw Error(m);};
  window.addEventListener('load',async()=>{try{
    await wait();const url=location.href;
    window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:1}}));await wait();
    const w=document.getElementById('dialogCanvas').querySelector('[data-element-id]');
    const f=w.querySelector('.progress-fill-image'),b=w.querySelector('.progress-background-image');
    check(f&&b&&f.complete&&b.complete&&f.naturalWidth>0&&b.naturalWidth>0,'both actual images loaded');
    check(w.dataset.progressDisplayRatio==='0.25','effective quarter ratio');
    check(getComputedStyle(f).clipPath==='inset(0px 75% 0px 0px)','quarter fill visibly clipped');
    check(w.querySelector('.progress-caption').textContent==='25/100','resolved caption');
    check(w.dataset.progressBlocked==='dynamic','runtime gate retained');
    const r=w.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
    check(r.width>0&&r.height>0&&(hit===w||w.contains(hit)),'visible and hittable');
    check(!messages.some(m=>['previewNavigate','apply','save'].includes(m.type))&&location.href===url,'no action or source writes');
    const inputModel=${JSON.stringify(inputModel).replace(/</g, '\\u003c')},unknownModel=${JSON.stringify(unknownModel).replace(/</g, '\\u003c')};
    const deliver=(model,revision)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:revision,preserveDrafts:true}}));
    deliver(unknownModel,2);await wait();
    check(!document.querySelector('[data-progress-display-ratio]'),'unknown zero does not acquire ratio');
    window.bridge=m=>{if(m.type==='previewInput'){check(m.name==='N$VALUE'&&m.value==='60','typed input payload');queueMicrotask(()=>deliver(inputModel,3));}};
    const input=[...document.querySelectorAll('[data-preview-name]')].find(n=>n.dataset.previewName==='N$VALUE');
    input.focus();input.value='60';input.dispatchEvent(new Event('change',{bubbles:true}));await wait();
    const changed=document.querySelector('[data-progress-display-ratio]');
    check(changed.dataset.progressDisplayRatio==='0.6'&&changed.dataset.progressDisplayOrigin==='preview-input','typed input drives ratio');
    check(changed.querySelector('.progress-caption').textContent==='60/100','typed input drives caption');
    check(getComputedStyle(changed.querySelector('.progress-fill-image')).clipPath==='inset(0px 40% 0px 0px)','typed input drives visible fill');
    check(document.activeElement===input,'focus preserved');
    document.body.dataset.progressRange='PASS';
  }catch(e){document.body.dataset.progressRange='FAIL';document.body.dataset.error=String(e.stack||e);}});
  </script></body>`);
  const file = path.join(out, 'fixture.html'); fs.writeFileSync(file, html);
  const attempts = [];
  const candidates = [...new Set([process.env.BOO_BROWSER_EXECUTABLE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p => p && fs.existsSync(p)))];
  assert.ok(candidates.length, 'Chromium required');
  for (const [index, executable] of candidates.entries()) {
    const result = spawnSync(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', '--window-size=1440,1000', '--virtual-time-budget=5000', '--dump-dom', `--user-data-dir=${path.join(out, 'profile-' + index)}`, `--screenshot=${path.join(out, 'preview.png')}`, pathToFileURL(file).href], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    const dom = result.stdout || '';
    attempts.push({ executable, status: result.status, error: String(result.error || ''), diagnostic: dom.match(/data-error="[^"]*"/)?.[0] });
    fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2));
    fs.writeFileSync(path.join(out, 'dom-' + index + '.html'), dom);
    if (result.status === 0 && dom.includes('data-progress-range="PASS"')) { console.log('preview-progress-range-browser.test.js: PASS ' + executable); return; }
  }
  throw Error(JSON.stringify(attempts));
}
run().catch(e => { console.error(e); process.exitCode = 1; });
