import { NestedVariableAnalysisOptions } from '../utils/nested-variable-analysis';
import { normalizeScriptVariableName } from '../utils/variable-statistics';
import { DialogResolvedVariable } from './model';

const VARIABLE_NAME = /^(?:[PDMNSIGAUTJZ]\d+|(?:GL|[NSLD])\$[A-Za-z0-9_\u3400-\u9fff]+)$/i;
const MAX_EXECUTION_DEPTH = 48;
const MAX_TEMPLATE_PASSES = 12;

interface ScriptLine {
  text: string;
  lineNumber: number;
}

interface ScriptFunction {
  label: string;
  lines: ScriptLine[];
}

interface RuntimeValue {
  value: string;
  complete: boolean;
  sourceLabel?: string;
  sourceLine?: number;
  dependencies?: DialogResolvedVariable[];
}

interface TemplateResult {
  value: string;
  complete: boolean;
}

interface LabelExecution {
  snapshots: Map<number, Map<string, RuntimeValue>>;
  finalValues: Map<string, RuntimeValue>;
}

export interface DialogResolvedLine {
  text: string;
  variables: DialogResolvedVariable[];
}

export interface DialogLabelVariableResolution {
  lines: ReadonlyMap<number, DialogResolvedLine>;
}

export interface DialogVariableResolution {
  byLabel: ReadonlyMap<string, DialogLabelVariableResolution>;
  warnings: string[];
}

export interface ResolveDialogVariablesOptions {
  rootLabel: string;
  targetLabels: readonly string[];
  conditionStates?: Readonly<Record<string, boolean>>;
  dataOptions?: NestedVariableAnalysisOptions;
}

export function resolveDialogVariables(
  text: string,
  options: ResolveDialogVariablesOptions
): DialogVariableResolution {
  const functions = parseFunctions(text);
  const byName = new Map(functions.map(section => [normalizeLabel(section.label), section]));
  const root = byName.get(normalizeLabel(options.rootLabel));
  if (!root) return { byLabel: new Map(), warnings: ['变量求值找不到当前 @函数'] };

  const warnings: string[] = [];
  const result = new Map<string, DialogLabelVariableResolution>();
  const targets = [...new Set(options.targetLabels.map(normalizeLabel))];
  for (const targetName of targets) {
    const target = byName.get(targetName);
    if (!target) continue;
    const environment = new Map<string, RuntimeValue>();
    const snapshotsByLabel = new Map<string, Map<number, Map<string, RuntimeValue>>>();
    executeFunction(
      root.label,
      byName,
      environment,
      snapshotsByLabel,
      options,
      warnings,
      []
    );
    if (!snapshotsByLabel.has(targetName)) {
      const path = findUiPath(root.label, target.label, byName);
      for (const label of path.slice(1)) {
        if (snapshotsByLabel.has(normalizeLabel(label))) continue;
        executeFunction(
          label,
          byName,
          environment,
          snapshotsByLabel,
          options,
          warnings,
          []
        );
      }
    }
    if (!snapshotsByLabel.has(targetName)) {
      executeFunction(
        target.label,
        byName,
        environment,
        snapshotsByLabel,
        options,
        warnings,
        []
      );
    }
    const snapshots = snapshotsByLabel.get(targetName) || new Map();
    const execution: LabelExecution = { snapshots, finalValues: environment };
    result.set(targetName, resolveTargetLines(target, execution));
  }
  return { byLabel: result, warnings: [...new Set(warnings)] };
}

function parseFunctions(text: string): ScriptFunction[] {
  const sourceLines = text.split(/\r\n|\r|\n/).map((line, lineNumber) => ({
    text: line,
    lineNumber,
  }));
  const labels: Array<{ label: string; lineIndex: number }> = [];
  for (let index = 0; index < sourceLines.length; index++) {
    const match = /^\uFEFF?\s*\[(@[^\]]+)\]/.exec(sourceLines[index].text);
    if (match) labels.push({ label: match[1], lineIndex: index });
  }
  return labels.map((entry, index) => ({
    label: entry.label,
    lines: sourceLines.slice(entry.lineIndex, labels[index + 1]?.lineIndex ?? sourceLines.length),
  }));
}

