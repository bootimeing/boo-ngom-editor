const assert = require('node:assert/strict');
const path = require('node:path');
const { parse } = require('./preview-inputs-integration.test');
const { manager } = require('./helpers/preview-image-hydration');

const runtime = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const clientResources = require(path.join(runtime, 'out/utils/client-resources'));
const patchCache = require(path.join(runtime, 'out/utils/patch-cache'));

const source = markup => `[@main]\n#SAY\n${markup}`;
const uri = value => ({ fsPath: value, path: value, toString: () => value });
const ref = imageIndex => ({ archiveName: 'NewopUI', imageIndex });
const unframed = model => {
  for (const scene of model.scenes) for (const element of scene.elements) {
    delete element.assetRef;
    delete element.assetLayers;
  }
  return model;
};

async function hydrate(model, options = {}) {
  const host = manager({ workspace: { getWorkspaceFolder: () => ({ uri: uri('D:/demand-workspace') }) } });
  host.context = { globalStorageUri: uri('D:/demand-fixture-storage') };
  host.patchState = () => ({ engine: model.engine });
  const requests = [], databaseRequests = [], snapshots = [], counts = { layout: 0, scans: 0, cache: 0 };
  host.scriptDataResolver = {
    resolveItemFieldByIndex(_file, index, field) {
      databaseRequests.push({ index, field });
      return field === 'Looks' && options.looks !== undefined ? String(options.looks) : undefined;
    },
    resolveItemFieldByName() { return undefined; },
  };
  host.resolveAsset = (reference, _engine, _webview, _document, _archiveCache, _assetTableCache, snapshot) => {
    requests.push({ ...reference });
    snapshots.push(snapshot);
    return { status: 'ready', url: `fixture:${reference.imageIndex}`, width: 140, height: 24, offsetX: 0, offsetY: 0 };
  };
  const originals = {
    layout: clientResources.clientResourceLayoutFromState,
    scan: clientResources.scanClientArchiveFiles,
    cache: patchCache.createPatchCacheSnapshot,
  };
  clientResources.clientResourceLayoutFromState = () => { counts.layout++; return { dataRoots: ['D:/preferred/Data', 'D:/base/Data'] }; };
  clientResources.scanClientArchiveFiles = async () => { counts.scans++; return ['D:/preferred/Data/NewopUI.pak']; };
  patchCache.createPatchCacheSnapshot = () => { counts.cache++; return {}; };
  try {
    await host.hydrateAssets(model, {}, { fileName: 'D:/demand-workspace/npc.txt', uri: uri('D:/demand-workspace/npc.txt') });
  } finally {
    clientResources.clientResourceLayoutFromState = originals.layout;
    clientResources.scanClientArchiveFiles = originals.scan;
    patchCache.createPatchCacheSnapshot = originals.cache;
  }
  return { counts, requests, snapshots, databaseRequests, model };
}

