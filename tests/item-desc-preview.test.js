const assert = require('node:assert/strict');

function main() {
  const { resolveItemDescriptionMedia } = require('../out/utils/item-desc-preview');
  const resolved = [];
  const media = resolveItemDescriptionMedia(
    [
      '<IMG:1600:0:0:0:0:0>',
      '<PlayImg:1:610:3:100:10:10:0>',
      '<PLAYIMG:2:700:99:1:0:0:0>',
    ].join('\\'),
    (archiveIndex, imageIndex) => {
      resolved.push([archiveIndex, imageIndex]);
      return `image://${archiveIndex}/${imageIndex}`;
    },
    { maxFramesPerAnimation: 4, maxTotalAnimationFrames: 6 }
  );

  assert.equal(
    media.images['<IMG:1600:0:0:0:0:0>'],
    'image://0/1600',
    'IMG must accept the extended item-description form'
  );
  assert.deepEqual(media.animations['<PlayImg:1:610:3:100:10:10:0>'], {
    frames: ['image://1/610', 'image://1/611', 'image://1/612'],
    speedMs: 100,
  });
  assert.deepEqual(
    media.animations['<PLAYIMG:2:700:99:1:0:0:0>'].frames,
    ['image://2/700', 'image://2/701', 'image://2/702'],
    'the total frame budget must cap oversized PLAYIMG notes'
  );
  assert.equal(media.animations['<PLAYIMG:2:700:99:1:0:0:0>'].speedMs, 40);
  assert.deepEqual(resolved.slice(0, 4), [[0, 1600], [1, 610], [1, 611], [1, 612]]);

  console.log('item-desc-preview.test.js: PASS');
}

main();
