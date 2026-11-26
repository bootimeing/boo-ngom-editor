import { scriptCodeBeforeComment } from './script-labels';
import { ActiveStaticLanguageEntry } from './static-language';

export interface SayMarkupToken {
  start: number;
  end: number;
  markupEnd: number;
  bodyEnd: number;
  text: string;
  entry: ActiveStaticLanguageEntry;
}

export interface SayMarkupParameterSpan {
  start: number;
  end: number;
  text: string;
  index: number;
  meaning: string;
  key?: string;
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

export interface DocumentSayHover {
  start: number;
  end: number;
  markup?: SayMarkupToken;
  parameter?: SayMarkupParameterSpan;
  entry?: ActiveStaticLanguageEntry;
}

interface SaySourceRange {
  start: number;
  end: number;
}

// VS Code often asks about several positions in the same document. Build the
// multiline ranges once per document text and discard them on the next edit.
let multilineCache: { text: string; ranges: SaySourceRange[] } | undefined;
function multilineMTextAt(text: string, offset: number): SaySourceRange | undefined {
  if (multilineCache?.text !== text) {
    const ranges: SaySourceRange[] = [];
    const openings = /<&?MTEXT:/gi;
    const section = /^[ \t]*(?:#(?:IF|ACT|ELSEACT|SAY|ELSESAY|OR|AND)\b|\[@)/gim;
    for (let open; (open = openings.exec(text));) {
      const bol = Math.max(text.lastIndexOf('\n', open.index - 1), text.lastIndexOf('\r', open.index - 1)) + 1;
      if (/^\s*(?:;|\/\/)|\s\/\//.test(text.slice(bol, open.index))) continue;
      section.lastIndex = open.index;
      const limit = section.exec(text)?.index ?? text.length;
      const end = findAngleMarkupEnd(text, open.index, limit);
      if (end < 0) continue;
      if (/[\r\n]/.test(text.slice(open.index, end))) ranges.push({ start: open.index, end: end + 1 });
      openings.lastIndex = end + 1;
    }
    multilineCache = { text, ranges };
  }
  return multilineCache.ranges.find(range => range.start <= offset && offset < range.end);
}

// Classify the shape of an IMGEX image triple without substituting characters
// into the source. A computed write may override a previous literal. When its
// selector matches the RHS selector, identical source/target indices can be
// paired, even when the runtime index itself is unknown.
function fixedImageTriple(before: string, name: string): boolean {
  const lines = before.split(/\r\n|[\r\n]/);
  let first = lines.length;
  while (first > 0 && !/^\s*\[@/.test(lines[first - 1])) first--;
  const known = new Set<string>();
  let conditional = false;
  let section: 'condition' | 'action' | 'say' = 'action';
  const indexed = /^(S\$[^<>]*)(<\$STR\(N\$[^()<>]+\)>)$/i;
  for (const raw of lines.slice(first)) {
    const line = raw.trim();
    if (!line || /^(?:;|\/\/)/.test(line)) continue;
    if (/^#IF\b/i.test(line)) { conditional = false; section = 'condition'; continue; }
    if (/^#ELSEACT\b/i.test(line)) { conditional = true; section = 'action'; continue; }
    if (/^#ACT\b/i.test(line)) { section = 'action'; continue; }
    if (/^#(?:SAY|ELSESAY)\b/i.test(line)) { section = 'say'; continue; }
    if (section === 'say') continue;
    if (section === 'condition') { conditional = true; continue; }
    const mov = /^MOV\s+(\S+)\s+(.+?)\s*$/i.exec(line);
    if (!mov) { known.clear(); continue; }
    const [, target, value] = mov;
    if (!/^S\$/i.test(target)) continue;
    const key = 'S$' + target.slice(2);
    const direct = /^\d+:\d+:\d+$/.test(value);
    if (!target.includes('<')) {
      if (!direct) known.delete(key);
      else if (!conditional) known.add(key);
      continue;
    }
    const pattern = indexed.exec(key);
    if (!pattern) { known.clear(); continue; }
    const reference = /^<\$STR\((.+)\)>$/i.exec(value)?.[1];
    const rhs = reference && indexed.exec(reference);
    const snapshot = new Set(known);
    for (const prior of snapshot) {
      if (!prior.startsWith(pattern[1])) continue;
      const suffix = prior.slice(pattern[1].length);
      if (!/^-?\d+$/.test(suffix)) continue;
      if (!direct && !(rhs && rhs[2] === pattern[2] && snapshot.has(rhs[1] + suffix))) known.delete(prior);
    }
  }
  return known.has(name);
}

function imgExCoordinateParameter(
  text: string, bol: number, line: string, token: SayMarkupToken, cursor: number, parameter: SayMarkupParameterSpan
): SayMarkupParameterSpan {
  if (!token.entry.engines.includes('GOM') || !/^<&?IMGEX$/i.test(token.text)) return parameter;
  const shape = /^(<&?IMGEX:[^:<>]+:<\$STR\((S\$[\w\p{L}]+)\)>:)([^:<>/]+):([^:<>/]+)(?:\/@|>)/iu
    .exec(line.slice(token.start, token.markupEnd));
  if (!shape) return parameter;
  const x = token.start + shape[1].length;
  const y = x + shape[3].length + 1;
  const axis = x <= cursor && cursor < y - 1 ? 5 : y <= cursor && cursor < y + shape[4].length ? 6 : undefined;
  if (!axis) return parameter;
  const meaning = fixedImageTriple(text.slice(0, bol), 'S$' + shape[2].slice(2))
    ? sayMarkupParameterMeanings(token.entry)[axis - 1]
    : '图片组由字符串展开，后续参数位置待运行时确定。';
  return { ...parameter, index: axis, meaning };
}

/** Return half-open offsets in the original document for VS Code hover ranges. */
export function findDocumentSayHover(text: string, offset: number, index: SayMarkupIndex): DocumentSayHover | undefined {
  const bol = Math.max(text.lastIndexOf('\n', offset - 1), text.lastIndexOf('\r', offset - 1)) + 1;
  const newline = /[\r\n]/g;
  newline.lastIndex = offset;
  const eol = newline.exec(text)?.index ?? text.length;
  const physical = text.slice(bol, eol);
  if (/^\s*(?:;|\/\/)/.test(physical)) return undefined;
  const comment = scriptCodeBeforeComment(physical).length;
  if (offset >= bol + comment) return undefined;

  const multi = multilineMTextAt(text, offset);
  const base = multi?.start ?? bol;
  const line = multi ? text.slice(base, multi.end) : physical.slice(0, comment);
  const cursor = offset - base;
  const token = findSayMarkupTokens(line, index).reverse().find(t => t.start <= cursor && cursor < t.markupEnd);
  const flow = findFlowTextHover(line, cursor, index);
  if (flow && (!token || flow.parameter.start > token.start)) {
    return { ...flow, start: base + flow.parameter.start, end: base + flow.parameter.end };
  }
  if (!token) return undefined;
  if (cursor < token.end) return { markup: token, start: base + token.start, end: base + token.end };
  const field = findSayMarkupParameterSpans(line, token).find(span => span.start <= cursor && cursor < span.end);
  if (!field) return undefined;
  const parameter = imgExCoordinateParameter(text, bol, line, token, cursor, field);
  return { markup: token, parameter, start: base + parameter.start, end: base + parameter.end };
}

export function buildSayMarkupIndex(entries: readonly ActiveStaticLanguageEntry[]): SayMarkupIndex {
  const result: SayMarkupIndex = new Map();
  for (const entry of entries) {
    // These documented forms start with the user's caption, not a command.
    if (['text-link', 'text-link-params', 'text-color'].includes(entry.id)) {
      result.set(entry.id, [entry]);
      continue;
    }
    const tokens = [entry.label, ...(entry.markupAliases || [])]
      .map(sayMarkupTokenFromLabel)
      .filter((token): token is string => Boolean(token));
    for (const token of new Set(tokens)) {
      const key = token.toUpperCase();
      const values = result.get(key) || [];
      values.push(entry);
      result.set(key, values);
    }
  }
  return result;
}

export function sayMarkupTokenFromLabel(label: string): string | undefined {
  return /^(<&?[A-Za-z_][A-Za-z0-9_.]*)/.exec(label.trim())?.[1];
}

export function sayMarkupParameterMeanings(entry: ActiveStaticLanguageEntry): string[] {
  if (entry.parameters?.length) {
    return entry.parameters.map(parameter => parameter.description);
  }
  return sayMarkupTemplateParts(entry)
    .filter((part): part is SayMarkupTemplateParameter => part.kind === 'parameter')
    .sort((left, right) => left.index - right.index)
    .map(part => part.meaning);
}

export function findSayMarkupTokens(line: string, index: SayMarkupIndex): SayMarkupToken[] {
  if (!line || /^\s*(?:;|\/\/)/.test(line)) return [];
  const result: SayMarkupToken[] = [];
  const pattern = /<&?[A-Za-z_][A-Za-z0-9_.]*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const delimiter = line[pattern.lastIndex];
    if (delimiter && ![':', '|', '>'].includes(delimiter)) continue;
    const entries = index.get(match[0].toUpperCase())?.filter(entry => {
      if (delimiter !== ':' && delimiter !== '|') return true;
      const syntax = entry.snippet || entry.label;
      const documented = syntax[sayMarkupTokenFromLabel(syntax)?.length ?? 0];
      return documented === delimiter || (documented === '>' && delimiter === ':');
    });
    if (!entries?.length) continue;
    const markupEnd = findAngleMarkupEnd(line, match.index);
    const resolvedMarkupEnd = markupEnd >= 0 ? markupEnd + 1 : line.length;
    const markup = line.slice(match.index, resolvedMarkupEnd);
    result.push({
      start: match.index,
      end: match.index + match[0].length,
      markupEnd: resolvedMarkupEnd,
      bodyEnd: markupEnd < 0 ? line.length : markupEnd,
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
    token.start <= character && character < token.end
  ));
}

export function findSayMarkupParameterAt(
  line: string,
  character: number,
  index: SayMarkupIndex
): SayMarkupParameterSpan | undefined {
  for (const token of findSayMarkupTokens(line, index).reverse()) {
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
  if (token.entry.parameters?.some(parameter => parameter.key)) {
    return findKeyValueParameterSpans(line, token);
  }
  return legacyParameterSpans(line, token);
}

/** Text links and inline color spans have no fixed command word. */
export function findFlowTextHover(line: string, character: number, index: SayMarkupIndex): {
  entry: ActiveStaticLanguageEntry; parameter: SayMarkupParameterSpan;
} | undefined {
  for (let start = line.lastIndexOf('<', character); start >= 0; start = start ? line.lastIndexOf('<', start - 1) : -1) {
    const end = findAngleMarkupEnd(line, start);
    if (end < character || line[start + 1] === '$') continue;
    const command = /^(<&?[A-Za-z_][\w.]*)[:|]/.exec(line.slice(start, end));
    if (command && index.has(command[1].toUpperCase())) continue;
    let directive = -1;
    let note = -1;
    for (let cursor = start + 1; cursor < end; cursor++) {
      if (line[cursor] === '<') {
        const close = findAngleMarkupEnd(line, cursor);
        if (close >= 0) cursor = close;
      } else if (line[cursor] === '|' && note < 0) note = cursor;
      else if (line[cursor] === '/' && /^(?:@|(?:F|S|AUTO)COLOR=)/i.test(line.slice(cursor + 1))) {
        directive = cursor;
        break;
      }
    }
    if (directive < 0) continue;
    const action = line.slice(directive + 1, end);
    const color = !action.startsWith('@');
    const argOffset = color ? -1 : action.search(/[(#]/);
    const id = color ? 'text-color' : argOffset < 0 ? 'text-link' : 'text-link-params';
    const entry = index.get(id)?.[0];
    if (!entry) continue;
    const meanings = sayMarkupParameterMeanings(entry);
    const field = (from: number, to: number, position: number, meaning: string) => ({
      entry, parameter: { start: from, end: to, text: line.slice(from, to), index: position, meaning }
    });
    const captionEnd = note >= 0 ? note : directive;
    if (character > start && character < captionEnd) return field(start + 1, captionEnd, 1, meanings[0] || '显示文字');
    if (note >= 0 && character > note && character < directive) return field(note + 1, directive, 0, '鼠标悬停时显示的提示文字');
    if (character > directive && character < end) {
      const args = directive + 1 + argOffset;
      if (argOffset >= 0 && character >= args) {
        const parens = line[args] === '(' && line[end - 1] === ')' && end - args > 2;
        return field(parens ? args + 1 : args, parens ? end - 1 : end, 3, '传给触发标签的实参');
      }
      const meaning = /^AUTOCOLOR=/i.test(action) ? '文字自动变色所用的颜色列表'
        : /^SCOLOR=/i.test(action) ? '文字片段的颜色'
        : meanings[1] || (color ? '文字颜色' : '脚本触发标签');
      return field(directive + 1, argOffset < 0 ? end : args, 2, meaning);
    }
  }
  return undefined;
}

interface LegacySlot {
  index: number;
  meaning: string;
}

function legacyParameterSpans(line: string, token: SayMarkupToken): SayMarkupParameterSpan[] {
  const entry = token.entry;
  const positional: LegacySlot[] = [];
  const styles = new Map<string, LegacySlot>();
  let note: LegacySlot | undefined;
  let link: LegacySlot | undefined;
  let literal = '';
  for (const part of sayMarkupTemplateParts(entry)) {
    if (part.kind === 'literal') { literal = part.value; continue; }
    const slot = { index: part.index, meaning: entry.parameters?.[part.index - 1]?.description || part.meaning };
    const key = /([A-Za-z][A-Za-z0-9_]*)=\s*$/.exec(literal)?.[1];
    if (key) styles.set(key.toUpperCase(), slot);
    else if (literal.endsWith('/@')) link = slot;
    else if (literal.endsWith('|')) note = slot;
    else positional.push(slot);
  }
  if (!positional.length && !styles.size && !note && !link) {
    entry.parameters?.forEach((p, i) => positional.push({ index: i + 1, meaning: p.description }));
  }
  for (const parameter of entry.styleParameters ?? []) {
    if (!parameter.key) continue;
    const key = parameter.key.toUpperCase();
    styles.set(key, { index: styles.get(key)?.index ?? 0, meaning: parameter.description });
  }

  const spans: SayMarkupParameterSpan[] = [];
  function add(slot: LegacySlot | undefined, start: number, end: number, key?: string) {
    while (start < end && /\s/.test(line[start])) start++;
    while (end > start && /\s/.test(line[end - 1])) end--;
    if (slot && start < end) spans.push({ ...slot, start, end, text: line.slice(start, end), key });
  }

  // Read actual source boundaries. Template examples often omit optional slots,
  // or contain a nested expression whose colons belong to that expression.
  const end = token.bodyEnd;
  let start = token.end + (line[token.end] === ':' ? 1 : 0);
  let slotIndex = 0;
  let pendingNote = false;
  const legacyContainer = entry.engines.some(engine => engine === 'GOM' || engine === 'GEE');
  const declaresContainer = /容器|父子/.test(positional[0]?.meaning ?? '') || entry.id === 'container-newline';
  const textHint = /^<&?text$/i.test(token.text);
  let first = true;
  function finish(until: number) {
    const value = line.slice(start, until).trim();
    if (first && legacyContainer) {
      first = false;
      if (!declaresContainer && isContainerReference(value)) {
        add({ index: 0, meaning: '上层容器编号与本元素编号' }, start, until, '容器编号');
        return;
      }
      if (declaresContainer && !isContainerReference(value) && /^(?:[-+]?\d+$|<\$|\*)/.test(value)) slotIndex++;
    }
    if (pendingNote) add(note ?? { index: 0, meaning: '鼠标经过时显示的提示文字' }, start, until, '提示');
    else add(positional[slotIndex++], start, until);
  }

  let cursor = start;
  while (cursor < end) {
    const char = line[cursor];
    if (char === '<') {
      const close = findAngleMarkupEnd(line, cursor);
      if (close < 0 || close >= end) break;
      cursor = close + 1;
      continue;
    }
    if (char === '{') {
      const close = line.indexOf('}', cursor + 1);
      if (close >= 0 && close < end) {
        const body = line.slice(cursor + 1, close);
        // New GOM permits multiple styled fragments inside the text value.
        // Their styles own the inner ranges but do not consume an X/Y slot.
        const inline = textHint && styles.has('SCOLOR') && /\/(FCOLOR|SCOLOR|AUTOCOLOR)=([^{}]+)$/i.exec(body);
        if (inline) {
          const keyStart = cursor + 2 + inline.index;
          const slot = styles.get(inline[1].toUpperCase());
          add(slot, keyStart, keyStart + inline[1].length, inline[1]);
          add(slot, keyStart + inline[1].length + 1, close, inline[1]);
        } else if (textHint && styles.has('SCOLOR') && /\|(?:\d{1,3}|[#$][\da-f]{6})$/i.test(body)) {
          const color = body.slice(body.lastIndexOf('|') + 1);
          if (!/^\d+$/.test(color) || Number(color) <= 255) add(styles.get('FCOLOR'), close - color.length, close, 'FCOLOR');
        } else if (styles.size && /^\s*[A-Za-z]\w*\s*=/.test(body)) {
          if (start < cursor) finish(cursor);
          for (const m of body.matchAll(/(?:^|;)\s*([A-Za-z]\w*)\s*=([^;]*)/g)) {
            const slot = styles.get(m[1].toUpperCase());
            const keyStart = cursor + 1 + m.index! + m[0].indexOf(m[1]);
            const valueStart = cursor + 1 + m.index! + m[0].length - m[2].length;
            add(slot, keyStart, keyStart + m[1].length, m[1]);
            add(slot, valueStart, valueStart + m[2].length, m[1]);
          }
          start = close + 1;
        }
        cursor = close + 1;
        continue;
      }
    }
    if (char === '/' && line[cursor + 1] === '@') {
      if (start < cursor) finish(cursor);
      const args = line.slice(cursor + 1,end).search(/[(#]/);
      const boundary = args < 0 ? end : cursor + 1 + args;
      add(link, cursor + 1, boundary);
      if (link && args >= 0) {
        const parens = line[boundary] === '(' && line[end-1] === ')';
        add({index: link.index, meaning: '传给触发标签的实参'}, boundary+Number(parens), end-Number(parens), '标签参数');
      }
      return spans;
    }
    if ((char === ':' && (!pendingNote || textHint)) || (char === '|' && !pendingNote && (note || textHint))) {
      finish(cursor);
      pendingNote = char === '|';
      start = cursor + 1;
    }
    cursor++;
  }
  if (start < end) finish(end);
  return spans;
}

function isContainerReference(value: string): boolean {
  const name = value.replace(/<\$[^<>]+>/g, 'v');
  return /^(?:#[\w.\p{L}$-]+(?:~#?[\w.\p{L}$-]*)?|~#?[\w.\p{L}$-]+)$/u.test(name);
}

function findKeyValueParameterSpans(
  line: string,
  token: SayMarkupToken
): SayMarkupParameterSpan[] {
  const parameters = token.entry.parameters || [];
  const byKey = new Map<string, string>();
  parameters.forEach(parameter => {
    if (!parameter.key) return;
    byKey.set(parameter.key.toUpperCase(), parameter.description);
    for (const alias of parameter.aliases || []) {
      byKey.set(alias.toUpperCase(), parameter.description);
    }
  });

  const result: SayMarkupParameterSpan[] = [];
  let parameterIndex = 0;
  for (const segment of splitTopLevelPipeSegments(line, token.end, token.bodyEnd)) {
    const raw = line.slice(segment.start, segment.end);
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw);
    if (!match) continue;
    const meaning = byKey.get(match[1].toUpperCase());
    if (!meaning) continue;
    parameterIndex++;
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const start = segment.start + leading;
    const end = segment.end - trailing;
    if (/^tips$/i.test(match[1])) {
      for (const style of raw.matchAll(/\{[^{}]*?\/((?:F|S|AUTO)COLOR=[^{}]+)\}/gi)) {
        const at = segment.start + style.index! + style[0].lastIndexOf(style[1]);
        result.push({start:at,end:at+style[1].length,text:style[1],key:style[1].split('=')[0],
          index:parameterIndex,meaning:'悬停提示中文字的颜色或色号'});
      }
    }
    result.push({
      start,
      end,
      text: line.slice(start, end),
      index: parameterIndex,
      key: match[1],
      meaning,
    });
  }
  return result;
}

function splitTopLevelPipeSegments(
  line: string,
  start: number,
  end: number
): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = [];
  let segmentStart = start;
  let angleDepth = 0;
  let braceDepth = 0;
  let quote = '';
  for (let cursor = start; cursor < end; cursor++) {
    const char = line[cursor];
    if (quote) {
      if (char === quote && line[cursor - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '<') angleDepth++;
    else if (char === '>' && angleDepth > 0) angleDepth--;
    else if (char === '{') braceDepth++;
    else if (char === '}' && braceDepth > 0) braceDepth--;
    else if (char === '|' && angleDepth === 0 && braceDepth === 0) {
      if (segmentStart < cursor) result.push({ start: segmentStart, end: cursor });
      segmentStart = cursor + 1;
    }
  }
  if (segmentStart < end) result.push({ start: segmentStart, end });
  return result;
}

function selectBestEntry(
  entries: readonly ActiveStaticLanguageEntry[],
  markup: string
): ActiveStaticLanguageEntry {
  if (entries.length === 1) return entries[0];
  // A link, pipe or colon inside a nested field is not part of the
  // containing control's signature.
  let shape = '';
  for (let i = 1; i < markup.length; i++) {
    if (markup[i] === '<' || markup[i] === '{') {
      const end = markup[i] === '<' ? findAngleMarkupEnd(markup, i) : markup.indexOf('}', i + 1);
      if (end < 0) break;
      shape += 'v';
      i = end;
    } else shape += markup[i];
  }
  const hasLink = shape.includes('/@');
  const hasPipe = shape.includes('|');
  const parts = shape.split('/@')[0].split(':').slice(1);
  const first = (parts[0] ?? '').replace(/>$/, '');
  const slotCount = parts.length - Number(isContainerReference(first));
  const longEquip = entries.find(e => e.id === 'gee-user-item-view-target' || e.id === 'gee-hero-user-item-view-target');
  if (longEquip && slotCount >= 7) return longEquip;
  function score(entry: ActiveStaticLanguageEntry): number {
    const count = (entry.label.split('/@')[0].replace(/\{[^{}]*\}/g, '').match(/:/g) || []).length;
    // A short example may omit optional slots. Prefer the declared arity
    // when several signatures share the same token and punctuation.
    return entryShapeScore(entry, hasLink, hasPipe)
      - Math.abs(count - slotCount)
      + Number(markup.toUpperCase().startsWith((sayMarkupTokenFromLabel(entry.label) ?? '').toUpperCase() + ':')) * 0.1;
  }
  return entries.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best);
}

function entryShapeScore(
  entry: ActiveStaticLanguageEntry,
  hasLink: boolean,
  hasPipe: boolean
): number {
  const label = entry.label;
  let score = 0;
  if (label.includes('/@') === hasLink) score += hasLink ? 4 : 0.5;
  if (label.includes('|') === hasPipe) score += 2;
  return score;
}

function findAngleMarkupEnd(line: string, start: number, limit = line.length): number {
  let depth = 0;
  let quote = '';
  for (let cursor = start; cursor < limit; cursor++) {
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
  const snippet = entry.hoverSnippet || entry.snippet || '';
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
