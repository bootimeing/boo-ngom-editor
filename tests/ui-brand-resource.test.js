// Exercise the compiled HTML provider, including its resource URL and CSP handling.
// VS Code's URI transport is a deterministic double; this is not a native-host test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const runtime = path.resolve(process.env.BOO_PAK_RUNTIME_ROOT || path.join(__dirname, '..'));
const filename = path.join(runtime, 'out/extension.js');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
const provider = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'getWebviewContent');
assert.ok(provider, 'compiled production HTML provider must exist');
const security = require(path.join(runtime, 'out/utils/webview-security'));
const origin = 'https://ui-brand.vscode-cdn.net';
const mappedUrl = filename => origin + '/' + path.resolve(filename).split(/[\\/]/).map(encodeURIComponent).join('/');
const html = fs.readFileSync(path.join(runtime, 'media/editor.html'), 'utf8');
const icon = fs.readFileSync(path.join(runtime, 'resources/icon.png'));
assert.deepEqual(icon.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'brand resource is a packaged PNG');
assert.ok(icon.readUInt32BE(16) > 0 && icon.readUInt32BE(20) > 0, 'brand PNG has nonempty dimensions');

function render(extensionPath, contents) {
  const sandbox = {
    path,
    fs: { readFileSync(filename, encoding) {
      assert.equal(filename, path.join(extensionPath, 'media', 'editor.html'));
      assert.equal(encoding, 'utf8');
      return contents;
    } },
    vscode: { Uri: { file: fsPath => ({ fsPath }) } },
    webview_security_1: security,
  };
  vm.createContext(sandbox);
  vm.runInContext(provider.getText(source), sandbox);
  return sandbox.getWebviewContent({ extensionPath }, {
    cspSource: origin,
    asWebviewUri: uri => ({ toString: () => mappedUrl(uri.fsPath) }),
  });
}

for (const extensionPath of [runtime, runtime + path.sep]) {
  const rendered = render(extensionPath, html);
  const brandTag = rendered.match(/<img\b[^>]*\bclass="[^"]*\bbrand-mark\b[^"]*"[^>]*>/)?.[0];
  assert.ok(brandTag, 'top-left brand must be the actual image, not BOO text');
  assert.equal(brandTag.match(/\bsrc="([^"]+)"/)?.[1], mappedUrl(path.join(extensionPath, 'resources')) + '/icon.png',
    'resource directory and icon filename retain their separating slash');
  assert.match(brandTag, /\balt="老卢"/);
  assert.equal((rendered.match(/Content-Security-Policy/g) || []).length, 1, 'provider emits exactly one CSP');
  assert.ok(rendered.includes('img-src ' + origin + ' data: blob:'), 'CSP permits the mapped local image origin');
  assert.match(rendered, /<script nonce="[A-Za-z0-9_-]+">/, 'script nonce protection remains enabled');
  assert.doesNotMatch(rendered, /(?:src|href)="resources\//, 'no resource references remain relative to the webview');

  const probe = render(extensionPath, '<html><head><link href="resources/probe.css"></head><body><img src="resources/probe.png"></body></html>');
  assert.ok(probe.includes('href="' + mappedUrl(path.join(extensionPath, 'resources')) + '/probe.css"'), 'stylesheet mapping keeps the same safe resource root');
  assert.ok(probe.includes('src="' + mappedUrl(path.join(extensionPath, 'resources')) + '/probe.png"'), 'image mapping keeps the same safe resource root');
}

console.log('ui-brand-resource.test.js: PASS (compiled provider, packaged icon, resource separators, CSP and nonce)');
