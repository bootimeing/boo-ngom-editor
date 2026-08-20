export interface VariableUsage {
  count: number;
  files: Set<string>;
}

export function normalizeScriptVariableName(name: string): string {
  const trimmed = name.trim();
  const bracketed = /^\[([^\]]+)\]$/.exec(trimmed);
  if (bracketed) {
    return `[${normalizeScriptVariableName(bracketed[1])}]`;
  }

  const numbered = /^([PDMNSIGAUTJZ])(\d+)$/i.exec(trimmed);
  if (numbered) {
    return `${numbered[1].toUpperCase()}${numbered[2]}`;
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
