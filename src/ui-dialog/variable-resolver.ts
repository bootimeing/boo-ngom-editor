import { NestedVariableAnalysisOptions } from '../utils/nested-variable-analysis';
import { normalizeScriptVariableName } from '../utils/variable-statistics';
import { EngineId } from '../types';
import { isClientTextFlowMarkup } from './client-text-preview';
import { popupCallbackLabel, popupInputAt, popupInputValueAccepted } from './preview-popup-input';
import * as iconv from 'iconv-lite';
import { DialogPreviewInput, DialogPreviewValues, discoverPreviewInputs, evaluatePreviewCondition, previewFlagNames, resolvePreviewExpression, protectPreviewText, restorePreviewText, validPreviewValue, applyPreviewInputValue, normalizePreviewEquipmentValues, effectivePreviewConditionThreshold, PreviewFunctionResolver } from './preview-inputs';
import { previewVariableContract } from './preview-variable-contracts';
import { applyPreviewCollectionCommand, protectPreviewCollectionValue, resolvePreviewCollectionDisplayExpression } from './preview-collections';
import { applyPreviewExcelCommand } from './preview-excel';
import { runtimePreviewOutputIndexes, runtimePreviewOutputFamilyIndexes, runtimePreviewImplicitOutputs } from './preview-command-outputs';
import { executePreviewScopedVariableCommand } from './preview-scoped-variables';
import {
  DialogResolvedVariable,
  DialogVariableSourceReference,
} from './model';

const VARIABLE_NAME = /^(?:[PDMNSIGAUTJZ]\d+|(?:GL|[NSLD])\$[A-Za-z0-9_\u3400-\u9fff]+)$/i;
const MAX_EXECUTION_DEPTH = 48;
const MAX_EXECUTION_STEPS = 100000;
const MAX_INACTIVE_SCAN_STEPS = 20000;
const MAX_TEMPLATE_PASSES = 12;
const ACT_UI_SURFACE_COMMANDS = new Set([
  'MESSAGEBOX',
  'SHOWPROGRESSBARDLG',
  'PLAYWINDOWEFFECT',
  'SENDMOVEHINTMSG',
  'OPENUPGRADEDLG',
  'OPENCLIENTDLG',
  'ADDBUTTON',
  'ADDBUTTONEX',
  'DELBUTTON',
  'ADDDLG',
]);

interface PreviewContext {
  engine: EngineId;
  inputs: Map<string, DialogPreviewInput>;
  values: DialogPreviewValues;
  /** CSV aliases become available only after the script executes CSVOPENCACHE. */
  csvAliases: Map<string, Set<string>>;
  /** Snapshot loaded by each executed CSVOPENCACHE, keyed by source spelling. */
  csvTables: Map<string, { rows: readonly (readonly string[])[]; complete: boolean } | undefined>;
  resolvePreviewCsvData?: (request: { path: string; format: 'csv' }) =>
    { rows: readonly (readonly string[])[]; complete: boolean } | undefined;
  declaredAliases?: Map<string, string>;
  activeReferences?: Map<string, DialogResolvedVariable>;
}
const previewContexts = new WeakMap<ReadonlyMap<string, RuntimeValue>, PreviewContext>();

function initialPreviewDisplay(input: DialogPreviewInput, value: string): string {
  return input.kind === 'list' || input.kind === 'dictionary'
    ? protectPreviewCollectionValue(input.kind, value) ?? value
    : input.kind === 'text' ? protectPreviewText(value) : value;
}

function inputContract(rawName: string, environment: ReadonlyMap<string, RuntimeValue>): DialogPreviewInput | undefined {
  const context = previewContexts.get(environment);
  if (!context) return undefined;
  const registered = context.inputs.get(rawName.trim()) || context.inputs.get(rawName.trim().toUpperCase());
  if (registered && (!rawName.includes('$') || registered.scenario)) return registered;
  const contract = previewVariableContract(rawName, context.engine);
  if (!contract) return undefined;
  const existing = context.inputs.get(contract.name);
  if (existing) return existing;
  const input: DialogPreviewInput = { ...contract };
  if (Object.prototype.hasOwnProperty.call(context.values, input.name) && validPreviewValue(input, context.values[input.name])) {
    input.value = context.values[input.name];
  }
  context.inputs.set(input.name, input);
  return input;
}

function readPreviewValue(name: string, environment: ReadonlyMap<string, RuntimeValue>): string | undefined {
  const input = inputContract(name, environment);
  if (!input) return undefined;
  const known = environment.get(input.name);
  if (known?.complete) return known.value;
  if (input.value !== undefined) return input.value;
  return input.kind === 'text' ? '预览文字' : input.kind === 'list' ? '[]' : input.kind === 'dictionary' ? '{}' : '0';
}

/** Resolve the GOM/LFM CSVOPENCACHE shorthand against the local, bounded
 * preview reader.  The alias map is populated only by an executed
 * CSVOPENCACHE command; this prevents arbitrary `<$name(row,col)>` expressions
 * from turning into disk reads. */
function previewCsvFunctionResolver(environment: ReadonlyMap<string, RuntimeValue>): PreviewFunctionResolver | undefined {
  const context = previewContexts.get(environment);
  if (!context || context.engine !== 'GOM' || context.csvAliases.size === 0) return undefined;
  const readCell = (alias: string, row: number, column: number): string | undefined => {
    const paths = context.csvAliases.get(alias.toUpperCase());
    if (!paths || paths.size !== 1 || !Number.isSafeInteger(row) || row < 0
      || !Number.isSafeInteger(column) || column < 0) return undefined;
    const path = [...paths][0];
    const table = context.csvTables.get(path);
    const cell = table?.rows[row]?.[column];
    return table?.complete === true && cell !== undefined ? String(cell) : undefined;
  };
  return (name, args, resolveArgument) => {
    const normalized = name.trim().toUpperCase();
    const rowLookup = normalized.endsWith('.ROW');
    const alias = rowLookup ? normalized.slice(0, -4) : normalized;
    if (!alias || !context.csvAliases.has(alias)) return undefined;
    if (rowLookup) {
      if (args.length !== 3) return undefined;
      const directionRaw = resolveArgument(args[0]);
      const search = resolveArgument(args[1]);
      const columnRaw = resolveArgument(args[2]);
      const direction = directionRaw === undefined ? undefined : parsePreviewCsvIndex(directionRaw);
      const column = columnRaw === undefined ? undefined : parsePreviewCsvIndex(columnRaw);
      if (direction === undefined || (direction !== 0 && direction !== 1)
        || column === undefined || search === undefined) return undefined;
      const paths = context.csvAliases.get(alias)!;
      if (paths.size !== 1) return undefined;
      const table = context.csvTables.get([...paths][0]);
      if (!table || table.complete !== true) return undefined;
      const indexes = Array.from({ length: table.rows.length }, (_, index) => index);
      if (direction === 1) indexes.reverse();
      const found = indexes.find(index => {
        const row = table.rows[index];
        return column < row.length && String(row[column]) === search;
      });
      return String(found === undefined ? -1 : found);
    }
    if (args.length !== 2) return undefined;
    const rowRaw = resolveArgument(args[0]);
    const columnRaw = resolveArgument(args[1]);
    if (rowRaw === undefined || columnRaw === undefined) return undefined;
    const row = parsePreviewCsvIndex(rowRaw);
    const column = parsePreviewCsvIndex(columnRaw);
    if (row === undefined || column === undefined) return undefined;
    return readCell(alias, row, column);
  };
}

