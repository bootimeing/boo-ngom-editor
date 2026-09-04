const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');

/*
 * RED contract for every user-visible text/number surface in Ctrl+F12.
 *
 * Display values and runtime/resource values are deliberately asserted
 * independently:
 *   - a value proven on the selected local source path is useful canvas text;
 *   - an unresolved string is `预览文字`;
 *   - an unresolved display number/quantity is `0`;
 *   - source expressions remain in raw/Inspector provenance;
 *   - dynamic assets, database IDs and server actions remain blocked.
 *
 * Keep this suite as an accumulating matrix. A first failure must not hide the
 * other unreadable surfaces from the repair report.
 */

const GOM_SOURCE = [
  '[@main]',
  '#ACT',
  'MOV N$KNOWN_NUM 456',
  'MOV S$IMG_TITLE 已知图片标题',
  'MOV S$IMG_TIP 已知图片提示',
  'MOV S$ANIM_TITLE 已知动画标题',
  'MOV S$ADD_TITLE 已知动作按钮',
  'MOV S$ADD_TIP 已知动作提示',
  'MOV N$DYNAMIC_WIL 37',
  'MOV N$DYNAMIC_IMAGE 9901',
  'MOV N$DYNAMIC_BUTTON_ID 88',
  String.raw`ADDBUTTON 3 9 283 284 285 20 500 0|1 <$STR(S$ADD_TITLE)> 253/<$STR(S$ADD_TIP)>`,
  String.raw`ADDBUTTON 3 10 286 287 288 200 500 0|1 <$STR(S$UNKNOWN_ADD_TITLE)> 253/<$STR(S$UNKNOWN_ADD_TIP)>`,
  String.raw`ADDBUTTON <$STR(N$DYNAMIC_WIL)> <$STR(N$DYNAMIC_BUTTON_ID)> <$STR(N$DYNAMIC_IMAGE)> 291 292 380 500 0|1 动态素材按钮 253/动态素材提示`,
  '#SAY',
  '<&IMGNUM:3170:<$STR(N$KNOWN_NUM)>:0:10:20:*>',
  '<&IMGNUM:3180:<$STR(N$UNKNOWN_NUM)>:0:10:50:*>',
  '<&IMG:<$STR(N$DYNAMIC_IMAGE)>:<$STR(N$DYNAMIC_WIL)>:10:80>',
  '<IMG:1802:0:10:110:<$STR(S$IMG_TITLE)>,2,3,250#|<$STR(S$IMG_TIP)>>',
  '<IMG:1803:0:10:145:<$STR(S$UNKNOWN_IMG_TITLE)>,2,3,250#|<$STR(S$UNKNOWN_IMG_TIP)>>',
  '<&PlayImg:2:600:3:100:10:180:1:0:<$STR(S$ANIM_TITLE)>,4,5,250#:1>',
  '<&PlayImg:2:610:3:100:10:220:1:0:<$STR(S$UNKNOWN_ANIM_TITLE)>,4,5,250#:1>',
].join('\n');

const GEE_SOURCE = [
  '[@main]',
  '#ACT',
  'MOV S$ANIM_TIP 已知动画提示',
  '#SAY',
  '<&PlayImg:5:510:3:100:520:180:3:249#<$STR(S$ANIM_TIP)>:1,2/@knownAnim>',
  '<&PlayImg:5:520:3:100:520:225:3:249#<$STR(S$UNKNOWN_ANIM_TIP)>:*/@unknownAnim>',
].join('\n');