function findUiPath(
  rootLabel: string,
  targetLabel: string,
  byName: ReadonlyMap<string, ScriptFunction>
): string[] {
  const root = normalizeLabel(rootLabel);
  const target = normalizeLabel(targetLabel);
  if (root === target) return [root];
  const queue: Array<{ label: string; path: string[] }> = [{ label: root, path: [root] }];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.label)) continue;
    visited.add(current.label);
    const section = byName.get(current.label);
    if (!section) continue;
    for (const reference of uiLinkReferences(section.lines.map(line => line.text).join('\n'))) {
      const next = normalizeLabel(cleanTargetLabel(reference));
      if (!byName.has(next) || visited.has(next)) continue;
      const path = [...current.path, next];
      if (next === target) return path;
      queue.push({ label: next, path });
    }
  }
  return [root, target];
}

function executeFunction(
  rawLabel: string,
  byName: ReadonlyMap<string, ScriptFunction>,
  environment: Map<string, RuntimeValue>,
  snapshotsByLabel: Map<string, Map<number, Map<string, RuntimeValue>>>,
  options: ResolveDialogVariablesOptions,
  warnings: string[],
  stack: string[]
): void {
  const label = normalizeLabel(rawLabel);
  const section = byName.get(label);
  if (!section) return;
  if (stack.length >= MAX_EXECUTION_DEPTH || stack.includes(label)) {
    warnings.push(`变量求值已跳过循环 GOTO: ${section.label}`);
    return;
  }
  const nextStack = [...stack, label];
  const snapshots = snapshotsByLabel.get(label) || new Map<number, Map<string, RuntimeValue>>();
  snapshotsByLabel.set(label, snapshots);
  let conditionNumber = 0;
  let conditionId = '';
  let collectingConditions = false;
  let conditionCount = 0;
  let actionEnabled = false;

  for (let index = 1; index < section.lines.length; index++) {
    const line = section.lines[index];
    snapshots.set(line.lineNumber, cloneEnvironment(environment));
    const directive = directiveName(line.text);
    if (directive === 'IF') {
      conditionId = conditionGroupId(section.label, ++conditionNumber);
      conditionCount = 0;
      collectingConditions = true;
      actionEnabled = false;
      continue;
    }
    if (directive === 'OR') {
      collectingConditions = true;
      continue;
    }
    if (directive === 'ACT' || directive === 'ELSEACT') {
      collectingConditions = false;
      const satisfied = conditionCount === 0
        ? true
        : options.conditionStates?.[conditionId] === true;
      actionEnabled = directive === 'ACT' ? satisfied : !satisfied;
      continue;
    }
    if (directive === 'SAY' || directive === 'ELSESAY') {
      collectingConditions = false;
      actionEnabled = false;
      continue;
    }
    const trimmed = line.text.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('//')) continue;
    if (collectingConditions) {
      conditionCount++;
      continue;
    }
    if (!actionEnabled) continue;
    const command = parseCommand(trimmed);
    if (!command) continue;
    if (command.name === 'GOTO') {
      const target = cleanTargetLabel(command.rest.split(/\s+/)[0] || '');
      if (target.startsWith('@')) {
        executeFunction(
          target,
          byName,
          environment,
          snapshotsByLabel,
          options,
          warnings,
          nextStack
        );
      }
      continue;
    }
    if (command.name === 'BREAK') break;
    executeAssignment(command.name, command.rest, environment, options, section.label, line.lineNumber);
  }
}

