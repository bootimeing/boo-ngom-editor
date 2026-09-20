import { EngineId } from '../types';
import { normalizeScriptVariableName } from '../utils/variable-statistics';

/** Local preview storage is JSON, while script expansion uses native [a,b]/{k:v} syntax. */
export type PreviewCollectionKind = 'list' | 'dictionary';
export type PreviewCollectionRead = (name: string) => string | undefined;
export type PreviewCollectionWrite = (name: string, value: string | undefined, dependencies?: string[], previewValue?: string) => void;
const MAX_ITEMS = 512;
const MAX_ITEM_LENGTH = 4096;
const MAX_LENGTH = 65536;
const NAME = /^(GL|L|D)\$([A-Za-z0-9_\u3400-\u9fff]+)$/i;
const VARIABLE = /^(?:[PDMNSIGAUTJZ]\d+|(?:GL|[NSLD])\$[A-Za-z0-9_\u3400-\u9fff]+)$/i;
type Collection = string[] | Record<string, string>;

export function previewCollectionKind(name: string, engine: EngineId = 'GOM'): PreviewCollectionKind | undefined {
  const match = NAME.exec(name);
  if (!match || (match[1].toUpperCase() === 'GL' && engine !== 'GOM') || (match[1].toUpperCase() === 'D' && engine === '996PC')) return undefined;
  return match[1].toUpperCase() === 'D' ? 'dictionary' : 'list';
}

function scalar(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return String(value);
  return typeof value === 'string' && value.length <= MAX_ITEM_LENGTH && !/[\r\n\x00]/.test(value) ? value : undefined;
}

function normalizedCollection(kind: PreviewCollectionKind, value: unknown, depth = 0): Collection | undefined {
  if (depth > 8) return undefined;
  if (kind === 'list') {
    if (!Array.isArray(value) || value.length > MAX_ITEMS) return undefined;
    const list: string[] = [];
    for (const item of value) {
      const nested = Array.isArray(item) ? normalizedCollection('list', item, depth + 1) : undefined;
      const text = nested ? nativeCollection(nested) : scalar(item);
      if (text === undefined || text.length > MAX_ITEM_LENGTH) return undefined;
      list.push(text);
    }
    return list;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > MAX_ITEMS) return undefined;
  const dictionary: Record<string, string> = Object.create(null);
  for (const [key, item] of entries) {
    const text = scalar(item);
    if (!key || scalar(key) === undefined || text === undefined) return undefined;
    // Own-key storage preserves legitimate __proto__/constructor keys without prototype writes.
    dictionary[key] = text;
  }
  return dictionary;
}

export function normalizePreviewCollectionValue(kind: PreviewCollectionKind, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_LENGTH) return undefined;
  try {
    // Validate JSON grammar first, then retain numeric lexemes as strings. JSON.parse
    // alone rounds both 922G integer values and long decimal collection elements.
    const original: unknown = JSON.parse(value);
    const finiteNumbers = (item: unknown, depth = 0): boolean => depth > 8 ? false : typeof item === 'number' ? Number.isFinite(item)
      : Array.isArray(item) ? item.every(child => finiteNumbers(child, depth + 1))
        : item && typeof item === 'object' ? Object.values(item).every(child => finiteNumbers(child, depth + 1)) : true;
    if (!finiteNumbers(original)) return undefined;
    let preserved = '';
    let quoted = false;
    for (let cursor = 0; cursor < value.length; cursor += 1) {
      const char = value[cursor];
      if (quoted && char === '\\') { preserved += char + value[++cursor]; continue; }
      if (char === '"') quoted = !quoted;
      if (!quoted && /[-\d]/.test(char)) {
        const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(value.slice(cursor));
        if (number) { preserved += JSON.stringify(number[0]); cursor += number[0].length - 1; continue; }
      }
      preserved += char;
    }
    const parsed = normalizedCollection(kind, JSON.parse(preserved));
    if (!parsed) return undefined;
    const result = JSON.stringify(parsed);
    return result.length <= MAX_LENGTH ? result : undefined;
  } catch { return undefined; }
}

function nativeCollection(value: Collection): string {
  return Array.isArray(value) ? `[${value.join(',')}]` : `{${Object.entries(value).map(([key, item]) => `${key}:${item}`).join(',')}}`;
}

function protectLiteral(value: string): string {
  return value.replace(/[:|{}<>/\\]/g, char => String.fromCharCode(0xe000 + char.charCodeAt(0)));
}

