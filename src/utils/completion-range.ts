function suffixStart(linePrefix: string, pattern: RegExp): number {
  const match = linePrefix.match(pattern);
  return match?.index ?? -1;
}

export function findAtLabelReplacementStart(linePrefix: string): number {
  return suffixStart(linePrefix, /@[^\s<>\[\]\\/]*$/u);
}

export function findVariableReplacementStart(linePrefix: string): number {
  if (linePrefix.endsWith('<')) return linePrefix.length - 1;

  const angleVariable = suffixStart(linePrefix, /<\$[^<>\s]*$/u);
  if (angleVariable >= 0) return angleVariable;

  return suffixStart(linePrefix, /[NSD]\$[A-Za-z0-9_]*$/iu);
}

export function findCommandReplacementStart(linePrefix: string): number {
  return suffixStart(linePrefix, /[A-Za-z_$][A-Za-z_0-9.$]*$/u);
}

export function findDirectiveReplacementStart(linePrefix: string): number {
  return suffixStart(linePrefix, /#[A-Za-z]*$/u);
}

export function findSectionLabelReplacementStart(linePrefix: string): number {
  const start = suffixStart(linePrefix, /\[(?:@[^\]\r\n]*)?$/u);
  if (start < 0) return -1;
  const value = linePrefix.slice(start);
  return value === '[' || value.startsWith('[@') ? start : -1;
}

export function findSayMarkupReplacementStart(linePrefix: string): number {
  return suffixStart(linePrefix, /<[^<>\r\n]*$/u);
}

export function findPathPartialReplacementStart(linePrefix: string): number {
  const match = linePrefix.match(/((?:\.\.?)?[\\\/](?:[^\\\/]*[\\\/])*)([^\\\/]*)$/u);
  if (!match || !match[1]) return -1;
  return linePrefix.length - (match[2] || '').length;
}

export function findMapInfoReplacementStart(linePrefix: string): number {
  return suffixStart(
    linePrefix,
    /[A-Za-z][A-Za-z0-9_]*(?:\([^)\r\n]*)?$/u
  );
}
