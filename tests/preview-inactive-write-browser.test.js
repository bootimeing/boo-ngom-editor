const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url'), { spawnSync } = require('node:child_process');
const { source } = require('./preview-inactive-write-inputs.test');
const { parse } = require('./preview-inputs-integration.test');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const destination = path.resolve(__dirname, '../artifacts/skipped-write-r16');
fs.mkdirSync(destination, { recursive: true });
const models = ['GOM', 'GEE'].flatMap(engine => [{}, { 'WORN(承影)': '1' }, {}].map(v => parse(source, v, engine)));
const uri = p => pathToFileURL(path.join(root, p)).href;
const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
  .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
html = html.replace(renderer, () => `<script>
const models=${JSON.stringify(models).replace(/</g, '\\u003c')};let next=0,revision=0;const messages=[];
window.deliver=i=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:models[i],previewRevision:++revision,preserveDrafts:true}}));
window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);if(['ready','previewInput','resetPreview'].includes(m.type)){const i=next++;setTimeout(()=>deliver(i),0);}}});
</script>${renderer}`);
html = html.replace('</body>', `<script>
const check=(v,m)=>{if(!v)throw Error(m)}, text=()=>document.getElementById('dialogCanvas').textContent,
field=()=>[...document.querySelectorAll('[data-preview-name]')].find(e=>e.dataset.previewName==='WORN(承影)'),
wait=async p=>{for(let i=0;i<100;i++){if(p())return;await new Promise(r=>setTimeout(r,20));}throw Error('timeout');};
addEventListener('load',async()=>{try{
for(let engine=0;engine<2;engine++){
 if(engine){next=4;deliver(3);}
 await wait(()=>field()&&text().includes('88灵玉'));
 check(document.querySelectorAll('[data-preview-name]').length===1,'business or derived inputs leaked');
 const el=field(),r=el.getBoundingClientRect();check(r.width>0&&r.height>0&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el,'missing hit target');
 el.click();await wait(()=>field().checked&&text().includes('188灵玉'));
 document.getElementById('resetPreview').click();await wait(()=>!field().checked&&text().includes('88灵玉'));
}
check(messages.filter(m=>m.type==='previewInput').every(m=>m.name==='WORN(承影)'&&m.value==='1'),'wrong preview input message');
check(!messages.some(m=>['apply','save','previewNavigate'].includes(m.type)),'unexpected write/navigation');
document.body.dataset.skippedWrite='PASS';
}catch(e){document.body.dataset.skippedWrite=e.stack;}});
</script></body>`);
const fixture = path.join(destination, 'fixture.html'); fs.writeFileSync(fixture, html);
const exe = process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const result = spawnSync(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  `--user-data-dir=${path.join(destination, 'profile-' + Date.now())}`, '--window-size=1440,1000', '--virtual-time-budget=6000', '--dump-dom', pathToFileURL(fixture).href],
{ encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
fs.writeFileSync(path.join(destination, 'dom.html'), result.stdout || '');
assert.equal(result.status, 0, result.error?.message || result.stderr);
assert.ok(result.stdout.includes('data-skipped-write="PASS"'), result.stdout.match(/data-skipped-write="[^"]*"/)?.[0] || result.stderr);
console.log('preview-inactive-write-browser.test.js: PASS ' + exe + '; real DOM/hit/checkbox/reset, precomputed model-message transport');
