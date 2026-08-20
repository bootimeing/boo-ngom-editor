const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const htmlPath = path.join(__dirname, '..', 'media', 'patch-manager.html');
let html = fs.readFileSync(htmlPath, 'utf8')
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace(/ nonce="\{\{NONCE\}\}"/g, '')
  .replace(/\{\{CSP_SOURCE\}\}/g, '');

const bootstrap = `<style>
  :root {
    --vscode-foreground: #cccccc;
    --vscode-descriptionForeground: #9d9d9d;
    --vscode-sideBar-background: #181818;
    --vscode-sideBarSectionHeader-background: #242424;
    --vscode-sideBarSectionHeader-foreground: #cccccc;
    --vscode-sideBarSectionHeader-border: #353535;
    --vscode-input-background: #252526;
    --vscode-input-border: #3c3c3c;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #1177bb;
    --vscode-button-secondaryBackground: #3a3d41;
    --vscode-button-secondaryForeground: #ffffff;
    --vscode-button-secondaryHoverBackground: #45494e;
    --vscode-list-hoverBackground: #2a2d2e;
    --vscode-list-activeSelectionBackground: #094771;
    --vscode-list-activeSelectionForeground: #ffffff;
    --vscode-inputValidation-errorBackground: #5a1d1d;
    --vscode-inputValidation-errorBorder: #be1100;
    --vscode-inputValidation-errorForeground: #ffffff;
    --vscode-editorWarning-foreground: #cca700;
    --vscode-textBlockQuote-background: #222222;
    --vscode-progressBar-background: #0e70c0;
    --vscode-focusBorder: #007fd4;
  }
</style><script>
  window.__postedMessages = [];
  window.acquireVsCodeApi = () => ({
    getState: () => window.__webviewState || {},
    setState: value => { window.__webviewState = value; },
    postMessage: message => {
      window.__postedMessages.push(message);
      if (message.type === 'ready') {
        dispatchState(false, [
          entry('D:\\\\Client\\\\CustomPatch\\\\data\\\\DiyUI.pak', 'CustomPatch\\\\data\\\\DiyUI.pak', 'cached', '已有缓存', 100, true),
          entry('D:\\\\Client\\\\CustomPatch\\\\data\\\\Items1.pak', 'CustomPatch\\\\data\\\\Items1.pak', 'password-error', '密码错误', 0, true),
          entry('D:\\\\Client\\\\data\\\\Magic.wil', 'data\\\\Magic.wil', 'cached', '资源已就绪', 100, false)
        ]);
      }
      if (message.type === 'readPatches') {
        dispatchState(true, [
          entry('D:\\\\Client\\\\CustomPatch\\\\data\\\\DiyUI.pak', 'CustomPatch\\\\data\\\\DiyUI.pak', 'cached', '已有缓存', 100, true),
          entry('D:\\\\Client\\\\CustomPatch\\\\data\\\\Items1.pak', 'CustomPatch\\\\data\\\\Items1.pak', 'password-error', '密码错误', 0, true),
          entry('D:\\\\Client\\\\data\\\\Magic.wil', 'data\\\\Magic.wil', 'caching', 'Magic: 40/100', 40, false)
        ]);
      }
    }
  });
  function entry(path, name, status, message, progress, passwordRequired) {
    return { path, name, status, message, progress, passwordRequired };
  }
  function dispatchState(busy, entries) {
    setTimeout(() => window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'state',
      clientDirectory: 'D:\\\\Client',
      customPatchName: 'CustomPatch',
      customPatchCandidates: ['CustomPatch', 'SecondPatch'],
      customPatchError: '',
      resourceSummary: '自定义补丁 1 个 · Data 2 · Map 2 · Wav 2',
      passwordFile: 'D:\\\\Client\\\\Pak.txt',
      archiveLabel: 'PAK/JPK/WIL/WZL',
      entries,
      busy
    }})), 0);
  }
</script>`;

html = html.replace('<script>', bootstrap + '<script>');

const server = http.createServer((request, response) => {
  if (request.url === '/' || request.url === '/patch-manager') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(html);
    return;
  }
  response.writeHead(404);
  response.end('Not found');
});

server.listen(41761, '127.0.0.1', () => {
  console.log('Patch manager harness: http://127.0.0.1:41761/patch-manager');
});
