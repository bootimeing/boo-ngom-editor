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
const DYNAMIC_CUSTOM_PREFIX_PATTERN = /^(?:GL\$|[NSLGD]\$)[A-Za-z0-9_\u3400-\u9fff]+/i;
const DYNAMIC_NUMBERED_PREFIX_PATTERN = /^[UTAG]$/i;

function isNameCharacter(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_$\u3400-\u9fff]/.test(value));
}

export function isWrappableVariable(value: string): boolean {
  const dynamic = parseDynamicVariableAt(value, 0);
  if (dynamic?.end === value.length) return true;
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

function findDynamicExpressionEnd(text: string, start: number): number | undefined {
  if (!text.startsWith('<$', start)) return undefined;
  let depth = 1;
  let cursor = start + 2;
  while (cursor < text.length) {
    if (text.startsWith('<$', cursor)) {
      depth++;
      cursor += 2;
      continue;
    }
    if (text[cursor] === '>') {
      depth--;
      cursor++;
      if (depth === 0) return cursor;
      continue;
    }
    cursor++;
  }
  return undefined;
}

function isStrExpressionAt(text: string, start: number): boolean {
  return text.slice(start, start + 6).toUpperCase() === '<$STR(';
}

function consumeStrExpressionSuffixes(text: string, start: number): number | undefined {
  let cursor = start;
  let count = 0;
  while (isStrExpressionAt(text, cursor)) {
    const end = findDynamicExpressionEnd(text, cursor);
    if (end === undefined || text[end - 2] !== ')') return undefined;
    cursor = end;
    count++;
  }
  return count > 0 ? cursor : undefined;
}

function parseDynamicVariableAt(text: string, start: number): Span | undefined {
  let suffixStart: number | undefined;
  const prefix = text[start];
  if (DYNAMIC_NUMBERED_PREFIX_PATTERN.test(prefix) && isStrExpressionAt(text, start + 1)) {
    suffixStart = start + 1;
  } else {
    const custom = DYNAMIC_CUSTOM_PREFIX_PATTERN.exec(text.slice(start));
    if (custom) {
      const candidateSuffixStart = start + custom[0].length;
      if (isStrExpressionAt(text, candidateSuffixStart)) suffixStart = candidateSuffixStart;
    }
  }
  if (suffixStart === undefined) return undefined;
  const end = consumeStrExpressionSuffixes(text, suffixStart);
  return end === undefined ? undefined : { start, end };
}

function findDynamicExpressionSpans(text: string): Span[] {
  const result: Span[] = [];
  let start = 0;
  while ((start = text.indexOf('<$', start)) >= 0) {
    const end = findDynamicExpressionEnd(text, start) ?? text.length;
    result.push({ start, end });
    start = Math.max(end, start + 2);
  }
  return result;
}

function overlapsExcludedSpan(start: number, end: number, spans: Span[]): boolean {
  return spans.some(span => start < span.end && end > span.start);
}

function startsInsideSpan(position: number, spans: Span[]): boolean {
  return spans.some(span => position >= span.start && position < span.end);
}

function hasInvalidDynamicOverlap(start: number, end: number, spans: Span[]): boolean {
  return spans.some(span => (
    start < span.end
    && end > span.start
    && !(span.start >= start && span.end <= end)
  ));
}

export function findVariableWrapEdits(text: string): VariableWrapEdit[] {
  const comments = findCommentSpans(text);
  const dynamicExpressions = findDynamicExpressionSpans(text);
  const dynamicVariables: Span[] = [];
  const result: VariableWrapEdit[] = [];

  let cursor = 0;
  while (cursor < text.length) {
    const dynamic = parseDynamicVariableAt(text, cursor);
    if (!dynamic) {
      cursor++;
      continue;
    }
    dynamicVariables.push(dynamic);
    if (
      !isNameCharacter(text[dynamic.start - 1])
      && !isNameCharacter(text[dynamic.end])
      && !overlapsExcludedSpan(dynamic.start, dynamic.end, comments)
      && !startsInsideSpan(dynamic.start, dynamicExpressions)
    ) {
      const variable = text.slice(dynamic.start, dynamic.end);
      result.push({
        ...dynamic,
        variable,
        replacement: `<$STR(${variable})>`,
      });
    }
    cursor = Math.max(dynamic.end, cursor + 1);
  }

  const excluded = [...comments, ...dynamicExpressions, ...dynamicVariables];
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
  return result.sort((left, right) => left.start - right.start || right.end - left.end);
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
  const documentComments = documentText ? findCommentSpans(documentText) : [];
  const documentDynamics = documentText ? findDynamicExpressionSpans(documentText) : [];
  for (const selection of selections) {
    for (const edit of findVariableWrapEdits(selection.text)) {
      const start = selection.start + edit.start;
      const end = selection.start + edit.end;
      if (documentText) {
        const isDynamicVariable = edit.variable.includes('<$');
        const parsedDynamic = isDynamicVariable
          ? parseDynamicVariableAt(documentText, start)
          : undefined;
        if (
          isNameCharacter(documentText[start - 1])
          || isNameCharacter(documentText[end])
          || overlapsExcludedSpan(start, end, documentComments)
          || (isDynamicVariable && (
            parsedDynamic?.end !== end
            || hasInvalidDynamicOverlap(start, end, documentDynamics)
          ))
          || (!isDynamicVariable && overlapsExcludedSpan(start, end, documentDynamics))
        ) {
          continue;
        }
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
