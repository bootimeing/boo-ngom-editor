const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { makeContext, makeVscodeStub, loadCompiledProvider, makePanel } = require('./map-preview-persistent-tile-provider.test');
const { parseOriginalMap } = require('../out/utils/original-map');
const { listArchiveIndexSummaries, readArchiveImagePng, loadArchiveAssetTable } = require('../out/utils/archive-index');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');
const mapPath = 'D:/MirServer/Mir200/Map/boo_三山关.map';
const clientArchive = 'D:/老卢专用客户端/boo独家制作/data/SmTiles102.pak';
const output = path.join(root, 'artifacts', 'map-middle-word-r14');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  // This is explicitly a local real-sample gate, not a portable synthetic fallback.
  assert.ok(fs.existsSync(mapPath) && fs.existsSync(clientArchive), 'real MAP and SmTiles102 required');
  const originalBytes = fs.readFileSync(mapPath), mapHash = hash(originalBytes);
  const archiveHash = hash(fs.readFileSync(clientArchive));
  const indexRoot = path.join(process.env.LOCALAPPDATA, 'BOO-NGOM-Editor/cache/archive-index-v1');
  const archives = listArchiveIndexSummaries(indexRoot).filter(summary =>
    path.resolve(summary.pakPath).toLowerCase() === path.resolve(clientArchive).toLowerCase());
  assert.equal(archives.length, 1, 'real archive selection must be unambiguous');
  const archive = archives[0];
  const table = loadArchiveAssetTable(indexRoot, archive.archiveId);
  const model = await parseOriginalMap(originalBytes);
  assert.deepEqual([model.width, model.height, model.cellSize], [136, 154, 14]);
  const index = 59 * model.width + 58;
  assert.equal(originalBytes.readUInt16LE(52 + (58 * model.height + 59) * 14 + 2), 36985);
  assert.equal(model.middleImages[index], 36985, 'real MAP must not lose the middle-image top bit');
  assert.deepEqual([table.width[36984], table.height[36984]], [96, 64]);
  assert.deepEqual([table.width[4216], table.height[4216]], [48, 32]);
  let groundPlacements = 0;
  for (const value of model.middleImages) {
    if (!value) continue;
    groundPlacements++;
    assert.equal(table.present[value - 1], 1);
    assert.equal(table.blank[value - 1], 0);
    assert.deepEqual([table.width[value - 1], table.height[value - 1]], [96, 64]);
  }
  assert.equal(groundPlacements, 5236, 'full real-map ground inventory changed');
  // Isolate the ground layer in memory; no MAP/PAK writes and no alteration of
  // object semantics. Compare against the previous mask with identical input.
  model.frontImages = new Uint16Array(model.frontImages.length);
  const beforeModel = { ...model, middleImages: model.middleImages.map(value => value & 0x7fff) };
  const workspace = path.join(os.tmpdir(), 'boo-real-middle-readonly');
  const { MapPreviewProvider } = loadCompiledProvider(makeVscodeStub(workspace));
  const provider = new MapPreviewProvider(makeContext(workspace));
  provider.panel = makePanel([]); provider.currentMap = { key: 'real-middle' };
  provider.originalMapVersion = 1; provider.postOriginalProgress = () => {};
  provider.originalMapSourceContext = async () => ({
    definition: { id: 'GOM', shortLabel: 'GOM' }, resourceRoots: [path.dirname(clientArchive)],
    supportedExtensions: ['.pak'], archiveFiles: [clientArchive], sourceScanWarning: '',
  });
  provider.resolveOriginalArchive = name => {
    assert.equal(name, 'SmTiles102');
    return { status: 'ready', pak: {
      archiveId: archive.archiveId, storageMode: 'direct', pakPath: clientArchive,
      pakName: 'SmTiles102', cacheDir: path.join(indexRoot, archive.archiveId),
      manifestPath: path.join(indexRoot, archive.archiveId, 'summary.json'),
    } };
  };
  const pngHashes = {};
  async function dataFor(activeModel) {
    const session = { model: activeModel, mapKey: 'real-middle', generation: 1, latestViewportSeq: 1 };
    provider.originalMapSession = session;
    const data = await provider.resolveOriginalMapData(session, 1, 1,
      { left: 58, top: 59, right: 61, bottom: 62 }, 1);
    for (const resource of data.resources) {
      const imageIndex = Number(resource.key.split(':').pop());
      const png = await readArchiveImagePng({ extensionPath: root, indexRoot, archiveId: archive.archiveId, imageIndex });
      assert.equal(png.readUInt32BE(16), resource.width);
      assert.equal(png.readUInt32BE(20), resource.height);
      pngHashes[imageIndex] = hash(png);
      resource.url = `data:image/png;base64,${png.toString('base64')}`;
    }
    return data;
  }
  const before = await dataFor(beforeModel), after = await dataFor(model);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-middle-word-browser-'));
  fs.mkdirSync(output, { recursive: true });
  try {
    const harness = path.join(temporary, 'map.html');
    let html = fs.readFileSync(path.join(root, 'media/map-preview.html'), 'utf8');
    html = html.replace('<script>', '<script>window.acquireVsCodeApi=()=>({postMessage(){}});</script><script>');
    const samples = JSON.stringify({ before, after }).replace(/</g, '\\u003c');
    html = html.replace('</body>', `<script>
    (async()=>{try{
      const samples=${samples},results={},cards=[];
      resize();
      for(const key of ['before','after']){
        stopOriginalMapAnimation();clearOriginalPrefetchTimer();clearOriginalImageCache();releaseOriginalMapBase();
        state.map={width:136,height:154};state.worldW=6528;state.worldH=4928;
        state.scale=1;state.offsetX=-58*48;state.offsetY=-59*32;
        state.original.active=true;state.original.ready=true;state.original.requestId=1;
        state.original.generation=1;state.original.viewportSeq=1;
        await loadOriginalMapData({...samples[key],requestId:1,generation:1,viewportSeq:1,
          viewport:{left:58,top:59,right:61,bottom:62}},false);
        clearOriginalPrefetchTimer();drawOriginalMap(0,0);
        const pixels=ctx.getImageData(0,0,192,128).data;let holes=0;
        for(let i=0;i<pixels.length;i+=4)if(pixels[i]===17&&pixels[i+1]===17&&pixels[i+2]===17)holes++;
        results[key]={holes,pixels:192*128,resources:samples[key].resources.length};
        const copy=document.createElement('canvas');copy.width=192;copy.height=128;
        copy.getContext('2d').drawImage(canvas,0,0,192,128,0,0,192,128);
        copy.style='width:576px;height:384px;image-rendering:pixelated';cards.push(copy);
      }
      if(results.before.holes<15000)throw Error('old masked control did not reproduce checkerboard: '+JSON.stringify(results));
      if(results.after.holes!==0)throw Error('fixed real ground still contains canvas holes: '+JSON.stringify(results));
      document.body.replaceChildren();document.body.style='padding:20px;background:#181818;color:white;font:16px sans-serif';
      const heading=document.createElement('h2');heading.textContent='三山关真实 SmTiles102：左为旧序号，右为修正序号（地表层，3倍展示）';document.body.append(heading);
      const row=document.createElement('div');row.style='display:flex;gap:12px';cards.forEach(c=>row.append(c));document.body.append(row);
      const note=document.createElement('p');note.textContent=JSON.stringify(results);document.body.append(note);
      document.body.dataset.middleWord='pass';document.body.dataset.result=JSON.stringify(results);
    }catch(error){document.body.dataset.middleWord='fail';document.body.dataset.error=String(error.stack||error)}})();
    </script></body>`);
    fs.writeFileSync(harness, html);
    const browser = process.env.BOO_BROWSER_EXECUTABLE || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    const screenshot = path.join(output, 'real-ground-before-after.png');
    const result = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run',
      '--allow-file-access-from-files', '--force-device-scale-factor=1', '--window-size=1240,620',
      `--user-data-dir=${path.join(temporary, 'profile')}`, '--virtual-time-budget=5000',
      `--screenshot=${screenshot}`, '--dump-dom', pathToFileURL(harness).href],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    assert.equal(result.status, 0, result.error?.message || result.stderr);
    fs.writeFileSync(path.join(output, 'browser-dom.html'), result.stdout);
    assert.match(result.stdout, /data-middle-word="pass"/,
      /data-error="([^"]*)"/.exec(result.stdout)?.[1] || 'browser did not complete');
    const observed = JSON.parse(/data-result="([^"]*)"/.exec(result.stdout)[1].replace(/&quot;/g, '"'));
    assert.equal(hash(fs.readFileSync(mapPath)), mapHash, 'source MAP changed');
    assert.equal(hash(fs.readFileSync(clientArchive)), archiveHash, 'source PAK changed');
    const report = { mapPath, mapHash, clientArchive, archiveHash, archiveId: archive.archiveId,
      browser, observed, groundPlacements, pngHashes, screenshot, boundary: 'real MAP/PAK + production parser/Provider/Webview; stub host/discovery; ground only, not game-client comparison' };
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2));
    console.log('map-middle-word-real-browser.test.js: PASS '+JSON.stringify(observed));
    console.log(screenshot);
  } finally { removeTemporaryDirectory(temporary); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
