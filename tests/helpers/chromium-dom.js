// Real-time CDP test harness: virtual-time dump-dom does not reliably schedule requestAnimationFrame.
const fs = require('node:fs'), path = require('node:path');
const { spawn } = require('node:child_process');
const net = require('node:net');
const { pathToFileURL } = require('node:url');
const WebSocketImpl = globalThis.WebSocket || require('undici').WebSocket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function connectCdp(url) {
  const socket = new WebSocketImpl(url), pending = new Map();
  let sequence = 0;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CDP connection timeout')), 5000);
    const finish = callback => value => { clearTimeout(timer); callback(value); };
    socket.addEventListener('open', finish(resolve), { once: true });
    socket.addEventListener('error', finish(() => reject(Error('CDP connection failed'))), { once: true });
    socket.addEventListener('close', finish(() => reject(Error('CDP connection closed before opening'))), { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data), item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result);
  });
  const rejectPending = () => {
    pending.forEach(item => { clearTimeout(item.timer); item.reject(Error('CDP closed')); });
    pending.clear();
  };
  socket.addEventListener('close', rejectPending);
  return {
    ready,
    send: (method, params = {}, timeout = 20000) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout ' + method)); }, timeout);
      pending.set(id, { resolve, reject, timer });
      try { socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
    }),
    dispose() { rejectPending(); socket.close(); },
  };
}

function endpointClosed(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port: Number(port) });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(false));
    socket.once('error', error => finish(error.code === 'ECONNREFUSED'));
    socket.setTimeout(500, () => finish(false));
  });
}

async function waitUntil(predicate, milliseconds) {
  const deadline = Date.now() + milliseconds;
  do {
    if (await predicate()) return true;
    await delay(25);
  } while (Date.now() < deadline);
  return false;
}

async function runChromiumDom(browser, htmlPath, profilePath) {
  // A stale DevToolsActivePort can silently connect a Chrome attempt to an old
  // Edge process. Never launch into, clean, or close a pre-existing profile.
  profilePath = path.resolve(profilePath);
  if (fs.existsSync(profilePath) && fs.readdirSync(profilePath).length) {
    throw Error('Chromium test profile must be empty: ' + profilePath);
  }
  fs.mkdirSync(profilePath, { recursive: true });
  const isEdge = /^msedge(?:\.exe)?$/i.test(path.basename(browser));
  const isChrome = /^(?:chrome|chromium)(?:\.exe)?$/i.test(path.basename(browser));
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
    '--remote-debugging-port=0', '--allow-file-access-from-files', '--window-size=1200,850',
    // Without this flag Edge's compatibility launcher can exit while the real
    // browser remains alive outside the spawned handle's lifetime.
    ...(isEdge ? ['--edge-skip-compat-layer-relaunch'] : []),
    '--user-data-dir=' + profilePath, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.resume();
  let startupError, browserCdp, pageCdp, port, childClosed = false, primaryError, dom;
  child.once('error', error => { startupError = error; });
  child.once('close', () => { childClosed = true; });
  try {
    const portFile = path.join(profilePath, 'DevToolsActivePort');
    const deadline = Date.now() + 20000;
    let browserPath;
    while (!port) {
      if (startupError) throw startupError;
      if (child.exitCode !== null || Date.now() > deadline) throw Error('Chromium startup failed');
      try {
        const [candidate, target] = fs.readFileSync(portFile, 'utf8').split(/\r?\n/);
        if (/^[1-9]\d*$/.test(candidate) && Number(candidate) <= 65535
          && /^\/devtools\/browser\/[\w-]+$/.test(target)) { port = candidate; browserPath = target; }
      } catch (error) {
        if (!['ENOENT', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      }
      if (port) break;
      await delay(50);
    }
    const endpoint = 'http://127.0.0.1:' + port;
    const version = await (await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(5000) })).json();
    const browserUrl = 'ws://127.0.0.1:' + port + browserPath;
    if (version.webSocketDebuggerUrl !== browserUrl) throw Error('Chromium browser endpoint does not match its new profile');
    browserCdp = connectCdp(browserUrl);
    await browserCdp.ready;
    if ((isEdge && !/^Edg\//.test(version.Browser))
      || (isChrome && !/^(?:HeadlessChrome|Chrome|Chromium)\//.test(version.Browser))) {
      throw Error('Chromium browser identity mismatch: ' + version.Browser + ' for ' + browser);
    }
    const pages = await (await fetch(endpoint + '/json/list', { signal: AbortSignal.timeout(5000) })).json();
    const page = pages.find(candidate => candidate.type === 'page');
    if (!page?.webSocketDebuggerUrl?.startsWith('ws://127.0.0.1:' + port + '/devtools/page/')) throw Error('Chromium page endpoint mismatch');
    pageCdp = connectCdp(page.webSocketDebuggerUrl);
    await pageCdp.ready;
    await pageCdp.send('Page.navigate', { url: pathToFileURL(htmlPath).href });
    const end = Date.now() + 25000;
    while (Date.now() < end) {
      const result = await pageCdp.send('Runtime.evaluate', { expression: 'document.body && document.body.dataset.testStatus ? document.body.outerHTML : null', returnByValue: true });
      if (result.result.value) { dom = result.result.value; break; }
      await delay(25);
    }
    if (!dom) throw Error('DOM test did not complete');
  } catch (error) {
    primaryError = error;
  } finally {
    let closeError;
    try {
      if (browserCdp) {
        // Browser.close targets the actual browser, not only a Windows launch
        // wrapper. A disconnect is acceptable only if its endpoint really exits.
        try { await browserCdp.send('Browser.close', {}, 5000); }
        catch (error) { closeError = error; }
      }
      let endpointExited = !port || await waitUntil(() => endpointClosed(port), 5000);
      let processExited = await waitUntil(() => childClosed, 5000);
      if ((!endpointExited || !processExited) && child.exitCode === null && !startupError) {
        // Only the process handle spawned for this verified fresh profile is
        // eligible for fallback. Never enumerate/kill a user's browser processes.
        child.kill();
        processExited = await waitUntil(() => childClosed, 5000);
        endpointExited = !port || await waitUntil(() => endpointClosed(port), 5000);
      }
      if (!endpointExited || !processExited) throw Error('Chromium cleanup did not complete' + (closeError ? ': ' + closeError.message : ''));
    } catch (cleanupError) {
      if (primaryError) throw new AggregateError([primaryError, cleanupError], 'Chromium scenario and cleanup failed');
      throw cleanupError;
    } finally {
      pageCdp?.dispose();
      browserCdp?.dispose();
    }
  }
  if (primaryError) throw primaryError;
  return dom;
}
module.exports = { runChromiumDom };
