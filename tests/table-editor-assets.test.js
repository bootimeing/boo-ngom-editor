const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function main() {
  const html = read('media/csv-editor.html');
  const editor = read('media/table-editor.js');
  const core = read('media/table-editor-core.js');
  const css = read('media/table-editor.css');
  const csvProvider = read('src/providers/csv-editor.ts');
  const xlsProvider = read('src/providers/xls-editor.ts');
  const webviewLoader = read('src/utils/table-editor-webview.ts');
  const databaseHtml = read('media/database-viewer.html');
  const databaseLoader = read('src/utils/database-viewer-webview.ts');
  const assistant = read('src/assistant.ts');
  const manifest = JSON.parse(read('package.json'));
  const vendorRoot = path.join(__dirname, '..', 'media', 'vendor', 'tabulator');

  assert.doesNotThrow(() => new vm.Script(editor, { filename: 'table-editor.js' }));
  assert.doesNotThrow(() => new vm.Script(core, { filename: 'table-editor-core.js' }));
  assert.doesNotThrow(() => new vm.Script(read('media/vendor/tabulator/tabulator.min.js'), {
    filename: 'tabulator.min.js',
  }));

  assert.match(html, /\{\{TABULATOR_CSS_URI\}\}/);
  assert.match(html, /\{\{TABULATOR_JS_URI\}\}/);
  assert.match(html, /\{\{TABLE_EDITOR_JS_URI\}\}/);
  assert.doesNotMatch(html, /\sonclick=/i, 'the table editor must not require unsafe inline handlers');
  assert.match(editor, /renderVertical:\s*'virtual'/);
  assert.match(editor, /selectableRange:\s*1/);
  assert.match(editor, /operation:\s*'patch'/);
  assert.match(editor, /command\s*&&\s*key\s*===\s*'d'/, 'the table grid must handle Ctrl+D locally');
  assert.doesNotMatch(css, /color-mix\(/, 'minimum VS Code support predates CSS color-mix');
  assert.match(csvProvider, /tableEditorWebviewOptions/);
  assert.match(xlsProvider, /tableEditorWebviewOptions/);
  assert.match(webviewLoader, /localResourceRoots/);
  assert.match(webviewLoader, /asWebviewUri/);
  assert.match(databaseHtml, /\{\{TABULATOR_CSS_URI\}\}/);
  assert.match(databaseHtml, /\{\{TABLE_EDITOR_CORE_URI\}\}/);
  assert.match(databaseHtml, /\{\{TABULATOR_JS_URI\}\}/);
  assert.match(databaseHtml, /renderVertical:'virtual'/);
  assert.match(databaseHtml, /selectableRange:1/);
  assert.doesNotMatch(databaseHtml, /\sonclick=/i, 'the database grid must not require unsafe inline handlers');
  assert.match(databaseLoader, /localResourceRoots/);
  assert.match(databaseLoader, /asWebviewUri/);
  assert.match(assistant, /databaseViewerWebviewOptions\(context\)/);
  assert.match(assistant, /databaseViewerWebviewHtml\(context, panel\.webview\)/);

  const variableWrapBinding = manifest.contributes.keybindings.find(binding => binding.command === 'boo.wrapVariable');
  assert.ok(variableWrapBinding, 'the script variable wrapper keybinding must remain registered');
  assert.equal(variableWrapBinding.key.toLowerCase(), 'ctrl+d');
  assert.match(variableWrapBinding.when, /editorTextFocus/);
  assert.match(variableWrapBinding.when, /editorHasSelection/);
  assert.match(variableWrapBinding.when, /editorLangId\s*==\s*gomscript/);

  const vendorFiles = fs.readdirSync(vendorRoot).sort();
  assert.deepEqual(vendorFiles, [
    'LICENSE',
    'VERSION',
    'tabulator.min.js',
    'tabulator_midnight.min.css',
  ]);
  assert.ok(fs.statSync(path.join(vendorRoot, 'tabulator.min.js')).size > 400_000);
  assert.match(read('media/vendor/tabulator/VERSION'), /Tabulator 6\.5\.2/);
  assert.match(read('media/vendor/tabulator/LICENSE'), /MIT License/);

  console.log('table-editor-assets.test.js: PASS');
}

main();
