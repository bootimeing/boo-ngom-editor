import { EngineId } from '../types';
import { maskDialogContainerIds } from './script-container-ids';
import { findScriptCommandInvocations, ScriptTextSpan } from './command-arguments';

export interface VariableUsage {
  count: number;
  files: Set<string>;
}

export interface ScriptSemanticVariableReference {
  name: string;
  index: number;
  end: number;
  expression: string;
  reason?: string;
}
export interface ScriptSemanticVariableReferences {
  references: ScriptSemanticVariableReference[];
  /** A scoped name or expanded CLEARVAR start is not a second ordinary variable token. */
  excludedRanges: ScriptTextSpan[];
}

const STATIC_SCOPED_NAME = /^[\p{L}_][\p{L}\p{N}_]*(?:·[\p{L}\p{N}_]+)*$/u;

/** Interpret scope and command position using the selected engine manual. */
export function findSemanticScriptVariables(line: string, engine: EngineId, context?: string | boolean): ScriptSemanticVariableReferences {
  const result: ScriptSemanticVariableReferences = { references: [], excludedRanges: [] };
  if (/^\s*(?:;|\/\/)/.test(line)) return result;
  const supportedScope = (scope: string, command?: string) => (engine === 'GOM' || engine === 'GEE') &&
    (scope === 'HUMAN' || (engine === 'GOM' && (scope === 'GUILD' || scope === 'GLOBAL')) || (engine === 'GEE' && scope === 'GUILD' && command !== 'LOADVAR'));
  const addScoped = (scope: string, rawName: string, span: ScriptTextSpan, expression: string, command?: string) => {
    if (!STATIC_SCOPED_NAME.test(rawName)) return;
    result.excludedRanges.push(span);
    if (supportedScope(scope, command)) result.references.push({
      name: `${scope}(${rawName})`, index: span.start, end: span.end, expression,
    });
  };
  const placeholders = /<\$(HUMAN|GUILD|GLOBAL)\(\s*([\p{L}_][\p{L}\p{N}_]*(?:·[\p{L}\p{N}_]+)*)\s*\)>/giu;
  let match: RegExpExecArray | null;
  while ((match = placeholders.exec(line)) !== null) {
    addScoped(match[1].toUpperCase(), match[2], { start: match.index, end: placeholders.lastIndex, text: match[0] }, match[0]);
  }
  const block = typeof context === 'string' ? context : undefined;
  if (context === false || block === 'SAY' || block === 'ELSESAY') return result;
  const conditional = /^(?:IF|OR|AND)$/.test(block || '');
  // Preserve source offsets when stripping conditional negation.
  const commandLine = line.replace(/^(\s*(?:#(?:IF|OR|AND)\s+)?)((?:NOT\s+)+)(?=CHECKVAR\b)/i,
    (_match, prefix: string, negations: string) => prefix + ' '.repeat(negations.length));
  for (const invocation of findScriptCommandInvocations(commandLine, name => /^(?:VAR|CALCVAR|LOADVAR|SAVEVAR|CLEARVAR|CHECKVAR)$/i.test(name) ? name.toUpperCase() : undefined)) {
    if (invocation.form !== 'line') continue;
    const args = invocation.arguments;
    const command = invocation.command;
    if (block && conditional !== (command === 'CHECKVAR')) continue;
    if (command === 'CHECKVAR' && engine !== 'GOM') continue;
    if (command === 'CLEARVAR') {
      // Both own manuals explicitly show S0 5 => S0-S4. Do not extrapolate to U/T/etc.
      if (engine !== 'GOM' && engine !== 'GEE') continue;
      if (!/^S\d+$/i.test(args[0]?.text || '') || !/^\d+$/.test(args[1]?.text || '')) continue;
      const start = Number(args[0].text.slice(1));
      const count = Number(args[1].text);
      // The documented S family is 0..999; malformed or out-of-range commands retain lexical scanning.
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 1 || start + count > 1000) continue;
      result.excludedRanges.push(args[0]);
      const expression = line.slice(invocation.commandSpan.start, args[1].end);
      for (let index = start; index < start + count; index++) result.references.push({
        name: `S${index}`, index: args[0].start, end: args[0].end, expression,
        reason: `CLEARVAR静态区间覆盖S${start}-S${start + count - 1}，每个槽位在该源码位置计一处引用`,
      });
      continue;
    }
    const scopeIndex = command === 'VAR' ? 1 : 0;
    if (command === 'VAR' && !(/^(?:INTEGER|STRING)$/i.test(args[0]?.text || '') && (engine === 'GOM' || args[0].text.toUpperCase() === 'INTEGER'))) continue;
    if (args.length < (command === 'CALCVAR' ? 4 : 3)) continue;
    const scope = args[scopeIndex]?.text.toUpperCase();
    const name = args[scopeIndex + 1];
    if (!name || (scope !== 'HUMAN' && scope !== 'GUILD' && scope !== 'GLOBAL')) continue;
    addScoped(scope, name.text, name, line.slice(invocation.commandSpan.start), command);
  }
  return result;
}

/** Absolute name spans for consumers that otherwise scan ordinary tokens across a whole document. */
export function findSemanticScriptVariableExclusionRanges(text: string, engine: EngineId): ScriptTextSpan[] {
  const ranges: ScriptTextSpan[] = [];
  let offset = 0;
  let activeBlock: string | undefined;
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (/^\s*\[@[^\]]+\]/.test(line)) activeBlock = undefined;
    const directive = /^\s*#(IF|ACT|SAY|ELSEACT|ELSESAY|OR|AND)\b/i.exec(line);
    if (directive) activeBlock = directive[1].toUpperCase();
    const semantic = findSemanticScriptVariables(line, engine, activeBlock);
    for (const span of semantic.excludedRanges) ranges.push({ ...span, start: offset + span.start, end: offset + span.end });
    offset += line.length;
    offset += text[offset] === '\r' && text[offset + 1] === '\n' ? 2 : 1;
  }
  return ranges;
}

