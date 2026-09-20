const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { ScriptDataResolver } = require(path.join(root, 'out/utils/script-data-resolver'));
const { parseNpcDialogDocument } = require(path.join(root, 'out/ui-dialog/source-parser'));
const { buildDialogStatementCatalog } = require(path.join(root, 'out/ui-dialog/statement-catalog'));
const { workspaceNpcDialogOffsets } = require(path.join(root, 'out/ui-dialog/offsets'));
const language = require(path.join(root, 'data/static-language.json'));
const XLSX = require(require.resolve('xlsx', { paths: [root] }));
const uri = file => pathToFileURL(path.join(root, file)).href;
const serialize = value => JSON.stringify(value).replace(/</g, '\u003c');
const key = values => JSON.stringify(Object.fromEntries(Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
function version(executable) {
  if (process.platform !== 'win32') return 'unavailable';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(Get-Item -LiteralPath $env:BOO_EXCEL_BROWSER).VersionInfo.ProductVersion'], {
    encoding: 'utf8', windowsHide: true, timeout: 10000, env: { ...process.env, BOO_EXCEL_BROWSER: executable },
  });
  return result.status === 0 ? result.stdout.trim() : 'unavailable';
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-preview-excel-browser-'));
const resolver = new ScriptDataResolver();
try {
  const envir = path.join(temporary, 'Mir200', 'Envir');
  const sourceFile = path.join(envir, 'Market_Def', 'ExcelPreview.txt');
  const workbookFile = path.join(envir, 'QuestDiary', '预览数据.xls');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.mkdirSync(path.dirname(workbookFile), { recursive: true });
  const source = [
    '[@main]', '#ACT', 'READEXCEL ..\\QuestDiary\\预览数据.xls <$STR(N0)>', '#SAY',
    // The flow link occupies the first flow line. Keep absolute fixture text
    // below it so the screenshot tests real readability, not overlapping nodes.
    '<TEXT:当前读取行 <$STR(N0)>:30:70>', '<TEXT:读取值 <$GLOBAL(Excel0)>:30:105>',
    '<TEXT:别名值 <$STR(EXCEL00)>:30:140>', '<缺失文件预览/@missing>', '#IF',
    'EQUAL EXCEL0 第二行', '#SAY', '<TEXT:条件分支 第二行已匹配:30:175>',
    '#ELSESAY', '<TEXT:条件分支 未匹配:30:175>',
    '[@missing]', '#ACT', 'READEXCEL ..\\QuestDiary\\missing.xls 1', '#SAY',
    '<TEXT:缺失文件 <$GLOBAL(Excel0)>:30:65>', '#IF', 'EQUAL EXCEL0 缺失手填',
    '#SAY', '<TEXT:缺失分支 手填值已匹配:30:105>', '#ELSESAY', '<TEXT:缺失分支 等待手填:30:105>',
  ].join('\r\n');
  const sourceBytes = Buffer.from(source, 'utf8');
  fs.writeFileSync(sourceFile, sourceBytes);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['第一行'], ['第二行']]), 'Data');
  const workbookBytes = Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'biff8' }));
  fs.writeFileSync(workbookFile, workbookBytes);
  const dataOptions = resolver.optionsFor(sourceFile, 'GOM');
  const reads = [];
  const safeRead = dataOptions.resolvePreviewExcelData;
  assert.equal(typeof safeRead, 'function', 'real provider must expose the safe Excel reader');
  dataOptions.resolvePreviewExcelData = request => { reads.push(request.path); return safeRead(request); };
  dataOptions.resolveTableData = () => assert.fail('Excel browser models must not bypass the dedicated safe provider');
  const initial = { N0: '1' };
  const states = [initial, { N0: '2' }, { N0: '99' }, { N0: '99', EXCEL0: '越界手填' },
    { N0: '99', EXCEL0: '缺失手填' }, { N0: '2', EXCEL0: '缺失手填' }, {}];
  const models = Object.fromEntries(states.map(values => [key(values), parseNpcDialogDocument(source, {
    uri: pathToFileURL(sourceFile).href, fileName: path.basename(sourceFile), filePath: sourceFile,
    documentVersion: 1, engine: 'GOM', engineLabel: 'GOM', cursorOffset: 2,
    offsets: workspaceNpcDialogOffsets(0, 0), catalog: buildDialogStatementCatalog(language, 'GOM'),
    previewValues: values, dataOptions,
  })]));
  assert.ok(reads.includes('..\\QuestDiary\\预览数据.xls'), 'real provider must read the existing BIFF8 file');
  assert.ok(reads.includes('..\\QuestDiary\\missing.xls'), 'missing-file fallback must also reach the safe provider');
  for (const model of Object.values(models)) {
    assert.equal(model.previewInputs.filter(input => input.name === 'EXCEL0').length, 1, 'GLOBAL and EXCEL00 must share one input');
  }
  assert.ok(models[key({ N0: '2' })].pages.flatMap(page => page.elements).some(element => element.text === '读取值 第二行'));

  let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
    .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css'))
    .replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
  const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  // Only the VS Code postMessage transport is replaced. Every model is built
  // above by the delivered real ScriptDataResolver and parser against actual
  // temporary BIFF8 files; this is not an Extension Host message-handler test.
  const bridge = `<script>
    window.fixtureModels=${serialize(models)};window.fixtureValues=${serialize(initial)};window.fixtureMessages=[];window.fixtureRevision=0;
    window.fixtureHistoryLength=history.length;window.fixtureWindowOpens=0;window.open=()=>{fixtureWindowOpens++;return null;};
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
  html = html.replace(renderer, () => bridge + renderer);
  const fixtureFile = path.join(temporary, 'fixture.html');
  html = html.replace('</body>', () => `<script>
    const check=(value,message)=>{if(!value)throw Error(message);};
    const wait=()=>new Promise(resolve=>setTimeout(resolve,80));
    const canvas=()=>document.getElementById('dialogCanvas');
    const field=name=>[...document.querySelectorAll('[data-preview-name]')].find(input=>input.dataset.previewName===name);
    const page=label=>[...document.querySelectorAll('.scene-button')].find(button=>button.querySelector('strong').textContent===label);
    const change=(input,value)=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));};
    const element=text=>{const nodes=[...canvas().querySelectorAll('[data-element-id]')];const node=nodes.find(node=>(node.querySelector('.element-text')?.textContent||node.textContent)===text);
      check(node,'missing '+text+' among '+JSON.stringify(nodes.map(item=>item.textContent)));return node;};
    const paint=node=>{check(node,'required control absent');node.scrollIntoView({block:'center',inline:'center'});
      const box=node.getBoundingClientRect(),style=getComputedStyle(node);
      check(box.width>0&&box.height>0,'control has no positive geometry');
      check(style.display!=='none'&&style.visibility==='visible'&&Number(style.opacity)>0,'control not visible');
      const hit=document.elementFromPoint(box.x+box.width/2,box.y+box.height/2);
      check(hit&&(hit===node||node.contains(hit)),'control cannot be hit: '+node.textContent+'; hit='+(hit&&hit.outerHTML.slice(0,150)));};
    const uniqueExcel=()=>{check([...document.querySelectorAll('[data-preview-name]')].filter(input=>input.dataset.previewName==='EXCEL0').length===1,'Excel alias duplicated');
      check(![...document.querySelectorAll('[data-preview-name]')].some(input=>/^GLOBAL\\(Excel0\\)$/i.test(input.dataset.previewName)),'unmerged GLOBAL alias remains');};
    const headerAndLink=row=>{const header=element('当前读取行 '+row),link=element('缺失文件预览');paint(header);paint(link);
      const a=header.getBoundingClientRect(),b=link.getBoundingClientRect();
      check(a.bottom<=b.top||b.bottom<=a.top||a.right<=b.left||b.right<=a.left,'row header overlaps the missing-file link');};
    window.addEventListener('load',async()=>{try{
      await wait();uniqueExcel();check(!document.body.dataset.fixtureHostError,'initial bridge missing model');
      headerAndLink('1');
      paint(element('读取值 第一行'));paint(element('别名值 第一行'));paint(element('条件分支 未匹配'));
      const number=field('N0');paint(number);check(number.value==='1','initial row control incorrect');number.focus();change(number,'2');await wait();
      check(number.isConnected&&document.activeElement===number,'row input replaced or focus lost');uniqueExcel();
      headerAndLink('2');
      paint(element('读取值 第二行'));paint(element('别名值 第二行'));paint(element('条件分支 第二行已匹配'));
      check(!canvas().textContent.includes('条件分支 未匹配'),'stale false branch retained after row change');
      change(number,'99');await wait();
      paint(element('读取值 预览文字'));check(!canvas().textContent.includes('第二行'),'out-of-range read retained old row');
      const excel=field('EXCEL0');paint(excel);excel.focus();change(excel,'越界手填');await wait();
      check(excel.isConnected&&document.activeElement===excel,'fallback input focus replaced');
      paint(element('读取值 越界手填'));paint(element('别名值 越界手填'));paint(element('条件分支 未匹配'));
      paint(page('@missing'));page('@missing').click();await wait();
      paint(element('缺失文件 越界手填'));paint(element('缺失分支 等待手填'));
      const missing=field('EXCEL0');paint(missing);missing.focus();change(missing,'缺失手填');await wait();
      paint(element('缺失文件 缺失手填'));paint(element('缺失分支 手填值已匹配'));uniqueExcel();
      paint(page('@main'));page('@main').click();await wait();
      change(field('N0'),'2');await wait();
      headerAndLink('2');
      paint(element('读取值 第二行'));paint(element('条件分支 第二行已匹配'));
      check(!canvas().textContent.includes('缺失手填'),'deterministic read failed to override fallback on valid row');
      check(fixtureMessages.some(message=>message.type==='previewInput'&&message.name==='N0'&&message.value==='2'),'row edit did not post canonical input');
      check(fixtureMessages.some(message=>message.type==='previewInput'&&message.name==='EXCEL0'&&message.value==='缺失手填'),'Excel edit did not post canonical input');
      check(!fixtureMessages.some(message=>['apply','save','previewCondition','openExternal','executeCommand'].includes(message.type)),'preview attempted source write or external execution');
      check(fixtureMessages.every(message=>['ready','previewInput'].includes(message.type)),'unexpected host request: '+JSON.stringify(fixtureMessages));
      check(!document.body.dataset.fixtureHostError,'unexpected bridge state');
      check(location.href===${serialize(pathToFileURL(fixtureFile).href)},'browser navigated');
      check(history.length===fixtureHistoryLength&&fixtureWindowOpens===0,'browser history/window changed');
      if(${Boolean(process.env.BOO_EXCEL_PREVIEW_SCREENSHOT)}){
        window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:fixtureModels[fixtureKey({N0:'2'})],previewRevision:++fixtureRevision,preserveDrafts:true}}));
        await wait();document.querySelector('.scene-pane').scrollTop=0;
      }
      document.body.dataset.previewExcel='PASS';
    }catch(error){document.body.dataset.previewExcel=error.stack;}});
  </script></body>`);
  fs.writeFileSync(fixtureFile, html);
  const candidates = [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
    .filter(executable => executable && fs.existsSync(executable)))];
  assert.ok(candidates.length, 'No installed Chromium candidate for Excel preview gate');
  const attempts = []; let passed = false;
  for (const [index, executable] of candidates.entries()) {
    const result = spawnSync(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
      `--user-data-dir=${path.join(temporary, `profile-${index}`)}`, '--window-size=1440,1000', '--virtual-time-budget=4000', '--dump-dom',
      ...(process.env.BOO_EXCEL_PREVIEW_SCREENSHOT ? [`--screenshot=${path.resolve(process.env.BOO_EXCEL_PREVIEW_SCREENSHOT)}`] : []),
      pathToFileURL(fixtureFile).href], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    if (!result.error && result.status === 0 && result.stdout.includes('data-preview-excel="PASS"')) {
      if (attempts.length) console.log(`Earlier browser attempts: ${attempts.join('\n')}`);
      console.log(`preview-excel-browser.test.js: PASS ${executable}; version=${version(executable)}; DOM=${(result.stdout.match(/data-element-id=/g) || []).length}; real BIFF8 provider-parser models, precomputed postMessage transport; rows/aliases/fallbacks/conditions painted and hittable`);
      passed = true; break;
    }
    attempts.push(`${executable}: ${result.error || result.stdout.match(/data-preview-excel="[^"]*"/)?.[0] || result.stderr}`);
  }
  assert.ok(passed, attempts.join('\n'));
  assert.ok(fs.readFileSync(sourceFile).equals(sourceBytes), 'browser preview must not alter NPC source bytes');
  assert.ok(fs.readFileSync(workbookFile).equals(workbookBytes), 'browser preview must not alter the source workbook');
} finally {
  resolver.dispose();
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('boo-preview-excel-browser-'));
  removeTemporaryDirectory(temporary);
}
