import {
  analyzeNestedVariables,
  isNestedVariableBaseOffset,
  NestedVariableAnalysis,
  NestedVariableAnalysisOptions,
} from './nested-variable-analysis';
import { isScriptCommentLine } from './script-labels';
import { findScriptVariables } from './variable-statistics';
import { EngineId } from '../types';

export type CandidateVariableFamily = 'U' | 'T' | 'A' | 'G';

export interface CandidateUsage {
  engine: EngineId;
  variables: Record<CandidateVariableFamily, Set<number>>;
  personalFlags: Set<number>;
  uncertainVariableFamilies: Set<CandidateVariableFamily>;
  personalFlagsUncertain: boolean;
}

export interface CandidateCollectionOptions extends NestedVariableAnalysisOptions {
  engine?: EngineId;
  nestedAnalysis?: NestedVariableAnalysis;
  excludedRanges?: readonly { start: number; end: number }[];
}

// GOM/GEE catalog: 程序变量说明[!].htm. 996PC expansion chapters disagree;
// only offer candidates in the common, documented range (not the larger preview range).
export function candidateVariableLimit(family: CandidateVariableFamily, engine: EngineId): number {
  return engine === '996PC' ? (family === 'U' || family === 'T' ? 254 : 499)
    : family === 'U' || family === 'T' ? 499 : 999;
}
export function personalFlagRangeForEngine(engine: EngineId): { min: number; max: number } {
  return engine === '996PC' ? { min: 0, max: 999 } : { min: 1, max: 1024 };
}

export function createCandidateUsage(engine: EngineId = 'GOM'): CandidateUsage {
  return {
    engine,
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
  const usage = createCandidateUsage(options.engine);
  const activeText = text.replace(/[^\r\n]*(?:\r\n|\r|\n|$)/g, chunk => {
    const line = chunk.replace(/[\r\n]+$/, '');
    const ending = chunk.slice(line.length);
    return `${isScriptCommentLine(line) ? ' '.repeat(line.length) : line}${ending}`;
  });

  const nested = options.nestedAnalysis || analyzeNestedVariables(text, {
    ...options, personalFlagRange: options.personalFlagRange || personalFlagRangeForEngine(usage.engine),
  });
  for (const reference of findScriptVariables(activeText)) {
    const match = /^([UTAG])(\d+)$/i.exec(reference.name);
    if (!match || isNestedVariableBaseOffset(reference.index, nested.references)) continue;
    if (options.excludedRanges?.some(range => range.start <= reference.index && reference.index < range.end)) {
      continue;
    }
    addVariable(usage, match[1], Number(match[2]));
  }

  for (const reference of nested.references) {
    if (options.excludedRanges?.some(range => range.start <= reference.start && reference.start < range.end)) continue;
    for (const variable of reference.variables) {
      const variableMatch = /^([UTAG])(\d+)$/i.exec(variable);
      if (variableMatch) addVariable(usage, variableMatch[1], Number(variableMatch[2]));
    }
    const familyMatch = /^([UTAG])\d*$/i.exec(reference.base);
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
      const range = personalFlagRangeForEngine(usage.engine);
      if (Number.isInteger(value) && value >= range.min && value <= range.max) {
        usage.personalFlags.add(value);
      }
    }
    if (reference.status !== 'resolved') usage.personalFlagsUncertain = true;
  }
  return usage;
}

export function mergeCandidateUsage(target: CandidateUsage, source: CandidateUsage): CandidateUsage {
  if (target.engine !== source.engine) throw new Error('不能合并不同引擎的变量候选范围');
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
  return unusedRange(0, candidateVariableLimit(family, usage.engine), usage.variables[family]);
}

export function unusedPersonalFlagCandidates(usage: CandidateUsage): number[] {
  const range = personalFlagRangeForEngine(usage.engine);
  return unusedRange(range.min, range.max, usage.personalFlags);
}

export function candidateVariableFamilies(): CandidateVariableFamily[] {
  return ['U', 'T', 'A', 'G'];
}

function addVariable(usage: CandidateUsage, familyText: string, value: number): void {
  const family = familyText.toUpperCase() as CandidateVariableFamily;
  if (!candidateVariableFamilies().includes(family)) return;
  if (!Number.isSafeInteger(value) || value < 0) return;
  usage.variables[family].add(value);
}

function unusedRange(start: number, end: number, used: ReadonlySet<number>): number[] {
  const result: number[] = [];
  for (let value = start; value <= end; value++) {
    if (!used.has(value)) result.push(value);
  }
  return result;
}
