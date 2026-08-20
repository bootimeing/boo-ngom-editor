import * as vscode from 'vscode';

const DOC_SELECTOR: vscode.DocumentSelector = [
  { language: 'gomscript', scheme: 'file' },
  { language: 'plaintext', scheme: 'file', pattern: '**/*.txt' }
];

export function registerFoldingProvider(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerFoldingRangeProvider(DOC_SELECTOR, {
    provideFoldingRanges(document) {
      const ranges: vscode.FoldingRange[] = [];
      const lines: string[] = [];
      for (let li = 0; li < document.lineCount; li++) lines.push(document.lineAt(li).text);

      // 找到所有 [@xxx] 标签位置
      const labelLines: number[] = [];
      for (let li = 0; li < lines.length; li++) {
        if (/\[@[^\]]+\]/.test(lines[li])) labelLines.push(li);
      }

      // 为每个标签区域创建折叠：从标签行到下一个标签行之前
      for (let i = 0; i < labelLines.length; i++) {
        const start = labelLines[i];
        const end = i + 1 < labelLines.length ? labelLines[i + 1] - 1 : lines.length - 1;
        if (end - start >= 1) {
          ranges.push(new vscode.FoldingRange(start, end, vscode.FoldingRangeKind.Region));
        }
      }

      // 为 #IF/#OR 块创建折叠
      for (let i = 0; i < lines.length; i++) {
        const up = lines[i].trim().toUpperCase();
        if (up.startsWith('#IF(') || up.startsWith('#IF ') || up === '#IF' || up.startsWith('#OR')) {
          for (let j = i + 1; j < lines.length; j++) {
            const uj = lines[j].trim().toUpperCase();
            if (uj.startsWith('#IF(') || uj.startsWith('#IF ') || uj === '#IF' || uj.startsWith('#OR') || uj.startsWith('[@')) {
              if (j - i >= 1) ranges.push(new vscode.FoldingRange(i, j - 1, vscode.FoldingRangeKind.Region));
              break;
            }
            if (j === lines.length - 1 && j - i >= 1) {
              ranges.push(new vscode.FoldingRange(i, j, vscode.FoldingRangeKind.Region));
            }
          }
        }
      }

      // ; region / ; endregion 注释折叠
      const regionRe = /^\s*;\s*(region|endregion)\b(.*)?$/i;
      const regionStack: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(regionRe);
        if (!m) continue;
        const kind = m[1].toLowerCase();
        if (kind === 'region') {
          regionStack.push(i);
        } else if (kind === 'endregion' && regionStack.length > 0) {
          const start = regionStack.pop()!;
          if (i - start >= 1) {
            ranges.push(new vscode.FoldingRange(start, i, vscode.FoldingRangeKind.Region));
          }
        }
      }
      return ranges;
    }
  });
  context.subscriptions.push(provider);
}
