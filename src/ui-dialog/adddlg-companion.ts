import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { decodeTextFile, PreservedTextEncoding } from '../utils/text';
import {
  DialogAddDlgWindow,
  DialogConditionGroup,
  DialogElement,
  DialogScene,
  NpcDialogDocumentModel,
} from './model';
import {
  collectGomAddDlgCloseActions,
  findNpcDialogFunctionLabelOffset,
  ParseNpcDialogOptions,
  parseNpcDialogDocument,
  reflowNpcDialogLayout,
} from './source-parser';

const QFUNCTION_RELATIVE_PATHS = [
  ['Mir200', 'Envir', 'Market_Def', 'QFunction-0.txt'],
  ['Envir', 'Market_Def', 'QFunction-0.txt'],
] as const;

export interface AddDlgCompanionSource {
  uri: string;
  fileName: string;
  filePath: string;
  documentVersion: number;
  text: string;
  encoding?: PreservedTextEncoding;
  size?: number;
  mtimeMs?: number;
}

interface AddDlgCompanionResolutionBase {
  candidateFilePaths: string[];
}

export interface FoundAddDlgCompanionResolution extends AddDlgCompanionResolutionBase {
  status: 'found';
  source: AddDlgCompanionSource;
}

export interface MissingAddDlgCompanionResolution extends AddDlgCompanionResolutionBase {
  status: 'missing';
}

export interface AmbiguousAddDlgCompanionResolution extends AddDlgCompanionResolutionBase {
  status: 'ambiguous';
  existingFilePaths: string[];
}

export type AddDlgCompanionResolution =
  | FoundAddDlgCompanionResolution
  | MissingAddDlgCompanionResolution
  | AmbiguousAddDlgCompanionResolution;

export function addDlgCompanionCandidatePaths(workspaceRoot: string): string[] {
  return QFUNCTION_RELATIVE_PATHS.map(parts => path.join(workspaceRoot, ...parts));
}

export function isAddDlgCompanionCandidate(
  workspaceRoot: string,
  filePath: string
): boolean {
  const target = normalizedPath(filePath);
  return addDlgCompanionCandidatePaths(workspaceRoot)
    .some(candidate => normalizedPath(candidate) === target);
}

export function resolveAddDlgCompanion(workspaceRoot: string): AddDlgCompanionResolution {
  const candidateFilePaths = addDlgCompanionCandidatePaths(workspaceRoot);
  const existingFilePaths = candidateFilePaths.filter(isFile);
  if (existingFilePaths.length === 0) return { status: 'missing', candidateFilePaths };
  if (existingFilePaths.length > 1) {
    return { status: 'ambiguous', candidateFilePaths, existingFilePaths };
  }
  const filePath = existingFilePaths[0];
  const raw = fs.readFileSync(filePath);
  const decoded = decodeTextFile(raw);
  const stat = fs.statSync(filePath);
  return {
    status: 'found',
    candidateFilePaths,
    source: {
      uri: pathToFileURL(filePath).toString(),
      fileName: path.basename(filePath),
      filePath,
      documentVersion: 0,
      text: decoded.text,
      encoding: decoded.encoding,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    },
  };
}

export function parseNpcDialogDocumentWithCompanion(
  primaryText: string,
  options: ParseNpcDialogOptions,
  resolution: AddDlgCompanionResolution
): NpcDialogDocumentModel {
  const model = parseNpcDialogDocument(primaryText, options);
  model.companionCandidateFilePaths = [...resolution.candidateFilePaths];
  if (options.engine !== 'GOM' || model.addDlgWindows.length === 0) return model;

  const attachedWindowIds = new Set(
    model.scenes.map(scene => scene.addDlgWindow?.id).filter((id): id is string => Boolean(id))
  );
  const pending = model.addDlgWindows.filter(window => !attachedWindowIds.has(window.id));
  if (pending.length === 0) return model;

  if (resolution.status === 'missing') {
    const warning = `AddDlg 未找到标准 QFunction-0.txt：${resolution.candidateFilePaths.join('；')}`;
    pushUnique(model.warnings, warning);
    for (const window of pending) attachSyntheticWindow(model, window, warning);
    reflowNpcDialogLayout(model);
    return model;
  }
  if (resolution.status === 'ambiguous') {
    const warning = `AddDlg 找到多个 QFunction-0.txt，无法安全确定 companion：${resolution.existingFilePaths.join('；')}`;
    pushUnique(model.warnings, warning);
    for (const window of pending) attachSyntheticWindow(model, window, warning);
    reflowNpcDialogLayout(model);
    return model;
  }

  const companion = resolution.source;
  model.companionUris = [companion.uri];
  model.companionFilePaths = [companion.filePath];
  for (const window of pending) {
    attachExternalWindow(model, window, companion, options);
  }
  reflowNpcDialogLayout(model);
  return model;
}

