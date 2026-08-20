const assert = require('node:assert/strict');

function main() {
  const { secureWebviewHtml } = require('../out/utils/webview-security');
  const webview = { cspSource: 'https://test.vscode-cdn.net' };

  const strict = secureWebviewHtml(
    webview,
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script>window.ok=true;</script></body></html>'
  );
  assert.equal(
    (strict.match(/Content-Security-Policy/g) || []).length,
    1,
    'a secured webview must contain exactly one CSP'
  );
  assert.match(strict, /<script nonce="[A-Za-z0-9_-]+">/);
  assert.match(strict, /script-src 'nonce-[A-Za-z0-9_-]+'/);
  assert.match(strict, /script-src-attr 'none'/);
  assert.match(strict, /img-src https:\/\/test\.vscode-cdn\.net data: blob:/);

  const legacy = secureWebviewHtml(
    webview,
    '<html><head></head><body><button onclick="run()">Run</button><script>function run(){}</script></body></html>',
    { allowInlineEventHandlers: true }
  );
  assert.match(legacy, /script-src-attr 'unsafe-inline'/);
  assert.match(legacy, /<script nonce="[A-Za-z0-9_-]+">/);

  const scriptsDisabled = secureWebviewHtml(
    webview,
    '<html><head></head><body>Static</body></html>',
    { enableScripts: false }
  );
  assert.match(scriptsDisabled, /script-src 'none'/);
  assert.match(scriptsDisabled, /script-src-attr 'none'/);

  console.log('webview-security.test.js: PASS');
}

main();
