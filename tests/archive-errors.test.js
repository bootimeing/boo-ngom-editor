const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const { hxmFixture, pack4Fixture } = require('./pak-hxm-pack4.test');
const { buildFixture: gomFixture } = require('./gom-reader-tolerance.test');
const runtimeRoot = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const runtime = name => require(path.join(runtimeRoot, 'out/utils', name));
const hxm = runtime('hxm-reader');
const pack4 = runtime('pack4-reader');
const gom = runtime('gom-reader');
const jpk = runtime('jpk-reader');
const pak = runtime('pak-reader');
const gee = require(path.join(runtimeRoot, 'media/geepak3_exact.js'));

function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-archive-errors-'));
  const password = 'Synthetic-private-中文-42';
  let checks = 0;
  const write = (name, bytes) => { const file = path.join(root, name); fs.writeFileSync(file, bytes); return file; };
  const check = (run, stage, reasonCode, expected = {}) => {
    const keys = ['stage', 'reasonCode', 'family', 'profileId', 'logicalIndex', 'offset', 'length'];
    assert.throws(run, error => {
      assert.ok(error.diagnostic, `Missing diagnostic for ${error.message}`);
      assert.equal(error.diagnostic.stage, stage);
      assert.equal(error.diagnostic.reasonCode, reasonCode);
      for (const [key, value] of Object.entries(expected)) assert.equal(error.diagnostic[key], value, key);
      assert.ok(Object.keys(error.diagnostic).every(key => keys.includes(key)));
      assert.equal(JSON.stringify(error.diagnostic).includes(password), false);
      checks++;
      return true;
    });
  };
  try {
    const unknown = write('unknown.pak', Buffer.alloc(300));
    check(() => hxm.parseHxmFile(unknown, password), 'global-header', 'unsupported-global-header', { family: 'HXM', offset: 0 });
    check(() => pack4.parsePack4File(unknown, password), 'global-header', 'unsupported-global-header', { family: 'PACK4' });
    check(() => gom.parseGomFile(unknown, password, gee), 'global-header', 'unsupported-global-header', { family: 'GOM' });
    check(() => gee.parse(Buffer.alloc(300), password), 'global-header', 'unsupported-global-header');
    check(() => gee.parseFromReader(300, (o, n) => Buffer.alloc(n), password), 'global-header', 'unsupported-global-header');
    const unsupportedVersion = write('hxm-v9.pak', hxmFixture(password, { version: 9 }));
    check(() => hxm.parseHxmFile(unsupportedVersion, password), 'global-header', 'unsupported-global-header');
    const unsupportedHxm = write('hxm-type.pak', hxmFixture(password, { type: 4 }));
    check(() => hxm.parseHxmFile(unsupportedHxm, password), 'image-header', 'unsupported-image-layout', { logicalIndex: 4 });
    const goodHxm = write('hxm-good.pak', hxmFixture(password));
    check(() => hxm.parseHxmFile(goodHxm, 'wrong'), 'global-header', 'password-check-failed');
    const shortHxm = write('hxm-short.pak', hxmFixture(password).subarray(0, 270));
    check(() => hxm.parseHxmFile(shortHxm, password), 'index', 'index-truncated', { offset: 262, length: 24 });
    const duplicate = write('hxm-duplicate.pak', hxmFixture(password, { duplicate: true }));
    check(() => hxm.parseHxmFile(duplicate, password), 'index', 'duplicate-offset', { logicalIndex: 4 });
    const unsupportedPack4 = write('pack4-type.pak', pack4Fixture(password, false, { type: 5 }));
    check(() => pack4.parsePack4File(unsupportedPack4, password), 'image-header', 'unsupported-image-layout', { logicalIndex: 4, offset: 64, length: 23 });
    const encrypted = write('pack4-ksf.pak', pack4Fixture(password, true));
    check(() => pack4.parsePack4File(encrypted, 'wrong'), 'index', 'password-or-profile-mismatch');
    check(() => pack4.parsePack4File(encrypted, ''), 'global-header', 'password-required');
    const shortPack4 = write('pack4-short.pak', Buffer.from('PACK4.0 '));
    check(() => pack4.parsePack4File(shortPack4, ''), 'global-header', 'truncated-data', { offset: 0, length: 64 });
    const trailing = write('pack4-trailing.pak', pack4Fixture(password, false, { trailing: true }));
    check(() => pack4.parsePack4File(trailing, password), 'index', 'trailing-compressed-data');
    const gomFile = path.join(root, 'gom.pak'); gomFixture(gomFile, password, new Set());
    check(() => gom.parseGomFile(gomFile, 'wrong', gee), 'index', 'password-or-profile-mismatch');
    const gomShort = write('gom-short.pak', fs.readFileSync(gomFile).subarray(0, 300));
    check(() => gom.parseGomFile(gomShort, password, gee), 'index', 'index-truncated');
    const gmBadBytes = fs.readFileSync(gomFile);
    // Mutate only the encrypted type byte of the first and second records.
    gmBadBytes[269 + 1659 * 4] ^= 7 ^ 4;
    gmBadBytes[269 + 1659 * 4 + 20] ^= 7 ^ 4;
    const gomUnsupported = write('gom-unsupported.pak', gmBadBytes);
    check(() => gom.parseGomFile(gomUnsupported, password, gee), 'image-header', 'unsupported-image-layout', { family: 'GOM', logicalIndex: 0 });
    const hxmBlock = { logicalIndex: 9, imageType: 5, flags: 0, width: 3, height: 2, rawSize: 16, payloadOffset: 400, payloadSize: 16, compressedSize: 0, x: 0, y: 0 };
    check(() => hxm.decodeHxmPayload(Buffer.alloc(16), hxmBlock, 'hxm2-lz-v1', pak.inflatePakPayload), 'pixels', 'unsupported-image-layout', { logicalIndex: 9, offset: 400, length: 16 });
    check(() => pak.inflatePakPayload(Buffer.from([1, 2, 3]), 16), 'decompression', 'decompression-failed');
    check(() => pak.inflatePakPayload(zlib.deflateSync(Buffer.alloc(17)), 16), 'decompression', 'decompression-failed');
    check(() => pak.inflatePakPayload(Buffer.concat([zlib.deflateSync(Buffer.alloc(16)), Buffer.from([9])]), 16), 'decompression', 'trailing-compressed-data');
    check(() => pak.inflatePakPayload(zlib.deflateSync(Buffer.alloc(15)), 16), 'decompression', 'decoded-size-mismatch');
    check(() => pak.inflatePakPayload(Buffer.alloc(0), 128 * 1024 * 1024 + 1), 'decompression', 'resource-limit');
    const shortJpk = write('jpk-short.jpk', Buffer.alloc(79));
    check(() => jpk.parseJpkFile(shortJpk, password), 'global-header', 'truncated-data');
    const state = jpk.deriveJpkRc4State(password), jpkHeader = Buffer.alloc(80);
    jpkHeader[0] = 7; jpkHeader.write('GameLib', 1);
    jpkHeader.writeUInt32LE(80, 44); jpkHeader.writeUInt32LE(1, 48); jpkHeader.writeUInt32LE(80, 52);
    const goodJpk = write('jpk-header.jpk', Buffer.concat([jpk.rc4Crypt(jpkHeader, state), Buffer.alloc(4)]));
    check(() => jpk.parseJpkFile(goodJpk, 'wrong'), 'global-header', 'password-or-profile-mismatch');
    const badJpkIndex = write('jpk-index.jpk', fs.readFileSync(goodJpk).subarray(0, 82));
    check(() => jpk.parseJpkFile(badJpkIndex, password), 'index', 'index-truncated', { offset: 80, length: 4 });
    const payloadFile = write('jpk-payload.jpk', jpk.rc4Crypt(Buffer.from([1, 2, 3]), state));
    const fd = fs.openSync(payloadFile, 'r');
    try {
      check(() => jpk.readJpkPayload(fd, { logicalIndex: 17, payloadOffset: 0, payloadSize: 3, compressed: true, rawSize: 16 }, state), 'decompression', 'decompression-failed', { logicalIndex: 17 });
    } finally { fs.closeSync(fd); }
    check(() => gee.rawImageSize(4, 0, 1, 1), 'image-header', 'unsupported-image-layout');
    check(() => gee.parse(Buffer.alloc(10), password), 'global-header', 'truncated-data');
    check(() => pack4.renderPack4Rgba(Buffer.alloc(3), { logicalIndex: 1, imageType: 3, flags: 0, width: 1, height: 1, rawSize: 4, payloadOffset: 100, payloadSize: 4 }), 'pixels', 'decoded-size-mismatch');
    check(() => pack4.renderPack4Rgba(Buffer.alloc(4), { logicalIndex: 1, imageType: 3, flags: 0, width: 0, height: 1, rawSize: 4, payloadOffset: 100, payloadSize: 4 }), 'pixels', 'invalid-dimensions');
    const errors = runtime('archive-errors');
    assert.deepEqual(errors.getArchiveDiagnostic(new Error('password invalid corrupted zlib unsupported')), { stage: 'unknown', reasonCode: 'unknown' });
    const safe = errors.sanitizeArchiveDiagnostic({ stage: 'index', reasonCode: 'index-truncated', family: 'JPK', profileId: 'jpk-GameLib', logicalIndex: 8, offset: 80, length: 4, password, key: password, rawHeader: password, cause: password });
    assert.deepEqual(safe, { stage: 'index', reasonCode: 'index-truncated', family: 'JPK', profileId: 'jpk-GameLib', logicalIndex: 8, offset: 80, length: 4 });
    assert.deepEqual(errors.sanitizeArchiveDiagnostic({ stage: password, reasonCode: password, family: password, profileId: password, logicalIndex: -1, offset: NaN, length: Infinity }), { stage: 'unknown', reasonCode: 'unknown' });
    const plain = new Error('opaque'), tagged = errors.annotateArchiveError(plain, safe);
    assert.equal(plain, tagged); assert.ok(Object.isFrozen(tagged.diagnostic));
    assert.deepEqual(errors.getArchiveDiagnostic(JSON.parse(JSON.stringify(tagged))), safe);
    const hostError = new Error('unknown host failure');
    assert.throws(() => hxm.decodeHxmPayload(Buffer.alloc(16), { ...hxmBlock, imageType: 7, width: 2, compressedSize: 16 }, 'hxm2-lz-v1', () => { throw hostError; }), error => error === hostError);
    const oldInflate = zlib.inflateSync;
    try {
      zlib.inflateSync = () => { throw hostError; };
      assert.throws(() => pack4.parsePack4File(encrypted, password), error => error === hostError);
      const f = fs.openSync(payloadFile, 'r');
      try { assert.throws(() => jpk.readJpkPayload(f, { logicalIndex: 17, payloadOffset: 0, payloadSize: 3, compressed: true, rawSize: 16 }, state), error => error === hostError); }
      finally { fs.closeSync(f); }
    } finally { zlib.inflateSync = oldInflate; }
    console.log(`Archive structured errors: ${checks} identified failure points and safe unknown/transport checks passed.`);
  } finally { removeTemporaryDirectory(root, 'boo-archive-errors-'); }
}
main();