/** An encoded display mirror, never an alternate semantic value or selector. */
export function protectPreviewCollectionValue(kind: PreviewCollectionKind, raw: string): string | undefined {
  const collection = parseCollection(kind, raw);
  if (!collection) return undefined;
  return JSON.stringify(Array.isArray(collection) ? collection.map(protectLiteral)
    : Object.fromEntries(Object.entries(collection).map(([key, value]) => [protectLiteral(key), protectLiteral(value)])));
}

interface CollectionShadow { values: Collection; keys: Record<string, string> }
function collectionShadow(kind: PreviewCollectionKind, raw: Collection, display: string | undefined): CollectionShadow {
  const parsed = parseCollection(kind, display);
  const keys: Record<string, string> = Object.create(null);
  if (Array.isArray(raw)) return { values: Array.isArray(parsed) && parsed.length === raw.length ? parsed : [...raw], keys };
  const values: Record<string, string> = Object.create(null);
  const entries = parsed && !Array.isArray(parsed) ? Object.entries(parsed) : Object.entries(raw);
  Object.entries(raw).forEach(([key, value], index) => {
    const counterpart = entries[index];
    keys[key] = counterpart?.[0] ?? key;
    values[key] = counterpart?.[1] ?? value;
  });
  return { values, keys };
}

function serializeShadow(shadow: CollectionShadow): Collection {
  return Array.isArray(shadow.values) ? shadow.values
    : Object.fromEntries(Object.entries(shadow.values).map(([key, value]) => [shadow.keys[key] ?? key, value]));
}

/** Raw selectors choose the final leaf; only that leaf uses the display mirror. */
function readDisplayReference(reference: { name: string; kind: PreviewCollectionKind; key?: string },
  read: PreviewCollectionRead, readPreview: PreviewCollectionRead, engine: EngineId): string | undefined {
  const raw = read(reference.name);
  const collection = parseCollection(reference.kind, raw);
  if (!collection) return undefined;
  const shadow = collectionShadow(reference.kind, collection, readPreview(reference.name));
  if (reference.key === undefined) return raw === '' ? '' : nativeCollection(serializeShadow(shadow));
  if (Array.isArray(collection) && Array.isArray(shadow.values)) {
    const index = numericIndex(reference.key, collection.length, engine);
    return index === undefined ? undefined : shadow.values[index];
  }
  return Object.prototype.hasOwnProperty.call(collection, reference.key) ? (shadow.values as Record<string, string>)[reference.key] : '';
}

/** Balanced splitting: no evaluation, JSON execution, filesystem access or host callbacks. */
function splitTopLevel(text: string, delimiter: ',' | ':' | ' '): string[] | undefined {
  const result: string[] = [];
  const stack: string[] = [];
  let start = 0;
  let quote = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') { index += 1; continue; }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '<' && text[index + 1] === '$') { stack.push('>'); continue; }
    if (char === '[' || char === '{' || char === '(') stack.push(char === '[' ? ']' : char === '{' ? '}' : ')');
    else if (char === stack[stack.length - 1]) stack.pop();
    else if (char === ']' || char === '}' || char === ')') return undefined;
    else if (!stack.length && (delimiter === ' ' ? /\s/.test(char) : char === delimiter)) {
      if (delimiter !== ' ' || start < index) result.push(text.slice(start, index));
      start = index + 1;
    }
  }
  if (stack.length || quote) return undefined;
  if (delimiter !== ' ' || start < text.length) result.push(text.slice(start));
  return result;
}

function parseCollection(kind: PreviewCollectionKind, raw: string | undefined): Collection | undefined {
  if (raw === undefined || raw.length > MAX_LENGTH) return undefined;
  if (raw === '') return kind === 'list' ? [] : Object.create(null);
  const json = normalizePreviewCollectionValue(kind, raw);
  if (json !== undefined) return normalizedCollection(kind, JSON.parse(json));
  const text = raw.trim();
  const brackets = kind === 'list' ? ['[', ']'] : ['{', '}'];
  if (!text.startsWith(brackets[0]) || !text.endsWith(brackets[1])) return undefined;
  const inside = text.slice(1, -1);
  const items = inside === '' ? [] : splitTopLevel(inside, ',');
  if (!items || items.length > MAX_ITEMS) return undefined;
  if (kind === 'list') return normalizedCollection(kind, items);
  const dictionary: Record<string, string> = Object.create(null);
  for (const item of items) {
    const pair = splitTopLevel(item, ':');
    if (!pair || pair.length !== 2 || !pair[0] || /[{}\[\]]/.test(item)) return undefined;
    dictionary[pair[0]] = pair[1];
  }
  return normalizedCollection(kind, dictionary);
}

