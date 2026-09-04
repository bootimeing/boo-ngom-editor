const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const {
  collectOriginalMapViewport,
  originalMapAnimationFrameCount,
  originalMapAnimationFrameReferences,
  originalMapAnimationSequenceKey,
  parseOriginalMap,
} = require('../out/utils/original-map');
const {
  listArchiveIndexSummaries,
  loadArchiveAssetTable,
  readArchiveImagePng,
} = require('../out/utils/archive-index');
const {
  loadCachedPatchAssetTable,
  patchImagePath,
} = require('../out/utils/patch-cache');

const port = Number(process.env.BOO_TEST_PORT || 18767);
const workspaceRoot = process.env.BOO_TEST_MIRSERVER || 'D:\\MirServer新GOM';
const mapId = process.env.BOO_TEST_MAP_ID || '0103';
const mapPath = process.env.BOO_TEST_MAP_PATH
  ? path.resolve(process.env.BOO_TEST_MAP_PATH)
  : path.join(workspaceRoot, 'Mir200', 'Map', `${mapId}.map`);
const viewerPath = path.join(__dirname, '..', 'media', 'map-preview.html');
const sidebarDetailPath = path.join(__dirname, '..', 'media', 'sidebar-detail.html');
const cacheRoot = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
  'BOO-NGOM-Editor',
  'cache',
  'patch-cache'
);
const archiveIndexRoot = process.env.BOO_TEST_ARCHIVE_INDEX_ROOT || path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
  'BOO-NGOM-Editor',
  'cache',
  'archive-index-v1'
);
const clientRoot = process.env.BOO_TEST_CLIENT_ROOT
  ? path.resolve(process.env.BOO_TEST_CLIENT_ROOT)
  : '';

function normalizeArchiveName(value) {
  return path.basename(String(value || ''), path.extname(String(value || ''))).toLowerCase();
}

function readCachedPaks() {
  const results = new Map();
  if (!fs.existsSync(cacheRoot)) return results;
  for (const directory of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const manifestPath = path.join(cacheRoot, directory.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const stored = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const pak = {
        manifestPath,
        cacheDir: path.dirname(manifestPath),
        pakPath: path.resolve(stored.pakPath),
        pakName: stored.pakName,
        format: stored.format,
        storedWillIdx: Number(stored.willIdx) || 0,
        slotCount: Number(stored.slotCount) || 0,
        cachedAt: fs.statSync(manifestPath).mtimeMs,
      };
      const key = normalizeArchiveName(pak.pakName);
      const existing = results.get(key);
      if (!existing || pak.cachedAt > existing.cachedAt) results.set(key, pak);
    } catch {
      // Ignore unrelated or incomplete cache entries in the visual harness.
    }
  }
  return results;
}

