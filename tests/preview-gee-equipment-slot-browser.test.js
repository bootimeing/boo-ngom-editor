const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { fixture, partSource } = require('./preview-gee-inputs.test');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));

async function main() {
  const f = await fixture();
  try {
    const models = [
      f.model({}, partSource),
      f.model({ 'WORN([NECKLACE])': '1' }, partSource),
      f.model({ 'WORN([NECKLACE])': '1', 'WORN([RING])': '1' }, partSource),
      f.model({ 'WORN([NECKLACE])': '1', 'WORN([RING])': '1', 'HERO(PRESENT)': '1' }, partSource),
      f.model({ 'WORN([NECKLACE])': '1', 'WORN([RING])': '1', 'HERO(PRESENT)': '1', 'H.WORN([HELMET])': '1' }, partSource),
    ];
    const uri = p => pathToFileURL(path.join(root, p)).href;
    let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
    const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
    html = html.replace(renderer, `<script>const models=${JSON.stringify(models).replace(/</g, '\\u003c')};let next=0,revision=0;const messages=[];
      window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);if(['ready','previewInput'].includes(m.type)){const index=next++;setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:models[index],previewRevision:++revision,preserveDrafts:true}})),0);}}});</script>${renderer}`);
    html = html.replace('</body>', `<script>
      const check=(value,message)=>{if(!value)throw Error(message)},field=name=>[...document.querySelectorAll('[data-preview-name]')].find(e=>e.dataset.previewName===name),text=()=>document.getElementById('dialogCanvas').textContent,
      wait=async predicate=>{for(let i=0;i<80;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('DOM update timeout')};
      addEventListener('load',async()=>{try{
        await wait(()=>field('WORN([NECKLACE])'));
        check(field('WORN([NECKLACE])').type==='checkbox'&&field('WORN([RING])').type==='checkbox'&&field('H.WORN([HELMET])').type==='checkbox','slot selector inputs missing');
        check(field('HERO(PRESENT)')&&document.querySelectorAll('[data-preview-name]').length===4,'hero slot dependency missing');
        const necklace=field('WORN([NECKLACE])'),box=necklace.getBoundingClientRect();
        check(box.width>0&&box.height>0&&document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===necklace,'slot selector not hittable');
        necklace.click();await wait(()=>text().includes('项链部位')&&!text().includes('戒指部位'));
        field('WORN([RING])').click();await wait(()=>text().includes('戒指部位'));
        check(necklace.checked&&field('WORN([RING])').checked,'paired/unique slot flags did not remain independently selectable');
        field('HERO(PRESENT)').click();await wait(()=>field('H.WORN([HELMET])').checked===false);
        field('H.WORN([HELMET])').click();await wait(()=>text().includes('英雄头盔'));
        check(!messages.some(m=>['apply','save'].includes(m.type)),'slot selector requested source write');
        document.body.dataset.geeSlotTest='PASS';
      }catch(error){document.body.dataset.geeSlotTest=error.stack+'; messages='+JSON.stringify(messages)+'; canvas='+text();}});</script></body>`);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-gee-slot-browser-'));
    try {
      const page = path.join(temp, 'browser.html'); fs.writeFileSync(page, html);
      const executable = process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
      const result = spawnSync(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
        `--user-data-dir=${path.join(temp, 'profile')}`, '--window-size=1440,1000', '--virtual-time-budget=6000', '--dump-dom', pathToFileURL(page).href],
      { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
      assert.equal(result.status, 0, JSON.stringify({ executable, status: result.status, signal: result.signal, error: result.error?.message, stderr: result.stderr }));
      assert.match(result.stdout, /data-gee-slot-test="PASS"/, result.stdout.match(/data-gee-slot-test="[^"]*"/)?.[0] || result.stderr);
      console.log('preview-gee-equipment-slot-browser.test.js: PASS Chrome slot selectors, paired slots, hero isolation and hit target');
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  } finally { f.cleanup(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