const PC_SOURCE = [
  '[@main]',
  '#ACT',
  'MOV S$PLACE 已知输入提示',
  'MOV S$ERROR 已知错误提示',
  'MOV S$MENU_ITEMS 甲#乙',
  'MOV S$MENU_SELECTED 乙',
  'MOV S$COST_TITLE 已知消耗',
  'MOV N$COST_ITEM_ID 993',
  'MOV N$COST_COUNT 12',
  'MOV N$ITEM_ID 1927',
  'MOV N$ITEM_COUNT 7',
  'MOV N$TIME 65',
  'MOV N$PROGRESS 25',
  '#SAY',
  '<TextAtlas|id=ATLAS_UNKNOWN|x=250|y=20|wil=NewopUI|pcimg=2522|iwidth=14|iheight=24|text=<$STR(N$UNKNOWN_ATLAS)>>',
  '<Input|id=INPUT_KNOWN|x=250|y=60|inputid=1|type=0|width=180|height=26|place=<$STR(S$PLACE)>|errortips=<$STR(S$ERROR)>>',
  '<Input|id=INPUT_UNKNOWN|x=250|y=95|inputid=2|type=0|width=180|height=26|place=<$STR(S$UNKNOWN_PLACE)>|errortips=<$STR(S$UNKNOWN_ERROR)>>',
  '<MenuItem|id=MENU_KNOWN|x=250|y=130|itemname=<$STR(S$MENU_ITEMS)>|select=<$STR(S$MENU_SELECTED)>|direction=0|itemhei=28>',
  '<MenuItem|id=MENU_UNKNOWN|x=250|y=170|itemname=<$STR(S$UNKNOWN_MENU)>|select=<$STR(S$UNKNOWN_SELECTED)>|direction=0|itemhei=28>',
  '<CostItem|id=COST_KNOWN|x=250|y=210|itemid=<$STR(N$COST_ITEM_ID)>|itemcount=<$STR(N$COST_COUNT)>|title=<$STR(S$COST_TITLE)>>',
  '<CostItem|id=COST_UNKNOWN|x=250|y=250|itemid=<$STR(N$UNKNOWN_COST_ITEM)>|itemcount=<$STR(N$UNKNOWN_COST)>|title=<$STR(S$UNKNOWN_COST_TITLE)>>',
  '<ItemShow|id=ITEM_KNOWN|x=250|y=290|itemid=<$STR(N$ITEM_ID)>|itemcount=<$STR(N$ITEM_COUNT)>|bgtype=1>',
  '<ItemShow|id=ITEM_UNKNOWN|x=300|y=290|itemid=<$STR(N$UNKNOWN_ITEM)>|itemcount=<$STR(N$UNKNOWN_ITEM_COUNT)>|bgtype=1>',
  '<COUNTDOWN|id=COUNT_KNOWN|x=250|y=345|time=<$STR(N$TIME)>|count=1|showWay=0>',
  '<COUNTDOWN|id=COUNT_UNKNOWN|x=250|y=380|time=<$STR(N$UNKNOWN_TIME)>|count=1|showWay=0>',
  '<LoadingBar|id=PROGRESS_KNOWN|x=250|y=420|width=180|height=24|wil=NewopUI|pcloadingbg=100|pcloadingbar=101|startper=<$STR(N$PROGRESS)>|endper=100|maxper=100|direction=0|HideText=0>',
  '<LoadingBar|id=PROGRESS_UNKNOWN|x=250|y=455|width=180|height=24|wil=NewopUI|pcloadingbg=110|pcloadingbar=111|startper=<$STR(N$UNKNOWN_PROGRESS)>|endper=100|maxper=100|direction=0|HideText=0>',
].join('\n');

function parse(engine, source, suffix) {
  return parseNpcDialogDocument(source, {
    uri: `file:///D:/MirServer/Mir200/Envir/QuestDiary/all-text-${suffix}.txt`,
    fileName: `all-text-${suffix}.txt`,
    filePath: `D:\\MirServer\\Mir200\\Envir\\QuestDiary\\all-text-${suffix}.txt`,
    documentVersion: 1,
    engine,
    engineLabel: engine === 'GEE' ? 'LFM/GEE' : engine,
    cursorOffset: source.indexOf('[@main]') + '[@main]'.length,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, engine),
  });
}

function pageElements(model) {
  return model.pages[0].elements.filter(element => element.statementId !== 'flow-text');
}

function statement(model, id, occurrence = 0) {
  const result = pageElements(model).filter(element => element.statementId === id)[occurrence];
  assert.ok(result, `missing ${id} occurrence ${occurrence}`);
  return result;
}

function keyed(model, id) {
  const result = pageElements(model).find(element => element.containerElementId === id);
  assert.ok(result, `missing keyed control ${id}`);
  return result;
}

function actionElements(model) {
  const byId = new Map();
  for (const element of (model.scenes || []).flatMap(scene => scene.elements || [])) {
    if (element.addButtonPreview) byId.set(element.id, element);
  }
  return [...byId.values()];
}

