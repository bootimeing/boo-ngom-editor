const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { parse } = require('./preview-inputs-integration.test');

const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const out = path.resolve(process.env.BOO_LIST_COMPOSITION_OUT || 'artifacts/listview-composition-r15');
fs.mkdirSync(out, { recursive: true });
// Use actual parser relationships and geometry, not an injected parent tree.
function fixture(origin, nested, direction = 1) {
  const source = ['[@main]', '#ACT', `OPENMERCHANTBIGDLG 5 3 0 0 ${origin ? 100 : 0} ${origin ? 60 : 0} 0`, '#SAY',
    `<ListView:~#OUTER:20:20:100:70:0:0:${direction}:0:0:0>`,
    ...(nested ? [`<ListView:#OUTER~#INNER:0:0:180:120:0:0:${direction}:0:0:0>`] : []),
    `<Layout:#${nested ? 'INNER' : 'OUTER'}~#ROW:0:0:240:140>`,
    '<TEXT:#ROW~:ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ:4:4>',
  ].join('\n');
  const model = parse(source);
  const elements = model.scenes[0].elements;
  const outer = elements.find(e => e.containerElementId === 'OUTER');
  const inner = elements.find(e => e.containerElementId === 'INNER');
  const row = elements.find(e => e.containerElementId === 'ROW');
  const text = elements.find(e => e.kind === 'text');
  assert.equal(model.scenes[0].background.offsetX, origin ? 100 : 0);
  assert.equal(model.scenes[0].background.status, 'static');
  assert.equal(row.parentElementId, (inner || outer).id);
  assert.equal(outer.containerPreview.direction, direction === 1 ? 'horizontal' : 'vertical');
  assert.equal(outer.containerPreview.interactionStatus, 'local-only');
  assert.equal(text.parentElementId, row.id);
  assert.equal(text.localLayoutX, 0, 'TEXT source x=4 has exactly one paint bias');
  return { model, ids: { outer: outer.id, inner: inner?.id, row: row.id, text: text.id } };
}
const fixtures = [fixture(true, false), fixture(false, true), fixture(true, true), fixture(true, true, 0)];
const liveSource = ['[@main]', '#SAY',
  '<ListView|id=OUTER|children={ROW}|x=20|y=20|width=30|height=50|direction=2|cantouch=1>',
  '<Layout|id=ROW|children={TEXT}|width=200|height=100>',
  '<Text|id=TEXT|text=$STM(SLIDERV_N0)|x=0|y=0>',
  '<Slider|wil=NewopUI|pcbgimg=298|pcbarimg=299|pcballimg=297|sliderid=N0|x=60|y=180|width=200|height=20|maxvalue=100000000|defvalue=1>',
].join('\n');
const liveModel = parse(liveSource, {}, '996PC');
const disabledModel = parse(liveSource.replace('cantouch=1', 'cantouch=0'), {}, '996PC');
const liveElements = liveModel.scenes[0].elements;
assert.equal(liveElements.find(e => e.containerElementId === 'OUTER').containerPreview.direction, 'horizontal');
const live = { model: liveModel, ids: Object.fromEntries(['OUTER', 'ROW', 'TEXT'].map(id =>
  [id.toLowerCase(), liveElements.find(e => e.containerElementId === id).id])) };
assert.equal(liveElements.find(e => e.id === live.ids.text).parentElementId, live.ids.row);
const uri = f => pathToFileURL(path.join(root, f)).href;
let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
  .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
