import { NestedVariableAnalysisOptions } from '../utils/nested-variable-analysis';
import { normalizeScriptVariableName } from '../utils/variable-statistics';
import { EngineId } from '../types';
import {
  DialogResolvedVariable,
  DialogVariableSourceReference,
} from './model';

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
  previewValue?: string;
  complete: boolean;
  staticValueSource?: 'database-item-index';
  sourceLabel?: string;
  sourceLine?: number;
  sourceReferences?: DialogVariableSourceReference[];
  dependencies?: DialogResolvedVariable[];
}

interface TemplateResult {
  value: string;
  complete: boolean;
}

interface ResolveTemplateOptions {
  previewUnknownText?: boolean;
}

interface LabelExecution {
  snapshots: Map<number, Map<string, RuntimeValue>>;
  finalValues: Map<string, RuntimeValue>;
}

interface RuntimeFileEffects {
  /** Paths whose on-disk bytes may be replaced by an earlier runtime command. */
  invalidatedListPaths: Set<string>;
  /** A dynamic output path can alias any later list read, so fail closed. */
  unknownListWrite: boolean;
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
  engine: EngineId;
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
    const fileEffects: RuntimeFileEffects = {
      invalidatedListPaths: new Set(),
      unknownListWrite: false,
    };
    const snapshotsByLabel = new Map<string, Map<number, Map<string, RuntimeValue>>>();
    executeFunction(
      root.label,
      byName,
      environment,
      snapshotsByLabel,
      options,
      warnings,
      fileEffects,
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
          fileEffects,
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
        fileEffects,
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
  fileEffects: RuntimeFileEffects,
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
      const conditionCommand = parseConditionCommand(trimmed);
      if (conditionCommand) {
        invalidateConditionRuntimeOutputs(
          conditionCommand.name,
          conditionCommand.rest,
          options.engine,
          environment,
          section.label,
          line.lineNumber
        );
      }
      continue;
    }
    if (!actionEnabled) continue;
    const command = parseCommand(trimmed);
    if (!command) continue;
    if (command.name === 'GOTO') {
      const invocation = parseGotoInvocation(command.rest);
      const returnTargets = (invocation?.returnTargets || [])
        .map(rawTarget => resolveRuntimeOutputTarget(rawTarget, environment))
        .filter((target): target is string => target !== undefined);
      if (invocation?.target.startsWith('@')) {
        executeFunction(
          invocation.target,
          byName,
          environment,
          snapshotsByLabel,
          options,
          warnings,
          fileEffects,
          nextStack
        );
      }
      for (const target of returnTargets) {
        setUnknownRuntimeValue(environment, target, section.label, line.lineNumber);
      }
      continue;
    }
    if (command.name === 'BREAK' || command.name === 'RETURN') break;
    executeAssignment(
      command.name,
      command.rest,
      environment,
      options,
      warnings,
      fileEffects,
      section.label,
      line.lineNumber
    );
  }
}

