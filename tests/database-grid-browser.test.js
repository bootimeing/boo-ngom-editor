const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = process.env.BOO_TEST_ROOT
  ? path.resolve(process.env.BOO_TEST_ROOT)
  : path.resolve(__dirname, '..');

function findEdge() {
  const candidates = [
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, relativePath)).href;
}

function main() {
  const edge = findEdge();
  if (!edge) {
    console.log('database-grid-browser.test.js: SKIP (Microsoft Edge not found)');
    return;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-database-grid-'));
  const profile = path.join(temporary, 'profile');
  const harness = path.join(temporary, 'database-grid-test.html');
  try {
    let html = fs.readFileSync(path.join(root, 'media', 'database-viewer.html'), 'utf8');
    const replacements = {
      '{{TABULATOR_CSS_URI}}': resourceUri('media/vendor/tabulator/tabulator_midnight.min.css'),
      '{{TABLE_EDITOR_CORE_URI}}': resourceUri('media/table-editor-core.js'),
      '{{TABULATOR_JS_URI}}': resourceUri('media/vendor/tabulator/tabulator.min.js'),
    };
    for (const [token, value] of Object.entries(replacements)) html = html.replaceAll(token, value);

    const mock = `<script>
window.__booMessages=[];
window.__rows=[];
window.addEventListener('error',function(event){
  document.body.dataset.appError=event.error&&event.error.stack?event.error.stack:String(event.message||event.error||'unknown error');
});
var columns=['Idx','Name','StdMode','Price','Color'].concat(Array.from({length:35},function(_,index){return 'Value'+(index+1)}));
var columnTypes={};columns.forEach(function(column){columnTypes[column]=column==='Name'?'TEXT':'INTEGER'});
for(var rowIndex=0;rowIndex<100;rowIndex++){
  var row={__booRowId:rowIndex+1,Idx:rowIndex,Name:'测试物品'+String(rowIndex).padStart(3,'0'),StdMode:5,Price:rowIndex*10,Color:249};
  for(var columnIndex=1;columnIndex<=35;columnIndex++)row['Value'+columnIndex]=rowIndex+columnIndex;
  window.__rows.push(row);
}
function tableInfo(){return{id:'items',name:'StdItems',label:'物品数据库',fileName:'ApexM2.DB',kind:'sqlite',rowCount:window.__rows.length,columns:columns,columnTypes:columnTypes,columnLabels:{Name:'名称',Price:'价格'},columnDescriptions:{Name:'物品名称',Price:'物品价格'},editable:true,schemaEditable:true,schemaEditReason:'',sortMode:'database'}}
function send(data){window.dispatchEvent(new MessageEvent('message',{data:data}))}
window.acquireVsCodeApi=function(){return{postMessage:function(message){
  window.__booMessages.push(message);
  if(message.type==='showDatabaseDetail')document.documentElement.dataset.lastItemName=message.name||'';
  if(message.type==='ready')setTimeout(function(){send({type:'databaseCatalog',dbType:'SQLite (.DB) - ApexM2.DB',totalCount:window.__rows.length,tables:[tableInfo()]})},10);
  if(message.type==='loadDatabasePage')setTimeout(function(){
    var offset=Number(message.offset)||0,limit=Number(message.limit)||100;
    send({type:'databasePage',requestId:message.requestId,tableId:'items',columns:columns,rows:window.__rows.slice(offset,offset+limit),offset:offset,limit:limit,total:window.__rows.length,query:'',searchColumn:'',matchMode:'contains',filters:[],sortColumn:message.sortColumn||'',sortDirection:message.sortDirection||'asc'});
  },20);
  if(message.type==='updateDatabaseRow'||message.type==='updateDatabaseRows')setTimeout(function(){
    var updates=message.type==='updateDatabaseRow'?[{rowId:message.rowId,values:message.values||{}}]:(message.updates||[]);
    if(updates.some(function(update){return String((update.values||{}).Price)==='9999'})){
      send({type:'databaseMutationError',requestId:message.requestId,error:'simulated write failure'});return;
    }
    updates.forEach(function(update){var row=window.__rows.find(function(candidate){return Number(candidate.__booRowId)===Number(update.rowId)});if(row)Object.assign(row,update.values||{})});
    document.documentElement.dataset.lastMutationType=message.type;
    document.documentElement.dataset.lastMutationRows=String(updates.length);
    document.documentElement.dataset.lastMutationLabel=message.label||'';
    send({type:'databaseMutationResult',requestId:message.requestId,result:{operation:'update',tableId:'items',rowCount:window.__rows.length,rowId:updates[0]&&updates[0].rowId,backupPath:'C:\\\\test\\\\ApexM2.DB.bak'},table:tableInfo(),totalCount:window.__rows.length});
  },20);
  if(message.type==='undoDatabaseMutation')document.documentElement.dataset.undoSeen='true';
}}};
</script>`;
    const coreTag = `<script src="${replacements['{{TABLE_EDITOR_CORE_URI}}']}"></script>`;
    html = html.replace(coreTag, mock + coreTag);

    const scenario = `<script>
(function(){
  function wait(ms){return new Promise(function(resolve){setTimeout(resolve,ms)})}
  async function waitReady(){for(var attempt=0;attempt<160;attempt++){if(document.getElementById('table').dataset.ready==='true')return;await wait(25)}throw new Error('database grid did not become ready')}
  async function waitFor(predicate,label){for(var attempt=0;attempt<160;attempt++){if(predicate())return;await wait(25)}throw new Error(typeof label==='function'?label():(label||'condition timed out'))}
  function cell(row,field){var rows=document.querySelectorAll('.tabulator-row');return rows[row]&&rows[row].querySelector('.tabulator-cell[tabulator-field="'+field+'"]')}
  function select(start,end){
    start.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));start.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));start.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0}));
    if(end&&end!==start){end.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,shiftKey:true}));end.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,shiftKey:true}));end.dispatchEvent(new MouseEvent('click',{bubbles:true,button:0,shiftKey:true}))}
  }
  function paste(target,text){var event=new Event('paste',{bubbles:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:function(){return text}}});target.dispatchEvent(event)}
  async function run(){
    await waitReady();
    await waitFor(function(){return !!cell(0,'Name')},function(){var holder=document.querySelector('.tabulator-tableholder');return 'database rows were not rendered: rows='+document.querySelectorAll('.tabulator-row').length+', data='+(databaseGrid?databaseGrid.getData().length:'missing')+', active='+(databaseGrid?databaseGrid.getRows('active').length:'missing')+', holder='+(holder?holder.clientWidth+'x'+holder.clientHeight+'/'+holder.scrollWidth+'x'+holder.scrollHeight:'missing')+', table='+document.getElementById('table').getBoundingClientRect().width+'x'+document.getElementById('table').getBoundingClientRect().height+', appError='+(document.body.dataset.appError||'')});
    var table=document.getElementById('table'),renderedRows=document.querySelectorAll('.tabulator-row').length;
    var nameHeader=document.querySelector('.tabulator-col[tabulator-field="Name"]'),nameCell=cell(0,'Name'),priceCell=cell(0,'Price');
    if(!nameHeader||!nameCell||!priceCell)throw new Error('required database cells are missing: header='+!!nameHeader+', name='+!!nameCell+', price='+!!priceCell+', fields='+Array.from(document.querySelectorAll('.tabulator-row:first-of-type .tabulator-cell[tabulator-field]')).map(function(node){return node.getAttribute('tabulator-field')}).join(','));
    var nameLeft=nameHeader.getBoundingClientRect().left,holder=document.querySelector('.tabulator-tableholder'),initialHolder=holder;
    var holderStyle=getComputedStyle(holder),tableWrap=document.getElementById('tableWrap');
    var horizontalScroll=holder.scrollWidth>holder.clientWidth+20&&(holderStyle.overflowX==='auto'||holderStyle.overflowX==='scroll')&&table.getBoundingClientRect().width<=tableWrap.getBoundingClientRect().width+2;
    var rowNumberCells=Array.from(document.querySelectorAll('.tabulator-row-header'));
    var rowNumbersRemoved=rowNumberCells.length>0&&rowNumberCells.every(function(node){return !node.textContent.trim()&&node.getBoundingClientRect().width<=2});
    holder.scrollLeft=2200;holder.dispatchEvent(new Event('scroll'));await wait(80);
    var frozenStable=holder.scrollLeft>1000&&Math.abs(document.querySelector('.tabulator-col[tabulator-field="Name"]').getBoundingClientRect().left-nameLeft)<2;
    nameCell=cell(0,'Name');select(nameCell);await wait(30);
    var detailLinked=document.documentElement.dataset.lastItemName==='测试物品000';
    var rangeOverlay=document.querySelector('.tabulator-range-overlay .tabulator-range');
    var overlayColor=rangeOverlay?getComputedStyle(rangeOverlay).backgroundColor:'';
    var overlayTransparent=overlayColor==='transparent'||overlayColor==='rgba(0, 0, 0, 0)';

    holder.scrollLeft=0;holder.dispatchEvent(new Event('scroll'));await wait(80);
    priceCell=cell(0,'Price');
    priceCell.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:12,clientY:12}));await wait(380);
    var cellTooltipRemoved=!document.querySelector('.tabulator-tooltip');
    priceCell.dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));
    select(priceCell);priceCell.focus();priceCell.dispatchEvent(new KeyboardEvent('keydown',{key:'7',bubbles:true,cancelable:true}));await wait(30);
    var input=priceCell.querySelector('input');if(!input)throw new Error('typing did not open database cell editor');
    var directReplace=input.value==='7';
    var beforeSingle=window.__booMessages.length;
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    var editStayedVisible=!document.getElementById('loading').classList.contains('visible');
    await waitFor(function(){return window.__booMessages.slice(beforeSingle).some(function(message){return message.type==='loadDatabasePage'})},'single edit did not refresh');await wait(80);await waitReady();
    var singleEdit=window.__booMessages.some(function(message){return message.type==='updateDatabaseRow'&&Number(message.rowId)===1&&String(message.values.Price)==='7'});
    var gridReused=document.querySelector('.tabulator-tableholder')===initialHolder;

    priceCell=cell(0,'Price');select(priceCell);priceCell.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,button:0}));await wait(30);
    var selectionInput=priceCell.querySelector('input');if(!selectionInput)throw new Error('double click did not open database cell editor');
    selectionInput.setSelectionRange(0,selectionInput.value.length);
    selectionInput.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,cancelable:true}));
    selectionInput.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));await wait(20);
    var mouseSelectionStable=selectionInput.isConnected&&priceCell.classList.contains('tabulator-editing');
    selectionInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(20);

    var pasteStart=cell(0,'Price');select(pasteStart);paste(pasteStart,'10\\t20\\r\\n30\\t40');await wait(180);await waitReady();
    var pasteMessage=window.__booMessages.find(function(message){return message.type==='updateDatabaseRows'&&message.label==='粘贴单元格'});
    var pasteGrouped=!!pasteMessage&&pasteMessage.updates.length===2&&String(pasteMessage.updates[0].values.Price)==='10'&&String(pasteMessage.updates[1].values.Price)==='30';

    var fillStart=cell(1,'Price'),fillEnd=cell(4,'Price');select(fillStart,fillEnd);await wait(30);fillEnd.focus();fillEnd.dispatchEvent(new KeyboardEvent('keydown',{key:'d',ctrlKey:true,bubbles:true,cancelable:true}));await wait(180);await waitReady();
    var fillMessage=window.__booMessages.find(function(message){return message.type==='updateDatabaseRows'&&message.label==='Ctrl+D 填充选区'});
    var fillGrouped=!!fillMessage&&fillMessage.updates.length===2&&String(fillMessage.updates[0].values.Price)==='30'&&String(fillMessage.updates[1].values.Price)==='30';

    holder=document.querySelector('.tabulator-tableholder');holder.scrollTop=0;holder.dispatchEvent(new Event('scroll'));await wait(40);
    var dragStart=cell(0,'Price'),dragEnd=cell(3,'Price');select(dragStart);await wait(50);
    var fillHandle=document.getElementById('fillHandle');
    if(!fillHandle||getComputedStyle(fillHandle).display==='none'){var active=activeRange(),rangeCells=active&&active.getBounds(),endRect=rangeCells&&rangeCells.end&&rangeCells.end.getElement().getBoundingClientRect(),wrapRect=document.getElementById('tableWrap').getBoundingClientRect();throw new Error('database fill handle is not visible: mutation='+mutationPending+', editing='+!!activeCellEdit+', range='+JSON.stringify(selectedGridBounds())+', end='+(endRect?JSON.stringify({l:endRect.left,r:endRect.right,t:endRect.top,b:endRect.bottom}):'missing')+', wrap='+JSON.stringify({l:wrapRect.left,r:wrapRect.right,t:wrapRect.top,b:wrapRect.bottom})+', scroll='+document.querySelector('.tabulator-tableholder').scrollLeft+', handle='+(fillHandle?fillHandle.style.cssText:'missing'))}
    fillHandle.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,cancelable:true}));
    dragEnd.dispatchEvent(new MouseEvent('mouseover',{bubbles:true,button:0}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));
    await wait(180);await waitReady();
    var dragMessage=window.__booMessages.find(function(message){return message.type==='updateDatabaseRows'&&message.label==='拖拽递增填充'});
    var dragIncrement=!!dragMessage&&dragMessage.updates.length===3&&String(dragMessage.updates[0].values.Price)==='11'&&String(dragMessage.updates[1].values.Price)==='12'&&String(dragMessage.updates[2].values.Price)==='13';

    var incrementStart=cell(0,'Price'),incrementEnd=cell(2,'Price');select(incrementStart,incrementEnd);await wait(30);
    incrementEnd.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,cancelable:true,clientX:400,clientY:300}));await wait(30);
    var incrementButton=document.getElementById('contextIncrementCells');
    if(!incrementButton||incrementButton.disabled)throw new Error('increment context command is unavailable');
    incrementButton.click();await wait(20);
    var incrementInput=document.getElementById('incrementValue');
    if(!incrementInput||document.getElementById('incrementModal').hidden)throw new Error('increment dialog did not open');
    incrementInput.value='+2';document.getElementById('incrementAccept').click();
    await wait(180);await waitReady();
    var incrementMessage=window.__booMessages.find(function(message){return message.type==='updateDatabaseRows'&&message.label==='递增选区'});
    var contextIncrement=!!incrementMessage&&incrementMessage.updates.length===3&&String(incrementMessage.updates[0].values.Price)==='12'&&String(incrementMessage.updates[1].values.Price)==='15'&&String(incrementMessage.updates[2].values.Price)==='18';

    var failureCell=cell(0,'Price');select(failureCell);failureCell.focus();failureCell.dispatchEvent(new KeyboardEvent('keydown',{key:'9',bubbles:true,cancelable:true}));await wait(30);
    var failureInput=failureCell.querySelector('input');if(!failureInput)throw new Error('failure rollback editor did not open');
    failureInput.value='9999';failureInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await waitFor(function(){return mutationPending===false},'failed database mutation did not finish');await wait(30);
    var failedWriteRolledBack=String(cell(0,'Price').textContent).trim()==='12'&&document.querySelector('.tabulator-tableholder')===initialHolder;

    var focusCell=cell(0,'Name');focusCell.focus();focusCell.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}));await wait(30);
    var appError=document.body.dataset.appError||'';
    document.body.dataset.testStatus=horizontalScroll&&rowNumbersRemoved&&frozenStable&&detailLinked&&overlayTransparent&&cellTooltipRemoved&&directReplace&&editStayedVisible&&gridReused&&mouseSelectionStable&&singleEdit&&pasteGrouped&&fillGrouped&&dragIncrement&&contextIncrement&&failedWriteRolledBack&&document.documentElement.dataset.undoSeen==='true'&&!appError?'pass':'fail';
    document.body.dataset.renderedRows=String(renderedRows);document.body.dataset.horizontalScroll=String(horizontalScroll);document.body.dataset.rowNumbersRemoved=String(rowNumbersRemoved);document.body.dataset.frozenStable=String(frozenStable);document.body.dataset.detailLinked=String(detailLinked);document.body.dataset.overlayTransparent=String(overlayTransparent);document.body.dataset.cellTooltipRemoved=String(cellTooltipRemoved);document.body.dataset.directReplace=String(directReplace);document.body.dataset.editStayedVisible=String(editStayedVisible);document.body.dataset.gridReused=String(gridReused);document.body.dataset.mouseSelectionStable=String(mouseSelectionStable);document.body.dataset.singleEdit=String(singleEdit);document.body.dataset.pasteGrouped=String(pasteGrouped);document.body.dataset.fillGrouped=String(fillGrouped);document.body.dataset.dragIncrement=String(dragIncrement);document.body.dataset.contextIncrement=String(contextIncrement);document.body.dataset.failedWriteRolledBack=String(failedWriteRolledBack);document.body.dataset.appError=appError;
    document.body.dataset.messageTypes=window.__booMessages.map(function(message){return message.type+(message.label?':'+message.label:'')}).join(',');
  }
  run().catch(function(error){document.body.dataset.testStatus='fail';document.body.dataset.testError=error&&error.message?error.message:String(error)});
}());
</script>`;
    html = html.replace('</body>', scenario + '</body>');
    fs.writeFileSync(harness, html, 'utf8');

    const result = spawnSync(edge, [
      '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
      '--allow-file-access-from-files', `--user-data-dir=${profile}`,
      '--virtual-time-budget=12000', '--dump-dom', pathToFileURL(harness).href,
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    const body = result.stdout.match(/<body\b([^>]*)>/i);
    if (!body && !result.stderr.trim()) {
      console.log('database-grid-browser.test.js: SKIP (headless Edge returned no DOM)');
      return;
    }
    assert.ok(body, 'headless Edge did not return a body element');
    const attributes = body[1];
    const value = name => attributes.match(new RegExp(`data-${name}="([^"]*)"`))?.[1];
    assert.equal(value('test-status'), 'pass', value('test-error') || JSON.stringify({
      renderedRows: value('rendered-rows'), frozenStable: value('frozen-stable'),
      horizontalScroll: value('horizontal-scroll'), rowNumbersRemoved: value('row-numbers-removed'),
      detailLinked: value('detail-linked'), overlayTransparent: value('overlay-transparent'),
      cellTooltipRemoved: value('cell-tooltip-removed'), directReplace: value('direct-replace'),
      editStayedVisible: value('edit-stayed-visible'), gridReused: value('grid-reused'),
      mouseSelectionStable: value('mouse-selection-stable'),
      singleEdit: value('single-edit'), pasteGrouped: value('paste-grouped'),
      fillGrouped: value('fill-grouped'), dragIncrement: value('drag-increment'),
      contextIncrement: value('context-increment'), failedWriteRolledBack: value('failed-write-rolled-back'),
      appError: value('app-error'),
      messageTypes: value('message-types'), stderr: result.stderr,
    }));
    assert.ok(Number(value('rendered-rows')) < 80, 'database page did not use virtual row rendering');
    console.log(`database-grid-browser.test.js: PASS (${value('rendered-rows')} DOM rows)`);
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

main();
