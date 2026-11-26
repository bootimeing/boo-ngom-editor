const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

function fileUri(filePath) {
  const resolved = path.resolve(filePath);
  return { scheme: 'file', fsPath: resolved, path: resolved.replaceAll('\\', '/'), toString: () => pathToFileURL(resolved).href };
}

function loadBridge() {
  const filename = require.resolve('../out/utils/sidebar-bridge');
  const original = Module._load;
  const uriFrom = ({ scheme, path: uriPath }) => ({ scheme, path: uriPath, fsPath: uriPath, toString: () => `${scheme}:${uriPath}` });
  const vscode = {
    Uri: {
      file: fileUri,
      parse(value) { const match = /^([^:]+):(.*)$/.exec(value); return uriFrom({ scheme: match[1], path: match[2] }); },
      from: uriFrom,
      joinPath: (base, ...parts) => fileUri(path.join(base.fsPath, ...parts)),
    },
    workspace: { workspaceFolders: undefined, getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
  };
  delete require.cache[filename];
  Module._load = function (id, parent, isMain) {
    return id === 'vscode' ? vscode : original.call(this, id, parent, isMain);
  };
  try { return require(filename); }
  finally { Module._load = original; }
}

function webview(label) {
  const messages = [], resourceUris = [];
  return {
    messages, resourceUris,
    options: { enableScripts: false, customPreservedOption: label },
    asWebviewUri(value) {
      resourceUris.push(value);
      return { toString: () => `https://${label}.example.invalid/resource/${encodeURIComponent(value.toString())}` };
    },
    postMessage(message) { messages.push(message); return Promise.resolve(true); },
  };
}

function expectedUrl(label, filePath) {
  return `https://${label}.example.invalid/resource/${encodeURIComponent(pathToFileURL(filePath).href)}`;
}

function main() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-database-detail-resource-'));
  const bridge = loadBridge();
  try {
    const imageDirectory = path.join(temporary, 'isolated-loaded-images');
    fs.mkdirSync(imageDirectory);
    const imagePath = path.join(imageDirectory, '000042.png');
    // A local PNG fixture is used only as an existing resource path. This test
    // does not decode archives, render pixels or validate image fidelity.
    fs.writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64'));
    const sidebar = webview('sidebar');
    const replacement = webview('replacement');
    bridge.setSidebarView(undefined);
    assert.deepEqual(bridge.resolvePakImageAsset(7, 42), { url: '' }, 'no target should produce no Webview resource');

    bridge.setLoadedPakAssets([{ willIdx: 7, localIdx: 42, path: imagePath, width: 37, height: 51, offsetX: -7, offsetY: 19 }]);
    bridge.setSidebarView({ webview: sidebar });
    const resolved = bridge.resolvePakImageAsset(7, 42);
    assert.deepEqual(resolved, {
      url: expectedUrl('sidebar', imagePath), width: 37, height: 51, offsetX: -7, offsetY: 19,
    }, 'the independent inspector must resolve resources using its own Webview and preserve metadata');
    assert.equal(sidebar.resourceUris.at(-1).fsPath, imagePath);
    assert.ok(sidebar.options.localResourceRoots.some(value => value.scheme === 'file' && value.fsPath === imageDirectory),
      'the sidebar Webview must authorize the loaded image directory');
    assert.ok(sidebar.options.localResourceRoots.some(value => value.scheme === 'boo-archive'),
      'the shared archive resource root must be retained');
    assert.equal(sidebar.options.customPreservedOption, 'sidebar', 'resource updates must preserve other Webview options');
    assert.equal(sidebar.options.enableScripts, true);

    const detail = { type: 'showDatabaseDetail', detailKind: 'item', name: 'resource fixture', fields: { Name: 'resource fixture' } };
    bridge.postToSidebar(detail);
    assert.deepEqual(sidebar.messages, [detail], 'the active inspector should receive each detail once');
    bridge.replaySidebarMessage();
    assert.deepEqual(sidebar.messages, [detail, detail], 'the independent sidebar must retain its normal message and replay behavior');
    const result = { type: 'itemDescSaveResult', name: 'resource fixture', key: 'topDesc', ok: true, message: 'fixture saved' };
    bridge.postToSidebar(result);
    assert.equal(sidebar.messages.at(-1), result);

    bridge.setSidebarView(undefined);
    assert.deepEqual(bridge.resolvePakImageAsset(7, 42), { url: '' });
    const detachedUriCount = sidebar.resourceUris.length;
    const clear = { type: 'clearDatabaseDetail', detailKind: 'item' };
    bridge.postToSidebar(clear);
    bridge.replaySidebarMessage();
    assert.equal(sidebar.messages.length, 3, 'a detached inspector must stop receiving updates and replays');
    assert.equal(sidebar.resourceUris.length, detachedUriCount, 'a detached inspector must stop issuing resource URLs');

    bridge.setSidebarView({ webview: replacement });
    assert.deepEqual(bridge.resolvePakImageAsset(7, 42), {
      url: expectedUrl('replacement', imagePath), width: 37, height: 51, offsetX: -7, offsetY: 19,
    }, 'a reopened inspector must use its new resource authority');
    assert.equal(replacement.options.customPreservedOption, 'replacement');
    assert.ok(replacement.options.localResourceRoots.some(value => value.scheme === 'file' && value.fsPath === imageDirectory));
    bridge.replaySidebarMessage();
    assert.deepEqual(replacement.messages, [clear], 'the reopened inspector must replay the latest cleared state');
    assert.equal(sidebar.messages.length, 3, 'reopening must not reactivate the detached inspector');
    console.log('database-detail-resource-target.test.js: PASS (independent sidebar URI authority, roots, metadata, options, replay and detach/reopen lifecycle)');
  } finally {
    bridge.setSidebarView(undefined);
    bridge.clearArchiveResourceContext();
    removeTemporaryDirectory(temporary);
  }
}

main();