const script = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html = html.replace(script, () => `<script>window.messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>messages.push(m)});</script>${script}`);
html = html.replace('</body>', () => `<script>
const fixtures=${JSON.stringify(fixtures).replace(/</g, '\\u003c')},live=${JSON.stringify(live).replace(/</g, '\\u003c')},disabledModel=${JSON.stringify(disabledModel).replace(/</g, '\\u003c')};
const wait=()=>new Promise(r=>setTimeout(r,60)),results=[];let revision=0;
const node=id=>[...document.querySelectorAll('[data-element-id]')].find(n=>n.dataset.elementId===id);
const check=(v,m)=>{if(!v)throw Error(m);};
function verify(f,label){
 const text=node(f.ids.text),tr=text.getBoundingClientRect(),outer=node(f.ids.outer).getBoundingClientRect();
 const inner=f.ids.inner?node(f.ids.inner).getBoundingClientRect():outer;
 const left=Math.max(outer.left,inner.left,tr.left),right=Math.min(outer.right,inner.right,tr.right);
 const top=Math.max(outer.top,inner.top,tr.top),bottom=Math.min(outer.bottom,inner.bottom,tr.bottom);
 const hit=(x,y)=>{const n=document.elementFromPoint(x,y);return n===text||text.contains(n);};
 if(right-left>4&&bottom-top>4) check(hit(left+3,top+3),label+' visible text must be hittable');
 if(tr.right>right+5&&bottom-top>4) check(!hit(right+3,top+3),label+' text must not escape any ancestor viewport');
 const row=node(f.ids.row),rr=row.getBoundingClientRect();
 const scale=Number(document.getElementById('zoomValue').textContent.replace('%',''))/100;
 const expectedRight=Math.max(0,rr.right-Math.min(outer.right,inner.right))/scale;
 check(Math.abs(Number(row.dataset.listClipRight)-expectedRight)<1,label+' right clip uses all ancestors in canvas coordinates');
 results.push({label,clip:text.dataset.listClip,rowClip:row.style.clipPath,textClip:text.style.clipPath});
}
window.addEventListener('load',async()=>{try{
 await wait();const url=location.href;
 for(const [i,f]of fixtures.entries()){
  window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:f.model,previewRevision:++revision,preserveDrafts:false}}));await wait();
  verify(f,'fixture '+i);
  document.getElementById('zoomOut').click();await wait();verify(f,'zoom '+i);
  document.getElementById('zoomReset').click();await wait();verify(f,'reset '+i);
  const tr=node(f.ids.text).getBoundingClientRect();
  const hit=document.elementFromPoint(tr.left+3,tr.top+3),before=node(f.ids.row).getBoundingClientRect();
  check(hit===node(f.ids.text)||node(f.ids.text).contains(hit),'wheel starts on actual visible text');
  hit.dispatchEvent(new WheelEvent('wheel',{deltaY:5,bubbles:true,cancelable:true}));await wait();
  const after=node(f.ids.row).getBoundingClientRect();
  check(Math.abs((i===3?before.top-after.top:before.left-after.left)-5)<.1,'wheel over child scrolls nearest list '+i);
  verify(f,'child wheel '+i);
  if(f.ids.inner){node(f.ids.outer).dispatchEvent(new WheelEvent('wheel',{deltaY:15,bubbles:true,cancelable:true}));await wait();verify(f,'outer scroll '+i);
   node(f.ids.inner).dispatchEvent(new WheelEvent('wheel',{deltaY:10,bubbles:true,cancelable:true}));await wait();verify(f,'inner scroll '+i);
   node(f.ids.inner).dispatchEvent(new WheelEvent('wheel',{deltaY:1000,bubbles:true,cancelable:true}));await wait();
   const bound=node(f.ids.outer).getBoundingClientRect(),innerBefore=node(f.ids.inner).getBoundingClientRect();
   const rowHit=document.elementFromPoint(bound.left+5,bound.top+30);
   check(rowHit===node(f.ids.row)||node(f.ids.row).contains(rowHit),'at-bound wheel targets actual row');
   rowHit.dispatchEvent(new WheelEvent('wheel',{deltaY:5,bubbles:true,cancelable:true}));await wait();
   const innerAfter=node(f.ids.inner).getBoundingClientRect();
   check(Math.abs((i===3?innerBefore.top-innerAfter.top:innerBefore.left-innerAfter.left)-5)<.1,'at-bound child wheel reaches outer list');
  }
 }
 window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:live.model,previewRevision:++revision,preserveDrafts:false}}));await wait();
 verify(live,'live initial');
 const slider=document.querySelector('.slider-hitarea');check(slider,'slider control exists');
 slider.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));await wait();
 check(node(live.ids.text).textContent.includes('100000000'),'live slider text updated');verify(live,'live expanded');
 const beforeCtrl=node(live.ids.row).getBoundingClientRect().left;
 node(live.ids.text).dispatchEvent(new WheelEvent('wheel',{deltaY:10,ctrlKey:true,bubbles:true,cancelable:true}));await wait();
 check(node(live.ids.row).getBoundingClientRect().left===beforeCtrl,'Ctrl-wheel is not list scroll');
 node(live.ids.text).dispatchEvent(new WheelEvent('wheel',{deltaY:1,deltaMode:1,bubbles:true,cancelable:true}));await wait();
 check(Math.abs(beforeCtrl-node(live.ids.row).getBoundingClientRect().left-16)<.1,'line-mode wheel normalized');
 window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:disabledModel,previewRevision:++revision,preserveDrafts:false}}));await wait();
 const disabledBefore=node(live.ids.row).getBoundingClientRect().left;
 node(live.ids.text).dispatchEvent(new WheelEvent('wheel',{deltaY:10,bubbles:true,cancelable:true}));await wait();
 check(node(live.ids.row).getBoundingClientRect().left===disabledBefore,'cantouch=0 blocks child wheel');
 check(location.href===url&&!messages.some(m=>['apply','save','previewNavigate'].includes(m.type)),'no source writes or navigation');
 document.body.dataset.listComposition='PASS';
}catch(e){document.body.dataset.listComposition='FAIL';document.body.dataset.error=String(e.stack||e);}
document.body.dataset.results=JSON.stringify(results);});
</script></body>`);
const file = path.join(out, 'fixture.html'); fs.writeFileSync(file, html);
const candidates = [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p => p && fs.existsSync(p)))];
assert.ok(candidates.length, 'Chromium required');
const attempts = [];
for (const [i, exe] of candidates.entries()) {
  const r = spawnSync(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
    '--window-size=1440,1000', '--virtual-time-budget=6500', '--dump-dom', '--user-data-dir=' + path.join(out, 'profile-' + i),
    pathToFileURL(file).href], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  const dom = r.stdout || ''; fs.writeFileSync(path.join(out, 'dom-' + i + '.html'), dom);
  attempts.push({ exe, status: r.status, pass: dom.includes('data-list-composition="PASS"'), error: dom.match(/data-error="[^"]*"/)?.[0] });
}
fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2));
assert.ok(attempts.every(a => a.status === 0 && a.pass), JSON.stringify(attempts));
console.log('listview-composition-browser.test.js: PASS parser + origin + nested clipping + horizontal/vertical scroll', attempts.map(a => a.exe));
