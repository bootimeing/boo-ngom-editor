const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(__dirname, '..');

function findEdge() {
  const candidates = [
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

function resourceUri(relativePath) {
  return pathToFileURL(path.join(root, relativePath)).href;
}

function main() {
  const edge = findEdge();
  if (!edge) {
    console.log('table-editor-browser.test.js: SKIP (Microsoft Edge not found)');
    return;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-table-browser-'));
  const profile = path.join(temporary, 'profile');
  const harness = path.join(temporary, 'table-editor-test.html');
  try {
    let html = fs.readFileSync(path.join(root, 'media', 'csv-editor.html'), 'utf8');
    const replacements = {
      '{{TABULATOR_CSS_URI}}': resourceUri('media/vendor/tabulator/tabulator_midnight.min.css'),
      '{{TABLE_EDITOR_CSS_URI}}': resourceUri('media/table-editor.css'),
      '{{TABLE_EDITOR_CORE_URI}}': resourceUri('media/table-editor-core.js'),
      '{{TABULATOR_JS_URI}}': resourceUri('media/vendor/tabulator/tabulator.min.js'),
      '{{TABLE_EDITOR_JS_URI}}': resourceUri('media/table-editor.js'),
    };
    for (const [token, value] of Object.entries(replacements)) html = html.replaceAll(token, value);

    const mock = `<script>
window.__booMessages = [];
window.__booLoadStart = 0;
window.addEventListener('error', function (event) {
  var details = event.error && event.error.stack
    ? event.error.stack
    : (event.message || String(event.error || 'unknown error')) + ' @ ' + event.filename + ':' + event.lineno + ':' + event.colno;
  document.body.dataset.appError = details;
});
window.acquireVsCodeApi = function () {
  return {
    postMessage: function (message) {
      window.__booMessages.push(message);
      if (message.type === 'ready') {
        setTimeout(function () {
          var rows = [];
          for (var row = 0; row < 20000; row++) {
            var values = [];
            for (var column = 0; column < 20; column++) values.push('R' + row + 'C' + column);
            rows.push(values);
          }
          window.__booLoadStart = performance.now();
          window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'load', mode: 'csv', fileName: 'large.csv', rows: rows
          }}));
        }, 0);
      }
    }
  };
};
</script>`;
    html = html.replace('<script src="' + replacements['{{TABLE_EDITOR_CORE_URI}}'] + '"></script>',
      mock + '<script src="' + replacements['{{TABLE_EDITOR_CORE_URI}}'] + '"></script>');

    const scenario = `<script>
(function () {
  function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function isTransparent(color) {
    return color === 'transparent' || color === 'rgba(0, 0, 0, 0)';
  }
  async function run() {
    for (var attempt = 0; attempt < 200; attempt++) {
      if (document.getElementById('grid').dataset.ready === 'true') break;
      await wait(50);
    }
    var grid = document.getElementById('grid');
    if (grid.dataset.ready !== 'true') throw new Error('table did not become ready');
    var buildMs = Math.round(performance.now() - window.__booLoadStart);
    var renderedRows = document.querySelectorAll('.tabulator-row').length;
    var renderedCells = document.querySelectorAll('.tabulator-row .tabulator-cell').length;
    var firstCell = document.querySelector('.tabulator-row .tabulator-cell[tabulator-field="A"]');
    if (!firstCell) throw new Error('first data cell missing');
    var rangeOverlay = document.querySelector('.tabulator-range-overlay .tabulator-range');
    if (!rangeOverlay) throw new Error('selection overlay missing');
    var rangeOverlayBackground = getComputedStyle(rangeOverlay).backgroundColor;
    var rangeOverlayTransparent = isTransparent(rangeOverlayBackground);
    var selectedTextPresent = firstCell.textContent === 'R0C0';

    var visibleRows = document.querySelectorAll('.tabulator-row');
    var fillStart = visibleRows[1] && visibleRows[1].querySelector('.tabulator-cell[tabulator-field="C"]');
    var fillEnd = visibleRows[9] && visibleRows[9].querySelector('.tabulator-cell[tabulator-field="C"]');
    if (!fillStart || !fillEnd) throw new Error('Ctrl+D fill cells missing');
    fillStart.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    fillStart.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    fillStart.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    fillEnd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, shiftKey: true }));
    fillEnd.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, shiftKey: true }));
    fillEnd.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, shiftKey: true }));
    await wait(30);
    fillEnd.focus();
    fillEnd.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'd', ctrlKey: true, bubbles: true, cancelable: true
    }));
    await wait(160);

    firstCell = document.querySelector('.tabulator-row .tabulator-cell[tabulator-field="A"]');
    if (!firstCell) throw new Error('first data cell missing after Ctrl+D fill');
    firstCell.focus();
    firstCell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    firstCell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    firstCell.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    firstCell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
    await wait(30);
    var input = firstCell.querySelector('input');
    if (!input) throw new Error('double click did not open the editor');
    input.value = 'edited';
    input.blur();
    await wait(160);

    firstCell = document.querySelector('.tabulator-row .tabulator-cell[tabulator-field="A"]');
    if (!firstCell) throw new Error('edited data cell missing');
    firstCell.focus();
    var paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: {
      getData: function () { return '10\\t20\\r\\n30\\t40'; }
    }});
    firstCell.dispatchEvent(paste);
    await wait(160);

    document.getElementById('insertRowButton').click();
    await wait(100);
    document.getElementById('undoButton').click();
    await wait(100);

    var messages = window.__booMessages;
    var patches = messages.filter(function (message) {
      return message.type === 'applyEdit' && message.operation === 'patch';
    });
    var replacements = messages.filter(function (message) {
      return message.type === 'applyEdit' && message.operation === 'replace';
    });
    var undo = messages.some(function (message) { return message.type === 'undo'; });
    var editPatch = patches.some(function (message) {
      return message.changes && message.changes.some(function (change) {
        return change.row === 0 && change.column === 0 && change.value === 'edited';
      });
    });
    var pastePatch = patches.some(function (message) {
      if (!message.changes || message.changes.length !== 4) return false;
      var values = new Map(message.changes.map(function (change) {
        return [change.row + ':' + change.column, change.value];
      }));
      return values.get('0:0') === '10' && values.get('0:1') === '20' &&
        values.get('1:0') === '30' && values.get('1:1') === '40';
    });
    var ctrlDFillPatch = patches.some(function (message) {
      if (message.label !== 'Ctrl+D 填充选区' || !message.changes || message.changes.length !== 8) return false;
      return message.changes.every(function (change, index) {
        return change.row === index + 2 && change.column === 2 && change.value === 'R1C2';
      });
    });
    var structureReplacement = replacements.some(function (message) {
      return message.rows && message.rows.length === 20002 &&
        message.rows[0][0] === '10' && message.rows[1][1] === '40' &&
        message.rows[2].every(function (value) { return value === ''; }) &&
        message.rows[3].every(function (value) { return value === ''; }) &&
        message.rows[4][0] === 'R2C0';
    });
    var appError = document.body.dataset.appError;
    document.body.dataset.testStatus = rangeOverlayTransparent && selectedTextPresent && ctrlDFillPatch &&
      editPatch && pastePatch && structureReplacement && undo && !appError ? 'pass' : 'fail';
    document.body.dataset.buildMs = String(buildMs);
    document.body.dataset.renderedRows = String(renderedRows);
    document.body.dataset.renderedCells = String(renderedCells);
    document.body.dataset.rangeOverlayBackground = rangeOverlayBackground;
    document.body.dataset.rangeOverlayTransparent = String(rangeOverlayTransparent);
    document.body.dataset.selectedTextPresent = String(selectedTextPresent);
    document.body.dataset.patchCount = String(patches.length);
    document.body.dataset.replaceCount = String(replacements.length);
    document.body.dataset.undoSeen = String(undo);
    document.body.dataset.editSeen = String(editPatch);
    document.body.dataset.ctrlDFillSeen = String(ctrlDFillPatch);
    document.body.dataset.pasteSeen = String(pastePatch);
    document.body.dataset.structureSeen = String(structureReplacement);
    document.body.dataset.messageTypes = messages.map(function (message) {
      return message.type + (message.operation ? ':' + message.operation : '');
    }).join(',');
  }
  run().catch(function (error) {
    document.body.dataset.testStatus = 'fail';
    document.body.dataset.testError = error && error.message ? error.message : String(error);
  });
}());
</script>`;
    html = html.replace('</body>', scenario + '</body>');
    fs.writeFileSync(harness, html, 'utf8');

    const result = spawnSync(edge, [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--allow-file-access-from-files',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=15000',
      '--dump-dom',
      pathToFileURL(harness).href,
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 20 * 1024 * 1024 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    const body = result.stdout.match(/<body\b([^>]*)>/i);
    if (!body && !result.stderr.trim()) {
      console.log('table-editor-browser.test.js: SKIP (headless Edge returned no DOM)');
      return;
    }
    assert.ok(body, 'headless Edge did not return a body element');
    const attributes = body[1];
    const value = name => attributes.match(new RegExp(`data-${name}="([^"]*)"`))?.[1];
    assert.equal(value('test-status'), 'pass', value('test-error') || JSON.stringify({
      buildMs: value('build-ms'),
      renderedRows: value('rendered-rows'),
      renderedCells: value('rendered-cells'),
      rangeOverlayBackground: value('range-overlay-background'),
      rangeOverlayTransparent: value('range-overlay-transparent'),
      selectedTextPresent: value('selected-text-present'),
      patchCount: value('patch-count'),
      replaceCount: value('replace-count'),
      undoSeen: value('undo-seen'),
      editSeen: value('edit-seen'),
      ctrlDFillSeen: value('ctrl-d-fill-seen'),
      pasteSeen: value('paste-seen'),
      structureSeen: value('structure-seen'),
      messageTypes: value('message-types'),
      appError: value('app-error'),
      stderr: result.stderr,
    }));
    assert.ok(Number(value('rendered-rows')) < 200, 'virtual rendering created too many DOM rows');
    assert.ok(Number(value('rendered-cells')) < 5000, 'virtual rendering created too many DOM cells');
    assert.ok(Number(value('build-ms')) < 10000, '20k x 20 table took too long to initialize');

    console.log(
      `table-editor-browser.test.js: PASS (${value('build-ms')}ms, ` +
      `${value('rendered-rows')} DOM rows, ${value('rendered-cells')} DOM cells)`
    );
  } finally {
    removeTemporaryDirectory(temporary);
  }
}

main();
