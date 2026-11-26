import * as path from 'path';
import * as vscode from 'vscode';
import { resolveEngineRoot } from '../utils/engine-detect';
import { normalizeEngineId } from '../utils/engine-registry';
import { auditServerReferences, ServerReferenceReport } from '../utils/server-reference-audit';

const labels = { monster: 'MonGen 怪物名', item: 'MonItems 物品名', connection: '地图连接点', npc: 'NPC 坐标', spawn: '刷怪中心坐标', source: '配置来源' };

function reportText(report: ServerReferenceReport): string {
  const lines = ['服务端配置核对', report.root, '引擎　' + report.engine, '数据库　' + (report.database || '未能确定'), '',
    '核对项目　通过 / 错误 / 待核实（按展开后的引用次数）'];
  for (const [key, counts] of Object.entries(report.counts)) {
    lines.push(labels[key as keyof ServerReferenceReport['counts']] + '　' + [counts.valid, counts.invalid, counts.unverified].join(' / '));
  }
  if (report.findings.length) lines.push('', '可在 VS Code 的“问题”面板定位对应源文件。');
  for (const finding of report.findings) lines.push(
    (finding.status === 'invalid' ? '错误' : '待核实') + '　' + path.relative(report.root, finding.file) + '(' + finding.line + ')　' + finding.message + (finding.occurrences > 1 ? ' 共引用 ' + finding.occurrences + ' 次。' : '')
  );
  return lines.join('\n');
}

export function registerServerReferenceAudit(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('BOO 服务端配置核对');
  const latest = new Map<string, number>();
  const diagnosticsByRoot = new Map<string, string[]>();
  context.subscriptions.push(diagnostics, vscode.commands.registerCommand('boo.auditServerReferences', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) { void vscode.window.showInformationMessage('请先打开传奇服务端工作区。'); return; }
    const uri = vscode.window.activeTextEditor?.document.uri;
    const folder = (uri && vscode.workspace.getWorkspaceFolder(uri)) ||
      (folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: '选择要核对的服务端' }));
    if (!folder) return;
    const root = resolveEngineRoot(folder.uri.fsPath);
    const revision = (latest.get(root) || 0) + 1;
    latest.set(root, revision);
    const engine = normalizeEngineId(vscode.workspace.getConfiguration('boo', folder.uri).get<string>('engine'));
    try {
      const report = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'BOO 正在核对服务端数据库与地图' },
        () => auditServerReferences(root, engine));
      if (latest.get(root) !== revision) return;
      for (const old of diagnosticsByRoot.get(root) || []) diagnostics.delete(vscode.Uri.file(old));
      const grouped = new Map<string, vscode.Diagnostic[]>();
      for (const finding of report.findings) {
        const items = grouped.get(finding.file) || [];
        const line = Math.max(0, finding.line - 1);
        const severity = finding.status === 'invalid' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Information;
        const diagnostic = new vscode.Diagnostic(new vscode.Range(line, 0, line, 1), finding.message, severity);
        diagnostic.source = 'BOO · ' + labels[finding.check];
        items.push(diagnostic);
        grouped.set(finding.file, items);
      }
      for (const [file, items] of grouped) diagnostics.set(vscode.Uri.file(file), items);
      diagnosticsByRoot.set(root, [...grouped.keys()]);
      const document = await vscode.workspace.openTextDocument({ language: 'plaintext', content: reportText(report) });
      await vscode.window.showTextDocument(document, { preview: true });
    } catch (error) {
      void vscode.window.showErrorMessage('服务端配置核对失败。' + (error instanceof Error ? error.message : String(error)));
    }
  }));
}
