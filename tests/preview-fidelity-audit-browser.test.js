// Collect real Chromium observations without changing production rendering.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { cases, root, out } = require('./preview-fidelity-audit.test');
const { parse } = require('./preview-inputs-integration.test');
async function main() {
if(process.env.BOO_FIDELITY_EXPECT_IMAGE==='1') {
  const {hydrate}=require('./helpers/preview-image-hydration');
  for(const fixture of cases.filter(c=>['literal-image','resolved-image'].includes(c.id))) await hydrate(fixture.model);
}
fs.mkdirSync(out, { recursive: true });
const uri = f => pathToFileURL(path.join(root, f)).href;
const serialize = x => JSON.stringify(x).replace(/</g, '\\u003c');
const navigation = parse('[@main]\n#SAY\n<进入下一页/@next>\n[@next]\n#SAY\n<TEXT:目标页内容:30:100>');
const scenarioSource='[@main]\n#IF\nCHECKJOB warrior\n#SAY\n<TEXT:战士场景:30:30>\n#ELSESAY\n<TEXT:其他职业:30:30>\n#IF\nCHECKNAMELIST ..\\QuestDiary\\名单.txt\n#SAY\n<TEXT:名单内:30:80>\n#ELSESAY\n<TEXT:名单外:30:80>';
const scenarioName=parse(scenarioSource).previewInputs.find(input=>input.scenario==='namelist')?.name || 'NAMELIST(../questdiary/名单.txt)';
const scenarioModels={};
for(const job of ['', 'warrior','wizard','taoist'])for(const flag of ['', '0','1']){
  const values={};if(job)values.JOB=job;if(flag)values[scenarioName]=flag;
  scenarioModels[job+'|'+flag]=parse(scenarioSource,values);
}
const comparison = parse('[@main]\n#ACT\nMOV N0 240\n#SAY\n<Text|x=30|y=30|text=字面量 width=240>\n<Input|x=30|y=70|inputid=1|type=0|width=240|height=30|bgtype=1|place=字面量宽度输入框>\n<Text|x=30|y=130|text=变量 N0=240，应该与上方同宽>\n<Input|x=30|y=170|inputid=2|type=0|width=<$STR(N0)>|height=30|bgtype=1|place=已知变量宽度输入框>', {}, '996PC');
let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
  .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
html = html.replace(renderer, () => `<script>window.hostMessages=[];window.acquireVsCodeApi=()=>({postMessage:m=>{hostMessages.push(m);if(window.onFixtureHostMessage)window.onFixtureHostMessage(m);}});</script>${renderer}`);
html = html.replace('</body>', () => `<script>
const fixtures=${serialize(cases.map(c => ({id:c.id,model:c.model,expected:c.expected,actual:c.actual,matches:c.matches,category:c.category})))};
const wait=()=>new Promise(r=>setTimeout(r,80));let revision=0;
const canvas=()=>document.getElementById('dialogCanvas');
const deliver=async model=>{window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:++revision,preserveDrafts:false}}));await wait();};
window.addEventListener('load',async()=>{try{
  const observations=[];await wait();
  for(const fixture of fixtures){
    await deliver(fixture.model);
    const node=canvas().querySelector('[data-element-id]');
    if(!node)throw Error('missing DOM for '+fixture.id);
    node.scrollIntoView({block:'center',inline:'center'});
    const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
    const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
    const text=node.querySelector('.element-text')?.textContent ?? node.textContent;
    const observation={id:fixture.id,text,width:parseFloat(style.width),height:parseFloat(style.height),
      visible:rect.width>0&&rect.height>0&&style.display!=='none'&&style.visibility==='visible',
      hittable:!!hit&&(hit===node||node.contains(hit)),expected:fixture.expected,modelActual:fixture.actual};
    if(!observation.visible)throw Error('invisible fixture '+fixture.id);
    if(${process.env.BOO_FIDELITY_EXPECT_SEMANTICS === '1'} && fixture.category==='implementation-bug'){
      if(text!==fixture.expected)throw Error('incorrect rendered semantics '+fixture.id+': '+text);
      if(!observation.hittable)throw Error('unhittable semantic fixture '+fixture.id);
    }
    if(${process.env.BOO_FIDELITY_EXPECT_SIZE === '1'} && ['literal-width','resolved-width'].includes(fixture.id)
      && observation.width!==fixture.expected)throw Error('incorrect rendered width '+fixture.id+': '+observation.width);
    if(${process.env.BOO_FIDELITY_EXPECT_IMAGE === '1'} && ['literal-image','resolved-image'].includes(fixture.id)) {
      const img=node.querySelector('img');
      observation.imageLoaded=!!img&&img.complete&&img.naturalWidth===40&&img.getBoundingClientRect().width>0;
      if(!observation.imageLoaded)throw Error('missing hydrated image '+fixture.id);
    }
    observations.push(observation);
  }
  await deliver(${serialize(navigation)});
  const before=canvas().textContent;
  const action=canvas().querySelector('.runtime-action-hitarea');
  if(!action)throw Error('navigation fixture missing action surface');
  const actionStyle=getComputedStyle(action);
  const caption=canvas().querySelector('.element-text');
  const captionStyle=caption?getComputedStyle(caption):null;
  action.click();await wait();
  const after=canvas().textContent;
  if(${process.env.BOO_FIDELITY_EXPECT_NAVIGATION==='1'} && !after.includes('目标页内容'))throw Error('canvas link did not change local page');
  observations.push({id:'local-navigation',before,after,navigated:after.includes('目标页内容'),
    actionStatus:canvas().querySelector('[data-runtime-action-status]')?.dataset.runtimeActionStatus,
    captionColor:captionStyle?.color,captionUnderline:captionStyle?.textDecorationLine,actionColor:actionStyle.color});
  if(${process.env.BOO_FIDELITY_EXPECT_SCENARIOS==='1'}) {
    const models=${serialize(scenarioModels)}, name=${serialize(scenarioName)};
    const values={};
    window.onFixtureHostMessage=message=>{
      if(message.type==='previewInput') {if(message.value===null)delete values[message.name];else values[message.name]=message.value;}
      else if(message.type==='resetPreview') {for(const key of Object.keys(values))delete values[key];}
      else return;
      deliver(models[(values.JOB||'')+'|'+(values[name]||'')]);
    };
    await deliver(models['|']);
    const field=n=>[...document.querySelectorAll('[data-preview-name]')].find(node=>node.dataset.previewName===n);
    const job=field('JOB');
    if(!job||job.tagName!=='SELECT'||job.options.length!==4)throw Error('missing typed job selector');
    job.focus();job.value='warrior';job.dispatchEvent(new Event('input',{bubbles:true}));job.dispatchEvent(new Event('change',{bubbles:true}));await wait();
    if(!canvas().textContent.includes('战士场景')||!job.isConnected||document.activeElement!==job)throw Error('job update or focus failed');
    const flag=field(name);flag.click();await wait();
    if(!canvas().textContent.includes('名单内'))throw Error('namelist switch did not affect canvas');
    document.getElementById('resetPreview').click();await wait();
    if(field('JOB').value!==''||field(name).checked||!canvas().textContent.includes('名单外'))throw Error('scenario reset not synchronized');
    if(hostMessages.some(message=>['apply','save','previewCondition'].includes(message.type)))throw Error('scenario edit wrote source');
    observations.push({id:'scenario-controls',jobSelector:true,jobFocusPreserved:true,namelistToggle:true,resetSynchronized:true});
    window.onFixtureHostMessage=null;
  }
  await deliver(${serialize(comparison)});
  document.querySelector('.scene-pane').scrollTop=0;
  const report=document.createElement('pre');report.id='fidelity-audit-result';report.hidden=true;
  report.textContent=JSON.stringify({observations,hostMessages,collection:'complete'});document.body.append(report);
  document.body.dataset.fidelityAudit='COLLECTED';
}catch(e){document.body.dataset.fidelityAudit='ERROR '+e.stack;}});
</script></body>`);
const fixture = path.join(out, 'browser-fixture.html');
fs.writeFileSync(fixture, html);
const candidates = [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(x=>x&&fs.existsSync(x)))];
if (!candidates.length) throw Error('No Chromium available; browser audit not performed');
const attempts = [];
for (const [index, executable] of candidates.entries()) {
  const result = spawnSync(executable, ['--headless=new','--disable-gpu','--no-first-run','--allow-file-access-from-files',
    `--user-data-dir=${path.join(out, 'browser-profile-'+index)}`, '--window-size=1440,1000','--virtual-time-budget=12000','--dump-dom',
    `--screenshot=${path.join(out,'width-comparison.png')}`,pathToFileURL(fixture).href],
  {encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
  const dom=result.stdout||'';
  attempts.push({executable,status:result.status,error:String(result.error||''),diagnostic:dom.match(/data-fidelity-audit="[^"]*"/)?.[0]});
  fs.writeFileSync(path.join(out,'browser-attempts.json'),JSON.stringify(attempts,null,2));
  if(result.status===0&&dom.includes('data-fidelity-audit="COLLECTED"')){
    fs.writeFileSync(path.join(out,'browser-dom.html'),dom);
    const encoded=dom.match(/<pre id="fidelity-audit-result"[^>]*>([\s\S]*?)<\/pre>/)?.[1];
    if(!encoded)throw Error('Missing browser result');
    const decoded=encoded.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&');
    const report=JSON.parse(decoded);report.executable=executable;report.runtimeRoot=root;
    fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report.observations,null,2));
    console.log('BROWSER OBSERVATIONS COLLECTED; not feature PASS.');
    process.exit(0);
  }
}
throw Error(JSON.stringify(attempts));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
