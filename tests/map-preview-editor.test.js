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
    /\.npc-map-name\{[^}]*transform:translate\(-50%,calc\(-100% \+ var\(--npc-name-half-line,8px\)\)\)[^}]*white-space:pre[^}]*pointer-events:none/,
    'multiline NPC names must keep the source first segment on the bottom calibrated line'
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
    /function applyNpcFrame\(node,image,frame\)[\s\S]*candidate\.hidden=candidate!==image[\s\S]*frameOffsetX[\s\S]*frameOffsetY[\s\S]*layoutEntityNode\(node\)/,
    'custom NPC animation frames must carry their cached image offsets into layout'
  );
  assert.match(
    html,
    /function waitNpcFrameImage\(image\)[\s\S]*image\.decode\(\)[\s\S]*Promise\.all\(images\.map\(waitNpcFrameImage\)\)[\s\S]*ready\[frame\]\.image/,
    'NPC animation must preload and decode every frame before switching visible frame metadata'
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
  assert.match(html, /id="npcAppearance" type="number"/);
  assert.match(html, /id="npcIconText"/);
  assert.match(html, /id="npcTargetMap"[^>]*role="combobox"/);
  assert.match(html, /id="npcMapChoices"[^>]*role="listbox"/);
  assert.match(html, /id="moveNpcToMap"[^>]*>切换地图</);
  assert.match(html, /function matchingNpcMaps\(query\)/);
  assert.match(html, /type:'moveNpcToMap'/);
  assert.match(html, /data\.type==='npcMoveError'/);
  assert.match(html, /function drawSafeZones\(\)/);
  assert.match(html, /function prepareSafeZoneFrames\(\)/);
  assert.match(html, /安全区 '\+state\.safeZones\.length/);
  assert.doesNotMatch(html, /\.map-entity:hover,/);
  assert.match(html, /\.spawn-entity:hover,\.spawn-entity\.selected/);
  assert.match(html, /function applyNpcIconFrame\(node,image,frame,icon\)/);
  assert.match(html, /assetOffsetX\+\(Number\(icon\.x\)\|\|0\)\+24-Math\.floor\(width\/2\)/);
  assert.match(html, /assetOffsetY\+\(Number\(icon\.y\)\|\|0\)\+21-height/);
  assert.match(html, /if\(event&&event\.target===npcEditor\.iconText\)npc\.iconDirty=true/);
  assert.match(html, /if\(entity\.iconDirty===true\)npc\.iconText=entity\.iconText\|\|''/);
  assert.match(html, /data\.type==='npcSaved'&&data\.npc[\s\S]*state\.npcs\[index\]=data\.npc;rebuildEntities\(\);updateNpcJumpBar\(\)/);
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
  assert.match(provider, /updateMerchantNpc/);
  assert.match(provider, /parseStartPointText/);
  assert.match(provider, /private enqueueNpcMove\(message: MapPreviewMessage\)/);
  assert.match(provider, /targetMap\.mapId/);
  assert.match(provider, /pendingNpcReveal = \{/);
  assert.match(provider, /private resolveSafeZoneAnimation\(/);
  assert.match(provider, /\(haloType - 20\) \* 10/);
  assert.match(provider, /SafePointEffect 未缓存/);
  assert.match(provider, /loadNpcIconDetail/);
  assert.match(provider, /saveNpcIconText/);
  assert.match(provider, /resolveNpcIconPreviews/);
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
  assert.match(
    provider,
    /objectAnimationFrames\.push\(animationControlSupported \? reference\.animationFrame : 0\)/,
    'verified original-map object payloads must preserve the MAP animation/blend byte per placement'
  );
  assert.match(
    provider,
    /objectAnimationTicks\.push\(animationControlSupported \? reference\.animationTick : 0\)/,
    'verified original-map object payloads must preserve the MAP animation tick per placement'
  );
  assert.match(
    provider,
    /blendAnchorRows: reference\.layer === 'object'[\s\S]*originalMapObjectBlendAnchorRows\([\s\S]*definition\.id,[\s\S]*session\.model\.animationProfile[\s\S]*\)/,
    'the Provider must transmit the engine/profile-gated client anchor only with object resources'
  );
  assert.match(provider, /ORIGINAL_MAP_EXTRA_ANIMATION_RESOURCE_LIMIT = 4096/);
  assert.match(provider, /ORIGINAL_MAP_EXTRA_ANIMATION_DECODED_BYTE_LIMIT = 256 \* 1024 \* 1024/);
  assert.match(
    provider,
    /originalMapAnimationProfileSupportsPlayback\([\s\S]*definition\.id,[\s\S]*session\.model\.animationProfile[\s\S]*\)/,
    'the provider must gate animation planning on the explicit engine/MAP profile capability'
  );
  assert.match(
    provider,
    /const resolveArchive = \(archiveName: string\)[\s\S]*this\.resolveOriginalArchive\([\s\S]*archiveResolutions\.set\(archiveName, resolution\)/,
    'the animation planner archive cache must delegate to the production resolver instead of recursing'
  );
  assert.match(
    provider,
    /const complete = frameReferences\.every[\s\S]*if \(!complete\)[\s\S]*const decodedBytes = extraReferences\.reduce[\s\S]*extraAnimationDecodedBytes \+ decodedBytes/,
    'animation sequences must be validated before count and decoded-memory budgets are consumed'
  );
  assert.match(provider, /objectAnimationSets\.push\(frameResourceIds\)/);
  assert.match(provider, /animationOnly: !baseResourceKeys\.has\(reference\.resourceKey\)/);
  assert.match(provider, /scanStartupPermanentMapEffects\(envirDirectory\)/);
  assert.match(
    provider,
    /loadPakIndex\(workspaceRoot\)\?\.pakList[\s\S]*selectCustomNpcArchive\([\s\S]*effect\.wilIndex/,
    'permanent MAPEFFECT WIL indexes must resolve through EffectImageList and the strict cached archive selector'
  );
  assert.match(
    provider,
    /effect\.startImage \+ frameOffset/,
    'MAPEFFECT startImage is a direct logical slot and must not be decremented'
  );
  assert.match(
    provider,
    /const complete = frameIndices\.every[\s\S]*if \(!complete\)[\s\S]*const decodedBytes = newFrameIndices\.reduce/,
    'MAPEFFECT sequences must be atomically validated before consuming the shared animation budget'
  );
  assert.match(provider, /permanentMapEffects,[\s\S]*permanentMapEffectSets,/);
  assert.match(
    provider,
    /diagnosticCounts\['noncanonical-tail'\][\s\S]*diagnosticCounts\['conditional-mapeffect'\][\s\S]*严格启动脚本预览另有/,
    'strict MAPEFFECT omissions must be disclosed instead of presenting the accepted subset as complete'
  );
  assert.match(
    provider,
    /message\?\.type === 'refresh'\)[\s\S]*this\.clearOriginalMapSession\(\);[\s\S]*this\.postCurrentMap\(\);/,
    'refresh must invalidate cached script and EffectImageList-derived original-map data'
  );
  assert.match(html, /function scheduleOriginalMapAnimation\(\)/);
  assert.match(html, /layer\.animationIntervalsMs=\[\.\.\.intervalsMs\]/);
  assert.match(html, /永久 MAPEFFECT 脚本定义/);
  const originalDrawSource = extractFunction(html, 'drawOriginalMap');
  assert.ok(
    originalDrawSource.indexOf("drawOriginalMapResource(ctx,resource,'object'")
      < originalDrawSource.indexOf('drawPermanentMapEffects(layer,elapsedMs)'),
    'permanent MAPEFFECT must draw after MAP Objects'
  );
  assert.ok(
    originalDrawSource.indexOf('drawPermanentMapEffects(layer,elapsedMs)')
      < originalDrawSource.indexOf('drawSafeZones()'),
    'safe-zone overlays must remain above permanent MAPEFFECT'
  );
  assert.match(html, /document\.addEventListener\('visibilitychange'/);
  assert.match(html, /animationTimer=setTimeout[\s\S]*renderOriginalMapAnimationFrame\(\)/);
  assert.match(
    html,
    /const currentRequest=\(\)=>data\.requestId===state\.original\.requestId[\s\S]*while\(cursor<indices\.length&&currentRequest\(\)\)[\s\S]*await record\.promise;[\s\S]*if\(!currentRequest\(\)\)return/,
    'stale background animation loads must stop before they can repopulate a newer map cache'
  );
  assert.match(html, /function releaseOriginalMapBase\(\)/);

  const drawCalls = [];
  const objectCompositeCalls = [];
  const navigatorCalls = [];
  const mapLayer = {
    resources: [
      { meta: { width: 96, height: 64, offsetX: 7, offsetY: -44 }, image: { id: 'tile', complete: true } },
      { meta: { width: 48, height: 32, offsetX: 7, offsetY: -44 }, image: { id: 'smTile', complete: true } },
      { meta: { width: 48, height: 88, offsetX: 7, offsetY: -44 }, image: { id: 'object', complete: true } },
      { meta: { width: 48, height: 90, offsetX: 9, offsetY: -40 }, image: { id: 'object-frame-2', complete: true } },
      { meta: { width: 48, height: 92, offsetX: 11, offsetY: -38 }, image: { id: 'object-frame-3', complete: true } },
    ],
    tiles: [10, 20, 0],
    smTiles: [11, 21, 1],
    objects: [12, 22, 2, 13, 23, 2],
    objectAnimationFrames: [35, 0xa3],
    objectAnimationTicks: [0, 1],
    objectAnimationSetIds: [-1, 0],
    objectAnimationSets: [[2, 3, 4]],
    objectAnimationSetReady: [true],
  };
  const placementContext = {
    state: {
      original: { active: true, layer: mapLayer },
      image: null,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      worldW: 1920,
      worldH: 1280,
    },
    viewport: { clientWidth: 1920, clientHeight: 1280 },
    ctx: {
      globalCompositeOperation: 'source-over',
      fillRect() {},
      save() {
        this.savedComposite = this.globalCompositeOperation;
      },
      restore() {
        this.globalCompositeOperation = this.savedComposite;
      },
      drawImage(image, left, top, width, height) {
        drawCalls.push([image.id, left, top, width, height]);
        objectCompositeCalls.push(this.globalCompositeOperation);
      },
    },
    drawSafeZones() {},
    mapNavigator: { hidden: false },
    mapNavigatorContext: {
      setTransform() {},
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      drawImage(image, left, top, width, height) {
        navigatorCalls.push([image.id, left, top, width, height]);
      },
    },
    ensureMapNavigatorCanvasSize: () => ({ width: 1920, height: 1280, dpr: 1 }),
    mapNavigatorGeometry: () => ({
      width: 1920,
      height: 1280,
      scale: 1,
      left: 0,
      top: 0,
      mapWidth: 1920,
      mapHeight: 1280,
    }),
    renderMapNavigatorViewport() {},
  };
  vm.createContext(placementContext);
  vm.runInContext(extractFunction(html, 'originalMapPlacement'), placementContext);
  vm.runInContext(extractFunction(html, 'originalMapResourceReady'), placementContext);
  vm.runInContext(extractFunction(html, 'originalMapObjectResource'), placementContext);
  vm.runInContext(extractFunction(html, 'originalMapObjectRowRanges'), placementContext);
  vm.runInContext(extractFunction(html, 'originalMapObjectRowPadding'), placementContext);
  vm.runInContext(extractFunction(html, 'drawOriginalMapResource'), placementContext);
  vm.runInContext(extractFunction(html, 'renderMapNavigator'), placementContext);
  const verifiedBlendPlacement = placementContext.originalMapPlacement(
    'object',
    23,
    61,
    { key: 'objects111:14954', width: 328, height: 358, offsetX: 0, offsetY: 0, blendAnchorRows: 3 },
    0x8a
  );
  assert.equal(verifiedBlendPlacement.worldX, 23 * 48);
  assert.equal(
    verifiedBlendPlacement.worldY,
    (61 + 1) * 32 - 3 * 32,
    'verified bit7 effects must use the resource-provided client anchor instead of full bitmap height'
  );
  assert.equal(
    placementContext.originalMapPlacement(
      'object',
      23,
      61,
      { key: 'objects111:14954', width: 328, height: 358, offsetX: 0, offsetY: 0, blendAnchorRows: 3 },
      0x0a
    ).worldY,
    (61 + 1) * 32 - 358,
    'the same resource without bit7 must retain ordinary bottom anchoring'
  );
  assert.equal(
    placementContext.originalMapPlacement(
      'object',
      23,
      61,
      { key: 'objects111:15840', width: 980, height: 900, offsetX: 0, offsetY: 0, blendAnchorRows: 3 },
      0x86
    ).worldY,
    verifiedBlendPlacement.worldY,
    'verified bit7 placement must stay fixed when another effect frame has a very different height'
  );
  placementContext.drawOriginalMapResource(placementContext.ctx, mapLayer.resources[0], 'tile', 10, 20, 0);
  placementContext.drawOriginalMapResource(placementContext.ctx, mapLayer.resources[1], 'smTile', 11, 21, 0);
  placementContext.drawOriginalMapResource(placementContext.ctx, mapLayer.resources[2], 'object', 12, 22, 35);
  const frameAtCounter2 = placementContext.originalMapObjectResource(
    mapLayer,
    1,
    mapLayer.resources[2],
    2
  );
  placementContext.drawOriginalMapResource(placementContext.ctx, frameAtCounter2, 'object', 13, 23, 0xa3);
  assert.deepEqual(
    drawCalls,
    [
      ['tile', 480, 640, 97, 65],
      ['smTile', 528, 672, 49, 33],
      ['object', 576, 648, 48, 88],
      ['object-frame-2', 633, 638, 48, 90],
    ],
    'animation must use the current frame metadata while preserving ordinary and blend placement paths'
  );
  assert.deepEqual(
    objectCompositeCalls,
    ['source-over', 'source-over', 'source-over', 'lighter'],
    'only bit7 MAP Objects must use the additive DrawBlend composite path'
  );
  assert.equal(
    placementContext.ctx.globalCompositeOperation,
    'source-over',
    'bit7 MAP Object drawing must restore the caller composite mode'
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map(counter => placementContext.originalMapObjectResource(
      mapLayer,
      1,
      mapLayer.resources[2],
      counter
    ).image.id),
    ['object', 'object', 'object-frame-2', 'object-frame-2', 'object-frame-3', 'object-frame-3', 'object'],
    'tick 1 must hold each frame for two 100ms global animation counts'
  );
  const rowRanges = placementContext.originalMapObjectRowRanges(mapLayer.objects);
  assert.deepEqual(
    [Array.from(rowRanges[22]), Array.from(rowRanges[23])],
    [[0, 3], [3, 6]],
    'object placements must be row indexed so animation redraws do not scan the complete map'
  );
  const rowPadding = placementContext.originalMapObjectRowPadding([
      { key: 'tiles:0', height: 4096, offsetY: -4096 },
      { key: 'objects2:1', height: 1400, offsetY: -64, blendAnchorRows: 3 },
      { key: 'objects2:2', height: 32, offsetY: 96 },
      { key: 'objects111:14954', height: 358, offsetY: 0, blendAnchorRows: 3 },
    ]);
  assert.deepEqual(
    [rowPadding.lookbehind, rowPadding.lookahead],
    [41, 47],
    'row culling must union ordinary and fixed-anchor extents when one resource can use either placement mode'
  );
  placementContext.renderMapNavigator();
  assert.deepEqual(
    navigatorCalls,
    [['tile', 480, 640, 96, 64]],
    'the original-map navigator must use the same unshifted tile placement as the main canvas'
  );

  const effectDraws = [];
  const effectContext = {
    state: { offsetX: 0, offsetY: 0, scale: 1 },
    viewport: { clientWidth: 1920, clientHeight: 1280 },
    ctx: {
      globalCompositeOperation: 'xor',
      imageSmoothingEnabled: true,
      save() {
        this.savedComposite = this.globalCompositeOperation;
      },
      restore() {
        this.globalCompositeOperation = this.savedComposite;
      },
      drawImage(image, left, top, width, height) {
        effectDraws.push([image.id, left, top, width, height, this.globalCompositeOperation]);
      },
    },
  };
  const effectResource = {
    meta: { width: 20, height: 10, offsetX: -7, offsetY: -9 },
    image: { id: 'map-effect', complete: true },
    blank: false,
    failed: false,
  };
  const effectLayer = {
    resources: [effectResource],
    permanentMapEffectSets: [[0]],
    permanentMapEffectSetReady: [true],
    permanentMapEffects: [
      { x: 3, y: 4, speedMs: 150, drawMode: 0, frameSetId: 0 },
      { x: 10, y: 10, speedMs: 150, drawMode: 1, frameSetId: 0 },
    ],
  };
  vm.createContext(effectContext);
  vm.runInContext(extractFunction(html, 'originalMapResourceReady'), effectContext);
  vm.runInContext(extractFunction(html, 'originalMapEffectResource'), effectContext);
  vm.runInContext(extractFunction(html, 'drawPermanentMapEffects'), effectContext);
  effectContext.drawPermanentMapEffects(effectLayer, 0);
  assert.deepEqual(
    effectDraws,
    [['map-effect', 137, 119, 20, 10, 'source-over']],
    'mode 0 MAPEFFECT must use x*48/y*32 plus per-frame offsets, while unverified mode 1 is skipped'
  );
  assert.equal(
    effectContext.ctx.globalCompositeOperation,
    'xor',
    'MAPEFFECT drawing must restore the caller composite mode'
  );

  const context = {
    state: { original: { active: true }, offsetX: 100, offsetY: 200, scale: 0.5 },
    viewport: { clientWidth: 1920, clientHeight: 1080 },
    entityBy: () => ({ x: 10, y: 20 }),
  };
  vm.createContext(context);
  vm.runInContext(extractFunction(html, 'layoutEntityNode'), context);
  vm.runInContext(extractFunction(html, 'layoutNpcName'), context);
  vm.runInContext(extractFunction(html, 'applyNpcFrame'), context);
  vm.runInContext(extractFunction(html, 'applyNpcIconFrame'), context);
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
  const nameStyle = { setProperty() {} };
  context.layoutNpcName({ dataset: { line: '3' }, style: nameStyle });
  assert.equal(nameStyle.left, '352px');
  assert.equal(nameStyle.top, '514.5px', 'the game-calibrated NPC name offset must scale with the map');
  assert.equal(nameStyle.fontSize, '6px');
  assert.equal(nameStyle.lineHeight, '8px');
  assert.equal(parseFloat(nameStyle.left) - parseFloat(spriteStyle.left), 25 * 0.5);
  assert.equal(parseFloat(nameStyle.top) - parseFloat(spriteStyle.top), 41 * 0.5);

  const firstImage = { hidden: false, src: 'frame-1' };
  const secondImage = { hidden: true, src: 'preloaded-frame-2' };
  const animatedStyle = { setProperty() {} };
  const animatedNode = {
    dataset: { entityType: 'npc', line: '3' },
    classList: { toggle() {}, contains: value => value === 'offset-positioned' },
    querySelectorAll: () => [firstImage, secondImage],
    style: animatedStyle,
  };
  context.applyNpcFrame(animatedNode, secondImage, {
    url: 'frame-2', width: 65, height: 81, offsetX: 7, offsetY: -51, usesOffsets: true,
  });
  assert.equal(firstImage.hidden, true);
  assert.equal(secondImage.hidden, false);
  assert.equal(secondImage.src, 'preloaded-frame-2', 'switching frames must not rewrite the preloaded image source');
  assert.equal(animatedNode.dataset.frameOffsetX, '7');
  assert.equal(animatedNode.dataset.frameOffsetY, '-51');
  assert.equal(animatedStyle.width, '65px');
  assert.equal(animatedStyle.height, '81px');

  const iconImage = { hidden: true, naturalWidth: 100, naturalHeight: 40 };
  const iconStyle = { setProperty() {} };
  const iconNode = {
    dataset: { entityType: 'npc', line: '3' },
    classList: { contains: value => value === 'offset-positioned' },
    querySelectorAll: () => [iconImage],
    style: iconStyle,
  };
  context.applyNpcIconFrame(
    iconNode,
    iconImage,
    { width: 100, height: 40, offsetX: -10, offsetY: -20, usesOffsets: true },
    { x: 5, y: -30 }
  );
  assert.equal(iconNode.dataset.frameOffsetX, '-31');
  assert.equal(iconNode.dataset.frameOffsetY, '-69');
  assert.equal(iconStyle.left, '324.5px');
  assert.equal(iconStyle.top, '485.5px');

  context.applyNpcIconFrame(
    iconNode,
    iconImage,
    {
      width: 100,
      height: 40,
      offsetX: -10,
      offsetY: -20,
      usesOffsets: true,
      placementX: 13,
      placementY: -77,
    },
    { x: 999, y: 999 }
  );
  assert.equal(iconNode.dataset.frameOffsetX, '13');
  assert.equal(iconNode.dataset.frameOffsetY, '-77');
  assert.equal(iconStyle.left, '346.5px');
  assert.equal(iconStyle.top, '481.5px');

  context.state.offsetX = 0;
  context.state.offsetY = 0;
  context.state.scale = 1;
  const merchantRows = new Map([
    [1, { x: 116, y: 180 }],
    [2, { x: 138, y: 185 }],
  ]);
  context.entityBy = (_type, line) => merchantRows.get(line);
  const firstName = { dataset: { line: '1' }, style: { setProperty() {} } };
  const secondName = { dataset: { line: '2' }, style: { setProperty() {} } };
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