function parsePreviewCsvIndex(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function previewFunctionResolverFor(environment: ReadonlyMap<string, RuntimeValue>): PreviewFunctionResolver | undefined {
  return previewCsvFunctionResolver(environment);
}

interface ScriptLine {
  text: string;
  lineNumber: number;
}

interface ScriptFunction {
  label: string;
  lines: ScriptLine[];
}

interface RuntimeValue {
  localPreview?: boolean;
  previewInputNames?: string[];
  value: string;
  previewValue?: string;
  complete: boolean;
  staticValueSource?: 'database-item-index';
  /** Exact literal MOV payload; control selection does not turn it into user text. */
  sourceLiteral?: boolean;
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

type FunctionExecutionResult = { kind: 'fallthrough' } | { kind: 'return'; values: RuntimeValue[] } | { kind: 'aborted' };
interface FunctionExecutionOptions extends ResolveDialogVariablesOptions {
  ambiguousLabels: ReadonlySet<string>;
  executionBudget: { steps: number; exhausted: boolean; inactiveSteps: number };
  executionState: { events: DialogSayTraceLine[]; characters: number; frame: number; rootLabel: string; truncated: boolean };
  conditionVariables: Map<string, Map<string, DialogResolvedVariable>>;
  surfaceControlVariables: Map<string, Map<string, DialogResolvedVariable>>;
  executedLabels: Set<string>;
  activeSurfaceActionLines: Set<number>;
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
  sayTrace?: readonly DialogSayTraceLine[];
  sayEvents?: readonly DialogSayTraceLine[];
  inactiveLoopSayLines?: ReadonlySet<number>;
}

export interface DialogSayTraceLine {
  sourceLabel: string;
  executionRootLabel: string;
  executionFrame: number;
  sayOccurrence: number;
  block: number;
  lineNumber: number;
  inLoop: boolean;
  resolution: DialogResolvedLine;
}

export interface DialogVariableResolution {
  executionTrace?: readonly DialogSayTraceLine[];
  previewPath?: DialogPreviewCall[];
  previewInputs?: DialogPreviewInput[];
  /** Complete evaluator-side condition dependencies, keyed by source group id. */
  conditionVariables?: ReadonlyMap<string, readonly DialogResolvedVariable[]>;
  /** Inputs used by non-IF control flow, grouped by the label owning that surface. */
  surfaceControlVariables?: ReadonlyMap<string, readonly DialogResolvedVariable[]>;
  /** Labels executed by the current root plus the accepted local click path. */
  executedLabels?: readonly string[];
  /** Exact source lines of document-level UI actions executed on that path. */
  activeSurfaceActionLines?: readonly number[];
  conditionStates?: Record<string, boolean>;
  byLabel: ReadonlyMap<string, DialogLabelVariableResolution>;
  warnings: string[];
}

/** Source identity only: values are evaluated from the selected SAY snapshot. */
export interface DialogPreviewCall {
  /** Host-derived top-level frame; never accepted from a Webview payload. */
  sourceRootLabel?: string;
  sayOccurrence?: number;
  sourceLabel: string;
  targetLabel: string;
  lineNumber: number;
  column: number;
  trigger?: 'click' | 'double-click' | 'change' | 'completion' | 'popup-submit';
  submittedPopup?: string;
  submittedControl?: { type: 2 | 3 | 4; variable: string; value: string };
  /** Current-page input values validated by the Provider; never source code. */
  submittedInputs?: Readonly<Record<string, string>>;
}

export interface ResolveDialogVariablesOptions {
  previewPath?: readonly DialogPreviewCall[];
  previewCall?: DialogPreviewCall;
  activeSayLines?: Set<number>;
  sayTraces?: Map<string, DialogSayTraceLine[]>;
  selectedSaySnapshots?: Map<string, Map<number, Map<string, RuntimeValue>>>;
  previewValues?: DialogPreviewValues;
  evaluatedConditions?: Record<string, boolean>;
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
  const seenLabels = new Set<string>();
  const ambiguousLabels = new Set<string>();
  for (const section of functions) {
    const label = normalizeLabel(section.label);
    if (seenLabels.has(label)) ambiguousLabels.add(label);
    seenLabels.add(label);
  }
  const root = byName.get(normalizeLabel(options.rootLabel));
  if (!root) return { byLabel: new Map(), warnings: ['变量求值找不到当前 @函数'] };

  const warnings: string[] = [];
  const conditionStates: Record<string, boolean> = {};
  const conditionVariables = new Map<string, Map<string, DialogResolvedVariable>>();
  const surfaceControlVariables = new Map<string, Map<string, DialogResolvedVariable>>();
  if (options.previewValues !== undefined) {
    options = { ...options, previewValues: normalizePreviewEquipmentValues(options.previewValues, options.engine) };
  }
  let initialValues = { ...(options.dataOptions?.resolvePreviewGlobalValues?.() || {}),
    ...(options.previewValues || {}) };
  const inputs = new Map(discoverPreviewInputs(
    functions.filter(section => options.targetLabels.some(label => normalizeLabel(label) === normalizeLabel(section.label)))
      .flatMap(section => section.lines.map(line => line.text)).join('\n'), initialValues, options.engine, options.dataOptions
  ).map(input => [input.name, input]));
  if (options.previewValues !== undefined) {
    let effective = {...options.previewValues};
    for (const [name,value] of Object.entries(options.previewValues)) {
      const input = inputs.get(name);
      if (input?.scenario === 'equipment' && validPreviewValue(input, value) && Number(value) > 0) {
        effective = applyPreviewInputValue([...inputs.values()],effective,input,value,options.dataOptions?.resolvePreviewEquipmentSlot);
      }
    }
    options = {...options,previewValues:effective};
    initialValues = {...initialValues,...effective};
    for (const input of inputs.values()) if (input.scenario === 'equipment' && effective[input.name] !== undefined) input.value = effective[input.name];
  }
  const result = new Map<string, DialogLabelVariableResolution>();
  let appliedPath: DialogPreviewCall[] | undefined;
  let executionTrace: readonly DialogSayTraceLine[] | undefined;
  let executedLabels: readonly string[] | undefined;
  let activeSurfaceActionLines: readonly number[] | undefined;
  const targets = [...new Set(options.targetLabels.map(normalizeLabel))];
  // Shared across target exploration and every call frame. A small acyclic
  // graph with two calls per level otherwise expands exponentially.
  const executionBudget = { steps: 0, exhausted: false, inactiveSteps: 0 };
  for (const targetName of targets) {
    const target = byName.get(targetName);
    if (!target) continue;
    let environment = new Map<string, RuntimeValue>();
    if (options.previewValues !== undefined) previewContexts.set(environment, {
      engine: options.engine,
      inputs,
      values: initialValues,
      csvAliases: new Map(),
      csvTables: new Map(),
      resolvePreviewCsvData: (options.dataOptions as (NestedVariableAnalysisOptions & {
        resolvePreviewCsvData?: PreviewContext['resolvePreviewCsvData'];
      }) | undefined)?.resolvePreviewCsvData,
    });
    for (const [name, value] of Object.entries(options.previewValues || {})) {
      const contract = inputContract(name, environment);
      if (!contract || !validPreviewValue(contract, value)) continue;
      environment.set(contract.name, { value, previewValue: initialPreviewDisplay(contract, value),
        complete: true, localPreview: true, previewInputNames: [contract.name], sourceLabel: '本地预览初始值' });
    }
    const evaluatedConditions: Record<string, boolean> = {};
    const executionOptions = { ...options, ambiguousLabels, executionBudget, evaluatedConditions, conditionVariables, surfaceControlVariables,
      executedLabels: new Set<string>(), activeSurfaceActionLines: new Set<number>(), activeSayLines: new Set<number>(), sayTraces: new Map<string, DialogSayTraceLine[]>(), selectedSaySnapshots: new Map<string, Map<number, Map<string, RuntimeValue>>>(),
      executionState: {events:[] as DialogSayTraceLine[],characters:0,frame:0,rootLabel:root.label,truncated:false} };
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
      executionOptions,
      warnings,
      fileEffects,
      []
    );
    if (options.previewPath !== undefined && options.previewValues !== undefined) {
      appliedPath = [];
      let currentLabel = root.label;
      if (options.previewPath.length > 32) warnings.push('本地点击路径最多重放32次；超出部分未执行，可使用预览后退或重置');
      for (const call of options.previewPath.slice(0, 32)) {
        const parent = byName.get(normalizeLabel(call.sourceLabel));
        const next = byName.get(normalizeLabel(call.targetLabel));
        let callerSnapshots = snapshotsByLabel.get(normalizeLabel(call.sourceLabel));
        let caller = callerSnapshots?.get(call.lineNumber);
        let sourceRootMatches = !call.sourceRootLabel;
        if (call.sayOccurrence !== undefined) {
          const event = Number.isInteger(call.sayOccurrence) && call.sayOccurrence >= 0
            ? executionOptions.sayTraces.get(normalizeLabel(call.sourceLabel))?.[call.sayOccurrence] : undefined;
          caller = event?.lineNumber === call.lineNumber
            ? executionOptions.selectedSaySnapshots.get(normalizeLabel(call.sourceLabel))?.get(call.sayOccurrence) : undefined;
          sourceRootMatches = !!event && normalizeLabel(event.executionRootLabel) === normalizeLabel(currentLabel)
            && normalizeLabel(call.sourceRootLabel || call.sourceLabel) === normalizeLabel(currentLabel);
          if (caller) callerSnapshots = new Map([[call.lineNumber, caller]]);
        } else if ((executionOptions.sayTraces.get(normalizeLabel(call.sourceLabel)) || [])
          .filter(event => event.lineNumber === call.lineNumber).length > 1) {
          // Old histories cannot identify which repeated source instance was clicked.
          // Require a new click instead of silently using the last iteration.
          caller = undefined;
        }
        if (!parent || !next || !caller || (call.sourceRootLabel ? !sourceRootMatches
          : normalizeLabel(currentLabel) !== normalizeLabel(call.sourceLabel))) {
          warnings.push('本地点击路径已失效；停止重放后续调用');
          break;
        }
        const candidate = cloneEnvironment(caller);
        if (!bindUniqueUiParameters(parent, next.label, candidate, warnings, callerSnapshots,
          executionOptions.activeSayLines, call)) {
          warnings.push('本地点击路径的按钮已不存在或条件不再满足；停止重放后续调用');
          break;
        }
        if (call.trigger === 'popup-submit') {
          const popup = popupInputAt(parent.lines.find(line => line.lineNumber === call.lineNumber)?.text || '', call.column, options.engine);
          if (!popup || !popupInputValueAccepted(popup,call.submittedPopup)) break;
          candidate.set(`NPCPARAMS(1,${popup.variable})`, {value:call.submittedPopup,previewValue:protectPreviewText(call.submittedPopup),complete:true,
            localPreview:true,previewInputNames:[`NPCPARAMS(1,${popup.variable})`],sourceLabel:'本地弹窗提交'});
        }
        for (const [id, value] of Object.entries(call.submittedInputs || {})) {
          if (!/^[1-9]\d?$/.test(id) || Number(id) > (options.engine === 'GOM' || options.engine === 'GEE' ? 40 : options.engine === '996PC' ? 9 : 0) || typeof value !== 'string' || value.length > 65536) continue;
          candidate.set(`NPCINPUT(${id})`, { value, previewValue: protectPreviewText(value), complete: true,
            localPreview: true, previewInputNames: [`NPCINPUT(${id})`], sourceLabel: '本地输入框提交' });
        }
        if (options.engine === '996PC' && call.trigger === 'change' && call.submittedControl) {
          const {type, variable, value} = call.submittedControl;
          const contract = previewVariableContract(`NPCPARAMS(${type},${variable})`, options.engine);
          if (!contract || typeof value !== 'string' || value.length > 65536
            || (type !== 4 && (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))))
            || (type === 2 && value !== '0' && value !== '1')) break;
          candidate.set(contract.name, {value, previewValue:protectPreviewText(value), complete:true,
            localPreview:true, previewInputNames:[contract.name], sourceLabel:'本地控件提交'});
        }
        environment = candidate;
        snapshotsByLabel.delete(normalizeLabel(next.label));
        executionOptions.sayTraces.delete(normalizeLabel(next.label));
        executionOptions.selectedSaySnapshots.delete(normalizeLabel(next.label));
        for (const line of next.lines) executionOptions.activeSayLines.delete(line.lineNumber);
        executionOptions.executionState.events = [];
        executionOptions.executionState.characters = 0;
        executeFunction(next.label, byName, environment, snapshotsByLabel, executionOptions, warnings, fileEffects, []);
        if (executionBudget.exhausted) break;
        appliedPath.push({ ...call });
        currentLabel = next.label;
      }
    }
    if (targetName === normalizeLabel(root.label)) {
      executionTrace = executionOptions.executionState.events.slice();
      executedLabels = [...executionOptions.executedLabels];
      activeSurfaceActionLines = [...executionOptions.activeSurfaceActionLines];
    }
    if (options.previewPath === undefined && options.previewCall && normalizeLabel(options.previewCall.sourceLabel) === normalizeLabel(root.label)
      && normalizeLabel(options.previewCall.targetLabel) === targetName) snapshotsByLabel.delete(targetName);
    if (!snapshotsByLabel.has(targetName)) {
      const path = findUiPath(root.label, target.label, byName, options.engine);
      for (const label of path.slice(1)) {
        if (snapshotsByLabel.has(normalizeLabel(label))) continue;
        if (options.previewValues !== undefined) {
          const position = path.indexOf(label);
          const parent = byName.get(normalizeLabel(path[position - 1]));
          bindUniqueUiParameters(parent, label, environment, warnings,
            snapshotsByLabel.get(normalizeLabel(parent?.label || '')), executionOptions.activeSayLines, options.previewCall);
        }
        executeFunction(
          label,
          byName,
          environment,
          snapshotsByLabel,
          executionOptions,
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
        executionOptions,
        warnings,
        fileEffects,
        []
      );
    }
    const snapshots = snapshotsByLabel.get(targetName) || new Map();
    const execution: LabelExecution = { snapshots, finalValues: environment };
    const resolvedTarget = resolveTargetLines(target, execution);
    const trace = executionOptions.sayTraces.get(targetName);
    resolvedTarget.sayEvents = trace;
    if (trace?.some((event, index) => event.inLoop || trace.findIndex(peer => peer.lineNumber === event.lineNumber) !== index)) resolvedTarget.sayTrace = trace;
    if (options.previewValues !== undefined && options.engine === 'GOM') {
      let depth = 0;
      const inactiveLoopSayLines = new Set<number>();
      target.lines.forEach((line, index) => {
        const command = parseCommand(stripPreviewCommandComment(line.text.trim()));
        if (command?.name === 'WHILE') depth++;
        if (command?.name === 'ENDWHILE') depth = Math.max(0, depth - 1);
        if (depth && ['SAY', 'ELSESAY'].includes(directiveName(line.text) || '')) {
          const body: ScriptLine[] = [];
          for (let cursor = index + 1; cursor < target.lines.length && !directiveName(target.lines[cursor].text); cursor++) body.push(target.lines[cursor]);
          if (!body.some(item => executionOptions.activeSayLines.has(item.lineNumber))) inactiveLoopSayLines.add(line.lineNumber);
          else if (!resolvedTarget.sayTrace) warnings.push('循环内显示未取得完整输出事件，保留源行快照');
        }
      });
      resolvedTarget.inactiveLoopSayLines = inactiveLoopSayLines;
    }
    result.set(targetName, resolvedTarget);
    for (const [id, state] of Object.entries(evaluatedConditions)) {
      if (!Object.prototype.hasOwnProperty.call(conditionStates, id)) conditionStates[id] = state;
    }
  }
  return { byLabel: result, executionTrace, warnings: [...new Set(warnings)], conditionStates,
    conditionVariables: new Map([...conditionVariables].map(([id, values]) => [id, [...values.values()]])), previewPath: appliedPath,
    surfaceControlVariables: new Map([...surfaceControlVariables].map(([sourceLabel, values]) => (
      [sourceLabel, [...values.values()]]
    ))), executedLabels, activeSurfaceActionLines,
    previewInputs: options.previewValues !== undefined ? [...inputs.values()] : undefined };
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
  byName: ReadonlyMap<string, ScriptFunction>,
  engine: EngineId
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
      const next = normalizeLabel(popupCallbackLabel(reference,engine) || cleanTargetLabel(engine === '996PC' ? reference.split('#')[0] : reference));
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
  options: FunctionExecutionOptions,
  warnings: string[],
  fileEffects: RuntimeFileEffects,
  stack: string[],
  inheritedControlVariables: readonly DialogResolvedVariable[] = []
): FunctionExecutionResult {
  const label = normalizeLabel(rawLabel);
  const section = byName.get(label);
  if (!section) return { kind: 'aborted' };
  const abortBudget = (): FunctionExecutionResult => {
    if (!options.executionBudget.exhausted) warnings.push('本地预览达到全局执行步骤安全上限（100000），已停止后续调用；未完成变量不作为确定值');
    options.executionBudget.exhausted = true;
    for (const name of environment.keys()) setUnknownRuntimeValue(environment, name, section.label, section.lines[0].lineNumber);
    return { kind: 'aborted' };
  };
  if (options.executionBudget.exhausted) return abortBudget();
  if (stack.length >= MAX_EXECUTION_DEPTH || stack.includes(label)) {
    warnings.push(`变量求值已跳过循环 GOTO: ${section.label}`);
    return { kind: 'aborted' };
  }
  // Preserve legacy source snapshots, but never grant a new return capability
  // from a duplicate-label choice or an execution path stopped by its budget.
  let returnBlocked = options.ambiguousLabels.has(label);
  const nextStack = [...stack, label];
  if (stack.length === 0) options.executionState.rootLabel = section.label;
  const executionRootLabel = options.executionState.rootLabel;
  const executionFrame = ++options.executionState.frame;
  options.executedLabels.add(label);
  const sayTrace = options.sayTraces?.get(label) || [];
  options.sayTraces?.set(label, sayTrace);
  let sayBlock = sayTrace.length + 1;
  let traceCharacters = sayTrace.reduce((total, event) => total + event.resolution.text.length, 0);
  const snapshots = snapshotsByLabel.get(label) || new Map<number, Map<string, RuntimeValue>>();
  snapshotsByLabel.set(label, snapshots);
  let conditionNumber = 0;
  const conditionNumbers = new Map<number, number>();
  const conditionSizes = new Map<number, number>();
  let countingCondition: number | undefined;
  section.lines.forEach((line, index) => {
    const directive = directiveName(line.text);
    if (directive === 'IF') {
      conditionNumbers.set(index, ++conditionNumber);
      countingCondition = index;
      conditionSizes.set(index, 0);
    } else if (directive && directive !== 'OR') countingCondition = undefined;
    else if (!directive && countingCondition !== undefined && line.text.trim() && !/^\s*(?:;|\/\/)/.test(line.text)) {
      conditionSizes.set(countingCondition, (conditionSizes.get(countingCondition) || 0) + 1);
    }
  });
  let conditionId = '';
  let collectingConditions = false;
  let conditionCount = 0;
  let actionEnabled = false;
  let actionBranch = false;
  let sayEnabled = false;
  let conditionResult: boolean | undefined = true;
  let conditionOperator = 'AND';
  let conditionThreshold: number | undefined;
  let conditionTrueCount = 0;
  let conditionUnknownCount = 0;
  let conditionStopped = false;
  let conditionTotal = 0;
  let conditionVariables = new Map<string, DialogResolvedVariable>();
  let activeControlVariables: DialogResolvedVariable[] = [];
  const loops: { start: number; end: number; iterations: number; state: ReturnType<typeof saveControl>;
    dependencies: DialogResolvedVariable[]; rendersVisibleOutput: boolean }[] = [];
  const saveControl = () => ({ conditionId, collectingConditions, conditionCount, actionEnabled, actionBranch, sayEnabled,
    conditionResult, conditionOperator, conditionThreshold, conditionTrueCount, conditionUnknownCount, conditionStopped, conditionTotal,
    conditionVariables: new Map(conditionVariables), activeControlVariables: [...activeControlVariables] });
  const restoreControl = (state: ReturnType<typeof saveControl>) => {
    ({ conditionId, collectingConditions, conditionCount, actionEnabled, actionBranch, sayEnabled, conditionResult,
      conditionOperator, conditionThreshold, conditionTrueCount, conditionUnknownCount, conditionStopped, conditionTotal,
      conditionVariables, activeControlVariables } = state);
  };
  let loopSteps = 0;
  const finishCondition = () => {
    if (options.previewValues === undefined || !conditionId) return;
    options.evaluatedConditions![conditionId] = conditionResult === true;
    const collected = options.conditionVariables.get(conditionId) || new Map<string, DialogResolvedVariable>();
    for (const [name, variable] of conditionVariables) collected.set(name, variable);
    options.conditionVariables.set(conditionId, collected);
  };
  const currentControlVariables = (): DialogResolvedVariable[] => mergeResolvedVariables(
    mergeResolvedVariables(inheritedControlVariables, activeControlVariables),
    loops.flatMap(loop => loop.dependencies)
  );

  for (let index = 1; index < section.lines.length; index++) {
    if (++options.executionBudget.steps > MAX_EXECUTION_STEPS) return abortBudget();
    const line = section.lines[index];
    // Runtime-only writers lose static provenance, but can use an explicit local fallback.
    for (const [name, value] of Object.entries(options.previewValues || {})) {
      const contract = inputContract(name, environment);
      if (!contract || !validPreviewValue(contract, value)) continue;
      if (!environment.get(contract.name)?.complete) environment.set(contract.name, {
        value, previewValue: initialPreviewDisplay(contract, value),
        complete: true, localPreview: true, previewInputNames: [contract.name], sourceLabel: '本地预览输入',
      });
    }
    snapshots.set(line.lineNumber, cloneEnvironment(environment));
    const directive = directiveName(line.text);
    if (directive === 'IF') {
      finishCondition();
      conditionId = conditionGroupId(section.label, conditionNumbers.get(index)!);
      conditionCount = 0;
      conditionResult = true;
      conditionOperator = 'AND';
      const threshold = /^\s*#IF\s*\(\s*(\d+)\s*\)\s*$/i.exec(line.text);
      conditionThreshold = (options.engine === 'GOM' || options.engine === 'GEE') && threshold ? Number(threshold[1]) : undefined;
      conditionTrueCount = 0;
      conditionUnknownCount = 0;
      conditionStopped = false;
      conditionTotal = conditionSizes.get(index) || 0;
      conditionThreshold = effectivePreviewConditionThreshold(options.engine, conditionThreshold, conditionTotal);
      conditionVariables = new Map();
      activeControlVariables = [];
      collectingConditions = true;
      actionEnabled = false;
      actionBranch = false;
      sayEnabled = false;
      continue;
    }
    if (directive === 'OR') {
      sayEnabled = false;
      conditionOperator = 'OR';
      conditionThreshold = effectivePreviewConditionThreshold(options.engine, conditionThreshold, conditionTotal, true);
      collectingConditions = true;
      continue;
    }
    if (directive === 'ACT' || directive === 'ELSEACT') {
      actionBranch = true;
      sayEnabled = false;
      finishCondition();
      collectingConditions = false;
      const satisfied = conditionCount === 0
        ? true
        : options.previewValues !== undefined
          ? conditionResult === true
          : options.conditionStates?.[conditionId] === true;
      actionEnabled = directive === 'ACT' ? satisfied : !satisfied;
      activeControlVariables = conditionCount > 0 ? [...conditionVariables.values()] : [];
      continue;
    }
    if (directive === 'SAY' || directive === 'ELSESAY') {
      actionBranch = false;
      sayBlock = sayTrace.length + 1;
      finishCondition();
      collectingConditions = false;
      actionEnabled = false;
      const satisfied = conditionCount === 0 || (options.previewValues !== undefined
        ? conditionResult === true : options.conditionStates?.[conditionId] === true);
      sayEnabled = directive === 'SAY' ? satisfied : !satisfied;
      activeControlVariables = conditionCount > 0 ? [...conditionVariables.values()] : [];
      continue;
    }
    const trimmed = line.text.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('//')) continue;
    if (collectingConditions) {
      conditionCount++;
      if (options.previewValues !== undefined) {
        const effects: { heroAbsent?: boolean } = {};
        const value = evaluatePreviewCondition(trimmed, name => {
          const runtime = readVariable(name, environment);
          if (runtime) recordReference(conditionVariables, name, runtime, environment);
          return readPreviewValue(name, environment);
        }, options.engine, options.dataOptions, effects, previewFunctionResolverFor(environment));
        if (!conditionStopped && effects.heroAbsent) {
          // GXX HandleNpcCmds: nil target breaks before counting this predicate.
          // Threshold mode then compares only preceding truths. Plain AND/OR
          // may already have short-circuited before reaching the missing hero.
          if (conditionOperator === 'OR') conditionResult = conditionTrueCount > 0 ? true
            : conditionUnknownCount > 0 ? undefined : value;
          else if (conditionThreshold !== undefined && conditionThreshold > 0 && conditionThreshold < conditionTotal) {
            conditionResult = conditionTrueCount >= conditionThreshold ? true : conditionUnknownCount > 0 ? undefined : false;
          } else conditionResult = conditionTrueCount + conditionUnknownCount < conditionCount - 1 ? false
            : conditionUnknownCount > 0 ? undefined : value;
          conditionStopped = true;
        } else if (!conditionStopped) {
          if (value === undefined) warnings.push(`预览条件暂不支持，按未满足展示：${trimmed}`);
          if (value === true) conditionTrueCount++;
          if (value === undefined) conditionUnknownCount++;
          conditionResult = conditionThreshold !== undefined
          ? conditionTrueCount >= conditionThreshold ? true : conditionUnknownCount ? undefined : false
          : conditionCount === 1 ? value : conditionOperator === 'OR'
          ? conditionResult === true || value === true ? true : conditionResult === undefined || value === undefined ? undefined : false
          : conditionResult === false || value === false ? false : conditionResult === undefined || value === undefined ? undefined : true;
        }
      }
      if (conditionStopped) continue;
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
    // ENDWHILE is structural even after an IF inside the body disabled ACT.
    if (options.previewValues !== undefined && options.engine === 'GOM'
      && /^ENDWHILE(?:\s*(?:;.*)?)?$/i.test(trimmed) && loops.at(-1)?.end === index) {
      const loop = loops.at(-1)!;
      restoreControl(loop.state);
      index = loop.start - 1;
      continue;
    }
    if (!actionEnabled) {
      if (actionBranch && options.previewValues !== undefined) {
        // Inspect only potential output identities, not the inactive values or
        // conditions. This also covers already-resolvable indirect destinations
        // and transitive local calls without executing an unselected branch.
        const skipped = parseCommand(stripPreviewCommandComment(trimmed));
        if (skipped) retainInactiveWriteInputs(skipped, environment, currentControlVariables(), byName, options, warnings);
      }
      if (sayEnabled) {
        options.activeSayLines?.add(line.lineNumber);
        if (options.previewValues !== undefined && options.sayTraces) {
          const variables = new Map<string, DialogResolvedVariable>();
          const resolved = resolveTemplate(line.text, environment, variables, { previewUnknownText: true });
          for (const variable of currentControlVariables()) {
            if (!variables.has(variable.name)) variables.set(variable.name, variable);
          }
          if (sayTrace.length < 4096 && traceCharacters + resolved.value.length <= 2_000_000) {
            // Retain environments only for the bounded selected path (max 32),
            // not every emitted line. Never serialize environments to the Webview.
            if (options.previewPath?.slice(0, 32).some(call => normalizeLabel(call.sourceLabel) === label
              && call.lineNumber === line.lineNumber && call.sayOccurrence === sayTrace.length)) {
              const selected = options.selectedSaySnapshots?.get(label) || new Map<number, Map<string, RuntimeValue>>();
              selected.set(sayTrace.length, cloneEnvironment(environment));
              options.selectedSaySnapshots?.set(label, selected);
            }
            traceCharacters += resolved.value.length;
            const event: DialogSayTraceLine = { sourceLabel:section.label, executionRootLabel, executionFrame,
              sayOccurrence:sayTrace.length, block: sayBlock, lineNumber: line.lineNumber, inLoop: loops.length > 0,
              resolution: { text: resolved.value, variables: [...variables.values()] } };
            sayTrace.push(event);
            const state = options.executionState;
            if (state.events.length < 4096 && state.characters + resolved.value.length <= 2_000_000) {
              state.events.push(event); state.characters += resolved.value.length;
            } else if (!state.truncated) {
              state.truncated = true;
              warnings.push('跨标签执行输出达到 4096 行或 200 万字符上限，后续组合输出未绘制');
            }
          } else if (!warnings.includes('本地显示事件达到 4096 行或 200 万字符上限，后续输出未绘制')) {
            warnings.push('本地显示事件达到 4096 行或 200 万字符上限，后续输出未绘制');
          }
        }
      }
      continue;
    }
    const commandSource = options.previewValues !== undefined ? stripPreviewCommandComment(trimmed) : trimmed;
    if (options.previewValues !== undefined && (options.engine === 'GOM' || options.engine === 'GEE')
      && /^#?(?:CALL|CALLEX)\b/i.test(commandSource)) {
      // The external body is not loaded by this local interpreter. Preserve
      // the existing snapshots, but do not certify a later RETURN as complete.
      returnBlocked = true;
      warnings.push(`本地预览尚未展开跨文件调用：第 ${line.lineNumber + 1} 行，后续 RETURN 保持未知`);
    }
    const command = parseCommand(commandSource);
    if (!command) continue;
    if (options.previewValues !== undefined && ACT_UI_SURFACE_COMMANDS.has(command.name)) {
      options.activeSurfaceActionLines.add(line.lineNumber);
    }
    if (options.previewValues !== undefined && options.engine === 'GOM' && command.name === 'WHILE') {
      let loop = loops.at(-1);
      if (loop?.start !== index) {
        let depth = 1, end = index + 1;
        for (; end < section.lines.length; end++) {
          const nested = parseCommand(stripPreviewCommandComment(section.lines[end].text.trim()));
          if (nested?.name === 'WHILE') depth++;
          if (nested?.name === 'ENDWHILE' && --depth === 0) break;
        }
        if (end === section.lines.length) {
          returnBlocked = true;
          warnings.push(`本地预览循环缺少 ENDWHILE：第 ${line.lineNumber + 1} 行，停止该路径`);
          for (const name of environment.keys()) setUnknownRuntimeValue(environment, name, section.label, line.lineNumber);
          break;
        }
        const rendersVisibleOutput = section.lines.slice(index + 1, end).some(candidate => {
          const nestedDirective = directiveName(candidate.text);
          if (nestedDirective === 'SAY' || nestedDirective === 'ELSESAY') return true;
          const nestedCommand = parseCommand(stripPreviewCommandComment(candidate.text.trim()))?.name;
          return !!nestedCommand && (ACT_UI_SURFACE_COMMANDS.has(nestedCommand)
            || nestedCommand === 'ADDBUTTON' || nestedCommand === 'ADDBUTTONEX' || nestedCommand === 'ADDDLG');
        });
        loop = { start: index, end, iterations: 0, state: saveControl(), dependencies: [], rendersVisibleOutput };
        loops.push(loop);
      }
      const parts = splitArguments(command.rest);
      const loopReferences = new Map<string, DialogResolvedVariable>();
      const read = (raw: string) => resolvePreviewExpression(raw, name => {
        const target = resolveTarget(name, environment);
        const value = target ? readVariable(target, environment) : undefined;
        if (target && value) recordReference(loopReferences, target, value, environment);
        return value?.complete ? value.value : undefined;
      }, options.engine, previewFunctionResolverFor(environment));
      const left = read(parts[0] || ''), right = read(parts[2] || '');
      const valid = parts.length === 3 && /^[><=?]$/.test(parts[1])
        && left !== undefined && right !== undefined && /^[+-]?\d{1,128}$/.test(left) && /^[+-]?\d{1,128}$/.test(right);
      const a = valid ? BigInt(left!) : 0n, b = valid ? BigInt(right!) : 0n;
      loop.dependencies = mergeResolvedVariables(loop.dependencies, [...loopReferences.values()]);
      if (loop.rendersVisibleOutput) {
        const surfaceVariables = options.surfaceControlVariables.get(label) || new Map<string, DialogResolvedVariable>();
        for (const variable of loop.dependencies) surfaceVariables.set(variable.name, variable);
        options.surfaceControlVariables.set(label, surfaceVariables);
      }
      const satisfied = valid && (parts[1] === '>' ? a > b : parts[1] === '<' ? a < b : parts[1] === '?' ? a <= b : a === b);
      const exceeded = satisfied && (loop.iterations >= 3000 || loopSteps >= 10000);
      if (!valid || exceeded) {
        returnBlocked = true;
        warnings.push(exceeded ? '本地预览循环达到安全上限，后续变量标为未知' : `本地预览循环条件无法确定：${command.rest}，后续变量标为未知`);
        for (const name of environment.keys()) setUnknownRuntimeValue(environment, name, section.label, line.lineNumber);
      }
      if (!satisfied || exceeded) { loops.pop(); index = loop.end; }
      else { loop.iterations++; loopSteps++; }
      continue;
    }
    if (options.previewValues !== undefined && (command.name === 'SET' || command.name === 'RESET')) {
      captureRuntimeWrites(environment, currentControlVariables(), () => {
        applyPreviewFlagCommand(command.name, command.rest, environment, section.label, line.lineNumber, warnings);
      });
      continue;
    }
    if (command.name === 'GOTO') {
      const beforeInvocation = new Map(environment);
      const invocationControls = currentControlVariables();
      const invocation = parseGotoInvocation(command.rest);
      // Keep positional slots, including invalid ones. Filtering them would
      // shift a later RETURN value into a different output variable.
      const returnTargets = (invocation?.returnTargets || [])
        .map(rawTarget => resolveRuntimeOutputTarget(rawTarget, environment));
      let execution: FunctionExecutionResult = { kind: 'aborted' };
      if (invocation?.target.startsWith('@')) {
        const savedParameters = new Map([...environment].filter(([name]) => /^SCRIPTPARAM\(\d+\)$/i.test(name)));
        if (options.previewValues !== undefined) bindPreviewParameters(invocation.arguments, environment, section.label);
        execution = executeFunction(
          invocation.target,
          byName,
          environment,
          snapshotsByLabel,
          options,
          warnings,
          fileEffects,
          nextStack,
          invocationControls
        );
        if (options.executionBudget.exhausted) return abortBudget();
        if (options.previewValues !== undefined) {
          for (const name of [...environment.keys()]) if (/^SCRIPTPARAM\(\d+\)$/i.test(name)) environment.delete(name);
          if (options.engine !== 'GEE') for (const [name, value] of savedParameters) environment.set(name, value);
        }
      }
      // Own GOM/LFM manuals prove matched N-value returns only. Missing or
      // mismatched values and ambiguous identities remain a local boundary;
      // do not guess client truncation, padding or duplicate-write ordering.
      const supported = options.previewValues !== undefined && (options.engine === 'GOM' || options.engine === 'GEE');
      const returned = execution.kind === 'return' ? execution.values : undefined;
      const matched = supported && invocation?.complete === true && returned !== undefined
        && returned.length === returnTargets.length && returnTargets.every(target => target !== undefined)
        && new Set(returnTargets).size === returnTargets.length;
      if (supported && returnTargets.length > 0 && !matched) {
        warnings.push(`GOTO 返回值未确定或参数数量/目标不匹配：${invocation?.target || command.rest}，返回目标使用未知值`);
      }
      for (let outputIndex = 0; outputIndex < returnTargets.length; outputIndex++) {
        const target = returnTargets[outputIndex];
        if (!target) continue;
        const value = matched ? returned![outputIndex] : undefined;
        if (!value?.complete) setUnknownRuntimeValue(environment, target, section.label, line.lineNumber);
        else environment.set(target, value);
      }
      mergeRuntimeWriteInputs(beforeInvocation, environment, invocationControls);
      if (execution.kind === 'aborted' || invocation?.complete !== true) returnBlocked = true;
      continue;
    }
    if (command.name === 'RETURN') {
      if (options.previewValues === undefined || (options.engine !== 'GOM' && options.engine !== 'GEE')) break;
      if (returnBlocked) return { kind: 'aborted' };
      // Resolve all operands against this callee snapshot before writing any
      // caller target. Copy raw/display values, never resource capabilities.
      return { kind: 'return', values: splitArguments(command.rest).map(raw => {
        const references = new Map<string, DialogResolvedVariable>();
        const result = resolveTemplate(stripQuotes(raw), environment, references);
        const display = resolveTemplate(stripQuotes(raw), environment, undefined, { previewUnknownText: true });
        const dependencies = mergeResolvedVariables([...references.values()], currentControlVariables());
        return { value: result.value, previewValue: display.value, complete: result.complete,
          localPreview: dependencies.some(reference => reference.localPreview),
          previewInputNames: previewInputNamesFromVariables(dependencies), dependencies,
          sourceLabel: section.label, sourceLine: line.lineNumber + 1,
          sourceReferences: [{ sourceLabel: section.label, sourceLine: line.lineNumber + 1 }] };
      }) };
    }
    if (command.name === 'BREAK') break;
    captureRuntimeWrites(environment, currentControlVariables(), () => {
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
    });
  }
  finishCondition();
  return { kind: returnBlocked ? 'aborted' : 'fallthrough' };
}

