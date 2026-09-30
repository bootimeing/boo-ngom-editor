// Independent regression probes discovered in the 2026-09-26 integration review.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-archive-review-'));
async function main() {
  const failures = [];
  try {
    const { describeArchiveImage } = require(path.join(runtime, 'out/utils/archive-image-metadata'));
    const { renderJpkRgba } = require(path.join(runtime, 'out/utils/jpk-reader'));
    const block = { imageType:32, bitsPerPixel:32, alpha:false, flags:0, width:1, height:1, rawSize:4 };
    const rgba = renderJpkRgba(Buffer.alloc(4), block, Buffer.alloc(1024));
    assert.equal(rgba[3], 255, 'independent production renderer confirms opaque black JPK without alpha');
    const metadata = describeArchiveImage({ format:'JPK', profileId:'jpk-gamelib' }, block);
    if (/色键/.test(metadata.alpha)) failures.push('JPK metadata claims color-key alpha, but production decoder returns alpha=255 for black');
    const paletteAlpha = describeArchiveImage({ format:'GEE' }, { ...block, imageType:3 });
    if (!/调色板|palette/i.test(paletteAlpha.alpha)) failures.push('GEE indexed-8 metadata omits actual palette alpha');
    let html = fs.readFileSync(path.join(runtime, 'media/editor.html'), 'utf8');
    html = html.replace('<script>', '<script>window.__messages=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__messages.push(m)},getState(){return{}},setState(){}});</script><script>');
    html = html.replace('</body>', `<script>(async()=>{
      const failures=[], $=id=>document.getElementById(id);
      const wait=p=>new Promise((resolve,reject)=>{let n=0;const tick=()=>p()?resolve():n++>200?reject(Error('wait timeout')):setTimeout(tick,10);tick();});
      const check=(value,message)=>{if(!value)failures.push(message);};
      try {
        const canvas=document.createElement('canvas'); canvas.width=4; canvas.height=4; const url=canvas.toDataURL();
        const files=[200,100].map((id,index)=>({name:String(id),imageIdx:id,localIdx:id,willIdx:1,pakName:'first.pak',
          width:4,height:4,offsetX:0,offsetY:0,url,decodeStatus:index===0?'recovered':'decoded',failureCode:index===0?'checksum-recovered':undefined}));
        window.dispatchEvent(new MessageEvent('message',{data:{type:'loadAssets',files,pakMode:true,pakList:[{name:'first.pak',willIdx:1}]}}));
        document.querySelector('[data-action="selectProgressBarFiles"]').click();
        check($('progressBarDialog').contains(document.activeElement),'opening progress dialog must focus inside modal before keyboard input');
        const recovered=document.querySelector('#progressBarPakGrid [data-asset-index="0"]');
        check(!recovered.disabled,'checksum-recovered image must remain selectable in progress dialog');
        recovered.click();
        check(window._progressBarBgSelected?.name==='200','recovered selection must be accepted by handler');
        window.closeProgressBarDialog();
        // Historical array position changed, but stable logical ID and package identity still resolve correctly.
        const old={name:'100',imageIdx:100,willIdx:1,pakName:'first.pak',assetIdx:0};
        window.dispatchEvent(new MessageEvent('message',{data:{type:'loadQuickImports',imports:{progressBar:{bg:old,fill:old,willIdx:1}}}}));
        document.querySelector('[data-action="selectProgressBarFiles"]').click();
        await wait(()=>$('progressBarComposite').dataset.drawn==='true');
        window.confirmProgressBarSelection();
        const saved=window.__messages.findLast(message=>message.type==='saveQuickImport'&&message.importType==='progressBar');
        check(saved?.data.bg.imageIdx===100 && saved?.data.fill.imageIdx===100,'restored preview ID100 must not save stale array-position ID200');
      }catch(error){failures.push(error.stack||String(error));}
      document.body.dataset.reviewFailures=JSON.stringify(failures); document.body.dataset.testStatus='pass';
    })();</script></body>`);
    const file=path.join(temporary,'review.html'); fs.writeFileSync(file,html);
    const dom=await runChromiumDom(process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe',file,path.join(temporary,'profile'));
    const body=dom.match(/<body[^>]*>/)?.[0] || '';
    const encoded=body.match(/data-review-failures="([^"]*)"/)?.[1];
    assert.ok(encoded !== undefined,'browser review completion required');
    failures.push(...JSON.parse(encoded.replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')));
    assert.deepEqual(failures, [], 'independent integration boundaries');
    console.log('archive-review-boundaries.test.js: PASS (decoder metadata fidelity, recovered selection, modal focus, restored logical ID)');
  } finally { removeTemporaryDirectory(temporary); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
