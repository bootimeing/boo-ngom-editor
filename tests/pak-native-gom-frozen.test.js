// Successful GOM legacy/GOM2 differential gate against the previous frozen
// executable. Synthetic fixtures are labelled and never replace a real corpus.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function des(key, bytes) {
  const cipher = crypto.createCipheriv('des-ede3', Buffer.concat([key, key, key]), null);
  cipher.setAutoPadding(false); return Buffer.concat([cipher.update(bytes), cipher.final()]);
}
const seedFor = key => Buffer.concat([des(key, Buffer.alloc(8, 0x8f)), Buffer.alloc(12, 0x8f)]);
function encrypt(bytes, key) {
  const output = Buffer.alloc(bytes.length); let feedback = seedFor(key), position = 0;
  while (bytes.length - position >= 20) {
    const stage = Buffer.from(bytes.subarray(position, position + 20));
    for (let n = 0; n < 20; n++) stage[n] ^= feedback[n];
    feedback = Buffer.concat([des(key, stage.subarray(0, 8)), stage.subarray(8)]);
    feedback.copy(output, position); position += 20;
  }
  const tail = Buffer.concat([des(key, feedback.subarray(0, 8)), feedback.subarray(8)]);
  for (let n = 0; position + n < bytes.length; n++) output[position + n] = bytes[position + n] ^ tail[n];
  return output;
}
function fixture(legacy) {
  const signature = legacy ? Buffer.from('\x09GAMEOFMIR', 'latin1') : Buffer.from('\x0aGAMEOFMIR2\0\0', 'latin1');
  const fixedKey = Buffer.from(legacy ? '507892b60c6ed00c' : 'd0740a42ee869c94', 'hex');
  const password = 'synthetic-fixture';
  const key = crypto.createHash('sha1').update(password, 'ascii').digest().subarray(0, 8), seed = seedFor(key);
  const mask = Buffer.concat([des(key, seed.subarray(0, 8)), seed.subarray(8, 16)]);
  const global = Buffer.alloc(256), indexOffset = signature.length + 256, index = Buffer.alloc(12);
  global[1] = 17; global.write('www.gameofmir.com', 2, 'ascii'); global.writeUInt32LE(indexOffset, 0x2a);
  global.writeUInt32LE(3, 0x2e); global.writeUInt32LE(2, 0x32); global.writeUInt32LE(indexOffset, 0x36);
  const blocks = [];
  for (let slot = 1; slot < 3; slot++) {
    index.writeUInt32LE(indexOffset + index.length + (slot - 1) * 32, slot * 4);
    const header = Buffer.alloc(16); header[0] = 7; header[3] = 1;
    header.writeUInt16LE(2, 4); header.writeUInt16LE(2, 6); header.writeInt16LE(slot - 2, 8); header.writeInt16LE(slot, 10);
    for (let n = 0; n < 16; n++) header[n] ^= mask[n];
    blocks.push(header, Buffer.from([10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0, 100, 110, 120, 255]));
  }
  return { bytes: Buffer.concat([signature, encrypt(global, fixedKey), encrypt(index, key), ...blocks]), password };
}
async function start(bin) {
  const lease = net.createServer(); await new Promise(resolve => lease.listen(0, '127.0.0.1', resolve));
  const port = lease.address().port; await new Promise(resolve => lease.close(resolve));
  const child = spawn(path.join(bin, 'boo-pak-bridge.exe'), ['serve', '--host', '127.0.0.1', '--port', String(port)], { cwd: bin, windowsHide: true, stdio: 'ignore' });
  const closed = new Promise(resolve => child.once('close', resolve));
  const request = (route, bytes, password) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: bytes ? 'POST' : 'GET', timeout: 5000,
      headers: bytes ? { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length, 'X-GM-Password-B64': Buffer.from(password).toString('base64') } : {} }, res => {
      const data = []; res.on('data', b => data.push(b)); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(data)) }); } catch (e) { reject(e); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(Error('bridge timeout'))); req.end(bytes);
  });
  try {
    for (let n = 0; n < 150; n++) {
      assert.equal(child.exitCode, null);
      try { if ((await request('/api/health')).status === 200) return { request, close: async () => { child.kill(); await closed; } }; } catch { /* startup */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('bridge failed to start');
  } catch (error) { child.kill(); await closed; throw error; }
}
async function main() {
  assert.ok(process.env.BOO_PAK_BRIDGE_BIN, 'explicit native candidate required');
  const candidate = path.resolve(process.env.BOO_PAK_BRIDGE_BIN);
  const baseline = path.resolve(process.env.BOO_PAK_BASELINE_BIN || path.join(root, 'tools/PakBridge/bin'));
  const old = await start(baseline), next = await start(candidate);
  try {
    const outcomes = [];
    for (const legacy of [true, false]) {
      const sample = fixture(legacy);
      const expected = await old.request('/api/gom-profile', sample.bytes, sample.password);
      const actual = await next.request('/api/gom-profile', sample.bytes, sample.password);
      assert.equal(expected.status, 200, JSON.stringify(expected)); assert.deepEqual(actual, expected);
      assert.equal(actual.body.profile.slotCount, 3); assert.equal(actual.body.profile.blocks.length, 2);
      for (const [bytes, password] of [[sample.bytes, 'wrong'], [sample.bytes.subarray(0, 100), sample.password], [Buffer.alloc(280), sample.password]]) {
        assert.equal((await next.request('/api/gom-profile', bytes, password)).status, 400);
      }
      outcomes.push({ family: legacy ? 'GAMEOFMIR' : 'GAMEOFMIR2', kind: 'synthetic', bytesSha256: sha(sample.bytes), profileSha256: sha(JSON.stringify(actual.body.profile)), slots: 3, blocks: 2, invalidRequests: 3 });
    }
    const samplePath = process.env.BOO_GOM2_TEST_PAK || 'D:/老卢专用客户端/boo独家制作/data/Items3.pak';
    // Same already configured engine material as the production reader; its
    // SHA matches this sample's cache passwordHash. Never print credentials.
    const bytes = fs.readFileSync(samplePath), before = sha(bytes), password = process.env.BOO_GOM2_TEST_PASSWORD || require('../media/geepak3_exact').PASSWORD;
    const expected = await old.request('/api/gom-profile', bytes, password), actual = await next.request('/api/gom-profile', bytes, password);
    assert.equal(expected.status, 200, 'real GOM2 baseline failed'); assert.deepEqual(actual, expected);
    assert.equal(sha(fs.readFileSync(samplePath)), before);
    outcomes.push({ family: 'GAMEOFMIR2', kind: 'real', sourceSha256: before, slots: actual.body.profile.slotCount, blocks: actual.body.profile.blocks.length, profileSha256: sha(JSON.stringify(actual.body.profile)) });
    console.log(JSON.stringify({ status: 'PASS', candidate, baseline, outcomes, boundary: 'Legacy known-hash real GOM.Pak unavailable; synthetic successful differential is not a substitute for that corpus. JPK does not use this Python service.' }, null, 2));
  } finally { await old.close(); await next.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