function isPathInside(filePath, rootPath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(filePath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function readIndexedArchives() {
  const results = new Map();
  if (!fs.existsSync(archiveIndexRoot)) return results;
  const summaries = listArchiveIndexSummaries(archiveIndexRoot)
    .filter(summary => !clientRoot || isPathInside(summary.pakPath, clientRoot))
    .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
  for (const summary of summaries) {
    if (!fs.existsSync(summary.pakPath)) continue;
    results.set(normalizeArchiveName(summary.pakName), summary);
  }
  return results;
}

function json(response, value) {
  response.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(value));
}

function fail(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}

function bridgeScript(model) {
  const originalGeneration = 1;
  const mapData = {
    type: 'mapData',
    map: {
      mapId,
      originalMapId: mapId,
      name: `${mapId} 原始地图实测`,
      width: model.width,
      height: model.height,
    },
    maps: [{
      key: mapId,
      mapId,
      originalMapId: mapId,
      name: `${mapId} 原始地图实测`,
    }, {
      key: 'target-map',
      mapId: 'TARGET01',
      originalMapId: 'TARGET01',
      name: '跨地图切换测试',
    }],
    imageUrl: '',
    markers: [{
      lineNumber: 1,
      mapName: `${mapId} 原始地图实测`,
      x: Math.floor(model.width / 2),
      y: Math.floor(model.height / 2),
      text: '中心标识',
      displayText: '中心标识',
      colorSource: '$FFFF00',
      color: '#00FFFF',
      mode: 0,
    }],
    npcs: [{
      lineNumber: 1,
      fields: ['测试NPC', mapId, String(Math.floor(model.width / 2) - 2), String(Math.floor(model.height / 2)), '测试传送员', '0', '0'],
      scriptRef: '测试NPC',
      mapName: mapId,
      x: Math.floor(model.width / 2) - 2,
      y: Math.floor(model.height / 2),
      displayName: '测试传送员',
      direction: 0,
      appearance: 0,
      nameColor: '#DEA500',
      frames: ['/npc-look/0.webp'],
      frameInterval: 0,
      appearanceLabel: '官方外观 0',
      scriptAvailable: true,
    }, {
      lineNumber: 3,
      fields: ['偏移测试NPC', mapId, String(Math.floor(model.width / 2) - 4), String(Math.floor(model.height / 2)), '偏移测试NPC', '0', '10001'],
      scriptRef: '偏移测试NPC',
      mapName: mapId,
      x: Math.floor(model.width / 2) - 4,
      y: Math.floor(model.height / 2),
      displayName: '偏移测试NPC',
      direction: 4,
      appearance: 10001,
      nameColor: '#DEA500',
      frames: [{
        url: '/npc-look/273.webp',
        width: 96,
        height: 120,
        offsetX: -37,
        offsetY: -91,
        usesOffsets: true,
      }],
      frameInterval: 150,
      appearanceLabel: '自定义外观偏移实测',
      scriptAvailable: true,
    }],
    spawns: [{
      lineNumber: 2,
      fields: [mapId, String(Math.floor(model.width / 2) + 2), String(Math.floor(model.height / 2)), '测试怪物', '4', '10', '30'],
      mapName: mapId,
      x: Math.floor(model.width / 2) + 2,
      y: Math.floor(model.height / 2),
      monsterName: '测试怪物',
      range: 4,
    }],
    safeZones: [{
      lineNumber: 1,
      mapName: mapId,
      shape: 'area',
      x: Math.floor(model.width / 2),
      y: Math.floor(model.height / 2),
      silence: 0,
      range: 3,
      haloType: 4,
      pkZone: 0,
      pkFire: 0,
      styleLabel: '困魔光效果',
      customResource: false,
      transparentDraw: false,
      frames: [],
      frameInterval: 0,
      resourceLabel: '困魔光效果',
    }],
    merchantColumns: ['脚本路径', '地图编号', 'X', 'Y', 'NPC显示名字', 'NPC朝向', 'NPC外观编号'],
    monGenColumns: ['地图', '坐标X', '坐标Y', '怪物名字', '范围', '数量', '时间间隔'],
    engine: 'GOM',
    entityWarnings: [],
    markerFile: 'MapDesc1.txt',
    warning: '',
  };
  return `<script>
window.__booMessages=[];
window.acquireVsCodeApi=function(){return{postMessage:function(message){
  window.__booMessages.push(message);
  document.documentElement.dataset.lastMessageType=message.type;
  function send(data){window.dispatchEvent(new MessageEvent('message',{data:data}))}
  if(message.type==='ready')setTimeout(function(){send(${JSON.stringify(mapData)})},20);
  if(message.type==='loadOriginalMap'){
    var requestId=message.requestId;
    send({type:'originalMapProgress',requestId:requestId,percent:3,label:'正在定位原始 MAP'});
    setTimeout(function(){
      send({type:'originalMapProgress',requestId:requestId,percent:42,label:'正在解析地图单元'});
    },120);
    setTimeout(function(){fetch('/api/model').then(function(response){return response.json()}).then(function(data){
      send(Object.assign({
        type:'originalMapReady',requestId:requestId,generation:${originalGeneration},
        chunkCellWidth:16,chunkCellHeight:16
      },data));
    }).catch(function(error){send({
      type:'originalMapError',requestId:requestId,generation:${originalGeneration},message:String(error)
    })})},260);
  }
  if(message.type==='loadOriginalMapViewport'&&message.generation===${originalGeneration}){
    var viewport=message.viewport||{};
    var query=new URLSearchParams({
      left:String(viewport.left),top:String(viewport.top),
      right:String(viewport.right),bottom:String(viewport.bottom)
    });
    fetch('/api/map?'+query.toString()).then(function(response){return response.json()}).then(function(data){
      send(Object.assign({
        type:'originalMapViewportData',requestId:message.requestId,
        generation:${originalGeneration},viewportSeq:message.viewportSeq,
        viewport:viewport,prefetch:message.prefetch===true
      },data));
    }).catch(function(error){send({
      type:'originalMapError',requestId:message.requestId,
      generation:${originalGeneration},viewportSeq:message.viewportSeq,message:String(error)
    })});
  }
  if(message.type==='updateNpc')send({type:'npcSaved',requestId:message.requestId,npc:message.npc});
  if(message.type==='updateSpawn')send({type:'spawnSaved',requestId:message.requestId,spawn:message.spawn});
}}};
</script>`;
}

function sidebarDetailBridgeScript() {
  const detail = {
    detailKind: 'monster',
    name: '怪物合成预览测试',
    fields: { Race: 81, Appr: 1120, Level: 80 },
    columnLabels: { Race: '种族', Appr: '外观', Level: '等级' },
    monsterBody: {
      source: 'archive',
      pakName: 'Mon113',
      imageIndex: 40,
      label: 'Mon113.pak / 000040',
      url: '/npc-look/0.webp',
      width: 438,
      height: 259,
      offsetX: -155,
      offsetY: -186,
    },
    monsterIcons: [{
      wilIndex: 7,
      imageIndex: 110,
      frameCount: 16,
      x: 73,
      y: 90,
      effect: 0,
      speedMs: 100,
      playCount: 0,
      layer: 0,
      frames: Array.from({ length: 16 }, (_, index) => `/asset/${encodeURIComponent('顶戴')}/${110 + index}`),
      frameAssets: Array.from({ length: 16 }, (_, index) => ({
        url: `/asset/${encodeURIComponent('顶戴')}/${110 + index}`,
        width: 200,
        height: 100,
        offsetX: -72,
        offsetY: -136,
      })),
    }],
    dropRateText: '测试物品 1/10',
    dropRateFileName: 'MonItems\\怪物合成预览测试.txt',
    iconText: '7 110 16 73 90 0 100',
    iconFileName: 'MonIcons\\怪物合成预览测试.txt',
  };
  return `<script>window.acquireVsCodeApi=function(){return{postMessage:function(){},getState:function(){return ${JSON.stringify(detail)}},setState:function(){}}};</script>`;
}

async function main() {
  if (!fs.existsSync(mapPath)) throw new Error(`测试 MAP 不存在: ${mapPath}`);
  const model = await parseOriginalMap(fs.readFileSync(mapPath));
  const cachedPaks = readCachedPaks();
  const indexedArchives = readIndexedArchives();
  const indexedArchivesById = new Map(
    [...indexedArchives.values()].map(summary => [summary.archiveId, summary])
  );
  const assetTables = new Map();
  const indexedAssetTables = new Map();
  const viewerHtml = fs.readFileSync(viewerPath, 'utf8');

  function assetTable(pak) {
    const cached = assetTables.get(pak.manifestPath);
    if (cached) return cached;
    const table = loadCachedPatchAssetTable(pak);
    assetTables.set(pak.manifestPath, table);
    return table;
  }

  function indexedAssetTable(summary) {
    const cached = indexedAssetTables.get(summary.archiveId);
    if (cached) return cached;
    const table = loadArchiveAssetTable(archiveIndexRoot, summary.archiveId);
    indexedAssetTables.set(summary.archiveId, table);
    return table;
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/') {
      const html = viewerHtml.replace('<script>', bridgeScript(model) + '<script>');
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(html);
      return;
    }
    if (url.pathname === '/monster-detail') {
      const detailHtml = fs.readFileSync(sidebarDetailPath, 'utf8')
        .replace('<script>', sidebarDetailBridgeScript() + '<script>');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(detailHtml);
      return;
    }
    if (url.pathname === '/api/model') {
      json(response, {
        mapKey: mapId,
        fileName: path.basename(mapPath),
        format: model.format,
        width: model.width,
        height: model.height,
        pixelWidth: model.width * 48,
        pixelHeight: model.height * 32,
        archiveCount: model.archiveNames.length,
        referenceCount: model.referenceCount,
      });
      return;
    }
    if (url.pathname === '/api/map') {
      const requestedViewport = ['left', 'top', 'right', 'bottom'].every(
        name => url.searchParams.has(name) && Number.isFinite(Number(url.searchParams.get(name)))
      ) ? {
        left: Number(url.searchParams.get('left')),
        top: Number(url.searchParams.get('top')),
        right: Number(url.searchParams.get('right')),
        bottom: Number(url.searchParams.get('bottom')),
      } : {
        left: 0,
        top: 0,
        right: model.width - 1,
        bottom: model.height - 1,
      };
      const references = collectOriginalMapViewport(model, requestedViewport);
      const baseResourceKeys = new Set(references.map(reference => reference.resourceKey));
      const uniqueReferences = new Map();
      for (const reference of references) {
        if (!uniqueReferences.has(reference.resourceKey)) {
          uniqueReferences.set(reference.resourceKey, reference);
        }
      }
      const animationSequences = new Map();
      const skippedAnimationSequences = new Set();
      const incompleteAnimationSequences = new Set();
      const animationFrameResourceKeys = new Set();
      let extraAnimationResources = 0;
      let extraAnimationDecodedBytes = 0;
      const planAnimation = reference => {
        if (reference.layer !== 'object' || originalMapAnimationFrameCount(reference.animationFrame) <= 1) return;
        const sequenceKey = originalMapAnimationSequenceKey(reference);
        if (animationSequences.has(sequenceKey)
          || skippedAnimationSequences.has(sequenceKey)
          || incompleteAnimationSequences.has(sequenceKey)) return;
        const frameReferences = originalMapAnimationFrameReferences(reference);
        const indexed = indexedArchives.get(normalizeArchiveName(reference.archiveName));
        const pak = cachedPaks.get(normalizeArchiveName(reference.archiveName));
        if (!indexed && !pak) {
          incompleteAnimationSequences.add(sequenceKey);
          return;
        }
        const table = indexed ? indexedAssetTable(indexed) : assetTable(pak);
        const complete = frameReferences.every(frame => {
          const index = frame.imageIndex;
          if (index < 0 || index >= table.slotCount || !table.present[index]) return false;
          if (table.blank[index] || indexed) return true;
          return fs.existsSync(patchImagePath(pak, index));
        });
        if (!complete) {
          incompleteAnimationSequences.add(sequenceKey);
          return;
        }
        const extras = frameReferences.filter(frame => !uniqueReferences.has(frame.resourceKey));
        const decodedBytes = extras.reduce((total, frame) => {
          const index = frame.imageIndex;
          if (table.blank[index]) return total;
          return total + Math.max(1, table.width[index] || 1)
            * Math.max(1, table.height[index] || 1) * 4;
        }, 0);
        if (extraAnimationResources + extras.length > 4096
          || extraAnimationDecodedBytes + decodedBytes > 256 * 1024 * 1024) {
          skippedAnimationSequences.add(sequenceKey);
          return;
        }
        extraAnimationResources += extras.length;
        extraAnimationDecodedBytes += decodedBytes;
        animationSequences.set(sequenceKey, frameReferences.map(frame => frame.resourceKey));
        for (const frame of frameReferences) {
          animationFrameResourceKeys.add(frame.resourceKey);
          if (!uniqueReferences.has(frame.resourceKey)) uniqueReferences.set(frame.resourceKey, frame);
        }
      };
      for (const interior of [true, false]) {
        for (const reference of references) {
          const isInterior = reference.x > 0 && reference.y > 0
            && reference.x < model.width - 1 && reference.y < model.height - 1;
          if (isInterior === interior) planAnimation(reference);
        }
      }
      const resources = [];
      const resourceIds = new Map();
      const missingArchives = new Set();
      let missingImages = 0;
      for (const reference of uniqueReferences.values()) {
        const indexed = indexedArchives.get(normalizeArchiveName(reference.archiveName));
        const pak = cachedPaks.get(normalizeArchiveName(reference.archiveName));
        if (!indexed && !pak) {
          missingArchives.add(reference.archiveName);
          continue;
        }
        const table = indexed ? indexedAssetTable(indexed) : assetTable(pak);
        const index = reference.imageIndex;
        const missing = index < 0 || index >= table.slotCount || !table.present[index];
        const blank = !missing && Boolean(table.blank[index]);
        if (missing) {
          missingImages++;
          continue;
        }
        if (blank && !animationFrameResourceKeys.has(reference.resourceKey)) {
          continue;
        }
        const imagePath = indexed ? '' : patchImagePath(pak, index);
        if (!blank && !indexed && !fs.existsSync(imagePath)) {
          missingImages++;
          continue;
        }
        const resourceId = resources.length;
        resourceIds.set(reference.resourceKey, resourceId);
        resources.push({
          key: reference.resourceKey,
          url: blank
            ? ''
            : indexed
              ? `/archive/${indexed.archiveId}/${index}`
              : `/asset/${encodeURIComponent(normalizeArchiveName(reference.archiveName))}/${index}`,
          width: blank ? 1 : table.width[index] || 1,
          height: blank ? 1 : table.height[index] || 1,
          offsetX: blank ? 0 : table.offsetX[index] || 0,
          offsetY: blank ? 0 : table.offsetY[index] || 0,
          blank,
          animationOnly: !baseResourceKeys.has(reference.resourceKey),
        });
      }
      const layers = { tile: [], smTile: [], object: [] };
      const objectAnimationFrames = [];
      const objectAnimationTicks = [];
      const objectAnimationSetIds = [];
      const objectAnimationSets = [];
      const animationSetIdsBySequence = new Map();
      let animatedObjectCount = 0;
      for (const reference of references) {
        const resourceId = resourceIds.get(reference.resourceKey);
        if (resourceId === undefined) continue;
        layers[reference.layer].push(reference.x, reference.y, resourceId);
        if (reference.layer === 'object') {
          objectAnimationFrames.push(reference.animationFrame);
          objectAnimationTicks.push(reference.animationTick);
          let animationSetId = -1;
          if (originalMapAnimationFrameCount(reference.animationFrame) > 1) {
            const sequenceKey = originalMapAnimationSequenceKey(reference);
            const cachedSetId = animationSetIdsBySequence.get(sequenceKey);
            if (cachedSetId !== undefined) {
              animationSetId = cachedSetId;
            } else {
              const frameKeys = animationSequences.get(sequenceKey);
              const frameIds = frameKeys && frameKeys.map(key => resourceIds.get(key));
              if (frameIds && frameIds.every(id => id !== undefined)) {
                animationSetId = objectAnimationSets.length;
                objectAnimationSets.push(frameIds);
              } else if (frameKeys) {
                incompleteAnimationSequences.add(sequenceKey);
              }
              animationSetIdsBySequence.set(sequenceKey, animationSetId);
            }
          }
          objectAnimationSetIds.push(animationSetId);
          if (animationSetId >= 0) animatedObjectCount++;
        }
      }
      const warnings = [];
      if (missingArchives.size) warnings.push(`未缓存 ${[...missingArchives].join('、')}`);
      if (missingImages) warnings.push(`${missingImages} 个图片序号缺失`);
      if (incompleteAnimationSequences.size) {
        warnings.push(`${incompleteAnimationSequences.size} 组 MAP 内嵌 Objects 连续帧不完整，已按首帧显示`);
      }
      if (skippedAnimationSequences.size) {
        warnings.push(`${skippedAnimationSequences.size} 组 MAP 内嵌 Objects 连续帧超过 4096 张或 256 MiB 附加帧预算，已按首帧显示`);
      }
      json(response, {
        resources,
        tiles: layers.tile,
        smTiles: layers.smTile,
        objects: layers.object,
        objectAnimationFrames,
        objectAnimationTicks,
        objectAnimationSetIds,
        objectAnimationSets,
        animatedObjectCount,
        warning: warnings.join('；'),
      });
      return;
    }
    const archiveAssetMatch = /^\/archive\/([a-f0-9]+)\/(\d+)$/.exec(url.pathname);
    if (archiveAssetMatch) {
      const summary = indexedArchivesById.get(archiveAssetMatch[1]);
      if (!summary) {
        fail(response, 404, 'Indexed asset not found');
        return;
      }
      readArchiveImagePng({
        extensionPath: path.resolve(__dirname, '..'),
        indexRoot: archiveIndexRoot,
        archiveId: summary.archiveId,
        imageIndex: Number(archiveAssetMatch[2]),
      }).then(data => {
        response.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': data.length,
          'Cache-Control': 'public, max-age=3600',
        });
        response.end(data);
      }).catch(error => fail(response, 500, error instanceof Error ? error.message : String(error)));
      return;
    }
    const npcLookMatch = /^\/npc-look\/(\d+)\.webp$/.exec(url.pathname);
    if (npcLookMatch) {
      const imagePath = path.join(__dirname, 'fixtures', 'npc-looks', `${npcLookMatch[1]}.webp`);
      if (!fs.existsSync(imagePath)) {
        fail(response, 404, 'NPC look not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=3600' });
      fs.createReadStream(imagePath).pipe(response);
      return;
    }
    const assetMatch = /^\/asset\/([^/]+)\/(\d+)$/.exec(url.pathname);
    if (assetMatch) {
      const pak = cachedPaks.get(normalizeArchiveName(decodeURIComponent(assetMatch[1])));
      const imagePath = pak ? patchImagePath(pak, Number(assetMatch[2])) : '';
      if (!pak || !fs.existsSync(imagePath)) {
        fail(response, 404, 'Asset not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      });
      fs.createReadStream(imagePath).pipe(response);
      return;
    }
    fail(response, 404, 'Not found');
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`http://127.0.0.1:${port}/`);
    console.log(`${path.basename(mapPath)} ${model.width}x${model.height} ${model.archiveNames.join(', ')}`);
  });
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
