import * as fs from 'fs';
import * as vscode from 'vscode';
import { secureWebviewHtml } from './webview-security';

const RESOURCE_TOKENS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['{{TABULATOR_CSS_URI}}', ['vendor', 'tabulator', 'tabulator_midnight.min.css']],
  ['{{TABLE_EDITOR_CSS_URI}}', ['table-editor.css']],
  ['{{TABLE_EDITOR_CORE_URI}}', ['table-editor-core.js']],
  ['{{TABULATOR_JS_URI}}', ['vendor', 'tabulator', 'tabulator.min.js']],
  ['{{TABLE_EDITOR_JS_URI}}', ['table-editor.js']],
];

export function tableEditorWebviewOptions(context: vscode.ExtensionContext): vscode.WebviewOptions {
  return {
    enableScripts: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
  };
}

export function tableEditorWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview
): string {
  const mediaRoot = vscode.Uri.joinPath(context.extensionUri, 'media');
  const htmlUri = vscode.Uri.joinPath(mediaRoot, 'csv-editor.html');
  let html = fs.readFileSync(htmlUri.fsPath, 'utf8');

  for (const [token, segments] of RESOURCE_TOKENS) {
    const resourceUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, ...segments)).toString();
    html = html.split(token).join(resourceUri);
  }
  if (/\{\{[A-Z0-9_]+_URI\}\}/.test(html)) {
    throw new Error('表格编辑器资源地址替换不完整');
  }
  return secureWebviewHtml(webview, html);
}