/** Script identifiers need a Unicode-aware boundary, not JavaScript's ASCII \b. */
export function* findScriptVariables(text: string, engine: EngineId = 'GOM'): IterableIterator<{ name: string; index: number; raw: string }> {
  text = maskDialogContainerIds(text, engine);
  const pattern = /(?:(?<![\p{L}\p{N}_$])|(?<=<\$))((?:GD|GL|[NSLD])\$[\p{L}\p{N}_]+(?:·[\p{L}\p{N}_]+)*|[PDMNSIGAUTJZ]\d+)(?![\p{L}\p{N}_$])/giu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (engine !== 'GOM' && /^GD\$/i.test(match[1])) continue;
    yield { name: normalizeScriptVariableName(match[1]), index: match.index, raw: match[1] };
  }
}

export function normalizeScriptVariableName(name: string): string {
  const trimmed = name.trim();
  const bracketed = /^\[([^\]]+)\]$/.exec(trimmed);
  if (bracketed) {
    return `[${normalizeScriptVariableName(bracketed[1])}]`;
  }

  // The scope is part of identity. Preserve the user-defined name's case conservatively.
  const scoped = /^(HUMAN|GUILD|GLOBAL)\(\s*([\p{L}_][\p{L}\p{N}_]*(?:·[\p{L}\p{N}_]+)*)\s*\)$/iu.exec(trimmed);
  if (scoped) return `${scoped[1].toUpperCase()}(${scoped[2]})`;

  const numbered = /^([PDMNSIGAUTJZ])(\d+)$/i.exec(trimmed);
  if (numbered) {
    return `${numbered[1].toUpperCase()}${numbered[2].replace(/^0+(?=\d)/, '')}`;
  }

  // The engine accepts case-insensitive type prefixes, while custom variable
  // names after "$" may be case-sensitive.
  const custom = /^(GD|GL|[NSLD])(\$.*)$/i.exec(trimmed);
  if (custom) {
    return `${custom[1].toUpperCase()}${custom[2]}`;
  }

  return trimmed;
}

export function compactVariableTypeLabel(name: string): string {
  const upper = name.toUpperCase();
  const scoped = /^(HUMAN|GUILD|GLOBAL)\(/.exec(upper);
  if (scoped) return `${scoped[1]}命名变量`;
  if (upper.startsWith('GD$')) return 'GD$';
  if (upper.startsWith('GL$')) return 'GL$';
  const custom = /^(N\$|S\$|L\$|D\$)/i.exec(name);
  if (custom) return custom[1].toUpperCase();
  return /^([PDMNSIGAUTJZ])\d+$/i.exec(name)?.[1].toUpperCase() || '其他';
}

export function formatVariableGroupLabel(category: string, count: number): string {
  return `${category}(${count}个)`;
}

export function recordVariableUsage<T extends VariableUsage>(
  usages: Map<string, T>,
  rawName: string,
  filePath: string,
  create: (normalizedName: string) => T
): { name: string; usage: T } {
  const name = normalizeScriptVariableName(rawName);
  let usage = usages.get(name);
  if (!usage) {
    usage = create(name);
    usages.set(name, usage);
  }
  usage.count++;
  usage.files.add(filePath);
  return { name, usage };
}