function executeAssignment(
  command: string,
  rest: string,
  environment: Map<string, RuntimeValue>,
  options: ResolveDialogVariablesOptions,
  warnings: string[],
  fileEffects: RuntimeFileEffects,
  sourceLabel: string,
  sourceLine: number
): void {
  if (command === 'MIRRORMAPTIME' && (options.engine === 'GOM' || options.engine === '996PC')) {
    // Both documented implementations write the newly-created mirror map id
    // through the implicit D99 channel. It is runtime state, never a reusable
    // static database IDX capability.
    setUnknownRuntimeValue(environment, 'D99', sourceLabel, sourceLine);
    return;
  }

  const listOutputPaths = runtimeListWriterOutputPaths(command, rest, environment);
  if (listOutputPaths) {
    if (listOutputPaths.length === 0) fileEffects.unknownListWrite = true;
    for (const path of listOutputPaths) fileEffects.invalidatedListPaths.add(path);
    return;
  }
  if (command === 'MOV' || command === 'INC' || command === 'DEC'
    || command === 'MUL' || command === 'DIV') {
    const split = splitFirstArgument(rest);
    if (!split) return;
    const target = resolveTarget(split.argument, environment);
    if (!target) return;
    const references = new Map<string, DialogResolvedVariable>();
    const value = resolveTemplate(split.remainder, environment, references);
    const preview = resolveTemplate(
      split.remainder,
      environment,
      undefined,
      { previewUnknownText: true }
    );
    const current = environment.get(target) || {
      value: defaultVariableValue(target),
      complete: false,
    };
    let next = value.value === '' && !isStringVariable(target)
      ? defaultVariableValue(target)
      : value.value;
    let nextPreview = preview.value === '' && !isStringVariable(target)
      ? defaultVariableValue(target)
      : preview.value;
    let complete = value.complete;
    if (command === 'INC') {
      if (isStringVariable(target) || !isFiniteNumber(current.value) || !isFiniteNumber(value.value)) {
        next = current.value + value.value;
        nextPreview = (current.previewValue ?? current.value) + preview.value;
      } else {
        next = String(Number(current.value) + Number(value.value));
        nextPreview = next;
      }
      complete = current.complete && value.complete;
    } else if (command === 'DEC' || command === 'MUL' || command === 'DIV') {
      if (!isFiniteNumber(current.value) || !isFiniteNumber(value.value)
        || (command === 'DIV' && Number(value.value) === 0)) {
        next = defaultVariableValue(target);
        nextPreview = next;
        complete = false;
      } else {
        const left = Number(current.value);
        const right = Number(value.value);
        next = String(command === 'DEC' ? left - right : command === 'MUL' ? left * right : left / right);
        nextPreview = next;
        complete = current.complete && value.complete;
      }
    }
    environment.set(target, {
      value: next,
      previewValue: nextPreview,
      complete,
      sourceLabel,
      sourceLine: sourceLine + 1,
      sourceReferences: command === 'MOV'
        ? [{ sourceLabel, sourceLine: sourceLine + 1 }]
        : mergeSourceReferences(
          runtimeSourceReferences(current),
          [{ sourceLabel, sourceLine: sourceLine + 1 }]
        ),
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
  const unknownOutputTargets = unmodeledRuntimeOutputTargets(command, parts, environment);
  if (unknownOutputTargets) {
    for (const target of unknownOutputTargets) {
      setUnknownRuntimeValue(environment, target, sourceLabel, sourceLine);
    }
    return;
  }
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
    const invalidated = listReadWasInvalidated(filePath, fileEffects);
    const list = invalidated
      ? undefined
      : options.dataOptions?.resolveListData?.({ path: filePath.value });
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
    if (invalidated) {
      warnings.push(
        `列表 ${filePath.value || parts[0]} 在读取前会被运行时命令改写；Ctrl+F12 已禁止借用磁盘旧快照`
      );
    }
    return;
  }

  if (command === 'GETLISTSTRINGEX' && parts.length >= 3) {
    const filePath = resolveTemplate(parts[0], environment);
    const rowValue = resolveTemplate(parts[1], environment);
    const target = resolveTarget(parts[2], environment);
    if (!target) return;
    const invalidated = listReadWasInvalidated(filePath, fileEffects);
    const list = invalidated
      ? undefined
      : options.dataOptions?.resolveListData?.({ path: filePath.value });
    const row = Number(rowValue.value);
    const line = Number.isInteger(row) && row >= 0 ? list?.lines[row] : undefined;
    const complete = filePath.complete && rowValue.complete && list?.complete === true && line !== undefined;
    environment.set(target, {
      value: complete ? line.trim() : defaultVariableValue(target),
      complete,
      sourceLabel,
      sourceLine: sourceLine + 1,
    });
    if (invalidated) {
      warnings.push(
        `列表 ${filePath.value || parts[0]} 在读取前会被运行时命令改写；Ctrl+F12 已禁止借用磁盘旧快照`
      );
    }
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
    const rawTarget = parts[parts.length - 1];
    const target = resolveTarget(rawTarget, environment);
    if (!target) return;
    const rawItemName = parts[0];
    const rawField = parts.slice(1, -1).join(' ');
    const itemName = resolveTemplate(rawItemName, environment);
    const field = resolveTemplate(rawField, environment);
    const result = itemName.complete && field.complete
      ? options.dataOptions?.resolveDatabaseField?.({
        itemName: itemName.value,
        field: field.value,
      })
      : undefined;
    environment.set(target, {
      value: result?.complete ? result.value : defaultVariableValue(target),
      complete: result?.complete === true,
      ...(result?.complete === true
        && parts.length === 3
        && !/<\$/i.test(rawItemName)
        && rawField.trim().toUpperCase() === 'IDX'
        && VARIABLE_NAME.test(rawTarget.trim())
        ? { staticValueSource: 'database-item-index' as const }
        : {}),
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
    return;
  }

  // Unknown commands are a capability boundary. A raw standalone variable may
  // be an undocumented output target, so revoke an existing database IDX value
  // conservatively. Embedded input expressions such as <$STR(N$IDX)> are not
  // standalone tokens and therefore remain untouched.
  for (const rawArgument of parts) {
    const rawTarget = rawArgument.trim();
    if (!VARIABLE_NAME.test(rawTarget)) continue;
    const target = normalizeScriptVariableName(rawTarget);
    if (environment.get(target)?.staticValueSource !== 'database-item-index') continue;
    setUnknownRuntimeValue(environment, target, sourceLabel, sourceLine);
  }
}

function unmodeledRuntimeOutputTargets(
  command: string,
  parts: readonly string[],
  environment: ReadonlyMap<string, RuntimeValue>
): string[] | undefined {
  const outputIndexes: Readonly<Record<string, readonly number[]>> = {
    CALCPER: [2],
    GETRANDOMLINETEXT: [1],
    GETRANDOMLINETEXTEX: [1],
  };
  const indexes = outputIndexes[command];
  if (!indexes) return undefined;
  return indexes.flatMap(index => {
    const target = resolveRuntimeOutputTarget(parts[index] || '', environment);
    return target ? [target] : [];
  });
}

function setUnknownRuntimeValue(
  environment: Map<string, RuntimeValue>,
  target: string,
  sourceLabel: string,
  sourceLine: number
): void {
  environment.set(target, {
    value: defaultVariableValue(target),
    complete: false,
    sourceLabel,
    sourceLine: sourceLine + 1,
  });
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

/**
 * Output positions in several engine commands are documented both as a raw
 * variable and as a direct projection such as `<$STR(N$1)>`.  Evaluating the
 * latter first turns it into the old value (for example `935`) and loses the
 * identity of the variable that the runtime command will overwrite.  Recover
 * only an exact one-variable projection here; concatenated or nested
 * expressions remain outside the static contract.  The ordinary resolver is
 * retained as a fallback for a statically known indirect target name.
 */
function resolveRuntimeOutputTarget(
  raw: string,
  environment: ReadonlyMap<string, RuntimeValue>
): string | undefined {
  const value = raw.trim();
  if (VARIABLE_NAME.test(value)) return normalizeScriptVariableName(value);
  for (const pattern of [
    /^<\$\s*STR\(\s*([^()]+?)\s*\)\s*>$/i,
    /^\$STR\(\s*([^()]+?)\s*\)$/i,
    /^<\$\s*([^<>]+?)\s*>$/i,
  ]) {
    const match = pattern.exec(value);
    const target = match?.[1]?.trim();
    if (target && VARIABLE_NAME.test(target)) return normalizeScriptVariableName(target);
  }
  return resolveTarget(value, environment);
}

function resolveTargetLines(
  section: ScriptFunction,
  execution: LabelExecution
): DialogLabelVariableResolution {
  const lines = new Map<number, DialogResolvedLine>();
  for (const line of section.lines) {
    const variables = new Map<string, DialogResolvedVariable>();
    const environment = execution.snapshots.get(line.lineNumber) || execution.finalValues;
    const resolved = resolveTemplate(
      line.text,
      environment,
      variables,
      { previewUnknownText: true }
    );
    if (resolved.value !== line.text || variables.size > 0) {
      lines.set(line.lineNumber, { text: resolved.value, variables: [...variables.values()] });
    }
  }
  return { lines };
}

function resolveTemplate(
  input: string,
  environment: ReadonlyMap<string, RuntimeValue>,
  references?: Map<string, DialogResolvedVariable>,
  options: ResolveTemplateOptions = {}
): TemplateResult {
  let value = input;
  let complete = true;
  for (let pass = 0; pass < MAX_TEMPLATE_PASSES; pass++) {
    const resolved = resolveTemplatePass(value, environment, references, options);
    complete = complete && resolved.complete;
    if (resolved.value === value) return { value, complete };
    value = resolved.value;
  }
  return { value, complete: false };
}

function resolveTemplatePass(
  input: string,
  environment: ReadonlyMap<string, RuntimeValue>,
  references: Map<string, DialogResolvedVariable> | undefined,
  options: ResolveTemplateOptions
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
        output += previewRuntimeValue(variableName, replacement, options);
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
        output += previewRuntimeValue(variableName, replacement, options);
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
    ...(value.staticValueSource ? { staticValueSource: value.staticValueSource } : {}),
    sourceLabel: value.sourceLabel,
    sourceLine: value.sourceLine,
    sourceReferences: runtimeSourceReferences(value),
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

function parseConditionCommand(line: string): { name: string; rest: string } | undefined {
  let source = line.trim();
  while (/^NOT(?:\s+|$)/i.test(source)) source = source.replace(/^NOT(?:\s+|$)/i, '').trim();
  return parseCommand(source);
}

const CONDITION_RUNTIME_OUTPUT_INDEXES: Readonly<
  Record<EngineId, Readonly<Record<string, readonly number[]>>>
> = {
  GOM: {
    CHECKBAGITEM: [1],
    CHECKSLAVENAME: [1],
    CHECKITEMADDVALUE: [4],
    CHECKITEMADDVALUEEX: [4],
    CHECKNAMEDATETIMELIST: [2, 3, 4, 5],
    CHECKNAMELISTPOSITION: [3],
    CHECKREVIVAL: [0],
    CHECKSKILL: [4, 5],
    CHECKUSERDATE: [3, 4],
    FINDMONPOINT: [2, 3, 4],
    GETGUILDMEMBERCOUNT: [1],
    GETSHOPITEMCOUNT: [1, 3],
    GETSTRINGPOSEX: [2, 3],
  },
  GEE: {
    CHECKITEMADDVALUE: [4],
    CHECKNAMEDATETIMELIST: [2, 3, 4, 5],
    CHECKNAMELISTPOSITION: [3],
    CHECKUSERDATE: [3, 4],
    FINDMONPOINT: [2, 3],
    GETGUILDMEMBERCOUNT: [1],
    GETSTRINGPOSEX: [2, 3],
  },
  '996PC': {
    CHECKBAGITEM: [1],
    CHECKITEMADDVALUE: [4],
    CHECKNAMEDATETIMELIST: [2, 3, 4, 5],
    CHECKNAMELISTPOSITION: [3],
    CHECKREVIVAL: [0],
    GETSTRINGPOSEX: [2, 3],
  },
};

function invalidateConditionRuntimeOutputs(
  command: string,
  rest: string,
  engine: EngineId,
  environment: Map<string, RuntimeValue>,
  sourceLabel: string,
  sourceLine: number
): void {
  if (command === 'CHECKNAMELISTPOSITION' && (engine === 'GOM' || engine === 'GEE')) {
    // The classic GOM/GEE contract also writes the matched list position to
    // the implicit P0 register when no explicit fourth output is supplied.
    // That runtime value must replace any earlier database-Idx capability.
    setUnknownRuntimeValue(environment, 'P0', sourceLabel, sourceLine);
  }
  const indexes = CONDITION_RUNTIME_OUTPUT_INDEXES[engine][command];
  if (!indexes) return;
  const parts = splitArguments(rest);
  for (const index of indexes) {
    const target = resolveRuntimeOutputTarget(parts[index] || '', environment);
    if (target) setUnknownRuntimeValue(environment, target, sourceLabel, sourceLine);
  }
}

interface GotoInvocation {
  target: string;
  returnTargets: string[];
}

function parseGotoInvocation(rest: string): GotoInvocation | undefined {
  const source = rest.trim();
  if (!source.startsWith('@')) return undefined;
  const open = source.indexOf('(');
  if (open < 0) {
    return {
      target: cleanTargetLabel(source.split(/\s+/)[0] || ''),
      returnTargets: [],
    };
  }

  const target = cleanTargetLabel(source.slice(0, open));
  const close = findGotoCallClose(source, open);
  if (close < 0) return { target, returnTargets: [] };
  const argumentsText = source.slice(open + 1, close);
  const returnSeparator = findTopLevelDelimiter(argumentsText, '|');
  if (returnSeparator < 0) return { target, returnTargets: [] };
  return {
    target,
    returnTargets: splitTopLevelDelimited(argumentsText.slice(returnSeparator + 1), ','),
  };
}

function findGotoCallClose(value: string, open: number): number {
  let depth = 0;
  let angleDepth = 0;
  let quote = '';
  for (let cursor = open; cursor < value.length; cursor++) {
    const char = value[cursor];
    if (quote) {
      if (char === quote && value[cursor - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '<' && value[cursor + 1] === '$') {
      angleDepth++;
      continue;
    }
    if (char === '>' && angleDepth > 0) {
      angleDepth--;
      continue;
    }
    if (angleDepth > 0) continue;
    if (char === '(') depth++;
    else if (char === ')' && --depth === 0) return cursor;
  }
  return -1;
}

function findTopLevelDelimiter(value: string, delimiter: string): number {
  let parenDepth = 0;
  let angleDepth = 0;
  let braceDepth = 0;
  let quote = '';
  for (let cursor = 0; cursor < value.length; cursor++) {
    const char = value[cursor];
    if (quote) {
      if (char === quote && value[cursor - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '<' && value[cursor + 1] === '$') angleDepth++;
    else if (char === '>' && angleDepth > 0) angleDepth--;
    else if (char === '{') braceDepth++;
    else if (char === '}' && braceDepth > 0) braceDepth--;
    else if (char === '(') parenDepth++;
    else if (char === ')' && parenDepth > 0) parenDepth--;
    else if (char === delimiter && parenDepth === 0 && angleDepth === 0 && braceDepth === 0) return cursor;
  }
  return -1;
}

function splitTopLevelDelimited(value: string, delimiter: string): string[] {
  const result: string[] = [];
  let remaining = value;
  while (remaining) {
    const index = findTopLevelDelimiter(remaining, delimiter);
    const part = (index < 0 ? remaining : remaining.slice(0, index)).trim();
    if (part) result.push(part);
    if (index < 0) break;
    remaining = remaining.slice(index + delimiter.length);
  }
  return result;
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
    else if (char === '<' && value[cursor + 1] === '$') angleDepth++;
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

/**
 * File-producing ranking commands execute inside the game server. If one is
 * active before GETLISTSTRING, the current disk bytes are a pre-execution
 * snapshot rather than proof of what that read will observe.
 */
function runtimeListWriterOutputPaths(
  command: string,
  rest: string,
  environment: ReadonlyMap<string, RuntimeValue>
): string[] | undefined {
  const outputIndexes: Readonly<Record<string, readonly number[]>> = {
    SORTHUMVARTOLISTEX: [3],
    SORTHUMVARTOLIST: [1, 3],
    SORTVARTOLIST: [2],
    SORTGUILDTOLIST: [0],
  };
  const indexes = outputIndexes[command];
  if (!indexes) return undefined;
  const parts = splitArguments(rest);
  const outputs: string[] = [];
  let unknown = false;
  for (const index of indexes) {
    if (index >= parts.length) continue;
    const resolved = resolveTemplate(parts[index], environment);
    const normalized = resolved.complete
      ? normalizeScriptDataPath(resolved.value)
      : undefined;
    if (normalized) outputs.push(normalized);
    else unknown = true;
  }
  return unknown || outputs.length === 0 ? [] : [...new Set(outputs)];
}

function listReadWasInvalidated(
  filePath: TemplateResult,
  effects: RuntimeFileEffects
): boolean {
  if (effects.unknownListWrite) return true;
  if (!filePath.complete) return false;
  const normalized = normalizeScriptDataPath(filePath.value);
  return Boolean(normalized && effects.invalidatedListPaths.has(normalized));
}

function normalizeScriptDataPath(value: string): string | undefined {
  const raw = value.trim().replace(/^["']|["']$/g, '').replace(/\//g, '\\');
  if (!raw || /<\$/i.test(raw)) return undefined;
  const prefix = /^[A-Za-z]:/.exec(raw)?.[0]?.toUpperCase();
  const absolute = raw.startsWith('\\');
  const body = prefix ? raw.slice(prefix.length) : raw;
  const segments: string[] = [];
  for (const segment of body.split(/\\+/)) {
    if (!segment || segment === '.') continue;
    if (segment === '..' && segments.length > 0 && segments.at(-1) !== '..') {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  const normalizedBody = segments.join('\\').toUpperCase();
  if (!normalizedBody && !prefix && !absolute) return undefined;
  return `${prefix || ''}${absolute ? '\\' : ''}${normalizedBody}`;
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

function runtimeSourceReferences(value: RuntimeValue): DialogVariableSourceReference[] {
  if (value.sourceReferences?.length) return [...value.sourceReferences];
  return value.sourceLabel && value.sourceLine !== undefined
    ? [{ sourceLabel: value.sourceLabel, sourceLine: value.sourceLine }]
    : [];
}

function mergeSourceReferences(
  left: readonly DialogVariableSourceReference[],
  right: readonly DialogVariableSourceReference[]
): DialogVariableSourceReference[] {
  const result = new Map<string, DialogVariableSourceReference>();
  for (const reference of [...left, ...right]) {
    result.set(`${normalizeLabel(reference.sourceLabel)}:${reference.sourceLine}`, reference);
  }
  return [...result.values()];
}

function previewRuntimeValue(
  variableName: string,
  value: RuntimeValue,
  options: ResolveTemplateOptions
): string {
  if (options.previewUnknownText && value.previewValue !== undefined) {
    return value.previewValue;
  }
  if (
    options.previewUnknownText
    && !value.complete
    && value.value === ''
    && isStringVariable(variableName)
  ) {
    return '预览文字';
  }
  return value.value;
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
