const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const viewerPath = path.join(__dirname, '..', 'media', 'database-viewer.html');
const port = Number(process.env.BOO_TEST_PORT || 18766);
const itemColumns = [
  'Idx', 'Name', 'StdMode', 'Shape', 'Weight', 'Anicount', 'Source', 'Reserved',
  'Looks', 'DuraMax', 'Ac', 'Ac2', 'Mac', 'Mac2', 'Dc', 'Dc2', 'Mc', 'Mc2',
  'Sc', 'Sc2', 'Need', 'NeedLevel', 'Price', 'Stock', 'Color', 'OverLap', 'HP',
  'MP', 'Job', ...Array.from({ length: 30 }, (_, index) => `Value${index + 1}`),
  'Expand1', 'Expand2', '攻击加成', '防御加成', '生命加成', '魔法加成', '全属性加成',
];
const bridge = `<script>
window.__booMessages=[];
var itemColumns=${JSON.stringify(itemColumns)};
var itemRowCount=5000;
var itemStdModes=[5,6,10,11,15,19,20,21,24,26,22,23,30,70,31,42,54,64,52,62,53,48,16,65,66,67,68,69,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89];
var itemOverlaps=[0,2,3,4,5,6,7];
var itemOverrides={};
var itemTypes={};itemColumns.forEach(function(column){itemTypes[column]=column==='Name'?'TEXT':'INTEGER'});
function tableInfo(id,name,label,rowCount,columns,columnTypes){
  return{id:id,name:name,label:label,fileName:'ApexM2.DB',kind:'sqlite',rowCount:rowCount,columns:columns,columnTypes:columnTypes,editable:true,schemaEditable:true,schemaEditReason:'',sortMode:'database'};
}
function currentItemTable(){return tableInfo('items','StdItems','物品数据库',itemRowCount,itemColumns,itemTypes)}
window.acquireVsCodeApi=function(){return{postMessage:function(message){
  window.__booMessages.push(message);
  document.documentElement.dataset.lastMessageType=message.type;
  if(message.type==='showDatabaseDetail')document.documentElement.dataset.lastItemName=message.name||'';
  function send(data){window.dispatchEvent(new MessageEvent('message',{data:data}))}
  if(message.type==='ready')setTimeout(function(){send({type:'databaseCatalog',dbType:'SQLite (.DB) - ApexM2.DB',totalCount:5201,tables:[
    currentItemTable(),
    tableInfo('monster','Monster','怪物数据库',200,['Idx','Name','Race','Level','HP','Exp'],{Idx:'INTEGER',Name:'TEXT',Race:'INTEGER',Level:'INTEGER',HP:'INTEGER',Exp:'INTEGER'}),
    tableInfo('magic','Magic','技能数据库',1,['MagID','MagName','NeedL1','Power'],{MagID:'INTEGER',MagName:'TEXT',NeedL1:'INTEGER',Power:'INTEGER'})
  ]})},20);
  if(message.type==='loadDatabasePage')setTimeout(function(){
    var total=0,rows=[],offset=Number(message.offset)||0,limit=Number(message.limit)||100;
    if(message.tableId==='items'){
      for(var n=0;n<itemRowCount;n++){
        var mode=itemStdModes[n%itemStdModes.length],name='测试物品'+String(n).padStart(5,'0');
        var candidate={__booRowId:n+1};for(var c=0;c<itemColumns.length;c++)candidate[itemColumns[c]]=c+1;
        candidate.Idx=n;candidate.Name=name;candidate.StdMode=mode;candidate.Weight=0;candidate.Color=249;
        candidate.OverLap=itemOverlaps[n%itemOverlaps.length];candidate.Expand1=n%14;
        Object.assign(candidate,itemOverrides[candidate.__booRowId]||{});
        var filters=message.filters||[];
        if(!filters.length&&message.filterValues&&message.filterValues.length)filters=[{column:message.filterColumn,values:message.filterValues}];
        if(filters.some(function(filter){return filter.values&&filter.values.length&&filter.values.indexOf(candidate[filter.column])<0}))continue;
        if(message.query&&name.toLowerCase().indexOf(String(message.query).toLowerCase())<0)continue;
        if(total>=offset&&rows.length<limit)rows.push(candidate);
        total++;
      }
    }else{
      total=message.tableId==='monster'?200:1;
      var count=Math.min(limit,Math.max(0,total-offset));
      for(var i=0;i<count;i++){var itemIndex=offset+i;if(message.tableId==='monster')rows.push({__booRowId:itemIndex+1,Idx:itemIndex,Name:'怪物'+String(itemIndex).padStart(4,'0'),Race:81,Level:Math.floor(itemIndex/5)+1,HP:1000+itemIndex*20,Exp:500+itemIndex})}
    }
    send({type:'databasePage',requestId:message.requestId,tableId:message.tableId,columns:message.tableId==='monster'?['Idx','Name','Race','Level','HP','Exp']:itemColumns,rows:rows,offset:Number(message.offset)||0,limit:Number(message.limit)||100,total:total,query:message.query||'',searchColumn:message.searchColumn||'',matchMode:message.matchMode||'contains',sortColumn:message.sortColumn||'',sortDirection:message.sortDirection||'asc'});
  },80);
  if(message.type==='createDatabaseRow'||message.type==='updateDatabaseRow'||message.type==='updateDatabaseRows'||message.type==='deleteDatabaseRow'||message.type==='updateDatabaseSchema')setTimeout(function(){
    var operation=message.type==='createDatabaseRow'?'create':message.type==='updateDatabaseRow'||message.type==='updateDatabaseRows'?'update':message.type==='deleteDatabaseRow'?'delete':'schema';
    var resultRowId;
    if(operation==='create'){itemRowCount++;resultRowId=itemRowCount;itemOverrides[resultRowId]={}}
    if(message.type==='updateDatabaseRow'){resultRowId=Number(message.rowId);itemOverrides[resultRowId]=Object.assign({},itemOverrides[resultRowId]||{},message.values||{})}
    if(message.type==='updateDatabaseRows'){
      (message.updates||[]).forEach(function(update){var id=Number(update.rowId);itemOverrides[id]=Object.assign({},itemOverrides[id]||{},update.values||{})});
      resultRowId=message.updates&&message.updates.length?Number(message.updates[0].rowId):undefined;
      document.documentElement.dataset.lastBatchRows=String((message.updates||[]).length);
      document.documentElement.dataset.lastBatchLabel=message.label||'';
    }
    if(operation==='delete')itemRowCount=Math.max(0,itemRowCount-1);
    if(operation==='schema'){
      itemColumns=message.columns.map(function(column){return column.name});
      itemTypes={};message.columns.forEach(function(column){itemTypes[column.name]=column.type||'TEXT'});
    }
    send({type:'databaseMutationResult',requestId:message.requestId,result:{operation:operation,tableId:'items',rowCount:itemRowCount,rowId:resultRowId,backupPath:'C:\\\\test\\\\boo-database-backups\\\\ApexM2.DB.test.bak'},table:currentItemTable(),totalCount:itemRowCount+201});
  },80);
}};};
</script>`;

const server = http.createServer((request, response) => {
  const assets = {
    '/tabulator.css': path.join(__dirname, '..', 'media', 'vendor', 'tabulator', 'tabulator_midnight.min.css'),
    '/table-core.js': path.join(__dirname, '..', 'media', 'table-editor-core.js'),
    '/tabulator.js': path.join(__dirname, '..', 'media', 'vendor', 'tabulator', 'tabulator.min.js'),
  };
  if (assets[request.url]) {
    const contentType = request.url.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
    response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    response.end(fs.readFileSync(assets[request.url]));
    return;
  }
  if (request.url !== '/') { response.writeHead(404).end('Not found'); return; }
  const html = fs.readFileSync(viewerPath, 'utf8')
    .replaceAll('{{TABULATOR_CSS_URI}}', '/tabulator.css')
    .replaceAll('{{TABLE_EDITOR_CORE_URI}}', '/table-core.js')
    .replaceAll('{{TABULATOR_JS_URI}}', '/tabulator.js')
    .replace('<script>', bridge + '<script>');
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(html);
});

server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
process.on('SIGINT', () => server.close(() => process.exit(0)));
