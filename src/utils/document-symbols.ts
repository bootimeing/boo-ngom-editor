export interface ScriptSectionSymbol {
  name: string;
  kind: 'function' | 'branch';
  rangeStart: number;
  rangeEnd: number;
  selectionStart: number;
  selectionEnd: number;
}

export function findScriptSectionSymbols(text: string): ScriptSectionSymbol[] {
  const labels: Array<Omit<ScriptSectionSymbol, 'rangeEnd'>> = [];
  const linePattern = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  let lineMatch: RegExpExecArray | null;
  while ((lineMatch = linePattern.exec(text)) !== null) {
    if (!lineMatch[0]) break;
    const line = lineMatch[0].replace(/[\r\n]+$/, '');
    if (/^\s*[;]/.test(line)) continue;
    const labelPattern = /\[([@~][^\]]+)\]/g;
    let labelMatch: RegExpExecArray | null;
    while ((labelMatch = labelPattern.exec(line)) !== null) {
      const selectionStart = lineMatch.index + labelMatch.index;
      labels.push({
        name: labelMatch[1],
        kind: labelMatch[1].startsWith('@') ? 'function' : 'branch',
        rangeStart: selectionStart,
        selectionStart,
        selectionEnd: selectionStart + labelMatch[0].length,
      });
    }
  }

  return labels.map((label, index) => ({
    ...label,
    rangeEnd: labels[index + 1]?.rangeStart ?? text.length,
  }));
}
