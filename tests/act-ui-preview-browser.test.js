const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');

function findChromiumBrowsers() {
  const candidates = [
    process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(candidate => candidate && fs.existsSync(candidate));
  return [...new Set(candidates.map(candidate => path.resolve(candidate)))];
}

function browserVersion(executable) {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Item -LiteralPath $env:BOO_BROWSER_VERSION_EXECUTABLE).VersionInfo.ProductVersion',
    ], { encoding: 'utf8', timeout: 5000, windowsHide: true,
      env: { ...process.env, BOO_BROWSER_VERSION_EXECUTABLE: executable } });
    const value = String(result.stdout || '').trim().split(/\r?\n/, 1)[0];
    if (!result.error && result.status === 0 && value) return value;
  }
  return '<unknown>';
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, ...relativePath.split('/'))).href;
}

function decodeAttribute(value) {
  return String(value || '').replaceAll('&quot;', '"').replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

function browserDiagnostic(candidate, result) {
  const stderr = String(result.stderr || '').trim().replace(/\r?\n/g, '\\n') || '<empty>';
  return `${candidate}: status=${result.status}, signal=${result.signal || '<none>'}, `
    + `error=${result.error?.message || '<none>'}, `
    + `body=${/<body\b/i.test(result.stdout || '')}, stderr=${stderr}`;
}

function parseModel() {
  const source = [
    '[@main]',
    '#ACT',
    'MOV S$KNOWN 已确定提示',
    'MOV S$HINT 已确定滚动提示',
    'MESSAGEBOX 系统提示：<$STR(S$KNOWN)> @确定 @取消',
    'MESSAGEBOX 系统提示：<$STR(S$UNKNOWN)>，数量<$STR(N$UNKNOWN)> @<$STR(S$CONFIRM)> @取消',
    'SHOWPROGRESSBARDLG <$STR(N$SECONDS)> @完成 正在采集<$STR(S$PROGRESS)> 1 @中断',
    'PLAYWINDOWEFFECT 0 1 <$STR(N$WIL)> 10 12 100 1 8 9 1|1',
    'SENDMOVEHINTMSG 提示：<$STR(S$HINT)> 249 0 <$STR(N$X)> 60 1',
    'OPENUPGRADEDLG 升级<$STR(S$UPGRADE)>',
    'OPENCLIENTDLG 15 2 100 20',
    'OPENCLIENTDLG <$STR(N$DIALOG)> 2 <$STR(N$X)> 20',
    '#SAY',
    '<Text:ACT UI 卡片覆盖层>',
  ].join('\n');
  const model = parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/act-ui-browser.txt',
    fileName: 'act-ui-browser.txt', filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\act-ui-browser.txt',
    documentVersion: 1, engine: 'GOM', engineLabel: 'GOM', cursorOffset: source.indexOf('#SAY') + 5,
    offsets: workspaceNpcDialogOffsets(0, 0), catalog: buildDialogStatementCatalog(staticLanguage, 'GOM'),
  });
  model.canvasWidth = 600; model.canvasHeight = 360;
  return model;
}

