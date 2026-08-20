export interface ScriptTextSpan {
  start: number;
  end: number;
  text: string;
}

export interface ScriptCommandInvocation<T> {
  command: T;
  typedName: string;
  commandSpan: ScriptTextSpan;
  arguments: ScriptTextSpan[];
  form: 'line' | 'markup';
}

export interface ScriptCommandArgument<T> {
  invocation: ScriptCommandInvocation<T>;
  argument: ScriptTextSpan;
  index: number;
}

export interface CommandParameterDescription {
  raw: string;
  label: string;
  detail: string;
  optional: boolean;
}

type CommandResolver<T> = (typedName: string) => T | undefined;

const DIRECTIVE_PATTERN = /^#(?:IF|ACT|SAY|ELSEACT|ELSESAY|OR|AND)\b/i;
const COMMAND_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*/;

export function findScriptCommandInvocations<T>(
  line: string,
  resolveCommand: CommandResolver<T>
): ScriptCommandInvocation<T>[] {
  if (!line.trim() || /^\s*[;]/.test(line)) return [];
  const result: ScriptCommandInvocation<T>[] = [];
  const lineInvocation = findLineInvocation(line, resolveCommand);
  if (lineInvocation) result.push(lineInvocation);
  result.push(...findMarkupInvocations(line, resolveCommand));
  return result;
}

export function findScriptCommandArgumentAt<T>(
  line: string,
  character: number,
  resolveCommand: CommandResolver<T>
): ScriptCommandArgument<T> | undefined {
  for (const invocation of findScriptCommandInvocations(line, resolveCommand)) {
    for (let index = 0; index < invocation.arguments.length; index++) {
      const argument = invocation.arguments[index];
      if (argument.start <= character && character < argument.end) {
        return { invocation, argument, index };
      }
    }
  }
  return undefined;
}

export function describeCommandParameter(rawValue: string): CommandParameterDescription {
  const raw = rawValue.trim();
  const optional = raw.startsWith('[') && raw.endsWith(']');
  const body = optional ? raw.slice(1, -1).trim() : raw;
  const numbered = /^(参数\d+)\s*[（(](.+)[）)]$/.exec(body);
  if (numbered) {
    return { raw, label: numbered[1], detail: numbered[2].trim(), optional };
  }

  const separator = firstParameterSeparator(body);
  if (separator >= 0) {
    return {
      raw,
      label: body.slice(0, separator).trim() || body,
      detail: body.slice(separator + 1).trim(),
      optional,
    };
  }
  return { raw, label: body, detail: '', optional };
}

export function formatCommandParameterMeaning(rawValue: string): string {
  const described = describeCommandParameter(rawValue);
  if (!described.detail) return described.label || described.raw;
  if (/^参数\d+$/i.test(described.label)) return described.detail;
  return `${described.label}：${described.detail}`;
}

export function isMapParameterDescription(rawValue: string): boolean {
  const described = describeCommandParameter(rawValue);
  let value = described.detail && /^参数\d+$/i.test(described.label)
    ? described.detail
    : (described.label || described.raw);
  value = value.replace(/^\[|\]$/g, '').trim();
  if (!value || /地图变量|显示名|小地图编号/i.test(value)) return false;
  return /^(?:(?:原|新|源|目标|连接|待连接|入口|退出返回|返回|老|指定|当前|所在)地图|地图)(?:编号|代码|号|名(?:称)?|文件(?:名|名称)?|ID)?(?:$|[\s(（:：/]|或SELF)/i.test(value);
}

function findLineInvocation<T>(
  line: string,
  resolveCommand: CommandResolver<T>
): ScriptCommandInvocation<T> | undefined {
  let cursor = skipWhitespace(line, 0, line.length);
  let argumentEnd = line.length;

  const directive = DIRECTIVE_PATTERN.exec(line.slice(cursor));
  if (directive) {
    cursor += directive[0].length;
    cursor = skipWhitespace(line, cursor, line.length);
    if (line[cursor] === '(') {
      const closing = findMatchingClose(line, cursor, '(', ')');
      if (closing >= 0) argumentEnd = closing;
      cursor++;
      cursor = skipWhitespace(line, cursor, argumentEnd);
    }
  }

  const commandMatch = COMMAND_PATTERN.exec(line.slice(cursor, argumentEnd));
  if (!commandMatch) return undefined;
  const typedName = commandMatch[0].replace(/\.+$/, '');
  const command = resolveCommand(typedName);
  if (!command) return undefined;
  const commandEnd = cursor + typedName.length;
  return {
    command,
    typedName,
    commandSpan: { start: cursor, end: commandEnd, text: typedName },
    arguments: splitWhitespaceArguments(line, commandEnd, argumentEnd),
    form: 'line',
  };
}

function findMarkupInvocations<T>(
  line: string,
  resolveCommand: CommandResolver<T>
): ScriptCommandInvocation<T>[] {
  const result: ScriptCommandInvocation<T>[] = [];
  const pattern = /<&?([A-Za-z_][A-Za-z0-9_.]*)(?=[:>])/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const typedName = match[1].replace(/\.+$/, '');
    const command = resolveCommand(typedName);
    if (!command) continue;
    const commandStart = match.index + match[0].length - match[1].length;
    const commandEnd = commandStart + typedName.length;
    const markupEnd = findAngleMarkupEnd(line, match.index);
    if (markupEnd < 0) continue;
    const argumentsStart = line[commandEnd] === ':' ? commandEnd + 1 : commandEnd;
    result.push({
      command,
      typedName,
      commandSpan: { start: commandStart, end: commandEnd, text: typedName },
      arguments: argumentsStart < markupEnd
        ? splitDelimitedArguments(line, argumentsStart, markupEnd, ':')
        : [],
      form: 'markup',
    });
    pattern.lastIndex = markupEnd + 1;
  }
  return result;
}

