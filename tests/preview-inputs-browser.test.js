const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { parse, source } = require('./preview-inputs.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const uri = file => pathToFileURL(path.join(root, file)).href;
const states = [{}, { '[101]': '1' }, { '[101]': '1', U101: '11' }, { '[101]': '1', U101: '11', 'S$名字': '勇士' }, {}];
const models = states.map(values => parse(source, values));
const { titleSource, titleNames } = require('./preview-condition-scenarios.test');
const { parse: parseScenario } = require('./preview-inputs-integration.test');
models.push(...[{}, { [titleNames[0]]: '1' }, { [titleNames[0]]: '1', [titleNames[1]]: '1' },
  { [titleNames[0]]: '0', [titleNames[1]]: '1' }, { [titleNames[0]]: '0', [titleNames[1]]: '0' }, {}]
  .map(values => parseScenario(titleSource, values)));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-typed-preview-'));
try {
  let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
    .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css'))
    .replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
  const mock = `<script>
  window.models=${JSON.stringify(models).replace(/</g, '\\u003c')};
  window.messages=[]; window.next=0;
  window.acquireVsCodeApi=()=>({postMessage: message=>{
    messages.push(message);
    if(['ready','previewInput','resetPreview'].includes(message.type)) {
      const n=next++;
      setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{
        type:'model',model:models[n],previewRevision:n+1,preserveDrafts:n>0
      }})),0);
    }
  }});
  </script>`;
  const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  html = html.replace(renderer, () => mock + renderer);
  html = html.replace('</body>', () => `<script>
  const wait=()=>new Promise(resolve=>setTimeout(resolve,80));
  const check=(value,message)=>{if(!value)throw Error(message);};
  const field=name=>[...document.querySelectorAll('[data-preview-name]')].find(input=>input.dataset.previewName===name);
  const canvas=()=>document.getElementById('dialogCanvas').textContent;
  window.addEventListener('load',async()=>{try{
    await wait();
    check(document.querySelectorAll('[data-preview-name]').length===3,'deduplication');
    check(!document.querySelector('#advancedConditions,.branch-button'),'retired controls remain');
    const flag=field('[101]');
    const rect=flag.getBoundingClientRect();
    check(rect.width>0&&rect.height>0,'flag invisible');
    check(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===flag,'flag not hittable');
    check(canvas().includes('标识已关'),'default flag');
    // Keep a coordinate draft on the initial else element across reparsing.
    const node=document.querySelector('#dialogCanvas [data-element-id]');
    node.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const x=document.getElementById('elementX');
    x.value=String(Number(x.value)+7);x.dispatchEvent(new Event('change',{bubbles:true}));
    flag.click();await wait();
    check(canvas().includes('标识已开')&&canvas().includes('同一个开关'),'shared flag branches');
    const number=field('U101');number.focus();number.value='11';number.dispatchEvent(new Event('change',{bubbles:true}));
    await wait();check(canvas().includes('数量足够 11'),'numeric condition and display');
    check(document.activeElement===number,'input focus lost on model refresh');
    const text=field('S$名字');text.value='勇士';text.dispatchEvent(new Event('change',{bubbles:true}));
    await wait();check(canvas().includes('姓名 勇士')&&canvas().includes('欢迎勇士'),'text condition and display');
    document.getElementById('resetPreview').click();await wait();
    check(canvas().includes('标识已关'),'reset condition');
    check(!field('[101]').checked,'reset checkbox');
    check(field('U101').value==='', 'focused numeric input retained old value after reset');
    check(messages.filter(m=>m.type==='previewInput').length===3,'input message count');
    check(messages.some(m=>m.name==='[101]'&&m.value==='1'),'flag message');
    check(!messages.some(m=>['apply','save','previewCondition'].includes(m.type)),'unexpected source write or old message');
    check(document.getElementById('changeList').textContent.includes('7') || !document.getElementById('applyButton').disabled,'coordinate draft lost');
    next=6;
    window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:models[5],previewRevision:6}}));
    await wait();
    const titleA=()=>field('TITLE(狂暴之力)'), titleB=()=>field('TITLE(武神之力)');
    check(document.querySelectorAll('[data-preview-name]').length===2,'title controls missing or duplicated');
    for(const input of [titleA(),titleB()]) {
      check(input.type==='checkbox'&&!input.checked,'title default checkbox');
      const box=input.getBoundingClientRect();
      check(box.width>0&&box.height>0&&document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===input,'title checkbox not hittable');
      check(input.closest('.preview-input-row').querySelector('.preview-input-type').textContent==='称号','wrong title type label');
    }
    check(canvas().includes('两项未拥有'),'initial negative title branch');
    titleA().click();await wait();
    check(canvas().includes('狂暴已拥有')&&canvas().includes('武神未拥有')&&canvas().includes('至少拥有一项'),'title A on');
    titleB().click();await wait();
    check(titleA().checked&&titleB().checked&&canvas().includes('武神已拥有'),'both titles on');
    titleA().click();await wait();
    check(!titleA().checked&&titleB().checked&&canvas().includes('狂暴未拥有'),'title A off independent of B');
    titleB().click();await wait();
    check(canvas().includes('两项未拥有'),'both titles off');
    document.getElementById('resetPreview').click();await wait();
    check(!titleA().checked&&!titleB().checked&&canvas().includes('两项未拥有'),'reset title state');
    check(messages.filter(m=>m.type==='previewInput'&&m.name.startsWith('TITLE(')).length===4,'title messages');
    check(!messages.some(m=>['apply','save','previewCondition'].includes(m.type)),'title switch wrote source');
    document.body.dataset.previewTest='PASS';
  }catch(error){document.body.dataset.previewTest=error.stack;}});
  </script></body>`);
  const file = path.join(temp, 'fixture.html');
  fs.writeFileSync(file, html);
  const candidates = [...new Set([
    process.env.BOO_BROWSER_EXECUTABLE,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(exe => exe && fs.existsSync(exe)))];
  assert.ok(candidates.length, 'No browser installed');
  let passed = false;
  const errors = [];
  for (const [index, exe] of candidates.entries()) {
    const result = spawnSync(exe, ['--headless=new', '--disable-gpu', '--no-first-run',
      ...(process.env.BOO_PREVIEW_INPUT_SCREENSHOT ? [`--screenshot=${path.resolve(process.env.BOO_PREVIEW_INPUT_SCREENSHOT)}`] : []),
      '--allow-file-access-from-files', `--user-data-dir=${path.join(temp, `profile-${index}`)}`,
      '--window-size=1440,1000', '--virtual-time-budget=3500', '--dump-dom', pathToFileURL(file).href],
    { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    if (!result.error && result.status === 0 && result.stdout.includes('data-preview-test="PASS"')) {
      console.log(`preview-inputs-browser.test.js: PASS ${exe}`); passed = true; break;
    }
    errors.push(`${exe}: ${result.error || result.stdout.match(/data-preview-test="[^"]*"/)?.[0] || result.stderr}`);
  }
  assert.ok(passed, errors.join('\n'));
} finally { removeTemporaryDirectory(temp); }
