import * as path from 'path';
import * as vscode from 'vscode';
import {
  buildMonGenDropFilePlan,
  createMissingMonGenDropFiles,
  isMonGenDocumentPath,
} from '../utils/mongen-drop-files';

export function registerMonGenDropFileCommand(context: vscode.ExtensionContext): void {
  const pendingSources = new Set<string>();
  context.subscriptions.push(vscode.commands.registerCommand('boo.createMonGenDropFiles', async () => {
    const document = vscode.window.activeTextEditor?.document;
    if (!document || document.uri.scheme !== 'file' || !isMonGenDocumentPath(document.uri.fsPath)) {
      void vscode.window.showWarningMessage('请在 MonGen.txt 中使用 Alt+R');
      return;
    }
    const sourceKey = path.resolve(document.uri.fsPath).toLowerCase();
    if (pendingSources.has(sourceKey)) return;
    pendingSources.add(sourceKey);
    try {
      const version = document.version;
      const plan = buildMonGenDropFilePlan(document.uri.fsPath, document.getText());
      const missingCount = plan.targets.filter(target => !target.existingPath).length;
      if (missingCount === 0) {
        void vscode.window.showInformationMessage(plan.ignored.length
          ? `无可补建文件，${plan.ignored.length} 条怪物名无效或路径不安全` : 'MonItems 文件已齐全');
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        `MonItems 缺少 ${missingCount} 个爆率文件。是否创建空白文本？${plan.ignored.length ? `\n将跳过 ${plan.ignored.length} 条无效配置。` : ''}`,
        { modal: true }, '创建文本'
      );
      if (choice !== '创建文本') return;
      if (document.isClosed || document.version !== version
        || vscode.window.activeTextEditor?.document !== document) {
        void vscode.window.showWarningMessage('刷怪配置已变化，请重新按 Alt+R');
        return;
      }
      const result = createMissingMonGenDropFiles(plan);
      if (result.failed.length) {
        void vscode.window.showWarningMessage(
          `已创建 ${result.created.length} 个，失败 ${result.failed.length} 个：${result.failed.slice(0, 3).map(item => `${item.monsterName}（${item.message}）`).join('；')}`
        );
      } else {
        vscode.window.setStatusBarMessage(`MonItems：创建 ${result.created.length} 个，保留 ${result.existing.length} 个`, 5000);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`无法补建爆率文件：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pendingSources.delete(sourceKey);
    }
  }));
}