function splitWhitespaceArguments(line: string, start: number, end: number): ScriptTextSpan[] {
  const result: ScriptTextSpan[] = [];
  let cursor = start;
  while (cursor < end) {
    cursor = skipWhitespace(line, cursor, end);
    if (cursor >= end) break;
    const tokenStart = cursor;
    const state = createDelimiterState();
    while (cursor < end) {
      const char = line[cursor];
      updateDelimiterState(state, char);
      if (/\s/.test(char) && isTopLevel(state)) break;
      cursor++;
    }
    const span = trimmedSpan(line, tokenStart, cursor);
    if (span) result.push(span);
  }
  return result;
}

function splitDelimitedArguments(
  line: string,
  start: number,
  end: number,
  delimiter: string
): ScriptTextSpan[] {
  const result: ScriptTextSpan[] = [];
  const state = createDelimiterState();
  let segmentStart = start;
  for (let cursor = start; cursor < end; cursor++) {
    const char = line[cursor];
    if (char === delimiter && isTopLevel(state)) {
      result.push(trimmedSpan(line, segmentStart, cursor) || {
        start: cursor,
        end: cursor,
        text: '',
      });
      segmentStart = cursor + 1;
      continue;
    }
    updateDelimiterState(state, char);
  }
  result.push(trimmedSpan(line, segmentStart, end) || { start: end, end, text: '' });
  return result;
}

function firstParameterSeparator(value: string): number {
  const ascii = value.indexOf(':');
  const full = value.indexOf('：');
  if (ascii < 0) return full;
  if (full < 0) return ascii;
  return Math.min(ascii, full);
}

function trimmedSpan(line: string, start: number, end: number): ScriptTextSpan | undefined {
  while (start < end && /\s/.test(line[start])) start++;
  while (end > start && /\s/.test(line[end - 1])) end--;
  if (start >= end) return undefined;
  return { start, end, text: line.slice(start, end) };
}

function skipWhitespace(line: string, start: number, end: number): number {
  while (start < end && /\s/.test(line[start])) start++;
  return start;
}

function findMatchingClose(
  line: string,
  start: number,
  opening: string,
  closing: string
): number {
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
    if (char === opening) depth++;
    if (char === closing && --depth === 0) return cursor;
  }
  return -1;
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

interface DelimiterState {
  round: number;
  square: number;
  curly: number;
  angle: number;
  quote: string;
}

function createDelimiterState(): DelimiterState {
  return { round: 0, square: 0, curly: 0, angle: 0, quote: '' };
}

function updateDelimiterState(state: DelimiterState, char: string): void {
  if (state.quote) {
    if (char === state.quote) state.quote = '';
    return;
  }
  if (char === '"' || char === "'") {
    state.quote = char;
    return;
  }
  if (char === '(') state.round++;
  else if (char === ')' && state.round > 0) state.round--;
  else if (char === '[') state.square++;
  else if (char === ']' && state.square > 0) state.square--;
  else if (char === '{') state.curly++;
  else if (char === '}' && state.curly > 0) state.curly--;
  else if (char === '<') state.angle++;
  else if (char === '>' && state.angle > 0) state.angle--;
}

function isTopLevel(state: DelimiterState): boolean {
  return !state.quote
    && state.round === 0
    && state.square === 0
    && state.curly === 0
    && state.angle === 0;
}
