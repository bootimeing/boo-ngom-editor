import { normalizeScriptVariableName } from './variable-statistics';
import { isScriptCommentLine } from './script-labels';

const MAX_INFERRED_VALUES = 512;
const MAX_PERSONAL_FLAG = 1024;
const VARIABLE_NAME = /^(?:[PDMNSIGAUTJZ]\d+|(?:GL|[NSLD])\$[A-Za-z0-9_\u3400-\u9fff]+)$/i;
const CONCRETE_VARIABLE = /(?:[NSLDnsld]\$[A-Za-z0-9_\u3400-\u9fff]+|[Gg][Ll]\$[A-Za-z0-9_\u3400-\u9fff]+|[PDMNSIGAUTJZpdmnigautjz]\d+)/g;

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
}

export interface PersonalFlagReference {
  raw: string;
  content: string;
  command: 'CHECK' | 'SET' | 'RESET';
  countExpression?: string;
  start: number;
  end: number;
  line: number;
}

export interface PersonalFlagResolution extends PersonalFlagReference {
  flags: string[];
  status: NestedVariableResolutionStatus;
}

export interface NestedVariableAnalysis {
  references: NestedVariableResolution[];
  personalFlags: PersonalFlagResolution[];
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
  resolveConfigValues?: (
    request: NestedConfigValueRequest,
  ) => NestedConfigValueResult | undefined;
  resolveTableData?: (
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
  kind: 'extract';
  delimiter: string;
  sourceExpression: string;
  targets: string[];
  label: string;
}

type AssignmentConstraint = MoveConstraint | FormulaConstraint | RangeConstraint |
  ValuesConstraint | TableCellConstraint | ListLineConstraint;

interface EventParameter {
  values: Set<string>;
  complete: boolean;
}

interface EventParameterSource {
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
  assignments: AssignmentConstraint[];
  dynamicMoves: DynamicMoveConstraint[];
  extracts: ExtractConstraint[];
  incompleteTargets: Set<string>;
  eventSources: EventParameterSource[];
  eventParameters: Map<string, Map<number, EventParameter>>;
  tables: TableContext;
  explicitVariables: ReadonlySet<string>;
}

export function extractNestedVariableReferences(text: string): NestedVariableReference[] {
  const references: NestedVariableReference[] = [];
  const starts = lineStarts(text);
  const startPattern = /((?:GL|[A-Za-z])(?:\$[A-Za-z0-9_\u3400-\u9fff]*|\d*))<\$STR\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = startPattern.exec(text)) !== null) {
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
  const commandPattern = /^[ \t]*(?:<\$[^>\r\n]+>\.)?(CHECK|SET|RESET)\s*\[/gim;
  let match: RegExpExecArray | null;

  while ((match = commandPattern.exec(text)) !== null) {
    const open = commandPattern.lastIndex - 1;
    const close = findBalancedClose(text, open, '[', ']');
    const lineEnd = text.indexOf('\n', open);
    if (close < 0 || (lineEnd >= 0 && close > lineEnd)) {
      commandPattern.lastIndex = open + 1;
      continue;
    }
    const command = match[1].toUpperCase() as PersonalFlagReference['command'];
    let countExpression: string | undefined;
    if (command === 'RESET') {
      const restEnd = lineEnd < 0 ? text.length : lineEnd;
      countExpression = splitArguments(text.slice(close + 1, restEnd).trim())[0] || '1';
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

  return references;
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
  const normalize = (value: string) => value
    .replace(/\$STR/gi, '$STR')
    .replace(/\$SCRIPTPARAM/gi, '$SCRIPTPARAM')
    .replace(/(?:GL|[NSLD])\$[A-Za-z0-9_\u3400-\u9fff]+|[PDMNSIGAUTJZ]\d+/gi,
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
  const references = extractNestedVariableReferences(activeText);
  const personalFlagReferences = extractPersonalFlagReferences(activeText);
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
      personalFlags: personalFlagReferences.map(resolveStaticPersonalFlagReference),
      inferredValues: new Map(),
    };
  }
  const parsed = parseScript(activeText, options, labelsByLine, references);
  const inferredValues = solveValues(parsed);
  const completeVariables = solveCompleteness(parsed, inferredValues);
  const explicitVariables = collectConcreteVariables(activeText, references);
  const resolved = references.map(reference => resolveReference(
    reference,
    inferredValues,
    completeVariables,
    parsed,
    explicitVariables,
    labelsByLine[reference.line] || '',
  ));
  const personalFlags = personalFlagReferences.map(reference => resolvePersonalFlagReference(
    reference,
    inferredValues,
    completeVariables,
    parsed,
    labelsByLine[reference.line] || '',
  ));

  return { references: resolved, personalFlags, inferredValues };
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
  const references = extractNestedVariableReferences(activeText);
  const parsed = parseScript(activeText, options, labelsByLine, references);
  const inferredValues = solveValues(parsed);
  const completeVariables = solveCompleteness(parsed, inferredValues);

  return requests.map(request => {
    const expression = request.expression.trim();
    const label = labelsByLine[Math.max(0, request.line)] || '';
    let result: ValueResult | undefined;
    if (isVariableName(expression)) {
      result = evaluateStrInner(
        expression,
        label,
        inferredValues,
        completeVariables,
        parsed,
        0,
      );
    } else {
      result = evaluateTemplate(
        expression,
        label,
        inferredValues,
        completeVariables,
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

  for (const line of text.split(/\r?\n/)) {
    if (isScriptCommentLine(line)) continue;
    const label = /^\s*\[@([^\]]+)\]/.exec(line);
    if (label) {
      currentLabel = label[1].trim().toUpperCase();
      continue;
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
      });
      continue;
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
      if (parts.length >= 3 && target) {
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
        const targets = parts.slice(2)
          .map(normalizeAssignmentTarget)
          .filter((target): target is string => target !== undefined);
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
        }
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
  }

  addExtractFieldAssignments(assignments, extracts);
  initializeEventParameters(eventSources, eventParameters);
  return {
    assignments,
    dynamicMoves,
    extracts,
    incompleteTargets,
    eventSources,
    eventParameters,
    tables,
    explicitVariables: collectConcreteVariables(text, nestedReferences),
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
      if (result) changed = mergeValues(values, assignment.target, result.values) || changed;
    }
    for (const dynamicMove of parsed.dynamicMoves) {
      const result = evaluateDynamicMove(dynamicMove, values, completeness, parsed);
      if (!result.value) continue;
      for (const target of result.targets) {
        changed = mergeValues(values, target, result.value.values) || changed;
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
          changed = mergeValues(values, extract.targets[index], new Set([fields[index]])) || changed;
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
      if (complete.get(target) || parsed.incompleteTargets.has(target)) continue;
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
        if (!complete.get(target) && !parsed.incompleteTargets.has(target)) {
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
    const result = calculateSimpleFormula(expression);
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

    const scriptParameter = /^<\$SCRIPTPARAM(\d+)>/i.exec(expression.slice(placeholder));
    if (scriptParameter) {
      const parameter = parsed.eventParameters.get(label)?.get(Number(scriptParameter[1]));
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
    complete: allComplete,
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
  if (isVariableName(inner)) {
    const name = normalizeScriptVariableName(inner);
    const known = values.get(name);
    if (!known || known.size === 0) return undefined;
    return { values: new Set(known), complete: complete.get(name) === true };
  }

  const dynamic = extractNestedVariableReferences(inner)
    .find(reference => reference.start === 0 && reference.end === inner.length);
  if (dynamic) {
    const suffix = evaluateTemplate(
      dynamic.expression,
      label,
      values,
      complete,
      parsed,
      recursionDepth + 1,
    );
    if (!suffix) return undefined;
    const names = constructVariableNames(dynamic.base, suffix.values);
    const result = new Set<string>();
    let allComplete = suffix.complete;
    for (const name of names) {
      const known = values.get(name);
      if (!known || known.size === 0) {
        allComplete = false;
        continue;
      }
      for (const value of known) result.add(value);
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
): PersonalFlagResolution {
  return buildPersonalFlagResolution(
    reference,
    { values: new Set([reference.content]), complete: true },
    reference.command === 'RESET'
      ? { values: new Set([reference.countExpression || '1']), complete: true }
      : undefined,
  );
}

function resolvePersonalFlagReference(
  reference: PersonalFlagReference,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
  label: string,
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
  return buildPersonalFlagResolution(reference, content, count);
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
            addPersonalFlag(numbers, start + offset);
            if (offset >= MAX_PERSONAL_FLAG) {
              complete = false;
              break;
            }
          }
        }
      }
    }
  } else if (content) {
    for (const value of content.values) {
      const parsed = parsePersonalFlagList(value);
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

function parsePersonalFlagList(value: string): { flags: Set<number>; complete: boolean } {
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
      addPersonalFlag(flags, single);
      continue;
    }
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (!range) {
      complete = false;
      continue;
    }
    const first = Number(range[1]);
    const last = Number(range[2]);
    if (first > last) continue;
    for (let flag = Math.max(1, first); flag <= Math.min(MAX_PERSONAL_FLAG, last); flag++) {
      flags.add(flag);
    }
  }
  return { flags, complete };
}

function parseUnsignedInteger(value: string): number | undefined {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

function addPersonalFlag(flags: Set<number>, value: number): void {
  if (Number.isInteger(value) && value >= 1 && value <= MAX_PERSONAL_FLAG) flags.add(value);
}

function collectConcreteVariables(
  text: string,
  references: readonly NestedVariableReference[],
): Set<string> {
  const variables = new Set<string>();
  let match: RegExpExecArray | null;
  CONCRETE_VARIABLE.lastIndex = 0;
  while ((match = CONCRETE_VARIABLE.exec(text)) !== null) {
    if (isNestedVariableBaseOffset(match.index, references)) continue;
    variables.add(normalizeScriptVariableName(match[0]));
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
  const custom = /^(?:GL|[NSLD])\$[A-Za-z0-9_\u3400-\u9fff]*$/i.test(base);
  if (!numeric && !custom) return [];

  const names = new Set<string>();
  for (const rawSuffix of suffixes) {
    const suffix = rawSuffix.trim();
    if (!suffix || (numeric && !/^\d+$/.test(suffix))) continue;
    if (custom && !/^[A-Za-z0-9_\u3400-\u9fff]+$/.test(suffix)) continue;
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
  const paths = parsed.tables.csvAliases.get(alias);
  if (!paths || paths.size === 0) return undefined;
  const args = splitTopLevel(rawArguments, ',').map(value => value.trim());
  if (isRowLookup) {
    if (args.length < 3) return undefined;
    return evaluateCsvRowLookup(
      paths,
      args,
      label,
      values,
      complete,
      parsed,
      recursionDepth,
    );
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
  return mergeValueResults(results);
}

function evaluateExcelColumn(
  column: number,
  label: string,
  values: ReadonlyMap<string, Set<string>>,
  complete: ReadonlyMap<string, boolean>,
  parsed: ParsedScript,
  recursionDepth: number,
): ValueResult | undefined {
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
  const rowIndexes = rowValues
    ? [...rowValues.values].map(Number).map(value => value - rowBase)
    : table.rows.map((_, index) => index);
  const maximumColumns = table.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const columnIndexes = columnValues
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
    if (!label || text[cursor] !== '(') {
      searchFrom = cursor + 1;
      continue;
    }
    const close = findBalancedClose(text, cursor, '(', ')');
    if (close < 0) {
      searchFrom = cursor + 1;
      continue;
    }
    sources.push({
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
  return new Set([...values].map(value => value + literal));
}

function combineValues(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  const combined = new Set<string>();
  for (const prefix of left) {
    for (const suffix of right) {
      combined.add(prefix + suffix);
      if (combined.size >= MAX_INFERRED_VALUES) return combined;
    }
  }
  return combined;
}

function calculateSimpleFormula(expression: string): string | undefined {
  const compact = expression.replace(/\s+/g, '');
  if (/^[+-]?\d+$/.test(compact)) return String(Number(compact));
  const match = /^([+-]?\d+)([+\-*/])([+-]?\d+)$/.exec(compact);
  if (!match) return undefined;
  const left = Number(match[1]);
  const right = Number(match[3]);
  let result: number;
  switch (match[2]) {
    case '+': result = left + right; break;
    case '-': result = left - right; break;
    case '*': result = left * right; break;
    case '/':
      if (right === 0) return undefined;
      result = Math.trunc(left / right);
      break;
    default: return undefined;
  }
  return String(result);
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
    if (text[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function collectLabelsByLine(text: string): string[] {
  const labels: string[] = [];
  let current = '';
  for (const line of text.split(/\r?\n/)) {
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
  return /[A-Za-z0-9_$\u3400-\u9fff]/.test(character);
}

function maskCommentLines(text: string): string {
  return text.replace(/^[ \t]*;[^\r\n]*/gm, line => ' '.repeat(line.length));
}
