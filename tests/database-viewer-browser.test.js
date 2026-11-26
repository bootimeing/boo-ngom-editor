const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(process.env.BOO_DATABASE_RUNTIME_ROOT || path.join(__dirname, '..'));
const uri = value => ({ fsPath: value, toString: () => pathToFileURL(value).href });

function loadProductionViewer() {
  const filename = path.join(root, 'src/utils/database-viewer-webview.ts');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  const original = Module._load;
  Module._load = function (id, parent, isMain) {
    if (id === 'vscode') return { Uri: { joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) } };
    if (id === './webview-security' && parent?.filename === filename) {
      return original.call(this, path.join(root, 'out/utils/webview-security.js'), parent, isMain);
    }
    return original.call(this, id, parent, isMain);
  };
  try {
    loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      fileName: filename,
    }).outputText, filename);
    return loaded.exports;
  } finally { Module._load = original; }
}

function installedBrowser() {
  return [process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
  ].find(candidate => candidate && fs.existsSync(candidate));
}

async function main() {
  const browser = installedBrowser();
  assert.ok(browser, 'database-viewer-browser.test.js requires installed Chrome/Edge');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-database-viewer-'));
  try {
    const provider = loadProductionViewer();
    const context = { extensionUri: uri(root) };
    const webview = { cspSource: 'file:', asWebviewUri: value => value };
    let html = provider.databaseViewerWebviewHtml(context, webview);
    const nonce = html.match(/<script nonce="([a-z0-9]+)"/)?.[1];
    assert.ok(nonce, 'production loader must authorize its scripts with a nonce');
    assert.match(html, /script-src-attr 'none'/);
    assert.match(html, /frame-src 'none'/);
    assert.equal((html.match(/Content-Security-Policy/g) || []).length, 1);
    assert.doesNotMatch(html, /<iframe\b|database-detail-bridge\.js|databaseDetailSource/);
    assert.doesNotMatch(html, /\{\{[A-Z0-9_]+(?:_URI|_SOURCE)\}\}/);

    const hostMock = String.raw`
window.fixtureMessages=[];window.fixtureCsp=[];window.fixtureErrors=[];
window.fixtureSource='C:\\Fixture\\Mir200\\Database\\game.db';
window.addEventListener('securitypolicyviolation',event=>fixtureCsp.push(event.violatedDirective+': '+event.blockedURI));
window.addEventListener('error',event=>fixtureErrors.push(String(event.error?.stack||event.message)));
window.fixtureSend=message=>window.dispatchEvent(new MessageEvent('message',{data:message}));
function fixtureTable(id){
  const monster=id==='monsters',columns=monster?['Idx','Name','HP']:['Idx','Name','Price','Color'];
  return{id,name:monster?'Monster':'StdItems',label:monster?'怪物数据库':'物品数据库',fileName:'Fixture.db',kind:'sqlite',rowCount:1,columns,
    columnTypes:Object.fromEntries(columns.map(column=>[column,column==='Name'?'TEXT':'INTEGER'])),
    columnLabels:{},columnDescriptions:{},editable:true,schemaEditable:true,sortMode:'database'};
}
window.acquireVsCodeApi=()=>({postMessage:message=>{
  fixtureMessages.push(message);
  if(message.type==='ready')setTimeout(()=>fixtureSend({type:'databaseCatalog',dbType:'SQLite fixture',totalCount:2,
    sourcePath:fixtureSource,sourceDescription:'!Setup configured fixture',tables:['items','monsters'].map(fixtureTable)}),15);
  if(message.type==='loadDatabasePage')setTimeout(()=>fixtureSend({type:'databasePage',requestId:message.requestId,
    tableId:message.tableId,columns:fixtureTable(message.tableId).columns,
    rows:[message.tableId==='monsters'?{__booRowId:1,Idx:1,Name:'Fixture monster',HP:456}:{__booRowId:1,Idx:1,Name:'Fixture item',Price:88,Color:255}],
    offset:0,limit:100,total:1}),15);
}});
`;
    const firstScript = html.match(/<script nonce="[a-z0-9]+"[^>]*>/)?.[0];
    assert.ok(firstScript);
    html = html.replace(firstScript, `<script nonce="${nonce}">${hostMock}</script>${firstScript}`);

    const scenario = String.raw`
(function(){
  const check=(value,label)=>{if(!value)throw Error(label)};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function until(predicate,label){
    for(let attempt=0;attempt<180;attempt++){if(predicate())return;await wait(20)}
    throw Error(label);
  }
  async function run(){
    await until(()=>document.getElementById('table').dataset.ready==='true'&&!!document.querySelector('.tabulator-row'),'production table did not initialize');
    check(getComputedStyle(document.body).backgroundColor==='rgb(24, 26, 31)','original dark background was not restored');
    const tabs=document.getElementById('tabs');
    check(tabs.parentElement===document.body,'table tabs must occupy the original top-level horizontal navigation');
    check(getComputedStyle(tabs).flexDirection==='row','table navigation must be horizontal');
    check(!document.querySelector('.database-nav,.database-inline-detail,iframe'),'original table must not retain the redesigned navigation or embedded inspector');
    const main=document.querySelector('main'),pane=document.querySelector('.grid-pane');
    check(main.children.length===1&&main.children[0]===pane,'the table must occupy the main editing pane');
    check(Math.abs(main.getBoundingClientRect().width-pane.getBoundingClientRect().width)<2,'table pane no longer fills the available width');
    const name=document.querySelector('.tabulator-row [tabulator-field="Name"] .name-text');
    check(name&&getComputedStyle(name).color==='rgb(255, 255, 255)'&&!name.querySelector('.name-color-marker'),'original game name color rendering changed');
    check(document.getElementById('info').title.includes(fixtureSource)&&document.getElementById('info').title.includes('!Setup configured fixture'),'configured source path and description must remain inspectable');
    document.querySelector('.tabulator-row').click();
    await until(()=>fixtureMessages.some(message=>message.type==='showDatabaseDetail'),'item selection did not request the independent detail sidebar');
    let detail=fixtureMessages.filter(message=>message.type==='showDatabaseDetail').at(-1);
    check(detail.name==='Fixture item'&&detail.tableName==='StdItems'&&detail.fields.Price===88,'item sidebar selection payload changed');
    tabs.querySelectorAll('.tab')[1].click();
    await until(()=>document.querySelector('.tabulator-row')?.textContent.includes('Fixture monster'),'monster table did not load');
    check(fixtureMessages.some(message=>message.type==='clearDatabaseDetail'&&message.tableName==='Monster'),'table switch did not clear the independent detail sidebar');
    document.querySelector('.tabulator-row').click();
    await until(()=>fixtureMessages.some(message=>message.type==='showDatabaseDetail'&&message.name==='Fixture monster'),'monster selection did not reach the sidebar request');
    detail=fixtureMessages.filter(message=>message.type==='showDatabaseDetail').at(-1);
    check(detail.tableName==='Monster'&&detail.fields.HP===456,'monster sidebar selection payload changed');
    const oldRequest=fixtureMessages.filter(message=>message.type==='loadDatabasePage').at(-1);
    const messagesBeforeEmptyCatalog=fixtureMessages.length;
    fixtureSend({type:'databaseCatalog',dbType:'configured database unavailable',totalCount:0,tables:[]});
    await wait(35);
    check(databaseGrid===null&&currentTable===null&&currentRows.length===0&&currentColumns.length===0&&selectedRow===-1,'empty catalog retained the previous table state');
    check(!document.querySelector('.tabulator-row')&&document.getElementById('table').textContent.includes('未找到可读取的数据表'),'empty catalog did not remove previous visible rows');
    check(document.getElementById('addDatabaseRow').disabled,'empty catalog must disable record mutations');
    check(!document.getElementById('info').title.includes(fixtureSource),'empty catalog retained the unavailable source path');
    check(fixtureMessages.slice(messagesBeforeEmptyCatalog).some(message=>message.type==='clearDatabaseDetail'),'empty catalog must clear the independent detail sidebar');
    fixtureSend({type:'databasePage',requestId:oldRequest.requestId,tableId:'monsters',columns:['Idx','Name','HP'],
      rows:[{__booRowId:1,Idx:1,Name:'late stale monster',HP:999}],offset:0,limit:100,total:1});
    await wait(35);
    check(databaseGrid===null&&currentRows.length===0&&!document.querySelector('.tabulator-row')&&!document.getElementById('table').textContent.includes('late stale monster'),'late page response resurrected the unavailable database');
    check(fixtureCsp.length===0,'strict CSP rejected production content: '+fixtureCsp.join('; '));
    check(fixtureErrors.length===0,'production runtime errors: '+fixtureErrors.join('; '));
    document.body.dataset.testStatus='pass';
  }
  run().catch(error=>{document.body.dataset.testStatus='fail';document.body.dataset.testError=String(error.stack||error);document.body.dataset.testCspViolations=fixtureCsp.join('; ');document.body.dataset.testRuntimeErrors=fixtureErrors.join('; ')});
})();`;
    html = html.replace('</body>', `<script nonce="${nonce}">${scenario}</script></body>`);
    const fixture = path.join(temporary, 'production-database-viewer.html');
    fs.writeFileSync(fixture, html, 'utf8');
    const dom = await runChromiumDom(browser, fixture, path.join(temporary, 'profile'));
    const body = dom.match(/<body\b([^>]*)>/i)?.[1] || '';
    assert.match(body, /data-test-status="pass"/, body);
    console.log('database-viewer-browser.test.js: PASS (production loader and strict CSP, original dark horizontal layout, full-width table, sidebar selection payloads, source path, empty catalog and stale-page rejection)');
  } finally { removeTemporaryDirectory(temporary); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
