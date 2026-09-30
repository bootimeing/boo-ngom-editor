const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-verify-browser-'));
try {
  const browsers = [...new Set([process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ].filter(file => file && fs.existsSync(file)).map(file => path.resolve(file)))];
  assert.ok(browsers.length, 'a real Chromium browser is required');
  let html = fs.readFileSync(path.join(__dirname, '../media/patch-manager.html'), 'utf8');
  html = html.replace('<script>', `<script>
    window.sent = []; window.acquireVsCodeApi = () => ({ getState: () => ({}), setState() {}, postMessage: m => window.sent.push(m) });
    </script><script>`);
  html = html.replace('</body>', `<script>
  try {
    document.body.style.width = '260px';
    const entry = { path: 'D:/fixture.pak', name: 'A very long archive filename.pak', status: 'cached', canVerify: true, message: '索引完成', progress: 100 };
    const send = (busy = false) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', entries: [entry], busy } }));
    const button = action => document.querySelector('[data-action="' + action + '"]');
    const require = (yes, msg) => { if (!yes) throw Error(msg); };
    send(); document.querySelector('.pak-row').click();
    button('verifyPak').click();
    require(sent.at(-1).type === 'verifyPak' && sent.at(-1).path === entry.path, 'verify IPC');
    entry.verification = 'running'; entry.message = '验证 10/100'; send(true);
    require(!button('cancelVerification').disabled && button('reloadPak').disabled, 'cancel remains operable');
    button('cancelVerification').click(); require(sent.at(-1).type === 'cancelVerification', 'cancel IPC');
    entry.verification = 'cancelled'; entry.hasVerificationDetails = true; send();
    require(button('verifyPak').textContent === '继续验证', 'resume label');
    for (const node of document.querySelectorAll('.row-actions button')) {
      const r = node.getBoundingClientRect(); require(r.left >= 0 && r.right <= 261 && r.width > 0, 'narrow sidebar buttons overflow');
    }
    button('verificationDetails').click(); require(sent.at(-1).type === 'verificationDetails', 'details IPC');
    entry.name = '<img src=x onerror="window.pwned=true">'; entry.message = '<script>alert(1)<\\/script>'; send();
    require(!document.querySelector('.pak-row img') && !window.pwned, 'escape untrusted file names');
    document.body.dataset.testStatus = 'pass';
  } catch(error) { document.body.dataset.testStatus = 'fail'; document.body.dataset.testError = error.message; }
  </script></body>`);
  const file = path.join(root, 'harness.html'); fs.writeFileSync(file, html);
  let result, selected;
  const diagnostics = [];
  for (const browser of browsers) {
    const attempt = spawnSync(browser, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
      '--allow-file-access-from-files', '--window-size=500,800', '--virtual-time-budget=3000', '--dump-dom',
      `--user-data-dir=${path.join(root, 'profile-' + diagnostics.length)}`, pathToFileURL(file).href],
    { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    // Only retry a missing browser response. A real DOM with failed product assertions
    // is authoritative and must NOT be retried until another browser happens to pass.
    if (!attempt.error && attempt.status === 0 && /<body\b/i.test(attempt.stdout || '')) {
      result = attempt; selected = browser; break;
    }
    diagnostics.push(`${browser}: status=${attempt.status}, error=${attempt.error?.message || '<none>'}, `
      + `body=${/<body\b/i.test(attempt.stdout || '')}, stderr=${attempt.stderr || '<empty>'}`);
  }
  assert.ok(result, 'No installed Chromium returned DOM:\n' + diagnostics.join('\n'));
  for (const diagnostic of diagnostics) console.warn('patch-verification-browser: ' + diagnostic);
  assert.match(result.stdout, /<body[^>]*data-test-status="pass"/, result.stdout.match(/<body[^>]*>/)?.[0]);
  console.log(`patch-verification-browser.test.js: PASS (real Chromium DOM, verify/cancel/resume/details IPC, 260px sidebar, escaping; browser=${selected})`);
} finally {
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(root).startsWith('boo-verify-browser-'));
  removeTemporaryDirectory(root);
}
