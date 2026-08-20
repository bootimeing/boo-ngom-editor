import { isScriptCommentLine } from './script-labels';

export interface VariableWrapEdit {
  start: number;
  end: number;
  variable: string;
  replacement: string;
}

export interface VariableWrapResult {
  text: string;
  count: number;
  edits: VariableWrapEdit[];
}

export interface VariableWrapSelection {
  start: number;
  text: string;
}

export interface AbsoluteVariableWrapEdit {
  start: number;
  end: number;
  replacement: string;
}

interface Span {
  start: number;
  end: number;
}

const VARIABLE_PATTERN = /(?:GL\$|[NSLGD]\$)[A-Za-z0-9_\u3400-\u9fff]+|[AGUTPJZNSMDI]\d+/gi;
const CUSTOM_VARIABLE_PATTERN = /^(?:GL\$|[NSLGD]\$)[A-Za-z0-9_\u3400-\u9fff]+$/i;
const NUMBERED_VARIABLE_PATTERN = /^([AGUTPJZNSMDI])(\d+)$/i;

function isNameCharacter(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_$\u3400-\u9fff]/.test(value));
}

export function isWrappableVariable(value: string): boolean {
  if (CUSTOM_VARIABLE_PATTERN.test(value)) return true;
  const numbered = NUMBERED_VARIABLE_PATTERN.exec(value);
  if (!numbered) return false;
  const index = Number(numbered[2]);
  if (!Number.isInteger(index)) return false;
  const prefix = numbered[1].toUpperCase();
  return index <= (prefix === 'U' || prefix === 'T' ? 499 : 999);
}

function findCommentSpans(text: string): Span[] {
  const result: Span[] = [];
  let start = 0;
  while (start <= text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline >= 0 ? newline : text.length;
    const line = text.slice(start, end).replace(/\r$/, '');
    if (isScriptCommentLine(line)) result.push({ start, end });
    if (newline < 0) break;
    start = newline + 1;
  }
  return result;
}

function findDynamicExpressionSpans(text: string): Span[] {
  const result: Span[] = [];
  let start = 0;
  while ((start = text.indexOf('<$', start)) >= 0) {
    let depth = 1;
    let cursor = start + 2;
    while (cursor < text.length && depth > 0) {
      if (text.startsWith('<$', cursor)) {
        depth++;
        cursor += 2;
        continue;
      }
      if (text[cursor] === '>') depth--;
      cursor++;
    }
    result.push({ start, end: depth === 0 ? cursor : text.length });
    start = Math.max(cursor, start + 2);
  }
  return result;
}

function overlapsExcludedSpan(start: number, end: number, spans: Span[]): boolean {
  return spans.some(span => start < span.end && end > span.start);
}

export function findVariableWrapEdits(text: string): VariableWrapEdit[] {
  const excluded = [...findCommentSpans(text), ...findDynamicExpressionSpans(text)];
  const result: VariableWrapEdit[] = [];
  VARIABLE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VARIABLE_PATTERN.exec(text)) !== null) {
    const variable = match[0];
    const start = match.index;
    const end = start + variable.length;
    if (
      !isNameCharacter(text[start - 1])
      && !isNameCharacter(text[end])
      && isWrappableVariable(variable)
      && !overlapsExcludedSpan(start, end, excluded)
    ) {
      result.push({
        start,
        end,
        variable,
        replacement: `<$STR(${variable})>`,
      });
    }
    if (VARIABLE_PATTERN.lastIndex >= text.length) break;
  }
  return result;
}

export function wrapVariablesInText(text: string): VariableWrapResult {
  const edits = findVariableWrapEdits(text);
  let transformed = text;
  for (let index = edits.length - 1; index >= 0; index--) {
    const edit = edits[index];
    transformed = transformed.slice(0, edit.start) + edit.replacement + transformed.slice(edit.end);
  }
  return { text: transformed, count: edits.length, edits };
}

export function collectVariableWrapEdits(
  selections: VariableWrapSelection[],
  documentText?: string
): AbsoluteVariableWrapEdit[] {
  const uniqueEdits = new Map<string, AbsoluteVariableWrapEdit>();
  const documentExcluded = documentText
    ? [...findCommentSpans(documentText), ...findDynamicExpressionSpans(documentText)]
    : [];
  for (const selection of selections) {
    for (const edit of findVariableWrapEdits(selection.text)) {
      const start = selection.start + edit.start;
      const end = selection.start + edit.end;
      if (documentText && (
        isNameCharacter(documentText[start - 1])
        || isNameCharacter(documentText[end])
        || overlapsExcludedSpan(start, end, documentExcluded)
      )) {
        continue;
      }
      uniqueEdits.set(`${start}:${end}`, { start, end, replacement: edit.replacement });
    }
  }
  const nonOverlapping: AbsoluteVariableWrapEdit[] = [];
  const ascending = [...uniqueEdits.values()].sort((left, right) => (
    left.start - right.start || right.end - left.end
  ));
  for (const edit of ascending) {
    const previous = nonOverlapping[nonOverlapping.length - 1];
    if (!previous || edit.start >= previous.end) nonOverlapping.push(edit);
  }
  return nonOverlapping.sort((left, right) => (
    right.start - left.start || right.end - left.end
  ));
}
