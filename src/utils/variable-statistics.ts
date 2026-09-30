export interface VariableUsage {
  count: number;
  files: Set<string>;
}

/** Script identifiers need a Unicode-aware boundary, not JavaScript's ASCII \b. */
export function* findScriptVariables(text: string): IterableIterator<{ name: string; index: number }> {
  const pattern = /(?:(?<![\p{L}\p{N}_$])|(?<=<\$))((?:GL|[NSLD])\$[A-Za-z0-9_\u3400-\u9fff]+|[PDMNSIGAUTJZ]\d+)(?![\p{L}\p{N}_$])/giu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    yield { name: normalizeScriptVariableName(match[1]), index: match.index };
  }
}

export function normalizeScriptVariableName(name: string): string {
  const trimmed = name.trim();
  const bracketed = /^\[([^\]]+)\]$/.exec(trimmed);
  if (bracketed) {
    return `[${normalizeScriptVariableName(bracketed[1])}]`;
  }

  const numbered = /^([PDMNSIGAUTJZ])(\d+)$/i.exec(trimmed);
  if (numbered) {
    return `${numbered[1].toUpperCase()}${numbered[2].replace(/^0+(?=\d)/, '')}`;
  }

  // The engine accepts case-insensitive type prefixes, while custom variable
  // names after "$" may be case-sensitive.
  const custom = /^(GL|[NSLD])(\$.*)$/i.exec(trimmed);
  if (custom) {
    return `${custom[1].toUpperCase()}${custom[2]}`;
  }

  return trimmed;
}

export function compactVariableTypeLabel(name: string): string {
  const upper = name.toUpperCase();
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