export function dialogElementSource(
  model: NpcDialogDocumentModel,
  element: DialogElement
): { uri: string; filePath: string; documentVersion: number } {
  return {
    uri: element.sourceUri || model.uri,
    filePath: element.sourceFilePath || model.filePath,
    documentVersion: element.sourceDocumentVersion ?? model.documentVersion,
  };
}

export function isDialogCompanionModelSource(
  model: NpcDialogDocumentModel,
  filePath: string
): boolean {
  if (model.addDlgWindows.length === 0) return false;
  const target = normalizedPath(filePath);
  return [...model.companionFilePaths, ...model.companionCandidateFilePaths]
    .some(candidate => normalizedPath(candidate) === target);
}

export function dialogCompanionSourceChangeAction(
  model: NpcDialogDocumentModel,
  filePath: string,
  hasVisualDrafts: boolean
): 'ignore' | 'reload' | 'conflict' {
  if (!isDialogCompanionModelSource(model, filePath)) return 'ignore';
  return hasVisualDrafts ? 'conflict' : 'reload';
}

function attachExternalWindow(
  model: NpcDialogDocumentModel,
  window: DialogAddDlgWindow,
  companion: AddDlgCompanionSource,
  primaryOptions: ParseNpcDialogOptions
): void {
  if (!window.qfTarget) {
    attachSyntheticWindow(model, window, 'AddDlg 的 QF 目标为动态值或无效值，无法读取 companion 页面');
    return;
  }
  const cursorOffset = findNpcDialogFunctionLabelOffset(companion.text, window.qfTarget);
  if (cursorOffset === undefined) {
    const warning = `QFunction-0.txt 未找到 QF 标签 ${window.qfTarget}`;
    replacePreliminaryMissingWarning(model, window, window.qfTarget);
    pushWindowWarning(model, window, warning);
    attachSyntheticWindow(model, window, warning);
    return;
  }

  let companionModel: NpcDialogDocumentModel;
  const prefix = `COMPANION:${window.id}:`;
  const companionConditionStates = Object.fromEntries(
    Object.entries(primaryOptions.conditionStates || {})
      .filter(([id]) => id.startsWith(prefix))
      .map(([id, value]) => [id.slice(prefix.length), value])
  );
  try {
    companionModel = parseNpcDialogDocument(companion.text, {
      ...primaryOptions,
      uri: companion.uri,
      fileName: companion.fileName,
      filePath: companion.filePath,
      documentVersion: companion.documentVersion,
      cursorOffset,
      conditionStates: companionConditionStates,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const warning = `QFunction-0.txt 的 ${window.qfTarget} 无法解析：${message}`;
    pushWindowWarning(model, window, warning);
    attachSyntheticWindow(model, window, warning);
    return;
  }

  replacePreliminaryMissingWarning(model, window, window.qfTarget);
  window.closeActions = collectGomAddDlgCloseActions(companion.text, window.qfTarget);
  const readOnlyWarning = `外部 QFunction companion ${path.basename(companion.filePath)} 为只读预览；定位源码会打开该文件`;
  pushWindowWarning(model, window, readOnlyWarning);
  const unsupportedOkBox = companionModel.scenes.some(scene => (
    scene.elements.some(element => /^<?&?ITEMBOX\b/i.test(element.token) || /^<ITEMBOX\b/i.test(element.raw))
    || scene.unsupportedStatements.some(statement => /<?&?ITEMBOX\b/i.test(statement))
  ));
  if (unsupportedOkBox) {
    pushWindowWarning(
      model,
      window,
      'GOM 官方 AddDlg 说明不支持 ITEMBOX/OK框；Ctrl+F12 仅保留静态展示，不代表客户端能够使用'
    );
  }

  const labelSuffix = ` · AddDlg #${window.dialogId ?? '?'}`;
  const conditionIdMap = new Map(
    companionModel.conditionGroups.map(group => [group.id, `${prefix}${group.id}`])
  );
  const clonedGroups = companionModel.conditionGroups.map(group => cloneConditionGroup(
    group,
    conditionIdMap,
    labelSuffix
  ));
  model.conditionGroups.push(...clonedGroups);
  for (const warning of companionModel.warnings) pushUnique(model.warnings, warning);
  if (companionModel.scenes.length === 0) {
    attachSyntheticWindow(
      model,
      window,
      `QFunction-0.txt 的 ${window.qfTarget} 没有可静态展示的 #SAY 或界面语句`
    );
    return;
  }
  for (const scene of companionModel.scenes) {
    model.scenes.push(cloneCompanionScene(
      scene,
      window,
      companion,
      prefix,
      conditionIdMap,
      labelSuffix,
      readOnlyWarning
    ));
  }
}

function cloneConditionGroup(
  group: DialogConditionGroup,
  conditionIdMap: ReadonlyMap<string, string>,
  labelSuffix: string
): DialogConditionGroup {
  return {
    ...group,
    id: conditionIdMap.get(group.id) || group.id,
    sourceLabel: `${group.sourceLabel}${labelSuffix}`,
    title: `${group.title}${labelSuffix}`,
  };
}

function cloneCompanionScene(
  scene: DialogScene,
  window: DialogAddDlgWindow,
  companion: AddDlgCompanionSource,
  prefix: string,
  conditionIdMap: ReadonlyMap<string, string>,
  labelSuffix: string,
  readOnlyWarning: string
): DialogScene {
  const elementIdMap = new Map(scene.elements.map(element => [element.id, `${prefix}${element.id}`]));
  const elements = scene.elements.map(element => cloneCompanionElement(
    element,
    companion,
    prefix,
    elementIdMap,
    readOnlyWarning
  ));
  const previewPath = Object.fromEntries(Object.entries(scene.previewPath).map(([id, value]) => [
    conditionIdMap.get(id) || `${prefix}${id}`,
    value,
  ]));
  const background = scene.background ? {
    ...scene.background,
    sourceUri: companion.uri,
    sourceFilePath: companion.filePath,
    sourceDocumentVersion: companion.documentVersion,
    ...(scene.background.offsetBinding ? {
      offsetBinding: {
        ...scene.background.offsetBinding,
        id: `${prefix}${scene.background.offsetBinding.id}`,
        sourceUri: companion.uri,
        sourceFilePath: companion.filePath,
        sourceDocumentVersion: companion.documentVersion,
        editable: false,
      },
    } : {}),
  } : undefined;
  return {
    ...scene,
    id: `${prefix}${scene.id}`,
    title: `${scene.title}${labelSuffix}`,
    sourceLabel: `${scene.sourceLabel}${labelSuffix}`,
    ...(scene.conditionGroupId ? {
      conditionGroupId: conditionIdMap.get(scene.conditionGroupId) || `${prefix}${scene.conditionGroupId}`,
    } : {}),
    previewPath,
    addDlgWindow: window,
    ...(background ? { background } : {}),
    elements,
    warnings: unique([...scene.warnings, ...window.warnings, readOnlyWarning]),
  };
}

function cloneCompanionElement(
  element: DialogElement,
  companion: AddDlgCompanionSource,
  prefix: string,
  elementIdMap: ReadonlyMap<string, string>,
  readOnlyWarning: string
): DialogElement {
  const remap = (id: string | undefined): string | undefined => (
    id ? elementIdMap.get(id) || `${prefix}${id}` : undefined
  );
  return {
    ...element,
    id: elementIdMap.get(element.id) || `${prefix}${element.id}`,
    sourceUri: companion.uri,
    sourceFilePath: companion.filePath,
    sourceDocumentVersion: companion.documentVersion,
    editable: false,
    ...(element.containerElementId ? { containerElementId: remap(element.containerElementId) } : {}),
    ...(element.containerParentId ? { containerParentId: remap(element.containerParentId) } : {}),
    ...(element.containerChildIds ? {
      containerChildIds: element.containerChildIds.map(id => remap(id)!),
    } : {}),
    ...(element.parentElementId ? { parentElementId: remap(element.parentElementId) } : {}),
    warning: element.warning ? `${element.warning}；${readOnlyWarning}` : readOnlyWarning,
  };
}

function attachSyntheticWindow(
  model: NpcDialogDocumentModel,
  window: DialogAddDlgWindow,
  warning: string
): void {
  pushWindowWarning(model, window, warning);
  const sourceLabel = `${window.qfTarget || `AddDlg #${window.dialogId ?? '?'}`} · AddDlg #${window.dialogId ?? '?'}`;
  model.scenes.push({
    id: `SYNTHETIC:${window.id}`,
    title: sourceLabel,
    sourceLabel,
    marker: 'STATIC',
    conditions: [],
    conditionOperators: [],
    previewPath: {},
    conditionSummary: 'AddDlg companion 不可用，保留静态窗口',
    sourceStart: window.sourceRange.start,
    sourceEnd: window.sourceRange.end,
    addDlgWindow: window,
    elements: [],
    unsupportedStatements: [],
    warnings: unique([...window.warnings, warning]),
    resolvedVariables: [],
  });
}

function pushWindowWarning(
  model: NpcDialogDocumentModel,
  window: DialogAddDlgWindow,
  warning: string
): void {
  pushUnique(window.warnings, warning);
  pushUnique(model.warnings, warning);
}

function replacePreliminaryMissingWarning(
  model: NpcDialogDocumentModel,
  window: DialogAddDlgWindow,
  resolvedTarget: string | undefined
): void {
  const prefix = 'AddDlg 未找到 QF 标签 ';
  window.warnings = window.warnings.filter(warning => !warning.startsWith(prefix));
  if (resolvedTarget) {
    model.warnings = model.warnings.filter(warning => warning !== `${prefix}${resolvedTarget}`);
  }
}

function normalizedPath(filePath: string): string {
  return path.resolve(filePath).replace(/\//g, '\\').toLowerCase();
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
