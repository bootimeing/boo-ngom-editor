const Module = require('node:module');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

// Exercise the actual registrations made by activateAssistant, not a copied
// regular expression or extracted provider body. No extension host is started.
const runtime = path.resolve(process.env.BOO_SCRIPT_RUNTIME_ROOT || path.join(__dirname, '..', '..'));
const disposable = () => ({ dispose() {} });
let documentVersion = 0;

class TestUri {
  constructor(value) { this.value = value; this.scheme = value.split(':')[0]; this.fsPath = this.scheme === 'file' ? fileURLToPath(value) : ''; }
  static file(value) { return new TestUri(pathToFileURL(path.resolve(value)).href); }
  static parse(value) { return new TestUri(value); }
  toString() { return this.value; }
}
class TestPosition { constructor(line, character) { this.line = line; this.character = character; } }
class TestRange {
  constructor(...args) {
    this.start = typeof args[0] === 'number' ? new TestPosition(args[0], args[1]) : args[0];
    this.end = typeof args[0] === 'number' ? new TestPosition(args[2], args[3]) : args[1];
  }
}
class TestLocation { constructor(uri, position) { this.uri = uri; this.range = position.start ? position : new TestRange(position, position); } }
class TestCodeLens { constructor(range, command) { this.range = range; this.command = command; } }
class TestEventEmitter { constructor() { this.event = disposable; } fire() {} dispose() {} }

function makeDocument(text, fileName = path.join(runtime, 'test-fixtures', 'Mir200', 'Envir', 'QuestDiary', '延迟跳转.txt')) {
  let content = text;
  const document = {
    fileName, uri: TestUri.file(fileName), languageId: 'gomscript', version: ++documentVersion, isDirty: true,
    get lineCount() { return content.split(/\r\n|\r|\n/).length; },
    getText(range) {
      if (!range) return content;
      return content.slice(document.offsetAt(range.start), document.offsetAt(range.end));
    },
    lineAt(index) {
      const value = content.split(/\r\n|\r|\n/)[typeof index === 'number' ? index : index.line];
      return { text: value, range: new TestRange(typeof index === 'number' ? index : index.line, 0, typeof index === 'number' ? index : index.line, value.length) };
    },
    positionAt(offset) {
      const prefix = content.slice(0, Math.max(0, Math.min(offset, content.length)));
      const lines = prefix.split(/\r\n|\r|\n/);
      return new TestPosition(lines.length - 1, lines[lines.length - 1].length);
    },
    offsetAt(position) {
      const lines = content.split(/\r\n|\r|\n/);
      const starts = [...content.matchAll(/\r\n|\r|\n/g)];
      return (position.line ? starts[position.line - 1].index + starts[position.line - 1][0].length : 0) + Math.min(position.character, lines[position.line].length);
    },
    getWordRangeAtPosition(position, pattern = /[\p{L}\p{N}_]+/u) {
      const line = this.lineAt(position.line).text;
      for (const match of line.matchAll(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'))) {
        if (position.character >= match.index && position.character < match.index + match[0].length) return new TestRange(position.line, match.index, position.line, match.index + match[0].length);
      }
      return undefined;
    },
    replace(value) { content = value; this.version = ++documentVersion; },
  };
  return document;
}

function activateWithStub() {
  const providers = {}, selectors = {}, events = {}, commands = new Map(), diagnostics = new Map(), sideEffects = [];
  let engine = 'GOM';
  const workspace = {
    workspaceFolders: [], textDocuments: [],
    getConfiguration(_name, scope) {
      return { get(key, fallback) { if (key === 'engine') return scope?.engine || engine; if (key === 'autoDetectEngine') return false; return fallback; } };
    },
    getWorkspaceFolder() { return undefined; },
    async findFiles() { return []; },
    async openTextDocument() { sideEffects.push('openTextDocument'); throw new Error('same-file jump must not read disk'); },
    fs: { async readFile() { sideEffects.push('readFile'); throw new Error('unexpected file read'); }, async writeFile() { throw new Error('unexpected file write'); } },
  };
  for (const name of ['onDidChangeTextDocument', 'onDidSaveTextDocument', 'onDidChangeWorkspaceFolders', 'onDidChangeConfiguration', 'onDidOpenTextDocument', 'onDidCloseTextDocument', 'onDidCreateFiles', 'onDidDeleteFiles', 'onDidRenameFiles']) {
    workspace[name] = callback => { (events[name] ||= []).push(callback); return disposable(); };
  }
  const languages = {
    createDiagnosticCollection() {
      return { set(uri, values) { diagnostics.set(uri.toString(), values); }, delete(uri) { diagnostics.delete(uri.toString()); }, clear() { diagnostics.clear(); }, forEach() {}, dispose() {} };
    },
  };
  for (const kind of ['CompletionItem', 'Hover', 'Definition', 'DocumentLink', 'Reference', 'DocumentSymbol', 'FoldingRange', 'CodeLens', 'CodeActions', 'SignatureHelp', 'DocumentSemanticTokens']) {
    languages[`register${kind}Provider`] = (selector, provider) => { selectors[kind] = selector; providers[kind] = provider; return disposable(); };
  }
  const window = {
    activeTextEditor: undefined, visibleTextEditors: [],
    createOutputChannel() { return { appendLine() {}, dispose() {} }; },
    createTextEditorDecorationType: disposable, showInformationMessage: async () => {},
    onDidChangeActiveTextEditor: disposable, onDidChangeVisibleTextEditors: disposable,
    registerTreeDataProvider: disposable,
    createStatusBarItem() { return { show() {}, dispose() {} }; },
    showWarningMessage() { throw new Error('definition lookup must not show UI'); },
    showErrorMessage() { throw new Error('definition lookup must not show UI'); },
  };
  const api = {
    MarkdownString: class {
      constructor(value = '') { this.value = value; }
      appendMarkdown(value) { this.value += value; return this; }
      appendCodeblock(value) { this.value += '\n```\n' + value + '\n```\n'; return this; }
    },
    Hover: class { constructor(contents, range) { this.contents = contents; this.range = range; } },
    Uri: TestUri, Position: TestPosition, Range: TestRange, Location: TestLocation, CodeLens: TestCodeLens,
    EventEmitter: TestEventEmitter, TreeItem: class {}, ThemeIcon: class {}, SemanticTokensLegend: class {},
    Diagnostic: class { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } },
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    StatusBarAlignment: { Right: 2 }, DecorationRangeBehavior: { ClosedOpen: 0 },
    CodeActionKind: { QuickFix: 'quickfix' },
    workspace, window, languages,
    commands: { registerCommand(name, callback) { commands.set(name, callback); return disposable(); }, registerTextEditorCommand(name, callback) { commands.set(name, callback); return disposable(); }, async executeCommand() {} },
  };
  const state = { get(_key, fallback) { return fallback; }, async update() {} };
  const context = { subscriptions: [], extensionPath: runtime, extensionUri: TestUri.file(runtime), globalState: state, workspaceState: state };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) { return request === 'vscode' ? api : originalLoad.call(this, request, parent, isMain); };
  try { require(path.join(runtime, 'out', 'assistant')).activateAssistant(context); }
  finally { Module._load = originalLoad; }
  return { providers, selectors, events, commands, diagnostics, sideEffects, workspace, setEngine(value) { engine = value; }, dispose() { for (const subscription of context.subscriptions) subscription?.dispose(); } };
}

module.exports = { activateWithStub, makeDocument, TestPosition };