/**
 * A false branch may call a helper that would replace a later displayed value.
 * Walk its ACT output identities only: no assignment RHS, condition, file read,
 * SAY event, return value or resource authority is executed/borrowed here.
 * Known call labels are visited once per scan. The scan budget is shared by
 * all roots and inactive calls, so repeated calls cannot reset their allowance.
 */
function retainInactiveWriteInputs(
  command: { name: string; rest: string },
  environment: Map<string, RuntimeValue>,
  controls: readonly DialogResolvedVariable[],
  byName: ReadonlyMap<string, ScriptFunction>,
  options: FunctionExecutionOptions,
  warnings: string[]
): void {
  if (controls.length === 0) return;
  const targets = new Map<string, DialogResolvedVariable[]>();
  const visited = new Set<string>();
  const consumeStep = (): boolean => {
    if (options.executionBudget.inactiveSteps >= MAX_INACTIVE_SCAN_STEPS) {
      const warning = '未执行调用的显示依赖扫描达到全局 20000 步上限；部分控制输入可能无法推导';
      if (!warnings.includes(warning)) warnings.push(warning);
      return false;
    }
    options.executionBudget.inactiveSteps++;
    return true;
  };
  const addTarget = (raw: string, runtimeOutput = false): void => {
    const references = new Map<string, DialogResolvedVariable>();
    if (raw.includes('<$')) {
      const resolved = resolveTemplate(raw, environment, references);
      if (!runtimeOutput && !resolved.complete) return;
    }
    const target = runtimeOutput ? resolveRuntimeOutputTarget(raw, environment) : resolveTarget(raw, environment);
    if (target) targets.set(target, mergeResolvedVariables(targets.get(target) || [], [...references.values()]));
  };
  const inspect = (candidate: { name: string; rest: string }, depth: number): void => {
    if (!consumeStep()) return;
    if (depth > MAX_EXECUTION_DEPTH) {
      const warning = '未执行调用的显示依赖扫描达到深度上限；部分控制输入可能无法推导';
      if (!warnings.includes(warning)) warnings.push(warning);
      return;
    }
    const args = splitArguments(candidate.rest);
    if (['MOV', 'INC', 'DEC', 'MUL', 'DIV'].includes(candidate.name)) addTarget(args[0] || '');
    else if (candidate.name === 'GOTO') {
      const invocation = parseGotoInvocation(candidate.rest);
      for (const raw of invocation?.returnTargets || []) addTarget(raw, true);
      if (!invocation?.complete || /<\$/.test(invocation.target)) return;
      const label = normalizeLabel(invocation.target);
      if (visited.has(label) || options.ambiguousLabels.has(label)) return;
      const section = byName.get(label);
      if (!section) return;
      visited.add(label);
      let actions = false;
      let conditional = false;
      for (const line of section.lines.slice(1)) {
        if (!consumeStep()) break;
        const directive = directiveName(line.text);
        if (directive) {
          actions = directive === 'ACT' || directive === 'ELSEACT';
          if (directive === 'IF') conditional = true;
          continue;
        }
        if (!actions) continue;
        const nested = parseCommand(stripPreviewCommandComment(line.text.trim()));
        if (!nested) continue;
        if (!conditional && (nested.name === 'BREAK' || nested.name === 'RETURN')) break;
        inspect(nested, depth + 1);
      }
    } else {
      for (const index of runtimePreviewOutputIndexes(candidate.name, options.engine) || []) addTarget(args[index] || '', true);
      for (const target of runtimePreviewImplicitOutputs(candidate.name, options.engine) || []) addTarget(target, true);
    }
  };
  inspect(command, 0);
  for (const [target, selectors] of targets) {
    const value = readVariable(target, environment);
    if (!value) continue;
    const before = new Map(environment);
    environment.set(target, { ...value });
    mergeRuntimeWriteInputs(before, environment, mergeResolvedVariables(controls, selectors));
  }
}

