const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-ui-background-lock-'));

async function main() {
  try {
    let html = fs.readFileSync(path.join(runtime, 'media/editor.html'), 'utf8');
    html = html.replace('<script>', '<script>window.acquireVsCodeApi=()=>({postMessage(){},getState(){return{}},setState(){}});</script><script>');
    html = html.replace(/        \}\)\(\);\s*<\/script>/, `
      (async function () {
        const check = (value, message) => { if (!value) throw Error(message); };
        const wait = (predicate, label) => new Promise((resolve, reject) => {
          let n = 0; const tick = () => predicate() ? resolve() : n++ > 200 ? reject(Error('wait timeout: ' + label + '; elements=' + elements.length)) : setTimeout(tick, 10); tick();
        });
        const key = (key, ctrlKey = false) => document.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true }));
        const mouse = (type, x, y, ctrlKey = false) => {
          const rect = canvas.getBoundingClientRect();
          canvas.dispatchEvent(new MouseEvent(type, { clientX: rect.left + x * zoom, clientY: rect.top + y * zoom, ctrlKey, bubbles: true }));
        };
        const drag = (x, y, dx, dy, ctrlKey = false) => { mouse('mousedown', x, y, ctrlKey); mouse('mousemove', x + dx, y + dy); mouse('mouseup', x + dx, y + dy); };
        try {
          const bitmap = document.createElement('canvas'); bitmap.width = 300; bitmap.height = 200;
          bitmap.getContext('2d').fillRect(0, 0, 300, 200);
          const url = bitmap.toDataURL(), img = new Image(); img.src = url; await img.decode();
          const fixture = (extra = {}) => ({ img, x: 0, y: 0, w: 300, h: 200, name: 'background', isImgTag: true, assetIdx: 1, willIdx: 7, ...extra });
          function install(items) { elements = items; selectedIdx = -1; selectedIndices = []; isDragging = false; zoom = 1; updatePropsPanel(); redraw(); }
          install([fixture(), fixture({ x: 80, y: 60, w: 20, h: 20, assetIdx: 2, name: 'ordinary' })]);
          drag(20, 20, 30, 25);
          check(elements[0].x === 0 && elements[0].y === 0, 'background mouse drag must keep origin');
          check(selectedIdx === 0, 'background remains selectable for dialog settings');
          check(document.getElementById('propX').readOnly && document.getElementById('propY').readOnly, 'background coordinates are visibly read-only');
          key('ArrowRight'); key('ArrowDown');
          window.updateElementProp(0, 'x', 91); window.updateElementProp(0, 'y', -19);
          check(elements[0].x === 0 && elements[0].y === 0, 'keyboard and coordinate handler cannot move background');
          updateDialogConfig('offsetX', 17); updateDialogConfig('offsetY', -13); updateDialogConfig('allowMove', 1);
          check(dialogConfig.offsetX === 17 && dialogConfig.offsetY === -13 && dialogConfig.allowMove === 1, 'game dialog placement remains editable');
          drag(85, 65, 12, 9);
          check(elements[1].x === 92 && elements[1].y === 69, 'ordinary image drag stays enabled');
          check(!document.getElementById('propX').readOnly, 'ordinary image coordinates stay editable');
          window.updateElementProp(1, 'x', 101); key('ArrowDown');
          check(elements[1].x === 101 && elements[1].y === 70, 'ordinary image property and keyboard remain enabled');
          // Ctrl-select background and image, then drag the image as a group.
          mouse('mousedown', 20, 20, true); mouse('mouseup', 20, 20);
          drag(105, 75, 6, 8, true);
          check(elements[0].x === 0 && elements[0].y === 0 && elements[1].x === 107 && elements[1].y === 78, 'multi-select drag skips background only');
          key('ArrowLeft');
          check(elements[0].x === 0 && elements[1].x === 106, 'multi-select keyboard skips background only');
          selectedIdx = 0; selectedIndices = []; copySelectedElements(); pasteElements();
          const copied = elements[2]; window.updateElementProp(2, 'x', 45);
          check(copied.x === 45 && findDialogBgIndex() === 0, 'pasted background is a movable image, not another background');
          window.deleteElement(0);
          check(findDialogBgIndex() === -1 && elements[0].x === 106, 'deleting background does not promote another image');
          check(!generateCodeSilent('7').includes('OPENMERCHANTBIGDLG'), 'ordinary image remains ordinary in generated code');
          // A legacy saved array may start with text. Only its first plain image is the background.
          install([fixture({ isImgTag: false, isText: true, textContent: 'text', x: 20, y: 20, w: 20, h: 15 }), fixture({ x: 31, y: 22 }), fixture({ isImgTag: false, isButton: true, x: 90, y: 90, w: 20, h: 20 })]);
          check(findDialogBgIndex() === 1 && elements[0].x === 20 && elements[1].x === 0 && elements[1].y === 0, 'legacy identity is not based on array index');
          window.selectElement(0); key('ArrowRight'); check(elements[0].x === 21, 'first text remains movable');
          drag(95, 95, 4, 3); check(elements[2].x === 94 && elements[2].y === 93, 'button remains movable');
          install([fixture({ isImgTag: false, isText: true, isDialogBg: true, textContent: 'text' })]);
          check(findDialogBgIndex() === -1, 'stale marker cannot lock a text element');
          const restored = fixture({ x: 80, y: 90, isDialogBg: true });
          deserializeAndApplyElements([serializeElement(restored), serializeElement(fixture({ x: 42, y: 35, w: 20, h: 20, isDialogBg: false }))]);
          check(elements[0].x === 0 && elements[0].y === 0 && elements[1].x === 42, 'deserialization normalizes only background origin');
          await wait(() => elements.every(el => el.img.complete), 'restore images');
          const saved = elements.map(serializeElement);
          install([]); deserializeAndApplyElements(saved);
          check(findDialogBgIndex() === 0 && elements[1].isDialogBg === false, 'reopen retains background identity');
          window.renderAssetsFromFiles([]);
          check(findDialogBgIndex() === 0 && elements[0].x === 0 && elements[1].x === 42, 'closing packages does not change canvas identity or coordinates');
          window.renderAssetsFromFiles([{ name: 'fixture.png', url, width: 300, height: 200, willIdx: 7, imageIdx: 1, pakName: 'fixture', isBlank: false }]);
          window._pakMode = true; window._pakList = [{ name: 'fixture', willIdx: 7 }];
          selectedIndices = [0, 1]; isDragging = true;
          window.dispatchEvent(new MessageEvent('message', { data: { type: 'clearCanvas' } }));
          check(elements.length === 0 && selectedIndices.length === 0 && !isDragging, 'actual clear discards old selection and drag state');
          window.addToCanvas(0); await wait(() => elements.length === 1, 'new background');
          check(elements[0].isDialogBg === true && elements[0].x === 0, 'new background after clear is anchored');
          window.addImageToCanvas(0); await wait(() => elements.length === 2, 'second image');
          check(elements[1].isDialogBg === false, 'later image additions stay movable');
          parseCodeToCanvasSilent('<&img:1:7:034:056>'); await wait(() => elements.length === 1, 'source image');
          check(findDialogBgIndex() === -1 && elements[0].x === 34 && elements[0].y === 56, 'source image without dialog is not a background');
          check(!generateCodeSilent('7').includes('OPENMERCHANTBIGDLG'), 'source-only image does not invent dialog on export');
          parseCodeToCanvasSilent('OPENMERCHANTBIGDLG 7 1 1 4 10 20 0 0 0\\n<&img:1:7:034:056>');
          await wait(() => elements.length === 2, 'source dialog');
          check(findDialogBgIndex() === 0 && elements[0].x === 0 && elements[1].x === 34, 'source dialog and child image keep separate roles');
          check(generateCodeSilent('7').includes('OPENMERCHANTBIGDLG 7 1 1 4 10 20'), 'client placement parameters survive lock');
          document.getElementById('codeOutput').value = '<&img:1:7:034:056>';
          parseCodeToCanvas(); await wait(() => elements.length === 1, 'manual source image');
          check(findDialogBgIndex() === -1 && elements[0].x === 34 && elements[0].y === 56, 'manual parser also keeps ordinary image position');
          generateCode(); check(!document.getElementById('codeOutput').value.includes('OPENMERCHANTBIGDLG'), 'manual code generation does not promote plain image');
          document.body.dataset.testStatus = 'pass';
        } catch (error) { document.body.dataset.testStatus = 'fail'; document.body.dataset.testError = error.stack || error.message; }
      })();
        })();</script>`);
    const file = path.join(temp, 'index.html'); fs.writeFileSync(file, html);
    const dom = await runChromiumDom(process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe', file, path.join(temp, 'profile'));
    const body = dom.match(/<body[^>]*>/)?.[0] || ''; console.log(body);
    assert.match(body, /data-test-status="pass"/);
    console.log('ui-background-lock-browser: PASS background origin, mouse/multi-selection/keyboard/properties, ordinary elements, source parsing, clone/delete/reopen and clear; synthetic DOM input');
  } finally { removeTemporaryDirectory(temp); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