function addButton(model, triggerId, occurrence = 0) {
  const matches = actionElements(model).filter(element => (
    triggerId === undefined || element.addButtonPreview?.triggerId === triggerId
  ));
  const result = matches[occurrence];
  assert.ok(result, `missing ADDBUTTON ${triggerId ?? `<dynamic:${occurrence}>`}`);
  return result;
}

function flattened(preview) {
  return (preview?.lines || [])
    .map(line => (line || []).map(run => String(run.text || '')).join(''))
    .join('\n');
}

function assetReferences(element) {
  return [
    element.assetRef,
    ...(element.assetLayers || []).map(layer => layer.assetRef),
    ...(element.imageTextPreview?.glyphs || []).map(glyph => glyph.assetRef),
    ...(element.imageTextPreview?.glyphBank || []).map(glyph => glyph.assetRef),
    ...(element.animationPreview?.effects || []).map(effect => effect.assetRef),
  ].filter(Boolean);
}

function glyphText(element) {
  return (element.imageTextPreview?.glyphs || []).map(glyph => glyph.character).join('');
}

const gom = parse('GOM', GOM_SOURCE, 'gom');
const gee = parse('GEE', GEE_SOURCE, 'gee');
const pc = parse('996PC', PC_SOURCE, '996pc');

const checks = [];
function check(name, callback) {
  checks.push({ name, callback });
}

check('P0 IMGNUM draws a proved number and neutral unknown zero', () => {
  const known = statement(gom, 'image-number', 0);
  const unknown = statement(gom, 'image-number', 1);
  assert.equal(known.imageTextPreview?.value, '456');
  assert.equal(glyphText(known), '456');
  assert.equal(unknown.imageTextPreview?.value, '0');
  assert.equal(glyphText(unknown), '0');
  assert.match(known.raw, /<\$STR\(N\$KNOWN_NUM\)>/i);
  assert.match(unknown.raw, /<\$STR\(N\$UNKNOWN_NUM\)>/i);
});

check('P0 CostItem separates display title/count from database identity', () => {
  const known = keyed(pc, 'COST_KNOWN');
  const unknown = keyed(pc, 'COST_UNKNOWN');
  assert.equal(known.costItemPreview?.title, '已知消耗');
  assert.equal(known.costItemPreview?.quantityText, '12');
  assert.equal(unknown.costItemPreview?.title, '预览文字');
  assert.equal(unknown.costItemPreview?.quantityText, '0');
  for (const element of [known, unknown]) {
    assert.equal(element.itemPreview?.itemIndex, undefined,
      'display text must not promote a dynamic database ID to a real item lookup');
  }
});

check('P0 TextAtlas keeps a static sheet but draws unknown numeric text as zero', () => {
  const atlas = keyed(pc, 'ATLAS_UNKNOWN');
  assert.deepEqual(atlas.imageTextPreview?.baseAssetRef, {
    archiveName: 'NewopUI', imageIndex: 2522,
  });
  assert.equal(atlas.imageTextPreview?.value, '0');
  assert.equal(glyphText(atlas), '0');
  assert.ok(atlas.imageTextPreview?.dynamicFields?.includes('text'));
});

check('P1 Input placeholder and error tips use proved text or preview text', () => {
  const known = keyed(pc, 'INPUT_KNOWN');
  const unknown = keyed(pc, 'INPUT_UNKNOWN');
  assert.equal(known.inputPreview?.placeholder, '已知输入提示');
  assert.equal(known.inputPreview?.errorTips, '已知错误提示');
  assert.equal(unknown.inputPreview?.placeholder, '预览文字');
  assert.equal(unknown.inputPreview?.errorTips, '预览文字');
});

check('P1 MenuItem items and selected value stay visible without enabling its action', () => {
  const known = keyed(pc, 'MENU_KNOWN');
  const unknown = keyed(pc, 'MENU_UNKNOWN');
  assert.deepEqual(known.menuPreview?.items, ['甲', '乙']);
  assert.equal(known.menuPreview?.selected, '乙');
  assert.deepEqual(unknown.menuPreview?.items, ['预览文字']);
  assert.equal(unknown.menuPreview?.selected, '预览文字');
  assert.equal(unknown.runtimeActionPreview?.localOnly ?? true, true);
});

