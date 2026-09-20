// Opt-in real-data benchmark. Production MapPreviewProvider + production HTML,
// a loopback transport replacing only VS Code IPC/URI plumbing, and real Edge.
// No OS cache flush, no user cache writes, no service-side script execution.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const output = path.resolve(process.env.BOO_MAP_PERF_OUTPUT || path.join(__dirname, '../artifacts/map-first-frame-r20'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const inside = (file, directory) => {
  const relative = path.relative(directory, path.resolve(String(file)));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], min: sorted[0], max: sorted.at(-1) };
};

async function worker(config) {
  const { makeContext, makeVscodeStub, loadCompiledProvider } = require('./map-preview-persistent-tile-provider.test');
  const serverRoot = process.env.BOO_TEST_MIRSERVER || 'D:/MirServer';
  const clientRoot = process.env.BOO_TEST_CLIENT_ROOT || 'D:/老卢专用客户端';
  const browser = process.env.BOO_BROWSER_EXECUTABLE || path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe');
  assert.ok(fs.existsSync(browser), 'real Chromium executable required');
  const mapPath = path.join(serverRoot, 'Mir200/Map', `${config.map}.map`);
  const mapBefore = hash(fs.readFileSync(mapPath));
  const runtimeFiles = ['out/providers/map-preview.js', 'out/utils/patch-cache.js', 'out/utils/archive-index.js', 'media/map-preview.html'];
  const runtimeHashes = Object.fromEntries(runtimeFiles.map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
  fs.mkdirSync(config.directory, { recursive: true });
  // Only derived map tiles are redirected; archive indices remain the actual
  // configured user cache, read-only. Do not populate a simplified fake index.
  const cache = require(path.join(root, 'out/utils/cache-storage'));
  cache.getOriginalMapTileCacheRoot = () => config.tiles;
  const { patchManagerStateKey } = require(path.join(root, 'out/utils/patch-cache'));
  const context = makeContext(config.directory);
  context.workspaceState.get = (key, fallback) => key === patchManagerStateKey('GOM')
    ? { clientDirectory: clientRoot, customPatchName: 'boo独家制作', passwordFile: '', entries: [], stateVersion: 1, engine: 'GOM' }
    : fallback;
  context.workspaceState.update = () => { throw Error('benchmark cannot write workspace state'); };
  const { MapPreviewProvider } = loadCompiledProvider(makeVscodeStub(serverRoot));
  const { readArchiveImagePng } = require(path.join(root, 'out/utils/archive-index'));
  const { readOriginalMapTile } = require(path.join(root, 'out/utils/original-map-tile-cache'));
  const provider = new MapPreviewProvider(context);
  provider.currentMap = { key: `benchmark:${config.map}`, mapId: config.map, originalMapId: config.map, name: config.map };
  const messages = [], resourceRequests = [], errors = [], stages = [], writes = [];
  let active = false, started = 0, lastTick = 0, maxGapMs = 0, peakRss = 0, browserResult, requestsAtFirstFrame = 0;
  const io = {}, originals = {}, writeDescriptors = new Set();
  for (const method of ['existsSync', 'statSync', 'readFileSync', 'readSync', 'readdirSync', 'openSync']) {
    originals[method] = fs[method];
    fs[method] = function (...args) {
      if (active) io[method] = (io[method] || 0) + 1;
      const writable = method === 'openSync' && String(args[1]) !== 'r';
      if (writable) assert.ok(inside(args[0], output), `write open escaped private artifacts: ${args[0]}`);
      const value = originals[method].apply(this, args);
      if (writable) writeDescriptors.add(value);
      return value;
    };
  }
  // Fail immediately if production code attempts a mutation outside our exact
  // private artifact tree. Production cache pruning cannot touch the user root.
  for (const method of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'utimesSync', 'unlinkSync', 'rmSync', 'rmdirSync', 'renameSync']) {
    originals[method] = fs[method];
    fs[method] = function (...args) {
      assert.ok(typeof args[0] === 'number' ? writeDescriptors.has(args[0]) : inside(args[0], output), `unexpected ${method} outside private artifacts: ${args[0]}`);
      if (method === 'renameSync') assert.ok(inside(args[1], output), 'rename target escaped private artifacts');
      writes.push(method); return originals[method].apply(this, args);
    };
  }
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  const timer = setInterval(() => {
    if (active) { const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - lastTick); lastTick = now; peakRss = Math.max(peakRss, process.memoryUsage().rss); }
  }, 2);
  provider.panel = { webview: {
    asWebviewUri: uri => ({ toString: () => `/resource?uri=${encodeURIComponent(uri.toString())}` }),
    postMessage: async message => { messages.push(message); return true; },
  } };
  const html = fs.readFileSync(path.join(root, 'media/map-preview.html'), 'utf8');
  const bridge = `<script>
  window.__perf={pending:0,stores:0,start:0,firstFrame:0,requests:[],errors:[]};
  window.acquireVsCodeApi=()=>({postMessage:async message=>{
    if(message.type==='ready')return;
    if(message.prefetch)return; // first-screen probe stops before background prefetch
    if(!['loadOriginalMap','loadOriginalMapViewport','storeOriginalMapTile'].includes(message.type))return;
    window.__perf.pending++;
    try{const response=await fetch('/message',{method:'POST',body:JSON.stringify(message)});
      const messages=await response.json();for(const data of messages){
        if(data.type==='originalMapError')window.__perf.errors.push(data.message);
        window.dispatchEvent(new MessageEvent('message',{data}));
      }
      if(message.type==='storeOriginalMapTile')window.__perf.stores++;
    }catch(error){window.__perf.errors.push(String(error))}finally{window.__perf.pending--}
  }});
  </script>`;
  const scenario = `<script>
  (async()=>{
    const p=window.__perf;
    resize();
    updateMap({map:{mapId:${JSON.stringify(config.map)},originalMapId:${JSON.stringify(config.map)},name:'Real MAP benchmark',width:1000,height:1000},engine:'GOM',maps:[],markers:[],npcs:[],spawns:[],safeZones:[],imageUrl:'',warning:''});
    p.start=performance.now();mapLayerToggle.click();
    const deadline=p.start+90000;
    while(performance.now()<deadline){
      if(state.original.ready&&state.original.layer){
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        p.firstFrame=performance.now()-p.start;break;
      }
      if(p.errors.length)break;
      await new Promise(r=>setTimeout(r,5));
    }
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data, colours=new Set();
    for(let i=0;i<pixels.length;i+=256)colours.add([pixels[i],pixels[i+1],pixels[i+2],pixels[i+3]].join(','));
    const result={firstFrameMs:p.firstFrame,warning:state.original.warning,errors:p.errors,distinctSamplePixels:colours.size,
      viewport:state.original.appliedViewport,resources:state.original.layer?.resources.length||0,
      chunks:state.original.layer?.staticChunks.length||0,usesStaticChunks:state.original.layer?.usesStaticChunks||false,
      jsHeapBytes:performance.memory?.usedJSHeapSize||null,
      imageCacheBytes:state.original.imageCacheBytes,staticChunkCacheBytes:state.original.staticChunkCacheBytes,
      viewportPixels:[canvas.width,canvas.height],userAgent:navigator.userAgent};
    // Freeze measurement at first actual committed frame; allow already started
    // uploads to finish so a new process can prove persistent-cache reuse.
    clearOriginalPrefetchTimer();stopOriginalMapAnimation();
    await fetch('/first-frame',{method:'POST',body:'{}'});
    const flushDeadline=performance.now()+15000;
    const expectedStores=${JSON.stringify(config.mode)}==='cold'&&result.usesStaticChunks?result.chunks:0;
    while((p.pending||p.stores<expectedStores)&&performance.now()<flushDeadline)await new Promise(r=>setTimeout(r,20));
    result.stores=p.stores;result.flushComplete=p.pending===0&&p.stores>=expectedStores;
    await fetch('/result',{method:'POST',body:JSON.stringify(result)});
    document.body.dataset.benchmark='complete';
  })().catch(async error=>fetch('/result',{method:'POST',body:JSON.stringify({errors:[String(error)]})}));
  </script>`;
  const reply = (res, status, data, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/') return reply(res, 200, html.replace('<script>', `${bridge}<script>`).replace('</body>', `${scenario}</body>`), 'text/html; charset=utf-8');
      if (url.pathname === '/resource') {
        const uri = decodeURIComponent(url.searchParams.get('uri') || '');
        let png;
        const archive = /^boo-archive:\/([a-f0-9]{64})\/(\d+)\.png$/.exec(uri);
        const tile = /^boo-map-tile:\/([a-f0-9]{64})\/(c\d+-r\d+)\.png$/.exec(uri);
        if (archive) png = await readArchiveImagePng({ extensionPath: root, indexRoot: cache.getArchiveIndexRoot(context), archiveId: archive[1], imageIndex: Number(archive[2]) });
        else if (tile) png = readOriginalMapTile({ cacheRoot: config.tiles, cacheKey: tile[1], chunkId: tile[2], mapWidth: provider.originalMapSession.model.width, mapHeight: provider.originalMapSession.model.height });
        else throw Error(`unsupported resource URI ${uri}`);
        assert.ok(png?.length, 'empty production image');
        resourceRequests.push({ uri, bytes: png.length, atMs: performance.now() - started });
        return reply(res, 200, png, 'image/png');
      }
      if (req.method === 'POST') {
        const chunks = [];for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        if (url.pathname === '/first-frame') { active = false; requestsAtFirstFrame = resourceRequests.length; reply(res, 200, { ok: true }); return; }
        if (url.pathname === '/result') { browserResult = body; active = false; reply(res, 200, { ok: true }); finish(); return; }
        if (url.pathname === '/message') {
          if (body.type === 'loadOriginalMap') { started = lastTick = performance.now(); active = true; peakRss = process.memoryUsage().rss; }
          const before = performance.now();
          assert.ok(['loadOriginalMap', 'loadOriginalMapViewport', 'storeOriginalMapTile'].includes(body.type));
          await provider[body.type](body);
          const sent = messages.splice(0);
          stages.push({ method: body.type, elapsedMs: performance.now() - before,
            messages: sent.map(m => ({ type: m.type, resources: m.resources?.length, cachedChunks: m.staticChunks?.filter(c => c.cached).length, staticSourceIncluded: m.staticSourceIncluded, bytes: Buffer.byteLength(JSON.stringify(m)) })) });
          return reply(res, 200, sent);
        }
      }
      reply(res, 404, { error: 'not found' });
    } catch (error) { errors.push(String(error)); reply(res, 500, { error: String(error) }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--disable-background-networking', '--enable-precise-memory-info', '--window-size=1280,720', `--user-data-dir=${path.join(config.directory, 'browser-profile')}`, `http://127.0.0.1:${server.address().port}/`], { windowsHide: true, stdio: 'ignore' });
  const closed = new Promise(resolve => child.once('close', resolve));
  try {
    await Promise.race([completed, new Promise((_, reject) => { const deadline = setTimeout(() => reject(Error('real MAP benchmark timeout')), 110000); deadline.unref(); }), new Promise((_, reject) => child.once('error', reject))]);
    assert.ok(browserResult.firstFrameMs > 0, JSON.stringify(browserResult));
    assert.ok(browserResult.distinctSamplePixels > 8, 'committed canvas must contain real map pixels');
    assert.deepEqual(browserResult.errors, []); assert.deepEqual(errors, []);
    assert.equal(browserResult.flushComplete, true);
    assert.equal(hash(fs.readFileSync(mapPath)), mapBefore, 'MAP source changed');
    for (const [file, before] of Object.entries(runtimeHashes)) assert.equal(hash(fs.readFileSync(path.join(root, file))), before, `runtime changed during sample: ${file}`);
    const result = { ...config, runtimeHashes, mapSha256: mapBefore, browser: browserResult, node: { peakRssBytes: Math.max(peakRss, process.memoryUsage().rss), maxEventLoopGapMs: maxGapMs, syncIo: io, maxRssBytes: process.resourceUsage().maxRSS * 1024 },
      stages, resourceRequests, requestsAtFirstFrame, resourceBytes: resourceRequests.reduce((sum, r) => sum + r.bytes, 0), writes: writes.length,
      methodology: 'New Node and browser for every sample. Cold=empty private static cache; warm=existing static cache across processes. OS filesystem cache not flushed. Node RSS only; browser JS/backing estimates reported separately. Synthetic click, real Chromium rendering, not VS Code native input.' };
    fs.writeFileSync(path.join(config.directory, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: 'PASS', map: config.map, mode: config.mode, firstFrameMs: browserResult.firstFrameMs, resources: resourceRequests.length }));
  } finally {
    clearInterval(timer); active = false;
    if (child.exitCode === null) child.kill();
    await closed; await new Promise(resolve => server.close(resolve));
    for (const [method, original] of Object.entries(originals)) fs[method] = original;
    provider.dispose?.();
  }
}

