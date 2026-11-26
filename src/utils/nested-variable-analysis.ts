import { findScriptVariables, normalizeScriptVariableName } from './variable-statistics';
import { isScriptCommentLine, scriptCodeBeforeComment } from './script-labels';
import { EngineId } from '../types';
import { maskDialogContainerIds } from './script-container-ids';
import { computeStaticNumericOperation, evaluateStaticFormula } from './script-static-arithmetic';
import { runtimePreviewOutputIndexes, runtimePreviewOutputFamilyIndexes, runtimePreviewImplicitOutputs } from '../ui-dialog/preview-command-outputs';

const MAX_INFERRED_VALUES = 512;
const MAX_PERSONAL_FLAG = 1024;
const truncatedValueSets = new WeakSet<ReadonlySet<string>>();
const VARIABLE_NAME = /^(?:[PDMNSIGAUTJZ]\d+|(?:GL|[NSLD])\$[\p{L}\p{N}_]+(?:·[\p{L}\p{N}_]+)*)$/iu;

export type NestedVariableResolutionStatus = 'resolved' | 'partial' | 'unresolved';

export interface NestedVariableReference {
  raw: string;
  base: string;
  expression: string;
  start: number;
  end: number;
  baseStart: number;
  baseEnd: number;
  line: number;
  depth: number;
}

export interface NestedVariableResolution extends NestedVariableReference {
  variables: string[];
  status: NestedVariableResolutionStatus;
  evidence: Array<'data-flow' | 'explicit-family'>;
  reasons?: string[];
  trace?: Array<{ line: number; description: string }>;
}

export interface PersonalFlagReference {
  raw: string;
  content: string;
  command: 'CHECK' | 'SET' | 'RESET' | 'FLAG';
  countExpression?: string;
  start: number;
  end: number;
  line: number;
}

export interface PersonalFlagResolution extends PersonalFlagReference {
  flags: string[];
  status: NestedVariableResolutionStatus;
  reasons?: string[];
  trace?: Array<{ line: number; description: string }>;
}

