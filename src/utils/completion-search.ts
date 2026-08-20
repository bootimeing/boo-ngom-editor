export interface SearchableCommand {
  name: string;
  syntax?: string;
  description?: string;
  params?: string[];
  aliases?: string[];
}

export interface ChineseCommandSearch {
  query: string;
  start: number;
}

const HAN_SUFFIX = /([\p{Script=Han}]+)$/u;
const INLINE_COMMAND_PREFIX = /^\s*#(?:IF|OR|ACT|ELSEACT)\s+$/iu;

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN');
}

function compactSearchText(value: string): string {
  return normalizeSearchText(value).replace(/[\s\p{P}\p{S}]+/gu, '');
}

function isSubsequence(query: string, value: string): boolean {
  let queryIndex = 0;
  for (const char of value) {
    if (char !== query[queryIndex]) continue;
    queryIndex++;
    if (queryIndex === query.length) return true;
  }
  return false;
}

/**
 * Chinese description search is accepted only where a command can start.
 * This keeps NPC dialogue text and command arguments out of the replacement range.
 */
export function findChineseCommandSearch(linePrefix: string): ChineseCommandSearch | null {
  const match = HAN_SUFFIX.exec(linePrefix);
  if (!match || match.index === undefined) return null;

  const prefix = linePrefix.slice(0, match.index);
  if (prefix.trim() !== '' && !INLINE_COMMAND_PREFIX.test(prefix)) return null;
  return { query: match[1], start: match.index };
}

export function buildCommandSearchText(
  command: SearchableCommand,
  _category: string
): string {
  return command.description || '';
}

/**
 * Lower scores are better. Direct matches are ranked before fuzzy subsequences.
 */
export function scoreChineseCommandSearch(
  command: SearchableCommand,
  _category: string,
  query: string
): number | null {
  const normalizedQuery = compactSearchText(query);
  if (!normalizedQuery) return null;

  const description = compactSearchText(command.description || '');
  if (description.includes(normalizedQuery)) return 0;
  return isSubsequence(normalizedQuery, description) ? 1 : null;
}

export function buildChineseCommandFilterText(
  command: SearchableCommand,
  _category: string,
  query: string
): string {
  return `${query} ${command.description || ''}`;
}
