const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const http = require('node:http');
const { inspectPakStructure } = require('../out/utils/pak-structure');
const { pakStructureProfileIds, pakStructureContract } = require('../out/utils/pak-structure-contracts');
const { parseHxmFile } = require('../out/utils/hxm-reader');
const { hxmFixture, pack4Fixture } = require('./pak-hxm-pack4.test');
const { buildFixture: gomFixture } = require('./gom-reader-tolerance.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-pak-structure-'));
  const repository = path.resolve(__dirname, '..');
  const password = 'Synthetic-private-中文-42';
  const options = { extensionPath: repository, password };
  try {
    assert.equal(pakStructureProfileIds().length, 10);
    assert.ok(pakStructureProfileIds().includes('hxm2-lz-v0'));
    assert.throws(() => pakStructureContract('unknown'), /未登记/);
    assert.equal(pakStructureContract('gee3-legacy-v2').offsetsDecoded, false);
    assert.equal(pakStructureContract('gee3-legacy-v2').imageFields.some(field => field.name === 'x'), false);
    let hxmPath;
    for (const [name, bytes, profile] of [
      ['hxm', hxmFixture(password, { versionReserved: [1, 2, 3] }), 'hxm2-lz-v1'],
      ['plain', pack4Fixture(password, false), 'pack4-plain-bgra'],
      ['ksf', pack4Fixture(password, true), 'pack4-ksf-bgra'],
    ]) {
      const file = path.join(root, name + '.pak'); fs.writeFileSync(file, bytes);
      const result = await inspectPakStructure({ ...options, pakPath: file });
      assert.equal(result.profileId, profile);
      assert.deepEqual(result.totals, { slots: 6, empty: 4, indexedUnverified: 2, rejected: 0 });
      assert.equal(result.verification.pixels, 'not-run');
      assert.equal(result.issues.length, 0);
      assert.equal(result.sourceUnchanged, true);
      assert.deepEqual(fs.readFileSync(file), bytes);
      assert.equal(result.slots[1].state, 'empty');
      assert.equal(result.slots[4].image.values.x, -23);
      assert.equal(result.slots[4].image.values.y, 7);
      assert.equal(JSON.stringify(result).includes(password), false);
      assert.equal(result.slots[4].indexEntry.decodedOffset, (name === 'hxm' ? 0 : 40) + 4 * 4);
      if (name === 'hxm') {
        hxmPath = file;
        assert.equal(result.globalValues.version, 1);
        assert.deepEqual(result.globalValues.versionReservedBytes, [1, 2, 3]);
        assert.equal(result.contract.globalFields.find(field => field.name === 'version').length, 1);
      }
    }
    const invalid = path.join(root, 'bad-check-length.pak');
    fs.writeFileSync(invalid, hxmFixture(password, { checkLength: 13 }));
    assert.throws(() => parseHxmFile(invalid, password), /校验字段无效/);
    await assert.rejects(inspectPakStructure({ ...options, pakPath: hxmPath, password: 'wrong' }), /密码/);
    await assert.rejects(inspectPakStructure({ ...options, pakPath: hxmPath, maxReportSlots: 5 }), /超过槽位上限/);

    const damaged = path.join(root, 'damaged.pak');
    gomFixture(damaged, password, new Set([1260]));
    const damageReport = await inspectPakStructure({ ...options, pakPath: damaged });
    assert.equal(damageReport.slots[1260].state, 'rejected-block');
    assert.equal(damageReport.slots[1655].state, 'empty');
    assert.equal(damageReport.totals.rejected, 1);
    assert.equal(damageReport.issues[0].logicalIndex, 1260);
    assert.equal(damageReport.issues[0].code, 'invalid-dimensions');
    const overlapping = path.join(root, 'overlap.pak'); gomFixture(overlapping, password, new Set());
    const modified = fs.readFileSync(overlapping); modified[269 + 1659 * 4 + 4] ^= 1 ^ 2;
    fs.writeFileSync(overlapping, modified);
    const overlapReport = await inspectPakStructure({ ...options, pakPath: overlapping });
    assert.ok(overlapReport.issues.some(issue => issue.code === 'overlapping-blocks' && issue.logicalIndex === 0));
    assert.equal(overlapReport.slots[0].state, 'rejected-block');
    assert.equal(overlapReport.verification.structure, 'issues-found');
    const unknown = path.join(root, 'unknown.pak'); fs.writeFileSync(unknown, Buffer.from('GEEM2-unknown'));
    await assert.rejects(inspectPakStructure({ ...options, pakPath: unknown }), /未尝试扫描/);

    const reportFile = path.join(root, 'report.json');
    const cli = input => spawnSync(process.execPath, ['tools/pak/inspect-structure.js'], {
      cwd: repository, windowsHide: true, encoding: 'utf8', input: JSON.stringify(input),
    });
    const good = cli({ files: [hxmPath], password, reportFile });
    assert.equal(good.status, 0, good.stderr);
    assert.equal(good.stdout.includes(password), false);
    const saved = fs.readFileSync(reportFile);
    assert.equal(saved.toString('utf8').includes(password), false);
    assert.equal(cli({ files: [hxmPath], password, reportFile }).status, 1);
    assert.deepEqual(fs.readFileSync(reportFile), saved, 'reports must not be overwritten');
    const sourceBefore = fs.readFileSync(hxmPath);
    assert.equal(cli({ files: [hxmPath], password, reportFile: hxmPath }).status, 1);
    assert.deepEqual(fs.readFileSync(hxmPath), sourceBefore);
    assert.equal(cli({ files: [unknown], password, reportFile: path.join(root, 'unknown.json') }).status, 2);
    const gee = path.join(root, 'requires-bridge.pak'), geeBytes = Buffer.alloc(266);
    geeBytes[0] = 7; geeBytes.write('GEEPAK3', 1); fs.writeFileSync(gee, geeBytes);
    const requests = [];
    const server = http.createServer((request, response) => {
      requests.push([request.method, request.url]);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, engine: 'unrelated-service' }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const status = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['tools/pak/inspect-structure.js'], {
          cwd: repository, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, BOO_PAK_BRIDGE_PORT: String(server.address().port) },
        });
        child.stdout.resume(); child.stderr.resume(); child.on('error', reject); child.on('close', resolve);
        child.stdin.end(JSON.stringify({ files: [gee], password, useRunningBridge: true,
          reportFile: path.join(root, 'wrong-service.json') }));
      });
      assert.equal(status, 2);
      assert.deepEqual(requests, [['GET', '/api/health']], 'must not send archive/password to an unrelated local service');
    } finally { await new Promise(resolve => server.close(resolve)); }
    console.log('pak-structure.test.js: PASS (provenance, real byte ranges, reserved fields, failures, no guessing, read-only CLI)');
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(root).startsWith('boo-pak-structure-'));
    removeTemporaryDirectory(root);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