function applyPreviewFlagCommand(
  command: string, rest: string, environment: Map<string, RuntimeValue>,
  sourceLabel: string, sourceLine: number, warnings: string[]
): void {
  const match = /^(\[.*\])\s+(\S+)(?:\s+(\S+))?\s*$/.exec(rest.trim());
  if (!match) { warnings.push(`预览未应用无法解析的 ${command} ${rest}`); return; }
  const resolved = resolveTemplate(match[1], environment);
  const engine = previewContexts.get(environment)?.engine || 'GOM';
  let flags = previewFlagNames(resolved.value, undefined, engine);
  const value = resolveTemplate(match[2], environment).value;
  if (command === 'RESET') {
    const amount = Number(resolveTemplate(match[3] || '1', environment).value);
    const start = flags?.length === 1 ? Number(flags[0].slice(1, -1)) : NaN;
    flags = Number.isInteger(amount) && amount >= 0 && start >= (engine === '996PC' ? 0 : 1) && start + amount - 1 <= (engine === '996PC' ? 999 : 1024)
      ? Array.from({ length: amount }, (_, index) => `[${start + index}]`) : undefined;
  }
  if (!flags || !/^[01]$/.test(value)) { warnings.push(`预览未应用无效的 ${command} ${rest}`); return; }
  for (const name of flags) {
    inputContract(name, environment);
    environment.set(name, { value, complete: true, sourceLabel, sourceLine: sourceLine + 1 });
  }
}