function collectionReference(raw: string, engine: EngineId): { name: string; kind: PreviewCollectionKind; key?: string } | undefined {
  const match = /^((?:GL|L|D)\$[A-Za-z0-9_\u3400-\u9fff]+)(?:\[([\s\S]*)\])?$/i.exec(raw.trim());
  if (!match) return undefined;
  const name = normalizeScriptVariableName(match[1]);
  const kind = previewCollectionKind(name, engine);
  return kind ? { name, kind, key: match[2] } : undefined;
}

function numericIndex(raw: string, length: number, engine: EngineId, allowEnd = false, insert = false): number | undefined {
  if (!/^-?\d+$/.test(raw)) return undefined;
  let value = Number(raw);
  if (!Number.isSafeInteger(value)) return undefined;
  // 996PC only documents -1 for insertion; do not borrow general negative-index rules.
  if (value < 0) {
    if (engine === '996PC' && !(insert && value === -1)) return undefined;
    value += length;
  }
  return value >= 0 && value < length + (allowEnd ? 1 : 0) ? value : undefined;
}

function unwrap(raw: string): string {
  let text = raw.trim();
  if (/^<\$[\s\S]*>$/.test(text)) text = text.slice(2, -1);
  const str = /^STR\(([\s\S]*)\)$/i.exec(text);
  return str ? str[1] : text;
}

function expand(raw: string, read: PreviewCollectionRead, engine: EngineId, depth = 0): string | undefined {
  if (depth > 16 || raw.length > MAX_LENGTH) return undefined;
  let result = '';
  for (let cursor = 0; cursor < raw.length;) {
    const start = raw.indexOf('<$', cursor);
    if (start < 0) { result += raw.slice(cursor); break; }
    result += raw.slice(cursor, start);
    let end = start + 2;
    let nesting = 1;
    for (; end < raw.length; end += 1) {
      if (raw[end] === '<' && raw[end + 1] === '$') { nesting += 1; end += 1; }
      else if (raw[end] === '>' && --nesting === 0) break;
    }
    if (end >= raw.length) return undefined;
    const expression = expand(unwrap(raw.slice(start, end + 1)), read, engine, depth + 1);
    if (expression === undefined) return undefined;
    const reference = collectionReference(expression, engine);
    const value = reference ? readCollectionReference(reference, read, engine) : read(normalizeScriptVariableName(expression));
    if (value === undefined) return undefined;
    result += value;
    if (result.length > MAX_LENGTH) return undefined;
    cursor = end + 1;
  }
  return result;
}

function readCollectionReference(reference: { name: string; kind: PreviewCollectionKind; key?: string }, read: PreviewCollectionRead, engine: EngineId): string | undefined {
  const raw = read(reference.name);
  const collection = parseCollection(reference.kind, raw);
  if (!collection) return undefined;
  if (reference.key === undefined) return raw === '' ? '' : nativeCollection(collection);
  if (Array.isArray(collection)) {
    const index = numericIndex(reference.key, collection.length, engine);
    return index === undefined ? undefined : collection[index];
  }
  return Object.prototype.hasOwnProperty.call(collection, reference.key) ? collection[reference.key] : '';
}

export function resolvePreviewCollectionExpression(expression: string, read: PreviewCollectionRead, engine: EngineId = 'GOM'): string | undefined {
  const expanded = expand(unwrap(expression), read, engine);
  const reference = expanded === undefined ? undefined : collectionReference(expanded, engine);
  return reference ? readCollectionReference(reference, read, engine) : undefined;
}

export function resolvePreviewCollectionDisplayExpression(expression: string, read: PreviewCollectionRead,
  readPreview: PreviewCollectionRead, engine: EngineId = 'GOM'): string | undefined {
  const expanded = expand(unwrap(expression), read, engine);
  const reference = expanded === undefined ? undefined : collectionReference(expanded, engine);
  return reference ? readDisplayReference(reference, read, readPreview, engine) : undefined;
}

