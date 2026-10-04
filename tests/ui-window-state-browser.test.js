const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-ui-window-state-'));

async function main() {
  try {
    let editor = fs.readFileSync(path.join(runtime, 'media/editor.html'), 'utf8');
    editor = editor.replace('<script>', '<script>window.acquireVsCodeApi=()=>parent.makeApi();</script><script>');
    editor = editor.replace(/        \}\)\(\);\s*<\/script>/, `
      window.stateProbe = {
        async setup() {
          const bitmap = document.createElement('canvas'); bitmap.width = 16; bitmap.height = 16;
          const draw = color => { bitmap.getContext('2d').fillStyle = color; bitmap.getContext('2d').fillRect(0,0,16,16); return bitmap.toDataURL(); };
          const image = async url => { const img = new Image(); img.src = url; await img.decode(); return img; };
          const red = await image(draw('#ff0000')), green = await image(draw('#00ff00')), blue = await image(draw('#0000ff'));
          const blob = await (await fetch(red.src)).blob(); const local = await image(URL.createObjectURL(blob));
          const transparent = document.createElement('canvas'); transparent.width = 16; transparent.height = 16;
          const textRaster = renderTextToCanvas('跨窗文字', 251, '文字触发', '宋体', 14, true);
          const textImg = await image(textRaster.canvas.toDataURL());
          elements = [
            { img:local, x:0,y:0,w:120,h:90,name:'background',isImgTag:true,isDialogBg:true,willIdx:7,assetIdx:1 },
            { img:red,x:25,y:30,w:16,h:16,name:'effect',isEffect:true,willIdx:7,effectStartIdx:2,effectFrameCount:3,effectSpeed:1000,effectFrames:[red,transparent,blue],effectCurrentFrame:0,effectLastTime:Date.now() },
            { img:red,x:55,y:30,w:16,h:16,name:'button',isButton:true,willIdx:7,buttonImages:[2,3,4],buttonImgs:{default:red,hover:green,click:blue},buttonState:'default',buttonScript:'trigger' },
            { img:green,x:78,y:30,w:16,h:16,name:'countdown',isCountdown:true,countdownSeconds:123,countdownColor:250 },
            { img:blue,x:15,y:60,w:16,h:16,name:'legacy animation',isAnim:true,animFrames:[red,blue],animSpeed:1000,animCurrentFrame:0 },
            { img:green,x:90,y:60,w:16,h:16,name:'progress',isProgressBar:true,progressBarBgIdx:6,progressBarFillIdx:7,progressBarOffsetX:-4,progressBarOffsetY:9 },
            { img:textImg,x:120,y:95,w:textRaster.width,h:textRaster.height,name:'text',isText:true,textContent:'跨窗文字',textColor:251,textScript:'文字触发',textFont:'宋体',textSize:14,textBold:true }
          ];
          canvasW=320;canvasH=240;canvas.width=320;canvas.height=240;zoom=1.25;updateCanvasSize();
          dialogConfig.willIndex='7';dialogConfig.offsetX=18;dialogConfig.offsetY=-21;dialogConfig.allowMove=1;
          document.getElementById('willIndex').value='7';selectedIdx=2;selectedIndices=[1,2];
          const catalog={version:1,segments:[{kind:'direct',pakName:'million.pak',pakPath:'fixture.pak',willIdx:7,source:'pak',archiveId:'a'.repeat(64),indexGeneration:'b'.repeat(32),profileId:'pack4-plain-bgra',slotCount:1000000,urlTemplate:red.src+'#{id}',records:[[1,16,16,0,0,'decoded']]}]};
          window.renderAssetsFromFiles([],catalog);updatePropsPanel();redraw();startEffectAnimation();
          // A just-entered draft must survive before its 800 ms parse debounce.
          document.getElementById('codeOutput').value='// unsaved code draft';
          document.getElementById('codeOutput').dispatchEvent(new Event('input',{bubbles:true}));
        },
        inspect() {return { count:elements.length,canvasW,canvasH,zoom,selectedIdx,selectedIndices: Array.from(selectedIndices),config:{...dialogConfig},code:document.getElementById('codeOutput').value,
          catalogCount:folderAssets.length, frames:elements[1]?.effectFrames?.length,button:!!elements[2]?.buttonImgs,seconds:elements[3]?.countdownSeconds,
          legacy:elements[4]?.animFrames?.length, effectFrame:elements[1]?.effectCurrentFrame,animFrame:elements[4]?.animCurrentFrame,
          allLoaded:elements.every(el=>el.img instanceof HTMLCanvasElement || (el.img.complete && el.img.naturalWidth>0)),
          progress:elements[5]?.progressBarOffsetX,background:elements[0]?.isDialogBg,backgroundX:elements[0]?.x,
          text:elements[6]&&{content:elements[6].textContent,color:elements[6].textColor,script:elements[6].textScript,font:elements[6].textFont,size:elements[6].textSize,bold:elements[6].textBold} };},
        pixel(index){const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(elements[index].img,0,0,1,1);return Array.from(c.getContext('2d').getImageData(0,0,1,1).data);},
        canvasPixel(){return Array.from(ctx.getImageData(1,1,1,1).data);},
        imageHash(index){const img=elements[index].img,c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const cx=c.getContext('2d');cx.drawImage(img,0,0);const bytes=cx.getImageData(0,0,c.width,c.height).data;let hash=2166136261,visible=0;for(let i=0;i<bytes.length;i++){hash=Math.imul(hash^bytes[i],16777619);if(i%4===3&&bytes[i]>0)visible++;}return {hash:hash>>>0,visible,width:c.width,height:c.height};},
        button(type){const r=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent(type,{clientX:r.left+60*zoom,clientY:r.top+35*zoom,bubbles:true}));},
        pauseAnimation(){if(effectAnimationId){cancelAnimationFrame(effectAnimationId);effectAnimationId=null;}},
        clear(){window.clearCanvas();},
        changeProperty(){window.updateButtonScript(2,'changed-trigger');},
        dragBurst(){selectedIndices=[];const r=canvas.getBoundingClientRect();const send=(type,x,y)=>canvas.dispatchEvent(new MouseEvent(type,{clientX:r.left+x*zoom,clientY:r.top+y*zoom,bubbles:true}));send('mousedown',60,35);for(let i=1;i<=80;i++)send('mousemove',60+i/10,35+i/10);send('mouseup',68,43);},
        pagehide(){window.dispatchEvent(new PageTransitionEvent('pagehide'));}
      };
        })();</script>`);
    const parent = `<!doctype html><html><body><script>
      const editor = ${JSON.stringify(editor).replace(/<\//g, '<\\/')};
      let saved, calls=[], messages=[];
      window.makeApi=()=>({getState(){return saved&&JSON.parse(JSON.stringify(saved));},setState(value){saved=JSON.parse(JSON.stringify(value));calls.push(saved);return value;},postMessage(value){messages.push(value);}});
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=predicate=>new Promise((resolve,reject)=>{let n=0;const tick=()=>predicate()?resolve():n++>400?reject(Error('wait timeout')):setTimeout(tick,10);tick();});
      const newFrame=async()=>{const frame=document.createElement('iframe');frame.style='width:1200px;height:800px';frame.srcdoc=editor;document.body.appendChild(frame);await wait(()=>frame.contentWindow.stateProbe);return frame;};
      (async()=>{try{
        let frame=await newFrame(),probe=frame.contentWindow.stateProbe;
        await probe.setup();
        check(saved&&saved.elements?.length===7,'editing persists complete canvas before window movement');
        check(saved.codeText==='// unsaved code draft','code input is saved immediately before debounce');
        check(!('folderAssets' in saved)&&!('assetCatalog' in saved),'million-slot assets are not copied into Webview state');
        check(JSON.stringify(saved).length<30000,'sparse material catalog does not inflate canvas snapshot');
        check(!JSON.stringify(saved).includes('blob:'),'ephemeral blob images have durable pixels');
        const before=saved,textBefore=probe.imageHash(6),cut=calls.length;frame.remove();
        frame=await newFrame();probe=frame.contentWindow.stateProbe;
        check(calls.slice(cut).every(item=>item.elements.length===7),'new document initialization never overwrites canvas with empty state');
        let state=probe.inspect();check(state.count===7&&state.canvasW===320&&state.canvasH===240&&state.zoom===1.25,'canvas geometry survives document replacement');
        check(state.selectedIdx===2&&JSON.stringify(state.selectedIndices)==='[1,2]','selection survives replacement');
        check(state.config.offsetX===18&&state.config.offsetY===-21&&state.code==='// unsaved code draft','dialog parameters and code draft survive replacement');
        check(state.catalogCount===0,'asset catalog is rehydrated by host, not stale frontend state');
        await wait(()=>probe.inspect().allLoaded);state=probe.inspect();
        check(state.frames===3&&state.button&&state.legacy===2&&state.seconds===123&&state.progress===-4,'all dynamic source fields are reconstructed');
        check(state.background&&state.backgroundX===0,'background lock survives window movement');
        check(JSON.stringify(probe.pixel(0))==='[255,0,0,255]','blob background pixels survive destroyed origin');
        // Image.complete can precede its queued load callback, which repaints the canvas.
        // Observe the production draw; do not force redraw or relax the exact pixel assertion.
        await wait(()=>JSON.stringify(probe.canvasPixel())==='[255,0,0,255]');
        check(JSON.stringify(probe.canvasPixel())==='[255,0,0,255]','restored image is actually drawn on the production canvas');
        check(JSON.stringify(state.text)===JSON.stringify({content:'跨窗文字',color:251,script:'文字触发',font:'宋体',size:14,bold:true}),'text content and style/action parameters survive');
        check(textBefore.visible>0&&JSON.stringify(probe.imageHash(6))===JSON.stringify(textBefore),'restored text is rendered with identical nonempty pixels');
        probe.button('mousemove');check(JSON.stringify(probe.pixel(2))==='[0,255,0,255]','button hover image restored');
        probe.button('mousedown');check(JSON.stringify(probe.pixel(2))==='[0,0,255,255]','button click image restored');probe.button('mouseup');
        const effectFrames=new Set(),legacyFrames=new Set();await new Promise(resolve=>{let n=0;const tick=()=>{const s=probe.inspect();effectFrames.add(s.effectFrame);legacyFrames.add(s.animFrame);if(n++<30)setTimeout(tick,15);else resolve();};tick();});
        check(effectFrames.size>1&&legacyFrames.size>1,'effect and legacy animation actually advance after restore');
        // Let the event-driven code update settle before measuring animation-only state writes.
        await new Promise(resolve=>setTimeout(resolve,350));const animationCalls=calls.length;
        await new Promise(resolve=>setTimeout(resolve,150));check(calls.length===animationCalls,'animation RAF never persists snapshots');
        const dragCalls=calls.length;probe.dragBurst();check(calls.length-dragCalls<=2,'eighty mousemove events coalesce into a bounded snapshot write');check(saved.elements[2].x===63,'mouseup flushes final drag position');
        probe.changeProperty();probe.pagehide();check(saved.elements[2].buttonScript==='changed-trigger','property-only edit and pagehide are captured');
        probe.clear();probe.pagehide();check(saved.elements.length===0,'intentional clear persists an empty canvas');frame.remove();
        frame=await newFrame();check(frame.contentWindow.stateProbe.inspect().count===0,'cleared canvas remains empty on next move');frame.remove();
        saved={version:999,elements:before.elements};frame=await newFrame();check(frame.contentWindow.stateProbe.inspect().count===0,'unknown state schema is ignored without crash');frame.remove();
        document.body.dataset.testStatus='pass';document.body.dataset.stateBytes=String(JSON.stringify(before).length);
      }catch(error){document.body.dataset.testStatus='fail';document.body.dataset.testError=error.stack||error.message;}})();
    </script></body></html>`;
    const file = path.join(temp, 'index.html'); fs.writeFileSync(file, parent);
    const dom = await runChromiumDom(process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', file, path.join(temp, 'profile'));
    const body = dom.match(/<body[^>]*>/)?.[0] || ''; console.log(body); assert.match(body, /data-test-status="pass"/);
    console.log('ui-window-state-browser: PASS destroyed/recreated production documents, compact state, images, dynamic frames, button states, geometry, code, selection and clear; mocked VS Code state API');
  } finally { removeTemporaryDirectory(temp); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
