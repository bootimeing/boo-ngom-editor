// Execute the actual compiled/candidate handler statements, with an explicit VS Code transport double.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const runtime=path.resolve(process.env.BOO_PAK_RUNTIME_ROOT||path.join(__dirname,'..'));
const filename=path.join(runtime,'out/extension.js'),source=fs.readFileSync(filename,'utf8');
const parsed=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const names=['selectQuickImportFile','saveQuickImport','getQuickImports'],branches=new Map();
function visit(node){if(ts.isCaseClause(node)&&ts.isStringLiteral(node.expression)&&names.includes(node.expression.text))branches.set(node.expression.text,node.getText(parsed));ts.forEachChild(node,visit);}
visit(parsed);for(const name of names)assert.ok(branches.has(name),'compiled production handler '+name);
const javascript='async function handle(message){switch(message.type){'+[...branches.values()].join('\n')+'}}';
async function main(){
  const sent=[],writes=[],dialogs=[],roots=new Set();let saved={};
  const panel={webview:{postMessage:message=>{sent.push(message);return true;},asWebviewUri:uri=>({toString:()=>`webview:${uri.fsPath}`})}};
  const sandbox={currentPanel:panel,loadedPakEngine:'GOM',archiveOperationVersion:1,quickImportPickers:new Map(),resourceRootsSet:roots,
    path,fs:{existsSync:file=>file==='valid.png'},vscode:{Uri:{file:fsPath=>({fsPath})},window:{showOpenDialog:()=>new Promise((resolve,reject)=>dialogs.push({resolve,reject}))}},
    archive_resource_provider_1:{webviewResourceRoots:set=>[...set]},readQuickImports:()=>structuredClone(saved),quickImportsStateKey:engine=>'quick:'+engine,
    context:{workspaceState:{update:async(key,value)=>{writes.push({key,value});saved=structuredClone(value);}}}};
  vm.createContext(sandbox);vm.runInContext(javascript,sandbox);
  const base={type:'selectQuickImportFile',importType:'closeBtn',requestId:1,sessionId:1};
  for(const invalid of [{requestId:undefined},{requestId:NaN},{requestId:-1},{sessionId:0},{sessionId:1.5},{importType:'unknown'},{subType:'bg'},
    {importType:'progressBar',subType:'nope'},{importType:'progressBar'}])await sandbox.handle({...base,...invalid});
  assert.equal(dialogs.length,0,'malformed identities/channels never open OS picker');
  let task=sandbox.handle(base);dialogs.shift().resolve([{fsPath:'local/frame.png'}]);await task;
  assert.deepEqual(JSON.parse(JSON.stringify(sent.pop())),{type:'loadQuickImport',importType:'closeBtn',requestId:1,sessionId:1,name:'frame.png',url:'webview:local/frame.png',filePath:'local/frame.png'});
  assert.equal(writes.length,0,'picker has no implicit persistence');
  const first=sandbox.handle({...base,requestId:2}),second=sandbox.handle({...base,requestId:3});
  const old=dialogs.shift(),latest=dialogs.shift();const rootCount=roots.size;
  old.resolve([{fsPath:'old/late.png'}]);await first;assert.equal(sent.length,0);assert.equal(roots.size,rootCount,'old request cannot authorize resource root');
  latest.resolve([{fsPath:'new/current.png'}]);await second;assert.equal(sent.pop().requestId,3);
  for(const boundary of ['currentPanel','loadedPakEngine','archiveOperationVersion']){
    const previous=sandbox[boundary];task=sandbox.handle({...base,requestId:4});
    sandbox[boundary]=boundary==='currentPanel'?{webview:panel.webview}:boundary==='loadedPakEngine'?'GEE':previous+1;
    const before=roots.size;dialogs.shift().resolve([{fsPath:'wrong-boundary/leak.png'}]);await task;
    assert.equal(sent.length,0,boundary+' rejects stale picker response');assert.equal(roots.size,before,boundary+' rejects stale resource roots');sandbox[boundary]=previous;
  }
  task=sandbox.handle({...base,requestId:5});dialogs.shift().resolve(undefined);await task;
  assert.equal(sent.at(-1).cancelled,true);assert.equal(sent.pop().sessionId,1);
  task=sandbox.handle({...base,requestId:6});dialogs.shift().reject(Error('secret/path'));await task;
  const failure=sent.pop();assert.ok(failure.error);assert.equal(failure.requestId,6);assert.equal(JSON.stringify(failure).includes('secret/path'),false);
  const bg=sandbox.handle({...base,importType:'progressBar',subType:'bg',requestId:7}),fill=sandbox.handle({...base,importType:'progressBar',subType:'fill',requestId:8});
  dialogs.shift().resolve([{fsPath:'bg.png'}]);dialogs.shift().resolve([{fsPath:'fill.png'}]);await Promise.all([bg,fill]);
  assert.deepEqual(sent.map(message=>message.subType),['bg','fill']);sent.length=0;assert.equal(writes.length,0);assert.equal(sandbox.quickImportPickers.size,0);
  const identity={name:'slot',filePath:'',imageIdx:999999,willIdx:0,pakName:'million.pak',archiveId:'a'.repeat(64)};
  for(const type of ['closeBtn','equipFrame']){
    await sandbox.handle({type:'saveQuickImport',importType:type,...identity,assetIdx:4,url:'stale://old'});
    assert.deepEqual(JSON.parse(JSON.stringify(saved[type])),{...identity,isDefault:false},type+' preserves logical identity, not array position or URL');
  }
  let count=writes.length;await sandbox.handle({type:'saveQuickImport',importType:'__proto__',name:'bad'});assert.equal(writes.length,count);
  await sandbox.handle({type:'getQuickImports'});const restored=sent.pop();
  assert.deepEqual(Array.from(restored.invalidTypes),[]);assert.equal(writes.length,count,'direct no-path selections not deleted');
  for(const type of ['closeBtn','equipFrame']){assert.equal(restored.imports[type].imageIdx,999999);assert.equal(restored.imports[type].willIdx,0);assert.equal(restored.imports[type].archiveId,identity.archiveId);assert.equal(restored.imports[type].url,'');}
  await sandbox.handle({type:'saveQuickImport',importType:'closeBtn',name:'local',filePath:'valid.png'});
  await sandbox.handle({type:'getQuickImports'});assert.equal(sent.pop().imports.closeBtn.url,'webview:valid.png');
  saved.closeBtn={name:'gone',filePath:'missing.png'};await sandbox.handle({type:'getQuickImports'});
  assert.deepEqual(Array.from(sent.pop().invalidTypes),['closeBtn']);assert.equal(saved.closeBtn,undefined,'missing local file still invalidates');
  const progress={bg:{...identity},fill:{...identity},willIdx:0,offsetX:-4,offsetY:8};
  await sandbox.handle({type:'saveQuickImport',importType:'progressBar',data:progress});await sandbox.handle({type:'getQuickImports'});
  const restoredProgress=sent.pop().imports.progressBar;assert.equal(restoredProgress.bg.imageIdx,999999);assert.equal(restoredProgress.willIdx,0);assert.equal(restoredProgress.offsetX,-4);
  console.log('quick-import-protocol.test.js: PASS (actual '+filename+' branches; mocked VS Code transport; request/session echo, stale panel/engine/source rejection, explicit persistence, stable metadata)');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
