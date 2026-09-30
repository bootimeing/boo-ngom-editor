// Real-time CDP test harness: virtual-time dump-dom does not reliably schedule requestAnimationFrame.
const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const WebSocketImpl = globalThis.WebSocket || require('undici').WebSocket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runChromiumDom(browser, htmlPath, profilePath) {
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
    '--remote-debugging-port=0', '--allow-file-access-from-files', '--window-size=1200,850',
    '--user-data-dir=' + profilePath, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.resume();
  let startupError, socket, seq = 0;
  child.once('error', error => { startupError = error; });
  const closed = new Promise(resolve => child.once('close', resolve));
  const pending = new Map();
  try {
    const portFile = path.join(profilePath, 'DevToolsActivePort');
    const deadline = Date.now() + 20000;
    let port;
    while (!port) {
      if (startupError) throw startupError;
      if (child.exitCode !== null || Date.now() > deadline) throw Error('Chromium startup failed');
      try {
        const candidate = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
        if (/^[1-9]\d*$/.test(candidate) && Number(candidate) <= 65535) port = candidate;
      } catch (error) {
        if (!['ENOENT', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      }
      if (port) break;
      await delay(50);
    }
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocketImpl(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result);
    });
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, 20000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      const result = await send('Runtime.evaluate', { expression: 'document.body && document.body.dataset.testStatus ? document.body.outerHTML : null', returnByValue: true });
      if (result.result.value) return result.result.value;
      await delay(25);
    }
    throw Error('DOM test did not complete');
  } finally {
    pending.forEach(item => { clearTimeout(item.timer); item.reject(Error('CDP closed')); });
    socket?.close();
    if (child.exitCode === null) child.kill();
    await closed;
  }
}
module.exports = { runChromiumDom };
