const assert = require('node:assert/strict');
const fs = require('node:fs');
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
  const editor = fs.readFileSync('media/editor.html', 'utf8');
  const database = fs.readFileSync('media/database-viewer.html', 'utf8');
  const sidebar = fs.readFileSync('media/sidebar-detail.html', 'utf8');
  const extension = fs.readFileSync('src/extension.ts', 'utf8');
  const assistant = fs.readFileSync('src/assistant.ts', 'utf8');
  const databaseDetail = fs.readFileSync('src/utils/database-detail.ts', 'utf8');
  const mapPreviewProvider = fs.readFileSync('src/providers/map-preview.ts', 'utf8');
  const sidebarBridge = fs.readFileSync('src/utils/sidebar-bridge.ts', 'utf8');
  const pakReader = fs.readFileSync('src/utils/pak-reader.ts', 'utf8');
  const patchCache = fs.readFileSync('src/utils/patch-cache.ts', 'utf8');
  const mapViewer = fs.readFileSync('media/map-viewer.html', 'utf8');
  const mapPreview = fs.readFileSync('media/map-preview.html', 'utf8');
  const packageManifest = fs.readFileSync('package.json', 'utf8');
  const engineRegistry = fs.readFileSync('src/utils/engine-registry.ts', 'utf8');
  const patchManager = fs.readFileSync('media/patch-manager.html', 'utf8');
  const reloadOptions = fs.readFileSync('src/utils/reload-options.ts', 'utf8');
  const databaseScriptMatch = database.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(databaseScriptMatch, 'database Webview script should exist');
  assert.doesNotThrow(
    () => new vm.Script(databaseScriptMatch[1], { filename: 'database-viewer.html' }),
    'database Webview script must remain valid JavaScript'
  );

  const toolsStart = extension.indexOf('const tools = [');
  const toolsEnd = extension.indexOf('];', toolsStart);
  assert.notEqual(toolsStart, -1, 'shortcut tools list should exist');
  assert.notEqual(toolsEnd, -1, 'shortcut tools list should be closed');
  const toolsBlock = extension.slice(toolsStart, toolsEnd);
  const hiddenToolCommands = [
    'boo.openDatabase',
    'boo.formatScript',
    'boo.findUnusedLabels',
    'boo.toUpperCase',
    'boo.cleanAllLogs',
    'boo.openFontSettings',
  ];
  for (const command of hiddenToolCommands) {
    assert.ok(!toolsBlock.includes(`cmd: '${command}'`), `${command} button must be hidden from shortcut tools`);
  }
  assert.ok(toolsBlock.includes("cmd: 'boo.toUpperCaseAll'"), 'all-script uppercase button must remain visible');
  const manifest = JSON.parse(packageManifest);
  const contributedCommands = new Set(manifest.contributes.commands.map(item => item.command));
  const registeredCommands = assistant + extension;
  for (const command of hiddenToolCommands) {
    assert.ok(contributedCommands.has(command), `${command} must remain available in the command palette`);
    assert.ok(
      registeredCommands.includes(`registerCommand('${command}'`),
      `${command} runtime implementation must not be removed with its button`
    );
  }
  for (const key of ['Ctrl+D', 'Ctrl+Q', 'Ctrl+F1', 'Alt+Shift+U', 'Alt+X']) {
    assert.ok(extension.includes(`<span class="key">${key}</span>`), `${key} must be listed in shortcut tools`);
  }
  for (const key of ['Ctrl+Space', 'Ctrl+.', 'F8 / Shift+F8', 'Ctrl+K S', 'Ctrl+Shift+P']) {
    assert.ok(extension.includes(`<span class="key">${key}</span>`), `${key} editor shortcut must be listed`);
  }
  assert.match(extension, /Ctrl\+Shift\+P[\s\S]*可使用全部 BOO 功能/);
  assert.match(extension, /可视化工具[\s\S]*Ctrl\+点击[\s\S]*Ctrl\+C \/ Ctrl\+V[\s\S]*Delete[\s\S]*方向键/);
  assert.match(extension, /Ctrl\+左键[\s\S]*Merchant\.txt[\s\S]*原始地图定位/);

  assert.doesNotMatch(
    assistant,
    /unsupportedTriggerByName\.get\(triggerName\)/,
    'custom labels must not be diagnosed as unsupported engine triggers by name alone'
  );
  assert.doesNotMatch(
    assistant,
    /兼容提示：\\`\$\{unsupportedTrigger\.label\}\\`/,
    'hover must not misclassify a custom label that shares another engine trigger name'
  );

  const actionMaps = [...editor.matchAll(/_actionFnMap\s*=\s*\{([\s\S]*?)\n\s*\};/g)];
  const actionMap = actionMaps[actionMaps.length - 1];
  assert.ok(actionMap, 'editor action map should exist');
  assert.match(actionMap[1], /requestOpenPakHistory\s*:\s*requestOpenPakHistory/, 'PAK history button must be wired');

  assert.doesNotMatch(
    database,
    /id="detail(?:Resizer)?"/,
    'database viewer must not duplicate the left property detail pane'
  );
  assert.match(
    database,
    /function resetTableViewport\(\)[\s\S]*?scrollLeft=0[\s\S]*?scrollTop=0/,
    'database table must reset to the first columns when its data changes'
  );
  assert.match(
    database,
    /function getFrozenColumns\(columns\)[\s\S]*getNameColumn\(columns\)[\s\S]*columns\.slice\(0,nameIndex>=0\?nameIndex\+1:1\)/,
    'database columns must remain frozen from the first field through the name field'
  );
  assert.match(
    database,
    /frozen:frozenIndex>=0[\s\S]*renderHorizontal:'virtual'/,
    'the virtual database grid must let Tabulator freeze each identification column cumulatively'
  );
  assert.match(
    database,
    /frozenIndex===frozenColumns\.length-1[\s\S]*database-frozen-end/,
    'the name-side edge of the frozen database pane must remain visually distinct'
  );
  assert.match(
    database,
    /event\.ctrlKey[\s\S]*key==='z'[\s\S]*requestDatabaseUndo\(\)/,
    'database Ctrl+Z must invoke the dedicated persisted undo flow'
  );
  assert.match(
    database,
    /type:'undoDatabaseMutation'[\s\S]*databaseUndoResult[\s\S]*loadUndoResult/,
    'database Webview must send and apply undo results'
  );
  assert.match(
    assistant,
    /undoDatabaseMutation[\s\S]*undoLastMutation\(\)[\s\S]*databaseUndoResult/,
    'extension host must execute database undo before refreshing the catalog'
  );
  assert.match(
    database,
    /databaseHeaderFormatter[\s\S]*className='field-name'[\s\S]*className='field-label'/,
    'database headers must show the original field and Chinese translation'
  );
  assert.doesNotMatch(
    database,
    /class="name-link"/,
    'the name field must be normal text instead of a link-styled button'
  );
  assert.match(
    database,
    /function gomColor[\s\S]*GOM_PALETTE/,
    'database names must support the engine Color palette'
  );
  assert.match(
    database,
    /type:'createDatabaseRow'[\s\S]*type:'updateDatabaseRow'[\s\S]*type:'updateDatabaseRows'[\s\S]*type:'deleteDatabaseRow'/,
    'database record CRUD actions must be wired'
  );
  assert.match(
    database,
    /selectableRange:1[\s\S]*function pasteGridMatrix[\s\S]*function fillSelectedGridRange[\s\S]*Ctrl\+D 填充选区/,
    'database records must support bounded range paste and Ctrl+D fill'
  );
  assert.match(
    assistant,
    /updateDatabaseRows[\s\S]*databaseSession\.updateRows/,
    'database range edits must be grouped into one extension-host mutation'
  );
  assert.match(
    database,
    /type:'updateDatabaseSchema'/,
    'database field add, rename, delete, and reorder must be wired'
  );
  assert.doesNotMatch(
    database,
    /window\.confirm\(/,
    'sandboxed database webviews must use an in-app confirmation dialog'
  );
  assert.match(
    database,
    /id="confirmModal"[\s\S]*function showConfirmDialog/,
    'database destructive actions must use the Webview confirmation dialog'
  );
  assert.match(
    database,
    /武器[\s\S]*values:\[5,6\][\s\S]*项链[\s\S]*values:\[19,20,21\]/,
    'equipment filters must use documented StdMode groups'
  );
  assert.match(
    database,
    /称号[\s\S]*values:\[70\][\s\S]*双击物品[\s\S]*values:\[31\][\s\S]*材料[\s\S]*values:\[42\]/,
    'item filters must include title, double-click item, and material StdMode types'
  );
  assert.match(
    database,
    /时装衣服[\s\S]*values:\[66,67\][\s\S]*时装项链[\s\S]*values:\[75,76,77\][\s\S]*时装宝石[\s\S]*values:\[88,89\]/,
    'fashion equipment filters must include every documented slot and StdMode'
  );
  assert.match(
    database,
    /首饰盒[\s\S]*overlap[\s\S]*values:\[2,3,6,7\][\s\S]*expand1[\s\S]*values:\[1,2,3,4,5,6,13\]/,
    'jewelry box filters must use OverLap and Expand1 eligibility'
  );
  assert.match(
    database,
    /神佑盒[\s\S]*overlap[\s\S]*values:\[4,5,6,7\][\s\S]*expand1[\s\S]*values:\[1,2,3,4,5,6,7,8,9,10,11,12,13\]/,
    'god bless box filters must use OverLap and Expand1 eligibility'
  );
  assert.match(
    database,
    /EQUIPMENT_FILTERS_996PC[\s\S]*勋章[\s\S]*values:\[30\][\s\S]*符\/毒药[\s\S]*values:\[25,51\][\s\S]*面巾[\s\S]*values:\[16,50\][\s\S]*宝石\/血石[\s\S]*values:\[7,53,63\]/,
    '996PC equipment filters must use the documented medal, talisman, veil, and gem StdMode groups'
  );
  assert.match(
    database,
    /EQUIPMENT_FILTERS_996PC[\s\S]*首饰盒[\s\S]*overlap[\s\S]*values:\[2,3,6,7\][\s\S]*神佑盒[\s\S]*overlap[\s\S]*values:\[4,5,6,7\][\s\S]*生肖装备[\s\S]*values:\[100,101,102,103,104,105,106,107,108,109,110,111\]/,
    '996PC jewelry box, god-bless box, and zodiac equipment filters must stay distinct'
  );
  assert.match(
    database,
    /function activeEquipmentFilters\(\)[\s\S]*996PC[\s\S]*EQUIPMENT_FILTERS_996PC/,
    'database item categories must switch with the active database protocol'
  );
  assert.match(
    database,
    /filters:buildEquipmentFilters\(/,
    'equipment category selection must send all field filters to the database query layer'
  );
  assert.match(
    database,
    /editTriggerEvent:'dblclick'[\s\S]*function startCellEdit/,
    'double-clicking a database cell must enter inline edit mode'
  );
  const startCellEdit = database.match(/function startCellEdit\(initialValue,cell\)\{([\s\S]*?)\n\}/);
  assert.ok(startCellEdit, 'inline cell editor implementation must exist');
  assert.doesNotMatch(
    startCellEdit[1],
    /requestVisualDetail/,
    'entering inline edit mode must not trigger a second sidebar update'
  );
  assert.match(
    database,
    /event\.key\.length===1[\s\S]*startCellEdit\(event\.key\)/,
    'typing over a selected database cell must replace it through the inline editor'
  );
  assert.match(
    database,
    /function protectCellEditorSelection[\s\S]*stopPropagation/,
    'mouse text selection inside a database editor must not collapse edit mode'
  );
  assert.doesNotMatch(
    database,
    /tooltip:function\(_event,cell\)/,
    'database data cells must not show duplicate value tooltips'
  );
  assert.match(
    database,
    /id="fillHandle"[\s\S]*function beginGridFill[\s\S]*calculateFillChanges[\s\S]*\u62d6\u62fd\u9012\u589e\u586b\u5145/,
    'the database range handle must perform spreadsheet-style series fill'
  );
  assert.match(
    database,
    /id="incrementModal"[\s\S]*id="contextIncrementCells"[\s\S]*calculateIncrementChanges[\s\S]*\u9012\u589e\u9009\u533a/,
    'the database context menu must apply ordered incremental numeric changes'
  );
  assert.match(
    database,
    /replaceData\(currentRows\)[\s\S]*applyOptimisticUpdates[\s\S]*requestPage\(operation==='update'\)/,
    'ordinary database edits must stay visible and refresh without rebuilding the grid'
  );
  assert.doesNotMatch(
    database,
    /recordGridCellEdit[\s\S]{0,600}restoreOldValue/,
    'ordinary database edits must not visibly restore the old value before saving'
  );
  assert.match(
    database,
    /rowHeader:\{formatter:function\(\)\{return''\}[\s\S]*width:1[\s\S]*minWidth:1[\s\S]*maxWidth:1/,
    'the Tabulator compatibility row header must remain visually collapsed without row numbers'
  );
  assert.match(
    database,
    /databaseGrid\.on\('rowContext'[\s\S]*showRowContextMenu/,
    'database rows must expose the custom context menu'
  );
  assert.match(
    database,
    /function copySelectedRow[\s\S]*function pasteCopiedRow/,
    'database rows must support copy and paste'
  );
  assert.doesNotMatch(
    database,
    /id="recordModal"/,
    'record CRUD must happen in the table instead of a separate form dialog'
  );
  assert.match(
    sidebar,
    /if\(val===0\|\|val==='0'\|\|val===''?\|\|val===null\|\|val===undefined\) continue/,
    'visual detail must hide zero and empty fields'
  );

  assert.match(
    extension,
    /const nextResults\s*=\s*new Map[\s\S]{0,1800}workspaceState\.update\(PAK_HISTORY_STATE_KEY[\s\S]{0,500}loadedPakResults\s*=\s*nextResults/,
    'successful PAK loading must persist history in the current workspace'
  );
  assert.match(
    extension,
    /listCalledClientArchives[\s\S]*打开新的 \$\{archiveLabel\}\.\.\.[\s\S]*已经缓存的补丁 \$\{archiveLabel\}/,
    'Open archive must list the new-file action before called cached patch archives'
  );
  assert.match(
    extension,
    /findCachedPatchPakByPath[\s\S]*loadCachedPatchPakResult/,
    'UI editor must load selected patch PAKs directly from the shared cache'
  );
  assert.match(
    database,
    /type:'showDatabaseDetail'[\s\S]*tableName:currentTable\?currentTable\.name:''[\s\S]*tableLabel:currentTable\?currentTable\.label:''/,
    'database row selection must identify the active table when requesting sidebar detail'
  );
  assert.match(
    database,
    /type:'showDatabaseDetail'[\s\S]*columnLabels:currentTable&&currentTable\.columnLabels[\s\S]*columnDescriptions:currentTable&&currentTable\.columnDescriptions/,
    'database details must carry engine-native field labels and descriptions'
  );
  assert.match(
    sidebar,
    /detailKind==='monster'\?'怪物属性':detailKind==='skill'\?'技能属性':'物品属性'/,
    'the sidebar must label item, monster, and skill properties independently'
  );
  assert.match(
    sidebar,
    /protocolLabels=_detail&&_detail\.columnLabels[\s\S]*protocolLabels\[key\]/,
    'the sidebar must prefer 996PC protocol labels over legacy field meanings'
  );
  assert.match(sidebar, /怪物爆率/, 'monster details must expose the MonItems drop-rate section');
  assert.match(sidebar, /怪物样子与顶戴/, 'monster details must expose the combined body and MonIcons preview section');
  assert.match(sidebar, /monster-composite-stage/, 'monster body and MonIcons must share one layered stage');
  assert.match(sidebar, /monster-body-image/, 'monster details must render the monster body below MonIcons');
  const iconLayoutContext = { Math, Number, Array };
  vm.createContext(iconLayoutContext);
  vm.runInContext(extractFunction(sidebar, 'finiteMonsterNumber'), iconLayoutContext);
  vm.runInContext(extractFunction(sidebar, 'buildMonsterPlacement'), iconLayoutContext);
  vm.runInContext(extractFunction(sidebar, 'calculateMonsterStageLayout'), iconLayoutContext);
  vm.runInContext(extractFunction(sidebar, 'calculateMonsterNamePlacement'), iconLayoutContext);
  const bodyPlacement = iconLayoutContext.buildMonsterPlacement({
    width: 438,
    height: 259,
    offsetX: -155,
    offsetY: -186,
  }, null, 'body', 0, 0);
  const iconPlacement = iconLayoutContext.buildMonsterPlacement({
    width: 200,
    height: 100,
    offsetX: -72,
    offsetY: -136,
  }, null, 'icon', 73, 90);
  assert.deepEqual(JSON.parse(JSON.stringify(bodyPlacement)), { x: -155, y: -186, width: 438, height: 259 });
  assert.deepEqual(
    JSON.parse(JSON.stringify(iconPlacement)),
    { x: -75, y: -125, width: 200, height: 100 },
    'MonIcons must be bottom-centered on the 48x32 actor cell before frame and script offsets'
  );
  const zeroOffsetPlacement = iconLayoutContext.buildMonsterPlacement(
    { width: 151, height: 80 },
    null,
    'icon',
    0,
    0
  );
  assert.deepEqual(JSON.parse(JSON.stringify(zeroOffsetPlacement)), { x: -51, y: -59, width: 151, height: 80 });
  const zeroScriptIconPlacement = iconLayoutContext.buildMonsterPlacement({
    width: 200,
    height: 100,
    offsetX: -72,
    offsetY: -136,
  }, null, 'icon', 0, 0);
  assert.equal(iconPlacement.x - zeroScriptIconPlacement.x, 73);
  assert.equal(iconPlacement.y - zeroScriptIconPlacement.y, 90);
  const compositeLayout = iconLayoutContext.calculateMonsterStageLayout(bodyPlacement);
  assert.equal(compositeLayout.stageWidth, 657);
  assert.equal(compositeLayout.stageHeight, 389);
  assert.equal(compositeLayout.originX, 264);
  assert.equal(compositeLayout.originY, 251);
  assert.equal(compositeLayout.originX + bodyPlacement.x, 109);
  assert.equal(compositeLayout.originY + bodyPlacement.y, 65);
  assert.equal(compositeLayout.originX + iconPlacement.x, 189);
  assert.equal(compositeLayout.originY + iconPlacement.y, 126);
  const shankeBodyPlacement = iconLayoutContext.buildMonsterPlacement({
    width: 99,
    height: 114,
    offsetX: -19,
    offsetY: -72,
  }, null, 'body', 0, 0);
  const shankeIconPlacement = iconLayoutContext.buildMonsterPlacement({
    width: 200,
    height: 100,
    offsetX: -72,
    offsetY: -136,
  }, null, 'icon', 73, 90);
  const shankeLayout = iconLayoutContext.calculateMonsterStageLayout(
    shankeBodyPlacement,
    [shankeIconPlacement],
    34,
    14
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(shankeLayout)),
    { stageWidth: 204, stageHeight: 198, originX: 77, originY: 127 },
    '山客的 200 像素顶戴必须扩展固定画布，不能被 99 像素怪物本体裁掉'
  );
  assert.equal(shankeLayout.originX + shankeBodyPlacement.x, 58);
  assert.equal(shankeLayout.originY + shankeBodyPlacement.y, 55);
  assert.equal(shankeLayout.originX + shankeIconPlacement.x, 2);
  assert.equal(shankeLayout.originY + shankeIconPlacement.y, 2);
  assert.equal(shankeLayout.originX + shankeIconPlacement.x + shankeIconPlacement.width, 202);
  const namePlacement = iconLayoutContext.calculateMonsterNamePlacement(compositeLayout, 14);
  assert.deepEqual(
    JSON.parse(JSON.stringify(namePlacement)),
    { centerX: 288, top: 234 },
    'monster names must be centered on the 48-pixel game cell rather than the image bounds'
  );
  assert.match(
    sidebar,
    /\.monster-body-image,\.monster-icon-image\{[^}]*max-width:none;[^}]*max-height:none;[^}]*transform:none/,
    'monster body and icons must use explicit top-left coordinates instead of center transforms'
  );
  assert.match(
    sidebar,
    /\.monster-composite-viewport\{[^}]*width:max-content;[^}]*height:max-content;[^}]*overflow:hidden/,
    'the fixed 100 percent canvas must neither resize nor scroll with the sidebar'
  );
  assert.match(
    sidebar,
    /function calculateMonsterStageLayout[\s\S]*Math\.ceil\(bodyWidth\*1\.5\)[\s\S]*Math\.ceil\(bodyHeight\*1\.5\)[\s\S]*overlayPlacements[\s\S]*x\+width\+2/,
    'the fixed canvas must preserve the 150 percent body area and expand for every top-icon frame'
  );
  assert.match(sidebar, /Math\.round\(layout\.originX\+placement\.x\)/, 'sprite drawing must stay on integer pixels at 100 percent scale');
  assert.match(sidebar, /monster-origin-marker/, 'the preview must expose the shared game drawing origin');
  assert.match(sidebar, /monster-name-label/, 'the preview must render a game-style name anchored to the map cell');
  assert.doesNotMatch(sidebar, /layout\.scale/, 'monster body and top icons must remain at 100 percent size');
  assert.doesNotMatch(sidebar, /scrollLeft|scrollTop|centerMonsterCompositeViewport/, 'the monster preview must not auto-scroll');
  assert.match(sidebar, /body\{[^}]*overflow-y:auto;overflow-x:hidden/, 'the fixed preview must not create a horizontal sidebar scrollbar');
  assert.match(sidebar, /monsterFrameAsset[\s\S]*frameAssets/, 'animated top icons must retain per-frame offsets');
  assert.match(
    sidebarBridge,
    /resolveCachedPatchPakImageAsset[\s\S]*loadCachedPatchAssetTable[\s\S]*offsetX:[\s\S]*offsetY:/,
    'cached archive image metadata must reach the monster composite preview'
  );
  assert.match(
    extension,
    /buildMonsterIconPreviews\(detail\.icons, resolvePakImageAsset\)[\s\S]*resolveCachedPatchPakImageAsset/,
    'database detail refresh must resolve body and icon layout metadata'
  );
  assert.match(
    sidebar,
    /function saveMonsterDetail[\s\S]*type:'saveMonsterDetail'/,
    'monster drop-rate and icon text editors must expose save feedback and Ctrl+S'
  );
  assert.match(sidebar, /monsterDetailSaveResult/, 'monster detail editors must display save feedback');
  assert.match(sidebar, /event\.ctrlKey\|\|event\.metaKey[\s\S]*event\.key[\s\S]*==='s'/, 'monster editors must support the save shortcut');
  assert.match(
    extension,
    /msg\.type === 'saveMonsterDetail'[\s\S]*saveMonsterDatabaseDetailText[\s\S]*buildMonsterIconPreviews/,
    'monster detail saves must persist and rebuild the visual preview'
  );
  assert.match(
    databaseDetail,
    /frameBudgetPerIcon[\s\S]*Math\.floor\(totalFrameBudget\s*\/\s*iconConfigs\.length\)/,
    'monster icon preview frames must be shared across all visible icon configurations'
  );
  assert.match(
    mapPreviewProvider,
    /resolveSavedMapMarkerFile[\s\S]*MARKER_FILE_PATHS_STATE_KEY[\s\S]*globalState\.update/,
    'map marker paths must restore by workspace and persist across workspace-state changes'
  );
  assert.match(
    mapPreviewProvider,
    /markerFilePath[\s\S]*已载入：[\s\S]*classList\.toggle\('missing'/,
    'the map marker sidebar must show whether the remembered file was restored or is missing'
  );
  assert.match(
    sidebar,
    /if\(detailKind==='item'\)[\s\S]*buildEditSection\('顶部备注','topDesc'\)/,
    'item notes must only render for item database rows'
  );
  const detailHandler = assistant.match(/if \(msg\.type === 'showDatabaseDetail'\) \{([\s\S]*?)\n\s*if \(msg\.type === 'ready'\)/);
  assert.ok(detailHandler, 'database detail handler must exist');
  assert.doesNotMatch(
    detailHandler[1],
    /workbench\.view\.extension\.boo-database/,
    'row selection must not refocus the database sidebar and interrupt inline editing'
  );
  assert.match(
    pakReader,
    /enumeratePakSlots\(blocks, slotCount\)[\s\S]*isBlank: !block/,
    'PAK loading must retain blank logical image slots'
  );
  assert.match(
    patchCache,
    /readPatchManifestHeader[\s\S]*Buffer\.allocUnsafe\(65536\)/,
    'the shared patch index must read manifest headers instead of parsing every asset list'
  );
  assert.match(
    assistant,
    /findMiniMapReference[\s\S]*findCachedPatchImage[\s\S]*miniMapUrl/,
    'the map viewer must resolve MiniMap.txt references through cached mmap PAKs'
  );
  assert.match(
    mapViewer,
    /state\.showMiniMap&&state\.miniMapImage[\s\S]*drawImage\(state\.miniMapImage,0,0,state\.w,state\.h\)/,
    'the map viewer must render the cached minimap as its default map layer'
  );
  assert.match(
    assistant,
    /resolveItemImageReference[\s\S]*resolveCachedPatchPakImage[\s\S]*itemImageLabel/,
    'database item selection must resolve Looks to a cached Items PAK image'
  );
  assert.match(
    assistant,
    /class="engine-tabs"[\s\S]*data-engine="\$\{definition\.id\}"[\s\S]*let activeEngine/,
    'the completion editor must provide top-level engine tabs'
  );
  assert.match(
    assistant,
    /activeEngineChanged[\s\S]*activeEngine = nextEngine[\s\S]*render\(''\)[\s\S]*completionEngineSync[\s\S]*affectsConfiguration\('boo\.engine'\)/,
    'an open completion editor must follow global engine changes without losing manual engine tabs'
  );
  assert.match(
    engineRegistry,
    /label: 'GOM引擎'[\s\S]*label: '翎风引擎'[\s\S]*label: '996PC引擎'/,
    'the engine registry must expose GOM, GEE, and 996PC independently'
  );
  assert.match(
    editor,
    /'996pc':\s*\{[\s\S]*dlgParamCount:\s*9[\s\S]*supportsCodeGeneration:\s*true/,
    '996PC must use the verified GOM-compatible UI serializer while retaining JPK resources'
  );
  assert.doesNotMatch(
    editor,
    /996PC UI 代码生成尚未通过|996PC.*UI 代码生成尚未验收/,
    'the 996PC editor must not retain a stale disabled-code-generation warning'
  );
  assert.match(
    engineRegistry,
    /id: '996PC'[\s\S]*uiCodeGenerationVerified:\s*true[\s\S]*mapPreviewVerified:\s*true/,
    '996PC UI generation and mmap JPK preview must both be enabled in the central capability registry'
  );
  assert.match(
    editor,
    /id="openPakBtn"[\s\S]*打开资源包[\s\S]*id="pakHistoryBtn"[\s\S]*资源包历史/,
    'archive buttons must use neutral text until the active engine label arrives'
  );
  assert.match(
    patchManager,
    /archiveLabel:\s*'资源包'/,
    'patch manager must not flash a PAK label before a 996PC JPK state is loaded'
  );
  assert.match(
    reloadOptions,
    /'996PC':\s*\[[\s\S]*物品数据[\s\S]*重载爆率[\s\S]*QFunction[\s\S]*所有NPC[\s\S]*重载账号列表/,
    '996PC automatic reload settings must expose the menu names verified from its M2'
  );
  assert.match(
    packageManifest,
    /PAK\/JPK 读取/,
    'the extension description must advertise both supported archive formats'
  );
  assert.match(
    assistant,
    /检测命令[\s\S]*执行命令[\s\S]*引擎函数[\s\S]*系统常量/,
    'each engine tab must expose commands, engine entry labels, and merged system constants'
  );
  assert.doesNotMatch(assistant, /label:\s*'系统变量'/, 'system variables must be merged into system constants');
  assert.match(
    assistant,
    /id:\s*'constant'[\s\S]*mergeRows\([\s\S]*variableRows\([\s\S]*constantRows\(/,
    'the system constants tab must preserve both variable and constant backing stores'
  );
  assert.doesNotMatch(assistant, /label:\s*'触发器'/, '[@...] entries must be presented as engine functions');
  assert.doesNotMatch(assistant, /帮助来源|formatHelpSource/, 'completion and hover UI must not expose help-source paths');
  assert.match(
    assistant,
    /id:\s*'exec'[\s\S]*functionRows/,
    'engine-specific action catalogs must be included under execution commands'
  );
  assert.match(
    assistant,
    /id:\s*'func'[\s\S]*triggerRows/,
    '[@attack]-style triggers must be displayed under engine functions'
  );
  assert.match(
    sidebar,
    /PLAYIMG[\s\S]*animatedImages[\s\S]*startDescriptionAnimations/i,
    'item visual notes must render PLAYIMG animation frames'
  );
  assert.match(packageManifest, /"filenamePattern":\s*"\*\.xls"/, 'the custom table editor must support .xls files');
  assert.match(
    assistant,
    /activeEngine\+':'\+storage\+':'\+sourceIndex[\s\S]*data-engine="'\+activeEngine\+'" data-storage="'\+storage\+'" data-idx="'\+sourceIndex/,
    'filtered completion rows must preserve engine and source index identity'
  );
  assert.match(
    mapPreview,
    /id="mapLayerToggle"[\s\S]*原始地图[\s\S]*正在完整读取原始地图[\s\S]*originalMapProgress[\s\S]*originalMapData/,
    'map preview must expose original-map switching and complete-map loading progress'
  );
  assert.ok(
    !mapPreview.includes("type:'loadOriginalViewport'"),
    'zooming and panning the original map must not request another viewport payload'
  );
  assert.match(
    mapPreview,
    /Math\.floor\(state\.offsetX\+worldX\*state\.scale\)[\s\S]*Math\.ceil\(state\.offsetX\+\(worldX\+meta\.width\)\*state\.scale\)[\s\S]*const seam=kind==='object'\?0:1/,
    'original-map drawing must snap scaled bounds and overlap background layers to hide seams'
  );
  assert.match(
    mapPreviewProvider,
    /parseOriginalMap[\s\S]*collectOriginalMapViewport[\s\S]*loadCachedPatchAssetTable/,
    'original-map rendering must parse MAP references and resolve cached archive metadata'
  );
  assert.match(
    assistant,
    /type: 'save',[\s\S]*engine: activeEngine/,
    'completion editor saves must include the selected engine'
  );
  const diagnosticsSource = assistant.slice(
    assistant.indexOf('function computeDiagnostics'),
    assistant.indexOf('const diagnosticTimeouts')
  );
  assert.ok(
    !/unsupported(?:Command|Variable|Constant)ByName/.test(diagnosticsSource),
    'code review must not diagnose commands or system values from catalog omissions'
  );
  assert.ok(
    !/属于 .*\u5f53前选择|未收录在当前/.test(diagnosticsSource),
    'code review must not emit cross-engine catalog mismatch warnings'
  );
  assert.match(
    sidebarBridge,
    /_cachedPatchResourceRoots[\s\S]*\.\.\._cachedPatchResourceRoots[\s\S]*_cachedPatchResourceRoots\.push/,
    'shared patch resource roots must survive UI editor asset-list refreshes'
  );
  assert.match(
    sidebarBridge,
    /_loadedPakResourceRoots = \[\.\.\.new Set\(assets[\s\S]*\.filter\(asset => !!asset\.path\)[\s\S]*\.map\(asset => path\.dirname\(asset\.path\)\)/,
    'direct archive assets with an empty legacy path must not add the current directory to Webview roots'
  );
  assert.match(
    sidebarBridge,
    /function clearArchiveResourceContext\(\)[\s\S]*_loadedPakImages\.clear\(\)[\s\S]*_cachedPatchResourceRoots = \[\]/,
    'engine switching must revoke resource roots and images inherited from the previous archive format'
  );
  assert.match(
    extension,
    /const selectionEngine = loadedPakEngine[\s\S]*showQuickPick[\s\S]*loadedPakEngine !== selectionEngine/,
    'archive quick-pick results must be discarded when the engine changes while the picker is open'
  );
  assert.match(
    extension,
    /const operationVersion = \+\+archiveOperationVersion[\s\S]*isCurrentArchiveOperation/,
    'asynchronous archive operations must be invalidated by newer loads or engine switches'
  );
  assert.match(
    extension,
    /const nextResults = new Map[\s\S]*workspaceState\.update[\s\S]*isCurrentArchiveOperation[\s\S]*workspaceState\.update[\s\S]*isCurrentArchiveOperation[\s\S]*loadedPakResults = nextResults/,
    'decoded archives must only become visible after persistence completes for the same engine operation'
  );
  assert.match(
    extension,
    /clearArchiveResourceContext\(\)[\s\S]*reloadEngineResources:\s*true[\s\S]*restoreOpenedPakFiles/,
    'engine switching must clear old resources, reload engine-specific imports, and restore only that engine history'
  );
  assert.match(
    mapPreviewProvider,
    /affectsConfiguration\('boo\.engine'\)[\s\S]*this\.panel\?\.dispose\(\)[\s\S]*this\.reloadMaps\(\)/,
    'map preview panels must close on every engine switch instead of retaining an old engine image'
  );
  assert.match(
    assistant,
    /postToSidebar\(\{ type: 'clearDatabaseDetail', detailKind: 'other' \}\)[\s\S]*for \(const panel of \[\.\.\.mapViewerPanels\]\) panel\.dispose\(\)/,
    'engine switching must clear stale database details and map viewer panels'
  );
  assert.match(
    sidebar,
    /h\+=buildPropTable\(d,detailKind\);[\s\S]*if\(detailKind==='item'\)[\s\S]*buildEditSection\('顶部备注'/,
    'the item material and properties must render above visual notes'
  );
  assert.match(
    extension,
    /preserveSelectionVisuals:\s*true/,
    'description saves must explicitly request preservation of the selected item visuals'
  );
  assert.doesNotMatch(
    sidebar,
    /sameItem&&!e\.data\.itemImage/,
    'normal row selection must never reuse the previous item image'
  );
  assert.match(
    extension,
    /href="command:boo\.openEditor">打开可视化编辑器/,
    'the tutorial button must reuse the stable editor command'
  );
  assert.doesNotMatch(
    extension,
    /onclick="acquireVsCodeApi\(\)\.postMessage\(\{type:'openEditor'\}\)"/,
    'the tutorial button must not reacquire the VS Code API on every click'
  );
  assert.doesNotMatch(
    packageManifest,
    /"view == boo\.editorView"/,
    'the duplicate editor button must be removed from the sidebar title'
  );
  assert.doesNotMatch(
    extension,
    /registerCommand\('boo\.openVisualEditor'/,
    'the obsolete one-shot editor command must be removed'
  );
  console.log('ui-regressions.test.js: PASS');
}

main();
