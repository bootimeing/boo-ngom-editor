const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { parse } = require('./preview-inputs.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const uri = file => pathToFileURL(path.join(root, file)).href;
function browserVersion(executable) {
  if (process.platform !== 'win32') return 'unavailable';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(Get-Item -LiteralPath $env:BOO_EXPANDED_PREVIEW_BROWSER).VersionInfo.ProductVersion'], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
    env: { ...process.env, BOO_EXPANDED_PREVIEW_BROWSER: executable },
  });
  return result.status === 0 ? result.stdout.trim() : 'unavailable';
}
const source = `[@main]
#IF
NOT CHECK [101] 0
#SAY
<TEXT:个人标志开启:30:20>
#ELSESAY
<TEXT:个人标志关闭:30:20>
#IF
CHECK [101] 1
#SAY
<TEXT:共享个人标志:30:45>
#IF
LARGE U101 9007199254740992
#SAY
<TEXT:大数条件满足 <$STR(U101)>:30:70>
#IF
#SAY
<TEXT:字符 <$STR(A0)>:30:100>
<TEXT:其他字符 <$STR(S0)> <$STR(T0)> <$STR(Z0)>:30:130>
<TEXT:列表首项 <$STR(L$名单[0])>:30:160>
<TEXT:字典积分 <$STR(D$积分[张三])>:30:190>
<TEXT:角色 <$USERNAME> 等级 <$LEVEL>:30:220>
<TEXT:对象 <$C.GAMEGOLD> 英雄 <$H.LEVEL>:30:250>
<TEXT:参数 <$SCRIPTPARAM1>:30:280>`;
const literal = '勇士:<IMG:1:1:1:1>|/@x<img src=x onerror=window.previewInjected=1>';
const firstList = '甲:<IMG:1:1:1:1>|/@x';
const keyFor = values => JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
const states = new Map();
let values = {};
function state(name, value) {
  if (name === undefined) values = {};
  else if (value === null) delete values[name];
  else values[name] = value;
  states.set(keyFor(values), parse(source, values));
}
state();
state('[101]', '1');
state('U101', '9007199254740993');
state('U101', null);
state('USERNAME', '预览勇士');
state('LEVEL', '15');
state('C.GAMEGOLD', '100');
state('H.LEVEL', '7');
state('SCRIPTPARAM(1)', '传入内容');
state('A0', literal);
state('A0', '');
state('A0', literal);
state('L$名单', JSON.stringify(['']));
state('L$名单', JSON.stringify([firstList]));
state('L$名单', JSON.stringify([firstList, '']));
state('L$名单', JSON.stringify([firstList, '乙']));
state('D$积分', JSON.stringify({ 张三: '' }));
state('D$积分', JSON.stringify({ 张三: '99' }));
state('D$积分', JSON.stringify({ 张三: '99', 李四: '' }));
state('D$积分', JSON.stringify({ 张三: '99', 李四: '0' }));
// Keep attack strings in interaction assertions, but use ordinary values for
// the optional user-facing screenshot of the same production model path.
const populatedModel = parse(source, { ...values, A0: '欢迎来到玛法大陆', S0: '战士', T0: '行会成员', Z0: '可领取奖励',
  'L$名单': JSON.stringify(['张三', '李四']) });
