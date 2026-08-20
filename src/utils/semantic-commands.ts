import { IndexedCommand, LanguageIndex } from './command-index';

export type SemanticCommandKind = 'check' | 'action';

export interface SemanticCommandIndex {
  checks: Set<string>;
  actions: Set<string>;
}

export interface CommandCandidate {
  name: string;
  start: number;
  end: number;
}

function addNames(target: Set<string>, commands: IndexedCommand[]): void {
  for (const command of commands) target.add(command.name.toUpperCase());
}

export function buildSemanticCommandIndex(index: LanguageIndex): SemanticCommandIndex {
  const checks = new Set<string>();
  const actions = new Set<string>();
  addNames(checks, index.checkNameCompletions);
  addNames(actions, index.actionNameCompletions);
  addNames(actions, index.sayNameCompletions);

  // Flow/control commands and any future uncategorized commands remain executable names.
  for (const command of index.commandNameCompletions) {
    const key = command.name.toUpperCase();
    if (!checks.has(key) && !actions.has(key)) actions.add(key);
  }
  return { checks, actions };
}

export function classifySemanticCommand(
  index: SemanticCommandIndex,
  name: string,
  preferred: SemanticCommandKind = 'action'
): SemanticCommandKind | null {
  const key = name.toUpperCase();
  const isCheck = index.checks.has(key);
  const isAction = index.actions.has(key);
  if (isCheck && isAction) return preferred;
  if (isCheck) return 'check';
  if (isAction) return 'action';
  return null;
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
