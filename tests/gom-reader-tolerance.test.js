const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const iconv = require('iconv-lite');
const os = require('node:os');
const path = require('node:path');

const { parseGomFile } = require('../out/utils/gom-reader');
const { openArchiveIndexed } = require('../out/utils/archive-index');

const SIGNATURE = Buffer.from([0x0a, ...Buffer.from('GAMEOFMIR2', 'ascii'), 0, 0]);
const FIXED_KEY = Buffer.from('d0740a42ee869c94', 'hex');
const PASSWORD_SALT = 0x8f;
const SLOT_COUNT = 1659;
const NONEMPTY_COUNT = 1655;

const parser = {
  rawImageSize(imageType, flags, width, height) {
    if (imageType !== 7 || flags !== 1) throw new Error('unsupported fixture image format');
    return width * height * 4;
  },
  formatName(imageType, flags) {
    if (imageType !== 7 || flags !== 1) throw new Error('unsupported fixture image format');
    return 'RGBA32';
  },
};

function desBlock(key, block, decrypt) {
  const tripleKey = Buffer.concat([key, key, key]);
  const cipher = decrypt
    ? crypto.createDecipheriv('des-ede3', tripleKey, null)
    : crypto.createCipheriv('des-ede3', tripleKey, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function desEncrypt(key, block) {
  return desBlock(key, block, false);
}

function createSeed(key) {
  return Buffer.concat([
    desEncrypt(key, Buffer.alloc(8, PASSWORD_SALT)),
    Buffer.alloc(12, PASSWORD_SALT),
  ]);
}

function encryptFeedback(plaintext, key, seed) {
  const output = Buffer.allocUnsafe(plaintext.length);
  let feedback = Buffer.from(seed);
  let position = 0;
  while (plaintext.length - position >= 20) {
    const stage = Buffer.allocUnsafe(20);
    for (let index = 0; index < 20; index++) {
      stage[index] = plaintext[position + index] ^ feedback[index];
    }
    const encrypted = Buffer.concat([desEncrypt(key, stage.subarray(0, 8)), stage.subarray(8)]);
    encrypted.copy(output, position);
    feedback = encrypted;
    position += 20;
  }
  if (position < plaintext.length) {
    const stream = Buffer.concat([desEncrypt(key, feedback.subarray(0, 8)), feedback.subarray(8)]);
    for (let index = 0; position + index < plaintext.length; index++) {
      output[position + index] = plaintext[position + index] ^ stream[index];
    }
  }
  return output;
}

function passwordMaterial(password) {
  const key = crypto.createHash('sha1').update(iconv.encode(password, 'cp936')).digest().subarray(0, 8);
  const seed = createSeed(key);
  return {
    key,
    seed,
    imageHeaderKey: Buffer.concat([desEncrypt(key, seed.subarray(0, 8)), seed.subarray(8, 16)]),
  };
}

function buildFixture(filePath, password, malformedIndices) {
  const indexOffset = SIGNATURE.length + 256;
  const indexSize = SLOT_COUNT * 4;
  const firstBlockOffset = indexOffset + indexSize;
  const blockSize = 20;
  const globalHeader = Buffer.alloc(256);
  const title = Buffer.from('www.gameofmir.com', 'ascii');
  globalHeader[1] = title.length;
  title.copy(globalHeader, 2);
  globalHeader.writeUInt32LE(indexOffset, 0x2a);
  globalHeader.writeUInt32LE(SLOT_COUNT, 0x2e);
  globalHeader.writeUInt32LE(2, 0x32);
  globalHeader.writeUInt32LE(indexOffset, 0x36);

  const material = passwordMaterial(password);
  const index = Buffer.alloc(indexSize);
  const blocks = [];
  for (let logicalIndex = 0; logicalIndex < NONEMPTY_COUNT; logicalIndex++) {
    index.writeUInt32LE(firstBlockOffset + logicalIndex * blockSize, logicalIndex * 4);
    const header = Buffer.alloc(16);
    header[0] = 7;
    header[3] = 1;
    header.writeUInt16LE(malformedIndices.has(logicalIndex) ? 0 : 1, 4);
    header.writeUInt16LE(1, 6);
    for (let byte = 0; byte < 16; byte++) header[byte] ^= material.imageHeaderKey[byte];
    blocks.push(header, Buffer.from([0x10, 0x20, 0x30, 0xff]));
  }

  const encryptedGlobal = encryptFeedback(globalHeader, FIXED_KEY, createSeed(FIXED_KEY));
  const encryptedIndex = encryptFeedback(index, material.key, material.seed);
  fs.writeFileSync(filePath, Buffer.concat([SIGNATURE, encryptedGlobal, encryptedIndex, ...blocks]));
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-gom-tolerance-'));
  const password = 'fixture password ';
  try {
    const toleratedPath = path.join(tempRoot, 'one-malformed.pak');
    buildFixture(toleratedPath, password, new Set([1260]));
    const parsed = parseGomFile(toleratedPath, password, parser);
    assert.equal(parsed.slotCount, SLOT_COUNT);
    assert.equal(parsed.blocks.length, NONEMPTY_COUNT - 1);
    assert.deepEqual(parsed.skippedMalformedIndices, [1260]);
    assert.equal(parsed.blocks.some(block => block.logicalIndex === 1260), false);
    assert.equal(parsed.blocks.some(block => block.logicalIndex === 1261), true);
    const indexed = await openArchiveIndexed({
      extensionPath: path.resolve(__dirname, '..'),
      indexRoot: path.join(tempRoot, 'index'),
      pakPath: toleratedPath,
      password,
      willIdx: 0,
      forceRefresh: true,
    });
    assert.equal(indexed.skippedMalformedCount, 1);
    assert.equal(indexed.assets.length, SLOT_COUNT);
    assert.equal(indexed.assets[1260].isBlank, true, 'the malformed logical slot must remain a blank placeholder');
    assert.equal(indexed.assets[1261].isBlank, false, 'later logical slots must retain their original numbering');
    assert.throws(
      () => parseGomFile(toleratedPath, password.trim(), parser),
      /密码错误|索引损坏/,
      'password bytes must not be trimmed by the archive parser'
    );

    const rejectedPath = path.join(tempRoot, 'two-malformed.pak');
    buildFixture(rejectedPath, password, new Set([1260, 1261]));
    assert.throws(
      () => parseGomFile(rejectedPath, password, parser),
      /2 个异常图片块/,
      'the tolerance must reject more than one malformed block for this fixture size'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('gom-reader-tolerance.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
