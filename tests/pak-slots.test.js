const assert = require('node:assert/strict');

function main() {
  const { enumeratePakSlots } = require('../out/utils/pak-reader');
  const first = { logicalIndex: 0, name: 'first' };
  const third = { logicalIndex: 2, name: 'third' };
  const slots = enumeratePakSlots([third, first], 5);

  assert.equal(slots.length, 5, 'every logical PAK slot must be retained');
  assert.equal(slots[0], first);
  assert.equal(slots[1], undefined, 'an empty PAK slot must remain in its original position');
  assert.equal(slots[2], third);
  assert.equal(slots[3], undefined);
  assert.equal(slots[4], undefined);
  console.log('pak-slots.test.js: PASS');
}

main();
