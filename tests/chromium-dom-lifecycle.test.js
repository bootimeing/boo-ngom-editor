const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { runChromiumDom } = require('./helpers/chromium-dom');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

function browsers() {
  const candidates = [process.env.BOO_BROWSER_EXECUTABLE,
    path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Edge/Application/msedge.exe')];
  return [...new Set(candidates.filter(candidate => candidate && fs.existsSync(candidate)).map(candidate => path.resolve(candidate)))];
}

function endpointIsClosed(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(false));
    socket.once('error', error => finish(error.code === 'ECONNREFUSED'));
    socket.setTimeout(1000, () => finish(false));
  });
}

function ownProfileProcesses(profile) {
  if (process.platform !== 'win32') return [];
  const command = "$target = [regex]::Escape($env:BOO_CHROMIUM_TEST_PROFILE); @(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Where-Object { $_.CommandLine -match ($target + '(\"|\\s|$)') } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, BOO_CHROMIUM_TEST_PROFILE: profile },
  });
  assert.equal(result.status, 0, result.stderr || 'cannot inspect test-owned browser processes');
  const value = result.stdout.trim() ? JSON.parse(result.stdout) : [];
  return Array.isArray(value) ? value : [value];
}

async function verifyStopped(profile) {
  const port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]);
  assert.ok(await endpointIsClosed(port), 'CDP endpoint survives runChromiumDom');
  assert.deepEqual(ownProfileProcesses(profile), [], 'test-owned browser process survives runChromiumDom');
  removeTemporaryDirectory(profile);
  assert.equal(fs.existsSync(profile), false, 'owned profile remains after cleanup');
}

async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-chromium-lifecycle-'));
  let primaryError;
  try {
    const html = path.join(temporary, 'fixture.html');
    fs.writeFileSync(html, '<!doctype html><body><script>document.body.dataset.browserAgent=navigator.userAgent;document.body.dataset.testStatus="PASS";</script></body>');

    // This must fail before spawn or CDP contact, even if the port points to a
    // real user's browser. The old content and port are deliberately untouched.
    const stale = fs.mkdtempSync(path.join(temporary, 'stale-profile-'));
    const sentinel = path.join(stale, 'sentinel.txt'), portFile = path.join(stale, 'DevToolsActivePort');
    fs.writeFileSync(sentinel, 'do not overwrite or remove');
    fs.writeFileSync(portFile, '1\n/devtools/browser/stale\n');
    const snapshot = [fs.readFileSync(sentinel), fs.readFileSync(portFile)];
    await assert.rejects(runChromiumDom('nonexistent-browser-for-negative-control', html, stale), /profile must be empty/);
    assert.deepEqual([fs.readFileSync(sentinel), fs.readFileSync(portFile)], snapshot);
    console.log('chromium-dom-lifecycle.test.js: existing profile rejection PASS (content unchanged, no browser spawned)');

    const missingProfile = fs.mkdtempSync(path.join(temporary, 'missing-executable-profile-'));
    await assert.rejects(runChromiumDom(path.join(temporary, 'does-not-exist-browser.exe'), html, missingProfile), error => error.code === 'ENOENT');
    assert.deepEqual(fs.readdirSync(missingProfile), []);
    assert.deepEqual(ownProfileProcesses(missingProfile), []);
    removeTemporaryDirectory(missingProfile);
    console.log('chromium-dom-lifecycle.test.js: missing executable PASS (ENOENT preserved, no profile process remains)');

    const available = browsers();
    assert.ok(available.length, 'chromium-dom-lifecycle.test.js requires installed Chrome or Edge');
    const chrome = available.find(browser => /^chrome(?:\.exe)?$/i.test(path.basename(browser)));
    const edge = available.find(browser => /^msedge(?:\.exe)?$/i.test(path.basename(browser)));
    const selected = [...(chrome ? [chrome, chrome] : []), ...(edge ? [edge] : [])];
    if (!selected.length) selected.push(available[0], available[0]);
    for (const [index, browser] of selected.entries()) {
      const profile = fs.mkdtempSync(path.join(temporary, 'owned-profile-'));
      const dom = await runChromiumDom(browser, html, profile);
      assert.match(dom, /data-test-status="PASS"/);
      const isEdge = /^msedge(?:\.exe)?$/i.test(path.basename(browser));
      if (isEdge) assert.match(dom, /data-browser-agent="[^"]*Edg\//);
      else if (chrome && browser === chrome) assert.doesNotMatch(dom, /data-browser-agent="[^"]*Edg\//);
      await verifyStopped(profile);
      console.log(`chromium-dom-lifecycle.test.js: round ${index + 1} ${isEdge ? 'Edge' : 'Chrome'} PASS (identity verified, endpoint closed, own processes exited, profile removed)`);
    }
    for (const status of ['FAIL', 'ERROR']) {
      const failedHtml = path.join(temporary, status.toLowerCase() + '.html');
      fs.writeFileSync(failedHtml, `<!doctype html><body data-test-status="${status}" data-test-error="deliberate lifecycle negative control"></body>`);
      const profile = fs.mkdtempSync(path.join(temporary, 'failed-dom-profile-'));
      const dom = await runChromiumDom(selected[0], failedHtml, profile);
      assert.match(dom, new RegExp('data-test-status="' + status + '"'));
      assert.match(dom, /deliberate lifecycle negative control/);
      await verifyStopped(profile);
      console.log(`chromium-dom-lifecycle.test.js: DOM ${status} PASS (original failure returned unchanged, browser/profile cleaned)`);
    }
    // Explicit diagnostic mode covers the full production timeout without
    // adding a mandatory 25-second delay to every release regression run.
    if (process.env.BOO_CHROMIUM_LIFECYCLE_TIMEOUT === '1') {
      const unfinishedHtml = path.join(temporary, 'unfinished.html');
      fs.writeFileSync(unfinishedHtml, '<!doctype html><body>never signals completion</body>');
      const profile = fs.mkdtempSync(path.join(temporary, 'unfinished-profile-'));
      await assert.rejects(runChromiumDom(selected[0], unfinishedHtml, profile), /DOM test did not complete/);
      await verifyStopped(profile);
      console.log('chromium-dom-lifecycle.test.js: DOM timeout PASS (original timeout preserved, browser/profile cleaned)');
    }
    console.log('chromium-dom-lifecycle.test.js: PASS (real Chromium lifecycle; not VS Code/game-client acceptance)');
  } catch (error) {
    primaryError = error;
  } finally {
    try { removeTemporaryDirectory(temporary); }
    catch (cleanupError) {
      if (primaryError) throw new AggregateError([primaryError, cleanupError], 'Chromium lifecycle test and temporary cleanup failed');
      throw cleanupError;
    }
  }
  if (primaryError) throw primaryError;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