function runBrowserMatrix() {
  const candidates = findChromiumBrowsers();
  if (!candidates.length) { console.log('act-ui-preview-browser.test.js: SKIP (Edge/Chrome is not installed)'); return []; }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-act-ui-browser-'));
  try {
    const harness = path.join(temporary, 'act-ui-preview.html');
    let html = fs.readFileSync(path.join(root, 'media', 'npc-dialog-visual.html'), 'utf8')
      .replaceAll('{{STYLE_URI}}', resourceUri('media/npc-dialog-visual.css'))
      .replaceAll('{{SCRIPT_URI}}', resourceUri('media/npc-dialog-visual.js'));
    const mock = `<script>
window.__model=${JSON.stringify(parseModel())};window.__postedMessages=[];window.__openedLinks=[];
window.open=function(){window.__openedLinks.push(Array.from(arguments));return null;};
window.__historyCalls=[];for(const method of ['pushState','replaceState']){const old=history[method];history[method]=function(){window.__historyCalls.push(method);return old.apply(this,arguments);};}
window.acquireVsCodeApi=function(){return{postMessage:function(message){window.__postedMessages.push(message);if(message.type==='ready')setTimeout(function(){window.dispatchEvent(new MessageEvent('message',{data:{type:'model',model:window.__model,previewRevision:1,preserveDrafts:false,geeOffsetHelp:''}}));},0);}}};
</script>`;
    html = html.replace(`<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`, `${mock}<script src="${resourceUri('media/npc-dialog-visual.js')}"></script>`);
    const scenario = `<script>
(function(){
 document.body.dataset.actUiTest='boot';
 function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms);});}
 function byId(id){return document.querySelector('[data-act-ui-card-id="'+id+'"]');}
 function findField(wrapper,name){return wrapper&&wrapper.querySelector('.act-ui-field[data-act-ui-field="'+name+'"]');}
 async function run(){
  for(var i=0;i<50&&!document.querySelector('.act-ui-preview-card');i++)await wait(20);
  var cards=Array.from(document.querySelectorAll('.act-ui-preview-card')),errors=[];
  if(cards.length!==8)errors.push('expected 8 ACT cards, got '+cards.length);
  var order=cards.map(function(c){return c.dataset.actUiCommand;}).join(',');
  if(order!=='messagebox,messagebox,show-progress-bar,play-window-effect,send-move-hint,open-upgrade-dialog,open-client-dialog,open-client-dialog')errors.push('source order not preserved: '+order);
  cards.forEach(function(c){var rect=c.getBoundingClientRect();if(c.dataset.actUiSimulation!=='partial')errors.push(c.dataset.actUiCardId+' lacks partial boundary');if(c.dataset.actUiLocalOnly!=='true')errors.push(c.dataset.actUiCardId+' is not local-only');if(!(rect.width>150&&rect.height>30))errors.push(c.dataset.actUiCardId+' has no positive visible geometry: '+rect.width+'x'+rect.height);if(c.closest('#dialogCanvas'))errors.push(c.dataset.actUiCardId+' leaked into coordinate canvas');});
  var messages=cards.filter(function(c){return c.dataset.actUiCommand==='messagebox';});
  var known=findField(messages[0],'message'),unknown=findField(messages[1],'message'),unknownConfirm=findField(messages[1],'confirm-label');
  if(!known||known.querySelector('.act-ui-field-value')?.textContent!=='系统提示：已确定提示')errors.push('resolved MessageBox text was not displayed');
  if(!unknown||unknown.querySelector('.act-ui-field-value')?.textContent!=='系统提示：预览文字，数量0')errors.push('unknown MessageBox text/number placeholders are wrong');
  if(!unknownConfirm||unknownConfirm.querySelector('.act-ui-field-value')?.textContent!=='@预览文字')errors.push('unknown @ label did not get a text placeholder');
  var label=unknownConfirm&&unknownConfirm.querySelector('.act-ui-field-value');if(label){var style=getComputedStyle(label);if(style.color!=='rgb(255, 255, 0)')errors.push('@ label is not yellow: '+style.color);if(style.textDecorationLine.indexOf('underline')<0)errors.push('@ label is not underlined: '+style.textDecorationLine);if(label.tagName==='BUTTON'||label.tagName==='A'||label.getAttribute('role')==='button')errors.push('@ label became an executable control');}
  var panel=document.querySelector('#actUiPreviewPanel');if(String(panel&&panel.textContent||'').toUpperCase().includes('$STR('))errors.push('raw runtime expression leaked into default ACT card text');
  for(var pair of [['show-progress-bar','duration-seconds'],['play-window-effect','will-index'],['send-move-hint','x']]){var target=cards.find(function(c){return c.dataset.actUiCommand===pair[0];}),f=findField(target,pair[1]),shown=String(f&&f.querySelector('.act-ui-field-value')?.textContent||'').trim();if(!f||f.dataset.actUiFieldStatus!=='dynamic')errors.push(pair.join('/')+' lost dynamic source gate');if(f&&(shown.toUpperCase().includes('$STR(')||shown==='0'))errors.push(pair.join('/')+' used raw/0 to unlock runtime state');}
  var upgrade=cards.find(function(c){return c.dataset.actUiCommand==='open-upgrade-dialog';});if(findField(upgrade,'title')?.querySelector('.act-ui-field-value')?.textContent!=='升级预览文字')errors.push('upgrade title placeholder is not visible');
  var clients=cards.filter(function(c){return c.dataset.actUiCommand==='open-client-dialog';});if(!/背包/.test(clients[0]&&clients[0].textContent||''))errors.push('static GOM ID 15 mapping missing');if(findField(clients[1],'dialog-name'))errors.push('placeholder 0 unlocked a client dialog mapping');if(String(clients[1]&&clients[1].textContent||'').toUpperCase().includes('$STR('))errors.push('dynamic client ID leaked raw source');
  var warning=cards[0]&&cards[0].querySelector('.act-ui-preview-warning'),boundary=cards[0]&&cards[0].querySelector('.act-ui-preview-boundary'),status=cards[0]&&cards[0].querySelector('.act-ui-field-status');if(!warning||getComputedStyle(warning).display!=='none'||!boundary||getComputedStyle(boundary).display!=='none'||!status||getComputedStyle(status).display!=='none')errors.push('ACT diagnostics are not opt-in by default');
  document.querySelector('#canvasDiagnosticsToggle')?.click();await wait(20);if(getComputedStyle(warning).display==='none'||getComputedStyle(boundary).display==='none'||getComputedStyle(status).display==='none')errors.push('diagnostics toggle did not reveal ACT diagnostics');
  if(document.querySelector('#dialogCanvas')?.textContent.match(/MESSAGEBOX|SHOWPROGRESSBARDLG|PLAYWINDOWEFFECT|SENDMOVEHINTMSG|OPENUPGRADEDLG|OPENCLIENTDLG/i))errors.push('#ACT command leaked into canvas text');
  var hits=cards.flatMap(function(c){return Array.from(c.querySelectorAll('button,[role=button],a'));});if(hits.length)errors.push('ACT cards contain executable controls');
  var postStart=window.__postedMessages.length,href=location.href;cards.forEach(function(card){card.click();});await wait(30);
  if(window.__postedMessages.slice(postStart).length)errors.push('ACT card interaction posted a host/server message');if(window.__openedLinks.length||location.href!==href||window.__historyCalls.length)errors.push('ACT card interaction opened/navigated/history-mutated');
  document.body.dataset.actUiDomCount=String(document.querySelectorAll('*').length);document.body.dataset.actUiTest=errors.length?'fail':'pass';if(errors.length)document.body.dataset.actUiErrors=errors.join(' || ');
 }
 run().catch(function(error){document.body.dataset.actUiDomCount=String(document.querySelectorAll('*').length);document.body.dataset.actUiTest='fail';document.body.dataset.actUiErrors=error&&error.stack?error.stack:String(error);});
}());
</script>`;
    fs.writeFileSync(harness, html.replace('</body>', `${scenario}</body>`), 'utf8');
    const attempts = []; let selected;
    for (let index = 0; index < candidates.length; index++) {
      const result = spawnSync(candidates[index], [
        '--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--no-first-run', '--allow-file-access-from-files',
        `--user-data-dir=${path.join(temporary, `profile-${index}`)}`, '--window-size=1100,800', '--virtual-time-budget=1800', '--dump-dom', pathToFileURL(harness).href,
      ], { encoding: 'utf8', timeout: 25000, maxBuffer: 12 * 1024 * 1024 });
      attempts.push({ candidate: candidates[index], result });
      if (!result.error && result.status === 0 && /<body\b/i.test(result.stdout || '') && /data-act-ui-test=/i.test(result.stdout || '')) { selected = { candidate: candidates[index], result }; break; }
    }
    if (!selected) return [`[browser] no installed candidate produced a completed DOM:\n${attempts.map(
      ({ candidate, result }) => browserDiagnostic(candidate, result)
    ).join('\n')}`];
    for (const { candidate, result } of attempts) {
      if (candidate === selected.candidate) break;
      console.log(`act-ui-preview-browser.test.js: candidate-failure=${browserDiagnostic(candidate, result)}`);
    }
    const domCount = /data-act-ui-dom-count="([0-9]+)"/.exec(selected.result.stdout)?.[1] || '<missing>';
    console.log(`act-ui-preview-browser.test.js: browser=${selected.candidate}`);
    console.log(`act-ui-preview-browser.test.js: version=${browserVersion(selected.candidate)}`);
    console.log(`act-ui-preview-browser.test.js: DOM=${domCount}`);
    return /data-act-ui-test="pass"/.test(selected.result.stdout) ? [] : [decodeAttribute(/data-act-ui-errors="([^"]*)"/.exec(selected.result.stdout)?.[1])];
  } finally { if (process.env.BOO_KEEP_ACT_UI_TEST_TEMP === '1') console.log(`act-ui-preview-browser.test.js: retained=${temporary}`); else removeTemporaryDirectory(temporary); }
}

const failures = runBrowserMatrix();
if (failures.length) { console.error('act-ui-preview-browser.test.js: RED FAILURE MATRIX'); failures.forEach(value => console.error(`- ${value}`)); process.exitCode = 1; }
else console.log('act-ui-preview-browser.test.js: PASS');
