const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${name}`);
}

function main() {
  const html = fs.readFileSync(
    path.join(__dirname, '..', 'media', 'map-preview.html'),
    'utf8'
  );
  const provider = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'providers', 'map-preview.ts'),
    'utf8'
  );
  const merchantLinks = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'providers', 'merchant-map-link.ts'),
    'utf8'
  );
  const extension = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');

  for (const label of ['标识编辑器', '地图名字', '坐标 X', '坐标 Y', '显示文字', '文字颜色', '标识所在']) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /function reset100\(\)/);
  assert.doesNotMatch(html, /function fit\(/);
  assert.match(
    html,
    /\.npc-map-name\{[^}]*transform:translate\(-50%,-50%\);pointer-events:none/,
    'NPC name centers must be aligned independently from the sprite frame'
  );
  assert.match(
    html,
    /const sx=state\.offsetX\+\(npc\.x\*48\+24\)\*state\.scale;[\s\S]*const sy=state\.offsetY\+\(npc\.y\*32-11\)\*state\.scale;/,
    'NPC name centers must use the game-calibrated 48x32 anchor and scaled pixel offset'
  );
  assert.match(
    html,
    /fontSize=\(12\*fontScale\)\+'px'[\s\S]*lineHeight=\(16\*fontScale\)\+'px'/,
    'NPC SimSun 12px labels must scale with the original map'
  );
  assert.match(
    html,
    /function applyNpcFrame\(node,image,frame\)[\s\S]*frameOffsetX[\s\S]*frameOffsetY[\s\S]*layoutEntityNode\(node\)/,
    'custom NPC animation frames must carry their cached image offsets into layout'
  );
  assert.match(
    html,
    /classList\.contains\('offset-positioned'\)[\s\S]*frameOffsetX[\s\S]*state\.scale[\s\S]*frameOffsetY[\s\S]*state\.scale/,
    'custom NPC offsets must be applied from the logical map anchor at the active zoom'
  );
  assert.match(html, /type:'updateMarker'/);
  assert.match(html, /\+ 增加地图标识/);
  assert.match(html, /id="addLargeMap" type="checkbox" checked/);
  assert.match(html, /id="addSmallMap" type="checkbox"/);
  assert.match(html, /id="addX"[^>]*value="0"/);
  assert.match(html, /id="addY"[^>]*value="0"/);
  assert.match(html, /id="addText"[^>]*value="标识文字"/);
  assert.match(html, /id="addColor"[^>]*value="\$FFFF00"/);
  assert.match(html, /type:'addMarkers'/);
  assert.match(html, />确认添加</);
  assert.match(html, /function closeAddMarkerForm\(\)/);
  assert.match(html, /const preferred=added\.find\(marker=>marker\.mode===0\)\|\|added\[0\]/);
  assert.match(html, /selectMarkerMode\(preferred\.mode\)[\s\S]*selectMarker\(preferred\)/);
  assert.match(html, /setSaveState\('新增标识已保存','saved'\)/);
  assert.match(html, /function beginMarkerDrag\(event,marker\)/);
  assert.match(html, /function mapPointFromClient\(clientX,clientY,requireInside\)/);
  assert.doesNotMatch(html, /if\(wasDragging&&!wasPanning&&state\.selectedLine\)/);
  assert.match(html, /if\(state\.markerDragMoved\)[\s\S]*setMarkerCoordinates\(marker,point\)/);
  assert.match(html, /if\(changed\)saveMarkerCoordinates\(marker\)/);
  assert.match(html, /\.marker\.dragging/);
  assert.match(html, /id="deleteMarker"[^>]*>删除标识</);
  assert.match(html, /type:'deleteMarker'/);
  assert.match(html, /function nudgeSelectedMarker\(deltaX,deltaY\)/);
  assert.match(html, /ArrowLeft:\[-1,0\][\s\S]*ArrowDown:\[0,1\]/);
  assert.match(html, /if\(state\.original\.active\)nudgeSelectedEntity/);
  assert.match(html, /Number\.isInteger\(x\)[\s\S]*Number\.isInteger\(y\)/);
  assert.match(html, /id="entities"/);
  assert.match(html, /id="npcJumpBar"[\s\S]*id="npcJumpList"/);
  assert.match(html, /id="mapNavigator"[\s\S]*id="mapNavigatorCanvas"[\s\S]*id="mapNavigatorOverlay"/);
  assert.match(html, /\.map-navigator\.expanded\{[^}]*width:clamp\(300px,38%,360px\)[^}]*max-width:calc\(100% - 24px\)/);
  assert.match(html, /function focusNpcAt100\(npc\)[\s\S]*centerWorldPoint\(npc\.x\*48\+24,npc\.y\*32,1\)/);
  assert.match(html, /renderMapNavigatorViewport[\s\S]*strokeStyle='#fff'/);
  assert.match(html, /pointerdown[\s\S]*navigateFromMapNavigator/);
  assert.match(html, /data\.type==='revealMerchantNpc'[\s\S]*revealMerchantNpc\(data\.npc\)/);
  assert.match(html, /NPC 编辑器/);
  assert.match(html, /刷怪编辑器/);
  assert.match(html, /id="showSpawnRange"/);
  assert.match(html, /type:'updateNpc'/);
  assert.match(html, /type:'updateSpawn'/);
  assert.match(html, /type:'openNpcScript'/);
  assert.match(html, /modeTabs[^\n]*classList\.toggle\('hidden',state\.original\.active\)/);
  assert.match(html, /markerLayer\.style\.display=state\.original\.active\?'none':'block'/);
  assert.match(provider, /updateMapMarkerLine/);
  assert.match(provider, /appendMapMarkerLines/);
  assert.match(provider, /deleteMapMarkerLine/);
  assert.match(provider, /type: 'markerDeleted'/);
  assert.match(provider, /encodeTextFile\(updated\.text, decoded\.encoding\)/);
  assert.match(provider, /parseMerchantText[\s\S]*parseMonGenText/);
  assert.match(provider, /updateMerchantCoordinates/);
  assert.match(provider, /updateMonGenFields/);
  assert.match(provider, /resolveMerchantScriptPath/);
  assert.match(provider, /async revealMerchantNpc\([\s\S]*mapEntityMatches\(npc\.mapName, entry\)[\s\S]*type: 'revealMerchantNpc'/);
  assert.match(provider, /revealNpc,[\s\S]*markerFile:/);
  assert.match(merchantLinks, /displayNameColumn = parsed\?\.columns\[4\]/);
  assert.match(merchantLinks, /command:\$\{OPEN_MERCHANT_NPC_COMMAND\}/);
  assert.match(merchantLinks, /Ctrl\+左键：在原始地图定位此 NPC/);
  assert.doesNotMatch(merchantLinks, /registerAltClick|TextEditorSelectionChangeKind\.Mouse/);
  assert.match(extension, /registerDocumentLinkProvider[\s\S]*merchantMapLinkProvider/);
  assert.doesNotMatch(extension, /merchantMapLinkProvider\.registerAltClick\(\)/);
  assert.match(extension, /registerCommand\([\s\S]*'boo\.openMerchantNpcOnMap'/);
  assert.match(provider, /MerchantNameColor|parseMerchantNameColor/);
  assert.match(provider, /resolveOfficialNpcAnimationPlan/);
  assert.match(provider, /selectOfficialNpcArchiveFile/);
  assert.doesNotMatch(provider, /resources[\s\S]*npc-looks[\s\S]*\.webp/);
  assert.match(
    provider,
    /assetTable!?\.width\[imageIndex\][\s\S]*assetTable!?\.height\[imageIndex\][\s\S]*assetTable!?\.offsetX\[imageIndex\][\s\S]*assetTable!?\.offsetY\[imageIndex\]/,
    'custom NPC frames must include cached dimensions and offsets'
  );

  const context = {
    state: { original: { active: true }, offsetX: 100, offsetY: 200, scale: 0.5 },
    viewport: { clientWidth: 1920, clientHeight: 1080 },
    entityBy: () => ({ x: 10, y: 20 }),
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(html, 'layoutEntityNode'), context);
  vm.runInContext(extractFunction(html, 'layoutNpcName'), context);
  vm.runInContext(extractFunction(html, 'clampViewOffset'), context);
  vm.runInContext(extractFunction(html, 'centerWorldPoint'), context);
  const spriteStyle = { setProperty() {} };
  context.layoutEntityNode({
    dataset: { entityType: 'npc', line: '3', frameOffsetX: '-1', frameOffsetY: '-52' },
    classList: { contains: value => value === 'offset-positioned' },
    style: spriteStyle,
  });
  assert.equal(spriteStyle.left, '339.5px');
  assert.equal(spriteStyle.top, '494px');
  const nameStyle = {};
  context.layoutNpcName({ dataset: { line: '3' }, style: nameStyle });
  assert.equal(nameStyle.left, '352px');
  assert.equal(nameStyle.top, '514.5px', 'the game-calibrated NPC name offset must scale with the map');
  assert.equal(nameStyle.fontSize, '6px');
  assert.equal(nameStyle.lineHeight, '8px');
  assert.equal(parseFloat(nameStyle.left) - parseFloat(spriteStyle.left), 25 * 0.5);
  assert.equal(parseFloat(nameStyle.top) - parseFloat(spriteStyle.top), 41 * 0.5);

  context.state.offsetX = 0;
  context.state.offsetY = 0;
  context.state.scale = 1;
  const merchantRows = new Map([
    [1, { x: 116, y: 180 }],
    [2, { x: 138, y: 185 }],
  ]);
  context.entityBy = (_type, line) => merchantRows.get(line);
  const firstName = { dataset: { line: '1' }, style: {} };
  const secondName = { dataset: { line: '2' }, style: {} };
  context.layoutNpcName(firstName);
  context.layoutNpcName(secondName);
  assert.equal(parseFloat(secondName.style.left) - parseFloat(firstName.style.left), 22 * 48);
  assert.equal(parseFloat(secondName.style.top) - parseFloat(firstName.style.top), 5 * 32);
  assert.equal(firstName.style.fontSize, '12px');

  context.render = () => {};
  context.state.worldW = 4800;
  context.state.worldH = 3200;
  context.viewport.clientWidth = 1000;
  context.viewport.clientHeight = 700;
  context.centerWorldPoint(2424, 1600, 1);
  assert.equal(context.state.scale, 1, 'NPC quick navigation must restore 100 percent zoom');
  assert.equal(context.state.offsetX, -1924);
  assert.equal(context.state.offsetY, -1250);

  console.log('map-preview-editor.test.js: PASS');
}

main();
