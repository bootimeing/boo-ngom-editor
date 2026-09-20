// Read-only real-corpus differential for the existing built-in password profile.
// Usage: node tests/pak-geepak3-local-corpus.test.js <archive.pak> [...]
// Optional BOO_PAK_TEST_PYTHON chooses a Python runtime. No passwords in argv/logs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const parser = require('../media/geepak3_exact.js');
const { inflatePakPayload } = require('../out/utils/pak-reader.js');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');

const archives = process.argv.slice(2).map(p => path.resolve(p));
assert.ok(archives.length, 'Supply actual PAK paths; no samples is not a passing test');
const profileScript = `
import base64, json, statistics, sys, time
sys.path.insert(0, 'tools/PakBridge/src')
import gm_offline_crypto as c
import geepak3_exact as p
password = p.QQ1167746_PROFILE.password
vm = c.default_gee_vm()
def profile(k):
    return dict(zip(['indexKey','globalHeaderKey','imageHeaderKey'],
        [base64.b64encode(b).decode('ascii') for b in [k.index_key,k.global_header_key,k.image_header_key]]))
reference = vm.derive(password)
local = c.derive_gee_keys(password)
assert reference == local
timings = {}
for name, run in [('vm', lambda: vm.derive(password)), ('local', lambda: c.derive_gee_keys(password))]:
    samples = []
    for _ in range(7):
        c.derive_gee_keys.cache_clear()
        start = time.perf_counter()
        assert run() == reference
        samples.append((time.perf_counter()-start)*1000)
    timings[name] = dict(median_ms=statistics.median(samples),max_ms=max(samples),runs=len(samples))
wrong = c.derive_gee_keys('definitely-wrong-local-test')
print(json.dumps(dict(reference=profile(reference),local=profile(local),wrong=profile(wrong),timings=timings)))
`;
const profiles = JSON.parse(execFileSync(process.env.BOO_PAK_TEST_PYTHON || 'python',
  ['-B', '-X', 'utf8', '-c', profileScript], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true,
    timeout: 60000, maxBuffer: 1024 * 1024,
  }));
const results = [];
for (const file of archives) {
  const original = fs.readFileSync(file);
  const sourceHash = hash(original);
  const expected = parser.parse(original, parser.PASSWORD, profiles.reference);
  const actual = parser.parseFromReader(original.length,
    (offset, length) => original.subarray(offset, offset + length), parser.PASSWORD, profiles.local);
  assert.deepEqual(actual, expected, 'local/VM header, slot and block metadata');
  const rgba = crypto.createHash('sha256');
  const formats = new Map();
  for (let i = 0; i < actual.blocks.length; i++) {
    const block = actual.blocks[i];
    const referenceBlock = expected.blocks[i];
    const pixels = parser.toRgba(parser.readPayload(original, block,
      payload => inflatePakPayload(payload, block.rawSize).raw), block);
    const referencePixels = parser.toRgba(parser.readPayload(original, referenceBlock,
      payload => inflatePakPayload(payload, referenceBlock.rawSize).raw), referenceBlock);
    assert.deepEqual(pixels, referencePixels, `RGBA at slot ${block.logicalIndex}`);
    rgba.update(pixels);
    const format = `${block.imageType}/${block.flags}`;
    formats.set(format, (formats.get(format) || 0) + 1);
  }
  // Legacy/empty archives can have a password-independent header; record that
  // boundary instead of pretending an empty file verifies an image password.
  let wrongPassword = 'rejected';
  try {
    const wrong = parser.parse(original, 'definitely-wrong-local-test', profiles.wrong);
    assert.equal(wrong.blocks.length, 0, 'wrong password must not yield drawable blocks');
    wrongPassword = 'empty-no-drawable-content';
  } catch (error) {
    if (error.code === 'ERR_ASSERTION') throw error;
    assert.match(String(error.message), /密码|password|索引|header|image|offset|format|图片|块|尺寸/i);
  }
  assert.equal(hash(fs.readFileSync(file)), sourceHash, 'source archive changed');
  results.push({ file, bytes: original.length, sourceSha256: sourceHash, family: actual.header.family,
    slots: actual.header.count, blocks: actual.blocks.length,
    blank: actual.header.count - actual.blocks.length, rgbaSha256: rgba.digest('hex'),
    formats: Object.fromEntries(formats), wrongPassword, sourceUnchanged: true });
}
const report = { status: 'PASS',
  scope: 'Real archives through production JS parser; VM/local keys compared. Same pixel decoder, not independent client pixel fidelity or VSIX/Worker verification.',
  timingScope: 'Warm password material and VM snapshot; key result cache cleared per run; not archive load or first-paint timing.',
  keyTimings: profiles.timings, results };
if (process.env.BOO_PAK_CORPUS_REPORT) {
  fs.writeFileSync(path.resolve(process.env.BOO_PAK_CORPUS_REPORT), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify(report, null, 2));
