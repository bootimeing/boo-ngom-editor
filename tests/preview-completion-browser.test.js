const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { parse } = require('./preview-inputs-integration.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const uri = file => pathToFileURL(path.join(root, file)).href;
const source = ['[@main]', '#ACT', 'MOV N0 7', 'MOV L$mix [<TEXT:Z源码控件:30:130>]',
  'ADDTOLIST L$mix <$STR(S$user)>', 'SORTLIST L$mix L$sorted 0 1', '#SAY',
  '<$STR(L$sorted[<$STR(N$selector)>])>', '<TEXT:<$STR(L$sorted[0])>:30:165>',
  '<查看参数页/@page(<$STR(N0)>)>', '#ACT', 'MOV N0 99', '[@page]', '#SAY', '<TEXT:参数<$SCRIPTPARAM1>:30:100>'].join('\n');
const initial = { 'S$user': '<TEXT:A用户文字:1:1>', 'N$selector': '1' };
const attack = '<IMG:1:1:1:1>|/@fake<img src=x onerror=window.previewInjected=1>';
const edited = { ...initial, 'S$user': attack };
const overridden = { ...edited, 'SCRIPTPARAM(1)': '8' };
const key = values => JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
const models = Object.fromEntries([initial, edited, overridden, {}].map(values => [key(values), parse(source, values)]));
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
function version(executable) {
  if (process.platform !== 'win32') return 'unavailable';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(Get-Item -LiteralPath $env:BOO_COMPLETION_BROWSER).VersionInfo.ProductVersion'],
  { encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, BOO_COMPLETION_BROWSER: executable } });
  return result.status === 0 ? result.stdout.trim() : 'unavailable';
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-preview-completion-'));
try {
  let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
    .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
  const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  const mock = `<script>
    window.fixtureModels=${serialize(models)};window.fixtureValues=${serialize(initial)};window.fixtureMessages=[];window.fixtureRevision=0;window.fixtureHistoryLength=history.length;
    const fixtureKey=values=>JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a],[b])=>a<b?-1:a>b?1:0)));
    window.acquireVsCodeApi=()=>({postMessage:message=>{
      fixtureMessages.push(message);
      if(message.type==='previewInput'){if(message.value===null)delete fixtureValues[message.name];else fixtureValues[message.name]=message.value;}
      if(message.type==='resetPreview')fixtureValues={};
      if(['ready','previewInput','resetPreview'].includes(message.type)){
        const model=fixtureModels[fixtureKey(fixtureValues)];
        if(!model){document.body.dataset.fixtureHostError=JSON.stringify(message);return;}
        const revision=++fixtureRevision;
        setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:revision,preserveDrafts:revision>1}})),0);
      }
    }});
  </script>`;
  html = html.replace(renderer, () => mock + renderer);
  html = html.replace('</body>', () => `<script>
    const check=(value,message)=>{if(!value)throw Error(message);};
    const wait=()=>new Promise(resolve=>setTimeout(resolve,80));
    const canvas=()=>document.getElementById('dialogCanvas');
    const field=name=>[...document.querySelectorAll('[data-preview-name]')].find(input=>input.dataset.previewName===name);
    const page=label=>[...document.querySelectorAll('.scene-button')].find(button=>button.querySelector('strong').textContent===label);
    const change=(input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
    const element=text=>{const nodes=[...canvas().querySelectorAll('[data-element-id]')];const node=nodes.find(node=>(node.querySelector('.element-text')?.textContent||node.textContent)===text);
      check(node,'missing '+text+' among '+JSON.stringify(nodes.map(item=>item.textContent)));return node;};
    const paint=node=>{check(node,'required text element absent');node.scrollIntoView({block:'center',inline:'center'});
      const box=node.getBoundingClientRect(),style=getComputedStyle(node);
      check(box.width>0&&box.height>0,'required element has no painted geometry');
      check(style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0,'required element is hidden');
      const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
      check(hit&&(hit===node||node.contains(hit)),'required element cannot be hit: '+node.textContent+'; hit='+(hit&&hit.outerHTML.slice(0,160))+'; box='+JSON.stringify(box));};
    window.addEventListener('load',async()=>{try{
      await wait();
      check(!document.body.dataset.fixtureHostError,'host fixture missing initial state');
      paint(element('Z源码控件'));paint(element('<TEXT:A用户文字:1:1>'));
      check(!canvas().textContent.includes('<TEXT:Z源码控件:'),'source collection leaf was escaped after user append/sort');
      const input=field('S$user');paint(input);input.focus();change(input,${serialize(attack)});await wait();
      check(input.isConnected&&document.activeElement===input,'input focus replaced on model update');
      paint(element('Z源码控件'));paint(element(${serialize(attack)}));
      check(!window.previewInjected&&!canvas().querySelector('img'),'user collection literal became image or script');
      paint(page('@page'));page('@page').click();await wait();paint(element('参数7'));
      check(!canvas().textContent.includes('参数99'),'button parameter used later source value instead of click-site snapshot');
      check(!field('SCRIPTPARAM(1)'),'a statically bound button parameter must not create an ineffective input');
      paint(element('参数7'));
      document.getElementById('resetPreview').click();await wait();paint(element('参数7'));
      check(!fixtureMessages.some(message=>['apply','save','previewCondition'].includes(message.type)),'preview interaction wrote source or used retired condition state');
      check(!document.body.dataset.fixtureHostError,'unexpected provider input state');
      check(!window.previewInjected&&!document.querySelector('img[src="x"]'),'literal text escaped canvas isolation');
      check(location.href===${serialize(pathToFileURL(path.join(temporary, 'fixture.html')).href)},'preview navigated browser');
      check(history.length===fixtureHistoryLength,'preview changed browser history');
      // A readable populated-state screenshot is distinct from the attack assertions.
      if(${Boolean(process.env.BOO_COMPLETION_PREVIEW_SCREENSHOT)}){
        window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:fixtureModels[fixtureKey(${serialize(initial)})],previewRevision:++fixtureRevision,preserveDrafts:true}}));
        await wait();page('@main').click();await wait();document.querySelector('.scene-pane').scrollTop=0;
      }
      document.body.dataset.previewCompletion='PASS';
    }catch(error){document.body.dataset.previewCompletion=error.stack;}});
  </script></body>`);
  const file = path.join(temporary, 'fixture.html');
  fs.writeFileSync(file, html);
  const candidates = [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .filter(executable => executable && fs.existsSync(executable)))];
  assert.ok(candidates.length, 'No installed Chromium candidate for preview completion gate');
  const attempts = [];
  let passed = false;
  for (const [index, executable] of candidates.entries()) {
    const result = spawnSync(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(temporary, `profile-${index}`)}`, '--window-size=1440,1000', '--virtual-time-budget=4000', '--dump-dom',
      ...(process.env.BOO_COMPLETION_PREVIEW_SCREENSHOT ? [`--screenshot=${path.resolve(process.env.BOO_COMPLETION_PREVIEW_SCREENSHOT)}`] : []),
      pathToFileURL(file).href], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (!result.error && result.status === 0 && result.stdout.includes('data-preview-completion="PASS"')) {
      if (attempts.length) console.log(`Earlier browser attempts: ${attempts.join('\n')}`);
      console.log(`preview-completion-browser.test.js: PASS ${executable}; version=${version(executable)}; DOM=${(result.stdout.match(/data-element-id=/g) || []).length}; mixed collection and parameter snapshot painted/hittable`);
      passed = true; break;
    }
    attempts.push(`${executable}: ${result.error || result.stdout.match(/data-preview-completion="[^"]*"/)?.[0] || result.stderr}`);
  }
  assert.ok(passed, attempts.join('\n'));
} finally { removeTemporaryDirectory(temporary); }
