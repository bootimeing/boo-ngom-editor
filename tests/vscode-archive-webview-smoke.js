const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const vscode = require('vscode');

const RESULT_PATH = path.join(os.tmpdir(), 'boo-v425-archive-webview-smoke.json');

function imageBlock(state, options, rc4Crypt) {
  const plaintext = options.compressed ? zlib.deflateSync(options.raw) : options.raw;
  const payload = rc4Crypt(plaintext, state);
  const record = Buffer.alloc(20);
  record[0] = options.bitsPerPixel;
  record[1] = options.compressed ? 1 : 0;
  record.writeUInt16LE(options.width, 2);
  record.writeUInt16LE(options.height, 4);
  record.writeInt16LE(options.x || 0, 6);
  record.writeInt16LE(options.y || 0, 8);
  record.writeUInt32LE(payload.length, 12);
  record[16] = options.alpha ? 1 : 0;
  return { record, payload };
}

function buildFixture(filePath, password, jpk) {
  const state = jpk.deriveJpkRc4State(password);
  const raw = Buffer.from([
    0, 0, 255, 0,
    0, 255, 0, 0,
    255, 0, 0, 0,
  ]);
  const image = imageBlock(state, {
    bitsPerPixel: 8,
    compressed: true,
    width: 3,
    height: 3,
    raw,
  }, jpk.rc4Crypt);
  const imageOffset = 80;
  const indexOffset = imageOffset + image.record.length + image.payload.length;
  const header = Buffer.alloc(80);
  header[0] = 7;
  header.write('GameLib', 1, 'ascii');
  header.writeUInt32LE(80, 0x2c);
  header.writeUInt32LE(1, 0x30);
  header.writeUInt32LE(indexOffset, 0x34);
  header.writeDoubleLE(1234.5, 0x38);
  const index = Buffer.alloc(4);
  index.writeUInt32LE(imageOffset, 0);
  fs.writeFileSync(filePath, Buffer.concat([
    jpk.rc4Crypt(header, state),
    image.record,
    image.payload,
    index,
  ]));
}

function waitForImage(panel) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Webview image load timed out')), 15000);
    const subscription = panel.webview.onDidReceiveMessage(message => {
      if (!message || message.kind !== 'archive-image-result') return;
      clearTimeout(timer);
      subscription.dispose();
      if (!message.ok) reject(new Error(`Webview image failed: ${message.reason || 'unknown'}`));
      else resolve(message);
    });
  });
}

async function run() {
  const startedAt = Date.now();
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-vscode-archive-smoke-'));
  const archivePath = path.join(fixtureRoot, 'Smoke.jpk');
  const indexRoot = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'BOO-NGOM-Editor',
    'cache',
    'archive-index-v1'
  );
  let cacheDir;
  let panel;
  try {
    const extension = vscode.extensions.getExtension('boo1213.boo-NGOM-editor');
    assert.ok(extension, 'BOO development extension was not found');
    await extension.activate();
    const jpk = require(path.join(extension.extensionPath, 'out', 'utils', 'jpk-reader'));
    const { openArchiveIndexed } = require(
      path.join(extension.extensionPath, 'out', 'utils', 'archive-index')
    );

    const password = 'WebviewSmoke';
    buildFixture(archivePath, password, jpk);
    const direct = await openArchiveIndexed({
      extensionPath: extension.extensionPath,
      indexRoot,
      pakPath: archivePath,
      password,
      willIdx: 0,
    });
    cacheDir = direct.cacheDir;
    const sourceUri = vscode.Uri.from({
      scheme: 'boo-archive',
      path: `/${direct.archiveId}/000000.png`,
    });

    const rootStat = await vscode.workspace.fs.stat(vscode.Uri.parse('boo-archive:/'));
    const archiveStat = await vscode.workspace.fs.stat(
      vscode.Uri.parse(`boo-archive:/${direct.archiveId}`)
    );
    assert.equal(rootStat.type, vscode.FileType.Directory);
    assert.equal(archiveStat.type, vscode.FileType.Directory);

    const bytes = Buffer.from(await vscode.workspace.fs.readFile(sourceUri));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    panel = vscode.window.createWebviewPanel(
      'booArchivePreviewSmoke',
      'BOO Archive Preview Smoke',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.parse('boo-archive:/')],
      }
    );
    const resourceUri = panel.webview.asWebviewUri(sourceUri);
    const nonce = Math.random().toString(36).slice(2);
    const imageResult = waitForImage(panel);
    panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource}; script-src 'nonce-${nonce}';">
</head><body><img id="asset" alt="archive smoke">
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const image = document.getElementById('asset');
image.addEventListener('load', () => vscode.postMessage({
  kind: 'archive-image-result', ok: true,
  width: image.naturalWidth, height: image.naturalHeight
}));
image.addEventListener('error', () => vscode.postMessage({
  kind: 'archive-image-result', ok: false, reason: 'image-error'
}));
image.src = ${JSON.stringify(resourceUri.toString())};
</script></body></html>`;
    const rendered = await imageResult;
    assert.equal(rendered.width, 3);
    assert.equal(rendered.height, 3);

    const result = {
      ok: true,
      durationMs: Date.now() - startedAt,
      archiveId: direct.archiveId,
      pngBytes: bytes.length,
      webviewWidth: rendered.width,
      webviewHeight: rendered.height,
      resourceScheme: resourceUri.scheme,
      extensionPath: extension.extensionPath,
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    console.log('[BOO smoke]', result);
  } catch (error) {
    const result = {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error && error.stack ? error.stack : String(error),
    };
    fs.writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
    throw error;
  } finally {
    if (panel) panel.dispose();
    if (cacheDir) fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

module.exports = { run };