function executeAssignment(
  command: string,
  rest: string,
  environment: Map<string, RuntimeValue>,
  options: ResolveDialogVariablesOptions,
  sourceLabel: string,
  sourceLine: number
): void {
  if (command === 'MOV' || command === 'INC' || command === 'DEC'
    || command === 'MUL' || command === 'DIV') {
    const split = splitFirstArgument(rest);
    if (!split) return;
    const target = resolveTarget(split.argument, environment);
    if (!target) return;
    const references = new Map<string, DialogResolvedVariable>();
    const value = resolveTemplate(split.remainder, environment, references);
    const current = environment.get(target) || {
      value: defaultVariableValue(target),
      complete: false,
    };
    let next = value.value === '' && !isStringVariable(target)
      ? defaultVariableValue(target)
      : value.value;
    let complete = value.complete;
    if (command === 'INC') {
      if (isStringVariable(target) || !isFiniteNumber(current.value) || !isFiniteNumber(value.value)) {
        next = current.value + value.value;
      } else {
        next = String(Number(current.value) + Number(value.value));
      }
      complete = current.complete && value.complete;
    } else if (command === 'DEC' || command === 'MUL' || command === 'DIV') {
      if (!isFiniteNumber(current.value) || !isFiniteNumber(value.value)
        || (command === 'DIV' && Number(value.value) === 0)) {
        next = defaultVariableValue(target);
        complete = false;
      } else {
        const left = Number(current.value);
        const right = Number(value.value);
        next = String(command === 'DEC' ? left - right : command === 'MUL' ? left * right : left / right);
        complete = current.complete && value.complete;
      }
    }
    environment.set(target, {
      value: next,
      complete,
      sourceLabel,
      sourceLine: sourceLine + 1,
      dependencies: command === 'MOV'
        ? [...references.values()]
        : mergeDependencies(current.dependencies, [...references.values()]),
    });
    return;
  }

  if (command === 'MOVR') {
    const split = splitFirstArgument(rest);
    if (!split) return;
    const target = resolveTarget(split.argument, environment);
    if (target) environment.set(target, {
      value: defaultVariableValue(target),
      complete: false,
      sourceLabel,
      sourceLine: sourceLine + 1,
    });
    return;
  }

  if (command === 'SETSTRINGBLANK') {
    const target = resolveTarget(splitArguments(rest)[0] || '', environment);
    if (target) environment.set(target, {
      value: defaultVariableValue(target),
      complete: true,
      sourceLabel,
      sourceLine: sourceLine + 1,
    });
    return;
  }

  if (command === 'FORMULATION') {
    const parts = splitArgumentsWithSpans(rest);
    const targetPart = [...parts].reverse().find(part => resolveTarget(part.value, environment));
    const target = targetPart ? resolveTarget(targetPart.value, environment) : undefined;
    if (!target || !targetPart) return;
    const references = new Map<string, DialogResolvedVariable>();
    const expression = resolveTemplate(rest.slice(0, targetPart.end - targetPart.value.length).trim(), environment, references);
    const calculated = expression.complete ? calculateSimpleFormula(expression.value) : undefined;
    environment.set(target, {
      value: calculated ?? defaultVariableValue(target),
      complete: calculated !== undefined,
      sourceLabel,
      sourceLine: sourceLine + 1,
      dependencies: [...references.values()],
    });
    return;
  }

  const parts = splitArguments(rest);
  if (command === 'READCONFIGFILEITEM' && parts.length >= 4) {
    const target = resolveTarget(parts[3], environment);
    if (!target) return;
    const filePath = resolveTemplate(parts[0], environment);
    const section = resolveTemplate(parts[1], environment);
    const key = resolveTemplate(parts[2], environment);
    const result = options.dataOptions?.resolveConfigValues?.({
      path: filePath.value,
      section: section.value,
      key: key.value,
    });
    const value = filePath.complete && section.complete && key.complete
      && result?.complete && result.values.length === 1
      ? { value: result.values[0], complete: true }
      : { value: defaultVariableValue(target), complete: false };
    environment.set(target, { ...value, sourceLabel, sourceLine: sourceLine + 1 });
    return;
  }

  if (command === 'GETLISTSTRING' && parts.length >= 3) {
    const filePath = resolveTemplate(parts[0], environment);
    const list = options.dataOptions?.resolveListData?.({ path: filePath.value });
    const rowValue = resolveTemplate(parts[1], environment);
    const row = Number(rowValue.value);
    const targets = parts.slice(2)
      .map(value => resolveTarget(value, environment))
      .filter((target): target is string => target !== undefined);
    const line = Number.isInteger(row) && row >= 0 ? list?.lines[row] : undefined;
    const fields = line === undefined ? [] : splitListLine(line, targets.length);
    targets.forEach((target, index) => {
      const complete = filePath.complete && rowValue.complete
        && list?.complete === true && line !== undefined && fields[index] !== undefined;
      environment.set(target, {
        value: complete ? fields[index].trim() : defaultVariableValue(target),
        complete,
        sourceLabel,
        sourceLine: sourceLine + 1,
      });
    });
    return;
  }

  if (command === 'GETLISTSTRINGEX' && parts.length >= 3) {
    const filePath = resolveTemplate(parts[0], environment);
    const rowValue = resolveTemplate(parts[1], environment);
    const target = resolveTarget(parts[2], environment);
    if (!target) return;
    const list = options.dataOptions?.resolveListData?.({ path: filePath.value });
    const row = Number(rowValue.value);
    const line = Number.isInteger(row) && row >= 0 ? list?.lines[row] : undefined;
    const complete = filePath.complete && rowValue.complete && list?.complete === true && line !== undefined;
    environment.set(target, {
      value: complete ? line.trim() : defaultVariableValue(target),
      complete,
      sourceLabel,
      sourceLine: sourceLine + 1,
    });
    return;
  }

  if (command === 'CSVGETCELLTEXT' && parts.length >= 4) {
    const target = resolveTarget(parts[parts.length - 1], environment);
    if (!target) return;
    const filePath = resolveTemplate(parts[0], environment);
    const rowValue = resolveTemplate(parts[1], environment);
    const columnValue = resolveTemplate(parts[2], environment);
    const table = options.dataOptions?.resolveTableData?.({ path: filePath.value, format: 'csv' });
    const row = Number(rowValue.value);
    const column = Number(columnValue.value);
    const value = Number.isInteger(row) && Number.isInteger(column) && row >= 0 && column >= 0
      ? table?.rows[row]?.[column]
      : undefined;
    environment.set(target, {
      value: value ?? defaultVariableValue(target),
      complete: filePath.complete && rowValue.complete && columnValue.complete
        && table?.complete === true && value !== undefined,
      sourceLabel,
      sourceLine: sourceLine + 1,
    });
    return;
  }

  if (command === 'CSVGETCELLINFO' && parts.length >= 3) {
    const filePath = resolveTemplate(parts[0], environment);
    const table = options.dataOptions?.resolveTableData?.({ path: filePath.value, format: 'csv' });
    const targets = parts.slice(1, 3).map(value => resolveTarget(value, environment));
    const values = [
      table?.rows.length,
      table?.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0),
    ];
    targets.forEach((target, index) => {
      if (!target) return;
      const value = values[index];
      const complete = filePath.complete && table?.complete === true && value !== undefined;
      environment.set(target, {
        value: complete ? String(value) : defaultVariableValue(target),
        complete,
        sourceLabel,
        sourceLine: sourceLine + 1,
      });
    });
    return;
  }

  if (command === 'CSVFINDTEXTROW' && parts.length >= 6) {
    const target = resolveTarget(parts[parts.length - 1], environment);
    if (!target) return;
    const filePath = resolveTemplate(parts[0], environment);
    const search = resolveTemplate(parts[1], environment);
    const range = resolveTemplate(parts[2], environment);
    const columnValue = resolveTemplate(parts[3], environment);
    const modeValue = resolveTemplate(parts[4], environment);
    const table = options.dataOptions?.resolveTableData?.({ path: filePath.value, format: 'csv' });
    const found = findCsvRow(
      table?.rows || [],
      search.value,
      range.value,
      Number(columnValue.value),
      Number(modeValue.value)
    );
    const complete = filePath.complete && search.complete && range.complete
      && columnValue.complete && modeValue.complete && table?.complete === true;
    environment.set(target, {
      value: complete ? String(found) : defaultVariableValue(target),
      complete,
      sourceLabel,
      sourceLine: sourceLine + 1,
    });
    return;
  }

  if (command === 'GETDBITEMFIELDVALUE' && parts.length >= 3) {
    const target = resolveTarget(parts[parts.length - 1], environment);
    if (!target) return;
    const itemName = resolveTemplate(parts[0], environment);
    const field = resolveTemplate(parts.slice(1, -1).join(' '), environment);
    const result = itemName.complete && field.complete
      ? options.dataOptions?.resolveDatabaseField?.({
        itemName: itemName.value,
        field: field.value,
      })
      : undefined;
    environment.set(target, {
      value: result?.complete ? result.value : defaultVariableValue(target),
      complete: result?.complete === true,
      sourceLabel,
      sourceLine: sourceLine + 1,
    });
    return;
  }

  if (command === 'EXTRACTSTRING' && parts.length >= 3) {
    const delimiter = stripQuotes(parts[0]);
    const source = resolveTemplate(parts[1], environment);
    const values = delimiter ? source.value.split(delimiter) : [source.value];
    parts.slice(2).forEach((rawTarget, index) => {
      const target = resolveTarget(rawTarget, environment);
      if (!target) return;
      environment.set(target, {
        value: values[index] ?? defaultVariableValue(target),
        complete: source.complete && values[index] !== undefined,
        sourceLabel,
        sourceLine: sourceLine + 1,
      });
    });
    return;
  }

  if (/^(?:READSQL|CALLDLL|HTTPGET|HTTPPOST)$/.test(command)) {
    const target = [...parts].reverse().map(value => resolveTarget(value, environment)).find(Boolean);
    if (target) environment.set(target, {
      value: defaultVariableValue(target),
      complete: false,
      sourceLabel,
      sourceLine: sourceLine + 1,
    });
  }
}