check('P1 ItemShow quantity has a visible value while its dynamic DB ID stays gated', () => {
  const known = keyed(pc, 'ITEM_KNOWN');
  const unknown = keyed(pc, 'ITEM_UNKNOWN');
  assert.equal(known.itemPreview?.quantity, 7);
  assert.equal(unknown.itemPreview?.quantity, 0);
  assert.equal(known.itemPreview?.itemIndex, undefined);
  assert.equal(unknown.itemPreview?.itemIndex, undefined);
  assert.ok(known.itemPreview?.dynamicFields?.includes('itemid'));
  assert.ok(unknown.itemPreview?.dynamicFields?.includes('itemcount'));
});

check('P1 Countdown displays proved/neutral values but remains a blocked timer', () => {
  const known = keyed(pc, 'COUNT_KNOWN');
  const unknown = keyed(pc, 'COUNT_UNKNOWN');
  assert.equal(known.countdownPreview?.initialText, '65秒');
  assert.equal(flattened(known.textPreview), '65秒');
  assert.equal(unknown.countdownPreview?.initialText, '0秒');
  assert.equal(flattened(unknown.textPreview), '0秒');
  for (const element of [known, unknown]) {
    assert.equal(element.countdownPreview?.seconds, undefined,
      'a display placeholder/proved snapshot must not start a deterministic timer');
    assert.ok(element.countdownPreview?.dynamicFields?.includes('seconds'));
  }
});

check('P1 Progress caption displays proved/neutral values without inventing ratio', () => {
  const known = keyed(pc, 'PROGRESS_KNOWN');
  const unknown = keyed(pc, 'PROGRESS_UNKNOWN');
  assert.equal(known.progressPreview?.value, 25);
  assert.equal(unknown.progressPreview?.value, 0);
  assert.equal(known.progressPreview?.maximum, 100);
  assert.equal(unknown.progressPreview?.maximum, 100);
  assert.equal(known.progressPreview?.ratio, undefined);
  assert.equal(unknown.progressPreview?.ratio, undefined);
  assert.ok(known.progressPreview?.dynamicFields?.includes('value'));
  assert.ok(unknown.progressPreview?.dynamicFields?.includes('value'));
});

check('P1 IMG titles and tooltips use proved text or preview text', () => {
  const known = pageElements(gom).find(element => element.assetRef?.imageIndex === 1802);
  const unknown = pageElements(gom).find(element => element.assetRef?.imageIndex === 1803);
  assert.ok(known && unknown, 'titled IMG fixtures must remain recognized');
  assert.equal(known.imagePreview?.title?.text, '已知图片标题');
  assert.equal(flattened(known.tooltipPreview), '已知图片提示');
  assert.equal(unknown.imagePreview?.title?.text, '预览文字');
  assert.equal(flattened(unknown.tooltipPreview), '预览文字');
});

check('P1 Animation titles and tooltips use proved text or preview text', () => {
  const gomAnimations = pageElements(gom).filter(element => element.animationPreview);
  const geeAnimations = pageElements(gee).filter(element => element.animationPreview);
  assert.equal(gomAnimations[0]?.animationPreview?.title?.text, '已知动画标题');
  assert.equal(gomAnimations[1]?.animationPreview?.title?.text, '预览文字');
  assert.equal(flattened(geeAnimations[0]?.tooltipPreview), '已知动画提示');
  assert.equal(flattened(geeAnimations[1]?.tooltipPreview), '预览文字');
});

check('P1 ADDBUTTON title/tips use display values and all clicks remain local', () => {
  const known = addButton(gom, 9);
  const unknown = addButton(gom, 10);
  assert.equal(flattened(known.textPreview), '已知动作按钮');
  assert.equal(flattened(known.tooltipPreview), '已知动作提示');
  assert.equal(flattened(unknown.textPreview), '预览文字');
  assert.equal(flattened(unknown.tooltipPreview), '预览文字');
  for (const element of [known, unknown]) {
    assert.equal(element.runtimeActionPreview?.localOnly, true);
    assert.match(element.runtimeActionPreview?.link || '', /^@ButtonClick(?:9|10)$/);
  }
});

