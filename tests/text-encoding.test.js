const assert = require('node:assert/strict');
const iconv = require('iconv-lite');

function main() {
  const { decodeTextFile, encodeTextFile } = require('../out/utils/text');
  const source = '西岐,119,92,安全区,$00FF00,0\r\n';

  const gbk = iconv.encode(source, 'gbk');
  const decodedGbk = decodeTextFile(gbk);
  assert.equal(decodedGbk.encoding, 'gbk');
  assert.equal(decodedGbk.text, source);
  assert.deepEqual(encodeTextFile(decodedGbk.text, decodedGbk.encoding), Buffer.from(gbk));

  const utf8Bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(source)]);
  const decodedUtf8Bom = decodeTextFile(utf8Bom);
  assert.equal(decodedUtf8Bom.encoding, 'utf8-bom');
  assert.equal(decodedUtf8Bom.text, source);
  assert.deepEqual(encodeTextFile(decodedUtf8Bom.text, decodedUtf8Bom.encoding), utf8Bom);

  console.log('text-encoding.test.js: PASS');
}

main();