function resolveTarget(raw: string, environment: ReadonlyMap<string, RuntimeValue>): string | undefined {
  const value = raw.trim();
  if (VARIABLE_NAME.test(value)) return normalizeScriptVariableName(value);
  if (value.includes('<$')) {
    const resolved = resolveTemplate(value, environment).value.trim();
    if (VARIABLE_NAME.test(resolved)) return normalizeScriptVariableName(resolved);
  }
  return undefined;
}

function resolveTargetLines(
  section: ScriptFunction,
  execution: LabelExecution
): DialogLabelVariableResolution {
  const lines = new Map<number, DialogResolvedLine>();
  for (const line of section.lines) {
    const variables = new Map<string, DialogResolvedVariable>();
    const environment = execution.snapshots.get(line.lineNumber) || execution.finalValues;
    const resolved = resolveTemplate(line.text, environment, variables);
    if (resolved.value !== line.text || variables.size > 0) {
      lines.set(line.lineNumber, { text: resolved.value, variables: [...variables.values()] });
    }
  }
  return { lines };
}

function resolveTemplate(
  input: string,
  environment: ReadonlyMap<string, RuntimeValue>,
  references?: Map<string, DialogResolvedVariable>
): TemplateResult {
  let value = input;
  let complete = true;
  for (let pass = 0; pass < MAX_TEMPLATE_PASSES; pass++) {
    const resolved = resolveTemplatePass(value, environment, references);
    complete = complete && resolved.complete;
    if (resolved.value === value) return { value, complete };
    value = resolved.value;
  }
  return { value, complete: false };
}

