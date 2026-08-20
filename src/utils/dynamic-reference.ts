import { isScriptCommentLine } from './script-labels';

export interface InvalidDynamicReference {
  line: number;
  start: number;
  end: number;
  text: string;
}

const VARIABLE_ARGUMENT_OPERATORS = new Set([
  'STR',
  'CSTR',
  'H.STR',
  'C.STR',
  'M.STR',
]);

export function findInvalidDynamicReferences(
  lines: string[]
): InvalidDynamicReference[] {
  const result: InvalidDynamicReference[] = [];
  const dynamicReference = /<\$\s*([A-Z.]+)\s*\(([^)]*)\)>/gi;

  for (let line = 0; line < lines.length; line++) {
    if (isScriptCommentLine(lines[line])) continue;
    dynamicReference.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = dynamicReference.exec(lines[line])) !== null) {
      const operator = match[1].toUpperCase();
      if (!VARIABLE_ARGUMENT_OPERATORS.has(operator)) continue;
      const content = match[2].trim();
      if (!content || content === '*') continue;
      const hasVariable = /[NSLD]\$/i.test(content)
        || /GL\$/i.test(content)
        || /[PDMNSIGAUTJZ]\d+/i.test(content);
      if (hasVariable) continue;
      result.push({
        line,
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
      });
    }
  }
  return result;
}
