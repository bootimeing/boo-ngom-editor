const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const runtime = path.resolve(process.env.BOO_SCRIPT_RUNTIME_ROOT || path.join(__dirname, '..'));
let cases = 0;
function check(name, body) { body(); cases++; console.log(`map-config-links: PASS - ${name}`); }
async function checkAsync(name, body) { await body(); cases++; console.log(`map-config-links: PASS - ${name}`); }

class TestUri {
  constructor(value) {
    this.value = value;
    this.scheme = value.split(':')[0];
    this.fsPath = this.scheme === 'file' ? fileURLToPath(value) : '';
  }
  static file(value) { return new TestUri(pathToFileURL(path.resolve(value)).href); }
  static parse(value) { return new TestUri(value); }
  static from(value) { return new TestUri(`${value.scheme}://${value.authority || ''}${value.path || ''}`); }
  toString() { return this.value; }
  toJSON() { return { scheme: this.scheme, path: this.fsPath, fsPath: this.fsPath }; }
}
class TestRange {
  constructor(line, start, endLine, end) { this.start = { line, character: start }; this.end = { line: endLine, character: end }; }
}
class TestLink { constructor(range, target) { this.range = range; this.target = target; } }
class TestEventEmitter { constructor() { this.event = () => ({ dispose() {} }); } fire() {} dispose() {} }

function makeDocument(fileName, text) {
  return {
    fileName, uri: TestUri.file(fileName), version: 1,
    getText() { return text; },
    get lineCount() { return text.split(/\r?\n|\r/).length; },
    lineAt(index) { return { text: text.split(/\r?\n|\r/)[index] }; },
    replace(value) { text = value; this.version++; },
  };
}
function linkText(document, link) {
  return document.lineAt(link.range.start.line).text.slice(link.range.start.character, link.range.end.character);
}
function argsFor(link) { return JSON.parse(decodeURIComponent(link.target.toString().split('?')[1])); }
function mapBytes(width) {
  const data = Buffer.alloc(52 + width * 14);
  data.writeUInt16LE(width, 0); data.writeUInt16LE(1, 2);
  return data;
}

