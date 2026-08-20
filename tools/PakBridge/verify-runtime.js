const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const binDir = path.join(__dirname, 'bin');
const requiredFiles = [
  'boo-pak-bridge.exe',
  'python312.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  path.join('lib', '_ssl.pyd'),
  path.join('lib', 'libcrypto-3-x64.dll'),
  path.join('lib', 'libssl-3-x64.dll'),
  path.join('lib', 'unicorn', 'lib', 'unicorn.dll'),
];

for (const relativePath of requiredFiles) {
  const fullPath = path.join(binDir, relativePath);
  assert.ok(fs.existsSync(fullPath), `PAK runtime file is missing: ${relativePath}`);
  assert.ok(fs.statSync(fullPath).size > 0, `PAK runtime file is empty: ${relativePath}`);
}

for (const relativePath of ['boo-pak-bridge.exe', 'python312.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']) {
  const buffer = fs.readFileSync(path.join(binDir, relativePath));
  const peOffset = buffer.readUInt32LE(0x3c);
  assert.strictEqual(buffer.toString('ascii', peOffset, peOffset + 4), 'PE\0\0', `${relativePath} is not a PE file`);
  assert.strictEqual(buffer.readUInt16LE(peOffset + 4), 0x8664, `${relativePath} is not an x64 binary`);
}

const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'Path';
const env = { ...process.env };
env[pathKey] = [binDir, path.join(binDir, 'lib'), env[pathKey]].filter(Boolean).join(path.delimiter);
const result = spawnSync(path.join(binDir, 'boo-pak-bridge.exe'), ['--help'], {
  cwd: binDir,
  env,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 15000,
});

assert.ifError(result.error);
assert.strictEqual(result.status, 0, `PAK runtime loader failed (${result.status}): ${result.stderr || result.stdout}`);
assert.match(result.stdout, /\{profile,serve\}/, 'PAK runtime help output is incomplete');

function request(method, route, port) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: route,
      method,
      timeout: 3000,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ status: response.statusCode, headers: response.headers, json: JSON.parse(body) });
        } catch {
          reject(new Error(`PAK runtime returned invalid JSON: ${body}`));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('request timed out')));
    request.on('error', reject);
    request.end();
  });
}

async function verifyHealth() {
  const port = 18764;
  const child = spawn(path.join(binDir, 'boo-pak-bridge.exe'), [
    'serve', '--host', '127.0.0.1', '--port', String(port),
  ], {
    cwd: binDir,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', chunk => output.push(chunk.toString()));
  child.stderr.on('data', chunk => output.push(chunk.toString()));
  try {
    const deadline = Date.now() + 15000;
    let health;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`PAK runtime exited early: ${output.join('')}`);
      try {
        health = await request('GET', '/api/health', port);
        if (health.status === 200 && health.json.ok === true) break;
      } catch {
        // The frozen runtime may still be loading.
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(health, `PAK runtime health check timed out: ${output.join('')}`);
    assert.match(String(health.headers.server), /^PakOfflineEngine\/2\.3 /);
    assert.deepStrictEqual(
      health.json.formats,
      ['GEEPAK2', 'GEEPAK3', 'GAMEOFMIR', 'GAMEOFMIR2']
    );
  } finally {
    try { await request('POST', '/api/shutdown', port); } catch { /* process cleanup below */ }
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode === null) child.kill();
  }
}

verifyHealth()
  .then(() => console.log('PAK runtime verification passed.'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
