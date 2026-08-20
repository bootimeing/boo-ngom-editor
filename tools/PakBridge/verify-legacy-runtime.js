const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');

const projectRoot = process.env.BOO_EXTENSION_ROOT
  ? path.resolve(process.env.BOO_EXTENSION_ROOT)
  : path.resolve(__dirname, '..', '..');
const binDir = process.env.BOO_PAK_BRIDGE_BIN
  ? path.resolve(process.env.BOO_PAK_BRIDGE_BIN)
  : path.join(__dirname, 'bin');
const bridgePath = path.join(binDir, 'boo-pak-bridge.exe');
const pakPath = process.env.BOO_LEGACY_PAK
  ? path.resolve(process.env.BOO_LEGACY_PAK)
  : '';
const password = process.env.BOO_LEGACY_PAK_PASSWORD || 'gameofmir';
const host = '127.0.0.1';
const port = 18765;
const pakSha256 = '4b9209525355702ead983c8d309e3140a2bc2c09eaa5581ec1af6149f318c22a';
const rgbaSha256 = '8bbc6814fc56f77b8b0775c7ac3351579920c75e67b40d57a2bb7437731b5cbe';

function request(method, route, body = Buffer.alloc(0), headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: host,
      port,
      path: route,
      method,
      timeout: 15000,
      headers: { 'Content-Length': body.length, ...headers },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = text ? JSON.parse(text) : {}; } catch { json = { text }; }
        resolve({ status: response.statusCode, headers: response.headers, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end(body);
  });
}

async function waitForHealth(child, output) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`bridge exited with ${child.exitCode}: ${output.join('')}`);
    }
    try {
      const health = await request('GET', '/api/health');
      if (health.status === 200 && health.json.ok === true) return health;
    } catch {
      // The service may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`bridge startup timed out: ${output.join('')}`);
}

async function main() {
  assert.ok(pakPath, 'BOO_LEGACY_PAK must point to the verified legacy GAMEOFMIR sample');
  assert.ok(fs.existsSync(pakPath), `legacy test PAK is missing: ${pakPath}`);
  const data = fs.readFileSync(pakPath);
  assert.strictEqual(crypto.createHash('sha256').update(data).digest('hex'), pakSha256);

  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'Path';
  const env = { ...process.env };
  env[pathKey] = [binDir, path.join(binDir, 'lib'), env[pathKey]].filter(Boolean).join(path.delimiter);
  const child = spawn(bridgePath, ['serve', '--host', host, '--port', String(port)], {
    cwd: binDir,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));

  try {
    const health = await waitForHealth(child, output);
    assert.match(String(health.headers.server), /^PakOfflineEngine\/2\.3 /);
    assert.deepStrictEqual(health.json.formats, ['GEEPAK2', 'GEEPAK3', 'GAMEOFMIR', 'GAMEOFMIR2']);

    const profileResponse = await request('POST', '/api/gom-profile', data, {
      'Content-Type': 'application/octet-stream',
      'X-GM-Password-B64': Buffer.from(password, 'utf8').toString('base64'),
    });
    assert.strictEqual(profileResponse.status, 200, JSON.stringify(profileResponse.json));
    const profile = profileResponse.json.profile;
    assert.strictEqual(profile.family, 'GM GAMEOFMIR');
    assert.strictEqual(profile.slotCount, 1376);
    assert.strictEqual(profile.blocks.length, 368);

    const parser = require(path.join(projectRoot, 'media', 'geepak3_exact.js'));
    const corpus = crypto.createHash('sha256');
    let rawBytes = 0;
    for (const block of profile.blocks) {
      const raw = parser.readPayload(data, block, payload => zlib.inflateSync(payload));
      const rgba = parser.toRgba(raw, block);
      rawBytes += raw.length;
      corpus.update(rgba);
    }
    assert.strictEqual(rawBytes, 12601984);
    assert.strictEqual(corpus.digest('hex'), rgbaSha256);

    const wrongPassword = await request('POST', '/api/gom-profile', data, {
      'Content-Type': 'application/octet-stream',
      'X-GM-Password-B64': Buffer.from('wrong-password', 'utf8').toString('base64'),
    });
    assert.strictEqual(wrongPassword.status, 400);
    assert.ok(wrongPassword.json.error);

    console.log('Legacy GAMEOFMIR frozen runtime verification passed.');
    console.log(`family=${profile.family} slots=${profile.slotCount} blocks=${profile.blocks.length}`);
    console.log(`raw_bytes=${rawBytes} all_rgba_sha256=${rgbaSha256} matched=100%`);
  } finally {
    try { await request('POST', '/api/shutdown'); } catch { /* process cleanup below */ }
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null) child.kill();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