async function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-map-config-links-'));
  const warnings = [], panels = [], opened = [], scopedConfigs = [];
  const serverA = path.join(temporary, '服一'), serverB = path.join(temporary, '服二');
  const envirA = path.join(serverA, 'Mir200', 'Envir'), envirB = path.join(serverB, 'Mir200', 'Envir');
  for (const envir of [envirA, envirB]) fs.mkdirSync(envir, { recursive: true });
  for (const [server, width] of [[serverA, 1], [serverB, 2]]) {
    fs.mkdirSync(path.join(server, 'Mir200', 'Map'));
    fs.writeFileSync(path.join(server, 'Mir200', 'Map', '0.MAP'), mapBytes(width));
    fs.writeFileSync(path.join(server, 'Mir200', 'Map', 'ERSG.map'), mapBytes(width + 2));
    fs.writeFileSync(path.join(server, 'Mir200', 'Envir', 'MapInfo.txt'), '[0 磁盘地图]\r\n[D001|ERSG 磁盘副本]');
  }
  const vscode = {
    Uri: TestUri, Range: TestRange, DocumentLink: TestLink,
    EventEmitter: TestEventEmitter, Disposable: class { dispose() {} },
    ViewColumn: { Active: 1 }, FileType: { File: 1, Directory: 2 },
    workspace: {
      workspaceFolders: [{ uri: TestUri.file(temporary) }], textDocuments: [],
      getWorkspaceFolder() { return { uri: TestUri.file(temporary) }; },
      getConfiguration(_section, scope) {
        scopedConfigs.push(scope?.fsPath);
        return { get(key, fallback) { return key === 'engine' ? 'GOM' : fallback; } };
      },
      onDidChangeWorkspaceFolders() { return { dispose() {} }; },
      onDidChangeConfiguration() { return { dispose() {} }; },
      async openTextDocument(uri) {
        opened.push(uri.fsPath);
        const document = makeDocument(uri.fsPath, fs.readFileSync(uri.fsPath, 'utf8'));
        this.textDocuments.push(document); return document;
      },
    },
    window: {
      showWarningMessage(value) { warnings.push(value); },
      createWebviewPanel() {
        const messages = [];
        const panel = {
          messages, revealed: 0, receive: undefined,
          reveal() { this.revealed++; }, onDidDispose() {}, dispose() {},
          webview: {
            cspSource: 'https://test.local', options: {},
            asWebviewUri(uri) { return uri; },
            postMessage(value) { messages.push(value); return Promise.resolve(true); },
            onDidReceiveMessage(callback) { panel.receive = callback; },
          },
        };
        panels.push(panel); return panel;
      },
    },
  };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const { parseMapInfoLine, parseMapInfoText } = require(path.join(runtime, 'out/utils/map-preview'));
    const { parseMonGenLine } = require(path.join(runtime, 'out/utils/map-entities'));
    const { MapInfoLinkProvider } = require(path.join(runtime, 'out/providers/map-info-link'));
    const { MonGenLinkProvider } = require(path.join(runtime, 'out/providers/mongen-link'));
    const { MapPreviewProvider } = require(path.join(runtime, 'out/providers/map-preview'));
    const mapLinks = new MapInfoLinkProvider(), monLinks = new MonGenLinkProvider();
    const mapDoc = makeDocument(path.join(envirB, 'MapInfo.txt'), [
      '\uFEFF  [0 长安] DAY ; 长安 outside',
      '\t[D001 | ERSG 长安 副本  ] DARK',
      '[长安 长安] NORECALL',
      ';[2 注释地图]', '//[3 注释地图]', '[4]',
      '[../escape 不安全]', '[D2|<$STR(S1)> 动态]', '长安',
      '[5 长安] DAY',
    ].join('\r\n'));
    check('exact standard, alias, repeated ID/name and repeated display-name spans', () => {
      const links = mapLinks.provideDocumentLinks(mapDoc);
      assert.deepEqual(links.map(link => linkText(mapDoc, link)), ['长安', '长安 副本', '长安', '长安']);
      assert.deepEqual(links.map(link => argsFor(link)), [1, 2, 3, 10].map(line => [mapDoc.uri.toString(), line]));
      assert.ok(links.every(link => link.target.toString().startsWith('command:boo.openMapInfoOriginalMap?')));
      assert.equal(panels.length, 0, 'link lookup never opens a map');
      assert.equal(warnings.length, 0, 'link lookup never prompts');
    });
    check('other files, nested MapInfo and non-file documents have no accidental name links', () => {
      for (const file of [path.join(envirB, 'other.txt'), path.join(envirB, 'QuestDiary', 'MapInfo.txt'), path.join(temporary, 'MapInfo.txt')]) {
        assert.deepEqual(mapLinks.provideDocumentLinks(makeDocument(file, '[0 长安]')), []);
      }
      const document = makeDocument(path.join(envirB, 'MapInfo.txt'), '[0 长安]');
      document.uri = TestUri.parse('untitled:MapInfo.txt');
      assert.deepEqual(mapLinks.provideDocumentLinks(document), []);
    });
    check('single-line helper and catalogue share semantics without linking fallback names', () => {
      const raw = '\t [D001|ERSG 长安副本] DARK';
      const parsed = parseMapInfoLine(raw, 7);
      assert.equal(raw.slice(parsed.nameSpan.start, parsed.nameSpan.end), '长安副本');
      assert.deepEqual(parseMapInfoText(raw)[0], { ...parsed.entry, key: '1:D001', lineNumber: 1 });
      assert.equal(parseMapInfoLine('[0]', 1).nameSpan, undefined);
    });
    const monDoc = makeDocument(path.join(envirB, 'MonGen.txt'), [
      '\uFEFF\tD001 152 97 练功师 0 1 1 ;练功师 outside',
      ';0 1 2 注释 3 1', '//0 1 2 注释 3 1',
      '0 1 2 <$STR(S1)> 3 1', '0 1 2 ../逃逸 3 1',
    ].join('\r\n'));
    check('MonGen links only map and monster columns, without creating missing MonItems', () => {
      const links = monLinks.provideDocumentLinks(monDoc);
      assert.deepEqual(links.map(link => linkText(monDoc, link)), ['D001', '练功师', '0', '0']);
      assert.equal(links[0].target.toString().split('?')[0], 'command:boo.openMonGenOriginalMap');
      assert.equal(links[1].target.toString().split('?')[0], 'command:boo.createMissingFile');
      assert.equal(argsFor(links[1])[1], '练功师');
      assert.equal(argsFor(links[1])[2], 'monGen');
      assert.equal(argsFor(links[1])[3], 1);
      assert.equal(fs.existsSync(path.join(envirB, 'MonItems')), false);
      const parsed = parseMonGenLine(monDoc.lineAt(0).text, 1);
      assert.equal(parsed.spawn.mapName, 'D001');
      assert.equal(monDoc.lineAt(0).text.slice(parsed.columns[3].start, parsed.columns[3].end), '练功师');
    });
    check('nested or foreign MonGen files cannot generate map or drop-file links', () => {
      for (const file of [path.join(envirB, 'QuestDiary', 'MonGen.txt'), path.join(temporary, 'MonGen.txt')]) {
        assert.deepEqual(monLinks.provideDocumentLinks(makeDocument(file, '0 152 97 练功师 0 1 1')), []);
      }
    });
    check('escaped MonItems junction blocks drop-file links but does not hide valid map links', () => {
      const envir = path.join(temporary, 'unsafe-drops', 'Mir200', 'Envir');
      const outside = path.join(temporary, 'outside-drops');
      fs.mkdirSync(envir, { recursive: true }); fs.mkdirSync(outside);
      const junction = path.join(envir, 'MonItems');
      fs.symlinkSync(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
      try {
        const document = makeDocument(path.join(envir, 'MonGen.txt'), '0 152 97 练功师 0 1 1');
        const links = monLinks.provideDocumentLinks(document);
        assert.equal(links.length, 1);
        assert.equal(linkText(document, links[0]), '0');
        assert.equal(links[0].target.toString().split('?')[0], 'command:boo.openMonGenOriginalMap');
        assert.deepEqual(fs.readdirSync(outside), []);
      } finally { process.platform === 'win32' ? fs.rmdirSync(junction) : fs.unlinkSync(junction); }
    });
    check('existing drop file links prefer own server, case insensitive and preserve original bytes', () => {
      const dropsA = path.join(envirA, 'MonItems'), dropsB = path.join(envirB, 'monitems');
      fs.mkdirSync(dropsA); fs.mkdirSync(dropsB);
      fs.writeFileSync(path.join(dropsA, '练功师.txt'), 'wrong server');
      const own = path.join(dropsB, '练功师.TXT'); fs.writeFileSync(own, 'existing drop');
      const monster = monLinks.provideDocumentLinks(monDoc).find(link => linkText(monDoc, link) === '练功师');
      assert.equal(monster.target.fsPath, own);
      assert.equal(fs.readFileSync(own, 'utf8'), 'existing drop');
    });
    check('5387-row DocumentLink query enumerates Envir and MonItems once each', () => {
      const document = makeDocument(path.join(envirB, 'MonGen.txt'), Array.from({ length: 5387 }, () => '0 152 97 练功师 0 1 1').join('\n'));
      const readdir = fs.readdirSync;
      let directoryReads = 0;
      fs.readdirSync = function(file, options) {
        if ([envirB, path.join(envirB, 'monitems')].includes(file)) directoryReads++;
        return readdir.call(this, file, options);
      };
      try {
        assert.equal(monLinks.provideDocumentLinks(document).length, 5387 * 2);
        assert.equal(directoryReads, 2, 'no per-row directory scan');
      } finally { fs.readdirSync = readdir; }
    });
    const state = { get(_key, fallback) { return fallback; }, async update() {} };
    const provider = new MapPreviewProvider({
      extensionPath: runtime, extensionUri: TestUri.file(runtime),
      globalStorageUri: TestUri.file(path.join(temporary, 'storage')),
      globalState: state, workspaceState: state, subscriptions: [],
    });
    const entityRoots = [];
    provider.clientResourceLayout = () => undefined;
    provider.resolveMiniMapImage = () => undefined;
    provider.readMapEntities = root => {
      entityRoots.push(root);
      return { npcs: [], spawns: [], safeZones: [], resourceRoots: [], warnings: [] };
    };
    const dirtyA = makeDocument(path.join(envirA, 'MapInfo.txt'), '[0 脏地图甲]\r\n[D001|ERSG 脏副本甲]');
    const dirtyB = makeDocument(path.join(envirB, 'MapInfo.txt'), '[0 脏地图乙]\r\n[D001|ERSG 脏副本乙]');
    vscode.workspace.textDocuments.push(dirtyA, dirtyB, monDoc);
    await checkAsync('click reads dirty source and selects original mode via existing load protocol', async () => {
      await provider.revealMapInfoOriginalMap(dirtyA.uri.toString(), 1);
      assert.equal(opened.length, 0, 'already-open dirty text is authoritative');
      assert.equal(provider.currentMap.name, '脏地图甲');
      const panel = panels[0]; panel.receive({ type: 'ready' });
      const data = panel.messages.find(message => message.type === 'mapData');
      assert.equal(data.originalMap, true);
      assert.equal(data.map.width, 1);
      assert.equal(entityRoots.at(-1), serverA);
      await provider.loadOriginalMap({ requestId: 1 });
      assert.equal(provider.originalMapSession.filePath.toLowerCase(), path.join(serverA, 'Mir200', 'Map', '0.map').toLowerCase());
    });
    await checkAsync('same-key map in second server invalidates the first session and never borrows its file', async () => {
      const previous = provider.originalMapSession;
      await provider.revealMapInfoOriginalMap(dirtyB.uri.toString(), 1);
      assert.equal(provider.currentMap.name, '脏地图乙');
      assert.equal(provider.originalMapSession, undefined);
      assert.equal(entityRoots.at(-1), serverB);
      await provider.loadOriginalMap({ requestId: 2 });
      assert.notEqual(provider.originalMapSession, previous);
      assert.equal(provider.originalMapSession.model.width, 2);
      assert.ok(scopedConfigs.includes(dirtyB.fileName));
    });
    await checkAsync('queued marker and entity writes cannot cross a same-key server switch', async () => {
      const originalRoot = provider.sourceWorkspaceRoot, originalMap = provider.currentMap;
      let markerWrites = 0;
      provider.saveMarkerUpdate = () => { markerWrites++; return {}; };
      provider.saveMarkerAdditions = () => { markerWrites++; return []; };
      provider.enqueueMarkerUpdate({ requestId: 40 });
      provider.enqueueMarkerAddition({ requestId: 41 });
      provider.enqueueNpcUpdate({ requestId: 42 });
      provider.enqueueSpawnUpdate({ requestId: 43 });
      provider.sourceWorkspaceRoot = serverA;
      provider.currentMap = { ...originalMap }; // Same line number/map ID is not a server identity.
      await provider.markerSaveQueue; await provider.entitySaveQueue;
      assert.equal(markerWrites, 0);
      const failed = panels[0].messages.filter(message => [40, 41, 42, 43].includes(message.requestId));
      assert.equal(failed.length, 4);
      assert.ok(failed.every(message => /切换/.test(message.message)));
      provider.sourceWorkspaceRoot = originalRoot; provider.currentMap = originalMap;
    });
    await checkAsync('instance ID resolves real map filename, not a same-name map from another server', async () => {
      await provider.revealMapInfoOriginalMap(dirtyB.uri.toString(), 2);
      await provider.loadOriginalMap({ requestId: 3 });
      assert.equal(provider.currentMap.mapId, 'D001');
      assert.equal(provider.currentMap.originalMapId, 'ERSG');
      assert.equal(provider.originalMapSession.model.width, 4);
      assert.equal(path.basename(provider.originalMapSession.filePath), 'ERSG.map');
    });
    await checkAsync('repeated ready-map clicks reveal without restarting a valid original session', async () => {
      const session = provider.originalMapSession;
      const count = panels[0].messages.filter(message => message.type === 'mapData').length;
      await provider.revealMapInfoOriginalMap(dirtyB.uri.toString(), 2);
      assert.equal(provider.originalMapSession, session);
      assert.equal(panels[0].messages.at(-1).type, 'revealOriginalMap');
      assert.equal(panels[0].messages.filter(message => message.type === 'mapData').length, count);
    });
    await checkAsync('dirty alias target change invalidates same-key cached session', async () => {
      dirtyB.replace('[0 脏地图乙]\r\n[D001|0 修改副本]');
      await provider.revealMapInfoOriginalMap(dirtyB.uri.toString(), 2);
      assert.equal(provider.currentMap.originalMapId, '0');
      assert.equal(provider.originalMapSession, undefined);
      await provider.loadOriginalMap({ requestId: 4 });
      assert.equal(provider.originalMapSession.model.width, 2);
    });
    await checkAsync('MonGen map command shares dirty MapInfo and original renderer without text-name guessing', async () => {
      dirtyB.replace('[0 脏地图乙]\r\n[D001|ERSG 最新副本]');
      await provider.revealMonGenOriginalMap(monDoc.uri.toString(), 1);
      assert.equal(provider.currentMap.name, '最新副本');
      await provider.loadOriginalMap({ requestId: 5 });
      assert.equal(provider.originalMapSession.model.width, 4);
      monDoc.replace('不存在 152 97 练功师 0 1 1');
      await provider.revealMonGenOriginalMap(monDoc.uri.toString(), 1);
      assert.match(warnings.at(-1), /当前服务端 MapInfo/);
    });
    await checkAsync('map ID matching normalizes both dollar prefixes without selecting same display names', async () => {
      dirtyB.replace('[FAKE D001]\r\n[$D001|ERSG 正确副本]');
      monDoc.replace('$d001 152 97 练功师 0 1 1');
      await provider.revealMonGenOriginalMap(monDoc.uri.toString(), 1);
      assert.equal(provider.currentMap.mapId, '$D001');
      assert.equal(provider.currentMap.name, '正确副本');
      await provider.loadOriginalMap({ requestId: 6 });
      assert.equal(path.basename(provider.originalMapSession.filePath), 'ERSG.map');
    });
    await checkAsync('stale or invalid clicked definitions are rejected without replacing the current map', async () => {
      const current = provider.currentMap, panelCount = panels.length;
      dirtyB.replace('[0 脏地图乙]\r\n;[D001|ERSG 已删除副本]');
      await provider.revealMapInfoOriginalMap(dirtyB.uri.toString(), 2);
      await provider.revealMapInfoOriginalMap(path.join(temporary, 'MapInfo.txt'), 1);
      await provider.revealMapInfoOriginalMap(dirtyB.uri.toString(), 0);
      assert.equal(provider.currentMap, current);
      assert.equal(panels.length, panelCount);
      assert.ok(warnings.length >= 4);
    });
    console.log(`map-config-links.test.js: PASS (${cases} behavior cases)`);
  } finally {
    Module._load = originalLoad;
    removeTemporaryDirectory(temporary);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
