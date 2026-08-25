import {
  analyzeNestedVariables,
  NestedVariableAnalysisOptions,
} from './nested-variable-analysis';
import { isScriptCommentLine } from './script-labels';

export type CandidateVariableFamily = 'U' | 'T' | 'A' | 'G';

export interface CandidateUsage {
  variables: Record<CandidateVariableFamily, Set<number>>;
  personalFlags: Set<number>;
  uncertainVariableFamilies: Set<CandidateVariableFamily>;
  personalFlagsUncertain: boolean;
}

export interface CandidateCollectionOptions extends NestedVariableAnalysisOptions {
  excludedRanges?: readonly { start: number; end: number }[];
}

const FAMILY_LIMITS: Record<CandidateVariableFamily, number> = {
  U: 499,
  T: 499,
  A: 499,
  G: 499,
};

export function createCandidateUsage(): CandidateUsage {
  return {
    variables: { U: new Set(), T: new Set(), A: new Set(), G: new Set() },
    personalFlags: new Set(),
    uncertainVariableFamilies: new Set(),
    personalFlagsUncertain: false,
  };
}

export function collectCandidateUsage(
  text: string,
  options: CandidateCollectionOptions = {},
): CandidateUsage {
  const usage = createCandidateUsage();
  const activeText = text.replace(/[^\r\n]*(?:\r\n|\r|\n|$)/g, chunk => {
    const line = chunk.replace(/[\r\n]+$/, '');
    const ending = chunk.slice(line.length);
    return `${isScriptCommentLine(line) ? ' '.repeat(line.length) : line}${ending}`;
  });

  const direct = /\b([UTAG])(\d{1,3})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = direct.exec(activeText)) !== null) {
    if (options.excludedRanges?.some(range => range.start <= match!.index && match!.index < range.end)) {
      continue;
    }
    addVariable(usage, match[1], Number(match[2]));
  }

  const nested = analyzeNestedVariables(text, options);
  for (const reference of nested.references) {
    for (const variable of reference.variables) {
      const variableMatch = /^([UTAG])(\d+)$/i.exec(variable);
      if (variableMatch) addVariable(usage, variableMatch[1], Number(variableMatch[2]));
    }
    const familyMatch = /^([UTAG])$/i.exec(reference.base);
    if (familyMatch && reference.status !== 'resolved') {
      usage.uncertainVariableFamilies.add(
        familyMatch[1].toUpperCase() as CandidateVariableFamily
      );
    }
  }
  for (const reference of nested.personalFlags) {
    for (const flag of reference.flags) {
      const flagMatch = /^\[(\d+)]$/.exec(flag);
      if (!flagMatch) continue;
      const value = Number(flagMatch[1]);
      if (Number.isInteger(value) && value >= 1 && value <= 1024) {
        usage.personalFlags.add(value);
      }
    }
    if (reference.status !== 'resolved') usage.personalFlagsUncertain = true;
  }
  return usage;
}

export function mergeCandidateUsage(target: CandidateUsage, source: CandidateUsage): CandidateUsage {
  for (const family of candidateVariableFamilies()) {
    for (const value of source.variables[family]) target.variables[family].add(value);
    if (source.uncertainVariableFamilies.has(family)) {
      target.uncertainVariableFamilies.add(family);
    }
  }
  for (const value of source.personalFlags) target.personalFlags.add(value);
  target.personalFlagsUncertain ||= source.personalFlagsUncertain;
  return target;
}

export function unusedVariableCandidates(
  family: CandidateVariableFamily,
  usage: CandidateUsage,
): number[] {
  return unusedRange(0, FAMILY_LIMITS[family], usage.variables[family]);
}

export function unusedPersonalFlagCandidates(usage: CandidateUsage): number[] {
  return unusedRange(1, 1024, usage.personalFlags);
}

export function candidateVariableFamilies(): CandidateVariableFamily[] {
  return ['U', 'T', 'A', 'G'];
}

function addVariable(usage: CandidateUsage, familyText: string, value: number): void {
  const family = familyText.toUpperCase() as CandidateVariableFamily;
  if (!(family in FAMILY_LIMITS)) return;
  if (!Number.isInteger(value) || value < 0 || value > FAMILY_LIMITS[family]) return;
  usage.variables[family].add(value);
}

function unusedRange(start: number, end: number, used: ReadonlySet<number>): number[] {
  const result: number[] = [];
  for (let value = start; value <= end; value++) {
    if (!used.has(value)) result.push(value);
  }
  return result;
}
