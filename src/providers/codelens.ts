import * as vscode from 'vscode';
import { findScriptLabelReferencesInText, normalizeScriptLabelKey } from '../utils/script-labels';

const DOC_SELECTOR: vscode.DocumentSelector = [
  { language: 'gomscript', scheme: 'file' },
  { language: 'plaintext', scheme: 'file', pattern: '**/*.txt' }
];

export function registerCodeLensProvider(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerCodeLensProvider(DOC_SELECTOR, {
    provideCodeLenses(document) {
      const lenses: vscode.CodeLens[] = [];
      const allText = document.getText();
      const referenceCounts = new Map<string, number>();
      for (const reference of findScriptLabelReferencesInText(allText)) {
        const key = normalizeScriptLabelKey(reference.name);
        referenceCounts.set(key, (referenceCounts.get(key) || 0) + 1);
      }

      // 标签引用计数
      const labelRe = /\[@([^\]]+)\]/g;
      let m;
      while ((m = labelRe.exec(allText)) !== null) {
        const label = m[1];
        const refCount = referenceCounts.get(normalizeScriptLabelKey(label)) || 0;

        if (refCount > 0) {
          const pos = document.positionAt(m.index);
          const line = document.lineAt(pos.line);
          const range = new vscode.Range(line.range.start, line.range.start);
          const lens = new vscode.CodeLens(range, {
            title: `${refCount} 处引用`,
            command: 'editor.action.goToReferences',
            arguments: [document.uri, pos]
          });
          lenses.push(lens);
        }
      }

      // 行备注 (workspaceState)
      const notes: Record<string, string> = context.workspaceState.get('boo.lineNotes', {});
      const docKey = document.uri.toString();
      const docNotes: Record<number, string> = notes[docKey] || {};
      for (const [lineStr, note] of Object.entries(docNotes)) {
        const lineNum = parseInt(lineStr);
        if (lineNum < document.lineCount) {
          const line = document.lineAt(lineNum);
          const range = new vscode.Range(line.range.start, line.range.start);
          const lens = new vscode.CodeLens(range, {
            title: `📝 ${note}`,
            command: 'boo.addLineNote',
            tooltip: '点击编辑此行备注'
          });
          lenses.push(lens);
        }
      }

      return lenses;
    }
  });
  context.subscriptions.push(provider);
}
