const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = process.env.BOO_EXTENSION_ROOT
  ? path.resolve(process.env.BOO_EXTENSION_ROOT)
  : path.resolve(__dirname, '..', '..');
const binDir = process.env.BOO_PAK_BRIDGE_BIN
  ? path.resolve(process.env.BOO_PAK_BRIDGE_BIN)
  : path.join(__dirname, 'bin');
const bridgePath = path.join(binDir, 'boo-pak-bridge.exe');
const pakPath = process.env.BOO_GEE2_PAK
  ? path.resolve(process.env.BOO_GEE2_PAK)
  : '';
const password = process.env.BOO_GEE2_PAK_PASSWORD;
const host = '127.0.0.1';
const port = Number(process.env.BOO_GEE2_TEST_PORT || 18766);
const pakSha256 = '97f4cf98f129a88a1ee44aa29822e53c41f493da6f1296722ab75c7ed919565a';

function request(method, route) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: host, port, path: route, method, timeout: 2000 }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = text ? JSON.parse(text) : {}; } catch { json = { text }; }
        resolve({ status: response.statusCode, headers: response.headers, json });
      });
    });
    request.on('timeout', () => request.destroy(new Error('request timed out')));
    request.on('error', reject);
    request.end();
  });
}

async function waitForHealth(child, output) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`bridge exited with ${child.exitCode}: ${output.join('')}`);
    try {
      const health = await request('GET', '/api/health');
      if (health.status === 200 && health.json.ok === true) return health;
    } catch {
      // The frozen Python runtime may still be loading.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`bridge startup timed out: ${output.join('')}`);
}

function pngSize(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

async function main() {
  assert.ok(pakPath, 'BOO_GEE2_PAK must point to the verified GEEPAK2 sample');
  assert.ok(password, 'BOO_GEE2_PAK_PASSWORD must be set for the real GEEPAK2 runtime test');
  assert.ok(fs.existsSync(bridgePath), `PAK runtime is missing: ${bridgePath}`);
  assert.ok(fs.existsSync(pakPath), `GEEPAK2 test archive is missing: ${pakPath}`);
  const archive = fs.readFileSync(pakPath);
  assert.equal(crypto.createHash('sha256').update(archive).digest('hex'), pakSha256);

  try {
    const active = await request('GET', '/api/health');
    if (active.status === 200) throw new Error(`port ${port} is already occupied by a PAK bridge`);
  } catch (error) {
    if (String(error.message || error).includes('already occupied')) throw error;
  }

  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'Path';
  const env = { ...process.env };
  env[pathKey] = [binDir, path.join(binDir, 'lib'), env[pathKey]].filter(Boolean).join(path.delimiter);
  process.env.BOO_PAK_BRIDGE_PORT = String(port);
  const child = spawn(bridgePath, ['serve', '--host', host, '--port', String(port)], {
    cwd: binDir,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));
  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-geepak2-index-'));

  try {
    const health = await waitForHealth(child, output);
    assert.match(String(health.headers.server), /^PakOfflineEngine\/2\.3 /);
    assert.deepEqual(health.json.formats, ['GEEPAK2', 'GEEPAK3', 'GAMEOFMIR', 'GAMEOFMIR2']);

    const { openArchiveIndexed, readArchiveImagePng } = require(path.join(projectRoot, 'out', 'utils', 'archive-index.js'));
    let bridgeRequests = 0;
    const opened = await openArchiveIndexed({
      extensionPath: projectRoot,
      indexRoot,
      pakPath,
      password,
      willIdx: 0,
      ensureBridge: async () => { bridgeRequests++; },
    });
    assert.equal(opened.format, 'GEE');
    assert.equal(opened.storageMode, 'direct');
    assert.equal(opened.slotCount, 2300);
    assert.equal(opened.assets.filter(asset => asset.isBlank).length, 749);
    assert.equal(bridgeRequests, 1);

    const firstPng = await readArchiveImagePng({
      extensionPath: projectRoot,
      indexRoot,
      archiveId: opened.archiveId,
      imageIndex: 0,
    });
    assert.deepEqual(pngSize(firstPng), [200, 252]);
    const blankIndex = opened.assets.findIndex(asset => asset.isBlank);
    assert.ok(blankIndex >= 0);
    const blankPng = await readArchiveImagePng({
      extensionPath: projectRoot,
      indexRoot,
      archiveId: opened.archiveId,
      imageIndex: blankIndex,
    });
    assert.deepEqual(pngSize(blankPng), [1, 1]);

    const cached = await openArchiveIndexed({
      extensionPath: projectRoot,
      indexRoot,
      pakPath,
      password,
      willIdx: 0,
      ensureBridge: async () => { bridgeRequests++; },
    });
    assert.equal(cached.fromCache, true);
    assert.equal(bridgeRequests, 1, 'a valid direct index must reopen without invoking the bridge');

    await assert.rejects(
      openArchiveIndexed({
        extensionPath: projectRoot,
        indexRoot,
        pakPath,
        password: 'definitely-wrong',
        willIdx: 0,
        ensureBridge: async () => {},
      }),
      /password is incorrect|密码错误/i
    );

    console.log('GEEPAK2 frozen runtime verification passed.');
    console.log(`slots=${opened.slotCount} blocks=1551 blank=749 first=200x252 direct_cache=PASS`);
  } finally {
    try { await request('POST', '/api/shutdown'); } catch { /* process cleanup below */ }
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null) child.kill();
    const resolvedRoot = path.resolve(indexRoot);
    if (resolvedRoot.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolvedRoot, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
