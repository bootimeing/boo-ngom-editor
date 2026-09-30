const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-resource-editor-'));

async function main() {
  try {
    let editor = fs.readFileSync(path.join(runtime, 'media/resource-editor.html'), 'utf8');
    assert.ok(!/\.innerHTML\s*=/.test(editor), 'resource data must not be interpolated with innerHTML');
    editor = editor.replace('{{ICON_URI}}', 'data:image/png;base64,' + fs.readFileSync(path.join(runtime, 'resources/icon.png')).toString('base64'));
    editor = editor.replace('<script>', '<script>window.acquireVsCodeApi=()=>parent.mockApi(window);</script><script>');
    editor = editor.replace("api.postMessage({type:'ready',documentId});", "window.__testSafeImageUrl=safeImageUrl;api.postMessage({type:'ready',documentId});");
    const page = `<!doctype html><html><head><meta charset="UTF-8"></head><body style="margin:0"><script>
    const editor = ${JSON.stringify(editor).replace(/<\//g, '<\\/')};
    const check=(value,text)=>{if(!value)throw Error(text);};
    const wait=(predicate,text)=>new Promise((resolve,reject)=>{let n=0;const next=()=>predicate()?resolve():n++>250?reject(Error('wait: '+text)):setTimeout(next,10);next();});
    const settle=()=>new Promise(resolve=>setTimeout(resolve,35));
    const bitmap=document.createElement('canvas');bitmap.width=36;bitmap.height=28;const context=bitmap.getContext('2d');context.fillStyle='#4d95ef';context.fillRect(3,4,29,21);const image=bitmap.toDataURL();
    let active, savedState, frame;
    const hosts=[];
    window.mockApi=function(child){
      const host=active;host.child=child;
      return {getState:()=>host.saved,setState:value=>{host.saved=JSON.parse(JSON.stringify(value));savedState=host.saved;},postMessage:message=>{
        host.messages.push(message);
        if(message.type==='ready'){host.documentId=message.documentId;host.readonlyAtHandshake=child.document.getElementById('beginEdit').hidden&&child.document.getElementById('replaceImage').disabled;setTimeout(()=>host.state(),0);return;}
        if(message.documentId!==host.documentId||message.sessionId!==host.sessionId)return;
        if(message.type==='page'){host.start=Math.floor(message.start/100)*100;setTimeout(()=>host.state(message.requestId),0);}
        if(message.type==='jump'){host.start=Math.floor(message.index/100)*100;host.focus=message.index;setTimeout(()=>{host.state(message.requestId);host.replyDetail(message.requestId,message.index);},0);}
        if(message.type==='inspect'&&host.autoDetail){setTimeout(()=>host.replyDetail(message.requestId,message.index),0);}
        if(message.type==='export')host.busy=true;
      }};
    };
    async function create(width,height,saved,options={}){
      if(frame)frame.remove();
      const host={messages:[],saved,sessionId:'session-one',start:0,count:251,busy:false,autoDetail:true,documentId:'',focus:undefined,name:'测试资源.pak',format:'PAK',editActive:false,editRevision:0,canStartEdit:false,dirty:false,canUndo:false,canRedo:false,capabilities:{},overrides:{},...options};active=host;hosts.push(host);
      host.slot=index=>({index,status:index===2?'empty':index===3?'corrupt':index===4?'unsupported':'decoded',width:36,height:28,offsetX:index===6?null:-12,offsetY:index===6?null:18,imageUrl:image,pixelFormat:'RGBA32',compression:'zlib',alpha:true,...host.overrides[index]});
      host.post=value=>host.child.postMessage({sessionId:host.sessionId,documentId:host.documentId,...value},'*');
      host.stateData=requestId=>({type:'state',requestId,name:host.name,format:host.format,profileId:'test-profile',slotCount:host.count,pageSize:100,start:host.start,slots:Array.from({length:Math.max(0,Math.min(100,host.count-host.start))},(_,i)=>host.slot(host.start+i)),focusIndex:host.focus,busy:host.busy,canStartEdit:host.canStartEdit,editActive:host.editActive,canEdit:host.editActive,canExport:!host.editActive,editRevision:host.editRevision,dirty:host.dirty,canUndo:host.canUndo,canRedo:host.canRedo,capabilities:host.capabilities});
      host.state=requestId=>host.post(host.stateData(requestId));
      host.replyDetail=(requestId,index,overrides,revision=host.editRevision)=>host.post({type:'detail',requestId,editRevision:revision,slot:{...host.slot(index),...overrides}});
      frame=document.createElement('iframe');frame.style='display:block;border:0;width:'+width+'px;height:'+height+'px';document.body.appendChild(frame);frame.srcdoc=editor;
      await wait(()=>host.documentId&&frame.contentDocument.querySelectorAll('.slot').length===100,'initial 100-slot page');
      host.doc=frame.contentDocument;host.win=frame.contentWindow;host.$=id=>host.doc.getElementById(id);host.items=()=>Array.from(host.$('slots').children);
      host.item=index=>host.items().find(node=>Number(node.dataset.index)===index);
      host.click=(index,options={})=>host.item(index).dispatchEvent(new host.win.MouseEvent('click',{bubbles:true,...options}));
      host.jump=index=>{host.$('slotId').value=String(index);host.$('locator').dispatchEvent(new host.win.Event('submit',{bubbles:true,cancelable:true}));};
      host.mode=mode=>{host.$('exportMode').value=mode;host.$('exportMode').dispatchEvent(new host.win.Event('change',{bubbles:true}));};
      return host;
    }
    const metrics=[];
    (async()=>{try{
      for(const [width,height] of [[900,700],[1100,800],[1440,960]]){
        const host=await create(width,height),doc=host.doc,$=host.$;
        await wait(()=>$('brandIcon').complete&&$('brandIcon').naturalWidth>0,'real brand icon decode');
        host.click(0);await wait(()=>$('previewImage').complete&&$('previewImage').naturalWidth===36&&!$('previewStage').hidden,'actual PNG detail decode');
        const rect=node=>node.getBoundingClientRect();
        for(const selector of ['.topbar','.workspace','.browser','.metadata','.preview','.statusbar','#slots','#previewViewport']){
          const box=rect(doc.querySelector(selector));check(box.width>0&&box.height>0&&box.left>=-1&&box.top>=-1&&box.right<=width+1&&box.bottom<=height+1,selector+' fits '+width+'x'+height+' '+JSON.stringify(box.toJSON()));
        }
        for(const button of doc.querySelectorAll('button,input,select')){
          const box=rect(button);if(!box.width||!box.height||$('slots').contains(button))continue;
          check(box.left>=-1&&box.top>=-1&&box.right<=width+1&&box.bottom<=height+1,'control is on-screen '+button.id);
        }
        check(rect($('previewViewport')).width>=width*.33,'useful large preview width');
        check($('slots').scrollHeight>$('slots').clientHeight,'100 slots use a scrollable page');
        check(host.items().length===100,'one page contains exactly 100 slots');
        check(host.win.getComputedStyle($('slots')).gridTemplateColumns.split(' ').length===5,'five columns at every supported width');
        const rows=new Set(host.items().map(node=>Math.round(rect(node).top)));
        check(rows.size===20,'100 slots form twenty rows');
        check(!doc.getElementById('createJpk'),'new JPK action has been removed');
        check($('metaOffsetX').textContent==='-12'&&$('metaOffsetY').textContent==='18','offset metadata is read-only factual data');
        check($('previewImage').style.left==='0px'&&$('previewOrigin').style.left==='12px','negative offset retains origin relationship');
        $('zoom').value='2';$('zoom').dispatchEvent(new host.win.Event('change'));check($('previewImage').style.width==='72px','zoom scales original PNG');
        $('applyOffsets').checked=false;$('applyOffsets').dispatchEvent(new host.win.Event('change'));check($('previewOrigin').hidden&&$('previewImage').style.top==='0px','toggle offset view changes preview only');
        $('backgroundMode').value='white';$('backgroundMode').dispatchEvent(new host.win.Event('change'));check(host.win.getComputedStyle($('previewViewport')).backgroundColor==='rgb(255, 255, 255)','white background');
        check(!doc.querySelector('[contenteditable=true]')&&!doc.querySelector('button[data-action=save]'),'P1 has no pretend editing action');
        metrics.push({viewport:[width,height],items:host.items().length,previewWidth:rect($('previewViewport')).width,iconLoaded:true,pngLoaded:true});
      }
      const host=active,$=host.$;
      for(const url of [
        'https://boo-archive+.vscode-resource.vscode-cdn.net/id/000.png',
        'https://file+.vscode-resource.vscode-cdn.net/c:/fixture.png',
        'https://boo-archive+authority-003a3000.vscode-resource.vscode-cdn.net/id/000.png',
        'https://boo-archive+.vscode-resource.vscode-cdn.net:443/id/000.png'
      ])check(host.win.__testSafeImageUrl(url)===url,'real VS Code resource URI accepted: '+url);
      for(const url of [
        'https://boo-archive+.vscode-resource.vscode-cdn.net.attacker.invalid/id/000.png',
        'https://evil.vscode-cdn.net/id/000.png',
        'https://javascript+.vscode-resource.vscode-cdn.net/id/000.png',
        'https://boo-archive+.vscode-resource.vscode-cdn.net:444/id/000.png',
        'https://user:secret@boo-archive+.vscode-resource.vscode-cdn.net/id/000.png',
        'file:///C:/private.png','javascript:alert(1)'
      ])check(host.win.__testSafeImageUrl(url)==='','untrusted resource URI rejected: '+url);
      host.jump(199);await wait(()=>host.item(199)&&$('metaIndex').textContent==='199'&&!$('previewStage').hidden,'jump page+detail with the same requestId');
      check(host.items().length===100&&host.item(100)&&host.item(198),'ID jump preserves all neighbors');
      check(host.item(199).classList.contains('focused'),'located ID highlighted');
      const target=host.item(199).getBoundingClientRect(),grid=$('slots').getBoundingClientRect();check(target.top<grid.bottom&&target.bottom>grid.top,'located ID scrolls into view');
      host.click(100);host.click(102,{ctrlKey:true});host.click(104,{shiftKey:true});await settle();
      check(savedState.selectedIds.join(',')==='102,103,104','shift selection uses one contiguous range');
      $('nextPage').click();await wait(()=>host.item(200),'next page');host.click(200,{ctrlKey:true});await settle();
      check(savedState.selectedIds.length===4&&savedState.selectedIds.includes(102)&&savedState.selectedIds.includes(200),'Ctrl selection persists across pages');
      check(host.items().length===51,'partial final page preserves logical slots');
      $('selectPage').click();check(savedState.selectedIds.length===54,'select page unions only visible IDs');$('clearSelection').click();check(savedState.selectedIds.length===0,'clear selection');
      host.jump(0);await wait(()=>host.item(0),'return first page');
      for(const [index,label] of [[2,'空槽'],[3,'损坏'],[4,'不支持']]){host.click(index);await wait(()=>$('metaIndex').textContent===String(index)&&$('previewEmpty').textContent===label,'slot status '+label);check($('previewStage').hidden,'no invented image for '+label);}
      host.click(6);await wait(()=>$('metaIndex').textContent==='6'&&!$('previewStage').hidden,'unknown offset detail');check($('metaOffsetX').textContent==='未知','unknown offsets are not reported as factual zero');
      host.autoDetail=false;host.click(10);const first=host.messages.at(-1);host.click(11);const second=host.messages.at(-1);
      host.replyDetail(second.requestId,11);await wait(()=>$('metaIndex').textContent==='11'&&!$('previewStage').hidden,'latest detail');
      host.replyDetail(first.requestId,10);host.post({type:'detail',requestId:second.requestId,sessionId:'wrong-session',slot:host.slot(99)});await settle();check($('metaIndex').textContent==='11','stale detail/session cannot overwrite current image');
      host.post({type:'state',documentId:'old-document',sessionId:'stale-source',slotCount:0,slots:[],name:'wrong'});await settle();check($('archiveName').textContent==='测试资源.pak','old DOM state is ignored');
      host.replyDetail(second.requestId,11,{imageUrl:'https://example.invalid/should-not-load.png'});await wait(()=>$('previewEmpty').textContent==='图像地址不可用','untrusted image URL rejected');check(!$('previewImage').hasAttribute('src'),'untrusted URL never enters image element');
      host.autoDetail=true;host.click(12);await wait(()=>$('metaIndex').textContent==='12'&&!$('previewStage').hidden,'current export selection');
      host.mode('current');$('exportButton').click();let intent=host.messages.at(-1);check(intent.type==='export'&&intent.selection.kind==='ids'&&intent.selection.ids.join(',')==='12','current export intent');
      check($('exportButton').disabled&&!$('cancelExport').hidden,'export busy affordance');
      host.post({type:'progress',completed:12,total:100,exported:9,failed:1,empty:2});await wait(()=>$('statusText').textContent.includes('12 / 100'),'progress visible');
      $('nextPage').click();await wait(()=>host.item(100),'browse during export');check($('exportButton').disabled,'page state retains export busy');
      $('cancelExport').click();check(host.messages.at(-1).type==='cancelExport','cancel intent');
      host.busy=false;host.post({type:'notice',text:'已取消',busy:false});await wait(()=>!$('exportButton').disabled,'export cancellation releases controls');
      host.post({type:'busy',busy:false});await settle();check($('statusText').textContent==='已取消','busy-only update retains notice');
      host.click(120);host.click(122,{ctrlKey:true});host.mode('selected');$('exportButton').click();intent=host.messages.at(-1);check(intent.selection.ids.join(',')==='120,122','selected export IDs');host.busy=false;host.post({type:'busy',busy:false});await settle();
      host.mode('range');$('rangeStart').value='12';$('rangeEnd').value='200';$('exportButton').click();intent=host.messages.at(-1);check(JSON.stringify(intent.selection)===JSON.stringify({kind:'range',start:12,end:200}),'range is compact, not expanded');host.busy=false;host.post({type:'busy',busy:false});await settle();
      host.mode('all');$('exportButton').click();check(JSON.stringify(host.messages.at(-1).selection)==='{"kind":"all"}','whole archive export is compact');host.busy=false;host.post({type:'busy',busy:false});await settle();
      host.jump(120);await wait(()=>host.item(120)&&$('metaIndex').textContent==='120','restore snapshot page');host.click(120);host.click(122,{ctrlKey:true});await settle();const snapshot=JSON.parse(JSON.stringify(savedState)),oldDocument=host.documentId;
      check(Object.keys(snapshot).every(key=>['version','sessionId','start','selectedIds','focusIndex'].includes(key))&&!JSON.stringify(snapshot).includes('data:image'),'persisted state contains only compact navigation');
      const reloaded=await create(1100,800,snapshot);await wait(()=>reloaded.item(120)&&reloaded.$('metaIndex').textContent==='122','restored page and focused ID');
      check(savedState.selectedIds.join(',')==='120,122','cross-window restored selection');check(reloaded.documentId!==oldDocument,'new document epoch after reload');
      reloaded.post({type:'busy',documentId:oldDocument,busy:true});await settle();check(reloaded.$('cancelExport').hidden,'old document busy ignored');
      reloaded.sessionId='session-two';reloaded.count=20001;reloaded.start=0;reloaded.focus=undefined;reloaded.state();await wait(()=>savedState.sessionId==='session-two'&&reloaded.item(0),'new source session');check(savedState.selectedIds.length===0,'new session clears selections');
      reloaded.click(0);reloaded.jump(10000);await wait(()=>reloaded.item(10000),'large archive page');reloaded.click(10000,{shiftKey:true});check(savedState.selectedIds.length===1&&reloaded.$('statusText').textContent.includes('10000'),'oversized Shift selection refused before expansion');
      reloaded.mode('range');reloaded.$('rangeStart').value='0';reloaded.$('rangeEnd').value='20000';reloaded.$('exportButton').click();check(reloaded.messages.at(-1).selection.end===20000,'range export exceeds manual selection cap without expansion');
      const editCapabilities={canReplace:true,canFill:true,canAppend:true,canClear:true,canOffsets:true,canSaveAs:true};
      for(const [width,height] of [[900,700],[1100,800],[1440,960]]){
        const edit=await create(width,height,undefined,{name:'测试资源.jpk',format:'JPK',canStartEdit:true}),e=edit.$;
        check(edit.readonlyAtHandshake,'editing is unavailable before host capability handshake');
        edit.click(0);await wait(()=>e('metaIndex').textContent==='0'&&!e('previewStage').hidden,'pre-edit detail');
        check(!e('beginEdit').hidden&&!e('beginEdit').disabled&&e('editToolbar').hidden,'eligible JPK offers host verification only');
        e('beginEdit').click();const begin=edit.messages.at(-1);
        check(begin.type==='beginEdit'&&!('revision'in begin),'begin edit has no invented revision');
        const pendingCount=edit.messages.length;e('beginEdit').onclick();e('exportButton').onclick();
        check(edit.messages.length===pendingCount&&e('beginEdit').disabled&&e('exportButton').disabled,'pending capability verification locks repeated mutation and export');
        edit.editActive=true;edit.editRevision=1;edit.canStartEdit=false;edit.capabilities={...editCapabilities};edit.focus=0;edit.state(begin.requestId);
        await wait(()=>!e('editToolbar').hidden&&!e('replaceImage').disabled&&!e('previewStage').hidden,'host grants editing');
        check(e('fillSlot').disabled&&!e('appendImage').disabled&&!e('clearSlot').disabled&&!e('editOffsetX').hidden,'present slot editing controls');
        check(e('undoEdit').disabled&&e('redoEdit').disabled,'undo redo disabled without host history');
        check(e('exportButton').disabled&&e('exportMode').disabled&&e('exportHint').textContent==='结束编辑后导出','all exporting disabled in edit mode');
        const beforeExport=edit.messages.length;e('exportButton').onclick();check(edit.messages.length===beforeExport,'direct export handler also refuses active edit');
        edit.mode('range');
        for(const node of edit.doc.querySelectorAll('button,input,select,.edit-toolbar,.workspace')){
          const box=node.getBoundingClientRect();if(!box.width||!box.height||e('slots').contains(node))continue;
          check(box.left>=-1&&box.top>=-1&&box.right<=width+1&&box.bottom<=height+1,'edit control fits '+width+'x'+height+' '+(node.id||node.className));
        }
        metrics.push({viewport:[width,height],editToolbar:true,offsetInputs:true,exportDisabled:true});
      }
      const edit=active,e=edit.$;
      e('openAnimation').click();let animationRequest=edit.messages.at(-1);
      check(animationRequest.type==='animation','host-owned animation range picker');
      edit.post({type:'animationFrames',requestId:animationRequest.requestId,revision:edit.editRevision,frames:[edit.slot(0),edit.slot(2),{...edit.slot(1),offsetX:18,offsetY:-6}]});
      edit.post({type:'busy',busy:false});
      await wait(()=>!e('animationControls').hidden&&e('animationIndex').textContent.startsWith('#0'),'animation decoded');
      const cw=e('animationCanvas').width,ch=e('animationCanvas').height;
      e('nextFrame').click();check(e('animationIndex').textContent.startsWith('#2'),'empty slot retains animation frame');
      check(e('animationCanvas').width===cw&&e('animationCanvas').height===ch,'empty frame keeps fixed origin and canvas');
      e('nextFrame').click();check(e('animationIndex').textContent.startsWith('#1'),'per-frame stored offsets');
      check(e('animationCanvas').width===cw&&e('animationCanvas').height===ch,'different offsets do not recenter');
      edit.post({type:'referenceImage',imageUrl:image});await wait(()=>!e('referenceFields').hidden,'reference image decoded');
      e('referenceX').value='-20';e('referenceX').dispatchEvent(new edit.win.Event('input'));
      e('exportAnimation').click();const apng=edit.messages.at(-1);check(apng.type==='exportAnimation'&&apng.ids.join(',')==='0,2,1'&&apng.fps===10,'export intent contains IDs only, no file path');
      e('clearReference').click();check(e('referenceFields').hidden,'reference removal');
      e('closeAnimation').click();check(e('animationControls').hidden&&!e('previewViewport').hidden,'return to still preview');
      e('batchTools').click();const batch=edit.messages.at(-1);check(batch.type==='batchTools'&&batch.ids.join(',')==='0'&&batch.index===0,'typed batch selection');
      edit.post({type:'busy',busy:false});await settle();
      e('previewViewport').dispatchEvent(new edit.win.KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,shiftKey:true,bubbles:true,cancelable:true}));
      const nudge=edit.messages.at(-1);check(nudge.type==='setOffsets'&&nudge.x===-2&&nudge.y===18,'Alt+Shift arrow edits exact offset by ten');
      edit.post({type:'busy',busy:false});await settle();
      const viewport=e('previewViewport'),capture=viewport.setPointerCapture;viewport.setPointerCapture=()=>{};
      viewport.dispatchEvent(new edit.win.PointerEvent('pointerdown',{button:0,altKey:true,pointerId:41,clientX:30,clientY:30,bubbles:true}));
      viewport.dispatchEvent(new edit.win.PointerEvent('pointermove',{pointerId:41,clientX:35,clientY:28,bubbles:true}));
      const beforeDrag=edit.messages.length;
      viewport.dispatchEvent(new edit.win.PointerEvent('pointerup',{pointerId:41,clientX:35,clientY:28,bubbles:true}));
      const dragged=edit.messages.at(-1);check(edit.messages.length===beforeDrag+1&&dragged.type==='setOffsets'&&dragged.x===-7&&dragged.y===16,'Alt drag commits one offset intent');
      viewport.setPointerCapture=capture;edit.post({type:'busy',busy:false});await settle();
      const mutation=(button,type)=>{e(button).click();const result=edit.messages.at(-1);check(result.type===type,'edit intent '+type);check(result.revision===edit.editRevision,'edit revision supplied for '+type);return result;};
      const complete=async(request,changes={})=>{Object.assign(edit,{editRevision:edit.editRevision+1},changes);edit.state(request.requestId);await wait(()=>!e('endEdit').disabled,'editing response unlocks '+request.type);await settle();};
      let request=mutation('replaceImage','importImage');check(request.mode==='replace'&&request.index===0,'replace addresses current logical ID');
      check(e('phaseLabel').textContent==='编辑副本','dirty is not optimistic');
      const oldRevision=edit.editRevision,oldState=edit.stateData(request.requestId-1);
      e('nextPage').click();await wait(()=>edit.item(100),'browse stays available during pending edit');
      check(e('appendImage').disabled&&e('saveAs').disabled,'navigation state cannot unlock pending mutation');
      edit.overrides[0]={modified:true,offsetX:-9};edit.dirty=true;edit.canUndo=true;edit.focus=0;
      await complete(request);
      check(e('phaseLabel').textContent==='编辑 · 未保存'&&e('metaOffsetX').textContent==='-9','completed mutation accepts revision despite later navigation request');
      check(!e('undoEdit').disabled&&e('redoEdit').disabled,'host history updates undo authority');
      const inspect=edit.messages.filter(value=>value.type==='inspect').at(-1);
      edit.replyDetail(inspect.requestId,0,{offsetX:999,imageUrl:'https://example.invalid/stale.png'},oldRevision);
      edit.post(oldState);await settle();check(e('metaOffsetX').textContent==='-9'&&!e('previewStage').hidden,'old revision detail/state cannot replace current preview');
      edit.post({type:'notice',text:'已取消',busy:false});await settle();check(e('phaseLabel').textContent==='编辑 · 未保存','notice cannot clear dirty state');
      edit.jump(0);await wait(()=>edit.item(0)&&!e('previewStage').hidden,'modified slot page');check(!!edit.item(0).querySelector('.modified-mark'),'modified thumbnail is marked');
      edit.capabilities={...editCapabilities,canReplace:false,canAppend:false,canOffsets:false,canSaveAs:false};edit.state();await settle();
      check(e('replaceImage').disabled&&e('appendImage').disabled&&e('editOffsetX').hidden&&e('saveAs').disabled,'individual host capabilities are authoritative');
      edit.capabilities={...editCapabilities};edit.state();await settle();
      edit.click(2);await wait(()=>e('previewEmpty').textContent==='空槽','empty slot for fill');
      check(!e('fillSlot').disabled&&e('replaceImage').disabled&&e('clearSlot').disabled&&e('editOffsetX').disabled,'empty-slot edit gating');
      request=mutation('fillSlot','importImage');check(request.mode==='fill'&&request.index===2,'fill targets exact empty ID');
      edit.overrides[2]={status:'decoded',modified:true};edit.focus=2;await complete(request);check(edit.count===251&&!e('replaceImage').disabled,'filling does not shift logical IDs');
      request=mutation('clearSlot','clearSlot');check(request.index===2,'clear targets exact ID');edit.overrides[2]={status:'empty',modified:true};await complete(request);
      check(edit.count===251&&edit.item(3)&&e('previewEmpty').textContent==='空槽','clear retains next ID and slot count');
      request=mutation('appendImage','importImage');check(request.mode==='append'&&request.index===null,'append has explicit null index');
      edit.overrides[251]={status:'decoded',modified:true};await complete(request,{count:252,start:200,focus:251});
      check(edit.item(251)&&e('metaIndex').textContent==='251'&&!e('previewStage').hidden,'append opens real appended slot');
      edit.click(251);await settle();request=mutation('undoEdit','undo');await complete(request,{count:251,focus:undefined,canRedo:true});
      check(!edit.item(251)&&savedState.focusIndex===null&&!savedState.selectedIds.includes(251)&&e('previewStage').hidden&&!e('previewImage').hasAttribute('src'),'undo shrink clears invalid focus selection and preview');
      request=mutation('redoEdit','redo');await complete(request,{count:252,focus:251,canRedo:false});check(!e('previewStage').hidden&&e('metaIndex').textContent==='251','redo restores host-approved appended slot');
      for(const [x,y] of [['','0'],['1.5','0'],['32768','0'],['-32769','0'],['0','99999']]){
        e('editOffsetX').value=x;e('editOffsetY').value=y;const before=edit.messages.length;e('applyOffsetsEdit').click();check(edit.messages.length===before&&e('statusText').textContent.includes('-32768'),'invalid int16 offset refused '+x+','+y);
      }
      e('editOffsetX').value='-32768';e('editOffsetY').value='32767';const beforeOffset=e('metaOffsetX').textContent;
      request=mutation('applyOffsetsEdit','setOffsets');check(request.x===-32768&&request.y===32767&&request.index===251,'signed int16 extremes are transmitted exactly');
      check(e('metaOffsetX').textContent===beforeOffset,'offset metadata is not optimistic');
      edit.overrides[251]={status:'decoded',modified:true,offsetX:-32768,offsetY:32767};await complete(request);check(e('editOffsetX').value==='-32768'&&e('editOffsetY').value==='32767','host applies exact offsets');
      request=mutation('saveAs','saveAs');const saveRevision=edit.editRevision;
      edit.post({type:'notice',text:'已取消另存',busy:false});await wait(()=>!e('saveAs').disabled,'save picker cancellation unlocks');check(e('phaseLabel').textContent==='编辑 · 未保存','cancelled save retains dirty draft');
      request=mutation('saveAs','saveAs');const replacement=document.createElement('canvas');replacement.width=17;replacement.height=19;replacement.getContext('2d').fillRect(0,0,17,19);
      edit.overrides[251]={status:'decoded',modified:false,offsetX:1,offsetY:2,width:17,height:19,imageUrl:replacement.toDataURL()};
      await complete(request,{name:'已另存.jpk',dirty:false,canUndo:false,canRedo:false});
      await wait(()=>e('previewImage').naturalWidth===17&&!e('previewStage').hidden,'save reload uses new source image URI');
      check(edit.editRevision>saveRevision&&e('phaseLabel').textContent==='编辑副本'&&e('archiveName').textContent==='已另存.jpk','save increments revision, keeps editor session and clears dirty only by state');
      edit.dirty=true;edit.state();await settle();request=mutation('endEdit','endEdit');edit.post({type:'notice',text:'已取消结束编辑',busy:false});await wait(()=>!e('endEdit').disabled,'cancel ending unlocks');
      check(!e('editToolbar').hidden&&e('phaseLabel').textContent==='编辑 · 未保存','cancelled end leaves active dirty editor');
      request=mutation('endEdit','endEdit');const lateActive=edit.stateData(request.requestId-1);
      Object.assign(edit,{editActive:false,editRevision:0,dirty:false,canStartEdit:true,capabilities:{},canUndo:false,canRedo:false});edit.state(request.requestId);
      await wait(()=>e('editToolbar').hidden&&!e('beginEdit').hidden&&!e('exportButton').disabled,'confirmed end returns to revision zero readonly');
      edit.post(lateActive);await settle();check(e('editToolbar').hidden,'late old edit state cannot reactivate ended editor');
      const failed=await create(900,700,undefined,{format:'GOM',canStartEdit:true}),f=failed.$;
      f('beginEdit').click();const failedRequest=failed.messages.at(-1);
      const reason='此 PAK 含未验证数据，暂仅支持浏览/导出。';
      failed.post({type:'notice',text:reason,busy:true});failed.post({type:'busy',busy:false});
      failed.post({...failed.stateData(failedRequest.requestId),notice:reason});
      await wait(()=>!f('editNotice').hidden&&f('statusText').textContent===reason,'failure survives final state');
      check(failed.win.getComputedStyle(f('editNotice')).display!=='none'&&f('editNotice').textContent===reason,'failure reason is visibly retained');
      f('beginEdit').click();check(f('editNotice').hidden,'a new attempt clears stale failure');
      for(const unsupported of ['PAK','unknown']){const readonly=await create(900,700,undefined,{format:unsupported});check(readonly.$('beginEdit').hidden&&readonly.$('editToolbar').hidden,'unsupported '+unsupported+' stays read-only');const before=readonly.messages.length;readonly.$('beginEdit').onclick();check(readonly.messages.length===before,'readonly begin handler refuses');}
      const typedFields={beginEdit:[],importImage:['mode','index','revision'],clearSlot:['index','revision'],setOffsets:['index','x','y','revision'],undo:['revision'],redo:['revision'],saveAs:['revision'],endEdit:['revision']};
      for(const h of hosts){let previous=0;for(const msg of h.messages){check(!Object.keys(msg).some(key=>/path|password|url|file/i.test(key)),'no path/password/image URL emitted');if(msg.type==='ready'){check(typeof msg.documentId==='string'&&msg.documentId.length>8,'ready has document identity');continue;}check(msg.documentId===h.documentId&&Number.isSafeInteger(msg.requestId)&&msg.requestId>previous,'requests monotonically identified');previous=msg.requestId;if(typedFields[msg.type])check(Object.keys(msg).sort().join(',')===['type','documentId','sessionId','requestId',...typedFields[msg.type]].sort().join(','),'only typed fields sent for '+msg.type);}}
      document.body.dataset.metrics=JSON.stringify(metrics);document.body.dataset.testStatus='pass';
    }catch(error){document.body.dataset.testError=error.stack||error.message;document.body.dataset.testStatus='fail';}})();
    </script></body></html>`;
    const htmlPath = path.join(temp, 'resource-editor-browser.html');
    fs.writeFileSync(htmlPath, page);
    const browser = process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const dom = await runChromiumDom(browser, htmlPath, path.join(temp, 'profile'));
    const body = dom.match(/<body[^>]*>/)?.[0] || '';
    console.log(body);
    assert.match(body, /data-test-status="pass"/);
    console.log('resource-editor-browser: PASS real Chromium 900x700/1100x800/1440x960 browse/edit layout, brand/PNG decode, 100-slot pages, ID navigation, cross-page selection, safe URLs, export/cancel/restoration, host-authoritative editing capabilities, typed edit intents, revision/race guards, int16 offsets, stable empty IDs, undo/redo, save-as and ending cancellation; synthetic host/archive fixtures');
  } finally {
    removeTemporaryDirectory(temp, 'boo-resource-editor-');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
