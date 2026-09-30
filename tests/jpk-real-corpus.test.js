// Opt-in real corpus verification. JSON {directory,passwords,reportFile?} on
// stdin only; passwords and RC4 state must never be included in the report.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');
const runtimeRoot = path.resolve(process.env.BOO_JPK_RUNTIME_ROOT || path.join(__dirname, '..'));
const { parseJpkFile, JpkPasswordError } = require(path.join(runtimeRoot, 'out/utils/jpk-reader'));
const { decodePakFully } = require(path.join(runtimeRoot, 'out/utils/pak-reader'));
const { openArchiveIndexed, readArchiveImagePng } = require(path.join(runtimeRoot, 'out/utils/archive-index'));

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
  assert.ok(Array.isArray(input.passwords) && input.passwords.length > 0);
  const files = fs.readdirSync(input.directory)
    .filter(name => /\.jpk$/i.test(name) && (!input.onlyFiles || input.onlyFiles.includes(name))).sort();
  assert.ok(files.length > 0);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-jpk-real-'));
  const report = { generatedAt: new Date().toISOString(), runtimeRoot, files: [] };
  try {
    for (const name of files) {
      const file = path.join(input.directory, name);
      const original = fs.readFileSync(file);
      const result = { name, bytes: original.length, sourceSha256: sha(original) };
      let parsed, password;
      for (const [i, candidate] of input.passwords.entries()) {
        try {
          parsed = parseJpkFile(file, candidate);
          password = candidate;
          result.passwordCandidate = i + 1;
          break;
        } catch (error) {
          if (!(error instanceof JpkPasswordError)) {
            result.passwordCandidate = i + 1;
            result.error = error.message;
            break;
          }
        }
      }
      if (!parsed) {
        result.status = result.error ? 'invalid-index' : 'no-candidate-password';
      } else {
        const options = { extensionPath: runtimeRoot, pakPath: file, password, willIdx: 0 };
        const indexRoot = path.join(temp, 'direct');
        const direct = await openArchiveIndexed({ ...options, indexRoot });
        const pngHashes = new Map(), failed = [];
        for (const block of parsed.blocks) {
          try {
            const png = await readArchiveImagePng({
              extensionPath: options.extensionPath, indexRoot,
              archiveId: direct.archiveId, imageIndex: block.logicalIndex,
            });
            assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
            assert.equal(png.readUInt32BE(16), block.width);
            assert.equal(png.readUInt32BE(20), block.height);
            pngHashes.set(block.logicalIndex, sha(png));
          } catch (error) {
            if (error.name !== 'JpkFormatError') throw error;
            failed.push(block.logicalIndex);
          }
        }
        const legacy = await decodePakFully({ ...options, cacheRoot: path.join(temp, 'legacy') });
        const malformed = [...parsed.skippedMalformedIndices, ...failed].sort((a, b) => a - b);
        assert.equal(direct.slotCount, parsed.slotCount);
        assert.equal(legacy.slotCount, parsed.slotCount);
        assert.equal(legacy.skippedMalformedCount, malformed.length);
        assert.equal(legacy.assets.filter(asset => asset.decodeStatus === 'decoded' || asset.decodeStatus === 'recovered').length, pngHashes.size);
        const corpus = crypto.createHash('sha256');
        for (const [id, hash] of pngHashes) {
          assert.equal(sha(fs.readFileSync(legacy.assets[id].path)), hash, `${name} slot ${id}: direct/legacy PNG mismatch`);
          corpus.update(`${id}:${hash}\n`);
        }
        for (const id of malformed) {
          assert.equal(legacy.assets[id].imageIdx, id);
          assert.equal(legacy.assets[id].isBlank, false);
          assert.equal(legacy.assets[id].decodeStatus, 'corrupt');
          assert.equal(legacy.assets[id].path, '');
        }
        result.status = malformed.length ? 'partial-damaged-source' : 'compatible';
        Object.assign(result, {
          title: parsed.title, slotCount: parsed.slotCount, imageCount: pngHashes.size,
          originalEmptySlots: parsed.slotCount - parsed.blocks.length - parsed.skippedMalformedIndices.length,
          trailerSize: parsed.trailerSize, indexOffset: parsed.indexOffset,
          erasedHeaderIndices: parsed.skippedMalformedIndices, payloadFailureIndices: failed,
          directLegacyPngMatches: pngHashes.size, pngCorpusSha256: corpus.digest('hex'),
        });
      }
      assert.equal(sha(fs.readFileSync(file)), result.sourceSha256, `${name}: source changed`);
      result.sourceUnchanged = true;
      report.files.push(result);
      console.log(JSON.stringify(result));
    }
    if (input.expected) {
      for (const [name, expected] of Object.entries(input.expected)) {
        const actual = report.files.find(file => file.name === name);
        assert.ok(actual, `missing fixture ${name}`);
        for (const [key, value] of Object.entries(expected)) assert.deepEqual(actual[key], value, `${name}: ${key}`);
      }
    }
    if (input.reportFile) {
      fs.mkdirSync(path.dirname(path.resolve(input.reportFile)), { recursive: true });
      fs.writeFileSync(input.reportFile, JSON.stringify(report, null, 2));
    }
    console.log('jpk-real-corpus: verification complete; per-file status above, blocked files are not compatibility passes');
  } finally { removeTemporaryDirectory(temp); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
