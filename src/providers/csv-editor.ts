import * as vscode from 'vscode';
import * as path from 'path';
import { parseCsvTable, serializeCsvTable } from '../utils/csv-table';
import {
  applyTableChanges,
  readTableChanges,
  readTableRows,
} from '../utils/table-edit';
import { tableEditorWebviewHtml, tableEditorWebviewOptions } from '../utils/table-editor-webview';

export class CsvEditorProvider implements vscode.CustomTextEditorProvider {
  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      'boo.csvEditor', new CsvEditorProvider(context),
      { webviewOptions: {}, supportsMultipleEditorsPerDocument: false }
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = tableEditorWebviewOptions(this.context);
    webviewPanel.webview.html = tableEditorWebviewHtml(this.context, webviewPanel.webview);

    let applyingEdit = false;
    let webviewReady = false;
    let state = parseCsvTable(document.getText());
    let operationQueue: Promise<void> = Promise.resolve();

    const postData = (): void => {
      if (applyingEdit || !webviewReady) return;
      void webviewPanel.webview.postMessage({
        type: 'load',
        mode: 'csv',
        rows: state.rows,
        fileName: path.basename(document.fileName),
      });
    };

    const reportError = (error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error);
      void webviewPanel.webview.postMessage({ type: 'error', message });
      void vscode.window.showErrorMessage(`CSV 表格修改失败: ${message}`);
    };

    const enqueue = (operation: () => Promise<void>): void => {
      operationQueue = operationQueue.then(operation).catch(reportError);
    };

    const applyMessageEdit = async (message: Record<string, unknown>): Promise<void> => {
      const nextRows = message.operation === 'replace'
        ? readTableRows(message.rows)
        : applyTableChanges(
          state.rows,
          readTableChanges(message.changes),
          typeof message.rowCount === 'number' ? message.rowCount : undefined,
          typeof message.columnCount === 'number' ? message.columnCount : undefined
        );
      const nextState = { ...state, rows: nextRows };
      const newText = serializeCsvTable(nextState);
      const revision = typeof message.revision === 'number' ? message.revision : 0;
      if (newText === document.getText()) {
        state = nextState;
        void webviewPanel.webview.postMessage({ type: 'saved', revision });
        return;
      }

      applyingEdit = true;
      try {
        const edit = new vscode.WorkspaceEdit();
        const currentText = document.getText();
        edit.replace(document.uri, new vscode.Range(
          document.positionAt(0),
          document.positionAt(currentText.length)
        ), newText);
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied) throw new Error('VS Code 拒绝了表格修改');
        // The operation queue serializes edits, so this state cannot be replaced concurrently.
        // eslint-disable-next-line require-atomic-updates
        state = nextState;
        void webviewPanel.webview.postMessage({ type: 'saved', revision });
      } finally {
        applyingEdit = false;
      }
    };

    const messageSub = webviewPanel.webview.onDidReceiveMessage(message => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') {
        webviewReady = true;
        postData();
      } else if (message.type === 'applyEdit') {
        enqueue(() => applyMessageEdit(message as Record<string, unknown>));
      } else if (message.type === 'undo' || message.type === 'redo') {
        enqueue(async () => {
          await vscode.commands.executeCommand(message.type);
        });
      } else if (message.type === 'saveDocument') {
        enqueue(async () => {
          await vscode.commands.executeCommand('workbench.action.files.save');
        });
      } else if (message.type === 'exit') {
        enqueue(async () => {
          await vscode.window.showTextDocument(document, {
            viewColumn: webviewPanel.viewColumn,
            preview: false,
          });
        });
      }
    });

    const changeSub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() !== document.uri.toString() || applyingEdit) return;
      state = parseCsvTable(document.getText());
      postData();
    });
    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      messageSub.dispose();
    });

  }
}
