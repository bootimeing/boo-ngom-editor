const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url'), { spawnSync } = require('node:child_process');
const { fixture, quantitySource, caseSource, partialSource, dynamicQuantitySource, heroSource, bareMovSource, thresholdBoundarySource, dynamicModeSource } = require('./preview-gee-inputs.test');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
async function main() {
  const f = await fixture();
  try {
    const values = [{}, { A201: '临时玩家' }, { A201: '临时玩家', G201: '100' },
      { A201: '临时玩家', G201: '100', 'WORN(金刚)': '1' },
      { A201: '临时玩家', G201: '100', 'WORN(金刚)': '0', 'WORN(泰阿)': '1' },
      { 'WORN(戒指甲)': '1', 'WORN(戒指乙)': '1' }, {}];
    const models = values.map(v => f.model(v));
    models.push(...[{}, { 'WORN(戒指甲)': '2' }, { 'WORN(戒指甲)': '0' }, {}].map(v => f.model(v, quantitySource)));
    models.push(...[{}, { 'WORN(BLADE)': '2' }, { 'WORN(BLADE)': '0', 'WORN(AXE)': '1' }, {}].map(v => f.model(v, caseSource)));
    models.push(...[{}, { 'WORN(戒指甲)': '1' }, { 'WORN(戒指甲)': '1', 'WORN(戒指乙)': '1' }, {}].map(v => f.model(v, partialSource)));
    models.push(...[{}, { 'WORN(戒指甲)': '2' }, { 'WORN(戒指甲)': '2', U101: '2' }, {}].map(v => f.model(v, dynamicQuantitySource)));
    models.push(...[{}, { 'WORN(金刚)': '1' }, { 'WORN(金刚)': '1', 'HERO(PRESENT)': '1' },
      { 'WORN(金刚)': '1', 'HERO(PRESENT)': '1', 'H.WORN(泰阿)': '1' },
      { 'WORN(金刚)': '1', 'HERO(PRESENT)': '0', 'H.WORN(泰阿)': '1' },
      { 'WORN(金刚)': '1', 'HERO(PRESENT)': '1', 'H.WORN(泰阿)': '1' }, {}].map(v => f.model(v, heroSource)));
    const before = [f.file, f.ini, f.db].map(p => fs.readFileSync(p));
    models.push(...[{}, { U101: '42' }, { U101: '42', A201: '甲:乙|丙/@x' }, {}].map(v => f.model(v, bareMovSource)));
    models.push(...[{}, { '[101]': '1' }, { '[101]': '1', '[102]': '1' }, {}].map(v => f.model(v, thresholdBoundarySource)));
    models.push(...[{}, {U102:'1'}, {U102:'1','WORN(戒指甲)':'2'}, {U102:'0','WORN(戒指甲)':'2'},
      {U102:'1','WORN(戒指甲)':'2'}, {}].map(v=>f.model(v,dynamicModeSource)));
    const uri = p => pathToFileURL(path.join(root, p)).href;
    let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
    const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
    html = html.replace(renderer, `<script>const models=${JSON.stringify(models).replace(/</g, '\\u003c')}; let revision=0;const messages=[];
      window.deliver=i=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:models[i],previewRevision:++revision,preserveDrafts:true}}));
      let next=0;window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);if(['ready','previewInput','resetPreview'].includes(m.type)){const index=next++;setTimeout(()=>deliver(index),0)}}});</script>` + renderer);
    html = html.replace('</body>', `<script>
      const check=(v,m)=>{if(!v)throw Error(m)}, field=n=>[...document.querySelectorAll('[data-preview-name]')].find(e=>e.dataset.previewName===n),
      text=()=>document.getElementById('dialogCanvas').textContent,
      wait=async p=>{for(let i=0;i<80;i++){if(p())return;await new Promise(r=>setTimeout(r,25));}throw Error('DOM update timeout')},
      edit=(n,v)=>{let e=field(n);e.focus();e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
      addEventListener('load',async()=>{try{
        await wait(()=>field('G201'));check(field('G201').value==='40'&&text().includes('数量=42'),'disk default/GOTO lost');
        check(field('A201').type==='text'&&text().includes('暂无玩家'),'text type/empty branch');
        for(const n of ['WORN(金刚)','WORN(泰阿)','WORN(戒指甲)','WORN(戒指乙)']){const e=field(n);check(e,'missing '+n);const r=e.getBoundingClientRect();check(e.type==='checkbox'&&r.width>0&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e,'not hittable '+n);}
        edit('A201','临时玩家');await wait(()=>text().includes('玩家=临时玩家'));
        edit('G201','100');await wait(()=>text().includes('数量=102'));
        field('WORN(金刚)').click();await wait(()=>text().includes('已穿戴武器'));check(!text().includes('未穿金刚'),'NOT must share identity');
        field('WORN(泰阿)').click();await wait(()=>!field('WORN(金刚)').checked&&field('WORN(泰阿)').checked);
        deliver(5);await wait(()=>text().includes('双戒指'));check(field('WORN(戒指甲)').checked&&field('WORN(戒指乙)').checked,'paired slots');
        next=6;document.getElementById('resetPreview').click();await wait(()=>text().includes('数量=42')&&text().includes('暂无玩家')&&!field('WORN(戒指甲)').checked);
        check(field('G201').value==='40'&&field('A201').value===''&&!field('WORN(泰阿)').checked,'reset input mismatch');
        deliver(7);await wait(()=>field('WORN(戒指甲)')?.type==='text');
        check(document.querySelectorAll('[data-preview-name]').length===1,'quantity predicates must share one field');
        const count=field('WORN(戒指甲)'), box=count.getBoundingClientRect();
        check(box.width>0&&box.height>0&&document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===count,'quantity not hittable');
        next=8;const sent=messages.length;edit('WORN(戒指甲)','1.5');
        check(messages.length===sent&&count.getAttribute('aria-invalid')==='true','fractional equipment count submitted');
        edit('WORN(戒指甲)','2');await wait(()=>text().includes('双件达标'));
        check(text().includes('至少一件')&&!text().includes('双件未达标'),'quantity branch incoherent');
        edit('WORN(戒指甲)','0');await wait(()=>text().includes('不足双件'));
        check(!text().includes('确实穿戴'),'zero must not count as worn');
        document.getElementById('resetPreview').click();await wait(()=>field('WORN(戒指甲)').value==='');
        deliver(11);await wait(()=>field('WORN(BLADE)'));
        check(document.querySelectorAll('[data-preview-name]').length===2,'mixed case produced duplicate controls');
        const blade=field('WORN(BLADE)'), bladeRow=blade.closest('.preview-input-row');
        check(blade.type==='text'&&bladeRow.querySelector('.preview-input-heading span').textContent==='Blade','original label or merged quantity lost');
        check(blade.getAttribute('aria-label')==='穿戴 Blade','accessible name must preserve source spelling');
        const bladeBox=blade.getBoundingClientRect();check(bladeBox.width>0&&document.elementFromPoint(bladeBox.x+bladeBox.width/2,bladeBox.y+bladeBox.height/2)===blade,'case input not hittable');
        next=12;edit('WORN(BLADE)','2');await wait(()=>text().includes('大写双件')&&text().includes('混写单件'));
        check(!text().includes('未满双件'),'NOT case alias disagrees');
        field('WORN(AXE)').click();await wait(()=>text().includes('另一武器')&&field('WORN(BLADE)').value==='0');
        check(!text().includes('混写单件'),'case-insensitive database exclusivity lost');
        document.getElementById('resetPreview').click();await wait(()=>field('WORN(BLADE)').value===''&&!field('WORN(AXE)').checked);
        deliver(15);await wait(()=>field('WORN(戒指乙)'));
        check(document.querySelectorAll('[data-preview-name]').length===2&&field('WORN(戒指甲)').type==='text','partial must share real item controls');
        next=16;edit('WORN(戒指甲)','1');await wait(()=>text().includes('甲已穿戴'));
        check(text().includes('部分匹配不足')&&text().includes('反向成立'),'partial counted twice');
        edit('WORN(戒指乙)','1');await wait(()=>text().includes('部分匹配达标'));
        check(!text().includes('反向成立'),'partial NOT disagrees');
        document.getElementById('resetPreview').click();await wait(()=>text().includes('部分匹配不足')&&field('WORN(戒指甲)').value==='');
        deliver(19);await wait(()=>field('U101'));
        check(document.querySelectorAll('[data-preview-name]').length===2&&field('WORN(戒指甲)').type==='text','GOTO quantity dependencies missing');
        next=20;edit('WORN(戒指甲)','2');await wait(()=>text().includes('变量数量达标'));
        edit('U101','2');await wait(()=>text().includes('变量数量不足'));
        check(text().includes('变量反向成立')&&field('WORN(戒指甲)').value==='2','threshold edit lost shared count');
        document.getElementById('resetPreview').click();await wait(()=>field('U101').value===''&&field('WORN(戒指甲)').value==='');
        deliver(23);await wait(()=>field('HERO(PRESENT)'));
        check(document.querySelectorAll('[data-preview-name]').length===4,'hero identities missing');
        check(field('H.WORN(泰阿)').getAttribute('aria-label')==='英雄穿戴 泰阿','hero label ambiguous');
        for(const name of ['HERO(PRESENT)','H.WORN(泰阿)']){const e=field(name),r=e.getBoundingClientRect();check(r.width>0&&r.height>0&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e,'hero input not hittable '+name);}
        next=24;field('WORN(金刚)').click();await wait(()=>text().includes('玩家金刚'));
        field('HERO(PRESENT)').click();await wait(()=>field('HERO(PRESENT)').checked);
        field('H.WORN(泰阿)').click();await wait(()=>text().includes('英雄泰阿'));
        check(text().includes('玩家金刚')&&field('WORN(金刚)').checked,'hero cleared player equipment');
        field('HERO(PRESENT)').click();await wait(()=>!text().includes('英雄泰阿'));
        check(field('H.WORN(泰阿)').checked&&text().includes('玩家金刚'),'absence must preserve draft equipment without displaying it as active');
        field('HERO(PRESENT)').click();await wait(()=>text().includes('英雄泰阿'));
        check(field('H.WORN(泰阿)').checked&&text().includes('玩家金刚'),'hero return must restore retained equipment');
        document.getElementById('resetPreview').click();await wait(()=>!field('WORN(金刚)').checked&&!field('H.WORN(泰阿)').checked);
        deliver(30);await wait(()=>text().includes('裸数量='));
        check(text().includes('裸数量=0')&&field('U101')&&field('A201'),'bare MOV default or input dependency lost');
        check(document.querySelectorAll('[data-preview-name]').length===2,'derived MOV outputs must not become extra inputs');
        next=31;edit('U101','42');await wait(()=>text().includes('裸数量=42'));
        edit('A201','甲:乙|丙/@x');await wait(()=>text().includes('裸文字=甲:乙|丙/@x'));
        document.getElementById('resetPreview').click();await wait(()=>text().includes('裸数量=0')&&field('A201').value==='');
        deliver(34);await wait(()=>field('[101]'));
        check(text().includes('零阈值未通过')&&text().includes('超阈值未通过')&&text().includes('或条件未通过'),'threshold default wrong');
        next=35;field('[101]').click();await wait(()=>text().includes('或条件通过'));
        check(text().includes('零阈值未通过')&&text().includes('超阈值未通过'),'AND fallback became OR');
        field('[102]').click();await wait(()=>text().includes('零阈值通过')&&text().includes('超阈值通过'));
        document.getElementById('resetPreview').click();await wait(()=>text().includes('零阈值未通过')&&!field('[101]').checked);
        deliver(38);await wait(()=>text().includes('模式匹配不足'));
        check(field('U102')&&field('WORN(戒指)')&&!field('WORN(戒指甲)'),'dynamic mode exact input missing');
        next=39;edit('U102','1');await wait(()=>field('WORN(戒指甲)'));
        check(!field('WORN(戒指)')&&document.querySelectorAll('[data-preview-name]').length===3,'partial input projection wrong');
        edit('WORN(戒指甲)','2');await wait(()=>text().includes('模式匹配成功'));
        check(!text().includes('模式反向成立'),'dynamic mode NOT disagrees');
        edit('U102','0');await wait(()=>text().includes('模式匹配不足')&&field('WORN(戒指)'));
        edit('U102','1');await wait(()=>text().includes('模式匹配成功')&&field('WORN(戒指甲)').value==='2');
        document.getElementById('resetPreview').click();await wait(()=>field('WORN(戒指)')&&field('U102').value==='');
        check(!messages.some(m=>['apply','save'].includes(m.type)),'source write requested');document.body.dataset.geeTest='PASS';
      }catch(e){document.body.dataset.geeTest=e.stack+'; next='+next+'; messages='+JSON.stringify(messages)+'; canvas='+text();}});</script></body>`);
    const page = path.join(f.temp, 'browser.html'); fs.writeFileSync(page, html);
    const exe = process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const r = spawnSync(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(f.temp, 'profile')}`, '--window-size=1440,1000', '--virtual-time-budget=6000', '--dump-dom', pathToFileURL(page).href],
      { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    const diagnostic = JSON.stringify({ executable: exe, status: r.status, signal: r.signal,
      error: r.error?.message, stdoutBytes: Buffer.byteLength(r.stdout || ''), stderr: r.stderr });
    assert.equal(r.status, 0, diagnostic);
    assert.ok(r.stdout.includes('data-gee-test="PASS"'), r.stdout.match(/data-gee-test="[^"]*"/)?.[0] || diagnostic);
    [f.file, f.ini, f.db].forEach((p, i) => assert.deepEqual(fs.readFileSync(p), before[i]));
    console.log('preview-gee-inputs-browser.test.js: PASS ' + exe + ' rendering/inputs/hit/reset; model-message host simulation');
  } finally { f.cleanup(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
