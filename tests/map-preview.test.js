const assert = require('node:assert/strict');

function main() {
  const {
    appendMapMarkerLines,
    deleteMapMarkerLine,
    markerMatchesMap,
    normalizeMarkerColor,
    parseMapInfoText,
    parseMapMarkerText,
    updateMapMarkerLine,
  } = require('../out/utils/map-preview');

  const maps = parseMapInfoText([
    '; comment',
    '[东胜神洲|new_n3 东胜神洲] DAY',
    '[妖塔8层 玲珑七宝塔首层] DARK',
    '[东胜神洲|new_n3 东胜神洲] duplicate',
  ].join('\n'));

  assert.equal(maps.length, 2);
  assert.deepEqual(
    {
      mapId: maps[0].mapId,
      originalMapId: maps[0].originalMapId,
      name: maps[0].name,
      parameters: maps[0].parameters,
    },
    {
      mapId: '东胜神洲',
      originalMapId: 'new_n3',
      name: '东胜神洲',
      parameters: 'DAY',
    }
  );
  assert.equal(maps[1].mapId, '妖塔8层');
  assert.equal(maps[1].originalMapId, '妖塔8层');
  assert.equal(maps[1].name, '玲珑七宝塔首层');

  const markers = parseMapMarkerText([
    '$00FF00,$FFFF00,$0080FF,$FF8080,$FF00FF,$0000FF',
    '#安全区,,,,,',
    '东胜神洲,119,92,安全区,$00FF00,0',
    'new_n3,95,82,"传送,入口",$0000FF,1',
    '妖塔8层,10,11,姜子牙\\<渭水>,$FFFF00,0',
    ',,,,',
  ].join('\n'));

  assert.equal(markers.length, 3);
  assert.equal(markers[0].color, '#00FF00');
  assert.equal(markers[1].displayText, '传送,入口');
  assert.equal(markers[2].displayText, '姜子牙<渭水>');
  assert.equal(markerMatchesMap(markers[0], maps[0]), true);
  assert.equal(markerMatchesMap(markers[1], maps[0]), true);
  assert.equal(markerMatchesMap(markers[2], maps[1]), true);

  assert.equal(normalizeMarkerColor('$0000FF'), '#FF0000');
  assert.equal(normalizeMarkerColor('$FFFF00'), '#00FFFF');
  assert.equal(normalizeMarkerColor('#123456'), '#123456');
  assert.equal(normalizeMarkerColor('255'), '#FFFFFF');

  const original = [
    '#安全区,,,,,',
    '东胜神洲,119,92,安全区,$00FF00,0',
    'new_n3,95,82,"传送,入口",$0000FF,1',
  ].join('\r\n');
  const updated = updateMapMarkerLine(original, 3, {
    mapName: '东胜神洲',
    x: 120,
    y: 83,
    text: '传送,"新入口"',
    colorSource: '$FF0000',
    mode: 0,
  });
  assert.equal(
    updated.text,
    '#安全区,,,,,\r\n东胜神洲,119,92,安全区,$00FF00,0\r\n东胜神洲,120,83,"传送,""新入口""",$FF0000,0'
  );
  assert.equal(updated.marker.lineNumber, 3);
  assert.equal(updated.marker.displayText, '传送,"新入口"');
  assert.equal(updated.marker.color, '#0000FF');

  const appended = appendMapMarkerLines(original, [
    {
      mapName: '东胜神洲',
      x: 0,
      y: 0,
      text: '标识文字',
      colorSource: '$FFFF00',
      mode: 0,
    },
    {
      mapName: '东胜神洲',
      x: 0,
      y: 0,
      text: '标识文字',
      colorSource: '$FFFF00',
      mode: 1,
    },
  ]);
  assert.equal(appended.markers.length, 2);
  assert.equal(appended.markers[0].lineNumber, 4);
  assert.equal(appended.markers[1].lineNumber, 5);
  assert.equal(appended.markers[0].color, '#00FFFF');
  assert.equal(
    appended.text,
    original + '\r\n东胜神洲,0,0,标识文字,$FFFF00,0\r\n东胜神洲,0,0,标识文字,$FFFF00,1'
  );

  const trailing = appendMapMarkerLines('东胜神洲,1,2,旧标识,$00FF00,0\r\n', [{
    mapName: '东胜神洲',
    x: 0,
    y: 0,
    text: '标识文字',
    colorSource: '$FFFF00',
    mode: 1,
  }]);
  assert.equal(trailing.markers[0].lineNumber, 2);
  assert.equal(
    trailing.text,
    '东胜神洲,1,2,旧标识,$00FF00,0\r\n东胜神洲,0,0,标识文字,$FFFF00,1\r\n'
  );

  const deletedMiddle = deleteMapMarkerLine(original, 2);
  assert.equal(deletedMiddle.marker.displayText, '安全区');
  assert.equal(
    deletedMiddle.text,
    '#安全区,,,,,\r\nnew_n3,95,82,"传送,入口",$0000FF,1'
  );
  const deletedLast = deleteMapMarkerLine(deletedMiddle.text, 2);
  assert.equal(deletedLast.text, '#安全区,,,,,');

  console.log('map-preview.test.js: PASS');
}

main();
