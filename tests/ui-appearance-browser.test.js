// Layout and appearance contract for the production UI editor. The fixture supplies
// synthetic assets through its public host protocol; no production style is replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const WebSocketImpl = globalThis.WebSocket || require('undici').WebSocket;
const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const baseline = process.env.BOO_UI_APPEARANCE_BASELINE === '1';
const output = process.env.BOO_UI_APPEARANCE_ARTIFACTS && path.resolve(process.env.BOO_UI_APPEARANCE_ARTIFACTS);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function browserSession(htmlPath, profilePath, task) {
  const browser = process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
    '--remote-debugging-port=0', '--allow-file-access-from-files', '--user-data-dir=' + profilePath, 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.resume();
  let startupError, socket, sequence = 0;
  child.once('error', error => { startupError = error; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const pending = new Map();
  try {
    let port;
    const deadline = Date.now() + 20000;
    while (!port) {
      if (startupError) throw startupError;
      if (child.exitCode !== null || Date.now() > deadline) throw Error('Chromium startup failed');
      try {
        const value = fs.readFileSync(path.join(profilePath, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0];
        if (/^[1-9]\d*$/.test(value) && Number(value) <= 65535) port = value;
      } catch (error) { if (!['ENOENT', 'EBUSY', 'EACCES'].includes(error.code)) throw error; }
      if (!port) await delay(50);
    }
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocketImpl(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 20000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
    while (!await evaluate('document.readyState === "complete" && typeof window.addToCanvas === "function"')) await delay(25);
    return await task(send, evaluate);
  } finally {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(Error('CDP closed')); }
    socket?.close();
    if (child.exitCode === null) child.kill();
    await closed;
  }
}

const fixture = String.raw`(async () => {
  const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const wait = async (predicate, label) => { for (let n = 0; n < 200; n++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('wait: ' + label); };
  window.__appearance = { next, wait, failures: [] };
  const canvas = document.createElement('canvas'); canvas.width = 460; canvas.height = 320;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#252a32'; ctx.fillRect(0, 0, 460, 320);
  ctx.strokeStyle = '#a28e65'; ctx.lineWidth = 2; ctx.strokeRect(5, 5, 450, 310);
  ctx.fillStyle = '#e1c890'; ctx.font = 'bold 20px Microsoft YaHei'; ctx.fillText('传送使者', 28, 42);
  ctx.fillStyle = '#c6cbd1'; ctx.font = '14px Microsoft YaHei'; ctx.fillText('旅途漫长，选择你的下一站。', 28, 86);
  ctx.strokeStyle = '#47505c'; ctx.beginPath(); ctx.moveTo(28, 105); ctx.lineTo(432, 105); ctx.stroke();
  ['比奇城', '盟重土城', '苍月岛'].forEach((text, index) => {
    ctx.fillStyle = '#353d48'; ctx.fillRect(28, 128 + index * 49, 404, 34);
    ctx.fillStyle = '#e3ce97'; ctx.fillText(text, 42, 150 + index * 49);
  });
  const background = canvas.toDataURL();
  const palette = ['#758ba1', '#baa373', '#7d9c86', '#ad8385', '#918cae'];
  const files = Array.from({ length: 251 }, (_, index) => {
    const empty = [3, 4, 7].includes(index);
    canvas.width = 40; canvas.height = 40; ctx.clearRect(0, 0, 40, 40);
    ctx.fillStyle = palette[index % palette.length]; ctx.beginPath();
    ctx.moveTo(20, 3); ctx.lineTo(35, 20); ctx.lineTo(20, 37); ctx.lineTo(5, 20); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#eef2f5'; ctx.font = '12px Consolas'; ctx.textAlign = 'center'; ctx.fillText(String(index), 20, 24);
    return { name: String(index).padStart(6, '0'), pakName: '界面素材.pak', imageIdx: index, localIdx: index, willIdx: 7,
      width: index === 0 ? 460 : 40, height: index === 0 ? 320 : 40, url: empty ? '' : index === 0 ? background : canvas.toDataURL(), decodeStatus: empty ? 'empty' : 'decoded', isBlank: empty };
  });
  window.dispatchEvent(new MessageEvent('message', { data: { type: 'loadAssets', files, pakMode: true, pakList: [{ name: '界面素材.pak', willIdx: 7 }] } }));
  window.addToCanvas(0); await wait(() => document.querySelector('.element-item'), 'background installed');
  const code = document.getElementById('codeArea');
  if (getComputedStyle(code).display !== 'none') document.querySelector('[data-action="toggleCodeArea"]').click();
  await next();
  return true;
})()`;

const layoutChecks = String.raw`(async () => {
  const { next } = window.__appearance;
  const failures = [], check = (condition, message) => { if (!condition) failures.push(message); };
  const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  const visible = node => { const r = rect(node); return r.width > 0 && r.height > 0 && r.x >= -1 && r.right <= innerWidth + 1 && r.y >= -1 && r.bottom <= innerHeight + 1; };
  const toolbar = document.querySelector('.toolbar');
  const toolbarButtons = Array.from(document.querySelectorAll('.toolbar button,.toolbar select,.insert-toolbar button')).filter(node => getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0);
  for (const button of toolbarButtons) {
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' }); await next();
    check(visible(button), 'toolbar action inaccessible: ' + (button.dataset.action || button.id));
    const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    check(hit && (hit === button || button.contains(hit)), 'toolbar action obscured: ' + (button.dataset.action || button.id));
  }
  for (const node of document.querySelectorAll('.toolbar,.toolbar *,.insert-toolbar,.insert-toolbar *')) { if (node.scrollWidth > node.clientWidth) node.scrollLeft = 0; }
  const main = rect(document.querySelector('.main-container')), canvas = rect(document.getElementById('canvasContainer'));
  check(canvas.width >= Math.max(300, innerWidth * .34), 'canvas must retain useful width: ' + JSON.stringify(canvas));
  check(canvas.height >= innerHeight * .65, 'canvas must retain useful height: ' + JSON.stringify(canvas));
  check(main.bottom <= innerHeight + 1, 'main container extends below viewport');
  check(document.documentElement.scrollWidth <= innerWidth + 1, 'whole document horizontally overflows');
  const count = document.getElementById('fileCount');
  check(getComputedStyle(count).display === 'none' && rect(count).height === 0, 'asset count must not be displayed or reserve a row');
  check(!document.querySelector('#assetsList .asset-item button'), 'thumbnail cards must not show view buttons');
  for (const node of document.querySelectorAll('#assetsList [data-slot-status="empty"]')) {
    const placeholder = node.querySelector('.asset-placeholder');
    check(node.textContent === node.querySelector('.name').textContent && !node.querySelector('.asset-state'), 'empty slot shows only its original ID');
    check(placeholder && getComputedStyle(placeholder).backgroundColor === 'rgba(0, 0, 0, 0)' && rect(placeholder).height === 35, 'empty thumbnail is transparent and retains its height');
  }
  const brand = document.querySelector('img.brand-mark');
  check(brand && brand.complete && brand.naturalWidth > 0 && visible(brand), 'local Lao Lu brand icon must load and remain visible');
  const scrolling = {};
  for (const id of ['assetsList', 'propsContent']) {
    const node = document.getElementById(id), style = getComputedStyle(node), before = node.scrollTop;
    if (id === 'propsContent') for (let i = 0; i < 30; i++) document.querySelector('[data-action="addTextElement"]').click();
    await next(); node.scrollTop = node.scrollHeight; await next();
    scrolling[id] = { overflow: style.overflowY, height: node.clientHeight, content: node.scrollHeight, moved: node.scrollTop > 0 };
    check(['auto', 'scroll'].includes(style.overflowY), id + ' is not configured to scroll');
    check(node.scrollHeight > node.clientHeight && node.scrollTop > 0, id + ' cannot reach overflowing contents');
    check(visible(node), id + ' viewport must fit window'); node.scrollTop = before;
  }
  return { viewport: [innerWidth, innerHeight], toolbar: rect(toolbar), canvas, main, scrolling, failures };
})()`;

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-ui-appearance-'));
  const results = [];
  try {
    if (output) fs.mkdirSync(output, { recursive: true });
    let html = fs.readFileSync(path.join(runtime, 'media/editor.html'), 'utf8');
    const sourceSha256 = createHash('sha256').update(html).digest('hex');
    // Match the extension-root resource base used by the real Webview host.
    html = html.replace('<head>', '<head><base href="' + pathToFileURL(runtime + path.sep).href + '">');
    html = html.replace('<script>', '<script>window.__messages=[];window.acquireVsCodeApi=()=>({postMessage:m=>window.__messages.push(m),getState(){return{}},setState(){}});</script><script>');
    const source = path.join(temp, 'index.html'); fs.writeFileSync(source, html);
    await browserSession(source, path.join(temp, 'profile'), async (send, evaluate) => {
      const shot = async name => {
        if (!output) return;
        const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(result.data, 'base64'));
      };
      for (const [width, height] of [[1440, 960], [1100, 800], [900, 700]]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        const url = pathToFileURL(source).href + '?viewport=' + width + 'x' + height;
        await send('Page.navigate', { url });
        while (!await evaluate('location.href === ' + JSON.stringify(url) + ' && document.readyState === "complete" && typeof window.addToCanvas === "function"')) await delay(25);
        await evaluate(fixture);
        await shot(`editor-${width}x${height}`);
        const code = await evaluate(`(async () => {
          const panel = document.getElementById('codeArea'), button = document.getElementById('toggleCodeBtn');
          button.click(); await window.__appearance.next();
          const r = panel.getBoundingClientRect(), visible = getComputedStyle(panel).display !== 'none';
          const result = { visible, x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
          return result;
        })()`);
        if (width === 1440 || width === 900) await shot(`editor-code-${width}x${height}`);
        await evaluate(`document.getElementById('toggleCodeBtn').click()`);
        const result = await evaluate(layoutChecks); result.modals = [];
        result.code = code;
        if (!code.visible || code.x < -1 || code.y < -1 || code.right > width + 1 || code.bottom > height + 1) result.failures.push('code panel must open inside viewport');
        // A real CDP keyboard event activates :focus-visible, unlike a synthetic DOM KeyboardEvent.
        await evaluate('document.activeElement?.blur(); document.body.focus()');
        await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        result.focus = await evaluate(`(() => { const node = document.activeElement, s = getComputedStyle(node); return { tag: node.tagName, id: node.id, keyboard: node.matches(':focus-visible'), outlineStyle: s.outlineStyle, outlineWidth: s.outlineWidth, shadow: s.boxShadow }; })()`);
        if (!result.focus.keyboard || !(parseFloat(result.focus.outlineWidth) >= 1 && result.focus.outlineStyle !== 'none' || result.focus.shadow !== 'none')) result.failures.push('keyboard focus-visible has no clear outline/shadow');
        const entries = [
          ['imageSelectorModal', 'showImageSelector'], ['buttonSelectorModal', 'showButtonSelector'],
          ['effectSelectorModal', 'showEffectSelector'], ['closeBtnDialog', 'selectCloseBtnFiles'],
          ['equipFrameDialog', 'selectEquipFrameFiles'], ['progressBarDialog', 'selectProgressBarFiles']
        ];
        for (const [id, action] of entries) {
          const modal = await evaluate(`(async () => {
            const { next, wait } = window.__appearance;
            document.querySelector('[data-action="${action}"]').click(); await next();
            const modal = document.getElementById('${id}'); if (!modal) throw Error('missing ${id}');
            const grid = modal.querySelector('.dialog-asset-item')?.parentElement;
            if (!grid) throw Error('missing asset grid ${id}');
            const shell = modal.firstElementChild, r = shell.getBoundingClientRect(), failures = [];
            if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) failures.push('dialog shell exceeds viewport');
            if (grid.querySelectorAll('.dialog-asset-item').length !== 100) failures.push('first page is not 100 items');
            if (grid.clientHeight < 100) failures.push('asset grid has insufficient visible height');
            const disabled = Array.from(modal.querySelectorAll('button:disabled')), disabledStyles = disabled.map(node => {
              const s = getComputedStyle(node); return { opacity: s.opacity, cursor: s.cursor, color: s.color, background: s.backgroundColor };
            });
            if (!disabledStyles.length) failures.push('first page must expose disabled previous-page control');
            const enabledPagination = modal.querySelector('.archive-selector-next,#progressBarPageNext');
            const enabledStyle = getComputedStyle(enabledPagination);
            for (const s of disabledStyles) if (!(Number(s.opacity) < .8 || s.cursor === 'not-allowed' || s.color !== enabledStyle.color && s.background !== enabledStyle.backgroundColor)) failures.push('disabled button is visually indistinguishable from enabled pagination');
            for (const control of modal.querySelectorAll('button,input,select')) {
              if (control.disabled || grid.contains(control) || control.getBoundingClientRect().width === 0) continue;
              control.scrollIntoView({ block: 'nearest', inline: 'nearest' }); await next();
              const box = control.getBoundingClientRect();
              if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) failures.push('dialog control cannot be reached: ' + (control.id || control.textContent));
              const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              if (!hit || hit !== control && !control.contains(hit)) failures.push('dialog control obscured: ' + (control.id || control.textContent));
            }
            const query = modal.querySelector('.archive-selector-query,#progressBarSlotSearch');
            query.value = '199'; query.dispatchEvent(new Event('input', { bubbles: true }));
            await wait(() => grid.querySelector('.archive-id-target')?.title.endsWith(' #199'), 'ID 199 highlight'); await next();
            const items = Array.from(grid.querySelectorAll('.dialog-asset-item')), target = grid.querySelector('.archive-id-target');
            if (items.length !== 100 || !items.some(node => node.title.endsWith(' #100'))) failures.push('ID location must retain neighbors');
            const t = target.getBoundingClientRect(), g = grid.getBoundingClientRect();
            if (t.top >= g.bottom || t.bottom <= g.top) failures.push('located target is outside scroll viewport');
            return { id: '${id}', rect: { x: r.x, y: r.y, width: r.width, height: r.height }, grid: { height: grid.clientHeight, items: items.length }, disabledStyles, failures };
          })()`);
          result.modals.push(modal);
          if (width === 1440 || width === 900) await shot(`${id}-${width}x${height}`);
          await evaluate(`document.getElementById('${id}').querySelector('button').click()`);
        }
        results.push(result);
      }
    });
    if (output) fs.writeFileSync(path.join(output, 'layout-results.json'), JSON.stringify({ baseline, runtime, sourceSha256, results }, null, 2));
    const failures = results.flatMap(result => [
      ...result.failures.map(message => result.viewport.join('x') + ': ' + message),
      ...result.modals.flatMap(modal => modal.failures.map(message => result.viewport.join('x') + '/' + modal.id + ': ' + message))
    ]);
    console.log(JSON.stringify({ baseline, screenshots: output || null, failures, results }, null, 2));
    if (!baseline) assert.equal(failures.length, 0, failures.join('\n'));
    console.log('ui-appearance-browser: ' + (baseline ? 'BASELINE RECORDED' : 'PASS') + ' real Chromium layout at 1440x960/1100x800/900x700, accessible actions, canvas space, scrolling, six asset selectors, 100-item/ID navigation, keyboard focus and disabled affordance; synthetic assets');
  } finally { removeTemporaryDirectory(temp); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
