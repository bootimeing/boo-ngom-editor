const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url'), { spawnSync } = require('node:child_process');
const { cases } = require('./preview-indirect-write-inputs.test');
const { parse } = require('./preview-inputs-integration.test');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const destination = path.resolve(__dirname, '../artifacts/indirect-write-r20');
fs.mkdirSync(destination, { recursive: true });
const models = cases.flatMap(test => [{}, { '[401]': '1' }, {}].map(values => parse(test.source, values, test.engine)));
const uri = file => pathToFileURL(path.join(root, file)).href;
const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
  .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
html = html.replace(renderer, () => `<script>
const models=${JSON.stringify(models).replace(/</g, '\\u003c')};let next=0,revision=0;const messages=[];
window.deliver=i=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:models[i],previewRevision:++revision,preserveDrafts:true}}));
window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);if(['ready','previewInput','resetPreview'].includes(m.type)){const i=next++;setTimeout(()=>deliver(i),0);}}});
</script>${renderer}`);
html = html.replace('</body>', `<script>
const check=(value,message)=>{if(!value)throw Error(message)},text=()=>document.getElementById('dialogCanvas').textContent,
field=()=>[...document.querySelectorAll('[data-preview-name]')].find(e=>e.dataset.previewName==='[401]'),
wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('timeout');};
addEventListener('load',async()=>{try{
for(let scenario=0;scenario<${cases.length};scenario++){
 if(scenario){next=scenario*3+1;deliver(scenario*3);}
 await wait(()=>field()&&!field().checked&&text().includes('88灵玉'));
 check(document.querySelectorAll('[data-preview-name]').length===1,'business/derived inputs leaked');
 const el=field(),r=el.getBoundingClientRect();check(r.width>0&&r.height>0&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el,'toggle is not hittable');
 el.click();await wait(()=>field().checked&&text().includes('188灵玉'));
 document.getElementById('resetPreview').click();await wait(()=>!field().checked&&text().includes('88灵玉'));
}
check(messages.filter(m=>m.type==='previewInput').length===${cases.length},'missing toggle events');
check(messages.filter(m=>m.type==='previewInput').every(m=>m.name==='[401]'&&m.value==='1'),'wrong input payload');
check(!messages.some(m=>['apply','save','previewNavigate'].includes(m.type)),'unexpected write/navigation');
document.body.dataset.indirectWrite='PASS';
}catch(error){document.body.dataset.indirectWrite=error.stack;}});
</script></body>`);
const fixture = path.join(destination, 'fixture.html'); fs.writeFileSync(fixture, html);
const exe = process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const result = spawnSync(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
  `--user-data-dir=${path.join(destination, 'profile-' + Date.now())}`, '--window-size=1440,1000', '--virtual-time-budget=12000', '--dump-dom', pathToFileURL(fixture).href],
{ encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
fs.writeFileSync(path.join(destination, 'dom.html'), result.stdout || '');
assert.equal(result.status, 0, result.error?.message || result.stderr);
assert.ok(result.stdout.includes('data-indirect-write="PASS"'), result.stdout.match(/data-indirect-write="[^"]*"/)?.[0] || result.stderr);
console.log('preview-indirect-write-browser.test.js: PASS ' + exe + '; real DOM/hit/checkbox/reset; precomputed model transport, not native VS Code input');