async function main() {
  const failures = [];
  let cases = 0;
  const check = async (name, body) => {
    cases++;
    try { await body(); console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
  };
  const noDemand = async (name, model) => check(name, async () => {
    const result = await hydrate(model);
    assert.deepEqual(result.requests, [], `${name}: no positive-looking request may escape its source gate`);
    assert.equal(result.counts.scans, 0, `${name}: no client archive directory scan without a hydratable reference`);
    assert.equal(result.counts.cache, 0, `${name}: no cached-manifest snapshot without demand`);
    assert.equal(result.counts.layout, 0, `${name}: no client directory discovery without demand`);
  });

  for (const engine of ['GOM', 'GEE', '996PC']) {
    await noDemand(`pure text ${engine}`, parse(source(engine === '996PC' ? '<Text|text=纯文字|x=20|y=20>' : '<TEXT:纯文字:20:20>'), {}, engine));
  }
  await noDemand('unknown IMG index', parse(source('<&IMG:<$STR(U101)>:1:20:20>')));
  await noDemand('local-input IMG index is display-only', parse(source('<&IMG:<$STR(U101)>:1:20:20>'), { U101: '7' }));
  await noDemand('unframed ITEMSHOW without database IDX', unframed(parse(source('<&ITEMSHOW:<$STR(U101)>:1:20:20:32:32>'))));
  await noDemand('unframed ITEMSHOW known IDX but absent Looks', unframed(parse(source('<&ITEMSHOW:935:1:20:20:32:32>'))));
  await noDemand('text item tooltip does not need an archive', parse(source('<TEXT:说明:20:20|ItemShow#935#0>')));

  // Runtime player inventory is not a reason to discover every client package.
  // Keep a typed item control but deliberately no independently static frame.
  const runtimeItem = parse(source('<TEXT:运行时物品:20:20>'));
  runtimeItem.scenes[0].elements[0].itemPreview = { mode: 'equipment', equipmentSlot: 0 };
  await noDemand('runtime equipment without a static frame', runtimeItem);

  // Valid-looking references serialized by an older preview must still pass
  // current role-specific gates. The demand preflight cannot bypass them.
  for (const status of ['dynamic', 'invalid', 'missing']) {
    const model = parse(source('<TEXT:状态按钮:20:20>'));
    Object.assign(model.scenes[0].elements[0], {
      assetRef: ref(7),
      assetStateDiagnostics: [{ role: 'normal', status, assetRef: ref(7) }],
    });
    await noDemand(`stateful ${status} stale reference`, model);
  }
  for (const sourceStatus of ['dynamic', 'invalid', 'disabled', 'reserved']) {
    const model = parse(source('<TEXT:列表:20:20>'));
    Object.assign(model.scenes[0].elements[0], {
      assetLayers: [{ role: 'scroll-thumb', assetRef: ref(7) }],
      containerPreview: { variant: 'list', label: '列表', scrollbarDiagnostics: [{ role: 'scroll-thumb', sourceStatus, status: sourceStatus, assetRef: ref(7) }] },
    });
    await noDemand(`list scrollbar ${sourceStatus} stale reference`, model);
  }
  const blockedAtlas = parse(source('<TextAtlas|text=0123|wil=NewopUI|pcimg=<$STR(U101)>|iwidth=14|iheight=24|x=20|y=20>'), { U101: '2522' }, '996PC');
  await noDemand('dynamic TextAtlas resource remains blocked', blockedAtlas);
  for (const status of ['dynamic', 'invalid', 'evidence-blocked']) {
    const model = parse(source('<TEXT:动作按钮:20:20>'));
    Object.assign(model.scenes[0].elements[0], {
      assetRef: ref(7), assetLayers: [{ role: 'hover', assetRef: ref(8) }],
      addButtonPreview: { command: 'ADDBUTTONEX', status, dynamicFields: [], invalidFields: [], effects: [{ state: 'normal', assetRef: ref(9), frameCount: 4 }] },
    });
    await noDemand(`ADDBUTTON ${status} stale references`, model);
  }
  const dynamicBackground = parse(source('<TEXT:背景:20:20>'));
  dynamicBackground.scenes[0].background = { status: 'dynamic', willIndex: 1, imageIndex: 7, dynamicFields: ['image-index'], assetRef: ref(7) };
  await noDemand('dynamic background refuses stale assetRef', dynamicBackground);
  const dynamicProgress = parse(source('<TEXT:进度:20:20>'));
  Object.assign(dynamicProgress.scenes[0].elements[0], {
    assetRef: ref(7), assetLayers: [{ role: 'progress', assetRef: ref(8) }],
    progressPreview: { variant: 'legacy', dynamicFields: ['archive'], frameCount: 4 },
  });
  await noDemand('progress dynamic archive blocks every layer', dynamicProgress);
  const dynamicMenu = parse(source('<TEXT:菜单:20:20>'), {}, '996PC');
  Object.assign(dynamicMenu.scenes[0].elements[0], {
    assetRef: ref(7), assetLayers: [{ role: 'arrow', assetRef: ref(8) }],
    menuPreview: { assetDiagnostics: [{ field: 'img', sourceStatus: 'dynamic', assetRef: ref(7) }, { field: 'arrowimg', sourceStatus: 'invalid', assetRef: ref(8) }] },
  });
  await noDemand('menu dynamic or invalid source blocks stale layers', dynamicMenu);

  const demand = async (name, model, expectedIndexes, options = {}) => check(name, async () => {
    const result = await hydrate(model, options);
    assert.equal(result.counts.scans, 1, 'one client file snapshot per demanded hydration');
    assert.equal(result.counts.cache, 1, 'one cache snapshot shared by all layer requests');
    assert.equal(result.counts.layout, 1, 'one source-root discovery per demanded hydration');
    for (const imageIndex of expectedIndexes) assert.ok(result.requests.some(request => request.imageIndex === imageIndex), `missing demanded slot ${imageIndex}`);
    assert.ok(result.snapshots.length > 0 && result.snapshots.every(snapshot => snapshot === result.snapshots[0]), 'all resolver calls share the same selected-package snapshot');
    assert.deepEqual(result.snapshots[0].resourceRoots, ['D:/preferred/Data', 'D:/base/Data']);
    assert.ok(Object.isFrozen(result.snapshots[0].resourceRoots), 'selected package roots are immutable during hydration');
    assert.ok(Object.isFrozen(result.snapshots[0].archiveFiles), 'archive-file selection is immutable during hydration');
    for (const scene of result.model.scenes) for (const element of scene.elements) {
      for (const diagnostic of [
        ...(element.menuPreview?.assetDiagnostics || []),
        ...(element.containerPreview?.scrollbarDiagnostics || []),
      ]) {
        if (diagnostic.asset?.status === 'ready') assert.equal(diagnostic.status, diagnostic.sourceStatus,
          'the collection-only probe must not leave missing/unavailable diagnostics on actual ready layers');
      }
    }
    return result;
  });
  await demand('ordinary image with a tooltip', parse(source('<IMG:7:1:20:20|说明>')), [7]);
  await demand('animation all frame slots', parse(source('<&PLAYIMG:1:7:4:100:20:20>')), [7, 8, 9, 10]);
  await demand('UIModel layered parts', parse(source('<UIModel|x=20|y=20|clothID=2540|weaponID=2523>'), {}, '996PC'), [2540, 2523]);
  await check('TextAtlas retains real dimension match', async () => {
    const result = await hydrate(parse(source('<TextAtlas|text=0123|wil=NewopUI|pcimg=2522|iwidth=14|iheight=24|x=20|y=20>'), {}, '996PC'));
    assert.equal(result.counts.scans, 1);
    const atlas = result.model.scenes[0].elements[0].imageTextPreview;
    assert.equal(atlas.assetContract, 'matched');
    assert.deepEqual(atlas.glyphs.map(glyph => glyph.sourceX), [0, 14, 28, 42]);
    assert.ok(atlas.glyphs.every(glyph => glyph.asset?.status === 'ready'));
  });
  await demand('ITEMSHOW database Looks demands Items slot', parse(source('<&ITEMSHOW:935:1:20:20:32:32>')), [1], { looks: 20001 });
  await check('ITEMSHOW preflight does not query Looks twice', async () => {
    const result = await hydrate(unframed(parse(source('<&ITEMSHOW:935:1:20:20:32:32>'))), { looks: 20001 });
    assert.equal(result.databaseRequests.filter(request => request.field === 'Looks').length, 1);
    assert.deepEqual(result.requests, [{ archiveName: 'Items2', imageIndex: 1 }]);
  });
  await demand('three-state control pixels', parse(source('<Button|x=20|y=20|wil=NewopUI|pcnimg=7|pcmimg=8|pcpimg=9|text=按钮>'), {}, '996PC'), [7, 8, 9]);
  await demand('MenuItem default resources', parse(source('<MenuItem|x=20|y=20|direction=1|itemname=甲#乙|select=甲>'), {}, '996PC'), [2000, 1451, 2047]);
  await demand('ListView scrollbar and interaction states', parse(source('<ListView|id=LV|x=20|y=20|direction=1|Slider=1|Sdbg=300|Sdupnimg=301|Sdupmimg=302|Sduppimg=303|Sdnimg=304|Sdmimg=305|Sdpimg=306|Sddwnimg=307|Sddwmimg=308|Sddwpimg=309>'), {}, '996PC'), [300, 301, 302, 303, 304, 305, 306, 307, 308, 309]);
  await demand('Slider background fill and thumb', parse(source('<Slider|wil=NewopUI|sliderid=N0|x=20|y=20|width=100|height=24|maxvalue=100|defvalue=50|pcbgimg=298|pcbarimg=299|pcballimg=297>'), {}, '996PC'), [298, 299, 297]);
  await demand('Progress fill animation slots', parse(source('<&PROGRESSBAR:70:80:10:100:101:3:100:2:3:0:200:50:0:250:4:5:%p/%m/%r:测试>')), [100, 101, 102, 103]);
  await demand('ADDBUTTONEX state and effect frames', parse('[@main]\n#ACT\nADDBUTTONEX 2|160|30|1|4 5 275|276|277 9 840|3|80|0|2|-3 850|2|100|1|4|5 860|4|120|0|-1|6 -1|253/特效提示 17\n#SAY\n按钮'), [275, 276, 277, 840, 841, 842, 850, 851, 860, 861, 862, 863]);
  const digitBank = parse(source('<TEXT:数字字库:20:20>'));
  digitBank.scenes[0].elements[0].imageTextPreview = { mode: 'individual', value: '7', glyphs: [{ character: '7', assetRef: ref(7) }], glyphBank: [{ character: '8', assetRef: ref(8) }] };
  await demand('individual glyph and glyph bank', digitBank, [7, 8]);

  const background = parse(source('<TEXT:背景:20:20>'));
  background.scenes[0].background = { status: 'static', willIndex: 1, imageIndex: 7 };
  await demand('static dialog background', background, [7]);
  const addDlg = parse(source('<TEXT:窗口:20:20>'));
  addDlg.scenes[0].addDlgWindow = { id: 'test-window', assetRef: ref(9) };
  await demand('ADDDLG window layer', addDlg, [9]);
  const itemLight = parse(source('<TEXT:发光:20:20>'), {}, 'GEE');
  itemLight.scenes[0].elements[0].itemPreview = { mode: 'equipment', lightCode: 1 };
  await check('static item light independent of runtime item', async () => {
    const result = await hydrate(itemLight);
    assert.ok(result.requests.length > 0 && result.counts.scans === 1);
    assert.ok(itemLight.scenes[0].elements[0].itemPreview.lightPreview.frames.every(frame => frame.status === 'ready'));
  });
  console.log(JSON.stringify({ cases, failures }));
  assert.equal(failures.length, 0, `failed demand cases: ${failures.join(', ')}`);
  console.log('preview-demand-hydration.test.js: PASS');
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
