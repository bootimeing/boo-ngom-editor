const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { fixture } = require('./preview-gee-inputs.test');
const { source, layout, item } = require('./preview-equipment-layout.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
async function main() {
  const f = await fixture();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'boo-equipment-layout-browser-'));
  try {
    const p = 'EQUIPMENT(player)', h = 'EQUIPMENT(hero)', simple = { 'WORN(金刚)':'1' };
    const empty = layout(), ordinary = layout(item('金刚','ordinary',1)), jewelry = layout(item('金刚','jewelry',1));
    const withRing = layout(item('金刚','jewelry',1),item('戒指甲','ordinary',7));
    const twoRings = layout(item('金刚','jewelry',1),item('戒指甲','ordinary',7),item('戒指甲','ordinary',8));
    const states = [simple,{...simple,[p]:empty},{...simple,[p]:ordinary},{...simple,[p]:jewelry},
      {...simple,[p]:withRing},{...simple,[p]:twoRings},{...simple,[p]:twoRings,[h]:empty},
      {...simple,[p]:twoRings,[h]:ordinary},{...simple,[p]:twoRings,[h]:ordinary,'HERO(PRESENT)':'1'},
      {...simple,[h]:ordinary,'HERO(PRESENT)':'1'},{}];
    const expected = [null,[p,empty],[p,ordinary],[p,jewelry],[p,withRing],[p,twoRings],[h,empty],[h,ordinary],['HERO(PRESENT)','1'],[p,null],null];
    const models = states.map(values=>f.model(values,source));
    const before = [f.file,f.ini,f.db].map(file=>fs.readFileSync(file));
    const uri = name=>pathToFileURL(path.join(root,name)).href;
    let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8')
      .replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
    const script=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
    html=html.replace(script,`<script>const models=${JSON.stringify(models).replace(/</g,'\\u003c')},expected=${JSON.stringify(expected).replace(/</g,'\\u003c')};let next=0,revision=0,bridgeError='';const messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);if(!['ready','previewInput','resetPreview'].includes(m.type))return;const index=next++;if(expected[index]&&(m.name!==expected[index][0]||m.value!==expected[index][1]))bridgeError=JSON.stringify({index,m,expected:expected[index]});setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:models[index],previewRevision:++revision,preserveDrafts:true}})),0);}});</script>${script}`);
    html=html.replace('</body>',`<script>
      const check=(x,m)=>{if(!x)throw Error(m)},wait=async p=>{for(let i=0;i<100;i++){if(bridgeError)throw Error(bridgeError);if(p())return;await new Promise(r=>setTimeout(r,20));}throw Error('timeout '+document.getElementById('dialogCanvas').textContent)},
      editor=actor=>document.querySelector('[data-equipment-name="EQUIPMENT('+actor+')"]'),text=()=>document.getElementById('dialogCanvas').textContent,
      simple=()=>document.querySelector('[data-preview-name="WORN(金刚)"]'),rows=actor=>editor(actor).querySelectorAll('.preview-equipment-entry'),
      change=(field,value)=>{field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));},
      add=(actor,slot,name)=>{editor(actor).querySelector('.preview-equipment-add').click();const row=rows(actor)[rows(actor).length-1];change(row.querySelector('[data-equipment-slot]'),String(slot));change(row.querySelector('[data-equipment-item]'),name);return row.querySelector('[data-equipment-item]');};
      addEventListener('load',async()=>{try{
        await wait(()=>editor('player')&&simple());
        const enable=editor('player').querySelector('input'),box=enable.getBoundingClientRect();
        check(box.width>0&&box.height>0&&document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===enable,'layout enable not hittable');
        check(text().includes('名称成立'),'simple scenario not shown');enable.click();
        await wait(()=>!simple()&&!text().includes('名称成立')&&!editor('player').querySelector('.preview-equipment-body').hidden);
        const name=add('player',1,'金刚');await wait(()=>text().includes('名称成立')&&text().includes('武器部位'));
        check(name===rows('player')[0].querySelector('[data-equipment-item]'),'name editing lost focused control');
        change(rows('player')[0].querySelector('[data-equipment-container]'),'jewelry');await wait(()=>text().includes('名称成立')&&!text().includes('武器部位'));
        add('player',7,'戒指甲');await wait(()=>text().includes('普通戒指')&&!text().includes('两件戒指'));
        add('player',8,'戒指甲');await wait(()=>text().includes('两件戒指'));
        const count=messages.length;change(rows('player')[2].querySelector('[data-equipment-slot]'),'7');
        check(messages.length===count&&rows('player')[2].querySelector('[aria-invalid="true"]'),'duplicate slot was submitted');
        rows('player')[2].querySelector('[data-equipment-slot]').value='8';
        editor('hero').querySelector('input').click();await wait(()=>!editor('hero').querySelector('.preview-equipment-body').hidden);
        add('hero',1,'金刚');await wait(()=>rows('hero').length===1&&next===8);
        check(!text().includes('英雄金刚'),'absent hero inherited player equipment');
        document.querySelector('[data-preview-name="HERO(PRESENT)"]').click();await wait(()=>text().includes('英雄金刚')&&text().includes('英雄武器'));
        editor('player').closest('.preview-input-row').querySelector('.preview-input-reset').click();await wait(()=>simple()&&text().includes('名称成立'));
        document.getElementById('resetPreview').click();await wait(()=>!text().includes('名称成立')&&!text().includes('英雄金刚')&&next===11);
        check(!editor('player').querySelector('input').checked&&!editor('hero').querySelector('input').checked,'reset did not clear layout controls');
        check(!messages.some(m=>['apply','save'].includes(m.type)),'layout requested a source write');
        check(!document.querySelector('textarea')?.value?.includes('"items"'),'raw JSON exposed');
        document.body.dataset.equipmentLayout='PASS';
      }catch(e){document.body.dataset.equipmentLayout=e.stack+' messages='+JSON.stringify(messages);}});
    </script></body>`);
    const page=path.join(temp,'browser.html');fs.writeFileSync(page,html);
    const executable=process.env.BOO_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const result=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files',`--user-data-dir=${path.join(temp,'profile')}`,'--window-size=1440,1100','--virtual-time-budget=8000','--dump-dom',pathToFileURL(page).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:12*1024*1024});
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/data-equipment-layout="PASS"/,result.stdout.match(/data-equipment-layout="[^"]*"/)?.[0]||result.stderr);
    [f.file,f.ini,f.db].forEach((file,index)=>assert.deepEqual(fs.readFileSync(file),before[index]));
    console.log('preview-equipment-layout-browser.test.js: PASS real Chromium layout edits, duplicate rejection, counts, paired slots, hero, reset and source isolation');
  } finally { f.cleanup();removeTemporaryDirectory(temp); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
