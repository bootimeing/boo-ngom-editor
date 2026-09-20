// Exercise the actual frozen HTTP service, not system Python or source imports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const parser = require('../media/geepak3_exact.js');
const { inflatePakPayload } = require('../out/utils/pak-reader');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

async function main() {
  assert.ok(process.env.BOO_PAK_BRIDGE_BIN, 'Choose an explicit isolated candidate runtime');
  const bin = path.resolve(process.env.BOO_PAK_BRIDGE_BIN);
  const snapshotPresent = fs.existsSync(path.join(bin, 'geepak3_vm_snapshot.zip'));
  const lease = net.createServer();
  await new Promise((resolve, reject) => { lease.once('error', reject); lease.listen(0, '127.0.0.1', resolve); });
  const port = lease.address().port;
  await new Promise(resolve => lease.close(resolve));
  const env = { ...process.env };
  delete env.PYTHONHOME; delete env.PYTHONPATH;
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'Path';
  env[pathKey] = [bin, path.join(bin, 'lib'), path.join(env.SystemRoot, 'System32')].join(path.delimiter);
  const child = spawn(path.join(bin, 'boo-pak-bridge.exe'), ['serve', '--host', '127.0.0.1', '--port', String(port)],
    { cwd: bin, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let startError;
  child.on('error', e => { startError = e; });
  child.stdout.resume(); child.stderr.resume(); // Never dump profile/credential responses.
  const closed = new Promise(resolve => child.once('close', resolve));
  const request = (method, route, data, archivePassword) => new Promise((resolve, reject) => {
    const binary = Buffer.isBuffer(data);
    const body = data === undefined ? undefined : binary ? data : Buffer.from(JSON.stringify(data));
    const req = http.request({ host: '127.0.0.1', port, method, path: route, timeout: 5000,
      headers: body ? { 'Content-Type': binary ? 'application/octet-stream' : 'application/json', 'Content-Length': body.length,
        ...(archivePassword !== undefined ? { 'X-GM-Password-B64': Buffer.from(archivePassword).toString('base64') } : {}) } : {} }, res => {
      const chunks = []; res.on('data', x => chunks.push(x));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(Error('candidate timeout')));
    req.end(body);
  });
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (startError) throw startError;
      assert.equal(child.exitCode, null, 'candidate exited before health');
      try {
        const health = await request('GET', '/api/health');
        ready = health.status === 200 && health.body.ok === true
          && health.body.cryptoBackend === 'native' && health.body.snapshotRequired === false;
      } catch { /* loading */ }
      if (ready) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(ready, 'candidate did not become ready');
    const gee2 = require('./fixtures/gee2-native.json');
    const prefix = Buffer.from(gee2.prefix, 'base64');
    const index = Buffer.from(gee2.index, 'base64');
    for (const [route, bytes] of [['/api/gee2-header', prefix], ['/api/gee2-index', Buffer.concat([prefix, index])]]) {
      const result = await request('POST', route, bytes, gee2.password);
      assert.equal(result.status, 200, 'native frozen GEE2 request');
      assert.equal(result.body.profile.slotCount, 3);
      assert.equal(result.body.profile.imageHeaderMask, gee2.imageHeaderMask);
      if (route.endsWith('index')) {
        const decoded = Buffer.from(result.body.profile.decryptedIndex, 'base64');
        assert.deepEqual(gee2.offsets.map((_, i) => decoded.readUInt32LE(i * 4)), gee2.offsets);
      }
      assert.equal((await request('POST', route, bytes, 'wrong')).status, 400);
      assert.equal((await request('POST', route, bytes.subarray(0, bytes.length - 1), gee2.password)).status, 400);
    }
    const cases = [
      ['', '8dcc0e15eee43d0e785c964200b7e3863b47962657a1ac8ca3add10c6d252612', '7ea7b87f1cdf7478b837c645dd091d67aa09bd5ea7cdb8bdf9d733c026ec21e6', '3c3549bfa7107dc48ce9bd0035e0c838abbf8b09cf9023302d04d7c3f8fa7100'],
      ['测试密码123', '2c1f6773179411b29d9ebd942a2e32325a7b8a6cbc7fa1a86edbce9d3df3b3c1', 'daae8be72bfa08bb643ae751da6cbbe3677c770655d842323d0be01928ffb8b9', '431422cc97d43f86cc886f4f16ce0e0829166259fdf98e3632113e24bd14a4c5'],
      ['symbols.test!@#', '5cc07f3e8cd6da681c0932b7a682fd8366bc6937e020f58441138304007d7dc7', '0b5b575e22d83b70a0d7ad28d213f22662adf423bd113f3368125621604d3b69', '46d57bc539226edb7ea1fcdee6265433508590fb740caf079611bed861884da7'],
    ];
    for (const [password, ...hashes] of cases) {
      const r = await request('POST', '/api/gee-profile', { password, encryptedGlobalHeader: Buffer.alloc(256).toString('base64') });
      assert.equal(r.status, 200, 'frozen key derivation failed');
      const p = r.body.profile;
      assert.deepEqual(['indexKey', 'globalHeaderKey', 'imageHeaderKey'].map(k => sha(Buffer.from(p[k], 'base64'))), hashes);
      assert.equal(sha(Buffer.from(p.alternateGlobalHeader, 'base64')), hashes[1]);
    }
    for (const data of [{ password: 'x'.repeat(1025) }, { password: false }, { password: '', encryptedGlobalHeader: 'AA==' }]) {
      assert.equal((await request('POST', '/api/gee-profile', data)).status, 400);
    }
    assert.ok(process.env.BOO_GEE3_TEST_PAK, 'An actual archive is required');
    const file = path.resolve(process.env.BOO_GEE3_TEST_PAK), bytes = fs.readFileSync(file), before = sha(bytes);
    const r = await request('POST', '/api/gee-profile', { password: parser.PASSWORD, encryptedGlobalHeader: bytes.subarray(10, 266).toString('base64') });
    assert.equal(r.status, 200);
    const actual = parser.parse(bytes, parser.PASSWORD, r.body.profile), expected = parser.parse(bytes, parser.PASSWORD);
    assert.deepEqual(actual, expected);
    const pixels = crypto.createHash('sha256');
    for (const b of actual.blocks) pixels.update(parser.toRgba(parser.readPayload(bytes, b, x => inflatePakPayload(x, b.rawSize).raw), b));
    assert.equal(sha(fs.readFileSync(file)), before);
    console.log(JSON.stringify({ status: 'PASS', runtime: bin, snapshotPresent,
      keyVectors: cases.length, gee2SyntheticRequests: 2, invalidRequests: 7, sourceSha256: before, slots: actual.header.count,
      blocks: actual.blocks.length, rgbaSha256: pixels.digest('hex'), exeSha256: sha(fs.readFileSync(path.join(bin, 'boo-pak-bridge.exe'))) }));
  } finally {
    if (child.exitCode === null) child.kill(); // Only the process this test owns.
    await closed;
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