/** Expand source spans once. Display data is never re-read as source syntax. */
function expandDisplay(raw: string, read: PreviewCollectionRead, readPreview: PreviewCollectionRead, engine: EngineId): string | undefined {
  let result = '';
  for (let cursor = 0; cursor < raw.length;) {
    const start = raw.indexOf('<$', cursor);
    if (start < 0) { result += raw.slice(cursor); break; }
    result += raw.slice(cursor, start);
    let end = start + 2, depth = 1;
    for (; end < raw.length; end++) {
      if (raw[end] === '<' && raw[end + 1] === '$') { depth++; end++; }
      else if (raw[end] === '>' && --depth === 0) break;
    }
    if (depth) return undefined;
    const name = expand(unwrap(raw.slice(start, end + 1)), read, engine);
    if (name === undefined) return undefined;
    const reference = collectionReference(name, engine);
    const value = reference ? readDisplayReference(reference, read, readPreview, engine)
      : readPreview(normalizeScriptVariableName(name)) ?? read(normalizeScriptVariableName(name));
    if (value === undefined) return undefined;
    result += value;
    cursor = end + 1;
  }
  return result;
}

function displayOperand(raw: string | undefined, read: PreviewCollectionRead, readPreview: PreviewCollectionRead, engine: EngineId): string | undefined {
  if (raw === undefined) return undefined;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return expandDisplay(raw.slice(1, -1), read, readPreview, engine);
  if (raw.includes('<$') && !collectionReference(raw, engine)) return expandDisplay(raw, read, readPreview, engine);
  const semantic = expand(raw, read, engine);
  if (semantic === undefined) return undefined;
  const reference = collectionReference(semantic, engine);
  if (reference) return readDisplayReference(reference, read, readPreview, engine);
  return VARIABLE.test(semantic) ? readPreview(normalizeScriptVariableName(semantic)) ?? read(normalizeScriptVariableName(semantic)) : semantic;
}

function splitDisplay(source: string, display: string, separator: string): string[] {
  // The literal protection map replaces one UTF-16 code unit with one code unit.
  // Select split boundaries on raw data, preserving exact display fragments.
  const result: string[] = [];
  let start = 0, index: number;
  while ((index = source.indexOf(separator, start)) >= 0) {
    result.push(display.slice(start, index));
    start = index + separator.length;
  }
  result.push(display.slice(start));
  return result;
}

function operand(raw: string | undefined, read: PreviewCollectionRead, engine: EngineId): string | undefined {
  if (raw === undefined) return undefined;
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return expand(raw.slice(1, -1), read, engine);
  const value = expand(raw, read, engine);
  if (value === undefined) return undefined;
  // A template result is literal data: user text "U101" is not another variable,
  // and user-supplied quotes do not become source quoting syntax on a second pass.
  if (raw.includes('<$') && !collectionReference(raw, engine)) return value;
  const collection = collectionReference(value, engine);
  if (collection) return readCollectionReference(collection, read, engine);
  return VARIABLE.test(value) ? read(normalizeScriptVariableName(value)) : value;
}

