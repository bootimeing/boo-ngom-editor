import { IndexedCommand, LanguageIndex } from './command-index';

export type SemanticCommandKind = 'check' | 'action';

export interface SemanticCommandIndex {
  checks: Set<string>;
  actions: Set<string>;
  engine?: LanguageIndex['engine'];
}

export interface CommandCandidate {
  name: string;
  start: number;
  end: number;
}

function addNames(target: Set<string>, commands: IndexedCommand[]): void {
  for (const command of commands) {
    if (!command.source && command.origin !== 'custom') continue;
    target.add(command.name.toUpperCase());
    for (const alias of command.aliases) target.add(alias.toUpperCase());
  }
}

export function buildSemanticCommandIndex(index: LanguageIndex): SemanticCommandIndex {
  const checks = new Set<string>();
  const actions = new Set<string>();
  // Name recognition is independent of whether parameter snippets are verified.
  addNames(checks, index.checks);
  addNames(actions, index.actions);
  addNames(actions, index.sayCommands);

  // Flow/control commands and any future uncategorized commands remain executable names.
  for (const command of index.commands) {
    const key = command.name.toUpperCase();
    if (!checks.has(key) && !actions.has(key)) addNames(actions, [command]);
  }
  return { checks, actions, engine: index.engine };
}

export function classifySemanticCommand(
  index: SemanticCommandIndex,
  name: string,
  preferred: SemanticCommandKind = 'action'
): SemanticCommandKind | null {
  let key = name.toUpperCase();
  // Only documented object selectors may fall back to a base command.
  // Exact engine-specific entries always take precedence.
  const prefixes = index.engine === 'GOM' ? /^(?:H|O|M|P|L|PET|BB|CO|[NS]\d+)\./
    : index.engine === 'GEE' ? /^(?:H|O|M|P|L|HM|HL|CO|PET|BB)\./
      : index.engine === '996PC' ? /^(?:H|O|M|P|HM|HH|HP|PEX|HPEX)\./ : null;
  while (!index.checks.has(key) && !index.actions.has(key) && prefixes?.test(key)) {
    key = key.replace(prefixes, '');
  }
  const isCheck = index.checks.has(key);
  const isAction = index.actions.has(key);
  if (isCheck && isAction) return preferred;
  if (isCheck) return 'check';
  if (isAction) return 'action';
  return null;
}

/** Drop-file directives are not NPC action/check commands. Keep engine gates here. */
export function findDropFlowTokens(line: string, engine: LanguageIndex['engine']): CommandCandidate[] {
  const head = /^\s*#(CHILD|CASE|IF)\b/i.exec(line);
  if (!head) return [];
  const directive = head[1].toUpperCase();
  if (directive !== 'CHILD' && engine !== 'GOM' && engine !== '996PC') return [];
  if (directive === 'IF' && !/^\s*#IF\s+\[/.test(line.toUpperCase())) return [];
  const start = line.indexOf('#');
  const result = [{ name: `#${directive}`, start, end: start + directive.length + 1 }];
  // Semicolons inside LFM's condition brackets separate conditions, not comments.
  let depth = 0;
  let end = line.length;
  for (let i = head[0].length; i < line.length; i++) {
    if (line[i] === '[') depth++;
    else if (line[i] === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (line[i] === ';' || line.slice(i, i + 2) === '//')) { end = i; break; }
  }
  for (const match of line.slice(head[0].length, end).matchAll(/\b(RANDOM|BURSTRATE|OR)\b/gi)) {
    const name = match[1].toUpperCase();
    if (name === 'BURSTRATE' && (engine === '996PC' || directive !== 'CHILD')) continue;
    if (name === 'OR' && (engine !== 'GEE' || directive !== 'CHILD')) continue;
    const tokenStart = head[0].length + (match.index || 0);
    result.push({ name, start: tokenStart, end: tokenStart + name.length });
  }
  return result;
}

export function findScriptFlowTokens(line: string, engine: LanguageIndex['engine']): CommandCandidate[] {
  const match = /^\s*#(DEFINE|AUTORUN|CALLEX)\b/i.exec(line);
  if (!match) return findDropFlowTokens(line, engine);
  if (match[1].toUpperCase() === 'CALLEX' && engine === '996PC') return [];
  const start = line.indexOf('#');
  return [{ name: `#${match[1].toUpperCase()}`, start, end: start + match[1].length + 1 }];
}

export function findCommandCandidates(line: string): CommandCandidate[] {
  const result: CommandCandidate[] = [];
  const pattern = /[A-Za-z_][A-Za-z0-9_.]*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const name = match[0].replace(/\.+$/, '');
    if (name) {
      result.push({ name, start: match.index, end: match.index + name.length });
    }
    if (pattern.lastIndex >= line.length) break;
  }
  return result;
}