check('strict gate: dynamic generic image and ADDBUTTON assets/actions never borrow MOV', () => {
  const image = pageElements(gom).find(element => (
    /N\$DYNAMIC_IMAGE/i.test(element.raw || '')
  ));
  assert.ok(image, 'dynamic generic IMG fixture must remain auditable');
  const dynamicButton = actionElements(gom).find(element => (
    /N\$DYNAMIC_BUTTON_ID/i.test(element.raw || '')
  ));
  assert.ok(dynamicButton, 'dynamic ADDBUTTON fixture must remain auditable');
  for (const element of [image, dynamicButton]) {
    assert.equal(assetReferences(element).some(reference => (
      reference.willIndex === 37 || reference.imageIndex === 9901
    )), false, 'dynamic MOV asset escaped the source gate');
  }
  assert.equal(dynamicButton.addButtonPreview?.triggerId, undefined);
  assert.equal(dynamicButton.runtimeActionPreview?.link, undefined);
  assert.match(image.raw, /<\$STR\(N\$DYNAMIC_IMAGE\)>/i,
    'Inspector provenance must keep the source expression');
});

function loadProviderInternals() {
  const fileName = require.resolve('../out/providers/npc-dialog-visual');
  const source = fs.readFileSync(fileName, 'utf8')
    + '\nmodule.exports.__NpcDialogVisualEditorManager = NpcDialogVisualEditorManager;\n';
  const uri = value => ({
    fsPath: value, path: value, scheme: 'file', toString() { return value; },
  });
  const vscode = {
    Uri: {
      parse: uri, file: uri,
      joinPath(base, ...parts) { return uri([base.fsPath || base.path, ...parts].join('/')); },
    },
    EventEmitter: class {
      constructor() { this.event = () => undefined; }
      fire() {}
      dispose() {}
    },
    Disposable: { from: () => ({ dispose() {} }) },
    workspace: {}, window: {}, commands: {},
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const testModule = new Module(fileName, module);
    testModule.filename = fileName;
    testModule.paths = Module._nodeModulePaths(path.dirname(fileName));
    testModule._compile(source, fileName);
    return testModule.exports;
  } finally {
    Module._load = originalLoad;
  }
}

check('strict provider gate: display values do not trigger dynamic asset or DB lookup', async () => {
  const { __NpcDialogVisualEditorManager: Manager } = loadProviderInternals();
  const manager = Object.create(Manager.prototype);
  const requests = [];
  const databaseLookups = [];
  manager.resolveAsset = reference => {
    requests.push({ ...reference });
    return { status: 'missing', archiveLabel: 'contract/missing', message: 'fixture' };
  };
  manager.scriptDataResolver = {
    resolveItemFieldByIndex(fileName, itemIndex, field) {
      databaseLookups.push({ kind: 'index', fileName, itemIndex, field });
      return undefined;
    },
    resolveItemFieldByName(fileName, itemName, field) {
      databaseLookups.push({ kind: 'name', fileName, itemName, field });
      return undefined;
    },
  };
  for (const [engine, source, suffix] of [
    ['GOM', GOM_SOURCE, 'provider-gom'],
    ['GEE', GEE_SOURCE, 'provider-gee'],
    ['996PC', PC_SOURCE, 'provider-996pc'],
  ]) {
    const model = parse(engine, source, suffix);
    await manager.hydrateAssets(model, {}, { fileName: `all-text-${suffix}.txt` });
  }
  assert.equal(requests.some(reference => (
    reference.willIndex === 37 || reference.imageIndex === 9901
  )), false, `dynamic asset request leaked: ${JSON.stringify(requests)}`);
  assert.equal(databaseLookups.some(lookup => [993, 1927].includes(lookup.itemIndex)), false,
    `dynamic database lookup leaked: ${JSON.stringify(databaseLookups)}`);
});

async function main() {
  const failures = [];
  for (const entry of checks) {
    try {
      await entry.callback();
      console.log(`PASS ${entry.name}`);
    } catch (error) {
      failures.push(`${entry.name}: ${error && error.message ? error.message : String(error)}`);
      console.error(`FAIL ${entry.name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failures.length > 0) {
    console.error(`all-text-surface-contract.test.js: RED FAILURE MATRIX (${failures.length}/${checks.length})`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`all-text-surface-contract.test.js: PASS (${checks.length}/${checks.length})`);
  }
}

module.exports = { GOM_SOURCE, GEE_SOURCE, PC_SOURCE, parse };

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}
