const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const {parse}=require('./preview-inputs-integration.test'),{hydrate}=require('./helpers/preview-image-hydration');
async function run(){
 const root=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..')),out=path.resolve('artifacts/input-submit-r8/imgex-browser');fs.mkdirSync(out,{recursive:true});
 const model=parse('[@main]\n#ACT\nMOV N0 1\nMOV N1 2\n#SAY\n<IMGEX:0:<$STR(N0)>:<$STR(N1)>:3:30:30>');await hydrate(model,true);
 const dimensions=parse('[@main]\n#ACT\nMOV N0 1\nMOV N1 240\nMOV N2 24\n#SAY\n<Input|x=20|y=20|width=<$STR(N<$STR(N0)>)>|height=30|inputid=1|type=0>\n<Input|x=20|y=80|width=<$STR(N2)>0|height=30|inputid=2|type=0>',{},'996PC');
 const uri=f=>pathToFileURL(path.join(root,f)).href,encode=x=>JSON.stringify(x).replace(/</g,'\\u003c');
 let html=fs.readFileSync(path.join(root,'media/npc-dialog-visual.html'),'utf8').replaceAll('{{STYLE_URI}}',uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}',uri('media/npc-dialog-visual.js'));
 const renderer=`<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
 html=html.replace(renderer,()=>`<script>window.acquireVsCodeApi=()=>({postMessage:()=>{}});</script>${renderer}`);
 html=html.replace('</body>',()=>`<script>
 const model=${encode(model)},wait=()=>new Promise(r=>setTimeout(r,80)),check=(v,m)=>{if(!v)throw Error(m);};
 window.addEventListener('load',async()=>{try{await wait();window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:1}}));await wait();
 const wrapper=document.getElementById('dialogCanvas').querySelector('[data-element-id]');check(wrapper,'wrapper');
 const image=wrapper.querySelector('img'),element=model.pages[0].elements[0];check(image,'image');
 check(image.complete&&image.naturalWidth>0&&image.src===element.asset.url,'normal image loaded');
 const r=wrapper.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);check(r.width>0&&r.height>0&&(wrapper===hit||wrapper.contains(hit)),'visible and hittable');
 wrapper.dispatchEvent(new MouseEvent('mouseenter'));await wait();
 check(wrapper.dataset.interactiveState==='hover'&&image.src===element.assetLayers.find(layer=>layer.role==='hover').asset.url&&image.complete&&image.naturalWidth>0,'hover pixels loaded');
 wrapper.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:r.x+5,clientY:r.y+5}));await wait();
 check(wrapper.dataset.interactiveState==='pressed'&&image.src===element.assetLayers.find(layer=>layer.role==='pressed').asset.url&&image.complete&&image.naturalWidth>0,'pressed pixels loaded');
 window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
 window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:${encode(dimensions)},previewRevision:2,preserveDrafts:false}}));await wait();
 const inputs=[...document.getElementById('dialogCanvas').querySelectorAll('[data-element-id]')];check(inputs.length===2,'dimension fixtures');
 check(inputs.every(node=>parseFloat(getComputedStyle(node).width)===240&&node.getBoundingClientRect().width===240),'nested and composite widths');
 document.body.dataset.imgexCompat='PASS';
 }catch(e){document.body.dataset.imgexCompat='FAIL';document.body.dataset.error=String(e.stack||e);}});
 </script></body>`);
 const file=path.join(out,'fixture.html');fs.writeFileSync(file,html);const attempts=[];
 const candidates=[...new Set([process.env.BOO_BROWSER_EXECUTABLE,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p=>p&&fs.existsSync(p)))];assert.ok(candidates.length,'Chromium required');
 for(const [index,executable]of candidates.entries()){
  const result=spawnSync(executable,['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files','--window-size=1440,1000','--virtual-time-budget=5000','--dump-dom',`--user-data-dir=${path.join(out,'profile-'+index)}`,`--screenshot=${path.join(out,'preview.png')}`,pathToFileURL(file).href],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
  const dom=result.stdout||'';attempts.push({executable,status:result.status,error:String(result.error||''),diagnostic:dom.match(/data-error="[^"]*"/)?.[0]});fs.writeFileSync(path.join(out,'attempts.json'),JSON.stringify(attempts,null,2));fs.writeFileSync(path.join(out,'dom-'+index+'.html'),dom);
  if(result.status===0&&dom.includes('data-imgex-compat="PASS"')){console.log('preview-imgex-compat-browser.test.js: PASS '+executable);return;}
 }throw Error(JSON.stringify(attempts));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