export interface NestedVariableAnalysis {
  references: NestedVariableResolution[];
  personalFlags: PersonalFlagResolution[];
  /** Bounded may-values observed at program points, not final runtime values or a completeness proof. */
  inferredValues: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface NestedConfigValueRequest {
  path: string;
  section: string;
  key: string;
}

export interface NestedConfigValueResult {
  values: readonly string[];
  complete: boolean;
}

export interface NestedTableDataRequest {
  path: string;
  format: 'excel' | 'csv';
}

export interface NestedTableDataResult {
  rows: readonly (readonly string[])[];
  complete: boolean;
}

export interface NestedListDataRequest {
  path: string;
}

export interface NestedListDataResult {
  lines: readonly string[];
  complete: boolean;
}

export interface NestedDatabaseFieldRequest {
  itemName: string;
  field: string;
}

export interface NestedDatabaseFieldResult {
  value: string;
  complete: boolean;
}

export interface NestedVariableAnalysisOptions {
  engine?: EngineId;
  /** Statistics/candidates use the active engine's flag bounds; legacy callers retain 1..1024. */
  personalFlagRange?: { min: number; max: number };
  /** Ctrl+F12 local initial values; never writes back to server persistence. */
  resolvePreviewGlobalValues?: () => Readonly<Record<string, string>>;
  /** Local equipment grouping from this server's database/configuration. */
  resolvePreviewEquipmentSlot?: (itemName: string) => { key: string; label: string } | undefined;
  /** Complete, bounded GEE database candidates for a case-sensitive substring. */
  resolvePreviewEquipmentMatches?: (pattern: string) => readonly string[] | undefined;
  resolveConfigValues?: (
    request: NestedConfigValueRequest,
  ) => NestedConfigValueResult | undefined;
  resolveTableData?: (
    request: NestedTableDataRequest,
  ) => NestedTableDataResult | undefined;
  /** Ctrl+F12 only: bounded BIFF8 read inside this source's real local Envir. */
  resolvePreviewExcelData?: (
    request: NestedTableDataRequest,
  ) => NestedTableDataResult | undefined;
  /** Ctrl+F12 only: bounded CSV snapshot inside this source's real local Envir. */
  resolvePreviewCsvData?: (
    request: NestedTableDataRequest,
  ) => NestedTableDataResult | undefined;
  resolveListData?: (
    request: NestedListDataRequest,
  ) => NestedListDataResult | undefined;
  resolveDatabaseField?: (
    request: NestedDatabaseFieldRequest,
  ) => NestedDatabaseFieldResult | undefined;
}

export interface ScriptValueExpressionRequest {
  expression: string;
  /** Zero-based source line used to select the active script label. */
  line: number;
}

export interface ScriptValueExpressionResolution {
  expression: string;
  line: number;
  values: string[];
  complete: boolean;
}

interface ValueResult {
  values: Set<string>;
  complete: boolean;
}

interface MoveConstraint {
  kind: 'move';
  target: string;
  expression: string;
  label: string;
}

interface FormulaConstraint {
  kind: 'formula';
  target: string;
  expression: string;
  label: string;
}

interface RangeConstraint {
  kind: 'range';
  target: string;
  minimum: number;
  maximum: number;
}

interface ValuesConstraint {
  kind: 'values';
  target: string;
  values: Set<string>;
  complete: boolean;
}

interface TableCellConstraint {
  kind: 'table-cell';
  target: string;
  path: string;
  rowExpression: string;
  columnExpression: string;
  label: string;
}

interface ListLineConstraint {
  kind: 'list-line';
  target: string;
  path: string;
  lineExpression: string;
  field?: number;
  label: string;
}

interface DynamicMoveConstraint {
  sourceLine?: number;
  targetBase: string;
  targetExpression: string;
  expression: string;
  label: string;
}

interface DynamicMoveResult {
  targets: string[];
  targetsComplete: boolean;
  value?: ValueResult;
}

interface ExtractConstraint {
  sourceLine?: number;
  kind: 'extract';
  delimiter: string;
  sourceExpression: string;
  targets: string[];
  label: string;
}

type AssignmentConstraint = (MoveConstraint | FormulaConstraint | RangeConstraint |
  ValuesConstraint | TableCellConstraint | ListLineConstraint) & { sourceLine?: number; label?: string };

interface EventParameter {
  values: Set<string>;
  complete: boolean;
  trace?: Array<{ line: number; description: string }>;
}

interface EventParameterSource {
  sourceLine?: number;
  targetLabel: string;
  callerLabel: string;
  arguments: string[];
  kind: 'call' | 'check';
}

interface ExcelReadConstraint {
  path: string;
  rowExpression: string;
  label: string;
}

interface TableContext {
  excelReads: ExcelReadConstraint[];
  csvAliases: Map<string, Set<string>>;
  resolveTableData?: NestedVariableAnalysisOptions['resolveTableData'];
  resolveListData?: NestedVariableAnalysisOptions['resolveListData'];
  dataCache: Map<string, NestedTableDataResult | undefined>;
  listCache: Map<string, NestedListDataResult | undefined>;
}

interface ParsedScript {
  engine?: EngineId;
  truncatedTargets: Set<string>;
  assignments: AssignmentConstraint[];
  dynamicMoves: DynamicMoveConstraint[];
  extracts: ExtractConstraint[];
  incompleteTargets: Set<string>;
  eventSources: EventParameterSource[];
  eventParameters: Map<string, Map<number, EventParameter>>;
  tables: TableContext;
  explicitVariables: ReadonlySet<string>;
}

export function extractNestedVariableReferences(text: string, engine: EngineId = 'GOM'): NestedVariableReference[] {
  const references: NestedVariableReference[] = [];
  const searchable = maskDialogContainerIds(text, engine);
  const starts = lineStarts(text);
  const startPattern = /((?:GL|[A-Za-z])(?:\$[\p{L}\p{N}_·]*|\d*))<\$STR\s*\(/giu;
  let match: RegExpExecArray | null;

  while ((match = startPattern.exec(searchable)) !== null) {
    if (match.index > 0 && isVariableCharacter(text[match.index - 1])) {
      startPattern.lastIndex = match.index + 1;
      continue;
    }

    const expressionStart = startPattern.lastIndex;
    const expressionEnd = findClosingParenthesis(text, expressionStart);
    if (expressionEnd < 0) {
      startPattern.lastIndex = match.index + 1;
      continue;
    }

    let close = expressionEnd + 1;
    while (/\s/.test(text[close] || '')) close++;
    if (text[close] !== '>') {
      startPattern.lastIndex = match.index + 1;
      continue;
    }

    const end = close + 1;
    const raw = text.slice(match.index, end);
    references.push({
      raw,
      base: match[1],
      expression: text.slice(expressionStart, expressionEnd).trim(),
      start: match.index,
      end,
      baseStart: match.index,
      baseEnd: match.index + match[1].length,
      line: lineAtOffset(starts, match.index),
      depth: placeholderDepth(raw),
    });

    // Continue inside the outer expression so multi-level references are retained.
    startPattern.lastIndex = match.index + 1;
  }

  return references;
}

export function extractPersonalFlagReferences(text: string): PersonalFlagReference[] {
  const references: PersonalFlagReference[] = [];
  const starts = lineStarts(text);
  const sayLines = new Set<number>();
  let say = false;
  for (const [line, content] of text.split(/\r\n|\r|\n/).entries()) {
    if (/^\s*\[@/.test(content)) say = false;
    const block = /^\s*#(ACT|ELSEACT|SAY|ELSESAY|IF|AND|OR)\b/i.exec(content);
    if (block) say = /^(SAY|ELSESAY)$/i.test(block[1]);
    if (say) sayLines.add(line);
  }
  for (const match of text.matchAll(/<\$FLAG\s*\(/gi)) {
    const start = match.index!, opening = start + match[0].length - 1;
    const line = lineAtOffset(starts, start);
    const close = findClosingParenthesis(text, opening + 1);
    if (close < 0 || close >= (starts[line + 1] ?? text.length) || text[close + 1] !== '>') continue;
    const content = text.slice(opening + 1, close).trim();
    if (content) references.push({ raw: text.slice(start, close + 2), content, command: 'FLAG', start, end: close + 2, line });
  }
  const commandPattern = /^[ \t]*(?:#(?:ACT|ELSEACT|IF|OR|AND)[ \t]+)?(?:NOT[ \t]+)?(?:<\$[^>\r\n]+>\.)?(CHECK|SET|RESET)[ \t]*\[/gim;
  let match: RegExpExecArray | null;

  while ((match = commandPattern.exec(text)) !== null) {
    const open = commandPattern.lastIndex - 1;
    const close = findBalancedClose(text, open, '[', ']');
    const line = lineAtOffset(starts, open);
    if (sayLines.has(line)) continue;
    const lineEnd = (starts[line + 1] ?? text.length + 1) - 1;
    if (close < 0 || (lineEnd >= 0 && close > lineEnd)) {
      commandPattern.lastIndex = open + 1;
      continue;
    }
    const command = match[1].toUpperCase() as PersonalFlagReference['command'];
    let countExpression: string | undefined;
    if (command === 'RESET') {
      const restEnd = lineEnd < 0 ? text.length : lineEnd;
      countExpression = splitArguments(text.slice(close + 1, restEnd).trim())[0];
      if (!countExpression) continue;
    }
    references.push({
      raw: text.slice(open, close + 1),
      content: text.slice(open + 1, close).trim(),
      command,
      countExpression,
      start: open,
      end: close + 1,
      line: lineAtOffset(starts, open),
    });
    commandPattern.lastIndex = close + 1;
  }

  return references.sort((left, right) => left.start - right.start);
}

export function isNestedVariableBaseOffset(
  offset: number,
  references: readonly NestedVariableReference[],
): boolean {
  return references.some(reference => offset >= reference.baseStart && offset < reference.baseEnd);
}

export function normalizeNestedVariableReference(reference: NestedVariableReference): string {
  let expression = reference.expression.trim();
  if (isVariableName(expression)) {
    expression = normalizeScriptVariableName(expression);
  } else {
    const nested = extractNestedVariableReferences(expression)
      .find(item => item.start === 0 && item.end === expression.length);
    if (nested) expression = normalizeNestedVariableReference(nested);
  }
  return `${normalizeScriptVariableName(reference.base)}<$STR(${expression})>`;
}

export function normalizePersonalFlagReference(reference: PersonalFlagReference): string {
  if (reference.command === 'FLAG') return reference.raw;
  const normalize = (value: string) => value
    .replace(/\$STR/gi, '$STR')
    .replace(/\$SCRIPTPARAM/gi, '$SCRIPTPARAM')
    .replace(/(?:GL|[NSLD])\$[\p{L}\p{N}_]+(?:·[\p{L}\p{N}_]+)*|[PDMNSIGAUTJZ]\d+/giu,
      name => normalizeScriptVariableName(name));
  const base = `[${normalize(reference.content)}]`;
  return reference.command === 'RESET' && reference.countExpression
    ? `${base} x ${normalize(reference.countExpression)}`
    : base;
}

export function analyzeNestedVariables(
  text: string,
  options: NestedVariableAnalysisOptions = {},
): NestedVariableAnalysis {
  const activeText = maskCommentLines(text);
  const references = extractNestedVariableReferences(activeText, options.engine);
  const personalFlagReferences = extractPersonalFlagReferences(activeText);
  const flagRange = options.personalFlagRange ?? (options.engine === '996PC' ? {min: 0, max: 999} : undefined);
  if (references.length === 0 && personalFlagReferences.length === 0) {
    return { references: [], personalFlags: [], inferredValues: new Map() };
  }

  const labelsByLine = collectLabelsByLine(activeText);
  const requiresDataFlow = references.length > 0 || personalFlagReferences.some(reference =>
    /<\$/i.test(reference.content) || isVariableName(reference.content) ||
    /<\$/i.test(reference.countExpression || '') ||
    isVariableName(reference.countExpression || ''),
  );
  if (!requiresDataFlow) {
    return {
      references: [],
      personalFlags: personalFlagReferences.map(reference => resolveStaticPersonalFlagReference(reference, flagRange)),
      inferredValues: new Map(),
    };
  }
  const parsed = parseScript(activeText, options, labelsByLine, references);
  const inferredValues = solveValues(parsed);
  solveCompleteness(parsed, inferredValues);
  const explicitVariables = collectConcreteVariables(activeText, references, options.engine);
  const flow = solveSourceFlow(activeText, parsed, inferredValues, references, personalFlagReferences);
  const resolved = references.map(reference => {
    const state = flow.get(reference.line) || emptyFlowState();
    return { ...resolveReference(reference, state.values, state.complete, parsed,
      explicitVariables, labelsByLine[reference.line] || ''), ...flowEvidence(reference.expression, state) };
  });
  const personalFlags = personalFlagReferences.map(reference => {
    const state = flow.get(reference.line) || emptyFlowState();
    return { ...resolvePersonalFlagReference(reference, state.values, state.complete, parsed,
      labelsByLine[reference.line] || '', flagRange),
    ...flowEvidence(reference.content + ' ' + (reference.countExpression || ''), state) };
  });

  const observedValues = new Map<string, Set<string>>();
  for (const state of flow.values()) for (const [name, values] of state.values) {
    if (isVariableName(name)) mergeValues(observedValues, name, values);
  }
  return { references: resolved, personalFlags, inferredValues: observedValues };
}

interface FlowState {
  values: Map<string, Set<string>>;
  complete: Map<string, boolean>;
  traces: Map<string, Array<{ line: number; description: string }>>;
  reasons: Map<string, string[]>;
}

function emptyFlowState(): FlowState {
  return { values: new Map(), complete: new Map(), traces: new Map(), reasons: new Map() };
}

function cloneFlowState(state: FlowState): FlowState {
  return { values: new Map(state.values), complete: new Map(state.complete),
    traces: new Map(state.traces), reasons: new Map(state.reasons) };
}

function expressionDependencies(expression: string): string[] {
  const names = new Set([...findScriptVariables(expression)].map(item => item.name));
  for (const match of expression.matchAll(/<\$GLOBAL\s*\(\s*EXCEL(\d+)\s*\)>/gi)) names.add(`__EXCEL${Number(match[1])}`);
  for (const match of expression.matchAll(/<\$([A-Za-z0-9_.\u3400-\u9fff]+)\s*\(/gi)) {
    if (!/^(STR|CSTR|GLOBAL)$/i.test(match[1])) names.add(`__CSV_${match[1].toUpperCase().replace(/\.ROW$/, '')}`);
  }
  return [...names];
}

interface LocalScriptCall { target: string; args: string[]; outputs: string[]; }

function localScriptCall(rest: string): LocalScriptCall | undefined {
  const match = /^@([^\s()<>]+)\s*\(/.exec(rest);
  if (!match) return undefined;
  const close = findClosingParenthesis(rest, match[0].length);
  if (close < 0 || rest.slice(close + 1).trim()) return undefined;
  const [inputs, outputs, extra] = splitTopLevel(rest.slice(match[0].length, close), '|');
  if (extra !== undefined) return undefined;
  return { target: match[1].toUpperCase(), args: inputs.trim() ? splitTopLevel(inputs, ',').map(s => s.trim()) : [],
    outputs: outputs?.trim() ? splitTopLevel(outputs, ',').map(s => s.trim()) : [] };
}

function flowEvidence(expression: string, state: FlowState): {
  reasons: string[]; trace: Array<{ line: number; description: string }>;
} {
  const names = expressionDependencies(expression);
  // Include the concrete inner slot selected by a simple dynamic suffix in the trace.
  for (const reference of extractNestedVariableReferences(expression)) {
    const suffix = isVariableName(reference.expression) ? state.values.get(normalizeScriptVariableName(reference.expression))
      : /^\d+$/.test(reference.expression) ? new Set([reference.expression]) : undefined;
    if (suffix) names.push(...constructVariableNames(reference.base, suffix));
  }
  const reasons = [...new Set(names.flatMap(name => state.reasons.get(name) || []))];
  const trace = new Map<string, { line: number; description: string }>();
  for (const name of names) for (const step of state.traces.get(name) || []) {
    trace.set(`${step.line}:${step.description}`, step);
  }
  return { reasons, trace: [...trace.values()].sort((a, b) => a.line - b.line).slice(-8) };
}

/** Bounded may-analysis. Strong updates are local to a program point, never a global INC recurrence. */
function solveSourceFlow(
  text: string,
  parsed: ParsedScript,
  legacyValues: ReadonlyMap<string, Set<string>>,
  references: readonly NestedVariableReference[],
  flags: readonly PersonalFlagReference[],
): Map<number, FlowState> {
  const lines = text.split(/\r\n|\r|\n/);
  const labelsByLine = collectLabelsByLine(text);
  const labels = new Map<string, number>();
  const duplicates = new Set<string>();
  const ends = new Map<number, number>();
  const roots = [0];
  let lastRoot = 0;
  for (let i = 0; i < lines.length; i++) {
    const label = /^\s*\[@([^\]]+)\]/.exec(lines[i]);
    if (!label) continue;
    if (i > lastRoot) ends.set(lastRoot, i);
    if (i !== 0) roots.push(i);
    lastRoot = i;
    const key = label[1].trim().toUpperCase();
    if (labels.has(key)) duplicates.add(key);
    labels.set(key, i);
  }
  ends.set(lastRoot, lines.length);
  const assignments = new Map<number, AssignmentConstraint[]>();
  const dynamicMoves = new Map<number, DynamicMoveConstraint[]>();
  const extracts = new Map<number, ExtractConstraint[]>();
  const writers = new Map<string, Set<string>>();
  for (const assignment of parsed.assignments) {
    if (assignment.sourceLine === undefined) continue;
    const group = assignments.get(assignment.sourceLine) || [];
    group.push(assignment); assignments.set(assignment.sourceLine, group);
    const names = writers.get(assignment.target) || new Set<string>();
    names.add(assignment.label || ''); writers.set(assignment.target, names);
  }
  for (const move of parsed.dynamicMoves) {
    if (move.sourceLine === undefined) continue;
    const group = dynamicMoves.get(move.sourceLine) || [];
    group.push(move); dynamicMoves.set(move.sourceLine, group);
  }
  for (const extract of parsed.extracts) {
    if (extract.sourceLine === undefined) continue;
    const group = extracts.get(extract.sourceLine) || [];
    group.push(extract); extracts.set(extract.sourceLine, group);
  }
  // Only values needed to name a dynamic reference (and their transitive inputs) get states.
  const relevant = new Set<string>();
  const indexedReads = new Set<string>();
  const aliases = new Map<string, NestedVariableReference>();
  const extractedTargets = new Set(parsed.extracts.flatMap(extract => extract.targets));
  const addDependencies = (expression: string) => {
    for (const name of expressionDependencies(expression)) relevant.add(name);
    for (const nested of extractNestedVariableReferences(expression)) {
      indexedReads.add(normalizeScriptVariableName(nested.base));
      const alias = '__ALIAS:' + normalizeNestedVariableReference(nested);
      if (extractedTargets.has(alias.slice('__ALIAS:'.length))) {
        aliases.set(alias, nested); relevant.add(alias);
      }
      for (const name of parsed.explicitVariables) if (name.startsWith(normalizeScriptVariableName(nested.base))) relevant.add(name);
    }
  };
  for (const reference of references) addDependencies(reference.expression);
  for (const flag of flags) addDependencies(flag.content + ' ' + (flag.countExpression || ''));
  for (const source of parsed.eventSources) for (const expression of source.arguments) addDependencies(expression);
  for (const line of lines) {
    const returns = /^\s*(?:#(?:ACT|ELSEACT)\s+)?RETURN\b(.*)$/i.exec(line);
    if (returns) addDependencies(returns[1]);
  }
  for (let round = 0; round < 32; round++) {
    const count = relevant.size;
    for (const assignment of parsed.assignments) if (relevant.has(assignment.target)) {
      if ('expression' in assignment) addDependencies(assignment.expression);
      if ('rowExpression' in assignment) addDependencies(assignment.rowExpression + ' ' + assignment.columnExpression);
      if ('lineExpression' in assignment) addDependencies(assignment.lineExpression);
    }
    for (const extract of parsed.extracts) {
      for (const target of extract.targets) {
        if (!target.includes('<$') || aliases.has('__ALIAS:' + target)) continue;
        const ref = extractNestedVariableReferences(target).find(item => item.raw === target);
        if (ref && (indexedReads.has(ref.base) || [...relevant].some(name => name.startsWith(ref.base) && name.length > ref.base.length))) {
          addDependencies(target);
        }
      }
      if (extract.targets.some(target => relevant.has(target) || aliases.has('__ALIAS:' + target))) {
        addDependencies(extract.sourceExpression);
      }
    }
    for (const move of parsed.dynamicMoves) if (indexedReads.has(normalizeScriptVariableName(move.targetBase)) ||
      [...relevant].some(name => name.startsWith(normalizeScriptVariableName(move.targetBase)))) {
      addDependencies(move.expression); addDependencies(move.targetExpression);
    }
    for (const line of lines) {
      const arithmetic = /^\s*(?:#(?:ACT|ELSEACT)\s+)?(?:INC|DEC|MUL|DIV)\s+([^\s]+)\s+(.*)$/i.exec(line);
      if (arithmetic && relevant.has(normalizeAssignmentTarget(arithmetic[1]) || '')) addDependencies(arithmetic[2]);
    }
    if ([...relevant].some(name => /^__EXCEL\d+$/.test(name))) {
      for (const read of parsed.tables.excelReads) addDependencies(read.rowExpression);
    }
    if (count === relevant.size) break;
  }
  const commands: Array<{ name: string; rest: string; action: boolean; condition: boolean; foreign: boolean }> = [];
  let action = true;
  let condition = false;
  for (const line of lines) {
    if (/^\s*\[@/.test(line)) { action = true; condition = false; }
    const directive = /^\s*#(ACT|ELSEACT|SAY|ELSESAY|IF|OR)\b\s*(.*)$/i.exec(line);
    if (directive) {
      action = /^(ACT|ELSEACT)$/i.test(directive[1]);
      condition = /^(IF|OR)$/i.test(directive[1]);
    }
    const content = directive ? directive[2] : line;
    const command = /^\s*(?:<\$[^>]+>\.)?([A-Za-z]+)\b\s*([\s\S]*)$/.exec(content);
    commands.push({ name: command?.[1].toUpperCase() || '', rest: command?.[2] || '',
      action: action && !isScriptCommentLine(line), condition: condition && !isScriptCommentLine(line),
      foreign: /^\s*<\$[^>]+>\./.test(content) });
  }
  const successors: number[][] = lines.map(() => []);
  const comparisons = new Map<number, {target: string; value: string; yes: number[]; no: number[]}>();
  const canExitWithoutNext = new Set<number>();
  for (const root of roots) {
    const end = ends.get(root) || lines.length;
    for (let i = root; i < end - 1; i++) successors[i] = [i + 1];
    for (let i = root; i < end; i++) {
      if (!/^\s*#IF\b/i.test(lines[i])) continue;
      let join = i + 1;
      while (join < end && !/^\s*#IF\b/i.test(lines[join])) join++;
      const sections: Array<{ line: number; positive: boolean }> = [];
      for (let cursor = i + 1; cursor < join; cursor++) {
        const section = /^\s*#(ACT|SAY|ELSEACT|ELSESAY)\b/i.exec(lines[cursor]);
        if (section) sections.push({ line: cursor, positive: !/^ELSE/i.test(section[1]) });
      }
      if (!sections.length) continue;
      // ACT/SAY belong to the true branch, ELSEACT/ELSESAY to the false branch,
      // regardless of their textual order. Same-branch sections may be separated
      // by opposite-branch sections; never execute those as a sequential write.
      const after = join < end ? [join] : [];
      const nextByBranch = new Map<boolean, number[]>([[true, after], [false, after]]);
      for (let section = sections.length - 1; section >= 0; section--) {
        const current = sections[section];
        const sectionEnd = sections[section + 1]?.line ?? join;
        successors[sectionEnd - 1] = nextByBranch.get(current.positive)!;
        nextByBranch.set(current.positive, [current.line]);
      }
      // Missing branches proceed to the next condition; terminal commands below
      // still override these normal edges, but only on their own branch.
      // An empty #IF is unconditional, so the false edge cannot skip its writes.
      const hasCondition = !!lines[i].replace(/^\s*#IF\b/i, '').trim()
        || lines.slice(i + 1, sections[0].line).some(line => line.trim().length > 0);
      if (hasCondition && !after.length && (!nextByBranch.get(false)!.length || !nextByBranch.get(true)!.length))
        canExitWithoutNext.add(sections[0].line - 1);
      successors[sections[0].line - 1] = hasCondition
        ? [...new Set([...nextByBranch.get(true)!, ...nextByBranch.get(false)!])]
        : nextByBranch.get(true)!;
      // Plain #IF conditions are conjunctive. A successful integer equality also
      // constrains later CHECKs inside the condition, before the first #ACT.
      if (/^\s*#IF\s*$/i.test(lines[i]) && !lines.slice(i + 1, sections[0].line).some(line => /^\s*#/.test(line))) {
        for (let pos = i + 1; pos < sections[0].line; pos++) {
          const equal = /^\s*EQUAL\s+(\S+)\s+([+-]?\d{1,16})\s*$/i.exec(lines[pos]);
          const target = equal && normalizeAssignmentTarget(equal[1]);
          if (!equal || !target || !/^(?:N\$|[PDMNIGUJ]\d+$)/i.test(target)) continue;
          const yes = pos + 1 < sections[0].line ? [pos + 1] : nextByBranch.get(true)!;
          const no = nextByBranch.get(false)!;
          comparisons.set(pos, {target, value: String(BigInt(equal[2])), yes, no});
          successors[pos] = [...new Set([...yes, ...no])];
        }
      }
    }
  }
  const gotoTargets = new Set<number>();
  const calls = new Map<number, LocalScriptCall>();
  const bareContinuations = new Map<number, number[]>();
  const leafHelpers = new Map<number, LocalScriptCall>();
  const simpleLabels = new Set([...labels].filter(([name, start]) => !duplicates.has(name) &&
    commands.slice(start, ends.get(start)).every(cmd => !cmd.action || !/^(?:GOTO|LOOPGOTO|RANDOMGOTO|GOTOLABEL|GOTOLABELEX|HCALL|BREAK|CLOSE|EXIT|MESSAGEBOX)$/.test(cmd.name)))
    .map(([name]) => name));
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    if (!command.action) continue;
    if (command.name === 'GOTO') {
      const call = localScriptCall(command.rest);
      if (call) { calls.set(i, call); continue; }
      const match = /^@([^\s()<>]+)\s*$/.exec(command.rest);
      const target = match ? labels.get(match[1].toUpperCase()) : undefined;
      if (target !== undefined) {
        // Existing GOM NPCs also invoke a bare helper and then continue producing
        // the dialog. Carry a conservative caller snapshot along that possible
        // continuation until the helper's complete effects are available.
        const continuation = parsed.engine === 'GOM' ? successors[i].filter(next => next !== target) : [];
        if (continuation.length) {
          bareContinuations.set(i, continuation);
          const name = match![1].toUpperCase();
          if (simpleLabels.has(name)) leafHelpers.set(i, {target: name, args: [], outputs: []});
        }
        successors[i] = [target, ...continuation]; gotoTargets.add(target);
      }
      else successors[i] = [];
    } else if (command.name === 'MESSAGEBOX' && parsed.engine === 'GOM') {
      // Confirmation runs the callback with the current player's script variables.
      for (const arg of splitArguments(command.rest).slice(1)) {
        const target = /^@[^@<>()\s]+$/.test(arg) ? labels.get(arg.slice(1).toUpperCase()) : undefined;
        if (target !== undefined) { successors[i].push(target); gotoTargets.add(target); }
      }
    } else if (/^(BREAK|CLOSE|EXIT|RETURN)$/.test(command.name)) successors[i] = [];
  }
  const trackedNames = (state: FlowState) => new Set([...relevant, ...state.values.keys()]);
  const write = (state: FlowState, target: string, result: ValueResult | undefined, line: number,
    expression: string, description: string, weak = false) => {
    // An address computed at runtime can be read again through a different
    // subscript without its concrete spelling ever occurring in the script.
    if (!relevant.has(target) && ![...indexedReads].some(base => target.length > base.length && target.startsWith(base))) return;
    for (const [key, alias] of aliases) {
      const sameFamily = target.startsWith(normalizeScriptVariableName(alias.base)) && target.length > alias.base.length;
      if (sameFamily || expressionDependencies(alias.expression).includes(target)) {
        state.values.delete(key); state.complete.delete(key); state.traces.delete(key); state.reasons.delete(key);
      }
    }
    if (!relevant.has(target) && !state.values.has(target) && state.values.size >= relevant.size + MAX_INFERRED_VALUES) return;
    const evidence = flowEvidence(expression, state);
    for (const match of expression.matchAll(/<\$SCRIPTPARAM(\d+)>/gi)) {
      const parameter = parsed.eventParameters.get(labelsByLine[line] || '')?.get(Number(match[1]));
      evidence.trace.push(...(parameter?.trace || []));
    }
    const next = result?.values || new Set<string>();
    const bounded = new Set([...next].slice(0, MAX_INFERRED_VALUES));
    const isComplete = result?.complete === true && next.size <= MAX_INFERRED_VALUES && !weak;
    if (weak) for (const value of state.values.get(target) || []) {
      if (bounded.size < MAX_INFERRED_VALUES) bounded.add(value);
    }
    state.values.set(target, bounded);
    state.complete.set(target, isComplete);
    const display = [...bounded].slice(0, 4).join(',');
    state.traces.set(target, [...evidence.trace, { line, description: `${description} → ${display || '未知'}${bounded.size > 4 ? '…' : ''}` }].slice(-8));
    state.reasons.set(target, isComplete ? [] : [...new Set([...evidence.reasons,
      !result ? '输入值或命令结果无法静态确定' : next.size > MAX_INFERRED_VALUES ? '可能值超过分析上限' : weak ? '存在可能覆盖或不完整的动态写入' : '输入值域不完整'])]);
  };
  const bindDynamicTarget = (base: string, index: string, label: string, snapshot: FlowState, written = snapshot) => {
    const suffix = evaluateStrInner(index, label, snapshot.values, snapshot.complete, parsed, 0);
    const names = new Set(constructVariableNames(base, suffix?.values || new Set()));
    const certain = suffix?.complete === true && names.size > 0 && names.size === suffix.values.size;
    if (!certain) {
      const prefix = normalizeScriptVariableName(base);
      for (const name of trackedNames(written)) {
        if (name.length > prefix.length && name.startsWith(prefix)) names.add(name);
      }
    }
    return {names, certain, base: normalizeScriptVariableName(base)};
  };
  const invalidateDynamicAliases = (state: FlowState, base: string) => {
    for (const [key, alias] of aliases) if (normalizeScriptVariableName(alias.base) === base) {
      state.values.delete(key); state.complete.delete(key); state.traces.delete(key); state.reasons.delete(key);
    }
  };
  const edgeState = (line: number, next: number, outgoing: FlowState): FlowState | undefined => {
    if (bareContinuations.get(line)?.includes(next)) {
      const helper = leafHelpers.get(line);
      const state = helper ? evaluateCall(helper, line, outgoing, [], {remaining: 1024}).state : cloneFlowState(outgoing);
      for (const target of trackedNames(state)) {
        state.complete.set(target,false);
        state.reasons.set(target, [helper ? '来自无返回参数的 GOTO 子标签可能继续执行的路径' : '无返回参数的 GOTO 子标签写入尚未完全确定']);
      }
      return state;
    }
    const test = comparisons.get(line);
    if (!test || !relevant.has(test.target)) return outgoing;
    const yes = test.yes.includes(next), no = test.no.includes(next);
    if (yes === no) return outgoing;
    const old = outgoing.values.get(test.target) || new Set<string>();
    // Only compare integer domains. Script coercion of strings is engine-specific.
    if ([...old].some(value => !/^[+-]?\d+$/.test(value))) return outgoing;
    const matches = (value: string) => String(BigInt(value)) === test.value;
    const complete = outgoing.complete.get(test.target) === true;
    const values = new Set(yes ? [test.value] : [...old].filter(value => !matches(value)));
    if (complete && (yes ? ![...old].some(matches) : !values.size)) return undefined;
    const state = cloneFlowState(outgoing);
    write(state, test.target, {values, complete: yes || complete}, line, test.target, yes ? 'EQUAL 成立' : 'EQUAL 不成立');
    return state;
  };
  const transfer = (line: number, incoming: FlowState, stack: readonly string[] = [], budget = {remaining: 1024}): FlowState => {
    const state = cloneFlowState(incoming);
    const command = commands[line];
    const label = labelsByLine[line] || '';
    if (!command.action && !command.condition) return state;
    if (command.foreign) {
      for (const target of trackedNames(state)) {
        state.complete.set(target, false);
        state.reasons.set(target, ['对象前缀的变量归属尚未建模']);
      }
      return state;
    }
    const call = calls.get(line);
    if (call) {
      const result = evaluateCall(call, line, incoming, stack, budget);
      const outgoing = result.state;
      const targets = call.outputs.map(raw => {
        const fixed = normalizeAssignmentTarget(raw);
        if (fixed) return {names: new Set([fixed]), certain: true, base: ''};
        const dynamic = extractNestedVariableReferences(raw).find(ref => ref.raw === raw);
        return dynamic && bindDynamicTarget(dynamic.base, dynamic.expression, label, incoming, outgoing);
      });
      const fixed = targets.flatMap(t => t?.certain && t.names.size === 1 ? [...t.names] : []);
      const valid = targets.every(Boolean) && new Set(fixed).size === fixed.length;
      for (const [index, target] of targets.entries()) {
        if (!target) continue;
        if (target.base && !target.certain) invalidateDynamicAliases(outgoing, target.base);
        for (const name of target.names) {
          const overlap = targets.some((other, i) => i !== index && other?.names.has(name));
          write(outgoing, name, valid ? result.values[index] : undefined, line, command.rest, 'GOTO/RETURN ' + name,
            !target.certain || target.names.size !== 1 || (valid && overlap));
        }
      }
      return outgoing;
    }
    for (const assignment of assignments.get(line) || []) {
      if (!relevant.has(assignment.target)) continue;
      write(state, assignment.target, evaluateAssignment(assignment, incoming.values, incoming.complete, parsed), line,
        'expression' in assignment ? assignment.expression : command.rest, `${command.name} ${assignment.target}`);
    }
    for (const move of dynamicMoves.get(line) || []) {
      const bound = bindDynamicTarget(move.targetBase, move.targetExpression, label, incoming);
      const value = evaluateTemplate(move.expression, label, incoming.values, incoming.complete, parsed);
      if (!bound.certain) invalidateDynamicAliases(state, bound.base);
      for (const target of bound.names) write(state, target, value, line,
        move.expression + ' ' + move.targetExpression, `MOV ${target}（动态目标）`, !bound.certain || bound.names.size !== 1);
    }
    for (const extract of extracts.get(line) || []) {
      const result = evaluateTemplate(extract.sourceExpression, label, incoming.values, incoming.complete, parsed);
      for (let index = 0; index < extract.targets.length; index++) {
        const target = extract.targets[index];
        const alias = aliases.get('__ALIAS:' + target);
        if (!alias && !relevant.has(target)) continue;
        const fields = new Set<string>();
        let valid = result?.complete === true;
        for (const value of result?.values || []) {
          const field = value.split(extract.delimiter)[index];
          if (field === undefined) valid = false; else fields.add(field.trim());
        }
        const value = result ? { values: fields, complete: valid } : undefined;
        if (alias) {
          const suffix = evaluateStrInner(alias.expression, label, incoming.values, incoming.complete, parsed, 0);
          const names = constructVariableNames(alias.base, suffix?.values || new Set());
          for (const name of names) write(state, name, value, line, extract.sourceExpression, 'EXTRACTSTRING ' + name,
            !suffix?.complete || names.length !== 1);
          for (const [key, other] of aliases) if (other.base === alias.base) {
            state.values.delete(key); state.complete.delete(key);
          }
          write(state, '__ALIAS:' + target, value, line, extract.sourceExpression, 'EXTRACTSTRING ' + target);
        } else write(state, target, value, line, extract.sourceExpression, 'EXTRACTSTRING ' + target);
      }
    }
    const parts = splitArguments(command.rest);
    if (command.action && command.name === 'CSVOPENCACHE') {
      const alias = tableAliasFromPath(parts[0] || '');
      write(state, `__CSV_${alias}`, parts[0] && !/<\$/.test(parts[0]) ? { values: new Set([parts[0]]), complete: true } : undefined,
        line, command.rest, `CSVOPENCACHE ${alias}`);
    } else if (command.action && command.name === 'READEXCEL') {
      for (const target of relevant) if (/^__EXCEL\d+$/.test(target)) {
        const column = target.slice('__EXCEL'.length);
        const result = parts.length >= 2 ? evaluateTableCell(parts[0], parts.slice(1).join(' '), column,
          'excel', 1, label, incoming.values, incoming.complete, parsed) : undefined;
        write(state, target, result, line, command.rest, `READEXCEL Excel${column}`);
      }
    } else if (command.action && /^(INC|DEC|MUL|DIV)$/.test(command.name)) {
      const target = normalizeAssignmentTarget(parts[0] || '');
      if (target) {
        const leftExpression = parts.length === 3 && /^(MUL|DIV)$/.test(command.name) ? parts[1] : target;
        const rightExpression = parts.length === 3 ? parts[2] : parts[1];
        const left = evaluateFlagExpression(leftExpression, label, incoming.values, incoming.complete, parsed);
        const right = rightExpression === undefined ? undefined : evaluateFlagExpression(rightExpression, label, incoming.values, incoming.complete, parsed);
        const values = new Set<string>();
        let complete = left?.complete === true && right?.complete === true;
        const numeric = /^(?:[PDMNIGUJ]\d+|N\$)/i.test(target);
        const validArity = /^(INC|DEC)$/.test(command.name) ? parts.length === 2
          : parsed.engine === 'GEE' ? parts.length === 2 || parts.length === 3 : parts.length === 3;
        for (const a of left?.values || []) for (const b of right?.values || []) {
          const value = numeric && validArity ? computeStaticNumericOperation(a, b, command.name as 'INC' | 'DEC' | 'MUL' | 'DIV', parsed.engine) : undefined;
          if (value === undefined || values.size >= MAX_INFERRED_VALUES) complete = false;
          else values.add(value);
        }
        write(state, target, values.size ? { values, complete } : undefined, line,
          leftExpression + ' ' + (rightExpression || ''), `${command.name} ${target} ${rightExpression || ''}`);
      } else {
        const dynamic = extractNestedVariableReferences(parts[0] || '')[0];
        if (dynamic) {
          const bound = bindDynamicTarget(dynamic.base, dynamic.expression, label, incoming);
          if (!bound.certain) invalidateDynamicAliases(state, bound.base);
          for (const possible of bound.names) write(state, possible, undefined, line,
            command.rest, `${command.name}（动态目标尚未求值）`, !bound.certain || bound.names.size !== 1);
        }
      }
    } else if (/^(READCONFIGFILEITEM|MOVR)$/.test(command.name) && !(assignments.get(line)?.length)) {
      const rawTarget = command.name === 'MOVR' ? parts[0] : parts[3];
      const target = normalizeAssignmentTarget(rawTarget || '');
      if (target) write(state, target, undefined, line, command.rest, `${command.name}（读取失败或未支持）`);
    } else if (command.name === 'TEXTLENGTH') {
      const target = normalizeAssignmentTarget(parts[parts.length - 1] || '');
      if (target) write(state, target, undefined, line, command.rest, `${command.name}（运行时输出）`);
    } else if (command.name === 'FORMULATION' && parsed.engine === '996PC' &&
        !assignments.get(line)?.length && parts.length >= 3 && /^[01]$/.test(parts[parts.length - 1])) {
      const target = normalizeAssignmentTarget(parts[parts.length - 2]);
      if (target) write(state, target, undefined, line, command.rest, 'FORMULATION（结果模式尚未建模）');
    }
    // Reuse the audited, pure output registry: condition commands can write too.
    const modeledTargets = new Set((assignments.get(line) || []).map(assignment => assignment.target));
    for (const index of runtimePreviewOutputIndexes(command.name, parsed.engine || 'GOM') || []) {
      const target = normalizeAssignmentTarget(parts[index] || '');
      if (target && !modeledTargets.has(target)) write(state, target, undefined, line, command.rest,
        `${command.name}（未建模的输出值）`);
      if (!target) {
        const dynamic = extractNestedVariableReferences(parts[index] || '')[0];
        if (dynamic) {
          const bound = bindDynamicTarget(dynamic.base, dynamic.expression, label, incoming);
          if (!bound.certain) invalidateDynamicAliases(state, bound.base);
          for (const possible of bound.names) write(state, possible, undefined, line, command.rest,
            `${command.name}（动态输出目标）`, !bound.certain || bound.names.size !== 1);
        }
      }
    }
    for (const target of runtimePreviewImplicitOutputs(command.name, parsed.engine || 'GOM') || []) {
      write(state, target, undefined, line, command.rest, `${command.name}（隐式输出）`);
    }
    for (const index of runtimePreviewOutputFamilyIndexes(command.name, parsed.engine || 'GOM') || []) {
      const prefix = normalizeAssignmentTarget(parts[index] || '');
      if (prefix) for (const target of trackedNames(state)) if (target.startsWith(prefix) && /^\d+$/.test(target.slice(prefix.length))) {
        write(state, target, undefined, line, command.rest, `${command.name}（输出变量族）`);
      }
    }
    const executable = lines[line].replace(/^\s*#(?:ACT|ELSEACT)\b\s*/i, '');
    if (/^\s*#CALL(?:EX)?\b/i.test(executable) ||
        (command.name === 'GOTO' && successors[line].length === 0) ||
        /^(LOOPGOTO|RANDOMGOTO|GOTOLABEL|GOTOLABELEX|HCALL)$/.test(command.name) ||
        (command.name === 'SUM' && parsed.engine === 'GEE') ||
        (command.name === 'MOV' && /^<\$CSTR\s*\(/i.test(parts[0] || ''))) {
      for (const target of trackedNames(state)) {
        state.complete.set(target, false);
        state.reasons.set(target, ['跨文件、隐式累加或其他对象的写入尚未建模']);
      }
    }
    return state;
  };
  // Independent callee frames keep different callers' input and return values apart.
  function evaluateCall(call: LocalScriptCall, line: number, caller: FlowState, stack: readonly string[], budget: {remaining: number}) {
    const start = labels.get(call.target), states = new Map<number, FlowState>();
    const queue: number[] = [], terminals: FlowState[] = [], returns: Array<Array<ValueResult | undefined>> = [];
    let incomplete = false;
    if (start === undefined || duplicates.has(call.target) || stack.includes(call.target) || stack.length >= 8 ||
        (parsed.engine === '996PC' && (call.args.length > 5 || call.outputs.length > 17))) {
      const state = cloneFlowState(caller);
      for (const target of trackedNames(state)) state.complete.set(target, false);
      return {state, values: [] as Array<ValueResult | undefined>};
    }
    const input = cloneFlowState(caller);
    input.values.set('__CALL_FRAME', new Set());
    for (const key of input.values.keys()) if (key.startsWith('__ARG:')) { input.values.delete(key); input.complete.delete(key); }
    call.args.forEach((arg, index) => {
      const value = evaluateTemplate(stripMatchingQuotes(arg), labelsByLine[line] || '', caller.values, caller.complete, parsed);
      input.values.set('__ARG:' + (index + 1), value?.values || new Set());
      input.complete.set('__ARG:' + (index + 1), value?.complete === true);
    });
    states.set(start, input); queue.push(start);
    const end = ends.get(start) || lines.length, nextStack = [...stack, call.target];
    for (let index = 0; index < queue.length; index++) {
      if (--budget.remaining < 0) { incomplete = true; break; }
      const position = queue[index], current = states.get(position)!;
      const cmd = commands[position];
      if (cmd.action && cmd.name === 'RETURN') {
        const operands = splitArguments(cmd.rest);
        terminals.push(current);
        if (operands.length !== call.outputs.length) incomplete = true;
        else returns.push(operands.map(value => evaluateTemplate(stripMatchingQuotes(value), call.target, current.values, current.complete, parsed)));
        continue;
      }
      const outgoing = transfer(position, current, nextStack, budget);
      if (canExitWithoutNext.has(position) || !successors[position].length) { incomplete = true; terminals.push(outgoing); }
      for (const next of successors[position]) {
        if (next < start || next >= end || next <= position) { incomplete = true; continue; }
        const edge = edgeState(position, next, outgoing);
        if (!edge) continue;
        const old = states.get(next), joined = old ? joinFlowStates(old, edge) : edge;
        if (!old || !sameFlowValues(old, joined)) { states.set(next, joined); queue.push(next); }
      }
    }
    const state = cloneFlowState(terminals.length ? terminals.reduce(joinFlowStates) : caller);
    for (const key of new Set([...state.values.keys(), ...caller.values.keys()])) if (key.startsWith('__ARG:') || key === '__CALL_FRAME') {
      state.values.delete(key); state.complete.delete(key);
      if (caller.values.has(key)) state.values.set(key, caller.values.get(key)!);
      if (caller.complete.has(key)) state.complete.set(key, caller.complete.get(key)!);
    }
    if (incomplete) for (const target of trackedNames(state)) state.complete.set(target, false);
    return {state, values: call.outputs.map((_, i) => {
      const result = mergeValueResults(returns.map(row => row[i]));
      return result && {values: result.values, complete: result.complete && !incomplete};
    })};
  }
  let finalStates = new Map<number, FlowState>();
  // A GOM NPC button starts a new action. Player variables visible when its
  // SAY was generated are possible inputs; other entries or later changes
  // prevent the click from proving any one value. Never copy a local call frame.
  const buttons = new Map<number, Array<{destination: number; variables: string[]}>>();
  if (parsed.engine === 'GOM') {
    const readers = new Map<string, Set<string>>();
    for (const ref of [...references, ...flags]) {
      const label = labelsByLine[ref.line];
      const names = readers.get(label) || new Set<string>();
      for (const name of expressionDependencies('expression' in ref ? ref.expression : ref.content + ' ' + (ref.countExpression || ''))) {
        if (/^[NS]\$/.test(name)) names.add(name);
      }
      readers.set(label, names);
    }
    for (const source of parsed.eventSources) {
      const line = source.sourceLine, destination = labels.get(source.targetLabel), names = readers.get(source.targetLabel);
      if (source.kind !== 'call' || line === undefined || destination === undefined || !names?.size ||
          commands[line].action || commands[line].condition || duplicates.has(source.targetLabel)) continue;
      const events = buttons.get(line) || [];
      events.push({destination, variables: [...names]}); buttons.set(line, events);
    }
  }
  const visitLimit = aliases.size && parsed.assignments.some(assignment => assignment.kind === 'list-line') ? 96 : 32;
  // UI parameters use their caller's SAY snapshot, not a global final value pool.
  for (let parameterRound = 0; parameterRound < 8; parameterRound++) {
    const states = new Map<number, FlowState>();
    const queue: number[] = [];
    const queued = new Set<number>();
    const visits = new Map<number, number>();
    const enqueue = (line: number, state: FlowState) => {
      const old = states.get(line);
      const joined = old ? joinFlowStates(old, state) : state;
      if (old && sameFlowValues(old, joined)) return;
      states.set(line, joined);
      if (!queued.has(line)) { queue.push(line); queued.add(line); }
    };
    for (const root of roots) {
      const rootLabel = labelsByLine[root] || '';
      const hasUiEntry = parsed.eventSources.some(source => source.kind === 'call' && source.targetLabel === rootLabel);
      if (gotoTargets.has(root) && root !== 0 && !hasUiEntry) continue;
      const seed = emptyFlowState();
      const label = labelsByLine[root] || '';
      for (const target of relevant) {
        if (/^__EXCEL\d+$/.test(target)) {
          seed.values.set(target, new Set()); seed.complete.set(target, false);
          seed.reasons.set(target, ['该程序点尚未读取 Excel 列']);
          continue;
        }
        if (target.startsWith('__CSV_')) {
          const alias = target.slice('__CSV_'.length);
          const historical = commands.some((command, line) => command.action && command.name === 'CSVOPENCACHE' &&
            labelsByLine[line] !== label && tableAliasFromPath(splitArguments(command.rest)[0] || '') === alias);
          seed.values.set(target, historical ? new Set(parsed.tables.csvAliases.get(alias) || []) : new Set());
          seed.complete.set(target, false);
          seed.reasons.set(target, ['CSV 缓存尚未在当前入口确定加载']);
          continue;
        }
        const otherWriter = [...(writers.get(target) || [])].some(writer => writer !== label);
        if (!otherWriter || !legacyValues.has(target)) continue;
        seed.values.set(target, legacyValues.get(target)!);
        seed.complete.set(target, false);
        seed.reasons.set(target, ['其他入口存在历史写入，运行时初值未确定']);
      }
      enqueue(root, seed);
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const line = queue[cursor]; queued.delete(line);
      const count = (visits.get(line) || 0) + 1; visits.set(line, count);
      const incoming = states.get(line)!;
      // Allow a modest finite table walk to propagate through branch joins before widening.
      if (count > visitLimit) {
        const widened = cloneFlowState(incoming);
        for (const target of trackedNames(widened)) {
          widened.complete.set(target, false);
          widened.reasons.set(target, ['循环或控制流达到分析上限']);
        }
        states.set(line, widened);
        // An incomplete state must reach every dependent reference, even after stopping iteration.
        const pending = [...successors[line]]; const seen = new Set<number>();
        while (pending.length) {
          const next = pending.pop()!;
          if (seen.has(next)) continue; seen.add(next);
          const old = states.get(next);
          states.set(next, old ? joinFlowStates(old, widened) : widened);
          pending.push(...successors[next]);
        }
        continue;
      }
      const outgoing = transfer(line, incoming);
      for (const button of buttons.get(line) || []) {
        const clicked = emptyFlowState();
        for (const name of button.variables) {
          const values = incoming.values.get(name);
          if (!values?.size) continue;
          clicked.values.set(name, values);
          clicked.complete.set(name, false);
          clicked.traces.set(name, [...(incoming.traces.get(name) || []), {line, description: 'NPC 点击时可能沿用 ' + name}].slice(-8));
          clicked.reasons.set(name, ['按钮显示与玩家点击之间的变量值可能变化']);
        }
        if (clicked.values.size) enqueue(button.destination, clicked);
      }
      for (const next of successors[line]) {
        const edge = edgeState(line, next, outgoing);
        if (edge) enqueue(next, edge);
      }
    }
    finalStates = states;
    if (!updateSourceParameters(parsed, states)) break;
    if (parameterRound === 7) {
      for (const byIndex of parsed.eventParameters.values()) for (const parameter of byIndex.values()) parameter.complete = false;
      for (const state of states.values()) for (const target of trackedNames(state)) state.complete.set(target, false);
    }
  }
  return finalStates;
}

function joinFlowStates(left: FlowState, right: FlowState): FlowState {
  const result = cloneFlowState(left);
  for (const name of new Set([...left.values.keys(), ...right.values.keys(), ...left.complete.keys(), ...right.complete.keys()])) {
    const all = new Set([...(left.values.get(name) || []), ...(right.values.get(name) || [])]);
    result.values.set(name, new Set([...all].slice(0, MAX_INFERRED_VALUES)));
    const complete = left.complete.get(name) === true && right.complete.get(name) === true && all.size <= MAX_INFERRED_VALUES;
    result.complete.set(name, complete);
    result.reasons.set(name, complete ? [] : [...new Set([...(left.reasons.get(name) || []), ...(right.reasons.get(name) || []),
      all.size > MAX_INFERRED_VALUES ? '分支可能值超过分析上限' : '部分路径的输入值未确定'])]);
    const traces = new Map<string, { line: number; description: string }>();
    for (const step of [...(left.traces.get(name) || []), ...(right.traces.get(name) || [])]) traces.set(`${step.line}:${step.description}`, step);
    result.traces.set(name, [...traces.values()].sort((a, b) => a.line - b.line).slice(-8));
  }
  return result;
}

function sameFlowValues(left: FlowState, right: FlowState): boolean {
  if (left.values.size !== right.values.size || left.complete.size !== right.complete.size) return false;
  for (const [name, values] of left.values) if (!setEquals(values, right.values.get(name) || new Set())) return false;
  for (const [name, complete] of left.complete) if (right.complete.get(name) !== complete) return false;
  return true;
}

function updateSourceParameters(parsed: ParsedScript, states: ReadonlyMap<number, FlowState>): boolean {
  let changed = false;
  for (const [label, byIndex] of parsed.eventParameters) {
    const sources = selectEventSources(parsed.eventSources, label);
    for (const [index, parameter] of byIndex) {
      const values = new Set<string>();
      const trace = new Map<string, { line: number; description: string }>();
      let complete = sources.length > 0;
      for (const source of sources) {
        const state = source.sourceLine === undefined ? undefined : states.get(source.sourceLine);
        const expression = source.arguments[index - 1];
        // A literal in an explicit UI call remains a possible input when control flow
        // has no caller snapshot (for example, SAY after an unmodeled bare GOTO).
        // Runtime-dependent operands must never be recovered from another caller.
        const result = state && expression ? evaluateTemplate(expression, source.callerLabel, state.values, state.complete, parsed)
          : expression && source.kind === 'call' && !expression.includes('<$')
            ? {values: new Set([expression]), complete: false} : undefined;
        if (!result) { complete = false; continue; }
        complete = complete && result.complete;
        if (state) for (const step of flowEvidence(expression, state).trace) trace.set(`${step.line}:${step.description}`, step);
        const step = { line: source.sourceLine || 0, description: `NPC参数${index} ← ${[...result.values].slice(0, 4).join(',')}` };
        trace.set(`${step.line}:${step.description}`, step);
        for (const value of result.values) {
          if (!values.has(value) && values.size >= MAX_INFERRED_VALUES) complete = false;
          else values.add(stripMatchingQuotes(value.trim()));
        }
      }
      if (!setEquals(values, parameter.values) || parameter.complete !== complete) changed = true;
      parameter.values = values; parameter.complete = complete; parameter.trace = [...trace.values()].slice(-8);
    }
  }
  return changed;
}

/**
 * Resolves arbitrary script expressions with the same data-flow engine used by
 * nested-variable analysis. Unknown runtime values are returned as incomplete
 * instead of being guessed.
 */
export function resolveScriptValueExpressions(
  text: string,
  requests: readonly ScriptValueExpressionRequest[],
  options: NestedVariableAnalysisOptions = {},
): ScriptValueExpressionResolution[] {
  if (requests.length === 0) return [];
  const activeText = maskCommentLines(text);
  const labelsByLine = collectLabelsByLine(activeText);
  const references = extractNestedVariableReferences(activeText, options.engine);
  const parsed = parseScript(activeText, options, labelsByLine, references);
  const inferredValues = solveValues(parsed);
  solveCompleteness(parsed, inferredValues);
  const requestedReferences = requests.map(request => ({ raw: request.expression, base: 'N', expression: request.expression,
    start: 0, end: 0, baseStart: 0, baseEnd: 0, line: request.line, depth: 0 }));
  const flow = solveSourceFlow(activeText, parsed, inferredValues, [...references, ...requestedReferences], []);

  return requests.map(request => {
    const expression = request.expression.trim();
    const label = labelsByLine[Math.max(0, request.line)] || '';
    const state = flow.get(request.line) || emptyFlowState();
    let result: ValueResult | undefined;
    if (isVariableName(expression)) {
      result = evaluateStrInner(
        expression,
        label,
        state.values,
        state.complete,
        parsed,
        0,
      );
    } else {
      result = evaluateTemplate(
        expression,
        label,
        state.values,
        state.complete,
        parsed,
      );
    }
    return {
      expression: request.expression,
      line: request.line,
      values: result
        ? [...result.values].sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }))
        : [],
      complete: result?.complete === true,
    };
  });
}

function parseScript(
  text: string,
  options: NestedVariableAnalysisOptions,
  labelsByLine: readonly string[],
  nestedReferences: readonly NestedVariableReference[],
): ParsedScript {
  const assignments: AssignmentConstraint[] = [];
  const dynamicMoves: DynamicMoveConstraint[] = [];
  const extracts: ExtractConstraint[] = [];
  const incompleteTargets = new Set<string>();
  const eventSources = collectEventCallSources(text, labelsByLine);
  const eventParameters = new Map<string, Map<number, EventParameter>>();
  const tables: TableContext = {
    excelReads: [],
    csvAliases: new Map(),
    resolveTableData: options.resolveTableData,
    resolveListData: options.resolveListData,
    dataCache: new Map(),
    listCache: new Map(),
  };
  let currentLabel = '';
  let actionContext = true;

  for (const [sourceLine, rawLine] of text.split(/\r\n|\r|\n/).entries()) {
    let line = rawLine;
    const firstAssignment = assignments.length;
    const firstMove = dynamicMoves.length;
    const firstExtract = extracts.length;
    try {
    if (isScriptCommentLine(line)) continue;
    const label = /^\s*\[@([^\]]+)\]/.exec(line);
    if (label) {
      currentLabel = label[1].trim().toUpperCase();
      actionContext = true;
      continue;
    }
    const directive = /^\s*#(ACT|ELSEACT|SAY|ELSESAY|IF|OR)\b\s*(.*)$/i.exec(line);
    if (directive) {
      actionContext = /^(ACT|ELSEACT)$/i.test(directive[1]);
      if (!directive[2]) continue;
      line = directive[2];
    }

    const command = /^\s*(?:<\$[^>]+>\.)?([A-Za-z]+)\b([\s\S]*)$/i.exec(line);
    if (!command) continue;
    const name = command[1].toUpperCase();
    const rest = command[2].trim();

    if (name === 'CHECKSCRIPTPARAM' && currentLabel) {
      eventSources.push({
        targetLabel: currentLabel,
        callerLabel: currentLabel,
        arguments: splitTopLevel(rest, ','),
        kind: 'check',
        sourceLine,
      });
      continue;
    }
    if (!actionContext) continue;

    if (name === 'GOTO') {
      const call = localScriptCall(rest);
      if (call) eventSources.push({targetLabel: call.target, callerLabel: currentLabel,
        arguments: call.args, sourceLine, kind: 'call'});
    }
    if (name === 'MOV') {
      const move = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest);
      if (move) {
        const target = normalizeAssignmentTarget(move[1]);
        if (target) {
          assignments.push({
            kind: 'move',
            target,
            expression: (move[2] || '').trim(),
            label: currentLabel,
          });
        } else {
          const dynamicTarget = extractNestedVariableReferences(move[1])
            .find(reference => reference.start === 0 && reference.end === move[1].length);
          if (dynamicTarget) {
            dynamicMoves.push({
              targetBase: dynamicTarget.base,
              targetExpression: dynamicTarget.expression,
              expression: (move[2] || '').trim(),
              label: currentLabel,
            });
          }
        }
      }
      continue;
    }

    if (name === 'MOVR') {
      const parts = splitArguments(rest);
      const target = normalizeAssignmentTarget(parts[0] || '');
      if ((options.engine || 'GOM') === 'GOM' && target && (parts.length === 2 || parts.length === 3)
          && parts.slice(1).every(part => /^[+-]?\d{1,19}$/.test(part))) {
        const first = BigInt(parts[1]), second = parts[2] === undefined ? undefined : BigInt(parts[2]);
        const twoBounds = second !== undefined && second > 0n && second > first;
        const lower = twoBounds ? first : 0n;
        const upper = twoBounds ? second! : first > 0n ? first : 0n;
        const distance = upper - lower;
        // Large ranges include the upper endpoint but exceed the finite set budget.
        if (first >= -(1n << 63n) && first < (1n << 63n) && upper < (1n << 63n)
            && distance >= 0n && distance <= BigInt(MAX_INFERRED_VALUES)) {
          const values = new Set<string>();
          for (let value = lower; value < upper; value++) values.add(String(value));
          if (!values.size) values.add('0');
          assignments.push({kind: 'values', target, values, complete: true});
        } else incompleteTargets.add(target);
      } else if ((options.engine || 'GOM') !== 'GOM' && parts.length >= 3 && target) {
        const minimum = Number(parts[1]);
        const maximum = Number(parts[2]);
        if (Number.isInteger(minimum) && Number.isInteger(maximum) &&
            maximum >= minimum && maximum - minimum < MAX_INFERRED_VALUES) {
          assignments.push({
            kind: 'range',
            target,
            minimum,
            maximum,
          });
        } else {
          incompleteTargets.add(target);
        }
      }
      continue;
    }

    if (name === 'FORMULATION') {
      const parts = splitArguments(rest);
      const rawTarget = parts[parts.length - 1];
      const target = normalizeAssignmentTarget(rawTarget || '');
      if (parts.length >= 2 && target) {
        assignments.push({
          kind: 'formula',
          target,
          expression: rest.slice(0, rest.lastIndexOf(rawTarget)).trim(),
          label: currentLabel,
        });
      }
      continue;
    }

    if (name === 'EXTRACTSTRING') {
      const parts = splitArguments(rest);
      if (parts.length >= 3) {
        // Unsupported/discarded output operands still consume their original column.
        const targets = parts.slice(2).map(operand => {
          const direct = normalizeAssignmentTarget(operand);
          if (direct) return direct;
          const nested = extractNestedVariableReferences(operand).find(ref => ref.raw === operand);
          return nested ? normalizeNestedVariableReference(nested) : '';
        });
        if (targets.length > 0) {
          extracts.push({
            kind: 'extract',
            delimiter: parts[0],
            sourceExpression: parts[1],
            targets,
            label: currentLabel,
          });
        }
      }
      continue;
    }

    if (name === 'READCONFIGFILEITEM') {
      const parts = splitArguments(rest);
      if ((options.engine || 'GOM') === 'GOM' && parts.length === 5 && /^FAST$/i.test(parts[4])) parts.pop();
      const target = normalizeAssignmentTarget(parts[parts.length - 1] || '');
      if (parts.length >= 4 && target && options.resolveConfigValues) {
        const result = options.resolveConfigValues({
          path: parts[0],
          section: parts[1],
          key: parts.slice(2, -1).join(' '),
        });
        if (result && result.values.length > 0) {
          assignments.push({
            kind: 'values',
            target,
            values: new Set(result.values.slice(0, MAX_INFERRED_VALUES)),
            complete: result.complete && result.values.length <= MAX_INFERRED_VALUES,
          });
        } else incompleteTargets.add(target);
      } else if (target) {
        incompleteTargets.add(target);
      }
      continue;
    }

    if (name === 'READEXCEL') {
      const parts = splitArguments(rest);
      if (parts.length >= 2) {
        tables.excelReads.push({
          path: parts[0],
          rowExpression: parts.slice(1).join(' '),
          label: currentLabel,
        });
      }
      continue;
    }

    if (name === 'CSVOPENCACHE') {
      const tablePath = splitArguments(rest)[0];
      if (tablePath) {
        const alias = tableAliasFromPath(tablePath);
        const paths = tables.csvAliases.get(alias) || new Set<string>();
        paths.add(tablePath);
        tables.csvAliases.set(alias, paths);
      }
      continue;
    }

    if (name === 'CSVGETCELLTEXT') {
      const parts = splitArguments(rest);
      const target = normalizeAssignmentTarget(parts[parts.length - 1] || '');
      if (parts.length >= 4 && target) {
        assignments.push({
          kind: 'table-cell',
          target,
          path: parts[0],
          rowExpression: parts[1],
          columnExpression: parts.slice(2, -1).join(' '),
          label: currentLabel,
        });
      }
      continue;
    }

    if (name === 'GETLISTSTRING') {
      const parts = splitArguments(rest);
      const targets = parts.slice(2)
        .map(normalizeAssignmentTarget)
        .filter((target): target is string => target !== undefined);
      if (parts.length >= 3 && targets.length > 0) {
        for (let index = 0; index < targets.length; index++) {
          assignments.push({
            kind: 'list-line',
            target: targets[index],
            path: parts[0],
            lineExpression: parts[1],
            field: targets.length > 1 ? index : undefined,
            label: currentLabel,
          });
        }
      }
      continue;
    }

    if (name === 'INC' || name === 'DEC' || name === 'MUL' || name === 'DIV') {
      const target = normalizeAssignmentTarget(splitArguments(rest)[0] || '');
      if (target) incompleteTargets.add(target);
    }
    } finally {
      for (const assignment of assignments.slice(firstAssignment)) {
        assignment.sourceLine = sourceLine;
        assignment.label = currentLabel;
      }
      for (const move of dynamicMoves.slice(firstMove)) move.sourceLine = sourceLine;
      for (const extract of extracts.slice(firstExtract)) extract.sourceLine = sourceLine;
    }
  }

  addExtractFieldAssignments(assignments, extracts);
  initializeEventParameters(eventSources, eventParameters);
  return {
    engine: options.engine || 'GOM',
    truncatedTargets: new Set(),
    assignments,
    dynamicMoves,
    extracts,
    incompleteTargets,
    eventSources,
    eventParameters,
    tables,
    explicitVariables: collectConcreteVariables(text, nestedReferences, options.engine),
  };
}

function addExtractFieldAssignments(
  assignments: AssignmentConstraint[],
  extracts: readonly ExtractConstraint[],
): void {
  const moves = assignments.filter((item): item is MoveConstraint => item.kind === 'move');
  const derived: MoveConstraint[] = [];

  for (const extract of extracts) {
    const source = unwrapDirectStrVariable(extract.sourceExpression);
    if (!source) continue;
    for (const move of moves) {
      if (move.target !== source) continue;
      const fields = splitByDelimiter(move.expression, extract.delimiter);
      if (fields.length < extract.targets.length) continue;
      for (let index = 0; index < extract.targets.length; index++) {
        derived.push({
          kind: 'move',
          target: extract.targets[index],
          expression: fields[index].trim(),
          label: move.label,
        });
      }
    }
  }

  assignments.push(...derived);
}

function solveValues(parsed: ParsedScript): Map<string, Set<string>> {
  const values = new Map<string, Set<string>>();
  const completeness = new Map<string, boolean>();

  for (let iteration = 0; iteration < 64; iteration++) {
    let changed = updateEventParameters(parsed, values, completeness);
    for (const assignment of parsed.assignments) {
      const result = evaluateAssignment(
        assignment,
        values,
        completeness,
        parsed,
      );
      if (result) changed = mergeParsedValues(parsed, values, assignment.target, result.values) || changed;
    }
    for (const dynamicMove of parsed.dynamicMoves) {
      const result = evaluateDynamicMove(dynamicMove, values, completeness, parsed);
      if (!result.value) continue;
      for (const target of result.targets) {
        changed = mergeParsedValues(parsed, values, target, result.value.values) || changed;
      }
    }
    for (const extract of parsed.extracts) {
      const source = evaluateTemplate(
        extract.sourceExpression,
        extract.label,
        values,
        completeness,
        parsed,
      );
      if (!source) continue;
      for (const value of source.values) {
        const fields = value.split(extract.delimiter);
        for (let index = 0; index < extract.targets.length && index < fields.length; index++) {
          changed = mergeParsedValues(parsed, values, extract.targets[index], new Set([fields[index]])) || changed;
        }
      }
    }
    if (!changed) break;
  }

  return values;
}

function solveCompleteness(
  parsed: ParsedScript,
  values: ReadonlyMap<string, Set<string>>,
): Map<string, boolean> {
  const complete = new Map<string, boolean>();
  const byTarget = new Map<string, AssignmentConstraint[]>();
  for (const assignment of parsed.assignments) {
    const current = byTarget.get(assignment.target) || [];
    current.push(assignment);
    byTarget.set(assignment.target, current);
  }

  for (let iteration = 0; iteration < 64; iteration++) {
    let changed = updateEventParameters(parsed, values, complete);
    for (const [target, assignments] of byTarget) {
      if (complete.get(target) || parsed.incompleteTargets.has(target) || parsed.truncatedTargets.has(target)) continue;
      const results = assignments.map(assignment => evaluateAssignment(
        assignment,
        values,
        complete,
        parsed,
      ));
      if (results.length > 0 && results.every(result => result?.complete)) {
        complete.set(target, true);
        changed = true;
      }
    }
    for (const dynamicMove of parsed.dynamicMoves) {
      const result = evaluateDynamicMove(dynamicMove, values, complete, parsed);
      if (!result.value?.complete || !result.targetsComplete) continue;
      for (const target of result.targets) {
        if (!complete.get(target) && !parsed.incompleteTargets.has(target) && !parsed.truncatedTargets.has(target)) {
          complete.set(target, true);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return complete;
}

function evaluateAssignment(
  assignment: AssignmentConstraint,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
): ValueResult | undefined {
  if (assignment.kind === 'values') {
    return { values: new Set(assignment.values), complete: assignment.complete };
  }
  if (assignment.kind === 'range') {
    const range = new Set<string>();
    for (let value = assignment.minimum; value <= assignment.maximum; value++) {
      range.add(String(value));
    }
    return { values: range, complete: true };
  }
  if (assignment.kind === 'table-cell') {
    return evaluateTableCell(
      assignment.path,
      assignment.rowExpression,
      assignment.columnExpression,
      'csv',
      0,
      assignment.label,
      values,
      complete,
      parsed,
    );
  }
  if (assignment.kind === 'list-line') {
    return evaluateListLine(
      assignment,
      values,
      complete,
      parsed,
    );
  }

  // The independently documented FORMULATION outputs are numeric N registers/N$ names.
  // Do not coerce string/list/dictionary variables into numeric result registers.
  if (assignment.kind === 'formula' && !/^N(?:\d|\$)/i.test(assignment.target)) return undefined;

  const evaluated = evaluateTemplate(
    assignment.expression,
    assignment.label,
    values,
    complete,
    parsed,
  );
  if (!evaluated || assignment.kind === 'move') return evaluated;

  const formulaValues = new Set<string>();
  for (const expression of evaluated.values) {
    const result = evaluateStaticFormula(expression, parsed.engine);
    if (result === undefined) return undefined;
    formulaValues.add(result);
  }
  return { values: formulaValues, complete: evaluated.complete };
}

function evaluateDynamicMove(
  move: DynamicMoveConstraint,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
): DynamicMoveResult {
  const suffix = evaluateStrInner(
    move.targetExpression,
    move.label,
    values,
    complete,
    parsed,
    0,
  );
  const fromDataFlow = suffix ? constructVariableNames(move.targetBase, suffix.values) : [];
  const family = suffix?.complete && fromDataFlow.length > 0
    ? []
    : findExplicitFamily(move.targetBase, move.targetExpression, parsed.explicitVariables);
  return {
    targets: sortVariableNames([...fromDataFlow, ...family]),
    targetsComplete: suffix?.complete === true && fromDataFlow.length > 0 && family.length === 0,
    value: evaluateTemplate(move.expression, move.label, values, complete, parsed),
  };
}

function evaluateTemplate(
  expression: string,
  label: string,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
  recursionDepth = 0,
): ValueResult | undefined {
  if (recursionDepth > 8) return undefined;
  let combinations = new Set<string>(['']);
  let allComplete = true;
  let offset = 0;

  while (offset < expression.length) {
    const placeholder = expression.toUpperCase().indexOf('<$', offset);
    if (placeholder < 0) {
      combinations = appendLiteral(combinations, expression.slice(offset));
      break;
    }
    combinations = appendLiteral(combinations, expression.slice(offset, placeholder));

    const scriptParameter = /^<\$SCRIPTPARAM(?:\((\d+)\)|(\d+))>/i.exec(expression.slice(placeholder));
    if (scriptParameter) {
      const index = Number(scriptParameter[1] || scriptParameter[2]);
      const key = '__ARG:' + index;
      const parameter = values.has('__CALL_FRAME') ? { values: values.get(key) || new Set<string>(), complete: complete.get(key) === true }
        : parsed.eventParameters.get(label)?.get(index);
      if (!parameter || parameter.values.size === 0) return undefined;
      combinations = combineValues(combinations, parameter.values);
      allComplete = allComplete && parameter.complete;
      offset = placeholder + scriptParameter[0].length;
      continue;
    }

    const strStart = /^<\$STR\s*\(/i.exec(expression.slice(placeholder));
    if (strStart) {
      const innerStart = placeholder + strStart[0].length;
      const innerEnd = findClosingParenthesis(expression, innerStart);
      if (innerEnd < 0) return undefined;
      let close = innerEnd + 1;
      while (/\s/.test(expression[close] || '')) close++;
      if (expression[close] !== '>') return undefined;
      const inner = expression.slice(innerStart, innerEnd).trim();
      const innerResult = evaluateStrInner(
        inner,
        label,
        values,
        complete,
        parsed,
        recursionDepth + 1,
      );
      if (!innerResult || innerResult.values.size === 0) return undefined;
      combinations = combineValues(combinations, innerResult.values);
      allComplete = allComplete && innerResult.complete;
      offset = close + 1;
      continue;
    }

    const tableStart = /^<\$([A-Za-z0-9_.\u3400-\u9fff]+)\s*\(/i.exec(
      expression.slice(placeholder),
    );
    if (tableStart) {
      const innerStart = placeholder + tableStart[0].length;
      const innerEnd = findClosingParenthesis(expression, innerStart);
      if (innerEnd < 0) return undefined;
      let close = innerEnd + 1;
      while (/\s/.test(expression[close] || '')) close++;
      if (expression[close] !== '>') return undefined;
      const tableResult = evaluateTablePlaceholder(
        tableStart[1],
        expression.slice(innerStart, innerEnd),
        label,
        values,
        complete,
        parsed,
        recursionDepth + 1,
      );
      if (!tableResult || tableResult.values.size === 0) return undefined;
      combinations = combineValues(combinations, tableResult.values);
      allComplete = allComplete && tableResult.complete;
      offset = close + 1;
      continue;
    }

    return undefined;
  }

  return {
    values: new Set([...combinations].map(value => value.trim())),
    complete: allComplete && !truncatedValueSets.has(combinations),
  };
}

function evaluateStrInner(
  inner: string,
  label: string,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
  recursionDepth: number,
): ValueResult | undefined {
  if (recursionDepth > 8) return undefined;
  if (isVariableName(inner)) {
    const name = normalizeScriptVariableName(inner);
    const known = values.get(name);
    if (!known || known.size === 0) return undefined;
    return { values: new Set(known), complete: complete.get(name) === true };
  }

  const dynamic = extractNestedVariableReferences(inner)
    .find(reference => reference.start === 0 && reference.end === inner.length);
  if (dynamic) {
    const alias = '__ALIAS:' + normalizeNestedVariableReference(dynamic);
    const written = values.get(alias);
    if (written?.size && complete.get(alias)) return {values: new Set(written), complete: true};
    const suffix = evaluateStrInner(
      dynamic.expression,
      label,
      values,
      complete,
      parsed,
      recursionDepth + 1,
    );
    if (!suffix && !written?.size) return undefined;
    const names = constructVariableNames(dynamic.base, suffix?.values || new Set());
    const result = new Set<string>(written);
    let allComplete = suffix?.complete === true && !written?.size;
    for (const name of names) {
      const known = values.get(name);
      if (!known || known.size === 0) {
        allComplete = false;
        continue;
      }
      for (const value of known) {
        if (!result.has(value) && result.size >= MAX_INFERRED_VALUES) allComplete = false;
        else result.add(value);
      }
      allComplete = allComplete && complete.get(name) === true;
    }
    if (result.size === 0) return undefined;
    return { values: result, complete: allComplete };
  }

  if (/^<\$[\s\S]+>$/.test(inner)) {
    return evaluateTemplate(inner, label, values, complete, parsed, recursionDepth + 1);
  }

  if (/^[+-]?\d+$/.test(inner)) {
    return { values: new Set([inner]), complete: true };
  }
  return undefined;
}

function resolveReference(
  reference: NestedVariableReference,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
  explicitVariables: ReadonlySet<string>,
  label: string,
): NestedVariableResolution {
  const suffix = evaluateStrInner(
    reference.expression,
    label,
    values,
    complete,
    parsed,
    0,
  );
  const fromDataFlow = suffix ? constructVariableNames(reference.base, suffix.values) : [];
  const family = suffix?.complete && fromDataFlow.length > 0
    ? []
    : findExplicitFamily(reference.base, reference.expression, explicitVariables);
  const variables = sortVariableNames([...fromDataFlow, ...family]);
  if (variables.length > 0) {
    const evidence: Array<'data-flow' | 'explicit-family'> = [];
    if (fromDataFlow.length > 0) evidence.push('data-flow');
    if (family.length > 0) evidence.push('explicit-family');
    return {
      ...reference,
      variables,
      status: suffix?.complete && family.length === 0 ? 'resolved' : 'partial',
      evidence,
    };
  }

  return { ...reference, variables: [], status: 'unresolved', evidence: [] };
}

function resolveStaticPersonalFlagReference(
  reference: PersonalFlagReference,
  range?: { min: number; max: number },
): PersonalFlagResolution {
  return buildPersonalFlagResolution(
    reference,
    { values: new Set([reference.content]), complete: true },
    reference.command === 'RESET'
      ? { values: new Set([reference.countExpression || '1']), complete: true }
      : undefined,
    range,
  );
}

function resolvePersonalFlagReference(
  reference: PersonalFlagReference,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
  label: string,
  range?: { min: number; max: number },
): PersonalFlagResolution {
  const content = evaluateFlagExpression(
    reference.content,
    label,
    values,
    complete,
    parsed,
  );
  const count = reference.command === 'RESET'
    ? evaluateFlagExpression(
      reference.countExpression || '1',
      label,
      values,
      complete,
      parsed,
    )
    : undefined;
  return buildPersonalFlagResolution(reference, content, count, range);
}

function evaluateFlagExpression(
  expression: string,
  label: string,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
): ValueResult | undefined {
  const trimmed = expression.trim();
  if (isVariableName(trimmed)) {
    const name = normalizeScriptVariableName(trimmed);
    const known = values.get(name);
    return known && known.size > 0
      ? { values: new Set(known), complete: complete.get(name) === true }
      : undefined;
  }
  return evaluateTemplate(trimmed, label, values, complete, parsed);
}

function buildPersonalFlagResolution(
  reference: PersonalFlagReference,
  content: ValueResult | undefined,
  count: ValueResult | undefined,
  range = { min: 1, max: MAX_PERSONAL_FLAG },
): PersonalFlagResolution {
  const numbers = new Set<number>();
  let complete = content?.complete === true;

  if (reference.command === 'RESET') {
    complete = complete && count?.complete === true;
    if (content && count) {
      for (const rawStart of content.values) {
        const start = parseUnsignedInteger(rawStart);
        if (start === undefined) {
          complete = false;
          continue;
        }
        for (const rawCount of count.values) {
          const amount = parseUnsignedInteger(rawCount);
          if (amount === undefined) {
            complete = false;
            continue;
          }
          for (let offset = 0; offset < amount; offset++) {
            if (!addPersonalFlag(numbers, start + offset, range)) complete = false;
            if (offset >= range.max - range.min + 1) {
              complete = false;
              break;
            }
          }
        }
      }
    }
  } else if (content) {
    for (const value of content.values) {
      const parsed = parsePersonalFlagList(value, range);
      complete = complete && parsed.complete;
      for (const flag of parsed.flags) numbers.add(flag);
    }
  }

  const flags = [...numbers]
    .sort((left, right) => left - right)
    .map(value => `[${value}]`);
  const status: NestedVariableResolutionStatus = complete
    ? 'resolved'
    : flags.length > 0 ? 'partial' : 'unresolved';
  return { ...reference, flags, status };
}

function parsePersonalFlagList(value: string, range: { min: number; max: number }): { flags: Set<number>; complete: boolean } {
  const flags = new Set<number>();
  let complete = true;
  for (const rawPart of value.split(',')) {
    const part = rawPart.trim();
    if (!part) {
      complete = false;
      continue;
    }
    const single = parseUnsignedInteger(part);
    if (single !== undefined) {
      if (!addPersonalFlag(flags, single, range)) complete = false;
      continue;
    }
    const interval = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (!interval) {
      complete = false;
      continue;
    }
    const first = Number(interval[1]);
    const last = Number(interval[2]);
    if (first > last || first < range.min || last > range.max) complete = false;
    for (let flag = Math.max(range.min, first); flag <= Math.min(range.max, last); flag++) {
      flags.add(flag);
    }
  }
  return { flags, complete };
}

function parseUnsignedInteger(value: string): number | undefined {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

function addPersonalFlag(flags: Set<number>, value: number, range: { min: number; max: number }): boolean {
  if (!Number.isSafeInteger(value) || value < range.min || value > range.max) return false;
  flags.add(value);
  return true;
}

function collectConcreteVariables(
  text: string,
  references: readonly NestedVariableReference[],
  engine: EngineId = 'GOM',
): Set<string> {
  const variables = new Set<string>();
  for (const match of findScriptVariables(text, engine)) {
    if (isNestedVariableBaseOffset(match.index, references)) continue;
    variables.add(match.name);
  }
  return variables;
}

function findExplicitFamily(
  baseName: string,
  indexExpression: string,
  variables: ReadonlySet<string>,
): string[] {
  const base = normalizeScriptVariableName(baseName);
  const results: string[] = [];
  const custom = /^(?:GL|[NSLD])\$/i.test(base);
  const numbered = /^[PDMNSIGAUTJZ]\d+$/i.test(base);
  const numericCustomIndex = /^N\$/i.test(normalizeScriptVariableName(indexExpression));
  if (!custom && !numbered) return results;

  for (const variable of variables) {
    if (!variable.startsWith(base) || variable.length <= base.length) continue;
    const suffix = variable.slice(base.length);
    if ((numbered || numericCustomIndex) && !/^\d+$/.test(suffix)) continue;
    results.push(variable);
  }
  return results;
}

function constructVariableNames(baseName: string, suffixes: ReadonlySet<string>): string[] {
  const base = normalizeScriptVariableName(baseName);
  const numeric = /^[PDMNSIGAUTJZ]\d*$/i.test(base);
  const custom = /^(?:GL|[NSLD])\$[\p{L}\p{N}_·]*$/iu.test(base);
  if (!numeric && !custom) return [];

  const names = new Set<string>();
  for (const rawSuffix of suffixes) {
    const suffix = rawSuffix.trim();
    if (!suffix || (numeric && !/^\d+$/.test(suffix))) continue;
    if (custom && !VARIABLE_NAME.test(base + suffix)) continue;
    names.add(normalizeScriptVariableName(base + suffix));
  }
  return [...names];
}

function evaluateTablePlaceholder(
  rawName: string,
  rawArguments: string,
  label: string,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
  recursionDepth: number,
): ValueResult | undefined {
  const name = rawName.toUpperCase();
  if (name === 'GLOBAL') {
    const excel = /^\s*Excel(\d+)\s*$/i.exec(rawArguments);
    if (!excel) return undefined;
    return evaluateExcelColumn(
      Number(excel[1]),
      label,
      values,
      complete,
      parsed,
      recursionDepth,
    );
  }

  const isRowLookup = name.endsWith('.ROW');
  const alias = isRowLookup ? name.slice(0, -4) : name;
  let paths = parsed.tables.csvAliases.get(alias);
  const flowAlias = `__CSV_${alias}`;
  const activeComplete = !values.has(flowAlias) || complete.get(flowAlias) === true;
  if (values.has(flowAlias)) paths = new Set(values.get(flowAlias));
  if (!paths || paths.size === 0) return undefined;
  const args = splitTopLevel(rawArguments, ',').map(value => value.trim());
  if (isRowLookup) {
    if (args.length < 3) return undefined;
    const result = evaluateCsvRowLookup(
      paths,
      args,
      label,
      values,
      complete,
      parsed,
      recursionDepth,
    );
    return result ? { ...result, complete: result.complete && activeComplete } : undefined;
  }
  if (args.length < 2) return undefined;

  const results = [...paths].map(tablePath => evaluateTableCell(
    tablePath,
    args[0],
    args[1],
    'csv',
    0,
    label,
    values,
    complete,
    parsed,
    recursionDepth,
  ));
  const result = mergeValueResults(results);
  return result ? { ...result, complete: result.complete && activeComplete } : undefined;
}

function evaluateExcelColumn(
  column: number,
  label: string,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
  recursionDepth: number,
): ValueResult | undefined {
  const flowColumn = `__EXCEL${column}`;
  if (values.has(flowColumn)) {
    const known = values.get(flowColumn)!;
    return known.size ? { values: new Set(known), complete: complete.get(flowColumn) === true } : undefined;
  }
  const reads = parsed.tables.excelReads.filter(read => read.label === label);
  if (reads.length === 0) return undefined;
  return mergeValueResults(reads.map(read => evaluateTableCell(
    read.path,
    read.rowExpression,
    String(column),
    'excel',
    1,
    label,
    values,
    complete,
    parsed,
    recursionDepth,
  )));
}

function evaluateTableCell(
  tablePath: string,
  rowExpression: string,
  columnExpression: string,
  format: 'excel' | 'csv',
  rowBase: number,
  label: string,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
  recursionDepth = 0,
): ValueResult | undefined {
  const table = loadTableData(parsed, tablePath, format);
  if (!table || table.rows.length === 0) return undefined;
  const rowValues = evaluateIndexValues(
    rowExpression,
    label,
    values,
    complete,
    parsed,
    recursionDepth + 1,
  );
  const columnValues = evaluateIndexValues(
    columnExpression,
    label,
    values,
    complete,
    parsed,
    recursionDepth + 1,
  );
  const rowIndexes = rowValues?.complete
    ? [...rowValues.values].map(Number).map(value => value - rowBase)
    : table.rows.map((_, index) => index);
  const maximumColumns = table.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const columnIndexes = columnValues?.complete
    ? [...columnValues.values].map(Number)
    : Array.from({ length: maximumColumns }, (_, index) => index);
  const result = new Set<string>();
  let truncated = false;

  for (const rowIndex of rowIndexes) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= table.rows.length) continue;
    for (const columnIndex of columnIndexes) {
      if (!Number.isInteger(columnIndex) || columnIndex < 0 ||
          columnIndex >= table.rows[rowIndex].length) continue;
      const cell = String(table.rows[rowIndex][columnIndex] ?? '').trim();
      if (!cell) continue;
      result.add(cell);
      if (result.size >= MAX_INFERRED_VALUES) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }

  if (result.size === 0) return undefined;
  return {
    values: result,
    complete: table.complete && rowValues?.complete === true &&
      columnValues?.complete === true && !truncated,
  };
}

function evaluateListLine(
  assignment: ListLineConstraint,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
): ValueResult | undefined {
  const list = loadListData(parsed, assignment.path);
  if (!list || list.lines.length === 0) return undefined;
  const lineValues = evaluateIndexValues(
    assignment.lineExpression,
    assignment.label,
    values,
    complete,
    parsed,
    0,
  );
  const indexes = lineValues?.complete
    ? [...lineValues.values].map(Number)
    : list.lines.map((_, index) => index);
  const result = new Set<string>();
  let allIndexesValid = true;
  let truncated = false;

  for (const index of indexes) {
    if (!Number.isInteger(index) || index < 0 || index >= list.lines.length) {
      allIndexesValid = false;
      continue;
    }
    const line = String(list.lines[index] ?? '').trim();
    let value = line;
    if (assignment.field !== undefined) {
      const separator = line.indexOf(':');
      if (separator < 0) {
        allIndexesValid = false;
        if (assignment.field > 0) continue;
      } else {
        value = assignment.field === 0
          ? line.slice(0, separator)
          : line.slice(separator + 1);
      }
    }
    value = value.trim();
    if (!value) continue;
    result.add(value);
    if (result.size >= MAX_INFERRED_VALUES) {
      truncated = true;
      break;
    }
  }

  if (result.size === 0) return undefined;
  return {
    values: result,
    complete: list.complete && lineValues?.complete === true && allIndexesValid && !truncated,
  };
}

function evaluateIndexValues(
  expression: string,
  label: string,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
  recursionDepth: number,
): ValueResult | undefined {
  const trimmed = expression.trim();
  let result: ValueResult | undefined;
  if (isVariableName(trimmed)) {
    const name = normalizeScriptVariableName(trimmed);
    const known = values.get(name);
    if (known && known.size > 0) {
      result = { values: new Set(known), complete: complete.get(name) === true };
    }
  } else {
    result = evaluateTemplate(trimmed, label, values, complete, parsed, recursionDepth);
  }
  if (!result) return undefined;
  const numeric = new Set([...result.values].filter(value => /^[+-]?\d+$/.test(value.trim())));
  if (numeric.size === 0) return undefined;
  return {
    values: numeric,
    complete: result.complete && numeric.size === result.values.size,
  };
}

function evaluateCsvRowLookup(
  paths: ReadonlySet<string>,
  args: readonly string[],
  label: string,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
  recursionDepth: number,
): ValueResult | undefined {
  const direction = evaluateIndexValues(
    args[0], label, values, complete, parsed, recursionDepth + 1,
  );
  const search = evaluateTemplate(
    args[1], label, values, complete, parsed, recursionDepth + 1,
  );
  const column = evaluateIndexValues(
    args[2], label, values, complete, parsed, recursionDepth + 1,
  );
  const results = new Set<string>();
  let allComplete = direction?.complete === true && search?.complete === true &&
    column?.complete === true;

  for (const tablePath of paths) {
    const table = loadTableData(parsed, tablePath, 'csv');
    if (!table) {
      allComplete = false;
      continue;
    }
    if (!direction || !search || !column) {
      for (let index = 0; index < table.rows.length; index++) results.add(String(index));
      allComplete = false;
      continue;
    }
    for (const rawDirection of direction.values) {
      for (const rawSearch of search.values) {
        for (const rawColumn of column.values) {
          const columnIndex = Number(rawColumn);
          const indexes = Array.from({ length: table.rows.length }, (_, index) => index);
          if (Number(rawDirection) === 1) indexes.reverse();
          const found = indexes.find(index =>
            String(table.rows[index][columnIndex] ?? '') === stripMatchingQuotes(rawSearch),
          );
          results.add(String(found === undefined ? -1 : found));
          if (results.size >= MAX_INFERRED_VALUES) {
            allComplete = false;
            break;
          }
        }
      }
    }
    allComplete = allComplete && table.complete;
  }
  return results.size > 0 ? { values: results, complete: allComplete } : undefined;
}

function loadTableData(
  parsed: ParsedScript,
  rawPath: string,
  format: 'excel' | 'csv',
): NestedTableDataResult | undefined {
  const tablePath = stripMatchingQuotes(rawPath.trim());
  if (!tablePath || /<\$/i.test(tablePath) || !parsed.tables.resolveTableData) return undefined;
  const key = `${format}:${tablePath}`;
  if (parsed.tables.dataCache.has(key)) return parsed.tables.dataCache.get(key);
  const result = parsed.tables.resolveTableData({ path: tablePath, format });
  parsed.tables.dataCache.set(key, result);
  return result;
}

function loadListData(
  parsed: ParsedScript,
  rawPath: string,
): NestedListDataResult | undefined {
  const listPath = stripMatchingQuotes(rawPath.trim());
  if (!listPath || /<\$/i.test(listPath) || !parsed.tables.resolveListData) return undefined;
  if (parsed.tables.listCache.has(listPath)) return parsed.tables.listCache.get(listPath);
  const result = parsed.tables.resolveListData({ path: listPath });
  parsed.tables.listCache.set(listPath, result);
  return result;
}

function mergeValueResults(results: readonly (ValueResult | undefined)[]): ValueResult | undefined {
  const values = new Set<string>();
  let complete = results.length > 0;
  for (const result of results) {
    if (!result) {
      complete = false;
      continue;
    }
    complete = complete && result.complete;
    for (const value of result.values) {
      values.add(value);
      if (values.size >= MAX_INFERRED_VALUES) {
        complete = false;
        break;
      }
    }
  }
  return values.size > 0 ? { values, complete } : undefined;
}

function tableAliasFromPath(rawPath: string): string {
  const clean = stripMatchingQuotes(rawPath.trim());
  const fileName = clean.split(/[\\/]/).pop() || clean;
  return fileName.replace(/\.csv$/i, '').toUpperCase();
}

function collectEventCallSources(
  text: string,
  labelsByLine: readonly string[],
): EventParameterSource[] {
  const sources: EventParameterSource[] = [];
  const starts = lineStarts(text);
  let searchFrom = 0;
  while (searchFrom < text.length) {
    const marker = text.indexOf('/@', searchFrom);
    if (marker < 0) break;
    let cursor = marker + 2;
    while (cursor < text.length && !/[\s(>^|/\\\]}]/.test(text[cursor])) cursor++;
    const label = text.slice(marker + 2, cursor).trim().toUpperCase();
    if (!label) {
      searchFrom = cursor + 1;
      continue;
    }
    if (text[cursor] !== '(') {
      sources.push({ targetLabel: label, callerLabel: labelsByLine[lineAtOffset(starts, marker)] || '',
        arguments: [], kind: 'call', sourceLine: lineAtOffset(starts, marker) });
      searchFrom = cursor + 1;
      continue;
    }
    const close = findBalancedClose(text, cursor, '(', ')');
    if (close < 0) {
      searchFrom = cursor + 1;
      continue;
    }
    sources.push({
      sourceLine: lineAtOffset(starts, marker),
      targetLabel: label,
      callerLabel: labelsByLine[lineAtOffset(starts, marker)] || '',
      arguments: splitTopLevel(text.slice(cursor + 1, close), ','),
      kind: 'call',
    });
    searchFrom = close + 1;
  }
  return sources;
}

function initializeEventParameters(
  sources: readonly EventParameterSource[],
  parameters: Map<string, Map<number, EventParameter>>,
): void {
  for (const label of new Set(sources.map(source => source.targetLabel))) {
    const labelSources = selectEventSources(sources, label);
    const byIndex = new Map<number, EventParameter>();
    const maximum = Math.max(0, ...labelSources.map(source => source.arguments.length));
    for (let index = 0; index < maximum; index++) {
      byIndex.set(index + 1, { values: new Set(), complete: false });
    }
    parameters.set(label, byIndex);
  }
}

function updateEventParameters(
  parsed: ParsedScript,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
): boolean {
  let changed = false;
  for (const [label, byIndex] of parsed.eventParameters) {
    const sources = selectEventSources(parsed.eventSources, label);
    for (const [parameterIndex, parameter] of byIndex) {
      const nextValues = new Set<string>();
      let nextComplete = sources.length > 0;
      for (const source of sources) {
        const expression = source.arguments[parameterIndex - 1]?.trim();
        if (!expression) {
          nextComplete = false;
          continue;
        }
        const result = evaluateTemplate(
          expression,
          source.callerLabel,
          values,
          complete,
          parsed,
        );
        if (!result || result.values.size === 0) {
          nextComplete = false;
          continue;
        }
        nextComplete = nextComplete && result.complete;
        for (const value of result.values) {
          nextValues.add(stripMatchingQuotes(value.trim()));
          if (nextValues.size >= MAX_INFERRED_VALUES) {
            nextComplete = false;
            break;
          }
        }
      }
      if (!setEquals(parameter.values, nextValues)) {
        parameter.values = nextValues;
        changed = true;
      }
      if (parameter.complete !== nextComplete) {
        parameter.complete = nextComplete;
        changed = true;
      }
    }
  }
  return changed;
}

function selectEventSources(
  sources: readonly EventParameterSource[],
  label: string,
): EventParameterSource[] {
  const matching = sources.filter(source => source.targetLabel === label);
  const checks = matching.filter(source => source.kind === 'check');
  return checks.length > 0 ? checks : matching;
}

function setEquals(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function stripMatchingQuotes(value: string): string {
  if (value.length >= 2 && ((value[0] === '"' && value[value.length - 1] === '"') ||
      (value[0] === "'" && value[value.length - 1] === "'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function unwrapDirectStrVariable(expression: string): string | undefined {
  const match = /^<\$STR\s*\(\s*([^()]+?)\s*\)>$/i.exec(expression.trim());
  if (!match || !isVariableName(match[1])) return undefined;
  return normalizeScriptVariableName(match[1]);
}

function normalizeAssignmentTarget(value: string): string | undefined {
  const trimmed = value.trim();
  return isVariableName(trimmed)
    ? normalizeScriptVariableName(trimmed)
    : unwrapDirectStrVariable(trimmed);
}

function isVariableName(value: string): boolean {
  return VARIABLE_NAME.test(value.trim());
}

function mergeParsedValues(
  parsed: ParsedScript,
  target: Map<string, Set<string>>,
  name: string,
  incoming: ReadonlySet<string>,
): boolean {
  const changed = mergeValues(target, name, incoming);
  const retained = target.get(name)!;
  if ([...incoming].some(value => !retained.has(value))) parsed.truncatedTargets.add(name);
  return changed;
}

function mergeValues(
  target: Map<string, Set<string>>,
  name: string,
  incoming: ReadonlySet<string>,
): boolean {
  let values = target.get(name);
  if (!values) {
    values = new Set<string>();
    target.set(name, values);
  }
  let changed = false;
  for (const value of incoming) {
    if (values.size >= MAX_INFERRED_VALUES) break;
    if (!values.has(value)) {
      values.add(value);
      changed = true;
    }
  }
  return changed;
}

function appendLiteral(values: ReadonlySet<string>, literal: string): Set<string> {
  const result = new Set([...values].map(value => value + literal));
  if (truncatedValueSets.has(values)) truncatedValueSets.add(result);
  return result;
}

function combineValues(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  const combined = new Set<string>();
  if (truncatedValueSets.has(left) || truncatedValueSets.has(right)) truncatedValueSets.add(combined);
  for (const prefix of left) {
    for (const suffix of right) {
      const value = prefix + suffix;
      if (!combined.has(value) && combined.size >= MAX_INFERRED_VALUES) {
        truncatedValueSets.add(combined);
        return combined;
      }
      combined.add(value);
    }
  }
  return combined;
}

function splitArguments(value: string): string[] {
  const parts: string[] = [];
  let start = -1;
  let angle = 0;
  let parentheses = 0;
  for (let index = 0; index <= value.length; index++) {
    const character = value[index] || ' ';
    if (start < 0 && !/\s/.test(character)) start = index;
    if (start < 0) continue;
    if (character === '<') angle++;
    else if (character === '>' && angle > 0) angle--;
    else if (character === '(') parentheses++;
    else if (character === ')' && parentheses > 0) parentheses--;
    if (/\s/.test(character) && angle === 0 && parentheses === 0) {
      parts.push(value.slice(start, index));
      start = -1;
    }
  }
  return parts;
}

function splitByDelimiter(value: string, delimiter: string): string[] {
  if (!delimiter) return [value];
  return splitTopLevel(value, delimiter);
}

function splitTopLevel(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let angle = 0;
  let parentheses = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (character === '<') angle++;
    else if (character === '>' && angle > 0) angle--;
    else if (character === '(') parentheses++;
    else if (character === ')' && parentheses > 0) parentheses--;
    if (angle === 0 && parentheses === 0 && value.startsWith(delimiter, index)) {
      parts.push(value.slice(start, index));
      start = index + delimiter.length;
      index += delimiter.length - 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function sortVariableNames(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => {
    const leftNumber = /^([A-Z]+)(\d+)$/.exec(left);
    const rightNumber = /^([A-Z]+)(\d+)$/.exec(right);
    if (leftNumber && rightNumber && leftNumber[1] === rightNumber[1]) {
      return Number(leftNumber[2]) - Number(rightNumber[2]);
    }
    return left.localeCompare(right, 'zh-CN', { numeric: true });
  });
}

function findClosingParenthesis(text: string, start: number): number {
  let depth = 1;
  for (let index = start; index < text.length; index++) {
    if (text[index] === '(') depth++;
    else if (text[index] === ')' && --depth === 0) return index;
  }
  return -1;
}

function findBalancedClose(text: string, open: number, opening: string, closing: string): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === opening) depth++;
    else if (text[index] === closing && --depth === 0) return index;
  }
  return -1;
}

function placeholderDepth(text: string): number {
  let current = 0;
  let maximum = 0;
  for (let index = 0; index < text.length; index++) {
    const match = /^<\$STR\s*\(/i.exec(text.slice(index));
    if (match) {
      current++;
      maximum = Math.max(maximum, current);
      index += match[0].length - 1;
    } else if (text[index] === ')' && text[index + 1] === '>' && current > 0) {
      current--;
    }
  }
  return maximum;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n' || (text[index] === '\r' && text[index + 1] !== '\n')) starts.push(index + 1);
  }
  return starts;
}

function collectLabelsByLine(text: string): string[] {
  const labels: string[] = [];
  let current = '';
  for (const line of text.split(/\r\n|\r|\n/)) {
    const label = /^\s*\[@([^\]]+)\]/.exec(line);
    if (label) current = label[1].trim().toUpperCase();
    labels.push(current);
  }
  return labels;
}

function lineAtOffset(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(0, high);
}

function isVariableCharacter(character: string): boolean {
  return /[\p{L}\p{N}_$·]/u.test(character);
}

function maskCommentLines(text: string): string {
  return text.replace(/[^\r\n]+/g, line => scriptCodeBeforeComment(line).padEnd(line.length));
}
