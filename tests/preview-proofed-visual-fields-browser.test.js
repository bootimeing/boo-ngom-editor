const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { parse } = require('./preview-inputs-integration.test');
const { manager } = require('./helpers/preview-image-hydration');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const out = path.resolve(process.env.BOO_PROOFED_VISUAL_BROWSER_OUT
  || 'artifacts/ctrl-f12-proofed-visual-fields/browser');

// Real, differently colored PNG pixels are synthetic test assets, not a claim
// that a user's PAK/JPK was decoded. Provider hydration and reflow are production.
function syntheticPng(index) {
  function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type, bytes) {
    const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length);
    checksum.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
    return Buffer.concat([size, name, bytes, checksum]);
  }
  const header = Buffer.alloc(13), pixels = Buffer.alloc(24 * (1 + 40 * 4));
  header.writeUInt32BE(40, 0); header.writeUInt32BE(24, 4);
  header[8] = 8; header[9] = 6;
  const colors = [[68, 187, 238], [248, 194, 58], [238, 102, 68]];
  const rgb = colors[index % colors.length];
  for (let y = 0; y < 24; y++) for (let x = 0; x < 40; x++) {
    const offset = y * 161 + 1 + x * 4;
    pixels.set([...rgb, 255], offset);
  }
  return 'data:image/png;base64,' + Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64') + '#slot-' + index;
}

async function fixture(engine) {
  const statements = [
    ['IMG_RELATIVE', '<IMG:<$STR(N0)>:<$STR(N1)>:80:90>'],
    ['IMG_ABSOLUTE', '<&IMG:<$STR(N0)>:<$STR(N1)>:200:90>'],
    ['IMG_LITERAL_RELATIVE', '<IMG:1060:1:320:90>'],
    ['IMG_LITERAL_ABSOLUTE', '<&IMG:1060:1:440:90>'],
    ['PLAY_RELATIVE', '<PLAYIMG:1:1100:<$STR(N2)>:100:80:160>'],
    ['PLAY_ABSOLUTE', '<&PLAYIMG:1:1200:<$STR(N2)>:100:200:160>'],
    ['PLAY_LITERAL', '<&PLAYIMG:1:1300:15:100:320:160>'],
    ['PLAY_INPUT', '<&PLAYIMG:1:1400:<$STR(N5)>:100:80:240>'],
    ['PLAY_MOVR', '<&PLAYIMG:1:1500:<$STR(N6)>:100:200:240>'],
    ['PLAY_DYNAMIC_INTERVAL', '<&PLAYIMG:1:1600:<$STR(N2)>:<$STR(N4)>:320:240>'],
    ['PLAY_UNKNOWN_RESOURCE', '<&PLAYIMG:1:<$STR(N7)>:15:100:440:240>'],
    ['IMG_INPUT', '<&IMG:<$STR(N8)>:1:80:320>'],
    ['IMG_MOVR', '<&IMG:<$STR(N9)>:1:200:320>'],
    ['COLOR_RESOLVED', '<确定颜色/FCOLOR=<$STR(N3)>>'],
    ['COLOR_UNKNOWN', '<未知颜色/FCOLOR=<$STR(N11)>>'],
    ['COLOR_INVALID', '<非法颜色/FCOLOR=<$STR(N12)>>'],
  ];
  const source = [
    '[@main]', '#ACT', 'MOV N0 1060', 'MOV N1 1', 'MOV N2 15',
    'MOV N3 251', 'MOV N4 100', 'MOVR N6 15', 'MOVR N9 1060',
    'MOVR N11 255', 'MOV N12 999', '#SAY', ...statements.map(([, raw]) => raw),
  ].join('\n');
  const model = parse(source, { N5: '15', N6: '15', N7: '1700', N8: '1060', N9: '1060' }, engine);
  const all = model.scenes.flatMap(scene => scene.elements);
  const elements = {};
  for (const [name, raw] of statements) {
    const element = all.find(candidate => candidate.raw === raw);
    assert.ok(element, `${engine} missing source fixture ${name}`);
    element.id = engine + '_' + name;
    elements[name] = element;
    // The fixed gate must keep editable source expressions, not substitute the
    // effective value into raw/sourceRange or change the coordinate spans.
    assert.equal(element.sourceRange.original, raw);
    assert.equal(source.slice(element.sourceRange.start, element.sourceRange.end), raw);
  }
  const instance = manager(), requests = [];
  instance.scriptDataResolver = { resolveItemFieldByIndex() {}, resolveItemFieldByName() {} };
  instance.resolveAsset = reference => {
    requests.push({ ...reference });
    return { status: 'ready', url: syntheticPng(reference.imageIndex), width: 40, height: 24,
      offsetX: 0, offsetY: 0, archiveLabel: `Synthetic PNG/slot-${reference.imageIndex}` };
  };
  await instance.hydrateAssets(model, {}, { fileName: 'proofed-visual-fixture.txt' });
  return { engine, source, model, elements, requests };
}

