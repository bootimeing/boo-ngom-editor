const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(process.env.BOO_TEST_ROOT || path.join(__dirname, '..'));
const out = path.resolve(process.env.BOO_DATABASE_SCROLL_OUT || 'artifacts/database-scroll-retention');
const sourceFile = path.resolve(process.env.BOO_DATABASE_SCROLL_SOURCE_PATH || path.join(root, 'media/database-viewer.html'));
const encode = value => JSON.stringify(value).replace(/</g, '\\u003c');

function browsers() {
  return [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
  ].filter(file => file && fs.existsSync(file)).map(file => path.resolve(file)))];
}

async function main() {
  const candidates = browsers();
  assert.ok(candidates.length, 'database-grid-scroll-retention-browser.test.js requires an installed Chrome/Edge');
  fs.mkdirSync(out, { recursive: true });
  const original = fs.readFileSync(sourceFile, 'utf8');
  fs.writeFileSync(path.join(out, 'database-viewer-source.html'), original);
  const sourceSha256 = crypto.createHash('sha256').update(original).digest('hex');
  const uri = relative => pathToFileURL(path.join(root, relative)).href;
  let html = original.replaceAll('{{TABULATOR_CSS_URI}}', uri('media/vendor/tabulator/tabulator_midnight.min.css'))
    .replaceAll('{{TABLE_EDITOR_CORE_URI}}', uri('media/table-editor-core.js'))
    .replaceAll('{{TABULATOR_JS_URI}}', uri('media/vendor/tabulator/tabulator.min.js'));
  const mock = `<script>
  window.fixtureMessages=[];window.fixtureRefreshes=0;window.fixtureMutationMode='normal';window.fixtureTrace=[];
  window.fixtureColumns=['Idx','Name','StdMode','Price','Color'].concat(Array.from({length:35},(_,i)=>'Value'+(i+1)));
  window.fixtureRows={};
  function resetRows(count=320){
    window.fixtureUndo=null;
    window.fixtureColumns=['Idx','Name','StdMode','Price','Color'].concat(Array.from({length:35},(_,i)=>'Value'+(i+1)));
    for(const id of ['items','monsters'])window.fixtureRows[id]=Array.from({length:count},(_,i)=>{
      const row={__booRowId:i+1,Idx:i+(id==='monsters'?5000:0),Name:'滚动夹具'+id+i,StdMode:5,Price:i*10,Color:249};
      for(let column=1;column<=35;column++)row['Value'+column]=i+column;return row;
    });
  }
  resetRows();
  function fixtureTable(id){const columns=window.fixtureColumns.slice();return{id,name:id==='items'?'StdItems':'Monsters',label:id==='items'?'物品数据库':'怪物数据库',fileName:'Synthetic.db',kind:'sqlite',rowCount:window.fixtureRows[id].length,columns,columnTypes:Object.fromEntries(columns.map(field=>[field,field==='Name'?'TEXT':'INTEGER'])),columnLabels:{Name:'名称',Price:'价格'},editable:true,schemaEditable:true,sortMode:'database'};}
  function fixtureSend(message){window.dispatchEvent(new MessageEvent('message',{data:message}));}
  function fixtureCatalog(){fixtureSend({type:'databaseCatalog',dbType:'Synthetic SQLite - no filesystem writes',totalCount:640,tables:['items','monsters'].map(fixtureTable)});}
  window.addEventListener('error',event=>{window.fixtureTrace.push({event:'error',message:event.error?.stack||event.message});});
  function traceViewport(event,message){const holder=document.querySelector('.tabulator-tableholder');const range=window.databaseGrid?.getRanges?.().at(-1);window.fixtureTrace.push({event,type:message.type,offset:message.offset,top:holder?.scrollTop,left:holder?.scrollLeft,height:holder?.scrollHeight,width:holder?.scrollWidth,range:range?{top:range.getTopEdge(),bottom:range.getBottomEdge(),left:range.getLeftEdge(),right:range.getRightEdge()}:null});}
  window.acquireVsCodeApi=()=>({postMessage:message=>{
    window.fixtureMessages.push(message);
    if(message.type==='ready')setTimeout(fixtureCatalog,10);
    if(message.type==='loadDatabasePage')setTimeout(()=>{
      traceViewport('before-page-response',message);const offset=Number(message.offset)||0,limit=Number(message.limit)||100;
      fixtureSend({type:'databasePage',requestId:message.requestId,tableId:message.tableId,columns:window.fixtureColumns.slice(),rows:window.fixtureRows[message.tableId].slice(offset,offset+limit).map(row=>({...row})),offset,limit,total:window.fixtureRows[message.tableId].length,query:'',searchColumn:'',matchMode:'contains',filters:[],sortColumn:message.sortColumn||'',sortDirection:message.sortDirection||'asc'});
      window.fixtureRefreshes++;traceViewport('after-page-response',message);
    },25);
    if(['updateDatabaseRow','updateDatabaseRows'].includes(message.type)){
      traceViewport('mutation-dispatch',message);
      setTimeout(()=>{
        const updates=message.type==='updateDatabaseRow'?[{rowId:message.rowId,values:message.values}]:(message.updates||[]);
        if(window.fixtureMutationMode==='error'){window.fixtureMutationMode='normal';fixtureSend({type:'databaseMutationError',requestId:message.requestId,error:'Synthetic write failure; no file touched'});return;}
        window.fixtureUndo={tableId:message.tableId,rowId:updates[0]?.rowId,columns:window.fixtureColumns.slice(),rows:window.fixtureRows[message.tableId].map(row=>({...row}))};
        for(const update of updates){const row=window.fixtureRows[message.tableId].find(row=>Number(row.__booRowId)===Number(update.rowId));if(row)Object.assign(row,update.values);}
        if(window.fixtureMutationMode==='rebuild'){window.fixtureColumns.push('AddedColumn');for(const row of window.fixtureRows[message.tableId])row.AddedColumn=7;}
        if(window.fixtureMutationMode==='shrink'){window.fixtureColumns=['Idx','Name','StdMode','Price'];window.fixtureRows[message.tableId]=window.fixtureRows[message.tableId].slice(0,8);}
        if(window.fixtureMutationMode==='identity'){
          const rows=window.fixtureRows[message.tableId],position=rows.findIndex(row=>Number(row.__booRowId)===Number(updates[0].rowId));
          [rows[position],rows[position+1]]=[rows[position+1],rows[position]];window.fixtureColumns.splice(5,0,'InsertedColumn');for(const row of rows)row.InsertedColumn=8;
        }
        window.fixtureMutationMode='normal';
        fixtureSend({type:'databaseMutationResult',requestId:message.requestId,result:{operation:'update',tableId:message.tableId,rowCount:window.fixtureRows[message.tableId].length,rowId:updates[0]?.rowId,backupPath:'Synthetic-memory-only.bak'},table:fixtureTable(message.tableId),totalCount:640});
      },25);
    }
    if(message.type==='createDatabaseRow')setTimeout(()=>{
      const rows=window.fixtureRows[message.tableId],index=rows.length,row={__booRowId:index+1,Idx:index,Name:'新增滚动夹具',StdMode:5,Price:0,Color:249};
      for(let column=1;column<=35;column++)row['Value'+column]=index+column;
      Object.assign(row,message.values);rows.push(row);
      fixtureSend({type:'databaseMutationResult',requestId:message.requestId,result:{operation:'create',tableId:message.tableId,rowCount:rows.length,rowId:row.__booRowId,backupPath:'Synthetic-memory-only-create.bak'},table:fixtureTable(message.tableId),totalCount:rows.length+window.fixtureRows[message.tableId==='items'?'monsters':'items'].length});
    },25);
    if(message.type==='undoDatabaseMutation')setTimeout(()=>{
      const previous=window.fixtureUndo;if(!previous){fixtureSend({type:'databaseUndoError',requestId:message.requestId,error:'No synthetic undo'});return;}
      window.fixtureColumns=previous.columns.slice();window.fixtureRows[previous.tableId]=previous.rows.map(row=>({...row}));window.fixtureUndo=null;
      fixtureSend({type:'databaseUndoResult',requestId:message.requestId,result:{revertedOperation:'update',tableId:previous.tableId,rowId:previous.rowId,backupPath:'Synthetic-memory-only-undo.bak'},catalog:{dbType:'Synthetic SQLite',totalCount:640,tables:['items','monsters'].map(fixtureTable)}});
    },25);
  }});
  </script>`;
  const coreTag = `<script src="${uri('media/table-editor-core.js')}"></script>`;
  html = html.replace(coreTag, () => mock + coreTag);
  html = html.replace('</body>', () => `<script>
  const failures=[],observations=[];
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=(condition,message)=>{if(!condition)throw Error(message);};
  async function until(predicate,label){for(let attempt=0;attempt<180;attempt++){if(predicate())return;await wait(15);}throw Error(label);}
  const holder=()=>document.querySelector('.tabulator-tableholder');
  const snapshot=()=>{const h=holder(),range=window.databaseGrid?.getRanges?.().at(-1);return{top:h.scrollTop,left:h.scrollLeft,maxTop:Math.max(0,h.scrollHeight-h.clientHeight),maxLeft:Math.max(0,h.scrollWidth-h.clientWidth),height:h.clientHeight,width:h.clientWidth,range:range?{top:range.getTopEdge(),bottom:range.getBottomEdge(),left:range.getLeftEdge(),right:range.getRightEdge()}:null,selected:[...document.querySelectorAll('.tabulator-cell.tabulator-range-selected[tabulator-field]')].map(cell=>({row:Number(cell.closest('.tabulator-row').querySelector('[tabulator-field="Idx"]')?.textContent.trim()),field:cell.getAttribute('tabulator-field')}))};};
  const rowIndex=cell=>Number(cell.closest('.tabulator-row').querySelector('[tabulator-field="Idx"]').textContent.trim());
  const cellFor=(index,field)=>[...document.querySelectorAll('.tabulator-row')].find(row=>Number(row.querySelector('[tabulator-field="Idx"]')?.textContent.trim())===index)?.querySelector('[tabulator-field="'+field+'"]');
  function fire(cell,type,shift=false){const r=cell.getBoundingClientRect();cell.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0,shiftKey:shift,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));}
  function select(start,end){for(const type of ['mousedown','mouseup','click'])fire(start,type);if(end&&end!==start)for(const type of ['mousedown','mouseup','click'])fire(end,type,true);}
  async function ready(){await until(()=>document.getElementById('table').dataset.ready==='true'&&document.querySelectorAll('.tabulator-row').length>0,'production table did not finish rendering');await wait(75);}
  async function reset(count=320){resetRows(count);fixtureCatalog();await ready();}
  async function position(top,left){holder().scrollTop=top;holder().scrollLeft=left;holder().dispatchEvent(new Event('scroll'));await wait(120);
    const h=holder(),r=h.getBoundingClientRect();
    const cells=[...document.querySelectorAll('.tabulator-cell[tabulator-field^="Value"]')].filter(cell=>{const c=cell.getBoundingClientRect();return c.left>=r.left+235&&c.right<r.right-15&&c.top>=r.top+40&&c.bottom<r.bottom-60;});
    check(cells.length>0,'no genuinely visible numeric cell after scrolling');
    return cells.sort((a,b)=>Math.abs(a.getBoundingClientRect().top-(r.top+r.height/2))-Math.abs(b.getBoundingClientRect().top-(r.top+r.height/2)))[0];
  }
  async function mutationRefresh(before){await until(()=>fixtureMessages.slice(before).some(message=>message.type==='loadDatabasePage'),'mutation did not request its post-save page');await ready();await wait(100);}
  async function checkViewport(label,before,clamp=false){const after=snapshot();observations.push({case:label,before,after});const expectedTop=clamp?Math.min(before.top,after.maxTop):before.top,expectedLeft=clamp?Math.min(before.left,after.maxLeft):before.left;
    check(Math.abs(after.top-expectedTop)<=1&&Math.abs(after.left-expectedLeft)<=1,label+' viewport changed '+JSON.stringify({before,after,expectedTop,expectedLeft}));}
  async function checkActive(index,field){
    const target=cellFor(index,field);check(target,'edited row/field not visible after refresh');
    const selected=target.classList.contains('tabulator-range-selected');
    // Do not start an editor against a known-lost range: a detached vendor
    // component can then poison unrelated later cases. The positive path still
    // proves retained identity by reopening through the actual F2 UI handler.
    check(selected,'edited cell lost its range selection');
    const header=document.querySelector('.tabulator-header');header.focus({preventScroll:true});header.dispatchEvent(new KeyboardEvent('keydown',{key:'F2',bubbles:true,cancelable:true}));
    await until(()=>!!document.querySelector('.tabulator-cell.tabulator-editing input'),'F2 cannot reopen the retained active cell');
    const editing=document.querySelector('.tabulator-cell.tabulator-editing');
    const actual={row:rowIndex(editing),field:editing.getAttribute('tabulator-field'),viewport:snapshot()};
    observations.push({case:'active-cell-F2',expected:{row:index,field},selected,actual});
    editing.querySelector('input').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(25);
    check(actual.row===index&&actual.field===field,'F2 reopened a different row/field '+JSON.stringify({expected:{row:index,field},actual}));
    check(selected,'edited cell lost its range selection');
  }
  async function edit(cell,value){select(cell);fire(cell,'dblclick');await until(()=>!!cell.querySelector('input'),'double click did not open editor');const input=cell.querySelector('input');input.value=value;
    const before=snapshot(),messages=fixtureMessages.length,index=rowIndex(cell),field=cell.getAttribute('tabulator-field');
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await mutationRefresh(messages);return{before,index,field,messages};}
  async function test(name,task){try{await task();}catch(error){failures.push(name+': '+error.message);}}
  window.addEventListener('load',async()=>{try{
    await ready();
    await test('single row save preserves vertical/horizontal viewport and active edited cell',async()=>{
      const cell=await position(1450,1500),startHolder=holder(),result=await edit(cell,'61001');
      check(result.before.top>1000&&result.before.left>1000,'fixture never scrolled in both axes');
      check(fixtureMessages.slice(result.messages).some(message=>message.type==='updateDatabaseRow'),'single cell did not use single-row save');
      await checkViewport('single-row',result.before);check(holder()===startHolder,'compatible page unnecessarily rebuilt its grid');await checkActive(result.index,result.field);
      check(cellFor(result.index,result.field).textContent.trim()==='61001','saved visible value is stale');
    });
    await reset();
    await test('batch save preserves viewport and selected two by two range',async()=>{
      const start=await position(1600,1800),index=rowIndex(start),field=start.getAttribute('tabulator-field'),next='Value'+(Number(field.slice(5))+1);
      const end=cellFor(index+1,next);check(end,'batch opposite corner not rendered');select(start,end);const before=snapshot(),messages=fixtureMessages.length;
      const event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:()=> '71001\\t71002\\r\\n71003\\t71004'}});start.dispatchEvent(event);await mutationRefresh(messages);
      const update=fixtureMessages.slice(messages).find(message=>message.type==='updateDatabaseRows');check(update&&update.updates.length===2,'paste was not one two-row batch');
      await checkViewport('batch',before);
      for(const [row,column,value] of [[index,field,'71001'],[index,next,'71002'],[index+1,field,'71003'],[index+1,next,'71004']]){
        const target=cellFor(row,column);check(target&&target.classList.contains('tabulator-range-selected'),'batch range lost '+row+'/'+column);check(target.textContent.trim()===value,'batch visible value lost '+row+'/'+column);
      }
      await checkActive(index,field);
    });
    await reset();
    await test('rebuilt grid keeps source-page viewport and edited-cell identity',async()=>{
      const cell=await position(1750,1650),startHolder=holder();fixtureMutationMode='rebuild';const result=await edit(cell,'81001');
      check(holder()!==startHolder,'column-change fixture did not rebuild the grid');await checkViewport('rebuild',result.before);await checkActive(result.index,result.field);
    });
    await reset();
    await test('repeated saves preserve the same scroll and edited identity',async()=>{
      const cell=await position(1550,1700),first=await edit(cell,'82001');await checkViewport('repeat-first',first.before);await checkActive(first.index,first.field);
      const second=await edit(cellFor(first.index,first.field),'82002');await checkViewport('repeat-second',second.before);await checkActive(second.index,second.field);
      check(cellFor(second.index,second.field).textContent.trim()==='82002','second save did not paint its fresh value');
    });
    await reset();
    await test('failed write retains viewport range and rolls back the edited value',async()=>{
      const cell=await position(1500,1600),index=rowIndex(cell),field=cell.getAttribute('tabulator-field'),old=cell.textContent.trim();
      select(cell);fire(cell,'dblclick');await until(()=>!!cell.querySelector('input'),'failure editor missing');const input=cell.querySelector('input');input.value='83001';const before=snapshot(),messages=fixtureMessages.length;fixtureMutationMode='error';
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));await until(()=>fixtureMessages.slice(messages).some(message=>message.type==='updateDatabaseRow'),'failure did not dispatch mutation');await wait(150);
      await checkViewport('failed-write',before);check(!fixtureMessages.slice(messages).some(message=>message.type==='loadDatabasePage'),'failed write unexpectedly reloaded a page');check(cellFor(index,field).textContent.trim()===old,'failed optimistic edit did not roll back');await checkActive(index,field);
    });
    await reset();
    await test('undo restores value without losing source-page viewport or active cell',async()=>{
      const cell=await position(1650,1800),old=cell.textContent.trim(),saved=await edit(cell,'84001');await checkViewport('undo-save',saved.before);await checkActive(saved.index,saved.field);
      const before=snapshot(),messages=fixtureMessages.length,header=document.querySelector('.tabulator-header');header.focus({preventScroll:true});header.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));await mutationRefresh(messages);
      check(fixtureMessages.slice(messages).some(message=>message.type==='undoDatabaseMutation'),'undo did not pass through production host message');await checkViewport('undo',before);await checkActive(saved.index,saved.field);check(cellFor(saved.index,saved.field).textContent.trim()===old,'undo did not paint the original value');
    });
    await reset();
    await test('row reorder and inserted field retain row-id and field selection instead of numeric indices',async()=>{
      const cell=await position(1750,1650);fixtureMutationMode='identity';const result=await edit(cell,'85001');await checkViewport('identity-reorder',result.before);await checkActive(result.index,result.field);
      check(cellFor(result.index,result.field).textContent.trim()==='85001','source-owned edited cell changed identity');
    });
    await reset();
    await test('shrinking results clamp scroll without resurrecting removed cells',async()=>{
      const cell=await position(1900,1800);fixtureMutationMode='shrink';const result=await edit(cell,'91001');await checkViewport('shrink',result.before,true);
      check(snapshot().top===0&&snapshot().left===0,'small result did not clamp to legal zero extent');
      check(!cellFor(result.index,result.field),'removed edited cell survived narrower/shorter results');
    });
    await reset();
    await test('new last-page row is brought into view instead of reset back to the page start',async()=>{
      await reset(399);
      const cell=await position(1450,1550);select(cell);const messages=fixtureMessages.length,r=cell.getBoundingClientRect();
      cell.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:r.x+8,clientY:r.y+8}));
      check(!document.getElementById('rowContextMenu').hidden,'create context menu did not open');
      document.getElementById('contextAddRow').click();await mutationRefresh(messages);
      check(fixtureMessages.slice(messages).some(message=>message.type==='createDatabaseRow'),'create did not pass through the production menu handler');
      check(fixtureMessages.slice(messages).some(message=>message.type==='loadDatabasePage'&&message.offset===300),'new row last page was not requested');
      const target=cellFor(399,'Name'),h=holder(),bounds=h.getBoundingClientRect(),targetBounds=target?.getBoundingClientRect(),after=snapshot();
      observations.push({case:'create-last-page-visible',after,targetBounds:targetBounds?{top:targetBounds.top,bottom:targetBounds.bottom}:null,viewportBounds:{top:bounds.top,bottom:bounds.bottom}});
      check(document.getElementById('pageNumber').value==='4','created row did not navigate to its last page');
      check(after.left===0,'create inherited the previous horizontal scroll');
      check(after.top>2500&&targetBounds&&targetBounds.top>=bounds.top&&targetBounds.bottom<=bounds.bottom,'created last row is not visibly scrolled into view');
      check(target.closest('.tabulator-row').classList.contains('boo-selected-row'),'created row is not selected');
    });
    await reset();
    await test('page navigation resets viewport instead of reusing a saved position',async()=>{
      const cell=await position(1500,1550);select(cell);const messages=fixtureMessages.length;document.getElementById('nextPage').click();
      await until(()=>fixtureMessages.slice(messages).some(message=>message.type==='loadDatabasePage'&&message.offset===100),'next page was not requested');await ready();
      const after=snapshot();observations.push({case:'page-reset',after});check(after.top===0&&after.left===0,'new page inherited the previous page viewport');check(document.getElementById('pageNumber').value==='2','page label stale');
    });
    await reset();
    await test('table navigation resets viewport and source identity',async()=>{
      const cell=await position(1450,1550);select(cell);const messages=fixtureMessages.length;
      [...document.querySelectorAll('#tabs .tab')].find(button=>button.textContent.includes('怪物')).click();
      await until(()=>fixtureMessages.slice(messages).some(message=>message.type==='loadDatabasePage'&&message.tableId==='monsters'),'other table was not requested');await ready();
      const after=snapshot();observations.push({case:'table-reset',after});check(after.top===0&&after.left===0,'new table inherited previous scroll');check(document.getElementById('pageNumber').value==='1','new table page did not reset');check([...document.querySelectorAll('.tabulator-row [tabulator-field="Idx"]')].every(cell=>Number(cell.textContent.trim())>=5000),'new table painted prior source rows');
    });
    const result=document.createElement('pre');result.id='database-scroll-result';result.hidden=true;result.textContent=JSON.stringify({failures,observations,trace:fixtureTrace,messages:fixtureMessages,appErrors:fixtureTrace.filter(entry=>entry.event==='error')});document.body.append(result);
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
      const versionResult = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:BOO_DATABASE_SCROLL_BROWSER).VersionInfo.ProductVersion'],
        { windowsHide: true, encoding: 'utf8', timeout: 5000, env: { ...process.env, BOO_DATABASE_SCROLL_BROWSER: browser } });
      const version = String(versionResult.stdout || '').trim() || '<unknown>';
      const completed = /data-test-status="(?:PASS|FAIL)"/.test(dom);
      attempts.push({ browser, version, completed, status: /data-test-status="PASS"/.test(dom) ? 'PASS' : 'FAIL', error: /data-test-error="([^"]*)"/.exec(dom)?.[1] });
      fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2));
      if (!completed) continue;
      const raw = /<pre[^>]*id="database-scroll-result"[^>]*>([^]*?)<\/pre>/.exec(dom)?.[1];assert.ok(raw, 'scenario completed without evidence');
      const result = JSON.parse(raw.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ sourceFile, sourceSha256, browser, version, ...result }, null, 2));
      console.log(`database-grid-scroll-retention-browser.test.js: browser=${browser} version=${version} DOM=${/data-dom-count="([0-9]+)"/.exec(dom)?.[1]}`);
      assert.deepEqual(result.failures, [], 'database viewport/selection RED matrix');assert.deepEqual(result.appErrors, [], 'browser application errors');
      console.log('database-grid-scroll-retention-browser.test.js: PASS (production Tabulator UI, synthetic in-memory host; no database writes)');return;
    } catch (error) {
      if (attempts.at(-1)?.browser === browser && attempts.at(-1)?.completed) throw error;
      attempts.push({ browser, error: error.stack || String(error) });fs.writeFileSync(path.join(out, 'attempts.json'), JSON.stringify(attempts, null, 2));
    } finally { if (fs.existsSync(profile)) removeTemporaryDirectory(profile); }
  }
  throw Error('No installed Chromium produced completed DOM: ' + encode(attempts));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
