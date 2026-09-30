const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-archive-id-navigation-'));

async function main() {
  try {
    let html = fs.readFileSync(path.join(runtime, 'media/editor.html'), 'utf8');
    html = html.replace('<script>', '<script>window.__messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__messages.push(m),getState(){return{}},setState(){}});</script><script>');
    html = html.replace('</body>', `<script>
      (async function() {
        const $=id=>document.getElementById(id),check=(value,message)=>{if(!value)throw Error(message);};
        const wait=(predicate,label)=>new Promise((resolve,reject)=>{let n=0;const tick=()=>predicate()?resolve():n++>200?reject(Error('wait: '+label)):setTimeout(tick,10);tick();});
        const settle=()=>new Promise(resolve=>setTimeout(resolve,170));
        const change=(node,value)=>{node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));};
        const type=(node,value)=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));};
        const entries=[
          ['imageSelectorModal','showImageSelector'],['buttonSelectorModal','showButtonSelector'],
          ['effectSelectorModal','showEffectSelector'],['closeBtnDialog','selectCloseBtnFiles'],
          ['equipFrameDialog','selectEquipFrameFiles'],['progressBarDialog','selectProgressBarFiles']
        ];
        const completed=[];
        function controls(id) {
          const modal=$(id),progress=id==='progressBarDialog';
          return {modal,grid:progress?$('progressBarPakGrid'):modal.querySelector('.dialog-asset-item')?.parentElement,
            pak:modal.querySelector(progress?'#progressBarPakFilter':'.archive-selector-pak'),
            query:modal.querySelector(progress?'#progressBarSlotSearch':'.archive-selector-query'),
            info:modal.querySelector(progress?'#progressBarPageInfo':'.archive-selector-page'),
            prev:modal.querySelector(progress?'#progressBarPagePrev':'.archive-selector-prev'),
            next:modal.querySelector(progress?'#progressBarPageNext':'.archive-selector-next')};
        }
        const nodes=c=>Array.from(c.grid.querySelectorAll('.dialog-asset-item'));
        const item=(c,pak,id)=>nodes(c).find(node=>node.title===pak+' #'+id);
        const styleSignature=node=>{const s=getComputedStyle(node);return [s.outline,s.boxShadow,s.borderColor,s.backgroundColor].join('|');};
        const highlighted=(c,pak,id)=>{
          const target=item(c,pak,id);if(!target)return false;
          const counts=new Map();for(const node of nodes(c)){if(node===target)continue;const signature=styleSignature(node);counts.set(signature,(counts.get(signature)||0)+1);}
          const ordinary=Array.from(counts).sort((left,right)=>right[1]-left[1])[0];
          return !!ordinary&&ordinary[1]>nodes(c).length/2&&styleSignature(target)!==ordinary[0];
        };
        const samePage=(c,pak,first,last,count)=>nodes(c).length===count&&!!item(c,pak,first)&&!!item(c,pak,last);
        const close=c=>c.modal.querySelector('button').click();
        try {
          const raster=document.createElement('canvas');raster.width=raster.height=4;raster.getContext('2d').fillRect(0,0,4,4);const url=raster.toDataURL();
          const files=Array.from({length:502},(_,index)=>{const id=index%251;return {name:id===205?'needle <literal>':String(id).padStart(6,'0'),imageIdx:id,localIdx:id,
            pakName:index<251?'first.pak':'second.pak',willIdx:index<251?2:7,width:4,height:4,url,decodeStatus:'decoded',isBlank:false};});
          const load=(files,catalog)=>window.dispatchEvent(new MessageEvent('message',{data:{type:'loadAssets',files,assetCatalog:catalog,pakMode:true,
            pakList:catalog?[{name:'million.pak',willIdx:7}]:[{name:'first.pak',willIdx:2},{name:'second.pak',willIdx:7}]}}));
          load(files);
          for(const [id,action]of entries){
            document.querySelector('[data-action="'+action+'"]').click();const c=controls(id);check(c.modal&&c.grid,id+' opens');
            check(nodes(c).length===100,id+' first page contains exactly 100 items, not a viewport-dependent count');
            change(c.pak,'second.pak');await wait(()=>samePage(c,'second.pak',0,99,100),id+' selected package first page');
            for(const logical of [0,99,100,250]){
              type(c.query,String(logical));const first=Math.floor(logical/100)*100,last=Math.min(250,first+99),count=last-first+1;
              await wait(()=>samePage(c,'second.pak',first,last,count)&&highlighted(c,'second.pak',logical),id+' locate '+logical);
              check(c.info.textContent.includes('3')&&c.info.textContent.includes('251'),id+' navigation retains total package slots');
              check(!item(c,'first.pak',logical),id+' duplicate ID does not cross package identity');
              const target=item(c,'second.pak',logical),rect=target.getBoundingClientRect(),grid=c.grid.getBoundingClientRect();
              const gridStyle=getComputedStyle(c.grid),targetStyle=getComputedStyle(target);
              check(rect.bottom>grid.top&&rect.top<grid.bottom,id+' target scrolled into visible grid '+JSON.stringify({
                logical,target:{top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,height:rect.height},
                grid:{top:grid.top,bottom:grid.bottom,height:grid.height,scrollTop:c.grid.scrollTop,clientHeight:c.grid.clientHeight,scrollHeight:c.grid.scrollHeight},
                gridStyle:{height:gridStyle.height,minHeight:gridStyle.minHeight,maxHeight:gridStyle.maxHeight,overflowY:gridStyle.overflowY,display:gridStyle.display,flex:gridStyle.flex,rows:gridStyle.gridTemplateRows},
                targetStyle:{height:targetStyle.height,display:targetStyle.display},viewport:{width:innerWidth,height:innerHeight}}));
            }
            // The unchanged numeric input is a location, not a sticky filter.
            c.prev.click();check(samePage(c,'second.pak',100,199,100),id+' previous page works with ID still entered');
            await settle();check(samePage(c,'second.pak',100,199,100),id+' stale input timer must not pull page back');
            c.prev.click();check(samePage(c,'second.pak',0,99,100),id+' second previous page works');
            c.next.click();check(samePage(c,'second.pak',100,199,100),id+' next page works with ID still entered');
            type(c.query,'250');
            // Native pointer focus transfer commits the edited input before button click.
            // .click() alone does not reproduce this browser event order.
            c.query.dispatchEvent(new Event('change',{bubbles:true}));
            c.prev.click();await settle();
            check(samePage(c,'second.pak',0,99,100),id+' blur/change before pagination must not relocate pending ID first');
            c.query.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
            await wait(()=>samePage(c,'second.pak',200,250,51)&&highlighted(c,'second.pak',250),id+' Enter locates entered ID again');
            c.prev.click();check(samePage(c,'second.pak',100,199,100),id+' previous page remains available after explicit relocation');
            for(const invalid of ['-1','1.5','1e2','9007199254740992','999']){
              type(c.query,invalid);await settle();check(samePage(c,'second.pak',100,199,100),id+' invalid/unmatched '+invalid+' leaves browsable current page');
            }
            type(c.query,'needle');await wait(()=>nodes(c).length===1&&item(c,'second.pak',205),id+' name filtering remains available');
            check(!c.modal.querySelector('literal'),id+' asset name is escaped');
            type(c.query,'');await wait(()=>samePage(c,'second.pak',0,99,100),id+' clearing query restores package');
            change(c.pak,'');type(c.query,'100');await settle();
            check(nodes(c).length===100&&c.info.textContent.includes('502'),id+' ambiguous ID retains complete multi-package list');
            check(!highlighted(c,'first.pak',100)&&!highlighted(c,'second.pak',100),id+' ambiguous ID is not arbitrarily chosen');
            check(($('toast')?.textContent||c.modal.textContent).includes('资源包')||c.modal.textContent.includes('素材包'),id+' ambiguous ID offers package choice');
            change(c.pak,'first.pak');await wait(()=>samePage(c,'first.pak',100,199,100)&&highlighted(c,'first.pak',100),id+' package change resolves same entered ID');
            close(c);check(!$(id),id+' closes');completed.push(id);
          }
          // Main asset list already locates without filtering; keep its full source and scroll context.
          document.querySelector('#pakTabBar [data-action="switchVisiblePakTab"][data-idx="1"]').click();
          const label=$('fileCount').textContent;type($('archiveSlotId'),'250');$('archiveSlotId').closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
          await wait(()=>$('archiveInspectorTitle')?.textContent.includes('250'),'main list inspector tail');
          check($('fileCount').textContent===label&&document.querySelectorAll('#assetsList .asset-item').length>1,'main list keeps neighbor slots and total count');
          $('archiveInspectorClose').click();$('assetsList').scrollTop=0;$('assetsList').dispatchEvent(new Event('scroll'));
          await wait(()=>document.querySelector('#assetsList [data-idx="251"]'),'main list scroll can return to package start');
          // A compact million-slot catalog must jump to the final 100 slots, not a one-row result.
          const catalog={version:1,segments:[{kind:'direct',pakName:'million.pak',pakPath:'fixture.pak',willIdx:7,source:'pak',archiveId:'a'.repeat(64),indexGeneration:'b'.repeat(32),profileId:'pack4-plain-bgra',slotCount:1000000,urlTemplate:url+'#{id}',records:[[999999,4,4,0,0,'decoded']]}]};
          load(undefined,catalog);
          for(const [id,action]of entries){
            document.querySelector('[data-action="'+action+'"]').click();const c=controls(id);type(c.query,'999999');
            await wait(()=>samePage(c,'million.pak',999900,999999,100)&&highlighted(c,'million.pak',999999),id+' million-slot tail');
            check(c.info.textContent.includes('10000/10000')&&c.info.textContent.includes('1000000'),id+' exact million-slot pagination');
            c.prev.click();check(samePage(c,'million.pak',999800,999899,100),id+' tail previous page preserves empty logical slots');
            close(c);
          }
          document.body.dataset.testStatus='pass';document.body.dataset.completed=JSON.stringify(completed);
        }catch(error){document.body.dataset.testStatus='fail';document.body.dataset.testError=error.stack||error.message;}
      })();
    </script></body>`);
    const file=path.join(temp,'index.html');fs.writeFileSync(file,html);
    const dom=await runChromiumDom(process.env.BOO_BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',file,path.join(temp,'profile'));
    const body=dom.match(/<body[^>]*>/)?.[0]||'';console.log(body);assert.match(body,/data-test-status="pass"/);
    console.log('archive-id-navigation-browser: PASS 100-item pages, ID location rather than filtering, highlight/visibility, package identity, text filtering, invalid inputs, persistent navigation and million-slot tail; synthetic DOM input');
  } finally { removeTemporaryDirectory(temp); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
