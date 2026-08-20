const assert = require('node:assert/strict');

function main() {
  const {
    findItemLooksValue,
    resolveItemImageReference,
  } = require('../out/utils/item-image');

  assert.deepEqual(resolveItemImageReference(9999), {
    looks: 9999,
    pakName: 'Items',
    imageIndex: 9999,
  });
  assert.deepEqual(resolveItemImageReference(10000), {
    looks: 10000,
    pakName: 'Items1',
    imageIndex: 0,
  });
  assert.deepEqual(resolveItemImageReference(10001), {
    looks: 10001,
    pakName: 'Items1',
    imageIndex: 1,
  });
  assert.deepEqual(resolveItemImageReference(20030), {
    looks: 20030,
    pakName: 'Items2',
    imageIndex: 30,
  });
  assert.deepEqual(resolveItemImageReference(20073), {
    looks: 20073,
    pakName: 'Items2',
    imageIndex: 73,
  });
  assert.deepEqual(resolveItemImageReference(99999), {
    looks: 99999,
    pakName: 'Items9',
    imageIndex: 9999,
  });
  for (let pakNumber = 0; pakNumber <= 9; pakNumber++) {
    const looks = pakNumber * 10000 + 73;
    assert.deepEqual(resolveItemImageReference(looks), {
      looks,
      pakName: pakNumber === 0 ? 'Items' : `Items${pakNumber}`,
      imageIndex: 73,
    });
  }
  assert.equal(resolveItemImageReference(100000), undefined);
  assert.equal(resolveItemImageReference(''), undefined);
  assert.equal(resolveItemImageReference('   '), undefined);
  assert.equal(resolveItemImageReference(null), undefined);
  assert.equal(findItemLooksValue({ Name: '测试', LOOKS: 10001 }), 10001);
  assert.equal(resolveItemImageReference('invalid'), undefined);
  console.log('item-image.test.js: PASS');
}

main();
