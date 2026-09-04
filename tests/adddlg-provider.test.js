const assert = require('node:assert/strict');
const Module = require('node:module');

function loadProviderWithVscodeStub() {
  const originalLoad = Module._load;
  const uri = value => ({
    fsPath: value,
    path: value,
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

function testSharedAddDlgWindowHydratesOnce() {
  const { hydrateAddDlgWindowAssets } = loadProviderWithVscodeStub();
  assert.equal(typeof hydrateAddDlgWindowAssets, 'function');

  const window = {
    id: 'window-1',
    assetRef: { willIndex: 1, imageIndex: 440 },
  };
  const model = {
    scenes: [
      { addDlgWindow: window },
      { addDlgWindow: window },
      { addDlgWindow: { id: 'window-2' } },
    ],
  };
  const requests = [];
  hydrateAddDlgWindowAssets(model, reference => {
    requests.push(reference);
    return {
      status: 'ready',
      url: 'vscode-resource:/GOM.pak/000440.png',
      archiveLabel: 'GOM.pak/000440',
      width: 220,
      height: 120,
      offsetX: -2,
      offsetY: 3,
    };
  });

  assert.deepEqual(requests, [{ willIndex: 1, imageIndex: 440 }]);
  assert.equal(window.asset.status, 'ready');
  assert.equal(window.asset.width, 220);
  assert.equal(model.scenes[1].addDlgWindow.asset, window.asset);
  assert.equal(model.scenes[2].addDlgWindow.asset, undefined);
}

testSharedAddDlgWindowHydratesOnce();
console.log('adddlg-provider.test.js: PASS');