function decimal(raw: string): { digits: bigint; scale: number } | undefined {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw) || raw.length > MAX_ITEM_LENGTH) return undefined;
  const [integer, fraction = ''] = raw.split('.');
  return { digits: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

function compare(left: string, right: string): number | undefined {
  const a = decimal(left), b = decimal(right);
  if (!a || !b) return undefined;
  const scale = Math.max(a.scale, b.scale);
  const x = a.digits * 10n ** BigInt(scale - a.scale), y = b.digits * 10n ** BigInt(scale - b.scale);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function evaluatePreviewCollectionCondition(command: string, rest: string, read: PreviewCollectionRead, engine: EngineId = 'GOM'): boolean | undefined {
  const args = splitTopLevel(rest.trim(), ' ');
  if (!args?.length) return undefined;
  const name = normalizeScriptVariableName(args[0]);
  const kind = previewCollectionKind(name, engine);
  const collection = kind ? parseCollection(kind, read(name)) : undefined;
  if (!collection) return undefined;
  const cmd = command.toUpperCase();
  if (cmd === 'CHECKLISTALLDIGIT' && Array.isArray(collection) && args.length === 1) return collection.every(item => decimal(item) !== undefined);
  if (cmd === 'CHECKDICTALLDIGIT' && !Array.isArray(collection) && args.length === 1) return Object.values(collection).every(item => decimal(item) !== undefined);
  if (cmd === 'CHECKVARINLIST' && Array.isArray(collection) && args.length === 2) {
    const value = operand(args[1], read, engine);
    return value === undefined ? undefined : collection.includes(value);
  }
  if (cmd === 'CHECKINDICT' && !Array.isArray(collection) && (args.length === 2 || args.length === 3)) {
    const value = operand(args[1], read, engine), mode = operand(args[2] ?? '0', read, engine);
    if (value === undefined || (mode !== '0' && mode !== '1')) return undefined;
    return mode === '0' ? Object.prototype.hasOwnProperty.call(collection, value) : Object.values(collection).includes(value);
  }
  return undefined;
}

/**
 * Execute only documented, bounded local collection operations. A true result means
 * handled, including an unknown result written as undefined (never retain stale IDX).
 * Evidence: per-engine L$/D$ help pages and GOM GL$ support, not command-name similarity.
 */
export function applyPreviewCollectionCommand(command: string, rest: string, read: PreviewCollectionRead, write: PreviewCollectionWrite,
  engine: EngineId = 'GOM', readPreview: PreviewCollectionRead = read): boolean {
  const args = splitTopLevel(rest.trim(), ' ');
  if (!args?.length) return false;
  const dependencies = new Set<string>();
  const trackedRead: PreviewCollectionRead = name => { dependencies.add(name); return read(name); };
  const cmd = command.toUpperCase();
  const output = (name: string | undefined, value: string | Collection | undefined, display: string | Collection | undefined = value) => {
    if (!name || !VARIABLE.test(name)) return;
    let text = typeof value === 'object' ? JSON.stringify(value) : value;
    if (text !== undefined && (text.length > MAX_LENGTH || /[\r\n\x00]/.test(text))) text = undefined;
    const preview = typeof display === 'object' ? JSON.stringify(display) : display;
    write(normalizeScriptVariableName(name), text, [...dependencies], text === undefined ? undefined : preview);
  };
  const value = (index: number, fallback?: string) => operand(args[index] ?? fallback, trackedRead, engine);
  const displayValue = (index: number, fallback?: string) => displayOperand(args[index] ?? fallback, trackedRead, readPreview, engine);
  const targetText = expand(args[0], trackedRead, engine);
  const reference = targetText === undefined ? undefined : collectionReference(targetText, engine);
  if (['MOV', 'INC', 'DEC'].includes(cmd) && reference) {
    const rawValue = args.slice(1).join(' ');
    const result = args.length > 1 ? operand(rawValue, trackedRead, engine) : '';
    const resultDisplay = args.length > 1 ? displayOperand(rawValue, trackedRead, readPreview, engine) : '';
    if (cmd === 'MOV' && reference.key === undefined) {
      if (args.length === 1 && reference.kind === 'list') output(reference.name, '');
      else output(reference.name, result === undefined ? undefined : parseCollection(reference.kind, result),
        resultDisplay === undefined ? undefined : parseCollection(reference.kind, resultDisplay));
      return true;
    }
    const collection = parseCollection(reference.kind, trackedRead(reference.name));
    if (!collection || result === undefined) { output(reference.name, undefined); return true; }
    const shadow = collectionShadow(reference.kind, collection, readPreview(reference.name));
    if (Array.isArray(collection)) {
      const display = shadow.values as string[];
      if (reference.key === undefined) {
        if (cmd === 'INC') { collection.push(result); display.push(resultDisplay ?? protectLiteral(result)); }
        else if (cmd === 'DEC') {
          // L$ DEC is first-match; GOM GL$ explicitly documents last-match removal.
          const index = reference.name.startsWith('GL$') ? collection.lastIndexOf(result) : collection.indexOf(result);
          if (index >= 0) { collection.splice(index, 1); display.splice(index, 1); }
        }
      } else {
        const index = numericIndex(reference.key, collection.length, engine);
        if (index === undefined) { output(reference.name, undefined); return true; }
        if (cmd === 'MOV') { collection[index] = result; display[index] = resultDisplay ?? protectLiteral(result); }
        else if (cmd === 'INC') { collection[index] += result; display[index] += resultDisplay ?? protectLiteral(result); }
        else {
          const position = collection[index].indexOf(result);
          if (position >= 0) display[index] = display[index].slice(0, position) + display[index].slice(position + result.length);
          collection[index] = collection[index].replace(result, '');
        }
      }
    } else {
      const display = shadow.values as Record<string, string>;
      if (cmd === 'MOV' && reference.key !== undefined) {
        collection[reference.key] = result;
        display[reference.key] = resultDisplay ?? protectLiteral(result);
        // A newly selected dynamic key is literal text. Existing key provenance
        // is retained independently of the replacement value's origin.
        shadow.keys[reference.key] ??= args[0].includes('<$') ? protectLiteral(reference.key) : reference.key;
      }
      else if (cmd === 'DEC' && reference.key === undefined) { delete collection[result]; delete display[result]; delete shadow.keys[result]; }
      else if (cmd === 'INC' && reference.key === undefined) {
        const pair = splitTopLevel(result, ':');
        if (!pair || pair.length !== 2 || !pair[0]) { output(reference.name, undefined); return true; }
        collection[pair[0]] = pair[1];
        const separator = pair[0].length;
        const preview = resultDisplay ?? protectLiteral(result);
        display[pair[0]] = preview.slice(separator + 1);
        shadow.keys[pair[0]] = preview.slice(0, separator);
      } else { output(reference.name, undefined); return true; }
    }
    output(reference.name, normalizedCollection(reference.kind, collection), serializeShadow(shadow));
    return true;
  }

  const listCommands = ['ADDTOLIST', 'INSERTTOLIST', 'REPLACELISTBYINDEX', 'REMOVELISTBYINDEX', 'REMOVELISTBYCONTENT', 'REPLACELISTBYCONTENT', 'REVERSELIST', 'EXTRACTLIST', 'SORTLIST', 'GETLISTVARCOUNT', 'GETLISTVARINDEX', 'GETLISTMAXVAR', 'GETLISTMINVAR'];
  const gomCommands = ['JOINLIST', 'SPLITTOLIST', 'CLONELIST', 'CONCATLIST', 'UNIQUELIST', 'SUMLIST', 'COUNTINLIST', 'SHUFFLELIST', 'RANDOMPICKLIST'];
  const dictCommands = ['GETDICTKEYCOUNT', 'GETDICTITEMS', 'GETDICTMAXVALUE', 'GETDICTMINVALUE'];
  if (!(listCommands.includes(cmd) || (engine === 'GOM' && gomCommands.includes(cmd)) || (engine !== '996PC' && dictCommands.includes(cmd)))) return false;
  const inPlace = ['ADDTOLIST', 'INSERTTOLIST', 'REPLACELISTBYINDEX', 'REMOVELISTBYINDEX', 'REMOVELISTBYCONTENT', 'REPLACELISTBYCONTENT'].includes(cmd);
  const destination = inPlace ? reference?.name : ['GETLISTVARINDEX', 'COUNTINLIST', 'CONCATLIST', 'GETDICTITEMS', 'SPLITTOLIST'].includes(cmd) ? args[2] : args[1];
  const arities: Record<string, [number, number]> = {
    INSERTTOLIST: [3, 3], REPLACELISTBYINDEX: [3, 3], REMOVELISTBYCONTENT: [2, 3], REPLACELISTBYCONTENT: [3, 4],
    EXTRACTLIST: [4, 5], SORTLIST: [2, engine === 'GOM' ? 6 : 4], GETLISTVARINDEX: [3, 3],
    JOINLIST: [3, 3], SPLITTOLIST: [3, 3], CONCATLIST: [3, 3], COUNTINLIST: [3, 3],
    GETDICTITEMS: [3, 3], GETDICTMAXVALUE: [3, 3], GETDICTMINVALUE: [3, 3],
  };
  const [minimum, maximum] = arities[cmd] ?? [2, 2];
  if (args.length < minimum || args.length > maximum) {
    output(destination, undefined);
    if (cmd === 'GETDICTMAXVALUE' || cmd === 'GETDICTMINVALUE') output(args[2], undefined);
    return true;
  }
  if (cmd === 'SPLITTOLIST') {
    const source = value(0), separator = value(1);
    const display = displayValue(0);
    output(args[2], source === undefined || !separator ? undefined : normalizedCollection('list', source.split(separator)),
      source === undefined || !separator || display === undefined ? undefined : splitDisplay(source, display, separator));
    return true;
  }
  if (!reference || reference.key !== undefined) { output(destination, undefined); return true; }
  const collection = parseCollection(reference.kind, trackedRead(reference.name));
  if (!collection) {
    output(destination, undefined);
    if (cmd === 'GETDICTMAXVALUE' || cmd === 'GETDICTMINVALUE') output(args[2], undefined);
    return true;
  }
  const shadow = collectionShadow(reference.kind, collection, readPreview(reference.name));
  if (!Array.isArray(collection)) {
    if (!dictCommands.includes(cmd)) { output(destination, undefined); return true; }
    const keys = Object.keys(collection);
    if (cmd === 'GETDICTKEYCOUNT') output(args[1], String(keys.length));
    else if (cmd === 'GETDICTITEMS') {
      const mode = value(1);
      // Dictionary iteration order is unspecified by the engine. Use stable local order only.
      output(args[2], mode === '0' ? keys : mode === '1' ? keys.map(key => collection[key]) : undefined,
        mode === '0' ? keys.map(key => shadow.keys[key]) : mode === '1' ? keys.map(key => (shadow.values as Record<string, string>)[key]) : undefined);
    } else {
      if (!keys.length || keys.some(key => decimal(collection[key]) === undefined)) { output(args[1], undefined); output(args[2], undefined); }
      else {
        const sorted = keys.sort((a, b) => (compare(collection[a], collection[b]) ?? 0) * (cmd === 'GETDICTMAXVALUE' ? -1 : 1));
        // Tied keys have no evidenced winner: keep the value, but never invent a winning name.
        output(args[1], sorted.length > 1 && compare(collection[sorted[0]], collection[sorted[1]]) === 0 ? undefined : sorted[0], shadow.keys[sorted[0]]);
        output(args[2], collection[sorted[0]], (shadow.values as Record<string, string>)[sorted[0]]);
      }
    }
    return true;
  }
  let result: string | string[] | undefined;
  let resultDisplay: string | string[] | undefined;
  const display = shadow.values as string[];
  if (cmd === 'GETLISTVARCOUNT') result = String(collection.length);
  else if (cmd === 'GETLISTVARINDEX' || cmd === 'COUNTINLIST') {
    const sought = value(1);
    result = sought === undefined ? undefined : String(cmd === 'GETLISTVARINDEX' ? collection.indexOf(sought) : collection.filter(item => item === sought).length);
  } else if (cmd === 'GETLISTMAXVAR' || cmd === 'GETLISTMINVAR') {
    result = !collection.length || collection.some(item => !decimal(item)) ? undefined : [...collection].sort((a, b) => (compare(a, b) ?? 0) * (cmd === 'GETLISTMAXVAR' ? -1 : 1))[0];
    if (result !== undefined) resultDisplay = display[collection.indexOf(result)];
  } else if (cmd === 'JOINLIST') {
    const separator = value(2);
    result = separator === undefined ? undefined : collection.join(separator);
    const previewSeparator = displayValue(2);
    resultDisplay = previewSeparator === undefined ? undefined : display.join(previewSeparator);
  } else if (cmd === 'CLONELIST') { result = [...collection]; resultDisplay = [...display]; }
  else if (cmd === 'UNIQUELIST') { result = [...new Set(collection)]; resultDisplay = result.map(item => display[collection.indexOf(item)]); }
  else if (cmd === 'REVERSELIST') { result = [...collection].reverse(); resultDisplay = [...display].reverse(); }
  else if (cmd === 'CONCATLIST') {
    const otherKind = previewCollectionKind(args[1], engine);
    const other = otherKind === 'list' ? parseCollection('list', trackedRead(normalizeScriptVariableName(args[1]))) : undefined;
    result = Array.isArray(other) ? collection.concat(other) : undefined;
    if (Array.isArray(other)) resultDisplay = display.concat(collectionShadow('list', other, readPreview(normalizeScriptVariableName(args[1]))).values as string[]);
  } else if (cmd === 'SUMLIST') {
    const numbers = collection.map(item => decimal(item) ?? { digits: 0n, scale: 0 });
    const scale = Math.max(0, ...numbers.map(number => number.scale));
    const sum = numbers.reduce((total, number) => total + number.digits * 10n ** BigInt(scale - number.scale), 0n);
    const unsigned = (sum < 0n ? -sum : sum).toString().padStart(scale + 1, '0');
    result = `${sum < 0n ? '-' : ''}${scale ? `${unsigned.slice(0, -scale)}.${unsigned.slice(-scale)}` : unsigned}`;
  } else if (cmd === 'ADDTOLIST') {
    const item = value(1);
    result = item === undefined ? undefined : collection.concat(item);
    if (item !== undefined) resultDisplay = display.concat(displayValue(1) ?? protectLiteral(item));
  } else if (cmd === 'INSERTTOLIST' || cmd === 'REPLACELISTBYINDEX' || cmd === 'REMOVELISTBYINDEX') {
    const rawIndex = value(cmd === 'REMOVELISTBYINDEX' ? 1 : 2);
    const index = rawIndex === undefined ? undefined : numericIndex(rawIndex, collection.length, engine, cmd === 'INSERTTOLIST', cmd === 'INSERTTOLIST');
    const item = cmd === 'REMOVELISTBYINDEX' ? '' : value(1);
    if (index !== undefined && item !== undefined) {
      result = [...collection];
      resultDisplay = [...display];
      if (cmd === 'INSERTTOLIST') { result.splice(index, 0, item); resultDisplay.splice(index, 0, displayValue(1) ?? protectLiteral(item)); }
      else if (cmd === 'REMOVELISTBYINDEX') { result.splice(index, 1); resultDisplay.splice(index, 1); }
      else { result[index] = item; resultDisplay[index] = displayValue(1) ?? protectLiteral(item); }
    }
  } else if (cmd === 'REMOVELISTBYCONTENT' || cmd === 'REPLACELISTBYCONTENT') {
    const sought = value(1), replacement = cmd === 'REMOVELISTBYCONTENT' ? '' : value(2);
    const mode = value(cmd === 'REMOVELISTBYCONTENT' ? 2 : 3, '0');
    if (sought !== undefined && replacement !== undefined && mode !== undefined) {
      if (cmd === 'REPLACELISTBYCONTENT' && engine === 'GOM') {
        // GOM owns a replacement-count contract; GEE/996PC own the case-sensitivity contract.
        const count = /^\d+$/.test(mode) ? Number(mode) : -1;
        if (count >= 1 && count <= MAX_ITEMS) {
          let replaced = 0;
          resultDisplay = [];
          result = collection.map((item, index) => {
            const replace = item === sought && replaced++ < count;
            (resultDisplay as string[]).push(replace ? displayValue(2) ?? protectLiteral(replacement) : display[index]);
            return replace ? replacement : item;
          });
        }
      } else if (mode === '0' || mode === '1') {
        const matches = (item: string) => mode === '1' ? item === sought : item.toLowerCase() === sought.toLowerCase();
        result = cmd === 'REMOVELISTBYCONTENT' ? collection.filter(item => !matches(item)) : collection.map(item => matches(item) ? replacement : item);
        resultDisplay = cmd === 'REMOVELISTBYCONTENT' ? display.filter((_, index) => !matches(collection[index]))
          : display.map((item, index) => matches(collection[index]) ? displayValue(2) ?? protectLiteral(replacement) : item);
      }
    }
  } else if (cmd === 'EXTRACTLIST') {
    const startText = value(2), endText = value(3), stepText = value(4, '1');
    const start = startText === undefined ? undefined : numericIndex(startText, collection.length, engine);
    const end = endText === undefined ? undefined : numericIndex(endText, collection.length, engine);
    const step = stepText && /^\d+$/.test(stepText) ? Number(stepText) : 0;
    if (start !== undefined && end !== undefined && Number.isSafeInteger(step) && step > 0) {
      result = [];
      resultDisplay = [];
      for (let index = start; start <= end ? index <= end : index >= end; index += start <= end ? step : -step) {
        result.push(collection[index]); resultDisplay.push(display[index]);
      }
      if (previewCollectionKind(args[1], engine) !== 'list') { result = nativeCollection(result); resultDisplay = nativeCollection(resultDisplay); }
    }
  } else if (cmd === 'SORTLIST') {
    const direction = value(2, '0'), numeric = value(3, '0'), separator = value(4), segment = value(5, '1');
    if ((direction === '0' || direction === '1') && (numeric === '0' || numeric === '1') && (args.length <= 4 || engine === 'GOM')) {
      const part = segment && /^\d+$/.test(segment) ? Number(segment) : 0;
      const key = (item: string) => separator && part > 0 ? (item.split(separator)[part - 1] ?? item) : item;
      if (numeric !== '0' || collection.every(item => decimal(key(item)) !== undefined)) {
        const order = collection.map((_, index) => index).sort((a, b) => (numeric === '0' ? compare(key(collection[a]), key(collection[b])) ?? 0
          : key(collection[a]) < key(collection[b]) ? -1 : key(collection[a]) > key(collection[b]) ? 1 : 0) * (direction === '1' ? -1 : 1));
        result = order.map(index => collection[index]);
        resultDisplay = order.map(index => display[index]);
      }
    }
  }
  // RANDOMPICKLIST/SHUFFLELIST intentionally clear outputs; a local preview is not a random draw.
  output(destination, Array.isArray(result) ? normalizedCollection('list', result) : result,
    resultDisplay ?? result);
  return true;
}
