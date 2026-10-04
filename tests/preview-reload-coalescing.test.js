const assert = require('node:assert/strict');
const { parse } = require('./preview-inputs-integration.test');
const { manager } = require('./helpers/preview-image-hydration');

const source = text => `[@main]\n#SAY\n<TEXT:${text}:30:30>`;
function fixture() {
  const posted = [];
  const document = { uri: { toString: () => 'file:///D:/reload-fixture.txt', fsPath: 'D:/reload-fixture.txt' },
    fileName: 'D:/reload-fixture.txt', version: 1, isClosed: false, text: source('初始'), getText() { return this.text; } };
  const host = manager();
  host.hydrateAssets = async () => {};
  host.isCompanionSource = (_session, uri) => uri.fsPath === 'D:/helper.txt';
  host.programSourcesCurrent = () => true;
  const model = parse(document.text, {}, 'GOM', { documentVersion: 1 });
  const session = { key: 'reload', document, model, modelRevision: 1, dirty: false, conflict: false, applying: false,
    previewConditions: {}, previewValues: {}, previewPath: [], disposables: [],
    panel: { webview: { postMessage: message => { posted.push(message); return Promise.resolve(true); } } } };
  host.sessions = new Map([[session.key, session]]);
  let builds = 0;
  host.createModel = async doc => { builds++; return parse(doc.getText(), {}, 'GOM', { documentVersion: doc.version }); };
  const change = text => { document.text = source(text); document.version++; host.onDocumentChanged({ document, contentChanges: [{ text }] }); };
  return { host, session, document, posted, change, builds: () => builds };
}