function modelChecks(fixture) {
  const { engine, elements: e, requests } = fixture, failures = [];
  const check = (name, task) => {
    try { task(); } catch (error) { failures.push(`[model:${engine}] ${name}: ${error.message}`); }
  };
  for (const name of ['IMG_RELATIVE', 'IMG_ABSOLUTE']) check(name, () => {
    assert.deepEqual(e[name].assetRef, { willIndex: 1, imageIndex: 1060 });
    assert.equal(e[name].asset?.status, 'ready');
    assert.equal(e[name].previewAssetOrigin, 'resolved-static');
    assert.ok(requests.some(reference => reference.willIndex === 1 && reference.imageIndex === 1060));
  });
  check('coordinate contract remains relative/absolute', () => {
    for (const [actual, literal] of [['IMG_RELATIVE', 'IMG_LITERAL_RELATIVE'], ['IMG_ABSOLUTE', 'IMG_LITERAL_ABSOLUTE']]) {
      assert.equal(e[actual].coordinateMode, e[literal].coordinateMode);
      assert.equal(e[actual].x.sourceValue, actual === 'IMG_RELATIVE' ? 80 : 200);
      assert.equal(e[actual].y.sourceValue, 90);
      assert.ok(e[actual].width > 0 && e[actual].height > 0);
      assert.equal(e[actual].asset.width, e[literal].asset.width);
      assert.equal(e[actual].asset.height, e[literal].asset.height);
    }
  });
  for (const [name, start] of [['PLAY_RELATIVE', 1100], ['PLAY_ABSOLUTE', 1200]]) check(name, () => {
    assert.equal(e[name].animationPreview.frameCount, 15);
    assert.notEqual(e[name].animationPreview.staticFirstFrameOnly, true);
    assert.ok(!e[name].animationPreview.dynamicFields?.includes('frame-count'));
    assert.equal(e[name].animationFrames?.length, 15);
    assert.ok(e[name].animationFrames.every(frame => frame.status === 'ready'));
    assert.deepEqual([...new Set(requests.filter(reference => reference.imageIndex >= start && reference.imageIndex < start + 15)
      .map(reference => reference.imageIndex))].sort((a, b) => a - b), Array.from({ length: 15 }, (_, index) => start + index));
  });
  for (const [name, start] of [['PLAY_INPUT', 1400], ['PLAY_MOVR', 1500]]) check(name, () => {
    assert.equal(e[name].animationPreview.staticFirstFrameOnly, true);
    assert.equal(e[name].animationFrames?.length, 1);
    assert.deepEqual(requests.filter(reference => reference.imageIndex >= start && reference.imageIndex < start + 15)
      .map(reference => reference.imageIndex), [start]);
  });
  check('proved count cannot clear a different dynamic animation field', () => {
    assert.equal(e.PLAY_DYNAMIC_INTERVAL.animationPreview.staticFirstFrameOnly, true);
    assert.ok(e.PLAY_DYNAMIC_INTERVAL.animationPreview.dynamicFields.includes('interval'));
  });
  for (const name of ['PLAY_UNKNOWN_RESOURCE', 'IMG_INPUT', 'IMG_MOVR']) check(name, () => {
    assert.equal(e[name].assetRef, undefined);
    assert.equal(e[name].asset, undefined);
    assert.equal(e[name].animationFrames, undefined);
  });
  check('FCOLOR warning follows resolved-static field', () => {
    assert.equal(e.COLOR_RESOLVED.textPreview.fieldSources.find(field => field.field === 'color').status, 'resolved-static');
    assert.equal(e.COLOR_RESOLVED.color, '#ffff00');
    assert.doesNotMatch(e.COLOR_RESOLVED.warning || '', /文字颜色是动态表达式|不借用 MOV 当前值/);
    assert.match(e.COLOR_RESOLVED.warning || '', /传统流式文字/);
    assert.match(e.COLOR_UNKNOWN.warning || '', /动态|运行时|未确定|不借用/);
    assert.match(e.COLOR_INVALID.warning || '', /无效|非法/);
  });
  return failures;
}

