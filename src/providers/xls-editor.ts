import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { openXlsTable, serializeXlsTable, updateXlsTableRows, XlsTableState } from '../utils/xls-table';
import {
  applyTableChanges,
  readTableChanges,
  readTableRows,
  tableRowsEqual,
} from '../utils/table-edit';
import { tableEditorWebviewHtml, tableEditorWebviewOptions } from '../utils/table-editor-webview';

function cloneRows(rows: string[][]): string[][] {
  return rows.map(row => [...row]);
}

class XlsDocument implements vscode.CustomDocument {
  state: XlsTableState;
  formulaSaveConfirmed = false;
  formulaBackupPath = '';

  constructor(readonly uri: vscode.Uri, data: Uint8Array) {
    this.state = openXlsTable(Buffer.from(data));
  }

  dispose(): void {}
}

async function writeVerifiedXls(uri: vscode.Uri, data: Buffer): Promise<void> {
  openXlsTable(data);
  if (uri.scheme !== 'file') {
    await vscode.workspace.fs.writeFile(uri, data);
    return;
  }
  const target = uri.fsPath;
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.boo-write-${process.pid}-${Date.now()}.xls`
  );
  const replacementBackup = `${temporary}.original`;
  try {
    fs.writeFileSync(temporary, data);
    openXlsTable(fs.readFileSync(temporary));
    if (!fs.existsSync(target)) {
      fs.renameSync(temporary, target);
      return;
    }
    fs.renameSync(target, replacementBackup);
    try {
      fs.renameSync(temporary, target);
      fs.unlinkSync(replacementBackup);
    } catch (error) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      fs.renameSync(replacementBackup, target);
      throw error;
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    if (fs.existsSync(replacementBackup)) fs.unlinkSync(replacementBackup);
  }
}

export class XlsEditorProvider implements vscode.CustomEditorProvider<XlsDocument> {
  private readonly changeEmitter = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<XlsDocument> | vscode.CustomDocumentContentChangeEvent<XlsDocument>
  >();
  readonly onDidChangeCustomDocument = this.changeEmitter.event;
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new XlsEditorProvider(context);
    return vscode.window.registerCustomEditorProvider('boo.xlsEditor', provider, {
      webviewOptions: {},
      supportsMultipleEditorsPerDocument: false,
    });
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(uri: vscode.Uri): Promise<XlsDocument> {
    return new XlsDocument(uri, await vscode.workspace.fs.readFile(uri));
  }

  async resolveCustomEditor(document: XlsDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.options = tableEditorWebviewOptions(this.context);
    panel.webview.html = tableEditorWebviewHtml(this.context, panel.webview);
    this.panels.set(document.uri.toString(), panel);
    let operationQueue: Promise<void> = Promise.resolve();

    const postData = (): void => {
      void panel.webview.postMessage({
        type: 'load',
        mode: 'xls',
        rows: document.state.rows,
        fileName: path.basename(document.uri.fsPath),
        sheetName: document.state.sheetName,
      });
    };

    const reportError = (error: unknown): void => {
      const message = error instanceof Error ? error.message : String(error);
      void panel.webview.postMessage({ type: 'error', message });
      void vscode.window.showErrorMessage(`XLS 表格修改失败: ${message}`);
    };

    const enqueue = (operation: () => Promise<void>): void => {
      operationQueue = operationQueue.then(operation).catch(reportError);
    };

    const handleMessage = async (message: Record<string, unknown>): Promise<void> => {
      if (message.type === 'ready') {
        postData();
        return;
      }
      if (message.type === 'exit') {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        return;
      }
      if (message.type === 'undo' || message.type === 'redo') {
        await vscode.commands.executeCommand(message.type);
        return;
      }
      if (message.type === 'saveDocument') {
        await vscode.commands.executeCommand('workbench.action.files.save');
        return;
      }
      if (message.type !== 'applyEdit') return;

      const before = cloneRows(document.state.rows);
      const after = message.operation === 'replace'
        ? readTableRows(message.rows)
        : applyTableChanges(
          before,
          readTableChanges(message.changes),
          typeof message.rowCount === 'number' ? message.rowCount : undefined,
          typeof message.columnCount === 'number' ? message.columnCount : undefined
        );
      const revision = typeof message.revision === 'number' ? message.revision : 0;
      if (tableRowsEqual(before, after)) {
        void panel.webview.postMessage({ type: 'saved', revision });
        return;
      }
      updateXlsTableRows(document.state, after);
      this.changeEmitter.fire({
        document,
        label: typeof message.label === 'string' && message.label.length
          ? message.label.slice(0, 80)
          : '编辑 XLS 表格',
        undo: async () => {
          updateXlsTableRows(document.state, before);
          postData();
        },
        redo: async () => {
          updateXlsTableRows(document.state, after);
          postData();
        },
      });
      void panel.webview.postMessage({ type: 'saved', revision });
    };

    const messageSub = panel.webview.onDidReceiveMessage(message => {
      if (!message || typeof message !== 'object') return;
      enqueue(() => handleMessage(message as Record<string, unknown>));
    });

    panel.onDidDispose(() => {
      this.panels.delete(document.uri.toString());
      messageSub.dispose();
    });
  }

  async saveCustomDocument(document: XlsDocument): Promise<void> {
    await this.confirmFormulaSave(document, document.uri);
    await writeVerifiedXls(document.uri, serializeXlsTable(document.state));
  }

  async saveCustomDocumentAs(document: XlsDocument, destination: vscode.Uri): Promise<void> {
    await this.confirmFormulaSave(document, destination);
    await writeVerifiedXls(destination, serializeXlsTable(document.state));
  }

  async revertCustomDocument(document: XlsDocument): Promise<void> {
    document.state = openXlsTable(await vscode.workspace.fs.readFile(document.uri));
    document.formulaSaveConfirmed = false;
    document.formulaBackupPath = '';
    void this.panels.get(document.uri.toString())?.webview.postMessage({
      type: 'load',
      mode: 'xls',
      rows: document.state.rows,
      fileName: path.basename(document.uri.fsPath),
      sheetName: document.state.sheetName,
    });
  }

  async backupCustomDocument(
    document: XlsDocument,
    context: vscode.CustomDocumentBackupContext
  ): Promise<vscode.CustomDocumentBackup> {
    await writeVerifiedXls(context.destination, serializeXlsTable(document.state));
    return {
      id: context.destination.toString(),
      delete: () => {
        void vscode.workspace.fs.delete(context.destination).then(
          undefined,
          () => {
            // VS Code may already have removed an expired backup.
          }
        );
      },
    };
  }

  private async confirmFormulaSave(document: XlsDocument, destination: vscode.Uri): Promise<void> {
    if (document.state.formulaCellCount <= 0 || document.formulaSaveConfirmed) return;
    const choice = await vscode.window.showWarningMessage(
      `此 XLS 含 ${document.state.formulaCellCount} 个公式。当前兼容写入会保留计算值，但 BIFF8 公式本身可能被转成数值。`,
      { modal: true, detail: '继续保存前会在原文件旁自动建立一份公式备份。' },
      '备份并继续'
    );
    if (choice !== '备份并继续') throw new vscode.CancellationError();
    if (document.uri.scheme === 'file' && fs.existsSync(document.uri.fsPath)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = `${document.uri.fsPath}.boo-formula-${stamp}.bak`;
      fs.copyFileSync(document.uri.fsPath, backupPath);
      document.formulaBackupPath = backupPath;
      void vscode.window.showInformationMessage(`XLS 公式备份已创建: ${path.basename(backupPath)}`);
    } else if (destination.scheme === 'file' && fs.existsSync(destination.fsPath)) {
      const backupPath = `${destination.fsPath}.boo-formula.bak`;
      fs.copyFileSync(destination.fsPath, backupPath);
      document.formulaBackupPath = backupPath;
    }
    document.formulaSaveConfirmed = true;
  }
}
