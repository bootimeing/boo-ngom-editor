const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { pathToFileURL } = require('node:url'), { spawnSync } = require('node:child_process');
const { fixture, expectedOne } = require('./helpers/rebirth-preview-fixture');
const { parse } = require('./preview-inputs-integration.test');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { ScriptDataResolver } = require(path.join(root, 'out/utils/script-data-resolver'));
const setup = fixture(), resolver = new ScriptDataResolver();
const serialize = value => JSON.stringify(value).replace(/</g, '\\u003c');
const uri = file => pathToFileURL(path.join(root, file)).href;
try {
  const options = resolver.optionsFor(setup.file, 'GOM');
  options.resolveTableData = () => assert.fail('CSV must use the dedicated bounded reader');
  const models = Object.fromEntries(['0', '1', '2', '3'].map(level => [level, parse(setup.source, { RELEVEL: level }, 'GOM', {
    filePath: setup.file, fileName: path.basename(setup.file), uri: pathToFileURL(setup.file).href, dataOptions: options,
  })]));
  for (const value of expectedOne) assert.ok(models['1'].pages.flatMap(p => p.elements).some(e => e.text === value), `model missing ${value}`);
  let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
    .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css')).replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
  const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  html = html.replace(renderer, () => `<script>
    const models=${serialize(models)},messages=[];let revision=0;
    window.acquireVsCodeApi=()=>({postMessage:message=>{messages.push(message);
      if(['ready','previewInput','resetPreview'].includes(message.type)){
        const model=models[message.type==='previewInput'?message.value:'0'];
        if(!model){document.body.dataset.hostError=JSON.stringify(message);return;}
        const current=++revision;setTimeout(()=>dispatchEvent(new MessageEvent('message',{data:{type:'model',model,previewRevision:current,preserveDrafts:true}})),0);
      }
    }});
  </script>${renderer}`);
  html = html.replace('</body>', () => `<script>
    const check=(value,message)=>{if(!value)throw Error(message)},canvas=()=>document.getElementById('dialogCanvas'),
      field=()=>[...document.querySelectorAll('[data-preview-name]')].find(e=>e.dataset.previewName==='RELEVEL'),
      texts=()=>[...canvas().querySelectorAll('.element-text')].map(e=>e.textContent),
      wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('timeout: '+JSON.stringify(texts()));},
      paint=node=>{check(node,'node missing');node.scrollIntoView({block:'nearest',inline:'nearest'});
        const r=node.getBoundingClientRect(),s=getComputedStyle(node),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        check(r.width>0&&r.height>0&&s.display!=='none'&&s.visibility==='visible','invisible node '+node.textContent);
        check(hit&&(hit===node||node.contains(hit)),'node cannot be hit '+node.textContent);},
      textNode=value=>[...canvas().querySelectorAll('[data-element-id]')].find(e=>e.querySelector('.element-text')?.textContent===value),
      change=value=>{const input=field();paint(input);input.focus();input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return input;};
    addEventListener('load',async()=>{try{
      await wait(()=>field()&&texts().includes('0转　→　1转'));
      check(document.querySelectorAll('[data-preview-name]').length===1,'table/derived variables leaked into inputs');
      const input=change('1');await wait(()=>texts().includes('1转　→　2转'));
      check(input.isConnected&&document.activeElement===input&&input.value==='1','input lost focus/value');
      for(const expected of ${serialize(expectedOne)}){check(texts().includes(expected),'wrong resolved text '+expected);paint(textNode(expected));}
      check(!texts().some(text=>text.includes('预览文字')||text.includes('<$')),'deterministic CSV text remained a placeholder');
      change('2');await wait(()=>texts().includes('2转　→　3转'));
      for(const expected of ['等级需求：65级','金币需求：金币*20万','材料需求：转生石*20'])paint(textNode(expected));
      check(!texts().includes('金币需求：金币*10万'),'stale first-row formula');
      change('3');await wait(()=>texts().includes('等级需求：无法提升'));
      for(const expected of ['3转','对怪切割+150','对人真伤+90','神力倍攻+3%','金币需求：无法提升'])paint(textNode(expected));
      check(!texts().includes('2转　→　3转'),'stale upgrade branch');
      document.getElementById('resetPreview').click();await wait(()=>texts().includes('0转　→　1转'));
      check(field().value==='0','reset did not restore the actual input field');paint(textNode('金币需求：金币*5万'));
      check(!document.body.dataset.hostError,'unmapped preview state');
      check(messages.every(m=>['ready','previewInput','resetPreview'].includes(m.type)),'unexpected write/navigation request');
      check(messages.filter(m=>m.type==='previewInput').map(m=>m.name+':'+m.value).join(',')==='RELEVEL:1,RELEVEL:2,RELEVEL:3','wrong input payload');
      if(${Boolean(process.env.BOO_REBIRTH_PREVIEW_SCREENSHOT)}){change('1');await wait(()=>texts().includes('1转　→　2转'));}
      document.body.dataset.rebirthCsv='PASS';
    }catch(error){document.body.dataset.rebirthCsv=error.stack;}});
  </script></body>`);
  const file = path.join(setup.temp, 'fixture.html'); fs.writeFileSync(file, html);
  const browsers = [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(p => p && fs.existsSync(p)))];
  assert.ok(browsers.length, 'real Chromium is required');
  const failures = []; let passed = false;
  for (const [index, browser] of browsers.entries()) {
    const result = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(setup.temp, 'profile-' + index)}`, '--window-size=1440,1000', '--virtual-time-budget=5000', '--dump-dom',
      ...(process.env.BOO_REBIRTH_PREVIEW_SCREENSHOT ? [`--screenshot=${path.resolve(process.env.BOO_REBIRTH_PREVIEW_SCREENSHOT)}`] : []), pathToFileURL(file).href],
    { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 12 * 1024 * 1024 });
    if (!result.error && result.status === 0 && result.stdout.includes('data-rebirth-csv="PASS"')) {
      if (failures.length) console.log('Earlier browser attempts: ' + failures.join('\n'));
      console.log('preview-csv-cache-browser: PASS ' + browser + '; real GBK reader/parser/DOM/hit/input/focus/reset; precomputed host transport, no native VS Code claim');
      passed = true; break;
    }
    failures.push(`${browser}: ${result.error || result.stdout.match(/data-rebirth-csv="[^"]*"/)?.[0] || result.stderr}`);
  }
  assert.ok(passed, failures.join('\n')); setup.unchanged();
} finally { resolver.dispose(); setup.dispose(); }
