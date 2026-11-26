const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { secureWebviewHtml } = require('../out/utils/webview-security');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

async function main() {
  const browser = [process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
  ].find(candidate => candidate && fs.existsSync(candidate));
  assert.ok(browser, 'a real Chromium browser is required for the detail action regression');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-detail-actions-browser-'));
  try {
    const mock = `<script>
window.__messages=[];
window.acquireVsCodeApi=()=>({getState:()=>({}),setState:value=>{window.__saved=value},postMessage:value=>window.__messages.push(value)});
</script>`;
    const scenario = `<script>
(() => {try {
  const check=(value,label)=>{if(!value)throw Error(label)};
  const send=data=>window.dispatchEvent(new MessageEvent('message',{data}));
  const item={type:'showDatabaseDetail',name:'木剑',detailKind:'item',fields:{Name:'木剑',Idx:1,StdMode:5,Dc:3,Dc2:8,NeedLevel:20,Price:88},topDesc:'原备注',itemDesc:'物品说明'};
  send(item);
  check(getComputedStyle(document.body).backgroundColor==='rgb(24, 26, 31)','original dark background missing');
  check(getComputedStyle(document.querySelector('.item-name')).color==='rgb(255, 140, 0)','original orange record name missing');
  check(document.querySelector('.prop-table').rows.length===Object.keys(item.fields).length,'compact property rows missing');
  check(document.querySelector('.prop-table tr').cells[0].textContent==='名字','original compact field label missing');
  let textarea=document.getElementById('ta_topDesc');
  textarea.value='第一次保存';textarea.dispatchEvent(new Event('input',{bubbles:true}));
  document.getElementById('save_desc_topDesc').click();
  check(document.getElementById('ta_topDesc')===textarea,'saving rebuilt the active text editor');
  check(document.getElementById('save_desc_topDesc').disabled,'pending item save not disabled');
  check(window.__messages.at(-1).type==='saveItemDesc'&&window.__messages.at(-1).text==='第一次保存','delegated save did not dispatch under strict CSP');
  send({type:'itemDescSaveResult',name:'其他物品',key:'topDesc',ok:false,message:'错误记录'});
  check(document.getElementById('save_desc_topDesc').disabled,'foreign result released the pending save');
  send({type:'itemDescSaveResult',name:'木剑',key:'topDesc',ok:false,message:'磁盘只读，请重试'});
  check(textarea.value==='第一次保存','failed save discarded the draft');
  check(!document.getElementById('save_desc_topDesc').disabled,'failed save cannot be retried');
  check(document.getElementById('status_desc_topDesc').classList.contains('error'),'failed save was not visible');
  document.getElementById('save_desc_topDesc').click();
  send({...item,topDesc:'第一次保存',fields:{},preserveSelectionVisuals:true});
  send({type:'itemDescSaveResult',name:'木剑',key:'topDesc',ok:true,message:'已保存'});
  check(document.getElementById('status_desc_topDesc').classList.contains('success'),'successful save was not visible');
  check(_detail._topDescEdited===undefined,'saved draft was not cleared');
  textarea=document.getElementById('ta_topDesc');
  textarea.value='已提交的旧草稿';textarea.dispatchEvent(new Event('input',{bubbles:true}));
  document.getElementById('save_desc_topDesc').click();
  textarea.value='等待期间输入的新草稿';textarea.dispatchEvent(new Event('input',{bubbles:true}));
  send({...item,topDesc:'已提交的旧草稿',fields:{},preserveSelectionVisuals:true});
  send({type:'itemDescSaveResult',name:'木剑',key:'topDesc',ok:true,message:'已保存'});
  check(document.getElementById('ta_topDesc').value==='等待期间输入的新草稿','refresh discarded newer typing');
  check(document.getElementById('status_desc_topDesc').classList.contains('dirty'),'newer draft was incorrectly marked saved');
  send({...item,fieldsOnly:true});
  send({type:'itemDescSaveResult',name:'木剑',key:'topDesc',ok:false,message:'过期错误'});
  check(!document.querySelector('button,textarea,img'),'external fields-only controls leaked');
  send(item);
  check(!document.getElementById('save_desc_topDesc').disabled,'stale pending save followed a new selection');
  send({type:'showDatabaseDetail',name:'白野猪',detailKind:'monster',fields:{Name:'白野猪',HP:456,Level:12,Race:81},dropRateText:'1/2 木剑',iconText:'7 1'});
  textarea=document.getElementById('ta_dropRateText');textarea.value='1/3 木剑';textarea.dispatchEvent(new Event('input',{bubbles:true}));
  check(_detail._dropRateTextEdited==='1/3 木剑','delegated monster input did not keep draft');
  textarea.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true,cancelable:true}));
  check(window.__messages.at(-1).type==='saveMonsterDetail'&&window.__messages.at(-1).text==='1/3 木剑','delegated monster Ctrl+S failed');
  check(!document.querySelector('[onclick],[oninput],[onkeydown]'),'inline HTML events returned');
  document.body.dataset.testStatus='pass';
}catch(error){document.body.dataset.testStatus='fail';document.body.dataset.testError=String(error.stack||error)}})();
</script>`;
    const source = fs.readFileSync(path.join(__dirname, '../media/sidebar-detail.html'), 'utf8');
    const html = secureWebviewHtml({ cspSource: 'https://test.vscode-cdn.net' },
      source.replace('<script>', mock + '<script>').replace('</body>', scenario + '</body>'));
    assert.match(html, /script-src-attr 'none'/);
    const file = path.join(temporary, 'detail-actions.html');
    fs.writeFileSync(file, html, 'utf8');
    const dom = await runChromiumDom(browser, file, path.join(temporary, 'profile'));
    assert.match(dom.match(/<body\b[^>]*>/)?.[0] || '', /data-test-status="pass"/);
    console.log('database-detail-actions-browser.test.js: PASS (strict CSP delegation, local save feedback, failed retry, newer drafts, fields-only and selection isolation)');
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