function browsers() {
  return [...new Set([
    process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate)).map(candidate => path.resolve(candidate)))];
}

function version(browser) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(Get-Item -LiteralPath $env:BOO_PROOFED_BROWSER_EXECUTABLE).VersionInfo.ProductVersion'],
  { windowsHide: true, timeout: 5000, encoding: 'utf8', env: { ...process.env, BOO_PROOFED_BROWSER_EXECUTABLE: browser } });
  return String(result.stdout || '').trim() || '<unknown>';
}

async function run() {
  fs.mkdirSync(out, { recursive: true });
  const fixtures = await Promise.all(['GOM', 'GEE'].map(fixture));
  const failures = fixtures.flatMap(modelChecks);
  fs.writeFileSync(path.join(out, 'model-results.json'), JSON.stringify({
    verification: 'Production parser + Provider hydration/reflow; synthetic PNG, no user-cache access',
    failures, fixtures,
  }, null, 2));
  if (process.env.BOO_PROOFED_VISUAL_MODEL_ONLY === '1') {
    assert.deepEqual(failures, [], 'proofed visual model regression');
    console.log('preview-proofed-visual-fields-browser.test.js: MODEL PASS (browser not run)');
    return;
  }
  const candidates = browsers();
  if (!candidates.length) {
    assert.deepEqual(failures, [], 'proofed visual model regression');
    console.log('preview-proofed-visual-fields-browser.test.js: SKIP browser (Edge/Chrome not installed); MODEL PASS');
    return;
  }
  const uri = file => pathToFileURL(path.join(root, file)).href;
  const encode = value => JSON.stringify(value).replace(/</g, '\\u003c');
  let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
    .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css'))
    .replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
  const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  html = html.replace(renderer, () => `<script>window.hostMessages=[];window.acquireVsCodeApi=()=>({postMessage:message=>hostMessages.push(message)});</script>${renderer}`);
  html = html.replace('</body>', () => `<script>
  const fixtures=${encode(fixtures)},failures=${encode(failures)},observations=[];
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let revision=0;
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  const node=id=>document.querySelector('#dialogCanvas [data-element-id="'+id+'"]');
  const visible=target=>{const r=target.getBoundingClientRect(),s=getComputedStyle(target);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
  async function test(name,task){try{await task();}catch(error){failures.push('[dom] '+name+': '+error.message);}}
  async function loaded(image){for(let attempt=0;attempt<30&&(!image.complete||image.naturalWidth===0);attempt++)await wait(10);check(image.complete&&image.naturalWidth===40&&image.naturalHeight===24,'PNG did not load');}
  async function warning(wrapper){
    wrapper.scrollIntoView({block:'center',inline:'center'});const r=wrapper.getBoundingClientRect();
    wrapper.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:r.x+3,clientY:r.y+3}));
    window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:r.x+3,clientY:r.y+3}));
    await wait(15);check(!document.getElementById('elementInspector').classList.contains('hidden'),'Inspector selection did not synchronize');
    const target=document.getElementById('elementWarning');return visible(target)?target.textContent:'';
  }
  window.addEventListener('load',async()=>{try{
    await wait(60);document.getElementById('canvasDiagnosticsToggle').click();
    for(const fixture of fixtures){
      const engine=fixture.engine,e=fixture.elements;
      window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:fixture.model,previewRevision:++revision,preserveDrafts:false}}));await wait(80);
      for(const name of ['IMG_RELATIVE','IMG_ABSOLUTE','IMG_LITERAL_RELATIVE','IMG_LITERAL_ABSOLUTE'])await test(engine+' '+name,async()=>{
        const wrapper=node(e[name].id);check(wrapper,'image wrapper missing');const image=wrapper.querySelector('img');check(image,'hydrated image absent');await loaded(image);
        check(image.src===e[name].asset.url,'wrong Provider asset URL');check(visible(wrapper)&&visible(image),'image or selection has no visible extent');
        wrapper.scrollIntoView({block:'center',inline:'center'});const r=wrapper.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        check(hit&&(hit===wrapper||wrapper.contains(hit)),'painted image is not hittable');
        check(Math.abs(parseFloat(wrapper.style.left)-e[name].layoutX)<0.01&&Math.abs(parseFloat(wrapper.style.top)-e[name].layoutY)<0.01,'coordinate mode changed final placement');
        observations.push({engine,name,loaded:true,hittable:true,width:r.width,height:r.height,x:wrapper.style.left,y:wrapper.style.top,coordinateMode:e[name].coordinateMode});
      });
      const histories={},pixelColors={},observers=[];
      for(const name of ['PLAY_RELATIVE','PLAY_ABSOLUTE','PLAY_LITERAL','PLAY_INPUT','PLAY_MOVR','PLAY_DYNAMIC_INTERVAL'])await test(engine+' '+name+' initial frame',async()=>{
        const wrapper=node(e[name].id),image=wrapper&&wrapper.querySelector('.animation-frame-image');check(image,'animation image absent');await loaded(image);
        const positive=['PLAY_RELATIVE','PLAY_ABSOLUTE','PLAY_LITERAL'].includes(name),expectedSlots=positive||name==='PLAY_DYNAMIC_INTERVAL'?'15':'1';
        check(wrapper.dataset.animationSlotCount===expectedSlots,'wrong hydrated slot count '+wrapper.dataset.animationSlotCount);
        check(wrapper.dataset.animationReadyCount===expectedSlots&&wrapper.dataset.animationMissingCount==='0','ready/missing time slots mismatch');
        check(visible(image)&&wrapper.querySelector('.animation-frame-missing').hidden,'missing placeholder covers ready frame');
        check(positive?wrapper.dataset.animationStatus==='playing':wrapper.dataset.animationStatus==='static-first-frame','unsafe/wrong playback status '+wrapper.dataset.animationStatus);
        histories[name]=[{frame:Number(wrapper.dataset.animationCurrentFrame),src:image.src}];
        pixelColors[name]=new Set();
        const samplePixels=()=>{
          if(!image.complete||!image.naturalWidth)return;
          const sampler=document.createElement('canvas');sampler.width=1;sampler.height=1;
          const context=sampler.getContext('2d');context.drawImage(image,0,0,1,1);
          pixelColors[name].add(Array.from(context.getImageData(0,0,1,1).data).join(','));
        };
        image.addEventListener('load',samplePixels);samplePixels();
        const observer=new MutationObserver(()=>histories[name].push({frame:Number(wrapper.dataset.animationCurrentFrame),src:image.src}));
        observer.observe(wrapper,{attributes:true,attributeFilter:['data-animation-current-frame']});observers.push(observer);
      });
      await wait(1800);observers.forEach(observer=>observer.disconnect());
      for(const name of Object.keys(histories))await test(engine+' '+name+' time advance',async()=>{
        const positive=['PLAY_RELATIVE','PLAY_ABSOLUTE','PLAY_LITERAL'].includes(name),history=histories[name],frames=new Set(history.map(entry=>entry.frame));
        check(positive?frames.size>=12:frames.size===1,'time did not honor source-safe frame permission '+JSON.stringify([...frames]));
        if(positive){check(frames.has(14),'last declared frame did not play');check(new Set(history.map(entry=>entry.src)).size>=12,'frame metadata advanced without pixel URLs');check(pixelColors[name].size===3,'image pixels did not advance through the three synthetic colors');}
        else check([...frames][0]===0,'unsafe animation advanced beyond first frame');
        const current=node(e[name].id),image=current.querySelector('.animation-frame-image');await loaded(image);
        check(image.src===e[name].animationFrames[Number(current.dataset.animationCurrentFrame)].url,'current painted frame differs from its Provider time slot');
        observations.push({engine,name,frames:[...frames],colors:[...pixelColors[name]],urls:new Set(history.map(entry=>entry.src)).size,status:current.dataset.animationStatus});
      });
      for(const name of ['PLAY_UNKNOWN_RESOURCE','IMG_INPUT','IMG_MOVR'])await test(engine+' '+name+' resource gate',async()=>{
        const wrapper=node(e[name].id);check(wrapper,'unresolved selectable surface missing');check(visible(wrapper),'unresolved surface invisible');
        check(!wrapper.querySelector('img[src]'),'local input or runtime writer unlocked a resource URL');
      });
      await test(engine+' FCOLOR resolved diagnostics',async()=>{
        const wrapper=node(e.COLOR_RESOLVED.id),label=wrapper.querySelector('.element-text');check(label&&visible(label),'colored text is invisible');
        check(getComputedStyle(label).color==='rgb(255, 255, 0)','resolved indexed yellow did not draw');
        const text=await warning(wrapper);check(!text.includes('文字颜色是动态表达式')&&!text.includes('不借用 MOV 当前值'),'resolved color retains stale dynamic warning: '+text);
        check(text.includes('传统流式文字'),'unrelated layout warning was erased');observations.push({engine,name:'COLOR_RESOLVED',color:getComputedStyle(label).color,warning:text});
      });
      await test(engine+' FCOLOR unknown diagnostics',async()=>{
        const text=await warning(node(e.COLOR_UNKNOWN.id));check(/动态|运行时|未确定|不借用/.test(text),'true unknown color lost its diagnostic');
      });
      await test(engine+' FCOLOR invalid diagnostics',async()=>{
        const text=await warning(node(e.COLOR_INVALID.id));check(/无效|非法/.test(text),'invalid static color lost its diagnostic');
      });
    }
    check(!hostMessages.some(message=>['apply','save','previewSubmit','openLink','runtimeAction'].includes(message.type)),'rendering or selection triggered a source/server action');
    const result=document.createElement('pre');result.id='proofed-visual-result';result.hidden=true;result.textContent=JSON.stringify({failures,observations,hostMessages});document.body.append(result);
    document.body.dataset.testStatus=failures.length?'FAIL':'PASS';document.body.dataset.domCount=String(document.querySelectorAll('*').length);
  }catch(error){document.body.dataset.testStatus='ERROR';document.body.dataset.testError=error.stack||String(error);}});
  </script></body>`);
  const file = path.join(out, 'fixture.html');fs.writeFileSync(file, html);
  const attempts = [];
  for (const [index, browser] of candidates.entries()) {
    const profile = fs.mkdtempSync(path.join(out, `profile-${index}-`));
    try {
      const dom = await runChromiumDom(browser, file, profile);
      fs.writeFileSync(path.join(out, `dom-${index}.html`), dom);
      const completed = /data-test-status="(?:PASS|FAIL)"/.test(dom);
      attempts.push({ browser, version: version(browser), completed, status: /data-test-status="PASS"/.test(dom) ? 'PASS' : 'FAIL',
        error: /data-test-error="([^"]*)"/.exec(dom)?.[1] });
      fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2));
      if (!completed) continue;
      const json = /<pre[^>]*id="proofed-visual-result"[^>]*>([^]*?)<\/pre>/.exec(dom)?.[1];
      assert.ok(json, 'completed scenario omitted evidence');
      const result = JSON.parse(json.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
      fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ browser, version: attempts.at(-1).version, ...result }, null, 2));
      console.log(`preview-proofed-visual-fields-browser.test.js: browser=${browser} version=${attempts.at(-1).version} DOM=${/data-dom-count="([0-9]+)"/.exec(dom)?.[1]}`);
      assert.deepEqual(result.failures, [], 'proofed visual fields RED matrix');
      console.log('preview-proofed-visual-fields-browser.test.js: PASS (production HTML/CSS/JS + real Chromium, synthetic PNG; not native VS Code/game-client acceptance)');
      return;
    } catch (error) {
      if (attempts.at(-1)?.browser === browser && attempts.at(-1)?.completed) throw error;
      attempts.push({ browser, error: error.stack || String(error) });
      fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2));
      console.log(`preview-proofed-visual-fields-browser.test.js: candidate failure ${browser}: ${error.message}`);
    } finally {
      if (fs.existsSync(profile)) removeTemporaryDirectory(profile);
    }
  }
  throw Error('No installed Chromium produced completed DOM: ' + JSON.stringify(attempts));
}

run().catch(error => { console.error(error); process.exitCode = 1; });