function resolveTemplatePass(
  input: string,
  environment: ReadonlyMap<string, RuntimeValue>,
  references?: Map<string, DialogResolvedVariable>
): TemplateResult {
  let output = '';
  let complete = true;
  for (let cursor = 0; cursor < input.length;) {
    const prefix = /^<\$STR\(/i.exec(input.slice(cursor));
    if (prefix) {
      const end = findStrExpressionEnd(input, cursor + prefix[0].length);
      if (end) {
        const inner = input.slice(cursor + prefix[0].length, end.closeParen);
        const resolvedInner = resolveTemplate(inner, environment);
        const variableName = resolvedInner.value.trim();
        const variable = readVariable(variableName, environment);
        const replacement = variable || {
          value: VARIABLE_NAME.test(variableName) ? defaultVariableValue(variableName) : variableName,
          complete: !VARIABLE_NAME.test(variableName),
        };
        output += replacement.value;
        complete = complete && resolvedInner.complete && replacement.complete;
        recordReference(references, variableName, replacement);
        cursor = end.after;
        continue;
      }
    }
    if (input.startsWith('<$', cursor)) {
      const end = input.indexOf('>', cursor + 2);
      if (end > cursor) {
        const variableName = input.slice(cursor + 2, end).trim();
        const variable = readVariable(variableName, environment);
        const replacement = variable || {
          value: VARIABLE_NAME.test(variableName) ? defaultVariableValue(variableName) : '',
          complete: false,
        };
        output += replacement.value;
        complete = complete && replacement.complete;
        recordReference(references, variableName, replacement);
        cursor = end + 1;
        continue;
      }
    }
    output += input[cursor++];
  }
  return { value: output, complete };
}

function readVariable(
  rawName: string,
  environment: ReadonlyMap<string, RuntimeValue>
): RuntimeValue | undefined {
  if (!VARIABLE_NAME.test(rawName)) return undefined;
  return environment.get(normalizeScriptVariableName(rawName));
}

function recordReference(
  references: Map<string, DialogResolvedVariable> | undefined,
  rawName: string,
  value: RuntimeValue
): void {
  if (!references || !VARIABLE_NAME.test(rawName)) return;
  const name = normalizeScriptVariableName(rawName);
  references.set(name, {
    name,
    value: value.value,
    status: value.complete ? 'resolved' : 'default',
    sourceLabel: value.sourceLabel,
    sourceLine: value.sourceLine,
  });
  for (const dependency of value.dependencies || []) {
    if (!references.has(dependency.name)) references.set(dependency.name, dependency);
  }
}

function findStrExpressionEnd(
  input: string,
  contentStart: number
): { closeParen: number; after: number } | undefined {
  let depth = 1;
  for (let cursor = contentStart; cursor < input.length; cursor++) {
    if (input[cursor] === '(') depth++;
    else if (input[cursor] === ')' && --depth === 0) {
      if (input[cursor + 1] === '>') return { closeParen: cursor, after: cursor + 2 };
      return undefined;
    }
  }
  return undefined;
}

function parseCommand(line: string): { name: string; rest: string } | undefined {
  const match = /^\s*(?:<\$[^>]+>\.)?([A-Za-z][A-Za-z0-9_]*)\b([\s\S]*)$/i.exec(line);
  return match ? { name: match[1].toUpperCase(), rest: match[2].trim() } : undefined;
}

function directiveName(line: string): string | undefined {
  const match = /^\s*#(IF|OR|ACT|ELSEACT|SAY|ELSESAY)(?:\s*\([^)]*\))?\s*$/i.exec(line);
  return match?.[1].toUpperCase();
}

function conditionGroupId(label: string, number: number): string {
  return `${normalizeLabel(label)}:CONDITION:${number}`;
}

function splitFirstArgument(value: string): { argument: string; remainder: string } | undefined {
  const parts = splitArgumentsWithSpans(value);
  if (parts.length === 0) return undefined;
  return {
    argument: parts[0].value,
    remainder: value.slice(parts[0].end).trim(),
  };
}

function splitArguments(value: string): string[] {
  return splitArgumentsWithSpans(value).map(part => part.value);
}

function splitArgumentsWithSpans(value: string): Array<{ value: string; end: number }> {
  const result: Array<{ value: string; end: number }> = [];
  let start = -1;
  let angleDepth = 0;
  let braceDepth = 0;
  let quote = '';
  for (let cursor = 0; cursor <= value.length; cursor++) {
    const char = value[cursor] || ' ';
    if (start < 0) {
      if (/\s/.test(char)) continue;
      start = cursor;
    }
    if (quote) {
      if (char === quote && value[cursor - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '<') angleDepth++;
    else if (char === '>' && angleDepth > 0) angleDepth--;
    else if (char === '{') braceDepth++;
    else if (char === '}' && braceDepth > 0) braceDepth--;
    if ((cursor === value.length || /\s/.test(char)) && angleDepth === 0 && braceDepth === 0 && !quote) {
      result.push({ value: value.slice(start, cursor), end: cursor });
      start = -1;
    }
  }
  return result;
}

function splitListLine(line: string, targetCount: number): string[] {
  if (targetCount <= 1) return [line];
  const separator = line.indexOf(':');
  if (targetCount === 2 && separator >= 0) {
    return [line.slice(0, separator), line.slice(separator + 1)];
  }
  return line.split(':');
}

function findCsvRow(
  rows: readonly (readonly string[])[],
  search: string,
  rangeExpression: string,
  column: number,
  mode: number
): number {
  if (!Number.isInteger(column) || column < 0) return -1;
  const range = /^\s*(\d+)\s*[~-]\s*(\d+)\s*$/.exec(rangeExpression);
  const start = range ? Number(range[1]) : 0;
  const end = range ? Number(range[2]) : Math.max(0, rows.length - 1);
  const matches: number[] = [];
  for (let row = Math.max(0, start); row <= Math.min(end, rows.length - 1); row++) {
    if (String(rows[row]?.[column] ?? '') === search) matches.push(row);
  }
  return mode === 1 ? (matches[matches.length - 1] ?? -1) : (matches[0] ?? -1);
}

function mergeDependencies(
  left: readonly DialogResolvedVariable[] | undefined,
  right: readonly DialogResolvedVariable[]
): DialogResolvedVariable[] {
  const result = new Map<string, DialogResolvedVariable>();
  for (const dependency of [...(left || []), ...right]) result.set(dependency.name, dependency);
  return [...result.values()];
}

function calculateSimpleFormula(rawExpression: string): string | undefined {
  const source = rawExpression.trim()
    .replace(/^\[|\]$/g, '')
    .replace(/(\d+(?:\.\d+)?)%(?![\d.(])/g, '($1/100)');
  const tokens = source.match(/\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_]*|>=|<=|==|!=|[()+\-*/%^,<>=]/g) || [];
  if (tokens.join('') !== source.replace(/\s+/g, '')) return undefined;
  let cursor = 0;

  const parseExpression = (): number | undefined => parseComparison();
  const parseComparison = (): number | undefined => {
    let left = parseAdditive();
    if (left === undefined) return undefined;
    while (/^(?:>=|<=|==|!=|>|<|=)$/.test(tokens[cursor] || '')) {
      const operator = tokens[cursor++];
      const right = parseAdditive();
      if (right === undefined) return undefined;
      if (operator === '>=') left = left >= right ? 1 : 0;
      else if (operator === '<=') left = left <= right ? 1 : 0;
      else if (operator === '>' ) left = left > right ? 1 : 0;
      else if (operator === '<') left = left < right ? 1 : 0;
      else if (operator === '!=' ) left = left !== right ? 1 : 0;
      else left = left === right ? 1 : 0;
    }
    return left;
  };
  const parseAdditive = (): number | undefined => {
    let left = parseMultiplicative();
    if (left === undefined) return undefined;
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operator = tokens[cursor++];
      const right = parseMultiplicative();
      if (right === undefined) return undefined;
      left = operator === '+' ? left + right : left - right;
    }
    return left;
  };
  const parseMultiplicative = (): number | undefined => {
    let left = parsePower();
    if (left === undefined) return undefined;
    while (tokens[cursor] === '*' || tokens[cursor] === '/' || tokens[cursor] === '%') {
      const operator = tokens[cursor++];
      const right = parsePower();
      if (right === undefined || ((operator === '/' || operator === '%') && right === 0)) return undefined;
      left = operator === '*' ? left * right : operator === '/' ? left / right : left % right;
    }
    return left;
  };
  const parsePower = (): number | undefined => {
    let left = parseUnary();
    if (left === undefined) return undefined;
    while (tokens[cursor] === '^') {
      cursor++;
      const right = parseUnary();
      if (right === undefined) return undefined;
      left = Math.pow(left, right);
    }
    return left;
  };
  const parseUnary = (): number | undefined => {
    if (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operator = tokens[cursor++];
      const value = parseUnary();
      return value === undefined ? undefined : operator === '-' ? -value : value;
    }
    return parsePrimary();
  };
  const parsePrimary = (): number | undefined => {
    const token = tokens[cursor++];
    if (!token) return undefined;
    if (/^\d/.test(token)) return Number(token);
    if (token === '(') {
      const value = parseExpression();
      if (tokens[cursor++] !== ')') return undefined;
      return value;
    }
    if (/^[A-Za-z_]/.test(token) && tokens[cursor] === '(') {
      cursor++;
      const args: number[] = [];
      if (tokens[cursor] !== ')') {
        while (true) {
          const value = parseExpression();
          if (value === undefined) return undefined;
          args.push(value);
          if (tokens[cursor] !== ',') break;
          cursor++;
        }
      }
      if (tokens[cursor++] !== ')') return undefined;
      return calculateFormulaFunction(token, args);
    }
    return undefined;
  };

  const value = parseExpression();
  if (value === undefined || cursor !== tokens.length || !Number.isFinite(value)) return undefined;
  return String(Number.isInteger(value) ? value : Number(value.toFixed(8)));
}

function calculateFormulaFunction(name: string, args: readonly number[]): number | undefined {
  switch (name.toUpperCase()) {
    case 'IF': return args.length === 3 ? (args[0] !== 0 ? args[1] : args[2]) : undefined;
    case 'MIN': return args.length > 0 ? Math.min(...args) : undefined;
    case 'MAX': return args.length > 0 ? Math.max(...args) : undefined;
    case 'SUM': return args.reduce((sum, value) => sum + value, 0);
    case 'AVG': return args.length > 0 ? args.reduce((sum, value) => sum + value, 0) / args.length : undefined;
    case 'ABS': return args.length === 1 ? Math.abs(args[0]) : undefined;
    case 'ROUND': return args.length === 1 ? Math.round(args[0]) : undefined;
    case 'FLOOR': return args.length === 1 ? Math.floor(args[0]) : undefined;
    case 'CEIL': return args.length === 1 ? Math.ceil(args[0]) : undefined;
    case 'MOD': return args.length === 2 && args[1] !== 0 ? args[0] % args[1] : undefined;
    default: return undefined;
  }
}

function uiLinkReferences(source: string): string[] {
  const result = new Set<string>();
  const patterns = [
    /\/\s*(@[^>\s|}]+)/g,
    /\b(?:LINK|CLICK|ACTION|EVENT|ONCLICK)\s*=\s*(@[^|>\s},]+)/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) result.add(match[1]);
  }
  return [...result];
}

function cloneEnvironment(source: ReadonlyMap<string, RuntimeValue>): Map<string, RuntimeValue> {
  return new Map([...source].map(([key, value]) => [key, { ...value }]));
}

function defaultVariableValue(rawName: string): string {
  return isStringVariable(rawName) ? '' : '0';
}

function isStringVariable(rawName: string): boolean {
  return /^(?:(?:GL|[SLD])\$)/i.test(rawName.trim());
}

function isFiniteNumber(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value));
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function cleanTargetLabel(value: string): string {
  return value.trim().replace(/[>,)}\]]+$/, '');
}

function normalizeLabel(value: string): string {
  return value.trim().toUpperCase();
}