function bindPreviewParameters(argumentsList: readonly string[], environment: Map<string, RuntimeValue>, sourceLabel: string,
  argumentEnvironment: ReadonlyMap<string, RuntimeValue> = cloneEnvironment(environment)): void {
  for (const name of [...environment.keys()]) if (/^SCRIPTPARAM\(\d+\)$/i.test(name)) environment.delete(name);
  for (let index = 0; index < argumentsList.length; index++) {
    const input = inputContract(`SCRIPTPARAM(${index + 1})`, environment);
    if (!input) continue;
    const name = input.name;
    const references = new Map<string, DialogResolvedVariable>();
    const result = resolveTemplate(stripQuotes(argumentsList[index]), argumentEnvironment, references);
    const preview = resolveTemplate(stripQuotes(argumentsList[index]), argumentEnvironment, undefined, { previewUnknownText: true });
    const dependencies = [...references.values()];
    environment.set(name, { value: result.value, previewValue: preview.value, complete: result.complete, sourceLabel,
      dependencies, previewInputNames: previewInputNamesFromVariables(dependencies),
      localPreview: dependencies.some(value => value.localPreview) });
  }
}

function bindUniqueUiParameters(section: ScriptFunction | undefined, target: string,
  environment: Map<string, RuntimeValue>, warnings: string[], snapshots: ReadonlyMap<number, Map<string, RuntimeValue>> | undefined,
  activeSayLines: ReadonlySet<number>, selected?: DialogPreviewCall): boolean {
  const selection = selected && normalizeLabel(selected.sourceLabel) === normalizeLabel(section?.label || '')
    && normalizeLabel(selected.targetLabel) === normalizeLabel(target) ? selected : undefined;
  if (selection?.trigger === 'popup-submit') {
    const line = section?.lines.find(line => line.lineNumber === selection.lineNumber);
    const popup = line && activeSayLines.has(line.lineNumber) ? popupInputAt(line.text,selection.column,previewContexts.get(environment)!.engine) : undefined;
    bindPreviewParameters([],environment,section?.label || target);
    return Boolean(popup && normalizeLabel(popup.target) === normalizeLabel(target) && popupInputValueAccepted(popup,selection.submittedPopup));
  }
  const candidates = new Map<string, Map<string, RuntimeValue>>();
  for (const line of section?.lines || []) {
    if (!activeSayLines.has(line.lineNumber)) continue;
    if (/^\s*(?:;|\/\/)/.test(line.text)) continue;
    const pattern = previewContexts.get(environment)?.engine === '996PC'
      ? /(?:\/|\|(?:db)?link=)(@[^\s<>()/,|#]+)(\()?/gi
      : /\/(@[^\s<>()/,]+)(\()?/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line.text))) {
      if (selection && (line.lineNumber !== selection.lineNumber || match.index !== selection.column)) continue;
      if (selection && /^\|dblink=/i.test(match[0]) !== (selection.trigger === 'double-click')) continue;
      if (normalizeLabel(match[1]) !== normalizeLabel(target)) continue;
      let args: string[] = [];
      if (match[2]) {
        const open = match.index + match[0].length - 1;
        const close = findGotoCallClose(line.text, open);
        if (close < 0) continue;
        args = splitTopLevelDelimited(line.text.slice(open + 1, close), ',');
      }
      const candidate = cloneEnvironment(environment);
      bindPreviewParameters(args, candidate, section!.label, snapshots?.get(line.lineNumber) || environment);
      const parameters = new Map([...candidate].filter(([name]) => /^SCRIPTPARAM\(\d+\)$/i.test(name)));
      const after = match.index + match[0].length;
      if (previewContexts.get(environment)?.engine === '996PC' && line.text[after] === '#') {
        const relativeEnd = findTopLevelDelimiter(line.text.slice(after), '>');
        if (relativeEnd < 0) continue;
        const end = after + relativeEnd;
        const pairs = line.text.slice(after + 1, end).split('#').map(part => /^([A-Za-z0-9_\u3400-\u9fff]+)=([\s\S]*)$/.exec(part));
        if (pairs.length > 99 || pairs.some(pair => !pair) || new Set(pairs.map(pair => pair?.[1])).size !== pairs.length) continue;
        for (const pair of pairs) {
          const references = new Map<string, DialogResolvedVariable>();
          const result = resolveTemplate(pair![2], snapshots?.get(line.lineNumber) || environment, references);
          const display = resolveTemplate(pair![2], snapshots?.get(line.lineNumber) || environment, undefined, {previewUnknownText:true});
          const dependencies = [...references.values()];
          parameters.set(`S$${pair![1]}`, {value:result.value,previewValue:display.value,complete:result.complete,sourceLabel:section!.label,
            dependencies,previewInputNames:previewInputNamesFromVariables(dependencies),localPreview:dependencies.some(value=>value.localPreview)});
        }
      }
      candidates.set(JSON.stringify([...parameters].map(([name, value]) => [name, value.value, value.previewValue, value.complete])), parameters);
    }
  }
  bindPreviewParameters([], environment, section?.label || target);
  if (candidates.size === 1) for (const [name, value] of [...candidates.values()][0]) environment.set(name, value);
  else if (candidates.size > 1) warnings.push(`${target} 有多组点击参数，请在预览变量中指定 SCRIPTPARAM 值`);
  return candidates.size === 1;
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
  if (options.previewValues !== undefined) {
    if (command === 'CSVOPENCACHE' && options.engine === 'GOM') {
      const rawPath = splitArguments(rest)[0];
      const context = previewContexts.get(environment);
      if (rawPath && context) {
        const cleanPath = stripQuotes(rawPath.trim());
        const fileName = cleanPath.split(/[\\/]/).pop() || cleanPath;
        const alias = fileName.replace(/\.csv$/i, '').trim().toUpperCase();
        // Keep source spelling in the path, but normalize only the alias used
        // by the engine's case-insensitive shorthand lookup.
        if (alias && !/[<>$"'\r\n\x00]/.test(cleanPath) && context.resolvePreviewCsvData) {
          const paths = context.csvAliases.get(alias) || new Set<string>();
          paths.add(cleanPath);
          context.csvAliases.set(alias, paths);
          // CSVOPENCACHE is a source-order operation. Read once at the open
          // command and retain that bounded snapshot for all later shorthand
          // calls; later source/file changes cannot rewrite an earlier SAY.
          const table = context.resolvePreviewCsvData({ path: cleanPath, format: 'csv' });
          if (!table || table.complete !== true) {
            // Keep the attempted path in the alias set but mark its snapshot
            // unavailable. A failed refresh must not leave stale data usable;
            // retaining the path also keeps same-basename ambiguity fail-closed.
            context.csvTables.set(cleanPath, undefined);
            return;
          }
          context.csvTables.set(cleanPath, table);
        }
      }
      return;
    }
    const references = new Map<string, DialogResolvedVariable>();
    const readLocal = (name: string): string | undefined => {
      const value = readVariable(name, environment);
      if (!value) return undefined;
      recordReference(references, name, value, environment);
      return value.value;
    };
    const writeLocal = (rawName: string, value: string | undefined, dependencies: string[] = [], previewValue?: string): void => {
      const input = inputContract(rawName, environment);
      if (!input) return;
      if (value === undefined) { setUnknownRuntimeValue(environment, input.name, sourceLabel, sourceLine); return; }
      const used = dependencies.map(name => references.get(name)).filter((reference): reference is DialogResolvedVariable => !!reference);
      const localPreview = used.some(reference => reference.localPreview);
      environment.set(input.name, { value, previewValue: previewValue ?? (input.kind === 'text' && localPreview ? protectPreviewText(value) : value),
        complete: used.every(reference => reference.status === 'resolved'), localPreview,
        dependencies: used, sourceLabel, sourceLine: sourceLine + 1 });
    };
    const handled = applyPreviewCollectionCommand(command, rest, readLocal, writeLocal, options.engine,
      name => readVariable(name, environment)?.previewValue)
      || executePreviewScopedVariableCommand(command, rest, readLocal, writeLocal, options.engine,
        name => inputContract(name, environment)?.kind);
    if (handled) {
      if (command === 'VAR' && options.engine === 'GOM') {
        const parts = splitArguments(rest);
        if (parts.length === 3 && /^Integer$/i.test(parts[0]) && /^HUMAN$/i.test(parts[1])) {
          const scoped = `HUMAN(${parts[2]})`;
          const context = previewContexts.get(environment)!;
          (context.declaredAliases ??= new Map()).set(parts[2], scoped);
        }
      }
      return;
    }
    if (applyPreviewExcelCommand(command, splitArguments(rest), {
      resolve: raw => {
        const refs = new Map<string, DialogResolvedVariable>();
        const result = resolveTemplate(stripQuotes(raw), environment, refs);
        for (const [name, value] of refs) references.set(name, value);
        return { ...result, localPreview: [...refs.values()].some(value => value.localPreview), dependencies: [...refs.keys()] };
      },
      knownRegisters: new Set([...environment.keys(), ...(previewContexts.get(environment)?.inputs.keys() || [])]),
      readTable: request => options.dataOptions?.resolvePreviewExcelData?.(request),
      write: (name, value, dependencies, localPreview) => {
        if (value === undefined) { setUnknownRuntimeValue(environment, name, sourceLabel, sourceLine); return; }
        // A local row selector is a scenario dependency, not the origin of cell
        // text. Source-table markup stays source markup and never gains IDX rights.
        environment.set(name, { value, previewValue: value, complete: true, localPreview,
          dependencies: dependencies.flatMap(key => references.get(key) ? [references.get(key)!] : []),
          sourceLabel, sourceLine: sourceLine + 1 });
      },
      warn: message => warnings.push(message),
    }, options.engine)) return;
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
    const arithmeticParts = splitArguments(split.remainder);
    if (options.previewValues !== undefined && options.engine === 'GOM'
      && (command === 'MUL' || command === 'DIV') && arithmeticParts.length === 2) {
      let complete = true;
      const operand = (raw: string) => resolvePreviewExpression(raw, name => {
        const identity = resolveTarget(name, environment);
        const value = identity ? readVariable(identity, environment) : undefined;
        if (!value) { complete = false; return undefined; }
        recordReference(references, identity!, value, environment);
        complete = complete && value.complete;
        return value.value;
      }, options.engine, previewFunctionResolverFor(environment));
      const left = operand(arithmeticParts[0]), right = operand(arithmeticParts[1]);
      const calculated = complete && left !== undefined && right !== undefined
        ? calculatePreviewDecimal(command, left, right) : undefined;
      if (calculated === undefined) {
        setUnknownRuntimeValue(environment, target, sourceLabel, sourceLine);
        warnings.push(`本地预览不能精确计算三参数 ${command} ${target}`);
      } else environment.set(target, { value: calculated, previewValue: calculated, complete: true,
        dependencies: [...references.values()], localPreview: [...references.values()].some(value => value.localPreview),
        sourceLabel, sourceLine: sourceLine + 1 });
      return;
    }
    // A bare right-hand variable is an engine-specific syntax feature, not a
    // generic template expression.  Keep this gate deliberately narrow:
    //   * GEE/LFM's existing BOO compatibility contract accepts an exact
    //     scalar token (including the custom N$/S$ forms already covered by
    //     the GEE regression suite).  This is intentionally limited to
    //     scalar contracts; collections and object expressions stay literal.
    //     The available GXX source snapshot directly confirms this scalar-copy
    //     path for that build: LocalDB fills VarInfo2 via GetValNameInfo,
    //     including N$/S$ custom variables; ProcessParams first preserves the
    //     raw operand and then calls the GetVarValue overload that resolves it
    //     when VarInfo2.VarAttr > aNone; ActionOfMov passes the resolved
    //     sParam2/nParam2 into SetVarValue. This is strong evidence for the
    //     GXX/GEE-family behavior, while remaining version/profile-scoped
    //     rather than a claim about every downstream engine build.
    //   * GOM has a documented numeric custom-variable example in its CSV
    //     helper (`MOV N$找到 N$行`), so numeric-to-numeric copies are kept.
    //     A text target must remain the literal token (`MOV S$目标 N$IDX` is
    //     commonly used as a dynamic database target name).
    //   * 996PC explicitly removed the old `MOV N1 N2` form; its current
    //     syntax requires <$STR(...)>, so it must not be treated as a copy.
    //
    // Never apply this to prose, collections, object expressions or resource
    // arguments, and never re-evaluate a copied value as source markup.
    const bareName = split.remainder.trim();
    const bareContract = command === 'MOV'
      && /^(?:[PDMNGIASTUJZ]\d+|[NS]\$[A-Za-z0-9_\u3400-\u9fff]+)$/i.test(bareName)
      ? previewVariableContract(bareName, options.engine) : undefined;
    const targetContract = previewVariableContract(target, options.engine);
    const bareOperand = bareContract
      && ((options.engine === 'GEE'
        && (bareContract.kind === 'number' || bareContract.kind === 'text')
        )
        || (options.engine === 'GOM'
          && bareContract.kind === 'number' && targetContract?.kind === 'number'))
      ? bareContract : undefined;
    // 996PC explicitly removed the old `MOV N1 N2` spelling.  Do not copy
    // its current preview input into a numeric target or leave a literal
    // token looking like a resolved number; the local contract is unknown and
    // therefore renders its numeric fallback 0 with a diagnostic.
    if (!bareOperand && options.engine === '996PC' && bareContract?.kind === 'number'
      && targetContract?.kind === 'number') {
      setUnknownRuntimeValue(environment, target, sourceLabel, sourceLine);
      warnings.push(`996PC MOV ${target} 的裸变量参数未按当前语法解析；请使用 <$STR(...)>，本地预览使用 0`);
      return;
    }
    const bareSource = bareOperand ? readVariable(bareOperand.name, environment) : undefined;
    if (bareOperand && bareSource) recordReference(references, bareOperand.name, bareSource, environment);
    const value = bareOperand
      ? { value: bareSource?.value ?? defaultVariableValue(bareOperand.name, environment), complete: bareSource?.complete ?? false }
      : resolveTemplate(split.remainder, environment, references);
    const preview = bareOperand
      ? { value: bareSource ? previewRuntimeValue(bareOperand.name, bareSource, { previewUnknownText: true })
        : bareOperand.kind === 'text' ? '预览文字' : '0', complete: value.complete }
      : resolveTemplate(
      split.remainder,
      environment,
      undefined,
      { previewUnknownText: true }
    );
    // MOV replaces the whole value and must not inherit the target's previous
    // preview input. Arithmetic/string mutations do read the old value.
    const current = (command === 'MOV' ? undefined : readVariable(target, environment)) || {
      value: defaultVariableValue(target, environment),
      complete: false,
    };
    let next = value.value === '' && !isStringVariable(target, environment)
      ? defaultVariableValue(target, environment)
      : value.value;
    let nextPreview = preview.value === '' && !isStringVariable(target, environment)
      ? defaultVariableValue(target, environment)
      : preview.value;
    let complete = value.complete;
    if (command === 'INC') {
      if (isStringVariable(target, environment) || !isFiniteNumber(current.value) || !isFiniteNumber(value.value)) {
        next = current.value + value.value;
        nextPreview = (current.previewValue ?? current.value) + preview.value;
      } else {
        next = String(Number(current.value) + Number(value.value));
        nextPreview = next;
      }
      complete = current.complete && value.complete;
    } else if (command === 'DEC' && options.previewValues !== undefined && options.engine === 'GOM'
      && isStringVariable(target, environment)) {
      const deletion = current.complete && value.complete
        ? previewStringDeletion(current.value, current.previewValue ?? current.value, value.value) : undefined;
      complete = deletion !== undefined;
      next = deletion?.value ?? defaultVariableValue(target, environment);
      nextPreview = deletion?.previewValue ?? '预览文字';
      if (!complete) warnings.push(`本地预览不能确定字符串 DEC ${target} 的删除范围或字符边界`);
    } else if (command === 'DEC' || command === 'MUL' || command === 'DIV') {
      if (!isFiniteNumber(current.value) || !isFiniteNumber(value.value)
        || (command === 'DIV' && Number(value.value) === 0)) {
        next = defaultVariableValue(target, environment);
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
    if (options.previewValues !== undefined && command !== 'MOV' && !isStringVariable(target, environment)) {
      const exact = calculatePreviewDecimal(command, current.value, value.value);
      if (exact === undefined) {
        complete = false;
        next = defaultVariableValue(target, environment);
        warnings.push(`本地预览不能精确计算 ${command} ${target}，请为该变量输入预览值`);
      } else next = exact;
      nextPreview = next;
    }
    if (unresolvedConstantPattern(options.engine).test(preview.value)) {
      complete = false;
      if (isStringVariable(target, environment)) nextPreview = preview.value.replace(unresolvedConstantPattern(options.engine), '预览文字');
      else next = nextPreview = defaultVariableValue(target, environment);
      warnings.push(`未确定常量参与 ${command} ${target}，仅使用本地显示回退，不作为静态值证明`);
    }
    environment.set(target, {
      value: next,
      previewValue: nextPreview,
      sourceLiteral: command === 'MOV' && !bareOperand && complete && references.size === 0 && !/<\$/.test(split.remainder),
      localPreview: [...references.values()].some(reference => reference.localPreview)
        || (command !== 'MOV' && current.localPreview === true),
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
      value: defaultVariableValue(target, environment),
      complete: false,
      sourceLabel,
      sourceLine: sourceLine + 1,
    });
    return;
  }

  if (command === 'SETSTRINGBLANK') {
    const target = resolveTarget(splitArguments(rest)[0] || '', environment);
    if (target) environment.set(target, {
      value: defaultVariableValue(target, environment),
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
    const calculated = expression.complete ? calculateSimpleFormula(expression.value, options.engine === 'GOM') : undefined;
    if (calculated === undefined && options.previewValues !== undefined) warnings.push(`本地预览不能确定 FORMULATION ${target} 的结果，使用未知值占位`);
    environment.set(target, {
      value: calculated ?? defaultVariableValue(target, environment),
      complete: calculated !== undefined,
      localPreview: [...references.values()].some(reference => reference.localPreview),
      sourceLabel,
      sourceLine: sourceLine + 1,
      dependencies: [...references.values()],
    });
    return;
  }

  const parts = splitArguments(rest);
  const percentage = (command === 'PERCENT' && options.engine !== 'GEE') ? 'ratio'
    : (command === (options.engine === 'GEE' ? 'CALCPERCENT' : 'CALCPER')) ? 'portion' : undefined;
  if (options.previewValues !== undefined && percentage) {
    const outputIndex = percentage === 'ratio' ? 0 : 2;
    const target = resolveRuntimeOutputTarget(parts[outputIndex] || '', environment);
    if (!target) return;
    const references = new Map<string, DialogResolvedVariable>();
    let complete = parts.length === 3;
    const readOperand = (raw: string): string | undefined => resolvePreviewExpression(raw, name => {
      const value = readVariable(name, environment);
      if (!value) { complete = false; return undefined; }
      recordReference(references, name, value, environment);
      complete = complete && value.complete;
      return value.value;
    }, options.engine, previewFunctionResolverFor(environment));
    const left = readOperand(parts[percentage === 'ratio' ? 1 : 0] || '');
    const right = readOperand(parts[percentage === 'ratio' ? 2 : 1] || '');
    const product = left !== undefined && right !== undefined && complete
      ? calculatePreviewDecimal('MUL', left, percentage === 'ratio' ? '100' : right) : undefined;
    const result = product !== undefined && right !== undefined
      ? calculatePreviewDecimal('DIV', product, percentage === 'ratio' ? right : '100') : undefined;
    // Own-engine help proves the formula, but not fractional rounding. Only
    // exact integer quotients are portable local results; never guess rounding.
    if (result === undefined || !/^[+-]?\d+$/.test(result)) {
      setUnknownRuntimeValue(environment, target, sourceLabel, sourceLine);
      return;
    }
    environment.set(target, { value: result, previewValue: result, complete: true,
      localPreview: [...references.values()].some(value => value.localPreview), dependencies: [...references.values()],
      sourceLabel, sourceLine: sourceLine + 1 });
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
      : { value: defaultVariableValue(target, environment), complete: false };
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
        value: complete ? fields[index].trim() : defaultVariableValue(target, environment),
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
      value: complete ? line.trim() : defaultVariableValue(target, environment),
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
      value: value ?? defaultVariableValue(target, environment),
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
        value: complete ? String(value) : defaultVariableValue(target, environment),
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
      value: complete ? String(found) : defaultVariableValue(target, environment),
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
    const literalNameVariable = /^<\$STR\(\s*([^()]+)\s*\)>$/i.exec(rawItemName)?.[1];
    const literalName = literalNameVariable
      ? environment.get(normalizeScriptVariableName(literalNameVariable.trim()))?.sourceLiteral === true
      : !/<\$/i.test(rawItemName);
    const result = itemName.complete && field.complete
      ? options.dataOptions?.resolveDatabaseField?.({
        itemName: itemName.value,
        field: field.value,
      })
      : undefined;
    environment.set(target, {
      value: result?.complete ? result.value : defaultVariableValue(target, environment),
      complete: result?.complete === true,
      ...(result?.complete === true
        && parts.length === 3
        && literalName
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
    const references = new Map<string, DialogResolvedVariable>();
    const source = resolveTemplate(parts[1], environment, references);
    const preview = resolveTemplate(parts[1], environment, undefined, { previewUnknownText: true });
    const localPreview = [...references.values()].some(reference => reference.localPreview);
    const values = delimiter ? source.value.split(delimiter) : [source.value];
    // Literal protection is length preserving. Split at semantic boundaries,
    // then copy the matching display spans so mixed source/user text retains
    // each fragment's origin instead of protecting an entire derived string.
    let sourceOffset = 0;
    const displays = values.map(value => {
      const display = preview.value.slice(sourceOffset, sourceOffset + value.length);
      sourceOffset += value.length + delimiter.length;
      return display;
    });
    parts.slice(2).forEach((rawTarget, index) => {
      const target = resolveTarget(rawTarget, environment);
      if (!target) return;
      environment.set(target, {
        value: values[index] ?? defaultVariableValue(target, environment),
        ...(values[index] !== undefined ? { previewValue: displays[index] } : {}),
        localPreview,
        dependencies: [...references.values()],
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
      value: defaultVariableValue(target, environment),
      complete: false,
      sourceLabel,
      sourceLine: sourceLine + 1,
    });
    return;
  }

  const unknownOutputTargets = unmodeledRuntimeOutputTargets(command, parts, environment, options.engine);
  if (unknownOutputTargets) {
    for (const target of unknownOutputTargets) setUnknownRuntimeValue(environment, target, sourceLabel, sourceLine);
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
  environment: ReadonlyMap<string, RuntimeValue>,
  engine: EngineId
): string[] | undefined {
  const indexes = runtimePreviewOutputIndexes(command, engine);
  const families = runtimePreviewOutputFamilyIndexes(command, engine);
  const implicit = runtimePreviewImplicitOutputs(command, engine);
  if (!indexes && !families && !implicit) return undefined;
  const targets = (indexes || []).flatMap(index => {
    const target = resolveRuntimeOutputTarget(parts[index] || '', environment);
    return target ? [target] : [];
  });
  const knownNames = new Set([...environment.keys(), ...(previewContexts.get(environment)?.inputs.keys() || [])]);
  for (const index of families || []) {
    const prefix = resolveRuntimeOutputTarget(parts[index] || '', environment);
    if (!prefix) continue;
    for (const name of knownNames) {
      if (name.startsWith(prefix) && /^[1-9]\d*$/.test(name.slice(prefix.length))) targets.push(name);
    }
  }
  return [...new Set([...targets, ...(implicit || [])])];
}

function setUnknownRuntimeValue(
  environment: Map<string, RuntimeValue>,
  target: string,
  sourceLabel: string,
  sourceLine: number
): void {
  const input = inputContract(target, environment);
  environment.set(target, {
    value: defaultVariableValue(target, environment),
    complete: false,
    ...(input ? { previewInputNames: [input.name] } : {}),
    sourceLabel,
    sourceLine: sourceLine + 1,
  });
}

function resolveTarget(raw: string, environment: ReadonlyMap<string, RuntimeValue>): string | undefined {
  const value = raw.trim();
  const alias = previewContexts.get(environment)?.declaredAliases?.get(value);
  if (alias) return alias;
  const direct = inputContract(value, environment);
  if (direct) return direct.name;
  if (VARIABLE_NAME.test(value)) return normalizeScriptVariableName(value);
  if (value.includes('<$')) {
    const resolved = resolveTemplate(value, environment).value.trim();
    const indirect = inputContract(resolved, environment);
    if (indirect) return indirect.name;
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

function unresolvedConstantPattern(engine: EngineId): RegExp {
  return engine === '996PC' ? /\$\([^\s()$<>|{}\[\]]+\)/g : /\(\$[^\s()$<>|{}\[\]]+\)/g;
}

function resolveTemplate(
  input: string,
  environment: ReadonlyMap<string, RuntimeValue>,
  references?: Map<string, DialogResolvedVariable>,
  options: ResolveTemplateOptions = {}
): TemplateResult {
  let value = input;
  let complete = true;
  const finish = (value: string, complete: boolean): TemplateResult => {
    const context = previewContexts.get(environment);
    // Check before restoring protected user text. Unexpanded source constants
    // cannot become complete literal operands just because they lack <$...>.
    if (context && unresolvedConstantPattern(context.engine).test(value)) complete = false;
    return {value:context && !options.previewUnknownText ? restorePreviewText(value) : value,complete};
  };
  for (let pass = 0; pass < MAX_TEMPLATE_PASSES; pass++) {
    const resolved = resolveTemplatePass(value, environment, references, options);
    complete = complete && resolved.complete;
    if (resolved.value === value) return finish(value, complete);
    value = resolved.value;
  }
  return finish(value, false);
}

function resolveTemplatePass(
  input: string,
  environment: ReadonlyMap<string, RuntimeValue>,
  references: Map<string, DialogResolvedVariable> | undefined,
  options: ResolveTemplateOptions
): TemplateResult {
  const context = previewContexts.get(environment);
  if (context) return resolveTypedTemplatePass(input, environment, references, options, context.engine);
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
          value: VARIABLE_NAME.test(variableName) ? defaultVariableValue(variableName, environment) : variableName,
          complete: !VARIABLE_NAME.test(variableName),
        };
        output += previewRuntimeValue(variableName, replacement, options);
        complete = complete && resolvedInner.complete && replacement.complete;
        recordReference(references, variableName, replacement, environment);
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
          value: VARIABLE_NAME.test(variableName) ? defaultVariableValue(variableName, environment) : '',
          complete: false,
        };
        output += previewRuntimeValue(variableName, replacement, options);
        complete = complete && replacement.complete;
        recordReference(references, variableName, replacement, environment);
        cursor = end + 1;
        continue;
      }
    }
    output += input[cursor++];
  }
  return { value: output, complete };
}

/** Balanced templates share the same contract as condition operands. Only the
 * display channel receives escaped user text; raw values retain their provenance. */
function resolveTypedTemplatePass(input: string, environment: ReadonlyMap<string, RuntimeValue>,
  references: Map<string, DialogResolvedVariable> | undefined, options: ResolveTemplateOptions, engine: EngineId): TemplateResult {
  let output = '', cursor = 0, complete = true;
  while (cursor < input.length) {
    const start = input.indexOf('<$', cursor);
    if (start < 0) { output += input.slice(cursor); break; }
    output += input.slice(cursor, start);
    let end = start + 2, depth = 1;
    for (; end < input.length; end++) {
      if (input[end] === '<' && input[end + 1] === '$') { depth++; end++; }
      else if (input[end] === '>' && --depth === 0) break;
    }
    if (depth !== 0) { output += input.slice(start); complete = false; break; }
    const expression = input.slice(start, end + 1);
    if (engine === '996PC' && isClientTextFlowMarkup(expression)) {
      output += expression;
      cursor = end + 1;
      continue;
    }
    let lastRead: { name: string; value: RuntimeValue; collection: boolean } | undefined;
    const resolved = resolvePreviewExpression(expression, name => {
      const value = readVariable(name, environment);
      if (!value) { complete = false; return undefined; }
      recordReference(references, name, value, environment);
      complete = complete && value.complete;
      const kind = inputContract(name, environment)?.kind;
      lastRead = { name, value, collection: kind === 'list' || kind === 'dictionary' };
      if (kind === 'list' || kind === 'dictionary') {
        return value.value;
      }
      return value.value;
    }, engine, previewFunctionResolverFor(environment));
    if (resolved === undefined) { complete = false; output += options.previewUnknownText ? '预览文字' : ''; }
    else if (lastRead?.collection) output += resolvePreviewCollectionDisplayExpression(expression,
      name => readVariable(name, environment)?.value, name => readVariable(name, environment)?.previewValue, engine) ?? resolved;
    else if (lastRead && !lastRead.collection && resolved === lastRead.value.value) {
      // Preserve protected user fragments until ALL template passes finish;
      // raw substitution must not evaluate a user literal <$STR(...)> again.
      output += lastRead.value.previewValue ?? previewRuntimeValue(lastRead.name, lastRead.value, options);
    } else output += resolved;
    cursor = end + 1;
  }
  return { value: output, complete };
}

function readVariable(
  rawName: string,
  environment: ReadonlyMap<string, RuntimeValue>
): RuntimeValue | undefined {
  const tracked = (value: RuntimeValue | undefined): RuntimeValue | undefined => {
    const references = previewContexts.get(environment)?.activeReferences;
    if (value && references) recordReference(references, rawName, value, environment);
    return value;
  };
  const input = inputContract(rawName, environment);
  if (input) {
    const known = environment.get(input.name);
    if (known) return tracked(!known.complete && known.previewValue === undefined && input.kind === 'text'
      ? { ...known, previewValue: known.value || '预览文字' } : known);
    if (input.value !== undefined) return tracked({
      value: input.value, previewValue: initialPreviewDisplay(input, input.value),
      complete: true, localPreview: true, previewInputNames: [input.name], sourceLabel: '本地预览输入',
    });
    const defaultValue = input.kind === 'text' ? '预览文字' : defaultVariableValue(input.name, environment);
    return tracked({ value: defaultValue, complete: true, localPreview: true,
      previewInputNames: [input.name], sourceLabel: '本地预览默认值', previewValue: defaultValue });
  }
  if (!VARIABLE_NAME.test(rawName)) return undefined;
  return tracked(environment.get(normalizeScriptVariableName(rawName)));
}

function recordReference(
  references: Map<string, DialogResolvedVariable> | undefined,
  rawName: string,
  value: RuntimeValue,
  environment?: ReadonlyMap<string, RuntimeValue>
): void {
  if (!references) return;
  const input = environment && inputContract(rawName, environment);
  if (!input && !VARIABLE_NAME.test(rawName)) return;
  const name = input?.name || normalizeScriptVariableName(rawName);
  references.set(name, {
    name,
    value: value.value,
    status: value.complete ? 'resolved' : 'default',
    ...(value.localPreview ? { localPreview: true } : {}),
    ...(value.previewInputNames?.length ? { previewInputNames: [...value.previewInputNames] } : {}),
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

function stripPreviewCommandComment(source: string): string {
  let quote = '', bracket = 0, brace = 0, parens = 0, angle = 0;
  const startsLink = (start: number): boolean => {
    let depth = 1;
    for (let cursor = start + 1; cursor < source.length; cursor++) {
      if (source[cursor] === '<') depth++;
      else if (source[cursor] === '>' && --depth === 0) return source.slice(start, cursor).includes('/@');
    }
    return false;
  };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"') { quote = char; continue; }
    if (char === '<' && (/^(?:<\$|<[A-Za-z][A-Za-z0-9_]*(?::|\|))/.test(source.slice(index)) || startsLink(index))) angle++;
    else if (char === '>' && angle) angle--;
    else if (char === '[') bracket++;
    else if (char === ']' && bracket) bracket--;
    else if (char === '{') brace++;
    else if (char === '}' && brace) brace--;
    else if (char === '(') parens++;
    else if (char === ')' && parens) parens--;
    else if (!angle && !bracket && !brace && !parens && char === ';' && (index === 0 || /\s/.test(source[index - 1]))) return source.slice(0, index).trimEnd();
  }
  return source;
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

function invalidateConditionRuntimeOutputs(
  command: string,
  rest: string,
  engine: EngineId,
  environment: Map<string, RuntimeValue>,
  sourceLabel: string,
  sourceLine: number
): void {
  for (const target of unmodeledRuntimeOutputTargets(command, splitArguments(rest), environment, engine) || []) {
    setUnknownRuntimeValue(environment, target, sourceLabel, sourceLine);
  }
}

interface GotoInvocation {
  target: string;
  arguments: string[];
  returnTargets: string[];
  complete: boolean;
}

function parseGotoInvocation(rest: string): GotoInvocation | undefined {
  const source = rest.trim();
  if (!source.startsWith('@')) return undefined;
  const open = source.indexOf('(');
  if (open < 0) {
    return {
      target: cleanTargetLabel(source.split(/\s+/)[0] || ''),
      arguments: [],
      returnTargets: [],
      complete: true,
    };
  }

  const target = cleanTargetLabel(source.slice(0, open));
  const close = findGotoCallClose(source, open);
  if (close < 0) return { target, arguments: [], returnTargets: [], complete: false };
  const complete = source.slice(close + 1).trim() === '';
  const argumentsText = source.slice(open + 1, close);
  const returnSeparator = findTopLevelDelimiter(argumentsText, '|');
  if (returnSeparator < 0) return { target, arguments: splitTopLevelDelimited(argumentsText, ','), returnTargets: [], complete };
  return {
    target,
    arguments: splitTopLevelDelimited(argumentsText.slice(0, returnSeparator), ','),
    returnTargets: splitTopLevelDelimited(argumentsText.slice(returnSeparator + 1), ',', true),
    complete,
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

function splitTopLevelDelimited(value: string, delimiter: string, preserveEmpty = false): string[] {
  const result: string[] = [];
  if (!value.trim()) return result;
  let remaining = value;
  while (true) {
    const index = findTopLevelDelimiter(remaining, delimiter);
    const part = (index < 0 ? remaining : remaining.slice(0, index)).trim();
    if (part || preserveEmpty) result.push(part);
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

function mergeResolvedVariables(
  left: readonly DialogResolvedVariable[],
  right: readonly DialogResolvedVariable[]
): DialogResolvedVariable[] {
  const result = new Map<string, DialogResolvedVariable>();
  for (const variable of [...left, ...right]) {
    const existing = result.get(variable.name);
    if (!existing) {
      result.set(variable.name, variable);
      continue;
    }
    const previewInputNames = [...new Set([
      ...(existing.previewInputNames || []),
      ...(variable.previewInputNames || []),
    ])];
    result.set(variable.name, {
      ...existing,
      ...variable,
      ...(previewInputNames.length > 0 ? { previewInputNames } : {}),
    });
  }
  return [...result.values()];
}

function previewInputNamesFromVariables(
  variables: readonly DialogResolvedVariable[]
): string[] {
  const result = new Set<string>();
  for (const variable of variables) {
    for (const name of variable.previewInputNames || []) result.add(name);
    if ((variable.previewInputNames?.length || 0) > 0) continue;
    const directLocalInput = variable.localPreview === true
      && (!variable.sourceReferences || variable.sourceReferences.length === 0);
    if (directLocalInput || variable.status === 'default') result.add(variable.name);
  }
  return [...result];
}

function mergeRuntimeWriteInputs(
  before: ReadonlyMap<string, RuntimeValue>,
  environment: Map<string, RuntimeValue>,
  dependencies: readonly DialogResolvedVariable[]
): void {
  const dependencyNames = previewInputNamesFromVariables(dependencies);
  for (const [name, value] of [...environment]) {
    if (before.get(name) === value) continue;
    const previewInputNames = new Set([...(value.previewInputNames || []), ...dependencyNames]);
    if (!value.complete) {
      const fallback = inputContract(name, environment);
      if (fallback) previewInputNames.add(fallback.name);
    }
    const mergedDependencies = mergeDependencies(value.dependencies, dependencies);
    environment.set(name, {
      ...value,
      localPreview: value.localPreview === true || dependencies.some(variable => variable.localPreview),
      ...(previewInputNames.size > 0 ? { previewInputNames: [...previewInputNames] } : {}),
      ...(mergedDependencies.length > 0 ? { dependencies: mergedDependencies } : {}),
    });
  }
}

function captureRuntimeWrites(
  environment: Map<string, RuntimeValue>,
  controlVariables: readonly DialogResolvedVariable[],
  action: () => void
): void {
  const before = new Map(environment);
  const context = previewContexts.get(environment);
  const references = new Map<string, DialogResolvedVariable>();
  const previousReferences = context?.activeReferences;
  if (context) context.activeReferences = references;
  try {
    action();
  } finally {
    if (context) context.activeReferences = previousReferences;
  }
  mergeRuntimeWriteInputs(before, environment, mergeResolvedVariables([...references.values()], controlVariables));
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

/** Keep the large decimal values accepted by the input panel exact. A repeating
 * quotient has no documented rounding contract here, so remains an unknown write. */
function calculatePreviewDecimal(command: string, left: string, right: string): string | undefined {
  if ([left, right].some(value => value.length > 4096 || !/^[+-]?\d+(?:\.\d+)?$/.test(value))) return undefined;
  const parse = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return { value: BigInt(whole + fraction), scale: fraction.length };
  };
  const a = parse(left), b = parse(right);
  let scale = Math.max(a.scale, b.scale);
  let value: bigint;
  if (command === 'INC' || command === 'DEC') {
    const x = a.value * 10n ** BigInt(scale - a.scale), y = b.value * 10n ** BigInt(scale - b.scale);
    value = command === 'INC' ? x + y : x - y;
  } else if (command === 'MUL') { value = a.value * b.value; scale = a.scale + b.scale; }
  else if (command === 'DIV') {
    if (b.value === 0n) return undefined;
    let numerator = a.value * 10n ** BigInt(b.scale), denominator = b.value * 10n ** BigInt(a.scale);
    const negative = (numerator < 0n) !== (denominator < 0n);
    numerator = numerator < 0n ? -numerator : numerator;
    denominator = denominator < 0n ? -denominator : denominator;
    let x = numerator, y = denominator;
    while (y) { const remainder = x % y; x = y; y = remainder; }
    numerator /= x; denominator /= x;
    let twos = 0, fives = 0;
    while (denominator % 2n === 0n) { denominator /= 2n; twos++; }
    while (denominator % 5n === 0n) { denominator /= 5n; fives++; }
    if (denominator !== 1n) return undefined;
    scale = Math.max(twos, fives);
    if (scale > 4096) return undefined;
    value = numerator * 2n ** BigInt(scale - twos) * 5n ** BigInt(scale - fives) * (negative ? -1n : 1n);
  } else return undefined;
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const result = (negative ? '-' : '') + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '') : digits);
  return result.length <= 4096 ? result : undefined;
}

function calculateSimpleFormula(rawExpression: string, roundResult = false): string | undefined {
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
  if (roundResult) {
    const floor = Math.floor(value), fraction = value - floor;
    const rounded = fraction < 0.5 ? floor : fraction > 0.5 ? floor + 1 : floor % 2 === 0 ? floor : floor + 1;
    return Number.isSafeInteger(rounded) ? String(rounded) : undefined;
  }
  return String(Number.isInteger(value) ? value : Number(value.toFixed(8)));
}

/** Keep the UTF-16-length-preserving display shadow aligned with raw text. */
function previewStringDeletion(value: string, previewValue: string, operand: string): { value: string; previewValue: string } | undefined {
  const range = /^(\d+)\s+(\d+)$/.exec(operand.trim());
  let start: number, end: number;
  if (range) {
    const from = Number(range[1]) - 1, to = Number(range[2]);
    const encoded = iconv.encode(value, 'gbk');
    if (iconv.decode(encoded, 'gbk') !== value || from < 0 || to <= from || to > encoded.length) return undefined;
    const boundaries = new Map<number, number>([[0, 0]]);
    let bytes = 0, units = 0;
    for (const char of value) { bytes += iconv.encode(char, 'gbk').length; units += char.length; boundaries.set(bytes, units); }
    if (!boundaries.has(from) || !boundaries.has(to)) return undefined;
    start = boundaries.get(from)!; end = boundaries.get(to)!;
  } else {
    const needle = stripQuotes(operand);
    if (!needle) return { value, previewValue };
    start = value.indexOf(needle);
    if (start < 0) return { value, previewValue };
    // Own help does not specify repeated-match deletion; do not invent it.
    if (value.indexOf(needle, start + needle.length) >= 0) return undefined;
    end = start + needle.length;
  }
  return { value: value.slice(0, start) + value.slice(end), previewValue: previewValue.slice(0, start) + previewValue.slice(end) };
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
  let sayContext = false;
  for (const line of source.split(/\r\n|\n|\r/)) {
    const directive = directiveName(line);
    if (directive) {
      sayContext = directive === 'SAY' || directive === 'ELSESAY';
      continue;
    }
    const trimmed = line.trim();
    if (!sayContext || !trimmed || trimmed.startsWith(';') || trimmed.startsWith('//')) continue;
    for (const pattern of [
      /\/\s*(@[^>\s|}]+)/g,
      /\b(?:LINK|DBLINK|CLICK|ACTION|EVENT|ONCLICK)\s*=\s*(@[^|>\s},]+)/gi,
    ]) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(line)) !== null) result.add(match[1]);
    }
  }
  return [...result];
}

function cloneEnvironment(source: ReadonlyMap<string, RuntimeValue>): Map<string, RuntimeValue> {
  const result = new Map([...source].map(([key, value]) => [key, { ...value }]));
  const context = previewContexts.get(source);
  if (context) {
    // Runtime snapshots must retain the cache state that existed at the
    // source line.  Sharing the mutable alias map would let a later
    // CSVOPENCACHE retroactively change an earlier SAY snapshot.
    previewContexts.set(result, {
      ...context,
      csvAliases: new Map([...context.csvAliases].map(([alias, paths]) => [alias, new Set(paths)])),
      csvTables: new Map(context.csvTables),
      ...(context.declaredAliases ? { declaredAliases: new Map(context.declaredAliases) } : {}),
      activeReferences: undefined,
    });
  }
  return result;
}

function defaultVariableValue(rawName: string, environment?: ReadonlyMap<string, RuntimeValue>): string {
  const input = environment && inputContract(rawName, environment);
  if (input?.kind === 'list') return '[]';
  if (input?.kind === 'dictionary') return '{}';
  return isStringVariable(rawName, environment) ? '' : '0';
}

function isStringVariable(rawName: string, environment?: ReadonlyMap<string, RuntimeValue>): boolean {
  const input = environment && inputContract(rawName, environment);
  if (input) return input.kind === 'text';
  return /^(?:(?:GL|[SLD])\$)/i.test(rawName.trim());
}

function isFiniteNumber(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value));
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '');
}

function cleanTargetLabel(value: string): string {
  return value.slice(0, value.indexOf('(') < 0 ? value.length : value.indexOf('(')).trim().replace(/[>,)}\]]+$/, '');
}

function normalizeLabel(value: string): string {
  return value.trim().toUpperCase();
}
