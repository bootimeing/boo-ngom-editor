import * as vscode from 'vscode';
import { TABLE_CONFIGS, matchTableFile, parseTableColumns } from '../utils/table-configs';
import { secureWebviewHtml } from '../utils/webview-security';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildHtml(text: string, fileKey: string): string {
  const lines = text.split(/\r?\n/);
  const hdrCols = TABLE_CONFIGS[fileKey].split('│').map(c => c.trim());

  let rows = '';
  for (let li = 0; li < lines.length; li++) {
    const trimmed = lines[li].trim();
    if (!trimmed) continue;
    const isComment = trimmed.startsWith(';');
    if (isComment) {
      rows += `<tr class="cmt" data-li="${li}"><td colspan="${hdrCols.length}">${escapeHtml(trimmed)}</td></tr>`;
    } else {
      const cols = parseTableColumns(lines[li]).map(c => c.value);
      rows += `<tr data-li="${li}">`;
      for (let ci = 0; ci < hdrCols.length; ci++) {
        rows += `<td contenteditable="true" data-ci="${ci}">${ci < cols.length ? escapeHtml(cols[ci]) : ''}</td>`;
      }
      rows += '</tr>';
    }
  }

  const hdrHtml = hdrCols.map((c, i) => `<th data-ci="${i}">${escapeHtml(c)}</th>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1e1e1e;color:#ccc;font-family:Consolas,monospace;font-size:12px;overflow:auto}
table{border-collapse:collapse;width:max-content;min-width:100%}
thead th{position:sticky;top:0;background:#2a2a2a;color:#ff8c00;padding:4px 10px;border:1px solid #555;white-space:nowrap;font-weight:bold;z-index:2;cursor:default}
tbody td{padding:3px 10px;border:1px solid #333;white-space:pre;min-width:60px;outline:none}
tbody td:focus{background:#3a3a3a;color:#fff;outline:1px solid #0e639c}
tbody tr:nth-child(even) td{background:#252525}
tbody tr:nth-child(even) td:focus{background:#3a3a3a}
tbody tr.cmt td{background:#1a1a1a;color:#666;font-style:italic;cursor:default}
</style></head><body>
<table><thead><tr>${hdrHtml}</tr></thead><tbody>${rows}</tbody></table>
<script>
var vscode = acquireVsCodeApi();
var headerCols = ${JSON.stringify(hdrCols)};

document.addEventListener('keydown', function(e) {
  var td = document.activeElement;
  if (!td || td.tagName !== 'TD' || !td.contentEditable || td.contentEditable === 'false') return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    td.blur();
  }
});

document.addEventListener('blur', function(e) {
  var td = e.target;
  if (!td || td.tagName !== 'TD') return;
  var tr = td.parentElement;
  if (!tr || tr.tagName !== 'TR') return;
  var li = parseInt(tr.getAttribute('data-li'));
  if (isNaN(li)) return;
  var cols = [];
  var allTds = tr.querySelectorAll('td');
  for (var i = 0; i < allTds.length; i++) {
    cols.push(allTds[i].textContent || '');
  }
  // trim trailing empty columns
  while (cols.length > 0 && cols[cols.length-1] === '') cols.pop();
  vscode.postMessage({ type: 'rowChanged', lineIndex: li, cols: cols });
}, true);
</script>
</body></html>`;
}

export class TableEditorProvider implements vscode.CustomTextEditorProvider {
  static register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      'boo.tableEditor',
      new TableEditorProvider(),
      {
        webviewOptions: {},
        supportsMultipleEditorsPerDocument: false
      }
    );
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const fileKey = matchTableFile(document.fileName);
    if (!fileKey) return;

    webviewPanel.webview.options = { enableScripts: true };

    let updating = false;

    function refresh() {
      if (updating) return;
      webviewPanel.webview.html = secureWebviewHtml(
        webviewPanel.webview,
        buildHtml(document.getText(), fileKey!)
      );
    }

    refresh();

    webviewPanel.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'rowChanged') {
        const li = msg.lineIndex as number;
        const cols = msg.cols as string[];
        const newLine = cols.join('\t');
        const oldLine = document.lineAt(li).text;

        if (newLine === oldLine) return;

        updating = true;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri,
          new vscode.Range(li, 0, li, oldLine.length),
          newLine
        );
        vscode.workspace.applyEdit(edit).then(() => {
          updating = false;
          refresh();
        }, () => {
          updating = false;
        });
      }
    });

    const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        refresh();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
    });
  }
}
