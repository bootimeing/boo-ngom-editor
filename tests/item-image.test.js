const assert = require('node:assert/strict');

function main() {
  const {
    findItemLooksValue,
    resolveItemImageReference,
    resolveItemImageReferenceForSource,
    resolveStdItemImageReference,
    resolveStateItemImageReference,
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
  assert.deepEqual(resolveStateItemImageReference(344), {
    looks: 344,
    pakName: 'StateItem',
    imageIndex: 344,
  });
  assert.deepEqual(resolveStateItemImageReference(10005), {
    looks: 10005,
    pakName: 'StateItem1',
    imageIndex: 5,
  });
  assert.deepEqual(resolveStateItemImageReference(20006), {
    looks: 20006,
    pakName: 'StateItem2',
    imageIndex: 6,
  });
  assert.equal(resolveStateItemImageReference(100000), undefined);
  assert.deepEqual(resolveStdItemImageReference(344), {
    looks: 344,
    pakName: 'StdItem',
    imageIndex: 344,
  });
  assert.deepEqual(resolveStdItemImageReference(10005), {
    looks: 10005,
    pakName: 'StdItem1',
    imageIndex: 5,
  });
  assert.deepEqual(resolveStdItemImageReference(20006), {
    looks: 20006,
    pakName: 'StdItem2',
    imageIndex: 6,
  });
  assert.equal(resolveStdItemImageReference(100000), undefined);
  assert.deepEqual(resolveItemImageReferenceForSource(10005, 'std-item', false), {
    looks: 10005,
    pakName: 'StdItem1',
    imageIndex: 5,
  });
  assert.deepEqual(resolveItemImageReferenceForSource(10005, undefined, false), {
    looks: 10005,
    pakName: 'Items1',
    imageIndex: 5,
  });
  assert.equal(resolveItemImageReferenceForSource(10005, undefined, true), undefined,
    'a dynamic GOM source switch must not be hydrated as a definite Items image');
  console.log('item-image.test.js: PASS');
}

main();
