const assert = require('node:assert/strict');
const Module = require('node:module');

const staticLanguage = require('../data/static-language.json');
const { buildDialogStatementCatalog } = require('../out/ui-dialog/statement-catalog');
const { parseNpcDialogDocument } = require('../out/ui-dialog/source-parser');
const { workspaceNpcDialogOffsets } = require('../out/ui-dialog/offsets');

function loadProviderWithVscodeStub() {
  const originalLoad = Module._load;
  const uri = value => ({
    fsPath: value,
    path: value,
    scheme: 'file',
    toString() { return value; },
  });
  const vscode = {
    Uri: {
      parse: uri,
      file: uri,
      joinPath(base, ...parts) {
        return uri([base.fsPath || base.path, ...parts].join('/'));
      },
    },
    EventEmitter: class {
      constructor() { this.event = () => undefined; }
      fire() {}
      dispose() {}
    },
    Disposable: { from: () => ({ dispose() {} }) },
    workspace: {},
    window: {},
    commands: {},
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require('../out/providers/npc-dialog-visual');
  } finally {
    Module._load = originalLoad;
  }
}

function parse(source) {
  return parseNpcDialogDocument(source, {
    uri: 'file:///D:/MirServer/Mir200/Envir/QuestDiary/gee-adddlg-provider.txt',
    fileName: 'gee-adddlg-provider.txt',
    filePath: 'D:\\MirServer\\Mir200\\Envir\\QuestDiary\\gee-adddlg-provider.txt',
    documentVersion: 1,
    engine: 'GEE',
    engineLabel: '翎风引擎',
    cursorOffset: source.indexOf('#ACT') + 4,
    offsets: workspaceNpcDialogOffsets(0, 0),
    catalog: buildDialogStatementCatalog(staticLanguage, 'GEE'),
  });
}

const source = [
  '[@main]',
  '#ACT',
  'MOV N1 9',
  'MOV N2 999',
  'ADDDLG 11 1 440 1 10:20 30:40 22 >静态行内内容>',
  'ADDDLGEX 12 1 441 0 110:120 31:41 43 D:\\lfm-dialog\\d.txt 1',
  'ADDDLG 13 <$STR(N1)> <$STR(N2)> 1 210:220 32:42 22 <$STR(S1)>',
].join('\n');
const model = parse(source);
const { hydrateAddDlgWindowAssets } = loadProviderWithVscodeStub();
const requests = [];
hydrateAddDlgWindowAssets(model, reference => {
  requests.push({ ...reference });
  return {
    status: 'ready',
    url: `vscode-resource:/lfm/${reference.imageIndex}.png`,
    archiveLabel: `LFM/${reference.imageIndex}`,
    width: 240,
    height: 130,
    offsetX: 0,
    offsetY: 0,
  };
});

assert.deepEqual(requests, [
  { willIndex: 1, imageIndex: 440 },
  { willIndex: 1, imageIndex: 441 },
], 'provider must hydrate the two static LFM backgrounds and never the MOV-derived one');
const byId = new Map(model.addDlgWindows.map(window => [window.dialogId, window]));
assert.equal(byId.get(11)?.asset?.url, 'vscode-resource:/lfm/440.png');
assert.equal(byId.get(12)?.asset?.url, 'vscode-resource:/lfm/441.png');
assert.equal(byId.get(13)?.assetRef, undefined);
assert.equal(byId.get(13)?.asset, undefined);
assert.equal(
  requests.some(reference => reference.imageIndex === 999 || reference.willIndex === 9),
  false,
  'dynamic resource fields must not reach the production AddDlg asset resolver'
);
assert.equal(
  JSON.stringify(model).includes('file:///D:/lfm-dialog/d.txt'),
  false,
  'ADDDLGEX metadata must not be converted into a file URL or loaded resource'
);

console.log('gee-adddlg-provider.test.js: PASS (2 static requests, 0 dynamic/external-file loads)');
