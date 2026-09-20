const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {pathToFileURL}=require('node:url'),{spawnSync}=require('node:child_process');
const {equipmentModel}=require('./preview-equipment.test');
const {removeTemporaryDirectory}=require('./helpers/temp-cleanup');
const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'boo-equipment-browser-'));
try {
 const models=[{}, {'WORN(金刚)':'1'}, {'WORN(金刚)':'0','WORN(泰阿)':'1'},
  {'WORN(金刚)':'0','WORN(泰阿)':'1','WORN(头盔)':'1'}, {'WORN(泰阿)':'0','WORN(头盔)':'1'}, {}].map(equipmentModel);
 const uri=f=>pathToFileURL(path.join(root,f)).href;
 let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8')
  .replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
 const renderer=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
 html=html.replace(renderer,`<script>const models=${JSON.stringify(models).replace(/</g,'\\u003c')};let n=0;const messages=[];
 window.acquireVsCodeApi=()=>({postMessage:m=>{messages.push(m);if(['ready','previewInput','resetPreview'].includes(m.type))setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:models[n++],previewRevision:n}})),0)}});</script>`+renderer);
 html=html.replace('</body>',`<script>
 const wait=()=>new Promise(r=>setTimeout(r,80)),check=(v,m)=>{if(!v)throw Error(m)},field=n=>[...document.querySelectorAll('[data-preview-name]')].find(x=>x.dataset.previewName==='WORN('+n+')'),canvas=()=>document.getElementById('dialogCanvas').textContent;
 addEventListener('load',async()=>{try{
 await wait();check(document.querySelectorAll('[data-preview-name]').length===6,'missing equipment fields');
 for(const name of ['金刚','泰阿','莫邪','干将','蚩尤']){const f=field(name),r=f.getBoundingClientRect();check(f.type==='checkbox'&&r.width>0&&r.height>0&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===f,'unusable checkbox '+name);}
 check(canvas().includes('未穿戴'),'default branch');field('金刚').click();await wait();
 check(canvas().includes('已穿戴'),'IF(1) did not accept one');field('泰阿').click();await wait();
 check(!field('金刚').checked&&field('泰阿').checked,'same slot not exclusive');field('头盔').click();await wait();
 check(field('泰阿').checked&&field('头盔').checked,'different slot incorrectly excluded');field('泰阿').click();await wait();
 check(canvas().includes('未穿戴'),'uncheck last item');document.getElementById('resetPreview').click();await wait();
 check(!field('头盔').checked&&!field('泰阿').checked,'reset equipment');
 const node=document.querySelector('#dialogCanvas [data-element-id]');node.click();await wait();
 check(document.body.textContent.includes('满足任意一项'),'threshold presentation lost');
 check(!messages.some(m=>['apply','save'].includes(m.type)),'source mutation');document.body.dataset.test='PASS';
 }catch(e){document.body.dataset.test=e.stack;}});</script></body>`);
 const file=path.join(temp,'fixture.html');fs.writeFileSync(file,html);
 const exe=process.env.BOO_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe';
 const r=spawnSync(exe,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files',`--user-data-dir=${path.join(temp,'profile')}`,'--window-size=1440,1000','--virtual-time-budget=4500','--dump-dom',pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:8*1024*1024});
 assert.equal(r.status,0);assert.ok(r.stdout.includes('data-test="PASS"'),r.stdout.match(/data-test="[^"]*"/)?.[0]||r.stderr);
 console.log('preview-equipment-browser.test.js: PASS '+exe);
}finally{removeTemporaryDirectory(temp);}