state('D$积分', JSON.stringify({ 李四: '0' }));
state('L$名单', JSON.stringify(['乙']));
state('[101]', '0');
state('A0', null);
state('L$名单', '[]');
state('D$积分', '{}');
state('L$名单', '[""]');
state('D$积分', '{"张三":""}');
const initial = states.get('{}');
for (const [name, kind] of Object.entries({ A0: 'text', S0: 'text', T0: 'text', Z0: 'text',
  U101: 'number', USERNAME: 'text', LEVEL: 'number', 'C.GAMEGOLD': 'number', 'H.LEVEL': 'number',
  'L$名单': 'list', 'D$积分': 'dictionary', '[101]': 'flag' })) {
  assert.equal(initial.previewInputs.find(item => item.name === name)?.kind, kind, `${name} input contract`);
}
assert.ok(initial.previewInputs.some(item => item.name === 'SCRIPTPARAM(1)'), 'script parameter canonical input');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-typed-preview-expanded-'));
try {
  let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
    .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css'))
    .replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
  const fixture = JSON.stringify(Object.fromEntries(states)).replace(/</g, '\\u003c');
  const mock = `<script>
  window.previewModels=${fixture}; window.previewValues={}; window.previewMessages=[]; window.previewRevision=0;
  window.previewScreenshotModel=${process.env.BOO_EXPANDED_PREVIEW_SCREENSHOT ? JSON.stringify(populatedModel).replace(/</g, '\\u003c') : 'null'};
  const fixtureKey=values=>JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a],[b])=>a<b?-1:a>b?1:0)));
  window.acquireVsCodeApi=()=>({postMessage:message=>{
    previewMessages.push(message);
    if(message.type==='previewInput') {
      if(message.value===null)delete previewValues[message.name];else previewValues[message.name]=message.value;
    } else if(message.type==='resetPreview') previewValues={};
    if(['ready','previewInput','resetPreview'].includes(message.type)) {
      const model=previewModels[fixtureKey(previewValues)];
      if(!model){document.body.dataset.previewHostError=JSON.stringify(message);return;}
      const revision=++previewRevision;
      setTimeout(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model,
        previewRevision:revision,preserveDrafts:revision>1}})),0);
    }
  }});
  </script>`;
  const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  html = html.replace(renderer, () => mock + renderer);
  html = html.replace('</body>', () => `<script>
  const wait=()=>new Promise(resolve=>setTimeout(resolve,60));
  const check=(value,message)=>{if(!value)throw Error(message);};
  const field=name=>[...document.querySelectorAll('[data-preview-name]')].find(input=>input.dataset.previewName===name);
  const row=name=>[...document.querySelectorAll('.preview-input-row')].find(node=>node.dataset.name===name);
  const canvas=()=>document.getElementById('dialogCanvas').textContent;
  const entries=name=>field(name).querySelectorAll('.preview-collection-entry');
  const messages=()=>previewMessages.filter(message=>message.type==='previewInput');
  const change=(input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
  const hit=input=>{input.scrollIntoView({block:'center'});const box=input.getBoundingClientRect();const style=getComputedStyle(input);
    check(box.width>0&&box.height>0,'invisible control '+input.getAttribute('aria-label'));
    check(style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0,'control not visibly painted');
    check(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2)===input,'unhittable control '+input.getAttribute('aria-label'));};
  window.addEventListener('load',async()=>{try{
    await wait();
    check(document.querySelectorAll('[data-name="[101]"]').length===1,'flag identity was duplicated');
    check(!document.querySelector('#advancedConditions,.branch-button'),'retired condition switches remain');
    for(const name of ['[101]','U101','A0','L$名单','D$积分'])check(row(name).querySelector('.preview-input-reset').getAttribute('aria-pressed')==='true','Auto state is not visible for '+name);
    for(const name of ['A0','S0','T0','Z0','USERNAME'])check(field(name).type==='text',name+' is not textual');
    check(field('U101').type==='text'&&field('U101').inputMode==='decimal','lossy native numeric input');
    hit(field('[101]'));field('[101]').click();await wait();
    check(canvas().includes('个人标志开启')&&canvas().includes('共享个人标志'),'single flag does not drive both conditions');
    const number=field('U101');hit(number);number.focus();
    const beforeInvalid=messages().length;change(number,'1e3');await wait();
    check(messages().length===beforeInvalid&&number.getAttribute('aria-invalid')==='true','exponent was silently accepted');
    check(row('U101').textContent.includes('十进制'),'numeric validation not visible');
    change(number,'9007199254740993');await wait();
    check(number.value==='9007199254740993'&&document.activeElement===number,'large decimal value or focus lost');
    check(canvas().includes('大数条件满足 9007199254740993'),'large integer was rounded during comparison/display');
    change(number,'');await wait();
    check(messages().at(-1).name==='U101'&&messages().at(-1).value===null,'empty numeric is not Auto');
    check(!canvas().includes('大数条件满足'),'Auto did not update condition');
    change(field('USERNAME'),'预览勇士');await wait();
    change(field('LEVEL'),'15');await wait();
    change(field('C.GAMEGOLD'),'100');await wait();
    change(field('H.LEVEL'),'7');await wait();
    change(field('SCRIPTPARAM(1)'),'传入内容');await wait();
    check(canvas().includes('角色 预览勇士 等级 15'),'system display not connected to typed input');
    check(canvas().includes('对象 100 英雄 7'),'object-qualified values not isolated/displayed');
    check(canvas().includes('参数 传入内容'),'script parameter alias not connected');
    change(field('A0'),${JSON.stringify(literal)});await wait();
    check(canvas().includes(${JSON.stringify('字符 ' + literal)}),'numbered string not displayed literally');
    check(!window.previewInjected&&!document.querySelector('#dialogCanvas img'),'preview text became executable markup');
    change(field('A0'),'');await wait();
    check(messages().at(-1).value===''&&row('A0').querySelector('.preview-input-state').textContent==='已输入'&&row('A0').querySelector('.preview-input-reset').getAttribute('aria-pressed')==='false','explicit empty text became Auto');
    change(field('A0'),${JSON.stringify(literal)});await wait();
    const list=field('L$名单');check(list.classList.contains('preview-collection'),'list is a plain scalar');
    hit(list.querySelector('.preview-collection-add'));list.querySelector('.preview-collection-add').click();await wait();
    let listValue=entries('L$名单')[0].querySelector('input');listValue.focus();change(listValue,${JSON.stringify(firstList)});await wait();
    check(document.activeElement===listValue&&listValue.isConnected,'collection input replaced on refresh');
    check(canvas().includes(${JSON.stringify('列表首项 ' + firstList)}),'list indexed display did not update');
    list.querySelector('.preview-collection-add').click();await wait();
    change(entries('L$名单')[1].querySelector('input'),'乙');await wait();
    check(entries('L$名单')[0].querySelector('.preview-collection-index').textContent==='[0]','list index origin incorrect');
    check(entries('L$名单')[1].querySelector('.preview-collection-index').textContent==='[1]','list index increment incorrect');
    const dictionary=field('D$积分');hit(dictionary.querySelector('.preview-collection-add'));
    let count=messages().length;dictionary.querySelector('.preview-collection-add').click();await wait();
    check(messages().length===count,'incomplete dictionary row was applied');
    change(entries('D$积分')[0].querySelector('[data-collection-key]'),'张三');await wait();
    change(entries('D$积分')[0].querySelector('[data-collection-value]'),'99');await wait();
    check(canvas().includes('字典积分 99'),'dictionary lookup did not update');
    dictionary.querySelector('.preview-collection-add').click();await wait();
    const duplicate=entries('D$积分')[1].querySelector('[data-collection-key]');
    count=messages().length;change(duplicate,'张三');await wait();
    check(messages().length===count&&duplicate.getAttribute('aria-invalid')==='true','duplicate dictionary key overwrote a value');
    check(row('D$积分').textContent.includes('重复'),'duplicate key diagnostic absent');
    change(duplicate,'李四');await wait();
    change(entries('D$积分')[1].querySelector('[data-collection-value]'),'0');await wait();
    entries('D$积分')[0].querySelector('button').click();await wait();
    check(JSON.stringify(JSON.parse(messages().at(-1).value))===JSON.stringify({李四:'0'}),'dictionary remove corrupts remaining key');
    entries('L$名单')[0].querySelector('button').click();await wait();
    check(entries('L$名单')[0].querySelector('.preview-collection-index').textContent==='[0]'&&canvas().includes('列表首项 乙'),'list removal not reindexed');
    const text=field('A0');text.focus();text.value='未提交草稿';text.dispatchEvent(new Event('input',{bubbles:true}));
    field('[101]').click();await wait();check(text.value==='未提交草稿','unsubmitted scalar draft lost on another condition refresh');
    row('A0').querySelector('button').click();await wait();check(field('A0').value==='','per-variable Auto did not discard draft');
    field('L$名单').querySelector('.preview-collection-clear').click();await wait();
    check(messages().at(-1).value==='[]'&&row('L$名单').querySelector('.preview-input-state').textContent==='已输入'&&row('L$名单').querySelector('.preview-input-reset').getAttribute('aria-pressed')==='false','explicit empty list became Auto');
    field('D$积分').querySelector('.preview-collection-clear').click();await wait();
    check(messages().at(-1).value==='{}'&&entries('D$积分').length===0&&row('D$积分').querySelector('.preview-input-reset').getAttribute('aria-pressed')==='false','dictionary clear did not apply an explicit empty object');
    field('L$名单').querySelector('.preview-collection-add').click();await wait();
    field('D$积分').querySelector('.preview-collection-add').click();await wait();
    change(entries('D$积分')[0].querySelector('[data-collection-key]'),'张三');await wait();
    const search=document.getElementById('previewInputSearch');change(search,'字典');
    search.value='D$积分';search.dispatchEvent(new Event('input',{bubbles:true}));
    check(!row('D$积分').hidden&&row('A0').hidden,'input search did not filter');
    search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));
    entries('L$名单')[0].querySelector('input').focus();document.getElementById('resetPreview').click();await wait();
    check(entries('L$名单').length===0&&entries('D$积分').length===0,'reset retained collection data');
    check(!field('[101]').checked&&field('U101').value===''&&field('A0').value==='','reset retained scalar state');
    for(const name of ['[101]','U101','A0','L$名单','D$积分'])check(row(name).querySelector('.preview-input-reset').getAttribute('aria-pressed')==='true','reset did not restore visible Auto state for '+name);
    check(canvas().includes('个人标志关闭'),'reset canvas inconsistent');
    check(!previewMessages.some(message=>['apply','save','previewCondition'].includes(message.type)),'source or server side effect');
    check(!document.body.dataset.previewHostError,'unexpected host input '+document.body.dataset.previewHostError);
    // After independently asserting reset, an optional artifact shows a real
    // parser-produced populated state so collection controls can be inspected.
    if(window.previewScreenshotModel){
      window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:previewScreenshotModel,
        previewRevision:++previewRevision,preserveDrafts:true}}));await wait();
      document.querySelector('.scene-pane').scrollTop=0;
    }
    document.body.dataset.expandedPreviewTest='PASS';
  }catch(error){document.body.dataset.expandedPreviewTest=error.stack;}});
  </script></body>`);
  const fixturePath = path.join(temp, 'fixture.html');
  fs.writeFileSync(fixturePath, html);
  const candidates = [...new Set([
    process.env.BOO_BROWSER_EXECUTABLE,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(exe => exe && fs.existsSync(exe)))];
  assert.ok(candidates.length, 'No installed Chromium candidate for expanded preview UI gate');
  const errors = [];
  let passed = false;
  for (const [index, exe] of candidates.entries()) {
    const result = spawnSync(exe, ['--headless=new', '--disable-gpu', '--no-first-run',
      ...(process.env.BOO_EXPANDED_PREVIEW_SCREENSHOT ? [`--screenshot=${path.resolve(process.env.BOO_EXPANDED_PREVIEW_SCREENSHOT)}`] : []),
      '--allow-file-access-from-files', `--user-data-dir=${path.join(temp, `profile-${index}`)}`,
      '--window-size=1440,1000', '--virtual-time-budget=6500', '--dump-dom', pathToFileURL(fixturePath).href],
    { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (!result.error && result.status === 0 && result.stdout.includes('data-expanded-preview-test="PASS"')) {
      if (errors.length) console.log(`Earlier browser attempts: ${errors.join('\n')}`);
      console.log(`preview-inputs-expanded-browser.test.js: PASS ${exe}; version=${browserVersion(exe)}; DOM=${(result.stdout.match(/data-element-id=/g) || []).length}; visible input/collection DOM and parser-driven branches verified`);
      passed = true;
      break;
    }
    errors.push(`${exe}: ${result.error || result.stdout.match(/data-expanded-preview-test="[^"]*"/)?.[0] || result.stderr}`);
  }
  assert.ok(passed, errors.join('\n'));
} finally { removeTemporaryDirectory(temp); }