async function drain() { for (let step = 0; step < 40; step++) await Promise.resolve(); }
async function run() {
  const originalSet = global.setTimeout, originalClear = global.clearTimeout;
  const timers = new Map(); let sequence = 0;
  global.setTimeout = (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; };
  global.clearTimeout = id => timers.delete(id);
  const flush = async () => { const due = [...timers.values()]; timers.clear(); for (const item of due) item.callback(); await drain(); };
  try {
    const burst = fixture();
    for (let index = 0; index < 30; index++) burst.change(`输入${index}`);
    assert.equal(burst.builds(), 0, 'a synchronous burst must not start thirty parses');
    assert.equal(timers.size, 1, 'only the latest pending debounce timer survives');
    await flush();
    assert.equal(burst.builds(), 1);
    assert.equal(burst.posted.filter(message => message.type === 'model').length, 1);
    assert.equal(burst.session.model.pages[0].elements[0].text, '输入29');

    const flight = fixture(); let releases = [], started = 0, active = 0, maxActive = 0;
    flight.host.createModel = async doc => {
      started++; active++; maxActive = Math.max(maxActive, active);
      const text = doc.getText(), version = doc.version;
      await new Promise(resolve => releases.push(resolve)); active--;
      return parse(text, {}, 'GOM', { documentVersion: version });
    };
    flight.change('首轮'); await flush(); assert.equal(started, 1);
    for (let index = 0; index < 30; index++) flight.change(`最新${index}`);
    await flush(); assert.equal(started, 1, 'in-flight automatic work is single-flight');
    releases.shift()(); await drain();
    assert.equal(started, 2, 'all pending edits become only one latest follow-up');
    assert.equal(flight.posted.filter(message => message.type === 'model').length, 0, 'obsolete first parse must not publish');
    releases.shift()(); await drain();
    assert.equal(maxActive, 1);
    assert.equal(flight.session.model.pages[0].elements[0].text, '最新29');
    assert.equal(flight.posted.filter(message => message.type === 'model').length, 1);

    const manual = fixture(); manual.change('手动最新');
    await manual.host.reloadSession(manual.session, true);
    assert.equal(manual.builds(), 1, 'explicit reload remains immediate');
    assert.equal(timers.size, 0, 'explicit reload consumes pending automatic work');
    await flush(); assert.equal(manual.builds(), 1);

    const manualDuringFlight = fixture(); let releaseObsoleteAutomatic, flightBuilds = 0;
    manualDuringFlight.host.createModel = async doc => {
      const text = doc.getText(), version = doc.version;
      if (++flightBuilds === 1) await new Promise(resolve => { releaseObsoleteAutomatic = resolve; });
      return parse(text, {}, 'GOM', { documentVersion: version });
    };
    manualDuringFlight.change('手动刷新已是当前源码'); await flush();
    assert.equal(flightBuilds, 1);
    await manualDuringFlight.host.reloadSession(manualDuringFlight.session, true);
    assert.equal(flightBuilds, 2);
    assert.equal(manualDuringFlight.session.publishedPreview.model.documentVersion, manualDuringFlight.document.version);
    assert.equal(manualDuringFlight.session.automaticReload.running, true, 'obsolete automatic computation is still physically in flight');
    await manualDuringFlight.host.onMessage(manualDuringFlight.session, { type: 'dirtyChanged', dirty: true });
    assert.equal(manualDuringFlight.session.conflict, false, 'an obsolete auto parse must not invalidate a new draft on the current manually published model');
    releaseObsoleteAutomatic(); await drain();
    assert.equal(manualDuringFlight.session.dirty, true);
    assert.equal(manualDuringFlight.session.conflict, false);
    assert.equal(manualDuringFlight.posted.filter(message => message.type === 'model').length, 1);
    assert.equal(manualDuringFlight.posted.filter(message => message.type === 'conflict').length, 0);

    const manualThenNewSource = fixture(); let releaseBeforeManual, releaseNewest, mixedBuilds = 0;
    manualThenNewSource.host.createModel = async doc => {
      const text = doc.getText(), version = doc.version;
      const build = ++mixedBuilds;
      if (build === 1) await new Promise(resolve => { releaseBeforeManual = resolve; });
      if (build === 3) await new Promise(resolve => { releaseNewest = resolve; });
      return parse(text, {}, 'GOM', { documentVersion: version });
    };
    manualThenNewSource.change('首轮自动'); await flush();
    await manualThenNewSource.host.reloadSession(manualThenNewSource.session, true);
    assert.equal(mixedBuilds, 2);
    manualThenNewSource.change('手动之后的新源码'); await flush();
    assert.equal(mixedBuilds, 2, 'a manual refresh must not release the old automatic flight lock');
    releaseBeforeManual(); await drain();
    assert.equal(mixedBuilds, 3, 'obsolete auto completion must drain a newer source event after manual refresh');
    assert.equal(manualThenNewSource.posted.filter(message => message.type === 'model').length, 1, 'only the manual model published before newest automatic completion');
    releaseNewest(); await drain();
    assert.equal(manualThenNewSource.session.model.pages[0].elements[0].text, '手动之后的新源码');
    assert.equal(manualThenNewSource.posted.filter(message => message.type === 'model').length, 2);

    const failedFlight = fixture(); let rejectObsolete, failedBuilds = 0;
    failedFlight.host.createModel = async doc => {
      const text = doc.getText(), version = doc.version;
      if (++failedBuilds === 1) await new Promise((_resolve, reject) => { rejectObsolete = reject; });
      return parse(text, {}, 'GOM', { documentVersion: version });
    };
    failedFlight.change('即将失败的旧源码'); await flush();
    failedFlight.change('失败后仍需刷新'); await flush();
    rejectObsolete(new Error('obsolete parse failed')); await drain();
    assert.equal(failedBuilds, 2, 'an obsolete rejection must not strand pending latest source');
    assert.equal(failedFlight.session.model.pages[0].elements[0].text, '失败后仍需刷新');
    assert.equal(failedFlight.posted.filter(message => message.type === 'conflict').length, 0, 'obsolete errors must not poison the latest source');

    const disposed = fixture(); disposed.change('不应再计算'); disposed.host.disposeSession(disposed.session);
    await flush(); assert.equal(disposed.builds(), 0);
    const disposedFlight = fixture(); let releaseDisposed, disposedBuilds = 0;
    disposedFlight.host.createModel = async doc => {
      disposedBuilds++;
      const text = doc.getText(), version = doc.version;
      await new Promise(resolve => { releaseDisposed = resolve; });
      return parse(text, {}, 'GOM', { documentVersion: version });
    };
    disposedFlight.change('运行中'); await flush(); disposedFlight.change('释放前的新事件');
    disposedFlight.host.disposeSession(disposedFlight.session); releaseDisposed(); await drain(); await flush();
    assert.equal(disposedBuilds, 1);
    assert.equal(disposedFlight.posted.length, 0, 'disposed sessions neither publish old models nor launch queued work');
    const closed = fixture(); closed.change('关闭前'); closed.document.isClosed = true; closed.host.onDocumentClosed(closed.document);
    await flush(); assert.equal(closed.builds(), 0); assert.equal(closed.session.conflict, true);

    const drafts = fixture(); drafts.session.dirty = true; drafts.change('外部编辑');
    assert.equal(timers.size, 0); assert.equal(drafts.builds(), 0); assert.equal(drafts.session.conflict, true);
    const newlyDirty = fixture(); newlyDirty.change('已有新源');
    await newlyDirty.host.onMessage(newlyDirty.session, { type: 'dirtyChanged', dirty: true });
    await flush(); assert.equal(newlyDirty.builds(), 0); assert.equal(newlyDirty.session.dirty, true);
    assert.equal(newlyDirty.session.conflict, true, 'pending changed source must not erase a new coordinate draft');

    const companion = fixture();
    for (let index = 0; index < 30; index++) companion.host.onDocumentChanged({ document: { uri: { fsPath: 'D:/helper.txt', toString: () => 'file:///D:/helper.txt' } } });
    assert.equal(companion.builds(), 0); await flush(); assert.equal(companion.builds(), 1);
    console.log('preview-reload-coalescing.test.js: PASS 30->1, single-flight/latest-wins, explicit reload, disposed/closed/draft/companion guards; production Provider with API stubs and controlled timers');
  } finally { global.setTimeout = originalSet; global.clearTimeout = originalClear; }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { run };