async function main() {
  if (process.argv[2] === '--worker') return worker(JSON.parse(process.argv[3]));
  const samples = Math.max(1, Number(process.env.BOO_MAP_PERF_SAMPLES || 7));
  const maps = (process.env.BOO_MAP_PERF_MAPS || 'NEW_WYC,WX6').split(',');
  const variants = process.env.BOO_MAP_PERF_BASELINE_RUNTIME
    ? [{ name: 'baseline', runtime: path.resolve(process.env.BOO_MAP_PERF_BASELINE_RUNTIME) }, { name: 'current', runtime: root }]
    : [{ name: 'current', runtime: root }];
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  for (const map of maps) for (let n = 0; n < samples; n++) for (const variant of variants) {
    const tiles = path.join(output, variant.name, `${map}-${n}`, 'tiles');
    assert.equal(fs.existsSync(tiles), false, `choose a fresh output directory: ${tiles}`);
    for (const mode of ['cold', 'warm']) {
      const config = { map, mode, sample: n, variant: variant.name, tiles, directory: path.join(output, variant.name, `${map}-${n}`, mode) };
      const run = spawnSync(process.execPath, [__filename, '--worker', JSON.stringify(config)], { encoding: 'utf8', windowsHide: true, timeout: 130000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, BOO_NPC_DIALOG_RUNTIME_ROOT: variant.runtime } });
      fs.mkdirSync(config.directory, { recursive: true });
      fs.writeFileSync(path.join(config.directory, 'process.log'), `${run.stdout || ''}\n${run.stderr || ''}`);
      assert.equal(run.status, 0, `${map}/${mode}: ${run.stderr || run.error}`);
      const result = JSON.parse(fs.readFileSync(path.join(config.directory, 'result.json'), 'utf8'));
      results.push(result); console.log(run.stdout.trim());
    }
  }
  const groups = variants.flatMap(variant => maps.flatMap(map => ['cold', 'warm'].map(mode => {
    const rows = results.filter(r => r.map === map && r.mode === mode && r.variant === variant.name);
    for (const row of rows) assert.deepEqual(row.runtimeHashes, results.find(r => r.variant === variant.name).runtimeHashes, 'runtime changed across samples');
    return { variant: variant.name, map, mode, samples: rows.length, firstFrameMs: summary(rows.map(r => r.browser.firstFrameMs)), providerMs: summary(rows.map(r => r.stages.filter(s => s.method !== 'storeOriginalMapTile').reduce((sum, s) => sum + s.elapsedMs, 0))),
      maxEventLoopGapMs: summary(rows.map(r => r.node.maxEventLoopGapMs)), nodePeakRssBytes: summary(rows.map(r => r.node.peakRssBytes)), resourceRequests: summary(rows.map(r => r.resourceRequests.length)), resourceBytes: summary(rows.map(r => r.resourceBytes)),
      staticSourceIncluded: [...new Set(rows.flatMap(r => r.stages.flatMap(s => s.messages.filter(m => m.type === 'originalMapViewportData').map(m => m.staticSourceIncluded))))] };
  })));
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ status: 'PASS', groups, samples: results.length, createdAt: new Date().toISOString(), runtimeRoot: root, methodology: results[0].methodology }, null, 2));
  console.log(JSON.stringify(groups, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
