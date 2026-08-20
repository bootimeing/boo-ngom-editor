import { ActiveStaticLanguageEntry } from './static-language';

export interface SayMarkupToken {
  start: number;
  end: number;
  markupEnd: number;
  text: string;
  entry: ActiveStaticLanguageEntry;
}

export interface SayMarkupParameterSpan {
  start: number;
  end: number;
  text: string;
  index: number;
  meaning: string;
}

interface SayMarkupTemplateLiteral {
  kind: 'literal';
  value: string;
}

interface SayMarkupTemplateParameter {
  kind: 'parameter';
  index: number;
  meaning: string;
}

type SayMarkupTemplatePart = SayMarkupTemplateLiteral | SayMarkupTemplateParameter;

export type SayMarkupIndex = Map<string, ActiveStaticLanguageEntry[]>;

export function buildSayMarkupIndex(entries: readonly ActiveStaticLanguageEntry[]): SayMarkupIndex {
  const result: SayMarkupIndex = new Map();
  for (const entry of entries) {
    const token = sayMarkupTokenFromLabel(entry.label);
    if (!token) continue;
    const key = token.toUpperCase();
    const values = result.get(key) || [];
    values.push(entry);
    result.set(key, values);
  }
  return result;
}

export function sayMarkupTokenFromLabel(label: string): string | undefined {
  return /^(<&?[A-Za-z_][A-Za-z0-9_.]*)/.exec(label.trim())?.[1];
}

export function sayMarkupParameterMeanings(entry: ActiveStaticLanguageEntry): string[] {
  return sayMarkupTemplateParts(entry)
    .filter((part): part is SayMarkupTemplateParameter => part.kind === 'parameter')
    .sort((left, right) => left.index - right.index)
    .map(part => part.meaning);
}

export function findSayMarkupTokens(line: string, index: SayMarkupIndex): SayMarkupToken[] {
  if (!line || /^\s*;/.test(line)) return [];
  const result: SayMarkupToken[] = [];
  const pattern = /<&?[A-Za-z_][A-Za-z0-9_.]*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const entries = index.get(match[0].toUpperCase());
    if (!entries?.length) continue;
    const markupEnd = findAngleMarkupEnd(line, match.index);
    const resolvedMarkupEnd = markupEnd >= 0 ? markupEnd + 1 : line.length;
    const markup = line.slice(match.index, resolvedMarkupEnd);
    result.push({
      start: match.index,
      end: match.index + match[0].length,
      markupEnd: resolvedMarkupEnd,
      text: match[0],
      entry: selectBestEntry(entries, markup),
    });
  }
  return result;
}

export function findSayMarkupTokenAt(
  line: string,
  character: number,
  index: SayMarkupIndex
): SayMarkupToken | undefined {
  return findSayMarkupTokens(line, index).find(token => (
    token.start <= character && character <= token.end
  ));
}

export function findSayMarkupParameterAt(
  line: string,
  character: number,
  index: SayMarkupIndex
): SayMarkupParameterSpan | undefined {
  for (const token of findSayMarkupTokens(line, index)) {
    if (character < token.end || character >= token.markupEnd) continue;
    const parameter = findSayMarkupParameterSpans(line, token).find(span => (
      span.start <= character && character < span.end
    ));
    if (parameter) return parameter;
  }
  return undefined;
}

export function findSayMarkupParameterSpans(
  line: string,
  token: SayMarkupToken
): SayMarkupParameterSpan[] {
  const parts = sayMarkupTemplateParts(token.entry);
  if (!parts.some(part => part.kind === 'parameter')) return [];

  const markup = line.slice(token.start, token.markupEnd);
  const expression = parts.map(part => (
    part.kind === 'literal' ? escapeRegExp(part.value) : '([\\s\\S]*?)'
  )).join('');
  const match = new RegExp(`^${expression}$`, 'i').exec(markup);
  if (!match) return [];

  const result: SayMarkupParameterSpan[] = [];
  let cursor = 0;
  let captureIndex = 1;
  for (const part of parts) {
    if (part.kind === 'literal') {
      cursor += part.value.length;
      continue;
    }
    const value = match[captureIndex++] || '';
    const start = token.start + cursor;
    const end = start + value.length;
    result.push({ start, end, text: value, index: part.index, meaning: part.meaning });
    cursor += value.length;
  }
  return result;
}

function selectBestEntry(
  entries: readonly ActiveStaticLanguageEntry[],
  markup: string
): ActiveStaticLanguageEntry {
  const hasLink = /\/@/i.test(markup);
  const hasPipe = markup.includes('|');
  return [...entries].sort((left, right) => (
    entryShapeScore(right, hasLink, hasPipe) - entryShapeScore(left, hasLink, hasPipe)
  ))[0];
}

function entryShapeScore(
  entry: ActiveStaticLanguageEntry,
  hasLink: boolean,
  hasPipe: boolean
): number {
  const label = entry.label;
  let score = 0;
  if (/\/@/i.test(label) === hasLink) score += 4;
  if (label.includes('|') === hasPipe) score += 2;
  return score;
}

function findAngleMarkupEnd(line: string, start: number): number {
  let depth = 0;
  let quote = '';
  for (let cursor = start; cursor < line.length; cursor++) {
    const char = line[cursor];
    if (quote) {
      if (char === quote && line[cursor - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '<') depth++;
    if (char === '>' && --depth === 0) return cursor;
  }
  return -1;
}

function sayMarkupTemplateParts(entry: ActiveStaticLanguageEntry): SayMarkupTemplatePart[] {
  const snippet = entry.snippet || '';
  const result: SayMarkupTemplatePart[] = [];
  const values = new Set<number>();
  const pattern = /\$\{(\d+):([^}]+)\}/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(snippet)) !== null) {
    if (match.index > cursor) {
      result.push({ kind: 'literal', value: snippet.slice(cursor, match.index) });
    }
    const index = Number(match[1]);
    const meaning = normalizeSayMarkupParameterMeaning(snippet, match.index, match[2]);
    if (index > 0 && meaning && !values.has(index)) {
      result.push({ kind: 'parameter', index, meaning });
      values.add(index);
    } else {
      result.push({ kind: 'literal', value: match[0] });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < snippet.length) result.push({ kind: 'literal', value: snippet.slice(cursor) });
  return result;
}

function normalizeSayMarkupParameterMeaning(
  snippet: string,
  placeholderStart: number,
  rawMeaning: string
): string {
  let meaning = rawMeaning.trim();
  const assignment = /([A-Za-z][A-Za-z0-9_]*)=\s*$/.exec(snippet.slice(0, placeholderStart));
  if (/^[-+]?\d+(?:\.\d+)?$/.test(meaning) && assignment) {
    meaning = assignment[1].toUpperCase() === 'FCOLOR'
      ? '文字颜色'
      : assignment[1];
  }
  return meaning;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
