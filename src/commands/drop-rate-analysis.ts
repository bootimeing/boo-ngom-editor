import * as vscode from 'vscode';
import { EngineId } from '../types';
import { dropAnalysisMarkdown } from '../utils/drop-rate-analysis';
import { analyzeDropRatesWithExternal } from '../utils/drop-rate-external';

/** Analyze the editor buffer (including unsaved text); never save or execute it. */
export function registerDropRateAnalysisCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('boo.analyzeDropRates', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await vscode.window.showInformationMessage('请先打开怪物爆率文件。');
      return;
    }
    const engine = vscode.workspace.getConfiguration('boo', editor.document.uri).get<string>('engine');
    if (!engine || !['GOM', 'GEE', '996PC'].includes(engine)) {
      await vscode.window.showWarningMessage('请先在 BOO 设置中选择 GOM、翎风或 996PC 引擎。');
      return;
    }
    try {
      const result = analyzeDropRatesWithExternal(editor.document.getText(), engine as EngineId, editor.document.fileName);
      const report = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: dropAnalysisMarkdown(result, editor.document.fileName),
      });
      await vscode.window.showTextDocument(report, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    } catch (error) {
      await vscode.window.showErrorMessage(`爆率分析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  });
}
