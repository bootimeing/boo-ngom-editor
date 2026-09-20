const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { fixture } = require('./preview-gee-inputs.test');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));

async function main() {
  const f = await fixture();
  try {
    const source = '[@main]\n#IF\nCHECKITEMW <$STR(S$名称)>\n#SAY\n<TEXT:动态装备满足:20:20>\n#ELSESAY\n<TEXT:动态装备未满足:20:20>';
    const presence = 'WORN_DYNAMIC(<$STR(S$名称)>)';
    const models = [f.model({}, source), f.model({ 'S$名称': '金刚' }, source), f.model({ 'S$名称': '金刚', [presence]: '1' }, source)];
    const uri = p => pathToFileURL(path.join(root, p)).href;
    let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
    const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
    html = html.replace(renderer, `<script>const models=${JSON.stringify(models).replace(/</g, '\\u003c')};let next=0,revision=0;const messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);if(['ready','previewInput'].includes(m.type)){const i=next++;setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:models[i],previewRevision:++revision,preserveDrafts:true}})),0);}}});</script>${renderer}`);
    html = html.replace('</body>', `<script>
      const check=(value,message)=>{if(!value)throw Error(message)},field=name=>[...document.querySelectorAll('[data-preview-name]')].find(e=>e.dataset.previewName===name),text=()=>document.getElementById('dialogCanvas').textContent,
      wait=async predicate=>{for(let i=0;i<80;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('DOM update timeout')};
      addEventListener('load',async()=>{try{
        await wait(()=>field('S$名称')&&field('${presence}'));
        check(field('S$名称').type==='text'&&field('${presence}').type==='checkbox','dynamic name/presence input type lost');
        const nameBox=field('S$名称').getBoundingClientRect();check(nameBox.width>0&&nameBox.height>0&&document.elementFromPoint(nameBox.x+nameBox.width/2,nameBox.y+nameBox.height/2)===field('S$名称'),'dynamic name input not hittable');
        const input=field('S$名称');input.focus();input.value='金刚';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
        await wait(()=>text().includes('动态装备未满足'));
        field('${presence}').click();await wait(()=>text().includes('动态装备满足'));
        check(!messages.some(m=>['apply','save'].includes(m.type)),'dynamic equipment preview requested source write');document.body.dataset.geeDynamicEquipmentTest='PASS';
      }catch(error){document.body.dataset.geeDynamicEquipmentTest=error.stack+'; messages='+JSON.stringify(messages)+'; canvas='+text();}});</script></body>`);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-gee-dynamic-equipment-browser-'));
    try {
      const page = path.join(temp, 'browser.html');fs.writeFileSync(page,html);
      const executable=process.env.BOO_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe';
      const result=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files',`--user-data-dir=${path.join(temp,'profile')}`,'--window-size=1440,1000','--virtual-time-budget=6000','--dump-dom',pathToFileURL(page).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
      assert.equal(result.status,0,JSON.stringify({executable,status:result.status,signal:result.signal,error:result.error?.message,stderr:result.stderr}));
      assert.match(result.stdout,/data-gee-dynamic-equipment-test="PASS"/,result.stdout.match(/data-gee-dynamic-equipment-test="[^"]*"/)?.[0]||result.stderr);
      console.log('preview-gee-dynamic-equipment-browser.test.js: PASS Chrome dynamic name and local presence toggle');
    } finally {fs.rmSync(temp,{recursive:true,force:true});}
  } finally {f.cleanup();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
